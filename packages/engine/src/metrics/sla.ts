import { addBusinessMs, businessMsIn, type WorkingCalendar } from '../time/calendar.js';
import { close, duration, subtract } from '../time/interval.js';
import type { ClosedInterval, IssueTimeline, Millis, StatusId } from '../types.js';

/**
 * SLA and due-date breach evaluation — the engine behind listing 4.
 *
 * A goal is defined as: **start when the issue enters any of `startStatusIds`,
 * stop when it enters any of `stopStatusIds`, pause while it sits in any of
 * `pauseStatusIds`, and measure against a working calendar.** That is the model
 * Jira Service Management uses, and matching it means users do not have to
 * learn a second mental model.
 *
 * The paused-status subtraction is the part that is easy to get quietly wrong,
 * so it is implemented with explicit interval algebra
 * (`subtract` in `time/interval.ts`) rather than with running counters.
 */

export interface SlaGoal {
  readonly id: string;
  readonly name: string;
  /** Entering any of these starts the clock. Empty means "issue creation". */
  readonly startStatusIds: readonly StatusId[];
  /** Entering any of these stops the clock for good. */
  readonly stopStatusIds: readonly StatusId[];
  /** Time in these statuses does not count. */
  readonly pauseStatusIds: readonly StatusId[];
  /** Target duration in working milliseconds, per the calendar. */
  readonly targetMs: Millis;
  readonly calendar: WorkingCalendar;
}

export type SlaState = 'not_started' | 'running' | 'paused' | 'met' | 'breached';

export interface SlaResult {
  readonly issueId: string;
  readonly issueKey: string;
  readonly goalId: string;
  readonly state: SlaState;
  readonly startedAt: Millis | null;
  readonly stoppedAt: Millis | null;
  /** Working milliseconds consumed, excluding paused time. */
  readonly elapsedWorkingMs: Millis;
  /** `targetMs - elapsedWorkingMs`; negative once breached. */
  readonly remainingMs: Millis;
  /** Instant the goal will breach (or did). `null` when not started or stopped. */
  readonly breachAt: Millis | null;
  readonly breached: boolean;
  /** Working milliseconds spent paused; surfaced so users can audit the number. */
  readonly pausedMs: Millis;
}

export function evaluateSla(
  timeline: IssueTimeline,
  goal: SlaGoal,
  now: Millis = Date.now(),
): SlaResult {
  const startSet = new Set(goal.startStatusIds);
  const stopSet = new Set(goal.stopStatusIds);
  const pauseSet = new Set(goal.pauseStatusIds);

  let startedAt: Millis | null = startSet.size === 0 ? timeline.createdAt : null;
  let stoppedAt: Millis | null = null;

  for (const interval of timeline.intervals) {
    if (startedAt === null && startSet.has(interval.statusId)) startedAt = interval.start;
    if (startedAt !== null && stoppedAt === null && stopSet.has(interval.statusId)) {
      stoppedAt = interval.start;
      break;
    }
  }

  if (startedAt === null) {
    return {
      issueId: timeline.issueId,
      issueKey: timeline.issueKey,
      goalId: goal.id,
      state: 'not_started',
      startedAt: null,
      stoppedAt: null,
      elapsedWorkingMs: 0,
      remainingMs: goal.targetMs,
      breachAt: null,
      breached: false,
      pausedMs: 0,
    };
  }

  const span: ClosedInterval = { start: startedAt, end: Math.max(startedAt, stoppedAt ?? now) };

  const pauses: ClosedInterval[] = [];
  for (const interval of timeline.intervals) {
    if (!pauseSet.has(interval.statusId)) continue;
    const closed = close(interval, now);
    const start = Math.max(closed.start, span.start);
    const end = Math.min(closed.end, span.end);
    if (end > start) pauses.push({ start, end });
  }

  const countedSpans = subtract(span, pauses);
  const elapsedWorkingMs = countedSpans.reduce((sum, s) => sum + businessMsIn(s, goal.calendar), 0);
  const pausedMs = pauses.reduce((sum, p) => sum + businessMsIn(p, goal.calendar), 0);
  const remainingMs = goal.targetMs - elapsedWorkingMs;
  const breached = remainingMs < 0;

  const currentInterval = timeline.intervals[timeline.intervals.length - 1];
  const currentlyPaused =
    stoppedAt === null && currentInterval !== undefined && pauseSet.has(currentInterval.statusId);

  let state: SlaState;
  if (stoppedAt !== null) state = breached ? 'breached' : 'met';
  else if (breached) state = 'breached';
  else if (currentlyPaused) state = 'paused';
  else state = 'running';

  return {
    issueId: timeline.issueId,
    issueKey: timeline.issueKey,
    goalId: goal.id,
    state,
    startedAt,
    stoppedAt,
    elapsedWorkingMs,
    remainingMs,
    breachAt: projectBreachInstant(span, elapsedWorkingMs, goal, stoppedAt, currentlyPaused, now),
    breached,
    pausedMs,
  };
}

/**
 * When will (or did) this goal breach?
 *
 * For a stopped goal there is no future instant, so we return `null` rather
 * than a misleading extrapolation. For a paused goal the answer genuinely
 * depends on when it resumes, so we also return `null` — reporting a breach
 * time that silently assumes "resumes right now" is the kind of quiet
 * wrongness this codebase is trying to avoid.
 */
function projectBreachInstant(
  span: ClosedInterval,
  elapsedWorkingMs: Millis,
  goal: SlaGoal,
  stoppedAt: Millis | null,
  currentlyPaused: boolean,
  now: Millis,
): Millis | null {
  if (stoppedAt !== null || currentlyPaused) return null;
  const remaining = goal.targetMs - elapsedWorkingMs;
  if (remaining <= 0) {
    // Already breached: report the instant it happened, found by walking the
    // counted span forward by exactly `targetMs` of working time.
    return addBusinessMs(span.start, goal.targetMs, goal.calendar);
  }
  return addBusinessMs(now, remaining, goal.calendar);
}

export interface DueDateResult {
  readonly issueId: string;
  readonly issueKey: string;
  readonly dueAt: Millis | null;
  readonly resolvedAt: Millis | null;
  readonly breached: boolean;
  /** Positive when late, negative when early. `null` without a due date. */
  readonly overdueByMs: Millis | null;
}

/** Plain due-date breach, which is what most non-JSM projects actually track. */
export function evaluateDueDate(
  input: {
    readonly issueId: string;
    readonly issueKey: string;
    readonly dueAt: Millis | null;
    readonly resolvedAt: Millis | null;
  },
  now: Millis = Date.now(),
): DueDateResult {
  if (input.dueAt === null) {
    return { ...input, breached: false, overdueByMs: null };
  }
  const reference = input.resolvedAt ?? now;
  const overdueByMs = reference - input.dueAt;
  return { ...input, breached: overdueByMs > 0, overdueByMs };
}

/** Share of results that met their goal, as a 0-1 fraction. `null` when empty. */
export function attainmentRate(results: readonly SlaResult[]): number | null {
  const finished = results.filter((r) => r.state === 'met' || r.state === 'breached');
  if (finished.length === 0) return null;
  return finished.filter((r) => !r.breached).length / finished.length;
}

/** Total working time consumed across a set of goals, for a summary tile. */
export function totalWorkingMs(results: readonly SlaResult[]): Millis {
  return results.reduce((sum, r) => sum + r.elapsedWorkingMs, 0);
}

/** Convenience: the working duration of a closed span under a calendar. */
export function workingSpanMs(span: ClosedInterval, calendar: WorkingCalendar): Millis {
  return duration(span) === 0 ? 0 : businessMsIn(span, calendar);
}
