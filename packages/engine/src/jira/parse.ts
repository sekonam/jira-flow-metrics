import { EngineError, type Millis, type StatusCategory } from '../types.js';

/**
 * Parsing helpers for Jira's string encodings.
 *
 * Jira emits timestamps as `2026-03-01T09:15:00.000+0100` — ISO-8601 with a
 * *colonless* offset. `Date.parse` handles that in Node, but not on every
 * runtime, and it silently returns `NaN` on malformed input. Everything below
 * fails loudly or returns `null`; nothing returns `NaN`.
 */

const JIRA_TS_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?$/;

/** Parse a Jira timestamp to epoch milliseconds, or `null` if unparseable. */
export function parseJiraTimestamp(value: string | null | undefined): Millis | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const m = JIRA_TS_RE.exec(trimmed);
  if (m === null) {
    const fallback = Date.parse(trimmed);
    return Number.isNaN(fallback) ? null : fallback;
  }
  const [, y, mo, d, h, mi, s, frac, offset] = m;
  const millis = frac === undefined ? 0 : Number(frac.padEnd(3, '0').slice(0, 3));
  const base = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const offsetMs = parseOffset(offset);
  if (offsetMs === null) return null;
  return base + millis - offsetMs;
}

function parseOffset(offset: string | undefined): number | null {
  if (offset === undefined || offset === 'Z') return 0;
  const sign = offset.startsWith('-') ? -1 : 1;
  const digits = offset.slice(1).replace(':', '');
  if (digits.length !== 4) return null;
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return sign * (hours * 3_600_000 + minutes * 60_000);
}

/** Parse a Jira timestamp, throwing when it is required and absent. */
export function requireJiraTimestamp(value: string | null | undefined, what: string): Millis {
  const parsed = parseJiraTimestamp(value);
  if (parsed === null) {
    throw new EngineError(
      `Missing or unparseable timestamp for ${what}: ${String(value)}`,
      'BAD_TIMESTAMP',
    );
  }
  return parsed;
}

/** Map Jira's `statusCategory.key` onto the engine's category enum. */
export function toStatusCategory(key: string | null | undefined): StatusCategory {
  switch (key) {
    case 'new':
    case 'To Do':
    case 'todo':
      return 'todo';
    case 'indeterminate':
    case 'inprogress':
    case 'In Progress':
      return 'inprogress';
    case 'done':
    case 'Done':
      return 'done';
    default:
      return 'unknown';
  }
}

/**
 * Jira orders changelog pages by id, and ids are monotonic per issue, but the
 * `created` timestamps of two entries can be identical (a single transition
 * screen writes several items at once) and can even go backwards by a few
 * milliseconds across cluster nodes. Sorting by `(created, numeric id)` gives a
 * stable, correct order in every case we have seen.
 */
export function compareChangelogOrder(
  a: { at: Millis; id: string },
  b: { at: Millis; id: string },
): number {
  if (a.at !== b.at) return a.at - b.at;
  const an = Number(a.id);
  const bn = Number(b.id);
  if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
  return a.id.localeCompare(b.id);
}
