import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  STORE_MAX_ROWS,
  type HistoryRecord,
  type MetricsStore,
  type IssueMetaRow,
  type StatusAggregateRow,
  type WorklogRecord,
} from '@jfm/engine';
import {
  buildAgingReport,
  buildFlowReport,
  buildHistoryReport,
  buildSlaReport,
  buildWorklogReport,
} from '../src/reports.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.parse('2026-03-10T12:00:00Z');

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

function agg(
  issueId: string,
  statusId: string,
  overrides: Partial<StatusAggregateRow> = {},
): StatusAggregateRow {
  return {
    issueId,
    statusId,
    elapsedMs: HOUR,
    businessMs: HOUR,
    entries: 1,
    lastEnteredAt: NOW - DAY,
    lastExitedAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

async function seeded(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.upsertStatusMeta([
    { statusId: '10000', name: 'To Do', category: 'todo', firstSeenAt: 0, lastSeenAt: NOW },
    { statusId: '3', name: 'In Progress', category: 'inprogress', firstSeenAt: 0, lastSeenAt: NOW },
    { statusId: '10001', name: 'Done', category: 'done', firstSeenAt: 0, lastSeenAt: NOW },
  ]);
  await store.putIssueAggregates([
    {
      // In flight for 2 days in In Progress.
      meta: meta({ issueId: '1' }),
      rows: [
        agg('1', '10000', { businessMs: 4 * HOUR, lastEnteredAt: NOW - 10 * DAY }),
        agg('1', '3', { businessMs: 6 * HOUR, lastEnteredAt: NOW - 2 * DAY }),
      ],
    },
    {
      // In flight for 40 days — the stale bucket.
      meta: meta({ issueId: '2', dueAt: NOW - DAY }),
      rows: [agg('2', '3', { businessMs: 30 * HOUR, lastEnteredAt: NOW - 40 * DAY })],
    },
    {
      // Finished, so excluded from ageing.
      meta: meta({ issueId: '3', currentStatusId: '10001', resolvedAt: NOW - DAY }),
      rows: [agg('3', '10001', { businessMs: HOUR })],
    },
  ]);
  return store;
}

describe('worklog report (listing 2)', () => {
  it('groups stored worklogs without touching Jira', async () => {
    const store = new MemoryStore();
    const base: Omit<WorklogRecord, 'worklogId' | 'authorAccountId' | 'authorDisplayName'> = {
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      startedAt: NOW - DAY,
      timeSpentMs: 2 * HOUR,
      createdAt: null,
      updatedAt: null,
    };
    await store.putWorklogs('1', [
      { ...base, worklogId: 'a', authorAccountId: 'anna', authorDisplayName: 'Anna' },
      { ...base, worklogId: 'b', authorAccountId: 'anna', authorDisplayName: 'Anna' },
      { ...base, worklogId: 'c', authorAccountId: 'ben', authorDisplayName: 'Ben' },
    ]);
    const report = await buildWorklogReport(store, { projectId: '10000' }, 'UTC');
    expect(report.totalMs).toBe(6 * HOUR);
    expect(report.groups.map((g) => [g.label, g.timeSpentMs / HOUR])).toEqual([
      ['Anna', 4],
      ['Ben', 2],
    ]);
  });

  it('honours the window and grouping', async () => {
    const store = new MemoryStore();
    await store.putWorklogs('1', [
      {
        worklogId: 'a',
        issueId: '1',
        issueKey: 'FLOW-1',
        projectId: '10000',
        authorAccountId: 'anna',
        authorDisplayName: 'Anna',
        startedAt: NOW - 10 * DAY,
        timeSpentMs: HOUR,
        createdAt: null,
        updatedAt: null,
      },
    ]);
    const empty = await buildWorklogReport(
      store,
      { projectId: '10000', from: NOW - DAY, groupBy: 'day' },
      'UTC',
    );
    expect(empty.entries).toBe(0);
    const found = await buildWorklogReport(
      store,
      { projectId: '10000', from: NOW - 30 * DAY, to: NOW, groupBy: 'day' },
      'UTC',
    );
    expect(found.groups).toHaveLength(1);
  });
});

describe('aging report (listing 3)', () => {
  it('ages only work in flight, oldest first', async () => {
    const report = await buildAgingReport(await seeded(), '10000', NOW);
    expect(report.excludedDone).toBe(1);
    expect(report.rows.map((r) => r.issueKey)).toEqual(['FLOW-2', 'FLOW-1']);
    expect(report.rows[0]?.ageInStatusMs).toBe(40 * DAY);
    expect(report.rows[1]?.ageInStatusMs).toBe(2 * DAY);
  });

  it('buckets by age with half-open bounds', async () => {
    const report = await buildAgingReport(await seeded(), '10000', NOW);
    const byLabel = Object.fromEntries(report.buckets.map((b) => [b.label, b.count]));
    expect(byLabel['1-3d']).toBe(1);
    expect(byLabel['30d+']).toBe(1);
    expect(byLabel['3-7d']).toBe(0);
  });

  it('uses the aggregate row of the current status for the entry time', async () => {
    const report = await buildAgingReport(await seeded(), '10000', NOW);
    expect(report.rows[1]?.enteredStatusAt).toBe(NOW - 2 * DAY);
    expect(report.rows[1]?.statusName).toBe('In Progress');
  });

  it('copes with an issue whose current status has no aggregate row', async () => {
    const store = await seeded();
    await store.putIssueAggregate(meta({ issueId: '9', currentStatusId: 'ghost' }), []);
    const report = await buildAgingReport(store, '10000', NOW);
    const ghost = report.rows.find((r) => r.issueKey === 'FLOW-9');
    expect(ghost).toMatchObject({ ageInStatusMs: 0, enteredStatusAt: null, statusName: 'ghost' });
  });

  it('treats a null current status as unknown rather than done', async () => {
    const store = new MemoryStore();
    await store.putIssueAggregate(meta({ issueId: '9', currentStatusId: null }), []);
    const report = await buildAgingReport(store, '10000', NOW);
    expect(report.rows[0]?.statusName).toBe('Unknown');
  });
});

describe('SLA report (listing 4)', () => {
  it('sums working time in the counted statuses only', async () => {
    const report = await buildSlaReport(
      await seeded(),
      '10000',
      {
        id: 'g',
        name: 'Time in progress',
        countedStatusIds: ['3'],
        targetMs: 8 * HOUR,
      },
      NOW,
    );
    const one = report.rows.find((r) => r.issueKey === 'FLOW-1');
    // FLOW-1 has 4h in To Do and 6h in In Progress; only the 6h counts.
    expect(one?.consumedMs).toBe(6 * HOUR);
    expect(one?.breached).toBe(false);
    const two = report.rows.find((r) => r.issueKey === 'FLOW-2');
    expect(two?.consumedMs).toBe(30 * HOUR);
    expect(two?.breached).toBe(true);
    expect(report.breachedCount).toBe(1);
    expect(report.attainment).toBeCloseTo(2 / 3, 10);
  });

  it('counts every status when no counted set is given', async () => {
    const report = await buildSlaReport(
      await seeded(),
      '10000',
      { id: 'g', name: 'Total', countedStatusIds: [], targetMs: 8 * HOUR },
      NOW,
    );
    expect(report.rows.find((r) => r.issueKey === 'FLOW-1')?.consumedMs).toBe(10 * HOUR);
  });

  it('sorts the worst breaches first', async () => {
    const report = await buildSlaReport(
      await seeded(),
      '10000',
      { id: 'g', name: 'x', countedStatusIds: ['3'], targetMs: 8 * HOUR },
      NOW,
    );
    expect(report.rows[0]?.issueKey).toBe('FLOW-2');
  });

  it('evaluates due dates alongside the goal', async () => {
    const report = await buildSlaReport(
      await seeded(),
      '10000',
      { id: 'g', name: 'x', countedStatusIds: ['3'], targetMs: 8 * HOUR },
      NOW,
    );
    expect(report.dueDateBreaches).toBe(1);
    expect(report.rows.find((r) => r.issueKey === 'FLOW-1')?.dueDate.dueAt).toBeNull();
  });

  it('avoids dividing by a zero target', async () => {
    const report = await buildSlaReport(
      await seeded(),
      '10000',
      { id: 'g', name: 'x', countedStatusIds: ['3'], targetMs: 0 },
      NOW,
    );
    expect(report.rows.every((r) => Number.isFinite(r.consumedFraction))).toBe(true);
  });

  it('returns null attainment for an empty project', async () => {
    const report = await buildSlaReport(
      new MemoryStore(),
      '10000',
      { id: 'g', name: 'x', countedStatusIds: [], targetMs: HOUR },
      NOW,
    );
    expect(report.attainment).toBeNull();
  });
});

describe('history report (listing 5)', () => {
  it('returns filtered records plus a per-field summary', async () => {
    const store = new MemoryStore();
    const base: Omit<HistoryRecord, 'changeId' | 'field' | 'fieldLabel'> = {
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
    const all = await buildHistoryReport(store, { projectId: '10000' });
    expect(all.total).toBe(3);
    expect(all.byField[0]).toMatchObject({ field: 'status', changes: 2 });

    const filtered = await buildHistoryReport(store, {
      projectId: '10000',
      fields: ['assignee'],
      from: NOW - 2 * DAY,
      to: NOW,
      limit: 10,
    });
    expect(filtered.total).toBe(1);
  });
});

describe('cumulative flow (listing 3) — the report the aggregate cannot answer', () => {
  const DAY_0 = NOW - 4 * DAY;

  /**
   * One issue that moved To Do → In Progress → Done over four days, and one
   * that has sat in To Do the whole time.
   */
  async function flowStore(): Promise<MemoryStore> {
    const store = new MemoryStore();
    await store.migrate();
    await store.upsertStatusMeta([
      { statusId: '1', name: 'To Do', category: 'todo', firstSeenAt: 0, lastSeenAt: NOW },
      {
        statusId: '3',
        name: 'In Progress',
        category: 'inprogress',
        firstSeenAt: 0,
        lastSeenAt: NOW,
      },
      { statusId: '5', name: 'Done', category: 'done', firstSeenAt: 0, lastSeenAt: NOW },
    ]);
    await store.putIssueAggregate(meta({ issueId: '1', createdAt: DAY_0 }), []);
    await store.putIssueAggregate(meta({ issueId: '2', createdAt: DAY_0 }), []);
    await store.putIssueVisits('1', [
      {
        issueId: '1',
        seq: 0,
        statusId: '1',
        projectId: '10000',
        enteredAt: DAY_0,
        exitedAt: DAY_0 + 2 * DAY,
      },
      {
        issueId: '1',
        seq: 1,
        statusId: '3',
        projectId: '10000',
        enteredAt: DAY_0 + 2 * DAY,
        exitedAt: DAY_0 + 3 * DAY,
      },
      {
        issueId: '1',
        seq: 2,
        statusId: '5',
        projectId: '10000',
        enteredAt: DAY_0 + 3 * DAY,
        exitedAt: null,
      },
    ]);
    await store.putIssueVisits('2', [
      { issueId: '2', seq: 0, statusId: '1', projectId: '10000', enteredAt: DAY_0, exitedAt: null },
    ]);
    return store;
  }

  function countOn(
    report: Awaited<ReturnType<typeof buildFlowReport>>,
    dayIndex: number,
    statusId: string,
  ): number {
    const at = report.from + dayIndex * DAY;
    return report.points.find((p) => p.at === at && p.statusId === statusId)?.count ?? 0;
  }

  it('counts each issue in exactly one status per day', async () => {
    const report = await buildFlowReport(await flowStore(), '10000', NOW, { days: 5 });
    for (let day = 0; day < 5; day += 1) {
      const total = report.bands.reduce(
        (sum, band) => sum + countOn(report, day, band.statusId),
        0,
      );
      // The bands summing to the work in flight is what makes this a
      // cumulative flow diagram rather than a chart of status touches.
      expect(total).toBe(2);
    }
  });

  it('follows one issue across the bands as it moves', async () => {
    const report = await buildFlowReport(await flowStore(), '10000', NOW, { days: 5 });
    // Day 0 and 1 in To Do (with the other issue), day 2 in In Progress —
    // the visit ends at the start of day 2, so the *end* of day 2 finds it
    // in the next status.
    expect(countOn(report, 0, '1')).toBe(2);
    expect(countOn(report, 1, '1')).toBe(2);
    expect(countOn(report, 2, '3')).toBe(1);
    expect(countOn(report, 3, '5')).toBe(1);
    expect(countOn(report, 4, '5')).toBe(1);
    // And the issue that never moved is in To Do on every one of them.
    expect(countOn(report, 4, '1')).toBe(1);
  });

  it('emits a point for every band on every day, zeroes included', async () => {
    const report = await buildFlowReport(await flowStore(), '10000', NOW, { days: 5 });
    // A line chart that omits the days a band was empty draws a straight
    // line across the gap, which reads as "steady" where the truth is
    // "none".
    expect(report.points).toHaveLength(report.bands.length * 5);
    expect(countOn(report, 0, '5')).toBe(0);
  });

  it('orders the bands by workflow category, not alphabetically', async () => {
    const report = await buildFlowReport(await flowStore(), '10000', NOW, { days: 5 });
    expect(report.bands.map((b) => b.name)).toEqual(['To Do', 'In Progress', 'Done']);
  });

  it('★ selects visits by the window, not by the oldest page of issues', async () => {
    // Regression. This used to page `issue_meta` first and pass those ids
    // down — and `issue_meta` is ordered `created_at ASC`, so it picked the
    // *oldest* issues: exactly the ones least likely to have moved
    // recently. A long-lived project rendered `unavailable` and hid the
    // chart entirely, which is the precise outcome the flag exists to
    // avoid.
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
    // 600 ancient, long-closed issues, then one recent issue still in
    // flight. A 500-row issue page sorted oldest-first never reaches it.
    for (let index = 0; index < 600; index += 1) {
      const id = `old-${String(index)}`;
      await store.putIssueAggregate(meta({ issueId: id, createdAt: NOW - 900 * DAY }), []);
      await store.putIssueVisits(id, [
        {
          issueId: id,
          seq: 0,
          statusId: '3',
          projectId: '10000',
          enteredAt: NOW - 900 * DAY,
          exitedAt: NOW - 880 * DAY,
        },
      ]);
    }
    await store.putIssueAggregate(meta({ issueId: 'recent', createdAt: NOW - DAY }), []);
    await store.putIssueVisits('recent', [
      {
        issueId: 'recent',
        seq: 0,
        statusId: '3',
        projectId: '10000',
        enteredAt: NOW - DAY,
        exitedAt: null,
      },
    ]);

    const report = await buildFlowReport(store, '10000', NOW, { days: 5 });
    expect(report.unavailable).toBe(false);
    expect(report.issueCount).toBe(1);
    expect(countOn(report, 4, '3')).toBe(1);
  });

  it('says when the visit query hit its cap, so the bands are a lower bound', async () => {
    const store = await flowStore();
    const capped = await buildFlowReport(store, '10000', NOW, { days: 5, limit: 2 });
    expect(capped.capped).toBe(true);
    const complete = await buildFlowReport(store, '10000', NOW, { days: 5 });
    expect(complete.capped).toBe(false);
  });

  it('★ does not call an exactly-full visit read capped', async () => {
    // `visits.length >= visitLimit` called a read that dropped nothing
    // truncated — the same `>= MAX` false positive this cycle has now fixed
    // in three other places. `flowStore` holds exactly four visits.
    const store = await flowStore();
    const exact = await buildFlowReport(store, '10000', NOW, { days: 5, limit: 4 });
    expect(exact.capped).toBe(false);
    expect(await store.queryStatusVisits({ projectId: '10000' })).toHaveLength(4);
    // Three is a real truncation.
    expect((await buildFlowReport(store, '10000', NOW, { days: 5, limit: 3 })).capped).toBe(true);
  });

  it('★ reports the ceiling it actually applied, not the one it was asked for', async () => {
    // The page's cap banner had no number to print: it said "the maximum
    // number of rows it will read in one pass" above a title counting
    // *issues*, so on JFMB a 500-row ceiling appeared on screen as "102
    // issues". The limit is also clamped, so echoing `options.limit` would
    // print a ceiling that never fired.
    const store = await flowStore();
    expect((await buildFlowReport(store, '10000', NOW, { days: 5, limit: 2 })).readRowLimit).toBe(
      2,
    );
    expect(
      (await buildFlowReport(store, '10000', NOW, { days: 5, limit: 50_000 })).readRowLimit,
    ).toBeLessThanOrEqual(STORE_MAX_ROWS);
  });

  it('★ keeps the visit limit under the ceiling the store enforces', async () => {
    // The default was 20,000 — twice `STORE_MAX_ROWS` — so the store clamped
    // the read to 10,000 and `length >= 20_000` could never be true: a
    // window holding 12,000 visits silently lost 2,000 and reported
    // `capped: false`. Exactly what made `AGGREGATE_ROW_CAP` unable to fire.
    //
    // Asserted on the request rather than on a 12,000-row fixture: what went
    // wrong was the number asked for, and it is the number that must stay
    // below the ceiling.
    const store = await flowStore();
    const asked: number[] = [];
    // A Proxy, not a spread: `MemoryStore`'s methods live on its prototype,
    // so `{ ...store }` copies the fields and none of the behaviour.
    const spy = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop !== 'queryStatusVisits') return Reflect.get(target, prop, receiver) as unknown;
        return (query: Parameters<MetricsStore['queryStatusVisits']>[0]) => {
          asked.push(query.limit ?? Number.POSITIVE_INFINITY);
          return target.queryStatusVisits(query);
        };
      },
    }) as MetricsStore;

    await buildFlowReport(spy, '10000', NOW, { days: 5 });
    expect(asked[0]).toBeLessThanOrEqual(STORE_MAX_ROWS);
    // A caller asking for more than the store will ever return is clamped to
    // something it can actually detect the truncation of.
    asked.length = 0;
    await buildFlowReport(spy, '10000', NOW, { days: 5, limit: 50_000 });
    expect(asked[0]).toBeLessThanOrEqual(STORE_MAX_ROWS);
  });

  it('counts the distinct issues in the window, not the project', async () => {
    const store = await flowStore();
    await store.putIssueAggregate(meta({ issueId: 'untouched' }), []);
    const report = await buildFlowReport(store, '10000', NOW, { days: 5 });
    // Two issues have visits; a third exists and never moved in the window.
    expect(report.issueCount).toBe(2);
  });

  /**
   * ★ The defect this test exists for was found by opening the deployed app.
   *
   * On the real dev site the JFM cumulative flow chart topped out at **1**
   * where the project's true answer is 6, and said nothing. The arithmetic was
   * right; the store held visit rows for one issue in ten, because the visits
   * table shipped after that project was indexed and only one issue has had a
   * status change since. `unavailable` is the report's only completeness
   * signal and it is all-or-nothing — one issue's rows flip it to `false` and
   * the chart renders with the confidence of a complete answer.
   *
   * "Some issues have no visits yet" and "those issues were not in flight"
   * are different claims, and a chart that cannot tell them apart makes the
   * second one. The sibling report on the same page has always done this
   * properly: `buildAgingReport` compares its page against `countIssueMeta`.
   */
  it('★ says how much of the project the chart is drawn from', async () => {
    const store = await flowStore();
    // Eight more issues the indexer has stored but never wrote visits for —
    // the shape a project indexed before `datasets.statusVisits` existed is
    // left in, and the shape JFM was actually in.
    for (let i = 0; i < 8; i += 1) {
      await store.putIssueAggregate(
        meta({ issueId: `no-visits-${String(i)}`, createdAt: DAY_0 }),
        [],
      );
    }
    const report = await buildFlowReport(store, '10000', NOW, { days: 5 });
    expect(report.projectIssueCount).toBe(10);
    // `issueCount` is the chart's own coverage: every stored issue has an
    // open final visit, so one the window cannot see has no visit rows.
    expect(report.issueCount).toBe(2);
    expect(report.partial).toBe(true);
  });

  /**
   * ★ A cut read cannot tell "no visits stored" from "beyond the ceiling", so
   * it must not accuse the index of the first. Found by reading the fixed
   * banner on the live JFMB page, where it claimed 798 issues had no status
   * history on a project whose visits had merely been cut at 500 rows.
   */
  it('★ does not call a cut read partial — it cannot know which it is', async () => {
    const store = await flowStore();
    for (let i = 0; i < 8; i += 1) {
      await store.putIssueAggregate(
        meta({ issueId: `no-visits-${String(i)}`, createdAt: DAY_0 }),
        [],
      );
    }
    const report = await buildFlowReport(store, '10000', NOW, { days: 5, limit: 2 });
    expect(report.capped).toBe(true);
    expect(report.partial).toBe(false);
  });

  it('is not partial when every stored issue has visits', async () => {
    const report = await buildFlowReport(await flowStore(), '10000', NOW, { days: 5 });
    expect(report.projectIssueCount).toBe(2);
    expect(report.issueCount).toBe(2);
    expect(report.partial).toBe(false);
  });

  it('★ says the data is unavailable rather than drawing a flat zero', async () => {
    // A listing that does not set `datasets.statusVisits` stores no visits.
    // "Indexing has not recorded the visits" and "nothing was in flight for
    // 30 days" are different answers, and a chart of zeroes asserts the
    // second one.
    const store = new MemoryStore();
    await store.migrate();
    await store.putIssueAggregate(meta({ issueId: '1' }), []);
    const report = await buildFlowReport(store, '10000', NOW);
    expect(report.unavailable).toBe(true);
    expect(report.points).toEqual([]);
  });

  it('clamps an absurd window instead of scanning the whole table', async () => {
    const store = await flowStore();
    const huge = await buildFlowReport(store, '10000', NOW, { days: 100_000 });
    const tiny = await buildFlowReport(store, '10000', NOW, { days: 0 });
    expect((huge.to - huge.from) / DAY).toBe(180);
    expect((tiny.to - tiny.from) / DAY).toBe(1);
  });

  it('scopes to the project, like every other report', async () => {
    const store = await flowStore();
    await store.putIssueAggregate(meta({ issueId: '9', projectId: '20000' }), []);
    await store.putIssueVisits('9', [
      { issueId: '9', seq: 0, statusId: '3', projectId: '20000', enteredAt: DAY_0, exitedAt: null },
    ]);
    const report = await buildFlowReport(store, '10000', NOW, { days: 5 });
    expect(report.bands.map((b) => b.statusId)).not.toContain('3-other');
    expect(countOn(report, 4, '3')).toBe(0);
  });
});
