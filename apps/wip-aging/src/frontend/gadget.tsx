import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Heading, Stack, Text } from '@forge/react';
import { invoke, view } from '@forge/bridge';
import { NOT_IN_PROJECT, type AgingReport } from '@jfm/forge-runtime';
import type { BackfillProgress, JiraProjectRef } from '@jfm/engine';
import {
  ErrorSurface,
  GadgetConfigForm,
  LoadingSurface,
  SummaryTiles,
  isIndexIncomplete,
  surfaceStateOf,
  toAgingTiles,
  toProjectOptions,
  type ProjectOption,
} from '@jfm/ui';

/**
 * Dashboard gadget for the WIP Aging listing: the summary tiles only.
 *
 * A dashboard is where a report gets seen by people who did not install the
 * app, which is the only organic distribution a Marketplace app has inside a
 * customer. That is why every listing ships one.
 *
 * ✔ **Confirmed live** (on `time-in-status`) on 2026-09-11: a
 * `jira:dashboardGadget` context carries no project of its own, unlike
 * `jira:projectPage`. Adding that gadget to a real dashboard rendered "This
 * report can only be opened from inside a Jira project" every time, with no
 * configuration option anywhere on screen — `edit` was not declared in the
 * manifest. This file carries the same fix, applied identically rather than
 * independently re-verified — see TECHNICAL-SPEC.md § 11 item 7 for what is
 * and is not confirmed for this specific app.
 *
 * ⚠️ Rendered in tests only against the harness's stand-in host renderer, never
 * on Forge; see `docs/RUNBOOK.md`.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Edit mode: choose which project this gadget reports on. */
const GadgetEdit = (): React.JSX.Element => {
  const [options, setOptions] = useState<ProjectOption[] | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = (await invoke('listProjects', {})) as Result<readonly JiraProjectRef[]>;
        if (cancelled) return;
        if (result.ok) setOptions(toProjectOptions(result.data));
        else setError(result.error);
      } catch {
        if (!cancelled) setError('Could not load your projects.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <GadgetConfigForm
      options={options}
      error={error}
      saving={saving}
      onSave={(projectId) => {
        setSaving(true);
        void view.submit({ projectId });
      }}
    />
  );
};

/** View mode: the report itself, for whichever project was configured. */
const GadgetView = (): React.JSX.Element => {
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
  if (state === 'error') {
    // NOT_IN_PROJECT here means "configured with a project this gadget could
    // not read" rather than the page-context failure the message describes —
    // by the time this runs, the gadget has always been configured (edit
    // mode is the only other state), so a friendlier, actionable message
    // beats repeating the generic one.
    const message =
      error === NOT_IN_PROJECT
        ? 'This gadget could not read its configured project. Edit the gadget and choose it again.'
        : (error ?? 'Unknown error');
    return <ErrorSurface message={message} />;
  }
  if (report === null || state === 'empty')
    return <Text>Nothing to show for this project yet.</Text>;

  return (
    <Stack space="space.150">
      <Heading as="h3">WIP Aging</Heading>
      <SummaryTiles tiles={toAgingTiles(report)} />
      {/*
        A capped report must say so here too. Each of these files says a
        gadget is "often the only surface someone who did not install the app
        ever sees" — and only the indexing half of that was implemented, so a
        dashboard could publish an attainment percentage over a 500-issue
        slice of a 5,000-issue project with no qualifier at all.
      */}
      {report.capped ? (
        <Text size="small">
          Covering {report.rows.length + report.excludedDone} of {report.projectIssueCount} issues,
          so every figure here is a lower bound.
        </Text>
      ) : null}
      {partial ? <Text size="small">Indexing is still in progress.</Text> : null}
    </Stack>
  );
};

export const Gadget = (): React.JSX.Element => {
  const [entryPoint, setEntryPoint] = useState<'edit' | 'view' | null>(null);

  useEffect(() => {
    let cancelled = false;
    void view.getContext().then((context) => {
      if (cancelled) return;
      const extension = context.extension as { entryPoint?: string } | undefined;
      setEntryPoint(extension?.entryPoint === 'edit' ? 'edit' : 'view');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (entryPoint === null) return <LoadingSurface label="Loading" />;
  return entryPoint === 'edit' ? <GadgetEdit /> : <GadgetView />;
};

ForgeReconciler.render(
  <React.StrictMode>
    <Gadget />
  </React.StrictMode>,
);
