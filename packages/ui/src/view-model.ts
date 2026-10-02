import {
  DAY_MS,
  MINUTE_MS,
  formatJiraDuration,
  type BackfillProgress,
  type DistributionSummary,
  type JiraProjectRef,
  type Millis,
  type StatusReport,
  type StatusReportRow,
} from '@jfm/engine';

/**
 * View models for the report surfaces.
 *
 * All presentation *logic* lives here as pure functions so it can be tested
 * directly, leaving the Forge UI Kit components in `components.tsx` as
 * declarative markup. Untested formatting is how a metrics product ends up
 * displaying "0m" for a missing value; the components are covered separately
 * by `test/components.test.tsx`, which renders them.
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
 * How a duration longer than a day should read.
 *
 * ★ This is not cosmetic. Rolling a duration up into days is correct for
 * *elapsed* time — a day is a day — and wrong for *working* time. Jira's own
 * duration format uses the instance's working hours per day (8 by default), so
 * "1d 3h" in a working-hours column reads as **11 hours** to the person it is
 * shown to, while the value behind it is 27. Reporting working time in plain
 * hours removes the ambiguity entirely and costs nothing but width.
 */
export interface DurationFormat {
  /** Default `true`. Pass `false` for any duration measured in working time. */
  readonly rollUpToDays?: boolean;
}

const ELAPSED: DurationFormat = { rollUpToDays: true };
export const WORKING_TIME: DurationFormat = { rollUpToDays: false };

/** The right format for a report's basis. */
export function formatFor(basis: StatusReport['basis']): DurationFormat {
  return basis === 'business' ? WORKING_TIME : ELAPSED;
}

/**
 * Human duration for a table cell.
 *
 * Distinguishes "no time recorded" from "the issue was never in this status":
 * the first is `0m`, the second is an em dash. Conflating them is the sort of
 * quiet wrongness that makes a report untrustworthy.
 */
export function formatCell(ms: Millis | undefined, format: DurationFormat = ELAPSED): string {
  if (ms === undefined) return '—';
  return formatDurationForHumans(ms, format);
}

/**
 * Duration, at the precision a human can act on.
 *
 * Under a minute reads as `<1m`, because "0m" for a real 12-second interval is
 * misleading in the other direction.
 */
export function formatDurationForHumans(ms: Millis, format: DurationFormat = ELAPSED): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return '0m';
  if (ms < MINUTE_MS) return '<1m';
  // Rounding up from 59m30s produces 60 minutes, and neither "60m" nor
  // "44h 60m" is a duration anyone writes. The carry is applied once, before
  // either branch decides how to render the result.
  const wholeMinutes = Math.round(ms / MINUTE_MS);
  if (wholeMinutes < 60) return `${wholeMinutes}m`;
  if (ms < DAY_MS || format.rollUpToDays === false) {
    const hours = Math.floor(wholeMinutes / 60);
    const minutes = wholeMinutes % 60;
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }
  // ★ Days, never weeks. The arithmetic below is right — an elapsed week is
  // seven 24-hour days — but the *rendering* collides with Jira's own
  // convention: Jira's time-tracking format defaults to a five-day week, so
  // a Jira-literate reader decodes "1w 2d" as seven days where the value
  // behind it is nine. That is `DurationFormat`'s argument one unit up, and
  // the fix is the same: drop the ambiguous unit rather than explain it.
  // "9d" costs one character and cannot be misread.
  return formatJiraDuration(ms, { hoursPerDay: 24, daysPerWeek: 3650 });
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

/**
 * `9 Mar 2026 12:00` — the same date format with the time of day.
 *
 * Needed wherever rows are events rather than issues: a change log that only
 * says "2 Mar 2026" against five changes to the same issue tells the reader
 * nothing about their order, which was visible the moment the Issue History
 * page was rendered.
 *
 * UTC, like `formatDate`. The caller must label the column as such — a
 * timestamp shown in an unstated zone is exactly the sort of quiet ambiguity
 * this product is sold against.
 */
export function formatDateTime(ms: Millis | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${formatDate(ms)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
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
  /**
   * Jira's status category, so the table can colour the status the way Jira
   * itself does. `null` when the issue has no current status to speak of —
   * the cell then renders the em dash, not an empty lozenge.
   */
  readonly currentStatusCategory: 'todo' | 'inprogress' | 'done' | 'unknown' | null;
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
  const columnOf = new Map(report.columns.map((c) => [c.statusId, c]));
  const format = formatFor(report.basis);
  const rows = report.rows.map((row) => toReportTableRow(row, report, columnOf, format));
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
  columnOf: ReadonlyMap<string, StatusReport['columns'][number]>,
  format: DurationFormat,
): ReportTableRow {
  const column = row.currentStatusId === null ? undefined : columnOf.get(row.currentStatusId);
  return {
    issueKey: row.issueKey,
    currentStatus: row.currentStatusId === null ? '—' : (column?.name ?? row.currentStatusId),
    // An issue's current status always has an open visit, so it is always a
    // column — `unknown` here means the status meta had no category, not
    // that the lookup missed.
    currentStatusCategory: row.currentStatusId === null ? null : (column?.category ?? 'unknown'),
    created: formatDate(row.createdAt),
    resolved: formatDate(row.resolvedAt),
    cells: report.columns.map((column) => {
      const entries = row.entriesByStatus[column.statusId] ?? null;
      return {
        text: formatCell(row.byStatus[column.statusId], format),
        entries,
        reentered: entries !== null && entries > 1,
      };
    }),
    total: formatDurationForHumans(row.totalMs, format),
    truncated: row.truncated,
  };
}

export interface SummaryTile {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
}

/** One bar in a `BarChart`-shaped series — a category label and its count. */
export interface ChartPoint {
  readonly label: string;
  readonly value: number;
}

/**
 * One point in a multi-series chart — a `ChartPoint` that also says which
 * line it belongs to. `LineChart`'s `colorAccessor` names this field.
 */
export interface SeriesPoint extends ChartPoint {
  readonly series: string;
}

/** "1 issue" / "3 issues" — a tile hint that reads "across 1 issues" costs
 * more trust than the figure beside it earns. */
function countOfIssues(count: number): string {
  return count === 1 ? '1 issue' : `${count} issues`;
}

/** The tiles above the table. Median and 85th percentile, never the mean alone —
 * cycle-time distributions are right-skewed and a mean misleads. */
export function toSummaryTiles(report: StatusReport): SummaryTile[] {
  const format = formatFor(report.basis);
  const tiles: SummaryTile[] = [
    {
      // The whole matching set, not this page: the tile says "Issues
      // matching the current filters" and a page length is not that.
      label: 'Issues',
      value: String(report.matchingIssueCount),
      // "below" was a lie on the dashboard gadget, which renders these tiles
      // and no table at all — it read "1,500 issues … 200 of them are shown
      // below" above nothing. The wording has to be true on every surface
      // that renders a tile.
      hint:
        report.matchingIssueCount === report.issueCount
          ? 'Issues matching the current filters.'
          : `Issues matching the current filters. These figures cover ${report.issueCount} of them.`,
    },
  ];
  for (const column of report.columns) {
    const summary: DistributionSummary | undefined = report.summaryByStatus[column.statusId];
    if (summary === undefined || summary.count === 0) continue;
    tiles.push({
      label: `${column.name} · median`,
      value: summary.medianMs === null ? '—' : formatDurationForHumans(summary.medianMs, format),
      hint:
        summary.p85Ms === null
          ? `Across ${countOfIssues(summary.count)}.`
          : `85th percentile ${formatDurationForHumans(summary.p85Ms, format)}, across ${countOfIssues(summary.count)}.`,
    });
  }
  return tiles;
}

/**
 * Is the project's index incomplete?
 *
 * `null` means it has never been indexed, which is also incomplete. Named here
 * rather than repeated in five gadgets, because the alternative each of them
 * used — `ReportEnvelope.partial` — folds in per-page row truncation and so
 * answers a different question depending on the page size it was asked for.
 */
/**
 * What a gadget says when it has no rows to show.
 *
 * ★ "Nothing to show" and "nobody has indexed this" are different answers,
 * and every gadget gave the first for both.
 *
 * The project pages have distinguished these since the four-state design was
 * written — an empty indexed project gets `EmptySurface`, a never-indexed one
 * gets a banner and a Start indexing button. The gadgets collapsed them,
 * because the empty branch returns before the index state is consulted: a
 * dashboard on a project nobody had indexed read "Nothing to show for this
 * project yet", which says the project is empty when what is actually true
 * is that the app has never looked at it.
 *
 * That is the conflation this product exists to avoid, on the surface its own
 * comments call "often the only surface someone who did not install the app
 * ever sees". Found by the screenshot guard: the `empty` and `not-indexed`
 * screenshots were byte-identical on four of the five gadgets.
 *
 * A gadget cannot offer the button — indexing is the project page's action,
 * and a dashboard viewer may not even be able to reach it — so it says which
 * state it is in and where the action lives.
 */
export function gadgetEmptyMessage(progress: MaybeProgress): string {
  // Not knowing is not a claim, so this falls back to the one sentence that
  // is true either way. See `MaybeProgress`.
  if (progress === 'unknown') return 'Nothing to show for this project yet.';
  if (progress === null || progress.state === 'not_started') {
    return 'This project has not been indexed yet. Open the report from the project menu to start.';
  }
  if (progress.state === 'running' || progress.state === 'paused') {
    return 'Indexing is still running. This will fill in once it finishes.';
  }
  if (progress.state === 'failed') {
    return 'Indexing did not finish. Open the report from the project menu for the reason.';
  }
  return 'Nothing to show for this project yet.';
}

/**
 * The index state as a surface actually knows it.
 *
 * ★ Three cases, not two. `null` used to carry both "this project has never
 * been indexed" and "the call that would have told us failed", and every
 * reader chose the first — so a page whose report loaded fine but whose
 * `getIndexProgress` rejected rendered **"Not indexed yet — start indexing
 * to build the report"** directly above a populated report of that
 * project's issues. Two statements about the same project, on the same
 * screen, one of them false.
 *
 * The frontends already treat a failed progress read as non-fatal, under a
 * comment saying "saying nothing is better than saying something wrong
 * about the index" — and then said something wrong about the index, because
 * the type gave them no way to express not knowing.
 *
 * `'unknown'` is that way. Readers of this type must handle it explicitly;
 * both of the functions below render *nothing* for it, which is what the
 * comment intended all along.
 */
export type MaybeProgress = BackfillProgress | null | 'unknown';

export function isIndexIncomplete(progress: MaybeProgress): boolean {
  // `'unknown'` is not "incomplete": it is the absence of an answer, and a
  // banner asserting a partial index is as much a claim as one asserting a
  // complete one.
  if (progress === 'unknown') return false;
  return progress === null || progress.state !== 'complete';
}

export interface ProgressBanner {
  readonly appearance: 'information' | 'warning' | 'error' | 'success';
  readonly title: string;
  readonly body: string;
  readonly showSpinner: boolean;
  /**
   * Only `failed` sets this. Every other incomplete state either resolves on
   * its own (`paused` resumes automatically, `running`/`not_started` are
   * already moving) or coincides with an empty report, where `EmptySurface`
   * already offers the same action — see `IndexingBanner`'s docstring. A
   * failed backfill can leave real rows on screen (it fails after processing
   * some issues, not before), so that empty-state button never renders, and
   * without this the project has no way back short of reinstalling the app.
   */
  readonly showRetry: boolean;
}

/**
 * The indexing banner.
 *
 * It is never hidden while indexing is incomplete. A user looking at numbers
 * built from half their history must be told, and the honest message is worth
 * more than the tidier screen.
 */
export function toProgressBanner(progress: MaybeProgress): ProgressBanner | null {
  // Not knowing is not a claim. See `MaybeProgress`.
  if (progress === 'unknown') return null;
  if (progress === null) {
    return {
      appearance: 'information',
      title: 'Not indexed yet',
      body: 'Start indexing to build the report for this project.',
      showSpinner: false,
      showRetry: false,
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
        showRetry: false,
      };
    case 'paused':
      return {
        appearance: 'warning',
        title: 'Indexing paused — Jira rate limit',
        body:
          `${describeProgress(progress)} Indexing will resume automatically; ` +
          'this happens on large instances and needs no action.',
        showSpinner: false,
        showRetry: false,
      };
    case 'failed':
      return {
        appearance: 'error',
        title: 'Indexing failed',
        body: `${describeProgress(progress)} ${progress.lastError ?? 'No error detail was recorded.'}`,
        showSpinner: false,
        showRetry: true,
      };
    default: {
      const exhaustive: never = progress.state;
      return exhaustive;
    }
  }
}

/**
 * The banner for a capped report — a project or range bigger than the page
 * the report could fetch.
 *
 * Rendered through the same `IndexingBanner` component as indexing progress:
 * both are "the numbers below do not cover everything" messages, and a capped
 * page that looks complete is the silent-ceiling failure documented in
 * `docs/TECHNICAL-SPEC.md` § 11.1. `included`/`total` are counts of `noun`
 * ("issues", "changes", "worklog entries"); `capped` comes from the report,
 * which computed it against a real store count rather than a page length.
 */
export function toCapBanner(input: {
  capped: boolean;
  included: number;
  total: number;
  noun: string;
}): ProgressBanner | null {
  if (!input.capped) return null;
  return {
    appearance: 'warning',
    title: `Report capped at ${input.included.toLocaleString('en-GB')} of ${input.total.toLocaleString('en-GB')} ${input.noun}`,
    body:
      `The rest are beyond this report's page size, so every figure on this page is a ` +
      'lower bound. Narrow the filters to cover the remainder.',
    showSpinner: false,
    showRetry: false,
  };
}

/**
 * The cap banner for a report that knows it was truncated but cannot say
 * against what.
 *
 * `toCapBanner` needs an honest denominator. The cumulative flow report has
 * none — its `issueCount` is "distinct issues appearing in the window,
 * counted from the visits read", which is a property of what was read rather
 * than of what exists — and passing it as both halves produced the flatly
 * self-contradicting **"Report capped at 412 of 412 issues"**, a title saying
 * nothing was left out above a body saying the rest are missing.
 *
 * So this says only what is known: the figures are a lower bound, and why.
 */
export function toReadCapBanner(input: {
  capped: boolean;
  included: number;
  noun: string;
}): ProgressBanner | null {
  if (!input.capped) return null;
  return {
    appearance: 'warning',
    title: `Showing ${input.included.toLocaleString('en-GB')} ${input.noun}, and there are more`,
    body:
      'This report reached the maximum number of rows it will read in one pass, so every ' +
      'figure on it is a lower bound. Narrow the range to cover the remainder.',
    showSpinner: false,
    showRetry: false,
  };
}

/**
 * The cap banner for a report whose *aggregate* read was truncated.
 *
 * Distinct from both of the above. `toCapBanner` names a denominator
 * ("400 of 5,000 issues"); this truncation has none, because every issue was
 * read and only some of their status rows were cut — `included === total`,
 * and routing it through `toCapBanner` printed "Report capped at 400 of 400
 * issues". `toReadCapBanner` says "showing N, and there are more", which is
 * also wrong here: there are not more issues, there is less known about
 * these ones.
 */
export function toAggregateCapBanner(input: { included: number; noun: string }): ProgressBanner {
  return {
    appearance: 'warning',
    title: `Some of these ${input.included.toLocaleString('en-GB')} ${input.noun} are missing measurements`,
    body:
      'This report reached the maximum number of status rows it will read in one pass, so ' +
      'some issues are measured over only part of their history and read as lower than they ' +
      'are. Narrow the filters to cover the remainder.',
    showSpinner: false,
    showRetry: false,
  };
}

/**
 * The same choice as `toReportCapBanner`, as one sentence for a gadget.
 *
 * A gadget has room for a footnote, not a banner, but it must not make the
 * contradictory claim either: "Covering 400 of 400 issues, so every figure
 * here is a lower bound" is what the aggregate cap printed there.
 */
export function toCapNotice(input: {
  capped: boolean;
  aggregatesCapped: boolean;
  included: number;
  total: number;
  noun: string;
}): string | null {
  if (!input.capped) return null;
  const included = input.included.toLocaleString('en-GB');
  if (!input.aggregatesCapped) {
    return `Covering ${included} of ${input.total.toLocaleString('en-GB')} ${input.noun}, so every figure here is a lower bound.`;
  }
  if (input.included < input.total) {
    return `Covering ${included} of ${input.total.toLocaleString('en-GB')} ${input.noun}, and some of those are missing measurements, so every figure here is a lower bound.`;
  }
  return `Some of these ${included} ${input.noun} are missing measurements, so every figure here is a lower bound.`;
}

/**
 * Pick the right cap banner for a report that can be truncated two ways.
 *
 * The aging and SLA reports each carry two independent ceilings — the issue
 * page and the aggregate row cap — and a single `capped` boolean collapsed
 * them into one sentence that was false for the second. Which one fired is
 * the difference between "we only looked at 400 of your 5,000 issues" and
 * "we looked at all 400 and know less than everything about some of them".
 */
export function toReportCapBanner(input: {
  capped: boolean;
  aggregatesCapped: boolean;
  included: number;
  total: number;
  noun: string;
}): ProgressBanner | null {
  if (!input.capped) return null;
  // ★ Branch on `aggregatesCapped`, not on `included < total`.
  //
  // The two were equivalent — `rows.length` and `projectIssueCount` differ only
  // when the issue page was cut — but only because of an invariant held in
  // another package, stated nowhere here, and true of exactly these two
  // reports. The discriminator was sitting in the parameter list unread,
  // which is the "declares a prop and reads neither" shape this same commit
  // set added `standInPropsNeverRead` to catch on the stand-ins.
  const pageCapped = input.included < input.total;
  if (!input.aggregatesCapped) {
    return toCapBanner({
      capped: true,
      included: input.included,
      total: input.total,
      noun: input.noun,
    });
  }
  if (!pageCapped) {
    return toAggregateCapBanner({ included: input.included, noun: input.noun });
  }
  // Both ceilings. Naming only the first left the reader with a withheld
  // attainment figure and no sentence explaining why it was withheld.
  const page = toCapBanner({
    capped: true,
    included: input.included,
    total: input.total,
    noun: input.noun,
  })!;
  return {
    ...page,
    body: `${page.body} Some of the ${input.noun} that were read are also missing measurements.`,
  };
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

/** One selectable entry in the dashboard gadget's project picker. */
export interface ProjectOption {
  readonly label: string;
  readonly value: string;
}

/**
 * Turn `listProjects` results into `Select` options, sorted by name.
 *
 * A project missing an id is not offerable — `view.submit` needs a real
 * value to configure the gadget with — so it is dropped rather than shown
 * with a broken selection. `key`/`name` are both optional in Jira's own
 * type; when `name` is absent the key stands in, and when both are absent
 * the id does, so the picker never renders a blank row.
 */
export function toProjectOptions(projects: readonly JiraProjectRef[]): ProjectOption[] {
  return projects
    .filter((p): p is JiraProjectRef & { id: string } => typeof p.id === 'string' && p.id !== '')
    .map((p) => ({ label: p.name ?? p.key ?? p.id, value: p.id }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Hours, for a chart axis — two decimals, and never zero for a real duration.
 *
 * Charts cannot show "2d 4h": a bar's height is a number, and the axis has to
 * be labelled in something. Hours is the only unit that stays honest for both
 * bases — see `DurationFormat` for why days are wrong for working time — so
 * every chart states "hours" in its subtitle and every value is one.
 *
 * ★ The floor is the part worth reading. At one decimal, anything under three
 * minutes rounded to `0`, and `toStatusChartData` right below documents a zero
 * bar as "a different and wrong claim" — so a status with a real two-minute
 * median passed its own guard and was then plotted as exactly the bar that
 * guard exists to prevent. Two decimals plus a floor of 0.01 means a measured
 * duration is always visibly non-zero. It overstates a three-second visit as
 * ~36 seconds, which is the right way round to be wrong: the table beside it
 * carries the exact figure (`<1m`), and the reader needs to know the status
 * was visited at all far more than they need its third decimal place.
 */
export function toHours(ms: Millis): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(0.01, Math.round((ms / 3_600_000) * 100) / 100);
}

/**
 * Median time in each status, as a bar series.
 *
 * The median, not the mean, for the same reason `toSummaryTiles` uses it:
 * cycle-time distributions are right-skewed and one abandoned issue drags a
 * mean somewhere no real issue has ever been. Statuses with no measured
 * issues are dropped rather than plotted as zero — a zero bar reads as "no
 * time spent here", which is a different and wrong claim.
 */
export function toStatusChartData(report: StatusReport): ChartPoint[] {
  const points: ChartPoint[] = [];
  for (const column of report.columns) {
    const summary = report.summaryByStatus[column.statusId];
    if (summary === undefined || summary.count === 0 || summary.medianMs === null) continue;
    points.push({ label: column.name, value: toHours(summary.medianMs) });
  }
  return points;
}
