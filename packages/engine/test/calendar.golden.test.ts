import { describe, expect, it } from 'vitest';
import golden from './golden/business-hours.golden.json' with { type: 'json' };
import {
  addBusinessMs,
  alwaysOnCalendar,
  businessMsIn,
  isWorkingTime,
  nominalMinutesPerWeek,
  normaliseCalendar,
  standardBusinessCalendar,
  type WorkingCalendar,
} from '../src/time/calendar.js';
import { EngineError } from '../src/types.js';

/**
 * Golden-file tests for the business-hours maths.
 *
 * Expected values in `golden/business-hours.golden.json` were computed by hand
 * and each carries its arithmetic in a `why` field. Nothing here is generated
 * from the implementation, which is the only way a golden file is worth
 * anything: a regenerated golden file only asserts that the code still does
 * what it currently does.
 */

type GoldenCalendars = Record<string, unknown>;

function calendarNamed(name: string): WorkingCalendar {
  const calendars = golden.calendars as unknown as GoldenCalendars;
  const raw = calendars[name];
  if (raw === undefined) throw new Error(`golden file has no calendar "${name}"`);
  return normaliseCalendar(raw as WorkingCalendar);
}

describe('business-hours golden file', () => {
  for (const testCase of golden.businessMsCases) {
    it(`businessMsIn: ${testCase.name}`, () => {
      const calendar = calendarNamed(testCase.calendar);
      const actual = businessMsIn(
        { start: Date.parse(testCase.from), end: Date.parse(testCase.to) },
        calendar,
      );
      expect(actual, testCase.why).toBe(testCase.expectedMs);
    });
  }

  for (const testCase of golden.addBusinessMsCases) {
    it(`addBusinessMs: ${testCase.name}`, () => {
      const calendar = calendarNamed(testCase.calendar);
      const actual = addBusinessMs(Date.parse(testCase.from), testCase.addMs, calendar);
      expect(actual, testCase.why).not.toBeNull();
      expect(new Date(actual!).toISOString(), testCase.why).toBe(testCase.expected);
    });
  }
});

describe('businessMsIn and addBusinessMs are inverses', () => {
  // Property check: walking forward by N working milliseconds and then
  // measuring the span must give back N, for any start instant.
  const calendar = standardBusinessCalendar('Europe/Berlin');
  const starts = [
    '2026-01-05T08:30:00.000Z',
    '2026-03-27T15:00:00.000Z',
    '2026-03-29T01:30:00.000Z',
    '2026-06-15T12:00:00.000Z',
    '2026-10-25T00:30:00.000Z',
    '2026-12-24T22:00:00.000Z',
  ];
  const amounts = [0, 60_000, 3_600_000, 28_800_000, 144_000_000];

  for (const start of starts) {
    for (const amount of amounts) {
      it(`${start} + ${amount}ms round-trips`, () => {
        const from = Date.parse(start);
        const to = addBusinessMs(from, amount, calendar);
        expect(to).not.toBeNull();
        expect(businessMsIn({ start: from, end: to! }, calendar)).toBe(amount);
      });
    }
  }
});

describe('calendar construction', () => {
  it('rejects an unknown timezone rather than silently using UTC', () => {
    expect(() => normaliseCalendar(standardBusinessCalendar('Mars/Olympus_Mons'))).toThrow(
      EngineError,
    );
  });

  it('merges overlapping windows so time is never double-counted', () => {
    const calendar = normaliseCalendar({
      id: 'overlap',
      name: 'overlapping windows',
      timeZone: 'UTC',
      week: {
        1: [
          { fromMinute: 540, toMinute: 720 },
          { fromMinute: 600, toMinute: 1020 },
        ],
      },
      holidays: [],
    });
    expect(calendar.week[1]).toEqual([{ fromMinute: 540, toMinute: 1020 }]);
    // Monday 09:00-17:00 is 8h, not 3h + 7h.
    expect(
      businessMsIn(
        { start: Date.parse('2026-03-02T00:00:00Z'), end: Date.parse('2026-03-03T00:00:00Z') },
        calendar,
      ),
    ).toBe(8 * 3_600_000);
  });

  it('drops inverted and zero-length windows', () => {
    const calendar = normaliseCalendar({
      id: 'bad',
      name: 'bad windows',
      timeZone: 'UTC',
      week: {
        1: [
          { fromMinute: 720, toMinute: 540 },
          { fromMinute: 600, toMinute: 600 },
          { fromMinute: 540, toMinute: 600 },
        ],
      },
      holidays: [],
    });
    expect(calendar.week[1]).toEqual([{ fromMinute: 540, toMinute: 600 }]);
  });

  it('rejects a weekday outside 0-6', () => {
    expect(() =>
      normaliseCalendar({
        id: 'bad-weekday',
        name: 'bad weekday',
        timeZone: 'UTC',
        week: { 9: [{ fromMinute: 0, toMinute: 60 }] } as WorkingCalendar['week'],
        holidays: [],
      }),
    ).toThrow(EngineError);
  });

  it('normalises holiday keys and deduplicates them', () => {
    const calendar = normaliseCalendar({
      ...standardBusinessCalendar('UTC'),
      holidays: ['2026-04-03', '2026-04-03', '2026-01-01'],
    });
    expect(calendar.holidays).toEqual(['2026-01-01', '2026-04-03']);
  });

  it('a 24/7 calendar makes business time equal elapsed time', () => {
    const calendar = normaliseCalendar(alwaysOnCalendar('UTC'));
    const start = Date.parse('2026-05-01T00:00:00Z');
    const end = Date.parse('2026-05-08T00:00:00Z');
    expect(businessMsIn({ start, end }, calendar)).toBe(end - start);
    expect(nominalMinutesPerWeek(calendar)).toBe(7 * 1440);
  });

  it('reports whether an instant is working time', () => {
    const calendar = normaliseCalendar(standardBusinessCalendar('UTC'));
    expect(isWorkingTime(Date.parse('2026-03-02T10:00:00Z'), calendar)).toBe(true);
    expect(isWorkingTime(Date.parse('2026-03-02T17:00:00Z'), calendar)).toBe(false);
    expect(isWorkingTime(Date.parse('2026-03-07T10:00:00Z'), calendar)).toBe(false);
  });

  it('returns null from addBusinessMs when the calendar never works', () => {
    const empty: WorkingCalendar = {
      id: 'never',
      name: 'no working time',
      timeZone: 'UTC',
      week: {},
      holidays: [],
    };
    expect(addBusinessMs(Date.parse('2026-03-02T10:00:00Z'), 1000, empty)).toBeNull();
  });

  it('refuses to walk an absurdly long interval instead of hanging', () => {
    const calendar = normaliseCalendar(standardBusinessCalendar('UTC'));
    expect(() =>
      businessMsIn(
        { start: Date.parse('1990-01-01T00:00:00Z'), end: Date.parse('2026-01-01T00:00:00Z') },
        calendar,
      ),
    ).toThrow(EngineError);
  });
});
