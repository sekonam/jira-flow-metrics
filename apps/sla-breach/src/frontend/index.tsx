import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, { Stack } from '@forge/react';
import { invoke } from '@forge/bridge';
import type { SlaReport } from '@jfm/forge-runtime';
import type { BackfillProgress, StatusMetaRow } from '@jfm/engine';
import {
  CsvExport,
  DEFAULT_SLA_GOAL,
  EmptySurface,
  ErrorSurface,
  IndexingBanner,
  LoadingSurface,
  PageHeader,
  ReportBarChart,
  SimpleReportTable,
  SlaGoalForm,
  SummaryTiles,
  surfaceStateOf,
  toCapBanner,
  toProgressBanner,
  toSlaChartData,
  toSlaTable,
  toSlaTiles,
  type SlaGoalChoice,
} from '@jfm/ui';

/**
 * Project page for the SLA & Due Dates listing.
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
  const [report, setReport] = useState<SlaReport | null>(null);
  const [progress, setProgress] = useState<BackfillProgress | null>(null);
  const [statuses, setStatuses] = useState<readonly StatusMetaRow[]>([]);
  const [goal, setGoal] = useState<SlaGoalChoice>(DEFAULT_SLA_GOAL);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (nextGoal: SlaGoalChoice) => {
    setLoading(true);
    setError(null);
    try {
      const result = (await invoke('getSlaReport', {
        countedStatusIds: [...nextGoal.countedStatusIds],
        targetMs: nextGoal.targetMs,
      })) as Result<SlaReport>;
      if (result.ok) setReport(result.data);
      else setError(result.error);
      // The indexing banner is shared across all five listings. It reads the
      // index state from its own resolver rather than from `getReport`: that
      // call ran a whole report aggregation to return one enum, and Forge is
      // consumption-priced.
      const state = (await invoke('getIndexProgress', {})) as Result<BackfillProgress | null>;
      if (state.ok) setProgress(state.data);
    } catch {
      setError('The report could not be loaded. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, []);

  // The picker's options change only when indexing does, so one fetch per
  // page open is enough. A failure here degrades to a target-only picker
  // rather than an error page: the report itself is unaffected.
  useEffect(() => {
    void (async () => {
      try {
        const result = (await invoke('listStatuses', {})) as Result<readonly StatusMetaRow[]>;
        if (result.ok) setStatuses(result.data);
      } catch {
        // Leave the chip row empty; the default goal still renders a report.
      }
    })();
  }, []);

  // The `exportCsv` resolver has existed since the first commit with no
  // caller; this is the caller. `CsvExport` owns the presentation, so all
  // that belongs here is the bridge call and unwrapping the envelope. The
  // goal travels with it so the exported rows are measured against exactly
  // the goal on screen.
  const requestCsv = useCallback(async () => {
    const result = (await invoke('exportCsv', {
      countedStatusIds: [...goal.countedStatusIds],
      targetMs: goal.targetMs,
    })) as Result<{
      filename: string;
      csv: string;
    }>;
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }, [goal]);

  useEffect(() => {
    void load(goal);
  }, [goal, load]);

  const startIndexing = useCallback(async () => {
    await invoke('startIndexing', {});
    void load(goal);
  }, [goal, load]);

  const rowCount = report === null ? 0 : report.rows.length;
  const state = surfaceStateOf({ loading, error, rowCount });

  return (
    <Stack space="space.200">
      <PageHeader
        title="SLA & Due Dates"
        subtitle="Working time against a target, plus plain due-date breaches."
        actions={<CsvExport onRequestCsv={requestCsv} />}
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

      {/*
        The goal picker stays on screen in every non-error state: it is what
        the empty/ready states are relative to, and hiding it while loading
        would bounce the layout on every goal change.
      */}
      {state === 'error' ? null : (
        <SlaGoalForm
          statuses={statuses.map((s) => ({ id: s.statusId, name: s.name }))}
          goal={goal}
          onChange={setGoal}
        />
      )}

      {state === 'loading' ? <LoadingSurface label="Loading report" /> : null}
      {state === 'error' ? (
        <ErrorSurface
          message={error ?? 'Unknown error'}
          onRetry={() => {
            void load(goal);
          }}
        />
      ) : null}
      {state === 'empty' ? (
        <EmptySurface
          title="No issues measured yet"
          body="Once indexing finishes, every issue is measured against the goal you choose here."
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
              included: report.rows.length,
              total: report.projectIssueCount,
              noun: 'issues',
            })}
          />
          <SummaryTiles tiles={toSlaTiles(report)} />
          <ReportBarChart
            data={toSlaChartData(report)}
            title="How close to the target"
            subtitle="Issues by the share of the working-time target they have used. The 80-100% band is the one to act on."
          />
          <SimpleReportTable model={toSlaTable(report)} />
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
