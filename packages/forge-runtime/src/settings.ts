import {
  alwaysOnCalendar,
  isValidTimeZone,
  normaliseCalendar,
  standardBusinessCalendar,
  type WorkingCalendar,
  type WorkingWindow,
} from '@jfm/engine';
import type { SqlExecutor } from './sql/executor.js';

/**
 * Per-project app settings.
 *
 * There is exactly one setting that matters in v1 — **the working calendar** —
 * because it is the only input that changes what the numbers mean. Everything
 * else the UI offers (basis, grouping, window) is a view option and lives in
 * the URL, not in storage.
 *
 * Settings are stored in Forge SQL rather than KVS so the app has one storage
 * dependency instead of two, and because they are read on every report render:
 * KVS reads are metered, SQL storage is priced on bytes held.
 */

export interface ProjectSettings {
  readonly calendar: WorkingCalendar;
  /**
   * Whether reports default to the working calendar or to elapsed time.
   * Elapsed is the default because it needs no configuration to be correct.
   */
  readonly defaultBasis: 'elapsed' | 'business';
  /** Months of history the initial backfill will cover; `null` means all. */
  readonly backfillMonths: number | null;
}

export const GLOBAL_SCOPE = '__global__';

export function defaultSettings(timeZone = 'UTC'): ProjectSettings {
  return {
    calendar: normaliseCalendar(standardBusinessCalendar(timeZone)),
    defaultBasis: 'elapsed',
    // Twelve months keeps the first backfill bounded on a large instance. The
    // UI offers "extend history" once the initial pass is complete, which is
    // the mitigation the dossier calls for on backfill risk.
    backfillMonths: 12,
  };
}

/**
 * Parse untrusted settings JSON into a valid `ProjectSettings`.
 *
 * Anything unrecognised falls back to the default rather than throwing: a
 * corrupt settings row must not make the report page unrenderable, and the
 * cost of a wrong calendar is visible to the user while the cost of a blank
 * page is a support ticket.
 */
export function parseSettings(raw: unknown, fallbackTimeZone = 'UTC'): ProjectSettings {
  const base = defaultSettings(fallbackTimeZone);
  if (typeof raw !== 'object' || raw === null) return base;
  const record = raw as Record<string, unknown>;

  const basis = record['defaultBasis'];
  const backfillMonths = record['backfillMonths'];

  return {
    calendar: parseCalendar(record['calendar'], base.calendar),
    defaultBasis: basis === 'business' ? 'business' : 'elapsed',
    backfillMonths:
      backfillMonths === null
        ? null
        : typeof backfillMonths === 'number' && Number.isFinite(backfillMonths)
          ? Math.max(1, Math.min(120, Math.trunc(backfillMonths)))
          : base.backfillMonths,
  };
}

function parseCalendar(raw: unknown, fallback: WorkingCalendar): WorkingCalendar {
  if (typeof raw !== 'object' || raw === null) return fallback;
  const record = raw as Record<string, unknown>;
  const timeZone = record['timeZone'];
  if (typeof timeZone !== 'string' || !isValidTimeZone(timeZone)) return fallback;

  const preset = record['preset'];
  if (preset === '24x7') return normaliseCalendar(alwaysOnCalendar(timeZone));

  const week: Partial<Record<number, WorkingWindow[]>> = {};
  const rawWeek = record['week'];
  if (typeof rawWeek === 'object' && rawWeek !== null) {
    for (const [key, value] of Object.entries(rawWeek as Record<string, unknown>)) {
      const day = Number(key);
      if (!Number.isInteger(day) || day < 0 || day > 6) continue;
      if (!Array.isArray(value)) continue;
      week[day] = value.flatMap((w) => {
        if (typeof w !== 'object' || w === null) return [];
        const from = (w as Record<string, unknown>)['fromMinute'];
        const to = (w as Record<string, unknown>)['toMinute'];
        if (typeof from !== 'number' || typeof to !== 'number') return [];
        return [{ fromMinute: from, toMinute: to }];
      });
    }
  }

  const holidays = Array.isArray(record['holidays'])
    ? record['holidays'].filter(
        (h): h is string => typeof h === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h),
      )
    : [];

  try {
    return normaliseCalendar({
      id: typeof record['id'] === 'string' ? record['id'] : 'custom',
      name: typeof record['name'] === 'string' ? record['name'] : 'Custom calendar',
      timeZone,
      week: Object.keys(week).length > 0 ? week : fallback.week,
      holidays,
    });
  } catch {
    return fallback;
  }
}

export class SettingsStore {
  private readonly cache = new Map<string, ProjectSettings>();

  constructor(
    private readonly sql: SqlExecutor,
    private readonly fallbackTimeZone = 'UTC',
  ) {}

  /**
   * Read settings for a project, falling back to the instance-wide row and then
   * to the built-in default. Cached per invocation: a report render asks for
   * settings several times and the row cannot change mid-invocation.
   */
  async get(projectId: string): Promise<ProjectSettings> {
    const cached = this.cache.get(projectId);
    if (cached !== undefined) return cached;
    // The precedence is decided here rather than in `ORDER BY scope_key = ?
    // DESC`, which is what this used to do. Forge SQL refuses a bound
    // parameter inside an ORDER BY expression — `ForgeSQLError: Unknown SQL
    // execution error`, with no indication of which statement — so the first
    // deployed build failed on every event before reading a single setting.
    // Two rows at most, and choosing between them in code costs nothing.
    const rows = await this.sql.query<{ scope_key?: string; settings?: unknown }>(
      'SELECT scope_key, settings FROM app_settings WHERE scope_key IN (?, ?)',
      [projectId, GLOBAL_SCOPE],
    );
    const preferred =
      rows.find((row) => row.scope_key === projectId) ??
      rows.find((row) => row.scope_key === GLOBAL_SCOPE);
    const parsed = parseSettings(safeJson(preferred?.settings), this.fallbackTimeZone);
    this.cache.set(projectId, parsed);
    return parsed;
  }

  async put(scopeKey: string, settings: ProjectSettings, now: number): Promise<void> {
    await this.sql.execute(
      `INSERT INTO app_settings (scope_key, settings, updated_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE settings = VALUES(settings), updated_at = VALUES(updated_at)`,
      [scopeKey, JSON.stringify(settings), now],
    );
    this.cache.delete(scopeKey);
  }

  clearCache(): void {
    this.cache.clear();
  }
}

function safeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
