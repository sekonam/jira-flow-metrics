import type { Millis, StatusCategory, StatusId } from '../types.js';
import type { HistoryRecord } from '../metrics/history.js';
import type { WorklogRecord } from '../metrics/worklog.js';

/**
 * The persistence contract.
 *
 * **Forge SQL, never KVS.** The reasoning is in `docs/TECHNICAL-SPEC.md`, but
 * briefly: Forge's KVS free allowance is 0.1 GB/month for reads and for writes
 * respectively and writes cost roughly 20x reads, which is exactly the wrong
 * shape for an aggregate that is rewritten on every issue update. Forge SQL is
 * priced on GB-hours held (730 GB-hours/month free), so a ~16 MB footprint per
 * install stays inside the free tier for tens of installs.
 *
 * Every method is expressed in terms the SQL adapter can satisfy with one
 * statement, so the in-memory test double and the production adapter cannot
 * drift semantically.
 */

/** One row of `issue_status_agg`: cumulative time an issue spent in a status. */
export interface StatusAggregateRow {
  readonly issueId: string;
  readonly statusId: StatusId;
  readonly elapsedMs: Millis;
  readonly businessMs: Millis;
  readonly entries: number;
  readonly lastEnteredAt: Millis;
  readonly lastExitedAt: Millis | null;
  readonly updatedAt: Millis;
}

/**
 * One row of `issue_status_visit`: a single stay in a status.
 *
 * `StatusAggregateRow` above is this collapsed — every visit to a status
 * summed into one row. That is all four v1 reports need, and it cannot
 * answer either of the two questions ROADMAP stage 5 asks: what an issue's
 * status was on a day in the past (the cumulative flow diagram), and what
 * the visits were in order (the issue panel).
 *
 * `exitedAt` is `null` for the visit still in progress. `seq` is the visit's
 * position in the issue's own timeline, so rows sort without a timestamp
 * comparison and two visits entered in the same millisecond stay ordered.
 */
export interface StatusVisitRow {
  readonly issueId: string;
  readonly seq: number;
  readonly statusId: StatusId;
  readonly projectId: string;
  readonly enteredAt: Millis;
  readonly exitedAt: Millis | null;
}

export interface StatusVisitQuery {
  readonly projectId: string;
  readonly issueIds?: readonly string[];
  /** Visits overlapping `[from, to)`. A visit still open has no end to compare. */
  readonly from?: Millis;
  readonly to?: Millis;
  readonly limit?: number;
  readonly offset?: number;
}

/** One row of `issue_meta`: the small amount of issue state reports filter on. */
export interface IssueMetaRow {
  readonly issueId: string;
  readonly issueKey: string;
  readonly projectId: string;
  readonly issueTypeId: string | null;
  readonly priorityId: string | null;
  readonly assigneeAccountId: string | null;
  readonly currentStatusId: StatusId | null;
  readonly createdAt: Millis;
  readonly resolvedAt: Millis | null;
  readonly dueAt: Millis | null;
  /** Instant the last changelog entry we have processed was created. */
  readonly historyThroughAt: Millis;
  readonly truncated: boolean;
  readonly updatedAt: Millis;
}

/** One row of `status_meta`: id → name/category, with rename history. */
export interface StatusMetaRow {
  readonly statusId: StatusId;
  readonly name: string;
  readonly category: StatusCategory;
  readonly firstSeenAt: Millis;
  readonly lastSeenAt: Millis;
}

/**
 * Historic names of a status. Aggregates key on the id — statuses get renamed
 * and a report keyed on the name would silently split one status into two.
 */
export interface StatusNameHistoryRow {
  readonly statusId: StatusId;
  readonly name: string;
  readonly firstSeenAt: Millis;
  readonly lastSeenAt: Millis;
}

export type BackfillState = 'not_started' | 'running' | 'paused' | 'complete' | 'failed';

/** One row of `index_state`: everything needed to resume ingestion. */
export interface IndexStateRow {
  readonly projectId: string;
  readonly state: BackfillState;
  /** Opaque Jira page token for the next backfill slice. */
  readonly backfillCursor: string | null;
  /** Oldest `updated` timestamp the backfill will reach. */
  readonly backfillFrom: Millis | null;
  readonly issuesProcessed: number;
  readonly issuesTotal: number | null;
  /** Latest issue `updated` value fully processed by incremental ingestion. */
  readonly lastProcessedAt: Millis | null;
  readonly lastError: string | null;
  readonly startedAt: Millis | null;
  readonly updatedAt: Millis;
}

/**
 * The filters a report may apply to `issue_meta`, plus its page.
 *
 * These used to be applied in `buildStatusReport` *after* the page had been
 * fetched, which broke three ways at once on any project bigger than one
 * page: the page was fetched before filtering so a filtered page could come
 * back short or skip rows entirely, `issueCount` counted only the matches
 * inside the fetched window, and the "capped" test compared a filtered page
 * against the unfiltered project total, so every filtered report claimed to
 * be capped. One query shape, evaluated by the store, fixes all three — and
 * `countIssueMeta` takes the same shape so a page and its total cannot
 * disagree about which rows match.
 */
export interface IssueMetaQuery {
  readonly projectId: string;
  readonly assigneeAccountIds?: readonly string[];
  readonly issueTypeIds?: readonly string[];
  readonly createdFrom?: Millis;
  readonly createdTo?: Millis;
  readonly limit?: number;
  readonly offset?: number;
}

export interface StatusDurationQuery {
  readonly projectId: string;
  readonly issueIds?: readonly string[];
  readonly statusIds?: readonly StatusId[];
  readonly limit?: number;
  readonly offset?: number;
}

export interface WorklogQuery {
  readonly projectId: string;
  readonly from?: Millis;
  readonly to?: Millis;
  readonly authorAccountIds?: readonly string[];
  readonly limit?: number;
  readonly offset?: number;
}

export interface HistoryQuery {
  readonly projectId: string;
  readonly from?: Millis;
  readonly to?: Millis;
  readonly fields?: readonly string[];
  readonly authorAccountIds?: readonly string[];
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Persistence port. Implemented by `ForgeSqlStore` in production and by
 * `MemoryStore` in tests.
 */
export interface MetricsStore {
  /** Create tables if absent. Idempotent; safe to call on every invocation. */
  migrate(): Promise<void>;

  /**
   * Replace all aggregate rows for one issue, plus its meta row, in one
   * transaction. Replace-not-merge is deliberate: recomputing an issue's whole
   * timeline from its changelog is cheap and is the only way to stay correct
   * when history is edited, an issue is moved between projects, or an event is
   * delivered twice. **It is what makes ingestion idempotent.**
   */
  putIssueAggregate(meta: IssueMetaRow, rows: readonly StatusAggregateRow[]): Promise<void>;

  /** Bulk form of {@link putIssueAggregate}, used by backfill slices. */
  putIssueAggregates(
    batch: readonly { meta: IssueMetaRow; rows: readonly StatusAggregateRow[] }[],
  ): Promise<void>;

  deleteIssue(issueId: string): Promise<void>;

  getIssueMeta(issueId: string): Promise<IssueMetaRow | null>;
  queryIssueMeta(query: IssueMetaQuery): Promise<IssueMetaRow[]>;
  /**
   * Matching `issue_meta` rows, independent of any page size: `limit` and
   * `offset` on the query are ignored, every other field is honoured.
   * Reports need this to say "showing 500 of 1,234" instead of rendering a
   * capped page that looks complete — the silent-ceiling failure documented
   * in `docs/TECHNICAL-SPEC.md` § 11.1.
   */
  countIssueMeta(query: IssueMetaQuery): Promise<number>;
  queryStatusDurations(query: StatusDurationQuery): Promise<StatusAggregateRow[]>;
  /**
   * Distinct status ids seen in one project's aggregates. The SLA goal
   * picker's options: status metadata is instance-wide, and offering another
   * project's same-named statuses as chips reads as duplicates — observed
   * live with two seeded projects.
   */
  listProjectStatusIds(projectId: string): Promise<StatusId[]>;

  /**
   * Replace one issue's stored visits.
   *
   * Separate from `putIssueAggregate` rather than folded into it, matching
   * `putWorklogs`/`putHistory`: only the listings that set
   * `datasets.statusVisits` pay for the table, and the write path already
   * branches per dataset. Replace-not-merge for the same reason every other
   * write here does — it is what keeps ingestion idempotent.
   */
  putIssueVisits(issueId: string, visits: readonly StatusVisitRow[]): Promise<void>;
  queryStatusVisits(query: StatusVisitQuery): Promise<StatusVisitRow[]>;

  upsertStatusMeta(rows: readonly StatusMetaRow[]): Promise<void>;
  getStatusMeta(): Promise<StatusMetaRow[]>;
  recordStatusNames(rows: readonly StatusNameHistoryRow[]): Promise<void>;
  getStatusNameHistory(statusId: StatusId): Promise<StatusNameHistoryRow[]>;

  putWorklogs(issueId: string, records: readonly WorklogRecord[]): Promise<void>;
  queryWorklogs(query: WorklogQuery): Promise<WorklogRecord[]>;
  /** Matching worklog rows regardless of `limit`/`offset`, which are ignored. */
  countWorklogs(query: WorklogQuery): Promise<number>;

  putHistory(issueId: string, records: readonly HistoryRecord[]): Promise<void>;
  queryHistory(query: HistoryQuery): Promise<HistoryRecord[]>;
  /** Matching history rows regardless of `limit`/`offset`, which are ignored. */
  countHistory(query: HistoryQuery): Promise<number>;

  getIndexState(projectId: string): Promise<IndexStateRow | null>;
  putIndexState(row: IndexStateRow): Promise<void>;
  listIndexStates(): Promise<IndexStateRow[]>;

  /** Approximate stored bytes, for the in-app cost/usage panel. */
  estimateBytes(): Promise<number>;
}
