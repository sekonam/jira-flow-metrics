import type {
  IssueMetaRow,
  MetricsStore,
  StatusAggregateRow,
  StatusMetaRow,
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
  /** Per-status distribution across the whole result set. */
  readonly summaryByStatus: Readonly<Record<StatusId, DistributionSummary>>;
  readonly issueCount: number;
  /** True when any row's history was incomplete. Surfaced in the UI, not hidden. */
  readonly anyTruncated: boolean;
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

  // Over-fetch metadata, then filter in memory. Store-side filtering is a
  // planned optimisation (see docs/TECHNICAL-SPEC.md "known limitations");
  // at the page sizes the UI uses this is not the bottleneck.
  const metas = await store.queryIssueMeta(query.projectId, query.limit + query.offset, 0);
  const filtered = metas.filter((m) => matchesFilters(m, query));
  const page = filtered.slice(query.offset, query.offset + query.limit);

  const aggregates = await store.queryStatusDurations({
    projectId: query.projectId,
    issueIds: page.map((m) => m.issueId),
    ...(query.statusIds === undefined ? {} : { statusIds: query.statusIds }),
  });

  const byIssue = new Map<string, StatusAggregateRow[]>();
  for (const row of aggregates) {
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
    issueCount: filtered.length,
    anyTruncated: rows.some((r) => r.truncated),
  };
}

function matchesFilters(meta: IssueMetaRow, query: StatusReportQuery): boolean {
  if (query.assigneeAccountIds !== undefined && query.assigneeAccountIds.length > 0) {
    if (meta.assigneeAccountId === null) return false;
    if (!query.assigneeAccountIds.includes(meta.assigneeAccountId)) return false;
  }
  if (query.issueTypeIds !== undefined && query.issueTypeIds.length > 0) {
    if (meta.issueTypeId === null) return false;
    if (!query.issueTypeIds.includes(meta.issueTypeId)) return false;
  }
  if (query.createdFrom !== undefined && meta.createdAt < query.createdFrom) return false;
  if (query.createdTo !== undefined && meta.createdAt >= query.createdTo) return false;
  return true;
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
