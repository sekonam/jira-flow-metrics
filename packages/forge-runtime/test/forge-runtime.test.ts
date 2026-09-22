import { describe, expect, it } from 'vitest';
import {
  HttpError,
  MemoryStore,
  alwaysOnCalendar,
  normaliseCalendar,
  standardBusinessCalendar,
  type IndexStateRow,
  type IssueMetaRow,
  type JiraApi,
  type JiraIssue,
  type JiraProjectRef,
  type JiraSearchPage,
  type Sleeper,
  type StatusAggregateRow,
  type StatusMeta,
} from '@jfm/engine';
import { RecordingSqlExecutor, forgeSqlExecutor } from '../src/sql/executor.js';
import { SqlMetricsStore } from '../src/sql/sql-store.js';
import {
  historyFromRow,
  indexStateFromRow,
  indexStateToParams,
  issueMetaFromRow,
  issueMetaToParams,
  placeholders,
  statusAggregateFromRow,
  statusMetaFromRow,
  statusNameHistoryFromRow,
  toBoolean,
  toNullableNumber,
  toNullableText,
  toNumber,
  toText,
  worklogFromRow,
} from '../src/sql/rows.js';
import {
  JiraRestClient,
  asTemplateStrings,
  forgeJiraFetch,
  redact,
  type JiraResponseLike,
} from '../src/jira/client.js';
import { QueueScheduler, jobFromPayload } from '../src/scheduler.js';
import { SettingsStore, defaultSettings, parseSettings } from '../src/settings.js';
import { ListingRuntime } from '../src/runtime.js';

const NOW = Date.parse('2026-03-06T00:00:00Z');

const instantSleeper: Sleeper = { sleep: () => Promise.resolve() };

function meta(overrides: Partial<IssueMetaRow> = {}): IssueMetaRow {
  return {
    issueId: '1',
    issueKey: 'FLOW-1',
    projectId: '10000',
    issueTypeId: '10002',
    priorityId: '3',
    assigneeAccountId: 'acc-anna',
    currentStatusId: '3',
    createdAt: NOW - 86_400_000,
    resolvedAt: null,
    dueAt: null,
    historyThroughAt: NOW,
    truncated: false,
    updatedAt: NOW,
    ...overrides,
  };
}

function agg(overrides: Partial<StatusAggregateRow> = {}): StatusAggregateRow {
  return {
    issueId: '1',
    statusId: '3',
    elapsedMs: 3_600_000,
    businessMs: 1_800_000,
    entries: 2,
    lastEnteredAt: NOW,
    lastExitedAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('SQL column mapping', () => {
  it('accepts the numeric shapes a MySQL driver can return', () => {
    expect(toNumber(5)).toBe(5);
    expect(toNumber(5n)).toBe(5);
    expect(toNumber('5')).toBe(5);
    expect(toNullableNumber(null)).toBeNull();
    expect(toNullableNumber(undefined)).toBeNull();
  });

  it('refuses to turn a bad column into a plausible-looking zero', () => {
    // A NaN duration would render as "0m" and be indistinguishable from a real
    // zero, which is exactly the silent wrongness this product cannot afford.
    expect(() => toNumber('abc')).toThrow(TypeError);
    expect(() => toNumber(null)).toThrow(TypeError);
    expect(() => toText({})).toThrow(TypeError);
  });

  it('maps text and MySQL booleans', () => {
    expect(toText('x')).toBe('x');
    expect(toText(7)).toBe('7');
    expect(toNullableText(null)).toBeNull();
    expect(toBoolean(1)).toBe(true);
    expect(toBoolean('1')).toBe(true);
    expect(toBoolean(0)).toBe(false);
    expect(toBoolean(null)).toBe(false);
  });

  it('round-trips an issue_meta row through params and back', () => {
    const original = meta({ truncated: true, resolvedAt: NOW, dueAt: NOW });
    const params = issueMetaToParams(original);
    const row = {
      issue_id: params[0],
      issue_key: params[1],
      project_id: params[2],
      issue_type_id: params[3],
      priority_id: params[4],
      assignee_account_id: params[5],
      current_status_id: params[6],
      created_at: params[7],
      resolved_at: params[8],
      due_at: params[9],
      history_through_at: params[10],
      truncated: params[11],
      updated_at: params[12],
    };
    expect(issueMetaFromRow(row)).toEqual(original);
  });

  it('round-trips an index_state row', () => {
    const original: IndexStateRow = {
      projectId: '10000',
      state: 'running',
      backfillCursor: 'abc',
      backfillFrom: NOW,
      issuesProcessed: 10,
      issuesTotal: 20,
      lastProcessedAt: NOW,
      lastError: null,
      startedAt: NOW,
      updatedAt: NOW,
    };
    const p = indexStateToParams(original);
    expect(
      indexStateFromRow({
        project_id: p[0],
        state: p[1],
        backfill_cursor: p[2],
        backfill_from: p[3],
        issues_processed: p[4],
        issues_total: p[5],
        last_processed_at: p[6],
        last_error: p[7],
        started_at: p[8],
        updated_at: p[9],
      }),
    ).toEqual(original);
  });

  it('truncates a long error so the state update itself never fails', () => {
    const params = indexStateToParams({
      projectId: '10000',
      state: 'failed',
      backfillCursor: null,
      backfillFrom: null,
      issuesProcessed: 0,
      issuesTotal: null,
      lastProcessedAt: null,
      lastError: 'x'.repeat(5000),
      startedAt: null,
      updatedAt: NOW,
    });
    expect(String(params[7])).toHaveLength(1000);
  });

  it('falls back rather than throwing on an unrecognised enum value', () => {
    expect(
      statusMetaFromRow({
        status_id: '1',
        name: 'X',
        category: 'martian',
        first_seen_at: 0,
        last_seen_at: 0,
      }).category,
    ).toBe('unknown');
    expect(
      indexStateFromRow({
        project_id: 'p',
        state: 'nonsense',
        backfill_cursor: null,
        backfill_from: null,
        issues_processed: 0,
        issues_total: null,
        last_processed_at: null,
        last_error: null,
        started_at: null,
        updated_at: 0,
      }).state,
    ).toBe('failed');
  });

  it('maps the remaining row types', () => {
    expect(
      statusAggregateFromRow({
        issue_id: '1',
        status_id: '3',
        elapsed_ms: 1,
        business_ms: 2,
        entries: 3,
        last_entered_at: 4,
        last_exited_at: null,
        updated_at: 5,
      }),
    ).toMatchObject({ issueId: '1', entries: 3, lastExitedAt: null });

    expect(
      statusNameHistoryFromRow({
        status_id: '3',
        name: 'Doing',
        first_seen_at: 1,
        last_seen_at: 2,
      }),
    ).toEqual({ statusId: '3', name: 'Doing', firstSeenAt: 1, lastSeenAt: 2 });

    expect(
      worklogFromRow({
        worklog_id: 'w',
        issue_id: '1',
        issue_key: 'FLOW-1',
        project_id: '10000',
        author_account_id: 'a',
        author_display_name: 'Anna',
        started_at: 1,
        time_spent_ms: 2,
        created_at: null,
        updated_at: null,
      }).timeSpentMs,
    ).toBe(2);

    expect(
      historyFromRow({
        change_id: 'c',
        issue_id: '1',
        issue_key: 'FLOW-1',
        project_id: '10000',
        changed_at: 9,
        author_account_id: null,
        author_display_name: 'Anna',
        field: 'status',
        field_label: 'status',
        from_value: null,
        to_value: 'Done',
        from_id: null,
        to_id: '10001',
      }),
    ).toMatchObject({ at: 9, toValue: 'Done', authorAccountId: null });
  });

  it('keeps an empty IN list valid SQL that matches nothing', () => {
    expect(placeholders(0)).toBe('NULL');
    expect(placeholders(3)).toBe('?, ?, ?');
  });
});

describe('SqlMetricsStore statement generation', () => {
  it('creates every table on migrate', async () => {
    const sql = new RecordingSqlExecutor();
    await new SqlMetricsStore(sql).migrate();
    expect(sql.sql.every((s) => s.startsWith('CREATE TABLE IF NOT EXISTS'))).toBe(true);
    expect(sql.sql.length).toBeGreaterThanOrEqual(8);
  });

  it('migrates once per store instance, not once per call', async () => {
    // Found bulk-seeding 300 real issues into one project: every resolver
    // method and every issue event calls `store.migrate()` unconditionally
    // (see runtime.ts), and the warm-container runtime caches one store
    // instance across events — so a burst of Jira activity fired `migrate()`
    // once per event. `forgeSqlMigrator`'s own docstring assumed repeating it
    // was "cheap and idempotent" because Forge records applied migrations by
    // name; what actually happened live was every one of those calls still
    // counted against the installation's Forge SQL rate limit, and a few
    // hundred events in a few minutes was enough to trip
    // `ForgeSQLError: RATE_LIMIT_EXCEEDED` and fail the backfill outright.
    const sql = new RecordingSqlExecutor();
    const store = new SqlMetricsStore(sql);
    await store.migrate();
    await store.migrate();
    await store.migrate();
    expect(sql.sql.length).toBeGreaterThanOrEqual(8);
    expect(sql.sql.length).toBeLessThan(16); // one round of CREATEs, not three
  });

  it('retries migration on the next call if it failed', async () => {
    let calls = 0;
    const failingMigrator = {
      migrate: () => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error('boom'));
        return Promise.resolve();
      },
    };
    const store = new SqlMetricsStore(new RecordingSqlExecutor(), failingMigrator);
    await expect(store.migrate()).rejects.toThrow('boom');
    await expect(store.migrate()).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it('writes a batch as one upsert, one delete and one insert', async () => {
    const sql = new RecordingSqlExecutor();
    await new SqlMetricsStore(sql).putIssueAggregates([
      { meta: meta({ issueId: '1' }), rows: [agg({ issueId: '1' })] },
      { meta: meta({ issueId: '2' }), rows: [agg({ issueId: '2' })] },
    ]);
    expect(sql.sql).toHaveLength(3);
    expect(sql.sql[0]).toContain('INSERT INTO issue_meta');
    expect(sql.sql[0]).toContain('ON DUPLICATE KEY UPDATE');
    // Two rows of thirteen bound parameters each, not two statements.
    expect(sql.statements[0]?.params).toHaveLength(26);
    expect(sql.sql[1]).toBe('DELETE FROM issue_status_agg WHERE issue_id IN (?, ?)');
    expect(sql.sql[2]).toContain('INSERT INTO issue_status_agg');
    expect(sql.statements[2]?.params).toHaveLength(18);
  });

  it('still clears aggregates for an issue that now has none', async () => {
    const sql = new RecordingSqlExecutor();
    await new SqlMetricsStore(sql).putIssueAggregate(meta(), []);
    expect(sql.sql.filter((s) => s.startsWith('DELETE FROM issue_status_agg'))).toHaveLength(1);
    expect(sql.sql.some((s) => s.startsWith('INSERT INTO issue_status_agg'))).toBe(false);
  });

  it('does nothing for an empty batch', async () => {
    const sql = new RecordingSqlExecutor();
    await new SqlMetricsStore(sql).putIssueAggregates([]);
    expect(sql.sql).toHaveLength(0);
  });

  it('binds every filter value rather than interpolating it', async () => {
    const sql = new RecordingSqlExecutor();
    await new SqlMetricsStore(sql).queryStatusDurations({
      projectId: "10000'; DROP TABLE issue_meta; --",
      issueIds: ['a', 'b'],
      statusIds: ['3'],
    });
    const statement = sql.statements[0]!;
    expect(statement.statement).not.toContain('DROP TABLE');
    expect(statement.params[0]).toBe("10000'; DROP TABLE issue_meta; --");
    expect(statement.statement).toContain('issue_id IN (?, ?)');
    expect(statement.statement).toContain('status_id IN (?)');
  });

  it('clamps limits so no query can read the whole table', async () => {
    // LIMIT/OFFSET are inlined into the statement text, not bound — see the
    // comment on queryIssueMeta for why — so the clamp is asserted there.
    const sql = new RecordingSqlExecutor();
    const store = new SqlMetricsStore(sql);
    await store.queryIssueMeta({ projectId: '10000', limit: 10_000_000, offset: -5 });
    expect(sql.statements[0]?.params).toEqual(['10000']);
    expect(sql.sql[0]).toContain('LIMIT 10000 OFFSET 0');
  });

  it('deletes an issue from every table', async () => {
    const sql = new RecordingSqlExecutor();
    await new SqlMetricsStore(sql).deleteIssue('1');
    expect(sql.sql).toEqual([
      'DELETE FROM issue_status_agg WHERE issue_id = ?',
      'DELETE FROM worklog WHERE issue_id = ?',
      'DELETE FROM issue_history WHERE issue_id = ?',
      'DELETE FROM issue_meta WHERE issue_id = ?',
    ]);
  });

  it('replaces worklogs and history per issue', async () => {
    const sql = new RecordingSqlExecutor();
    const store = new SqlMetricsStore(sql);
    await store.putWorklogs('1', []);
    expect(sql.sql).toEqual(['DELETE FROM worklog WHERE issue_id = ?']);
    sql.clear();
    await store.putHistory('1', []);
    expect(sql.sql).toEqual(['DELETE FROM issue_history WHERE issue_id = ?']);
  });

  it('reads rows back through the mapping layer', async () => {
    const sql = new RecordingSqlExecutor((statement) =>
      statement.includes('FROM issue_meta')
        ? [
            {
              issue_id: '1',
              issue_key: 'FLOW-1',
              project_id: '10000',
              issue_type_id: null,
              priority_id: null,
              assignee_account_id: null,
              current_status_id: '3',
              created_at: 1,
              resolved_at: null,
              due_at: null,
              history_through_at: 2,
              truncated: 1,
              updated_at: 3,
            },
          ]
        : [],
    );
    const store = new SqlMetricsStore(sql);
    expect((await store.getIssueMeta('1'))?.truncated).toBe(true);
    expect(await store.getStatusMeta()).toEqual([]);
    expect(await store.getIndexState('10000')).toBeNull();
  });

  it('estimates bytes from row counts', async () => {
    const sql = new RecordingSqlExecutor(() => [
      {
        issue_meta: 10,
        issue_status_agg: 80,
        worklog: 0,
        issue_history: 0,
        status_meta: 5,
        status_name_history: 5,
        index_state: 1,
        app_settings: 1,
      },
    ]);
    expect(await new SqlMetricsStore(sql).estimateBytes()).toBeGreaterThan(0);
    const empty = new RecordingSqlExecutor(() => []);
    expect(await new SqlMetricsStore(empty).estimateBytes()).toBe(0);
  });

  it('skips no-op upserts', async () => {
    const sql = new RecordingSqlExecutor();
    const store = new SqlMetricsStore(sql);
    await store.upsertStatusMeta([]);
    await store.recordStatusNames([]);
    expect(sql.sql).toHaveLength(0);
  });
});

describe('forgeSqlExecutor', () => {
  // ⚠️ Read this before trusting the fake below.
  //
  // This suite used to build `bindParams` as taking an array, because that is
  // how the adapter called it — so it pinned the adapter to its own mistake and
  // passed while every statement failed on Forge with `argument mismatch, need
  // 2 but got 1`. A fake can only assert what its author already believes.
  //
  // The signature is now taken from the SDK rather than from us:
  // `bindParams(...args: SqlParameters): this` in
  // `@forge/sql/out/sql-statement.d.ts`, used as
  // `prepare(q).bindParams(migration.name)` by Forge's own migration runner.
  // `forge-host.contract.test.ts` does the equivalent job for `@forge/react`.
  it('spreads parameters into bindParams, and omits the call when there are none', async () => {
    const calls: { statement: string; params?: readonly unknown[] }[] = [];
    const fake = {
      prepare: <T>(statement: string) => ({
        bindParams: (...params: readonly unknown[]) => ({
          execute: () => {
            calls.push({ statement, params });
            return Promise.resolve({ rows: [] as T[] });
          },
        }),
        execute: () => {
          calls.push({ statement });
          return Promise.resolve({ rows: [{ n: 1 }] as unknown as T[] });
        },
      }),
    };
    const executor = forgeSqlExecutor(fake);
    expect(await executor.query('SELECT 1')).toEqual([{ n: 1 }]);
    // Two placeholders, two arguments — the case that was broken. Passing the
    // array bound one argument and Forge rejected the statement.
    await executor.execute('DELETE FROM x WHERE id = ? AND scope = ?', ['a', 'b']);
    expect(calls).toEqual([
      { statement: 'SELECT 1' },
      { statement: 'DELETE FROM x WHERE id = ? AND scope = ?', params: ['a', 'b'] },
    ]);
  });

  it('treats a missing rows property as no rows', async () => {
    const fake = {
      prepare: () => ({
        bindParams: (..._params: readonly unknown[]) => ({
          execute: () => Promise.resolve({}),
        }),
        execute: () => Promise.resolve({}),
      }),
    };
    expect(await forgeSqlExecutor(fake).query('SELECT 1')).toEqual([]);
  });
});

describe('JiraRestClient', () => {
  function respond(
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ): JiraResponseLike {
    return {
      status,
      headers: { get: (name) => headers[name] ?? null },
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
      json: () => Promise.resolve(body),
    };
  }

  it('asks Jira as the user, not as the app, for the browse permission', async () => {
    const appPaths: string[] = [];
    const userPaths: string[] = [];
    const client = new JiraRestClient(
      (path) => {
        appPaths.push(path);
        return Promise.resolve(respond(200, {}));
      },
      (path) => {
        userPaths.push(path);
        return Promise.resolve(
          respond(200, { permissions: { BROWSE_PROJECTS: { havePermission: true } } }),
        );
      },
    );
    expect(await client.canBrowseProject('10000')).toBe(true);
    expect(userPaths[0]).toBe(
      '/rest/api/3/mypermissions?projectId=10000&permissions=BROWSE_PROJECTS',
    );
    // Asking as the app would defeat the whole point of the check.
    expect(appPaths).toEqual([]);
  });

  it('treats anything short of an explicit grant as a refusal', async () => {
    const answers: unknown[] = [
      { permissions: { BROWSE_PROJECTS: { havePermission: false } } },
      { permissions: { BROWSE_PROJECTS: {} } },
      { permissions: {} },
      {},
    ];
    for (const body of answers) {
      const client = new JiraRestClient(
        () => Promise.resolve(respond(200, {})),
        () => Promise.resolve(respond(200, body)),
      );
      expect(await client.canBrowseProject('10000')).toBe(false);
    }
  });

  it('propagates a permission-check failure rather than answering false', async () => {
    // A transport failure is "unknown", not "no". The handler turns it into a
    // refusal, but the client must not manufacture an answer.
    const client = new JiraRestClient(
      () => Promise.resolve(respond(200, {})),
      () => Promise.resolve(respond(503, 'unavailable')),
    );
    await expect(client.canBrowseProject('10000')).rejects.toBeInstanceOf(HttpError);
  });

  it('builds the search request with the fields and page token it was given', async () => {
    const paths: string[] = [];
    const client = new JiraRestClient(
      (path) => {
        paths.push(path);
        return Promise.resolve(respond(200, { issues: [] }));
      },
      () => Promise.reject(new Error('as-user fetch must not be used for ingestion')),
    );
    await client.searchIssues({
      jql: 'project = "10000" ORDER BY created ASC',
      maxResults: 50,
      fields: ['created', 'status'],
      nextPageToken: 'TOKEN',
      expandChangelog: true,
    });
    const path = paths[0]!;
    expect(path.startsWith('/rest/api/3/search/jql?')).toBe(true);
    expect(path).toContain('maxResults=50');
    expect(path).toContain('fields=created%2Cstatus');
    expect(path).toContain('nextPageToken=TOKEN');
    expect(path).toContain('expand=changelog');
  });

  it('omits expand when the listing does not need the changelog', async () => {
    const paths: string[] = [];
    const client = new JiraRestClient(
      (path) => {
        paths.push(path);
        return Promise.resolve(respond(200, {}));
      },
      () => Promise.reject(new Error('unused')),
    );
    await client.searchIssues({ jql: 'x', maxResults: 1, fields: [] });
    expect(paths[0]).not.toContain('expand=');
  });

  it('encodes issue keys into the path', async () => {
    const paths: string[] = [];
    const client = new JiraRestClient(
      (path) => {
        paths.push(path);
        return Promise.resolve(respond(200, {}));
      },
      () => Promise.reject(new Error('unused')),
    );
    await client.getIssue('FLOW-1/../admin', ['status']);
    await client.getChangelog('FLOW 2', { startAt: 10, maxResults: 100 });
    await client.getWorklogs('FLOW-3', { startAt: 0, maxResults: 100 });
    expect(paths[0]).toContain('FLOW-1%2F..%2Fadmin');
    expect(paths[1]).toContain('FLOW%202/changelog?startAt=10&maxResults=100');
    expect(paths[2]).toContain('FLOW-3/worklog');
  });

  it('maps status metadata onto the engine categories', async () => {
    const client = new JiraRestClient(
      () =>
        Promise.resolve(
          respond(200, [
            { id: '10000', name: 'To Do', statusCategory: { key: 'new' } },
            { id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
            { id: '10001', statusCategory: { key: 'done' } },
            { name: 'no id — dropped' },
          ]),
        ),
      () => Promise.reject(new Error('unused')),
    );
    const statuses = await client.getStatuses();
    expect(statuses).toEqual<StatusMeta[]>([
      { id: '10000', name: 'To Do', category: 'todo' },
      { id: '3', name: 'In Progress', category: 'inprogress' },
      { id: '10001', name: '10001', category: 'done' },
    ]);
  });

  it('lists projects as the calling user, not the app', async () => {
    const asAppCalls: string[] = [];
    const asUserPaths: string[] = [];
    const client = new JiraRestClient(
      (path) => {
        asAppCalls.push(path);
        return Promise.reject(new Error('listProjects must not read as the app'));
      },
      (path) => {
        asUserPaths.push(path);
        return Promise.resolve(
          respond(200, {
            values: [{ id: '10000', key: 'FLOW', name: 'Flow' }],
            isLast: true,
          }),
        );
      },
    );
    const projects = await client.listProjects();
    expect(asAppCalls).toEqual([]);
    expect(asUserPaths[0]).toContain('/rest/api/3/project/search?');
    expect(asUserPaths[0]).toContain('maxResults=50');
    expect(projects).toEqual([{ id: '10000', key: 'FLOW', name: 'Flow' }]);
  });

  it('turns an HTTP failure into a retryable HttpError with Retry-After', async () => {
    const client = new JiraRestClient(
      () => Promise.resolve(respond(429, 'too many', { 'Retry-After': '30' })),
      () => Promise.reject(new Error('unused')),
      { now: () => NOW, retryAfterPaddingMs: 250 },
    );
    await expect(
      client.searchIssues({ jql: 'x', maxResults: 1, fields: [] }),
    ).rejects.toMatchObject({ status: 429, retryAfterMs: 30_250 });
  });

  it('keeps JQL out of the error message that reaches the logs', async () => {
    const client = new JiraRestClient(
      () => Promise.resolve(respond(500, 'boom')),
      () => Promise.reject(new Error('unused')),
    );
    const error = await client
      .searchIssues({ jql: 'summary ~ "customer secret"', maxResults: 1, fields: [] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).message).not.toContain('customer secret');
    expect((error as HttpError).message).toContain('<redacted>');
    expect(redact('/x?jql=a%20b&maxResults=1')).toBe('/x?jql=<redacted>&maxResults=1');
  });

  it('survives a response body it cannot read', async () => {
    const client = new JiraRestClient(
      () =>
        Promise.resolve({
          status: 502,
          headers: { get: () => null },
          text: () => Promise.reject(new Error('stream closed')),
          json: () => Promise.resolve(null),
        }),
      () => Promise.reject(new Error('unused')),
    );
    await expect(client.getIssue('X-1', [])).rejects.toBeInstanceOf(HttpError);
  });
});

describe('QueueScheduler', () => {
  // This fake used to take `(payload, options)` — two arguments, matching
  // what the adapter called at the time. Both were built from the same
  // plausible-but-wrong reading of `@forge/events`, so the fake could not
  // have caught the mismatch: it agreed with the code it was meant to check.
  // The real `Queue.push` takes one argument, `{ body, delayInSeconds }` —
  // confirmed by reading `@forge/events/out/queue.d.ts` after a live backfill
  // sat at "0 issues indexed" forever because every `push` call was rejected.
  it('pushes the job with a spacing delay', async () => {
    const pushed: unknown[] = [];
    const scheduler = new QueueScheduler({
      push: (event) => {
        pushed.push(event);
        return Promise.resolve({ jobId: 'job-1' });
      },
    });
    await scheduler.enqueueBackfill({ projectId: '10000', cursor: 'abc', slice: 3 });
    expect(pushed).toEqual([
      {
        body: { projectId: '10000', cursor: 'abc', slice: 3 },
        delayInSeconds: 5,
      },
    ]);
  });

  it('refuses to loop forever', async () => {
    const scheduler = new QueueScheduler(
      { push: () => Promise.resolve(undefined) },
      { maxSlices: 2 },
    );
    await expect(
      scheduler.enqueueBackfill({ projectId: '10000', cursor: null, slice: 3 }),
    ).rejects.toThrow('slice ceiling');
  });

  it('parses a queue payload defensively', () => {
    expect(jobFromPayload({ projectId: '10000', cursor: 'c', slice: 2 })).toEqual({
      projectId: '10000',
      cursor: 'c',
      slice: 2,
    });
    expect(jobFromPayload({ projectId: '10000' })).toEqual({
      projectId: '10000',
      cursor: null,
      slice: 0,
    });
    expect(jobFromPayload(null)).toBeNull();
    expect(jobFromPayload('nope')).toBeNull();
    expect(jobFromPayload({ projectId: '' })).toBeNull();
  });
});

describe('settings', () => {
  it('defaults to Mon-Fri 09:00-17:00 with an elapsed basis', () => {
    const settings = defaultSettings('Europe/Berlin');
    expect(settings.calendar.timeZone).toBe('Europe/Berlin');
    expect(settings.defaultBasis).toBe('elapsed');
    expect(settings.backfillMonths).toBe(12);
  });

  it('never throws on corrupt stored settings', () => {
    expect(parseSettings(null).defaultBasis).toBe('elapsed');
    expect(parseSettings('garbage').calendar.timeZone).toBe('UTC');
    expect(parseSettings({ calendar: { timeZone: 'Mars/Base' } }).calendar.timeZone).toBe('UTC');
    expect(parseSettings({ calendar: 42 }).calendar.timeZone).toBe('UTC');
    expect(parseSettings({ backfillMonths: 'lots' }).backfillMonths).toBe(12);
  });

  it('accepts a custom week, holidays and the 24/7 preset', () => {
    const custom = parseSettings({
      calendar: {
        timeZone: 'Europe/Berlin',
        name: 'Shift',
        week: { 1: [{ fromMinute: 360, toMinute: 840 }], 9: [], 2: 'nope' },
        holidays: ['2026-04-03', 'not-a-date'],
      },
      defaultBasis: 'business',
      backfillMonths: 3,
    });
    expect(custom.calendar.week[1]).toEqual([{ fromMinute: 360, toMinute: 840 }]);
    expect(custom.calendar.holidays).toEqual(['2026-04-03']);
    expect(custom.defaultBasis).toBe('business');
    expect(custom.backfillMonths).toBe(3);

    const always = parseSettings({ calendar: { timeZone: 'UTC', preset: '24x7' } });
    expect(always.calendar).toEqual(normaliseCalendar(alwaysOnCalendar('UTC')));
  });

  it('clamps an absurd backfill window and allows unlimited history', () => {
    expect(parseSettings({ backfillMonths: 9999 }).backfillMonths).toBe(120);
    expect(parseSettings({ backfillMonths: 0 }).backfillMonths).toBe(1);
    expect(parseSettings({ backfillMonths: null }).backfillMonths).toBeNull();
  });

  it('prefers the project row over the instance-wide one', async () => {
    // The instance-wide row is returned FIRST on purpose. Precedence used to
    // ride on `ORDER BY scope_key = ? DESC`, which Forge SQL refuses — a bound
    // parameter in an ORDER BY expression — so it is now decided in code, and
    // this ordering is what proves it no longer depends on the database.
    const sql = new RecordingSqlExecutor(() => [
      { scope_key: '__global__', settings: JSON.stringify({ defaultBasis: 'elapsed' }) },
      { scope_key: '10000', settings: JSON.stringify({ defaultBasis: 'business' }) },
    ]);
    const store = new SettingsStore(sql);
    expect((await store.get('10000')).defaultBasis).toBe('business');
    // The second read is served from the per-invocation cache.
    expect(sql.statements).toHaveLength(1);
    await store.get('10000');
    expect(sql.statements).toHaveLength(1);
  });

  it('writes settings as bound JSON and drops the cache entry', async () => {
    const sql = new RecordingSqlExecutor();
    const store = new SettingsStore(sql);
    await store.put('10000', defaultSettings('UTC'), NOW);
    expect(sql.sql[0]).toContain('INSERT INTO app_settings');
    expect(sql.statements[0]?.params[0]).toBe('10000');
    expect(String(sql.statements[0]?.params[1])).toContain('"defaultBasis":"elapsed"');
    store.clearCache();
  });
});

describe('ListingRuntime', () => {
  class StubJira implements JiraApi {
    constructor(private readonly issue: JiraIssue) {}
    canBrowseProject(): Promise<boolean> {
      return Promise.resolve(true);
    }
    searchIssues(): Promise<JiraSearchPage> {
      return Promise.resolve({ issues: [this.issue], isLast: true, nextPageToken: null, total: 1 });
    }
    getIssue(): Promise<JiraIssue> {
      return Promise.resolve(this.issue);
    }
    getChangelog() {
      return Promise.resolve({ values: [], total: 0, isLast: true });
    }
    getWorklogs() {
      return Promise.resolve({ worklogs: [], total: 0 });
    }
    getStatuses(): Promise<readonly StatusMeta[]> {
      return Promise.resolve([
        { id: '10000', name: 'To Do', category: 'todo' },
        { id: '3', name: 'In Progress', category: 'inprogress' },
      ]);
    }
    listProjects(): Promise<readonly JiraProjectRef[]> {
      return Promise.resolve([{ id: '10000', key: 'FLOW', name: 'Flow' }]);
    }
  }

  const issue: JiraIssue = {
    id: '20001',
    key: 'FLOW-1',
    fields: {
      created: '2026-03-01T09:00:00.000+0000',
      status: { id: '3', name: 'In Progress' },
      project: { id: '10000', key: 'FLOW' },
    },
    changelog: { total: 0, values: [], isLast: true },
  };

  function build() {
    const store = new MemoryStore();
    const sql = new RecordingSqlExecutor();
    const jobs: { projectId: string; cursor: string | null; slice: number }[] = [];
    const runtime = new ListingRuntime(
      {
        api: new StubJira(issue),
        store,
        settings: new SettingsStore(sql),
        scheduler: {
          enqueueBackfill: (job) => {
            jobs.push(job);
            return Promise.resolve();
          },
        },
        sleeper: instantSleeper,
        clock: { now: () => NOW },
      },
      {
        listingId: 'time-in-status',
        datasets: { statusDurations: true, worklogs: false, history: false },
      },
    );
    return { runtime, store, jobs };
  }

  it('exposes its listing id', () => {
    expect(build().runtime.listingId).toBe('time-in-status');
  });

  it('builds an ingest config from the project calendar', async () => {
    const { runtime } = build();
    const config = await runtime.ingestConfig('10000');
    expect(config.calendar).toEqual(normaliseCalendar(standardBusinessCalendar('UTC')));
    expect(config.datasets.statusDurations).toBe(true);
  });

  it('starts a backfill by resetting state and enqueuing slice zero', async () => {
    const { runtime, store, jobs } = build();
    await runtime.startBackfill('10000');
    expect(jobs).toEqual([{ projectId: '10000', cursor: null, slice: 0 }]);
    const state = await store.getIndexState('10000');
    expect(state?.state).toBe('not_started');
    expect(state?.backfillFrom).toBe(NOW - 12 * 30 * 86_400_000);
  });

  it('runs a slice, refreshing status metadata as it goes', async () => {
    const { runtime, store } = build();
    await runtime.startBackfill('10000');
    await runtime.runBackfill('10000', 0);
    expect((await store.getStatusMeta()).map((s) => s.statusId)).toEqual(['10000', '3']);
    expect((await store.getIndexState('10000'))?.state).toBe('complete');
    expect(await store.getIssueMeta('20001')).not.toBeNull();
  });

  it('ingests a single changed issue', async () => {
    const { runtime, store } = build();
    await runtime.startBackfill('10000');
    await runtime.onIssueChanged(
      { issue: { id: '20001' }, changelog: { items: [{ fieldId: 'status' }] } },
      '10000',
    );
    expect(await store.getIssueMeta('20001')).not.toBeNull();
    await runtime.onIssueDeleted({ issue: { id: '20001' } }, '10000');
    expect(await store.getIssueMeta('20001')).toBeNull();
  });

  it('marks a report partial until the backfill completes', async () => {
    const { runtime } = build();
    const before = await runtime.statusReport({ projectId: '10000' });
    expect(before.partial).toBe(true);
    expect(before.progress).toBeNull();

    await runtime.startBackfill('10000');
    await runtime.runBackfill('10000', 0);
    const after = await runtime.statusReport({ projectId: '10000' });
    expect(after.partial).toBe(false);
    expect(after.progress?.state).toBe('complete');
    expect(after.report.rows).toHaveLength(1);
  });

  it('clamps the page size a caller can ask for', async () => {
    const { runtime } = build();
    const envelope = await runtime.statusReport({ projectId: '10000', limit: 100_000, offset: -3 });
    expect(envelope.report.rows.length).toBeLessThanOrEqual(500);
  });

  it('defaults to a limit generous enough for a real project, not a demo one', async () => {
    // Found live against a 150-issue bulk-seeded project: the frontend never
    // sends a `limit` (see apps/time-in-status/src/frontend/index.tsx), so
    // whatever this resolver defaults to IS the report's real ceiling. Every
    // other report resolver defaults to 500 or more; this one silently
    // defaulted to 50, so a project past that size looked complete —
    // "Issues: 50", two full pages, no truncation notice — while three
    // quarters of its issues were simply never fetched.
    const { runtime, store } = build();
    for (let i = 0; i < 60; i += 1) {
      const issueId = `9${String(i).padStart(3, '0')}`;
      await store.putIssueAggregate(
        {
          issueId,
          issueKey: `FLOW-${i}`,
          projectId: '10000',
          issueTypeId: null,
          priorityId: null,
          assigneeAccountId: null,
          currentStatusId: '3',
          createdAt: NOW,
          resolvedAt: null,
          dueAt: null,
          historyThroughAt: NOW,
          truncated: false,
          updatedAt: NOW,
        },
        [
          {
            issueId,
            statusId: '3',
            elapsedMs: 1000,
            businessMs: 1000,
            entries: 1,
            lastEnteredAt: NOW,
            lastExitedAt: null,
            updatedAt: NOW,
          },
        ],
      );
    }
    const envelope = await runtime.statusReport({ projectId: '10000' });
    expect(envelope.report.rows).toHaveLength(60);
  });

  it('exports the same report as CSV', async () => {
    const { runtime } = build();
    await runtime.startBackfill('10000');
    await runtime.runBackfill('10000', 0);
    const csv = await runtime.statusReportCsv({ projectId: '10000' });
    expect(csv.split('\r\n')[0]).toContain('Issue key');
    expect(csv).toContain('FLOW-1');
  });

  it('labels the storage figure as an estimate', async () => {
    const { runtime } = build();
    const estimate = await runtime.storageEstimate();
    expect(estimate.note).toContain('Estimated');
  });
});

describe('SqlMetricsStore read and write paths not covered above', () => {
  it('upserts status metadata and name history with LEAST/GREATEST', async () => {
    const sql = new RecordingSqlExecutor();
    const store = new SqlMetricsStore(sql);
    await store.upsertStatusMeta([
      { statusId: '3', name: 'In Progress', category: 'inprogress', firstSeenAt: 1, lastSeenAt: 2 },
    ]);
    expect(sql.sql[0]).toContain('LEAST(first_seen_at, VALUES(first_seen_at))');
    expect(sql.sql[0]).toContain('GREATEST(last_seen_at, VALUES(last_seen_at))');
    sql.clear();

    await store.recordStatusNames([
      { statusId: '3', name: 'Doing', firstSeenAt: 1, lastSeenAt: 2 },
      { statusId: '3', name: 'In Progress', firstSeenAt: 3, lastSeenAt: 4 },
    ]);
    expect(sql.sql[0]).toContain('INSERT INTO status_name_history');
    expect(sql.statements[0]?.params).toHaveLength(8);
  });

  it('reads the status rename history for one status', async () => {
    const sql = new RecordingSqlExecutor(() => [
      { status_id: '3', name: 'Doing', first_seen_at: 1, last_seen_at: 2 },
    ]);
    const rows = await new SqlMetricsStore(sql).getStatusNameHistory('3');
    expect(rows).toEqual([{ statusId: '3', name: 'Doing', firstSeenAt: 1, lastSeenAt: 2 }]);
    expect(sql.statements[0]?.params).toEqual(['3']);
  });

  it('inserts worklogs and history in one statement each', async () => {
    const sql = new RecordingSqlExecutor();
    const store = new SqlMetricsStore(sql);
    await store.putWorklogs('1', [
      {
        worklogId: 'w1',
        issueId: '1',
        issueKey: 'FLOW-1',
        projectId: '10000',
        authorAccountId: 'a',
        authorDisplayName: 'Anna',
        startedAt: 1,
        timeSpentMs: 2,
        createdAt: null,
        updatedAt: null,
      },
    ]);
    expect(sql.sql[1]).toContain('INSERT INTO worklog');
    expect(sql.statements[1]?.params).toHaveLength(10);
    sql.clear();

    await store.putHistory('1', [
      {
        changeId: 'c1',
        issueId: '1',
        issueKey: 'FLOW-1',
        projectId: '10000',
        at: 9,
        authorAccountId: null,
        authorDisplayName: 'Anna',
        field: 'status',
        fieldLabel: 'status',
        fromValue: null,
        toValue: 'Done',
        fromId: null,
        toId: '10001',
      },
    ]);
    expect(sql.sql[1]).toContain('INSERT INTO issue_history');
    expect(sql.statements[1]?.params).toHaveLength(13);
  });

  it('binds every worklog filter', async () => {
    const sql = new RecordingSqlExecutor();
    await new SqlMetricsStore(sql).queryWorklogs({
      projectId: '10000',
      from: 100,
      to: 200,
      authorAccountIds: ['a', 'b'],
      limit: 25,
      offset: 5,
    });
    const statement = sql.statements[0]!;
    expect(statement.statement).toContain('started_at >= ?');
    expect(statement.statement).toContain('started_at < ?');
    expect(statement.statement).toContain('author_account_id IN (?, ?)');
    // LIMIT/OFFSET are inlined, not bound — see queryIssueMeta's comment.
    expect(statement.statement).toContain('LIMIT 25 OFFSET 5');
    expect(statement.params).toEqual(['10000', 100, 200, 'a', 'b']);
  });

  it('pushes the report filters into the issue_meta WHERE clause', async () => {
    const sql = new RecordingSqlExecutor();
    await new SqlMetricsStore(sql).queryIssueMeta({
      projectId: '10000',
      assigneeAccountIds: ['a', 'b'],
      issueTypeIds: ['10002'],
      createdFrom: 100,
      createdTo: 200,
      limit: 25,
      offset: 5,
    });
    const statement = sql.statements[0]!;
    expect(statement.statement).toContain('assignee_account_id IN (?, ?)');
    expect(statement.statement).toContain('issue_type_id IN (?)');
    expect(statement.statement).toContain('created_at >= ?');
    expect(statement.statement).toContain('created_at < ?');
    // LIMIT/OFFSET are inlined, not bound — see queryIssueMeta's comment.
    expect(statement.statement).toContain('LIMIT 25 OFFSET 5');
    expect(statement.params).toEqual(['10000', 'a', 'b', '10002', 100, 200]);
  });

  it('counts issue meta through the identical WHERE clause it pages with', async () => {
    // The page and the total must not build their own predicates: a report
    // that says "500 of 1,234" where the two halves filter differently is
    // exactly the silent wrongness TECHNICAL-SPEC § 11.1 is about.
    const sql = new RecordingSqlExecutor();
    const store = new SqlMetricsStore(sql);
    const query = {
      projectId: '10000',
      assigneeAccountIds: ['a'],
      createdFrom: 100,
    };
    await store.queryIssueMeta({ ...query, limit: 10 });
    await store.countIssueMeta(query);
    const [page, count] = sql.statements;
    const whereOf = (statement: string): string =>
      statement.slice(statement.indexOf('WHERE')).split('ORDER BY')[0]!.split('LIMIT')[0]!.trim();
    expect(whereOf(count!.statement)).toBe(whereOf(page!.statement));
    expect(count!.params).toEqual(page!.params);
  });

  it('omits an empty id list rather than emitting `IN ()`, which MySQL refuses', async () => {
    const sql = new RecordingSqlExecutor();
    await new SqlMetricsStore(sql).queryIssueMeta({
      projectId: '10000',
      assigneeAccountIds: [],
      issueTypeIds: [],
    });
    const statement = sql.statements[0]!;
    expect(statement.statement).not.toContain('IN ()');
    expect(statement.params).toEqual(['10000']);
  });

  it('lower-cases history field filters to match how they are stored', async () => {
    const sql = new RecordingSqlExecutor();
    await new SqlMetricsStore(sql).queryHistory({
      projectId: '10000',
      from: 1,
      to: 2,
      fields: ['STATUS', 'Assignee'],
      authorAccountIds: ['a'],
    });
    const statement = sql.statements[0]!;
    expect(statement.statement).toContain('field IN (?, ?)');
    expect(statement.params).toContain('status');
    expect(statement.params).toContain('assignee');
  });

  it('reads worklogs and history back through the mapping layer', async () => {
    const sql = new RecordingSqlExecutor((statement) =>
      statement.includes('FROM worklog')
        ? [
            {
              worklog_id: 'w1',
              issue_id: '1',
              issue_key: 'FLOW-1',
              project_id: '10000',
              author_account_id: 'a',
              author_display_name: 'Anna',
              started_at: 1,
              time_spent_ms: 2,
              created_at: null,
              updated_at: null,
            },
          ]
        : [
            {
              change_id: 'c1',
              issue_id: '1',
              issue_key: 'FLOW-1',
              project_id: '10000',
              changed_at: 9,
              author_account_id: null,
              author_display_name: 'Anna',
              field: 'status',
              field_label: 'status',
              from_value: null,
              to_value: 'Done',
              from_id: null,
              to_id: '10001',
            },
          ],
    );
    const store = new SqlMetricsStore(sql);
    expect(await store.queryWorklogs({ projectId: '10000' })).toHaveLength(1);
    expect(await store.queryHistory({ projectId: '10000' })).toHaveLength(1);
  });

  it('upserts and lists index state', async () => {
    const row: IndexStateRow = {
      projectId: '10000',
      state: 'running',
      backfillCursor: 'abc',
      backfillFrom: null,
      issuesProcessed: 3,
      issuesTotal: 9,
      lastProcessedAt: null,
      lastError: null,
      startedAt: NOW,
      updatedAt: NOW,
    };
    const sql = new RecordingSqlExecutor(() => [
      {
        project_id: '10000',
        state: 'running',
        backfill_cursor: 'abc',
        backfill_from: null,
        issues_processed: 3,
        issues_total: 9,
        last_processed_at: null,
        last_error: null,
        started_at: NOW,
        updated_at: NOW,
      },
    ]);
    const store = new SqlMetricsStore(sql);
    await store.putIndexState(row);
    expect(sql.sql[0]).toContain('INSERT INTO index_state');
    expect(sql.statements[0]?.params).toHaveLength(10);
    expect(await store.listIndexStates()).toEqual([row]);
    expect(await store.getIndexState('10000')).toEqual(row);
  });

  it('reads paged issue metadata and aggregates', async () => {
    const sql = new RecordingSqlExecutor((statement) => {
      if (statement.includes('FROM status_meta')) return [];
      return statement.includes('FROM issue_meta')
        ? [
            {
              issue_id: '1',
              issue_key: 'FLOW-1',
              project_id: '10000',
              issue_type_id: null,
              priority_id: null,
              assignee_account_id: null,
              current_status_id: '3',
              created_at: 1,
              resolved_at: null,
              due_at: null,
              history_through_at: 2,
              truncated: 0,
              updated_at: 3,
            },
          ]
        : [
            {
              issue_id: '1',
              status_id: '3',
              elapsed_ms: 10,
              business_ms: 5,
              entries: 1,
              last_entered_at: 1,
              last_exited_at: null,
              updated_at: 2,
            },
          ];
    });
    const store = new SqlMetricsStore(sql);
    expect(await store.queryIssueMeta({ projectId: '10000', limit: 10 })).toHaveLength(1);
    expect(await store.queryStatusDurations({ projectId: '10000' })).toHaveLength(1);
    expect(await store.getStatusMeta()).toHaveLength(0);
  });
});

describe('forgeJiraFetch', () => {
  it('hands the path to route as a zero-interpolation tagged template', async () => {
    const seen: unknown[] = [];
    const fakeRoute = (strings: TemplateStringsArray, ...values: unknown[]): string => {
      seen.push({ strings: [...strings], raw: [...strings.raw], values });
      return strings.join('');
    };
    const fakeApi = {
      asApp: () => ({
        requestJira: (routed: unknown) => {
          seen.push(routed);
          return Promise.resolve({
            status: 200,
            headers: { get: () => null },
            text: () => Promise.resolve(''),
            json: () => Promise.resolve({}),
          });
        },
      }),
    };
    const fetch = forgeJiraFetch(() => fakeApi.asApp(), fakeRoute);
    await fetch('/rest/api/3/status');
    expect(seen[0]).toEqual({
      strings: ['/rest/api/3/status'],
      raw: ['/rest/api/3/status'],
      values: [],
    });
    expect(seen[1]).toBe('/rest/api/3/status');
  });

  it('builds a template strings array that carries raw', () => {
    const strings = asTemplateStrings('/x');
    expect(strings.raw).toEqual(['/x']);
    expect([...strings]).toEqual(['/x']);
  });
});
