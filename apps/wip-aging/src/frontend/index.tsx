import React, { useCallback, useEffect, useRef, useState } from 'react';
import ForgeReconciler, { Inline, Stack } from '@forge/react';
import { invoke } from '@forge/bridge';
import type { BackfillProgress } from '@jfm/engine';
import type { AgingReport, FlowReport } from '@jfm/forge-runtime';
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
  toReportCapBanner,
  toReadCapBanner,
  toFlowChartData,
  toProgressBanner,
  type MaybeProgress,
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
  const [progress, setProgress] = useState<MaybeProgress>('unknown');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    // ★ Only the newest request may write to the screen.
    //
    // Every control on this page re-runs `load`, each `invoke` is a separate
    // Forge lambda, and answers arrive in whatever order they finish — so
    // without this the *older* reply can land last and win. The gadgets
    // guarded against it with a `cancelled` flag from the start; the pages
    // never did.
    //
    // What that looked like: click a status chip, the narrowed report
    // renders, the original answer then arrives and overwrites it — leaving
    // chips that say one goal above numbers computed from another, with
    // nothing loading and no way to tell. On the time-in-status page it also
    // stranded the reader: the basis had already been set, so pressing the
    // same button again changed no state, re-ran no effect, and the caption
    // kept contradicting the control until they toggled twice.
    const mine = requestId.current + 1;
    requestId.current = mine;
    setLoading(true);
    setError(null);
    try {
      const result = (await invoke('getAgingReport', {})) as Result<AgingReport>;
      if (mine !== requestId.current) return;
      if (result.ok) setReport(result.data);
      else setError(result.error);
      // The indexing banner is shared across all five listings. It reads the
      // index state from its own resolver rather than from `getReport`: that
      // call ran a whole report aggregation to return one enum, and Forge is
      // consumption-priced.
      const state = (await invoke('getIndexProgress', {})) as Result<BackfillProgress | null>;
      if (mine !== requestId.current) return;
      // ★ `'unknown'` on a failed read, not `null`.
      //
      // `null` is "never indexed", and rendering that because the call
      // failed put "Not indexed yet — start indexing" directly above a
      // populated report. See `MaybeProgress`.
      if (state.ok) setProgress(state.data);
      else setProgress('unknown');
      // The flow diagram is a second resolver rather than a field on the
      // aging report: it scans a different table over a different window,
      // and folding it in would make every gadget render pay for a chart it
      // does not show.
      const flowResult = (await invoke('getFlowReport', { days: 30 })) as Result<FlowReport>;
      if (mine !== requestId.current) return;
      if (flowResult.ok) setFlow(flowResult.data);
    } catch {
      // Guarded too: a superseded request that fails must not paint an error
      // over the screen a newer, successful one has already drawn.
      if (mine === requestId.current) {
        setError('The report could not be loaded. Try again in a moment.');
      }
    } finally {
      // A superseded request must not clear the spinner the newer one
      // put up, or the page reads as settled while it is still fetching.
      if (mine === requestId.current) setLoading(false);
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
            banner={toReportCapBanner({
              capped: report.capped,
              aggregatesCapped: report.aggregatesCapped,
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
              {/*
                `toReadCapBanner`, not `toCapBanner`: the flow report has no
                honest denominator — `issueCount` counts what was read, not
                what exists — and passing it as both halves produced the
                flatly self-contradicting "Report capped at 412 of 412
                issues".
              */}
              <IndexingBanner
                banner={toReadCapBanner({
                  capped: flow.capped,
                  included: flow.issueCount,
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
