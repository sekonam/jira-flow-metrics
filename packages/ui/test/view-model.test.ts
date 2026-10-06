import { describe, expect, it } from 'vitest';
import type { BackfillProgress, JiraProjectRef, StatusReport } from '@jfm/engine';
import {
  formatBytes,
  formatCell,
  formatDate,
  formatDateTime,
  formatDurationForHumans,
  isIndexIncomplete,
  surfaceStateOf,
  toProgressBanner,
  gadgetEmptyMessage,
  toFlowChartBanner,
  toReportCapBanner,
  toCapNotice,
  toProjectOptions,
  toHours,
  toReportTable,
  toStatusChartData,
  toSummaryTiles,
} from '../src/view-model.js';

const HOUR = 3_600_000;

function report(overrides: Partial<StatusReport> = {}): StatusReport {
  return {
    aggregatesCapped: false,
    columns: [
      { statusId: '10000', name: 'To Do', category: 'todo' },
      { statusId: '3', name: 'In Progress', category: 'inprogress' },
    ],
    rows: [
      {
        issueId: '1',
        issueKey: 'FLOW-1',
        currentStatusId: '3',
        createdAt: Date.parse('2026-03-02T00:00:00Z'),
        resolvedAt: null,
        assigneeAccountId: null,
        issueTypeId: null,
        truncated: false,
        byStatus: { '10000': HOUR, '3': 12 * HOUR },
        entriesByStatus: { '10000': 1, '3': 2 },
        totalMs: 13 * HOUR,
      },
    ],
    basis: 'elapsed',
    summaryByStatus: {
      '3': {
        count: 2,
        meanMs: 8 * HOUR,
        medianMs: 8 * HOUR,
        p85Ms: 11 * HOUR,
        p95Ms: 12 * HOUR,
        minMs: 4 * HOUR,
        maxMs: 12 * HOUR,
      },
    },
    issueCount: 1,
    anyTruncated: false,
    matchingIssueCount: 1,
    capped: false,
    ...overrides,
  };
}

function progress(overrides: Partial<BackfillProgress> = {}): BackfillProgress {
  return {
    state: 'running',
    issuesProcessed: 500,
    issuesTotal: 2000,
    fraction: 0.25,
    lastError: null,
    startedAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('duration formatting', () => {
  it('distinguishes "never in this status" from "no time recorded"', () => {
    expect(formatCell(undefined)).toBe('—');
    expect(formatCell(0)).toBe('0m');
  });

  it('never rounds a real duration down to zero', () => {
    expect(formatDurationForHumans(12_000)).toBe('<1m');
    expect(formatDurationForHumans(1)).toBe('<1m');
  });

  it('scales the unit to what a human can act on', () => {
    expect(formatDurationForHumans(90_000)).toBe('2m');
    expect(formatDurationForHumans(HOUR)).toBe('1h');
    expect(formatDurationForHumans(HOUR + 1_800_000)).toBe('1h 30m');
    expect(formatDurationForHumans(26 * HOUR)).toBe('1d 2h');
    expect(formatDurationForHumans(Number.NaN)).toBe('—');
    expect(formatDurationForHumans(-5)).toBe('0m');
  });

  it('★ never renders sixty minutes as "60m"', () => {
    // 44h 59m 40s of working time. Rounding the remainder gives 60 minutes,
    // and "44h 60m" is not a duration. Reachable only on the no-day-roll-up
    // path, which is every working-hours column.
    const ms = 44 * HOUR + 59 * 60_000 + 40_000;
    expect(formatDurationForHumans(ms, { rollUpToDays: false })).toBe('45h');
    // The same rounding under an hour must still read as an hour, not "0h 60m".
    expect(formatDurationForHumans(59.6 * 60_000, { rollUpToDays: false })).toBe('1h');
  });

  it('formats a timestamp to the minute for logs, where the day is not enough', () => {
    expect(formatDateTime(Date.parse('2026-03-09T12:00:00Z'))).toBe('9 Mar 2026 12:00');
    expect(formatDateTime(Date.parse('2026-03-09T07:05:00Z'))).toBe('9 Mar 2026 07:05');
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(Number.NaN)).toBe('—');
  });

  it('formats dates unambiguously and locale-independently', () => {
    expect(formatDate(Date.parse('2026-03-02T00:00:00Z'))).toBe('2 Mar 2026');
    expect(formatDate(null)).toBe('—');
    expect(formatDate(Number.NaN)).toBe('—');
  });

  it('formats byte counts', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(16 * 1024 * 1024)).toBe('16 MB');
  });
});

describe('surface state', () => {
  it('picks one of the four designed states', () => {
    expect(surfaceStateOf({ loading: true, error: null, rowCount: 0 })).toBe('loading');
    expect(surfaceStateOf({ loading: false, error: 'x', rowCount: 5 })).toBe('error');
    expect(surfaceStateOf({ loading: false, error: null, rowCount: 0 })).toBe('empty');
    expect(surfaceStateOf({ loading: false, error: null, rowCount: 5 })).toBe('ready');
  });
});

describe('index completeness', () => {
  it('★ treats "never indexed" as incomplete, and only "complete" as complete', () => {
    expect(isIndexIncomplete(null)).toBe(true);
    expect(isIndexIncomplete(progress({ state: 'complete' }))).toBe(false);
    for (const state of ['not_started', 'running', 'paused', 'failed'] as const) {
      expect(isIndexIncomplete(progress({ state }))).toBe(true);
    }
  });
});

describe('report table model', () => {
  it('builds headers from the report columns', () => {
    expect(toReportTable(report()).headers).toEqual([
      'Issue',
      'Status',
      'Created',
      'Resolved',
      'To Do',
      'In Progress',
      'Total',
    ]);
  });

  it('marks a re-entered status, which is the product argument in one badge', () => {
    const table = toReportTable(report());
    const row = table.rows[0]!;
    expect(row.cells[1]).toEqual({
      text: '12h',
      // The figure behind the text, so the column sorts on duration rather
      // than on how the duration happens to read.
      ms: 12 * HOUR,
      entries: 2,
      reentered: true,
    });
    expect(row.cells[0]?.reentered).toBe(false);
    expect(table.footnotes.some((f) => f.includes('cumulative across every visit'))).toBe(true);
  });

  it('explains partial history rather than hiding it', () => {
    const base = report();
    const truncated = report({
      rows: [{ ...base.rows[0]!, truncated: true }],
      anyTruncated: true,
    });
    const table = toReportTable(truncated);
    expect(table.rows[0]?.truncated).toBe(true);
    expect(table.footnotes.some((f) => f.includes('lower bound'))).toBe(true);
  });

  it('labels the basis', () => {
    expect(toReportTable(report()).basisLabel).toBe('Measured in elapsed time');
    expect(toReportTable(report({ basis: 'business' })).basisLabel).toBe(
      'Measured in working hours',
    );
  });

  /**
   * Found by rendering the report and reading it as a Jira user would.
   *
   * `44h` of *elapsed* time is unambiguously "1d 20h" — a day is a day. `27h`
   * of *working* time is not: Jira's own duration format uses the instance's
   * working hours per day (8 by default), so "1d 3h" in a working-hours column
   * reads as 11 hours to the person it is shown to, not 27. Rolling working
   * time into days is therefore off by a factor of three in the reader's head,
   * which is exactly the quiet wrongness this product is sold against.
   */
  it('★ never rolls working time up into days, because a working day is not 24h', () => {
    const base = report();
    const long = report({
      basis: 'business',
      rows: [
        {
          ...base.rows[0]!,
          byStatus: { '10000': 15 * HOUR, '3': 44 * HOUR },
          totalMs: 59 * HOUR,
        },
      ],
    });
    const row = toReportTable(long).rows[0]!;
    expect(row.cells[1]?.text).toBe('44h');
    expect(row.total).toBe('59h');
  });

  it('does roll elapsed time up into days, where a day means a day', () => {
    const base = report();
    const long = report({
      rows: [{ ...base.rows[0]!, byStatus: { '10000': HOUR, '3': 44 * HOUR }, totalMs: 45 * HOUR }],
    });
    const row = toReportTable(long).rows[0]!;
    expect(row.cells[1]?.text).toBe('1d 20h');
    expect(row.total).toBe('1d 21h');
  });

  it('handles a row whose current status is unknown', () => {
    const base = report();
    const table = toReportTable(report({ rows: [{ ...base.rows[0]!, currentStatusId: null }] }));
    expect(table.rows[0]?.currentStatus).toBe('—');
  });

  it('falls back to the status id when no name is known', () => {
    const base = report();
    const table = toReportTable(report({ rows: [{ ...base.rows[0]!, currentStatusId: 'ghost' }] }));
    expect(table.rows[0]?.currentStatus).toBe('ghost');
  });
});

describe('summary tiles', () => {
  /**
   * ★ Found by reading the deployed app, not the code: the Issue History
   * page rendered "Changes 8564" beside its own banner reading "Report capped
   * at 500 of 8,564 changes" — the same number, twice, formatted two ways,
   * eighty pixels apart. Every count below a thousand hid it, which is every
   * count the fixtures and both seeded projects produce for this tile.
   *
   * A figure is the one thing this product sells, and an unseparated
   * five-digit one reads as a different number for the half-second it takes
   * to count the digits.
   */
  it('★ separates thousands on a tile, like every other figure on the page', () => {
    const tiles = toSummaryTiles(report({ matchingIssueCount: 12_345, issueCount: 9_999 }));
    expect(tiles[0]?.value).toBe('12,345');
    expect(tiles[0]?.hint).toContain('9,999 of them');
  });

  it('★ reports working-hours medians in hours, matching the table', () => {
    const tiles = toSummaryTiles(
      report({
        basis: 'business',
        summaryByStatus: {
          '3': {
            count: 2,
            meanMs: 30 * HOUR,
            medianMs: 30 * HOUR,
            p85Ms: 40 * HOUR,
            p95Ms: 44 * HOUR,
            minMs: 20 * HOUR,
            maxMs: 44 * HOUR,
          },
        },
      }),
    );
    expect(tiles[1]?.value).toBe('30h');
    expect(tiles[1]?.hint).toContain('85th percentile 40h');
  });

  it('leads with the issue count and reports median plus 85th percentile', () => {
    const tiles = toSummaryTiles(report());
    expect(tiles[0]).toMatchObject({ label: 'Issues', value: '1' });
    expect(tiles[1]?.label).toBe('In Progress · median');
    expect(tiles[1]?.value).toBe('8h');
    expect(tiles[1]?.hint).toContain('85th percentile 11h');
  });

  it('skips statuses with no sample', () => {
    expect(toSummaryTiles(report({ summaryByStatus: {} }))).toHaveLength(1);
  });

  it('copes with a summary that has no median', () => {
    const tiles = toSummaryTiles(
      report({
        summaryByStatus: {
          '3': {
            count: 1,
            meanMs: null,
            medianMs: null,
            p85Ms: null,
            p95Ms: null,
            minMs: null,
            maxMs: null,
          },
        },
      }),
    );
    expect(tiles[1]?.value).toBe('—');
    expect(tiles[1]?.hint).toBe('Across 1 issue.');
  });
});

describe('indexing banner', () => {
  it('tells the user when nothing is indexed yet', () => {
    expect(toProgressBanner(null)).toMatchObject({ title: 'Not indexed yet' });
  });

  it('disappears only once indexing is complete', () => {
    expect(toProgressBanner(progress({ state: 'complete' }))).toBeNull();
  });

  it('says the numbers are partial while indexing runs', () => {
    const banner = toProgressBanner(progress());
    expect(banner?.body).toContain('500 of 2,000 issues indexed (25%)');
    expect(banner?.body).toContain('only the issues indexed so far');
  });

  /**
   * ★ One claim that it is moving, not two. A determinate bar already says
   * so and says how far; a spinner beside it is a second animation making the
   * weaker version of the same statement. The spinner is what a backfill with
   * no total to divide by gets, because there a bar could only lie.
   */
  it('★ spins only where there is no share to draw', () => {
    expect(toProgressBanner(progress())?.showSpinner).toBe(false);
    expect(toProgressBanner(progress({ fraction: null, issuesTotal: null }))?.showSpinner).toBe(
      true,
    );
  });

  /**
   * The share a bar can be drawn at, carried rather than left in the prose for
   * `IndexingBanner` to parse back out of a sentence. `null` where it is not
   * knowable: not indexed at all, finished, or a backfill Jira gave no total
   * for — a bar at 0% in that last case would deny work that has happened.
   */
  it('★ carries the completed share, and withholds it where there is none', () => {
    expect(toProgressBanner(progress())?.fraction).toBe(0.25);
    expect(toProgressBanner(progress({ state: 'paused' }))?.fraction).toBe(0.25);
    expect(toProgressBanner(progress({ state: 'failed' }))?.fraction).toBe(0.25);
    expect(toProgressBanner(progress({ fraction: null, issuesTotal: null }))?.fraction).toBeNull();
    expect(toProgressBanner(null)?.fraction).toBeNull();
  });

  it('reports a rate-limit pause as expected rather than as a fault', () => {
    const banner = toProgressBanner(progress({ state: 'paused' }));
    expect(banner?.appearance).toBe('warning');
    expect(banner?.body).toContain('resume automatically');
  });

  it('surfaces the recorded error on failure', () => {
    const banner = toProgressBanner(progress({ state: 'failed', lastError: 'HTTP 403' }));
    expect(banner?.appearance).toBe('error');
    expect(banner?.body).toContain('HTTP 403');
    expect(toProgressBanner(progress({ state: 'failed' }))?.body).toContain('No error detail');
  });

  it('offers a retry only on failure — a failed backfill has no other way back', () => {
    // Found live: a backfill that fails after indexing some issues leaves the
    // report non-empty, so `EmptySurface`'s "Start indexing" button (the only
    // other place this action lives — see `IndexingBanner`'s docstring) never
    // renders either. Without this, a failed project is stuck permanently.
    expect(toProgressBanner(progress({ state: 'failed' }))?.showRetry).toBe(true);
    for (const state of ['not_started', 'running', 'paused'] as const) {
      expect(toProgressBanner(progress({ state }))?.showRetry).toBe(false);
    }
    expect(toProgressBanner(null)?.showRetry).toBe(false);
  });

  it('does not invent a percentage when Jira gave no total', () => {
    const banner = toProgressBanner(progress({ fraction: null, issuesTotal: null }));
    expect(banner?.body).toContain('500 issues indexed.');
    expect(banner?.body).not.toContain('%');
  });

  it('treats not_started as indexing in progress', () => {
    expect(toProgressBanner(progress({ state: 'not_started' }))?.title).toBe(
      'Indexing in progress',
    );
    expect(
      toProgressBanner(progress({ state: 'not_started', fraction: null, issuesTotal: null }))
        ?.showSpinner,
    ).toBe(true);
  });
});

describe('toProjectOptions', () => {
  const projects: JiraProjectRef[] = [
    { id: '2', key: 'ZED', name: 'Zed Project' },
    { id: '1', key: 'ABC', name: 'Abc Project' },
  ];

  it('maps id to value and name to label, sorted by label', () => {
    expect(toProjectOptions(projects)).toEqual([
      { label: 'Abc Project', value: '1' },
      { label: 'Zed Project', value: '2' },
    ]);
  });

  it('falls back to key, then id, when name is missing', () => {
    expect(toProjectOptions([{ id: '1', key: 'ABC' }])).toEqual([{ label: 'ABC', value: '1' }]);
    expect(toProjectOptions([{ id: '1' }])).toEqual([{ label: '1', value: '1' }]);
  });

  it('drops a project with no id — nothing view.submit could use', () => {
    expect(toProjectOptions([{ key: 'ABC', name: 'Abc' }])).toEqual([]);
    expect(toProjectOptions([{ id: '', name: 'Abc' }])).toEqual([]);
  });

  it('returns an empty list for an empty input', () => {
    expect(toProjectOptions([])).toEqual([]);
  });
});

describe('toHours', () => {
  it('reports hours to two decimals', () => {
    expect(toHours(90 * 60_000)).toBe(1.5);
    expect(toHours(HOUR)).toBe(1);
    // 1h 3m — the chart axis reads 1.05 against a table reading "1h 3m".
    expect(toHours(63 * 60_000)).toBe(1.05);
  });

  it('★ never renders a real duration as zero', () => {
    // A zero bar is documented by `toStatusChartData` as "a different and
    // wrong claim" — it reads as "no time is spent here". At one decimal,
    // anything under three minutes became exactly that bar, so a status with
    // a real two-minute median passed the guard and was then plotted as the
    // thing the guard exists to prevent.
    expect(toHours(2 * 60_000)).toBeGreaterThan(0);
    expect(toHours(3_000)).toBeGreaterThan(0);
    expect(toHours(1)).toBe(0.01);
  });

  it('treats a missing or negative duration as zero rather than NaN', () => {
    // A NaN reaching `BarChart` is a bar of undefined height, which renders
    // as a silently absent category rather than an error. Genuine zero stays
    // zero — the floor is for measured time, not for its absence.
    expect(toHours(Number.NaN)).toBe(0);
    expect(toHours(-HOUR)).toBe(0);
    expect(toHours(0)).toBe(0);
  });
});

describe('toStatusChartData', () => {
  it('plots the median for every status that has one', () => {
    expect(toStatusChartData(report())).toEqual([{ label: 'In Progress', value: 8 }]);
  });

  it('drops a status with no measured issues rather than plotting it as zero', () => {
    // "To Do" has a column but no summary: no issue has a measurable stay in
    // it. A zero bar would claim "no time is spent here", which is a
    // different and wrong statement from "not measured".
    const data = toStatusChartData(report());
    expect(data.map((point) => point.label)).not.toContain('To Do');
  });

  it('is empty when nothing has been measured, so the chart can withhold itself', () => {
    expect(toStatusChartData(report({ summaryByStatus: {} }))).toEqual([]);
  });

  it('skips a summary whose median is null', () => {
    const data = toStatusChartData(
      report({
        summaryByStatus: {
          '3': {
            count: 1,
            meanMs: null,
            medianMs: null,
            p85Ms: null,
            p95Ms: null,
            minMs: null,
            maxMs: null,
          },
        },
      }),
    );
    expect(data).toEqual([]);
  });
});

describe('★ not knowing the index state is not a claim about it', () => {
  // `null` carried both "never indexed" and "the call that would have told
  // us failed", and every reader chose the first — so a page whose report
  // loaded fine and whose `getIndexProgress` rejected rendered "Not indexed
  // yet — start indexing to build the report" directly above a populated
  // report of that project's issues. Two statements about one project on
  // one screen, one of them false.

  it('renders no indexing banner at all when the state is unknown', () => {
    expect(toProgressBanner('unknown')).toBeNull();
    // Whereas a genuine never-indexed project still gets the invitation.
    expect(toProgressBanner(null)?.title).toBe('Not indexed yet');
  });

  it('falls back to the sentence that is true either way in a gadget', () => {
    expect(gadgetEmptyMessage('unknown')).toBe('Nothing to show for this project yet.');
    expect(gadgetEmptyMessage(null)).toMatch(/has not been indexed yet/);
  });

  it('does not report a partial index it cannot see', () => {
    // A "these figures cover part of your history" warning is as much a
    // claim as a clean bill of health.
    expect(isIndexIncomplete('unknown')).toBe(false);
    expect(isIndexIncomplete(null)).toBe(true);
  });
});

describe("★ a gadget's empty state has to say which empty it is", () => {
  // The pages have distinguished these since the four-state design was
  // written; the gadgets said "Nothing to show for this project yet" for
  // both, which claims the project is empty when what is true is that the
  // app has never looked at it. Found by the screenshot guard: `empty` and
  // `not-indexed` were byte-identical on four of the five gadgets.
  const progress = (state: BackfillProgress['state']): BackfillProgress => ({
    state,
    issuesProcessed: 0,
    issuesTotal: null,
    fraction: null,
    lastError: null,
    startedAt: null,
    updatedAt: 0,
  });

  it('names a never-indexed project as never indexed', () => {
    expect(gadgetEmptyMessage(null)).toMatch(/has not been indexed yet/);
    expect(gadgetEmptyMessage(progress('not_started'))).toMatch(/has not been indexed yet/);
  });

  it('says indexing is still running rather than that there is nothing', () => {
    expect(gadgetEmptyMessage(progress('running'))).toMatch(/still running/);
    expect(gadgetEmptyMessage(progress('paused'))).toMatch(/still running/);
  });

  it('says so when indexing failed, and where to look', () => {
    expect(gadgetEmptyMessage(progress('failed'))).toMatch(/did not finish/);
    expect(gadgetEmptyMessage(progress('failed'))).toMatch(/project menu/);
  });

  it('only claims the project is empty when it has actually been indexed', () => {
    expect(gadgetEmptyMessage(progress('complete'))).toBe('Nothing to show for this project yet.');
  });

  it('★ gives a different answer for every state, so no two render alike', () => {
    const said = new Set(
      [null, ...(['not_started', 'running', 'paused', 'failed', 'complete'] as const)].map(
        (state) => gadgetEmptyMessage(state === null ? null : progress(state)),
      ),
    );
    // `null` and `not_started` are the same statement, and `running`/`paused`
    // are one statement too — four distinct sentences for six states.
    expect(said.size).toBe(4);
  });
});

describe('★ a cap banner must not contradict itself', () => {
  it('says only what a report without a denominator knows', () => {
    // The cumulative flow report has no honest total — `issueCount` counts
    // what was read, not what exists — and passing it as both halves of
    // `toCapBanner` produced "Report capped at 412 of 412 issues": a title
    // saying nothing was left out above a body saying the rest are missing.
    const banner = toFlowChartBanner({
      capped: true,
      partial: false,
      covered: 412,
      total: 412,
      rowLimit: 500,
      rowNoun: 'status changes',
      pageCapped: false,
    });
    expect(banner).not.toBeNull();
    expect(banner?.title).toContain('412 issues');
    expect(banner?.title).not.toContain('of 412');
    expect(banner?.body).toContain('lower bound');
  });

  it('★ names the block it covers, not the page', () => {
    // Observed on the deployed app against JFMB (900 issues): this banner
    // landed between the two charts, under the "Age distribution" heading,
    // and claimed "every figure on it is a lower bound" — while the tiles and
    // the table above it come from a different resolver, a different table
    // and a different cap. Five figures on one page that a reader cannot
    // reconcile. A banner that covers one block has to name that block and
    // leave the rest of the page to the banner that does cover it.
    const banner = toFlowChartBanner({
      capped: true,
      partial: false,
      covered: 102,
      total: 102,
      rowLimit: 500,
      rowNoun: 'status changes',
      pageCapped: true,
    });
    expect(banner?.title).toContain('cumulative flow chart');
    // ★ The page-wide claim is the half that was false, and the assertion is
    // on "every figure" rather than the old sentence verbatim: a reworded
    // sentence that still indicts the whole page is the same defect.
    expect(banner?.body).not.toContain('every figure');
    expect(banner?.body).toContain('each figure in it is a lower bound');
    // ★ The ceiling is 500 rows of `issue_status_visit`; 102 is a derived
    // distinct-issue count. The old title counted issues while its body said
    // "rows", so the one number on screen was not the one that fired.
    expect(banner?.body).toContain('500 status changes');
    // And it points at the banner that does speak for the rest of the page.
    expect(banner?.body).toMatch(/capped separately/);
  });

  /**
   * ★ The JFM defect, at the surface that has to say it.
   *
   * The chart was drawn from one issue in ten and claimed nothing. The
   * remedy belongs in the sentence too: this is not something a reader can
   * narrow their way out of, it is an index that has never written visits for
   * those issues, and *Extend history* is what writes them.
   */
  it('★ says how much of the project the chart is drawn from, and what fixes it', () => {
    const banner = toFlowChartBanner({
      capped: false,
      partial: true,
      covered: 1,
      total: 10,
      rowLimit: 500,
      rowNoun: 'status changes',
      pageCapped: false,
    });
    expect(banner?.title).toBe('The cumulative flow chart above is drawn from 1 of 10 issues');
    expect(banner?.body).toContain('The other 9 have no status history stored yet');
    // ★ Read in place on the live tenant: the banner renders *under* the
    // chart, so "the bands below" pointed at the issues table — the same
    // wrong-neighbour defect the title's "above" exists to avoid, re-made one
    // sentence later.
    expect(banner?.body).not.toContain('below');
    expect(banner?.body).toContain('Extend history');
    // Not capped, so it must not claim a ceiling it never hit, and there is
    // no page banner to point at.
    expect(banner?.body).not.toContain('status changes it reads');
    expect(banner?.body).not.toContain('capped separately');
  });

  /**
   * The two facts are mutually exclusive by construction — `buildFlowReport`
   * refuses to call a cut read partial, because it cannot tell an unindexed
   * issue from one beyond the row ceiling. The builder still handles both, so
   * that a future caller passing both gets a banner that states both rather
   * than one that silently drops a warning.
   */
  it('states both problems in one banner rather than stacking two', () => {
    const banner = toFlowChartBanner({
      capped: true,
      partial: true,
      covered: 102,
      total: 900,
      rowLimit: 500,
      rowNoun: 'status changes',
      pageCapped: true,
    });
    expect(banner?.title).toContain('drawn from 102 of 900 issues');
    expect(banner?.body).toContain('Extend history');
    expect(banner?.body).toContain('500 status changes');
    expect(banner?.body).toContain('capped separately');
  });

  it('is silent when nothing was truncated', () => {
    expect(
      toFlowChartBanner({
        capped: false,
        partial: false,
        covered: 12,
        total: 12,
        rowLimit: 500,
        rowNoun: 'status changes',
        pageCapped: false,
      }),
    ).toBeNull();
  });

  it("★ picks by which of a report's two ceilings actually fired", () => {
    // The aging and SLA reports can be truncated two ways, and only one of
    // them has a denominator to name. Collapsing both into one `capped`
    // boolean put the identical contradiction back on those two pages:
    // "Report capped at 400 of 400 issues".
    const issuePage = toReportCapBanner({
      capped: true,
      aggregatesCapped: false,
      included: 400,
      total: 5000,
      noun: 'issues',
    });
    expect(issuePage?.title).toBe('Report capped at 400 of 5,000 issues');

    const aggregates = toReportCapBanner({
      capped: true,
      aggregatesCapped: true,
      included: 400,
      total: 400,
      noun: 'issues',
    });
    expect(aggregates?.title).toBe('Some of these 400 issues are missing measurements');
    expect(aggregates?.title).not.toContain('of 400');
    expect(aggregates?.body).toContain('part of their history');

    expect(
      toReportCapBanner({
        capped: false,
        aggregatesCapped: false,
        included: 400,
        total: 400,
        noun: 'issues',
      }),
    ).toBeNull();
  });

  it('★ names both ceilings when both fired', () => {
    // The SLA report withholds its attainment figure on a truncated
    // aggregate read. Printing only the issue-page banner left the reader
    // with a blank headline tile and no sentence explaining why it was
    // blank.
    const both = toReportCapBanner({
      capped: true,
      aggregatesCapped: true,
      included: 500,
      total: 600,
      noun: 'issues',
    });
    expect(both?.title).toBe('Report capped at 500 of 600 issues');
    expect(both?.body).toContain('missing measurements');

    // And `aggregatesCapped` is the discriminator, not `included < total`:
    // the two happen to agree on these two reports today, via an invariant
    // held in another package and stated nowhere in this one.
    const pageOnly = toReportCapBanner({
      capped: true,
      aggregatesCapped: false,
      included: 500,
      total: 500,
      noun: 'issues',
    });
    expect(pageOnly?.title).toBe('Report capped at 500 of 500 issues');
    expect(pageOnly?.body).not.toContain('missing measurements');
  });

  it('★ makes the same distinction in a gadget footnote', () => {
    // A gadget has room for a sentence rather than a banner, and printed
    // "Covering 400 of 400 issues, so every figure here is a lower bound".
    expect(
      toCapNotice({
        capped: true,
        aggregatesCapped: false,
        included: 400,
        total: 5000,
        noun: 'issues',
      }),
    ).toBe('Covering 400 of 5,000 issues, so every figure here is a lower bound.');
    expect(
      toCapNotice({
        capped: true,
        aggregatesCapped: true,
        included: 400,
        total: 400,
        noun: 'issues',
      }),
    ).toBe(
      'Some of these 400 issues are missing measurements, so every figure here is a lower bound.',
    );
    expect(
      toCapNotice({
        capped: false,
        aggregatesCapped: false,
        included: 4,
        total: 4,
        noun: 'issues',
      }),
    ).toBeNull();

    // ★ Both ceilings. This branch was added with the banner's and tested
    // only there: all three assertions above pass with it deleted, and
    // deleting it drops the "of 5,000" denominator from the gadget — the
    // exact information the banner side was fixed to keep.
    expect(
      toCapNotice({
        capped: true,
        aggregatesCapped: true,
        included: 400,
        total: 5000,
        noun: 'issues',
      }),
    ).toBe(
      'Covering 400 of 5,000 issues, and some of those are missing measurements, so every figure here is a lower bound.',
    );
  });
});

describe('★ the summary tile hint has to be true on every surface', () => {
  it('does not promise rows "below" — a gadget renders tiles and no table', () => {
    // It read "1,500 issues … 200 of them are shown below" on a dashboard
    // gadget, above nothing at all.
    const tiles = toSummaryTiles(report({ issueCount: 200, matchingIssueCount: 1500 }));
    expect(tiles[0]?.value).toBe('1,500');
    expect(tiles[0]?.hint).not.toContain('below');
    expect(tiles[0]?.hint).toContain('cover 200 of them');
  });
});
