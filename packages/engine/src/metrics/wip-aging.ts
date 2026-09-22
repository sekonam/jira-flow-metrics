import { businessMsIn, DAY_MS, type WorkingCalendar } from '../time/calendar.js';
import { localDateKey } from '../time/zone.js';
import { percentile } from './cycle-time.js';
import type { StatusCategoryResolver } from './cycle-time.js';
import type { IssueTimeline, Millis, StatusId } from '../types.js';

/**
 * WIP aging and run charts — the engine behind listing 3.
 *
 * "Aging" is the age of work *currently in flight*: how long each unfinished
 * issue has been in its present status, and in progress overall. It is the
 * question a standup asks, so it is recurring and it appears in the output
 * people show each other — the two conditions that separate a report anyone
 * buys from one nobody does.
 */

export interface AgingItem {
  readonly issueId: string;
  readonly issueKey: string;
  readonly statusId: StatusId;
  readonly statusName: string;
  /** Time in the *current* status, still running. */
  readonly ageInStatusMs: Millis;
  readonly ageInStatusBusinessMs: Millis;
  /** Time since the issue first entered an `inprogress` status. */
  readonly ageInProgressMs: Millis | null;
  /** Time since creation. */
  readonly ageTotalMs: Millis;
  readonly enteredStatusAt: Millis;
}

export interface AgingOptions {
  readonly now?: Millis;
  readonly calendar?: WorkingCalendar;
}

/** Age one in-flight issue. Returns `null` for issues that are already done. */
export function computeAging(
  timeline: IssueTimeline,
  resolver: StatusCategoryResolver,
  options: AgingOptions = {},
): AgingItem | null {
  const now = options.now ?? Date.now();
  const last = timeline.intervals[timeline.intervals.length - 1];
  if (last === undefined) return null;
  const category = resolver.categoryOf(last.statusId);
  if (category === 'done') return null;

  let firstInProgress: Millis | null = null;
  for (const interval of timeline.intervals) {
    if (resolver.categoryOf(interval.statusId) === 'inprogress') {
      firstInProgress = interval.start;
      break;
    }
  }

  const span = { start: last.start, end: Math.max(last.start, now) };
  return {
    issueId: timeline.issueId,
    issueKey: timeline.issueKey,
    statusId: last.statusId,
    statusName: last.statusName,
    ageInStatusMs: span.end - span.start,
    ageInStatusBusinessMs:
      options.calendar === undefined ? span.end - span.start : businessMsIn(span, options.calendar),
    ageInProgressMs: firstInProgress === null ? null : Math.max(0, now - firstInProgress),
    ageTotalMs: Math.max(0, now - timeline.createdAt),
    enteredStatusAt: last.start,
  };
}

export interface AgingBucket {
  /** Inclusive lower bound in days. */
  readonly fromDays: number;
  /** Exclusive upper bound in days; `null` means unbounded. */
  readonly toDays: number | null;
  readonly label: string;
  readonly count: number;
  readonly issueKeys: readonly string[];
}

export const DEFAULT_AGING_BUCKETS: readonly { fromDays: number; toDays: number | null }[] = [
  { fromDays: 0, toDays: 1 },
  { fromDays: 1, toDays: 3 },
  { fromDays: 3, toDays: 7 },
  { fromDays: 7, toDays: 14 },
  { fromDays: 14, toDays: 30 },
  { fromDays: 30, toDays: null },
];

/** Bucket in-flight issues by age, for the "how stale is our board?" histogram. */
export function bucketByAge(
  items: readonly AgingItem[],
  basis: 'status' | 'progress' | 'total' = 'status',
  buckets = DEFAULT_AGING_BUCKETS,
): AgingBucket[] {
  const result = buckets.map((b) => ({
    fromDays: b.fromDays,
    toDays: b.toDays,
    label: b.toDays === null ? `${b.fromDays}d+` : `${b.fromDays}-${b.toDays}d`,
    count: 0,
    issueKeys: [] as string[],
  }));

  for (const item of items) {
    const ms = ageForBasis(item, basis);
    if (ms === null) continue;
    const days = ms / DAY_MS;
    for (const bucket of result) {
      if (days >= bucket.fromDays && (bucket.toDays === null || days < bucket.toDays)) {
        bucket.count += 1;
        bucket.issueKeys.push(item.issueKey);
        break;
      }
    }
  }
  return result;
}

function ageForBasis(item: AgingItem, basis: 'status' | 'progress' | 'total'): Millis | null {
  switch (basis) {
    case 'status':
      return item.ageInStatusMs;
    case 'progress':
      return item.ageInProgressMs;
    case 'total':
      return item.ageTotalMs;
    default: {
      const exhaustive: never = basis;
      return exhaustive;
    }
  }
}

export interface RunChartPoint {
  /** `YYYY-MM-DD` bucket in the calendar's timezone. */
  readonly date: string;
  /** Issues that entered a `done` status on this day. */
  readonly completed: number;
  /** Issues in flight at the end of this day. */
  readonly wip: number;
  /** Median cycle time of the issues completed on this day. */
  readonly medianCycleTimeMs: number | null;
  readonly p85CycleTimeMs: number | null;
}

export interface RunChartOptions {
  readonly from: Millis;
  readonly to: Millis;
  readonly timeZone?: string;
  readonly calendar?: WorkingCalendar;
}

/**
 * Daily throughput / WIP / cycle-time run chart over a set of timelines.
 *
 * Computed by walking each timeline once and attributing events to day
 * buckets, rather than by re-scanning the corpus per day. That keeps this
 * O(issues × transitions) instead of O(issues × days), which matters because
 * the report renders over a whole project's history.
 */
export function computeRunChart(
  timelines: readonly IssueTimeline[],
  resolver: StatusCategoryResolver,
  options: RunChartOptions,
): RunChartPoint[] {
  const tz = options.timeZone ?? options.calendar?.timeZone ?? 'UTC';
  const days = enumerateDays(options.from, options.to, tz);
  const dayIndex = new Map(days.map((d, i) => [d, i]));

  const completed = new Array<number>(days.length).fill(0);
  const cycleSamples: number[][] = days.map(() => []);
  // WIP is a running balance: +1 when an issue starts, -1 when it finishes.
  const delta = new Array<number>(days.length).fill(0);
  let openBeforeWindow = 0;

  const applyDelta = (at: Millis, value: number): void => {
    if (at < options.from) {
      openBeforeWindow += value;
      return;
    }
    const bucket = dayIndex.get(localDateKey(at, tz));
    if (bucket !== undefined) delta[bucket] = (delta[bucket] ?? 0) + value;
  };

  for (const timeline of timelines) {
    let startedAt: Millis | null = null;
    let doneAt: Millis | null = null;
    for (const interval of timeline.intervals) {
      const category = resolver.categoryOf(interval.statusId);
      if (category === 'inprogress' && startedAt === null) startedAt = interval.start;
      if (category === 'done' && doneAt === null) doneAt = interval.start;
    }
    if (startedAt === null) continue;

    applyDelta(startedAt, +1);
    if (doneAt !== null) {
      applyDelta(doneAt, -1);
      const bucket = dayIndex.get(localDateKey(doneAt, tz));
      if (bucket !== undefined) {
        completed[bucket] = (completed[bucket] ?? 0) + 1;
        cycleSamples[bucket]?.push(Math.max(0, doneAt - startedAt));
      }
    }
  }

  let wip = openBeforeWindow;
  return days.map((date, i) => {
    wip += delta[i] ?? 0;
    const samples = cycleSamples[i] ?? [];
    return {
      date,
      completed: completed[i] ?? 0,
      wip: Math.max(0, wip),
      medianCycleTimeMs: percentile(samples, 0.5),
      p85CycleTimeMs: percentile(samples, 0.85),
    };
  });
}

/** ~3 years; beyond that a daily chart is unreadable anyway. */
export const MAX_ENUMERATED_DAYS = 1100;

/** Would {@link enumerateDays} truncate this range? */
export function enumerateDaysCapped(from: Millis, to: Millis, timeZone: string): boolean {
  return enumerateDays(from, to, timeZone).length >= MAX_ENUMERATED_DAYS;
}

/**
 * Inclusive list of `YYYY-MM-DD` keys between two instants, in `timeZone`.
 *
 * ⚠️ Capped at {@link MAX_ENUMERATED_DAYS}. The cap is deliberate — beyond
 * roughly three years a daily chart is unreadable — but it used to return
 * the truncation with no way to tell: `enumerateDays` over six years handed
 * back 1,100 days ending in 2023 and the caller could not distinguish "the
 * project has three years of history" from "we dropped half your range".
 * That is the same silent-ceiling shape `StatusReport.capped` exists to
 * surface, so {@link enumerateDaysCapped} answers it.
 */
export function enumerateDays(from: Millis, to: Millis, timeZone: string): string[] {
  if (to < from) return [];
  const days: string[] = [];
  const MAX_DAYS = MAX_ENUMERATED_DAYS;
  let cursor = from;
  let last = '';
  while (cursor <= to && days.length < MAX_DAYS) {
    const key = localDateKey(cursor, timeZone);
    if (key !== last) {
      days.push(key);
      last = key;
    }
    cursor += DAY_MS / 4; // quarter-day steps survive every DST shift
  }
  const endKey = localDateKey(to, timeZone);
  if (days[days.length - 1] !== endKey && days.length < MAX_DAYS) days.push(endKey);
  return days;
}
