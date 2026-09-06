import { describe, expect, it } from 'vitest';
import { reconstructTimeline } from '../src/changelog/reconstruct.js';
import {
  categoryResolver,
  computeCycleTime,
  percentile,
  summariseDurations,
} from '../src/metrics/cycle-time.js';
import {
  aggregateWorklogs,
  formatJiraDuration,
  isoWeekKey,
  toWorklogRecord,
  type WorklogRecord,
} from '../src/metrics/worklog.js';
import {
  bucketByAge,
  computeAging,
  computeRunChart,
  enumerateDays,
} from '../src/metrics/wip-aging.js';
import { evaluateDueDate, evaluateSla, attainmentRate, type SlaGoal } from '../src/metrics/sla.js';
import { describeIndexError } from '../src/ingest/backfill.js';
import { filterHistory, summariseByField, toHistoryRecords } from '../src/metrics/history.js';
import { parseJiraTimestamp, requireJiraTimestamp, toStatusCategory } from '../src/jira/parse.js';
import { normaliseCalendar, standardBusinessCalendar } from '../src/time/calendar.js';
import { EngineError } from '../src/types.js';
import type { JiraChangelogPage, JiraWorklogPage } from '../src/jira/types.js';
import {
  loadFixture,
  reentryTimeline,
  T,
  TEST_RESOLVER,
  UTC_BUSINESS_CALENDAR,
} from './helpers.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = T('2026-03-05T12:00:00Z');

describe('Jira timestamp parsing', () => {
  it('parses the colonless offset Jira actually emits', () => {
    expect(parseJiraTimestamp('2026-03-01T09:15:00.000+0100')).toBe(T('2026-03-01T08:15:00Z'));
    expect(parseJiraTimestamp('2026-03-01T09:15:00.000-0530')).toBe(T('2026-03-01T14:45:00Z'));
    expect(parseJiraTimestamp('2026-03-01T09:15:00.000+01:00')).toBe(T('2026-03-01T08:15:00Z'));
    expect(parseJiraTimestamp('2026-03-01T09:15:00Z')).toBe(T('2026-03-01T09:15:00Z'));
  });

  it('treats an offsetless timestamp as UTC', () => {
    expect(parseJiraTimestamp('2026-03-01T09:15:00')).toBe(T('2026-03-01T09:15:00Z'));
  });

  it('pads and truncates fractional seconds', () => {
    expect(parseJiraTimestamp('2026-03-01T09:15:00.5Z')).toBe(T('2026-03-01T09:15:00.500Z'));
    expect(parseJiraTimestamp('2026-03-01T09:15:00.123456Z')).toBe(T('2026-03-01T09:15:00.123Z'));
  });

  it('never returns NaN', () => {
    expect(parseJiraTimestamp('not a date')).toBeNull();
    expect(parseJiraTimestamp('')).toBeNull();
    expect(parseJiraTimestamp(null)).toBeNull();
    expect(parseJiraTimestamp(undefined)).toBeNull();
    expect(parseJiraTimestamp('2026-03-01T09:15:00.000+9')).toBeNull();
  });

  it('throws only where a timestamp is mandatory', () => {
    expect(() => requireJiraTimestamp(null, 'issue created')).toThrow(EngineError);
    expect(requireJiraTimestamp('2026-03-01T00:00:00Z', 'x')).toBe(T('2026-03-01T00:00:00Z'));
  });

  it('maps Jira status category keys', () => {
    expect(toStatusCategory('new')).toBe('todo');
    expect(toStatusCategory('indeterminate')).toBe('inprogress');
    expect(toStatusCategory('done')).toBe('done');
    expect(toStatusCategory('something-else')).toBe('unknown');
    expect(toStatusCategory(undefined)).toBe('unknown');
  });
});

describe('cycle and lead time', () => {
  it('measures from first in-progress to first done', () => {
    const result = computeCycleTime(reentryTimeline(), TEST_RESOLVER, { now: NOW });
    // Created Mon 08:00, started Mon 09:00, done Thu 11:30.
    expect(result.startedAt).toBe(T('2026-03-02T09:00:00Z'));
    expect(result.completedAt).toBe(T('2026-03-05T11:30:00Z'));
    expect(result.leadTimeMs).toBe(T('2026-03-05T11:30:00Z') - T('2026-03-02T08:00:00Z'));
    expect(result.cycleTimeMs).toBe(T('2026-03-05T11:30:00Z') - T('2026-03-02T09:00:00Z'));
    expect(result.reopenCount).toBe(0);
  });

  it('computes flow efficiency from in-progress versus waiting time', () => {
    const result = computeCycleTime(reentryTimeline(), TEST_RESOLVER, { now: NOW });
    // Inside the cycle span: In Progress 12h + In Review 18.5h = 30.5h working,
    // Blocked 44h waiting (Blocked is a todo-category status in the fixture).
    expect(result.flowEfficiency).toBeCloseTo(30.5 / (30.5 + 44), 10);
  });

  it('reports business-hours variants when a calendar is supplied', () => {
    const result = computeCycleTime(reentryTimeline(), TEST_RESOLVER, {
      now: NOW,
      calendar: UTC_BUSINESS_CALENDAR,
    });
    // Cycle span Mon 09:00 -> Thu 11:30: Mon 8h, Tue 8h, Wed 8h, Thu 2.5h.
    expect(result.cycleTimeBusinessMs).toBe(26.5 * HOUR);
    // Lead span starts Mon 08:00, which is outside the window, so it matches.
    expect(result.leadTimeBusinessMs).toBe(26.5 * HOUR);
  });

  it('has no cycle time for an issue that never started', () => {
    const timeline = reconstructTimeline({
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      createdAt: T('2026-03-02T08:00:00Z'),
      currentStatusId: '10000',
      currentStatusName: 'To Do',
      entries: [],
    });
    const result = computeCycleTime(timeline, TEST_RESOLVER, { now: NOW });
    expect(result.cycleTimeMs).toBeNull();
    expect(result.leadTimeMs).toBeNull();
    expect(result.flowEfficiency).toBeNull();
  });

  it('counts reopens without letting them erase the completion date', () => {
    const timeline = reconstructTimeline({
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      createdAt: T('2026-03-01T00:00:00Z'),
      currentStatusId: '10001',
      currentStatusName: 'Done',
      entries: [
        entry('1', '2026-03-02T09:00:00.000+0000', '10000', 'To Do', '3', 'In Progress'),
        entry('2', '2026-03-03T09:00:00.000+0000', '3', 'In Progress', '10001', 'Done'),
        entry('3', '2026-03-04T09:00:00.000+0000', '10001', 'Done', '3', 'In Progress'),
        entry('4', '2026-03-05T09:00:00.000+0000', '3', 'In Progress', '10001', 'Done'),
      ],
    });
    const result = computeCycleTime(timeline, TEST_RESOLVER, { now: NOW });
    expect(result.completedAt).toBe(T('2026-03-03T09:00:00Z'));
    expect(result.reopenCount).toBe(1);
  });

  it('resolves unknown statuses rather than throwing', () => {
    const resolver = categoryResolver([]);
    expect(resolver.categoryOf('anything')).toBe('unknown');
  });

  it('summarises a right-skewed distribution with percentiles', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([5], 0.5)).toBe(5);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4], 1)).toBe(4);
    expect(percentile([1, 2, 3, 4], 5)).toBe(4); // clamped

    const summary = summariseDurations([1, 2, null, 100]);
    expect(summary.count).toBe(3);
    expect(summary.medianMs).toBe(2);
    expect(summary.maxMs).toBe(100);
    expect(summariseDurations([]).count).toBe(0);
    expect(summariseDurations([null]).medianMs).toBeNull();
  });
});

describe('worklog aggregation', () => {
  const context = { issueId: '20001', issueKey: 'FLOW-1', projectId: '10000' };

  function fixtureRecords(): WorklogRecord[] {
    const page = loadFixture<JiraWorklogPage>('worklogs.json');
    return (page.worklogs ?? [])
      .map((w) => toWorklogRecord(w, context))
      .filter((w): w is WorklogRecord => w !== null);
  }

  it('drops entries Jira returns without a duration', () => {
    const page = loadFixture<JiraWorklogPage>('worklogs.json');
    expect(page.worklogs).toHaveLength(4);
    expect(fixtureRecords()).toHaveLength(3);
  });

  it('rejects malformed entries rather than counting them as zero', () => {
    expect(toWorklogRecord({ id: '1', started: '2026-03-01T00:00:00Z' }, context)).toBeNull();
    expect(
      toWorklogRecord({ started: '2026-03-01T00:00:00Z', timeSpentSeconds: 60 }, context),
    ).toBeNull();
    expect(toWorklogRecord({ id: '1', timeSpentSeconds: 60 }, context)).toBeNull();
    expect(
      toWorklogRecord({ id: '1', started: '2026-03-01T00:00:00Z', timeSpentSeconds: -60 }, context),
    ).toBeNull();
  });

  it('falls back to created when started is absent', () => {
    const record = toWorklogRecord(
      { id: '1', created: '2026-03-01T10:00:00.000+0000', timeSpentSeconds: 60 },
      context,
    );
    expect(record?.startedAt).toBe(T('2026-03-01T10:00:00Z'));
  });

  it('groups by author, largest first', () => {
    const result = aggregateWorklogs(fixtureRecords(), { groupBy: 'author' });
    expect(result.totalMs).toBe((10800 + 7200 + 5400) * 1000);
    expect(result.entries).toBe(3);
    expect(result.groups.map((g) => [g.label, g.timeSpentMs / HOUR])).toEqual([
      ['Anna Weber', 4.5],
      ['Ben Fischer', 2],
    ]);
    expect(result.groups[0]?.issueCount).toBe(1);
  });

  it('groups by day chronologically in the calendar timezone', () => {
    const result = aggregateWorklogs(fixtureRecords(), {
      groupBy: 'day',
      calendar: UTC_BUSINESS_CALENDAR,
    });
    expect(result.groups.map((g) => g.key)).toEqual(['2026-03-02', '2026-03-04']);
  });

  it('bucketing follows the timezone, not UTC', () => {
    const records = fixtureRecords();
    // The three worklogs start at 03-02T09:00Z, 03-02T13:00Z and 03-04T08:30Z.
    const auckland = aggregateWorklogs(records, { groupBy: 'day', timeZone: 'Pacific/Auckland' });
    // NZDT is +13 in March, so the second worklog lands on the following day.
    expect(auckland.groups.map((g) => g.key)).toEqual(['2026-03-02', '2026-03-03', '2026-03-04']);
    const honolulu = aggregateWorklogs(records, { groupBy: 'day', timeZone: 'Pacific/Honolulu' });
    // Honolulu is -10, so the first worklog lands on the previous day.
    expect(honolulu.groups.map((g) => g.key)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
  });

  it('groups by week and month', () => {
    const records = fixtureRecords();
    expect(aggregateWorklogs(records, { groupBy: 'week' }).groups.map((g) => g.key)).toEqual([
      '2026-W10',
    ]);
    expect(aggregateWorklogs(records, { groupBy: 'month' }).groups.map((g) => g.key)).toEqual([
      '2026-03',
    ]);
  });

  it('groups by issue and project', () => {
    const records = fixtureRecords();
    expect(aggregateWorklogs(records, { groupBy: 'issue' }).groups[0]?.label).toBe('FLOW-1');
    expect(aggregateWorklogs(records, { groupBy: 'project' }).groups[0]?.key).toBe('10000');
  });

  it('restricts to a window', () => {
    const result = aggregateWorklogs(fixtureRecords(), {
      groupBy: 'author',
      from: T('2026-03-03T00:00:00Z'),
      to: T('2026-03-05T00:00:00Z'),
    });
    expect(result.entries).toBe(1);
    expect(result.totalMs).toBe(5400 * 1000);
    expect(result.windowFrom).toBe(T('2026-03-03T00:00:00Z'));
  });

  it('computes ISO week keys, including the year boundary', () => {
    expect(isoWeekKey(T('2026-01-01T12:00:00Z'), 'UTC')).toBe('2026-W01');
    expect(isoWeekKey(T('2027-01-01T12:00:00Z'), 'UTC')).toBe('2026-W53');
    expect(isoWeekKey(T('2026-12-31T12:00:00Z'), 'UTC')).toBe('2026-W53');
  });

  it("formats durations the way Jira's time tracking does", () => {
    expect(formatJiraDuration(0)).toBe('0m');
    expect(formatJiraDuration(90 * 60_000)).toBe('1h 30m');
    expect(formatJiraDuration(8 * HOUR)).toBe('1d');
    expect(formatJiraDuration(45 * HOUR)).toBe('1w 5h');
    expect(formatJiraDuration(45 * HOUR, { hoursPerDay: 24, daysPerWeek: 7 })).toBe('1d 21h');
    expect(formatJiraDuration(-5)).toBe('0m');
  });
});

describe('WIP aging and run charts', () => {
  it('ages an in-flight issue by its current status', () => {
    const timeline = reconstructTimeline({
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      createdAt: T('2026-03-02T08:00:00Z'),
      currentStatusId: '3',
      currentStatusName: 'In Progress',
      entries: [entry('1', '2026-03-02T09:00:00.000+0000', '10000', 'To Do', '3', 'In Progress')],
    });
    const item = computeAging(timeline, TEST_RESOLVER, {
      now: NOW,
      calendar: UTC_BUSINESS_CALENDAR,
    });
    expect(item?.ageInStatusMs).toBe(T('2026-03-05T12:00:00Z') - T('2026-03-02T09:00:00Z'));
    // Mon 09:00-17:00 8h, Tue 8h, Wed 8h, Thu 09:00-12:00 3h.
    expect(item?.ageInStatusBusinessMs).toBe(27 * HOUR);
    expect(item?.ageInProgressMs).toBe(item?.ageInStatusMs);
    expect(item?.ageTotalMs).toBe(NOW - T('2026-03-02T08:00:00Z'));
  });

  it('excludes issues that are already done', () => {
    expect(computeAging(reentryTimeline(), TEST_RESOLVER, { now: NOW })).toBeNull();
  });

  it('has no in-progress age for an issue that never started', () => {
    const timeline = reconstructTimeline({
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      createdAt: T('2026-03-02T08:00:00Z'),
      currentStatusId: '10000',
      currentStatusName: 'To Do',
      entries: [],
    });
    expect(computeAging(timeline, TEST_RESOLVER, { now: NOW })?.ageInProgressMs).toBeNull();
  });

  it('buckets items by age', () => {
    const items = [
      agingItem('A', 0.5 * DAY),
      agingItem('B', 2 * DAY),
      agingItem('C', 2.5 * DAY),
      agingItem('D', 40 * DAY),
    ];
    const buckets = bucketByAge(items);
    expect(buckets.map((b) => [b.label, b.count])).toEqual([
      ['0-1d', 1],
      ['1-3d', 2],
      ['3-7d', 0],
      ['7-14d', 0],
      ['14-30d', 0],
      ['30d+', 1],
    ]);
    expect(buckets[1]?.issueKeys).toEqual(['B', 'C']);
  });

  it('skips items with no value for the requested basis', () => {
    const items = [{ ...agingItem('A', DAY), ageInProgressMs: null }];
    expect(bucketByAge(items, 'progress').every((b) => b.count === 0)).toBe(true);
    // Exactly 24h lands in the 1-3d bucket, since bucket bounds are [from, to).
    const byTotal = bucketByAge(items, 'total');
    expect(byTotal.reduce((n, b) => n + b.count, 0)).toBe(1);
    expect(byTotal.find((b) => b.label === '1-3d')?.count).toBe(1);
  });

  it('builds a daily run chart of throughput, WIP and cycle time', () => {
    const timelines = [
      simpleFlow('A', '2026-03-02T09:00:00', '2026-03-03T09:00:00'),
      simpleFlow('B', '2026-03-02T09:00:00', '2026-03-04T09:00:00'),
      simpleFlow('C', '2026-03-03T09:00:00', null),
    ];
    const chart = computeRunChart(timelines, TEST_RESOLVER, {
      from: T('2026-03-02T00:00:00Z'),
      to: T('2026-03-05T00:00:00Z'),
      timeZone: 'UTC',
    });
    expect(chart.map((p) => [p.date, p.completed, p.wip])).toEqual([
      ['2026-03-02', 0, 2],
      ['2026-03-03', 1, 2], // A finishes, C starts
      ['2026-03-04', 1, 1], // B finishes
      ['2026-03-05', 0, 1], // C still open
    ]);
    expect(chart[1]?.medianCycleTimeMs).toBe(DAY);
  });

  it('counts work started before the window in the opening WIP balance', () => {
    const timelines = [simpleFlow('A', '2026-02-01T09:00:00', null)];
    const chart = computeRunChart(timelines, TEST_RESOLVER, {
      from: T('2026-03-02T00:00:00Z'),
      to: T('2026-03-03T00:00:00Z'),
      timeZone: 'UTC',
    });
    expect(chart[0]?.wip).toBe(1);
  });

  it('enumerates days across a DST transition without gaps or repeats', () => {
    const days = enumerateDays(
      T('2026-03-28T00:00:00Z'),
      T('2026-03-31T00:00:00Z'),
      'Europe/Berlin',
    );
    expect(days).toEqual(['2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
    expect(enumerateDays(T('2026-03-31T00:00:00Z'), T('2026-03-28T00:00:00Z'), 'UTC')).toEqual([]);
  });
});

describe('SLA evaluation', () => {
  const calendar = normaliseCalendar(standardBusinessCalendar('UTC'));
  const goal: SlaGoal = {
    id: 'time-to-done',
    name: 'Time to done',
    startStatusIds: ['3'],
    stopStatusIds: ['10001'],
    pauseStatusIds: ['10100'],
    targetMs: 20 * HOUR,
    calendar,
  };

  it('excludes paused statuses from the working clock', () => {
    const result = evaluateSla(reentryTimeline(), goal, NOW);
    // Span Mon 09:00 -> Thu 11:30 is 26.5 business hours; Blocked contributes
    // 12 of those (Mon 13:00-17:00 plus all Tuesday) and is excluded.
    expect(result.pausedMs).toBe(12 * HOUR);
    expect(result.elapsedWorkingMs).toBe(14.5 * HOUR);
    expect(result.state).toBe('met');
    expect(result.breached).toBe(false);
    expect(result.remainingMs).toBe(5.5 * HOUR);
    expect(result.breachAt).toBeNull(); // stopped goals have no future breach
  });

  it('breaches when the target is smaller than the consumed time', () => {
    const result = evaluateSla(reentryTimeline(), { ...goal, targetMs: 8 * HOUR }, NOW);
    expect(result.state).toBe('breached');
    expect(result.remainingMs).toBeLessThan(0);
  });

  it('is not started when the start status was never reached', () => {
    const timeline = reconstructTimeline({
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      createdAt: T('2026-03-02T08:00:00Z'),
      currentStatusId: '10000',
      currentStatusName: 'To Do',
      entries: [],
    });
    const result = evaluateSla(timeline, goal, NOW);
    expect(result.state).toBe('not_started');
    expect(result.remainingMs).toBe(goal.targetMs);
    expect(result.breachAt).toBeNull();
  });

  it('starts at issue creation when no start status is configured', () => {
    const result = evaluateSla(reentryTimeline(), { ...goal, startStatusIds: [] }, NOW);
    expect(result.startedAt).toBe(T('2026-03-02T08:00:00Z'));
  });

  it('reports paused while the issue currently sits in a paused status', () => {
    const timeline = reconstructTimeline({
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      createdAt: T('2026-03-02T08:00:00Z'),
      currentStatusId: '10100',
      currentStatusName: 'Blocked',
      entries: [
        entry('1', '2026-03-02T09:00:00.000+0000', '10000', 'To Do', '3', 'In Progress'),
        entry('2', '2026-03-02T11:00:00.000+0000', '3', 'In Progress', '10100', 'Blocked'),
      ],
    });
    const result = evaluateSla(timeline, goal, NOW);
    expect(result.state).toBe('paused');
    expect(result.elapsedWorkingMs).toBe(2 * HOUR);
    // A breach instant would have to assume when the pause ends, so we do not
    // guess one.
    expect(result.breachAt).toBeNull();
  });

  it('projects a future breach instant for a running goal', () => {
    const timeline = reconstructTimeline({
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      createdAt: T('2026-03-02T08:00:00Z'),
      currentStatusId: '3',
      currentStatusName: 'In Progress',
      entries: [entry('1', '2026-03-02T09:00:00.000+0000', '10000', 'To Do', '3', 'In Progress')],
    });
    const now = T('2026-03-02T13:00:00Z');
    const result = evaluateSla(timeline, { ...goal, targetMs: 8 * HOUR }, now);
    expect(result.state).toBe('running');
    expect(result.elapsedWorkingMs).toBe(4 * HOUR);
    // 4 working hours remain: Mon 13:00-17:00 covers exactly that.
    expect(result.breachAt).toBe(T('2026-03-02T17:00:00Z'));
  });

  it('reports the instant a running goal already breached', () => {
    const timeline = reconstructTimeline({
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      createdAt: T('2026-03-02T08:00:00Z'),
      currentStatusId: '3',
      currentStatusName: 'In Progress',
      entries: [entry('1', '2026-03-02T09:00:00.000+0000', '10000', 'To Do', '3', 'In Progress')],
    });
    const result = evaluateSla(
      timeline,
      { ...goal, targetMs: 2 * HOUR },
      T('2026-03-03T13:00:00Z'),
    );
    expect(result.breached).toBe(true);
    expect(result.breachAt).toBe(T('2026-03-02T11:00:00Z'));
  });

  it('computes attainment across a set of results', () => {
    const met = evaluateSla(reentryTimeline(), goal, NOW);
    const breached = evaluateSla(reentryTimeline(), { ...goal, targetMs: HOUR }, NOW);
    expect(attainmentRate([met, breached])).toBe(0.5);
    expect(attainmentRate([])).toBeNull();
  });

  it('evaluates plain due dates', () => {
    expect(
      evaluateDueDate(
        { issueId: '1', issueKey: 'A', dueAt: T('2026-03-04T00:00:00Z'), resolvedAt: null },
        NOW,
      ).breached,
    ).toBe(true);
    expect(
      evaluateDueDate(
        {
          issueId: '1',
          issueKey: 'A',
          dueAt: T('2026-03-04T00:00:00Z'),
          resolvedAt: T('2026-03-03T00:00:00Z'),
        },
        NOW,
      ),
    ).toMatchObject({ breached: false, overdueByMs: -DAY });
    expect(
      evaluateDueDate({ issueId: '1', issueKey: 'A', dueAt: null, resolvedAt: null }, NOW),
    ).toMatchObject({ breached: false, overdueByMs: null });
  });
});

describe('issue history', () => {
  const context = { issueId: '20003', issueKey: 'FLOW-3', projectId: '10000' };

  function records() {
    const page = loadFixture<JiraChangelogPage>('changelog-reentry.json');
    return toHistoryRecords(page.values ?? [], context);
  }

  it('flattens every field change, not only status', () => {
    const all = records();
    // Five changelog entries carrying seven items in total.
    expect(all).toHaveLength(7);
    expect(new Set(all.map((r) => r.field))).toEqual(new Set(['status', 'assignee', 'resolution']));
  });

  it('gives each change a stable unique id', () => {
    const ids = records().map((r) => r.changeId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('filters by field, author, issue, window and value', () => {
    const all = records();
    expect(filterHistory(all, { fields: ['STATUS'] })).toHaveLength(5);
    expect(filterHistory(all, { authorAccountIds: ['acc-cara'] })).toHaveLength(2);
    expect(filterHistory(all, { issueKeys: ['NOPE-1'] })).toHaveLength(0);
    expect(
      filterHistory(all, { from: T('2026-03-04T00:00:00Z'), to: T('2026-03-05T00:00:00Z') }),
    ).toHaveLength(2);
    expect(filterHistory(all, { valueContains: 'blocked' })).toHaveLength(2);
    expect(filterHistory(all, { valueContains: '' })).toHaveLength(7);
  });

  it('summarises which fields churn most', () => {
    const summary = summariseByField(records());
    expect(summary[0]).toMatchObject({ field: 'status', changes: 5, issues: 1, authors: 3 });
  });

  it('drops entries with an unparseable timestamp instead of throwing', () => {
    expect(toHistoryRecords([{ id: '1', created: 'nonsense', items: [] }], context)).toEqual([]);
  });

  it('falls back to a synthetic id when Jira omits one', () => {
    const out = toHistoryRecords(
      [{ created: '2026-03-01T00:00:00.000+0000', items: [{ field: 'summary' }] }],
      context,
    );
    expect(out[0]?.changeId).toBe('idx-0:0');
    expect(out[0]?.authorDisplayName).toBe('Unknown user');
  });
});

function entry(
  id: string,
  created: string,
  from: string,
  fromString: string,
  to: string,
  toString: string,
) {
  return { id, created, items: [{ field: 'status', from, fromString, to, toString }] };
}

function agingItem(issueKey: string, ageMs: number) {
  return {
    issueId: issueKey,
    issueKey,
    statusId: '3',
    statusName: 'In Progress',
    ageInStatusMs: ageMs,
    ageInStatusBusinessMs: ageMs,
    ageInProgressMs: ageMs,
    ageTotalMs: ageMs,
    enteredStatusAt: NOW - ageMs,
  };
}

function simpleFlow(key: string, startedIso: string, doneIso: string | null) {
  const entries = [entry('1', `${startedIso}.000+0000`, '10000', 'To Do', '3', 'In Progress')];
  if (doneIso !== null) {
    entries.push(entry('2', `${doneIso}.000+0000`, '3', 'In Progress', '10001', 'Done'));
  }
  return reconstructTimeline({
    issueId: key,
    issueKey: key,
    projectId: '10000',
    createdAt: T('2026-01-01T00:00:00Z'),
    currentStatusId: doneIso === null ? '3' : '10001',
    currentStatusName: doneIso === null ? 'In Progress' : 'Done',
    entries,
  });
}

describe('worklog visibility restrictions', () => {
  const context = { issueId: '20001', issueKey: 'FLOW-1', projectId: '10000' };

  /**
   * Jira lets a worklog be restricted to a project role or group. Because this
   * app reads Jira as the app rather than as the viewer, a restricted worklog
   * arrives in full and would otherwise be totalled into a report shown to the
   * very people the restriction exists to exclude.
   */
  it('drops a worklog restricted to a role or group', () => {
    const base = { id: '1', started: '2026-03-01T09:00:00.000+0000', timeSpentSeconds: 3600 };
    expect(toWorklogRecord(base, context)).not.toBeNull();
    expect(
      toWorklogRecord({ ...base, visibility: { type: 'role', value: 'Administrators' } }, context),
    ).toBeNull();
    expect(
      toWorklogRecord({ ...base, visibility: { type: 'group', value: 'jira-admins' } }, context),
    ).toBeNull();
  });

  it('keeps a worklog whose visibility is explicitly absent', () => {
    const base = { id: '1', started: '2026-03-01T09:00:00.000+0000', timeSpentSeconds: 3600 };
    expect(toWorklogRecord({ ...base, visibility: null }, context)).not.toBeNull();
  });
});

describe('index errors crossing to the browser', () => {
  it('classifies rather than echoing the recorded message', () => {
    // index_state.last_error holds a raw exception. A Jira error is already
    // JQL-redacted, but a database driver error can echo statement fragments
    // and constraint values, and the report page renders this string.
    expect(describeIndexError(null)).toBeNull();
    expect(describeIndexError('   ')).toBeNull();
    expect(describeIndexError('Jira responded 429 for /rest/api/3/search')).toContain(
      'rate-limited',
    );
    expect(describeIndexError('Jira responded 403 for /rest/api/3/issue/1')).toContain(
      'administrator',
    );
    expect(describeIndexError('Jira responded 404 for /rest/api/3/issue/1')).toContain(
      'no longer exists',
    );
    const leaky = describeIndexError(
      "Duplicate entry 'FLOW-42: acquire Contoso' for key 'issue_meta.PRIMARY'",
    );
    expect(leaky).not.toContain('Contoso');
    expect(leaky).toContain('app logs');
  });
});
