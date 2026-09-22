import {
  CREATE_STATEMENTS,
  MIGRATIONS,
  DELETE_ISSUE_STATEMENTS,
  ESTIMATED_ROW_BYTES,
  type HistoryQuery,
  type HistoryRecord,
  type IndexStateRow,
  type IssueMetaQuery,
  type IssueMetaRow,
  type MetricsStore,
  type StatusAggregateRow,
  type StatusDurationQuery,
  type StatusId,
  type StatusMetaRow,
  type StatusNameHistoryRow,
  type StatusVisitQuery,
  type StatusVisitRow,
  type WorklogQuery,
  type WorklogRecord,
} from '@jfm/engine';
import type { SqlExecutor, SqlMigrator } from './executor.js';
import {
  historyFromRow,
  historyToParams,
  indexStateFromRow,
  indexStateToParams,
  issueMetaFromRow,
  issueMetaToParams,
  placeholders,
  statusAggregateFromRow,
  statusAggregateToParams,
  statusMetaFromRow,
  statusVisitFromRow,
  statusVisitToParams,
  statusNameHistoryFromRow,
  toNumber,
  worklogFromRow,
  worklogToParams,
} from './rows.js';

/**
 * `MetricsStore` on Forge SQL.
 *
 * ⚠️ **This adapter has never executed against Forge SQL.** No Atlassian
 * developer account exists in this environment, so it cannot be. What *is*
 * verified is the statement text and parameter binding, which the tests assert
 * exactly, and the row mapping, which is pure. Treat the first `forge tunnel`
 * run as the acceptance test for this file.
 *
 * Design notes that matter for cost, since Forge is consumption-priced:
 *
 * - **Multi-row `INSERT … ON DUPLICATE KEY UPDATE`.** One statement per batch
 *   rather than one per row; a backfill slice of 50 issues is a handful of
 *   statements, not several hundred.
 * - **Delete-then-insert per issue**, so re-processing is idempotent. This is
 *   what lets the backfill be at-least-once and still correct.
 * - **Every query is bound**, never interpolated. The only place a value is
 *   ever put into statement text is the placeholder count.
 */
export class SqlMetricsStore implements MetricsStore {
  /**
   * `migrator` is optional so the in-memory executors the tests drive can keep
   * applying DDL through `execute`, which is exactly what a plain SQL engine
   * wants. On Forge it must be supplied: DDL through the query path is refused
   * there, and the app fails on the first event rather than at startup.
   */
  constructor(
    private readonly sql: SqlExecutor,
    private readonly migrator?: SqlMigrator,
  ) {}

  /**
   * Every resolver method and every issue event calls this unconditionally,
   * and the composition root in each app caches one runtime — and one store
   * — per warm container (see each app's `src/runtime.ts`). Without this flag, a
   * burst of Jira activity re-runs the full migration once per event: Forge
   * SQL's own migration runner records applied migrations by name, so no DDL
   * is repeated, but each call still costs a real platform request, and
   * enough of them in a short window trips `ForgeSQLError: RATE_LIMIT_EXCEEDED`
   * — observed live bulk-seeding 300 issues into one project. Memoised per
   * instance, not globally: a failed attempt must be retried on the next
   * call, not remembered as done.
   */
  private migrated = false;

  async migrate(): Promise<void> {
    if (this.migrated) return;
    if (this.migrator !== undefined) {
      await this.migrator.migrate(MIGRATIONS);
    } else {
      for (const statement of CREATE_STATEMENTS) {
        await this.sql.execute(statement);
      }
    }
    this.migrated = true;
  }

  putIssueAggregate(meta: IssueMetaRow, rows: readonly StatusAggregateRow[]): Promise<void> {
    return this.putIssueAggregates([{ meta, rows }]);
  }

  async putIssueAggregates(
    batch: readonly { meta: IssueMetaRow; rows: readonly StatusAggregateRow[] }[],
  ): Promise<void> {
    if (batch.length === 0) return;

    const metaValues = batch.map(() => `(${placeholders(13)})`).join(', ');
    await this.sql.execute(
      `INSERT INTO issue_meta (
         issue_id, issue_key, project_id, issue_type_id, priority_id,
         assignee_account_id, current_status_id, created_at, resolved_at, due_at,
         history_through_at, truncated, updated_at
       ) VALUES ${metaValues}
       ON DUPLICATE KEY UPDATE
         issue_key = VALUES(issue_key),
         project_id = VALUES(project_id),
         issue_type_id = VALUES(issue_type_id),
         priority_id = VALUES(priority_id),
         assignee_account_id = VALUES(assignee_account_id),
         current_status_id = VALUES(current_status_id),
         created_at = VALUES(created_at),
         resolved_at = VALUES(resolved_at),
         due_at = VALUES(due_at),
         history_through_at = VALUES(history_through_at),
         truncated = VALUES(truncated),
         updated_at = VALUES(updated_at)`,
      batch.flatMap(({ meta }) => issueMetaToParams(meta)),
    );

    // Replace, never merge: an issue's aggregate is always recomputed from its
    // whole changelog, so stale rows for statuses it no longer touches must go.
    const issueIds = batch.map(({ meta }) => meta.issueId);
    await this.sql.execute(
      `DELETE FROM issue_status_agg WHERE issue_id IN (${placeholders(issueIds.length)})`,
      issueIds,
    );

    const aggregateRows = batch.flatMap(({ meta, rows }) =>
      rows.map((row) => statusAggregateToParams(row, meta.projectId)),
    );
    if (aggregateRows.length > 0) {
      const values = aggregateRows.map(() => `(${placeholders(9)})`).join(', ');
      await this.sql.execute(
        `INSERT INTO issue_status_agg (
           issue_id, status_id, project_id, elapsed_ms, business_ms,
           entries, last_entered_at, last_exited_at, updated_at
         ) VALUES ${values}`,
        aggregateRows.flat(),
      );
    }
  }

  async deleteIssue(issueId: string): Promise<void> {
    for (const statement of DELETE_ISSUE_STATEMENTS) {
      await this.sql.execute(statement, [issueId]);
    }
  }

  async getIssueMeta(issueId: string): Promise<IssueMetaRow | null> {
    const rows = await this.sql.query<Record<string, unknown>>(
      'SELECT * FROM issue_meta WHERE issue_id = ?',
      [issueId],
    );
    const row = rows[0];
    return row === undefined ? null : issueMetaFromRow(row);
  }

  async queryIssueMeta(query: IssueMetaQuery): Promise<IssueMetaRow[]> {
    const { clauses, params } = issueMetaClauses(query);
    // LIMIT/OFFSET are inlined, not bound, and that is deliberate: this is the
    // fourth Forge SQL call shape this repository has had to learn is unsafe
    // to assume from the docs rather than confirm live (see `settings.ts` and
    // `executor.ts` for the other three). `clampLimit`/`clampOffset` guarantee
    // a `Math.trunc`ed, range-bound plain integer, so inlining carries no
    // injection risk — the same reasoning `placeholders()` already relies on
    // elsewhere in this file for a parameter *count*.
    const limit = clampLimit(query.limit ?? 500);
    const offset = clampOffset(query.offset ?? 0);
    const rows = await this.sql.query<Record<string, unknown>>(
      `SELECT * FROM issue_meta WHERE ${clauses.join(' AND ')}
       ORDER BY created_at ASC, issue_id ASC LIMIT ${String(limit)} OFFSET ${String(offset)}`,
      params,
    );
    return rows.map(issueMetaFromRow);
  }

  async countIssueMeta(query: IssueMetaQuery): Promise<number> {
    const { clauses, params } = issueMetaClauses(query);
    const rows = await this.sql.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS n FROM issue_meta WHERE ${clauses.join(' AND ')}`,
      params,
    );
    return toNumber(rows[0]?.['n'] ?? 0);
  }

  async listProjectStatusIds(projectId: string): Promise<StatusId[]> {
    const rows = await this.sql.query<Record<string, unknown>>(
      `SELECT DISTINCT status_id FROM issue_status_agg WHERE project_id = ?
       ORDER BY status_id ASC`,
      [projectId],
    );
    return rows
      .map((row) => row['status_id'])
      .filter((id): id is string => typeof id === 'string' && id !== '');
  }

  async queryStatusDurations(query: StatusDurationQuery): Promise<StatusAggregateRow[]> {
    const clauses = ['project_id = ?'];
    const params: unknown[] = [query.projectId];
    if (query.issueIds !== undefined) {
      clauses.push(`issue_id IN (${placeholders(query.issueIds.length)})`);
      params.push(...query.issueIds);
    }
    if (query.statusIds !== undefined) {
      clauses.push(`status_id IN (${placeholders(query.statusIds.length)})`);
      params.push(...query.statusIds);
    }
    const limit = clampLimit(query.limit ?? 10_000);
    const offset = clampOffset(query.offset ?? 0);
    const rows = await this.sql.query<Record<string, unknown>>(
      `SELECT * FROM issue_status_agg WHERE ${clauses.join(' AND ')}
       ORDER BY issue_id ASC, status_id ASC LIMIT ${String(limit)} OFFSET ${String(offset)}`,
      params,
    );
    return rows.map(statusAggregateFromRow);
  }

  async putIssueVisits(issueId: string, visits: readonly StatusVisitRow[]): Promise<void> {
    // Delete-then-insert rather than upsert: a re-ingested issue can have
    // *fewer* visits than before (history edited, an issue moved), and an
    // upsert keyed on (issue_id, seq) would leave the surplus rows behind as
    // phantom visits nothing ever deletes.
    await this.sql.execute('DELETE FROM issue_status_visit WHERE issue_id = ?', [issueId]);
    if (visits.length === 0) return;
    const values = visits.map(() => `(${placeholders(6)})`).join(', ');
    await this.sql.execute(
      `INSERT INTO issue_status_visit (
         issue_id, seq, status_id, project_id, entered_at, exited_at
       ) VALUES ${values}`,
      visits.flatMap(statusVisitToParams),
    );
  }

  async queryStatusVisits(query: StatusVisitQuery): Promise<StatusVisitRow[]> {
    const clauses = ['project_id = ?'];
    const params: unknown[] = [query.projectId];
    if (query.issueIds !== undefined) {
      // No `.length > 0` guard: an empty list must match nothing, and
      // `placeholders(0)` is `NULL`, so `issue_id IN (NULL)` does exactly
      // that. See `StatusVisitQuery.issueIds` — this is a page of ids the
      // caller holds, not a filter a user chose.
      clauses.push(`issue_id IN (${placeholders(query.issueIds.length)})`);
      params.push(...query.issueIds);
    }
    if (query.to !== undefined) {
      clauses.push('entered_at < ?');
      params.push(query.to);
    }
    if (query.from !== undefined) {
      // Overlap, not containment: a visit that began before the window and
      // has not ended is exactly the row a flow diagram needs most, and
      // `exited_at IS NULL` is how that row says so.
      clauses.push('(exited_at IS NULL OR exited_at > ?)');
      params.push(query.from);
    }
    const limit = clampLimit(query.limit ?? 10_000);
    const offset = clampOffset(query.offset ?? 0);
    const rows = await this.sql.query<Record<string, unknown>>(
      `SELECT * FROM issue_status_visit WHERE ${clauses.join(' AND ')}
       ORDER BY issue_id ASC, seq ASC LIMIT ${String(limit)} OFFSET ${String(offset)}`,
      params,
    );
    return rows.map(statusVisitFromRow);
  }

  async upsertStatusMeta(rows: readonly StatusMetaRow[]): Promise<void> {
    if (rows.length === 0) return;
    const values = rows.map(() => `(${placeholders(5)})`).join(', ');
    await this.sql.execute(
      `INSERT INTO status_meta (status_id, name, category, first_seen_at, last_seen_at)
       VALUES ${values}
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         category = VALUES(category),
         first_seen_at = LEAST(first_seen_at, VALUES(first_seen_at)),
         last_seen_at = GREATEST(last_seen_at, VALUES(last_seen_at))`,
      rows.flatMap((r) => [r.statusId, r.name, r.category, r.firstSeenAt, r.lastSeenAt]),
    );
  }

  async getStatusMeta(): Promise<StatusMetaRow[]> {
    const rows = await this.sql.query<Record<string, unknown>>(
      'SELECT * FROM status_meta ORDER BY status_id ASC',
    );
    return rows.map(statusMetaFromRow);
  }

  async recordStatusNames(rows: readonly StatusNameHistoryRow[]): Promise<void> {
    if (rows.length === 0) return;
    const values = rows.map(() => `(${placeholders(4)})`).join(', ');
    await this.sql.execute(
      `INSERT INTO status_name_history (status_id, name, first_seen_at, last_seen_at)
       VALUES ${values}
       ON DUPLICATE KEY UPDATE
         first_seen_at = LEAST(first_seen_at, VALUES(first_seen_at)),
         last_seen_at = GREATEST(last_seen_at, VALUES(last_seen_at))`,
      rows.flatMap((r) => [r.statusId, r.name, r.firstSeenAt, r.lastSeenAt]),
    );
  }

  async getStatusNameHistory(statusId: StatusId): Promise<StatusNameHistoryRow[]> {
    const rows = await this.sql.query<Record<string, unknown>>(
      `SELECT * FROM status_name_history WHERE status_id = ?
       ORDER BY first_seen_at ASC, name ASC`,
      [statusId],
    );
    return rows.map(statusNameHistoryFromRow);
  }

  async putWorklogs(issueId: string, records: readonly WorklogRecord[]): Promise<void> {
    await this.sql.execute('DELETE FROM worklog WHERE issue_id = ?', [issueId]);
    if (records.length === 0) return;
    const values = records.map(() => `(${placeholders(10)})`).join(', ');
    await this.sql.execute(
      `INSERT INTO worklog (
         worklog_id, issue_id, issue_key, project_id, author_account_id,
         author_display_name, started_at, time_spent_ms, created_at, updated_at
       ) VALUES ${values}`,
      records.flatMap(worklogToParams),
    );
  }

  async queryWorklogs(query: WorklogQuery): Promise<WorklogRecord[]> {
    const { clauses, params } = worklogClauses(query);
    const limit = clampLimit(query.limit ?? 10_000);
    const offset = clampOffset(query.offset ?? 0);
    const rows = await this.sql.query<Record<string, unknown>>(
      `SELECT * FROM worklog WHERE ${clauses.join(' AND ')}
       ORDER BY started_at ASC, worklog_id ASC LIMIT ${String(limit)} OFFSET ${String(offset)}`,
      params,
    );
    return rows.map(worklogFromRow);
  }

  async countWorklogs(query: WorklogQuery): Promise<number> {
    const { clauses, params } = worklogClauses(query);
    const rows = await this.sql.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS n FROM worklog WHERE ${clauses.join(' AND ')}`,
      params,
    );
    return toNumber(rows[0]?.['n'] ?? 0);
  }

  async putHistory(issueId: string, records: readonly HistoryRecord[]): Promise<void> {
    await this.sql.execute('DELETE FROM issue_history WHERE issue_id = ?', [issueId]);
    if (records.length === 0) return;
    const values = records.map(() => `(${placeholders(13)})`).join(', ');
    await this.sql.execute(
      `INSERT INTO issue_history (
         change_id, issue_id, issue_key, project_id, changed_at,
         author_account_id, author_display_name, field, field_label,
         from_value, to_value, from_id, to_id
       ) VALUES ${values}`,
      records.flatMap(historyToParams),
    );
  }

  async queryHistory(query: HistoryQuery): Promise<HistoryRecord[]> {
    const { clauses, params } = historyClauses(query);
    const limit = clampLimit(query.limit ?? 10_000);
    const offset = clampOffset(query.offset ?? 0);
    const rows = await this.sql.query<Record<string, unknown>>(
      `SELECT * FROM issue_history WHERE ${clauses.join(' AND ')}
       ORDER BY changed_at ASC, change_id ASC LIMIT ${String(limit)} OFFSET ${String(offset)}`,
      params,
    );
    return rows.map(historyFromRow);
  }

  async countHistory(query: HistoryQuery): Promise<number> {
    const { clauses, params } = historyClauses(query);
    const rows = await this.sql.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS n FROM issue_history WHERE ${clauses.join(' AND ')}`,
      params,
    );
    return toNumber(rows[0]?.['n'] ?? 0);
  }

  async getIndexState(projectId: string): Promise<IndexStateRow | null> {
    const rows = await this.sql.query<Record<string, unknown>>(
      'SELECT * FROM index_state WHERE project_id = ?',
      [projectId],
    );
    const row = rows[0];
    return row === undefined ? null : indexStateFromRow(row);
  }

  async putIndexState(row: IndexStateRow): Promise<void> {
    await this.sql.execute(
      `INSERT INTO index_state (
         project_id, state, backfill_cursor, backfill_from, issues_processed,
         issues_total, last_processed_at, last_error, started_at, updated_at
       ) VALUES (${placeholders(10)})
       ON DUPLICATE KEY UPDATE
         state = VALUES(state),
         backfill_cursor = VALUES(backfill_cursor),
         backfill_from = VALUES(backfill_from),
         issues_processed = VALUES(issues_processed),
         issues_total = VALUES(issues_total),
         last_processed_at = VALUES(last_processed_at),
         last_error = VALUES(last_error),
         started_at = VALUES(started_at),
         updated_at = VALUES(updated_at)`,
      indexStateToParams(row),
    );
  }

  async listIndexStates(): Promise<IndexStateRow[]> {
    const rows = await this.sql.query<Record<string, unknown>>(
      'SELECT * FROM index_state ORDER BY project_id ASC',
    );
    return rows.map(indexStateFromRow);
  }

  /**
   * Approximate stored bytes, from row counts times the per-row estimates in
   * `@jfm/engine`'s schema module. It is an **estimate**, not a measurement of
   * on-disk size, and the UI labels it as one.
   */
  async estimateBytes(): Promise<number> {
    const counts = await this.countRows();
    let total = 0;
    for (const [table, bytes] of Object.entries(ESTIMATED_ROW_BYTES)) {
      total += (counts[table] ?? 0) * bytes;
    }
    return total;
  }

  /**
   * Rows per table, in one statement.
   *
   * One query with nine scalar sub-selects rather than nine queries: Forge
   * SQL meters DML requests per installation, and the admin page that reads
   * this is the sort of screen somebody refreshes.
   */
  async countRows(): Promise<Readonly<Record<string, number>>> {
    const rows = await this.sql.query<Record<string, unknown>>(
      `SELECT
         (SELECT COUNT(*) FROM issue_meta)          AS issue_meta,
         (SELECT COUNT(*) FROM issue_status_agg)    AS issue_status_agg,
         (SELECT COUNT(*) FROM issue_status_visit)  AS issue_status_visit,
         (SELECT COUNT(*) FROM worklog)             AS worklog,
         (SELECT COUNT(*) FROM issue_history)       AS issue_history,
         (SELECT COUNT(*) FROM status_meta)         AS status_meta,
         (SELECT COUNT(*) FROM status_name_history) AS status_name_history,
         (SELECT COUNT(*) FROM index_state)         AS index_state,
         (SELECT COUNT(*) FROM app_settings)        AS app_settings`,
    );
    const counts = rows[0];
    const result: Record<string, number> = {};
    for (const table of Object.keys(ESTIMATED_ROW_BYTES)) {
      result[table] = toNumber(counts?.[table] ?? 0);
    }
    return result;
  }
}

/**
 * Keep `LIMIT` inside sane bounds; an unbounded read is a cost incident.
 *
 * `Math.trunc(NaN)` is `NaN` and both `Math.min` and `Math.max` propagate it,
 * so a bare clamp would pass `NaN` straight into the statement. These fail
 * closed on any non-finite input instead.
 */
function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 10_000;
  return Math.max(1, Math.min(10_000, Math.trunc(limit)));
}

function clampOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.trunc(offset));
}

/**
 * WHERE clauses shared by a query and its COUNT twin, so the page and the
 * total can never disagree about which rows match. `limit`/`offset` are not
 * part of a WHERE clause and stay with the callers.
 */
/**
 * The WHERE clauses of a report's `issue_meta` filters.
 *
 * Shared by `queryIssueMeta` and `countIssueMeta` for the same reason
 * `worklogClauses` is shared: a page and its total that build their own
 * predicates can disagree about which rows match, and the report would then
 * render "500 of 1,234" where neither number describes the other.
 *
 * An empty id list is treated as no filter rather than as `IN ()`, which is a
 * syntax error in MySQL and would match nothing even if it parsed.
 */
function issueMetaClauses(query: IssueMetaQuery): { clauses: string[]; params: unknown[] } {
  const clauses = ['project_id = ?'];
  const params: unknown[] = [query.projectId];
  if (query.assigneeAccountIds !== undefined && query.assigneeAccountIds.length > 0) {
    clauses.push(`assignee_account_id IN (${placeholders(query.assigneeAccountIds.length)})`);
    params.push(...query.assigneeAccountIds);
  }
  if (query.issueTypeIds !== undefined && query.issueTypeIds.length > 0) {
    clauses.push(`issue_type_id IN (${placeholders(query.issueTypeIds.length)})`);
    params.push(...query.issueTypeIds);
  }
  if (query.createdFrom !== undefined) {
    clauses.push('created_at >= ?');
    params.push(query.createdFrom);
  }
  if (query.createdTo !== undefined) {
    clauses.push('created_at < ?');
    params.push(query.createdTo);
  }
  return { clauses, params };
}

function worklogClauses(query: WorklogQuery): { clauses: string[]; params: unknown[] } {
  const clauses = ['project_id = ?'];
  const params: unknown[] = [query.projectId];
  if (query.from !== undefined) {
    clauses.push('started_at >= ?');
    params.push(query.from);
  }
  if (query.to !== undefined) {
    clauses.push('started_at < ?');
    params.push(query.to);
  }
  if (query.authorAccountIds !== undefined) {
    clauses.push(`author_account_id IN (${placeholders(query.authorAccountIds.length)})`);
    params.push(...query.authorAccountIds);
  }
  return { clauses, params };
}

function historyClauses(query: HistoryQuery): { clauses: string[]; params: unknown[] } {
  const clauses = ['project_id = ?'];
  const params: unknown[] = [query.projectId];
  if (query.from !== undefined) {
    clauses.push('changed_at >= ?');
    params.push(query.from);
  }
  if (query.to !== undefined) {
    clauses.push('changed_at < ?');
    params.push(query.to);
  }
  if (query.fields !== undefined) {
    clauses.push(`field IN (${placeholders(query.fields.length)})`);
    params.push(...query.fields.map((f) => f.toLowerCase()));
  }
  if (query.authorAccountIds !== undefined) {
    clauses.push(`author_account_id IN (${placeholders(query.authorAccountIds.length)})`);
    params.push(...query.authorAccountIds);
  }
  return { clauses, params };
}
