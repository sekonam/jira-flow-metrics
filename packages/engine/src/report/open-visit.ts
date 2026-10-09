import { businessMsIn } from '../time/calendar.js';
import type { WorkingCalendar } from '../time/calendar.js';
import type { StatusAggregateRow } from '../store/types.js';
import type { Millis } from '../types.js';

/**
 * Advancing a stored aggregate's still-open visit to report time.
 *
 * ★ Why this module exists.
 *
 * `computeTimeInStatus` closes the visit an issue is *currently* in at the
 * `now` it is given, and ingestion gives it the ingest instant — then writes
 * the closed number into `issue_status_agg` with `updatedAt` set to that same
 * instant. The number is therefore correct **as of `updatedAt`** and goes
 * stale from the next millisecond, because the issue keeps sitting where it
 * is while nothing re-ingests it. An issue that has not moved generates no
 * issue event, so nothing ever does.
 *
 * Observed live on 2026-10-09 against a 2,000-issue project: `JFMB-2` entered
 * In Progress on 11 Sep and had not moved since. Jira's own changelog put it
 * at 27d 20h; the WIP-aging report (which computes from `enteredStatusAt` and
 * `now`) and the issue-timeline tab (which re-runs `computeTimeInStatus` with
 * a live `now`) both said 27d 20h; the time-in-status *project page*, reading
 * the stored row back verbatim, said 19d 22h — understating the flagship
 * listing's headline number by eight days, and understating it most for
 * exactly the issues a reader cares about, the ones that have been stuck
 * longest.
 *
 * The repository's recurring defect shape, once more: the arithmetic was
 * verified where it is computed — `computeTimeInStatus` takes an injected
 * `now` and every test passes one — and not where it is used, where the
 * injected `now` had already been frozen into a row months earlier.
 *
 * ## What is and is not topped up
 *
 * `lastExitedAt === null` is the precise marker of "the last visit to this
 * status is still open", written by the same pass that computed the duration.
 * A closed status is final and is returned untouched: a report of a finished
 * issue must not drift upwards every time it is rendered.
 *
 * The top-up is `now - updatedAt`, not `now - lastEnteredAt`: the stored
 * duration already contains the open visit measured up to `updatedAt`, so
 * measuring from `lastEnteredAt` would count that stretch twice.
 */
export interface ToppedUpDurations {
  readonly elapsedMs: Millis;
  readonly businessMs: Millis;
}

/**
 * The row's durations as of `now`.
 *
 * `calendar` must be the one the report is being rendered under. Omitting it
 * mirrors `computeTimeInStatus`, where `businessMs` collapses onto elapsed
 * time when no calendar is supplied — the two functions have to agree, or a
 * calendar-less report would top up its two bases by different amounts.
 */
export function topUpOpenVisit(
  row: StatusAggregateRow,
  now: Millis,
  calendar?: WorkingCalendar,
): ToppedUpDurations {
  // A closed visit is final. Returning early also keeps a resolved issue's
  // figures stable across renders, which a reader checking the same report
  // twice is entitled to.
  if (row.lastExitedAt !== null) {
    return { elapsedMs: row.elapsedMs, businessMs: row.businessMs };
  }

  // Non-positive means the row was written at or after `now` — a replay, or
  // clock skew between the ingesting container and this one. Both are real
  // and neither justifies subtracting time from a stored figure, so the row
  // stands as written.
  const sinceIngest = now - row.updatedAt;
  if (sinceIngest <= 0) {
    return { elapsedMs: row.elapsedMs, businessMs: row.businessMs };
  }

  const interval = { start: row.updatedAt, end: now };
  return {
    elapsedMs: row.elapsedMs + sinceIngest,
    businessMs:
      calendar === undefined
        ? row.businessMs + sinceIngest
        : row.businessMs + businessMsIn(interval, calendar),
  };
}
