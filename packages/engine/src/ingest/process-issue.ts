import { reconstructTimeline } from '../changelog/reconstruct.js';
import { parseJiraTimestamp } from '../jira/parse.js';
import type { JiraChangelogEntry, JiraIssue } from '../jira/types.js';
import { computeTimeInStatus } from '../metrics/time-in-status.js';
import { toHistoryRecords, type HistoryRecord } from '../metrics/history.js';
import { toWorklogRecord, type WorklogRecord } from '../metrics/worklog.js';
import type { WorkingCalendar } from '../time/calendar.js';
import type {
  IssueMetaRow,
  MetricsStore,
  StatusAggregateRow,
  StatusNameHistoryRow,
} from '../store/types.js';
import type { Millis } from '../types.js';
import { withRetry, type RetryOptions } from './retry.js';
import type { JiraApi, Logger } from './ports.js';

/**
 * Turning one Jira issue into stored aggregates.
 *
 * This is the single code path used by **both** the incremental updater and the
 * backfill. Sharing it is not a tidiness preference: the two paths producing
 * subtly different aggregates would be exactly the "silently wrong metrics
 * product" failure mode, and there is no cheap way to detect it in production.
 */

/** Which datasets a listing needs. Listings pay only for what they read. */
export interface IngestDatasets {
  readonly statusDurations: boolean;
  readonly worklogs: boolean;
  readonly history: boolean;
}

export const DATASETS_TIME_IN_STATUS: IngestDatasets = {
  statusDurations: true,
  worklogs: false,
  history: false,
};

export const DATASETS_WORKLOG: IngestDatasets = {
  statusDurations: false,
  worklogs: true,
  history: false,
};

export const DATASETS_HISTORY: IngestDatasets = {
  statusDurations: false,
  worklogs: false,
  history: true,
};

export const DATASETS_ALL: IngestDatasets = {
  statusDurations: true,
  worklogs: true,
  history: true,
};

export interface IngestConfig {
  readonly datasets: IngestDatasets;
  readonly calendar: WorkingCalendar;
  /** Page size for changelog and worklog fetches. Jira caps this at 100. */
  readonly pageSize: number;
  /** Hard cap on changelog entries per issue; protects against pathological issues. */
  readonly maxChangelogEntries: number;
  readonly retry: RetryOptions;
  readonly logger?: Logger;
}

export interface ProcessedIssue {
  readonly meta: IssueMetaRow;
  readonly aggregates: readonly StatusAggregateRow[];
  readonly worklogs: readonly WorklogRecord[];
  readonly history: readonly HistoryRecord[];
  readonly statusNames: readonly StatusNameHistoryRow[];
  /** Requests made to Jira for this issue. Surfaced so the UI can show progress cost. */
  readonly requests: number;
}

/**
 * Fetch everything needed for one issue and compute its aggregates.
 * Does **not** write; the caller batches writes so a backfill slice performs
 * one store round trip per batch rather than one per issue.
 */
export async function processIssue(
  issue: JiraIssue,
  api: JiraApi,
  config: IngestConfig,
  now: Millis,
): Promise<ProcessedIssue | null> {
  const issueId = issue.id;
  const createdAt = parseJiraTimestamp(issue.fields?.created);
  if (issueId === undefined || createdAt === null) {
    config.logger?.log('warn', 'skipping issue without id or created date', { key: issue.key });
    return null;
  }
  const issueKey = issue.key ?? issueId;
  const projectId = issue.fields?.project?.id ?? '';

  let requests = 0;
  const needsChangelog = config.datasets.statusDurations || config.datasets.history;
  let entries: JiraChangelogEntry[] = [];
  let truncated = false;

  if (needsChangelog) {
    const inline = issue.changelog;
    const inlineValues = inline?.values ?? [];
    const inlineTotal = inline?.total;
    // `expand=changelog` inlines at most the first page. Use it when it is the
    // whole changelog, and page explicitly otherwise — a saved request per
    // issue is the difference between a backfill that finishes and one that
    // exhausts the rate limit.
    if (
      inline !== undefined &&
      typeof inlineTotal === 'number' &&
      inlineTotal <= inlineValues.length
    ) {
      entries = [...inlineValues];
    } else {
      const fetched = await fetchAllChangelog(issueId, api, config);
      entries = fetched.entries;
      truncated = fetched.truncated;
      requests += fetched.requests;
    }
  }

  const timeline = reconstructTimeline({
    issueId,
    issueKey,
    projectId,
    createdAt,
    currentStatusId: issue.fields?.status?.id ?? null,
    currentStatusName: issue.fields?.status?.name ?? null,
    entries,
    truncated,
  });

  const aggregates: StatusAggregateRow[] = [];
  const statusNames: StatusNameHistoryRow[] = [];
  if (config.datasets.statusDurations) {
    const durations = computeTimeInStatus(timeline, { now, calendar: config.calendar });
    for (const d of durations.durations) {
      aggregates.push({
        issueId,
        statusId: d.statusId,
        elapsedMs: d.elapsedMs,
        businessMs: d.businessMs,
        entries: d.entries,
        lastEnteredAt: d.lastEnteredAt,
        lastExitedAt: d.lastExitedAt,
        updatedAt: now,
      });
    }
    for (const [statusId, names] of timeline.statusNames) {
      for (const name of names) {
        statusNames.push({ statusId, name, firstSeenAt: createdAt, lastSeenAt: now });
      }
    }
  }

  let worklogs: WorklogRecord[] = [];
  if (config.datasets.worklogs) {
    const fetched = await fetchAllWorklogs(issueId, issueKey, projectId, api, config);
    worklogs = fetched.records;
    requests += fetched.requests;
  }

  const history = config.datasets.history
    ? toHistoryRecords(entries, { issueId, issueKey, projectId })
    : [];

  const lastEntryAt = entries.reduce<Millis>((max, e) => {
    const at = parseJiraTimestamp(e.created);
    return at === null ? max : Math.max(max, at);
  }, createdAt);

  const meta: IssueMetaRow = {
    issueId,
    issueKey,
    projectId,
    issueTypeId: issue.fields?.issuetype?.id ?? null,
    priorityId: issue.fields?.priority?.id ?? null,
    assigneeAccountId: issue.fields?.assignee?.accountId ?? null,
    currentStatusId: issue.fields?.status?.id ?? null,
    createdAt,
    resolvedAt: parseJiraTimestamp(issue.fields?.resolutiondate),
    dueAt: parseJiraTimestamp(issue.fields?.duedate),
    historyThroughAt: lastEntryAt,
    truncated: timeline.truncated,
    updatedAt: now,
  };

  return { meta, aggregates, worklogs, history, statusNames, requests };
}

/** Persist a batch of processed issues with the minimum number of store calls. */
export async function writeProcessed(
  store: MetricsStore,
  processed: readonly ProcessedIssue[],
  datasets: IngestDatasets,
): Promise<void> {
  if (processed.length === 0) return;
  if (datasets.statusDurations) {
    await store.putIssueAggregates(processed.map((p) => ({ meta: p.meta, rows: p.aggregates })));
    const names = processed.flatMap((p) => p.statusNames);
    if (names.length > 0) await store.recordStatusNames(names);
  } else {
    // Other listings still need issue_meta for filtering, but write no aggregates.
    await store.putIssueAggregates(processed.map((p) => ({ meta: p.meta, rows: [] })));
  }
  if (datasets.worklogs) {
    for (const p of processed) await store.putWorklogs(p.meta.issueId, p.worklogs);
  }
  if (datasets.history) {
    for (const p of processed) await store.putHistory(p.meta.issueId, p.history);
  }
}

async function fetchAllChangelog(
  issueId: string,
  api: JiraApi,
  config: IngestConfig,
): Promise<{ entries: JiraChangelogEntry[]; truncated: boolean; requests: number }> {
  const entries: JiraChangelogEntry[] = [];
  let startAt = 0;
  let requests = 0;
  let truncated = false;

  for (;;) {
    const page = await withRetry(
      () => api.getChangelog(issueId, { startAt, maxResults: config.pageSize }),
      { ...config.retry, label: `changelog ${issueId}` },
    );
    requests += 1;
    const values = page.values ?? [];
    entries.push(...values);
    const total = page.total;
    const isLast =
      page.isLast === true ||
      values.length === 0 ||
      (typeof total === 'number' && entries.length >= total);
    if (entries.length >= config.maxChangelogEntries) {
      truncated = !isLast;
      break;
    }
    if (isLast) break;
    startAt += values.length;
  }
  return { entries, truncated, requests };
}

async function fetchAllWorklogs(
  issueId: string,
  issueKey: string,
  projectId: string,
  api: JiraApi,
  config: IngestConfig,
): Promise<{ records: WorklogRecord[]; requests: number }> {
  const records: WorklogRecord[] = [];
  let startAt = 0;
  let requests = 0;

  for (;;) {
    const page = await withRetry(
      () => api.getWorklogs(issueId, { startAt, maxResults: config.pageSize }),
      { ...config.retry, label: `worklogs ${issueId}` },
    );
    requests += 1;
    const values = page.worklogs ?? [];
    for (const entry of values) {
      const record = toWorklogRecord(entry, { issueId, issueKey, projectId });
      if (record !== null) records.push(record);
    }
    const total = page.total;
    if (
      values.length === 0 ||
      (typeof total === 'number' && startAt + values.length >= total) ||
      requests > 50
    ) {
      break;
    }
    startAt += values.length;
  }
  return { records, requests };
}
