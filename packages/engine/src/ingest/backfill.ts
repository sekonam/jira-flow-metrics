import type { JiraIssue, JiraSearchPage } from '../jira/types.js';
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
  /** Do not index issues created before this instant. `null` means all history. */
  readonly historyFrom?: Millis | null;
  /**
   * Skip issues that carry a Jira **issue security level**. Defaults to true.
   *
   * The app reads Jira as the app, so a restricted issue is returned in full
   * even though the person reading the report may not be entitled to see it.
   * Excluding them at ingest is the only place the restriction can be honoured
   * without re-checking every issue against every viewer.
   */
  readonly excludeRestrictedIssues?: boolean;
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
  excludeRestrictedIssues: true,
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

/**
 * Build the JQL for a backfill. Ordered by `created ASC` for a stable cursor.
 *
 * Every clause is assembled from values this module controls: a context-derived
 * project id, escaped by {@link quoteJql}, and a numeric instant formatted by
 * {@link formatJqlInstant}. There is deliberately **no free-text JQL option** —
 * an `extraJql` passthrough existed briefly and was removed, because an unused
 * raw-JQL parameter on an exported interface is an injection sink waiting for a
 * caller.
 */
export function buildBackfillJql(options: BackfillOptions): string {
  const clauses = [`project = ${quoteJql(options.projectId)}`];
  if (options.excludeRestrictedIssues !== false) clauses.push('level IS EMPTY');
  if (options.historyFrom !== undefined && options.historyFrom !== null) {
    clauses.push(`created >= ${formatJqlInstant(options.historyFrom)}`);
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
 * `backfillCursor` sometimes carries more than a page token.
 *
 * When a slice's issue or time budget runs out partway through a page, the
 * page has to be re-fetched next slice — Jira's `nextPageToken` is opaque and
 * has no way to ask for "this same page, but skip the first K" — and how many
 * items to skip on that re-fetch has to travel somewhere. Encoding it onto the
 * cursor string avoids a schema change for what is otherwise a one-field
 * concern; `{@link decodeCursor}` is the only place that ever has to know the
 * format.
 *
 * A mid-page stop is not a corner case: the 40s default time budget has
 * nothing to do with `issuesPerSlice`/`pageSize` alignment, so on a real
 * instance under real network latency it will routinely fall in the middle of
 * a page. Before this, that stop left the cursor untouched, so the next slice
 * re-fetched the identical page and — being fully deterministic apart from
 * timing — stopped at the identical position again. Whether that resolves
 * itself depends entirely on timing jitter being generous enough on some later
 * attempt; nothing here guarantees it, which is what makes it a real defect
 * rather than a curiosity: a project with a project-specific reason to be
 * evenly slow (not jittery, just consistent) could stall forever short of the
 * customer's own backfill, one page from the end.
 */
const CURSOR_SKIP_MARKER = '::skip=';

export function encodeCursor(token: string | null, skip: number): string | null {
  if (skip <= 0) return token;
  return `${token ?? ''}${CURSOR_SKIP_MARKER}${String(skip)}`;
}

export function decodeCursor(raw: string | null): { token: string | null; skip: number } {
  if (raw === null) return { token: null, skip: 0 };
  const at = raw.indexOf(CURSOR_SKIP_MARKER);
  if (at === -1) return { token: raw, skip: 0 };
  const skip = Number(raw.slice(at + CURSOR_SKIP_MARKER.length));
  return { token: raw.slice(0, at) || null, skip: Number.isFinite(skip) && skip > 0 ? skip : 0 };
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

  let jql = buildBackfillJql(options);
  const initialCursor = decodeCursor(state.backfillCursor);
  let cursor = initialCursor.token;
  // Only ever applied to the very first page fetched by this slice — every
  // page after that starts fresh, because the loop only continues past a page
  // it did not fully consume by breaking out first.
  const pendingSkip = initialCursor.skip;
  let firstIteration = true;
  let processedCount = 0;
  let skipped = 0;
  let requests = 0;
  let stoppedBecause: BackfillSliceResult['stoppedBecause'] = 'complete';
  let done = false;
  let issuesTotal = state.issuesTotal;

  try {
    outer: for (;;) {
      const search = (): Promise<JiraSearchPage> =>
        deps.api.searchIssues({
          jql,
          nextPageToken: cursor ?? undefined,
          maxResults: options.pageSize,
          fields: BACKFILL_FIELDS,
          expandChangelog: deps.config.datasets.statusDurations || deps.config.datasets.history,
        });

      let page: JiraSearchPage;
      try {
        page = await withRetry(search, {
          ...deps.config.retry,
          label: `search ${options.projectId}`,
        });
      } catch (error: unknown) {
        // `level` is only a searchable JQL field on instances that have an
        // issue security scheme. Where it is not, the clause is rejected — and
        // an instance with no security scheme has no restricted issues, so
        // dropping the clause there loses nothing and hides nothing.
        if (!isUnknownLevelFieldError(error) || jql === buildBackfillJql(unrestricted(options))) {
          throw error;
        }
        deps.logger?.log('info', 'issue security level is not searchable; indexing without it', {
          projectId: options.projectId,
        });
        jql = buildBackfillJql(unrestricted(options));
        page = await withRetry(search, {
          ...deps.config.retry,
          label: `search ${options.projectId} (unrestricted)`,
        });
        requests += 1;
      }
      requests += 1;
      if (typeof page.total === 'number') issuesTotal = page.total;

      const fetchedIssues: readonly JiraIssue[] = page.issues ?? [];
      const skipNow = firstIteration ? pendingSkip : 0;
      firstIteration = false;
      // Re-fetching this exact page was unavoidable (opaque tokens), but
      // re-processing the part already written on a previous attempt is not:
      // it was written idempotently, so redoing it would only waste the
      // request budget, not corrupt anything — skipping it is purely an
      // efficiency choice, not a correctness one.
      const issues = skipNow > 0 ? fetchedIssues.slice(skipNow) : fetchedIssues;
      const batch: ProcessedIssue[] = [];
      let handledInPage = 0;

      for (const issue of issues) {
        handledInPage += 1;
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
      const pageFullyConsumed = handledInPage === issues.length;

      if (stoppedBecause !== 'complete') {
        // A budget ran out. If it ran out *exactly* at the end of the page,
        // the page is finished and the cursor may advance — otherwise the next
        // slice would re-fetch and re-process a page it already stored, which
        // with the default budgets (100 issues, 50 per page) would repeat the
        // last page of every single slice and roughly double the backfill's
        // Jira request count.
        //
        // Stopping mid-page re-reads that same page next slice — Jira's page
        // tokens are opaque, so there is no other way to resume one — but it
        // does not re-process what this attempt already got through: the
        // count handled so far travels on the cursor itself (see
        // `encodeCursor`), so the next slice skips straight past it. Without
        // that, a slice landing here twice in a row would stop at the exact
        // same position both times and never advance.
        if (pageFullyConsumed) {
          cursor = nextToken;
          if (pageWasLast) done = true;
        } else {
          cursor = encodeCursor(cursor, skipNow + handledInPage);
        }
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
    // A failure on the page's very first fetch attempt (before anything in it
    // has been processed) still owes whatever skip was pending on entry —
    // persisting the bare token here would silently forgive it, and the next
    // slice would re-process items already written by an earlier one. A
    // failure partway through a resumed page's items is not recovered this
    // precisely (the retry falls back to reprocessing that page from its
    // start), which is safe, only slightly wasteful, and not the failure mode
    // this cursor scheme exists to close — see `encodeCursor`'s docstring.
    const cursorToPersist = encodeCursor(cursor, firstIteration ? pendingSkip : 0);
    await deps.store.putIndexState({
      ...state,
      state: rateLimited ? 'paused' : 'failed',
      backfillCursor: cursorToPersist,
      issuesProcessed: state.issuesProcessed + processedCount,
      issuesTotal,
      lastError: message.slice(0, 1000),
      updatedAt: deps.clock.now(),
    });
    if (rateLimited) {
      await deps.scheduler.enqueueBackfill({
        projectId: options.projectId,
        cursor: cursorToPersist,
        slice: slice + 1,
      });
    }
    return {
      projectId: options.projectId,
      issuesProcessed: processedCount,
      issuesSkipped: skipped,
      requests,
      done: false,
      nextCursor: cursorToPersist,
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

function unrestricted(options: BackfillOptions): BackfillOptions {
  return { ...options, excludeRestrictedIssues: false };
}

/** Does this failure mean Jira does not know the `level` field? */
function isUnknownLevelFieldError(error: unknown): boolean {
  if (!(error instanceof HttpError) || error.status !== 400) return false;
  return /level/i.test(error.body ?? '') || /level/i.test(error.message);
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

/**
 * Reduce a recorded error to something safe to show a person.
 *
 * `index_state.last_error` holds a raw exception message, and the report page
 * renders it. A Jira error is already JQL-redacted, but a database driver
 * error can echo statement fragments and constraint values, so only a fixed
 * classification crosses to the browser. The full message stays in the row for
 * the vendor to read through the logs.
 */
export function describeIndexError(lastError: string | null): string | null {
  if (lastError === null || lastError.trim() === '') return null;
  if (/\b429\b|rate.?limit/i.test(lastError)) {
    return 'Jira rate-limited the indexer. It will resume automatically.';
  }
  if (/\b40[13]\b|permission|forbidden|unauthor/i.test(lastError)) {
    return 'Jira refused the request. A Jira administrator may need to re-approve the app.';
  }
  if (/\b404\b|not found/i.test(lastError)) {
    return 'Something the indexer asked for no longer exists in Jira.';
  }
  return 'Indexing stopped on an unexpected error. The details are in the app logs.';
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
    lastError: describeIndexError(row.lastError),
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
  };
}
