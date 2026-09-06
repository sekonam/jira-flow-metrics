import { describe, expect, it } from 'vitest';
import {
  currentStatusOf,
  extractStatusTransitions,
  reconstructTimeline,
  timelineFromIssue,
  UNKNOWN_STATUS_ID,
} from '../src/changelog/reconstruct.js';
import { computeTimeInStatus, mostRecentVisitMs, totalMs } from '../src/metrics/time-in-status.js';
import type { JiraChangelogPage, JiraSearchPage } from '../src/jira/types.js';
import { EngineError } from '../src/types.js';
import { loadFixture, reentryTimeline, T, UTC_BUSINESS_CALENDAR } from './helpers.js';

const HOUR = 3_600_000;
const NOW = T('2026-03-05T12:00:00Z');

/**
 * The headline capability.
 *
 * Jira's native Control Chart reports only the most recent period an issue
 * spent in a status. The fixture issue enters "In Progress" twice — four hours,
 * then eight — so the two numbers differ by design, and this file asserts both.
 */

describe('status timeline reconstruction', () => {
  it('reconstructs every segment including the open one', () => {
    const timeline = reentryTimeline();
    expect(timeline.intervals.map((i) => [i.statusName, i.entryOrdinal])).toEqual([
      ['To Do', 1],
      ['In Progress', 1],
      ['Blocked', 1],
      ['In Progress', 2],
      ['In Review', 1],
      ['Done', 1],
    ]);
    expect(timeline.intervals[5]?.end).toBeNull();
    expect(timeline.truncated).toBe(false);
    expect(currentStatusOf(timeline)).toBe('10001');
  });

  it('ignores non-status changelog items', () => {
    const page = loadFixture<JiraChangelogPage>('changelog-reentry.json');
    // The fixture's second entry also changes the assignee, and the fifth also
    // changes the resolution; neither may produce a status transition.
    expect(extractStatusTransitions(page.values ?? [])).toHaveLength(5);
  });

  it('starts in the current status when the issue never transitioned', () => {
    const timeline = reconstructTimeline({
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      createdAt: T('2026-03-02T08:00:00Z'),
      currentStatusId: '10000',
      currentStatusName: 'To Do',
      entries: [],
    });
    expect(timeline.intervals).toHaveLength(1);
    expect(timeline.intervals[0]?.statusId).toBe('10000');
    expect(timeline.truncated).toBe(false);
  });

  it('marks the timeline truncated when the starting status is unknowable', () => {
    const timeline = reconstructTimeline({
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      createdAt: T('2026-03-02T08:00:00Z'),
      currentStatusId: null,
      currentStatusName: null,
      entries: [],
    });
    expect(timeline.truncated).toBe(true);
    expect(timeline.intervals[0]?.statusId).toBe(UNKNOWN_STATUS_ID);
    expect(currentStatusOf(timeline)).toBeNull();
  });

  it('flags a discontinuity between one transition and the next', () => {
    const timeline = reconstructTimeline({
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      createdAt: T('2026-03-02T08:00:00Z'),
      currentStatusId: '10001',
      currentStatusName: 'Done',
      entries: [
        {
          id: '1',
          created: '2026-03-02T09:00:00.000+0000',
          items: [
            {
              field: 'status',
              from: '10000',
              fromString: 'To Do',
              to: '3',
              toString: 'In Progress',
            },
          ],
        },
        {
          // Leaves "In Review", which the timeline never entered — history gap.
          id: '2',
          created: '2026-03-03T09:00:00.000+0000',
          items: [
            {
              field: 'status',
              from: '10200',
              fromString: 'In Review',
              to: '10001',
              toString: 'Done',
            },
          ],
        },
      ],
    });
    expect(timeline.truncated).toBe(true);
  });

  it('clamps a transition recorded before the issue was created', () => {
    const created = T('2026-03-02T08:00:00Z');
    const timeline = reconstructTimeline({
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      createdAt: created,
      currentStatusId: '3',
      currentStatusName: 'In Progress',
      entries: [
        {
          id: '1',
          created: '2026-03-01T09:00:00.000+0000',
          items: [
            {
              field: 'status',
              from: '10000',
              fromString: 'To Do',
              to: '3',
              toString: 'In Progress',
            },
          ],
        },
      ],
    });
    expect(timeline.intervals[0]).toMatchObject({ start: created, end: created });
    expect(timeline.intervals[1]?.start).toBe(created);
  });

  it('keeps zero-length visits from chained transitions', () => {
    const timeline = reconstructTimeline({
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      createdAt: T('2026-03-02T08:00:00Z'),
      currentStatusId: '10001',
      currentStatusName: 'Done',
      entries: [
        {
          id: '1',
          created: '2026-03-02T09:00:00.000+0000',
          items: [
            {
              field: 'status',
              from: '10000',
              fromString: 'To Do',
              to: '3',
              toString: 'In Progress',
            },
          ],
        },
        {
          id: '2',
          created: '2026-03-02T09:00:00.000+0000',
          items: [
            {
              field: 'status',
              from: '3',
              fromString: 'In Progress',
              to: '10001',
              toString: 'Done',
            },
          ],
        },
      ],
    });
    const inProgress = timeline.intervals.find((i) => i.statusId === '3');
    expect(inProgress).toMatchObject({
      start: T('2026-03-02T09:00:00Z'),
      end: T('2026-03-02T09:00:00Z'),
    });
    const result = computeTimeInStatus(timeline, { now: NOW });
    expect(result.durations.find((d) => d.statusId === '3')).toMatchObject({
      elapsedMs: 0,
      entries: 1,
    });
  });

  it('records the rename history of a status', () => {
    const timeline = reconstructTimeline({
      issueId: '1',
      issueKey: 'FLOW-1',
      projectId: '10000',
      createdAt: T('2026-03-02T08:00:00Z'),
      currentStatusId: '3',
      currentStatusName: 'Doing',
      entries: [
        {
          id: '1',
          created: '2026-03-02T09:00:00.000+0000',
          items: [
            {
              field: 'status',
              from: '10000',
              fromString: 'To Do',
              to: '3',
              toString: 'In Progress',
            },
          ],
        },
        {
          id: '2',
          created: '2026-03-03T09:00:00.000+0000',
          items: [
            { field: 'status', from: '3', fromString: 'Doing', to: '10000', toString: 'To Do' },
          ],
        },
      ],
    });
    // The same status id was seen under two names; both are retained, newest last.
    expect(timeline.statusNames.get('3')).toEqual(['In Progress', 'Doing']);
  });

  it('rejects an issue with no usable created date', () => {
    expect(() =>
      reconstructTimeline({
        issueId: '1',
        issueKey: 'FLOW-1',
        projectId: '10000',
        createdAt: Number.NaN,
        currentStatusId: '1',
        currentStatusName: 'To Do',
        entries: [],
      }),
    ).toThrow(EngineError);
  });

  it('builds a timeline straight from a search result', () => {
    const page = loadFixture<JiraSearchPage>('search-page.json');
    const timeline = timelineFromIssue(page.issues![0]!);
    expect(timeline?.issueKey).toBe('FLOW-1');
    expect(timeline?.truncated).toBe(false);

    // The second issue's inlined changelog is only a slice of the total, so the
    // timeline built from it alone must declare itself incomplete.
    const partial = timelineFromIssue(page.issues![1]!);
    expect(partial?.truncated).toBe(true);
  });

  it('returns null for an issue payload it cannot use', () => {
    expect(timelineFromIssue({ key: 'FLOW-9' })).toBeNull();
  });
});

describe('cumulative time in status', () => {
  it('sums every visit to a status, which the Control Chart does not', () => {
    const result = computeTimeInStatus(reentryTimeline(), { now: NOW });
    const inProgress = result.durations.find((d) => d.statusId === '3');

    // Visit 1: 2026-03-02 09:00 -> 13:00 = 4h. Visit 2: 2026-03-04 09:00 -> 17:00 = 8h.
    expect(inProgress?.elapsedMs).toBe(12 * HOUR);
    expect(inProgress?.entries).toBe(2);

    // What Jira's Control Chart would show for the same status and issue.
    expect(mostRecentVisitMs(reentryTimeline(), '3', { now: NOW })).toBe(8 * HOUR);
  });

  it('computes every status on the fixture issue', () => {
    const result = computeTimeInStatus(reentryTimeline(), { now: NOW });
    const byId = Object.fromEntries(result.durations.map((d) => [d.statusId, d]));

    expect(byId['10000']?.elapsedMs).toBe(1 * HOUR); // created 08:00 -> 09:00
    expect(byId['3']?.elapsedMs).toBe(12 * HOUR); // 4h + 8h
    expect(byId['10100']?.elapsedMs).toBe(44 * HOUR); // Mon 13:00 -> Wed 09:00
    expect(byId['10200']?.elapsedMs).toBe(18.5 * HOUR); // Wed 17:00 -> Thu 11:30
    expect(byId['10001']?.elapsedMs).toBe(0.5 * HOUR); // Thu 11:30 -> now 12:00

    expect(totalMs(result)).toBe(76 * HOUR);
    expect(result.currentStatusId).toBe('10001');
    expect(result.evaluatedAt).toBe(NOW);
  });

  it('computes business hours alongside elapsed', () => {
    const result = computeTimeInStatus(reentryTimeline(), {
      now: NOW,
      calendar: UTC_BUSINESS_CALENDAR,
    });
    const byId = Object.fromEntries(result.durations.map((d) => [d.statusId, d]));

    // 2026-03-02 is a Monday, 03-04 a Wednesday, 03-05 a Thursday.
    expect(byId['10000']?.businessMs).toBe(0); // 08:00-09:00, before the window
    expect(byId['3']?.businessMs).toBe(12 * HOUR); // both visits are inside 09:00-17:00
    // Blocked: Mon 13:00-17:00 (4h) + Tue 09:00-17:00 (8h) + Wed nothing before 09:00.
    expect(byId['10100']?.businessMs).toBe(12 * HOUR);
    expect(byId['10200']?.businessMs).toBe(2.5 * HOUR); // Thu 09:00-11:30
    expect(byId['10001']?.businessMs).toBe(0.5 * HOUR);

    expect(totalMs(result, 'business')).toBe(27 * HOUR);
  });

  it('falls back to elapsed when no calendar is given', () => {
    const result = computeTimeInStatus(reentryTimeline(), { now: NOW });
    for (const d of result.durations) expect(d.businessMs).toBe(d.elapsedMs);
  });

  it('clips to a reporting window', () => {
    const result = computeTimeInStatus(reentryTimeline(), {
      now: NOW,
      window: { start: T('2026-03-04T00:00:00Z'), end: T('2026-03-05T00:00:00Z') },
    });
    const byId = Object.fromEntries(result.durations.map((d) => [d.statusId, d]));

    // Only Wednesday counts: Blocked 00:00-09:00 (9h), In Progress 09:00-17:00
    // (8h), In Review 17:00-24:00 (7h). To Do and Done fall outside entirely.
    expect(byId['10100']?.elapsedMs).toBe(9 * HOUR);
    expect(byId['3']?.elapsedMs).toBe(8 * HOUR);
    expect(byId['3']?.entries).toBe(1); // only the second visit is in the window
    expect(byId['10200']?.elapsedMs).toBe(7 * HOUR);
    expect(byId['10000']).toBeUndefined();
    expect(byId['10001']).toBeUndefined();
  });

  it('reports the latest observed name for a renamed status', () => {
    const result = computeTimeInStatus(reentryTimeline(), { now: NOW });
    expect(result.durations.find((d) => d.statusId === '3')?.statusName).toBe('In Progress');
  });

  it('returns zero for a status the issue never visited', () => {
    expect(mostRecentVisitMs(reentryTimeline(), 'no-such-status', { now: NOW })).toBe(0);
  });

  it('measures the most recent visit in business hours too', () => {
    // The last In Progress visit is Wed 09:00-17:00, fully inside the window.
    expect(
      mostRecentVisitMs(reentryTimeline(), '3', { now: NOW, calendar: UTC_BUSINESS_CALENDAR }),
    ).toBe(8 * HOUR);
  });
});
