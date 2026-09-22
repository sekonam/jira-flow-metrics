import { describe, expect, it } from 'vitest';
import {
  DATASETS_TIME_IN_STATUS,
  MemoryStore,
  type IssueMetaRow,
  type JiraApi,
  type JiraIssue,
  type JiraProjectRef,
  type JiraSearchPage,
  type StatusAggregateRow,
  type StatusMeta,
  type WorklogRecord,
} from '@jfm/engine';
import { LimitHonouringSqlExecutor, RecordingSqlExecutor } from '../src/sql/executor.js';
import { SQL_MAX_ROWS, SqlMetricsStore } from '../src/sql/sql-store.js';
import {
  STORE_MAX_ROWS,
  buildStatusReport,
  capNoteRow,
  statusReportToCsv,
  tableToCsv,
} from '@jfm/engine';
import { SettingsStore } from '../src/settings.js';
import { ListingRuntime } from '../src/runtime.js';
import {
  buildAgingReport,
  buildHistoryReport,
  buildSlaReport,
  buildWorklogReport,
} from '../src/reports.js';
import {
  agingReportToCsv,
  historyReportToCsv,
  slaReportToCsv,
  worklogReportToCsv,
} from '../src/report-csv.js';
import { handleExportCsv, handleListStatuses, parseSlaGoal } from '../src/handlers.js';

/**
 * The silent-ceiling fix (TECHNICAL-SPEC § 11.1) and the per-listing CSV fix.
 *
 * Before these, a project bigger than a report's page rendered a page that
 * looked complete, and every listing's export button produced the
 * time-in-status CSV regardless of the report on screen.
 */

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.parse('2026-03-10T12:00:00Z');
const CONTEXT = { extension: { project: { id: '10000', key: 'FLOW' } } };

function meta(overrides: Partial<IssueMetaRow> & Pick<IssueMetaRow, 'issueId'>): IssueMetaRow {
  return {
    issueKey: `FLOW-${overrides.issueId}`,
    projectId: '10000',
    issueTypeId: null,
    priorityId: null,
    assigneeAccountId: null,
    currentStatusId: '3',
    createdAt: NOW - 30 * DAY,
    resolvedAt: null,
    dueAt: null,
    historyThroughAt: NOW,
    truncated: false,
    updatedAt: NOW,
    ...overrides,
  };
}

function agg(issueId: string, statusId: string, hours: number): StatusAggregateRow {
  return {
    issueId,
    statusId,
    elapsedMs: hours * HOUR,
    businessMs: hours * HOUR,
    entries: 1,
    lastEnteredAt: NOW - DAY,
    lastExitedAt: null,
    updatedAt: NOW,
  };
}

function worklog(worklogId: string, author: string): WorklogRecord {
  return {
    worklogId,
    issueId: '1',
    issueKey: 'FLOW-1',
    projectId: '10000',
    authorAccountId: author.toLowerCase(),
    authorDisplayName: author,
    startedAt: NOW - DAY,
    timeSpentMs: 2 * HOUR,
    createdAt: null,
    updatedAt: null,
  };
}

async function threeIssueStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.upsertStatusMeta([
    { statusId: '3', name: 'In Progress', category: 'inprogress', firstSeenAt: 0, lastSeenAt: NOW },
  ]);
  await store.putIssueAggregates(
    ['1', '2', '3'].map((issueId) => ({
      meta: meta({ issueId }),
      rows: [agg(issueId, '3', 4)],
    })),
  );
  return store;
}

describe('capped reports carry the real total', () => {
  it('aging report: capped when the project outgrows the fetch limit', async () => {
    const store = await threeIssueStore();
    const capped = await buildAgingReport(store, '10000', NOW, 2);
    expect(capped.projectIssueCount).toBe(3);
    expect(capped.capped).toBe(true);
    const complete = await buildAgingReport(store, '10000', NOW);
    expect(complete.capped).toBe(false);
    expect(complete.projectIssueCount).toBe(3);
  });

  it('SLA report: capped when the project outgrows the fetch limit', async () => {
    const store = await threeIssueStore();
    const goal = { id: 'g', name: 'Goal', countedStatusIds: [], targetMs: 8 * HOUR };
    const capped = await buildSlaReport(store, '10000', goal, NOW, 2);
    expect(capped.projectIssueCount).toBe(3);
    expect(capped.capped).toBe(true);
    const complete = await buildSlaReport(store, '10000', goal, NOW);
    expect(complete.capped).toBe(false);
  });

  it('★ distinguishes a truncated aggregate read from a truncated issue page', async () => {
    // Two independent ceilings. When only the *aggregate* read is cut, every
    // issue was fetched, so `rows.length === projectIssueCount` — and the one
    // `capped` boolean sent that through the issue-page banner, which printed
    // "Report capped at 400 of 400 issues": a title saying nothing was left
    // out above a body saying the rest are missing. That is precisely the
    // self-contradiction `toReadCapBanner` was added to remove from the flow
    // report, reintroduced here.
    //
    // 400 issues on a 30-status workflow is 12,000 aggregate rows against a
    // 10,000-row cap, and 400 is well under any issue page limit.
    const store = new MemoryStore();
    const statusIds = Array.from({ length: 30 }, (_u, i) => String(100 + i));
    await store.upsertStatusMeta(
      statusIds.map((statusId) => ({
        statusId,
        name: `Status ${statusId}`,
        category: 'inprogress' as const,
        firstSeenAt: 0,
        lastSeenAt: NOW,
      })),
    );
    await store.putIssueAggregates(
      Array.from({ length: 400 }, (_u, i) => ({
        meta: meta({ issueId: String(i + 1), currentStatusId: '100' }),
        rows: statusIds.map((statusId) => agg(String(i + 1), statusId, 20)),
      })),
    );

    const aging = await buildAgingReport(store, '10000', NOW);
    expect(aging.rows.length + aging.excludedDone).toBe(aging.projectIssueCount);
    expect(aging.capped).toBe(true);
    expect(aging.aggregatesCapped).toBe(true);

    const goal = { id: 'g', name: 'Goal', countedStatusIds: ['100'], targetMs: 8 * HOUR };
    const sla = await buildSlaReport(store, '10000', goal, NOW);
    expect(sla.rows.length).toBe(sla.projectIssueCount);
    expect(sla.aggregatesCapped).toBe(true);

    // ★ And attainment is withheld rather than overstated.
    //
    // Every one of these 400 issues is 600 working hours against an 8-hour
    // target, so the true attainment is 0%. The issues whose aggregate rows
    // were cut read as zero consumed time — compliant — which produced "16%
    // attainment" under a banner calling every figure a lower bound.
    // Attainment is the one figure that moves the *reassuring* way when a
    // report is truncated, so it is not shown at all.
    expect(sla.breachedCount).toBeLessThan(sla.rows.length);
    expect(sla.attainment).toBeNull();

    // A report inside both ceilings still reports a real attainment.
    const small = await threeIssueStore();
    expect((await buildSlaReport(small, '10000', goal, NOW)).aggregatesCapped).toBe(false);
  });

  it('★ does not call an exactly-full aggregate read truncated', async () => {
    // A read that exactly fills the cap dropped nothing, and `length >= cap`
    // cannot tell that from a real truncation — and since this report
    // withholds `attainment` on a capped read, that false positive blanks
    // the headline figure on a complete, correct report.
    //
    // 303 issues on a 33-status workflow is exactly 9,999 rows, which is
    // `AGGREGATE_ROW_CAP`: one below the store's own `SQL_MAX_ROWS` ceiling,
    // so the `cap + 1` probe is a limit the store will actually honour. See
    // `readAggregates` for why that last part is the whole fix.
    const store = new MemoryStore();
    const statusIds = Array.from({ length: 33 }, (_u, i) => String(100 + i));
    await store.upsertStatusMeta(
      statusIds.map((statusId) => ({
        statusId,
        name: `Status ${statusId}`,
        category: 'inprogress' as const,
        firstSeenAt: 0,
        lastSeenAt: NOW,
      })),
    );
    await store.putIssueAggregates(
      Array.from({ length: 303 }, (_u, i) => ({
        meta: meta({ issueId: String(i + 1), currentStatusId: '100' }),
        rows: statusIds.map((statusId) => agg(String(i + 1), statusId, 20)),
      })),
    );

    const goal = { id: 'g', name: 'Goal', countedStatusIds: ['100'], targetMs: 8 * HOUR };
    const sla = await buildSlaReport(store, '10000', goal, NOW);
    expect(sla.aggregatesCapped).toBe(false);
    expect(sla.capped).toBe(false);
    // Every one of the 303 breaches, and the report says so rather than
    // withholding the figure.
    expect(sla.attainment).toBe(0);
    expect((await buildAgingReport(store, '10000', NOW, 500)).aggregatesCapped).toBe(false);

    // One row past the cap is a real truncation. It has to land on an issue
    // already in the page — a 304th issue would change nothing about which
    // rows the aggregate read returns first.
    await store.putIssueAggregates([
      {
        meta: meta({ issueId: '1', currentStatusId: '100' }),
        rows: [...statusIds.map((statusId) => agg('1', statusId, 20)), agg('1', '999', 20)],
      },
    ]);
    expect((await buildSlaReport(store, '10000', goal, NOW)).aggregatesCapped).toBe(true);
  });

  it('★ detects a truncated aggregate read against the store that actually ships', async () => {
    // The defect this exists to prevent, stated plainly: every cap in this
    // product had only ever been tested against `MemoryStore`, which has no
    // `LIMIT` clamp. `SqlMetricsStore` clamps every read to `SQL_MAX_ROWS`,
    // so a truncation check that over-reads — asking for `cap + 1` and
    // seeing whether it arrives — was silently defeated, and its test was
    // green because it ran on the store where the clamp is absent.
    //
    // The consequence is the one `AGGREGATE_ROW_CAP`'s docstring names: the
    // tail issues' rows are dropped by `ORDER BY issue_id`, those issues
    // read as `consumedMs = 0` — fully compliant — and the page prints an
    // inflated attainment with no banner at all.
    const issues = 500;
    const statuses = 21; // 10,500 rows: past the cap, and past the ceiling
    const metaRows = Array.from({ length: issues }, (_u, i) => ({
      issue_id: String(i + 1),
      issue_key: `FLOW-${String(i + 1)}`,
      project_id: '10000',
      issue_type_id: null,
      priority_id: null,
      assignee_account_id: null,
      current_status_id: '100',
      created_at: NOW - 30 * DAY,
      resolved_at: null,
      due_at: null,
      history_through_at: NOW,
      truncated: 0,
      updated_at: NOW,
    }));
    const aggRows = metaRows.flatMap((row) =>
      Array.from({ length: statuses }, (_u, s) => ({
        issue_id: row.issue_id,
        status_id: String(100 + s),
        project_id: '10000',
        elapsed_ms: 600 * HOUR,
        business_ms: 600 * HOUR,
        entries: 1,
        last_entered_at: NOW - DAY,
        last_exited_at: null,
        updated_at: NOW,
      })),
    );

    const sqlStore = new SqlMetricsStore(
      new LimitHonouringSqlExecutor({ issue_meta: metaRows, issue_status_agg: aggRows }),
      { migrate: () => Promise.resolve() },
    );
    const goal = { id: 'g', name: 'Goal', countedStatusIds: ['100'], targetMs: 8 * HOUR };
    const sla = await buildSlaReport(sqlStore, '10000', goal, NOW);

    expect(aggRows.length).toBeGreaterThan(SQL_MAX_ROWS);
    expect(sla.rows).toHaveLength(issues);
    expect(sla.aggregatesCapped).toBe(true);
    expect(sla.capped).toBe(true);
    // Withheld, not inflated. Without the cap detection this reads as a
    // healthy attainment over a project where every issue is 600 working
    // hours against an eight-hour target.
    expect(sla.attainment).toBeNull();

    const aging = await buildAgingReport(sqlStore, '10000', NOW, issues);
    expect(aging.aggregatesCapped).toBe(true);
  });

  it('★ keeps every row it read, including the one that revealed the cap', async () => {
    // 500 issues on a 20-status workflow is exactly `STORE_MAX_ROWS`: the
    // store returns all 10,000, the probe sees the ceiling and flags it —
    // and slicing back to the cap then threw away a row that had genuinely
    // arrived, costing one issue a status column and leaving its total
    // short. The flag is a signal about what might be missing, not a reason
    // to discard what is present.
    const issues = 500;
    const statuses = 20;
    const metaRows = Array.from({ length: issues }, (_u, i) => ({
      issue_id: String(i + 1),
      issue_key: `FLOW-${String(i + 1)}`,
      project_id: '10000',
      issue_type_id: null,
      priority_id: null,
      assignee_account_id: null,
      current_status_id: '100',
      created_at: NOW - 30 * DAY,
      resolved_at: null,
      due_at: null,
      history_through_at: NOW,
      truncated: 0,
      updated_at: NOW,
    }));
    const aggRows = metaRows.flatMap((row) =>
      Array.from({ length: statuses }, (_u, s2) => ({
        issue_id: row.issue_id,
        status_id: String(100 + s2),
        project_id: '10000',
        elapsed_ms: 4 * HOUR,
        business_ms: 4 * HOUR,
        entries: 1,
        last_entered_at: NOW - DAY,
        last_exited_at: null,
        updated_at: NOW,
      })),
    );
    expect(aggRows).toHaveLength(STORE_MAX_ROWS);

    const report = await buildStatusReport(
      new SqlMetricsStore(
        new LimitHonouringSqlExecutor({ issue_meta: metaRows, issue_status_agg: aggRows }),
        { migrate: () => Promise.resolve() },
      ),
      { projectId: '10000', basis: 'business', limit: issues, offset: 0 },
    );

    // Flagged, because at exactly the ceiling there is no way to know — and
    // withholding is the recoverable direction.
    expect(report.aggregatesCapped).toBe(true);
    // But every figure is the one the store actually returned: 20 statuses
    // at four hours each, for all 500 issues, none short.
    expect(report.rows.every((row) => row.totalMs === statuses * 4 * HOUR)).toBe(true);
  });

  it('★ the flagship report detects a truncated aggregate read too', async () => {
    // `buildStatusReport` passed **no** `limit` to `queryStatusDurations`,
    // which does not mean "no limit": the SQL adapter clamps an unspecified
    // read to `STORE_MAX_ROWS` and keeps the first rows by `issue_id`. So on
    // a 500-issue page over a 21-status workflow — the default page size and
    // an ordinary enterprise workflow — the tail issues lost every aggregate
    // row and rendered `0h` in every column with `0` as their total, sorting
    // to the bottom of a table ordered by time. `StatusReport.capped` stayed
    // false, because it only ever compared the issue page against a COUNT.
    //
    // Three rounds of this cycle fixed that shape in the four derived
    // listings and never looked at listing 1, where it is a wrong number
    // rather than a missing banner.
    const issues = 500;
    const statuses = 21;
    const metaRows = Array.from({ length: issues }, (_u, i) => ({
      issue_id: String(i + 1),
      issue_key: `FLOW-${String(i + 1)}`,
      project_id: '10000',
      issue_type_id: null,
      priority_id: null,
      assignee_account_id: null,
      current_status_id: '100',
      created_at: NOW - 30 * DAY,
      resolved_at: null,
      due_at: null,
      history_through_at: NOW,
      truncated: 0,
      updated_at: NOW,
    }));
    const aggRows = metaRows.flatMap((row) =>
      Array.from({ length: statuses }, (_u, s2) => ({
        issue_id: row.issue_id,
        status_id: String(100 + s2),
        project_id: '10000',
        elapsed_ms: 4 * HOUR,
        business_ms: 4 * HOUR,
        entries: 1,
        last_entered_at: NOW - DAY,
        last_exited_at: null,
        updated_at: NOW,
      })),
    );
    expect(aggRows).toHaveLength(10_500);
    expect(aggRows.length).toBeGreaterThan(STORE_MAX_ROWS);

    const sqlStore = new SqlMetricsStore(
      new LimitHonouringSqlExecutor({ issue_meta: metaRows, issue_status_agg: aggRows }),
      { migrate: () => Promise.resolve() },
    );
    const report = await buildStatusReport(sqlStore, {
      projectId: '10000',
      basis: 'business',
      limit: issues,
      offset: 0,
    });

    expect(report.rows).toHaveLength(issues);
    expect(report.aggregatesCapped).toBe(true);

    // And the thing the flag is *about*: some rows really did come back as
    // zero, which is the wrong number the banner now qualifies.
    expect(report.rows.filter((row) => row.totalMs === 0).length).toBeGreaterThan(0);

    // A page inside the ceiling reports no truncation and no zero rows.
    const small = new SqlMetricsStore(
      new LimitHonouringSqlExecutor({
        issue_meta: metaRows.slice(0, 100),
        issue_status_agg: aggRows.slice(0, 100 * statuses),
      }),
      { migrate: () => Promise.resolve() },
    );
    const complete = await buildStatusReport(small, {
      projectId: '10000',
      basis: 'business',
      limit: 100,
      offset: 0,
    });
    expect(complete.aggregatesCapped).toBe(false);
    expect(complete.rows.every((row) => row.totalMs > 0)).toBe(true);
  });

  it('★ every capped export says so in the file, not only on the screen', async () => {
    // The export button sits directly beside a cap banner, and produced 500
    // silent rows of a 5,000-issue project. A CSV is the artefact that
    // leaves the product — mailed, pasted into a deck, summed in a
    // spreadsheet — and it was the one place the qualifier was missing.
    const store = await threeIssueStore();
    const goal = { id: 'g', name: 'Goal', countedStatusIds: [], targetMs: 8 * HOUR };

    const aging = agingReportToCsv(await buildAgingReport(store, '10000', NOW, 2));
    expect(aging.split('\n').at(-1)).toMatch(/^# This file covers 2 of 3 issues\./);

    const sla = slaReportToCsv(await buildSlaReport(store, '10000', goal, NOW, 2));
    expect(sla.split('\n').at(-1)).toMatch(/^# This file covers 2 of 3 issues\./);

    // All five exports, not two: the worklog and history notes were added in
    // the same commit and asserted nowhere, so deleting either left the
    // suite green.
    const worklogStore = new MemoryStore();
    await worklogStore.putWorklogs('1', [
      worklog('a', 'Anna'),
      worklog('b', 'Ben'),
      worklog('c', 'Cara'),
    ]);
    const worklogCsv = worklogReportToCsv(
      await buildWorklogReport(worklogStore, { projectId: '10000', limit: 2 }, 'UTC'),
      'Author',
    );
    expect(worklogCsv.split('\r\n').at(-1)).toContain('of 3 worklog entries');

    const historyStore = new MemoryStore();
    const change = {
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      at: NOW - DAY,
      authorAccountId: 'anna',
      authorDisplayName: 'Anna',
      fromValue: null,
      toValue: 'Done',
      fromId: null,
      toId: '10001',
      field: 'status',
      fieldLabel: 'status',
    };
    await historyStore.putHistory('1', [
      { ...change, changeId: 'a' },
      { ...change, changeId: 'b' },
      { ...change, changeId: 'c' },
    ]);
    const historyCsv = historyReportToCsv(
      await buildHistoryReport(historyStore, { projectId: '10000', limit: 2 }),
    );
    expect(historyCsv.split('\r\n').at(-1)).toContain('of 3 changes');

    // And a complete export carries no note at all — a spurious one would be
    // as wrong as a missing one, and it would land in someone's spreadsheet.
    const complete = agingReportToCsv(await buildAgingReport(store, '10000', NOW));
    expect(complete).not.toContain('#');
    expect(complete.split('\r\n')).toHaveLength(4); // header + three issues
  });

  it('★ escapes the truncation note like any other cell', async () => {
    // The note was built by string concatenation in `statusReportCsv` and
    // appended raw, outside `toCsv`. Every branch of its text contains a
    // comma — and `toLocaleString` puts one inside the number itself — so a
    // spreadsheet split "covers 500 of 5,000 issues" across two columns, at
    // exactly the figure the note exists to state. A note about truncation,
    // truncated.
    const rows = capNoteRow({
      capped: true,
      included: 500,
      total: 5000,
      noun: 'issues',
    });
    expect(rows).toHaveLength(1);
    const line = tableToCsv(['Issue key'], rows).split('\r\n').at(-1)!;
    expect(line.startsWith('"')).toBe(true);
    expect(line.endsWith('"')).toBe(true);
    // One cell: everything between the quotes, commas included.
    expect(line.slice(1, -1)).toBe(
      '# This file covers 500 of 5,000 issues. Narrow the filters to export the rest.',
    );

    // The status CSV is the path that had the bug, and it now goes through
    // the same writer as the other four — including the line ending, which
    // was a bare LF in a CRLF document.
    const report = await buildStatusReport(await threeIssueStore(), {
      projectId: '10000',
      basis: 'elapsed',
      limit: 2,
      offset: 0,
    });
    const csv = statusReportToCsv(report, { durationFormat: 'hours' });
    // No bare LF: the concatenated version joined with `\n` into a document
    // whose every other separator is CRLF.
    expect(csv).not.toMatch(/(?<!\r)\n/);
    // Unquoted here, and correctly so — `toCsv` quotes only a cell that
    // needs it, and "2 of 3" carries no separator. That is the same writer
    // doing the same job; what mattered was going through it at all.
    expect(csv.split('\r\n').at(-1)).toBe(
      '# This file covers 2 of 3 issues. Narrow the filters to export the rest.',
    );
  });

  it('worklog report: capped when more entries match than were fetched', async () => {
    const store = new MemoryStore();
    await store.putWorklogs('1', [worklog('a', 'Anna'), worklog('b', 'Ben'), worklog('c', 'Cara')]);
    const capped = await buildWorklogReport(store, { projectId: '10000', limit: 2 }, 'UTC');
    expect(capped.totalEntries).toBe(3);
    expect(capped.capped).toBe(true);
    const complete = await buildWorklogReport(store, { projectId: '10000' }, 'UTC');
    expect(complete.totalEntries).toBe(3);
    expect(complete.capped).toBe(false);
  });

  it('history report: capped when more changes match than the page shows', async () => {
    const store = new MemoryStore();
    const base = {
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      at: NOW - DAY,
      authorAccountId: 'anna',
      authorDisplayName: 'Anna',
      fromValue: null,
      toValue: 'Done',
      fromId: null,
      toId: '10001',
    };
    await store.putHistory('1', [
      { ...base, changeId: 'a', field: 'status', fieldLabel: 'status' },
      { ...base, changeId: 'b', field: 'status', fieldLabel: 'status' },
      { ...base, changeId: 'c', field: 'assignee', fieldLabel: 'assignee' },
    ]);
    const capped = await buildHistoryReport(store, { projectId: '10000', limit: 2 });
    expect(capped.total).toBe(2);
    expect(capped.totalMatching).toBe(3);
    expect(capped.capped).toBe(true);
    // A later page reaching the end is not capped, even though this page is short.
    const lastPage = await buildHistoryReport(store, { projectId: '10000', limit: 2, offset: 2 });
    expect(lastPage.capped).toBe(false);
    expect(lastPage.totalMatching).toBe(3);
  });
});

describe('per-listing CSV rendering', () => {
  it('worklog CSV lists groups with hours, not the status table', async () => {
    const store = new MemoryStore();
    await store.putWorklogs('1', [worklog('a', 'Anna'), worklog('b', 'Anna'), worklog('c', 'Ben')]);
    const report = await buildWorklogReport(store, { projectId: '10000' }, 'UTC');
    const csv = worklogReportToCsv(report, 'Person');
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Person,Hours logged,Entries,Issues');
    expect(lines[1]).toBe('Anna,4,2,1');
    expect(lines[2]).toBe('Ben,2,1,1');
  });

  it('aging CSV lists in-flight issues with their status and ages', async () => {
    const report = await buildAgingReport(await threeIssueStore(), '10000', NOW);
    const csv = agingReportToCsv(report);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('Issue key');
    expect(lines[0]).toContain('Age in status (hours)');
    expect(lines[1]).toContain('FLOW-1');
    expect(lines[1]).toContain('In Progress');
  });

  it('SLA CSV carries the breach verdicts and the due-date columns', async () => {
    const store = await threeIssueStore();
    const goal = { id: 'g', name: 'Goal', countedStatusIds: [], targetMs: 2 * HOUR };
    const report = await buildSlaReport(store, '10000', goal, NOW);
    const csv = slaReportToCsv(report);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(
      'Issue key,Working hours used,Target (hours),Remaining (hours),Breached,Due date (UTC),Due date breached',
    );
    // 4 working hours against a 2-hour target: -2 remaining, breached.
    expect(lines[1]).toContain('FLOW-1,4,2');
    expect(lines[1]).toContain('yes');
  });

  it('history CSV lists changes, defusing a formula-shaped value', async () => {
    const store = new MemoryStore();
    await store.putHistory('1', [
      {
        changeId: 'a',
        issueId: '1',
        issueKey: 'FLOW-1',
        projectId: '10000',
        at: NOW - DAY,
        authorAccountId: 'anna',
        authorDisplayName: 'Anna',
        field: 'summary',
        fieldLabel: 'Summary',
        fromValue: null,
        toValue: '=SUM(A1:A9)',
        fromId: null,
        toId: null,
      },
    ]);
    const report = await buildHistoryReport(store, { projectId: '10000' });
    const csv = historyReportToCsv(report);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Changed at (UTC),Issue key,Field,From,To,Author');
    expect(lines[1]).toContain("'=SUM(A1:A9)");
    expect(lines[1]).toContain('FLOW-1');
  });
});

// ------------------------------------------------- resolver-level wiring ---

const ISSUE: JiraIssue = {
  id: '20001',
  key: 'FLOW-1',
  fields: {
    created: '2026-03-01T09:00:00.000+0000',
    status: { id: '3', name: 'In Progress' },
    project: { id: '10000', key: 'FLOW' },
  },
  changelog: { total: 0, values: [], isLast: true },
};

class StubJira implements JiraApi {
  canBrowse = true;
  canBrowseProject(): Promise<boolean> {
    return Promise.resolve(this.canBrowse);
  }
  isAdmin(): Promise<boolean> {
    return Promise.resolve(true);
  }
  searchIssues(): Promise<JiraSearchPage> {
    return Promise.resolve({ issues: [ISSUE], isLast: true, nextPageToken: null, total: 1 });
  }
  getIssue(): Promise<JiraIssue> {
    return Promise.resolve(ISSUE);
  }
  getChangelog() {
    return Promise.resolve({ values: [], total: 0, isLast: true });
  }
  getWorklogs() {
    return Promise.resolve({ worklogs: [], total: 0 });
  }
  getStatuses(): Promise<readonly StatusMeta[]> {
    return Promise.resolve([{ id: '3', name: 'In Progress', category: 'inprogress' }]);
  }
  listProjects(): Promise<readonly JiraProjectRef[]> {
    return Promise.resolve([]);
  }
}

function build() {
  const store = new MemoryStore();
  const jira = new StubJira();
  const runtime = new ListingRuntime(
    {
      api: jira,
      store,
      settings: new SettingsStore(new RecordingSqlExecutor()),
      scheduler: { enqueueBackfill: () => Promise.resolve() },
      sleeper: { sleep: () => Promise.resolve() },
      clock: { now: () => NOW },
    },
    { listingId: 'test-listing', datasets: DATASETS_TIME_IN_STATUS },
  );
  return { runtime, store, jira };
}

describe('handleExportCsv exports the report on screen, per listing', () => {
  it("'aging' exports the aging table, not the status table", async () => {
    const { runtime, store } = build();
    await store.upsertStatusMeta([
      {
        statusId: '3',
        name: 'In Progress',
        category: 'inprogress',
        firstSeenAt: 0,
        lastSeenAt: NOW,
      },
    ]);
    await store.putIssueAggregate(meta({ issueId: '1' }), [agg('1', '3', 4)]);
    const result = await handleExportCsv(runtime, { context: CONTEXT }, 'aging');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.csv).toContain('Age in status (hours)');
      expect(result.data.csv).not.toContain('History complete');
    }
  });

  it("'worklog' exports the worklog groups", async () => {
    const { runtime, store } = build();
    await store.putWorklogs('1', [worklog('a', 'Anna')]);
    const result = await handleExportCsv(runtime, { context: CONTEXT }, 'worklog');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.csv).toContain('Person,Hours logged,Entries,Issues');
  });

  it("'sla' measures the export against the goal in the payload", async () => {
    const { runtime, store } = build();
    await store.putIssueAggregate(meta({ issueId: '1' }), [agg('1', '3', 4)]);
    const result = await handleExportCsv(
      runtime,
      { context: CONTEXT, payload: { targetMs: 2 * HOUR } },
      'sla',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.csv).toContain('Working hours used');
      expect(result.data.csv).toContain('FLOW-1,4,2');
    }
  });

  it("'history' exports the change log", async () => {
    const { runtime, store } = build();
    await store.putHistory('1', [
      {
        changeId: 'a',
        issueId: '1',
        issueKey: 'FLOW-1',
        projectId: '10000',
        at: NOW - DAY,
        authorAccountId: 'anna',
        authorDisplayName: 'Anna',
        field: 'status',
        fieldLabel: 'Status',
        fromValue: 'To Do',
        toValue: 'In Progress',
        fromId: null,
        toId: null,
      },
    ]);
    const result = await handleExportCsv(runtime, { context: CONTEXT }, 'history');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.csv).toContain('Changed at (UTC),Issue key,Field');
  });

  it('defaults to the status-report CSV, unchanged', async () => {
    const { runtime, store } = build();
    await store.upsertStatusMeta([
      {
        statusId: '3',
        name: 'In Progress',
        category: 'inprogress',
        firstSeenAt: 0,
        lastSeenAt: NOW,
      },
    ]);
    await store.putIssueAggregate(meta({ issueId: '1' }), [agg('1', '3', 4)]);
    const result = await handleExportCsv(runtime, { context: CONTEXT });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.csv).toContain('History complete');
  });
});

describe('parseSlaGoal', () => {
  it('defaults to an 8-working-hour, all-statuses goal', () => {
    expect(parseSlaGoal(undefined)).toEqual({
      id: 'default',
      name: 'Time to resolution',
      countedStatusIds: [],
      targetMs: 8 * HOUR,
    });
  });

  it('clamps an absurd target and keeps chosen statuses', () => {
    const goal = parseSlaGoal({ countedStatusIds: ['3'], targetMs: 1 });
    expect(goal.countedStatusIds).toEqual(['3']);
    expect(goal.targetMs).toBe(60_000);
    expect(parseSlaGoal({ targetMs: Number.MAX_SAFE_INTEGER }).targetMs).toBe(365 * 86_400_000);
  });
});

describe('handleListStatuses', () => {
  const TWO_STATUSES = [
    {
      statusId: '3',
      name: 'In Progress',
      category: 'inprogress' as const,
      firstSeenAt: 0,
      lastSeenAt: NOW,
    },
    {
      statusId: '77',
      name: 'In Progress',
      category: 'inprogress' as const,
      firstSeenAt: 0,
      lastSeenAt: NOW,
    },
  ];

  it("offers only the project's own statuses, not the instance's", async () => {
    // Two same-named statuses under different ids — another project's twin
    // must not appear as a duplicate chip (observed live with two seeded
    // projects).
    const { runtime, store } = build();
    await store.upsertStatusMeta(TWO_STATUSES);
    await store.putIssueAggregate(meta({ issueId: '1' }), [agg('1', '3', 4)]);
    await store.putIssueAggregate(meta({ issueId: '2', projectId: '20000' }), [agg('2', '77', 4)]);
    const result = await handleListStatuses(runtime, { context: CONTEXT });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.map((s) => s.statusId)).toEqual(['3']);
  });

  it('★ does not fall back to the instance-wide table before a project is indexed', async () => {
    // Regression. An unindexed project has no aggregates to narrow by, and
    // the fallback handed back the whole stored `status_meta` table —
    // including statuses that exist only in projects this caller cannot
    // browse. `handleListStatuses` authorises the caller precisely because
    // status names "are information about projects the caller may not be
    // allowed to see", and a name like "Pending Legal — Acquisition" is
    // exactly that. Every project is in this state for the minutes after
    // install, and permanently if nobody presses the button.
    //
    // Jira's own catalogue is the honest substitute — read as the *app*,
    // which makes it the whole instance catalogue rather than a narrower
    // list. What makes that acceptable is that any authenticated user can
    // fetch `/rest/api/3/status` themselves; the sensitive fact is which
    // statuses a *project* uses, and that is narrowed the moment the project
    // is indexed. See `ListingRuntime.listStatuses`. The stub reports only
    // status `3`, so `77` — which exists solely in the stored table, having
    // been seen in some other project — must not appear.
    const { runtime, store } = build();
    await store.upsertStatusMeta(TWO_STATUSES);
    const result = await handleListStatuses(runtime, { context: CONTEXT });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.map((s) => s.statusId)).toEqual(['3']);
  });

  it('leaves the picker empty rather than leaking when Jira cannot be reached', async () => {
    const { runtime, store, jira } = build();
    await store.upsertStatusMeta(TWO_STATUSES);
    jira.getStatuses = () => Promise.reject(new Error('jira unreachable'));
    const result = await handleListStatuses(runtime, { context: CONTEXT });
    // A picker with no chips still renders a usable report against the
    // default goal; leaking is the worse failure.
    expect(result).toEqual({ ok: true, data: [] });
  });

  it('refuses a caller who cannot browse the project', async () => {
    const { runtime, jira } = build();
    jira.canBrowse = false;
    const result = await handleListStatuses(runtime, { context: CONTEXT });
    expect(result.ok).toBe(false);
  });
});
