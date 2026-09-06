import type { ClosedInterval, Interval, Millis } from '../types.js';

/**
 * Interval algebra over half-open `[start, end)` ranges in epoch milliseconds.
 *
 * Everything here is total and defensive: Jira changelogs contain clock skew
 * between nodes, so `end < start` genuinely occurs in production data. Rather
 * than throw (which would break a whole report for one bad row) these
 * functions clamp to zero-length and let the caller carry on.
 */

/** Close an open interval against an evaluation instant. */
export function close(interval: Interval, now: Millis): ClosedInterval {
  const end = interval.end ?? now;
  return { start: interval.start, end: Math.max(interval.start, end) };
}

/** Length of a closed interval, never negative. */
export function duration(interval: ClosedInterval): Millis {
  return Math.max(0, interval.end - interval.start);
}

/** True when the interval carries no time at all. */
export function isEmpty(interval: ClosedInterval): boolean {
  return interval.end <= interval.start;
}

/**
 * Intersection of two closed intervals, or `null` when they do not overlap.
 * Touching intervals (`a.end === b.start`) do not overlap: the ranges are
 * half-open, so the shared instant belongs only to `b`.
 */
export function intersect(a: ClosedInterval, b: ClosedInterval): ClosedInterval | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end } : null;
}

/** Clip a closed interval to a window. Alias of {@link intersect}. */
export function clip(interval: ClosedInterval, window: ClosedInterval): ClosedInterval | null {
  return intersect(interval, window);
}

/**
 * Sort ascending by start, then by end. Returns a new array.
 */
export function sortIntervals(intervals: readonly ClosedInterval[]): ClosedInterval[] {
  return [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * Merge overlapping and adjacent intervals into a minimal disjoint cover.
 * Adjacent intervals (`a.end === b.start`) *are* merged here, because for
 * coverage purposes `[0,5) ∪ [5,9)` is exactly `[0,9)`.
 */
export function union(intervals: readonly ClosedInterval[]): ClosedInterval[] {
  const sorted = sortIntervals(intervals).filter((i) => !isEmpty(i));
  const merged: ClosedInterval[] = [];
  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && current.start <= last.end) {
      if (current.end > last.end) {
        merged[merged.length - 1] = { start: last.start, end: current.end };
      }
    } else {
      merged.push(current);
    }
  }
  return merged;
}

/**
 * Subtract a set of intervals from a single interval.
 * Used to remove SLA-paused periods from an elapsed duration.
 */
export function subtract(
  base: ClosedInterval,
  cutouts: readonly ClosedInterval[],
): ClosedInterval[] {
  if (isEmpty(base)) return [];
  const holes = union(cutouts);
  const result: ClosedInterval[] = [];
  let cursor = base.start;
  for (const hole of holes) {
    if (hole.end <= cursor) continue;
    if (hole.start >= base.end) break;
    if (hole.start > cursor) {
      result.push({ start: cursor, end: Math.min(hole.start, base.end) });
    }
    cursor = Math.max(cursor, hole.end);
    if (cursor >= base.end) break;
  }
  if (cursor < base.end) {
    result.push({ start: cursor, end: base.end });
  }
  return result.filter((i) => !isEmpty(i));
}

/** Total covered time of a set of intervals, counting overlaps once. */
export function coveredMs(intervals: readonly ClosedInterval[]): Millis {
  return union(intervals).reduce((sum, i) => sum + duration(i), 0);
}
