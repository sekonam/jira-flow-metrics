import type {
  JiraChangelogPage,
  JiraSearchPage,
  JiraWorklogPage,
  JiraIssue,
} from '../jira/types.js';
import type { Millis, StatusMeta } from '../types.js';

/**
 * The ports the ingestion pipeline talks to.
 *
 * Everything the engine does against the outside world goes through one of
 * these interfaces. The Forge implementations live in `forge/`; the tests use
 * fixture-backed fakes. **No test in this repository performs a live network
 * call**, which is what makes the suite deterministic and runnable in CI.
 */

export interface SearchParams {
  readonly jql: string;
  /** Page token from the previous response. Absent means "first page". */
  readonly nextPageToken?: string | undefined;
  readonly maxResults: number;
  readonly fields: readonly string[];
  /** When true, ask Jira to inline the changelog (`expand=changelog`). */
  readonly expandChangelog?: boolean;
}

export interface PageParams {
  readonly startAt: number;
  readonly maxResults: number;
}

/** Read-only Jira access. The apps never write to Jira. */
export interface JiraApi {
  /**
   * Can the **current user** browse this project?
   *
   * Every other method on this port reads Jira *as the app*, which by design
   * ignores the caller's Jira permissions. Without this check, any user of the
   * instance who could reach a report surface would read any project's
   * aggregates. Implementations must ask Jira as the user, and must fail
   * closed — a failure to determine the answer is not permission.
   */
  canBrowseProject(projectId: string): Promise<boolean>;

  searchIssues(params: SearchParams): Promise<JiraSearchPage>;
  getIssue(issueIdOrKey: string, fields: readonly string[]): Promise<JiraIssue>;
  getChangelog(issueIdOrKey: string, page: PageParams): Promise<JiraChangelogPage>;
  getWorklogs(issueIdOrKey: string, page: PageParams): Promise<JiraWorklogPage>;
  /** `/rest/api/3/status`, used to resolve status categories and names. */
  getStatuses(): Promise<readonly StatusMeta[]>;
}

export interface Clock {
  now(): Millis;
}

export const systemClock: Clock = { now: () => Date.now() };

export interface Sleeper {
  sleep(ms: number): Promise<void>;
}

export const realSleeper: Sleeper = {
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  log(level: LogLevel, message: string, context?: Readonly<Record<string, unknown>>): void;
}

export const silentLogger: Logger = { log: () => undefined };

/**
 * Continuation port. Backfill never runs to completion inside one Forge
 * invocation; it processes a slice and asks the host to schedule the next one.
 * On Forge this is the Async Events queue; in tests it is a spy.
 */
export interface Scheduler {
  /** Ask the host to invoke the backfill again with the given cursor. */
  enqueueBackfill(job: BackfillJob): Promise<void>;
}

export interface BackfillJob {
  readonly projectId: string;
  readonly cursor: string | null;
  /** Increments on every slice; used to spot runaway loops in logs. */
  readonly slice: number;
}

/** Error type the Jira adapter throws so the retry layer can act on it. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Parsed `Retry-After`, in milliseconds, when the server sent one. */
    readonly retryAfterMs: number | null = null,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  /** 429 and 5xx are worth retrying; 4xx other than 429 are not. */
  get retryable(): boolean {
    return this.status === 429 || this.status === 408 || this.status >= 500;
  }
}
