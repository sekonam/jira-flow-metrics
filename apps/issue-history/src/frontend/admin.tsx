import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, { Stack } from '@forge/react';
import { invoke } from '@forge/bridge';
import { isRetryableError } from '@jfm/forge-runtime';
import {
  ErrorSurface,
  LoadingSurface,
  PageHeader,
  SimpleReportTable,
  SummaryTiles,
  surfaceStateOf,
  toStorageTable,
  toStorageTiles,
  type StorageEstimate,
} from '@jfm/ui';

/**
 * Admin page: what this installation is holding.
 *
 * One per listing, not one shared page: **each app has its own Forge SQL
 * database**. Forge provisions storage per installation of an app, so
 * "how much is this holding" has a different answer for every listing an
 * admin has installed, and a single page could only ever answer it for one
 * of them. Confirmed live on 2026-09-22 — the Time in Status admin page
 * reported 191 issue_meta rows and zero visits while WIP Aging, which
 * ingests the visit dataset, held its own quite different counts.
 *
 * `TECHNICAL-SPEC.md` § 11 item 10 recorded `storageEstimate()` as an
 * internal method no app exposed, because it "reports instance-wide row
 * counts and has no project scope, so no app registers it as a resolver…
 * until there is an admin surface that can authorise it properly". This is
 * that surface: `jira:adminPage` is reachable only by Jira administrators,
 * which the platform enforces, and instance-wide is the only shape these
 * figures have — Forge SQL is provisioned per installation, not per project.
 *
 * Everything on this page is a fact about the app's own footprint. Nothing
 * issue-shaped appears here, because an admin page is visible to people who
 * may have no permission on the projects the rows came from.
 *
 * It exists for one customer question — "what is this app storing, and will
 * it cost me?" — which `docs/TECHNICAL-SPEC.md` answers with a model and
 * which this answers with the installation's own numbers.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export const Admin = (): React.JSX.Element => {
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await invoke('getStorageEstimate', {})) as Result<StorageEstimate>;
      if (result.ok) setEstimate(result.data);
      else setError(result.error);
    } catch {
      setError('The storage estimate could not be loaded. Try again in a moment.');
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
    // A fresh install holds no rows, and that is a real answer rather than
    // an empty state: the tiles read "0 B" and the table lists every table
    // at zero, which is what an admin checking before a rollout wants.
    rowCount: estimate === null ? 0 : 1,
  });

  return (
    <Stack space="space.200">
      <PageHeader
        title="Issue History — storage"
        subtitle="What this app is holding in Forge SQL, across every project it has indexed."
      />
      {state === 'loading' ? <LoadingSurface label="Reading storage" /> : null}
      {state === 'error' ? (
        <ErrorSurface
          message={error ?? 'Unknown error'}
          // A refusal about who the reader is cannot be retried into a
          // different answer; only a transient failure gets a button.
          onRetry={
            isRetryableError(error ?? '')
              ? () => {
                  void load();
                }
              : undefined
          }
        />
      ) : null}
      {estimate !== null && state === 'ready' ? (
        <Stack space="space.200">
          <SummaryTiles tiles={toStorageTiles(estimate)} />
          <SimpleReportTable heading="Tables" model={toStorageTable(estimate)} />
        </Stack>
      ) : null}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <Admin />
  </React.StrictMode>,
);
