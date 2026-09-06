import { describe, expect, it } from 'vitest';
import type { WorklogAggregateResult } from '@jfm/engine';
import type { AgingReport, HistoryReport, SlaReport } from '@jfm/forge-runtime';
import {
  toAgingChartData,
  toAgingTable,
  toAgingTiles,
  toHistoryTable,
  toHistoryTiles,
  toSlaTable,
  toSlaTiles,
  toWorklogTable,
  toWorklogTiles,
} from '../src/listing-models.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.parse('2026-03-10T12:00:00Z');

const worklog: WorklogAggregateResult = {
  groups: [
    { key: 'anna', label: 'Anna', timeSpentMs: 6 * HOUR, entries: 3, issueCount: 2 },
    { key: 'ben', label: 'Ben', timeSpentMs: 2 * HOUR, entries: 1, issueCount: 1 },
  ],
  totalMs: 8 * HOUR,
  entries: 4,
  windowFrom: null,
  windowTo: null,
};

const aging: AgingReport = {
  rows: [
    {
      issueId: '2',
      issueKey: 'FLOW-2',
      statusId: '3',
      statusName: 'In Progress',
      ageInStatusMs: 40 * DAY,
      ageInStatusBusinessMs: 30 * HOUR,
      ageTotalMs: 60 * DAY,
      enteredStatusAt: NOW - 40 * DAY,
    },
  ],
  buckets: [
    { label: '0-1d', count: 0 },
    { label: '1-3d', count: 1 },
    { label: '3-7d', count: 0 },
    { label: '7-14d', count: 0 },
    { label: '14-30d', count: 2 },
    { label: '30d+', count: 1 },
  ],
  evaluatedAt: NOW,
  excludedDone: 5,
};

const sla: SlaReport = {
  goalId: 'g',
  goalName: 'Time in progress',
  rows: [
    {
      issueId: '2',
      issueKey: 'FLOW-2',
      consumedMs: 30 * HOUR,
      targetMs: 8 * HOUR,
      remainingMs: -22 * HOUR,
      breached: true,
      consumedFraction: 3.75,
      dueDate: {
        issueId: '2',
        issueKey: 'FLOW-2',
        dueAt: NOW - DAY,
        resolvedAt: null,
        breached: true,
        overdueByMs: DAY,
      },
    },
    {
      issueId: '1',
      issueKey: 'FLOW-1',
      consumedMs: 6 * HOUR,
      targetMs: 8 * HOUR,
      remainingMs: 2 * HOUR,
      breached: false,
      consumedFraction: 0.75,
      dueDate: {
        issueId: '1',
        issueKey: 'FLOW-1',
        dueAt: null,
        resolvedAt: null,
        breached: false,
        overdueByMs: null,
      },
    },
  ],
  breachedCount: 1,
  attainment: 0.5,
  dueDateBreaches: 1,
};

const history: HistoryReport = {
  records: [
    {
      changeId: 'a',
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      at: NOW - DAY,
      authorAccountId: 'anna',
      authorDisplayName: 'Anna',
      field: 'status',
      fieldLabel: 'status',
      fromValue: null,
      toValue: 'Done',
      fromId: null,
      toId: '10001',
    },
  ],
  byField: [{ field: 'status', fieldLabel: 'status', changes: 1, issues: 1, authors: 1 }],
  total: 1,
};

describe('worklog view model', () => {
  it('shows shares that add up and states what the totals mean', () => {
    const table = toWorklogTable(worklog, 'Person');
    expect(table.headers[0]).toBe('Person');
    expect(table.rows[0]).toEqual(['Anna', '6h', '75%', '3', '2']);
    expect(table.footnotes[0]).toContain('durations people entered in Jira');
  });

  it('says so plainly when there are no worklogs', () => {
    const empty = toWorklogTable({ ...worklog, groups: [], totalMs: 0, entries: 0 }, 'Person');
    expect(empty.rows).toHaveLength(0);
    expect(empty.footnotes[0]).toContain('No worklogs');
    expect(toWorklogTiles({ ...worklog, groups: [], totalMs: 0, entries: 0 })[1]?.value).toBe('—');
  });

  it('avoids dividing by a zero total', () => {
    const table = toWorklogTable({ ...worklog, totalMs: 0 }, 'Person');
    expect(table.rows[0]?.[2]).toBe('—');
  });

  it('summarises the total and the largest contributor', () => {
    const tiles = toWorklogTiles(worklog);
    expect(tiles[0]?.value).toBe('8h');
    expect(tiles[1]?.value).toBe('Anna');
  });
});

describe('aging view model', () => {
  it('lists in-flight issues and explains the exclusions', () => {
    const table = toAgingTable(aging);
    expect(table.rows[0]?.[0]).toBe('FLOW-2');
    expect(table.rows[0]?.[2]).toBe('5w 5d');
    expect(table.footnotes[0]).toContain('5 finished issues are excluded');
    expect(table.footnotes[1]).toContain('shown separately rather than blended in');
  });

  it('counts stale work across the two oldest buckets', () => {
    const tiles = toAgingTiles(aging);
    expect(tiles[0]?.value).toBe('1');
    expect(tiles[2]).toMatchObject({ label: 'Older than 14 days', value: '3' });
  });

  it('handles an empty board', () => {
    const tiles = toAgingTiles({ ...aging, rows: [] });
    expect(tiles[1]?.value).toBe('—');
    expect(tiles[1]?.hint).toBe('Nothing in flight.');
  });

  it('exposes the histogram as chart data', () => {
    expect(toAgingChartData(aging)[5]).toEqual({ label: '30d+', value: 1 });
  });
});

describe('SLA view model', () => {
  it('states overrun in words rather than as a negative duration', () => {
    const table = toSlaTable(sla);
    expect(table.rows[0]?.[3]).toBe('over by 22h');
    expect(table.rows[0]?.[4]).toBe('Breached');
    expect(table.rows[1]?.[3]).toBe('2h');
  });

  it('describes due dates including "no due date"', () => {
    const table = toSlaTable(sla);
    expect(table.rows[0]?.[5]).toContain('late by');
    expect(table.rows[1]?.[5]).toBe('—');
  });

  it('warns that this is a counted-statuses goal, not a pause timer', () => {
    expect(toSlaTable(sla).footnotes[1]).toContain('not a start/stop/pause timer');
  });

  it('reports attainment, breaches and late issues', () => {
    const tiles = toSlaTiles(sla);
    expect(tiles[0]?.value).toBe('50%');
    expect(tiles[1]?.value).toBe('1');
    expect(tiles[2]?.value).toBe('1');
    expect(toSlaTiles({ ...sla, attainment: null })[0]?.value).toBe('—');
  });
});

describe('history view model', () => {
  it('renders a change per row with em dashes for absent values', () => {
    const table = toHistoryTable(history);
    expect(table.rows[0]).toEqual(['9 Mar 2026', 'FLOW-1', 'status', '—', 'Done', 'Anna']);
    expect(table.footnotes[0]).toContain('cross-issue, filterable and exportable');
  });

  it('names the busiest field', () => {
    expect(toHistoryTiles(history)[1]?.value).toBe('status');
    expect(toHistoryTiles({ ...history, byField: [], total: 0 })[1]?.value).toBe('—');
  });
});
