import {
  DAY_MS,
  aggregateWorklogs,
  evaluateDueDate,
  summariseByField,
  type DueDateResult,
  type FieldChangeSummary,
  type HistoryRecord,
  type IssueMetaRow,
  type MetricsStore,
  type Millis,
  AGGREGATE_ROW_CAP,
  type StatusAggregateRow,
  type StatusId,
  type StatusCategory,
  type StatusMetaRow,
  type WorklogAggregateResult,
  type WorklogGroupBy,
} from '@jfm/engine';

/**
 * Reports for listings 2-5, built from the same stored aggregates as listing 1.
 *
 * This file is the portfolio thesis under test: four more sellable reports, no
 * new ingestion, no new storage, no new Jira calls. If any of these had needed
 * its own pipeline the "one engine, five listings" argument would be false.
 *
 * ## What is deliberately *not* here
 *
 * The SLA report below uses a **counted-statuses** model — "cumulative working
 * time in these statuses must not exceed the target" — because that is exactly
 * computable from the stored aggregate. The engine also ships a full
 * start/stop/pause timeline model (`evaluateSla`), which is strictly more
 * expressive but needs the issue's whole timeline, so it is used on the issue
 * panel where one issue is in hand rather than on a project-wide table.
 * Both are documented in `docs/PRODUCT-SPEC.md`; conflating them would be the
 * sort of quiet difference that makes a metrics product untrustworthy.
 */

// ---------------------------------------------------------------- worklog ---

export interface WorklogReportRequest {
  readonly projectId: string;
  readonly groupBy?: WorklogGroupBy;
  readonly from?: Millis;
  readonly to?: Millis;
  readonly authorAccountIds?: readonly string[];
  readonly limit?: number;
}

export interface WorklogReport extends WorklogAggregateResult {
  /** Matching worklog entries in the store, from a real count, not a page length. */
  readonly totalEntries: number;
  /** True when more entries match than were fetched, so every figure is a lower bound. */
  readonly capped: boolean;
}

export async function buildWorklogReport(
  store: MetricsStore,
  request: WorklogReportRequest,
  timeZone: string,
): Promise<WorklogReport> {
  const worklogQuery = {
    projectId: request.projectId,
    ...(request.from === undefined ? {} : { from: request.from }),
    ...(request.to === undefined ? {} : { to: request.to }),
    ...(request.authorAccountIds === undefined
      ? {}
      : { authorAccountIds: request.authorAccountIds }),
  };
  const records = await store.queryWorklogs({ ...worklogQuery, limit: request.limit ?? 10_000 });
  const totalEntries = await store.countWorklogs(worklogQuery);
  const result = aggregateWorklogs(records, {
    groupBy: request.groupBy ?? 'author',
    timeZone,
    ...(request.from === undefined ? {} : { from: request.from }),
    ...(request.to === undefined ? {} : { to: request.to }),
  });
  return { ...result, totalEntries, capped: totalEntries > records.length };
}

// ------------------------------------------------------------- WIP aging ---

export interface AgingReportRow {
  readonly issueId: string;
  readonly issueKey: string;
  readonly statusId: StatusId | null;
  readonly statusName: string;
  /** Jira's category for that status, so the table can colour it as Jira does. */
  readonly statusCategory: StatusCategory | null;
  /** Time in the current status, still running. */
  readonly ageInStatusMs: Millis;
  readonly ageInStatusBusinessMs: Millis;
  readonly ageTotalMs: Millis;
  readonly enteredStatusAt: Millis | null;
}

export interface AgingReport {
  readonly rows: readonly AgingReportRow[];
  readonly buckets: readonly { label: string; count: number }[];
  readonly evaluatedAt: Millis;
  /** Issues excluded because they are already done. */
  readonly excludedDone: number;
  /** Total issues stored for the project, from a real count, not a page length. */
  readonly projectIssueCount: number;
  /** True when the project holds more issues than the report could fetch. */
  readonly capped: boolean;
  /**
   * True when the *aggregate* read hit its row cap, which is a different
   * truncation from `capped` and cannot be described with the same sentence.
   *
   * `capped` has an honest denominator — this many of that many issues — and
   * the page says so. This one does not: every issue was read, so
   * `rows.length === projectIssueCount`, and reporting it through the same
   * banner produced "Report capped at 400 of 400 issues", a title saying
   * nothing was left out above a body saying the rest are missing. Exactly
   * the self-contradiction `toReadCapBanner` was written to remove from the
   * flow report, reintroduced on this one.
   */
  readonly aggregatesCapped: boolean;
}

/**
 * Aggregate rows one report will read in a pass.
 *
 * The SQL adapter clamps an unspecified limit to 10,000 silently, and these
 * two reports asked for none — so on a wide workflow (500 issues each
 * visiting 20+ statuses) the tail issues lost their aggregates entirely,
 * `ORDER BY issue_id` deciding which. An issue with no aggregate row reads
 * as `consumedMs = 0`: **fully compliant**. An SLA table saying "100%
 * attainment, 0 breached" over a project that is breaching is the exact
 * failure this codebase exists to avoid, so the cap is now explicit and
 * hitting it is reported rather than absorbed.
 */

/**
 * Read the aggregate rows for a page of issues, and say whether the cap cut
 * them off.
 *
 * ★ Asks for one row more than the cap, and the cap is one below the store's
 * ceiling so that the extra row can actually be delivered.
 *
 * Two mistakes in sequence, both worth keeping written down.
 *
 * `length >= cap` cannot tell "exactly `cap` rows" from "truncated at `cap`",
 * and since the SLA report started withholding `attainment` on a capped
 * read, that false positive stopped costing a spurious banner and started
 * blanking the headline figure on a complete, correct report.
 *
 * ⚠️ One value is still indistinguishable, and it is not the one an earlier
 * version of this comment named. With the cap at `STORE_MAX_ROWS - 1` the
 * probe reads `STORE_MAX_ROWS`, so a page whose aggregates come to *exactly*
 * `STORE_MAX_ROWS` rows is reported as capped though nothing was dropped —
 * 500 issues on a 20-status workflow, which is an ordinary shape. That is
 * the honest limit of detecting truncation through a port with a hard
 * ceiling: one value must be guessed, and this guesses the safe way, since
 * withholding a correct figure is recoverable and publishing a wrong one is
 * not.
 *
 * The fix for that asked for `10_000 + 1` while `AGGREGATE_ROW_CAP` was
 * 10,000 — which is exactly `SQL_MAX_ROWS`, so `clampLimit` silently handed
 * back 10,000 and `length > cap` could never be true on the store that
 * ships. That turned a conservative over-report into silence on the real
 * truncation: the tail issues' rows are dropped by `ORDER BY issue_id`, they
 * read as `consumedMs = 0` — fully compliant — and the SLA page prints an
 * inflated attainment with no banner at all. Precisely the failure this
 * cap's own docstring says it exists to prevent. `MemoryStore` has no clamp,
 * so the test written for the fix exercised the one store where it worked.
 *
 * Deriving the cap from `SQL_MAX_ROWS` is what stops the two drifting again:
 * the probe cannot be silently swallowed by the ceiling it is probing.
 */
async function readAggregates(
  store: MetricsStore,
  projectId: string,
  issueIds: readonly string[],
): Promise<{ aggregates: readonly StatusAggregateRow[]; capped: boolean }> {
  const rows = await store.queryStatusDurations({
    projectId,
    issueIds,
    limit: AGGREGATE_ROW_CAP + 1,
  });
  const capped = rows.length > AGGREGATE_ROW_CAP;
  // ★ Every row read is kept, the probe row included — see the note in
  // `buildStatusReport`. Discarding it made one issue's figures worse than
  // they were before this check existed.
  return { aggregates: rows, capped };
}

const AGING_BUCKETS: readonly { label: string; fromDays: number; toDays: number | null }[] = [
  { label: '0-1d', fromDays: 0, toDays: 1 },
  { label: '1-3d', fromDays: 1, toDays: 3 },
  { label: '3-7d', fromDays: 3, toDays: 7 },
  { label: '7-14d', fromDays: 7, toDays: 14 },
  { label: '14-30d', fromDays: 14, toDays: 30 },
  { label: '30d+', fromDays: 30, toDays: null },
];

/**
 * Age every unfinished issue by how long it has sat in its current status.
 *
 * Computed from `issue_meta.current_status_id` plus the matching aggregate
 * row's `last_entered_at`, so it needs no timeline and no extra Jira call —
 * which is the whole reason this is a second listing rather than a second
 * product.
 */
export async function buildAgingReport(
  store: MetricsStore,
  projectId: string,
  now: Millis,
  limit = 500,
): Promise<AgingReport> {
  const metas = await store.queryIssueMeta({ projectId, limit });
  const projectIssueCount = await store.countIssueMeta({ projectId });
  const statusMeta = await store.getStatusMeta();
  const byId = new Map(statusMeta.map((s) => [s.statusId, s]));
  const { aggregates, capped: aggregatesCapped } = await readAggregates(
    store,
    projectId,
    metas.map((m) => m.issueId),
  );
  const aggregateFor = new Map<string, StatusAggregateRow>();
  for (const row of aggregates) aggregateFor.set(`${row.issueId}:${row.statusId}`, row);

  const rows: AgingReportRow[] = [];
  let excludedDone = 0;

  for (const meta of metas) {
    if (isDone(meta, byId)) {
      excludedDone += 1;
      continue;
    }
    const statusId = meta.currentStatusId;
    const aggregate =
      statusId === null ? undefined : aggregateFor.get(`${meta.issueId}:${statusId}`);
    const enteredAt = aggregate?.lastEnteredAt ?? null;
    rows.push({
      issueId: meta.issueId,
      issueKey: meta.issueKey,
      statusId,
      statusName: statusId === null ? 'Unknown' : (byId.get(statusId)?.name ?? statusId),
      statusCategory: statusId === null ? null : (byId.get(statusId)?.category ?? 'unknown'),
      ageInStatusMs: enteredAt === null ? 0 : Math.max(0, now - enteredAt),
      // The stored `business_ms` is the *closed* portion of the visit, so the
      // still-running part is added as elapsed. Reported as an approximation
      // rather than silently blended — see docs/PRODUCT-SPEC.md.
      ageInStatusBusinessMs: aggregate?.businessMs ?? 0,
      ageTotalMs: Math.max(0, now - meta.createdAt),
      enteredStatusAt: enteredAt,
    });
  }

  rows.sort((a, b) => b.ageInStatusMs - a.ageInStatusMs || a.issueKey.localeCompare(b.issueKey));

  const buckets = AGING_BUCKETS.map((bucket) => ({
    label: bucket.label,
    count: rows.filter((row) => {
      const days = row.ageInStatusMs / DAY_MS;
      return days >= bucket.fromDays && (bucket.toDays === null || days < bucket.toDays);
    }).length,
  }));

  return {
    rows,
    buckets,
    evaluatedAt: now,
    excludedDone,
    projectIssueCount,
    // Either ceiling makes every figure a lower bound — but they are not the
    // same statement, and `aggregatesCapped` carries the one the issue-page
    // banner cannot express. See its docstring.
    capped: projectIssueCount > metas.length || aggregatesCapped,
    aggregatesCapped,
  };
}

function isDone(meta: IssueMetaRow, byId: ReadonlyMap<StatusId, StatusMetaRow>): boolean {
  if (meta.resolvedAt !== null) return true;
  if (meta.currentStatusId === null) return false;
  return byId.get(meta.currentStatusId)?.category === 'done';
}

// ------------------------------------------------------------------- SLA ---

export interface SlaCountedGoal {
  readonly id: string;
  readonly name: string;
  /** Working time in these statuses counts towards the target. */
  readonly countedStatusIds: readonly StatusId[];
  readonly targetMs: Millis;
}

export interface SlaReportRow {
  readonly issueId: string;
  readonly issueKey: string;
  readonly consumedMs: Millis;
  readonly targetMs: Millis;
  readonly remainingMs: Millis;
  readonly breached: boolean;
  /** 0-1, uncapped so a badly-breached issue is visibly worse than a marginal one. */
  readonly consumedFraction: number;
  readonly dueDate: DueDateResult;
}

export interface SlaReport {
  readonly goalId: string;
  readonly goalName: string;
  readonly rows: readonly SlaReportRow[];
  readonly breachedCount: number;
  /** Share of measured issues that met the goal, 0-1. `null` when empty. */
  /**
   * Met issues as a fraction, or `null` when the figure cannot be trusted.
   *
   * ★ `null` when the aggregate read was truncated, not merely when there
   * are no rows. An issue whose aggregate rows were cut reads as zero
   * consumed working time — i.e. *compliant* — so on a 400-issue project
   * where all 400 breach, cutting 66 of them produced "16% attainment"
   * rather than 0%. Unlike every other figure on a capped report, attainment
   * is wrong in the reassuring direction, so it is withheld rather than
   * shown under a banner calling it a lower bound.
   */
  readonly attainment: number | null;
  readonly dueDateBreaches: number;
  /** Total issues stored for the project, from a real count, not a page length. */
  readonly projectIssueCount: number;
  /** True when the project holds more issues than the report could fetch. */
  readonly capped: boolean;
  /** True when the aggregate read hit its row cap. See `AgingReport`. */
  readonly aggregatesCapped: boolean;
}

export async function buildSlaReport(
  store: MetricsStore,
  projectId: string,
  goal: SlaCountedGoal,
  now: Millis,
  limit = 500,
  // The project's own timezone decides where its due *day* ends. Defaulting
  // to UTC keeps every existing caller behaving as before; the runtime passes
  // the configured calendar's zone, which is the one the customer set.
  timeZone = 'UTC',
): Promise<SlaReport> {
  const metas = await store.queryIssueMeta({ projectId, limit });
  const projectIssueCount = await store.countIssueMeta({ projectId });
  const counted = new Set(goal.countedStatusIds);
  const { aggregates, capped: aggregatesCapped } = await readAggregates(
    store,
    projectId,
    metas.map((m) => m.issueId),
  );

  const consumedByIssue = new Map<string, number>();
  for (const row of aggregates) {
    if (counted.size > 0 && !counted.has(row.statusId)) continue;
    consumedByIssue.set(row.issueId, (consumedByIssue.get(row.issueId) ?? 0) + row.businessMs);
  }

  const rows: SlaReportRow[] = metas.map((meta) => {
    const consumedMs = consumedByIssue.get(meta.issueId) ?? 0;
    const remainingMs = goal.targetMs - consumedMs;
    return {
      issueId: meta.issueId,
      issueKey: meta.issueKey,
      consumedMs,
      targetMs: goal.targetMs,
      remainingMs,
      breached: remainingMs < 0,
      consumedFraction: goal.targetMs <= 0 ? 0 : consumedMs / goal.targetMs,
      dueDate: evaluateDueDate(
        {
          issueId: meta.issueId,
          issueKey: meta.issueKey,
          dueAt: meta.dueAt,
          resolvedAt: meta.resolvedAt,
        },
        now,
        timeZone,
      ),
    };
  });

  rows.sort(
    (a, b) => b.consumedFraction - a.consumedFraction || a.issueKey.localeCompare(b.issueKey),
  );
  const breachedCount = rows.filter((r) => r.breached).length;

  return {
    goalId: goal.id,
    goalName: goal.name,
    rows,
    breachedCount,
    attainment:
      rows.length === 0 || aggregatesCapped ? null : (rows.length - breachedCount) / rows.length,
    dueDateBreaches: rows.filter((r) => r.dueDate.breached).length,
    projectIssueCount,
    // An issue whose aggregate rows were cut reads as zero consumed time —
    // i.e. compliant — so a truncated aggregate read has to surface as a cap
    // just as a truncated issue page does. Separately, though: only the
    // first of the two has a denominator the banner can name.
    capped: projectIssueCount > metas.length || aggregatesCapped,
    aggregatesCapped,
  };
}

// --------------------------------------------------------------- history ---

export interface HistoryReportRequest {
  readonly projectId: string;
  readonly from?: Millis;
  readonly to?: Millis;
  readonly fields?: readonly string[];
  readonly authorAccountIds?: readonly string[];
  readonly limit?: number;
  readonly offset?: number;
}

export interface HistoryReport {
  readonly records: readonly HistoryRecord[];
  readonly byField: readonly FieldChangeSummary[];
  /** Changes on this page. */
  readonly total: number;
  /** Matching changes in the store, from a real count, not a page length. */
  readonly totalMatching: number;
  /** True when more changes match than this page shows. */
  readonly capped: boolean;
}

export async function buildHistoryReport(
  store: MetricsStore,
  request: HistoryReportRequest,
): Promise<HistoryReport> {
  const historyQuery = {
    projectId: request.projectId,
    ...(request.from === undefined ? {} : { from: request.from }),
    ...(request.to === undefined ? {} : { to: request.to }),
    ...(request.fields === undefined ? {} : { fields: request.fields }),
    ...(request.authorAccountIds === undefined
      ? {}
      : { authorAccountIds: request.authorAccountIds }),
  };
  const offset = request.offset ?? 0;
  const records = await store.queryHistory({
    ...historyQuery,
    limit: request.limit ?? 500,
    offset,
  });
  const totalMatching = await store.countHistory(historyQuery);
  return {
    records,
    byField: summariseByField(records),
    total: records.length,
    totalMatching,
    capped: totalMatching > offset + records.length,
  };
}

// ------------------------------------------------- listing 3: flow ---

export interface FlowBand {
  readonly statusId: StatusId;
  readonly name: string;
  readonly category: StatusCategory;
}

export interface FlowPoint {
  /** Midnight UTC of the day this point describes. */
  readonly at: Millis;
  readonly statusId: StatusId;
  readonly count: number;
}

export interface FlowReport {
  readonly bands: readonly FlowBand[];
  readonly points: readonly FlowPoint[];
  readonly from: Millis;
  readonly to: Millis;
  /** Distinct issues appearing anywhere in the window, counted from the visits read. */
  readonly issueCount: number;
  /**
   * True when the visit query hit its own row cap, so some visits in the
   * window were not read and every band is a lower bound.
   */
  readonly capped: boolean;
  /**
   * The row ceiling that `capped` reports hitting — visit rows, not issues.
   *
   * The UI printed "This report reached the maximum number of rows it will
   * read in one pass" with no number, having only `issueCount` to hand: a
   * *derived* distinct-issue count. On JFMB that produced a title saying 102
   * issues above a body about rows, where the ceiling that actually fired was
   * 500 rows of `issue_status_visit`. A banner that cannot name the ceiling
   * either stays vague or invents a figure, so the report that applied the
   * limit reports it.
   */
  readonly readRowLimit: number;
  /**
   * True when nothing has stored visits for this project.
   *
   * Distinct from "no work happened": one means the listing has not indexed
   * with `datasets.statusVisits` yet, the other is a real and readable
   * answer. The UI renders different things for each, because telling a user
   * their team did nothing for 30 days when the truth is "not indexed" is the
   * failure this product is built to avoid.
   */
  readonly unavailable: boolean;
  /** Issues stored for this project, from a real count — the denominator. */
  readonly projectIssueCount: number;
  /**
   * ★ True when the chart is drawn from fewer issues than the project holds.
   *
   * `unavailable` above is all-or-nothing, and that was not enough. Opening
   * the deployed app showed why: on JFM the chart topped out at 1 where the
   * project's answer is 6, because `issue_status_visit` held rows for one
   * issue in ten — the visits table shipped after that project was indexed,
   * and only one issue has had a status change since. One issue's rows make
   * `unavailable` false, so a chart describing a tenth of the project
   * rendered with the confidence of a complete one.
   *
   * Between "no visits at all" and "every issue has visits" there is a whole
   * range where the shape on screen is an artefact of what has been indexed,
   * and the reader has to be told. Recovery is **Extend history**, which
   * replays every issue and writes the missing rows.
   *
   * ★ Why `issueCount` is a fair proxy for "issues this chart could see".
   * Every issue's final visit is open-ended (`reconstruct` leaves the last
   * interval's end `null`), and the query selects by overlap, so an issue
   * with visit rows at all overlaps every window — including one that has not
   * moved in years. An issue the window does not see is therefore an issue
   * with no stored visits, not an issue that stood still. That is what makes
   * this answerable without a second count over `issue_status_visit`, which
   * on a metered database would be a real bill at scale.
   */
  readonly partial: boolean;
}

/** Midnight UTC on or before `ms`. */
function startOfDayUtc(ms: Millis): Millis {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/**
 * Cumulative flow — how many issues sat in each status at the end of each day.
 *
 * ROADMAP stage 5: "the most-requested shape in this niche". It is the one
 * report in the product that cannot be answered from `issue_status_agg`,
 * because that table collapses every visit to a status into one row and so
 * has no way to say where an issue was on a Tuesday three weeks ago. It reads
 * `issue_status_visit` instead — see `StatusVisitRow`.
 *
 * ## The rule, stated once
 *
 * An issue counts in status S on day D when a visit to S covers **the end of
 * day D**: `enteredAt <= dayEnd` and (`exitedAt` is null or `exitedAt >
 * dayEnd`). One instant per day, so an issue that passed through four
 * statuses in one afternoon contributes to exactly one band that day — the
 * one it finished in. A "touched this status today" rule would make the
 * bands sum to more than the issue count, and a cumulative flow diagram
 * whose total is not the work in flight is not one.
 *
 * Days are UTC, matching `formatDate`/`formatDateTime` and for the same
 * reason: the alternative is a chart whose buckets depend on the reader's
 * timezone while the caption does not say so.
 */
export async function buildFlowReport(
  store: MetricsStore,
  projectId: string,
  now: Millis,
  options: { days?: number; limit?: number } = {},
): Promise<FlowReport> {
  const days = Math.max(1, Math.min(180, Math.trunc(options.days ?? 30)));
  // ★ Below the store's ceiling, and read one row past it.
  //
  // This defaulted to 20,000 — twice `STORE_MAX_ROWS` — so the store clamped
  // the read to 10,000 and `visits.length >= 20_000` could never be true: a
  // window holding 12,000 visits lost 2,000 of them and reported `capped:
  // false`. The same defect that made `AGGREGATE_ROW_CAP` unable to fire,
  // armed here for whoever raised the 500 that `runtime.flowReport` passes
  // today and currently hides it.
  //
  // And `>=` rather than `>` called an exactly-full read truncated, which is
  // the mirror-image false positive this cycle has now fixed three times.
  // Over-reading by one row answers both at once.
  const visitLimit = Math.min(options.limit ?? AGGREGATE_ROW_CAP, AGGREGATE_ROW_CAP);
  // `to` is the end of today; `from` is midnight `days - 1` days earlier, so
  // a 30-day window has 30 points and the last one is today.
  const lastDay = startOfDayUtc(now);
  const from = lastDay - (days - 1) * DAY_MS;
  const to = lastDay + DAY_MS;

  // The denominator for `partial`. One COUNT per render, the same one
  // `buildAgingReport` already pays on this page — and the alternative is a
  // chart that cannot tell "not indexed yet" from "did not move".
  const projectIssueCount = await store.countIssueMeta({ projectId });

  // ★ The visits are selected by the **window**, not by an issue page.
  //
  // This used to fetch `queryIssueMeta({ projectId, limit })` first and pass
  // those ids down — and `issue_meta` is ordered `created_at ASC`, so on a
  // project with more than one page of issues that selected the *oldest*
  // ones: exactly the issues least likely to have moved in the last thirty
  // days. A three-year-old project would have rendered `unavailable` — the
  // chart withheld entirely — because its 500 oldest issues were all long
  // closed. The window is the question this report asks, so the window is
  // what selects the rows.
  const read = await store.queryStatusVisits({ projectId, from, to, limit: visitLimit + 1 });
  const visitsCapped = read.length > visitLimit;
  const visits = visitsCapped ? read.slice(0, visitLimit) : read;

  const statusMeta = await store.getStatusMeta();
  const byId = new Map(statusMeta.map((s) => [s.statusId, s]));

  const counts = new Map<string, number>();
  const usedStatuses = new Set<StatusId>();
  const issues = new Set<string>();
  for (const visit of visits) issues.add(visit.issueId);
  for (let day = 0; day < days; day += 1) {
    // The last instant of the day, so an issue that entered a status at
    // 09:00 and left at 17:00 counts on that day only if it was still there
    // at midnight — the same instant for every band, which is what keeps the
    // bands summing to the work in flight.
    const dayEnd = from + (day + 1) * DAY_MS - 1;
    for (const visit of visits) {
      if (visit.enteredAt > dayEnd) continue;
      if (visit.exitedAt !== null && visit.exitedAt <= dayEnd) continue;
      usedStatuses.add(visit.statusId);
      const key = `${String(day)}:${visit.statusId}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const bands = [...usedStatuses]
    .map((statusId) => ({
      statusId,
      name: byId.get(statusId)?.name ?? statusId,
      category: byId.get(statusId)?.category ?? 'unknown',
    }))
    .sort((a, b) => {
      const rank: Record<string, number> = { todo: 0, inprogress: 1, done: 2, unknown: 3 };
      return (rank[a.category] ?? 3) - (rank[b.category] ?? 3) || a.name.localeCompare(b.name);
    });

  const points: FlowPoint[] = [];
  for (let day = 0; day < days; day += 1) {
    for (const band of bands) {
      points.push({
        at: from + day * DAY_MS,
        statusId: band.statusId,
        // Every band gets a point on every day, zero included: a line chart
        // that simply omits the days a band was empty draws a straight line
        // across the gap, which reads as "steady" where the truth is "none".
        count: counts.get(`${String(day)}:${band.statusId}`) ?? 0,
      });
    }
  }

  return {
    bands,
    points,
    from,
    to,
    issueCount: issues.size,
    projectIssueCount,
    // ★ Only claimable when the read was NOT cut.
    //
    // `partial` carries a specific accusation — those issues have no stored
    // visits — and a truncated read cannot support it: the missing issues may
    // simply be the ones beyond the row ceiling. Read live on JFMB, where the
    // banner said "The other 798 have no status history stored yet" about a
    // 900-issue project whose visits were cut at 500 rows. `capped` is the
    // honest statement in that case and the banner already makes it.
    partial: !visitsCapped && issues.size < projectIssueCount,
    // The query stopped at its own cap, so there are visits in this window
    // it did not read and every band below is a lower bound.
    capped: visitsCapped,
    // The clamped limit, not `options.limit`: the caller's number may be
    // above `AGGREGATE_ROW_CAP`, and the ceiling the page names has to be the
    // one that was actually applied.
    readRowLimit: visitLimit,
    unavailable: visits.length === 0,
  };
}
