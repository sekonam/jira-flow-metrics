import { formatJiraDuration } from '../metrics/worklog.js';
import type { StatusReport } from '../report/status-report.js';
import type { Millis } from '../types.js';

/**
 * CSV export.
 *
 * The dossier's observation that "finance and QBR users want the export more
 * than the chart" is the reason this exists in v1 rather than v2. It is also
 * the cheapest possible feature, which is exactly the trade this product wants.
 *
 * ## CSV injection
 *
 * Issue summaries and status names are user-controlled text that lands in a
 * file people open in Excel. A cell beginning `=`, `+`, `-`, `@`, TAB or CR is
 * interpreted as a formula by Excel and LibreOffice. Every such cell is
 * prefixed with a single quote. This is not paranoia — it is the standard
 * finding of any Marketplace security review that looks at an export feature.
 */

const RISKY_PREFIX = /^[=+\-@\t\r]/;

/** Escape one CSV field, defusing spreadsheet formula injection. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  const defused = RISKY_PREFIX.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(defused) ? `"${defused.replace(/"/g, '""')}"` : defused;
}

/** Join rows into a CSV document with CRLF line endings (RFC 4180). */
export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export interface CsvOptions {
  /** `duration` writes `2d 4h`; `hours` writes `18.5`; `ms` writes the raw number. */
  readonly durationFormat?: 'duration' | 'hours' | 'ms';
  readonly hoursPerDay?: number;
  readonly daysPerWeek?: number;
  /** Include the per-status visit-count columns. */
  readonly includeEntryCounts?: boolean;
}

export function formatDuration(ms: Millis, options: CsvOptions = {}): string | number {
  switch (options.durationFormat ?? 'duration') {
    case 'ms':
      return ms;
    case 'hours':
      return Math.round((ms / 3_600_000) * 100) / 100;
    case 'duration':
    default:
      return formatJiraDuration(ms, {
        ...(options.hoursPerDay === undefined ? {} : { hoursPerDay: options.hoursPerDay }),
        ...(options.daysPerWeek === undefined ? {} : { daysPerWeek: options.daysPerWeek }),
      });
  }
}

/** Render a status report as CSV. */
export function statusReportToCsv(report: StatusReport, options: CsvOptions = {}): string {
  const includeEntries = options.includeEntryCounts ?? true;
  const header: (string | number)[] = ['Issue key', 'Current status', 'Created', 'Resolved'];
  for (const column of report.columns) header.push(column.name);
  if (includeEntries) {
    for (const column of report.columns) header.push(`${column.name} (times entered)`);
  }
  header.push('Total', 'History complete');

  const rows: (string | number | null)[][] = [header];
  const nameOf = new Map(report.columns.map((c) => [c.statusId, c.name]));

  for (const row of report.rows) {
    const line: (string | number | null)[] = [
      row.issueKey,
      row.currentStatusId === null ? '' : (nameOf.get(row.currentStatusId) ?? row.currentStatusId),
      toIsoDate(row.createdAt),
      row.resolvedAt === null ? '' : toIsoDate(row.resolvedAt),
    ];
    for (const column of report.columns) {
      line.push(formatDuration(row.byStatus[column.statusId] ?? 0, options));
    }
    if (includeEntries) {
      for (const column of report.columns) line.push(row.entriesByStatus[column.statusId] ?? 0);
    }
    line.push(formatDuration(row.totalMs, options));
    line.push(row.truncated ? 'partial' : 'complete');
    rows.push(line);
  }
  return toCsv(rows);
}

function toIsoDate(ms: Millis): string {
  return new Date(ms).toISOString();
}

/** Generic table export used by the worklog, SLA and history listings. */
export function tableToCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  return toCsv([headers, ...rows]);
}
