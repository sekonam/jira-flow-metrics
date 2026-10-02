import React, { useCallback, useEffect, useRef, useState } from 'react';
import ForgeReconciler, { Box, Button, ButtonGroup, Inline, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';
import { isRetryableError } from '@jfm/forge-runtime';
import type { FilterOptions, ReportEnvelope } from '@jfm/forge-runtime';
import {
  CsvExport,
  EMPTY_FILTERS,
  EmptySurface,
  ErrorSurface,
  ExtendHistoryControl,
  IndexingBanner,
  LoadingSurface,
  PageHeader,
  ReportBarChart,
  hasActiveFilters,
  ReportFilters,
  ReportTable,
  SummaryTiles,
  filtersToRequest,
  surfaceStateOf,
  useIndexingRefresh,
  toReportCapBanner,
  toProgressBanner,
  toReportTable,
  toStatusChartData,
  toSummaryTiles,
  type ReportFilterState,
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
  const requestId = useRef(0);
  const [basis, setBasis] = useState<'elapsed' | 'business'>('elapsed');
  const [filters, setFilters] = useState<ReportFilterState>(EMPTY_FILTERS);
  // The pickers' options. Fetched once on mount; each list degrades to
  // empty on failure (see `listFilterOptions`), so a lost lookup renders a
  // disabled picker rather than replacing a working report with an error.
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    assignees: [],
    issueTypes: [],
  });

  const load = useCallback(
    async (nextBasis: 'elapsed' | 'business', nextFilters: ReportFilterState, quiet = false) => {
      // ★ Only the newest request may write to the screen.
      //
      // Every control on this page re-runs `load`, each `invoke` is a separate
      // Forge lambda, and answers arrive in whatever order they finish — so
      // without this the *older* reply can land last and win. The gadgets
      // guarded against it with a `cancelled` flag from the start; the pages
      // never did.
      //
      // What that looked like: click a status chip, the narrowed report
      // renders, the original answer then arrives and overwrites it — leaving
      // chips that say one goal above numbers computed from another, with
      // nothing loading and no way to tell. On the time-in-status page it also
      // stranded the reader: the basis had already been set, so pressing the
      // same button again changed no state, re-ran no effect, and the caption
      // kept contradicting the control until they toggled twice.
      const mine = requestId.current + 1;
      requestId.current = mine;
      // ★ A background refresh must not blank the screen it is refreshing.
      //
      // `useIndexingRefresh` re-reads this page every few seconds while the
      // index is building. Flipping `loading` on each poll makes
      // `surfaceStateOf` return 'loading', which hides the banner and the
      // report — so the very banner the polling exists to keep alive blinked
      // out and back roughly twenty times, and on a project with nothing
      // indexed yet it was the Start indexing button that flickered.
      if (!quiet) setLoading(true);
      setError(null);
      try {
        const result = (await invoke('getReport', {
          basis: nextBasis,
          ...filtersToRequest(nextFilters),
        })) as Result<ReportEnvelope>;
        if (mine !== requestId.current) return;
        if (result.ok) setEnvelope(result.data);
        else setError(result.error);
      } catch {
        // Guarded too: a superseded request that fails must not paint an error
        // over the screen a newer, successful one has already drawn.
        if (mine === requestId.current) {
          setError('The report could not be loaded. Try again in a moment.');
        }
      } finally {
        // A superseded request must not clear the spinner the newer one
        // put up, or the page reads as settled while it is still fetching.
        if (mine === requestId.current && !quiet) setLoading(false);
      }
    },
    [],
  );

  // The `exportCsv` resolver has existed since the first commit with no
  // caller; this is the caller. `CsvExport` owns the presentation, so all
  // that belongs here is the bridge call and unwrapping the envelope.
  const requestCsv = useCallback(async () => {
    // The exported file is measured against exactly the report on screen —
    // basis *and* filters. An export that quietly ignored the filters would
    // hand someone a wider file than the table they just read, which is the
    // same lie the SLA listing's goal resolution exists to prevent.
    const result = (await invoke('exportCsv', {
      basis,
      ...filtersToRequest(filters),
    })) as Result<{
      filename: string;
      csv: string;
    }>;
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }, [basis, filters]);

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
      await load(basis, filters);
    },
    [load, basis, filters],
  );

  useEffect(() => {
    void load(basis, filters);
  }, [basis, filters, load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = (await invoke('listFilterOptions', {})) as Result<FilterOptions>;
        if (!cancelled && result.ok) setFilterOptions(result.data);
      } catch {
        // Empty lists stay; the pickers render disabled rather than the
        // page trading its report for an error about a dropdown.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startIndexing = useCallback(async () => {
    await invoke('startIndexing', {});
    void load(basis, filters);
  }, [basis, filters, load]);

  // Keeps the indexing banner alive without a manual reload; see
  // `useIndexingRefresh`.
  useIndexingRefresh(envelope?.progress ?? 'unknown', () => {
    void load(basis, filters, true);
  });

  const state = surfaceStateOf({ loading, error, rowCount: envelope?.report.rows.length ?? 0 });

  return (
    <Stack space="space.200">
      <PageHeader
        subtitle="Cumulative time each issue has spent in every status, counting every re-entry."
        actions={
          // ★ Two groups, not one. `Elapsed`/`Working hours` are a segmented
          // control — one of them is always selected, and the selection
          // changes what every number on the page means. `Export CSV` and
          // `Extend history` are actions that select nothing. Run together in
          // a single `ButtonGroup` they render as one four-button strip, which
          // invites the reader to ask which of the four is currently chosen
          // and makes the basis the page is actually using harder to see.
          <Inline space="space.150" alignBlock="center" shouldWrap>
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
            <ButtonGroup>
              <CsvExport onRequestCsv={requestCsv} />
              <ExtendHistoryControl onLoad={loadHistoryWindow} onExtend={extendHistory} />
            </ButtonGroup>
          </Inline>
        }
      />

      <ReportFilters
        assignees={filterOptions.assignees.map((a) => ({ id: a.accountId, name: a.displayName }))}
        issueTypes={filterOptions.issueTypes.map((t) => ({ id: t.id, name: t.name }))}
        filters={filters}
        onChange={setFilters}
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
          // A refusal about who the reader is cannot be retried into a
          // different answer; only a transient failure gets a button.
          onRetry={
            isRetryableError(error ?? '')
              ? () => {
                  void load(basis, filters);
                }
              : undefined
          }
        />
      ) : null}
      {/*
        ★ Two different empty results, and only one of them is about indexing.
        An e2e flow drove a reader into the other one — assignee "Anna" plus
        issue type "Task", a combination this project has no answer for — and
        a fully indexed project answered "No indexed issues yet" with a
        **Start indexing** button under it. Both halves are wrong: the
        statement is false, and the action re-walks the whole project from
        Jira to fix a problem a click on *Clear filters* fixes. It is the same
        confusion `gadgetEmptyMessage` was written for ("nothing to show" and
        "nobody has indexed this" are different answers), one surface over.

        This page is the only one of the five that can reach an empty report
        by filtering, which is why the distinction lives here rather than in
        `EmptySurface`.
      */}
      {state === 'empty' ? (
        hasActiveFilters(filters) ? (
          <EmptySurface
            title="No issues match these filters"
            body="This project is indexed — nothing in it matches the assignee, issue type or creation window you picked. Widen the window or clear the filters."
            actionLabel="Clear filters"
            onAction={() => {
              setFilters(EMPTY_FILTERS);
            }}
          />
        ) : (
          <EmptySurface
            title="No indexed issues yet"
            body="Once indexing finishes, every issue in this project appears here with its cumulative time per status."
            actionLabel="Start indexing"
            onAction={() => {
              void startIndexing();
            }}
          />
        )
      ) : null}
      {state === 'ready' && envelope !== null ? (
        <Stack space="space.200">
          <IndexingBanner
            banner={toReportCapBanner({
              // Two ceilings, and this page had a banner for only one of
              // them: `capped` says there are more issues than these, while
              // `aggregatesCapped` says the issues *shown* may be
              // understated — an issue whose aggregate rows were cut renders
              // 0h in every column. The second is the wrong number rather
              // than the missing one.
              capped: envelope.report.capped || envelope.report.aggregatesCapped,
              aggregatesCapped: envelope.report.aggregatesCapped,
              included: envelope.report.issueCount,
              total: envelope.report.matchingIssueCount,
              noun: 'issues',
            })}
          />
          <SummaryTiles tiles={toSummaryTiles(envelope.report)} />
          <Box>
            <Text size="small" color="color.text.subtlest">
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
