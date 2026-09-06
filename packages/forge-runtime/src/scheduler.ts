import type { BackfillJob, Scheduler } from '@jfm/engine';

/**
 * Backfill continuation over Forge's Async Events queue.
 *
 * The backfill in `@jfm/engine` deliberately knows nothing about how it is
 * re-invoked; it asks a `Scheduler` for the next slice. On Forge that is a
 * `@forge/events` queue, which re-invokes the consumer function with the job
 * payload, giving each slice its own invocation budget.
 */

/** Shape of the `@forge/events` Queue used here, declared structurally. */
export interface ForgeQueueLike {
  push(payload: unknown, options?: { delayInSeconds?: number }): Promise<unknown>;
}

export interface QueueSchedulerOptions {
  /**
   * Seconds to wait before the next slice runs. A small delay is deliberate:
   * it spaces Jira requests out and keeps a large backfill from looking like a
   * burst to the tenant's rate limiter.
   */
  readonly delaySeconds?: number;
  /**
   * Refuse to schedule past this many slices. A backfill that has not finished
   * in this many slices is a bug or a pathological instance, and either way it
   * should stop rather than loop forever at the customer's expense.
   */
  readonly maxSlices?: number;
}

export const DEFAULT_SCHEDULER_OPTIONS: Required<QueueSchedulerOptions> = {
  delaySeconds: 5,
  maxSlices: 5_000,
};

export class QueueScheduler implements Scheduler {
  private readonly options: Required<QueueSchedulerOptions>;

  constructor(
    private readonly queue: ForgeQueueLike,
    options: QueueSchedulerOptions = {},
  ) {
    this.options = { ...DEFAULT_SCHEDULER_OPTIONS, ...options };
  }

  async enqueueBackfill(job: BackfillJob): Promise<void> {
    if (job.slice > this.options.maxSlices) {
      throw new Error(
        `Refusing to schedule backfill slice ${job.slice} for project ${job.projectId}: ` +
          `over the ${this.options.maxSlices}-slice ceiling`,
      );
    }
    await this.queue.push(
      { projectId: job.projectId, cursor: job.cursor, slice: job.slice },
      { delayInSeconds: this.options.delaySeconds },
    );
  }
}

/** Parse a queue payload back into a job, tolerating anything unexpected. */
export function jobFromPayload(payload: unknown): BackfillJob | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const projectId = record['projectId'];
  if (typeof projectId !== 'string' || projectId === '') return null;
  const cursor = record['cursor'];
  const slice = record['slice'];
  return {
    projectId,
    cursor: typeof cursor === 'string' ? cursor : null,
    slice: typeof slice === 'number' && Number.isFinite(slice) ? slice : 0,
  };
}
