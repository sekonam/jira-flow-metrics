import { describe, expect, it } from 'vitest';
import type { WorklogAggregateResult } from '@jfm/engine';
import type { AgingReport, HistoryReport, SlaReport } from '@jfm/forge-runtime';
import { formatDurationForHumans } from '../src/view-model.js';
import {
  CHART_CATEGORY_LIMIT,
  DEFAULT_SLA_GOAL,
  describeHistoryWindow,
  historyWindowOptions,
  parseHistoryWindowValue,
  toAgingChartData,
  toAgingTable,
  toAgingTiles,
  toFlowChartData,
  toHistoryChartData,
  toStorageTable,
  toStorageTiles,
  toTimelineTable,
  toTimelineTiles,
  toTimelineTotals,
  toHistoryTable,
  toHistoryTiles,
  toSlaChartData,
  toSlaTable,
  toSlaTiles,
  toWorklogChartData,
  toWorklogTable,
  toWorklogTiles,
  matchesSavedGoal,
  toGoalChoice,
  toGoalPayload,
  toggleCountedStatus,
  withTarget,
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
  projectIssueCount: 6,
  capped: false,
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
  projectIssueCount: 2,
  capped: false,
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
  totalMatching: 1,
  capped: false,
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
    expect(table.rows[0]?.[2]).toBe('40d');
    expect(table.footnotes[0]).toContain('5 finished issues are excluded');
    // "1 finished issues are excluded" was on screen until someone looked.
    expect(toAgingTable({ ...aging, excludedDone: 1 }).footnotes[0]).toContain(
      '1 finished issue is excluded',
    );
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

describe('★ logged time is working time', () => {
  /**
   * Jira renders "time spent" using the instance's working hours per day (8 by
   * default), so 30 logged hours reads as "3d 6h" there. Rolling it into
   * 24-hour days here would print "1d 6h" beside it — the same factor-of-three
   * misreading the status table was fixed for.
   */
  const long: WorklogAggregateResult = {
    groups: [{ key: 'anna', label: 'Anna', timeSpentMs: 30 * HOUR, entries: 9, issueCount: 4 }],
    totalMs: 30 * HOUR,
    entries: 9,
    windowFrom: null,
    windowTo: null,
  };

  it('reports totals in hours, never in days', () => {
    expect(toWorklogTable(long, 'Person').rows[0]?.[1]).toBe('30h');
    expect(toWorklogTable(long, 'Person').footnotes[0]).toContain('30h logged');
    expect(toWorklogTiles(long)[0]?.value).toBe('30h');
    expect(toWorklogTiles(long)[1]?.hint).toBe('30h');
  });
});

describe('history view model', () => {
  it('renders a change per row with em dashes for absent values', () => {
    const table = toHistoryTable(history);
    expect(table.rows[0]).toEqual(['9 Mar 2026 12:00', 'FLOW-1', 'status', '—', 'Done', 'Anna']);
    expect(table.footnotes[0]).toContain('cross-issue and exportable');
  });

  /**
   * Found by rendering the page: several changes to the same issue on the same
   * day were indistinguishable, and the column that a reader scans — the issue
   * key — was the one *not* emphasised. Both matter for the listing whose
   * entire pitch is a readable cross-issue change log.
   */
  it('★ times each change to the minute, and labels the zone it used', () => {
    const table = toHistoryTable(history);
    expect(table.headers[0]).toBe('When (UTC)');
    expect(table.rows[0]?.[0]).toBe('9 Mar 2026 12:00');
  });

  it('★ emphasises the issue key rather than the timestamp', () => {
    expect(toHistoryTable(history).emphasisColumn).toBe(1);
    // Every other listing does lead with the issue, so it keeps the default.
    expect(toAgingTable(aging).emphasisColumn).toBeUndefined();
  });

  it('names the busiest field', () => {
    expect(toHistoryTiles(history)[1]?.value).toBe('status');
    expect(toHistoryTiles({ ...history, byField: [], total: 0 })[1]?.value).toBe('—');
  });
});

describe('SLA goal choice', () => {
  it('defaults to all statuses at 8 working hours', () => {
    expect(DEFAULT_SLA_GOAL.countedStatusIds).toEqual([]);
    expect(DEFAULT_SLA_GOAL.targetMs).toBe(8 * HOUR);
  });

  it('toggles a status in and out without touching the target', () => {
    const counted = toggleCountedStatus(DEFAULT_SLA_GOAL, '3');
    expect(counted.countedStatusIds).toEqual(['3']);
    expect(counted.targetMs).toBe(DEFAULT_SLA_GOAL.targetMs);
    expect(toggleCountedStatus(counted, '3').countedStatusIds).toEqual([]);
  });
});

describe('chart series', () => {
  it('plots logged time in hours, not milliseconds', () => {
    // The table says "6h"; the chart axis has to say 6, not 21600000.
    expect(toWorklogChartData(worklog)).toEqual([
      { label: 'Anna', value: 6 },
      { label: 'Ben', value: 2 },
    ]);
  });

  it('truncates the worklog series to a readable number of bars', () => {
    const many: WorklogAggregateResult = {
      ...worklog,
      groups: Array.from({ length: 40 }, (_, index) => ({
        key: `p${index}`,
        label: `Person ${index}`,
        timeSpentMs: (40 - index) * HOUR,
        entries: 1,
        issueCount: 1,
      })),
    };
    const data = toWorklogChartData(many);
    expect(data).toHaveLength(CHART_CATEGORY_LIMIT);
    // The largest contributors, not an arbitrary dozen: `groups` arrives
    // sorted, and the chart is a summary of where the time went.
    expect(data[0]?.label).toBe('Person 0');
  });

  it('bands SLA issues by how much of the target they have used', () => {
    // 0.75 lands in 50-80%, 3.75 in Breached. Every band renders, including
    // the empty ones: "nothing is under 50%" is a real finding.
    expect(toSlaChartData(sla)).toEqual([
      { label: 'Under 50%', value: 0 },
      { label: '50-80%', value: 1 },
      { label: '80-100%', value: 0 },
      { label: 'Breached', value: 1 },
    ]);
  });

  it('bands an issue at exactly 100% of target the way the table does', () => {
    // The table calls this row "Within target" — `remainingMs` is 0, not
    // negative. A chart band of `fraction >= 1` would call the same row
    // breached directly above the table saying it is not. The chart reads
    // `breached`, so it cannot.
    const exact = toSlaChartData({
      ...sla,
      rows: [
        {
          ...sla.rows[0]!,
          consumedMs: 8 * HOUR,
          remainingMs: 0,
          consumedFraction: 1,
          breached: false,
        },
      ],
      breachedCount: 0,
    });
    expect(exact.find((band) => band.label === 'Breached')?.value).toBe(0);
    expect(exact.find((band) => band.label === '80-100%')?.value).toBe(1);
  });

  it('counts every breached issue once, however far over it is', () => {
    // `consumedFraction` is uncapped, so a 375%-of-target issue must still
    // land in exactly one band.
    const total = toSlaChartData(sla).reduce((sum, band) => sum + band.value, 0);
    expect(total).toBe(sla.rows.length);
  });

  it('plots history changes per field, busiest first', () => {
    expect(toHistoryChartData(history)).toEqual([{ label: 'status', value: 1 }]);
  });
});

describe('the history window', () => {
  it('reads as years once the months divide evenly', () => {
    expect(describeHistoryWindow(12)).toBe('Last 12 months');
    expect(describeHistoryWindow(24)).toBe('Last 2 years');
    expect(describeHistoryWindow(120)).toBe('Last 10 years');
    expect(describeHistoryWindow(null)).toBe('All history');
  });

  it('offers only wider windows, plus all history', () => {
    // Narrowing is not offered because it would not delete the rows already
    // stored — the report would keep showing history the page claimed was
    // out of range. The resolver refuses it too.
    expect(historyWindowOptions(36).map((o) => o.label)).toEqual([
      'Last 5 years',
      'Last 10 years',
      'All history',
    ]);
  });

  it('offers nothing once all history is already indexed', () => {
    expect(historyWindowOptions(null)).toEqual([]);
  });

  it('round-trips the values the Select carries', () => {
    expect(parseHistoryWindowValue('all')).toBe(null);
    expect(parseHistoryWindowValue('24')).toBe(24);
    // Not an offered window, so not accepted — matching the resolver, which
    // is what actually decides.
    expect(parseHistoryWindowValue('18')).toBeUndefined();
    expect(parseHistoryWindowValue('')).toBeUndefined();
  });
});

describe('saved SLA goals', () => {
  const saved = {
    id: 'g-1',
    name: 'Time to resolution',
    countedStatusIds: ['3', '10200'],
    targetMs: 4 * HOUR,
  };

  it('travels as its id alone, never alongside its fields', () => {
    // A client that could send a goal's definition next to its id could show
    // a table labelled "Time to resolution" measured against something else.
    expect(toGoalPayload(toGoalChoice(saved))).toEqual({ goalId: 'g-1' });
  });

  it('sends the fields when the choice is ad-hoc', () => {
    expect(toGoalPayload(DEFAULT_SLA_GOAL)).toEqual({
      countedStatusIds: [],
      targetMs: 8 * HOUR,
    });
  });

  it('★ detaches from the saved goal the moment anything is edited', () => {
    // Keeping the id here would make the resolver measure the *stored*
    // definition while the chips on screen showed something else — the two
    // disagreeing about the same report, which is the whole failure mode.
    const choice = toGoalChoice(saved);
    expect(toGoalPayload(toggleCountedStatus(choice, '99'))).not.toHaveProperty('goalId');
    expect(toGoalPayload(withTarget(choice, 16 * HOUR))).not.toHaveProperty('goalId');
  });

  it('knows whether a choice still matches the goal it came from', () => {
    const choice = toGoalChoice(saved);
    expect(matchesSavedGoal(choice, saved)).toBe(true);
    expect(matchesSavedGoal(withTarget(choice, 16 * HOUR), saved)).toBe(false);
    expect(matchesSavedGoal(toggleCountedStatus(choice, '3'), saved)).toBe(false);
    // Order is not identity: the same statuses chosen in another order is
    // the same goal.
    expect(matchesSavedGoal({ countedStatusIds: ['10200', '3'], targetMs: 4 * HOUR }, saved)).toBe(
      true,
    );
  });
});

describe('the cumulative flow series', () => {
  it('names each line after its status and dates each point', () => {
    const at = Date.parse('2026-03-09T00:00:00Z');
    expect(
      toFlowChartData({
        bands: [{ statusId: '3', name: 'In Progress', category: 'inprogress' }],
        points: [
          { at, statusId: '3', count: 2 },
          { at: at + DAY, statusId: '3', count: 5 },
        ],
        from: at,
        to: at + 2 * DAY,
        issueCount: 7,
        capped: false,
        unavailable: false,
      }),
    ).toEqual([
      { label: '9 Mar 2026', series: 'In Progress', value: 2 },
      { label: '10 Mar 2026', series: 'In Progress', value: 5 },
    ]);
  });

  it('falls back to the status id when the status has no stored name', () => {
    const at = Date.parse('2026-03-09T00:00:00Z');
    const data = toFlowChartData({
      bands: [],
      points: [{ at, statusId: '999', count: 1 }],
      from: at,
      to: at + DAY,
      issueCount: 1,
      capped: false,
      unavailable: false,
    });
    // An unnamed line is still a line with a real count on it; dropping the
    // point would make the bands stop summing to the work in flight.
    expect(data[0]?.series).toBe('999');
  });
});

describe('the issue timeline view models', () => {
  const AT = Date.parse('2026-03-02T09:00:00Z');
  const timeline = {
    issueKey: 'FLOW-1',
    createdAt: AT,
    resolvedAt: null,
    visits: [
      {
        statusId: '1',
        statusName: 'To Do',
        enteredAt: AT,
        exitedAt: AT + HOUR,
        elapsedMs: HOUR,
        businessMs: HOUR,
      },
      {
        statusId: '3',
        statusName: 'In Progress',
        enteredAt: AT + HOUR,
        exitedAt: null,
        elapsedMs: 2 * HOUR,
        businessMs: 2 * HOUR,
      },
    ],
    totals: [
      {
        statusId: '3',
        statusName: 'In Progress',
        elapsedMs: 2 * HOUR,
        businessMs: 2 * HOUR,
        entries: 2,
      },
    ],
    truncated: false,
    sla: null,
  };

  it('marks the visit still in progress rather than inventing an end', () => {
    const table = toTimelineTable(timeline);
    expect(table.rows[0]?.[2]).toBe('2 Mar 2026 10:00');
    expect(table.rows[1]?.[2]).toBe('still here');
  });

  it('shows both bases, because the panel sits beside the History tab', () => {
    // Elapsed has to be there to be checkable against Jira's own wall-clock
    // timestamps; working time has to be there or the panel disagrees with
    // the report page about the same issue.
    const table = toTimelineTable(timeline);
    expect(table.headers).toContain('Elapsed');
    expect(table.headers).toContain('Working time');
  });

  it('says when the timeline is a lower bound', () => {
    expect(toTimelineTable({ ...timeline, truncated: true }).footnotes[0]).toMatch(/lower bound/);
    expect(toTimelineTable(timeline).footnotes).toEqual([]);
  });

  it('footnotes the re-entry only when a status really was re-entered', () => {
    expect(toTimelineTotals(timeline).footnotes[0]).toMatch(/every stay/);
    const single = { ...timeline, totals: [{ ...timeline.totals[0]!, entries: 1 }] };
    expect(toTimelineTotals(single).footnotes).toEqual([]);
  });

  it('reports only the visit count when no goal could be derived', () => {
    const tiles = toTimelineTiles(timeline);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]?.value).toBe('2');
  });

  it('★ names the goal as derived, and discounts the paused time', () => {
    const tiles = toTimelineTiles({
      ...timeline,
      sla: {
        issueId: '1',
        issueKey: 'FLOW-1',
        goalId: 'derived',
        state: 'running',
        startedAt: AT,
        stoppedAt: null,
        elapsedWorkingMs: 2 * HOUR,
        remainingMs: 6 * HOUR,
        breachAt: null,
        breached: false,
        pausedMs: 3 * HOUR,
      },
    });
    expect(tiles[1]?.value).toBe('2h');
    expect(tiles[1]?.hint).toMatch(/3h back in a to-do status is not counted/);
    // A figure that reads as configured when it is derived is the sort of
    // quiet claim this product is sold against.
    expect(tiles[2]?.hint).toMatch(/Against a derived goal/);
  });

  it('reads a breach as "over by", never as a negative duration', () => {
    const tiles = toTimelineTiles({
      ...timeline,
      sla: {
        issueId: '1',
        issueKey: 'FLOW-1',
        goalId: 'derived',
        state: 'breached',
        startedAt: AT,
        stoppedAt: null,
        elapsedWorkingMs: 10 * HOUR,
        remainingMs: -2 * HOUR,
        breachAt: AT,
        breached: true,
        pausedMs: 0,
      },
    });
    expect(tiles[2]?.label).toBe('Over one working day');
    expect(tiles[2]?.value).toBe('over by 2h');
  });
});

describe('the admin storage view models', () => {
  const estimate = {
    bytes: 83_200,
    note: 'Estimated from row counts, not measured on disk.',
    tables: [
      { table: 'issue_status_agg', rows: 526, bytes: 52_600 },
      { table: 'issue_meta', rows: 191, bytes: 30_560 },
      { table: 'issue_status_visit', rows: 0, bytes: 0 },
    ],
  };

  it('lists every table with its rows and size, and keeps the caveat', () => {
    const table = toStorageTable(estimate);
    expect(table.rows[0]).toEqual(['issue_status_agg', '526', '51.4 KB']);
    // A table listed at zero is a real answer — "this listing does not
    // ingest that dataset" — and dropping the row would hide it.
    expect(table.rows[2]).toEqual(['issue_status_visit', '0', '0 B']);
    expect(table.footnotes).toEqual([estimate.note]);
  });

  it('leads with the total and the issue count an admin actually asks for', () => {
    const tiles = toStorageTiles(estimate);
    expect(tiles[0]?.value).toBe('81.3 KB');
    expect(tiles[1]?.value).toBe('191');
  });

  it('renders a fresh installation as zero rather than as nothing', () => {
    const tiles = toStorageTiles({ bytes: 0, note: estimate.note, tables: [] });
    expect(tiles[0]?.value).toBe('0 B');
    expect(tiles[1]?.value).toBe('0');
  });
});

describe('★ tiles that must not contradict the data beside them', () => {
  it('never rounds attainment up to 100% while a breach is on screen', () => {
    // 498 of 500 met is 99.6%, and `Math.round` made that "Attainment 100%"
    // sitting directly beside "Breached 2" — two tiles on one row stating
    // incompatible things about the same issues, in the healthy case rather
    // than an edge one.
    const almost = toSlaTiles({
      ...sla,
      rows: sla.rows,
      attainment: 0.996,
      breachedCount: 2,
    });
    expect(almost[0]?.value).toBe('99%');

    // 100% is reserved for exactly what it claims.
    const clean = toSlaTiles({ ...sla, attainment: 1, breachedCount: 0 });
    expect(clean[0]?.value).toBe('100%');
  });

  it('counts every matching change, not just the page, in the Changes tile', () => {
    // `report.total` is documented as "changes on this page", and using it
    // here put "Changes 3" directly under a banner reading "Report capped at
    // 3 of 3,000 changes".
    const capped = toHistoryTiles({ ...history, total: 3, totalMatching: 3000, capped: true });
    expect(capped[0]?.value).toBe('3000');
    expect(capped[0]?.hint).toContain('cover 3 of them');

    // Uncapped, the hint stays the plain sentence.
    expect(toHistoryTiles(history)[0]?.hint).toBe('Field changes in the selected range.');
  });

  it('shows the working-hours ageing column its own footnote promises', () => {
    // `ageInStatusBusinessMs` was populated, the footnote said it "is shown
    // separately rather than blended in", and the only place it appeared was
    // the CSV — so a reader following the footnote hunted a column that did
    // not exist.
    const table = toAgingTable(aging);
    expect(table.headers).toContain('Working hours');
    const column = table.headers.indexOf('Working hours');
    expect(table.rows[0]?.[column]).toBe('30h');
    expect(table.footnotes.join(' ')).toContain('shown separately');
  });
});

describe('★ elapsed durations never roll up into weeks', () => {
  it('reads an eight-week age in days, which cannot be misread', () => {
    // The arithmetic was right — an elapsed week is seven 24-hour days — and
    // the rendering collided with Jira's own convention, whose time-tracking
    // format defaults to a five-day week. A Jira-literate reader decodes
    // "1w 2d" as seven days where the value behind it is nine. Same argument
    // as `DurationFormat` one unit up, same fix: drop the ambiguous unit.
    expect(formatDurationForHumans(9 * DAY)).toBe('9d');
    expect(formatDurationForHumans(56 * DAY)).toBe('56d');
    expect(formatDurationForHumans(9 * DAY)).not.toContain('w');
  });
});
