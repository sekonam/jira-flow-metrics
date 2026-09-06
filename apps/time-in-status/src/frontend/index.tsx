import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, { Box, Button, ButtonGroup, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';
import type { ReportEnvelope } from '@jfm/forge-runtime';
import {
  EmptySurface,
  ErrorSurface,
  IndexingBanner,
  LoadingSurface,
  PageHeader,
  ReportTable,
  SummaryTiles,
  surfaceStateOf,
  toProgressBanner,
  toReportTable,
  toSummaryTiles,
} from '@jfm/ui';

/**
 * Project page for the Time in Status listing.
 *
 * The whole page is four states — loading, error, empty, ready — chosen by
 * `surfaceStateOf`, which is unit-tested. Nothing here decides anything except
 * which shared component to render.
 *
 * ⚠️ Never rendered. UI Kit runs only inside Forge; the first `forge tunnel`
 * session is this file's acceptance test (`docs/RUNBOOK.md`).
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const App = (): React.JSX.Element => {
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
          </ButtonGroup>
        }
      />

      <IndexingBanner
        banner={toProgressBanner(envelope?.progress ?? null)}
        onStart={
          envelope?.progress === null
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
          <SummaryTiles tiles={toSummaryTiles(envelope.report)} />
          <Box>
            <Text size="small">
              Showing {envelope.report.basis === 'business' ? 'working hours' : 'elapsed time'}.
            </Text>
          </Box>
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
