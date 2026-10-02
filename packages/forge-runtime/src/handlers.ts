import { jobFromPayload } from './scheduler.js';
import type {
  FilterOptions,
  ListingRuntime,
  ReportEnvelope,
  StatusReportRequest,
} from './runtime.js';
import type {
  AgingReport,
  FlowReport,
  HistoryReport,
  HistoryReportRequest,
  SlaCountedGoal,
  SlaReport,
  WorklogReport,
  WorklogReportRequest,
} from './reports.js';
import {
  agingReportToCsv,
  historyReportToCsv,
  slaReportToCsv,
  worklogReportToCsv,
} from './report-csv.js';
import { MAX_GOAL_NAME_LENGTH, MAX_SLA_GOALS, type StoredSlaGoal } from './settings.js';
import type { IssueTimelineReport } from './issue-timeline.js';
import type { BackfillProgress, JiraProjectRef, StatusMetaRow } from '@jfm/engine';

/**
 * Handler bodies, shared by all five listings.
 *
 * Every app's `index.ts` is a dozen lines of `@forge/resolver` wiring around
 * these functions. Keeping the logic here means the payload validation — the
 * part that actually breaks — is tested once rather than five times, and that
 * the Forge-specific files stay small enough to eyeball on first deploy.
 *
 * **Nothing here trusts its input.** A resolver payload arrives from the
 * browser and a product-event payload arrives from Jira; both are parsed
 * defensively, and a bad payload produces a typed failure rather than an
 * exception that reaches the user as a blank page.
 */

export interface ResolverInvocation {
  readonly payload?: unknown;
  readonly context?: unknown;
}

/**
 * Extract the project id from the Forge resolver context.
 *
 * The client never supplies it: taking the project from the payload would let
 * any user of the instance read any project's metrics regardless of their Jira
 * permissions. The context is set by the platform from the page the user is
 * actually on, so it is the only trustworthy source.
 *
 * Two sources, tried in order:
 *
 * 1. `extension.project.id` — a `jira:projectPage` context carries this
 *    directly, because the page itself is inside a project.
 * 2. `extension.gadgetConfiguration.projectId` — a `jira:dashboardGadget`
 *    context carries no project of its own (confirmed live: every gadget
 *    refused with "This report can only be opened from inside a Jira
 *    project" the first time one was added to a real dashboard), so the
 *    gadget owner chooses one explicitly through its edit mode. This is
 *    still context, not payload — Forge stores the submitted configuration
 *    itself and injects it server-side, so the trust boundary this function
 *    exists to enforce is unchanged. `authoriseProject` still checks the
 *    *viewer's* permission afterwards regardless of who configured it.
 */
export function projectIdFromContext(context: unknown): string | null {
  if (typeof context !== 'object' || context === null) return null;
  const extension = (context as Record<string, unknown>)['extension'];
  if (typeof extension !== 'object' || extension === null) return null;
  const record = extension as Record<string, unknown>;

  const project = record['project'];
  if (typeof project === 'object' && project !== null) {
    const id = idOf(project as Record<string, unknown>);
    if (id !== null) return id;
  }

  const gadgetConfiguration = record['gadgetConfiguration'];
  if (typeof gadgetConfiguration === 'object' && gadgetConfiguration !== null) {
    const id = (gadgetConfiguration as Record<string, unknown>)['projectId'];
    if (typeof id === 'string' && id !== '') return id;
  }

  return null;
}

function idOf(record: Record<string, unknown>): string | null {
  const id = record['id'];
  if (typeof id === 'string' && id !== '') return id;
  if (typeof id === 'number') return String(id);
  return null;
}

/** Parse the view options a client may legitimately choose. */
export function parseReportRequest(projectId: string, payload: unknown): StatusReportRequest {
  const record =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const basis = record['basis'];
  const request: {
    projectId: string;
    basis?: 'elapsed' | 'business';
    limit?: number;
    offset?: number;
    assigneeAccountIds?: string[];
    issueTypeIds?: string[];
    createdFrom?: number;
    createdTo?: number;
    // NOTE: `projectId` is assigned on its own line below and never inside an
    // object spread, so no future payload-derived spread can overwrite it.
  } = { projectId };
  if (basis === 'business' || basis === 'elapsed') request.basis = basis;
  const limit = record['limit'];
  if (typeof limit === 'number' && Number.isFinite(limit)) request.limit = limit;
  const offset = record['offset'];
  // Truncated and bounded here, not merely checked for finiteness.
  // `sql-store.ts` *inlines* LIMIT/OFFSET into the statement text on the
  // stated grounds that they are "a `Math.trunc`ed, range-bound plain
  // integer" — and nothing enforced that: `1e21` survived to become the
  // literal `OFFSET 1e+21`, which TiDB rejects, so any client could break
  // the main report on four listings. No injection was possible, but the
  // invariant the inlining rests on has to actually hold.
  if (typeof offset === 'number' && Number.isFinite(offset)) {
    request.offset = Math.max(0, Math.min(MAX_REPORT_OFFSET, Math.trunc(offset)));
  }
  const assignees = stringArray(record['assigneeAccountIds']);
  if (assignees !== null) request.assigneeAccountIds = assignees;
  const issueTypes = stringArray(record['issueTypeIds']);
  if (issueTypes !== null) request.issueTypeIds = issueTypes;
  // The creation window, as epoch milliseconds. Finite numbers only, like
  // every other numeric field here; an inverted window is passed through
  // rather than silently swapped — the engine answers it with an empty
  // report, which is the true answer to a question about an empty range,
  // and the UI's own pickers prevent constructing one.
  const createdFrom = record['createdFrom'];
  if (typeof createdFrom === 'number' && Number.isFinite(createdFrom)) {
    request.createdFrom = createdFrom;
  }
  const createdTo = record['createdTo'];
  if (typeof createdTo === 'number' && Number.isFinite(createdTo)) {
    request.createdTo = createdTo;
  }
  return request;
}

/**
 * Maximum length of any client-supplied list of ids.
 *
 * Uncapped, these lists reach `placeholders(n)` and become the number of `?`
 * markers in a SQL statement. There is no injection — the value itself is
 * always bound — but a resolver call carrying 200,000 field names would build
 * a 400 KB statement with 200,000 parameters against a metered database. The
 * in-memory filters have the same shape (an O(n·m) `includes` over up to
 * 10,000 rows), so one cap covers every call site.
 */
const MAX_FILTER_VALUES = 100;

/**
 * Furthest a client may page into a report.
 *
 * A million rows past the start is far beyond any real project and keeps the
 * value a small plain integer, which is what `sql-store.ts` inlines.
 */
const MAX_REPORT_OFFSET = 1_000_000;

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((v): v is string => typeof v === 'string' && v !== '');
  return strings.length === 0 ? null : strings.slice(0, MAX_FILTER_VALUES);
}

export type HandlerResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };

export const NOT_IN_PROJECT = 'This report can only be opened from inside a Jira project.';

export const NOT_AN_ADMIN =
  'Only a Jira administrator can see what this app is storing, because the figures cover the ' +
  'whole instance rather than one project.';

export const NO_PERMISSION =
  'You do not have permission to browse this project in Jira, so this report is not available.';

/**
 * Is it worth offering this reader a retry?
 *
 * The three refusals above are settled facts about who is asking, not
 * transient failures: pressing *Try again* re-asks the same question of the
 * same permissions and gets the same answer, forever. Offering the button is
 * not neutral — it implies the app might be wrong about them, so the reader
 * presses it, nothing changes, and they learn nothing about why. Everything
 * else that reaches this boundary (a rate limit, a timeout, a Jira 5xx) is
 * worth one more go.
 */
export function isRetryableError(message: string): boolean {
  return message !== NO_PERMISSION && message !== NOT_IN_PROJECT && message !== NOT_AN_ADMIN;
}

/**
 * Resolve and authorise the project for a resolver call.
 *
 * Two separate things, deliberately in one place because forgetting either is
 * a data leak:
 *
 * 1. The project id comes from the platform **context**, never the payload —
 *    otherwise any user could name any project.
 * 2. The **calling user's** Jira permission is checked. Every other read this
 *    app performs happens as the app, which by design ignores who is asking,
 *    so without this a user who can reach the page would read a project they
 *    may have no access to at all.
 *
 * Fails closed: an error while determining the permission is a refusal, not a
 * pass.
 */
async function authoriseProject(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
): Promise<{ ok: true; projectId: string } | { ok: false; error: string }> {
  const projectId = projectIdFromContext(invocation.context);
  if (projectId === null) return { ok: false, error: NOT_IN_PROJECT };
  let allowed: boolean;
  try {
    allowed = await runtime.canBrowseProject(projectId);
  } catch {
    return { ok: false, error: NO_PERMISSION };
  }
  return allowed ? { ok: true, projectId } : { ok: false, error: NO_PERMISSION };
}

/**
 * Turn a thrown error into a message safe to show a user.
 *
 * Jira error bodies can contain issue summaries, and the client is a browser.
 * Only the shape of the failure crosses the boundary; the detail stays in the
 * Forge logs where the vendor can read it and the customer's data is not
 * re-broadcast.
 */
export function toUserMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = error.status;
    if (status === 403 || status === 401) {
      return 'This app does not have permission to read that project in Jira. A Jira administrator may need to re-approve its access.';
    }
    if (status === 429) {
      return 'Jira is rate-limiting requests right now. Indexing will resume automatically; try again shortly.';
    }
  }
  return 'Something went wrong loading this report. The details are in the app logs.';
}

export async function handleGetReport(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
): Promise<HandlerResult<ReportEnvelope>> {
  runtime.beginInvocation();
  const auth = await authoriseProject(runtime, invocation);
  if (!auth.ok) return { ok: false, error: auth.error };
  const projectId = auth.projectId;
  try {
    return {
      ok: true,
      data: await runtime.statusReport(parseReportRequest(projectId, invocation.payload)),
    };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/**
 * Which report an app's export button exports.
 *
 * Defaults to `'status'` — but four of the five listings show a different
 * report, and until each app passed its own kind here, every export button
 * produced the time-in-status CSV regardless of the page it sat on.
 */
export type CsvExportKind = 'status' | 'worklog' | 'aging' | 'sla' | 'history';

export async function handleExportCsv(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
  kind: CsvExportKind = 'status',
): Promise<HandlerResult<{ filename: string; csv: string }>> {
  runtime.beginInvocation();
  const auth = await authoriseProject(runtime, invocation);
  if (!auth.ok) return { ok: false, error: auth.error };
  const projectId = auth.projectId;
  try {
    const csv = await buildCsvFor(runtime, kind, projectId, invocation.payload);
    return {
      ok: true,
      data: { filename: `${runtime.listingId}-${projectId}.csv`, csv },
    };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

async function buildCsvFor(
  runtime: ListingRuntime,
  kind: CsvExportKind,
  projectId: string,
  payload: unknown,
): Promise<string> {
  switch (kind) {
    case 'worklog':
      return worklogReportToCsv(
        await runtime.worklogReport(parseWorklogRequest(projectId, payload)),
        'Person',
      );
    case 'aging':
      return agingReportToCsv(await runtime.agingReport(projectId));
    case 'sla': {
      // The same goal *resolution* as `handleSlaReport`, saved goals
      // included, so the exported rows are measured against exactly the goal
      // on screen. Parsing the payload here while the report resolved a
      // stored goal by id would put a different goal's numbers in the file.
      const goal = await resolveSlaGoal(runtime, projectId, payload);
      if (goal === 'unknown-goal') throw new Error(UNKNOWN_SLA_GOAL);
      return slaReportToCsv(await runtime.slaReport(projectId, goal));
    }
    case 'history':
      return historyReportToCsv(
        // The export may read further than a page, but it still honours the
        // filters the table was showing.
        //
        // The export's own ceiling is applied *after* the request, not
        // before: spreading the parsed payload over it let a caller's
        // `limit` win, and `parseHistoryRequest` clamps that to a page — so
        // the sentence above was the opposite of what the code did.
        await runtime.historyReport({
          ...parseHistoryRequest(projectId, payload),
          limit: 10_000,
        }),
      );
    case 'status':
      return runtime.statusReportCsv(parseReportRequest(projectId, payload));
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export async function handleStartIndexing(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
): Promise<HandlerResult<{ started: true }>> {
  runtime.beginInvocation();
  const auth = await authoriseProject(runtime, invocation);
  if (!auth.ok) return { ok: false, error: auth.error };
  const projectId = auth.projectId;
  try {
    await runtime.startBackfill(projectId);
    return { ok: true, data: { started: true } };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/**
 * Index progress alone, for the banner.
 *
 * Authorised exactly like every other project-scoped resolver: the index state
 * tells a caller how much of a project has been read, which is information
 * about a project they may not be allowed to see.
 */
export async function handleIndexProgress(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
): Promise<HandlerResult<BackfillProgress | null>> {
  runtime.beginInvocation();
  const auth = await authoriseProject(runtime, invocation);
  if (!auth.ok) return { ok: false, error: auth.error };
  try {
    return { ok: true, data: await runtime.indexProgress(auth.projectId) };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/**
 * The admin usage page.
 *
 * No *project* authorisation, because the figures are instance-wide — Forge
 * SQL is provisioned per installation, so there is no project to scope them
 * to. The payload is row counts and byte estimates, never anything
 * issue-shaped, and a test asserts no issue key can reach it.
 *
 * ★ **The gate is an explicit admin check, not the module.** This used to
 * argue that `jira:adminPage` "is reachable only by Jira administrators,
 * which the platform enforces", and that argument was false: Forge gates the
 * **module**, while every module in these manifests binds the *same*
 * `resolver` function key. Anyone who could open a project page could run
 * `invoke('getStorageEstimate')` from the browser console and read
 * instance-wide figures. Only nine integers leak that way, but a security
 * argument that does not hold is worse than none — and the same structural
 * fact would apply to every admin-only resolver added beside it.
 *
 * `TECHNICAL-SPEC.md` § 11 item 10 recorded this method as unexposed until
 * "a surface that can authorise it properly" existed. The surface was not
 * enough; the check is.
 */
export async function handleStorageEstimate(runtime: ListingRuntime): Promise<
  HandlerResult<{
    bytes: number;
    note: string;
    tables: readonly { table: string; rows: number; bytes: number }[];
  }>
> {
  runtime.beginInvocation();
  try {
    if (!(await runtime.isAdmin())) return { ok: false, error: NOT_AN_ADMIN };
    return { ok: true, data: await runtime.storageEstimate() };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/**
 * The dashboard gadget's project picker.
 *
 * No project-scoped authorisation here — there is no project yet, that is
 * the whole point of this call. `listProjects` itself asks Jira as the
 * calling user, which is what keeps the picker from ever offering a project
 * that user cannot see.
 */
export async function handleListProjects(
  runtime: ListingRuntime,
): Promise<HandlerResult<readonly JiraProjectRef[]>> {
  runtime.beginInvocation();
  try {
    return { ok: true, data: await runtime.listProjects() };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/**
 * The SLA goal picker's status list.
 *
 * Project-authorised like every other report resolver: status metadata is
 * stored instance-wide, and its names are information about projects the
 * caller may not be allowed to see.
 */
/**
 * The filter pickers' options. Authorised like every project read: the
 * assignee list is fetched as the calling user, so Jira itself answers
 * according to what this caller may see.
 */
export async function handleListFilterOptions(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
): Promise<HandlerResult<FilterOptions>> {
  runtime.beginInvocation();
  const auth = await authoriseProject(runtime, invocation);
  if (!auth.ok) return { ok: false, error: auth.error };
  try {
    return { ok: true, data: await runtime.listFilterOptions(auth.projectId) };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

export async function handleListStatuses(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
): Promise<HandlerResult<readonly StatusMetaRow[]>> {
  runtime.beginInvocation();
  const auth = await authoriseProject(runtime, invocation);
  if (!auth.ok) return { ok: false, error: auth.error };
  try {
    return { ok: true, data: await runtime.listStatuses(auth.projectId) };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/**
 * Windows the "extend history" control offers, in months. `null` — all
 * history — is offered separately and is always the widest.
 *
 * `parseSettings` clamps `backfillMonths` to 1-120, so 120 is the largest
 * bounded window that can survive a round trip through storage.
 */
export const HISTORY_WINDOW_MONTHS: readonly number[] = [12, 24, 36, 60, 120];

export const NARROWER_HISTORY =
  'This project is already indexed over a longer history. Narrowing the window would leave ' +
  'the older data in place while the page claimed a shorter range, so it is not offered.';

export const UNUSABLE_HISTORY_WINDOW =
  'That is not a history window this app offers. Choose one of the listed ranges.';

/**
 * The history window a client may ask for: one of `HISTORY_WINDOW_MONTHS`, or
 * `null` for all history. Anything else — including a plausible-looking 18 —
 * is refused rather than clamped, because silently indexing a different range
 * from the one the user picked is the failure mode this product is sold
 * against.
 */
export function parseHistoryWindow(payload: unknown): number | null | 'unusable' {
  const record =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const months = record['months'];
  if (months === null) return null;
  if (typeof months === 'number' && HISTORY_WINDOW_MONTHS.includes(months)) return months;
  return 'unusable';
}

/** The project's current indexed-history window, for the extend-history control. */
export async function handleHistoryWindow(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
): Promise<HandlerResult<{ months: number | null }>> {
  runtime.beginInvocation();
  const auth = await authoriseProject(runtime, invocation);
  if (!auth.ok) return { ok: false, error: auth.error };
  try {
    return { ok: true, data: await runtime.historyWindow(auth.projectId) };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/**
 * Widen the indexed-history window and re-index.
 *
 * Authorised exactly like `startIndexing`, and for the same reason: both
 * spend the installation's Jira requests and Forge invocations on behalf of
 * whoever clicks. Neither is an admin action in Jira's model — there is no
 * project-admin permission this app holds a scope to check — so the honest
 * position is that anyone who can read the report can also re-index it, and
 * the control says what it is about to do before it does it.
 *
 * Only widening is accepted. A narrower window would not delete the older
 * rows already stored, so the report would keep showing history the page
 * claimed was out of range.
 */
export async function handleExtendHistory(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
): Promise<HandlerResult<{ months: number | null }>> {
  runtime.beginInvocation();
  const auth = await authoriseProject(runtime, invocation);
  if (!auth.ok) return { ok: false, error: auth.error };
  const requested = parseHistoryWindow(invocation.payload);
  if (requested === 'unusable') return { ok: false, error: UNUSABLE_HISTORY_WINDOW };
  try {
    const current = (await runtime.historyWindow(auth.projectId)).months;
    // Asking for the window already in force is not a widening, and this is
    // the one control in the product that spends the installation's whole
    // Jira request budget — so re-indexing for no change in coverage is
    // refused rather than quietly performed. The UI does not offer it; the
    // resolver is directly invokable, which is why the guard is here.
    if (current === requested) return { ok: false, error: NARROWER_HISTORY };
    // `null` is the widest window there is, so it is always accepted and
    // never narrowed away from.
    if (current === null && requested !== null) return { ok: false, error: NARROWER_HISTORY };
    if (current !== null && requested !== null && requested <= current) {
      return { ok: false, error: NARROWER_HISTORY };
    }
    await runtime.setHistoryWindow(auth.projectId, requested);
    return { ok: true, data: { months: requested } };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

export const NOT_ON_AN_ISSUE = 'This panel can only be opened from inside a Jira issue.';

/**
 * Read the issue from a `jira:issuePanel` context.
 *
 * Same rule as `projectIdFromContext`, for the same reason: the platform
 * sets this from the issue the user is actually looking at, and a payload
 * could name any issue in the instance.
 */
export function issueKeyFromContext(context: unknown): string | null {
  if (typeof context !== 'object' || context === null) return null;
  const extension = (context as Record<string, unknown>)['extension'];
  if (typeof extension !== 'object' || extension === null) return null;
  const issue = (extension as Record<string, unknown>)['issue'];
  if (typeof issue !== 'object' || issue === null) return null;
  const record = issue as Record<string, unknown>;
  const id = idOf(record);
  if (id !== null) return id;
  const key = record['key'];
  return typeof key === 'string' && key !== '' ? key : null;
}

/**
 * The issue panel.
 *
 * Authorised against the project **Jira says the issue belongs to**, read
 * back from the fetch rather than taken from the panel context. An issue
 * panel's context does carry a project, but trusting it would mean the
 * permission check and the data could describe different projects if the two
 * ever disagreed — and the check exists precisely for the case where
 * something is not what it appears.
 *
 * The fetch therefore happens before the authorisation, which is the one
 * place in this codebase where that order is correct: it reads *as the app*,
 * and nothing it read is returned unless the check passes.
 */
export async function handleIssueTimeline(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
): Promise<HandlerResult<IssueTimelineReport>> {
  runtime.beginInvocation();
  const issueKey = issueKeyFromContext(invocation.context);
  if (issueKey === null) return { ok: false, error: NOT_ON_AN_ISSUE };
  try {
    const { report, projectId } = await runtime.issueTimeline(
      issueKey,
      projectIdFromContext(invocation.context) ?? '',
    );
    // ★ Fail closed on an unusable project id.
    //
    // `buildIssueTimeline` falls back to `''` when Jira's issue carries no
    // `fields.project`, and `''` does not make `canBrowseProject` fail — it
    // makes it ask Jira `?projectId=&permissions=BROWSE_PROJECTS`, which Jira
    // evaluates at **global** scope, where a project permission answers true
    // if the user holds it in any project at all. The check would degrade to
    // "is a Jira user", and this handler's entire design rests on that id
    // being trustworthy.
    if (projectId === '') return { ok: false, error: NO_PERMISSION };
    let allowed: boolean;
    try {
      allowed = await runtime.canBrowseProject(projectId);
    } catch {
      return { ok: false, error: NO_PERMISSION };
    }
    if (!allowed) return { ok: false, error: NO_PERMISSION };
    return { ok: true, data: report };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/**
 * Product-event handler for `avi:jira:created|updated|deleted:issue`.
 *
 * Failures are swallowed after logging: a thrown error makes Forge retry the
 * event, and retrying a permanently-bad payload burns the app's invocation
 * budget for no benefit. The next real update to that issue re-derives its
 * aggregate from scratch anyway, because ingestion is idempotent.
 */
export async function handleIssueEvent(
  runtime: ListingRuntime,
  event: unknown,
  projectIdHint: string,
): Promise<'updated' | 'deleted' | 'ignored' | 'failed'> {
  const record =
    typeof event === 'object' && event !== null ? (event as Record<string, unknown>) : {};
  const eventType = typeof record['eventType'] === 'string' ? record['eventType'] : '';
  runtime.beginInvocation();
  try {
    if (eventType.includes('deleted')) {
      await runtime.onIssueDeleted(record, projectIdHint);
      return 'deleted';
    }
    await runtime.onIssueChanged(record, projectIdHint);
    return 'updated';
  } catch (error: unknown) {
    console.error(
      JSON.stringify({ message: 'issue event failed', eventType, error: describeError(error) }),
    );
    return 'failed';
  }
}

/** Async-events consumer for one backfill slice. */
export async function handleBackfillJob(
  runtime: ListingRuntime,
  payload: unknown,
): Promise<'ran' | 'ignored'> {
  runtime.beginInvocation();
  const job = jobFromPayload(payload);
  if (job === null) {
    console.error(JSON.stringify({ message: 'backfill job payload unusable' }));
    return 'ignored';
  }
  await runtime.runBackfill(job.projectId, job.slice);
  return 'ran';
}

/**
 * Read the project id out of a product-event payload.
 * Jira does not include it on every event shape, hence the fallback in the
 * handlers to a hint supplied by the caller.
 */
export function projectIdFromEvent(event: unknown): string | null {
  if (typeof event !== 'object' || event === null) return null;
  const issue = (event as Record<string, unknown>)['issue'];
  if (typeof issue !== 'object' || issue === null) return null;
  const fields = (issue as Record<string, unknown>)['fields'];
  if (typeof fields !== 'object' || fields === null) return null;
  const project = (fields as Record<string, unknown>)['project'];
  if (typeof project !== 'object' || project === null) return null;
  const id = (project as Record<string, unknown>)['id'];
  return typeof id === 'string' && id !== '' ? id : null;
}

// -------------------------------------------- listing-specific resolvers ---

const WORKLOG_GROUPINGS = ['author', 'issue', 'project', 'day', 'week', 'month'] as const;

/**
 * Read a number from an untrusted payload.
 *
 * `typeof NaN === 'number'`, so a bare `typeof` guard lets `NaN` through — and
 * a `NaN` bound as a SQL `LIMIT` or a timestamp comparison is a runtime error
 * rather than an empty result. Every numeric field a client can set goes
 * through here.
 */
function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Listing 2 — worklog totals. */
export async function handleWorklogReport(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
): Promise<HandlerResult<WorklogReport>> {
  runtime.beginInvocation();
  const auth = await authoriseProject(runtime, invocation);
  if (!auth.ok) return { ok: false, error: auth.error };
  const projectId = auth.projectId;
  const request = parseWorklogRequest(projectId, invocation.payload);
  try {
    return { ok: true, data: await runtime.worklogReport(request) };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

function isWorklogGrouping(value: unknown): value is (typeof WORKLOG_GROUPINGS)[number] {
  return typeof value === 'string' && (WORKLOG_GROUPINGS as readonly string[]).includes(value);
}

/** Listing 3 — WIP aging. */
export async function handleAgingReport(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
): Promise<HandlerResult<AgingReport>> {
  runtime.beginInvocation();
  const auth = await authoriseProject(runtime, invocation);
  if (!auth.ok) return { ok: false, error: auth.error };
  const projectId = auth.projectId;
  try {
    return { ok: true, data: await runtime.agingReport(projectId) };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/**
 * Listing 3 — the cumulative flow diagram.
 *
 * `days` is a view choice the client may set, clamped by `buildFlowReport`
 * to 1-180: the window decides how many rows of visits are scanned, and an
 * unbounded one is a client-chosen cost on a metered database.
 */
export async function handleFlowReport(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
): Promise<HandlerResult<FlowReport>> {
  runtime.beginInvocation();
  const auth = await authoriseProject(runtime, invocation);
  if (!auth.ok) return { ok: false, error: auth.error };
  const record =
    typeof invocation.payload === 'object' && invocation.payload !== null
      ? (invocation.payload as Record<string, unknown>)
      : {};
  const days = finiteNumber(record['days']);
  try {
    return {
      ok: true,
      data: await runtime.flowReport(auth.projectId, days === null ? 30 : days),
    };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/**
 * Listing 4 — SLA against a target.
 *
 * The goal comes from the payload because it is a *view* choice made on the
 * page, not a stored configuration: v1 deliberately ships no goal editor. The
 * target is clamped so a client cannot ask for an absurd number and get a
 * table full of meaningless fractions.
 */
export async function handleSlaReport(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
): Promise<HandlerResult<SlaReport>> {
  runtime.beginInvocation();
  const auth = await authoriseProject(runtime, invocation);
  if (!auth.ok) return { ok: false, error: auth.error };
  const projectId = auth.projectId;
  try {
    const goal = await resolveSlaGoal(runtime, projectId, invocation.payload);
    if (goal === 'unknown-goal') return { ok: false, error: UNKNOWN_SLA_GOAL };
    return { ok: true, data: await runtime.slaReport(projectId, goal) };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/**
 * The goal a client may choose on the page. Shared by the report resolver and
 * the CSV export so both measure against the same goal. The target is clamped
 * so a client cannot ask for an absurd number and get a table full of
 * meaningless fractions.
 */
export function parseSlaGoal(payload: unknown): SlaCountedGoal {
  const record =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const rawTarget = finiteNumber(record['targetMs']);
  return {
    id: 'default',
    name: typeof record['name'] === 'string' ? record['name'] : 'Time to resolution',
    // Bounded in *length* as well as in count. `stringArray` caps the list
    // at 100 entries and said nothing about each entry, so 100 ids of 600
    // characters each, twenty goals over, grew the single `app_settings`
    // JSON document past a megabyte — read and re-parsed on every report
    // render, and past TEXT's 64 KB the write simply fails with the generic
    // error. A Jira status id is a short number; 64 characters is generous.
    countedStatusIds: (stringArray(record['countedStatusIds']) ?? []).map((id) =>
      id.slice(0, MAX_STATUS_ID_LENGTH),
    ),
    targetMs:
      rawTarget === null ? 8 * 3_600_000 : Math.max(60_000, Math.min(365 * 86_400_000, rawTarget)),
  };
}

/**
 * The goal a report or export is measured against.
 *
 * Two shapes, and which one arrives decides what the numbers mean:
 *
 * - `{ goalId }` — a goal **saved for this project**. Resolved from storage
 *   here, on the server, never reconstructed from what the client sent: a
 *   client that supplied a goal's definition alongside its id could show a
 *   table labelled "Time to resolution" measured against something else.
 * - anything else — the ad-hoc goal the picker builds, unchanged from v1.
 *
 * A `goalId` naming a goal that is not there is a refusal, not a silent
 * fallback to the default: a page that says it is measuring against
 * "Time to first response" and quietly is not is the failure this product is
 * sold against.
 */
export async function resolveSlaGoal(
  runtime: ListingRuntime,
  projectId: string,
  payload: unknown,
): Promise<SlaCountedGoal | 'unknown-goal'> {
  const record =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const goalId = record['goalId'];
  if (typeof goalId !== 'string' || goalId === '') return parseSlaGoal(payload);
  const saved = (await runtime.slaGoals(projectId)).find((goal) => goal.id === goalId);
  if (saved === undefined) return 'unknown-goal';
  return {
    id: saved.id,
    name: saved.name,
    countedStatusIds: saved.countedStatusIds,
    targetMs: saved.targetMs,
  };
}

/**
 * The worklog view options a client may choose.
 *
 * ★ Shared by the report resolver and the CSV export, for exactly the reason
 * `resolveSlaGoal` is. The export used to call `worklogReport({ projectId })`
 * and drop `groupBy`, `from` and `to` — so a reader who filtered the table
 * and pressed Export got a *different document* from the one on screen,
 * against the standard `report-csv.ts` sets in its own first paragraph ("the
 * export must be the report on screen"). The SLA branch already had a
 * comment warning about this; its siblings did it anyway.
 */
export function parseWorklogRequest(projectId: string, payload: unknown): WorklogReportRequest {
  const record =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const groupBy = record['groupBy'];
  return {
    ...(isWorklogGrouping(groupBy) ? { groupBy } : {}),
    ...(finiteNumber(record['from']) === null ? {} : { from: finiteNumber(record['from'])! }),
    ...(finiteNumber(record['to']) === null ? {} : { to: finiteNumber(record['to'])! }),
    // Written last on purpose: a payload-derived spread can never overwrite
    // the context-derived project.
    projectId,
  };
}

/** The history view options a client may choose. Shared, for the same reason. */
export function parseHistoryRequest(projectId: string, payload: unknown): HistoryReportRequest {
  const record =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  return {
    ...(finiteNumber(record['from']) === null ? {} : { from: finiteNumber(record['from'])! }),
    ...(finiteNumber(record['to']) === null ? {} : { to: finiteNumber(record['to'])! }),
    ...(stringArray(record['fields']) === null ? {} : { fields: stringArray(record['fields'])! }),
    ...(finiteNumber(record['limit']) === null
      ? {}
      : { limit: Math.min(1000, Math.max(1, finiteNumber(record['limit'])!)) }),
    projectId,
  };
}

export const UNKNOWN_SLA_GOAL =
  'That saved goal no longer exists. Someone may have deleted it; pick another one.';

const MAX_STATUS_ID_LENGTH = 64;

export const GOAL_NAME_REQUIRED = 'Give the goal a name so the report can say what it measures.';

export const GOALS_FULL =
  `This project already has the maximum of ${String(MAX_SLA_GOALS)} saved goals. ` +
  'Delete one before saving another.';

/**
 * Parse a goal a client asks to save.
 *
 * The id is generated here when absent rather than accepted from the client:
 * a client-chosen id can collide with an existing goal and silently overwrite
 * it. An id that *is* supplied is an explicit edit of that goal, which is a
 * different intent and is allowed.
 */
export function parseGoalToSave(payload: unknown, now: number): StoredSlaGoal | 'no-name' {
  const record =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const rawName = typeof record['name'] === 'string' ? record['name'].trim() : '';
  if (rawName === '') return 'no-name';
  const id = record['id'];
  const rawTarget = typeof record['targetMs'] === 'number' ? record['targetMs'] : Number.NaN;
  return {
    id: typeof id === 'string' && id !== '' ? id : newGoalId(now),
    name: rawName.slice(0, MAX_GOAL_NAME_LENGTH),
    countedStatusIds: stringArray(record['countedStatusIds']) ?? [],
    // The same clamp the ad-hoc goal uses, so a goal cannot mean one thing
    // saved and another unsaved.
    targetMs: Number.isFinite(rawTarget)
      ? Math.max(60_000, Math.min(365 * 86_400_000, rawTarget))
      : 8 * 3_600_000,
  };
}

/** Sortable, readable, and unique enough for a list capped at twenty. */
function newGoalId(now: number): string {
  return `g-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Listing 4 — the project's saved goals. */
export async function handleListSlaGoals(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
): Promise<HandlerResult<readonly StoredSlaGoal[]>> {
  runtime.beginInvocation();
  const auth = await authoriseProject(runtime, invocation);
  if (!auth.ok) return { ok: false, error: auth.error };
  try {
    return { ok: true, data: await runtime.slaGoals(auth.projectId) };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/**
 * Save a goal for the project.
 *
 * Authorised like every other project-scoped resolver — browse permission on
 * the project. A saved goal is shared configuration, so this is the first
 * write in the product that one user makes and another sees, and it is worth
 * being plain about: Jira exposes no project-admin permission this app holds
 * a scope to check, so "can read this project's reports" is the only gate
 * available. The app writes nothing to Jira and the blast radius is a list of
 * twenty named goals, which is why that is an acceptable gate rather than a
 * reason to drop the feature.
 */
export async function handleSaveSlaGoal(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
): Promise<HandlerResult<{ goals: readonly StoredSlaGoal[]; savedId: string }>> {
  runtime.beginInvocation();
  const auth = await authoriseProject(runtime, invocation);
  if (!auth.ok) return { ok: false, error: auth.error };
  const goal = parseGoalToSave(invocation.payload, runtime.now());
  if (goal === 'no-name') return { ok: false, error: GOAL_NAME_REQUIRED };
  try {
    const result = await runtime.saveSlaGoal(auth.projectId, goal);
    // The id comes back explicitly. A client that had to find its own goal
    // in the returned list could only match on the name, and two goals may
    // share one — it would then attach the page to whichever came first,
    // which is the "labelled with one goal, computed from another" failure
    // `resolveSlaGoal` exists to prevent, reintroduced on the way out.
    return result.saved
      ? { ok: true, data: { goals: result.goals, savedId: goal.id } }
      : { ok: false, error: GOALS_FULL };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/** Delete a saved goal. Deleting one that is already gone is not an error. */
export async function handleDeleteSlaGoal(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
): Promise<HandlerResult<readonly StoredSlaGoal[]>> {
  runtime.beginInvocation();
  const auth = await authoriseProject(runtime, invocation);
  if (!auth.ok) return { ok: false, error: auth.error };
  const record =
    typeof invocation.payload === 'object' && invocation.payload !== null
      ? (invocation.payload as Record<string, unknown>)
      : {};
  const id = record['id'];
  if (typeof id !== 'string' || id === '') return { ok: false, error: UNKNOWN_SLA_GOAL };
  try {
    return { ok: true, data: await runtime.deleteSlaGoal(auth.projectId, id) };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/** Listing 5 — filtered field-change history. */
export async function handleHistoryReport(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
): Promise<HandlerResult<HistoryReport>> {
  runtime.beginInvocation();
  const auth = await authoriseProject(runtime, invocation);
  if (!auth.ok) return { ok: false, error: auth.error };
  const projectId = auth.projectId;
  const request = parseHistoryRequest(projectId, invocation.payload);
  try {
    return { ok: true, data: await runtime.historyReport(request) };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

/**
 * An error and everything it wraps, as one line.
 *
 * `String(error)` gives the outermost message only, which on Forge meant every
 * SQL failure reported itself as `ForgeSQLError: Unknown SQL execution error`
 * — true, and useless. The chain is what says which statement was refused.
 */
export function describeError(error: unknown): string {
  const describe = (value: unknown): string => {
    if (value instanceof Error) {
      // Platform errors carry the useful part in their own fields, not their
      // message: `@forge/sql`'s ForgeSQLAPIError keeps `code`, `suggestion`
      // and `context` beside a message that is only ever "Unknown SQL
      // execution error". Dropping them left nothing to act on.
      const extra = Object.getOwnPropertyNames(value)
        .filter((key) => key !== 'message' && key !== 'stack' && key !== 'cause')
        .map((key) => {
          try {
            return `${key}=${JSON.stringify((value as unknown as Record<string, unknown>)[key])}`;
          } catch {
            return `${key}=?`;
          }
        })
        .filter((part) => !part.endsWith('=undefined'));
      const suffix = extra.length === 0 ? '' : ` {${extra.join(' ')}}`;
      return `${value.name}: ${value.message}${suffix}`;
    }
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    // A thrown non-Error object stringifies to "[object Object]", which tells
    // nobody anything; JSON at least carries whatever fields it had.
    try {
      return JSON.stringify(value) ?? 'unknown';
    } catch {
      return 'unserialisable';
    }
  };

  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth += 1) {
    parts.push(describe(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.join(' ← caused by ');
}
