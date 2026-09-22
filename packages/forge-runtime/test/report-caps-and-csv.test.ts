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
import { RecordingSqlExecutor } from '../src/sql/executor.js';
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
    // Jira's own catalogue, read as the calling user, is the honest
    // substitute: it keeps the picker usable and says nothing about which
    // project uses what. The stub reports only status `3`, so `77` — which
    // exists solely in the stored table — must not appear.
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
