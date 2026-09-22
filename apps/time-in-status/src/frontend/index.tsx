import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, { Box, Button, ButtonGroup, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';
import type { ReportEnvelope } from '@jfm/forge-runtime';
import {
  CsvExport,
  EmptySurface,
  ErrorSurface,
  ExtendHistoryControl,
  IndexingBanner,
  LoadingSurface,
  PageHeader,
  ReportBarChart,
  ReportTable,
  SummaryTiles,
  surfaceStateOf,
  toCapBanner,
  toProgressBanner,
  toReportTable,
  toStatusChartData,
  toSummaryTiles,
} from '@jfm/ui';

/**
 * Project page for the Time in Status listing.
 *
 * The whole page is four states — loading, error, empty, ready — chosen by
 * `surfaceStateOf`, which is unit-tested. Nothing here decides anything except
 * which shared component to render.
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
  const [envelope, setEnvelope] = useState<ReportEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [basis, setBasis] = useState<'elapsed' | 'business'>('elapsed');

  const load = useCallback(async (nextBasis: 'elapsed' | 'business') => {
    setLoading(true);
    setError(null);
    try {
      const result = (await invoke('getReport', { basis: nextBasis })) as Result<ReportEnvelope>;
      if (result.ok) setEnvelope(result.data);
      else setError(result.error);
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
    const result = (await invoke('exportCsv', { basis })) as Result<{
      filename: string;
      csv: string;
    }>;
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }, [basis]);

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
      await load(basis);
    },
    [load, basis],
  );

  useEffect(() => {
    void load(basis);
  }, [basis, load]);

  const startIndexing = useCallback(async () => {
    await invoke('startIndexing', {});
    void load(basis);
  }, [basis, load]);

  const state = surfaceStateOf({ loading, error, rowCount: envelope?.report.rows.length ?? 0 });

  return (
    <Stack space="space.200">
      <PageHeader
        title="Time in Status"
        subtitle="Cumulative time each issue has spent in every status, counting every re-entry."
        actions={
          <ButtonGroup>
            <Button
              isSelected={basis === 'elapsed'}
              onClick={() => {
                setBasis('elapsed');
              }}
            >
              Elapsed
            </Button>
            <Button
              isSelected={basis === 'business'}
              onClick={() => {
                setBasis('business');
              }}
            >
              Working hours
            </Button>
            <CsvExport onRequestCsv={requestCsv} />
            <ExtendHistoryControl onLoad={loadHistoryWindow} onExtend={extendHistory} />
          </ButtonGroup>
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
          banner={toProgressBanner(envelope?.progress ?? null)}
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
            void load(basis);
          }}
        />
      ) : null}
      {state === 'empty' ? (
        <EmptySurface
          title="No indexed issues yet"
          body="Once indexing finishes, every issue in this project appears here with its cumulative time per status."
          actionLabel="Start indexing"
          onAction={() => {
            void startIndexing();
          }}
        />
      ) : null}
      {state === 'ready' && envelope !== null ? (
        <Stack space="space.200">
          <IndexingBanner
            banner={toCapBanner({
              capped: envelope.report.capped,
              included: envelope.report.issueCount,
              total: envelope.report.matchingIssueCount,
              noun: 'issues',
            })}
          />
          <SummaryTiles tiles={toSummaryTiles(envelope.report)} />
          <Box>
            <Text size="small">
              Showing {envelope.report.basis === 'business' ? 'working hours' : 'elapsed time'}.
            </Text>
          </Box>
          <ReportBarChart
            data={toStatusChartData(envelope.report)}
            title="Median time in status"
            subtitle={`Hours per status, median across the issues below (${
              envelope.report.basis === 'business' ? 'working hours' : 'elapsed time'
            }).`}
          />
          <ReportTable model={toReportTable(envelope.report)} />
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
