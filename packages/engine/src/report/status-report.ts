import {
  AGGREGATE_ROW_CAP,
  type MetricsStore,
  type StatusAggregateRow,
  type StatusMetaRow,
} from '../store/types.js';
import { summariseDurations, type DistributionSummary } from '../metrics/cycle-time.js';
import type { DurationBasis, Millis, StatusId } from '../types.js';

/**
 * Report assembly — turning stored aggregate rows into what the UI renders.
 *
 * All of this runs against the store, never against Jira. That is deliberate:
 * report rendering must not be on the critical path of an API call, both
 * because Jira rate limits and because a report that re-fetches on every render
 * is the fastest way to make Forge consumption costs scale with usage instead
 * of with installs.
 */

export interface StatusReportRow {
  readonly issueId: string;
  readonly issueKey: string;
  readonly currentStatusId: StatusId | null;
  readonly createdAt: Millis;
  readonly resolvedAt: Millis | null;
  readonly assigneeAccountId: string | null;
  readonly issueTypeId: string | null;
  readonly truncated: boolean;
  /** Duration per status id, in the requested basis. Missing status = zero. */
  readonly byStatus: Readonly<Record<StatusId, number>>;
  /** Visit counts per status id. This is the column Jira's Control Chart lacks. */
  readonly entriesByStatus: Readonly<Record<StatusId, number>>;
  readonly totalMs: number;
}

export interface StatusReport {
  readonly columns: readonly { statusId: StatusId; name: string }[];
  readonly rows: readonly StatusReportRow[];
  readonly basis: DurationBasis;
  /**
   * Per-status distribution across **this page**, not the whole match.
   *
   * It used to say "the whole result set", which it never was: the
   * percentiles are computed from `rows`, while `matchingIssueCount` is a
   * real `COUNT(*)`. On a capped report that means "median 2h" can describe
   * the 3 issues shown rather than the 10 that matched — so the page must
   * render `capped` beside it, which it does, and this comment must not
   * claim otherwise.
   *
   * Computing it over the full match would mean fetching every matching
   * issue's aggregates on every render, which is the cost the page size
   * exists to bound.
   */
  readonly summaryByStatus: Readonly<Record<StatusId, DistributionSummary>>;
  /** Issues on this page. */
  readonly issueCount: number;
  /** True when any row's history was incomplete. Surfaced in the UI, not hidden. */
  readonly anyTruncated: boolean;
  /**
   * Issues matching this report's filters, from a real `COUNT(*)`, not a page
   * length.
   *
   * Named for what it counts. It used to be `projectIssueCount` and used to
   * count the project, which was the same number only while the report had no
   * filters — with one applied, the cap banner read "500 of 1,234 issues"
   * where the 500 was filtered and the 1,234 was not, and the two halves of
   * that sentence described different sets.
   */
  readonly matchingIssueCount: number;
  /**
   * True when more issues match than this page could hold, so `issueCount` is
   * a lower bound and rows may be missing. The UI must say so —
   * a capped page that looks complete is the silent-ceiling failure documented
   * in `docs/TECHNICAL-SPEC.md` § 11.1.
   */
  readonly capped: boolean;
  /**
   * True when the *aggregate* read hit its row ceiling, so some issues on
   * this page are measured over only part of their statuses.
   *
   * ★ A separate truncation from `capped`, and the more dangerous one.
   *
   * `capped` compares a `COUNT(*)` against the issue page: it says "there
   * are more issues than these". This one says "the issues shown may be
   * understated" — an issue whose aggregate rows were cut renders `0h` in
   * every column and `0` as its total, which is a *wrong number*, not a
   * missing one, and it sorts to the bottom of a table ordered by time.
   *
   * The store clamps any read to 10,000 rows and drops the tail by
   * `ORDER BY issue_id`, so a 500-issue page on a workflow with 21 or more
   * statuses per issue crosses it — an ordinary enterprise workflow, on this
   * report's default page size. It had no flag at all: the same silent
   * ceiling `AGGREGATE_ROW_CAP` was added to close in `reports.ts` for the
   * four derived listings, left open on the flagship one.
   */
  readonly aggregatesCapped: boolean;
}

export interface StatusReportQuery {
  readonly projectId: string;
  readonly basis: DurationBasis;
  readonly limit: number;
  readonly offset: number;
  readonly statusIds?: readonly StatusId[];
  readonly assigneeAccountIds?: readonly string[];
  readonly issueTypeIds?: readonly string[];
  readonly createdFrom?: Millis;
  readonly createdTo?: Millis;
}

export async function buildStatusReport(
  store: MetricsStore,
  query: StatusReportQuery,
): Promise<StatusReport> {
  const statusMeta = await store.getStatusMeta();
  const nameOf = new Map(statusMeta.map((s) => [s.statusId, s.name]));

  // Filters are evaluated by the store, not here. This used to over-fetch
  // `limit + offset` rows, filter them in memory and then slice — which is
  // wrong three ways the moment a filter is set and the project is bigger
  // than one page: the fetch window is chosen before the filter is applied,
  // so the page can come back short or skip matching rows entirely;
  // `issueCount` counts only the matches inside that window; and `capped`
  // compares a filtered page against the unfiltered project total, so every
  // filtered report claims to be capped. See `IssueMetaQuery`.
  const metaQuery = {
    projectId: query.projectId,
    ...(query.assigneeAccountIds === undefined
      ? {}
      : { assigneeAccountIds: query.assigneeAccountIds }),
    ...(query.issueTypeIds === undefined ? {} : { issueTypeIds: query.issueTypeIds }),
    ...(query.createdFrom === undefined ? {} : { createdFrom: query.createdFrom }),
    ...(query.createdTo === undefined ? {} : { createdTo: query.createdTo }),
  };
  const page = await store.queryIssueMeta({
    ...metaQuery,
    limit: query.limit,
    offset: query.offset,
  });
  const matchingIssueCount = await store.countIssueMeta(metaQuery);

  // ★ An explicit ceiling, read one row past it.
  //
  // This used to pass no `limit` at all, which does not mean "no limit": the
  // SQL adapter clamps an unspecified read to 10,000 and returns the first
  // 10,000 by `issue_id`, so the tail issues of a large page lost every
  // aggregate row and rendered as zero. Asking for `cap + 1` is what makes
  // the truncation detectable — and the cap has to sit *below* the store's
  // ceiling, or the extra row is clamped away and the check can never fire.
  const aggregates = await store.queryStatusDurations({
    projectId: query.projectId,
    issueIds: page.map((m) => m.issueId),
    ...(query.statusIds === undefined ? {} : { statusIds: query.statusIds }),
    limit: AGGREGATE_ROW_CAP + 1,
  });
  const aggregatesCapped = aggregates.length > AGGREGATE_ROW_CAP;

  const byIssue = new Map<string, StatusAggregateRow[]>();
  for (const row of aggregatesCapped ? aggregates.slice(0, AGGREGATE_ROW_CAP) : aggregates) {
    const list = byIssue.get(row.issueId) ?? [];
    list.push(row);
    byIssue.set(row.issueId, list);
  }

  const usedStatuses = new Set<StatusId>();
  const rows: StatusReportRow[] = page.map((meta) => {
    const byStatus: Record<StatusId, number> = {};
    const entriesByStatus: Record<StatusId, number> = {};
    let total = 0;
    for (const row of byIssue.get(meta.issueId) ?? []) {
      const value = query.basis === 'business' ? row.businessMs : row.elapsedMs;
      byStatus[row.statusId] = value;
      entriesByStatus[row.statusId] = row.entries;
      total += value;
      usedStatuses.add(row.statusId);
    }
    return {
      issueId: meta.issueId,
      issueKey: meta.issueKey,
      currentStatusId: meta.currentStatusId,
      createdAt: meta.createdAt,
      resolvedAt: meta.resolvedAt,
      assigneeAccountId: meta.assigneeAccountId,
      issueTypeId: meta.issueTypeId,
      truncated: meta.truncated,
      byStatus,
      entriesByStatus,
      totalMs: total,
    };
  });

  const columns = orderColumns(usedStatuses, statusMeta, nameOf);
  const summaryByStatus: Record<StatusId, DistributionSummary> = {};
  for (const column of columns) {
    summaryByStatus[column.statusId] = summariseDurations(
      rows.map((r) => r.byStatus[column.statusId] ?? null),
    );
  }

  return {
    columns,
    rows,
    basis: query.basis,
    summaryByStatus,
    issueCount: rows.length,
    anyTruncated: rows.some((r) => r.truncated),
    matchingIssueCount,
    capped: matchingIssueCount > query.offset + rows.length,
    aggregatesCapped,
  };
}

/**
 * Columns follow workflow order where we know it — `todo`, then `inprogress`,
 * then `done` — and fall back to alphabetical inside each group. Jira does not
 * expose a global status ordering, so this is the best available proxy and it
 * matches what a board looks like left to right.
 */
function orderColumns(
  used: ReadonlySet<StatusId>,
  statusMeta: readonly StatusMetaRow[],
  nameOf: ReadonlyMap<StatusId, string>,
): { statusId: StatusId; name: string }[] {
  const rank: Record<string, number> = { todo: 0, inprogress: 1, done: 2, unknown: 3 };
  const categoryOf = new Map(statusMeta.map((s) => [s.statusId, s.category]));
  return [...used]
    .map((statusId) => ({ statusId, name: nameOf.get(statusId) ?? statusId }))
    .sort((a, b) => {
      const ra = rank[categoryOf.get(a.statusId) ?? 'unknown'] ?? 3;
      const rb = rank[categoryOf.get(b.statusId) ?? 'unknown'] ?? 3;
      return ra - rb || a.name.localeCompare(b.name);
    });
}
