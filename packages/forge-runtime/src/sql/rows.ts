import type {
  HistoryRecord,
  IndexStateRow,
  IssueMetaRow,
  StatusAggregateRow,
  StatusMetaRow,
  StatusNameHistoryRow,
  StatusVisitRow,
  WorklogRecord,
  BackfillState,
  StatusCategory,
} from '@jfm/engine';

/**
 * Row mapping between Forge SQL's snake_case columns and the engine's types.
 *
 * These are pure functions, so they are fully covered by tests even though the
 * database they map to has never been reached from here. Getting the mapping
 * wrong is the single most likely way for a metrics product to be silently
 * wrong, so every field is written out explicitly rather than spread.
 *
 * MySQL returns `BIGINT` as a JavaScript number through the Forge driver when
 * it fits in a double, and epoch milliseconds do (they exceed 2^53 only in the
 * year 287396). `toNumber` still guards, because a driver returning strings
 * would otherwise produce `NaN` durations that look like real zeros.
 */

export function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new TypeError(`Expected a numeric column value, received ${JSON.stringify(value)}`);
}

export function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : toNumber(value);
}

export function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  throw new TypeError(`Expected a text column value, received ${JSON.stringify(value)}`);
}

export function toNullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : toText(value);
}

/** MySQL has no boolean type; `TINYINT(1)` comes back as 0/1. */
export function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

type Row = Readonly<Record<string, unknown>>;

export function issueMetaFromRow(row: Row): IssueMetaRow {
  return {
    issueId: toText(row['issue_id']),
    issueKey: toText(row['issue_key']),
    projectId: toText(row['project_id']),
    issueTypeId: toNullableText(row['issue_type_id']),
    priorityId: toNullableText(row['priority_id']),
    assigneeAccountId: toNullableText(row['assignee_account_id']),
    currentStatusId: toNullableText(row['current_status_id']),
    createdAt: toNumber(row['created_at']),
    resolvedAt: toNullableNumber(row['resolved_at']),
    dueAt: toNullableNumber(row['due_at']),
    historyThroughAt: toNumber(row['history_through_at']),
    truncated: toBoolean(row['truncated']),
    updatedAt: toNumber(row['updated_at']),
  };
}

export function issueMetaToParams(meta: IssueMetaRow): unknown[] {
  return [
    meta.issueId,
    meta.issueKey,
    meta.projectId,
    meta.issueTypeId,
    meta.priorityId,
    meta.assigneeAccountId,
    meta.currentStatusId,
    meta.createdAt,
    meta.resolvedAt,
    meta.dueAt,
    meta.historyThroughAt,
    meta.truncated ? 1 : 0,
    meta.updatedAt,
  ];
}

export function statusAggregateFromRow(row: Row): StatusAggregateRow {
  return {
    issueId: toText(row['issue_id']),
    statusId: toText(row['status_id']),
    elapsedMs: toNumber(row['elapsed_ms']),
    businessMs: toNumber(row['business_ms']),
    entries: toNumber(row['entries']),
    lastEnteredAt: toNumber(row['last_entered_at']),
    lastExitedAt: toNullableNumber(row['last_exited_at']),
    updatedAt: toNumber(row['updated_at']),
  };
}

export function statusAggregateToParams(row: StatusAggregateRow, projectId: string): unknown[] {
  return [
    row.issueId,
    row.statusId,
    projectId,
    row.elapsedMs,
    row.businessMs,
    row.entries,
    row.lastEnteredAt,
    row.lastExitedAt,
    row.updatedAt,
  ];
}

export function statusVisitFromRow(row: Row): StatusVisitRow {
  return {
    issueId: toText(row['issue_id']),
    seq: toNumber(row['seq']),
    statusId: toText(row['status_id']),
    projectId: toText(row['project_id']),
    enteredAt: toNumber(row['entered_at']),
    exitedAt: toNullableNumber(row['exited_at']),
  };
}

export function statusVisitToParams(row: StatusVisitRow): unknown[] {
  return [row.issueId, row.seq, row.statusId, row.projectId, row.enteredAt, row.exitedAt];
}

const STATUS_CATEGORIES: readonly StatusCategory[] = ['todo', 'inprogress', 'done', 'unknown'];

export function statusMetaFromRow(row: Row): StatusMetaRow {
  const category = toText(row['category']);
  return {
    statusId: toText(row['status_id']),
    name: toText(row['name']),
    category: (STATUS_CATEGORIES as readonly string[]).includes(category)
      ? (category as StatusCategory)
      : 'unknown',
    firstSeenAt: toNumber(row['first_seen_at']),
    lastSeenAt: toNumber(row['last_seen_at']),
  };
}

export function statusNameHistoryFromRow(row: Row): StatusNameHistoryRow {
  return {
    statusId: toText(row['status_id']),
    name: toText(row['name']),
    firstSeenAt: toNumber(row['first_seen_at']),
    lastSeenAt: toNumber(row['last_seen_at']),
  };
}

export function worklogFromRow(row: Row): WorklogRecord {
  return {
    worklogId: toText(row['worklog_id']),
    issueId: toText(row['issue_id']),
    issueKey: toText(row['issue_key']),
    projectId: toText(row['project_id']),
    authorAccountId: toText(row['author_account_id']),
    authorDisplayName: toText(row['author_display_name']),
    startedAt: toNumber(row['started_at']),
    timeSpentMs: toNumber(row['time_spent_ms']),
    createdAt: toNullableNumber(row['created_at']),
    updatedAt: toNullableNumber(row['updated_at']),
  };
}

export function worklogToParams(record: WorklogRecord): unknown[] {
  return [
    record.worklogId,
    record.issueId,
    record.issueKey,
    record.projectId,
    record.authorAccountId,
    record.authorDisplayName,
    record.startedAt,
    record.timeSpentMs,
    record.createdAt,
    record.updatedAt,
  ];
}

export function historyFromRow(row: Row): HistoryRecord {
  return {
    changeId: toText(row['change_id']),
    issueId: toText(row['issue_id']),
    issueKey: toText(row['issue_key']),
    projectId: toText(row['project_id']),
    at: toNumber(row['changed_at']),
    authorAccountId: toNullableText(row['author_account_id']),
    authorDisplayName: toText(row['author_display_name']),
    field: toText(row['field']),
    fieldLabel: toText(row['field_label']),
    fromValue: toNullableText(row['from_value']),
    toValue: toNullableText(row['to_value']),
    fromId: toNullableText(row['from_id']),
    toId: toNullableText(row['to_id']),
  };
}

export function historyToParams(record: HistoryRecord): unknown[] {
  return [
    record.changeId,
    record.issueId,
    record.issueKey,
    record.projectId,
    record.at,
    record.authorAccountId,
    record.authorDisplayName,
    record.field,
    record.fieldLabel,
    record.fromValue,
    record.toValue,
    record.fromId,
    record.toId,
  ];
}

const BACKFILL_STATES: readonly BackfillState[] = [
  'not_started',
  'running',
  'paused',
  'complete',
  'failed',
];

export function indexStateFromRow(row: Row): IndexStateRow {
  const state = toText(row['state']);
  return {
    projectId: toText(row['project_id']),
    state: (BACKFILL_STATES as readonly string[]).includes(state)
      ? (state as BackfillState)
      : 'failed',
    backfillCursor: toNullableText(row['backfill_cursor']),
    backfillFrom: toNullableNumber(row['backfill_from']),
    issuesProcessed: toNumber(row['issues_processed']),
    issuesTotal: toNullableNumber(row['issues_total']),
    lastProcessedAt: toNullableNumber(row['last_processed_at']),
    lastError: toNullableText(row['last_error']),
    startedAt: toNullableNumber(row['started_at']),
    updatedAt: toNumber(row['updated_at']),
  };
}

export function indexStateToParams(row: IndexStateRow): unknown[] {
  return [
    row.projectId,
    row.state,
    row.backfillCursor,
    row.backfillFrom,
    row.issuesProcessed,
    row.issuesTotal,
    row.lastProcessedAt,
    // `last_error` is VARCHAR(1024); a longer message would abort the write and
    // lose the state update that is the whole point of recording the error.
    row.lastError === null ? null : row.lastError.slice(0, 1000),
    row.startedAt,
    row.updatedAt,
  ];
}

/** `?, ?, ?` for `count` parameters. Returns `NULL` for an empty list so that
 * `IN (…)` stays valid SQL and matches nothing. */
export function placeholders(count: number): string {
  return count <= 0 ? 'NULL' : new Array(count).fill('?').join(', ');
}
