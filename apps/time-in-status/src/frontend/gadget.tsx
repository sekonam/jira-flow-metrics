import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Heading, Stack, Text } from '@forge/react';
import { invoke, view } from '@forge/bridge';
import type { JiraProjectRef } from '@jfm/engine';
import { NOT_IN_PROJECT, type ReportEnvelope } from '@jfm/forge-runtime';
import {
  ErrorSurface,
  GadgetConfigForm,
  LoadingSurface,
  SummaryTiles,
  isIndexIncomplete,
  gadgetEmptyMessage,
  surfaceStateOf,
  toCapNotice,
  toProjectOptions,
  toSummaryTiles,
  type ProjectOption,
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
 * ✔ **Confirmed live** on 2026-09-11: a `jira:dashboardGadget` context carries
 * no project of its own, unlike `jira:projectPage`. Adding this gadget to a
 * real dashboard rendered "This report can only be opened from inside a Jira
 * project" every time, with no configuration option anywhere on screen —
 * `edit` was not declared in the manifest, so Jira offered no way to fix it.
 * The two things below exist because of that: `edit-mode` config screen, and
 * `NOT_IN_PROJECT` read from `context.extension.gadgetConfiguration.projectId`
 * server-side (see `projectIdFromContext` in `packages/forge-runtime`).
 *
 * ⚠️ The edit screen itself is unverified beyond one manual pass: Forge's own
 * docs do not show the full config data flow (what `view.submit` accepts, how
 * `gadgetConfiguration` reaches the resolver), so treat this file's two
 * components as the acceptance test for that contract, not as proven.
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
  // ★ Which empty this is. See `gadgetEmptyMessage`.
  //
  // The index state comes off the envelope this gadget already has, not from
  // a second resolver: `getReport` returns it, and unlike its four siblings
  // this listing defines no `getIndexProgress` — `resolver-wiring.test.ts`
  // catches a frontend invoking a key its own resolver never registers,
  // which is exactly what the first attempt at this did.
  if (state === 'empty' || envelope === null) {
    return <Text>{gadgetEmptyMessage(envelope?.progress ?? null)}</Text>;
  }

  // Two independent ceilings, two different sentences — see `toCapNotice`.
  const capNotice = toCapNotice({
    capped: envelope.report.capped || envelope.report.aggregatesCapped,
    aggregatesCapped: envelope.report.aggregatesCapped,
    included: envelope.report.issueCount,
    total: envelope.report.matchingIssueCount,
    noun: 'issues',
  });

  return (
    <Stack space="space.150">
      <Heading as="h3">Time in Status</Heading>
      <SummaryTiles tiles={toSummaryTiles(envelope.report).slice(0, 4)} />
      {/*
        A capped report must say so here too. Each of these files says a
        gadget is "often the only surface someone who did not install the app
        ever sees" — and only the indexing half of that was implemented, so a
        dashboard could publish an attainment percentage over a 500-issue
        slice of a 5,000-issue project with no qualifier at all.
      */}
      {capNotice !== null ? <Text size="small">{capNotice}</Text> : null}
      {/*
        Read from `progress`, not from `envelope.partial`. `partial` also folds
        in per-row changelog truncation across the *returned page*, so what it
        answers depends on the page size it was asked for. The gadget's claim
        is about indexing, so it asks about indexing.
      */}
      {isIndexIncomplete(envelope.progress) ? (
        <Text size="small">Indexing is still in progress.</Text>
      ) : null}
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
