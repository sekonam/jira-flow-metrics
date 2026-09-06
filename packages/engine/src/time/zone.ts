import { EngineError, type Millis } from '../types.js';

/**
 * IANA-timezone arithmetic built on `Intl.DateTimeFormat`.
 *
 * We deliberately take no date-library dependency. Node 22 ships full ICU, so
 * `Intl` already knows every zone and every DST rule, including historical
 * ones — and a Forge bundle is smaller without a tzdata copy.
 */

/** Wall-clock fields in some timezone. Month is 1-based, like a human writes it. */
export interface ZonedParts {
  readonly year: number;
  /** 1-12. */
  readonly month: number;
  /** 1-31. */
  readonly day: number;
  /** 0-23. */
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** 0 = Sunday … 6 = Saturday, matching `Date.prototype.getUTCDay`. */
  readonly weekday: number;
}

const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = FORMATTER_CACHE.get(timeZone);
  if (cached !== undefined) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      era: 'short',
    });
  } catch {
    throw new EngineError(`Unknown IANA timezone: ${timeZone}`, 'UNKNOWN_TIMEZONE');
  }
  FORMATTER_CACHE.set(timeZone, formatter);
  return formatter;
}

/** True when the string names a timezone this runtime knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Decompose an instant into wall-clock fields in `timeZone`. */
export function toZonedParts(instant: Millis, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  let year = 0;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let weekday = 0;
  let bce = false;
  for (const part of parts) {
    switch (part.type) {
      case 'year':
        year = Number(part.value);
        break;
      case 'month':
        month = Number(part.value);
        break;
      case 'day':
        day = Number(part.value);
        break;
      case 'hour':
        // Some ICU builds emit "24" for midnight even under h23.
        hour = Number(part.value) % 24;
        break;
      case 'minute':
        minute = Number(part.value);
        break;
      case 'second':
        second = Number(part.value);
        break;
      case 'weekday':
        weekday = WEEKDAY_INDEX[part.value] ?? 0;
        break;
      case 'era':
        bce = part.value === 'BC' || part.value === 'B';
        break;
      default:
        break;
    }
  }
  return { year: bce ? 1 - year : year, month, day, hour, minute, second, weekday };
}

/**
 * Build a UTC instant from calendar fields, normalising overflow the way
 * `Date.UTC` does but *without* its two-digit-year remapping (`Date.UTC(99,…)`
 * means 1999). Overflow normalisation is load-bearing: the calendar passes
 * `hour = 24` to mean "start of the next local day".
 */
function utcFromFields(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Millis {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, second, 0);
  return d.getTime();
}

/** UTC offset of `timeZone` at `instant`, in milliseconds (east of UTC is positive). */
export function offsetMsAt(instant: Millis, timeZone: string): Millis {
  const p = toZonedParts(instant, timeZone);
  const asUtc = utcFromFields(p.year, p.month, p.day, p.hour, p.minute, p.second);
  const millisOfSecond = ((instant % 1000) + 1000) % 1000;
  return asUtc - (instant - millisOfSecond);
}

/**
 * Convert wall-clock fields in `timeZone` to an instant.
 *
 * Fields are normalised the way `Date.UTC` normalises them, so `day = 32` or
 * `hour = 24` roll over correctly — the calendar relies on `hour = 24` meaning
 * "start of the next local day".
 *
 * Two DST edge cases, both resolved deterministically and documented because
 * they are unavoidable rather than because they are pretty:
 *
 * - **Nonexistent local times** (the hour skipped when clocks spring forward)
 *   resolve to the instant the shifted offset produces — i.e. 02:30 on a
 *   spring-forward day reads as 03:30 local.
 * - **Ambiguous local times** (the hour repeated when clocks fall back)
 *   resolve to the *first* (pre-transition, earlier) occurrence.
 */
export function zonedToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Millis {
  const utcGuess = utcFromFields(year, month, day, hour, minute, second);
  const firstOffset = offsetMsAt(utcGuess, timeZone);
  const firstGuess = utcGuess - firstOffset;
  const secondOffset = offsetMsAt(firstGuess, timeZone);
  if (secondOffset === firstOffset) return firstGuess;
  const secondGuess = utcGuess - secondOffset;
  // Prefer the earlier instant that actually round-trips; this is what makes
  // fall-back ambiguity resolve to the first occurrence.
  const candidates = [firstGuess, secondGuess].sort((a, b) => a - b);
  for (const candidate of candidates) {
    if (offsetMsAt(candidate, timeZone) === utcGuess - candidate) return candidate;
  }
  return secondGuess;
}

/** Start of the local day containing `instant`, as an instant. */
export function startOfLocalDay(instant: Millis, timeZone: string): Millis {
  const p = toZonedParts(instant, timeZone);
  return zonedToInstant(p.year, p.month, p.day, 0, 0, 0, timeZone);
}

/** `YYYY-MM-DD` for the local day containing `instant`. */
export function localDateKey(instant: Millis, timeZone: string): string {
  const p = toZonedParts(instant, timeZone);
  return formatDateKey(p.year, p.month, p.day);
}

/** `YYYY-MM-DD` from calendar fields, zero-padded. */
export function formatDateKey(year: number, month: number, day: number): string {
  const yyyy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a `YYYY-MM-DD` key into 1-based calendar fields. */
export function parseDateKey(key: string): { year: number; month: number; day: number } {
  const m = DATE_KEY_RE.exec(key);
  if (m === null) {
    throw new EngineError(`Expected a YYYY-MM-DD date, got "${key}"`, 'BAD_DATE_KEY');
  }
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Advance calendar fields by whole days, normalising month/year rollover. */
export function addDays(
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  const d = new Date(utcFromFields(year, month, day + days, 0, 0, 0));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
