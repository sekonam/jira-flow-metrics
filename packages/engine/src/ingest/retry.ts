import { HttpError, type Logger, type Sleeper } from './ports.js';

/**
 * Retry with exponential backoff and full jitter, honouring `Retry-After`.
 *
 * Jira Cloud rate-limits per app *and* per tenant, and a backfill is the single
 * most likely thing in this product to trip it. Getting this wrong does not
 * merely slow the backfill down — repeated 429s against a tenant are the kind
 * of thing that gets an app pulled from the Marketplace, so the defaults here
 * are deliberately timid.
 *
 * Full jitter (rather than "exponential + small random") is used because every
 * install that backfills at the same time would otherwise retry in lockstep.
 */

export interface RetryOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  /** Deterministic source of randomness; tests inject a constant. */
  readonly random?: () => number;
  readonly sleeper: Sleeper;
  readonly logger?: Logger;
  /** Human-readable label used in logs. */
  readonly label?: string;
}

export const DEFAULT_RETRY: Required<
  Pick<RetryOptions, 'maxAttempts' | 'baseDelayMs' | 'maxDelayMs'>
> = {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
};

/**
 * Delay before attempt `attempt` (1-based), in milliseconds.
 * A server-supplied `Retry-After` always wins over the computed backoff.
 */
export function backoffDelayMs(
  attempt: number,
  options: {
    baseDelayMs?: number;
    maxDelayMs?: number;
    retryAfterMs?: number | null;
    random?: () => number;
  } = {},
): number {
  const retryAfter = options.retryAfterMs ?? null;
  if (retryAfter !== null && retryAfter >= 0) {
    return Math.min(retryAfter, options.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs);
  }
  const base = options.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs;
  const max = options.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs;
  const random = options.random ?? Math.random;
  const ceiling = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * ceiling);
}

/** Parse an HTTP `Retry-After` header (delta-seconds or HTTP-date) to millis. */
export function parseRetryAfter(header: string | null | undefined, now: number): number | null {
  if (header === null || header === undefined) return null;
  const trimmed = header.trim();
  if (trimmed === '') return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

/**
 * Run `operation`, retrying retryable HTTP failures.
 * Non-retryable errors propagate immediately — a 403 will not fix itself and
 * burning four more requests on it only makes the rate-limit situation worse.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_RETRY.maxAttempts;
  const label = options.label ?? 'jira request';
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error: unknown) {
      lastError = error;
      const retryable = error instanceof HttpError ? error.retryable : isTransient(error);
      if (!retryable || attempt === maxAttempts) throw error;
      const delay = backoffDelayMs(attempt, {
        ...(options.baseDelayMs === undefined ? {} : { baseDelayMs: options.baseDelayMs }),
        ...(options.maxDelayMs === undefined ? {} : { maxDelayMs: options.maxDelayMs }),
        retryAfterMs: error instanceof HttpError ? error.retryAfterMs : null,
        ...(options.random === undefined ? {} : { random: options.random }),
      });
      options.logger?.log('warn', `${label} failed, retrying`, {
        attempt,
        maxAttempts,
        delayMs: delay,
        status: error instanceof HttpError ? error.status : undefined,
      });
      await options.sleeper.sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Network-level failures worth one more try. Deliberately narrow: an unknown
 * error is treated as permanent so a genuine bug surfaces instead of being
 * retried five times and then surfacing anyway.
 */
function isTransient(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND' ||
    /fetch failed|network|socket hang up/i.test(error.message)
  );
}
