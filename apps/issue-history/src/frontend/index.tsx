import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, { Stack } from '@forge/react';
import { invoke } from '@forge/bridge';
import type { HistoryReport } from '@jfm/forge-runtime';
import {
  EmptySurface,
  ErrorSurface,
  IndexingBanner,
  LoadingSurface,
  PageHeader,
  SimpleReportTable,
  SummaryTiles,
  surfaceStateOf,
  toProgressBanner,
  toHistoryTable,
  toHistoryTiles,
} from '@jfm/ui';
import type { ReportEnvelope } from '@jfm/forge-runtime';

/**
 * Project page for the Issue History listing.
 *
 * Structurally identical to the other four: fetch, pick one of four designed
 * states, render a shared component. The listing-specific part is one view
 * model, which lives in `@jfm/ui` and is unit-tested.
 *
 * ⚠️ Never rendered. UI Kit runs only inside Forge; the first `forge tunnel`
 * session is this file's acceptance test (`docs/RUNBOOK.md`).
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const App = (): React.JSX.Element => {
  const [report, setReport] = useState<HistoryReport | null>(null);
  const [progress, setProgress] = useState<ReportEnvelope['progress']>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await invoke('getHistoryReport', {})) as Result<HistoryReport>;
      if (result.ok) setReport(result.data);
      else setError(result.error);
      // The indexing banner is shared across all five listings, so the state
      // comes from the same envelope the status report uses.
      const envelope = (await invoke('getReport', { limit: 1 })) as Result<ReportEnvelope>;
      if (envelope.ok) setProgress(envelope.data.progress);
    } catch {
      setError('The report could not be loaded. Try again in a moment.');
    } finally {
      setLoading(false);
    }
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
        subtitle="Cross-issue, filterable, exportable field-change history."
      />

      <IndexingBanner
        banner={toProgressBanner(progress)}
        onStart={
          progress === null
            ? () => {
                void startIndexing();
              }
            : undefined
        }
      />

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
