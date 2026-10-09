import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory-store.js';
import type { IssueMetaRow, StatusAggregateRow } from '../src/store/types.js';
import { buildStatusReport } from '../src/report/status-report.js';
import { topUpOpenVisit } from '../src/report/open-visit.js';
import { normaliseCalendar, standardBusinessCalendar } from '../src/time/calendar.js';
import { T } from './helpers.js';

/**
 * The stored aggregate is correct only as of its own `updatedAt`.
 *
 * Found in real Jira on 2026-10-09: `JFMB-2` had sat in In Progress since
 * 11 September, and the time-in-status project page read 19d 22h while Jira's
 * changelog, the WIP-aging report and the issue-timeline tab all read 27d 20h.
 * Nothing re-ingests an issue that has not moved, so the figure the flagship
 * listing sells had been frozen for eight days.
 *
 * Every test here is written so that it fails if `topUpOpenVisit` is reduced
 * to returning the row unchanged — which is exactly the state the product was
 * in when the defect was found.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// A Friday, mid-afternoon, inside the standard 09:00-17:00 UTC working day.
const INGESTED_AT = T('2026-03-06T15:00:00Z');

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
    historyThroughAt: INGESTED_AT,
    truncated: false,
    updatedAt: INGESTED_AT,
    ...overrides,
  };
}

function agg(overrides: Partial<StatusAggregateRow> = {}): StatusAggregateRow {
  return {
    issueId: '1',
    statusId: '3',
    elapsedMs: 10 * HOUR,
    businessMs: 4 * HOUR,
    entries: 1,
    lastEnteredAt: INGESTED_AT - 10 * HOUR,
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
  await store.putIssueAggregates([{ meta: meta({ issueId: '1' }), rows: [...rows] }]);
  return store;
}

describe('topUpOpenVisit', () => {
  it('advances a still-open visit by the time since the row was written', () => {
    const topped = topUpOpenVisit(agg(), INGESTED_AT + 3 * HOUR);
    expect(topped.elapsedMs).toBe(13 * HOUR);
  });

  it('leaves a closed visit exactly as stored, however long ago it was written', () => {
    // The guard against the obvious over-correction: topping up every row
    // would make a finished issue's report grow each time it is opened.
    const closed = agg({ lastExitedAt: INGESTED_AT - HOUR });
    const topped = topUpOpenVisit(closed, INGESTED_AT + 365 * DAY);
    expect(topped.elapsedMs).toBe(10 * HOUR);
    expect(topped.businessMs).toBe(4 * HOUR);
  });

  it('measures from the row’s write time, not from when the visit began', () => {
    // `elapsedMs` already runs from `lastEnteredAt` up to `updatedAt`. Reading
    // the top-up from `lastEnteredAt` instead would count that stretch twice:
    // 10h stored + 13h since entry = 23h, for a visit only 13h old.
    const topped = topUpOpenVisit(agg(), INGESTED_AT + 3 * HOUR);
    expect(topped.elapsedMs).not.toBe(23 * HOUR);
    expect(topped.elapsedMs).toBe(13 * HOUR);
  });

  it('never subtracts time when the row was written after the report’s clock', () => {
    // Container clock skew and event replay both produce this, and neither is
    // a reason to show less time than was already measured.
    const topped = topUpOpenVisit(agg(), INGESTED_AT - 5 * HOUR);
    expect(topped.elapsedMs).toBe(10 * HOUR);
  });

  it('advances working hours on the working calendar, not on the wall clock', () => {
    // ★ The subtle half. From Friday 15:00 to Monday 15:00 is 72 elapsed
    // hours but only 8 working hours: 2h to Friday's 17:00 close, nothing
    // across the weekend, then 6h from Monday's 09:00 open.
    const calendar = normaliseCalendar(standardBusinessCalendar('UTC'));
    const monday = T('2026-03-09T15:00:00Z');
    const topped = topUpOpenVisit(agg(), monday, calendar);

    expect(topped.elapsedMs).toBe(10 * HOUR + 72 * HOUR);
    expect(topped.businessMs).toBe(4 * HOUR + 8 * HOUR);
  });

  it('collapses working hours onto elapsed time when no calendar is supplied', () => {
    // Mirrors `computeTimeInStatus`, where `businessMs` *is* `elapsedMs`
    // without a calendar. If the two disagreed, a calendar-less report would
    // advance its two bases by different amounts.
    const topped = topUpOpenVisit(agg(), INGESTED_AT + 3 * HOUR);
    expect(topped.businessMs).toBe(4 * HOUR + 3 * HOUR);
  });
});

describe('buildStatusReport, on a row nothing has re-ingested', () => {
  it('reports the status the issue is still in as of report time', async () => {
    const store = await storeWith([agg()]);
    const report = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      limit: 10,
      offset: 0,
      now: INGESTED_AT + 8 * DAY,
    });

    // 10h measured at ingest, plus the eight days nobody touched the issue.
    expect(report.rows[0]?.byStatus['3']).toBe(10 * HOUR + 8 * DAY);
    expect(report.rows[0]?.totalMs).toBe(10 * HOUR + 8 * DAY);
  });

  it('carries the advance into the per-status percentiles, not just the cells', async () => {
    // The tiles above the table are computed from `rows`, so a top-up applied
    // only to the rendered cell would leave the median contradicting the
    // column it summarises.
    const store = await storeWith([agg()]);
    const report = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      limit: 10,
      offset: 0,
      now: INGESTED_AT + 8 * DAY,
    });
    expect(report.summaryByStatus['3']?.medianMs).toBe(10 * HOUR + 8 * DAY);
  });

  it('advances the working-hours basis across a weekend by working time alone', async () => {
    const store = await storeWith([agg()]);
    const report = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'business',
      limit: 10,
      offset: 0,
      now: T('2026-03-09T15:00:00Z'),
      calendar: normaliseCalendar(standardBusinessCalendar('UTC')),
    });
    expect(report.rows[0]?.byStatus['3']).toBe(4 * HOUR + 8 * HOUR);
  });

  it('holds a finished status still while the open one moves', async () => {
    // Both rows belong to one issue, so this is the whole rule in a single
    // report: the closed status is history and the open one is a clock.
    const store = await storeWith([
      agg({ statusId: '3' }),
      agg({ statusId: '10001', elapsedMs: 2 * HOUR, lastExitedAt: INGESTED_AT - HOUR }),
    ]);
    const report = await buildStatusReport(store, {
      projectId: '10000',
      basis: 'elapsed',
      limit: 10,
      offset: 0,
      now: INGESTED_AT + 8 * DAY,
    });
    expect(report.rows[0]?.byStatus['10001']).toBe(2 * HOUR);
    expect(report.rows[0]?.byStatus['3']).toBe(10 * HOUR + 8 * DAY);
  });
});
