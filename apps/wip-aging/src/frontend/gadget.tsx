import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Heading, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';
import type { AgingReport } from '@jfm/forge-runtime';
import type { BackfillProgress } from '@jfm/engine';
import {
  ErrorSurface,
  LoadingSurface,
  SummaryTiles,
  isIndexIncomplete,
  surfaceStateOf,
  toAgingTiles,
} from '@jfm/ui';

/**
 * Dashboard gadget for the WIP Aging listing: the summary tiles only.
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
  const [report, setReport] = useState<AgingReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [partial, setPartial] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = (await invoke('getAgingReport', {})) as Result<AgingReport>;
        if (cancelled) return;
        if (result.ok) setReport(result.data);
        else setError(result.error);

        // A dashboard gadget is often the only surface someone ever sees, so
        // it must not present numbers built from half an instance without
        // saying so.
        //
        // Its own try/catch on purpose: the report above has already loaded,
        // and losing the index state is not a reason to replace a working
        // gadget with an error. The banner just goes quiet.
        try {
          const state = (await invoke('getIndexProgress', {})) as Result<BackfillProgress | null>;
          if (!cancelled && state.ok) setPartial(isIndexIncomplete(state.data));
        } catch {
          // Leave `partial` false: saying nothing is better than saying
          // something wrong about the index.
        }
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
      <Heading as="h3">WIP Aging</Heading>
      <SummaryTiles tiles={toAgingTiles(report)} />
      {partial ? <Text size="small">Indexing is still in progress.</Text> : null}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <Gadget />
  </React.StrictMode>,
);
