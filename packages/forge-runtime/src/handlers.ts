import { jobFromPayload } from './scheduler.js';
import type { ListingRuntime, ReportEnvelope, StatusReportRequest } from './runtime.js';
import type {
  AgingReport,
  HistoryReport,
  HistoryReportRequest,
  SlaReport,
  WorklogReportRequest,
} from './reports.js';
import type { WorklogAggregateResult } from '@jfm/engine';

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
 */
export function projectIdFromContext(context: unknown): string | null {
  if (typeof context !== 'object' || context === null) return null;
  const record = context as Record<string, unknown>;
  const extension = record['extension'];
  if (typeof extension === 'object' && extension !== null) {
    const project = (extension as Record<string, unknown>)['project'];
    if (typeof project === 'object' && project !== null) {
      const id = (project as Record<string, unknown>)['id'];
      if (typeof id === 'string' && id !== '') return id;
      if (typeof id === 'number') return String(id);
    }
  }
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
  } = { projectId };
  if (basis === 'business' || basis === 'elapsed') request.basis = basis;
  const limit = record['limit'];
  if (typeof limit === 'number' && Number.isFinite(limit)) request.limit = limit;
  const offset = record['offset'];
  if (typeof offset === 'number' && Number.isFinite(offset)) request.offset = offset;
  const assignees = stringArray(record['assigneeAccountIds']);
  if (assignees !== null) request.assigneeAccountIds = assignees;
  const issueTypes = stringArray(record['issueTypeIds']);
  if (issueTypes !== null) request.issueTypeIds = issueTypes;
  return request;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((v): v is string => typeof v === 'string' && v !== '');
  return strings.length === 0 ? null : strings;
}

export type HandlerResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };

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
  const projectId = projectIdFromContext(invocation.context);
  if (projectId === null) {
    return { ok: false, error: 'This report can only be opened from inside a Jira project.' };
  }
  try {
    return {
      ok: true,
      data: await runtime.statusReport(parseReportRequest(projectId, invocation.payload)),
    };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

export async function handleExportCsv(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
): Promise<HandlerResult<{ filename: string; csv: string }>> {
  runtime.beginInvocation();
  const projectId = projectIdFromContext(invocation.context);
  if (projectId === null) {
    return { ok: false, error: 'This report can only be opened from inside a Jira project.' };
  }
  try {
    const csv = await runtime.statusReportCsv(parseReportRequest(projectId, invocation.payload));
    return {
      ok: true,
      data: { filename: `${runtime.listingId}-${projectId}.csv`, csv },
    };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

export async function handleStartIndexing(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
): Promise<HandlerResult<{ started: true }>> {
  runtime.beginInvocation();
  const projectId = projectIdFromContext(invocation.context);
  if (projectId === null) {
    return { ok: false, error: 'Indexing can only be started from inside a Jira project.' };
  }
  try {
    await runtime.startBackfill(projectId);
    return { ok: true, data: { started: true } };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}

export async function handleStorageEstimate(
  runtime: ListingRuntime,
): Promise<HandlerResult<{ bytes: number; note: string }>> {
  runtime.beginInvocation();
  try {
    return { ok: true, data: await runtime.storageEstimate() };
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
      JSON.stringify({ message: 'issue event failed', eventType, error: String(error) }),
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

/** Listing 2 — worklog totals. */
export async function handleWorklogReport(
  runtime: ListingRuntime,
  invocation: ResolverInvocation,
): Promise<HandlerResult<WorklogAggregateResult>> {
  runtime.beginInvocation();
  const projectId = projectIdFromContext(invocation.context);
  if (projectId === null) {
    return { ok: false, error: 'This report can only be opened from inside a Jira project.' };
  }
  const record =
    typeof invocation.payload === 'object' && invocation.payload !== null
      ? (invocation.payload as Record<string, unknown>)
      : {};
  const groupBy = record['groupBy'];
  const request: WorklogReportRequest = {
    projectId,
    ...(isWorklogGrouping(groupBy) ? { groupBy } : {}),
    ...(typeof record['from'] === 'number' ? { from: record['from'] } : {}),
    ...(typeof record['to'] === 'number' ? { to: record['to'] } : {}),
  };
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
  const projectId = projectIdFromContext(invocation.context);
  if (projectId === null) {
    return { ok: false, error: 'This report can only be opened from inside a Jira project.' };
  }
  try {
    return { ok: true, data: await runtime.agingReport(projectId) };
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
  const projectId = projectIdFromContext(invocation.context);
  if (projectId === null) {
    return { ok: false, error: 'This report can only be opened from inside a Jira project.' };
  }
  const record =
    typeof invocation.payload === 'object' && invocation.payload !== null
      ? (invocation.payload as Record<string, unknown>)
      : {};
  const counted = stringArray(record['countedStatusIds']) ?? [];
  const rawTarget = record['targetMs'];
  const targetMs =
    typeof rawTarget === 'number' && Number.isFinite(rawTarget)
      ? Math.max(60_000, Math.min(365 * 86_400_000, rawTarget))
      : 8 * 3_600_000;
  try {
    return {
      ok: true,
      data: await runtime.slaReport(projectId, {
        id: 'default',
        name: typeof record['name'] === 'string' ? record['name'] : 'Time to resolution',
        countedStatusIds: counted,
        targetMs,
      }),
    };
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
  const projectId = projectIdFromContext(invocation.context);
  if (projectId === null) {
    return { ok: false, error: 'This report can only be opened from inside a Jira project.' };
  }
  const record =
    typeof invocation.payload === 'object' && invocation.payload !== null
      ? (invocation.payload as Record<string, unknown>)
      : {};
  const request: HistoryReportRequest = {
    projectId,
    ...(typeof record['from'] === 'number' ? { from: record['from'] } : {}),
    ...(typeof record['to'] === 'number' ? { to: record['to'] } : {}),
    ...(stringArray(record['fields']) === null ? {} : { fields: stringArray(record['fields'])! }),
    ...(typeof record['limit'] === 'number' ? { limit: Math.min(1000, record['limit']) } : {}),
  };
  try {
    return { ok: true, data: await runtime.historyReport(request) };
  } catch (error: unknown) {
    return { ok: false, error: toUserMessage(error) };
  }
}
