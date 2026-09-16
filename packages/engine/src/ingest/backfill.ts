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
 * The time budget defaults to 630 s (70% of 900 s). A backfill slice runs
 * under an Async Events consumer function (`manifest.yml`'s `consumer`
 * module), which the manifest schema caps at 900 s via `timeoutSeconds` —
 * confirmed against developer.atlassian.com/platform/forge/manifest-reference
 * /modules/function/ and /platform/forge/limits-invocation/ on 2026-09-15
 * (async-events consumers default to a 55 s timeout otherwise; this is a
 * manifest-schema ceiling, not a moving quota like the request-rate limits
 * are, so it does not need re-checking before every release the way the
 * comment this replaced assumed). All five apps' manifests declare
 * `timeoutSeconds: 900` on `backfill-consumer` to match. Forge bills by
 * actual runtime, not the declared ceiling, so raising it costs nothing on a
 * slice that finishes early — it only matters on slices that would otherwise
 * be killed mid-page. If `timeoutSeconds` ever changes, update this constant
 * to 70% of the new value.
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
  timeBudgetMs: 630_000,
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
 * A mid-page stop is not a corner case: the time budget has
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

/**
 * Second marker on the same cursor string, carrying the `created` instant of
 * the last issue this backfill has successfully written — regardless of
 * whether a skip is also pending. It exists so a later slice can recover from
 * a corrupted Jira pagination token (see {@link isCorruptedCursor} and
 * TECHNICAL-SPEC § 11 item 11) without a store schema change: the token is
 * opaque and cannot be trusted once Jira has handed back a bad one, but a
 * `created >=` JQL bound reconstructed from this value lets the search resume
 * from scratch without reprocessing everything from the start of history.
 */
const CURSOR_SEEK_MARKER = '::seek=';

/**
 * Third marker, carrying the bound of the most recent corrupted-cursor
 * *reseek attempt* — distinct from {@link CURSOR_SEEK_MARKER}, which is
 * attached to every persisted cursor as a resume bookmark regardless of
 * whether a reseek ever happened. Conflating the two was tried first and
 * confirmed live 2026-09-15 to be wrong in both directions: reusing the
 * bookmark as a loop guard made a legitimate first-time recovery (deferred
 * across a slice boundary, never yet attempted) fail immediately, while
 * guarding only within one invocation let the same corrupted bound recur
 * across many separate slices — `issuesProcessed` climbed past the whole
 * project's real issue count while a consumption-priced platform kept
 * billing for it. This marker exists solely so a slice can tell "a reseek
 * from this exact bound was already tried, possibly by an earlier slice,
 * with nothing written since" from "this bound has never been attempted" —
 * see its use in `runBackfillSlice`.
 */
const CURSOR_ATTEMPTED_MARKER = '::attempted=';

export function encodeCursor(
  token: string | null,
  skip: number,
  seekFrom?: Millis | null,
  attemptedSeek?: Millis | null,
): string | null {
  let encoded = skip > 0 ? `${token ?? ''}${CURSOR_SKIP_MARKER}${String(skip)}` : token;
  if (seekFrom !== undefined && seekFrom !== null) {
    encoded = `${encoded ?? ''}${CURSOR_SEEK_MARKER}${String(seekFrom)}`;
  }
  if (attemptedSeek !== undefined && attemptedSeek !== null) {
    encoded = `${encoded ?? ''}${CURSOR_ATTEMPTED_MARKER}${String(attemptedSeek)}`;
  }
  return encoded;
}

export function decodeCursor(raw: string | null): {
  token: string | null;
  skip: number;
  seekFrom: Millis | null;
  attemptedSeek: Millis | null;
} {
  if (raw === null) return { token: null, skip: 0, seekFrom: null, attemptedSeek: null };
  let rest = raw;
  let attemptedSeek: Millis | null = null;
  const attemptedAt = rest.indexOf(CURSOR_ATTEMPTED_MARKER);
  if (attemptedAt !== -1) {
    const parsed = Number(rest.slice(attemptedAt + CURSOR_ATTEMPTED_MARKER.length));
    attemptedSeek = Number.isFinite(parsed) ? parsed : null;
    rest = rest.slice(0, attemptedAt);
  }
  let seekFrom: Millis | null = null;
  const seekAt = rest.indexOf(CURSOR_SEEK_MARKER);
  if (seekAt !== -1) {
    const parsed = Number(rest.slice(seekAt + CURSOR_SEEK_MARKER.length));
    seekFrom = Number.isFinite(parsed) ? parsed : null;
    rest = rest.slice(0, seekAt);
  }
  const skipAt = rest.indexOf(CURSOR_SKIP_MARKER);
  if (skipAt === -1) return { token: rest || null, skip: 0, seekFrom, attemptedSeek };
  const skip = Number(rest.slice(skipAt + CURSOR_SKIP_MARKER.length));
  return {
    token: rest.slice(0, skipAt) || null,
    skip: Number.isFinite(skip) && skip > 0 ? skip : 0,
    seekFrom,
    attemptedSeek,
  };
}

/**
 * Jira can hand back a `nextPageToken` in an otherwise-successful response
 * whose own payload is corrupt — confirmed live, TECHNICAL-SPEC § 11 item 11.
 * The token is opaque base64; decoded, its payload embeds this exact marker
 * string, Jira's own internal error.
 *
 * Detection has to run on the *token*, not on the error a failed request
 * produces with it. Confirmed live 2026-09-15 by calling
 * `/rest/api/3/search/jql` directly with a captured corrupted token: Jira's
 * real response body is a generic, localized "invalid or expired" message —
 * the marker never appears there, and it never appears in plain text in the
 * request path either, since the token sits in the URL still base64-encoded.
 * An earlier version of this fix checked the caught error's `body`/`message`
 * for the literal marker string and missed every live occurrence for exactly
 * this reason. The only place the marker is ever findable as text is inside
 * the decoded token itself — which this backfill already holds in memory
 * before ever sending it, so the request that would fail can be skipped
 * entirely rather than sent and then classified.
 */
const CORRUPTED_CURSOR_MARKER = 'TENANT_NOT_FOUND_IN_TENANT_STORE';

export function isCorruptedCursor(token: string | null): boolean {
  if (!token) return false;
  try {
    const normalized = token.replace(/-/g, '+').replace(/_/g, '/');
    return atob(normalized).includes(CORRUPTED_CURSOR_MARKER);
  } catch {
    // Not valid base64 — cannot be the corrupted token this guards against,
    // whatever else it might be.
    return false;
  }
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
  let pendingSkip = initialCursor.skip;
  let firstIteration = true;
  let processedCount = 0;
  let skipped = 0;
  let requests = 0;
  let stoppedBecause: BackfillSliceResult['stoppedBecause'] = 'complete';
  let done = false;
  let issuesTotal = state.issuesTotal;
  // `created` of the last issue this backfill has actually written, carried
  // across slices on the cursor itself (`CURSOR_SEEK_MARKER`). The only input
  // a corrupted-cursor recovery has to work with, since the token it would
  // otherwise resume from cannot be trusted — see `isCorruptedCursor`.
  let lastCreatedAt: Millis | null = initialCursor.seekFrom;
  // The bound of the most recent reseek *attempt*, carried forward on the
  // persisted cursor (`CURSOR_ATTEMPTED_MARKER`) independently of the resume
  // bookmark above — see that marker's docstring for why the two must not be
  // conflated. Guards against looping forever without forward progress,
  // across slices, not just within one: confirmed live 2026-09-15, a
  // bulk-seeded project reseeking from the identical instant across many
  // separate slice invocations, `issuesProcessed` climbing past the whole
  // project's real issue count while the same issues were repeatedly
  // rewritten — safe (idempotent), but unbounded and billed for on a
  // consumption-priced platform, which is worse than failing loudly.
  let lastAttemptedSeek: Millis | null = initialCursor.attemptedSeek;

  try {
    outer: for (;;) {
      const usingUnrestrictedJql = jql === buildBackfillJql(unrestricted(options));

      if (cursor !== null && isCorruptedCursor(cursor) && lastCreatedAt !== null) {
        if (lastCreatedAt === lastAttemptedSeek) {
          throw new Error(
            `Backfill stuck: Jira handed back a corrupted pagination cursor and a reseek from ` +
              `the same bound (${String(lastCreatedAt)}) was already attempted, with nothing ` +
              `written since. Likely too many issues share this created-minute for a ` +
              `minute-grained JQL bound to skip past the corrupted boundary — see ` +
              `TECHNICAL-SPEC § 11 item 11.`,
          );
        }
        // Jira handed back this `nextPageToken` in an earlier *successful*
        // response whose own payload is corrupt (TECHNICAL-SPEC § 11 item
        // 11) — confirmed to recur at different, unpredictable page/slice
        // positions across backfill attempts, not just one fixed spot.
        // Checked here, before the request that would fail with it, rather
        // than by classifying the failure afterward: Jira's actual rejection
        // response is a generic, localized "invalid token" message with no
        // trace of the marker, confirmed live by calling the endpoint
        // directly — the marker is only ever findable in the decoded token,
        // which this backfill already holds. The token itself cannot be
        // trusted or repaired; the only way to resume is to drop pagination
        // state and re-issue the search bounded to what has not been written
        // yet, using the last successfully written issue's `created` as the
        // new lower bound. Safe because writes are idempotent — a few issues
        // sharing that same minute (`formatJqlInstant`'s resolution) may be
        // reprocessed, wasting a little request budget, not corrupting
        // anything.
        deps.logger?.log(
          'warn',
          'jira handed back a corrupted pagination cursor; reseeking by created date instead of trusting it',
          { projectId: options.projectId, slice, seekFrom: lastCreatedAt },
        );
        lastAttemptedSeek = lastCreatedAt;
        jql = buildBackfillJql({
          ...(usingUnrestrictedJql ? unrestricted(options) : options),
          historyFrom: lastCreatedAt,
        });
        cursor = null;
        // Any skip pending from a previous mid-page stop was keyed to the
        // now-abandoned token's page; it means nothing against this fresh,
        // differently-bounded query.
        pendingSkip = 0;
      }

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
        if (isUnknownLevelFieldError(error) && !usingUnrestrictedJql) {
          deps.logger?.log('info', 'issue security level is not searchable; indexing without it', {
            projectId: options.projectId,
          });
          jql = buildBackfillJql(unrestricted(options));
          page = await withRetry(search, {
            ...deps.config.retry,
            label: `search ${options.projectId} (unrestricted)`,
          });
          requests += 1;
        } else {
          throw error;
        }
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
      if (batch.length > 0) {
        // `batch` preserves the fetch order, which the JQL guarantees is
        // `created ASC` — its last element is the latest `created` this
        // backfill has durably written so far.
        lastCreatedAt = batch[batch.length - 1]!.meta.createdAt;
      }

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
          // `nextToken` is what a corrupted-cursor recovery has to work
          // around later — carry `lastCreatedAt` alongside it now, while it's
          // known, rather than lose it the moment this bare token gets
          // persisted. `lastAttemptedSeek` travels too, so a next slice that
          // inherits an already-corrupted `nextToken` can tell whether this
          // exact bound was tried and failed already.
          cursor = encodeCursor(nextToken, 0, lastCreatedAt, lastAttemptedSeek);
          if (pageWasLast) done = true;
        } else {
          cursor = encodeCursor(cursor, skipNow + handledInPage, lastCreatedAt, lastAttemptedSeek);
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
    const cursorToPersist = encodeCursor(
      cursor,
      firstIteration ? pendingSkip : 0,
      lastCreatedAt,
      lastAttemptedSeek,
    );
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
