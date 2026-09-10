import { describe, expect, it } from 'vitest';
import { normaliseCalendar, standardBusinessCalendar } from '@jfm/engine';
import {
  EXPECTED,
  PIPELINE_CONTEXT,
  PIPELINE_PROJECT_ID,
  runPipeline,
} from '../src/testing/pipeline.js';
import { handleBackfillJob, handleStartIndexing } from '../src/handlers.js';

/**
 * End-to-end scenario: recorded Jira payloads in, numbers out.
 *
 * Every other suite tests one layer. This one runs the whole pipeline — search
 * page → changelog paging → timeline reconstruction → working-hours
 * arithmetic → store → report assembly → CSV — and asserts the *specific*
 * durations that come out the other end, computed by hand from the fixture.
 *
 * It is the test that would catch a layer boundary being subtly wrong while
 * every layer is individually right.
 *
 * The scenario itself lives in `src/testing/pipeline.ts` because the UI suites
 * assert that these same numbers reach the rendered DOM. Two copies of the
 * fixture could drift, and a UI test asserting numbers the engine no longer
 * produces would be worse than no UI test at all.
 */

describe('end to end: recorded Jira payloads to reported durations', () => {
  it('drains the backfill queue to completion', async () => {
    const { store, jira } = await runPipeline();
    expect((await store.getIndexState(PIPELINE_PROJECT_ID))?.state).toBe('complete');
    // Three changelog pages at two entries each, plus the search, worklog and
    // status calls. Request count is the number that decides whether a real
    // backfill trips Jira's rate limit, so it is asserted rather than ignored.
    expect(jira.requests.filter((r) => r.startsWith('changelog'))).toEqual([
      'changelog@0',
      'changelog@2',
      'changelog@4',
    ]);
    expect(jira.requests.filter((r) => r === 'search')).toHaveLength(1);
    expect(jira.requests.filter((r) => r === 'worklog')).toHaveLength(1);
  });

  it('reports cumulative elapsed durations that match the fixture by hand', async () => {
    const { runtime } = await runPipeline();
    const envelope = await runtime.statusReport({
      projectId: PIPELINE_PROJECT_ID,
      basis: 'elapsed',
    });
    const row = envelope.report.rows[0];
    expect(row?.issueKey).toBe(EXPECTED.issueKey);

    // Created Mon 08:00 → In Progress 09:00 → Blocked 13:00 → In Progress
    // Wed 09:00 → In Review Wed 17:00 → Done Thu 11:30, evaluated Thu 12:00.
    expect(row?.byStatus['10000']).toBe(EXPECTED.elapsedByStatus['10000']); // To Do 08:00-09:00
    expect(row?.byStatus['3']).toBe(EXPECTED.elapsedByStatus['3']); // 4h + 8h across two visits
    expect(row?.byStatus['10100']).toBe(EXPECTED.elapsedByStatus['10100']); // Mon 13:00 → Wed 09:00
    expect(row?.byStatus['10200']).toBe(EXPECTED.elapsedByStatus['10200']); // Wed 17:00 → Thu 11:30
    expect(row?.byStatus['10001']).toBe(EXPECTED.elapsedByStatus['10001']); // Thu 11:30 → now
    expect(row?.totalMs).toBe(EXPECTED.elapsedTotal);
  });

  it('carries the re-entry count that Jira itself cannot report', async () => {
    const { runtime } = await runPipeline();
    const envelope = await runtime.statusReport({ projectId: PIPELINE_PROJECT_ID });
    expect(envelope.report.rows[0]?.entriesByStatus['3']).toBe(EXPECTED.inProgressEntries);
    expect(envelope.report.rows[0]?.entriesByStatus['10100']).toBe(1);
  });

  it('reports working hours against the default Mon-Fri 09:00-17:00 calendar', async () => {
    const { runtime } = await runPipeline();
    const envelope = await runtime.statusReport({
      projectId: PIPELINE_PROJECT_ID,
      basis: 'business',
    });
    const row = envelope.report.rows[0];
    // 2026-03-02 is a Monday, 03-04 a Wednesday, 03-05 a Thursday.
    expect(row?.byStatus['10000']).toBe(EXPECTED.businessByStatus['10000']); // before the window
    expect(row?.byStatus['3']).toBe(EXPECTED.businessByStatus['3']); // both visits inside 09-17
    expect(row?.byStatus['10100']).toBe(EXPECTED.businessByStatus['10100']); // Mon 13-17 + Tuesday
    expect(row?.byStatus['10200']).toBe(EXPECTED.businessByStatus['10200']); // Thu 09:00-11:30
    expect(row?.byStatus['10001']).toBe(EXPECTED.businessByStatus['10001']);
    expect(row?.totalMs).toBe(EXPECTED.businessTotal);
    expect(envelope.settings.calendar).toEqual(normaliseCalendar(standardBusinessCalendar('UTC')));
  });

  it('orders report columns by workflow category, not alphabetically', async () => {
    const { runtime } = await runPipeline();
    const envelope = await runtime.statusReport({ projectId: PIPELINE_PROJECT_ID });
    expect(envelope.report.columns.map((c) => c.name)).toEqual(EXPECTED.columnOrder);
  });

  it('stops calling the report partial once indexing completes', async () => {
    const { runtime } = await runPipeline();
    const envelope = await runtime.statusReport({ projectId: PIPELINE_PROJECT_ID });
    expect(envelope.progress?.state).toBe('complete');
    expect(envelope.partial).toBe(false);
  });

  it('exports the same numbers as CSV, defused against formula injection', async () => {
    const { runtime } = await runPipeline();
    const csv = await runtime.statusReportCsv({ projectId: PIPELINE_PROJECT_ID });
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('In Progress (times entered)');
    expect(lines[1]).toContain('FLOW-3');
    expect(lines[1]).toContain('12'); // 12 hours in progress
    expect(lines[1]?.endsWith('complete')).toBe(true);
    // Nothing in this export may begin a formula.
    for (const cell of (lines[1] ?? '').split(',')) {
      expect(/^[=+@]/.test(cell)).toBe(false);
    }
  });

  it('ingests worklogs and history in the same pass, with no extra Jira calls', async () => {
    const { runtime, store, jira } = await runPipeline();
    const worklogs = await runtime.worklogReport({
      projectId: PIPELINE_PROJECT_ID,
      groupBy: 'author',
    });
    // Three usable worklogs in the fixture; the fourth has no timeSpentSeconds.
    expect(worklogs.entries).toBe(3);
    expect(worklogs.totalMs).toBe((10800 + 7200 + 5400) * 1000);

    const history = await runtime.historyReport({ projectId: PIPELINE_PROJECT_ID });
    expect(history.total).toBe(7); // five changelog entries carrying seven items
    expect(history.byField[0]?.field).toBe('status');

    // Both came from the one changelog fetch and the one worklog fetch already
    // counted above — the portfolio thesis, asserted.
    expect(jira.requests.filter((r) => r === 'worklog')).toHaveLength(1);
    expect(await store.getIssueMeta('20003')).not.toBeNull();
  });

  it('re-running the whole pipeline changes nothing (idempotent)', async () => {
    const first = await runPipeline();
    const before = await first.runtime.statusReport({ projectId: PIPELINE_PROJECT_ID });
    const beforeRows = first.store.aggregateRowCount;

    // Reset the index state and run it all again over the same fixtures.
    await handleStartIndexing(first.runtime, { context: PIPELINE_CONTEXT });
    await handleBackfillJob(first.runtime, {
      projectId: PIPELINE_PROJECT_ID,
      cursor: null,
      slice: 0,
    });

    const after = await first.runtime.statusReport({ projectId: PIPELINE_PROJECT_ID });
    expect(first.store.aggregateRowCount).toBe(beforeRows);
    expect(after.report.rows[0]?.byStatus).toEqual(before.report.rows[0]?.byStatus);
  });

  /**
   * `runPipeline`'s own drain loop used to stop silently after 50 slices,
   * whatever `maxSlices` said. A fixture set needing more than that — 5,000+
   * issues at the production default `issuesPerSlice: 100` needs ~50 already,
   * so anything larger tripped it — got back a `pending` queue nobody was
   * checking, indistinguishable from a completed backfill unless the caller
   * happened to inspect `pending.length`. `packages/ui-harness/scripts/
   * scale-backfill.mjs` is what found this, driving 5,200 synthetic issues.
   *
   * Fixed by raising the safety net far past any real fixture size and making
   * it loud: hitting it now throws, so a caller can never mistake "gave up"
   * for "done". This pins that it does not fire at a realistic multi-issue
   * scale, only that it *would* fire — and say so — if the drain loop ever
   * genuinely stalled.
   */
  it('drains more than 50 slices without the old silent cap', async () => {
    // 60 single-status issues, one search page each — cheap to build, and
    // above the old ceiling by a comfortable margin.
    const issues = Array.from({ length: 60 }, (_, i) => ({
      issue: {
        id: String(90_000 + i),
        key: `MANY-${String(i)}`,
        fields: {
          summary: `issue ${String(i)}`,
          created: '2026-03-01T08:00:00.000+0000',
          updated: '2026-03-01T08:00:00.000+0000',
          resolutiondate: null,
          status: { id: '10000', name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: PIPELINE_PROJECT_ID, key: 'FLOW' },
        },
        changelog: { total: 0, values: [], isLast: true },
      },
      changelog: [],
      worklogs: [],
    }));

    const { store, pending } = await runPipeline({
      issues,
      issuesPerSlice: 1, // forces 60 slices — comfortably past the old 50-slice cap
      maxSlices: Number.POSITIVE_INFINITY,
    });
    expect(pending).toHaveLength(0);
    expect((await store.getIndexState(PIPELINE_PROJECT_ID))?.state).toBe('complete');
  });
});
