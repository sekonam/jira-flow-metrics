import { describe, expect, it } from 'vitest';
import {
  buildBackfillJql,
  DEFAULT_BACKFILL_OPTIONS,
  formatJqlInstant,
  initialIndexState,
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
import { HttpError, silentLogger, systemClock, realSleeper } from '../src/ingest/ports.js';
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
    expect(d.scheduler.jobs).toEqual([{ projectId: '10000', cursor: null, slice: 1 }]);

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
    expect(first.nextCursor).toBe('P3');
    expect((await d.store.getIndexState('10000'))?.backfillCursor).toBe('P3');

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

  it('keeps the cursor on a page it stopped in the middle of', async () => {
    const d = deps();
    const result = await runBackfillSlice(d, {
      ...DEFAULT_BACKFILL_OPTIONS,
      projectId: '10000',
      issuesPerSlice: 3,
      pageSize: 2,
    });
    expect(result.stoppedBecause).toBe('issue_budget');
    // Stopped after the first issue of page 2, so page 2 must be re-read.
    expect(result.nextCursor).toBe('P2');
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
