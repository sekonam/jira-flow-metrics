import {
  handleAgingReport,
  handleFlowReport,
  handleExportCsv,
  handleGetReport,
  handleIndexProgress,
  handleIssueTimeline,
  handleHistoryReport,
  handleHistoryWindow,
  handleListFilterOptions,
  handleListSlaGoals,
  handleListStatuses,
  handleStorageEstimate,
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

import { RESOLVER_KEYS, type ResolverKey } from './bridge.js';

export type { ResolverKey } from './bridge.js';

/** Everything the five frontends can ask for, in one JSON-serialisable object. */
/**
 * A snapshot answer per resolver — **partial on purpose**.
 *
 * `RESOLVER_KEYS` includes the mutating keys (`saveSlaGoal`, `extendHistory`
 * and friends), and a frozen snapshot has nothing meaningful to say about a
 * resolver whose entire purpose is to change state. Those are exercised by
 * `pnpm run e2e:ui`, which drives the real handlers over a live store instead.
 */
export type ResolverResponses = Readonly<Partial<Record<ResolverKey, unknown>>>;

export const SCENARIO_IDS = [
  'populated',
  'canonical',
  'capped',
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
  Record<
    ScenarioId,
    {
      label: string;
      note: string;
      /**
       * `reportLimit` is not a pipeline option: it is the page size the
       * *resolver* is asked for, which is what makes a report capped
       * without needing thousands of fixture issues.
       */
      options: PipelineOptions & { reportLimit?: number };
    }
  >
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
  capped: {
    label: 'Report capped',
    note: 'More rows match than the report will fetch. Every figure is a lower bound and the banner has to say so — the one state whose absence is invisible.',
    /**
     * ⚠️ Only the two resolvers that accept a page size can show this.
     *
     * `handleGetReport` and `handleHistoryReport` parse a `limit` from the
     * payload; `handleAgingReport` and `handleSlaReport` call
     * `runtime.agingReport(projectId)` / `slaReport(projectId, goal)` with
     * no page size at all, so their reports only cap past 500 *indexed*
     * issues — which this four-issue fixture cannot reach. Their surfaces
     * `skip` this scenario in `screens.mjs` rather than publishing a
     * populated screenshot under a caption that says "Report capped".
     */
    options: { issues: [...IN_FLIGHT_ISSUES, CANONICAL_ISSUE], reportLimit: 2 },
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
    note: 'The caller may neither browse the project nor administer the instance. Both refusals come from the real permission checks in authoriseProject and handleStorageEstimate, not from strings typed here.',
    // ★ `adminAllowed` too, not only `browseAllowed`.
    //
    // `browseAllowed` gates project authorisation, and the admin surface is
    // instance-wide and unscoped by project — so `getStorageEstimate` went
    // on answering `ok` in the one scenario named "Refused", and the five
    // `*-admin--error.png` screenshots showed an ordinary populated admin
    // page under the caption "Caller cannot browse the project". The
    // `adminAllowed` option existed for this and no scenario used it, so
    // `handleStorageEstimate`'s fail-closed path had no screenshot and no
    // snapshot test at all.
    options: {
      issues: [...IN_FLIGHT_ISSUES, CANONICAL_ISSUE],
      browseAllowed: false,
      adminAllowed: false,
    },
  },
};

const INVOCATION = { context: PIPELINE_CONTEXT };

async function collect(runtime: ListingRuntime, reportLimit?: number): Promise<ResolverResponses> {
  return {
    getReport: await handleGetReport(runtime, {
      ...INVOCATION,
      ...(reportLimit === undefined ? {} : { payload: { limit: reportLimit } }),
    }),
    getIndexProgress: await handleIndexProgress(runtime, INVOCATION),
    getWorklogReport: await handleWorklogReport(runtime, INVOCATION),
    getAgingReport: await handleAgingReport(runtime, INVOCATION),
    // The cumulative flow diagram.
    //
    // ⚠️ These scenarios run `DATASETS_ALL`, so visits are always stored and
    // this is `unavailable` only when the project has no issues at all (the
    // `empty` scenario). The comment here used to claim it was unavailable
    // "on every scenario whose pipeline runs the time-in-status datasets" —
    // no scenario runs those, because one snapshot has to answer all five
    // listings' resolvers from one runtime. The live harness is where each
    // listing gets its own restricted store; see `live-resolvers.ts`.
    getFlowReport: await handleFlowReport(runtime, INVOCATION),
    getSlaReport: await handleSlaReport(runtime, {
      ...INVOCATION,
      // Working time in the two active statuses against a one-working-day
      // target. Counted statuses and target are a view choice, not stored
      // configuration — see PRODUCT-SPEC §7.
      payload: { countedStatusIds: ['3', '10200'], targetMs: 8 * 3_600_000 },
    }),
    getHistoryReport: await handleHistoryReport(runtime, {
      ...INVOCATION,
      ...(reportLimit === undefined ? {} : { payload: { limit: reportLimit } }),
    }),
    // The SLA goal picker's options — the statuses the pipeline stored.
    listStatuses: await handleListStatuses(runtime, INVOCATION),
    // The report filters' options — assignees and issue types, derived by
    // the fixture Jira from the same issues the report is built from.
    listFilterOptions: await handleListFilterOptions(runtime, INVOCATION),
    // The goal editor's saved goals. Empty on every scenario: nothing has
    // saved one, which is the state every project starts in.
    listSlaGoals: await handleListSlaGoals(runtime, INVOCATION),
    // Produced by the real exporter, like everything else here, so the modal
    // shows the CSV a user would actually get rather than a sample of one.
    exportCsv: await handleExportCsv(runtime, INVOCATION),
    // The "extend history" control's current range. Read only when the
    // control is opened, so no screen fetches it on load.
    getHistoryWindow: await handleHistoryWindow(runtime, INVOCATION),
    // The issue panel. Its context names an *issue*, not a project — the one
    // resolver here that does — and it reads the fixture Jira rather than the
    // store the other eleven read.
    getIssueTimeline: await handleIssueTimeline(runtime, {
      context: {
        extension: { ...PIPELINE_CONTEXT.extension, issue: { id: CANONICAL_ISSUE.issue.id } },
      },
    }),
    // The admin usage page. Instance-wide and unscoped by project, which is
    // why it takes no invocation context at all.
    getStorageEstimate: await handleStorageEstimate(runtime),
    // ⚠️ The one hand-written answer in a file whose docstring says nothing
    // is. `handleStartIndexing` mutates, and a frozen snapshot has nothing
    // meaningful to say about a resolver whose purpose is to change state —
    // but the empty and not-indexed screens need the button not to throw.
    // What it does for real is exercised by `pnpm run e2e:ui`.
    startIndexing: { ok: true, data: { started: true } },
  };
}

/** Build one scenario by running the pipeline and calling every resolver. */
export async function buildScenario(id: ScenarioId): Promise<Scenario> {
  const setup = SCENARIO_SETUP[id];
  const { reportLimit, ...pipelineOptions } = setup.options;
  const { runtime } = await runPipeline(pipelineOptions);
  return {
    id,
    label: setup.label,
    note: setup.note,
    responses: await collect(runtime, reportLimit),
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

/**
 * Every resolver key any of the five frontends can invoke.
 *
 * Re-exported from `bridge.ts` rather than re-listed: the browser harness
 * needs the same list and cannot import this module, which pulls in the
 * Node-only pipeline.
 */
export const ALL_RESOLVER_KEYS: readonly ResolverKey[] = RESOLVER_KEYS;

/** Build every scenario once, keyed by id, for a suite that needs all of them. */
export async function loadScenarios(): Promise<Readonly<Record<ScenarioId, Scenario>>> {
  const all = await buildAllScenarios();
  return Object.fromEntries(all.map((scenario) => [scenario.id, scenario])) as Readonly<
    Record<ScenarioId, Scenario>
  >;
}
