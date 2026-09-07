import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Heading, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';
import type { SlaReport, ReportEnvelope } from '@jfm/forge-runtime';
import { ErrorSurface, LoadingSurface, SummaryTiles, surfaceStateOf, toSlaTiles } from '@jfm/ui';

/**
 * Dashboard gadget for the SLA & Due Dates listing: the summary tiles only.
 *
 * A dashboard is where a report gets seen by people who did not install the
 * app, which is the only organic distribution a Marketplace app has inside a
 * customer. That is why every listing ships one.
 *
 * ⚠️ Rendered in tests only against the harness's stand-in host renderer, never
 * on Forge; see `docs/RUNBOOK.md`.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export const Gadget = (): React.JSX.Element => {
  const [report, setReport] = useState<SlaReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [partial, setPartial] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = (await invoke('getSlaReport', {})) as Result<SlaReport>;
        if (cancelled) return;
        if (result.ok) setReport(result.data);
        else setError(result.error);

        // A dashboard gadget is often the only surface someone ever sees, so
        // it must not present numbers built from half an instance without
        // saying so — `ReportEnvelope.partial` exists precisely for this. The
        // index state lives on the status-report envelope, which is why this
        // second call is here; the project pages already do the same.
        const envelope = (await invoke('getReport', { limit: 1 })) as Result<ReportEnvelope>;
        if (!cancelled && envelope.ok) setPartial(envelope.data.partial);
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

  const rowCount = report === null ? 0 : report.rows.length;
  const state = surfaceStateOf({ loading, error, rowCount });

  if (state === 'loading') return <LoadingSurface label="Loading" />;
  if (state === 'error') return <ErrorSurface message={error ?? 'Unknown error'} />;
  if (report === null || state === 'empty')
    return <Text>Nothing to show for this project yet.</Text>;

  return (
    <Stack space="space.150">
      <Heading as="h3">SLA & Due Dates</Heading>
      <SummaryTiles tiles={toSlaTiles(report)} />
      {partial ? <Text size="small">Indexing is still in progress.</Text> : null}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <Gadget />
  </React.StrictMode>,
);
