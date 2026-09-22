import { capNoteRow, formatDuration, tableToCsv, type Millis } from '@jfm/engine';
import type { AgingReport, HistoryReport, SlaReport, WorklogReport } from './reports.js';

/**
 * CSV renderings for the listing 2-5 reports.
 *
 * These exist because every app's export button used to invoke
 * `statusReportCsv` — the *time-in-status* table — regardless of which report
 * the page was showing. `tableToCsv` had been written for exactly this and was
 * invoked by nothing outside tests. The export must be the report on screen.
 *
 * Durations are hours to two decimal places, matching `statusReportCsv`'s
 * export format: a CSV lands in a spreadsheet, where "2d 4h" is a string and
 * 52.5 is a number someone can sum.
 */

const HOURS = { durationFormat: 'hours' } as const;

function toIso(ms: Millis | null): string {
  return ms === null ? '' : new Date(ms).toISOString();
}

export function worklogReportToCsv(report: WorklogReport, groupLabel: string): string {
  return tableToCsv(
    [groupLabel, 'Hours logged', 'Entries', 'Issues'],
    [
      ...report.groups.map((group) => [
        group.label,
        formatDuration(group.timeSpentMs, HOURS),
        group.entries,
        group.issueCount,
      ]),
      ...capNoteRow({
        capped: report.capped,
        included: report.entries,
        total: report.totalEntries,
        noun: 'worklog entries',
      }),
    ],
  );
}

export function agingReportToCsv(report: AgingReport): string {
  return tableToCsv(
    [
      'Issue key',
      'Status',
      'Age in status (hours)',
      'Age in status, working, completed portion (hours)',
      'Age total (hours)',
      'Entered status (UTC)',
    ],
    [
      ...report.rows.map((row) => [
        row.issueKey,
        row.statusName,
        formatDuration(row.ageInStatusMs, HOURS),
        formatDuration(row.ageInStatusBusinessMs, HOURS),
        formatDuration(row.ageTotalMs, HOURS),
        toIso(row.enteredStatusAt),
      ]),
      ...capNoteRow({
        capped: report.capped,
        aggregatesCapped: report.aggregatesCapped,
        included: report.rows.length + report.excludedDone,
        total: report.projectIssueCount,
        noun: 'issues',
      }),
    ],
  );
}

export function slaReportToCsv(report: SlaReport): string {
  return tableToCsv(
    [
      'Issue key',
      'Working hours used',
      'Target (hours)',
      'Remaining (hours)',
      'Breached',
      'Due date (UTC)',
      'Due date breached',
    ],
    [
      ...report.rows.map((row) => [
        row.issueKey,
        formatDuration(row.consumedMs, HOURS),
        formatDuration(row.targetMs, HOURS),
        formatDuration(row.remainingMs, HOURS),
        row.breached ? 'yes' : 'no',
        toIso(row.dueDate.dueAt),
        row.dueDate.breached ? 'yes' : 'no',
      ]),
      ...capNoteRow({
        capped: report.capped,
        aggregatesCapped: report.aggregatesCapped,
        included: report.rows.length,
        total: report.projectIssueCount,
        noun: 'issues',
      }),
    ],
  );
}

export function historyReportToCsv(report: HistoryReport): string {
  return tableToCsv(
    ['Changed at (UTC)', 'Issue key', 'Field', 'From', 'To', 'Author'],
    [
      ...report.records.map((record) => [
        toIso(record.at),
        record.issueKey,
        record.fieldLabel,
        record.fromValue,
        record.toValue,
        record.authorDisplayName,
      ]),
      ...capNoteRow({
        capped: report.capped,
        included: report.total,
        total: report.totalMatching,
        noun: 'changes',
      }),
    ],
  );
}
