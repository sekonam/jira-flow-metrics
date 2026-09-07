import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, { Stack } from '@forge/react';
import { invoke } from '@forge/bridge';
import type { AgingReport } from '@jfm/forge-runtime';
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
  toAgingTable,
  toAgingTiles,
} from '@jfm/ui';
import type { ReportEnvelope } from '@jfm/forge-runtime';

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
  const [progress, setProgress] = useState<ReportEnvelope['progress']>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await invoke('getAgingReport', {})) as Result<AgingReport>;
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

  const rowCount = report === null ? 0 : report.rows.length;
  const state = surfaceStateOf({ loading, error, rowCount });

  return (
    <Stack space="space.200">
      <PageHeader
        title="WIP Aging"
        subtitle="How long each unfinished issue has been sitting where it is."
      />

      {/*
        Rendered only once a response has arrived. `toProgressBanner(null)`
        means "not indexed yet", and showing that while the first request is
        still in flight told every user of a fully-indexed project that their
        project had never been indexed — underneath a loading spinner.
      */}
      {state === 'loading' ? null : (
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
          <SummaryTiles tiles={toAgingTiles(report)} />
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
