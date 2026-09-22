import React, { useCallback, useEffect, useRef, useState } from 'react';
import ForgeReconciler, { Inline, Stack } from '@forge/react';
import { invoke } from '@forge/bridge';
import type { SlaReport } from '@jfm/forge-runtime';
import type { BackfillProgress, StatusMetaRow } from '@jfm/engine';
import {
  CsvExport,
  DEFAULT_SLA_GOAL,
  EmptySurface,
  ErrorSurface,
  ExtendHistoryControl,
  IndexingBanner,
  LoadingSurface,
  PageHeader,
  ReportBarChart,
  SimpleReportTable,
  SlaGoalForm,
  SummaryTiles,
  surfaceStateOf,
  toReportCapBanner,
  toProgressBanner,
  type MaybeProgress,
  toSlaChartData,
  toGoalChoice,
  toGoalPayload,
  toSlaTable,
  toSlaTiles,
  type SavedSlaGoal,
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
  const [progress, setProgress] = useState<MaybeProgress>('unknown');
  const [statuses, setStatuses] = useState<readonly StatusMetaRow[]>([]);
  const [savedGoals, setSavedGoals] = useState<readonly SavedSlaGoal[]>([]);
  const [goal, setGoal] = useState<SlaGoalChoice>(DEFAULT_SLA_GOAL);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  const load = useCallback(async (nextGoal: SlaGoalChoice) => {
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
      // A saved goal travels as its id alone, so the resolver measures
      // against the stored definition rather than against anything this
      // client could have altered on the way. `toGoalPayload` owns that
      // choice and the export below uses the same function.
      const result = (await invoke('getSlaReport', toGoalPayload(nextGoal))) as Result<SlaReport>;
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

  // The picker's options change only when indexing does, so one fetch per
  // page open is enough. A failure here degrades to a target-only picker
  // rather than an error page: the report itself is unaffected.
  useEffect(() => {
    void (async () => {
      // Two independent `try`s on purpose. Chained, a failing `listStatuses`
      // swallowed the error and `listSlaGoals` never ran, so a transient
      // failure loading the status chips silently took the saved-goal picker
      // with it — two unrelated features lost to one blip.
      try {
        const result = (await invoke('listStatuses', {})) as Result<readonly StatusMetaRow[]>;
        if (result.ok) setStatuses(result.data);
      } catch {
        // Leave the chip row empty; the default goal still renders a report.
      }
      try {
        const goals = (await invoke('listSlaGoals', {})) as Result<readonly SavedSlaGoal[]>;
        if (goals.ok) setSavedGoals(goals.data);
      } catch {
        // Leave the picker empty; an ad-hoc goal still renders a report.
      }
    })();
  }, []);

  // The `exportCsv` resolver has existed since the first commit with no
  // caller; this is the caller. `CsvExport` owns the presentation, so all
  // that belongs here is the bridge call and unwrapping the envelope. The
  // goal travels with it so the exported rows are measured against exactly
  // the goal on screen.
  const requestCsv = useCallback(async () => {
    const result = (await invoke('exportCsv', toGoalPayload(goal))) as Result<{
      filename: string;
      csv: string;
    }>;
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }, [goal]);

  /**
   * Saving a goal returns the whole list, so the picker re-renders from the
   * server's answer rather than from an optimistic guess about what the
   * server did with the name it was sent.
   */
  const saveGoal = useCallback(
    async (name: string) => {
      const result = (await invoke('saveSlaGoal', {
        name,
        countedStatusIds: [...goal.countedStatusIds],
        targetMs: goal.targetMs,
        // Present only when the page is still attached to a saved goal, so
        // saving under the same name *edits* that goal instead of minting a
        // second one with the same name.
        ...(goal.savedGoalId === undefined ? {} : { id: goal.savedGoalId }),
      })) as Result<{ goals: readonly SavedSlaGoal[]; savedId: string }>;
      if (!result.ok) throw new Error(result.error);
      setSavedGoals(result.data.goals);
      // Attach the page to the goal the *server* says it saved, by id. A
      // name lookup would pick the wrong one whenever two share a name.
      const saved = result.data.goals.find((candidate) => candidate.id === result.data.savedId);
      if (saved !== undefined) setGoal(toGoalChoice(saved));
    },
    [goal],
  );

  const deleteGoal = useCallback(async (id: string) => {
    const result = (await invoke('deleteSlaGoal', { id })) as Result<readonly SavedSlaGoal[]>;
    if (!result.ok) throw new Error(result.error);
    setSavedGoals(result.data);
    // The page was measuring against the goal that just went away. Fall back
    // to the default rather than leaving a `goalId` the resolver will refuse.
    setGoal(DEFAULT_SLA_GOAL);
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
      await load(goal);
    },
    [load, goal],
  );

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

      {/*
        The goal picker stays on screen in every non-error state: it is what
        the empty/ready states are relative to, and hiding it while loading
        would bounce the layout on every goal change.
      */}
      {state === 'error' ? null : (
        <SlaGoalForm
          statuses={statuses.map((s) => ({ id: s.statusId, name: s.name }))}
          goal={goal}
          savedGoals={savedGoals}
          onChange={setGoal}
          onSave={saveGoal}
          onDelete={deleteGoal}
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
            banner={toReportCapBanner({
              capped: report.capped,
              aggregatesCapped: report.aggregatesCapped,
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
