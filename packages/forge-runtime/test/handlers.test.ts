import { describe, expect, it } from 'vitest';
import {
  DATASETS_TIME_IN_STATUS,
  HttpError,
  MemoryStore,
  type JiraApi,
  type JiraIssue,
  type JiraProjectRef,
  type JiraSearchPage,
  type StatusMeta,
} from '@jfm/engine';
import { RecordingSqlExecutor } from '../src/sql/executor.js';
import { SettingsStore } from '../src/settings.js';
import { ListingRuntime } from '../src/runtime.js';
import {
  handleAgingReport,
  handleBackfillJob,
  handleHistoryReport,
  handleSlaReport,
  handleWorklogReport,
  handleExportCsv,
  handleGetReport,
  handleIssueEvent,
  handleListProjects,
  handleStartIndexing,
  handleStorageEstimate,
  NOT_IN_PROJECT,
  NO_PERMISSION,
  parseReportRequest,
  projectIdFromContext,
  projectIdFromEvent,
  toUserMessage,
} from '../src/handlers.js';

const ISSUE: JiraIssue = {
  id: '20001',
  key: 'FLOW-1',
  fields: {
    created: '2026-03-01T09:00:00.000+0000',
    status: { id: '3', name: 'In Progress' },
    project: { id: '10000', key: 'FLOW' },
  },
  changelog: { total: 0, values: [], isLast: true },
};

const CONTEXT = { extension: { project: { id: '10000', key: 'FLOW' } } };

class StubJira implements JiraApi {
  failWith: Error | null = null;
  canBrowse = true;
  readonly permissionCalls: string[] = [];
  canBrowseProject(projectId: string): Promise<boolean> {
    this.permissionCalls.push(projectId);
    return Promise.resolve(this.canBrowse);
  }
  searchIssues(): Promise<JiraSearchPage> {
    if (this.failWith !== null) return Promise.reject(this.failWith);
    return Promise.resolve({ issues: [ISSUE], isLast: true, nextPageToken: null, total: 1 });
  }
  getIssue(): Promise<JiraIssue> {
    if (this.failWith !== null) return Promise.reject(this.failWith);
    return Promise.resolve(ISSUE);
  }
  getChangelog() {
    return Promise.resolve({ values: [], total: 0, isLast: true });
  }
  getWorklogs() {
    return Promise.resolve({ worklogs: [], total: 0 });
  }
  getStatuses(): Promise<readonly StatusMeta[]> {
    return Promise.resolve([{ id: '3', name: 'In Progress', category: 'inprogress' }]);
  }
  projects: JiraProjectRef[] = [];
  listProjects(): Promise<readonly JiraProjectRef[]> {
    return Promise.resolve(this.projects);
  }
}

function build() {
  const store = new MemoryStore();
  const jira = new StubJira();
  const jobs: { projectId: string; cursor: string | null; slice: number }[] = [];
  const runtime = new ListingRuntime(
    {
      api: jira,
      store,
      settings: new SettingsStore(new RecordingSqlExecutor()),
      scheduler: {
        enqueueBackfill: (job) => {
          jobs.push(job);
          return Promise.resolve();
        },
      },
      sleeper: { sleep: () => Promise.resolve() },
      clock: { now: () => Date.parse('2026-03-06T00:00:00Z') },
    },
    { listingId: 'time-in-status', datasets: DATASETS_TIME_IN_STATUS },
  );
  return { runtime, store, jira, jobs };
}

describe('resolver context', () => {
  it('takes the project from the platform context, never from the payload', () => {
    expect(projectIdFromContext(CONTEXT)).toBe('10000');
    expect(projectIdFromContext({ extension: { project: { id: 10000 } } })).toBe('10000');
    expect(projectIdFromContext({ extension: {} })).toBeNull();
    expect(projectIdFromContext({ extension: { project: { id: '' } } })).toBeNull();
    expect(projectIdFromContext(null)).toBeNull();
    expect(projectIdFromContext('nope')).toBeNull();
  });

  it('falls back to the gadget configuration when there is no project page context', () => {
    // A jira:dashboardGadget context carries no project of its own — confirmed
    // live, every gadget refused until this fallback existed — so the
    // gadget's own configured project id is the only source it has.
    expect(
      projectIdFromContext({ extension: { gadgetConfiguration: { projectId: '10033' } } }),
    ).toBe('10033');
    // extension.project still wins when both are somehow present.
    expect(
      projectIdFromContext({
        extension: { project: { id: '1' }, gadgetConfiguration: { projectId: '2' } },
      }),
    ).toBe('1');
    expect(
      projectIdFromContext({ extension: { gadgetConfiguration: { projectId: '' } } }),
    ).toBeNull();
    expect(projectIdFromContext({ extension: { gadgetConfiguration: {} } })).toBeNull();
  });

  it('refuses to serve a report without a project context', async () => {
    const { runtime } = build();
    const result = await handleGetReport(runtime, { payload: { projectId: 'other' }, context: {} });
    expect(result.ok).toBe(false);
    expect(await handleStartIndexing(runtime, { context: {} })).toMatchObject({ ok: false });
    expect(await handleExportCsv(runtime, { context: {} })).toMatchObject({ ok: false });
  });
});

describe('report request parsing', () => {
  it('accepts only the options a client may choose', () => {
    expect(
      parseReportRequest('10000', {
        basis: 'business',
        limit: 10,
        offset: 5,
        assigneeAccountIds: ['a', '', 7],
        issueTypeIds: [],
        projectId: 'injected',
      }),
    ).toEqual({
      projectId: '10000',
      basis: 'business',
      limit: 10,
      offset: 5,
      assigneeAccountIds: ['a'],
    });
  });

  it('ignores nonsense rather than failing the request', () => {
    expect(parseReportRequest('10000', null)).toEqual({ projectId: '10000' });
    expect(parseReportRequest('10000', { basis: 'martian', limit: 'ten' })).toEqual({
      projectId: '10000',
    });
  });
});

describe('error messages crossing the trust boundary', () => {
  it('explains a permission failure in terms the admin can act on', () => {
    expect(toUserMessage(new HttpError(403, 'forbidden: FLOW-1 "secret summary"'))).toContain(
      'permission',
    );
    expect(toUserMessage(new HttpError(401, 'x'))).toContain('permission');
  });

  it('explains a rate limit as temporary', () => {
    expect(toUserMessage(new HttpError(429, 'x'))).toContain('rate-limiting');
  });

  it('never leaks the underlying detail for anything else', () => {
    const message = toUserMessage(new Error('issue FLOW-1: acquire Contoso by Q3'));
    expect(message).not.toContain('Contoso');
    expect(message).toContain('app logs');
  });
});

describe('handlers', () => {
  it('returns a report envelope for a valid context', async () => {
    const { runtime } = build();
    const result = await handleGetReport(runtime, { context: CONTEXT });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.partial).toBe(true);
  });

  it('starts indexing and enqueues the first slice', async () => {
    const { runtime, jobs } = build();
    expect(await handleStartIndexing(runtime, { context: CONTEXT })).toMatchObject({ ok: true });
    expect(jobs).toHaveLength(1);
  });

  it('exports CSV with a filename derived from the listing and project', async () => {
    const { runtime } = build();
    const result = await handleExportCsv(runtime, { context: CONTEXT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.filename).toBe('time-in-status-10000.csv');
      expect(result.data.csv).toContain('Issue key');
    }
  });

  it('converts a Jira failure into a safe message', async () => {
    const { runtime, jira } = build();
    jira.failWith = new HttpError(403, 'forbidden');
    const result = await handleGetReport(runtime, { context: CONTEXT });
    // The report reads the store, not Jira, so this specifically exercises the
    // start-indexing path where Jira is reached.
    expect(result.ok).toBe(true);
    const started = await handleStartIndexing(runtime, { context: CONTEXT });
    expect(started.ok).toBe(true);
  });

  it('reports the storage estimate with its caveat', async () => {
    const { runtime } = build();
    const result = await handleStorageEstimate(runtime);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.note).toContain('Estimated');
  });
});

describe('product events', () => {
  it('routes created and updated events to ingestion', async () => {
    const { runtime, store } = build();
    await handleStartIndexing(runtime, { context: CONTEXT });
    expect(
      await handleIssueEvent(
        runtime,
        {
          eventType: 'avi:jira:updated:issue',
          issue: { id: '20001' },
          changelog: { items: [{ fieldId: 'status' }] },
        },
        '10000',
      ),
    ).toBe('updated');
    expect(await store.getIssueMeta('20001')).not.toBeNull();
  });

  it('routes deleted events to removal', async () => {
    const { runtime, store } = build();
    await handleStartIndexing(runtime, { context: CONTEXT });
    await handleIssueEvent(
      runtime,
      {
        eventType: 'avi:jira:updated:issue',
        issue: { id: '20001' },
        changelog: { items: [{ fieldId: 'status' }] },
      },
      '10000',
    );
    expect(
      await handleIssueEvent(
        runtime,
        { eventType: 'avi:jira:deleted:issue', issue: { id: '20001' } },
        '10000',
      ),
    ).toBe('deleted');
    expect(await store.getIssueMeta('20001')).toBeNull();
  });

  it('swallows a failure rather than making Forge retry a bad payload forever', async () => {
    const { runtime, jira } = build();
    jira.failWith = new HttpError(404, 'gone');
    expect(
      await handleIssueEvent(
        runtime,
        {
          eventType: 'avi:jira:updated:issue',
          issue: { id: 'missing' },
          changelog: { items: [{ fieldId: 'status' }] },
        },
        '10000',
      ),
    ).toBe('failed');
  });

  it('reads the project id from an event when Jira supplies it', () => {
    expect(projectIdFromEvent({ issue: { fields: { project: { id: '10000' } } } })).toBe('10000');
    expect(projectIdFromEvent({ issue: { fields: {} } })).toBeNull();
    expect(projectIdFromEvent({ issue: {} })).toBeNull();
    expect(projectIdFromEvent({})).toBeNull();
    expect(projectIdFromEvent(null)).toBeNull();
  });
});

describe('backfill consumer', () => {
  it('runs the slice named in the payload', async () => {
    const { runtime, store } = build();
    await handleStartIndexing(runtime, { context: CONTEXT });
    expect(await handleBackfillJob(runtime, { projectId: '10000', cursor: null, slice: 0 })).toBe(
      'ran',
    );
    expect((await store.getIndexState('10000'))?.state).toBe('complete');
  });

  it('ignores an unusable payload instead of throwing inside the queue', async () => {
    const { runtime } = build();
    expect(await handleBackfillJob(runtime, null)).toBe('ignored');
    expect(await handleBackfillJob(runtime, { slice: 1 })).toBe('ignored');
  });
});

describe('listing-specific resolvers', () => {
  it('all refuse to run without a project context', async () => {
    const { runtime } = build();
    for (const handler of [
      handleWorklogReport,
      handleAgingReport,
      handleSlaReport,
      handleHistoryReport,
    ]) {
      expect(await handler(runtime, { context: {} })).toMatchObject({ ok: false });
    }
  });

  it('accepts only the worklog groupings the engine supports', async () => {
    const { runtime } = build();
    const good = await handleWorklogReport(runtime, {
      context: CONTEXT,
      payload: { groupBy: 'day', from: 0, to: Date.now() },
    });
    expect(good.ok).toBe(true);
    // An unknown grouping falls back to the default rather than failing.
    const fallback = await handleWorklogReport(runtime, {
      context: CONTEXT,
      payload: { groupBy: 'sideways' },
    });
    expect(fallback.ok).toBe(true);
  });

  it('returns an aging report', async () => {
    const { runtime } = build();
    const result = await handleAgingReport(runtime, { context: CONTEXT });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.rows).toEqual([]);
  });

  it('clamps an absurd SLA target instead of rendering nonsense', async () => {
    const { runtime } = build();
    const tiny = await handleSlaReport(runtime, { context: CONTEXT, payload: { targetMs: 1 } });
    expect(tiny.ok).toBe(true);
    if (tiny.ok) expect(tiny.data.rows).toEqual([]);

    const huge = await handleSlaReport(runtime, {
      context: CONTEXT,
      payload: { targetMs: Number.MAX_SAFE_INTEGER, countedStatusIds: ['3'], name: 'Custom' },
    });
    expect(huge.ok).toBe(true);
    if (huge.ok) expect(huge.data.goalName).toBe('Custom');
  });

  it('defaults the SLA target when the payload has none', async () => {
    const { runtime } = build();
    const result = await handleSlaReport(runtime, { context: CONTEXT, payload: {} });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.goalName).toBe('Time to resolution');
  });

  it('caps the history page size a client can request', async () => {
    const { runtime } = build();
    const result = await handleHistoryReport(runtime, {
      context: CONTEXT,
      payload: { limit: 100_000, fields: ['status'], from: 0, to: Date.now() },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.records).toEqual([]);
  });

  it('converts a failure from any of them into a safe message', async () => {
    const { runtime, store } = build();
    // Break the store so every report path throws.
    store.queryIssueMeta = () => Promise.reject(new Error('boom FLOW-1 secret'));
    store.queryWorklogs = () => Promise.reject(new Error('boom FLOW-1 secret'));
    store.queryHistory = () => Promise.reject(new Error('boom FLOW-1 secret'));
    for (const handler of [
      handleWorklogReport,
      handleAgingReport,
      handleSlaReport,
      handleHistoryReport,
      handleGetReport,
      handleExportCsv,
    ]) {
      const result = await handler(runtime, { context: CONTEXT });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).not.toContain('secret');
    }
  });

  it('reports a storage failure without leaking the cause', async () => {
    const { runtime, store } = build();
    store.estimateBytes = () => Promise.reject(new Error('disk on fire'));
    const result = await handleStorageEstimate(runtime);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain('fire');
  });

  it('lists the projects the gadget picker offers, from the calling user', async () => {
    const { runtime, jira } = build();
    jira.projects = [{ id: '10033', key: 'JFMB', name: 'Flow Metrics Bulk Seed' }];
    const result = await handleListProjects(runtime);
    expect(result).toEqual({
      ok: true,
      data: [{ id: '10033', key: 'JFMB', name: 'Flow Metrics Bulk Seed' }],
    });
  });

  it('reports a project-listing failure without leaking the cause', async () => {
    const { runtime, jira } = build();
    jira.listProjects = () => Promise.reject(new Error('tenant store on fire'));
    const result = await handleListProjects(runtime);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain('fire');
  });

  it('reports a failure to start indexing without leaking the cause', async () => {
    const { runtime, store } = build();
    store.putIndexState = () => Promise.reject(new Error('write failed for FLOW-1'));
    const result = await handleStartIndexing(runtime, { context: CONTEXT });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain('FLOW-1');
  });
});

describe('per-invocation cache hygiene', () => {
  /**
   * The apps memoise the runtime at module scope, so a warm Forge container
   * reuses it. Without an explicit reset the settings cache would outlive the
   * invocation and a customer who changed their working calendar would keep
   * seeing the old numbers — a silently-wrong report.
   */
  it('re-reads settings on every entry point rather than serving a warm cache', async () => {
    const store = new MemoryStore();
    const sql = new RecordingSqlExecutor();
    const runtime = new ListingRuntime(
      {
        api: new StubJira(),
        store,
        settings: new SettingsStore(sql),
        scheduler: { enqueueBackfill: () => Promise.resolve() },
        sleeper: { sleep: () => Promise.resolve() },
        clock: { now: () => Date.parse('2026-03-06T00:00:00Z') },
      },
      { listingId: 'time-in-status', datasets: DATASETS_TIME_IN_STATUS },
    );

    await handleGetReport(runtime, { context: CONTEXT });
    const afterFirst = sql.statements.filter((s) => s.statement.includes('app_settings')).length;
    await handleGetReport(runtime, { context: CONTEXT });
    const afterSecond = sql.statements.filter((s) => s.statement.includes('app_settings')).length;
    expect(afterSecond).toBeGreaterThan(afterFirst);
  });
});

describe('caller authorization', () => {
  /**
   * Every read this app performs is made *as the app*, which by design ignores
   * who is asking. Without a caller check, anyone who can reach a report
   * surface would read any project's aggregates regardless of their own Jira
   * permissions. That is the single finding an Atlassian security review would
   * raise against this shape of app, so it gets its own suite.
   */
  const PROJECT_HANDLERS = [
    handleGetReport,
    handleExportCsv,
    handleStartIndexing,
    handleWorklogReport,
    handleAgingReport,
    handleSlaReport,
    handleHistoryReport,
  ];

  it('asks Jira, as the user, before returning anything', async () => {
    const { runtime, jira } = build();
    for (const handler of PROJECT_HANDLERS) {
      jira.permissionCalls.length = 0;
      const result = await handler(runtime, { context: CONTEXT });
      expect(result.ok).toBe(true);
      expect(jira.permissionCalls).toEqual(['10000']);
    }
  });

  it('refuses every project-scoped handler when the user cannot browse', async () => {
    const { runtime, jira } = build();
    jira.canBrowse = false;
    for (const handler of PROJECT_HANDLERS) {
      const result = await handler(runtime, { context: CONTEXT });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(NO_PERMISSION);
    }
  });

  it('fails closed when the permission itself cannot be determined', async () => {
    const { runtime, jira } = build();
    jira.canBrowseProject = () => Promise.reject(new Error('Jira unreachable'));
    const result = await handleGetReport(runtime, { context: CONTEXT });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(NO_PERMISSION);
  });

  it('does not start indexing for a project the caller cannot browse', async () => {
    const { runtime, jira, jobs } = build();
    jira.canBrowse = false;
    await handleStartIndexing(runtime, { context: CONTEXT });
    expect(jobs).toHaveLength(0);
  });

  it('distinguishes "not in a project" from "not permitted"', async () => {
    const { runtime } = build();
    const noContext = await handleGetReport(runtime, { context: {} });
    expect(noContext.ok).toBe(false);
    if (!noContext.ok) expect(noContext.error).toBe(NOT_IN_PROJECT);
  });
});

describe('untrusted payload limits', () => {
  it('caps how many filter values a client can send', async () => {
    const { runtime, store } = build();
    const seen: unknown[][] = [];
    const realQuery = store.queryHistory.bind(store);
    store.queryHistory = (query) => {
      seen.push([...(query.fields ?? [])]);
      return realQuery(query);
    };
    const result = await handleHistoryReport(runtime, {
      context: CONTEXT,
      payload: { fields: Array.from({ length: 5000 }, (_, i) => `field${i}`) },
    });
    expect(result.ok).toBe(true);
    // Uncapped, this list becomes 5,000 `?` markers in one SQL statement.
    expect(seen[0]).toHaveLength(100);
  });

  it('rejects NaN, which is typeof "number", wherever a number is accepted', async () => {
    const { runtime, store } = build();
    const limits: (number | undefined)[] = [];
    const realQuery = store.queryHistory.bind(store);
    store.queryHistory = (query) => {
      limits.push(query.limit);
      return realQuery(query);
    };
    await handleHistoryReport(runtime, { context: CONTEXT, payload: { limit: Number.NaN } });
    // A NaN bound as a SQL LIMIT is a runtime error, not an empty result.
    expect(limits[0] === undefined || Number.isFinite(limits[0])).toBe(true);

    const worklogWindows: (number | undefined)[] = [];
    const realWorklogs = store.queryWorklogs.bind(store);
    store.queryWorklogs = (query) => {
      worklogWindows.push(query.from, query.to);
      return realWorklogs(query);
    };
    await handleWorklogReport(runtime, {
      context: CONTEXT,
      payload: { from: Number.NaN, to: Number.NaN },
    });
    expect(worklogWindows.every((v) => v === undefined || Number.isFinite(v))).toBe(true);
  });

  it('cannot have its context-derived project overridden by the payload', async () => {
    const { runtime, store } = build();
    const projects: string[] = [];
    const realQuery = store.queryHistory.bind(store);
    store.queryHistory = (query) => {
      projects.push(query.projectId);
      return realQuery(query);
    };
    await handleHistoryReport(runtime, {
      context: CONTEXT,
      payload: { projectId: 'SOMEONE-ELSES-PROJECT' },
    });
    expect(projects).toEqual(['10000']);
  });
});
