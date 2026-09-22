import {
  BACKFILL_FIELDS,
  computeTimeInStatus,
  evaluateSla,
  parseJiraTimestamp,
  reconstructTimeline,
  withRetry,
  type JiraApi,
  type JiraChangelogEntry,
  type Millis,
  type Sleeper,
  type SlaResult,
  type StatusId,
  type StatusMeta,
  type WorkingCalendar,
} from '@jfm/engine';

/**
 * One issue's timeline — the issue panel.
 *
 * ROADMAP stage 5: "Issue panel showing one issue's timeline; uses
 * `evaluateSla`'s full pause model; a genuinely different surface." It is
 * different in two ways that decide how it is built.
 *
 * ## It reads Jira, not the store
 *
 * Every other report in this product is answered from stored aggregates,
 * because a project-wide report that re-fetches on every render makes Forge
 * consumption scale with usage instead of with installs. One issue is the
 * case where that reasoning inverts: it is a single changelog fetch, it is
 * correct the instant a transition happens rather than whenever the event
 * queue drains, and it works identically on all five listings regardless of
 * which datasets each one ingests. The panel is also the one surface a user
 * opens while *looking at* the issue, where "this disagrees with the History
 * tab above it" would be the worst possible first impression.
 *
 * ## It uses the full start/stop/pause model
 *
 * `buildSlaReport` uses the counted-statuses model because that is exactly
 * computable from the stored aggregate across hundreds of issues. With one
 * issue's whole timeline in hand, `evaluateSla` applies the model Jira
 * Service Management uses — and the two are documented as different things
 * in `docs/PRODUCT-SPEC.md` rather than quietly blended.
 */

export interface TimelineVisit {
  readonly statusId: StatusId;
  readonly statusName: string;
  readonly enteredAt: Millis;
  /** `null` for the visit still in progress. */
  readonly exitedAt: Millis | null;
  readonly elapsedMs: Millis;
  readonly businessMs: Millis;
}

export interface TimelineTotal {
  readonly statusId: StatusId;
  readonly statusName: string;
  readonly elapsedMs: Millis;
  readonly businessMs: Millis;
  /** Visits to this status. The column Jira's Control Chart cannot show. */
  readonly entries: number;
}

export interface IssueTimelineReport {
  readonly issueKey: string;
  readonly createdAt: Millis;
  readonly resolvedAt: Millis | null;
  readonly visits: readonly TimelineVisit[];
  readonly totals: readonly TimelineTotal[];
  /** True when the changelog was longer than the cap, so the timeline is partial. */
  readonly truncated: boolean;
  /**
   * Working time between the first in-progress status and the first done
   * status, with time back in a to-do status subtracted.
   *
   * `null` when the issue has not started, or when the instance's status
   * categories give nothing to start or stop on. Derived from **status
   * categories**, not from a configured goal: the panel has no configuration
   * and inventing a default goal that looked configured would be worse than
   * a clearly-derived one. The UI says which it is.
   */
  readonly sla: SlaResult | null;
}

/**
 * The derived goal, built from Jira's own status categories.
 *
 * `todo` statuses pause the clock rather than being excluded outright, which
 * is the difference between "time in progress" and "time since work started":
 * an issue sent back to the backlog for a fortnight and then finished in an
 * hour reads as about an hour here, which is what a reader means by how long
 * the work took.
 */
export function deriveGoal(
  statuses: readonly StatusMeta[],
  calendar: WorkingCalendar,
  targetMs: Millis,
): { startStatusIds: StatusId[]; stopStatusIds: StatusId[]; pauseStatusIds: StatusId[] } | null {
  const of = (category: StatusMeta['category']): StatusId[] =>
    statuses.filter((s) => s.category === category).map((s) => s.id);
  const startStatusIds = of('inprogress');
  const stopStatusIds = of('done');
  void calendar;
  void targetMs;
  if (startStatusIds.length === 0 || stopStatusIds.length === 0) return null;
  return { startStatusIds, stopStatusIds, pauseStatusIds: of('todo') };
}

export interface IssueTimelineDeps {
  readonly api: JiraApi;
  readonly calendar: WorkingCalendar;
  readonly now: Millis;
  /** Hard cap on changelog entries, matching the ingest config. */
  readonly maxChangelogEntries: number;
  readonly pageSize: number;
  readonly targetMs: Millis;
  readonly sleeper: Sleeper;
}

export async function buildIssueTimeline(
  issueIdOrKey: string,
  deps: IssueTimelineDeps,
): Promise<{ report: IssueTimelineReport; projectId: string }> {
  const issue = await withRetry(() => deps.api.getIssue(issueIdOrKey, BACKFILL_FIELDS), {
    sleeper: deps.sleeper,
    label: `issue ${issueIdOrKey}`,
  });
  const issueId = issue.id ?? issueIdOrKey;
  const createdAt = parseJiraTimestamp(issue.fields?.created);
  const projectId = issue.fields?.project?.id ?? '';
  if (createdAt === null) {
    throw new Error(`Issue ${issueIdOrKey} has no created date; its timeline cannot be built.`);
  }

  const { entries, truncated } = await fetchChangelog(issueId, deps);
  const timeline = reconstructTimeline({
    issueId,
    issueKey: issue.key ?? issueId,
    projectId,
    createdAt,
    currentStatusId: issue.fields?.status?.id ?? null,
    currentStatusName: issue.fields?.status?.name ?? null,
    entries,
    truncated,
  });

  const durations = computeTimeInStatus(timeline, { now: deps.now, calendar: deps.calendar });
  const nameOf = new Map(durations.durations.map((d) => [d.statusId, d.statusName]));

  const visits: TimelineVisit[] = timeline.intervals.map((interval) => {
    const end = interval.end ?? deps.now;
    // Each visit measured on its own, rather than by dividing the status
    // total by the visit count: the visits are different lengths and that
    // difference is the whole reason this panel exists.
    const single = computeTimeInStatus(
      { ...timeline, intervals: [interval] },
      { now: deps.now, calendar: deps.calendar },
    );
    const measured = single.durations[0];
    return {
      statusId: interval.statusId,
      statusName: nameOf.get(interval.statusId) ?? interval.statusName,
      enteredAt: interval.start,
      exitedAt: interval.end,
      elapsedMs: measured?.elapsedMs ?? Math.max(0, end - interval.start),
      businessMs: measured?.businessMs ?? 0,
    };
  });

  const statuses = await deps.api.getStatuses();
  const derived = deriveGoal(statuses, deps.calendar, deps.targetMs);
  const sla =
    derived === null
      ? null
      : evaluateSla(
          timeline,
          {
            id: 'derived',
            name: 'Time in progress',
            ...derived,
            targetMs: deps.targetMs,
            calendar: deps.calendar,
          },
          deps.now,
        );

  return {
    projectId,
    report: {
      issueKey: timeline.issueKey,
      createdAt,
      resolvedAt: parseJiraTimestamp(issue.fields?.resolutiondate),
      visits,
      totals: durations.durations.map((d) => ({
        statusId: d.statusId,
        statusName: d.statusName,
        elapsedMs: d.elapsedMs,
        businessMs: d.businessMs,
        entries: d.entries,
      })),
      truncated: timeline.truncated,
      sla: sla !== null && sla.state === 'not_started' ? null : sla,
    },
  };
}

async function fetchChangelog(
  issueId: string,
  deps: IssueTimelineDeps,
): Promise<{ entries: JiraChangelogEntry[]; truncated: boolean }> {
  const entries: JiraChangelogEntry[] = [];
  let startAt = 0;
  for (;;) {
    const page = await withRetry(
      () => deps.api.getChangelog(issueId, { startAt, maxResults: deps.pageSize }),
      { sleeper: deps.sleeper, label: `changelog ${issueId}` },
    );
    const values = page.values ?? [];
    entries.push(...values);
    const total = page.total;
    const isLast =
      page.isLast === true ||
      values.length === 0 ||
      (typeof total === 'number' && entries.length >= total);
    if (isLast) return { entries, truncated: false };
    if (entries.length >= deps.maxChangelogEntries) {
      // Truncated rather than partial-and-silent: the panel says so, exactly
      // as the report table's "partial history" lozenge does.
      return { entries: entries.slice(0, deps.maxChangelogEntries), truncated: true };
    }
    startAt += values.length;
  }
}
