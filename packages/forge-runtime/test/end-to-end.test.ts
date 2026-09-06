import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DATASETS_ALL,
  MemoryStore,
  normaliseCalendar,
  standardBusinessCalendar,
  type JiraApi,
  type JiraChangelogPage,
  type JiraIssue,
  type JiraSearchPage,
  type JiraWorklogPage,
  type PageParams,
  type StatusMeta,
} from '@jfm/engine';
import { RecordingSqlExecutor } from '../src/sql/executor.js';
import { SettingsStore } from '../src/settings.js';
import { ListingRuntime } from '../src/runtime.js';
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
 */

const HOUR = 3_600_000;
const CONTEXT = { extension: { project: { id: '10000' } } };
// Thursday 2026-03-05 12:00 UTC, chosen so the open interval has a known length.
const NOW = Date.parse('2026-03-05T12:00:00Z');

function fixture<T>(name: string): T {
  const path = fileURLToPath(new URL(`../../engine/test/fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const CHANGELOG = fixture<JiraChangelogPage>('changelog-reentry.json');
const WORKLOGS = fixture<JiraWorklogPage>('worklogs.json');

/** One issue, created Mon 2026-03-02 08:00 UTC, with the re-entry history. */
const ISSUE: JiraIssue = {
  id: '20003',
  key: 'FLOW-3',
  fields: {
    created: '2026-03-02T08:00:00.000+0000',
    updated: '2026-03-05T11:30:00.000+0000',
    resolutiondate: '2026-03-05T11:30:00.000+0000',
    status: { id: '10001', name: 'Done', statusCategory: { key: 'done' } },
    project: { id: '10000', key: 'FLOW' },
  },
  // Deliberately partial, so the ingester must page the changelog separately —
  // the path a real large issue takes.
  changelog: { total: 5, values: [], isLast: false },
};

class FixtureJira implements JiraApi {
  readonly requests: string[] = [];

  searchIssues(): Promise<JiraSearchPage> {
    this.requests.push('search');
    return Promise.resolve({ issues: [ISSUE], isLast: true, nextPageToken: null, total: 1 });
  }
  getIssue(): Promise<JiraIssue> {
    this.requests.push('issue');
    return Promise.resolve(ISSUE);
  }
  getChangelog(_id: string, page: PageParams): Promise<JiraChangelogPage> {
    this.requests.push(`changelog@${page.startAt}`);
    const all = CHANGELOG.values ?? [];
    const values = all.slice(page.startAt, page.startAt + 2); // force three pages
    return Promise.resolve({
      startAt: page.startAt,
      maxResults: 2,
      total: all.length,
      isLast: page.startAt + values.length >= all.length,
      values,
    });
  }
  getWorklogs(): Promise<JiraWorklogPage> {
    this.requests.push('worklog');
    return Promise.resolve(WORKLOGS);
  }
  getStatuses(): Promise<readonly StatusMeta[]> {
    this.requests.push('status');
    return Promise.resolve([
      { id: '10000', name: 'To Do', category: 'todo' },
      { id: '3', name: 'In Progress', category: 'inprogress' },
      { id: '10100', name: 'Blocked', category: 'todo' },
      { id: '10200', name: 'In Review', category: 'inprogress' },
      { id: '10001', name: 'Done', category: 'done' },
    ]);
  }
}

async function runFullPipeline(): Promise<{
  runtime: ListingRuntime;
  store: MemoryStore;
  jira: FixtureJira;
}> {
  const store = new MemoryStore();
  const jira = new FixtureJira();
  const sql = new RecordingSqlExecutor();
  const settings = new SettingsStore(sql);
  const queue: { projectId: string; slice: number }[] = [];

  const runtime = new ListingRuntime(
    {
      api: jira,
      store,
      settings,
      scheduler: {
        enqueueBackfill: (job) => {
          queue.push(job);
          return Promise.resolve();
        },
      },
      sleeper: { sleep: () => Promise.resolve() },
      clock: { now: () => NOW },
    },
    { listingId: 'time-in-status', datasets: DATASETS_ALL },
  );

  await handleStartIndexing(runtime, { context: CONTEXT });
  // Drain the queue exactly as the Forge consumer would.
  let guard = 0;
  while (queue.length > 0 && guard < 10) {
    const job = queue.shift()!;
    await handleBackfillJob(runtime, { ...job, cursor: null });
    guard += 1;
  }
  return { runtime, store, jira };
}

describe('end to end: recorded Jira payloads to reported durations', () => {
  it('drains the backfill queue to completion', async () => {
    const { store, jira } = await runFullPipeline();
    expect((await store.getIndexState('10000'))?.state).toBe('complete');
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
    const { runtime } = await runFullPipeline();
    const envelope = await runtime.statusReport({ projectId: '10000', basis: 'elapsed' });
    const row = envelope.report.rows[0];
    expect(row?.issueKey).toBe('FLOW-3');

    // Created Mon 08:00 → In Progress 09:00 → Blocked 13:00 → In Progress
    // Wed 09:00 → In Review Wed 17:00 → Done Thu 11:30, evaluated Thu 12:00.
    expect(row?.byStatus['10000']).toBe(1 * HOUR); // To Do 08:00-09:00
    expect(row?.byStatus['3']).toBe(12 * HOUR); // 4h + 8h across two visits
    expect(row?.byStatus['10100']).toBe(44 * HOUR); // Mon 13:00 → Wed 09:00
    expect(row?.byStatus['10200']).toBe(18.5 * HOUR); // Wed 17:00 → Thu 11:30
    expect(row?.byStatus['10001']).toBe(0.5 * HOUR); // Thu 11:30 → now
    expect(row?.totalMs).toBe(76 * HOUR);
  });

  it('carries the re-entry count that Jira itself cannot report', async () => {
    const { runtime } = await runFullPipeline();
    const envelope = await runtime.statusReport({ projectId: '10000' });
    expect(envelope.report.rows[0]?.entriesByStatus['3']).toBe(2);
    expect(envelope.report.rows[0]?.entriesByStatus['10100']).toBe(1);
  });

  it('reports working hours against the default Mon-Fri 09:00-17:00 calendar', async () => {
    const { runtime } = await runFullPipeline();
    const envelope = await runtime.statusReport({ projectId: '10000', basis: 'business' });
    const row = envelope.report.rows[0];
    // 2026-03-02 is a Monday, 03-04 a Wednesday, 03-05 a Thursday.
    expect(row?.byStatus['10000']).toBe(0); // 08:00-09:00 is before the window
    expect(row?.byStatus['3']).toBe(12 * HOUR); // both visits sit inside 09:00-17:00
    expect(row?.byStatus['10100']).toBe(12 * HOUR); // Mon 13:00-17:00 + all Tuesday
    expect(row?.byStatus['10200']).toBe(2.5 * HOUR); // Thu 09:00-11:30
    expect(row?.byStatus['10001']).toBe(0.5 * HOUR);
    expect(row?.totalMs).toBe(27 * HOUR);
    expect(envelope.settings.calendar).toEqual(normaliseCalendar(standardBusinessCalendar('UTC')));
  });

  it('orders report columns by workflow category, not alphabetically', async () => {
    const { runtime } = await runFullPipeline();
    const envelope = await runtime.statusReport({ projectId: '10000' });
    expect(envelope.report.columns.map((c) => c.name)).toEqual([
      'Blocked', // todo category, alphabetically before "To Do"
      'To Do',
      'In Progress',
      'In Review',
      'Done',
    ]);
  });

  it('stops calling the report partial once indexing completes', async () => {
    const { runtime } = await runFullPipeline();
    const envelope = await runtime.statusReport({ projectId: '10000' });
    expect(envelope.progress?.state).toBe('complete');
    expect(envelope.partial).toBe(false);
  });

  it('exports the same numbers as CSV, defused against formula injection', async () => {
    const { runtime } = await runFullPipeline();
    const csv = await runtime.statusReportCsv({ projectId: '10000' });
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
    const { runtime, store, jira } = await runFullPipeline();
    const worklogs = await runtime.worklogReport({ projectId: '10000', groupBy: 'author' });
    // Three usable worklogs in the fixture; the fourth has no timeSpentSeconds.
    expect(worklogs.entries).toBe(3);
    expect(worklogs.totalMs).toBe((10800 + 7200 + 5400) * 1000);

    const history = await runtime.historyReport({ projectId: '10000' });
    expect(history.total).toBe(7); // five changelog entries carrying seven items
    expect(history.byField[0]?.field).toBe('status');

    // Both came from the one changelog fetch and the one worklog fetch already
    // counted above — the portfolio thesis, asserted.
    expect(jira.requests.filter((r) => r === 'worklog')).toHaveLength(1);
    expect(await store.getIssueMeta('20003')).not.toBeNull();
  });

  it('re-running the whole pipeline changes nothing (idempotent)', async () => {
    const first = await runFullPipeline();
    const before = await first.runtime.statusReport({ projectId: '10000' });
    const beforeRows = first.store.aggregateRowCount;

    // Reset the index state and run it all again over the same fixtures.
    await handleStartIndexing(first.runtime, { context: CONTEXT });
    await handleBackfillJob(first.runtime, { projectId: '10000', cursor: null, slice: 0 });

    const after = await first.runtime.statusReport({ projectId: '10000' });
    expect(first.store.aggregateRowCount).toBe(beforeRows);
    expect(after.report.rows[0]?.byStatus).toEqual(before.report.rows[0]?.byStatus);
  });
});
