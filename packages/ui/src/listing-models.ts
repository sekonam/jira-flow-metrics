import type { WorklogAggregateResult } from '@jfm/engine';
import type { AgingReport, HistoryReport, SlaReport } from '@jfm/forge-runtime';
import {
  WORKING_TIME,
  formatDate,
  formatDateTime,
  formatDurationForHumans,
  type SummaryTile,
} from './view-model.js';

/**
 * View models for listings 2-5.
 *
 * Same shape as `view-model.ts`: pure functions, tested, so the four extra
 * listings cost presentation work rather than engine work — which is the
 * portfolio thesis this repository is built to test.
 */

export interface SimpleTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly footnotes: readonly string[];
  /**
   * Which column carries the row's identity and is rendered in bold.
   *
   * Defaults to the first, which is right for every listing that leads with an
   * issue key or a person. The history table leads with a timestamp, and
   * bolding the timestamp while leaving the issue key plain puts the emphasis
   * on the one column a reader does not scan for.
   */
  readonly emphasisColumn?: number;
}

// ------------------------------------------------- listing 2: worklog ---

export function toWorklogTable(result: WorklogAggregateResult, groupLabel: string): SimpleTable {
  const total = result.totalMs;
  return {
    headers: [groupLabel, 'Time logged', 'Share', 'Entries', 'Issues'],
    rows: result.groups.map((group) => [
      group.label,
      formatDurationForHumans(group.timeSpentMs),
      total === 0 ? '—' : `${Math.round((group.timeSpentMs / total) * 100)}%`,
      String(group.entries),
      String(group.issueCount),
    ]),
    footnotes:
      result.entries === 0
        ? ['No worklogs were found in this range.']
        : [
            `${formatDurationForHumans(total)} logged across ${result.entries} entries. ` +
              'Totals are the durations people entered in Jira, not durations derived from timestamps.',
          ],
  };
}

export function toWorklogTiles(result: WorklogAggregateResult): SummaryTile[] {
  const top = result.groups[0];
  return [
    {
      label: 'Total logged',
      value: formatDurationForHumans(result.totalMs),
      hint: `${result.entries} worklog entries.`,
    },
    {
      label: 'Largest contributor',
      value: top === undefined ? '—' : top.label,
      hint: top === undefined ? 'No worklogs in range.' : formatDurationForHumans(top.timeSpentMs),
    },
  ];
}

// ----------------------------------------------- listing 3: WIP aging ---

export function toAgingTable(report: AgingReport): SimpleTable {
  return {
    headers: ['Issue', 'Status', 'Age in status', 'Age total', 'Entered status'],
    rows: report.rows.map((row) => [
      row.issueKey,
      row.statusName,
      formatDurationForHumans(row.ageInStatusMs),
      formatDurationForHumans(row.ageTotalMs),
      formatDate(row.enteredStatusAt),
    ]),
    footnotes: [
      `${report.excludedDone} finished ${report.excludedDone === 1 ? 'issue is' : 'issues are'} ` +
        'excluded; ageing only applies to work in flight.',
      'Age in status is elapsed time. Working-hours ageing covers the completed part of the ' +
        'current visit only, so it is shown separately rather than blended in.',
    ],
  };
}

export function toAgingTiles(report: AgingReport): SummaryTile[] {
  const oldest = report.rows[0];
  const stale = report.buckets
    .filter((b) => b.label === '14-30d' || b.label === '30d+')
    .reduce((n, b) => n + b.count, 0);
  return [
    {
      label: 'In flight',
      value: String(report.rows.length),
      hint: 'Unfinished issues in this project.',
    },
    {
      label: 'Oldest',
      value: oldest === undefined ? '—' : formatDurationForHumans(oldest.ageInStatusMs),
      hint:
        oldest === undefined ? 'Nothing in flight.' : `${oldest.issueKey} in ${oldest.statusName}.`,
    },
    {
      label: 'Older than 14 days',
      value: String(stale),
      hint: 'Issues that have not moved in a fortnight.',
    },
  ];
}

/** Bar-chart series for the aging histogram. */
export function toAgingChartData(report: AgingReport): { label: string; value: number }[] {
  return report.buckets.map((bucket) => ({ label: bucket.label, value: bucket.count }));
}

// ------------------------------------------------------ listing 4: SLA ---

export function toSlaTable(report: SlaReport): SimpleTable {
  // Every duration in this table is working time, so none of them may be
  // rolled up into days — see `DurationFormat` in view-model.ts.
  return {
    headers: ['Issue', 'Working time used', 'Target', 'Remaining', 'Status', 'Due date'],
    rows: report.rows.map((row) => [
      row.issueKey,
      formatDurationForHumans(row.consumedMs, WORKING_TIME),
      formatDurationForHumans(row.targetMs, WORKING_TIME),
      row.remainingMs < 0
        ? `over by ${formatDurationForHumans(-row.remainingMs, WORKING_TIME)}`
        : formatDurationForHumans(row.remainingMs, WORKING_TIME),
      row.breached ? 'Breached' : 'Within target',
      describeDueDate(row.dueDate),
    ]),
    footnotes: [
      `Goal "${report.goalName}": working time spent in the counted statuses, measured against ` +
        'the working calendar configured for this project.',
      'This is a counted-statuses goal, not a start/stop/pause timer. The difference is ' +
        'documented on the listing page so the number cannot be misread.',
    ],
  };
}

function describeDueDate(due: SlaReport['rows'][number]['dueDate']): string {
  if (due.dueAt === null) return '—';
  if (due.overdueByMs === null) return formatDate(due.dueAt);
  if (due.breached)
    return `${formatDate(due.dueAt)} (late by ${formatDurationForHumans(due.overdueByMs)})`;
  return `${formatDate(due.dueAt)} (on time)`;
}

export function toSlaTiles(report: SlaReport): SummaryTile[] {
  return [
    {
      label: 'Attainment',
      value: report.attainment === null ? '—' : `${Math.round(report.attainment * 100)}%`,
      hint: `${report.rows.length} issues measured against "${report.goalName}".`,
    },
    {
      label: 'Breached',
      value: String(report.breachedCount),
      hint: 'Issues over the working-time target.',
    },
    {
      label: 'Late against due date',
      value: String(report.dueDateBreaches),
      hint: 'Issues resolved after their due date, or still open past it.',
    },
  ];
}

// -------------------------------------------------- listing 5: history ---

export function toHistoryTable(report: HistoryReport): SimpleTable {
  return {
    // The zone is named in the header because the timestamps are UTC and the
    // reader's Jira may not be.
    headers: ['When (UTC)', 'Issue', 'Field', 'From', 'To', 'By'],
    // The issue key, not the timestamp, is what a reader scans for.
    emphasisColumn: 1,
    rows: report.records.map((record) => [
      formatDateTime(record.at),
      record.issueKey,
      record.fieldLabel,
      record.fromValue ?? '—',
      record.toValue ?? '—',
      record.authorDisplayName,
    ]),
    footnotes: [
      `${report.total} changes shown. Jira's own History tab is per-issue and cannot be ` +
        'filtered or exported; this view is cross-issue, filterable and exportable.',
    ],
  };
}

export function toHistoryTiles(report: HistoryReport): SummaryTile[] {
  const busiest = report.byField[0];
  return [
    {
      label: 'Changes',
      value: String(report.total),
      hint: 'Field changes in the selected range.',
    },
    {
      label: 'Busiest field',
      value: busiest === undefined ? '—' : busiest.fieldLabel,
      hint:
        busiest === undefined
          ? 'No changes in range.'
          : `${busiest.changes} changes across ${busiest.issues} issues.`,
    },
  ];
}
