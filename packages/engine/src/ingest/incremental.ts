import type { JiraIssueUpdatedEvent } from '../jira/types.js';
import type { MetricsStore } from '../store/types.js';
import type { Clock, JiraApi, Logger } from './ports.js';
import { BACKFILL_FIELDS } from './backfill.js';
import { processIssue, writeProcessed, type IngestConfig } from './process-issue.js';
import { withRetry } from './retry.js';

/**
 * Incremental ingestion — the steady state.
 *
 * **There is no scheduled re-index anywhere in this product.** Forge went
 * consumption-priced on 1 Jan 2026, so a nightly crawl over every install's
 * issues would make the marginal cost of an install grow with its size while
 * the price stays flat. Instead the app subscribes to `avi:jira:updated:issue`
 * and recomputes exactly the issue that changed.
 *
 * Cost per event is one changelog fetch plus one row-replacement write, which
 * is bounded by the issue's own history rather than by the instance's size.
 */

export interface IncrementalDeps {
  readonly api: JiraApi;
  readonly store: MetricsStore;
  readonly clock: Clock;
  readonly config: IngestConfig;
  readonly logger?: Logger;
}

export type IncrementalOutcome =
  | { readonly kind: 'updated'; readonly issueId: string; readonly requests: number }
  | { readonly kind: 'deleted'; readonly issueId: string }
  | { readonly kind: 'ignored'; readonly reason: string };

/** Extract the issue id from an `avi:jira:*:issue` event payload. */
export function issueIdFromEvent(event: JiraIssueUpdatedEvent): string | null {
  const id = event.issue?.id;
  return id === undefined || id === '' ? null : id;
}

/**
 * Decide whether an event needs any work at all.
 *
 * Most `avi:jira:updated:issue` events are comment edits, description changes
 * and field tweaks that cannot move any number this product reports. Filtering
 * them here is the single biggest lever on steady-state cost — for the
 * time-in-status listing it removes the large majority of events for one
 * cheap check on a payload we already have.
 */
export function eventAffectsDatasets(
  event: JiraIssueUpdatedEvent,
  config: IngestConfig,
): { affects: boolean; reason: string } {
  const items = event.changelog?.items ?? [];
  if (items.length === 0) {
    // No changelog on the event: we cannot tell, so we must re-read.
    return { affects: true, reason: 'no changelog in event payload' };
  }
  if (config.datasets.history) {
    return { affects: true, reason: 'history listing records every field change' };
  }
  for (const item of items) {
    const field = (item.fieldId ?? item.field ?? '').toLowerCase();
    if (config.datasets.statusDurations && (field === 'status' || field === 'resolution')) {
      return { affects: true, reason: `status-relevant field "${field}"` };
    }
    if (config.datasets.worklogs && (field === 'worklogid' || field === 'timespent')) {
      return { affects: true, reason: `worklog-relevant field "${field}"` };
    }
    if (field === 'project' || field === 'key') {
      return { affects: true, reason: 'issue moved between projects' };
    }
    if (field === 'duedate' || field === 'priority' || field === 'assignee') {
      // These live in issue_meta, which reports filter on.
      return { affects: true, reason: `filterable meta field "${field}"` };
    }
  }
  return { affects: false, reason: 'no relevant field changed' };
}

/** Handle one `avi:jira:updated:issue` (or `created`) event. */
export async function handleIssueUpdated(
  event: JiraIssueUpdatedEvent,
  deps: IncrementalDeps,
): Promise<IncrementalOutcome> {
  const issueId = issueIdFromEvent(event);
  if (issueId === null) return { kind: 'ignored', reason: 'event carried no issue id' };

  const relevance = eventAffectsDatasets(event, deps.config);
  if (!relevance.affects) {
    deps.logger?.log('debug', 'skipping irrelevant issue event', {
      issueId,
      why: relevance.reason,
    });
    return { kind: 'ignored', reason: relevance.reason };
  }

  const issue = await withRetry(() => deps.api.getIssue(issueId, BACKFILL_FIELDS), {
    ...deps.config.retry,
    label: `issue ${issueId}`,
  });

  const processed = await processIssue(issue, deps.api, deps.config, deps.clock.now());
  if (processed === null) return { kind: 'ignored', reason: 'issue payload unusable' };

  // Data minimisation. The product-event trigger fires for **every** project on
  // the instance, not only the ones someone opened a report for. Storing issue
  // metadata, worklogs and field history for projects nobody asked about is
  // both a cost on a byte-priced backend and an answer nobody wants to give a
  // security reviewer. Ingest only where an index has been started.
  const projectId = processed.meta.projectId;
  const indexState = projectId === '' ? null : await deps.store.getIndexState(projectId);
  if (indexState === null) {
    deps.logger?.log('debug', 'skipping event for an unindexed project', { issueId, projectId });
    return { kind: 'ignored', reason: 'project has not been indexed' };
  }

  await writeProcessed(deps.store, [processed], deps.config.datasets);
  await deps.store.putIndexState({
    ...indexState,
    lastProcessedAt: deps.clock.now(),
    updatedAt: deps.clock.now(),
  });
  return { kind: 'updated', issueId, requests: processed.requests + 1 };
}

/** Handle `avi:jira:deleted:issue`. */
export async function handleIssueDeleted(
  event: JiraIssueUpdatedEvent,
  deps: IncrementalDeps,
): Promise<IncrementalOutcome> {
  const issueId = issueIdFromEvent(event);
  if (issueId === null) return { kind: 'ignored', reason: 'event carried no issue id' };
  await deps.store.deleteIssue(issueId);
  return { kind: 'deleted', issueId };
}
