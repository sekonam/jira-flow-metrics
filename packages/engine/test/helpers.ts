import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { reconstructTimeline } from '../src/changelog/reconstruct.js';
import type {
  JiraChangelogEntry,
  JiraChangelogPage,
  JiraIssue,
  JiraSearchPage,
  JiraWorklogPage,
} from '../src/jira/types.js';
import type { JiraApi, PageParams, SearchParams, Sleeper } from '../src/ingest/ports.js';
import { categoryResolver } from '../src/metrics/cycle-time.js';
import { normaliseCalendar, standardBusinessCalendar } from '../src/time/calendar.js';
import type { IssueTimeline, StatusMeta } from '../src/types.js';

/**
 * Test helpers.
 *
 * **No test in this repository performs a live network call.** Everything the
 * ingestion tests see comes from the JSON fixtures in `test/fixtures/`, served
 * by `FakeJiraApi` below, which also records what was asked of it so tests can
 * assert on request counts — the number that decides whether a backfill trips
 * Jira's rate limit.
 */

export function loadFixture<T>(name: string): T {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** The status set used across the tests, matching the fixtures. */
export const TEST_STATUSES: readonly StatusMeta[] = [
  { id: '10000', name: 'To Do', category: 'todo' },
  { id: '3', name: 'In Progress', category: 'inprogress' },
  { id: '10100', name: 'Blocked', category: 'todo' },
  { id: '10200', name: 'In Review', category: 'inprogress' },
  { id: '10001', name: 'Done', category: 'done' },
];

export const TEST_RESOLVER = categoryResolver(TEST_STATUSES);

/** Mon-Fri 09:00-17:00 UTC, the calendar the arithmetic in comments assumes. */
export const UTC_BUSINESS_CALENDAR = normaliseCalendar(standardBusinessCalendar('UTC'));

export const T = (iso: string): number => Date.parse(iso);

/** The re-entry scenario: In Progress is visited twice, four hours then eight. */
export function reentryTimeline(): IssueTimeline {
  const changelog = loadFixture<JiraChangelogPage>('changelog-reentry.json');
  return reconstructTimeline({
    issueId: '20003',
    issueKey: 'FLOW-3',
    projectId: '10000',
    createdAt: T('2026-03-02T08:00:00Z'),
    currentStatusId: '10001',
    currentStatusName: 'Done',
    entries: changelog.values ?? [],
  });
}

export const instantSleeper: Sleeper = {
  sleep: () => Promise.resolve(),
};

/** A sleeper that records what it was asked to wait for, and waits for nothing. */
export class RecordingSleeper implements Sleeper {
  readonly delays: number[] = [];
  sleep(ms: number): Promise<void> {
    this.delays.push(ms);
    return Promise.resolve();
  }
}

export interface FakeJiraOptions {
  readonly pages?: readonly JiraSearchPage[];
  readonly changelogs?: Readonly<Record<string, readonly JiraChangelogEntry[]>>;
  readonly worklogs?: Readonly<Record<string, JiraWorklogPage>>;
  readonly issues?: Readonly<Record<string, JiraIssue>>;
  readonly statuses?: readonly StatusMeta[];
  /** Throw this from the nth call to `searchIssues` onwards (1-based). */
  readonly failSearchFromCall?: { call: number; error: Error };
  /** Page size Jira actually honours for changelog pages. */
  readonly changelogPageSize?: number;
  /** What `canBrowseProject` answers. Defaults to true. */
  readonly canBrowse?: boolean;
}

/** Fixture-backed `JiraApi`. Records every call for assertions. */
export class FakeJiraApi implements JiraApi {
  readonly searchCalls: SearchParams[] = [];
  readonly changelogCalls: { issueId: string; page: PageParams }[] = [];
  readonly worklogCalls: string[] = [];
  readonly issueCalls: string[] = [];

  readonly permissionCalls: string[] = [];

  constructor(private readonly options: FakeJiraOptions = {}) {}

  canBrowseProject(projectId: string): Promise<boolean> {
    this.permissionCalls.push(projectId);
    return Promise.resolve(this.options.canBrowse ?? true);
  }

  searchIssues(params: SearchParams): Promise<JiraSearchPage> {
    this.searchCalls.push(params);
    const fail = this.options.failSearchFromCall;
    if (fail !== undefined && this.searchCalls.length >= fail.call) {
      return Promise.reject(fail.error);
    }
    const pages = this.options.pages ?? [];
    const index =
      params.nextPageToken === undefined
        ? 0
        : pages.findIndex((p) => p.nextPageToken === params.nextPageToken) + 1;
    const page = pages[index];
    if (page === undefined) {
      return Promise.resolve({ issues: [], isLast: true, nextPageToken: null });
    }
    return Promise.resolve(page);
  }

  getIssue(issueIdOrKey: string): Promise<JiraIssue> {
    this.issueCalls.push(issueIdOrKey);
    const issue = this.options.issues?.[issueIdOrKey];
    if (issue === undefined) return Promise.reject(new Error(`no fixture issue ${issueIdOrKey}`));
    return Promise.resolve(issue);
  }

  getChangelog(issueIdOrKey: string, page: PageParams): Promise<JiraChangelogPage> {
    this.changelogCalls.push({ issueId: issueIdOrKey, page });
    const all = this.options.changelogs?.[issueIdOrKey] ?? [];
    const size = Math.min(page.maxResults, this.options.changelogPageSize ?? page.maxResults);
    const values = all.slice(page.startAt, page.startAt + size);
    return Promise.resolve({
      startAt: page.startAt,
      maxResults: size,
      total: all.length,
      isLast: page.startAt + values.length >= all.length,
      values,
    });
  }

  getWorklogs(issueIdOrKey: string, page: PageParams): Promise<JiraWorklogPage> {
    this.worklogCalls.push(issueIdOrKey);
    const fixture = this.options.worklogs?.[issueIdOrKey];
    if (fixture === undefined) {
      return Promise.resolve({
        startAt: page.startAt,
        maxResults: page.maxResults,
        total: 0,
        worklogs: [],
      });
    }
    return Promise.resolve(fixture);
  }

  getStatuses(): Promise<readonly StatusMeta[]> {
    return Promise.resolve(this.options.statuses ?? TEST_STATUSES);
  }
}

/** A `Clock` that advances by a fixed step on every read. */
export class FakeClock {
  constructor(
    private current: number,
    private readonly stepMs = 0,
  ) {}

  now(): number {
    const value = this.current;
    this.current += this.stepMs;
    return value;
  }

  set(value: number): void {
    this.current = value;
  }
}

/** A `Scheduler` that records enqueued jobs instead of running them. */
export class RecordingScheduler {
  readonly jobs: { projectId: string; cursor: string | null; slice: number }[] = [];
  enqueueBackfill(job: { projectId: string; cursor: string | null; slice: number }): Promise<void> {
    this.jobs.push(job);
    return Promise.resolve();
  }
}
