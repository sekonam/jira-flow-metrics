import type { JiraChangelogEntry, JiraIssue } from '../jira/types.js';
import { changelogItemToValue, compareChangelogOrder, parseJiraTimestamp } from '../jira/parse.js';
import { EngineError, type IssueTimeline, type Millis, type StatusInterval } from '../types.js';

/**
 * Reconstruct an issue's status timeline from its changelog.
 *
 * ## The thing this product exists to get right
 *
 * Jira's native Control Chart reports only the *most recent* period an issue
 * spent in a status. If an issue goes To Do → In Progress → Blocked → In
 * Progress, Jira's chart shows only the second In Progress period. This
 * function keeps every visit, and {@link ../metrics/timeInStatus} sums them.
 * That cumulative figure is the headline capability of listing 1.
 *
 * ## Algorithm
 *
 * 1. Extract every changelog item whose field is `status`, with its timestamp.
 * 2. Sort by `(created, numeric id)` — Jira pages are ordered but ties happen.
 * 3. The status *before* the first transition is that transition's `from`; when
 *    the issue has never transitioned, it is the issue's current status.
 * 4. Emit one interval per segment: `[issueCreated, t1)`, `[t1, t2)`, …,
 *    `[tn, null)` where `null` means "still open".
 * 5. Number each visit to a status so re-entries are visible in the output.
 *
 * ## Deliberate behaviours
 *
 * - **Chained transitions with identical timestamps** produce zero-length
 *   intervals. They are kept, not dropped: `entries` counts them, which is what
 *   an admin auditing a workflow expects to see.
 * - **A transition recorded before the issue's creation date** (clock skew,
 *   or an issue imported with a back-dated `created`) is clamped to the
 *   creation instant rather than producing a negative duration.
 * - **A gap between one transition's `to` and the next's `from`** — which
 *   happens when history is trimmed, or an issue is moved between projects and
 *   workflows — is trusted as recorded. We follow the `from` of the later
 *   entry, because that is what Jira itself displays, and mark the timeline
 *   `truncated` so the UI can say so.
 */

export interface StatusTransition {
  readonly at: Millis;
  readonly id: string;
  readonly fromId: string | null;
  readonly fromName: string | null;
  readonly toId: string | null;
  readonly toName: string | null;
}

export interface ReconstructInput {
  readonly issueId: string;
  readonly issueKey: string;
  readonly projectId: string;
  readonly createdAt: Millis;
  /** The status the issue is in *now*, needed when it has never transitioned. */
  readonly currentStatusId: string | null;
  readonly currentStatusName: string | null;
  readonly entries: readonly JiraChangelogEntry[];
  /** Set when the caller knows it did not fetch the whole changelog. */
  readonly truncated?: boolean;
}

const UNKNOWN_STATUS_ID = '__unknown__';

/** Pull the status transitions out of raw changelog entries, in order. */
export function extractStatusTransitions(
  entries: readonly JiraChangelogEntry[],
): StatusTransition[] {
  const transitions: StatusTransition[] = [];
  entries.forEach((entry, index) => {
    const at = parseJiraTimestamp(entry.created);
    if (at === null) return;
    const id = entry.id ?? `idx-${index}`;
    for (const item of entry.items ?? []) {
      if (!isStatusItem(item.field, item.fieldId)) continue;
      transitions.push({
        at,
        id,
        fromId: nullableString(item.from),
        fromName: nullableString(item.fromString),
        toId: nullableString(item.to),
        toName: nullableString(changelogItemToValue(item)),
      });
    }
  });
  return transitions.sort(compareChangelogOrder);
}

function isStatusItem(field: string | undefined, fieldId: string | undefined): boolean {
  return field?.toLowerCase() === 'status' || fieldId?.toLowerCase() === 'status';
}

function nullableString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Reconstruct the full status timeline. */
export function reconstructTimeline(input: ReconstructInput): IssueTimeline {
  if (!Number.isFinite(input.createdAt)) {
    throw new EngineError(`Issue ${input.issueKey} has no usable created date`, 'BAD_ISSUE');
  }
  const transitions = extractStatusTransitions(input.entries);
  const statusNames = new Map<string, string[]>();
  const recordName = (id: string | null, name: string | null): void => {
    if (id === null || name === null) return;
    const seen = statusNames.get(id) ?? [];
    if (seen[seen.length - 1] !== name) {
      // Keep the observed order but never repeat the same name twice running.
      statusNames.set(id, [...seen.filter((n) => n !== name), name]);
    }
  };

  let truncated = input.truncated ?? false;

  // Step 3: what status did the issue start in?
  const first = transitions[0];
  let currentId: string;
  let currentName: string;
  if (first !== undefined) {
    currentId = first.fromId ?? UNKNOWN_STATUS_ID;
    currentName = first.fromName ?? 'Unknown';
    if (first.fromId === null) truncated = true;
  } else {
    currentId = input.currentStatusId ?? UNKNOWN_STATUS_ID;
    currentName = input.currentStatusName ?? 'Unknown';
    if (input.currentStatusId === null) truncated = true;
  }
  recordName(currentId, currentName);
  for (const t of transitions) {
    recordName(t.fromId, t.fromName);
    recordName(t.toId, t.toName);
  }

  const visits = new Map<string, number>();
  const nextOrdinal = (statusId: string): number => {
    const n = (visits.get(statusId) ?? 0) + 1;
    visits.set(statusId, n);
    return n;
  };

  const intervals: StatusInterval[] = [];
  let segmentStart = input.createdAt;

  for (const t of transitions) {
    const at = Math.max(t.at, input.createdAt);
    intervals.push({
      statusId: currentId,
      statusName: currentName,
      start: segmentStart,
      end: Math.max(at, segmentStart),
      entryOrdinal: nextOrdinal(currentId),
    });
    if (t.fromId !== null && t.fromId !== currentId) {
      // History has a discontinuity — the previous segment's status is not the
      // one this transition claims to leave. Trust the changelog, flag it.
      truncated = true;
    }
    currentId = t.toId ?? UNKNOWN_STATUS_ID;
    currentName = t.toName ?? 'Unknown';
    if (t.toId === null) truncated = true;
    segmentStart = Math.max(at, segmentStart);
  }

  intervals.push({
    statusId: currentId,
    statusName: currentName,
    start: segmentStart,
    end: null,
    entryOrdinal: nextOrdinal(currentId),
  });

  const frozenNames = new Map<string, readonly string[]>();
  for (const [id, names] of statusNames) frozenNames.set(id, Object.freeze([...names]));

  return {
    issueId: input.issueId,
    issueKey: input.issueKey,
    projectId: input.projectId,
    createdAt: input.createdAt,
    intervals,
    statusNames: frozenNames,
    truncated,
  };
}

/**
 * Convenience wrapper for an issue fetched with `expand=changelog`.
 * Returns `null` when the payload lacks the fields the engine needs, so a
 * single malformed issue cannot abort a whole backfill page.
 */
export function timelineFromIssue(issue: JiraIssue): IssueTimeline | null {
  const issueId = issue.id;
  const createdAt = parseJiraTimestamp(issue.fields?.created);
  if (issueId === undefined || createdAt === null) return null;
  const changelog = issue.changelog;
  const values = changelog?.values ?? [];
  const total = changelog?.total;
  const truncated = typeof total === 'number' && total > values.length;
  return reconstructTimeline({
    issueId,
    issueKey: issue.key ?? issueId,
    projectId: issue.fields?.project?.id ?? '',
    createdAt,
    currentStatusId: issue.fields?.status?.id ?? null,
    currentStatusName: issue.fields?.status?.name ?? null,
    entries: values,
    truncated,
  });
}

/** The status the timeline ends in, or `null` if it could not be determined. */
export function currentStatusOf(timeline: IssueTimeline): string | null {
  const last = timeline.intervals[timeline.intervals.length - 1];
  if (last === undefined) return null;
  return last.statusId === UNKNOWN_STATUS_ID ? null : last.statusId;
}

export { UNKNOWN_STATUS_ID };
