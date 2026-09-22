import { businessMsIn, type WorkingCalendar } from '../time/calendar.js';
import { close, duration } from '../time/interval.js';
import type {
  ClosedInterval,
  IssueTimeline,
  Millis,
  StatusCategory,
  StatusId,
  StatusMeta,
} from '../types.js';

/**
 * Cycle time, lead time and flow efficiency.
 *
 * Definitions are stated explicitly in the UI as well as here, because every
 * vendor in this niche defines them slightly differently and a user comparing
 * two apps needs to know which one they are looking at.
 *
 * - **Lead time** — issue creation → first entry into a `done` status.
 * - **Cycle time** — first entry into an `inprogress` status → first entry into
 *   a `done` status. An issue that never started has no cycle time.
 * - **Flow efficiency** — `inprogress` time ÷ (`inprogress` + `todo`) time
 *   inside the cycle-time span; the classic "how much of the wait was work?".
 *
 * Both use the *first* entry into `done`, not the last: reopening an issue
 * should not retroactively erase the fact that it was delivered. Reopens are
 * reported separately via `reopenCount`.
 */

export interface StatusCategoryResolver {
  categoryOf(statusId: StatusId): StatusCategory;
}

/** Build a resolver from `/rest/api/3/status` metadata. */
export function categoryResolver(statuses: readonly StatusMeta[]): StatusCategoryResolver {
  const map = new Map<StatusId, StatusCategory>();
  for (const s of statuses) map.set(s.id, s.category);
  return {
    categoryOf: (statusId) => map.get(statusId) ?? 'unknown',
  };
}

export interface CycleTimeOptions {
  readonly now?: Millis;
  readonly calendar?: WorkingCalendar;
}

export interface CycleTimeResult {
  readonly issueId: string;
  readonly issueKey: string;
  /** Creation → first `done`. `null` while the issue is not yet done. */
  readonly leadTimeMs: Millis | null;
  readonly leadTimeBusinessMs: Millis | null;
  /** First `inprogress` → first `done`. `null` if either end is missing. */
  readonly cycleTimeMs: Millis | null;
  readonly cycleTimeBusinessMs: Millis | null;
  readonly startedAt: Millis | null;
  readonly completedAt: Millis | null;
  /** Working time ÷ (working + waiting) inside the cycle span, 0-1. */
  readonly flowEfficiency: number | null;
  /** How many times the issue entered a `done` status after having left one. */
  readonly reopenCount: number;
}

export function computeCycleTime(
  timeline: IssueTimeline,
  resolver: StatusCategoryResolver,
  options: CycleTimeOptions = {},
): CycleTimeResult {
  const now = options.now ?? Date.now();
  const calendar = options.calendar;

  let startedAt: Millis | null = null;
  let completedAt: Millis | null = null;
  let doneEntries = 0;
  let wasDone = false;

  for (const interval of timeline.intervals) {
    const category = resolver.categoryOf(interval.statusId);
    if (category === 'inprogress' && startedAt === null) startedAt = interval.start;
    if (category === 'done') {
      if (completedAt === null) completedAt = interval.start;
      if (!wasDone) doneEntries += 1;
      wasDone = true;
    } else {
      wasDone = false;
    }
  }

  const leadSpan: ClosedInterval | null =
    completedAt === null ? null : { start: timeline.createdAt, end: completedAt };
  const cycleSpan: ClosedInterval | null =
    startedAt === null || completedAt === null || completedAt < startedAt
      ? null
      : { start: startedAt, end: completedAt };

  return {
    issueId: timeline.issueId,
    issueKey: timeline.issueKey,
    leadTimeMs: leadSpan === null ? null : duration(leadSpan),
    leadTimeBusinessMs:
      leadSpan === null
        ? null
        : calendar === undefined
          ? duration(leadSpan)
          : businessMsIn(leadSpan, calendar),
    cycleTimeMs: cycleSpan === null ? null : duration(cycleSpan),
    cycleTimeBusinessMs:
      cycleSpan === null
        ? null
        : calendar === undefined
          ? duration(cycleSpan)
          : businessMsIn(cycleSpan, calendar),
    startedAt,
    completedAt,
    flowEfficiency:
      cycleSpan === null ? null : flowEfficiency(timeline, resolver, cycleSpan, now, calendar),
    reopenCount: Math.max(0, doneEntries - 1),
  };
}

/**
 * Working time as a share of working-plus-waiting time.
 *
 * ★ Measured on the **same clock as the cycle time beside it**. It used to
 * ignore `calendar` while `cycleTimeBusinessMs` on the same result honoured
 * it, so one row could read "11 business hours, 11% efficient" where the
 * business-clock answer was 27% — two numbers on two different clocks,
 * presented as describing the same issue. Nights and weekends count as
 * neither work nor waiting once a working calendar is in play.
 */
function flowEfficiency(
  timeline: IssueTimeline,
  resolver: StatusCategoryResolver,
  span: ClosedInterval,
  now: Millis,
  calendar?: WorkingCalendar,
): number | null {
  let working = 0;
  let waiting = 0;
  for (const interval of timeline.intervals) {
    const closed = close(interval, now);
    const start = Math.max(closed.start, span.start);
    const end = Math.min(closed.end, span.end);
    if (end <= start) continue;
    const category = resolver.categoryOf(interval.statusId);
    const measured = calendar === undefined ? end - start : businessMsIn({ start, end }, calendar);
    if (category === 'inprogress') working += measured;
    else if (category === 'todo') waiting += measured;
  }
  const total = working + waiting;
  return total === 0 ? null : working / total;
}

/** Percentile of a numeric sample, using linear interpolation (the "R-7" method). */
export function percentile(values: readonly number[], p: number): number | null {
  const sample = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sample.length === 0) return null;
  if (sample.length === 1) return sample[0] ?? null;
  const clamped = Math.min(1, Math.max(0, p));
  const rank = clamped * (sample.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const lowerValue = sample[lower];
  const upperValue = sample[upper];
  if (lowerValue === undefined || upperValue === undefined) return null;
  if (lower === upper) return lowerValue;
  return lowerValue + (upperValue - lowerValue) * (rank - lower);
}

export interface DistributionSummary {
  readonly count: number;
  readonly meanMs: number | null;
  readonly medianMs: number | null;
  readonly p85Ms: number | null;
  readonly p95Ms: number | null;
  readonly minMs: number | null;
  readonly maxMs: number | null;
}

/**
 * Summarise a set of durations. Median and 85th percentile are reported rather
 * than the mean alone because cycle-time distributions are heavily right-skewed
 * and a mean is close to meaningless on them.
 */
export function summariseDurations(values: readonly (number | null)[]): DistributionSummary {
  const sample = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (sample.length === 0) {
    return {
      count: 0,
      meanMs: null,
      medianMs: null,
      p85Ms: null,
      p95Ms: null,
      minMs: null,
      maxMs: null,
    };
  }
  const sum = sample.reduce((a, b) => a + b, 0);
  return {
    count: sample.length,
    meanMs: sum / sample.length,
    medianMs: percentile(sample, 0.5),
    p85Ms: percentile(sample, 0.85),
    p95Ms: percentile(sample, 0.95),
    // Reduced, not spread. `Math.min(...sample)` puts every element on the
    // argument stack, and a project-wide summary of 200,000 cycle times
    // threw `RangeError: Maximum call stack size exceeded` — from the one
    // function whose whole job is to survive a large sample.
    minMs: sample.reduce((a, b) => (b < a ? b : a), sample[0]!),
    maxMs: sample.reduce((a, b) => (b > a ? b : a), sample[0]!),
  };
}
