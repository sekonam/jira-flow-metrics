import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Heading, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';
import type { HistoryReport } from '@jfm/forge-runtime';
import {
  ErrorSurface,
  LoadingSurface,
  SummaryTiles,
  surfaceStateOf,
  toHistoryTiles,
} from '@jfm/ui';

/**
 * Dashboard gadget for the Issue History listing: the summary tiles only.
 *
 * A dashboard is where a report gets seen by people who did not install the
 * app, which is the only organic distribution a Marketplace app has inside a
 * customer. That is why every listing ships one.
 *
 * ⚠️ Never rendered; see `docs/RUNBOOK.md`.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const Gadget = (): React.JSX.Element => {
  const [report, setReport] = useState<HistoryReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = (await invoke('getHistoryReport', {})) as Result<HistoryReport>;
        if (cancelled) return;
        if (result.ok) setReport(result.data);
        else setError(result.error);
      } catch {
        if (!cancelled) setError('Could not load this gadget.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rowCount = report === null ? 0 : report.records.length;
  const state = surfaceStateOf({ loading, error, rowCount });

  if (state === 'loading') return <LoadingSurface label="Loading" />;
  if (state === 'error') return <ErrorSurface message={error ?? 'Unknown error'} />;
  if (report === null || state === 'empty')
    return <Text>Nothing to show for this project yet.</Text>;

  return (
    <Stack space="space.150">
      <Heading as="h3">Issue History</Heading>
      <SummaryTiles tiles={toHistoryTiles(report)} />
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <Gadget />
  </React.StrictMode>,
);
