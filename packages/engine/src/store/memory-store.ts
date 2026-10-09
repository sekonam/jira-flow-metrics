import { ESTIMATED_ROW_BYTES } from './schema.js';
import type {
  HistoryQuery,
  IndexStateRow,
  IssueMetaQuery,
  IssueMetaRow,
  MetricsStore,
  StatusAggregateRow,
  StatusDurationQuery,
  StatusMetaRow,
  StatusNameHistoryRow,
  StatusVisitQuery,
  StatusVisitRow,
  WorklogQuery,
} from './types.js';
import type { HistoryRecord } from '../metrics/history.js';
import type { WorklogRecord } from '../metrics/worklog.js';
import type { StatusId } from '../types.js';

/**
 * In-memory `MetricsStore`.
 *
 * This is the **reference implementation of the store's semantics**, not merely
 * a test stub: the Forge SQL adapter is expected to match its observable
 * behaviour row for row, and the store contract suite in
 * `test/store-contract.test.ts` runs against both. Anything ambiguous in the
 * SQL is resolved by reading this file.
 */
export class MemoryStore implements MetricsStore {
  private readonly issueMeta = new Map<string, IssueMetaRow>();
  private readonly aggregates = new Map<string, StatusAggregateRow[]>();
  private readonly visits = new Map<string, StatusVisitRow[]>();
  private readonly statusMeta = new Map<StatusId, StatusMetaRow>();
  private readonly statusNames = new Map<string, StatusNameHistoryRow>();
  private readonly worklogs = new Map<string, WorklogRecord[]>();
  private readonly history = new Map<string, HistoryRecord[]>();
  private readonly indexStates = new Map<string, IndexStateRow>();

  migrate(): Promise<void> {
    return Promise.resolve();
  }

  putIssueAggregate(meta: IssueMetaRow, rows: readonly StatusAggregateRow[]): Promise<void> {
    return this.putIssueAggregates([{ meta, rows }]);
  }

  putIssueAggregates(
    batch: readonly { meta: IssueMetaRow; rows: readonly StatusAggregateRow[] }[],
  ): Promise<void> {
    for (const { meta, rows } of batch) {
      this.issueMeta.set(meta.issueId, meta);
      // Replace, never merge — see the note on the port.
      this.aggregates.set(meta.issueId, [...rows]);
    }
    return Promise.resolve();
  }

  deleteIssue(issueId: string): Promise<void> {
    this.issueMeta.delete(issueId);
    this.aggregates.delete(issueId);
    this.visits.delete(issueId);
    this.worklogs.delete(issueId);
    this.history.delete(issueId);
    return Promise.resolve();
  }

  getIssueMeta(issueId: string): Promise<IssueMetaRow | null> {
    return Promise.resolve(this.issueMeta.get(issueId) ?? null);
  }

  queryIssueMeta(query: IssueMetaQuery): Promise<IssueMetaRow[]> {
    const rows = this.matchingIssueMeta(query).sort(
      (a, b) => a.createdAt - b.createdAt || a.issueId.localeCompare(b.issueId),
    );
    const offset = query.offset ?? 0;
    return Promise.resolve(rows.slice(offset, offset + (query.limit ?? rows.length)));
  }

  countIssueMeta(query: IssueMetaQuery): Promise<number> {
    return Promise.resolve(this.matchingIssueMeta(query).length);
  }

  /**
   * The filter half of `queryIssueMeta`, shared with `countIssueMeta` so the
   * two cannot disagree about which rows match — the same reason the SQL
   * adapter factors its WHERE clauses into `issueMetaClauses`.
   */
  private matchingIssueMeta(query: IssueMetaQuery): IssueMetaRow[] {
    return [...this.issueMeta.values()].filter((meta) => {
      if (meta.projectId !== query.projectId) return false;
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
    });
  }

  listProjectStatusIds(projectId: string): Promise<StatusId[]> {
    const ids = new Set<StatusId>();
    for (const [issueId, rows] of this.aggregates) {
      if (this.issueMeta.get(issueId)?.projectId !== projectId) continue;
      for (const row of rows) ids.add(row.statusId);
    }
    return Promise.resolve([...ids].sort((a, b) => a.localeCompare(b)));
  }

  queryStatusDurations(query: StatusDurationQuery): Promise<StatusAggregateRow[]> {
    const issueFilter = query.issueIds === undefined ? null : new Set(query.issueIds);
    const statusFilter = query.statusIds === undefined ? null : new Set(query.statusIds);
    const rows: StatusAggregateRow[] = [];
    for (const [issueId, aggregates] of this.aggregates) {
      const meta = this.issueMeta.get(issueId);
      if (meta === undefined || meta.projectId !== query.projectId) continue;
      if (issueFilter !== null && !issueFilter.has(issueId)) continue;
      for (const row of aggregates) {
        if (statusFilter !== null && !statusFilter.has(row.statusId)) continue;
        rows.push(row);
      }
    }
    rows.sort((a, b) => a.issueId.localeCompare(b.issueId) || a.statusId.localeCompare(b.statusId));
    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    return Promise.resolve(rows.slice(offset, offset + limit));
  }

  putIssueVisits(issueId: string, visits: readonly StatusVisitRow[]): Promise<void> {
    // Replace, never merge — the same rule as every other write here, and
    // what keeps a re-ingested issue from accumulating duplicate visits.
    this.visits.set(issueId, [...visits]);
    return Promise.resolve();
  }

  queryStatusVisits(query: StatusVisitQuery): Promise<StatusVisitRow[]> {
    // ★ An empty list matches **nothing**; only an absent one is "no filter".
    //
    // The same rule `StatusAggregateQuery` states and `sql-store` implements
    // (`IN (NULL)`): the caller is handing over the page of issue ids it
    // already holds, and an empty page means there is nothing to fetch —
    // returning the whole project for it is the worst available reading.
    //
    // This store is documented as the reference semantics, so a divergence
    // here is a divergence in the contract itself. It had one: the comment
    // that used to sit here claimed the opposite of what it did, on the one
    // query where the SQL adapter and the reference store disagreed.
    const issueFilter = query.issueIds === undefined ? null : new Set(query.issueIds);
    const rows: StatusVisitRow[] = [];
    for (const [issueId, visits] of this.visits) {
      const meta = this.issueMeta.get(issueId);
      if (meta === undefined || meta.projectId !== query.projectId) continue;
      if (issueFilter !== null && !issueFilter.has(issueId)) continue;
      for (const visit of visits) {
        // Overlap, not containment: a visit that began before the window and
        // is still running is exactly the row a flow diagram needs most.
        if (query.to !== undefined && visit.enteredAt >= query.to) continue;
        if (query.from !== undefined && visit.exitedAt !== null && visit.exitedAt <= query.from) {
          continue;
        }
        rows.push(visit);
      }
    }
    rows.sort((a, b) => a.issueId.localeCompare(b.issueId) || a.seq - b.seq);
    const offset = query.offset ?? 0;
    return Promise.resolve(rows.slice(offset, offset + (query.limit ?? rows.length)));
  }

  upsertStatusMeta(rows: readonly StatusMetaRow[]): Promise<void> {
    for (const row of rows) {
      const existing = this.statusMeta.get(row.statusId);
      this.statusMeta.set(row.statusId, {
        ...row,
        firstSeenAt: Math.min(existing?.firstSeenAt ?? row.firstSeenAt, row.firstSeenAt),
        lastSeenAt: Math.max(existing?.lastSeenAt ?? row.lastSeenAt, row.lastSeenAt),
      });
    }
    return Promise.resolve();
  }

  getStatusMeta(): Promise<StatusMetaRow[]> {
    return Promise.resolve(
      [...this.statusMeta.values()].sort((a, b) => a.statusId.localeCompare(b.statusId)),
    );
  }

  recordStatusNames(rows: readonly StatusNameHistoryRow[]): Promise<void> {
    for (const row of rows) {
      // `\u0000` as an escape, never a literal NUL byte in the source: a raw
      // one makes git classify this file as binary, so every change to it
      // lands in history as "Bin 9082 -> 9448 bytes" with no reviewable diff.
      // The runtime value is identical; only the encoding of the source changes.
      const key = `${row.statusId}\u0000${row.name}`;
      const existing = this.statusNames.get(key);
      this.statusNames.set(key, {
        ...row,
        firstSeenAt: Math.min(existing?.firstSeenAt ?? row.firstSeenAt, row.firstSeenAt),
        lastSeenAt: Math.max(existing?.lastSeenAt ?? row.lastSeenAt, row.lastSeenAt),
      });
    }
    return Promise.resolve();
  }

  getStatusNameHistory(statusId: StatusId): Promise<StatusNameHistoryRow[]> {
    return Promise.resolve(
      [...this.statusNames.values()]
        .filter((r) => r.statusId === statusId)
        .sort((a, b) => a.firstSeenAt - b.firstSeenAt || a.name.localeCompare(b.name)),
    );
  }

  putWorklogs(issueId: string, records: readonly WorklogRecord[]): Promise<void> {
    this.worklogs.set(issueId, [...records]);
    return Promise.resolve();
  }

  queryWorklogs(query: WorklogQuery): Promise<WorklogRecord[]> {
    const rows = this.matchingWorklogs(query).sort(
      (a, b) => a.startedAt - b.startedAt || a.worklogId.localeCompare(b.worklogId),
    );
    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    return Promise.resolve(rows.slice(offset, offset + limit));
  }

  countWorklogs(query: WorklogQuery): Promise<number> {
    return Promise.resolve(this.matchingWorklogs(query).length);
  }

  private matchingWorklogs(query: WorklogQuery): WorklogRecord[] {
    const authors = query.authorAccountIds === undefined ? null : new Set(query.authorAccountIds);
    return [...this.worklogs.values()]
      .flat()
      .filter((w) => w.projectId === query.projectId)
      .filter((w) => query.from === undefined || w.startedAt >= query.from)
      .filter((w) => query.to === undefined || w.startedAt < query.to)
      .filter((w) => authors === null || authors.has(w.authorAccountId));
  }

  putHistory(issueId: string, records: readonly HistoryRecord[]): Promise<void> {
    this.history.set(issueId, [...records]);
    return Promise.resolve();
  }

  queryHistory(query: HistoryQuery): Promise<HistoryRecord[]> {
    // Newest first, matching `SqlMetricsStore` — the ordering decides which
    // changes survive a capped read. See that store's `queryHistory`.
    const rows = this.matchingHistory(query).sort(
      (a, b) => b.at - a.at || b.changeId.localeCompare(a.changeId),
    );
    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    return Promise.resolve(rows.slice(offset, offset + limit));
  }

  countHistory(query: HistoryQuery): Promise<number> {
    return Promise.resolve(this.matchingHistory(query).length);
  }

  private matchingHistory(query: HistoryQuery): HistoryRecord[] {
    const fields =
      query.fields === undefined ? null : new Set(query.fields.map((f) => f.toLowerCase()));
    const authors = query.authorAccountIds === undefined ? null : new Set(query.authorAccountIds);
    return [...this.history.values()]
      .flat()
      .filter((h) => h.projectId === query.projectId)
      .filter((h) => query.from === undefined || h.at >= query.from)
      .filter((h) => query.to === undefined || h.at < query.to)
      .filter((h) => fields === null || fields.has(h.field))
      .filter(
        (h) => authors === null || (h.authorAccountId !== null && authors.has(h.authorAccountId)),
      );
  }

  getIndexState(projectId: string): Promise<IndexStateRow | null> {
    return Promise.resolve(this.indexStates.get(projectId) ?? null);
  }

  putIndexState(row: IndexStateRow): Promise<void> {
    this.indexStates.set(row.projectId, row);
    return Promise.resolve();
  }

  listIndexStates(): Promise<IndexStateRow[]> {
    return Promise.resolve(
      [...this.indexStates.values()].sort((a, b) => a.projectId.localeCompare(b.projectId)),
    );
  }

  estimateBytes(): Promise<number> {
    const aggregateRows = [...this.aggregates.values()].reduce((n, rows) => n + rows.length, 0);
    const worklogRows = [...this.worklogs.values()].reduce((n, rows) => n + rows.length, 0);
    const historyRows = [...this.history.values()].reduce((n, rows) => n + rows.length, 0);
    const visitRows = [...this.visits.values()].reduce((n, rows) => n + rows.length, 0);
    return Promise.resolve(
      this.issueMeta.size * ESTIMATED_ROW_BYTES.issue_meta +
        aggregateRows * ESTIMATED_ROW_BYTES.issue_status_agg +
        visitRows * ESTIMATED_ROW_BYTES.issue_status_visit +
        worklogRows * ESTIMATED_ROW_BYTES.worklog +
        historyRows * ESTIMATED_ROW_BYTES.issue_history +
        this.statusMeta.size * ESTIMATED_ROW_BYTES.status_meta +
        this.statusNames.size * ESTIMATED_ROW_BYTES.status_name_history +
        this.indexStates.size * ESTIMATED_ROW_BYTES.index_state,
    );
  }

  countRows(): Promise<Readonly<Record<string, number>>> {
    const sum = (map: ReadonlyMap<string, readonly unknown[]>): number =>
      [...map.values()].reduce((n, rows) => n + rows.length, 0);
    return Promise.resolve({
      issue_meta: this.issueMeta.size,
      issue_status_agg: sum(this.aggregates),
      issue_status_visit: sum(this.visits),
      worklog: sum(this.worklogs),
      issue_history: sum(this.history),
      status_meta: this.statusMeta.size,
      status_name_history: this.statusNames.size,
      index_state: this.indexStates.size,
      app_settings: 0,
    });
  }

  /** Test helper: total aggregate rows held. Not part of the port. */
  get aggregateRowCount(): number {
    return [...this.aggregates.values()].reduce((n, rows) => n + rows.length, 0);
  }
}
