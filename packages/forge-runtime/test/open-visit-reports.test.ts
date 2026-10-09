import { describe, expect, it } from 'vitest';
import { MemoryStore, normaliseCalendar, standardBusinessCalendar } from '@jfm/engine';
import type { IssueMetaRow, StatusAggregateRow } from '@jfm/engine';
import { buildAgingReport, buildSlaReport } from '../src/reports.js';

/**
 * Two reports that read a stored aggregate's still-open visit: listing 4's SLA
 * clock and listing 3's working-hours column.
 *
 * The SLA clock has to keep running while the issue sits in a counted status.
 *
 * Listing 4 computes consumed time by summing the stored `businessMs` of the
 * counted statuses. That number stopped at the row's own `updatedAt`, and an
 * issue that is quietly burning through its target generates no issue event —
 * so nothing re-ingests it and nothing advances the figure. The failure is in
 * the worst direction available to this listing: the report under-states
 * consumption, which means it hides breaches rather than inventing them.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Monday 09:00 UTC: the start of a standard working day, so the arithmetic
// below is countable by hand.
const INGESTED_AT = Date.parse('2026-03-09T09:00:00Z');

const GOAL = { id: 'g', name: 'First response', countedStatusIds: ['3'], targetMs: 8 * HOUR };
const CALENDAR = normaliseCalendar(standardBusinessCalendar('UTC'));

function meta(): IssueMetaRow {
  return {
    issueId: '1',
    issueKey: 'FLOW-1',
    projectId: '10000',
    issueTypeId: '10002',
    priorityId: '3',
    assigneeAccountId: 'acc-anna',
    currentStatusId: '3',
    createdAt: INGESTED_AT - 10 * DAY,
    resolvedAt: null,
    dueAt: null,
    historyThroughAt: INGESTED_AT,
    truncated: false,
    updatedAt: INGESTED_AT,
  };
}

function agg(overrides: Partial<StatusAggregateRow> = {}): StatusAggregateRow {
  return {
    issueId: '1',
    statusId: '3',
    // Two working hours consumed out of the eight-hour target: comfortably
    // compliant at the instant the row was written.
    elapsedMs: 2 * HOUR,
    businessMs: 2 * HOUR,
    entries: 1,
    lastEnteredAt: INGESTED_AT - 2 * HOUR,
    lastExitedAt: null,
    updatedAt: INGESTED_AT,
    ...overrides,
  };
}

async function storeWith(rows: readonly StatusAggregateRow[]): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.migrate();
  await store.upsertStatusMeta([
    {
      statusId: '3',
      name: 'In Progress',
      category: 'inprogress',
      firstSeenAt: 0,
      lastSeenAt: INGESTED_AT,
    },
  ]);
  await store.putIssueAggregates([{ meta: meta(), rows: [...rows] }]);
  return store;
}

describe('buildSlaReport, while the issue sits in a counted status', () => {
  it('★ reports the breach the stored row had not yet noticed', async () => {
    const store = await storeWith([agg()]);

    // Still inside the same working day, two days later: 2h already consumed,
    // plus the working hours from Monday 09:00 to Wednesday 15:00 — 8h Monday,
    // 8h Tuesday, 6h Wednesday = 22h. Far past an eight-hour target.
    const report = await buildSlaReport(
      store,
      '10000',
      GOAL,
      Date.parse('2026-03-11T15:00:00Z'),
      500,
      'UTC',
      CALENDAR,
    );

    expect(report.rows[0]?.consumedMs).toBe(2 * HOUR + 22 * HOUR);
    expect(report.rows[0]?.breached).toBe(true);
    expect(report.breachedCount).toBe(1);
    expect(report.attainment).toBe(0);
  });

  it('counts only working time, so a weekend alone never breaches a goal', async () => {
    // The guard on the fix itself: advancing on the wall clock would make
    // every open issue breach over any weekend, which is the same lie told
    // in the opposite direction.
    const store = await storeWith([agg()]);

    // Friday 17:00 close through to Monday 09:00 open: 48 elapsed hours, zero
    // working hours.
    const friday = await buildSlaReport(
      store,
      '10000',
      GOAL,
      Date.parse('2026-03-13T17:00:00Z'),
      500,
      'UTC',
      CALENDAR,
    );
    const monday = await buildSlaReport(
      store,
      '10000',
      GOAL,
      Date.parse('2026-03-16T09:00:00Z'),
      500,
      'UTC',
      CALENDAR,
    );

    expect(monday.rows[0]?.consumedMs).toBe(friday.rows[0]?.consumedMs);
  });

  it('leaves a closed status alone, so a resolved issue does not drift into breach', async () => {
    const store = await storeWith([agg({ lastExitedAt: INGESTED_AT })]);
    const report = await buildSlaReport(
      store,
      '10000',
      GOAL,
      INGESTED_AT + 365 * DAY,
      500,
      'UTC',
      CALENDAR,
    );

    expect(report.rows[0]?.consumedMs).toBe(2 * HOUR);
    expect(report.rows[0]?.breached).toBe(false);
  });

  it('does not advance a status the goal does not count', async () => {
    // A status outside `countedStatusIds` is filtered out before the top-up,
    // so time spent waiting on a customer stays outside the clock whether or
    // not the visit is open.
    const store = await storeWith([agg({ statusId: '10000' })]);
    const report = await buildSlaReport(
      store,
      '10000',
      GOAL,
      INGESTED_AT + 30 * DAY,
      500,
      'UTC',
      CALENDAR,
    );

    expect(report.rows[0]?.consumedMs).toBe(0);
    expect(report.rows[0]?.breached).toBe(false);
  });
});

describe('buildAgingReport, on the status an issue is still sitting in', () => {
  it('★ advances the working-hours column to the same instant as the elapsed one', async () => {
    // The two columns sit side by side under one heading. The elapsed one was
    // always computed live from `enteredAt`; the working one returned the
    // stored figure, so the row described two different moments and the
    // narrower number was always the stale one.
    const store = await storeWith([agg()]);
    const report = await buildAgingReport(
      store,
      '10000',
      Date.parse('2026-03-11T15:00:00Z'),
      500,
      CALENDAR,
    );

    // Monday 09:00 to Wednesday 15:00 is 22 working hours on top of the 2
    // already stored, against 54 elapsed hours.
    expect(report.rows[0]?.ageInStatusBusinessMs).toBe(2 * HOUR + 22 * HOUR);
    expect(report.rows[0]?.ageInStatusMs).toBe(56 * HOUR);
  });

  it('never reports more working time than elapsed time', async () => {
    // The invariant a reader checks by eye, and the one a wall-clock top-up
    // on the working column would break.
    const store = await storeWith([agg()]);
    const report = await buildAgingReport(
      store,
      '10000',
      Date.parse('2026-03-20T12:00:00Z'),
      500,
      CALENDAR,
    );
    const row = report.rows[0];
    expect(row).toBeDefined();
    expect(row!.ageInStatusBusinessMs).toBeLessThanOrEqual(row!.ageInStatusMs);
  });
});
