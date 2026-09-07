import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Heading, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';
import type { ReportEnvelope } from '@jfm/forge-runtime';
import {
  ErrorSurface,
  LoadingSurface,
  SummaryTiles,
  surfaceStateOf,
  toSummaryTiles,
} from '@jfm/ui';

/**
 * Dashboard gadget: the summary tiles only.
 *
 * A gadget lives in a small tile on a shared dashboard, so it shows the median
 * per status and nothing else. The full table stays on the project page. This
 * matters commercially as well as visually — a dashboard is where a report
 * gets seen by people who did not install the app, which is the only organic
 * distribution a Marketplace app gets inside a customer.
 *
 * ⚠️ Rendered in tests only against the harness's stand-in host renderer, never
 * on Forge; see `docs/RUNBOOK.md`.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export const Gadget = (): React.JSX.Element => {
  const [envelope, setEnvelope] = useState<ReportEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = (await invoke('getReport', { limit: 200 })) as Result<ReportEnvelope>;
        if (cancelled) return;
        if (result.ok) setEnvelope(result.data);
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

  const state = surfaceStateOf({ loading, error, rowCount: envelope?.report.rows.length ?? 0 });

  if (state === 'loading') return <LoadingSurface label="Loading" />;
  if (state === 'error') return <ErrorSurface message={error ?? 'Unknown error'} />;
  if (state === 'empty' || envelope === null) {
    return <Text>No indexed issues in this project yet.</Text>;
  }

  return (
    <Stack space="space.150">
      <Heading as="h3">Time in status</Heading>
      <SummaryTiles tiles={toSummaryTiles(envelope.report).slice(0, 4)} />
      {envelope.partial ? <Text size="small">Indexing is still in progress.</Text> : null}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <Gadget />
  </React.StrictMode>,
);
