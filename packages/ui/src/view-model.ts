import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  formatJiraDuration,
  type BackfillProgress,
  type DistributionSummary,
  type Millis,
  type StatusReport,
  type StatusReportRow,
} from '@jfm/engine';

/**
 * View models for the report surfaces.
 *
 * All presentation *logic* lives here as pure functions so it can be tested,
 * leaving the Forge UI Kit components in `components.tsx` as declarative
 * markup. That split matters because Forge UI components cannot be rendered in
 * a plain Node test process, and untested formatting is how a metrics product
 * ends up displaying "0m" for a missing value.
 */

/** The four states any data surface can be in. Designed explicitly, per the
 * engineering standards, rather than left to whatever the data happens to do. */
export type SurfaceState = 'loading' | 'error' | 'empty' | 'ready';

export function surfaceStateOf(input: {
  loading: boolean;
  error: string | null;
  rowCount: number;
}): SurfaceState {
  if (input.loading) return 'loading';
  if (input.error !== null) return 'error';
  if (input.rowCount === 0) return 'empty';
  return 'ready';
}

/**
 * Human duration for a table cell.
 *
 * Distinguishes "no time recorded" from "the issue was never in this status":
 * the first is `0m`, the second is an em dash. Conflating them is the sort of
 * quiet wrongness that makes a report untrustworthy.
 */
export function formatCell(ms: Millis | undefined): string {
  if (ms === undefined) return '—';
  return formatDurationForHumans(ms);
}

/**
 * Duration, at the precision a human can act on.
 *
 * Under a minute reads as `<1m`, because "0m" for a real 12-second interval is
 * misleading in the other direction.
 */
export function formatDurationForHumans(ms: Millis): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return '0m';
  if (ms < MINUTE_MS) return '<1m';
  if (ms < HOUR_MS) return `${Math.round(ms / MINUTE_MS)}m`;
  if (ms < DAY_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    const minutes = Math.round((ms % HOUR_MS) / MINUTE_MS);
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }
  return formatJiraDuration(ms, { hoursPerDay: 24, daysPerWeek: 7 });
}

/** `12 Mar 2026` — short, unambiguous and locale-independent. */
export function formatDate(ms: Millis | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()] ?? '?'} ${d.getUTCFullYear()}`;
}

export interface ReportTableCell {
  readonly text: string;
  /** How many separate visits produced this figure. `null` where not applicable. */
  readonly entries: number | null;
  /** True when the issue re-entered this status — the thing Jira cannot show. */
  readonly reentered: boolean;
}

export interface ReportTableRow {
  readonly issueKey: string;
  readonly currentStatus: string;
  readonly created: string;
  readonly resolved: string;
  readonly cells: readonly ReportTableCell[];
  readonly total: string;
  readonly truncated: boolean;
}

export interface ReportTableModel {
  readonly headers: readonly string[];
  readonly rows: readonly ReportTableRow[];
  readonly basisLabel: string;
  readonly footnotes: readonly string[];
}

export function toReportTable(report: StatusReport): ReportTableModel {
  const nameOf = new Map(report.columns.map((c) => [c.statusId, c.name]));
  const rows = report.rows.map((row) => toReportTableRow(row, report, nameOf));
  const footnotes: string[] = [];
  if (report.rows.some((r) => r.truncated)) {
    footnotes.push(
      'Rows marked "partial history" have more changelog entries than were indexed, ' +
        'so their totals are a lower bound.',
    );
  }
  const reentered = rows.some((r) => r.cells.some((c) => c.reentered));
  if (reentered) {
    footnotes.push(
      'A "x2" badge means the issue entered that status more than once. These durations are ' +
        "cumulative across every visit; Jira's own control chart shows only the most recent one.",
    );
  }
  return {
    headers: [
      'Issue',
      'Status',
      'Created',
      'Resolved',
      ...report.columns.map((c) => c.name),
      'Total',
    ],
    rows,
    basisLabel: report.basis === 'business' ? 'Working hours' : 'Elapsed time',
    footnotes,
  };
}

function toReportTableRow(
  row: StatusReportRow,
  report: StatusReport,
  nameOf: ReadonlyMap<string, string>,
): ReportTableRow {
  return {
    issueKey: row.issueKey,
    currentStatus:
      row.currentStatusId === null ? '—' : (nameOf.get(row.currentStatusId) ?? row.currentStatusId),
    created: formatDate(row.createdAt),
    resolved: formatDate(row.resolvedAt),
    cells: report.columns.map((column) => {
      const entries = row.entriesByStatus[column.statusId] ?? null;
      return {
        text: formatCell(row.byStatus[column.statusId]),
        entries,
        reentered: entries !== null && entries > 1,
      };
    }),
    total: formatDurationForHumans(row.totalMs),
    truncated: row.truncated,
  };
}

export interface SummaryTile {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
}

/** The tiles above the table. Median and 85th percentile, never the mean alone —
 * cycle-time distributions are right-skewed and a mean misleads. */
export function toSummaryTiles(report: StatusReport): SummaryTile[] {
  const tiles: SummaryTile[] = [
    {
      label: 'Issues',
      value: String(report.issueCount),
      hint: 'Issues matching the current filters.',
    },
  ];
  for (const column of report.columns) {
    const summary: DistributionSummary | undefined = report.summaryByStatus[column.statusId];
    if (summary === undefined || summary.count === 0) continue;
    tiles.push({
      label: `${column.name} · median`,
      value: summary.medianMs === null ? '—' : formatDurationForHumans(summary.medianMs),
      hint:
        summary.p85Ms === null
          ? `Across ${summary.count} issues.`
          : `85th percentile ${formatDurationForHumans(summary.p85Ms)}, across ${summary.count} issues.`,
    });
  }
  return tiles;
}

export interface ProgressBanner {
  readonly appearance: 'information' | 'warning' | 'error' | 'success';
  readonly title: string;
  readonly body: string;
  readonly showSpinner: boolean;
}

/**
 * The indexing banner.
 *
 * It is never hidden while indexing is incomplete. A user looking at numbers
 * built from half their history must be told, and the honest message is worth
 * more than the tidier screen.
 */
export function toProgressBanner(progress: BackfillProgress | null): ProgressBanner | null {
  if (progress === null) {
    return {
      appearance: 'information',
      title: 'Not indexed yet',
      body: 'Start indexing to build the report for this project.',
      showSpinner: false,
    };
  }
  switch (progress.state) {
    case 'complete':
      return null;
    case 'running':
    case 'not_started':
      return {
        appearance: 'information',
        title: 'Indexing in progress',
        body: `${describeProgress(progress)} Numbers below cover only the issues indexed so far.`,
        showSpinner: true,
      };
    case 'paused':
      return {
        appearance: 'warning',
        title: 'Indexing paused — Jira rate limit',
        body:
          `${describeProgress(progress)} Indexing will resume automatically; ` +
          'this happens on large instances and needs no action.',
        showSpinner: false,
      };
    case 'failed':
      return {
        appearance: 'error',
        title: 'Indexing failed',
        body: `${describeProgress(progress)} ${progress.lastError ?? 'No error detail was recorded.'}`,
        showSpinner: false,
      };
    default: {
      const exhaustive: never = progress.state;
      return exhaustive;
    }
  }
}

function describeProgress(progress: BackfillProgress): string {
  if (progress.fraction === null) {
    return `${progress.issuesProcessed.toLocaleString('en-GB')} issues indexed.`;
  }
  const percent = Math.round(progress.fraction * 100);
  const total = progress.issuesTotal ?? 0;
  return `${progress.issuesProcessed.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')} issues indexed (${percent}%).`;
}

/** Bytes as a human figure, always labelled as an estimate by the caller. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit] ?? 'B'}`;
}
