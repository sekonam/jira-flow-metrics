import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DATASETS_ALL,
  MemoryStore,
  type JiraApi,
  type JiraChangelogEntry,
  type JiraChangelogPage,
  type JiraIssue,
  type JiraProjectRef,
  type JiraSearchPage,
  type JiraWorklogEntry,
  type JiraWorklogPage,
  type Millis,
  type PageParams,
  type SearchParams,
  type StatusMeta,
} from '@jfm/engine';
import { RecordingSqlExecutor } from '../sql/executor.js';
import { SettingsStore } from '../settings.js';
import { ListingRuntime } from '../runtime.js';
import { handleBackfillJob, handleStartIndexing } from '../handlers.js';

/**
 * The recorded-payloads-to-reported-numbers pipeline, as a reusable fixture.
 *
 * This lives in `src/testing/` rather than in a test file because **two**
 * suites need the identical scenario and they sit in different packages:
 *
 * - `packages/forge-runtime/test/end-to-end.test.ts` asserts the numbers that
 *   come out of the resolver;
 * - the UI suites assert that *those same numbers* reach the DOM.
 *
 * Duplicating the fixture would let the two drift, and a UI test asserting
 * numbers that no longer match the engine's would be worse than no UI test at
 * all. One definition, imported twice.
 *
 * It is exported from `@jfm/forge-runtime/testing`, deliberately **not** from
 * the package index, so it never reaches a Forge bundle: it reads fixture JSON
 * from disk with `node:fs`, which does not exist in the Forge sandbox.
 */

const HOUR = 3_600_000;

/** Thursday 2026-03-05 12:00 UTC, so the open interval has a known length. */
export const PIPELINE_NOW: Millis = Date.parse('2026-03-05T12:00:00Z');

export const PIPELINE_PROJECT_ID = '10000';

export const PIPELINE_CONTEXT = { extension: { project: { id: PIPELINE_PROJECT_ID } } };

/**
 * Locate the workspace root by walking up from the working directory.
 *
 * Deliberately **not** derived from `import.meta.url`: under Vitest's jsdom
 * environment the global `URL` is jsdom's implementation rather than Node's,
 * and `fileURLToPath(new URL(relative, import.meta.url))` silently loses the
 * leading path segments — it returns `/packages/engine/...` instead of an
 * absolute path inside the repository. The UI suites run under jsdom and read
 * these same fixtures, so the lookup has to work in both environments.
 */
const FIXTURE_PATH = ['packages', 'engine', 'test', 'fixtures'];

function fixtureDir(): string {
  let dir = process.cwd();
  for (let hop = 0; hop < 10; hop += 1) {
    // Anchored on the fixtures themselves rather than on `pnpm-workspace.yaml`.
    // A checkout nested inside another pnpm workspace would match the outer
    // marker and then fail with an opaque ENOENT at module scope.
    const candidate = join(dir, ...FIXTURE_PATH);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `could not find ${FIXTURE_PATH.join('/')} at or above ${process.cwd()}; ` +
      'this module must be run from inside the jira-flow-metrics workspace.',
  );
}

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixtureDir(), name), 'utf8')) as T;
}

export const CHANGELOG_FIXTURE = fixture<JiraChangelogPage>('changelog-reentry.json');
export const WORKLOG_FIXTURE = fixture<JiraWorklogPage>('worklogs.json');

export const PIPELINE_STATUSES: readonly StatusMeta[] = [
  { id: '10000', name: 'To Do', category: 'todo' },
  { id: '3', name: 'In Progress', category: 'inprogress' },
  { id: '10100', name: 'Blocked', category: 'todo' },
  { id: '10200', name: 'In Review', category: 'inprogress' },
  { id: '10001', name: 'Done', category: 'done' },
];

/** One issue plus the payloads Jira would return for it. */
export interface FixtureIssue {
  readonly issue: JiraIssue;
  readonly changelog: readonly JiraChangelogEntry[];
  readonly worklogs: readonly JiraWorklogEntry[];
}

/**
 * The canonical issue: created Mon 2026-03-02 08:00 UTC, with the re-entry
 * history that Jira's own control chart cannot report.
 *
 * The `changelog` on the issue itself is deliberately partial so the ingester
 * must page the changelog separately — the path a real large issue takes.
 */
export const CANONICAL_ISSUE: FixtureIssue = {
  issue: {
    id: '20003',
    key: 'FLOW-3',
    fields: {
      summary: 'Checkout fails for guest customers on the second attempt',
      created: '2026-03-02T08:00:00.000+0000',
      updated: '2026-03-05T11:30:00.000+0000',
      resolutiondate: '2026-03-05T11:30:00.000+0000',
      status: { id: '10001', name: 'Done', statusCategory: { key: 'done' } },
      project: { id: PIPELINE_PROJECT_ID, key: 'FLOW' },
    },
    changelog: { total: 5, values: [], isLast: false },
  },
  changelog: CHANGELOG_FIXTURE.values ?? [],
  worklogs: WORKLOG_FIXTURE.worklogs ?? [],
};

function statusChange(
  at: string,
  from: readonly [string, string],
  to: readonly [string, string],
): JiraChangelogEntry {
  return {
    id: `9${at.slice(8, 10)}${at.slice(11, 13)}`,
    created: at,
    author: { accountId: 'acc-anna', displayName: 'Anna Weber', active: true },
    items: [
      {
        field: 'status',
        fieldtype: 'jira',
        fieldId: 'status',
        from: from[0],
        fromString: from[1],
        to: to[0],
        toString: to[1],
      },
    ],
  };
}

const TO_DO = ['10000', 'To Do'] as const;
const IN_PROGRESS = ['3', 'In Progress'] as const;
const BLOCKED = ['10100', 'Blocked'] as const;

/**
 * Three additional unfinished issues.
 *
 * The canonical issue is resolved, so on its own it produces an **empty** WIP
 * aging report — every screen of listing 3 would be the empty state. These
 * exist so the populated screens have work in flight. They are ordinary
 * changelogs run through the same real engine; no number in any report is
 * hand-written.
 */
export const IN_FLIGHT_ISSUES: readonly FixtureIssue[] = [
  {
    issue: {
      id: '20001',
      key: 'FLOW-1',
      fields: {
        summary: 'Search returns stale results after a bulk import',
        created: '2026-02-23T08:00:00.000+0000',
        updated: '2026-02-23T09:00:00.000+0000',
        resolutiondate: null,
        duedate: '2026-03-04',
        status: { id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        project: { id: PIPELINE_PROJECT_ID, key: 'FLOW' },
      },
      changelog: { total: 1, values: [], isLast: false },
    },
    changelog: [statusChange('2026-02-23T09:00:00.000+0000', TO_DO, IN_PROGRESS)],
    worklogs: [],
  },
  {
    issue: {
      id: '20002',
      key: 'FLOW-2',
      fields: {
        summary: 'Invoice PDF renders the wrong VAT rate for Austrian customers',
        created: '2026-03-03T10:00:00.000+0000',
        updated: '2026-03-03T14:00:00.000+0000',
        resolutiondate: null,
        duedate: '2026-03-06',
        status: { id: '10100', name: 'Blocked', statusCategory: { key: 'new' } },
        project: { id: PIPELINE_PROJECT_ID, key: 'FLOW' },
      },
      changelog: { total: 2, values: [], isLast: false },
    },
    changelog: [
      statusChange('2026-03-03T11:00:00.000+0000', TO_DO, IN_PROGRESS),
      statusChange('2026-03-03T14:00:00.000+0000', IN_PROGRESS, BLOCKED),
    ],
    worklogs: [],
  },
  {
    issue: {
      id: '20004',
      key: 'FLOW-4',
      fields: {
        summary: 'Add a webhook for subscription cancellations',
        created: '2026-03-05T08:00:00.000+0000',
        updated: '2026-03-05T08:00:00.000+0000',
        resolutiondate: null,
        status: { id: '10000', name: 'To Do', statusCategory: { key: 'new' } },
        project: { id: PIPELINE_PROJECT_ID, key: 'FLOW' },
      },
      changelog: { total: 0, values: [], isLast: true },
    },
    changelog: [],
    worklogs: [],
  },
];

/**
 * A `JiraApi` served entirely from fixtures, which records every call.
 *
 * Request counts are asserted rather than ignored: the number of Jira requests
 * a backfill makes is what decides whether it trips a rate limit on a real
 * instance.
 */
export class FixtureJira implements JiraApi {
  readonly requests: string[] = [];

  constructor(
    private readonly issues: readonly FixtureIssue[],
    /** Changelog page size. Small values force the pager to run. */
    private readonly changelogPageSize = 2,
    private readonly browseAllowed = true,
    /**
     * The status catalogue this Jira reports. Defaults to the canned one, so
     * every existing suite is unaffected; a caller driving the pipeline with
     * issues from a real site passes that site's catalogue instead, otherwise
     * every status it does not recognise is rendered as its bare numeric id.
     */
    private readonly statuses: readonly StatusMeta[] = PIPELINE_STATUSES,
  ) {}

  canBrowseProject(): Promise<boolean> {
    this.requests.push('mypermissions');
    return Promise.resolve(this.browseAllowed);
  }

  searchIssues(params: SearchParams): Promise<JiraSearchPage> {
    this.requests.push('search');
    const start = params.nextPageToken === undefined ? 0 : Number(params.nextPageToken);
    const slice = this.issues.slice(start, start + params.maxResults);
    const next = start + slice.length;
    const isLast = next >= this.issues.length;
    return Promise.resolve({
      issues: slice.map((f) => f.issue),
      isLast,
      nextPageToken: isLast ? null : String(next),
      total: this.issues.length,
    });
  }

  getIssue(issueIdOrKey: string): Promise<JiraIssue> {
    this.requests.push('issue');
    return Promise.resolve(this.find(issueIdOrKey).issue);
  }

  getChangelog(issueIdOrKey: string, page: PageParams): Promise<JiraChangelogPage> {
    this.requests.push(`changelog@${page.startAt}`);
    const all = this.find(issueIdOrKey).changelog;
    const values = all.slice(page.startAt, page.startAt + this.changelogPageSize);
    return Promise.resolve({
      startAt: page.startAt,
      maxResults: this.changelogPageSize,
      total: all.length,
      isLast: page.startAt + values.length >= all.length,
      values,
    });
  }

  getWorklogs(issueIdOrKey: string): Promise<JiraWorklogPage> {
    this.requests.push('worklog');
    const worklogs = this.find(issueIdOrKey).worklogs;
    return Promise.resolve({ startAt: 0, maxResults: 100, total: worklogs.length, worklogs });
  }

  getStatuses(): Promise<readonly StatusMeta[]> {
    this.requests.push('status');
    return Promise.resolve(this.statuses);
  }

  listProjects(): Promise<readonly JiraProjectRef[]> {
    return Promise.resolve([]);
  }

  private find(issueIdOrKey: string): FixtureIssue {
    const found = this.issues.find(
      (f) => f.issue.id === issueIdOrKey || f.issue.key === issueIdOrKey,
    );
    if (found === undefined) throw new Error(`fixture has no issue ${issueIdOrKey}`);
    return found;
  }
}

export interface PipelineOptions {
  readonly issues?: readonly FixtureIssue[];
  /** The status catalogue Jira reports. Defaults to `PIPELINE_STATUSES`. */
  readonly statuses?: readonly StatusMeta[];
  readonly now?: Millis;
  /** Issues per search page. */
  readonly pageSize?: number;
  readonly issuesPerSlice?: number;
  /**
   * Stop draining the backfill queue after this many slices, leaving the index
   * incomplete. This is how the "backfill still running" product state — which
   * is a real state a customer sees for minutes on a large instance — is
   * reproduced without faking anything.
   */
  readonly maxSlices?: number;
  readonly listingId?: string;
  /**
   * Skip `startIndexing` entirely, leaving the project with no index state.
   * This is what a freshly-installed app looks like before anyone presses the
   * button, and it is a different screen from "indexed, but no issues".
   */
  readonly startIndexing?: boolean;
  /**
   * Whether the calling user may browse the project. `false` drives the real
   * refusal path in `authoriseProject`, so the error screen shows the message
   * the product would actually produce rather than a message invented here.
   */
  readonly browseAllowed?: boolean;
}

export interface PipelineResult {
  readonly runtime: ListingRuntime;
  readonly store: MemoryStore;
  readonly jira: FixtureJira;
  /** Slices still waiting when draining stopped. */
  readonly pending: readonly { projectId: string; slice: number }[];
}

/**
 * Run the whole pipeline: start indexing, drain the async-events queue exactly
 * as the Forge consumer would, and hand back a runtime the resolvers can be
 * called against.
 */
export async function runPipeline(options: PipelineOptions = {}): Promise<PipelineResult> {
  const issues = options.issues ?? [CANONICAL_ISSUE];
  const store = new MemoryStore();
  const jira = new FixtureJira(issues, 2, options.browseAllowed ?? true, options.statuses);
  const sql = new RecordingSqlExecutor();
  const settings = new SettingsStore(sql);
  const queue: { projectId: string; slice: number }[] = [];
  const now = options.now ?? PIPELINE_NOW;

  const runtime = new ListingRuntime(
    {
      api: jira,
      store,
      settings,
      scheduler: {
        enqueueBackfill: (job) => {
          queue.push(job);
          return Promise.resolve();
        },
      },
      sleeper: { sleep: () => Promise.resolve() },
      clock: { now: () => now },
    },
    {
      listingId: options.listingId ?? 'time-in-status',
      datasets: DATASETS_ALL,
      ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
      ...(options.issuesPerSlice === undefined ? {} : { issuesPerSlice: options.issuesPerSlice }),
    },
  );

  if (options.startIndexing !== false) {
    await handleStartIndexing(runtime, { context: PIPELINE_CONTEXT });
  }

  const maxSlices = options.maxSlices ?? Number.POSITIVE_INFINITY;
  let ran = 0;
  let guard = 0;
  // A safety net against a real bug (a slice that re-enqueues without ever
  // finishing), not a ceiling callers are meant to hit. It used to be 50,
  // silently: a fixture set needing more slices than that got `pending`
  // entries back with no error, which is indistinguishable from "the backfill
  // finished" unless the caller happens to check `pending.length`. 5,000
  // issues at the default `issuesPerSlice: 100` alone need 50 slices — this
  // was truncating any test at exactly that scale.
  const SAFETY_SLICE_CAP = 5000;
  while (queue.length > 0 && ran < maxSlices && guard < SAFETY_SLICE_CAP) {
    const job = queue.shift()!;
    await handleBackfillJob(runtime, { ...job, cursor: null });
    ran += 1;
    guard += 1;
  }
  if (guard >= SAFETY_SLICE_CAP && queue.length > 0) {
    throw new Error(
      `runPipeline: stopped after ${String(SAFETY_SLICE_CAP)} slices with ${String(queue.length)} ` +
        'still queued. This looks like a real bug (a slice re-enqueuing without making progress), ' +
        'not a fixture set this large — raise SAFETY_SLICE_CAP only if you are certain otherwise.',
    );
  }
  return { runtime, store, jira, pending: [...queue] };
}

/** The numbers the pipeline is known to produce, asserted in two packages. */
export const EXPECTED = {
  issueKey: 'FLOW-3',
  /** Cumulative elapsed milliseconds per status id for the canonical issue. */
  elapsedByStatus: {
    '10000': 1 * HOUR,
    '3': 12 * HOUR,
    '10100': 44 * HOUR,
    '10200': 18.5 * HOUR,
    '10001': 0.5 * HOUR,
  },
  elapsedTotal: 76 * HOUR,
  businessByStatus: {
    '10000': 0,
    '3': 12 * HOUR,
    '10100': 12 * HOUR,
    '10200': 2.5 * HOUR,
    '10001': 0.5 * HOUR,
  },
  businessTotal: 27 * HOUR,
  /** In Progress was entered twice; Blocked once. */
  inProgressEntries: 2,
  columnOrder: ['Blocked', 'To Do', 'In Progress', 'In Review', 'Done'],
} as const;
