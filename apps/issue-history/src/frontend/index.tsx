import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, { Stack } from '@forge/react';
import { invoke } from '@forge/bridge';
import type { HistoryReport } from '@jfm/forge-runtime';
import type { BackfillProgress } from '@jfm/engine';
import {
  CsvExport,
  EmptySurface,
  ErrorSurface,
  IndexingBanner,
  LoadingSurface,
  PageHeader,
  SimpleReportTable,
  SummaryTiles,
  surfaceStateOf,
  toCapBanner,
  toProgressBanner,
  toHistoryTable,
  toHistoryTiles,
} from '@jfm/ui';

/**
 * Project page for the Issue History listing.
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
  const [report, setReport] = useState<HistoryReport | null>(null);
  const [progress, setProgress] = useState<BackfillProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await invoke('getHistoryReport', {})) as Result<HistoryReport>;
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

  useEffect(() => {
    void load();
  }, [load]);

  const startIndexing = useCallback(async () => {
    await invoke('startIndexing', {});
    void load();
  }, [load]);

  const rowCount = report === null ? 0 : report.records.length;
  const state = surfaceStateOf({ loading, error, rowCount });

  return (
    <Stack space="space.200">
      <PageHeader
        title="Issue History"
        subtitle="Every field change across the whole project in one exportable table."
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
          title="No changes indexed yet"
          body="Once indexing finishes, every field change in this project is listed here."
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
              included: report.total,
              total: report.totalMatching,
              noun: 'changes',
            })}
          />
          <SummaryTiles tiles={toHistoryTiles(report)} />
          <SimpleReportTable model={toHistoryTable(report)} />
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
