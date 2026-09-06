import { EngineError, type ClosedInterval, type Millis } from '../types.js';
import { duration, intersect } from './interval.js';
import {
  addDays,
  formatDateKey,
  isValidTimeZone,
  localDateKey,
  parseDateKey,
  toZonedParts,
  zonedToInstant,
} from './zone.js';

/**
 * Working-calendar arithmetic.
 *
 * This is the module the product lives or dies on. A time-in-status report
 * that is quietly wrong about business hours is worse than no report, so every
 * rule here is explicit and covered by golden-file tests
 * (`test/golden/business-hours.golden.json`).
 *
 * ## Model
 *
 * A calendar is a timezone, a weekly pattern of working windows expressed in
 * **minutes from local midnight**, and a set of non-working local dates.
 * Windows are half-open `[from, to)`; `to = 1440` means local midnight at the
 * end of the day.
 *
 * ## Why minutes-from-local-midnight and not fixed UTC offsets
 *
 * Because DST exists. "09:00-17:00 Europe/Berlin" is eight hours on every day
 * of the year, but it is 08:00-16:00 UTC in summer and 07:00-16:00... no —
 * it is a *different UTC range* in winter, and a naive implementation silently
 * shifts every report by an hour for half the year. Resolving windows per local
 * day through the zone database is the only way to be right.
 *
 * A 24/7 calendar (`00:00-24:00` every day) correspondingly measures 23 hours
 * on a spring-forward day and 25 on a fall-back day, which is the physically
 * correct answer and is asserted in the golden file.
 */

/** 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** A working window inside a local day, in minutes from local midnight. */
export interface WorkingWindow {
  /** Inclusive start, 0-1439. */
  readonly fromMinute: number;
  /** Exclusive end, 1-1440. `1440` is local midnight ending the day. */
  readonly toMinute: number;
}

export interface WorkingCalendar {
  /** Stable identifier, referenced by report configuration. */
  readonly id: string;
  readonly name: string;
  /** IANA timezone, e.g. `Europe/Berlin`. */
  readonly timeZone: string;
  /** Working windows per weekday. A missing or empty entry is a non-working day. */
  readonly week: Readonly<Partial<Record<Weekday, readonly WorkingWindow[]>>>;
  /** Non-working local dates as `YYYY-MM-DD`, e.g. public holidays. */
  readonly holidays: readonly string[];
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** Mon-Fri 09:00-17:00 — the default every competitor ships. */
export function standardBusinessCalendar(
  timeZone = 'UTC',
  overrides: Partial<Pick<WorkingCalendar, 'id' | 'name' | 'holidays'>> = {},
): WorkingCalendar {
  const window: WorkingWindow[] = [{ fromMinute: 9 * 60, toMinute: 17 * 60 }];
  return {
    id: overrides.id ?? 'standard',
    name: overrides.name ?? 'Mon-Fri 09:00-17:00',
    timeZone,
    week: { 1: window, 2: window, 3: window, 4: window, 5: window },
    holidays: overrides.holidays ?? [],
  };
}

/** Every hour of every day. Business time then equals elapsed time. */
export function alwaysOnCalendar(timeZone = 'UTC'): WorkingCalendar {
  const full: WorkingWindow[] = [{ fromMinute: 0, toMinute: 1440 }];
  return {
    id: '24x7',
    name: '24/7',
    timeZone,
    week: { 0: full, 1: full, 2: full, 3: full, 4: full, 5: full, 6: full },
    holidays: [],
  };
}

/**
 * Validate a calendar and return it normalised: windows sorted, merged where
 * they overlap, and clamped to `[0, 1440]`. Throws `EngineError` on structural
 * problems, because a bad calendar must not silently produce plausible numbers.
 */
export function normaliseCalendar(calendar: WorkingCalendar): WorkingCalendar {
  if (!isValidTimeZone(calendar.timeZone)) {
    throw new EngineError(`Unknown IANA timezone: ${calendar.timeZone}`, 'UNKNOWN_TIMEZONE');
  }
  const week: Partial<Record<Weekday, readonly WorkingWindow[]>> = {};
  for (const key of Object.keys(calendar.week)) {
    const day = Number(key) as Weekday;
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new EngineError(`Weekday out of range: ${key}`, 'BAD_WEEKDAY');
    }
    const windows = calendar.week[day] ?? [];
    week[day] = normaliseWindows(windows);
  }
  const holidays = [...new Set(calendar.holidays)].map((h) => {
    const { year, month, day } = parseDateKey(h);
    return formatDateKey(year, month, day);
  });
  holidays.sort();
  return { ...calendar, week, holidays };
}

function normaliseWindows(windows: readonly WorkingWindow[]): WorkingWindow[] {
  const cleaned = windows
    .map((w) => ({
      fromMinute: Math.max(0, Math.min(1440, Math.trunc(w.fromMinute))),
      toMinute: Math.max(0, Math.min(1440, Math.trunc(w.toMinute))),
    }))
    .filter((w) => w.toMinute > w.fromMinute)
    .sort((a, b) => a.fromMinute - b.fromMinute || a.toMinute - b.toMinute);

  const merged: WorkingWindow[] = [];
  for (const w of cleaned) {
    const last = merged[merged.length - 1];
    if (last !== undefined && w.fromMinute <= last.toMinute) {
      if (w.toMinute > last.toMinute) {
        merged[merged.length - 1] = { fromMinute: last.fromMinute, toMinute: w.toMinute };
      }
    } else {
      merged.push(w);
    }
  }
  return merged;
}

/** Working minutes in one local weekday pattern, ignoring DST. Used for capacity maths. */
export function nominalMinutesForWeekday(calendar: WorkingCalendar, weekday: Weekday): number {
  const windows = calendar.week[weekday] ?? [];
  return windows.reduce((sum, w) => sum + (w.toMinute - w.fromMinute), 0);
}

/** Nominal working minutes in a full week. Zero means the calendar can never advance. */
export function nominalMinutesPerWeek(calendar: WorkingCalendar): number {
  let total = 0;
  for (let d = 0; d <= 6; d += 1) {
    total += nominalMinutesForWeekday(calendar, d as Weekday);
  }
  return total;
}

/**
 * The concrete working intervals of one local day, as UTC instants.
 * Returns `[]` for weekends and holidays.
 */
export function workingIntervalsForLocalDay(
  calendar: WorkingCalendar,
  year: number,
  month: number,
  day: number,
): ClosedInterval[] {
  const dateKey = formatDateKey(year, month, day);
  if (calendar.holidays.includes(dateKey)) return [];
  const midnight = zonedToInstant(year, month, day, 0, 0, 0, calendar.timeZone);
  const weekday = toZonedParts(midnight, calendar.timeZone).weekday as Weekday;
  const windows = calendar.week[weekday] ?? [];
  const intervals: ClosedInterval[] = [];
  for (const w of windows) {
    const start = zonedToInstant(year, month, day, 0, w.fromMinute, 0, calendar.timeZone);
    const end = zonedToInstant(year, month, day, 0, w.toMinute, 0, calendar.timeZone);
    if (end > start) intervals.push({ start, end });
  }
  return intervals;
}

/**
 * Working milliseconds inside `interval`.
 *
 * Walks the interval one local day at a time. Bounded by design: the caller
 * cannot make this loop forever, because the iteration advances by whole local
 * days and stops at `interval.end`.
 */
export function businessMsIn(interval: ClosedInterval, calendar: WorkingCalendar): Millis {
  if (interval.end <= interval.start) return 0;
  const tz = calendar.timeZone;
  let total = 0;
  let cursor = toZonedParts(interval.start, tz);
  let dayStart = zonedToInstant(cursor.year, cursor.month, cursor.day, 0, 0, 0, tz);

  // Guard against pathological inputs (a 1000-year interval would be 365k
  // iterations of Intl work). Past the cap we fall back to a whole-week
  // extrapolation, which is exact for calendars without holidays in the gap.
  const MAX_DAYS = 4000;
  let dayCount = 0;

  while (dayStart < interval.end) {
    const dayWindows = workingIntervalsForLocalDay(calendar, cursor.year, cursor.month, cursor.day);
    for (const w of dayWindows) {
      const overlap = intersect(w, interval);
      if (overlap !== null) total += duration(overlap);
    }
    const next = addDays(cursor.year, cursor.month, cursor.day, 1);
    cursor = { ...cursor, ...next };
    dayStart = zonedToInstant(next.year, next.month, next.day, 0, 0, 0, tz);
    dayCount += 1;
    if (dayCount > MAX_DAYS) {
      throw new EngineError(
        `Refusing to walk more than ${MAX_DAYS} days of working calendar; ` +
          `interval is ${Math.round((interval.end - interval.start) / DAY_MS)} days long`,
        'CALENDAR_RANGE_TOO_LARGE',
      );
    }
  }
  return total;
}

/** Sum of {@link businessMsIn} over several intervals. Overlaps are *not* deduplicated. */
export function businessMsInAll(
  intervals: readonly ClosedInterval[],
  calendar: WorkingCalendar,
): Millis {
  return intervals.reduce((sum, i) => sum + businessMsIn(i, calendar), 0);
}

/** True when `instant` falls inside a working window. */
export function isWorkingTime(instant: Millis, calendar: WorkingCalendar): boolean {
  const p = toZonedParts(instant, calendar.timeZone);
  return workingIntervalsForLocalDay(calendar, p.year, p.month, p.day).some(
    (w) => instant >= w.start && instant < w.end,
  );
}

/**
 * Add `businessMs` of working time to `from` and return the resulting instant.
 * Used by the SLA listing to turn "8 business hours" into a concrete due date.
 *
 * Returns `null` when the calendar has no working time at all, because the
 * answer would be "never".
 */
export function addBusinessMs(
  from: Millis,
  businessMs: Millis,
  calendar: WorkingCalendar,
): Millis | null {
  if (businessMs <= 0) return from;
  if (nominalMinutesPerWeek(calendar) === 0) return null;
  const tz = calendar.timeZone;
  let remaining = businessMs;
  let cursor = toZonedParts(from, tz);
  let guardDays = 0;
  const MAX_DAYS = 4000;

  for (;;) {
    const windows = workingIntervalsForLocalDay(calendar, cursor.year, cursor.month, cursor.day);
    for (const w of windows) {
      const start = Math.max(w.start, from);
      if (w.end <= start) continue;
      const available = w.end - start;
      if (available >= remaining) return start + remaining;
      remaining -= available;
    }
    const next = addDays(cursor.year, cursor.month, cursor.day, 1);
    cursor = { ...cursor, ...next };
    guardDays += 1;
    if (guardDays > MAX_DAYS) {
      throw new EngineError(
        `Could not reach ${businessMs}ms of working time within ${MAX_DAYS} days`,
        'CALENDAR_RANGE_TOO_LARGE',
      );
    }
  }
}

/** `YYYY-MM-DD` of the local day containing `instant`, per the calendar's zone. */
export function calendarDateKey(instant: Millis, calendar: WorkingCalendar): string {
  return localDateKey(instant, calendar.timeZone);
}
