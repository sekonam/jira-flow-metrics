import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, { Inline, Stack } from '@forge/react';
import { invoke } from '@forge/bridge';
import type { AgingReport, FlowReport } from '@jfm/forge-runtime';
import type { BackfillProgress } from '@jfm/engine';
import {
  AgingHistogram,
  CsvExport,
  EmptySurface,
  ErrorSurface,
  ExtendHistoryControl,
  IndexingBanner,
  LoadingSurface,
  PageHeader,
  ReportLineChart,
  SimpleReportTable,
  SummaryTiles,
  surfaceStateOf,
  toAgingChartData,
  toAgingTable,
  toAgingTiles,
  toCapBanner,
  toFlowChartData,
  toProgressBanner,
} from '@jfm/ui';

/**
 * Project page for the WIP Aging listing.
 *
 * Structurally identical to the other four: fetch, pick one of four designed
 * states, render a shared component. The listing-specific part is one view
 * model, which lives in `@jfm/ui` and is unit-tested.
 *
 * `App` is exported so it can be rendered outside Forge. UI Kit 2 components
 * are sentinels serialised over the bridge, so rendering them needs a stand-in
 * for the half of the renderer that lives inside Jira — see
 * `packages/ui-harness/src/forge-host.tsx`. `test/frontend.test.tsx` and the
 * screenshot harness both mount this component that way.
 *
 * ⚠️ That is **not** platform verification. Nothing in this repository has run
 * on Forge, and the first `forge tunnel` session is still this file's real
 * acceptance test (`docs/RUNBOOK.md`).
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export const App = (): React.JSX.Element => {
  const [report, setReport] = useState<AgingReport | null>(null);
  const [flow, setFlow] = useState<FlowReport | null>(null);
  const [progress, setProgress] = useState<BackfillProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await invoke('getAgingReport', {})) as Result<AgingReport>;
      if (result.ok) setReport(result.data);
      else setError(result.error);
      // The indexing banner is shared across all five listings. It reads the
      // index state from its own resolver rather than from `getReport`: that
      // call ran a whole report aggregation to return one enum, and Forge is
      // consumption-priced.
      const state = (await invoke('getIndexProgress', {})) as Result<BackfillProgress | null>;
      if (state.ok) setProgress(state.data);
      // The flow diagram is a second resolver rather than a field on the
      // aging report: it scans a different table over a different window,
      // and folding it in would make every gadget render pay for a chart it
      // does not show.
      const flowResult = (await invoke('getFlowReport', { days: 30 })) as Result<FlowReport>;
      if (flowResult.ok) setFlow(flowResult.data);
    } catch {
      setError('The report could not be loaded. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, []);

  // The `exportCsv` resolver has existed since the first commit with no
  // caller; this is the caller. `CsvExport` owns the presentation, so all
  // that belongs here is the bridge call and unwrapping the envelope.
  const requestCsv = useCallback(async () => {
    const result = (await invoke('exportCsv', {})) as Result<{
      filename: string;
      csv: string;
    }>;
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }, []);

  /**
   * The "extend history" control's two calls. Both are made only when the
   * control is opened, so a reader who never opens it pays for neither.
   */
  const loadHistoryWindow = useCallback(async () => {
    const result = (await invoke('getHistoryWindow', {})) as Result<{ months: number | null }>;
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }, []);

  const extendHistory = useCallback(
    async (months: number | null) => {
      const result = (await invoke('extendHistory', { months })) as Result<{
        months: number | null;
      }>;
      if (!result.ok) throw new Error(result.error);
      // Re-indexing has just started; reload so the banner shows it rather
      // than leaving the page claiming the index is complete.
      await load();
    },
    [load],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const startIndexing = useCallback(async () => {
    await invoke('startIndexing', {});
    void load();
  }, [load]);

  const rowCount = report === null ? 0 : report.rows.length;
  const state = surfaceStateOf({ loading, error, rowCount });

  return (
    <Stack space="space.200">
      <PageHeader
        title="WIP Aging"
        subtitle="How long each unfinished issue has been sitting where it is."
        actions={
          <Inline space="space.100">
            <CsvExport onRequestCsv={requestCsv} />
            <ExtendHistoryControl onLoad={loadHistoryWindow} onExtend={extendHistory} />
          </Inline>
        }
      />

      {/*
        Withheld while loading and while refused. `toProgressBanner(null)`
        reads as "not indexed yet", and `progress` is still null in both of
        those states, so rendering it regardless told users of a fully-indexed
        project that it had never been indexed — under a loading spinner in
        one case, and directly above "you do not have permission" in the
        other.
      */}
      {state === 'loading' || state === 'error' ? null : (
        <IndexingBanner
          banner={toProgressBanner(progress)}
          onRetry={() => {
            void startIndexing();
          }}
        />
      )}

      {state === 'loading' ? <LoadingSurface label="Loading report" /> : null}
      {state === 'error' ? (
        <ErrorSurface
          message={error ?? 'Unknown error'}
          onRetry={() => {
            void load();
          }}
        />
      ) : null}
      {state === 'empty' ? (
        <EmptySurface
          title="Nothing in flight"
          body="Every issue in this project is finished, or indexing has not run yet."
          actionLabel="Start indexing"
          onAction={() => {
            void startIndexing();
          }}
        />
      ) : null}
      {state === 'ready' && report !== null ? (
        <Stack space="space.200">
          <IndexingBanner
            banner={toCapBanner({
              capped: report.capped,
              included: report.rows.length + report.excludedDone,
              total: report.projectIssueCount,
              noun: 'issues',
            })}
          />
          <SummaryTiles tiles={toAgingTiles(report)} />
          <AgingHistogram data={toAgingChartData(report)} />
          {/*
            Withheld rather than drawn empty when no visits are stored:
            "indexing has not recorded the visits yet" and "nothing was in
            flight for 30 days" are different answers, and a flat chart of
            zeroes asserts the second one.
          */}
          {flow !== null && !flow.unavailable ? (
            <Stack space="space.100">
              {/*
                A capped flow chart is a lower bound like any other capped
                report, and it said so nowhere: every other report in the
                product renders `toCapBanner` and this one quietly did not.
              */}
              <IndexingBanner
                banner={toCapBanner({
                  capped: flow.capped,
                  included: flow.issueCount,
                  total: flow.issueCount,
                  noun: 'issues',
                })}
              />
              <ReportLineChart
                data={toFlowChartData(flow)}
                title="Cumulative flow"
                subtitle="Issues in each status at the end of each day, last 30 days (UTC)."
              />
            </Stack>
          ) : null}
          <SimpleReportTable model={toAgingTable(report)} />
        </Stack>
      ) : null}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
