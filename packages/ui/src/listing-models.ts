import type { WorklogAggregateResult } from '@jfm/engine';
import type {
  AgingReport,
  FlowReport,
  HistoryReport,
  IssueTimelineReport,
  SlaReport,
} from '@jfm/forge-runtime';
import {
  WORKING_TIME,
  formatDateTime,
  formatDurationForHumans,
  toHours,
  formatBytes,
  formatDate,
  type ChartPoint,
  type SeriesPoint,
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

/**
 * Logged time is **working** time and must never roll up into days.
 *
 * It is the most working-time-shaped number in the product: it is what a
 * person typed into Jira's own "time spent" field, and Jira renders that with
 * the instance's working hours per day. Showing 30 logged hours as "1d 6h"
 * against Jira's own "3d 6h" is the same factor-of-three misreading the status
 * table was fixed for. See `DurationFormat` in view-model.ts.
 */
export function toWorklogTable(result: WorklogAggregateResult, groupLabel: string): SimpleTable {
  const total = result.totalMs;
  return {
    headers: [groupLabel, 'Time logged', 'Share', 'Entries', 'Issues'],
    rows: result.groups.map((group) => [
      group.label,
      formatDurationForHumans(group.timeSpentMs, WORKING_TIME),
      total === 0 ? '—' : `${Math.round((group.timeSpentMs / total) * 100)}%`,
      String(group.entries),
      String(group.issueCount),
    ]),
    footnotes:
      result.entries === 0
        ? ['No worklogs were found in this range.']
        : [
            `${formatDurationForHumans(total, WORKING_TIME)} logged across ${result.entries} entries. ` +
              'Totals are the durations people entered in Jira, not durations derived from timestamps.',
          ],
  };
}

export function toWorklogTiles(result: WorklogAggregateResult): SummaryTile[] {
  const top = result.groups[0];
  return [
    {
      label: 'Total logged',
      value: formatDurationForHumans(result.totalMs, WORKING_TIME),
      hint: `${result.entries} worklog entries.`,
    },
    {
      label: 'Largest contributor',
      value: top === undefined ? '—' : top.label,
      hint:
        top === undefined
          ? 'No worklogs in range.'
          : formatDurationForHumans(top.timeSpentMs, WORKING_TIME),
    },
  ];
}

// ----------------------------------------------- listing 3: WIP aging ---

export function toAgingTable(report: AgingReport): SimpleTable {
  return {
    // "Working hours" is a real column now. The footnote below has always
    // promised the working-hours figure "is shown separately rather than
    // blended in", `AgingReportRow.ageInStatusBusinessMs` has always been
    // populated, and the only place it actually appeared was the CSV — so a
    // reader following the footnote hunted a column that did not exist.
    headers: ['Issue', 'Status', 'Age in status', 'Working hours', 'Age total', 'Entered status'],
    rows: report.rows.map((row) => [
      row.issueKey,
      row.statusName,
      formatDurationForHumans(row.ageInStatusMs),
      formatDurationForHumans(row.ageInStatusBusinessMs, WORKING_TIME),
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
export function toAgingChartData(report: AgingReport): ChartPoint[] {
  return report.buckets.map((bucket) => ({ label: bucket.label, value: bucket.count }));
}

/**
 * The cumulative flow series — one line per status, one point per day.
 *
 * Day labels are the short date `formatDate` produces everywhere else, and
 * the caption has to say UTC for the same reason the history table's header
 * does: the buckets are UTC days and the reader's Jira may not be.
 */
export function toFlowChartData(report: FlowReport): SeriesPoint[] {
  const nameOf = new Map(report.bands.map((band) => [band.statusId, band.name]));
  return report.points.map((point) => ({
    label: formatDate(point.at),
    series: nameOf.get(point.statusId) ?? point.statusId,
    value: point.count,
  }));
}

// ------------------------------------------------------ listing 4: SLA ---

/**
 * The goal the user chooses on the SLA page — a *view* choice, not stored
 * configuration; v1 deliberately ships no goal editor (PRODUCT-SPEC § 7).
 * An empty `countedStatusIds` means every status counts, matching the
 * resolver's semantics.
 */
export interface SlaGoalChoice {
  readonly countedStatusIds: readonly string[];
  readonly targetMs: number;
  /**
   * Set when the choice came from a goal **saved for this project**.
   *
   * The report resolver then measures against the stored definition rather
   * than these fields: the id is the whole payload, so a client cannot label
   * a table with one goal's name and compute it from another's numbers.
   * Editing any field below clears it — what is on screen is no longer that
   * saved goal, and saying it is would be a lie the numbers cannot detect.
   */
  readonly savedGoalId?: string;
}

/** One saved goal as the picker sees it. Mirrors `StoredSlaGoal`. */
export interface SavedSlaGoal {
  readonly id: string;
  readonly name: string;
  readonly countedStatusIds: readonly string[];
  readonly targetMs: number;
}

/** A saved goal, as a choice the form can render. */
export function toGoalChoice(goal: SavedSlaGoal): SlaGoalChoice {
  return {
    countedStatusIds: goal.countedStatusIds,
    targetMs: goal.targetMs,
    savedGoalId: goal.id,
  };
}

/**
 * The payload the report and export resolvers take.
 *
 * A saved goal travels as its id alone. Sending the fields too would invite
 * exactly the mismatch `savedGoalId` exists to prevent.
 */
export function toGoalPayload(goal: SlaGoalChoice): Record<string, unknown> {
  if (goal.savedGoalId !== undefined) return { goalId: goal.savedGoalId };
  return { countedStatusIds: [...goal.countedStatusIds], targetMs: goal.targetMs };
}

/** Does this choice still match the goal it was loaded from? */
export function matchesSavedGoal(choice: SlaGoalChoice, goal: SavedSlaGoal): boolean {
  return (
    choice.targetMs === goal.targetMs &&
    choice.countedStatusIds.length === goal.countedStatusIds.length &&
    [...choice.countedStatusIds].sort().join(',') === [...goal.countedStatusIds].sort().join(',')
  );
}

const HOUR_MS = 3_600_000;

export const DEFAULT_SLA_GOAL: SlaGoalChoice = {
  countedStatusIds: [],
  targetMs: 8 * HOUR_MS,
};

/**
 * Preset targets rather than a free-text field: UI Kit 2 has no numeric
 * input validation worth trusting for the one number every figure on the
 * page divides by, and these cover the spans SLA conversations actually use.
 */
export const SLA_TARGET_OPTIONS: readonly { label: string; value: string }[] = [
  { label: '4 working hours', value: String(4 * HOUR_MS) },
  { label: '8 working hours', value: String(8 * HOUR_MS) },
  { label: '16 working hours', value: String(16 * HOUR_MS) },
  { label: '24 working hours', value: String(24 * HOUR_MS) },
  { label: '40 working hours', value: String(40 * HOUR_MS) },
  { label: '80 working hours', value: String(80 * HOUR_MS) },
];

/**
 * Toggle one status in or out of the counted set.
 *
 * Drops `savedGoalId`: the choice on screen is no longer the goal it was
 * loaded from, and keeping the id would make the report resolve the *stored*
 * definition while the chips showed something else.
 */
export function toggleCountedStatus(goal: SlaGoalChoice, statusId: string): SlaGoalChoice {
  const counted = goal.countedStatusIds.includes(statusId)
    ? goal.countedStatusIds.filter((id) => id !== statusId)
    : [...goal.countedStatusIds, statusId];
  return { countedStatusIds: counted, targetMs: goal.targetMs };
}

/** Change the target. Detaches from a saved goal for the same reason. */
export function withTarget(goal: SlaGoalChoice, targetMs: number): SlaGoalChoice {
  return { countedStatusIds: goal.countedStatusIds, targetMs };
}

export function toSlaTable(report: SlaReport): SimpleTable {
  // Every duration in the SLA *columns* is working time, so none of them may
  // be rolled up into days — see `DurationFormat` in view-model.ts. The due
  // date column is the exception and keeps the roll-up on purpose: lateness
  // against a calendar date is elapsed time, where a day does mean a day.
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
      // ★ Never round *up* to 100%. `Math.round` turned 498 of 500 met into
      // "Attainment 100%" sitting directly beside "Breached 2" — two tiles
      // on one row stating incompatible things about the same issues, in the
      // normal healthy case rather than an edge one. 100% now means exactly
      // what it says: nothing breached.
      value:
        report.attainment === null
          ? '—'
          : `${report.breachedCount === 0 ? 100 : Math.min(99, Math.floor(report.attainment * 100))}%`,
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
        'exported; this view is cross-issue and exportable.',
    ],
  };
}

export function toHistoryTiles(report: HistoryReport): SummaryTile[] {
  const busiest = report.byField[0];
  return [
    {
      // The matching total, not the page. `report.total` is documented as
      // "changes on this page", and using it here put "Changes 3 · Field
      // changes in the selected range" directly under a banner reading
      // "Report capped at 3 of 3,000 changes". `view-model.ts` solved the
      // same problem for the status report; history had not caught up.
      label: 'Changes',
      value: String(report.totalMatching),
      hint:
        report.totalMatching === report.total
          ? 'Field changes in the selected range.'
          : `Field changes in the selected range. These figures cover ${report.total} of them.`,
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

// ------------------------------------------------------- chart series ---

/**
 * How many categories a bar chart may show before the labels stop being
 * readable.
 *
 * Not a cosmetic cap. A project with 60 contributors renders 60 unlabelled
 * slivers, which is worse than no chart — so the series is truncated to the
 * largest `CHART_CATEGORY_LIMIT` and the *table underneath* stays complete.
 * The chart is the summary; the table is the record.
 */
export const CHART_CATEGORY_LIMIT = 12;

/** Time logged per group — the worklog page's chart. */
export function toWorklogChartData(result: WorklogAggregateResult): ChartPoint[] {
  return result.groups
    .slice(0, CHART_CATEGORY_LIMIT)
    .map((group) => ({ label: group.label, value: toHours(group.timeSpentMs) }));
}

/**
 * How close each issue is to its target — the SLA page's chart.
 *
 * Bands, not a breached/not-breached pair. "How many are about to breach" is
 * the question this listing exists to answer and a two-bar chart cannot show
 * it: an issue at 95% of target and one at 10% are both "within target", and
 * only one of them is a problem today.
 *
 * ★ The breached band reads `row.breached`, the same field the table's
 * "Breached" cell reads, rather than re-deriving it as `consumedFraction >=
 * 1`. An issue that has consumed *exactly* its target has `remainingMs === 0`
 * and is within target in the table; a band boundary of `>= 1` would count it
 * as breached in the chart directly above. Two views of one row disagreeing
 * on that row is precisely the quiet wrongness this product is sold against,
 * and it is one expression away.
 */
export function toSlaChartData(report: SlaReport): ChartPoint[] {
  const within = report.rows.filter((row) => !row.breached);
  const bands = [
    { label: 'Under 50%', min: 0, max: 0.5 },
    { label: '50-80%', min: 0.5, max: 0.8 },
    { label: '80-100%', min: 0.8, max: Number.POSITIVE_INFINITY },
  ];
  return [
    ...bands.map((band) => ({
      label: band.label,
      value: within.filter(
        (row) => row.consumedFraction >= band.min && row.consumedFraction < band.max,
      ).length,
    })),
    { label: 'Breached', value: report.breachedCount },
  ];
}

/** Changes per field — the history page's chart. */
export function toHistoryChartData(report: HistoryReport): ChartPoint[] {
  return report.byField
    .slice(0, CHART_CATEGORY_LIMIT)
    .map((field) => ({ label: field.fieldLabel, value: field.changes }));
}

// -------------------------------------------------- the history window ---

/**
 * Windows the "extend history" control offers. Mirrors
 * `HISTORY_WINDOW_MONTHS` in `@jfm/forge-runtime`, which is what actually
 * accepts or refuses the value — `@jfm/ui` must not depend on the runtime for
 * a constant, and a resolver must never trust a list the client sent anyway.
 */
export const HISTORY_WINDOW_MONTHS: readonly number[] = [12, 24, 36, 60, 120];

export interface HistoryWindowOption {
  readonly label: string;
  /** `String(months)`, or `all`. Parsed back by `parseHistoryWindowValue`. */
  readonly value: string;
}

/** How a window reads on screen. `null` is all history. */
export function describeHistoryWindow(months: number | null): string {
  if (months === null) return 'All history';
  if (months % 12 === 0) {
    const years = months / 12;
    return years === 1 ? 'Last 12 months' : `Last ${years} years`;
  }
  return `Last ${months} months`;
}

/**
 * The windows offered given the one in force — wider ones only.
 *
 * Narrowing is not offered because it would not delete the rows already
 * stored: the report would keep showing history the page claimed was out of
 * range. The resolver refuses it too; this just keeps the control from
 * offering what it knows will be refused.
 */
export function historyWindowOptions(current: number | null): HistoryWindowOption[] {
  if (current === null) return [];
  return [
    ...HISTORY_WINDOW_MONTHS.filter((months) => months > current).map((months) => ({
      label: describeHistoryWindow(months),
      value: String(months),
    })),
    { label: describeHistoryWindow(null), value: 'all' },
  ];
}

/** `all` → `null`; a listed month count → that number; anything else → `undefined`. */
export function parseHistoryWindowValue(value: string): number | null | undefined {
  if (value === 'all') return null;
  const months = Number(value);
  return HISTORY_WINDOW_MONTHS.includes(months) ? months : undefined;
}

// --------------------------------------------- the issue panel timeline ---

/**
 * One issue's visits, in order — the issue panel's table.
 *
 * Both bases in one table on purpose. The panel is opened beside Jira's own
 * History tab, where every timestamp is wall-clock, so elapsed has to be
 * there to be checkable; and working time is the figure the product's other
 * reports are measured in, so leaving it out would make the panel disagree
 * with the report page on the same issue.
 */
export function toTimelineTable(report: IssueTimelineReport): SimpleTable {
  return {
    headers: ['Status', 'Entered (UTC)', 'Left (UTC)', 'Elapsed', 'Working time'],
    rows: report.visits.map((visit) => [
      visit.statusName,
      formatDateTime(visit.enteredAt),
      visit.exitedAt === null ? 'still here' : formatDateTime(visit.exitedAt),
      formatDurationForHumans(visit.elapsedMs),
      formatDurationForHumans(visit.businessMs, WORKING_TIME),
    ]),
    footnotes: report.truncated
      ? [
          'This issue has more changelog entries than were read, so the visits below are a ' +
            'lower bound.',
        ]
      : [],
  };
}

/** The per-status totals, which is the report page's row for this one issue. */
export function toTimelineTotals(report: IssueTimelineReport): SimpleTable {
  return {
    headers: ['Status', 'Visits', 'Elapsed, all visits', 'Working time, all visits'],
    rows: report.totals.map((total) => [
      total.statusName,
      String(total.entries),
      formatDurationForHumans(total.elapsedMs),
      formatDurationForHumans(total.businessMs, WORKING_TIME),
    ]),
    footnotes: report.totals.some((total) => total.entries > 1)
      ? [
          'A status with more than one visit is one Jira’s own Control Chart reports only ' +
            'the most recent stay in. The totals here cover every stay.',
        ]
      : [],
  };
}

/** The panel's tiles: what the derived goal says about this issue. */
export function toTimelineTiles(report: IssueTimelineReport): SummaryTile[] {
  const tiles: SummaryTile[] = [
    {
      label: 'Visits recorded',
      value: String(report.visits.length),
      hint: `Since ${formatDate(report.createdAt)}.`,
    },
  ];
  const sla = report.sla;
  if (sla === null) return tiles;
  tiles.push({
    label: 'Working time in progress',
    value: formatDurationForHumans(sla.elapsedWorkingMs, WORKING_TIME),
    hint:
      sla.pausedMs > 0
        ? `${formatDurationForHumans(sla.pausedMs, WORKING_TIME)} back in a to-do status is not counted.`
        : 'No time back in a to-do status to discount.',
  });
  tiles.push({
    label: sla.breached ? 'Over one working day' : 'Within one working day',
    value:
      sla.remainingMs < 0
        ? `over by ${formatDurationForHumans(-sla.remainingMs, WORKING_TIME)}`
        : formatDurationForHumans(sla.remainingMs, WORKING_TIME),
    // Derived from status categories, and the panel says so rather than
    // letting the figure read as a goal somebody configured.
    hint: 'Against a derived goal: starts at the first in-progress status, stops at the first done status.',
  });
  return tiles;
}

// -------------------------------------------------- the admin usage page ---

export interface StorageEstimate {
  readonly bytes: number;
  readonly note: string;
  readonly tables: readonly { table: string; rows: number; bytes: number }[];
}

/**
 * What this installation is holding, per table.
 *
 * Row counts and estimated bytes only — never anything issue-shaped. An
 * admin page is instance-wide, so a single issue key here would be readable
 * by somebody with no permission on the project it came from.
 */
export function toStorageTable(estimate: StorageEstimate): SimpleTable {
  return {
    headers: ['Table', 'Rows', 'Estimated size'],
    rows: estimate.tables.map((row) => [
      row.table,
      row.rows.toLocaleString('en-GB'),
      formatBytes(row.bytes),
    ]),
    footnotes: [estimate.note],
  };
}

export function toStorageTiles(estimate: StorageEstimate): SummaryTile[] {
  const issues = estimate.tables.find((row) => row.table === 'issue_meta')?.rows ?? 0;
  return [
    {
      label: 'Estimated storage',
      value: formatBytes(estimate.bytes),
      hint: 'Across every project this app has indexed.',
    },
    {
      label: 'Issues indexed',
      value: issues.toLocaleString('en-GB'),
      hint: 'Rows in issue_meta, instance-wide.',
    },
  ];
}
