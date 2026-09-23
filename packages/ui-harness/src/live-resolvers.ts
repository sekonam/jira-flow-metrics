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
  handleListFilterOptions,
  handleListSlaGoals,
  handleListStatuses,
  handleSaveSlaGoal,
  handleSlaReport,
  handleStartIndexing,
  handleStorageEstimate,
  handleWorklogReport,
  isListingId,
  LISTING_CSV_KIND,
  LISTING_DATASETS,
  LISTING_IDS,
  type ListingId,
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

/** The listings this harness can run live. */
export const LIVE_APPS: readonly ListingId[] = LISTING_IDS;

const runtimes = new Map<string, Promise<ListingRuntime>>();

/**
 * One runtime per listing, built once and kept.
 *
 * Per listing rather than one shared: each app has its own Forge SQL database
 * in production, and a saved goal on the SLA listing must not appear on the
 * WIP-aging one. Getting that wrong here would hide a real bug.
 */
function runtimeFor(app: string): Promise<ListingRuntime> {
  // ★ An unknown listing id throws rather than getting a default runtime.
  //
  // `?live=<app>` comes off the URL unvalidated and a flow's `app` field is
  // forwarded verbatim, so a typo used to produce its own fresh runtime that
  // ingested everything and exported the time-in-status CSV under another
  // listing's name — the exact "wrong CSV kind" defect the five export flows
  // were written to catch, hidden by the fallback meant to be convenient.
  if (!isListingId(app)) {
    throw new Error(
      `the harness has no listing "${app}" — expected one of ${LISTING_IDS.join(', ')}`,
    );
  }
  const existing = runtimes.get(app);
  if (existing !== undefined) return existing;
  // ★ The listing's **real** datasets, not everything.
  //
  // `runPipeline` defaults to `DATASETS_ALL` because one snapshot scenario
  // has to answer all five listings' resolvers. Live mode does not: each
  // listing gets its own runtime, exactly as each app has its own database
  // on Forge. Ingesting everything here meant a listing configured to skip
  // the dataset its own report is built from rendered perfectly in all forty
  // browser flows — `wip-aging` is the only one that stores status visits,
  // and its cumulative flow chart is the report that needs them.
  const created = runPipeline({
    issues: [CANONICAL_ISSUE, ...IN_FLIGHT_ISSUES],
    listingId: app,
    datasets: LISTING_DATASETS[app],
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
    case 'listFilterOptions':
      return handleListFilterOptions(runtime, invocation);
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
      return handleExportCsv(runtime, invocation, LISTING_CSV_KIND[app as ListingId]);
    default:
      throw new Error(`the harness has no live handler for resolver "${key}"`);
  }
}
