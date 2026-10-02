import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, { Heading, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';
import { isRetryableError } from '@jfm/forge-runtime';
import type { IssueTimelineReport } from '@jfm/forge-runtime';
import {
  ErrorSurface,
  LoadingSurface,
  SimpleReportTable,
  SummaryTiles,
  surfaceStateOf,
  toTimelineTable,
  toTimelineTiles,
  toTimelineTotals,
} from '@jfm/ui';

/**
 * Issue panel: this one issue's status timeline.
 *
 * ROADMAP stage 5 calls this "a genuinely different surface", and it is
 * different in the way that matters commercially: it sits directly beneath
 * Jira's own History tab, on the screen where a user is already asking "why
 * has this taken so long?". The product's whole argument — that a status can
 * be entered more than once and Jira's Control Chart only reports the last
 * stay — is checkable here against the History tab immediately above it,
 * which is the strongest form the argument can take.
 *
 * Unlike every other surface, it reads Jira rather than the store: one
 * changelog fetch, correct the instant a transition happens rather than
 * whenever the event queue drains, and identical on all five listings
 * regardless of which datasets each ingests. See `buildIssueTimeline`.
 *
 * ⚠️ Rendered in CI through the stand-in host renderer, never by Forge.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export const Panel = (): React.JSX.Element => {
  const [report, setReport] = useState<IssueTimelineReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await invoke('getIssueTimeline', {})) as Result<IssueTimelineReport>;
      if (result.ok) setReport(result.data);
      else setError(result.error);
    } catch {
      setError('This issue’s timeline could not be loaded. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const state = surfaceStateOf({
    loading,
    error,
    rowCount: report === null ? 0 : report.visits.length,
  });

  return (
    <Stack space="space.200">
      {state === 'loading' ? <LoadingSurface label="Loading timeline" /> : null}
      {state === 'error' ? (
        <ErrorSurface
          message={error ?? 'Unknown error'}
          // A refusal about who the reader is, or about what this surface is
          // open on, cannot be retried into a different answer.
          onRetry={
            isRetryableError(error ?? '')
              ? () => {
                  void load();
                }
              : undefined
          }
        />
      ) : null}
      {/*
        An issue with no recorded transitions is not an error and not an
        empty report: it was created and has not moved. Saying that is more
        useful than an empty table, and it is a state a brand-new issue is in
        the moment somebody opens this panel on it.
      */}
      {state === 'empty' ? <Text>This issue has not changed status yet.</Text> : null}
      {state === 'ready' && report !== null ? (
        <Stack space="space.200">
          <SummaryTiles tiles={toTimelineTiles(report)} />
          <Heading as="h3">Every visit, in order</Heading>
          <SimpleReportTable model={toTimelineTable(report)} />
          <Heading as="h3">Totals per status</Heading>
          <SimpleReportTable model={toTimelineTotals(report)} />
        </Stack>
      ) : null}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <Panel />
  </React.StrictMode>,
);
