import { describe, expect, it } from 'vitest';
import {
  standardBusinessCalendar,
  type JiraApi,
  type JiraChangelogEntry,
  type JiraChangelogPage,
  type JiraIssue,
  type JiraProjectRef,
  type JiraSearchPage,
  type StatusMeta,
} from '@jfm/engine';
import { buildIssueTimeline, deriveGoal } from '../src/issue-timeline.js';

/**
 * The issue panel's timeline.
 *
 * The one report in the product built from Jira rather than from the store,
 * so these tests drive a stub `JiraApi` rather than a seeded `MemoryStore` —
 * which is itself the thing worth asserting about it.
 */

const CALENDAR = standardBusinessCalendar('UTC');
const HOUR = 3_600_000;
/** A Monday, so the working-hours arithmetic is not fighting a weekend. */
const MON_09 = Date.parse('2026-03-02T09:00:00Z');

function entry(at: string, from: [string, string], to: [string, string]): JiraChangelogEntry {
  return {
    id: at,
    created: at,
    author: { accountId: 'anna', displayName: 'Anna' },
    items: [
      {
        field: 'status',
        fieldId: 'status',
        from: from[0],
        fromString: from[1],
        to: to[0],
        toString: to[1],
      },
    ],
  };
}

const STATUSES: readonly StatusMeta[] = [
  { id: '1', name: 'To Do', category: 'todo' },
  { id: '3', name: 'In Progress', category: 'inprogress' },
  { id: '5', name: 'Done', category: 'done' },
];

class StubJira implements JiraApi {
  changelogPages: JiraChangelogPage[] = [];
  statuses: readonly StatusMeta[] = STATUSES;
  issue: JiraIssue = {
    id: '20001',
    key: 'FLOW-1',
    fields: {
      created: '2026-03-02T09:00:00.000+0000',
      status: { id: '3', name: 'In Progress' },
      project: { id: '10000', key: 'FLOW' },
    },
  };
  readonly changelogCalls: number[] = [];

  canBrowseProject(): Promise<boolean> {
    return Promise.resolve(true);
  }
  isAdmin(): Promise<boolean> {
    return Promise.resolve(true);
  }
  searchIssues(): Promise<JiraSearchPage> {
    return Promise.resolve({ issues: [], isLast: true, nextPageToken: null, total: 0 });
  }
  getIssue(): Promise<JiraIssue> {
    return Promise.resolve(this.issue);
  }
  getChangelog(_id: string, page: { startAt: number }): Promise<JiraChangelogPage> {
    this.changelogCalls.push(page.startAt);
    return Promise.resolve(
      this.changelogPages[this.changelogCalls.length - 1] ?? {
        values: [],
        total: 0,
        isLast: true,
      },
    );
  }
  getWorklogs() {
    return Promise.resolve({ worklogs: [], total: 0 });
  }
  getStatuses(): Promise<readonly StatusMeta[]> {
    return Promise.resolve(this.statuses);
  }
  listProjects(): Promise<readonly JiraProjectRef[]> {
    return Promise.resolve([]);
  }
}

function deps(api: JiraApi, now: number) {
  return {
    api,
    calendar: CALENDAR,
    now,
    maxChangelogEntries: 2000,
    pageSize: 50,
    targetMs: 8 * HOUR,
    sleeper: { sleep: () => Promise.resolve() },
  };
}

describe('the issue panel timeline', () => {
  it('★ measures each visit separately rather than dividing a total', async () => {
    // To Do 09:00-10:00, In Progress 10:00-11:00, back to To Do 11:00-14:00,
    // In Progress again from 14:00. The product's whole argument is that
    // those two In Progress visits are different lengths and Jira's Control
    // Chart reports only the second.
    const api = new StubJira();
    api.changelogPages = [
      {
        isLast: true,
        total: 3,
        values: [
          entry('2026-03-02T10:00:00.000+0000', ['1', 'To Do'], ['3', 'In Progress']),
          entry('2026-03-02T11:00:00.000+0000', ['3', 'In Progress'], ['1', 'To Do']),
          entry('2026-03-02T14:00:00.000+0000', ['1', 'To Do'], ['3', 'In Progress']),
        ],
      },
    ];
    const { report } = await buildIssueTimeline('FLOW-1', deps(api, MON_09 + 5 * HOUR));

    expect(report.visits.map((v) => [v.statusName, v.elapsedMs / HOUR])).toEqual([
      ['To Do', 1],
      ['In Progress', 1],
      ['To Do', 3],
      ['In Progress', 0],
    ]);
    // And the totals are what the report page shows for this issue: two
    // visits to each status, summed.
    const inProgress = report.totals.find((t) => t.statusName === 'In Progress');
    expect(inProgress?.entries).toBe(2);
    expect(inProgress?.elapsedMs).toBe(1 * HOUR);
  });

  it('marks the visit still in progress rather than closing it silently', async () => {
    const api = new StubJira();
    api.changelogPages = [
      {
        isLast: true,
        total: 1,
        values: [entry('2026-03-02T10:00:00.000+0000', ['1', 'To Do'], ['3', 'In Progress'])],
      },
    ];
    const { report } = await buildIssueTimeline('FLOW-1', deps(api, MON_09 + 4 * HOUR));
    expect(report.visits.at(-1)?.exitedAt).toBeNull();
  });

  it('★ discounts time back in a to-do status from the working figure', async () => {
    // Started at 10:00, sent back at 11:00, restarted at 14:00, still open
    // at 15:00: two working hours in progress, three paused. An issue parked
    // in the backlog for a fortnight and then finished in an hour should
    // read as about an hour, which is what a reader means by how long the
    // work took.
    const api = new StubJira();
    api.changelogPages = [
      {
        isLast: true,
        total: 3,
        values: [
          entry('2026-03-02T10:00:00.000+0000', ['1', 'To Do'], ['3', 'In Progress']),
          entry('2026-03-02T11:00:00.000+0000', ['3', 'In Progress'], ['1', 'To Do']),
          entry('2026-03-02T14:00:00.000+0000', ['1', 'To Do'], ['3', 'In Progress']),
        ],
      },
    ];
    const { report } = await buildIssueTimeline('FLOW-1', deps(api, MON_09 + 6 * HOUR));
    expect(report.sla?.elapsedWorkingMs).toBe(2 * HOUR);
    expect(report.sla?.pausedMs).toBe(3 * HOUR);
    expect(report.sla?.breached).toBe(false);
  });

  it('returns the project Jira says the issue belongs to, for the permission check', async () => {
    const api = new StubJira();
    const { projectId } = await buildIssueTimeline('FLOW-1', deps(api, MON_09 + HOUR));
    expect(projectId).toBe('10000');
  });

  it('withholds the derived goal when the issue has not started', async () => {
    // No transitions at all: created and never moved. An SLA reading of
    // "0h consumed, within target" on an issue nobody has started is a
    // claim, and the wrong one.
    const api = new StubJira();
    api.issue = {
      ...api.issue,
      fields: { ...api.issue.fields, status: { id: '1', name: 'To Do' } },
    };
    const { report } = await buildIssueTimeline('FLOW-1', deps(api, MON_09 + HOUR));
    expect(report.sla).toBeNull();
  });

  it('withholds the derived goal when the instance has no in-progress category', async () => {
    const api = new StubJira();
    api.statuses = [{ id: '1', name: 'To Do', category: 'todo' }];
    expect(deriveGoal(api.statuses, CALENDAR, HOUR)).toBeNull();
    const { report } = await buildIssueTimeline('FLOW-1', deps(api, MON_09 + HOUR));
    expect(report.sla).toBeNull();
  });

  it('pages the changelog and says so when it is cut short', async () => {
    const api = new StubJira();
    api.changelogPages = [
      {
        isLast: false,
        total: 10,
        values: [entry('2026-03-02T10:00:00.000+0000', ['1', 'To Do'], ['3', 'In Progress'])],
      },
      {
        isLast: true,
        total: 10,
        values: [entry('2026-03-02T11:00:00.000+0000', ['3', 'In Progress'], ['5', 'Done'])],
      },
    ];
    const { report } = await buildIssueTimeline('FLOW-1', deps(api, MON_09 + 6 * HOUR));
    expect(api.changelogCalls).toEqual([0, 1]);
    expect(report.truncated).toBe(false);

    const capped = new StubJira();
    capped.changelogPages = [
      {
        isLast: false,
        total: 10,
        values: [entry('2026-03-02T10:00:00.000+0000', ['1', 'To Do'], ['3', 'In Progress'])],
      },
    ];
    const cappedResult = await buildIssueTimeline('FLOW-1', {
      ...deps(capped, MON_09 + 6 * HOUR),
      maxChangelogEntries: 1,
    });
    // Truncated rather than partial-and-silent, exactly as the report
    // table's "partial history" lozenge is.
    expect(cappedResult.report.truncated).toBe(true);
  });

  it('refuses an issue with no created date rather than inventing one', async () => {
    const api = new StubJira();
    const { created: _dropped, ...withoutCreated } = api.issue.fields ?? {};
    api.issue = { ...api.issue, fields: withoutCreated };
    await expect(buildIssueTimeline('FLOW-1', deps(api, MON_09))).rejects.toThrow(/created date/);
  });
});
