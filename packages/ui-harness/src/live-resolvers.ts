import {
  handleAgingReport,
  handleDeleteSlaGoal,
  handleExportCsv,
  handleExtendHistory,
  handleFlowReport,
  handleGetReport,
  handleHistoryReport,
  handleHistoryWindow,
  handleIndexProgress,
  handleIssueTimeline,
  handleListProjects,
  handleListSlaGoals,
  handleListStatuses,
  handleSaveSlaGoal,
  handleSlaReport,
  handleStartIndexing,
  handleStorageEstimate,
  handleWorklogReport,
  type CsvExportKind,
  type ListingRuntime,
} from '@jfm/forge-runtime';
import {
  CANONICAL_ISSUE,
  IN_FLIGHT_ISSUES,
  PIPELINE_CONTEXT,
  runPipeline,
} from '@jfm/forge-runtime/testing';

/**
 * A **live** resolver backend for the browser harness.
 *
 * `scenarios.ts` produces one frozen snapshot per resolver: enough to render
 * every state, and useless the moment a user *does* something. A saved SLA
 * goal that does not come back on the next call, an extended history window
 * that leaves the banner unchanged — those are precisely the wiring this
 * product can get wrong, and a frozen snapshot cannot show it either way.
 *
 * So this keeps one real `ListingRuntime` per listing, alive across calls,
 * over the real engine and a real `MemoryStore` seeded from the recorded Jira
 * fixtures. A click in the browser reaches the same handler a Forge resolver
 * would, mutates the same store, and the next render reads it back.
 *
 * ⚠️ Still not Forge. The transport is a `fetch` to the harness's own dev
 * server rather than Atlassian's bridge, and the renderer is the stand-in in
 * `forge-host.tsx`. What this adds over the snapshot is **behaviour over
 * time**: state that round-trips, and every resolver reached by a real click
 * rather than by a test calling it directly.
 */

/**
 * Which report each listing's export button exports. Mirrors the `handleExportCsv`
 * kind each app passes in its own `src/index.ts`.
 */
const CSV_KIND: Readonly<Record<string, CsvExportKind>> = {
  'time-in-status': 'status',
  'worklog-reports': 'worklog',
  'wip-aging': 'aging',
  'sla-breach': 'sla',
  'issue-history': 'history',
};

export const LIVE_APPS = Object.keys(CSV_KIND);

const runtimes = new Map<string, Promise<ListingRuntime>>();

/**
 * One runtime per listing, built once and kept.
 *
 * Per listing rather than one shared: each app has its own Forge SQL database
 * in production, and a saved goal on the SLA listing must not appear on the
 * WIP-aging one. Getting that wrong here would hide a real bug.
 */
function runtimeFor(app: string): Promise<ListingRuntime> {
  const existing = runtimes.get(app);
  if (existing !== undefined) return existing;
  const created = runPipeline({
    issues: [CANONICAL_ISSUE, ...IN_FLIGHT_ISSUES],
    listingId: app,
  }).then((result) => result.runtime);
  runtimes.set(app, created);
  return created;
}

/** Drop every runtime, so a flow can start from a freshly-installed app. */
export function resetLiveRuntimes(): void {
  runtimes.clear();
}

/** The issue the timeline surface opens on — the canonical re-entry issue. */
const TIMELINE_CONTEXT = {
  extension: {
    ...PIPELINE_CONTEXT.extension,
    issue: { id: CANONICAL_ISSUE.issue.id, key: CANONICAL_ISSUE.issue.key },
  },
};

/**
 * Dispatch one resolver key to the real handler.
 *
 * Unknown keys throw rather than returning a plausible empty answer: a
 * frontend invoking a key nothing wires up is exactly the failure
 * `unregisteredResolvers` exists to surface, and it must not be smoothed over
 * here either.
 */
export async function callLiveResolver(
  app: string,
  key: string,
  payload: unknown,
): Promise<unknown> {
  const runtime = await runtimeFor(app);
  const invocation = { payload, context: PIPELINE_CONTEXT };
  switch (key) {
    case 'getReport':
      return handleGetReport(runtime, invocation);
    case 'getIndexProgress':
      return handleIndexProgress(runtime, invocation);
    case 'getWorklogReport':
      return handleWorklogReport(runtime, invocation);
    case 'getAgingReport':
      return handleAgingReport(runtime, invocation);
    case 'getFlowReport':
      return handleFlowReport(runtime, invocation);
    case 'getSlaReport':
      return handleSlaReport(runtime, invocation);
    case 'getHistoryReport':
      return handleHistoryReport(runtime, invocation);
    case 'listStatuses':
      return handleListStatuses(runtime, invocation);
    case 'listSlaGoals':
      return handleListSlaGoals(runtime, invocation);
    case 'saveSlaGoal':
      return handleSaveSlaGoal(runtime, invocation);
    case 'deleteSlaGoal':
      return handleDeleteSlaGoal(runtime, invocation);
    case 'getHistoryWindow':
      return handleHistoryWindow(runtime, invocation);
    case 'extendHistory':
      return handleExtendHistory(runtime, invocation);
    case 'getIssueTimeline':
      return handleIssueTimeline(runtime, { payload, context: TIMELINE_CONTEXT });
    case 'getStorageEstimate':
      return handleStorageEstimate(runtime);
    case 'listProjects':
      return handleListProjects(runtime);
    case 'startIndexing':
      return handleStartIndexing(runtime, invocation);
    case 'exportCsv':
      return handleExportCsv(runtime, invocation, CSV_KIND[app] ?? 'status');
    default:
      throw new Error(`the harness has no live handler for resolver "${key}"`);
  }
}
