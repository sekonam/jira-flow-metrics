import { describe, expect, it } from 'vitest';
import {
  clip,
  close,
  coveredMs,
  duration,
  intersect,
  isEmpty,
  sortIntervals,
  subtract,
  union,
} from '../src/time/interval.js';
import {
  addDays,
  formatDateKey,
  isValidTimeZone,
  localDateKey,
  offsetMsAt,
  parseDateKey,
  startOfLocalDay,
  toZonedParts,
  zonedToInstant,
} from '../src/time/zone.js';
import { EngineError } from '../src/types.js';

const HOUR = 3_600_000;

describe('interval algebra', () => {
  it('closes an open interval against the evaluation instant', () => {
    expect(close({ start: 100, end: null }, 500)).toEqual({ start: 100, end: 500 });
    expect(close({ start: 100, end: 300 }, 500)).toEqual({ start: 100, end: 300 });
  });

  it('clamps rather than throwing when the changelog has clock skew', () => {
    // Jira genuinely returns transitions timestamped before the previous one
    // when they were written by different cluster nodes.
    expect(close({ start: 500, end: 100 }, 900)).toEqual({ start: 500, end: 500 });
    expect(duration({ start: 500, end: 100 })).toBe(0);
  });

  it('treats touching intervals as non-overlapping', () => {
    expect(intersect({ start: 0, end: 5 }, { start: 5, end: 9 })).toBeNull();
    expect(clip({ start: 0, end: 9 }, { start: 4, end: 6 })).toEqual({ start: 4, end: 6 });
  });

  it('sorts by start then end', () => {
    expect(
      sortIntervals([
        { start: 5, end: 6 },
        { start: 1, end: 9 },
        { start: 1, end: 2 },
      ]),
    ).toEqual([
      { start: 1, end: 2 },
      { start: 1, end: 9 },
      { start: 5, end: 6 },
    ]);
  });

  it('merges overlapping and adjacent intervals', () => {
    expect(
      union([
        { start: 0, end: 5 },
        { start: 5, end: 9 },
        { start: 20, end: 25 },
        { start: 3, end: 4 },
      ]),
    ).toEqual([
      { start: 0, end: 9 },
      { start: 20, end: 25 },
    ]);
  });

  it('drops empty intervals from a union', () => {
    expect(union([{ start: 3, end: 3 }])).toEqual([]);
    expect(isEmpty({ start: 3, end: 3 })).toBe(true);
  });

  it('subtracts cutouts, including ones that overlap each other', () => {
    expect(
      subtract({ start: 0, end: 100 }, [
        { start: 10, end: 20 },
        { start: 15, end: 30 },
        { start: 90, end: 200 },
      ]),
    ).toEqual([
      { start: 0, end: 10 },
      { start: 30, end: 90 },
    ]);
  });

  it('returns the base untouched when no cutout overlaps', () => {
    expect(subtract({ start: 0, end: 10 }, [{ start: 50, end: 60 }])).toEqual([
      { start: 0, end: 10 },
    ]);
  });

  it('returns nothing when a cutout swallows the base', () => {
    expect(subtract({ start: 5, end: 10 }, [{ start: 0, end: 20 }])).toEqual([]);
    expect(subtract({ start: 5, end: 5 }, [])).toEqual([]);
  });

  it('counts overlapping coverage only once', () => {
    expect(
      coveredMs([
        { start: 0, end: 10 },
        { start: 5, end: 15 },
      ]),
    ).toBe(15);
  });
});

describe('timezone arithmetic', () => {
  it('knows valid and invalid zones', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });

  it('decomposes an instant into local wall-clock fields', () => {
    const parts = toZonedParts(Date.parse('2026-07-01T10:30:15Z'), 'Europe/Berlin');
    expect(parts).toEqual({
      year: 2026,
      month: 7,
      day: 1,
      hour: 12,
      minute: 30,
      second: 15,
      weekday: 3,
    });
  });

  it('reports the offset on both sides of a DST transition', () => {
    expect(offsetMsAt(Date.parse('2026-01-15T12:00:00Z'), 'Europe/Berlin')).toBe(HOUR);
    expect(offsetMsAt(Date.parse('2026-07-15T12:00:00Z'), 'Europe/Berlin')).toBe(2 * HOUR);
    expect(offsetMsAt(Date.parse('2026-07-15T12:00:00Z'), 'UTC')).toBe(0);
  });

  it('handles a zone with a half-hour offset', () => {
    expect(offsetMsAt(Date.parse('2026-07-15T12:00:00Z'), 'Asia/Kolkata')).toBe(5.5 * HOUR);
  });

  it('converts wall-clock fields back to an instant', () => {
    expect(new Date(zonedToInstant(2026, 7, 1, 12, 30, 15, 'Europe/Berlin')).toISOString()).toBe(
      '2026-07-01T10:30:15.000Z',
    );
    expect(new Date(zonedToInstant(2026, 1, 15, 12, 0, 0, 'Europe/Berlin')).toISOString()).toBe(
      '2026-01-15T11:00:00.000Z',
    );
  });

  it('normalises minute overflow, which the calendar relies on for midnight', () => {
    // 1440 minutes past local midnight is local midnight the next day.
    expect(zonedToInstant(2026, 3, 2, 0, 1440, 0, 'UTC')).toBe(
      zonedToInstant(2026, 3, 3, 0, 0, 0, 'UTC'),
    );
    // Month rollover.
    expect(new Date(zonedToInstant(2026, 1, 32, 0, 0, 0, 'UTC')).toISOString()).toBe(
      '2026-02-01T00:00:00.000Z',
    );
  });

  it('resolves an ambiguous fall-back local time to the first occurrence', () => {
    // 02:30 happens twice on 2026-10-25 in Berlin: at 00:30Z (CEST) and 01:30Z (CET).
    expect(new Date(zonedToInstant(2026, 10, 25, 2, 30, 0, 'Europe/Berlin')).toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });

  it('resolves a nonexistent spring-forward local time deterministically', () => {
    // 02:30 does not exist on 2026-03-29 in Berlin; the documented behaviour is
    // that it reads as 03:30 local.
    const instant = zonedToInstant(2026, 3, 29, 2, 30, 0, 'Europe/Berlin');
    expect(toZonedParts(instant, 'Europe/Berlin').hour).toBe(3);
    expect(toZonedParts(instant, 'Europe/Berlin').minute).toBe(30);
  });

  it('finds the start of the local day', () => {
    expect(
      new Date(startOfLocalDay(Date.parse('2026-07-01T10:30:00Z'), 'Europe/Berlin')).toISOString(),
    ).toBe('2026-06-30T22:00:00.000Z');
  });

  it('formats and parses date keys', () => {
    expect(localDateKey(Date.parse('2026-07-01T22:30:00Z'), 'Europe/Berlin')).toBe('2026-07-02');
    expect(localDateKey(Date.parse('2026-07-01T22:30:00Z'), 'UTC')).toBe('2026-07-01');
    expect(formatDateKey(2026, 3, 9)).toBe('2026-03-09');
    expect(parseDateKey('2026-03-09')).toEqual({ year: 2026, month: 3, day: 9 });
    expect(() => parseDateKey('9 March 2026')).toThrow(EngineError);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays(2026, 12, 30, 5)).toEqual({ year: 2027, month: 1, day: 4 });
    expect(addDays(2024, 2, 28, 1)).toEqual({ year: 2024, month: 2, day: 29 });
    expect(addDays(2026, 2, 28, 1)).toEqual({ year: 2026, month: 3, day: 1 });
  });
});
