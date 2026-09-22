import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory-store.js';
import {
  CREATE_STATEMENTS,
  DELETE_ISSUE_STATEMENTS,
  ESTIMATED_ROW_BYTES,
  SCHEMA_VERSION,
} from '../src/store/schema.js';
import type { IssueMetaRow, StatusAggregateRow } from '../src/store/types.js';
import { buildStatusReport } from '../src/report/status-report.js';
import { csvCell, statusReportToCsv, tableToCsv, toCsv } from '../src/export/csv.js';
import {
  ALL_PRICING,
  ISSUE_HISTORY_PRICING,
  modelledMonthlyRevenueUsd,
  monthlyPrice,
  priceLadder,
  TIME_IN_STATUS_PRICING,
  WORKLOG_PRICING,
} from '../src/config/pricing.js';
import {
  estimateIngestVolume,
  estimateMonthlySqlCost,
  estimateStorage,
  REFERENCE_PROFILE,
} from '../src/cost/model.js';
import { DATASETS_TIME_IN_STATUS } from '../src/ingest/process-issue.js';
import { T } from './helpers.js';

const HOUR = 3_600_000;
const NOW = T('2026-03-06T00:00:00Z');

function meta(overrides: Partial<IssueMetaRow> & Pick<IssueMetaRow, 'issueId'>): IssueMetaRow {
  return {
    issueKey: `FLOW-${overrides.issueId}`,
    projectId: '10000',
    issueTypeId: '10002',
    priorityId: '3',
    assigneeAccountId: 'acc-anna',
    currentStatusId: '3',
    createdAt: T('2026-03-01T00:00:00Z'),
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
    businessMs: (hours / 2) * HOUR,
    entries: 1,
    lastEnteredAt: NOW,
    lastExitedAt: null,
    updatedAt: NOW,
  };
}

async function seededStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.migrate();
  await store.upsertStatusMeta([
    { statusId: '10000', name: 'To Do', category: 'todo', firstSeenAt: 0, lastSeenAt: NOW },
    { statusId: '3', name: 'In Progress', category: 'inprogress', firstSeenAt: 0, lastSeenAt: NOW },
    { statusId: '10001', name: 'Done', category: 'done', firstSeenAt: 0, lastSeenAt: NOW },
  ]);
  await store.putIssueAggregates([
    {
      meta: meta({ issueId: '1', createdAt: T('2026-03-01T00:00:00Z') }),
      rows: [agg('1', '10000', 2), agg('1', '3', 10)],
    },
    {
      meta: meta({
        issueId: '2',
        createdAt: T('2026-03-02T00:00:00Z'),
        assigneeAccountId: 'acc-ben',
        issueTypeId: '10004',
        truncated: true,
      }),
      rows: [agg('2', '3', 4), agg('2', '10001', 1)],
    },
  ]);
  return store;
}

describe('store schema', () => {
  it('creates every table idempotently', () => {
    expect(CREATE_STATEMENTS.length).toBeGreaterThan(0);
    for (const statement of CREATE_STATEMENTS) {
      expect(statement).toContain('CREATE TABLE IF NOT EXISTS');
    }
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('deletes an issue from every table that holds its rows', () => {
    const tables = DELETE_ISSUE_STATEMENTS.map((s) => /FROM (\w+)/.exec(s)?.[1]);
    expect(new Set(tables)).toEqual(
      new Set(['issue_status_agg', 'issue_status_visit', 'worklog', 'issue_history', 'issue_meta']),
    );
    // issue_meta is removed last, so a partial failure leaves the issue visible
    // and therefore re-processable rather than orphaning its aggregate rows.
    expect(DELETE_ISSUE_STATEMENTS[DELETE_ISSUE_STATEMENTS.length - 1]).toContain('issue_meta');
  });

  it('publishes per-row size estimates for the cost model', () => {
    expect(ESTIMATED_ROW_BYTES.issue_status_agg).toBeGreaterThan(0);
  });
});

describe('MemoryStore — the reference store semantics', () => {
  it('replaces rather than merges an issue aggregate', async () => {
    const store = await seededStore();
    expect(store.aggregateRowCount).toBe(4);
    await store.putIssueAggregate(meta({ issueId: '1' }), [agg('1', '3', 99)]);
    expect(store.aggregateRowCount).toBe(3);
    const rows = await store.queryStatusDurations({ projectId: '10000', issueIds: ['1'] });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.elapsedMs).toBe(99 * HOUR);
  });

  it('scopes every query to a project', async () => {
    const store = await seededStore();
    await store.putIssueAggregate(meta({ issueId: '9', projectId: '20000' }), [agg('9', '3', 1)]);
    expect(await store.queryStatusDurations({ projectId: '10000' })).toHaveLength(4);
    expect(await store.queryStatusDurations({ projectId: '20000' })).toHaveLength(1);
    expect(await store.queryIssueMeta({ projectId: '20000', limit: 100 })).toHaveLength(1);
  });

  it('paginates deterministically', async () => {
    const store = await seededStore();
    const first = await store.queryIssueMeta({ projectId: '10000', limit: 1 });
    const second = await store.queryIssueMeta({ projectId: '10000', limit: 1, offset: 1 });
    expect(first[0]?.issueId).toBe('1');
    expect(second[0]?.issueId).toBe('2');
    expect(
      await store.queryStatusDurations({ projectId: '10000', limit: 2, offset: 2 }),
    ).toHaveLength(2);
  });

  it('filters aggregate rows by status', async () => {
    const store = await seededStore();
    const rows = await store.queryStatusDurations({ projectId: '10000', statusIds: ['3'] });
    expect(rows.map((r) => r.issueId)).toEqual(['1', '2']);
  });

  it('deletes an issue and everything attached to it', async () => {
    const store = await seededStore();
    await store.putWorklogs('1', [
      {
        worklogId: 'w1',
        issueId: '1',
        issueKey: 'FLOW-1',
        projectId: '10000',
        authorAccountId: 'acc-anna',
        authorDisplayName: 'Anna Weber',
        startedAt: NOW,
        timeSpentMs: HOUR,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
    await store.deleteIssue('1');
    expect(await store.getIssueMeta('1')).toBeNull();
    expect(await store.queryWorklogs({ projectId: '10000' })).toHaveLength(0);
    expect(store.aggregateRowCount).toBe(2);
  });

  it('widens the first/last seen window of status metadata', async () => {
    const store = new MemoryStore();
    await store.upsertStatusMeta([
      {
        statusId: '3',
        name: 'In Progress',
        category: 'inprogress',
        firstSeenAt: 500,
        lastSeenAt: 600,
      },
    ]);
    await store.upsertStatusMeta([
      { statusId: '3', name: 'Doing', category: 'inprogress', firstSeenAt: 100, lastSeenAt: 900 },
    ]);
    const rows = await store.getStatusMeta();
    expect(rows[0]).toMatchObject({ name: 'Doing', firstSeenAt: 100, lastSeenAt: 900 });
  });

  it('keeps a rename history keyed on status id', async () => {
    const store = new MemoryStore();
    await store.recordStatusNames([
      { statusId: '3', name: 'In Progress', firstSeenAt: 100, lastSeenAt: 200 },
      { statusId: '3', name: 'Doing', firstSeenAt: 300, lastSeenAt: 400 },
      { statusId: '3', name: 'In Progress', firstSeenAt: 50, lastSeenAt: 500 },
    ]);
    const history = await store.getStatusNameHistory('3');
    expect(history).toEqual([
      { statusId: '3', name: 'In Progress', firstSeenAt: 50, lastSeenAt: 500 },
      { statusId: '3', name: 'Doing', firstSeenAt: 300, lastSeenAt: 400 },
    ]);
    expect(await store.getStatusNameHistory('nope')).toEqual([]);
  });

  it('filters worklogs by window and author', async () => {
    const store = new MemoryStore();
    const base = {
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      timeSpentMs: HOUR,
      createdAt: null,
      updatedAt: null,
    };
    await store.putWorklogs('1', [
      {
        ...base,
        worklogId: 'a',
        authorAccountId: 'anna',
        authorDisplayName: 'Anna',
        startedAt: 1000,
      },
      {
        ...base,
        worklogId: 'b',
        authorAccountId: 'ben',
        authorDisplayName: 'Ben',
        startedAt: 2000,
      },
    ]);
    expect(await store.queryWorklogs({ projectId: '10000', from: 1500 })).toHaveLength(1);
    expect(await store.queryWorklogs({ projectId: '10000', to: 1500 })).toHaveLength(1);
    expect(
      await store.queryWorklogs({ projectId: '10000', authorAccountIds: ['anna'] }),
    ).toHaveLength(1);
    expect(await store.queryWorklogs({ projectId: '10000', limit: 1, offset: 1 })).toHaveLength(1);
  });

  it('filters history by field, author and window', async () => {
    const store = new MemoryStore();
    const base = {
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      authorDisplayName: 'Anna',
      fromValue: null,
      toValue: null,
      fromId: null,
      toId: null,
    };
    await store.putHistory('1', [
      {
        ...base,
        changeId: 'a',
        at: 1000,
        authorAccountId: 'anna',
        field: 'status',
        fieldLabel: 'status',
      },
      {
        ...base,
        changeId: 'b',
        at: 2000,
        authorAccountId: null,
        field: 'summary',
        fieldLabel: 'summary',
      },
    ]);
    expect(await store.queryHistory({ projectId: '10000' })).toHaveLength(2);
    expect(await store.queryHistory({ projectId: '10000', fields: ['STATUS'] })).toHaveLength(1);
    expect(
      await store.queryHistory({ projectId: '10000', authorAccountIds: ['anna'] }),
    ).toHaveLength(1);
    expect(await store.queryHistory({ projectId: '10000', from: 1500, to: 2500 })).toHaveLength(1);
    expect(await store.queryHistory({ projectId: '10000', limit: 1 })).toHaveLength(1);
  });

  it('tracks index state per project', async () => {
    const store = new MemoryStore();
    expect(await store.getIndexState('10000')).toBeNull();
    await store.putIndexState({
      projectId: '10000',
      state: 'running',
      backfillCursor: 'abc',
      backfillFrom: null,
      issuesProcessed: 5,
      issuesTotal: 10,
      lastProcessedAt: null,
      lastError: null,
      startedAt: NOW,
      updatedAt: NOW,
    });
    expect((await store.getIndexState('10000'))?.backfillCursor).toBe('abc');
    expect(await store.listIndexStates()).toHaveLength(1);
  });

  it('estimates its own footprint', async () => {
    const store = await seededStore();
    const bytes = await store.estimateBytes();
    expect(bytes).toBeGreaterThan(0);
    expect(await new MemoryStore().estimateBytes()).toBe(0);
  });
});

describe('store counts — the real totals behind capped pages', () => {
  it('counts issue meta per project regardless of any page size', async () => {
    const store = await seededStore();
    expect(await store.countIssueMeta({ projectId: '10000' })).toBe(2);
    expect(await store.countIssueMeta({ projectId: '99999' })).toBe(0);
  });

  it('lists the distinct status ids one project has actually used', async () => {
    const store = await seededStore();
    await store.putIssueAggregate(meta({ issueId: '9', projectId: '20000' }), [agg('9', '99', 1)]);
    expect(await store.listProjectStatusIds('10000')).toEqual(['10000', '10001', '3']);
    expect(await store.listProjectStatusIds('20000')).toEqual(['99']);
    expect(await store.listProjectStatusIds('30000')).toEqual([]);
  });

  it('counts worklogs with the same filters the query applies', async () => {
    const store = new MemoryStore();
    const base = {
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      timeSpentMs: HOUR,
      createdAt: null,
      updatedAt: null,
    };
    await store.putWorklogs('1', [
      {
        ...base,
        worklogId: 'a',
        authorAccountId: 'anna',
        authorDisplayName: 'Anna',
        startedAt: NOW - HOUR,
      },
      {
        ...base,
        worklogId: 'b',
        authorAccountId: 'ben',
        authorDisplayName: 'Ben',
        startedAt: NOW - 2 * HOUR,
      },
    ]);
    expect(await store.countWorklogs({ projectId: '10000' })).toBe(2);
    expect(await store.countWorklogs({ projectId: '10000', authorAccountIds: ['ben'] })).toBe(1);
    // limit/offset are page concerns and must not change the total.
    expect(await store.countWorklogs({ projectId: '10000', limit: 1 })).toBe(2);
  });

  it('counts history with the same filters the query applies', async () => {
    const store = new MemoryStore();
    const base = {
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      at: NOW - HOUR,
      authorAccountId: 'anna',
      authorDisplayName: 'Anna',
      fromValue: null,
      toValue: 'Done',
      fromId: null,
      toId: '10001',
    };
    await store.putHistory('1', [
      { ...base, changeId: 'a', field: 'status', fieldLabel: 'status' },
      { ...base, changeId: 'b', field: 'assignee', fieldLabel: 'assignee' },
    ]);
    expect(await store.countHistory({ projectId: '10000' })).toBe(2);
    expect(await store.countHistory({ projectId: '10000', fields: ['status'] })).toBe(1);
    expect(await store.countHistory({ projectId: '10000', limit: 1 })).toBe(2);
  });
});

describe('status report assembly', () => {
  it('lays statuses out in workflow order and fills gaps with zero', async () => {
    const store = await seededStore();
    const report = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      limit: 10,
      offset: 0,
    });
    expect(report.columns.map((c) => c.name)).toEqual(['To Do', 'In Progress', 'Done']);
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0]?.byStatus['3']).toBe(10 * HOUR);
    expect(report.rows[1]?.byStatus['10000']).toBeUndefined();
    expect(report.rows[1]?.totalMs).toBe(5 * HOUR);
    expect(report.issueCount).toBe(2);
  });

  it('surfaces incomplete history rather than hiding it', async () => {
    const store = await seededStore();
    const report = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      limit: 10,
      offset: 0,
    });
    expect(report.anyTruncated).toBe(true);
    expect(report.rows.find((r) => r.issueId === '2')?.truncated).toBe(true);
  });

  it('switches between elapsed and business bases', async () => {
    const store = await seededStore();
    const business = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'business',
      limit: 10,
      offset: 0,
    });
    expect(business.rows[0]?.byStatus['3']).toBe(5 * HOUR);
    expect(business.basis).toBe('business');
  });

  it('★ says when the project holds more issues than the page could fetch', async () => {
    const store = await seededStore();
    const capped = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      limit: 1,
      offset: 0,
    });
    // Two issues stored, a one-issue page: the report must say so, because a
    // capped page that looks complete is the silent-ceiling failure of
    // TECHNICAL-SPEC § 11.1.
    expect(capped.matchingIssueCount).toBe(2);
    expect(capped.capped).toBe(true);
    expect(capped.rows).toHaveLength(1);

    const complete = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      limit: 10,
      offset: 0,
    });
    expect(complete.matchingIssueCount).toBe(2);
    expect(complete.capped).toBe(false);
  });

  it('summarises each status across the result set', async () => {
    const store = await seededStore();
    const report = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      limit: 10,
      offset: 0,
    });
    expect(report.summaryByStatus['3']?.count).toBe(2);
    expect(report.summaryByStatus['3']?.medianMs).toBe(7 * HOUR);
  });

  it('filters by assignee, issue type and creation window', async () => {
    const store = await seededStore();
    const byAssignee = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      limit: 10,
      offset: 0,
      assigneeAccountIds: ['acc-ben'],
    });
    expect(byAssignee.rows.map((r) => r.issueId)).toEqual(['2']);

    const byType = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      limit: 10,
      offset: 0,
      issueTypeIds: ['10002'],
    });
    expect(byType.rows.map((r) => r.issueId)).toEqual(['1']);

    const byWindow = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      limit: 10,
      offset: 0,
      createdFrom: T('2026-03-02T00:00:00Z'),
    });
    expect(byWindow.rows.map((r) => r.issueId)).toEqual(['2']);

    const empty = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      limit: 10,
      offset: 0,
      createdTo: T('2026-01-01T00:00:00Z'),
    });
    expect(empty.rows).toHaveLength(0);
    expect(empty.columns).toHaveLength(0);
  });

  it('carries the visit count that Jira does not report', async () => {
    const store = await seededStore();
    const report = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      limit: 10,
      offset: 0,
    });
    expect(report.rows[0]?.entriesByStatus['3']).toBe(1);
  });
});

describe('CSV export', () => {
  it('defuses spreadsheet formula injection', () => {
    // A status renamed to "=HYPERLINK(...)" must not execute in Excel.
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+44 123')).toBe("'+44 123");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tTAB')).toBe("'\tTAB");
    expect(csvCell('plain')).toBe('plain');
  });

  it('leaves a real negative number numeric — a number cannot carry a formula', () => {
    // Observed live: the SLA export's Remaining column rendered -50.09 as
    // "'-50.09", which a spreadsheet reads as text and cannot sum. Only the
    // *string* "-5" is defused; the number -5 is not.
    expect(csvCell(-50.09)).toBe('-50.09');
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(Number.NaN)).toBe('NaN');
  });

  it('quotes and escapes per RFC 4180', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(42)).toBe('42');
    expect(toCsv([['a', 'b'], ['c']])).toBe('a,b\r\nc');
  });

  it('renders a status report with durations, visit counts and completeness', async () => {
    const store = await seededStore();
    const report = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      limit: 10,
      offset: 0,
    });
    const csv = statusReportToCsv(report, { durationFormat: 'hours' });
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(
      'Issue key,Current status,Created,Resolved,To Do,In Progress,Done,' +
        'To Do (times entered),In Progress (times entered),Done (times entered),' +
        'Total,History complete',
    );
    expect(lines[1]).toContain('FLOW-1');
    expect(lines[1]).toContain('2,10,0');
    expect(lines[1]?.endsWith('complete')).toBe(true);
    expect(lines[2]?.endsWith('partial')).toBe(true);
  });

  it('supports the three duration formats', async () => {
    const store = await seededStore();
    const report = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      limit: 1,
      offset: 0,
    });
    expect(statusReportToCsv(report, { durationFormat: 'ms' })).toContain(String(10 * HOUR));
    expect(statusReportToCsv(report, { durationFormat: 'duration' })).toContain('1d 2h');
    expect(statusReportToCsv(report, { includeEntryCounts: false })).not.toContain('times entered');
  });

  it('renders a generic table', () => {
    expect(tableToCsv(['a', 'b'], [[1, 2]])).toBe('a,b\r\n1,2');
  });
});

describe('pricing', () => {
  it('is free at or below ten users, as the whole niche is', () => {
    for (const pricing of ALL_PRICING) {
      expect(pricing.freeUpToUsers).toBe(10);
      expect(monthlyPrice(pricing, 10)).toBe(0);
      expect(monthlyPrice(pricing, 1)).toBe(0);
    }
  });

  it('hits the intended entry price at fifty users', () => {
    expect(monthlyPrice(TIME_IN_STATUS_PRICING, 50)).toBe(325);
    expect(monthlyPrice(WORKLOG_PRICING, 50)).toBe(250);
    expect(monthlyPrice(ISSUE_HISTORY_PRICING, 50)).toBe(375);
  });

  it('undercuts the incumbent it is priced against, on every listing', () => {
    for (const pricing of ALL_PRICING) {
      expect(monthlyPrice(pricing, 50)).toBeLessThanOrEqual(pricing.positioning.againstAt50Usd);
    }
  });

  it('records honestly where it is NOT the cheapest option', () => {
    // The worklog niche has two large apps at $200 and this listing sells at
    // $250. Claiming "cheapest" there would be false, and the positioning data
    // says so rather than papering over it.
    const worklog = WORKLOG_PRICING;
    expect(monthlyPrice(worklog, 50)).toBeGreaterThan(worklog.positioning.cheapestPaidAt50Usd);
    // For time in status the binding competitor is free, not cheap.
    expect(TIME_IN_STATUS_PRICING.positioning.notableFreeCompetitor).toContain('FREE');
  });

  it('is monotonic and tiers downward per seat', () => {
    for (const pricing of ALL_PRICING) {
      const ladder = priceLadder(pricing);
      for (let i = 1; i < ladder.length; i += 1) {
        expect(ladder[i]!.usd).toBeGreaterThan(ladder[i - 1]!.usd);
      }
      const perSeatAt100 = monthlyPrice(pricing, 100) / 100;
      const perSeatAt500 = monthlyPrice(pricing, 500) / 500;
      expect(perSeatAt500).toBeLessThan(perSeatAt100);
    }
  });

  it('labels modelled revenue as resting on an assumption', () => {
    const modelled = modelledMonthlyRevenueUsd(TIME_IN_STATUS_PRICING, 150);
    expect(modelled.usd).toBe(150 * 0.25 * 325);
    expect(modelled.payingShare).toBe(0.25);
    expect(modelled.assumption).toContain('ASSUMED');
    expect(modelledMonthlyRevenueUsd(TIME_IN_STATUS_PRICING, 150, { payingShare: 0.1 }).usd).toBe(
      150 * 0.1 * 325,
    );
  });
});

describe('Forge cost model', () => {
  it('sizes the reference instance at roughly 16 MB', () => {
    const storage = estimateStorage(REFERENCE_PROFILE, DATASETS_TIME_IN_STATUS);
    expect(storage.megabytes).toBeGreaterThan(14);
    expect(storage.megabytes).toBeLessThan(22);
  });

  it('fits tens of installs inside the free Forge SQL allowance', () => {
    const storage = estimateStorage(REFERENCE_PROFILE, DATASETS_TIME_IN_STATUS);
    const cost = estimateMonthlySqlCost(storage, 1);
    expect(cost.usd).toBe(0);
    expect(cost.installsWithinFreeTier).toBeGreaterThan(30);
  });

  it('charges only past the free allowance', () => {
    const storage = estimateStorage(REFERENCE_PROFILE, DATASETS_TIME_IN_STATUS);
    const many = estimateMonthlySqlCost(storage, 500);
    expect(many.billableGbHours).toBeGreaterThan(0);
    expect(many.usd).toBeGreaterThan(0);
    // Even at 500 installs the storage bill stays small; compute and request
    // volume are the real constraints, which is the point of the model.
    expect(many.usd).toBeLessThan(10);
  });

  it('treats an empty footprint as unbounded free installs', () => {
    expect(
      estimateMonthlySqlCost({ bytes: 0, megabytes: 0, gigabytes: 0 }, 10).installsWithinFreeTier,
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it('estimates request volume, which is what actually limits a backfill', () => {
    const volume = estimateIngestVolume(REFERENCE_PROFILE, {
      issuesPerSlice: 100,
      pageSize: 50,
      relevantUpdatesPerMonth: 2000,
    });
    expect(volume.backfillRequests).toBe(400 + 2000);
    expect(volume.backfillSlices).toBe(200);
    expect(volume.monthlyRequests).toBe(4000);
  });
});

/**
 * The filters used to be applied after the page had been fetched. These are
 * the three failures that produced, each of which needs a project bigger than
 * one page to show itself — which is why none of them appeared in the suite
 * that existed while the filtering was in memory.
 */
describe('★ report filters are evaluated by the store, not after the page', () => {
  /** Six issues, alternating assignee, one per day. */
  async function mixedStore(): Promise<MemoryStore> {
    const store = new MemoryStore();
    await store.migrate();
    await store.upsertStatusMeta([
      {
        statusId: '3',
        name: 'In Progress',
        category: 'inprogress',
        firstSeenAt: 0,
        lastSeenAt: NOW,
      },
    ]);
    await store.putIssueAggregates(
      Array.from({ length: 6 }, (_, index) => ({
        meta: meta({
          issueId: String(index + 1),
          assigneeAccountId: index % 2 === 0 ? 'acc-anna' : 'acc-ben',
          issueTypeId: index < 3 ? '10002' : '10003',
          createdAt: T('2026-03-01T00:00:00Z') + index * 86_400_000,
        }),
        rows: [agg(String(index + 1), '3', index + 1)],
      })),
    );
    return store;
  }

  it('pages through a filtered set instead of paging first and filtering after', async () => {
    const store = await mixedStore();
    const query = {
      projectId: '10000',
      basis: 'elapsed' as const,
      assigneeAccountIds: ['acc-anna'],
      limit: 2,
    };
    const first = await buildStatusReport(store, { ...query, offset: 0 });
    const second = await buildStatusReport(store, { ...query, offset: 2 });

    // Anna has issues 1, 3 and 5. Fetching `limit + offset` rows unfiltered
    // and slicing afterwards gave page two of [1,3] — rows 2 and 3 of a
    // four-row window that only held two matches — so the third match was
    // unreachable through paging at all.
    expect(first.rows.map((r) => r.issueId)).toEqual(['1', '3']);
    expect(second.rows.map((r) => r.issueId)).toEqual(['5']);
  });

  it('counts the matching issues, not the ones inside the fetched window', async () => {
    const store = await mixedStore();
    const report = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      assigneeAccountIds: ['acc-anna'],
      limit: 1,
      offset: 0,
    });
    // Three of the six are Anna's. The old code counted the matches inside a
    // one-row fetch, so this reported 1 — a page length wearing a total's
    // name, the same failure TECHNICAL-SPEC § 11.1 records for the unfiltered
    // path.
    expect(report.matchingIssueCount).toBe(3);
    expect(report.issueCount).toBe(1);
    expect(report.capped).toBe(true);
  });

  it('does not call a filtered report capped when every match is on the page', async () => {
    const store = await mixedStore();
    const report = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      issueTypeIds: ['10003'],
      limit: 500,
      offset: 0,
    });
    // Three matches, all shown. The old test compared the page against the
    // *project* total of six, so every filtered report — however complete —
    // rendered the "every figure on this page is a lower bound" banner.
    expect(report.rows).toHaveLength(3);
    expect(report.matchingIssueCount).toBe(3);
    expect(report.capped).toBe(false);
  });

  it('filters on created date as a half-open range', async () => {
    const store = await mixedStore();
    const report = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      createdFrom: T('2026-03-02T00:00:00Z'),
      createdTo: T('2026-03-04T00:00:00Z'),
      limit: 500,
      offset: 0,
    });
    // `[from, to)` — issue 4, created exactly at `createdTo`, is excluded,
    // matching every other range filter in the store.
    expect(report.rows.map((r) => r.issueId)).toEqual(['2', '3']);
  });

  it('treats an empty id list as no filter rather than as matching nothing', async () => {
    const store = await mixedStore();
    const report = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      assigneeAccountIds: [],
      limit: 500,
      offset: 0,
    });
    expect(report.rows).toHaveLength(6);
  });

  it('excludes an unassigned issue from an assignee filter without dropping it otherwise', async () => {
    const store = await mixedStore();
    await store.putIssueAggregate(meta({ issueId: '7', assigneeAccountId: null }), [
      agg('7', '3', 1),
    ]);
    const filtered = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      assigneeAccountIds: ['acc-anna'],
      limit: 500,
      offset: 0,
    });
    const unfiltered = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      limit: 500,
      offset: 0,
    });
    expect(filtered.rows.map((r) => r.issueId)).not.toContain('7');
    expect(unfiltered.rows.map((r) => r.issueId)).toContain('7');
  });
});
