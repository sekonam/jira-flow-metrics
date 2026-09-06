import { businessMsIn, type WorkingCalendar } from '../time/calendar.js';
import { close, duration } from '../time/interval.js';
import { currentStatusOf } from '../changelog/reconstruct.js';
import type {
  ClosedInterval,
  IssueStatusDurations,
  IssueTimeline,
  Millis,
  StatusDuration,
  StatusId,
} from '../types.js';

/**
 * Cumulative time in status — the headline calculation.
 *
 * Jira's Control Chart reports only the most recent visit to a status. This
 * function sums **every** visit, which is the gap the product sells into, and
 * reports the visit count alongside so a user can see the difference.
 */

export interface TimeInStatusOptions {
  /** Instant used to close the still-open interval. Defaults to `Date.now()`. */
  readonly now?: Millis;
  /** When supplied, business milliseconds are computed against it. */
  readonly calendar?: WorkingCalendar;
  /**
   * Restrict the measurement to this window. Intervals are clipped, so an
   * issue that entered a status before the window contributes only the part
   * inside it. Used by the run-chart and WIP listings.
   */
  readonly window?: ClosedInterval;
}

export function computeTimeInStatus(
  timeline: IssueTimeline,
  options: TimeInStatusOptions = {},
): IssueStatusDurations {
  const now = options.now ?? Date.now();
  const calendar = options.calendar;
  const window = options.window;

  interface Accumulator {
    statusId: StatusId;
    statusName: string;
    elapsedMs: number;
    businessMs: number;
    entries: number;
    lastEnteredAt: number;
    lastExitedAt: number | null;
  }

  const byStatus = new Map<StatusId, Accumulator>();

  for (const interval of timeline.intervals) {
    const closed = close(interval, now);
    const measured = clipToWindow(closed, window);

    const acc = byStatus.get(interval.statusId) ?? {
      statusId: interval.statusId,
      statusName: interval.statusName,
      elapsedMs: 0,
      businessMs: 0,
      entries: 0,
      lastEnteredAt: interval.start,
      lastExitedAt: interval.end,
    };

    // A visit is counted whenever it exists in the timeline. Clipping to a
    // reporting window changes the *duration* attributed to the window, not
    // whether the visit happened — but a visit entirely outside the window is
    // not counted at all, because the report is about that window.
    if (measured !== null) {
      acc.entries += 1;
      acc.elapsedMs += duration(measured);
      if (calendar !== undefined) {
        acc.businessMs += businessMsIn(measured, calendar);
      }
    }

    if (interval.start >= acc.lastEnteredAt) {
      acc.lastEnteredAt = interval.start;
      acc.lastExitedAt = interval.end;
    }
    // The latest observed name wins: statuses get renamed and the report should
    // show what the status is called today.
    acc.statusName = interval.statusName;
    byStatus.set(interval.statusId, acc);
  }

  const durations: StatusDuration[] = [...byStatus.values()]
    .map((a) => ({
      statusId: a.statusId,
      statusName: a.statusName,
      elapsedMs: a.elapsedMs,
      businessMs: calendar === undefined ? a.elapsedMs : a.businessMs,
      entries: a.entries,
      lastEnteredAt: a.lastEnteredAt,
      lastExitedAt: a.lastExitedAt,
    }))
    .filter((d) => d.entries > 0)
    .sort((a, b) => b.elapsedMs - a.elapsedMs || a.statusId.localeCompare(b.statusId));

  return {
    issueId: timeline.issueId,
    issueKey: timeline.issueKey,
    projectId: timeline.projectId,
    createdAt: timeline.createdAt,
    currentStatusId: currentStatusOf(timeline),
    durations,
    evaluatedAt: now,
    truncated: timeline.truncated,
  };
}

function clipToWindow(
  interval: ClosedInterval,
  window: ClosedInterval | undefined,
): ClosedInterval | null {
  if (window === undefined) return interval;
  const start = Math.max(interval.start, window.start);
  const end = Math.min(interval.end, window.end);
  if (end < start) return null;
  if (end === start) {
    // A zero-length *visit* inside the window is retained, because chained
    // transitions are real events the entry count must reflect. A non-empty
    // interval that merely touches the window edge contributes nothing.
    return interval.end === interval.start ? { start, end } : null;
  }
  return { start, end };
}

/**
 * The single number Jira's Control Chart would report: the duration of the
 * *most recent* visit only. Exposed so the UI can show both side by side —
 * that contrast is the product's clearest sales argument, and showing it
 * honestly is cheaper than claiming superiority in marketing copy.
 */
export function mostRecentVisitMs(
  timeline: IssueTimeline,
  statusId: StatusId,
  options: TimeInStatusOptions = {},
): Millis {
  const now = options.now ?? Date.now();
  for (let i = timeline.intervals.length - 1; i >= 0; i -= 1) {
    const interval = timeline.intervals[i];
    if (interval === undefined || interval.statusId !== statusId) continue;
    const closed = close(interval, now);
    return options.calendar === undefined
      ? duration(closed)
      : businessMsIn(closed, options.calendar);
  }
  return 0;
}

/** Total of every status duration on one issue. */
export function totalMs(
  result: IssueStatusDurations,
  basis: 'elapsed' | 'business' = 'elapsed',
): Millis {
  return result.durations.reduce(
    (sum, d) => sum + (basis === 'business' ? d.businessMs : d.elapsedMs),
    0,
  );
}
