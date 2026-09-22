import {
  handleAgingReport,
  handleExportCsv,
  handleGetReport,
  handleIndexProgress,
  handleHistoryReport,
  handleHistoryWindow,
  handleListStatuses,
  handleSlaReport,
  handleWorklogReport,
  type ListingRuntime,
} from '@jfm/forge-runtime';
import {
  CANONICAL_ISSUE,
  IN_FLIGHT_ISSUES,
  PIPELINE_CONTEXT,
  runPipeline,
  type PipelineOptions,
} from '@jfm/forge-runtime/testing';

/**
 * The product states, each produced by actually running the pipeline.
 *
 * Every payload below is what the *real* resolver handler returns after the
 * *real* engine has ingested the *recorded* Jira fixtures into the *real*
 * store. Nothing is hand-written, which is the point: a UI test that asserts
 * against invented data proves only that the invention renders.
 *
 * The one thing that is faked is the transport — `@forge/bridge` — because it
 * only exists inside a Jira page. See `bridge.ts`.
 *
 * Node-only: the pipeline reads fixture JSON from disk. The browser harness
 * consumes the JSON these functions produce, generated ahead of time by
 * `scripts/build-scenarios.mjs`.
 */

export type ResolverKey =
  | 'getReport'
  | 'getIndexProgress'
  | 'getWorklogReport'
  | 'getAgingReport'
  | 'getSlaReport'
  | 'getHistoryReport'
  | 'listStatuses'
  | 'exportCsv'
  | 'getHistoryWindow'
  | 'startIndexing';

/** Everything the five frontends can ask for, in one JSON-serialisable object. */
export type ResolverResponses = Readonly<Record<ResolverKey, unknown>>;

export const SCENARIO_IDS = [
  'populated',
  'canonical',
  'partial',
  'empty',
  'not-indexed',
  'error',
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

export interface Scenario {
  readonly id: ScenarioId;
  readonly label: string;
  /** What a reviewer should be looking at on this screen. */
  readonly note: string;
  readonly responses: ResolverResponses;
}

const SCENARIO_SETUP: Readonly<
  Record<ScenarioId, { label: string; note: string; options: PipelineOptions }>
> = {
  populated: {
    label: 'Populated',
    note: 'Four issues indexed to completion. The re-entry lozenge and the cumulative footnote are the product argument.',
    options: { issues: [...IN_FLIGHT_ISSUES, CANONICAL_ISSUE] },
  },
  canonical: {
    label: 'Canonical end-to-end issue',
    note: 'The single issue asserted in end-to-end.test.ts: In Progress 12h across two visits, 27h working hours, 76h elapsed.',
    options: { issues: [CANONICAL_ISSUE] },
  },
  partial: {
    label: 'Backfill still running',
    note: 'Indexing stopped after one slice. Rows are shown together with a banner saying they cover only part of the history.',
    options: {
      // The canonical issue leads so that the half that gets indexed contains
      // both a finished issue and work in flight — otherwise the WIP and
      // worklog listings would have nothing to show and the screen would be
      // indistinguishable from the empty state.
      issues: [CANONICAL_ISSUE, ...IN_FLIGHT_ISSUES],
      pageSize: 2,
      issuesPerSlice: 2,
      maxSlices: 1,
    },
  },
  empty: {
    label: 'Indexed, nothing to show',
    note: 'Indexing finished and the project has no issues. Distinct from "not indexed yet".',
    options: { issues: [] },
  },
  'not-indexed': {
    label: 'Never indexed',
    note: 'Freshly installed: no index state at all, so the banner offers the button rather than reporting progress.',
    options: { issues: [...IN_FLIGHT_ISSUES, CANONICAL_ISSUE], startIndexing: false },
  },
  error: {
    label: 'Refused',
    note: 'The caller cannot browse the project. The refusal comes from the real permission check in authoriseProject, not from a string typed here.',
    options: { issues: [...IN_FLIGHT_ISSUES, CANONICAL_ISSUE], browseAllowed: false },
  },
};

const INVOCATION = { context: PIPELINE_CONTEXT };

async function collect(runtime: ListingRuntime): Promise<ResolverResponses> {
  return {
    getReport: await handleGetReport(runtime, INVOCATION),
    getIndexProgress: await handleIndexProgress(runtime, INVOCATION),
    getWorklogReport: await handleWorklogReport(runtime, INVOCATION),
    getAgingReport: await handleAgingReport(runtime, INVOCATION),
    getSlaReport: await handleSlaReport(runtime, {
      ...INVOCATION,
      // Working time in the two active statuses against a one-working-day
      // target. Counted statuses and target are a view choice, not stored
      // configuration — see PRODUCT-SPEC §7.
      payload: { countedStatusIds: ['3', '10200'], targetMs: 8 * 3_600_000 },
    }),
    getHistoryReport: await handleHistoryReport(runtime, INVOCATION),
    // The SLA goal picker's options — the statuses the pipeline stored.
    listStatuses: await handleListStatuses(runtime, INVOCATION),
    // Produced by the real exporter, like everything else here, so the modal
    // shows the CSV a user would actually get rather than a sample of one.
    exportCsv: await handleExportCsv(runtime, INVOCATION),
    // The "extend history" control's current range. Read only when the
    // control is opened, so no screen fetches it on load.
    getHistoryWindow: await handleHistoryWindow(runtime, INVOCATION),
    startIndexing: { ok: true, data: { started: true } },
  };
}

/** Build one scenario by running the pipeline and calling every resolver. */
export async function buildScenario(id: ScenarioId): Promise<Scenario> {
  const setup = SCENARIO_SETUP[id];
  const { runtime } = await runPipeline(setup.options);
  return {
    id,
    label: setup.label,
    note: setup.note,
    responses: await collect(runtime),
  };
}

export async function buildAllScenarios(): Promise<readonly Scenario[]> {
  const built: Scenario[] = [];
  for (const id of SCENARIO_IDS) built.push(await buildScenario(id));
  return built;
}

// ------------------------------------------------- bridge wiring helpers ---

/**
 * Turn a scenario's responses into `@forge/bridge` handlers.
 *
 * `startIndexing` is included so the empty-state and not-indexed screens have
 * a working button: pressing it must not throw, because a button that throws
 * is a bug the four-state design is meant to prevent.
 */
export function resolversFor(responses: ResolverResponses): Record<string, () => unknown> {
  return Object.fromEntries(Object.entries(responses).map(([key, value]) => [key, () => value]));
}

/** Handlers that never settle, which is exactly the loading state. */
export function pendingResolvers(keys: readonly string[]): Record<string, () => Promise<never>> {
  return Object.fromEntries(keys.map((key) => [key, () => new Promise<never>(() => undefined)]));
}

/**
 * Handlers that reject.
 *
 * Distinct from a resolver returning `{ ok: false }`: a rejection is a
 * transport or runtime failure the frontend has to catch itself, and the two
 * paths render different messages.
 */
export function rejectingResolvers(keys: readonly string[]): Record<string, () => never> {
  return Object.fromEntries(
    keys.map((key) => [
      key,
      () => {
        throw new Error(`resolver ${key} exploded`);
      },
    ]),
  );
}

/** Every resolver key any of the five frontends can invoke. */
export const ALL_RESOLVER_KEYS: readonly ResolverKey[] = [
  'getReport',
  'getIndexProgress',
  'getWorklogReport',
  'getAgingReport',
  'getSlaReport',
  'getHistoryReport',
  'listStatuses',
  'exportCsv',
  'getHistoryWindow',
  'startIndexing',
];

/** Build every scenario once, keyed by id, for a suite that needs all of them. */
export async function loadScenarios(): Promise<Readonly<Record<ScenarioId, Scenario>>> {
  const all = await buildAllScenarios();
  return Object.fromEntries(all.map((scenario) => [scenario.id, scenario])) as Readonly<
    Record<ScenarioId, Scenario>
  >;
}
