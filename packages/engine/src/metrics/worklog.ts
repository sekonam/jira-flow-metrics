import { parseJiraTimestamp } from '../jira/parse.js';
import type { JiraWorklogEntry } from '../jira/types.js';
import { calendarDateKey, type WorkingCalendar } from '../time/calendar.js';
import { localDateKey } from '../time/zone.js';
import type { Millis } from '../types.js';

/**
 * Worklog aggregation — the engine behind listing 2.
 *
 * Reuses nothing from the status pipeline except the ingestion machinery and
 * the calendar, which is exactly the point of the portfolio: the same
 * incremental-ingest + Forge SQL aggregate substrate serves a second listing
 * with a different question.
 *
 * A worklog is a *stated* duration (`timeSpentSeconds`) attached to a *stated*
 * instant (`started`). We never re-derive it from timestamps — the user typed
 * "3h" and that is the number they expect to see totalled.
 */

export interface WorklogRecord {
  readonly worklogId: string;
  readonly issueId: string;
  readonly issueKey: string;
  readonly projectId: string;
  readonly authorAccountId: string;
  readonly authorDisplayName: string;
  /** Instant the work is logged *against*, not when it was entered. */
  readonly startedAt: Millis;
  readonly timeSpentMs: Millis;
  readonly createdAt: Millis | null;
  readonly updatedAt: Millis | null;
}

export interface WorklogContext {
  readonly issueId: string;
  readonly issueKey: string;
  readonly projectId: string;
}

/**
 * Normalise a raw Jira worklog. Returns `null` when the entry cannot be
 * attributed — an unattributable worklog silently skews every total, so it is
 * dropped and counted rather than guessed at.
 */
export function toWorklogRecord(
  entry: JiraWorklogEntry,
  context: WorklogContext,
): WorklogRecord | null {
  const worklogId = entry.id;
  const startedAt = parseJiraTimestamp(entry.started) ?? parseJiraTimestamp(entry.created);
  const seconds = entry.timeSpentSeconds;
  if (worklogId === undefined || startedAt === null) return null;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  return {
    worklogId,
    issueId: entry.issueId ?? context.issueId,
    issueKey: context.issueKey,
    projectId: context.projectId,
    authorAccountId: entry.author?.accountId ?? '',
    authorDisplayName: entry.author?.displayName ?? 'Unknown user',
    startedAt,
    timeSpentMs: Math.round(seconds * 1000),
    createdAt: parseJiraTimestamp(entry.created),
    updatedAt: parseJiraTimestamp(entry.updated),
  };
}

export type WorklogGroupBy = 'author' | 'issue' | 'project' | 'day' | 'week' | 'month';

export interface WorklogGroup {
  readonly key: string;
  readonly label: string;
  readonly timeSpentMs: Millis;
  readonly entries: number;
  /** Distinct issues touched — meaningful when grouping by author or day. */
  readonly issueCount: number;
}

export interface WorklogAggregateOptions {
  readonly groupBy: WorklogGroupBy;
  /** Timezone used for day/week/month bucketing. Defaults to the calendar's. */
  readonly calendar?: WorkingCalendar;
  readonly timeZone?: string;
  /** Only worklogs whose `startedAt` falls inside this window are counted. */
  readonly from?: Millis;
  readonly to?: Millis;
}

export interface WorklogAggregateResult {
  readonly groups: readonly WorklogGroup[];
  readonly totalMs: Millis;
  readonly entries: number;
  readonly windowFrom: Millis | null;
  readonly windowTo: Millis | null;
}

export function aggregateWorklogs(
  records: readonly WorklogRecord[],
  options: WorklogAggregateOptions,
): WorklogAggregateResult {
  const tz = options.timeZone ?? options.calendar?.timeZone ?? 'UTC';
  const from = options.from ?? null;
  const to = options.to ?? null;

  const buckets = new Map<
    string,
    { label: string; ms: number; entries: number; issues: Set<string> }
  >();
  let totalMs = 0;
  let entries = 0;

  for (const record of records) {
    if (from !== null && record.startedAt < from) continue;
    if (to !== null && record.startedAt >= to) continue;
    const { key, label } = bucketOf(record, options.groupBy, tz, options.calendar);
    const bucket = buckets.get(key) ?? { label, ms: 0, entries: 0, issues: new Set<string>() };
    bucket.ms += record.timeSpentMs;
    bucket.entries += 1;
    bucket.issues.add(record.issueId);
    buckets.set(key, bucket);
    totalMs += record.timeSpentMs;
    entries += 1;
  }

  const groups: WorklogGroup[] = [...buckets.entries()]
    .map(([key, b]) => ({
      key,
      label: b.label,
      timeSpentMs: b.ms,
      entries: b.entries,
      issueCount: b.issues.size,
    }))
    .sort(sortForGroupBy(options.groupBy));

  return { groups, totalMs, entries, windowFrom: from, windowTo: to };
}

function sortForGroupBy(groupBy: WorklogGroupBy): (a: WorklogGroup, b: WorklogGroup) => number {
  // Time buckets read chronologically; everything else reads largest-first.
  if (groupBy === 'day' || groupBy === 'week' || groupBy === 'month') {
    return (a, b) => a.key.localeCompare(b.key);
  }
  return (a, b) => b.timeSpentMs - a.timeSpentMs || a.label.localeCompare(b.label);
}

function bucketOf(
  record: WorklogRecord,
  groupBy: WorklogGroupBy,
  timeZone: string,
  calendar: WorkingCalendar | undefined,
): { key: string; label: string } {
  switch (groupBy) {
    case 'author':
      return { key: record.authorAccountId, label: record.authorDisplayName };
    case 'issue':
      return { key: record.issueId, label: record.issueKey };
    case 'project':
      return { key: record.projectId, label: record.projectId };
    case 'day': {
      const key =
        calendar === undefined
          ? localDateKey(record.startedAt, timeZone)
          : calendarDateKey(record.startedAt, calendar);
      return { key, label: key };
    }
    case 'week': {
      const key = isoWeekKey(record.startedAt, timeZone);
      return { key, label: key };
    }
    case 'month': {
      const day =
        calendar === undefined
          ? localDateKey(record.startedAt, timeZone)
          : calendarDateKey(record.startedAt, calendar);
      const key = day.slice(0, 7);
      return { key, label: key };
    }
    default: {
      const exhaustive: never = groupBy;
      return { key: String(exhaustive), label: String(exhaustive) };
    }
  }
}

/** ISO-8601 week key, e.g. `2026-W10`. Weeks start on Monday. */
export function isoWeekKey(instant: Millis, timeZone: string): string {
  const dateKey = localDateKey(instant, timeZone);
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d));
  // Shift to the Thursday of the same ISO week, whose year defines the week year.
  const dayOfWeek = (utc.getUTCDay() + 6) % 7; // Mon = 0
  utc.setUTCDate(utc.getUTCDate() - dayOfWeek + 3);
  const isoYear = utc.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayOfWeek = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayOfWeek + 3);
  const week = 1 + Math.round((utc.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${String(isoYear).padStart(4, '0')}-W${String(week).padStart(2, '0')}`;
}

/** Format milliseconds the way Jira formats time-tracking values: `2w 3d 4h 5m`. */
export function formatJiraDuration(
  ms: Millis,
  options: { hoursPerDay?: number; daysPerWeek?: number } = {},
): string {
  const hoursPerDay = options.hoursPerDay ?? 8;
  const daysPerWeek = options.daysPerWeek ?? 5;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = hoursPerDay * hour;
  const week = daysPerWeek * day;

  let remaining = Math.max(0, Math.round(ms / minute) * minute);
  const weeks = Math.floor(remaining / week);
  remaining -= weeks * week;
  const days = Math.floor(remaining / day);
  remaining -= days * day;
  const hours = Math.floor(remaining / hour);
  remaining -= hours * hour;
  const minutes = Math.floor(remaining / minute);

  const parts: string[] = [];
  if (weeks > 0) parts.push(`${weeks}w`);
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  return parts.length === 0 ? '0m' : parts.join(' ');
}
