import { describe, expect, it } from 'vitest';
import {
  buildBackfillJql,
  DEFAULT_BACKFILL_OPTIONS,
  decodeCursor,
  encodeCursor,
  formatJqlInstant,
  initialIndexState,
  isCorruptedCursor,
  quoteJql,
  runBackfillSlice,
  toProgress,
} from '../src/ingest/backfill.js';
import {
  eventAffectsDatasets,
  handleIssueDeleted,
  handleIssueUpdated,
  issueIdFromEvent,
} from '../src/ingest/incremental.js';
import {
  HttpError,
  silentLogger,
  systemClock,
  realSleeper,
  type JiraApi,
  type SearchParams,
} from '../src/ingest/ports.js';
import { backoffDelayMs, DEFAULT_RETRY, parseRetryAfter, withRetry } from '../src/ingest/retry.js';
import {
  DATASETS_ALL,
  DATASETS_HISTORY,
  DATASETS_TIME_IN_STATUS,
  DATASETS_WORKLOG,
  processIssue,
  writeProcessed,
  type IngestConfig,
} from '../src/ingest/process-issue.js';
import { MemoryStore } from '../src/store/memory-store.js';
import type {
  JiraChangelogPage,
  JiraIssue,
  JiraSearchPage,
  JiraWorklogPage,
} from '../src/jira/types.js';
import {
  FakeClock,
  FakeJiraApi,
  instantSleeper,
  loadFixture,
  RecordingScheduler,
  RecordingSleeper,
  T,
  UTC_BUSINESS_CALENDAR,
} from './helpers.js';

const NOW = T('2026-03-06T00:00:00Z');

function config(overrides: Partial<IngestConfig> = {}): IngestConfig {
  return {
    datasets: DATASETS_TIME_IN_STATUS,
    calendar: UTC_BUSINESS_CALENDAR,
    pageSize: 100,
    maxChangelogEntries: 1000,
    retry: { sleeper: instantSleeper, maxAttempts: 3, random: () => 0.5 },
    ...overrides,
  };
}

describe('retry and backoff', () => {
  it('classifies which HTTP failures are worth retrying', () => {
    expect(new HttpError(429, 'rate limited').retryable).toBe(true);
    expect(new HttpError(503, 'unavailable').retryable).toBe(true);
    expect(new HttpError(408, 'timeout').retryable).toBe(true);
    expect(new HttpError(403, 'forbidden').retryable).toBe(false);
    expect(new HttpError(404, 'gone').retryable).toBe(false);
  });

  it('grows the delay exponentially with full jitter', () => {
    const random = () => 1; // take the whole ceiling, so the growth is visible
    expect(backoffDelayMs(1, { random })).toBe(500);
    expect(backoffDelayMs(2, { random })).toBe(1000);
    expect(backoffDelayMs(3, { random })).toBe(2000);
    // Jitter genuinely reduces the delay rather than adding to a fixed base.
    expect(backoffDelayMs(3, { random: () => 0 })).toBe(0);
    expect(backoffDelayMs(20, { random })).toBe(DEFAULT_RETRY.maxDelayMs);
  });

  it('lets Retry-After override the computed backoff', () => {
    expect(backoffDelayMs(1, { retryAfterMs: 4321, random: () => 1 })).toBe(4321);
    expect(backoffDelayMs(1, { retryAfterMs: 999_999, random: () => 1 })).toBe(
      DEFAULT_RETRY.maxDelayMs,
    );
  });

  it('parses both Retry-After forms', () => {
    const now = T('2026-03-01T00:00:00Z');
    expect(parseRetryAfter('120', now)).toBe(120_000);
    expect(parseRetryAfter('Sun, 01 Mar 2026 00:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter('Sun, 01 Mar 2020 00:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('  ', now)).toBeNull();
    expect(parseRetryAfter('not a date', now)).toBeNull();
  });

  it('retries a 429 and honours its Retry-After', async () => {
    const sleeper = new RecordingSleeper();
    let calls = 0;
    const result = await withRetry(
      () => {
        calls += 1;
        if (calls < 3) return Promise.reject(new HttpError(429, 'slow down', 2000));
        return Promise.resolve('ok');
      },
      { sleeper, logger: silentLogger, maxAttempts: 5 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(sleeper.delays).toEqual([2000, 2000]);
  });

  it('does not waste attempts on a permanent failure', async () => {
    const sleeper = new RecordingSleeper();
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls += 1;
          return Promise.reject(new HttpError(403, 'forbidden'));
        },
        { sleeper, maxAttempts: 5 },
      ),
    ).rejects.toThrow('forbidden');
    expect(calls).toBe(1);
    expect(sleeper.delays).toEqual([]);
  });

  it('gives up after maxAttempts and rethrows the last error', async () => {
    const sleeper = new RecordingSleeper();
    await expect(
      withRetry(() => Promise.reject(new HttpError(500, 'boom')), { sleeper, maxAttempts: 3 }),
    ).rejects.toThrow('boom');
    expect(sleeper.delays).toHaveLength(2);
  });

  it('retries recognised transient network errors', async () => {
    const sleeper = new RecordingSleeper();
    let calls = 0;
    const result = await withRetry(
      () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('fetch failed')) : Promise.resolve(1);
      },
      { sleeper, maxAttempts: 3 },
    );
    expect(result).toBe(1);
  });

  it('treats an unknown error as permanent so real bugs surface', async () => {
    const sleeper = new RecordingSleeper();
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls += 1;
          return Promise.reject(new TypeError('x is not a function'));
        },
        { sleeper, maxAttempts: 3 },
      ),
    ).rejects.toThrow(TypeError);
    expect(calls).toBe(1);
  });

  it('exposes a real sleeper and clock for production wiring', async () => {
    expect(typeof systemClock.now()).toBe('number');
    await expect(realSleeper.sleep(0)).resolves.toBeUndefined();
  });
});

describe('processing a single issue', () => {
  const searchPage = loadFixture<JiraSearchPage>('search-page.json');
  const changelog = loadFixture<JiraChangelogPage>('changelog-reentry.json');
  const worklogs = loadFixture<JiraWorklogPage>('worklogs.json');

  it('uses the inlined changelog when it is complete, saving a request', async () => {
    const api = new FakeJiraApi();
    const processed = await processIssue(searchPage.issues![0]!, api, config(), NOW);
    expect(processed).not.toBeNull();
    expect(api.changelogCalls).toHaveLength(0);
    expect(processed!.requests).toBe(0);
    expect(processed!.meta.issueKey).toBe('FLOW-1');
    expect(processed!.meta.resolvedAt).toBe(T('2026-03-05T11:30:00Z'));
    expect(processed!.meta.dueAt).toBe(T('2026-03-04T00:00:00Z'));
  });

  it('pages the changelog when the inlined copy is partial', async () => {
    const api = new FakeJiraApi({
      changelogs: { '20002': changelog.values ?? [] },
      changelogPageSize: 2,
    });
    const processed = await processIssue(searchPage.issues![1]!, api, config(), NOW);
    // Five entries at two per page = three requests.
    expect(api.changelogCalls).toHaveLength(3);
    expect(processed!.requests).toBe(3);
    expect(processed!.aggregates.length).toBeGreaterThan(0);
  });

  it('stops paging the changelog at the configured cap and says so', async () => {
    const api = new FakeJiraApi({
      changelogs: { '20002': changelog.values ?? [] },
      changelogPageSize: 2,
    });
    const processed = await processIssue(
      searchPage.issues![1]!,
      api,
      config({ maxChangelogEntries: 2 }),
      NOW,
    );
    expect(api.changelogCalls).toHaveLength(1);
    expect(processed!.meta.truncated).toBe(true);
  });

  it('fetches worklogs only for a listing that needs them', async () => {
    const api = new FakeJiraApi({ worklogs: { '20001': worklogs } });
    const withoutWorklogs = await processIssue(searchPage.issues![0]!, api, config(), NOW);
    expect(api.worklogCalls).toHaveLength(0);
    expect(withoutWorklogs!.worklogs).toHaveLength(0);

    const withWorklogs = await processIssue(
      searchPage.issues![0]!,
      api,
      config({ datasets: DATASETS_WORKLOG }),
      NOW,
    );
    expect(api.worklogCalls).toEqual(['20001']);
    expect(withWorklogs!.worklogs).toHaveLength(3);
    // A worklog-only listing does not pay for status aggregates.
    expect(withWorklogs!.aggregates).toHaveLength(0);
  });

  it('produces history records only for the history listing', async () => {
    const api = new FakeJiraApi();
    const historyRun = await processIssue(
      searchPage.issues![0]!,
      api,
      config({ datasets: DATASETS_HISTORY }),
      NOW,
    );
    expect(historyRun!.history).toHaveLength(1);
    expect(historyRun!.aggregates).toHaveLength(0);
  });

  it('skips an issue with no id or created date instead of aborting the page', async () => {
    const api = new FakeJiraApi();
    expect(await processIssue({ key: 'X-1' }, api, config(), NOW)).toBeNull();
    expect(await processIssue({ id: '1', fields: {} }, api, config(), NOW)).toBeNull();
  });

  it('writes only the datasets a listing declares', async () => {
    const api = new FakeJiraApi({ worklogs: { '20001': worklogs } });
    const store = new MemoryStore();
    const processed = await processIssue(
      searchPage.issues![0]!,
      api,
      config({ datasets: DATASETS_ALL }),
      NOW,
    );
    await writeProcessed(store, [processed!], DATASETS_ALL);
    expect(await store.getIssueMeta('20001')).not.toBeNull();
    expect(store.aggregateRowCount).toBeGreaterThan(0);
    expect(await store.queryHistory({ projectId: '10000' })).toHaveLength(1);

    const worklogOnly = new MemoryStore();
    await writeProcessed(worklogOnly, [processed!], DATASETS_WORKLOG);
    expect(worklogOnly.aggregateRowCount).toBe(0);
    // issue_meta is still written, because every listing filters on it.
    expect(await worklogOnly.getIssueMeta('20001')).not.toBeNull();
  });

  it('is a no-op for an empty batch', async () => {
    const store = new MemoryStore();
    await writeProcessed(store, [], DATASETS_ALL);
    expect(store.aggregateRowCount).toBe(0);
  });
});

describe('backfill', () => {
  const searchPage = loadFixture<JiraSearchPage>('search-page.json');
  const changelog = loadFixture<JiraChangelogPage>('changelog-reentry.json');

  function pages(): JiraSearchPage[] {
    return [
      searchPage,
      {
        issues: [
          {
            id: '20003',
            key: 'FLOW-3',
            fields: {
              created: '2026-03-02T08:00:00.000+0000',
              status: { id: '10001', name: 'Done' },
              project: { id: '10000', key: 'FLOW' },
            },
            changelog: { total: 5, values: [] },
          },
        ],
        isLast: true,
        nextPageToken: null,
        total: 3,
      },
    ];
  }

  function deps(clock = new FakeClock(NOW), overrides: Partial<IngestConfig> = {}) {
    return {
      api: new FakeJiraApi({
        pages: pages(),
        changelogs: { '20002': changelog.values ?? [], '20003': changelog.values ?? [] },
      }),
      store: new MemoryStore(),
      scheduler: new RecordingScheduler(),
      clock,
      config: config(overrides),
      logger: silentLogger,
    };
  }

  it('builds JQL ordered by created for a stable cursor', () => {
    expect(buildBackfillJql({ ...DEFAULT_BACKFILL_OPTIONS, projectId: '10000' })).toBe(
      'project = "10000" AND level IS EMPTY ORDER BY created ASC',
    );
    expect(
      buildBackfillJql({
        ...DEFAULT_BACKFILL_OPTIONS,
        projectId: '10000',
        historyFrom: T('2026-01-01T00:00:00Z'),
      }),
    ).toBe(
      'project = "10000" AND level IS EMPTY AND created >= "2026/01/01 00:00" ORDER BY created ASC',
    );
  });

  it('excludes issues carrying a Jira issue security level by default', () => {
    // The app reads Jira as itself, so a restricted issue would otherwise be
    // aggregated into a report shown to people the restriction excludes.
    expect(buildBackfillJql({ ...DEFAULT_BACKFILL_OPTIONS, projectId: '1' })).toContain(
      'level IS EMPTY',
    );
    expect(
      buildBackfillJql({
        ...DEFAULT_BACKFILL_OPTIONS,
        projectId: '1',
        excludeRestrictedIssues: false,
      }),
    ).not.toContain('level');
  });

  it('escapes JQL literals', () => {
    expect(quoteJql('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(formatJqlInstant(T('2026-12-05T07:08:00Z'))).toBe('"2026/12/05 07:08"');
  });

  it('walks every page and marks itself complete', async () => {
    const d = deps();
    const result = await runBackfillSlice(d, {
      ...DEFAULT_BACKFILL_OPTIONS,
      projectId: '10000',
    });
    expect(result.done).toBe(true);
    expect(result.stoppedBecause).toBe('complete');
    expect(result.issuesProcessed).toBe(3);
    expect(d.api.searchCalls).toHaveLength(2);
    // Nothing more to do, so nothing is scheduled.
    expect(d.scheduler.jobs).toHaveLength(0);

    const state = await d.store.getIndexState('10000');
    expect(state?.state).toBe('complete');
    expect(state?.backfillCursor).toBeNull();
    expect(state?.issuesTotal).toBe(3);
  });

  it('stops at the issue budget and schedules the next slice', async () => {
    const d = deps();
    const result = await runBackfillSlice(d, {
      ...DEFAULT_BACKFILL_OPTIONS,
      projectId: '10000',
      issuesPerSlice: 1,
    });
    expect(result.done).toBe(false);
    expect(result.stoppedBecause).toBe('issue_budget');
    expect(result.issuesProcessed).toBe(1);
    // Stopped mid-page-one (it has two issues), so the cursor carries a skip
    // of 1 rather than staying bare null — otherwise the next slice would
    // re-fetch this page, reprocess the first issue, and stop at the same
    // spot forever. See `encodeCursor` in `backfill.ts`. It also carries a
    // `::seek=` marker with the one issue's `created` instant, so a later
    // slice could recover by JQL bound if this cursor ever turned out to be
    // corrupted — see `isCorruptedCursor`.
    expect(d.scheduler.jobs).toEqual([
      { projectId: '10000', cursor: '::skip=1::seek=1772438400000', slice: 1 },
    ]);

    // The write happened before the cursor advanced, so the issue is persisted.
    expect(await d.store.getIssueMeta('20001')).not.toBeNull();
  });

  it('stops at the time budget', async () => {
    // A clock that advances 30s per read exhausts a 40s budget after one issue.
    const d = deps(new FakeClock(NOW, 30_000));
    const result = await runBackfillSlice(d, {
      ...DEFAULT_BACKFILL_OPTIONS,
      projectId: '10000',
      timeBudgetMs: 40_000,
    });
    expect(result.stoppedBecause).toBe('time_budget');
    expect(result.done).toBe(false);
    expect(d.scheduler.jobs).toHaveLength(1);
  });

  it('resumes from the persisted cursor', async () => {
    const d = deps();
    await d.store.putIndexState({
      ...initialIndexState('10000', NOW, null),
      state: 'running',
      backfillCursor: 'CURSOR-PAGE-2',
    });
    const result = await runBackfillSlice(d, { ...DEFAULT_BACKFILL_OPTIONS, projectId: '10000' });
    expect(d.api.searchCalls[0]?.nextPageToken).toBe('CURSOR-PAGE-2');
    expect(result.issuesProcessed).toBe(1);
    expect(result.done).toBe(true);
  });

  it('is idempotent: re-running a slice does not double-count', async () => {
    const d = deps();
    await runBackfillSlice(d, { ...DEFAULT_BACKFILL_OPTIONS, projectId: '10000' });
    const rowsAfterFirst = d.store.aggregateRowCount;

    // Force a re-run over the same data by resetting the index state.
    await d.store.putIndexState({
      ...initialIndexState('10000', NOW, null),
      state: 'running',
    });
    await runBackfillSlice(d, { ...DEFAULT_BACKFILL_OPTIONS, projectId: '10000' });
    expect(d.store.aggregateRowCount).toBe(rowsAfterFirst);
  });

  it('does nothing when the project is already complete', async () => {
    const d = deps();
    await d.store.putIndexState({
      ...initialIndexState('10000', NOW, null),
      state: 'complete',
    });
    const result = await runBackfillSlice(d, { ...DEFAULT_BACKFILL_OPTIONS, projectId: '10000' });
    expect(result.stoppedBecause).toBe('complete');
    expect(d.api.searchCalls).toHaveLength(0);
  });

  it('pauses and reschedules on a rate limit rather than failing', async () => {
    const d = {
      ...deps(),
      api: new FakeJiraApi({
        pages: pages(),
        failSearchFromCall: { call: 1, error: new HttpError(429, 'rate limited', 1000) },
      }),
    };
    const result = await runBackfillSlice(d, {
      ...DEFAULT_BACKFILL_OPTIONS,
      projectId: '10000',
    });
    expect(result.stoppedBecause).toBe('rate_limited');
    expect(d.scheduler.jobs).toHaveLength(1);
    const state = await d.store.getIndexState('10000');
    expect(state?.state).toBe('paused');
    expect(state?.lastError).toContain('rate limited');
  });

  it('records a hard failure without rescheduling', async () => {
    const d = {
      ...deps(),
      api: new FakeJiraApi({
        pages: pages(),
        failSearchFromCall: { call: 1, error: new HttpError(403, 'forbidden') },
      }),
    };
    const result = await runBackfillSlice(d, { ...DEFAULT_BACKFILL_OPTIONS, projectId: '10000' });
    expect(result.stoppedBecause).toBe('error');
    expect(d.scheduler.jobs).toHaveLength(0);
    expect((await d.store.getIndexState('10000'))?.state).toBe('failed');
  });

  it('throttles between issues when asked to', async () => {
    const sleeper = new RecordingSleeper();
    const d = deps(new FakeClock(NOW), {
      retry: { sleeper, maxAttempts: 3, random: () => 0.5 },
    });
    await runBackfillSlice(d, {
      ...DEFAULT_BACKFILL_OPTIONS,
      projectId: '10000',
      throttleMs: 250,
    });
    expect(sleeper.delays).toEqual([250, 250, 250]);
  });

  it('counts issues it had to skip', async () => {
    const d = {
      ...deps(),
      api: new FakeJiraApi({
        pages: [{ issues: [{ key: 'BAD-1' }], isLast: true, nextPageToken: null, total: 1 }],
      }),
    };
    const result = await runBackfillSlice(d, { ...DEFAULT_BACKFILL_OPTIONS, projectId: '10000' });
    expect(result.issuesSkipped).toBe(1);
    expect(result.issuesProcessed).toBe(0);
    expect(result.done).toBe(true);
  });

  it('reports progress honestly when Jira gives no total', () => {
    const base = initialIndexState('10000', NOW, null);
    expect(toProgress(base).fraction).toBeNull();
    expect(toProgress({ ...base, issuesTotal: 0 }).fraction).toBeNull();
    expect(toProgress({ ...base, issuesTotal: 200, issuesProcessed: 50 }).fraction).toBe(0.25);
    // Jira's total moves while the backfill runs, so never report over 100%.
    expect(toProgress({ ...base, issuesTotal: 10, issuesProcessed: 50 }).fraction).toBe(1);
  });
});

describe('incremental ingestion', () => {
  const searchPage = loadFixture<JiraSearchPage>('search-page.json');

  function deps(overrides: Partial<IngestConfig> = {}) {
    return {
      api: new FakeJiraApi({ issues: { '20001': searchPage.issues![0]! } }),
      store: new MemoryStore(),
      clock: new FakeClock(NOW),
      config: config(overrides),
      logger: silentLogger,
    };
  }

  it('extracts the issue id from an event', () => {
    expect(issueIdFromEvent({ issue: { id: '1' } })).toBe('1');
    expect(issueIdFromEvent({ issue: {} })).toBeNull();
    expect(issueIdFromEvent({})).toBeNull();
  });

  it('skips events that cannot move any number it reports', () => {
    const cfg = config();
    expect(
      eventAffectsDatasets(
        { changelog: { items: [{ field: 'description' }, { field: 'summary' }] } },
        cfg,
      ).affects,
    ).toBe(false);
    expect(
      eventAffectsDatasets({ changelog: { items: [{ fieldId: 'status' }] } }, cfg).affects,
    ).toBe(true);
    expect(
      eventAffectsDatasets({ changelog: { items: [{ field: 'assignee' }] } }, cfg).affects,
    ).toBe(true);
    expect(
      eventAffectsDatasets({ changelog: { items: [{ field: 'project' }] } }, cfg).affects,
    ).toBe(true);
  });

  it('re-reads when the event carries no changelog, because it cannot tell', () => {
    expect(eventAffectsDatasets({}, config()).affects).toBe(true);
  });

  it('applies the worklog and history listings own relevance rules', () => {
    const worklogCfg = config({ datasets: DATASETS_WORKLOG });
    expect(
      eventAffectsDatasets({ changelog: { items: [{ field: 'status' }] } }, worklogCfg).affects,
    ).toBe(false);
    expect(
      eventAffectsDatasets({ changelog: { items: [{ field: 'timespent' }] } }, worklogCfg).affects,
    ).toBe(true);
    // The history listing records every field change, so nothing is skippable.
    expect(
      eventAffectsDatasets(
        { changelog: { items: [{ field: 'description' }] } },
        config({ datasets: DATASETS_HISTORY }),
      ).affects,
    ).toBe(true);
  });

  it('ignores an event for a project nobody has asked to index', async () => {
    // The product-event trigger fires for every project on the instance.
    // Storing history for projects nobody opened a report for is both a cost
    // on a byte-priced backend and an answer nobody wants to give a reviewer.
    const d = deps();
    const outcome = await handleIssueUpdated(
      { issue: { id: '20001' }, changelog: { items: [{ fieldId: 'status' }] } },
      d,
    );
    expect(outcome).toMatchObject({ kind: 'ignored' });
    expect(await d.store.getIssueMeta('20001')).toBeNull();
  });

  it('updates one issue on a relevant event', async () => {
    const d = deps();
    await d.store.putIndexState(initialIndexState('10000', NOW, null));
    const outcome = await handleIssueUpdated(
      { issue: { id: '20001' }, changelog: { items: [{ fieldId: 'status' }] } },
      d,
    );
    expect(outcome).toMatchObject({ kind: 'updated', issueId: '20001' });
    expect(await d.store.getIssueMeta('20001')).not.toBeNull();
    expect(d.api.issueCalls).toEqual(['20001']);
  });

  it('does no work at all for an irrelevant event', async () => {
    const d = deps();
    const outcome = await handleIssueUpdated(
      { issue: { id: '20001' }, changelog: { items: [{ field: 'description' }] } },
      d,
    );
    expect(outcome.kind).toBe('ignored');
    expect(d.api.issueCalls).toHaveLength(0);
  });

  it('ignores an event with no issue id', async () => {
    const d = deps();
    expect((await handleIssueUpdated({}, d)).kind).toBe('ignored');
    expect((await handleIssueDeleted({}, d)).kind).toBe('ignored');
  });

  it('deletes an issue and everything attached to it', async () => {
    const d = deps();
    await d.store.putIndexState(initialIndexState('10000', NOW, null));
    await handleIssueUpdated(
      { issue: { id: '20001' }, changelog: { items: [{ fieldId: 'status' }] } },
      d,
    );
    const outcome = await handleIssueDeleted({ issue: { id: '20001' } }, d);
    expect(outcome).toMatchObject({ kind: 'deleted' });
    expect(await d.store.getIssueMeta('20001')).toBeNull();
    expect(d.store.aggregateRowCount).toBe(0);
  });

  it('records the last processed instant against the project', async () => {
    const d = deps();
    await d.store.putIndexState(initialIndexState('10000', 0, null));
    await handleIssueUpdated(
      { issue: { id: '20001' }, changelog: { items: [{ fieldId: 'status' }] } },
      d,
    );
    expect((await d.store.getIndexState('10000'))?.lastProcessedAt).toBe(NOW);
  });

  it('ignores an issue payload it cannot use', async () => {
    const d = {
      ...deps(),
      api: new FakeJiraApi({ issues: { bad: { id: 'bad', fields: {} } } }),
    };
    await d.store.putIndexState(initialIndexState('10000', NOW, null));
    const outcome = await handleIssueUpdated(
      { issue: { id: 'bad' }, changelog: { items: [{ fieldId: 'status' }] } },
      d,
    );
    expect(outcome.kind).toBe('ignored');
  });
});

describe('backfill cursor advancement', () => {
  const changelog = loadFixture<JiraChangelogPage>('changelog-reentry.json');

  function issue(id: string): JiraIssue {
    return {
      id,
      key: `FLOW-${id}`,
      fields: {
        created: '2026-03-02T08:00:00.000+0000',
        status: { id: '10001', name: 'Done' },
        project: { id: '10000', key: 'FLOW' },
      },
      changelog: { total: 0, values: [], isLast: true },
    };
  }

  function threePages(): JiraSearchPage[] {
    return [
      { issues: [issue('1'), issue('2')], isLast: false, nextPageToken: 'P2', total: 6 },
      { issues: [issue('3'), issue('4')], isLast: false, nextPageToken: 'P3', total: 6 },
      { issues: [issue('5'), issue('6')], isLast: true, nextPageToken: null, total: 6 },
    ];
  }

  function deps() {
    return {
      api: new FakeJiraApi({
        pages: threePages(),
        changelogs: { '1': changelog.values ?? [] },
      }),
      store: new MemoryStore(),
      scheduler: new RecordingScheduler(),
      clock: new FakeClock(NOW),
      config: config(),
      logger: silentLogger,
    };
  }

  it('advances past a page the issue budget ended exactly on', async () => {
    // Budget of 4 with pages of 2: the second page is fully consumed when the
    // budget runs out. Re-reading it in the next slice would double the request
    // cost of the whole backfill.
    const d = deps();
    const first = await runBackfillSlice(d, {
      ...DEFAULT_BACKFILL_OPTIONS,
      projectId: '10000',
      issuesPerSlice: 4,
      pageSize: 2,
    });
    expect(first.stoppedBecause).toBe('issue_budget');
    expect(first.issuesProcessed).toBe(4);
    // Carries a `::seek=` marker (the last-written issue's `created`) even
    // though no skip is pending — see `isCorruptedCursor`'s recovery
    // path, which needs this on every persisted cursor, not only the ones
    // that stopped mid-page.
    expect(first.nextCursor).toBe('P3::seek=1772438400000');
    expect((await d.store.getIndexState('10000'))?.backfillCursor).toBe('P3::seek=1772438400000');

    const second = await runBackfillSlice(d, {
      ...DEFAULT_BACKFILL_OPTIONS,
      projectId: '10000',
      issuesPerSlice: 4,
      pageSize: 2,
    });
    // Only the third page is left; nothing is processed twice.
    expect(second.issuesProcessed).toBe(2);
    expect(second.done).toBe(true);
    expect(d.store.aggregateRowCount).toBeGreaterThan(0);

    // Four search calls total across both slices: P1, P2 in the first slice and
    // P3 in the second, plus the second slice's initial call. Never a repeat of
    // a page that was already fully stored.
    const tokens = d.api.searchCalls.map((c) => c.nextPageToken ?? 'FIRST');
    expect(tokens).toEqual(['FIRST', 'P2', 'P3']);
  });

  it('keeps the cursor on a page it stopped in the middle of, and skips past what it already did', async () => {
    const d = deps();
    const options = {
      ...DEFAULT_BACKFILL_OPTIONS,
      projectId: '10000',
      issuesPerSlice: 3,
      pageSize: 2,
    };
    const first = await runBackfillSlice(d, options);
    expect(first.stoppedBecause).toBe('issue_budget');
    // Stopped after the first issue of page 2 (issue 3). Page 2 has to be
    // re-read — Jira's page tokens are opaque, there is no other way to
    // resume it — but the "1" here is what makes the next slice skip past
    // issue 3 instead of reprocessing it and stopping at the same spot again.
    // The trailing `::seek=` is issue 3's `created`, carried for a possible
    // corrupted-cursor recovery later.
    expect(first.nextCursor).toBe('P2::skip=1::seek=1772438400000');

    // Without that skip, this second call would re-fetch page 2, reprocess
    // issue 3, and stop again after issue 4 — never reaching page 3 at all.
    // With it, the remaining work is exactly issue 4 (page 2) plus issues 5
    // and 6 (page 3): three issues, which is exactly the budget.
    const second = await runBackfillSlice(d, options);
    expect(second.issuesProcessed).toBe(3);
    expect(second.done).toBe(true);
    expect((await d.store.getIndexState('10000'))?.state).toBe('complete');

    // Page 2 was fetched twice (unavoidable — once per slice call above) and
    // never a third time, which is what "no forward progress" would look like.
    const page2Fetches = d.api.searchCalls.filter((c) => c.nextPageToken === 'P2').length;
    expect(page2Fetches).toBe(2);
  });

  it('marks itself done when the budget ends exactly on the final page', async () => {
    const d = deps();
    const result = await runBackfillSlice(d, {
      ...DEFAULT_BACKFILL_OPTIONS,
      projectId: '10000',
      issuesPerSlice: 6,
      pageSize: 2,
    });
    expect(result.done).toBe(true);
    expect((await d.store.getIndexState('10000'))?.state).toBe('complete');
  });
});

describe('cursor encoding carries a seek marker alongside skip', () => {
  it('round-trips a bare token untouched when nothing is pending', () => {
    expect(encodeCursor('TOK', 0)).toBe('TOK');
    expect(decodeCursor('TOK')).toEqual({
      token: 'TOK',
      skip: 0,
      seekFrom: null,
      attemptedSeek: null,
    });
  });

  it('appends a seek marker even when no skip is pending', () => {
    const encoded = encodeCursor('TOK', 0, T('2026-03-02T08:00:00Z'));
    expect(encoded).toBe(`TOK::seek=${T('2026-03-02T08:00:00Z')}`);
    expect(decodeCursor(encoded)).toEqual({
      token: 'TOK',
      skip: 0,
      seekFrom: T('2026-03-02T08:00:00Z'),
      attemptedSeek: null,
    });
  });

  it('carries both a skip and a seek marker together', () => {
    const encoded = encodeCursor('TOK', 3, T('2026-03-02T08:00:00Z'));
    expect(decodeCursor(encoded)).toEqual({
      token: 'TOK',
      skip: 3,
      seekFrom: T('2026-03-02T08:00:00Z'),
      attemptedSeek: null,
    });
  });

  it('carries a seek marker with no real token at all', () => {
    const encoded = encodeCursor(null, 0, T('2026-03-02T08:00:00Z'));
    expect(decodeCursor(encoded)).toEqual({
      token: null,
      skip: 0,
      seekFrom: T('2026-03-02T08:00:00Z'),
      attemptedSeek: null,
    });
  });

  it('carries an attempted-seek marker independently of the seek bookmark', () => {
    const encoded = encodeCursor('TOK', 0, T('2026-03-02T08:05:00Z'), T('2026-03-02T08:00:00Z'));
    expect(encoded).toBe(
      `TOK::seek=${T('2026-03-02T08:05:00Z')}::attempted=${T('2026-03-02T08:00:00Z')}`,
    );
    expect(decodeCursor(encoded)).toEqual({
      token: 'TOK',
      skip: 0,
      seekFrom: T('2026-03-02T08:05:00Z'),
      attemptedSeek: T('2026-03-02T08:00:00Z'),
    });
  });
});

describe('isCorruptedCursor', () => {
  // Real captured token, decoded — confirmed live 2026-09-15 by pulling it
  // straight out of a failed `forge logs` invocation and base64-decoding it.
  const REAL_CAPTURED_TOKEN =
    'EGQYotips4o0Iltwcm9qZWN0ID0gIjEwMDMzIiBBTkQgbGV2ZWwgSVMgRU1QVFkgQU5EIGNyZWF0ZWQgPj0gIjIwMjUvMDkvMjAgMTg6NTIiIE9SREVSIEJZIGNyZWF0ZWQgQVNDKgJbXTIgVEVOQU5UX05PVF9GT1VORF9JTl9URU5BTlRfU1RPUkU=';

  it('recognises a real captured corrupted token, decoded', () => {
    expect(isCorruptedCursor(REAL_CAPTURED_TOKEN)).toBe(true);
  });

  it('recognises any base64 token whose decoded payload carries the marker', () => {
    expect(isCorruptedCursor(btoa('...TENANT_NOT_FOUND_IN_TENANT_STORE...'))).toBe(true);
  });

  it('does not misclassify a healthy base64 token', () => {
    expect(isCorruptedCursor(btoa('a perfectly ordinary opaque page token'))).toBe(false);
  });

  it('does not misclassify null', () => {
    expect(isCorruptedCursor(null)).toBe(false);
  });

  it('does not throw on a non-base64 token — a plain opaque string is not corrupted just because it fails to decode', () => {
    expect(isCorruptedCursor('not-plausibly-base64-!!!')).toBe(false);
  });

  it('is not fooled by the marker appearing in the raw, un-encoded token text', () => {
    // Confirmed live 2026-09-15: Jira's actual rejection response and the
    // request path never carry the marker in plain text — only the decoded
    // token payload does. A literal, un-encoded occurrence of the string is
    // not the failure mode this guards against, so it must not match.
    expect(isCorruptedCursor('TENANT_NOT_FOUND_IN_TENANT_STORE')).toBe(false);
  });
});

describe('recovering from a corrupted Jira pagination cursor (TECHNICAL-SPEC § 11 item 11)', () => {
  /**
   * A minimal `JiraApi` driven by a fixed script of successful pages, one per
   * call to `searchIssues`, in order. Corruption is never simulated as a
   * rejected call here — detection is proactive (`isCorruptedCursor`, run on
   * the token *before* it is ever sent), confirmed live 2026-09-15 to be the
   * only place the marker is actually findable: Jira's real rejection
   * response for a poisoned token is a generic, localized "invalid or
   * expired" message with no trace of it. So a corrupted token in these
   * fixtures is simply a page whose `nextPageToken` decodes to the marker —
   * the search that *would* use it never happens. Every other method throws
   * if called, since nothing in these tests should reach them (changelog is
   * inlined and already `isLast: true`).
   */
  class ScriptedSearchApi implements JiraApi {
    readonly searchCalls: SearchParams[] = [];
    private cursor = 0;

    constructor(private readonly script: readonly JiraSearchPage[]) {}

    searchIssues(params: SearchParams): Promise<JiraSearchPage> {
      this.searchCalls.push(params);
      const next = this.script[this.cursor];
      this.cursor += 1;
      if (next === undefined) {
        throw new Error('ScriptedSearchApi: ran out of scripted responses');
      }
      return Promise.resolve(next);
    }

    canBrowseProject(): Promise<boolean> {
      throw new Error('not used by this test');
    }
    getIssue(): Promise<JiraIssue> {
      throw new Error('not used by this test');
    }
    getChangelog(): Promise<JiraChangelogPage> {
      throw new Error('not used by this test');
    }
    getWorklogs(): Promise<JiraWorklogPage> {
      throw new Error('not used by this test');
    }
    getStatuses(): Promise<readonly never[]> {
      throw new Error('not used by this test');
    }
    listProjects(): Promise<readonly never[]> {
      throw new Error('not used by this test');
    }
  }

  /** created ASC, one minute apart, so each carries a distinct seek bound. */
  function issue(n: number): JiraIssue {
    return {
      id: String(n),
      key: `SEEK-${n}`,
      fields: {
        created: new Date(T('2026-03-02T08:00:00Z') + n * 60_000).toISOString(),
        status: { id: '10001', name: 'Done' },
        project: { id: '10000', key: 'FLOW' },
      },
      changelog: { total: 0, values: [], isLast: true },
    };
  }

  /** A `nextPageToken` that decodes to Jira's corrupted-cursor marker. */
  function corruptToken(label: string): string {
    return btoa(`...${label}...TENANT_NOT_FOUND_IN_TENANT_STORE...`);
  }

  function deps(api: ScriptedSearchApi) {
    return {
      api,
      store: new MemoryStore(),
      scheduler: new RecordingScheduler(),
      clock: new FakeClock(NOW),
      config: config(),
      logger: silentLogger,
    };
  }

  it('reseeks by created date instead of trusting a corrupted token, and finishes', async () => {
    // Page 1 ok, page 2 ok (hands back a token that decodes to corrupted).
    // The *next* iteration detects that before sending it — no third call
    // ever carries the poisoned token. Recovery drops it and reseeks from
    // issue 4's `created`.
    const api = new ScriptedSearchApi([
      { issues: [issue(1), issue(2)], isLast: false, nextPageToken: 'P2', total: 6 },
      { issues: [issue(3), issue(4)], isLast: false, nextPageToken: corruptToken('P3'), total: 6 },
      { issues: [issue(5), issue(6)], isLast: true, nextPageToken: null, total: 6 },
    ]);
    const d = deps(api);
    const result = await runBackfillSlice(d, {
      ...DEFAULT_BACKFILL_OPTIONS,
      projectId: '10000',
      pageSize: 2,
    });

    expect(result.done).toBe(true);
    expect(result.stoppedBecause).toBe('complete');
    // All 6 issues indexed despite the corrupted token in the middle — none
    // silently dropped, none needed a human to notice and restart anything.
    expect(result.issuesProcessed).toBe(6);
    expect((await d.store.getIndexState('10000'))?.state).toBe('complete');

    // Three calls: P1, P2 (whose response is the poisoned one, never sent
    // back), and the recovered reseek — which must ask fresh (no token) and
    // must bound by issue 4's `created`, not restart from the beginning of
    // history. No call is ever made with the corrupted token itself.
    expect(api.searchCalls).toHaveLength(3);
    expect(api.searchCalls.some((c) => c.nextPageToken === corruptToken('P3'))).toBe(false);
    const recoveryCall = api.searchCalls[2]!;
    expect(recoveryCall.nextPageToken).toBeUndefined();
    expect(recoveryCall.jql).toContain(formatJqlInstant(T(issue(4).fields!.created!)));
  });

  it('recovers twice in one continuous backfill, at different, unpredictable positions', async () => {
    // Mirrors what was actually observed live: the corrupted-cursor marker is
    // not fixed to one page or slice — it can recur later in the same run,
    // and each recovery must recompute its bound from whatever has been
    // written *since* the last one, not from a fixed starting point.
    const api = new ScriptedSearchApi([
      { issues: [issue(1), issue(2)], isLast: false, nextPageToken: 'P2', total: 8 },
      {
        issues: [issue(3), issue(4)],
        isLast: false,
        nextPageToken: corruptToken('A'),
        total: 8,
      },
      // first corruption, recovering from issue 4
      {
        issues: [issue(5), issue(6)],
        isLast: false,
        nextPageToken: corruptToken('B'),
        total: 8,
      },
      // second corruption, recovering from issue 6 — a later, different bound
      { issues: [issue(7), issue(8)], isLast: true, nextPageToken: null, total: 8 },
    ]);
    const d = deps(api);
    const result = await runBackfillSlice(d, {
      ...DEFAULT_BACKFILL_OPTIONS,
      projectId: '10000',
      pageSize: 2,
    });

    expect(result.done).toBe(true);
    expect(result.issuesProcessed).toBe(8);

    const jqlBounds = api.searchCalls
      .filter((c) => c.nextPageToken === undefined)
      .map((c) => c.jql);
    // The very first call also has no token, so two *recoveries* means three
    // token-less calls total, and the second and third carry different,
    // strictly later bounds — proof the seek value is recomputed each time,
    // not replayed from the first recovery.
    expect(jqlBounds).toHaveLength(3);
    expect(jqlBounds[1]).toContain(formatJqlInstant(T(issue(4).fields!.created!)));
    expect(jqlBounds[2]).toContain(formatJqlInstant(T(issue(6).fields!.created!)));
    expect(jqlBounds[1]).not.toBe(jqlBounds[2]);
  });

  it('does not attempt recovery when nothing has been processed yet to seek from', async () => {
    // The very first page fetch of a backfill starts with no cursor at all
    // (`cursor === null`), so there is nothing to decode and nothing to
    // recover from — any failure here propagates exactly as it did before
    // this recovery mechanism existed. Modelled here as a generic rejection,
    // since a corrupted-cursor marker cannot even arise without a cursor.
    class RejectingApi extends ScriptedSearchApi {
      override searchIssues(params: SearchParams): Promise<JiraSearchPage> {
        this.searchCalls.push(params);
        return Promise.reject(new HttpError(400, 'Jira responded 400 for /rest/api/3/search/jql'));
      }
    }
    const api = new RejectingApi([]);
    const d = deps(api);
    const result = await runBackfillSlice(d, {
      ...DEFAULT_BACKFILL_OPTIONS,
      projectId: '10000',
      pageSize: 2,
    });

    expect(result.done).toBe(false);
    expect(result.stoppedBecause).toBe('error');
    expect((await d.store.getIndexState('10000'))?.state).toBe('failed');
    expect(api.searchCalls).toHaveLength(1);
  });

  it('persists the seek bound on the cursor so a later slice can recover too', async () => {
    // The corrupted token can be handed back at the very end of a slice (the
    // exact shape of the originally-observed bug: a clean page boundary,
    // budget stops, and only the *next* slice ever tries the poisoned
    // token). Detection at the very start of a later slice — before that
    // slice's first request — is exactly what proactive checking is for.
    const api = new ScriptedSearchApi([
      { issues: [issue(1), issue(2)], isLast: false, nextPageToken: corruptToken('END'), total: 4 },
    ]);
    const d = deps(api);
    const first = await runBackfillSlice(d, {
      ...DEFAULT_BACKFILL_OPTIONS,
      projectId: '10000',
      pageSize: 2,
      issuesPerSlice: 2,
    });
    expect(first.stoppedBecause).toBe('issue_budget');
    expect(first.nextCursor).toBe(`${corruptToken('END')}::seek=${T(issue(2).fields!.created!)}`);

    // Second slice: starts from that persisted, already-corrupted cursor.
    // Detected before any request — the first (and only) call this slice
    // makes is already the tokenless reseek.
    const api2 = new ScriptedSearchApi([
      { issues: [issue(3), issue(4)], isLast: true, nextPageToken: null, total: 4 },
    ]);
    const d2 = { ...d, api: api2 };
    const second = await runBackfillSlice(d2, {
      ...DEFAULT_BACKFILL_OPTIONS,
      projectId: '10000',
      pageSize: 2,
      issuesPerSlice: 2,
    });
    expect(second.done).toBe(true);
    expect(second.issuesProcessed).toBe(2);
    expect(api2.searchCalls).toHaveLength(1);
    expect(api2.searchCalls[0]!.nextPageToken).toBeUndefined();
    expect(api2.searchCalls[0]!.jql).toContain(formatJqlInstant(T(issue(2).fields!.created!)));
  });

  it('fails loudly instead of looping when a reseek was already attempted from the same bound', async () => {
    // Confirmed live 2026-09-15: a bulk-seeded project reseeked from the
    // identical instant across many separate slices — `issuesProcessed`
    // climbed past the real issue count while the same issues were
    // repeatedly rewritten, an unbounded loop on a consumption-priced
    // platform. This models the exact handoff that caused it: a slice
    // attempts a reseek, the reseek's own response is corrupted *again* at
    // exactly the same bound (no new `created` value written since), and the
    // slice's budget runs out before a third attempt — persisting a cursor
    // that already carries `attemptedSeek` equal to the seek bound. The next
    // slice must recognise that inherited marker and fail immediately rather
    // than trying the identical, already-failed reseek again.
    const seekBound = T(issue(2).fields!.created!);
    const api = new ScriptedSearchApi([
      { issues: [issue(3), issue(4)], isLast: true, nextPageToken: null, total: 4 },
    ]);
    const d = deps(api);
    // Persist a cursor as if an earlier slice already attempted and failed a
    // reseek from `seekBound`, then ran out of budget before trying again.
    await d.store.putIndexState({
      ...initialIndexState('10000', NOW, null),
      state: 'failed',
      backfillCursor: `${corruptToken('STUCK')}::seek=${seekBound}::attempted=${seekBound}`,
    });

    const result = await runBackfillSlice(d, {
      ...DEFAULT_BACKFILL_OPTIONS,
      projectId: '10000',
      pageSize: 2,
    });

    expect(result.done).toBe(false);
    expect(result.stoppedBecause).toBe('error');
    expect((await d.store.getIndexState('10000'))?.state).toBe('failed');
    // Caught before ever calling the API with the doomed token or bound.
    expect(api.searchCalls).toHaveLength(0);
  });
});

describe('issue security levels', () => {
  it('falls back to an unrestricted search when Jira does not know the level field', async () => {
    // `level` is only searchable where an issue security scheme exists — and an
    // instance with no scheme has no restricted issues, so dropping the clause
    // there loses nothing and hides nothing.
    let firstJql: string | undefined;
    let calls = 0;
    const api = {
      canBrowseProject: () => Promise.resolve(true),
      searchIssues: (params: { jql: string }) => {
        calls += 1;
        if (calls === 1) {
          firstJql = params.jql;
          return Promise.reject(
            new HttpError(400, 'bad request', null, "Field 'level' does not exist"),
          );
        }
        return Promise.resolve({ issues: [], isLast: true, nextPageToken: null, total: 0 });
      },
      getIssue: () => Promise.reject(new Error('unused')),
      getChangelog: () => Promise.resolve({ values: [], total: 0, isLast: true }),
      getWorklogs: () => Promise.resolve({ worklogs: [], total: 0 }),
      getStatuses: () => Promise.resolve([]),
      listProjects: () => Promise.resolve([]),
    };
    const d = {
      api,
      store: new MemoryStore(),
      scheduler: new RecordingScheduler(),
      clock: new FakeClock(NOW),
      config: config(),
      logger: silentLogger,
    };
    const result = await runBackfillSlice(d, { ...DEFAULT_BACKFILL_OPTIONS, projectId: '10000' });
    expect(firstJql).toContain('level IS EMPTY');
    expect(calls).toBe(2);
    expect(result.done).toBe(true);
  });

  it('does not swallow an unrelated 400', async () => {
    const api = {
      canBrowseProject: () => Promise.resolve(true),
      searchIssues: () =>
        Promise.reject(new HttpError(400, 'bad request', null, 'Unable to parse JQL')),
      getIssue: () => Promise.reject(new Error('unused')),
      getChangelog: () => Promise.resolve({ values: [], total: 0, isLast: true }),
      getWorklogs: () => Promise.resolve({ worklogs: [], total: 0 }),
      getStatuses: () => Promise.resolve([]),
      listProjects: () => Promise.resolve([]),
    };
    const d = {
      api,
      store: new MemoryStore(),
      scheduler: new RecordingScheduler(),
      clock: new FakeClock(NOW),
      config: config(),
      logger: silentLogger,
    };
    const result = await runBackfillSlice(d, { ...DEFAULT_BACKFILL_OPTIONS, projectId: '10000' });
    expect(result.stoppedBecause).toBe('error');
  });
});

describe('★ statusVisits needs the changelog it is derived from', () => {
  const searchPage = loadFixture<JiraSearchPage>('search-page.json');
  const changelog = loadFixture<JiraChangelogPage>('changelog-reentry.json');
  const VISITS_ONLY = {
    statusDurations: false,
    worklogs: false,
    history: false,
    statusVisits: true,
  } as const;

  it('pages the changelog for a dataset that wants visits but not durations', async () => {
    // Regression. `needsChangelog` was `statusDurations || history`, so a
    // dataset asking for visits alone fetched nothing: `reconstructTimeline`
    // saw an empty changelog and wrote every issue as one synthetic visit —
    // a silently wrong flow diagram and issue timeline, with no error
    // anywhere to notice. No shipped preset hits it; the flag is public API
    // and its own docstring invites the combination.
    const api = new FakeJiraApi({
      changelogs: { '20002': changelog.values ?? [] },
      changelogPageSize: 2,
    });
    const processed = await processIssue(
      searchPage.issues![1]!,
      api,
      config({ datasets: VISITS_ONLY }),
      NOW,
    );
    expect(api.changelogCalls).toHaveLength(3);
    // Real transitions, not one synthetic visit covering the issue's life.
    expect(processed!.visits.length).toBeGreaterThan(1);
    expect(processed!.visits[0]!.enteredAt).toBe(processed!.meta.createdAt);
  });

  it('writes visits and nothing else for a visits-only dataset', async () => {
    // The flag adds a table; it does not quietly switch the other ones on.
    const processed = await processIssue(
      searchPage.issues![0]!,
      new FakeJiraApi(),
      config({ datasets: VISITS_ONLY }),
      NOW,
    );
    expect(processed!.visits.length).toBeGreaterThan(0);
    expect(processed!.aggregates).toEqual([]);
    expect(processed!.worklogs).toEqual([]);
    expect(processed!.history).toEqual([]);
  });
});
