/**
 * Core domain types for the duration-analytics engine.
 *
 * Every timestamp in the engine is an **epoch-millisecond number in UTC**.
 * Local/wall-clock time exists only inside `time/calendar.ts`, where a
 * `WorkingCalendar` converts between the two. Keeping instants as numbers
 * removes a whole class of timezone bugs from the aggregation code.
 */

/** Epoch milliseconds, UTC. */
export type Millis = number;

/** A Jira status id. Aggregates are always keyed on the id, never the name. */
export type StatusId = string;

/**
 * Jira's three status categories. Cycle-time style metrics are defined in
 * terms of these rather than of individual statuses, because every instance
 * names its statuses differently but the categories are fixed.
 */
export type StatusCategory = 'todo' | 'inprogress' | 'done' | 'unknown';

/** Static metadata about a status, resolved from `/rest/api/3/status`. */
export interface StatusMeta {
  readonly id: StatusId;
  readonly name: string;
  readonly category: StatusCategory;
}

/** A half-open interval `[start, end)` in epoch milliseconds. */
export interface Interval {
  readonly start: Millis;
  /** `null` means "still open" — the interval runs to the evaluation instant. */
  readonly end: Millis | null;
}

/** A closed half-open interval; `end` is always known. */
export interface ClosedInterval {
  readonly start: Millis;
  readonly end: Millis;
}

/** One continuous period an issue spent in one status. */
export interface StatusInterval {
  readonly statusId: StatusId;
  /** Status name as recorded in the changelog at the time of the transition. */
  readonly statusName: string;
  readonly start: Millis;
  /** `null` for the currently-open interval. */
  readonly end: Millis | null;
  /** 1-based ordinal of this visit to this status (2 means "re-entered once"). */
  readonly entryOrdinal: number;
}

/**
 * The reconstructed status timeline of a single issue, plus everything the
 * aggregators need that cannot be recomputed from the intervals alone.
 */
export interface IssueTimeline {
  readonly issueId: string;
  readonly issueKey: string;
  readonly projectId: string;
  readonly createdAt: Millis;
  readonly intervals: readonly StatusInterval[];
  /** Names observed for each status id, newest last. Statuses get renamed. */
  readonly statusNames: ReadonlyMap<StatusId, readonly string[]>;
  /** True when the changelog was truncated and the timeline may be partial. */
  readonly truncated: boolean;
}

/** Cumulative time an issue spent in one status, across every re-entry. */
export interface StatusDuration {
  readonly statusId: StatusId;
  readonly statusName: string;
  /** Wall-clock milliseconds, summed over every visit. */
  readonly elapsedMs: Millis;
  /** Milliseconds inside the working calendar, summed over every visit. */
  readonly businessMs: Millis;
  /** Number of separate visits to this status. */
  readonly entries: number;
  /** Start of the most recent visit. */
  readonly lastEnteredAt: Millis;
  /** End of the most recent visit, or `null` if the issue is still in it. */
  readonly lastExitedAt: Millis | null;
}

/** The full per-issue result: one row per status the issue has ever been in. */
export interface IssueStatusDurations {
  readonly issueId: string;
  readonly issueKey: string;
  readonly projectId: string;
  readonly createdAt: Millis;
  /** The status the issue is in at the evaluation instant. */
  readonly currentStatusId: StatusId | null;
  readonly durations: readonly StatusDuration[];
  /** Evaluation instant used to close the open interval. */
  readonly evaluatedAt: Millis;
  readonly truncated: boolean;
}

/** Which clock a report is expressed in. */
export type DurationBasis = 'elapsed' | 'business';

export const DURATION_BASES: readonly DurationBasis[] = ['elapsed', 'business'];

/** Thrown when input data is structurally unusable. Never used for control flow. */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}
