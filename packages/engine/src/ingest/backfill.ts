import type { JiraIssue } from '../jira/types.js';
import type { MetricsStore, IndexStateRow } from '../store/types.js';
import type { Millis } from '../types.js';
import type { Clock, JiraApi, Logger, Scheduler } from './ports.js';
import { HttpError } from './ports.js';
import {
  processIssue,
  writeProcessed,
  type IngestConfig,
  type ProcessedIssue,
} from './process-issue.js';
import { withRetry } from './retry.js';

/**
 * Chunked, resumable, rate-limit-aware backfill.
 *
 * This is the hard part of the product — the dossier puts it at ~60% of the
 * engine's engineering — and the reason is that none of the obvious approaches
 * work on a Forge platform that is consumption-priced and caps invocation time:
 *
 * - A single "index everything" call times out on any real instance.
 * - A nightly full re-index inverts unit economics as installs grow.
 * - An unthrottled loop trips Jira's rate limit and gets the app noticed for
 *   the wrong reasons.
 *
 * So backfill runs as a **sequence of slices**. Each slice:
 *
 * 1. reads the persisted cursor from `index_state`;
 * 2. pulls one page of issues, oldest first, ordered by `created ASC` so the
 *    ordering is stable even while the instance keeps changing underneath us;
 * 3. processes issues until either the page is exhausted, the issue budget is
 *    spent, or the **time budget** is spent;
 * 4. writes aggregates and the new cursor **in that order**, so a crash between
 *    the two re-processes a page rather than skipping one (at-least-once, and
 *    `putIssueAggregate` is idempotent by replacement);
 * 5. asks the scheduler to enqueue the next slice, or marks the state complete.
 *
 * The time budget defaults to 40 s. Forge's asynchronous invocation limit is
 * larger than that, but the exact figure is a platform quota that changes:
 * **confirm the current value in Atlassian's "Platform quotas and limits" page
 * before release and set `timeBudgetMs` accordingly.** The default is chosen to
 * be safe rather than optimal.
 */

export interface BackfillOptions {
  readonly projectId: string;
  /** Extra JQL, ANDed with the project clause. */
  readonly extraJql?: string;
  /** Do not index issues created before this instant. `null` means all history. */
  readonly historyFrom?: Millis | null;
  readonly issuesPerSlice: number;
  readonly pageSize: number;
  readonly timeBudgetMs: number;
  /** Milliseconds to pause between issues, to stay well under the rate limit. */
  readonly throttleMs?: number;
}

export const DEFAULT_BACKFILL_OPTIONS: Omit<BackfillOptions, 'projectId'> = {
  issuesPerSlice: 100,
  pageSize: 50,
  timeBudgetMs: 40_000,
  throttleMs: 0,
};

export interface BackfillDeps {
  readonly api: JiraApi;
  readonly store: MetricsStore;
  readonly scheduler: Scheduler;
  readonly clock: Clock;
  readonly config: IngestConfig;
  readonly logger?: Logger;
}

export interface BackfillSliceResult {
  readonly projectId: string;
  readonly issuesProcessed: number;
  readonly issuesSkipped: number;
  readonly requests: number;
  readonly done: boolean;
  readonly nextCursor: string | null;
  readonly stoppedBecause: 'complete' | 'issue_budget' | 'time_budget' | 'rate_limited' | 'error';
  readonly elapsedMs: Millis;
}

/** The fields the backfill needs from each issue. Fewer fields, smaller pages. */
export const BACKFILL_FIELDS: readonly string[] = [
  'created',
  'updated',
  'resolutiondate',
  'duedate',
  'status',
  'issuetype',
  'priority',
  'assignee',
  'project',
];

export function initialIndexState(
  projectId: string,
  now: Millis,
  from: Millis | null,
): IndexStateRow {
  return {
    projectId,
    state: 'not_started',
    backfillCursor: null,
    backfillFrom: from,
    issuesProcessed: 0,
    issuesTotal: null,
    lastProcessedAt: null,
    lastError: null,
    startedAt: null,
    updatedAt: now,
  };
}

/** Build the JQL for a backfill. Ordered by `created ASC` for a stable cursor. */
export function buildBackfillJql(options: BackfillOptions): string {
  const clauses = [`project = ${quoteJql(options.projectId)}`];
  if (options.historyFrom !== undefined && options.historyFrom !== null) {
    clauses.push(`created >= ${formatJqlInstant(options.historyFrom)}`);
  }
  if (options.extraJql !== undefined && options.extraJql.trim() !== '') {
    clauses.push(`(${options.extraJql.trim()})`);
  }
  return `${clauses.join(' AND ')} ORDER BY created ASC`;
}

/** Quote a JQL literal. Project ids are numeric in practice; quote anyway. */
export function quoteJql(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** JQL wants `"yyyy/MM/dd HH:mm"`; it interprets it in the *user's* timezone. */
export function formatJqlInstant(instant: Millis): string {
  const d = new Date(instant);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `"${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}"`;
}

/**
 * Run exactly one backfill slice. Returns when the slice's budget is spent;
 * enqueues the next slice through the scheduler if work remains.
 */
export async function runBackfillSlice(
  deps: BackfillDeps,
  options: BackfillOptions,
  slice = 0,
): Promise<BackfillSliceResult> {
  const startedAt = deps.clock.now();
  const deadline = startedAt + options.timeBudgetMs;
  const state =
    (await deps.store.getIndexState(options.projectId)) ??
    initialIndexState(options.projectId, startedAt, options.historyFrom ?? null);

  if (state.state === 'complete') {
    return {
      projectId: options.projectId,
      issuesProcessed: 0,
      issuesSkipped: 0,
      requests: 0,
      done: true,
      nextCursor: null,
      stoppedBecause: 'complete',
      elapsedMs: 0,
    };
  }

  await deps.store.putIndexState({
    ...state,
    state: 'running',
    startedAt: state.startedAt ?? startedAt,
    updatedAt: startedAt,
    lastError: null,
  });

  const jql = buildBackfillJql(options);
  let cursor = state.backfillCursor;
  let processedCount = 0;
  let skipped = 0;
  let requests = 0;
  let stoppedBecause: BackfillSliceResult['stoppedBecause'] = 'complete';
  let done = false;
  let issuesTotal = state.issuesTotal;

  try {
    outer: for (;;) {
      const page = await withRetry(
        () =>
          deps.api.searchIssues({
            jql,
            nextPageToken: cursor ?? undefined,
            maxResults: options.pageSize,
            fields: BACKFILL_FIELDS,
            expandChangelog: deps.config.datasets.statusDurations || deps.config.datasets.history,
          }),
        { ...deps.config.retry, label: `search ${options.projectId}` },
      );
      requests += 1;
      if (typeof page.total === 'number') issuesTotal = page.total;

      const issues: readonly JiraIssue[] = page.issues ?? [];
      const batch: ProcessedIssue[] = [];

      for (const issue of issues) {
        const processed = await processIssue(issue, deps.api, deps.config, deps.clock.now());
        if (processed === null) {
          skipped += 1;
          continue;
        }
        requests += processed.requests;
        batch.push(processed);
        processedCount += 1;

        if (options.throttleMs !== undefined && options.throttleMs > 0) {
          await deps.config.retry.sleeper.sleep(options.throttleMs);
        }

        if (deps.clock.now() >= deadline) {
          stoppedBecause = 'time_budget';
          break;
        }
        if (processedCount >= options.issuesPerSlice) {
          stoppedBecause = 'issue_budget';
          break;
        }
      }

      // Step 4: write results *before* advancing the cursor.
      await writeProcessed(deps.store, batch, deps.config.datasets);

      const nextToken = page.nextPageToken ?? null;
      const pageWasLast = page.isLast === true || nextToken === null || issues.length === 0;

      if (stoppedBecause !== 'complete') {
        // We stopped mid-page. The cursor still points at this page, so the
        // next slice re-reads it and re-processes the issues we already wrote.
        // That is safe because writes replace rather than merge.
        break outer;
      }

      cursor = nextToken;
      if (pageWasLast) {
        done = true;
        break outer;
      }
    }
  } catch (error: unknown) {
    const rateLimited = error instanceof HttpError && error.status === 429;
    const message = error instanceof Error ? error.message : String(error);
    deps.logger?.log('error', 'backfill slice failed', {
      projectId: options.projectId,
      slice,
      message,
    });
    await deps.store.putIndexState({
      ...state,
      state: rateLimited ? 'paused' : 'failed',
      backfillCursor: cursor,
      issuesProcessed: state.issuesProcessed + processedCount,
      issuesTotal,
      lastError: message.slice(0, 1000),
      updatedAt: deps.clock.now(),
    });
    if (rateLimited) {
      await deps.scheduler.enqueueBackfill({
        projectId: options.projectId,
        cursor,
        slice: slice + 1,
      });
    }
    return {
      projectId: options.projectId,
      issuesProcessed: processedCount,
      issuesSkipped: skipped,
      requests,
      done: false,
      nextCursor: cursor,
      stoppedBecause: rateLimited ? 'rate_limited' : 'error',
      elapsedMs: deps.clock.now() - startedAt,
    };
  }

  const finishedAt = deps.clock.now();
  await deps.store.putIndexState({
    ...state,
    state: done ? 'complete' : 'running',
    backfillCursor: done ? null : cursor,
    issuesProcessed: state.issuesProcessed + processedCount,
    issuesTotal,
    lastProcessedAt: finishedAt,
    lastError: null,
    startedAt: state.startedAt ?? startedAt,
    updatedAt: finishedAt,
  });

  if (!done) {
    await deps.scheduler.enqueueBackfill({
      projectId: options.projectId,
      cursor,
      slice: slice + 1,
    });
  }

  return {
    projectId: options.projectId,
    issuesProcessed: processedCount,
    issuesSkipped: skipped,
    requests,
    done,
    nextCursor: done ? null : cursor,
    stoppedBecause,
    elapsedMs: finishedAt - startedAt,
  };
}

export interface BackfillProgress {
  readonly state: IndexStateRow['state'];
  readonly issuesProcessed: number;
  readonly issuesTotal: number | null;
  /** 0-1, or `null` when Jira did not give us a total to divide by. */
  readonly fraction: number | null;
  readonly lastError: string | null;
  readonly startedAt: Millis | null;
  readonly updatedAt: Millis;
}

/** Progress for the UI. Deliberately honest about not knowing the total. */
export function toProgress(row: IndexStateRow): BackfillProgress {
  const fraction =
    row.issuesTotal === null || row.issuesTotal === 0
      ? null
      : Math.min(1, row.issuesProcessed / row.issuesTotal);
  return {
    state: row.state,
    issuesProcessed: row.issuesProcessed,
    issuesTotal: row.issuesTotal,
    fraction,
    lastError: row.lastError,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
  };
}
