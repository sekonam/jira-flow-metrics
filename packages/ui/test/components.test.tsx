// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BackfillProgress, StatusReport } from '@jfm/engine';
import { auditA11y, describeFindings } from '@jfm/ui-harness';

/**
 * Rendering tests for `packages/ui/src/components.tsx`.
 *
 * ## Read this before trusting anything below
 *
 * `@forge/react`'s UI Kit 2 exports are **string sentinels**, not React
 * components — `exports.Box = 'Box'`. A Forge app's tree is reconciled into a
 * ForgeDoc and posted over the bridge; the code that turns that document into
 * Atlassian Design System markup ships inside Jira and is not installable from
 * npm. So this suite mocks `@forge/react` with the stand-in host renderer in
 * `packages/ui-harness/src/forge-host.tsx`, which maps each sentinel onto the
 * ADS component the Forge host is documented to render it as.
 *
 * **This is not platform verification.** No `forge login`, `forge deploy` or
 * `forge tunnel` has ever run against this repository, and no Atlassian tenant
 * has ever served these components. What the suite does establish is that the
 * component tree is coherent, that the four designed states are selected and
 * rendered, that the formatted numbers and the re-entry evidence reach the
 * DOM, and that the resulting markup passes an axe WCAG 2.1 AA audit.
 *
 * `forge-host.contract.test.ts` pins the stand-in to the real `@forge/react`
 * module so an upgrade that changes a component name fails here rather than on
 * deploy.
 */

vi.mock('@forge/react', () => import('@jfm/ui-harness/forge-host'));

const {
  CsvExport,
  EmptySurface,
  ErrorSurface,
  IndexingBanner,
  LoadingSurface,
  PageHeader,
  ReportTable,
  SimpleReportTable,
  SummaryTiles,
  toProgressBanner,
  toReportTable,
  toSummaryTiles,
} = await import('../src/index.js');

afterEach(() => {
  cleanup();
});

/** Fails with the offending markup rather than a bare boolean. */
async function expectNoA11yViolations(): Promise<void> {
  const findings = await auditA11y(document.body);
  expect(describeFindings(findings)).toBe('no violations');
}

const HOUR = 3_600_000;

/**
 * A report with the two things the product sells: a status entered twice, and
 * a row whose history was truncated. Both must be visible, not just present in
 * the model.
 */
const REPORT: StatusReport = {
  basis: 'elapsed',
  issueCount: 2,
  anyTruncated: true,
  columns: [
    { statusId: '10000', name: 'To Do' },
    { statusId: '3', name: 'In Progress' },
    { statusId: '10100', name: 'Blocked' },
  ],
  summaryByStatus: {
    '3': {
      count: 2,
      meanMs: 14 * HOUR,
      medianMs: 12 * HOUR,
      p85Ms: 20 * HOUR,
      p95Ms: 20 * HOUR,
      minMs: 4 * HOUR,
      maxMs: 20 * HOUR,
    },
  },
  rows: [
    {
      issueId: '20003',
      issueKey: 'FLOW-3',
      currentStatusId: '10100',
      createdAt: Date.parse('2026-03-02T08:00:00Z'),
      resolvedAt: null,
      assigneeAccountId: 'acc-anna',
      issueTypeId: '10001',
      truncated: false,
      byStatus: { '10000': HOUR, '3': 12 * HOUR, '10100': 44 * HOUR },
      entriesByStatus: { '10000': 1, '3': 2, '10100': 1 },
      totalMs: 57 * HOUR,
    },
    {
      issueId: '20004',
      issueKey: 'FLOW-4',
      currentStatusId: '10000',
      createdAt: Date.parse('2026-03-05T08:00:00Z'),
      resolvedAt: Date.parse('2026-03-05T09:30:00Z'),
      assigneeAccountId: null,
      issueTypeId: null,
      truncated: true,
      // No Blocked key at all: the issue was never in that status, which must
      // render as an em dash rather than "0m".
      byStatus: { '10000': 30_000, '3': 0 },
      entriesByStatus: { '10000': 1, '3': 1 },
      totalMs: 30_000,
    },
  ],
};

function headerTexts(): string[] {
  return screen.getAllByRole('columnheader').map((cell) => cell.textContent ?? '');
}

function rowTexts(issueKey: string): string[] {
  const cell = screen.getByText(issueKey);
  const row = cell.closest('tr');
  if (row === null) throw new Error(`no row for ${issueKey}`);
  return within(row)
    .getAllByRole('cell')
    .map((c) => c.textContent ?? '');
}

describe('LoadingSurface', () => {
  it('names what is loading, for the screen reader as well as the eye', async () => {
    render(<LoadingSurface label="Loading report" />);
    expect(screen.getAllByText('Loading report').length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: 'Loading report' })).toBeDefined();
    await expectNoA11yViolations();
  });
});

describe('ErrorSurface', () => {
  it('shows the message and a retry button when a retry is possible', async () => {
    const onRetry = vi.fn();
    render(<ErrorSurface message="Jira is rate-limiting requests right now." onRetry={onRetry} />);
    expect(screen.getByText('Could not load this report')).toBeDefined();
    expect(screen.getByText('Jira is rate-limiting requests right now.')).toBeDefined();
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    await expectNoA11yViolations();
  });

  it('omits the button when there is nothing to retry', () => {
    render(<ErrorSurface message="No permission." />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('EmptySurface', () => {
  it('renders a heading, an explanation and an optional action', async () => {
    const onAction = vi.fn();
    render(
      <EmptySurface
        title="No indexed issues yet"
        body="Once indexing finishes, every issue appears here."
        actionLabel="Start indexing"
        onAction={onAction}
      />,
    );
    expect(screen.getByRole('heading', { name: 'No indexed issues yet' })).toBeDefined();
    screen.getByRole('button', { name: 'Start indexing' }).click();
    expect(onAction).toHaveBeenCalledTimes(1);
    await expectNoA11yViolations();
  });

  it('renders no action when only a label is supplied', () => {
    render(<EmptySurface title="Nothing" body="Nothing at all" actionLabel="Ignored" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('IndexingBanner', () => {
  it('renders nothing once indexing is complete', () => {
    const complete: BackfillProgress = {
      state: 'complete',
      issuesProcessed: 4,
      issuesTotal: 4,
      fraction: 1,
      lastError: null,
      startedAt: 0,
      updatedAt: 0,
    };
    const { container } = render(<IndexingBanner banner={toProgressBanner(complete)} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows progress and a spinner while the backfill is running', async () => {
    const running: BackfillProgress = {
      state: 'running',
      issuesProcessed: 1200,
      issuesTotal: 4000,
      fraction: 0.3,
      lastError: null,
      startedAt: 0,
      updatedAt: 0,
    };
    render(<IndexingBanner banner={toProgressBanner(running)} />);
    expect(screen.getByText(/1,200 of 4,000 issues indexed \(30%\)/)).toBeDefined();
    expect(screen.getByText(/only the issues indexed so far/)).toBeDefined();
    expect(screen.getByRole('img', { name: 'Indexing' })).toBeDefined();
    await expectNoA11yViolations();
  });

  /**
   * The banner carries no action. On a project with no index there are no
   * rows, so the empty state is on screen at the same time offering the very
   * same button — which is what the rendered screen showed.
   */
  it('★ states that nothing is indexed without duplicating the empty state action', async () => {
    render(<IndexingBanner banner={toProgressBanner(null)} />);
    expect(screen.getByText('Not indexed yet')).toBeDefined();
    expect(screen.getByText('Start indexing to build the report for this project.')).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
    await expectNoA11yViolations();
  });

  it('reports a rate-limit pause as a warning that needs no action', async () => {
    const paused: BackfillProgress = {
      state: 'paused',
      issuesProcessed: 10,
      issuesTotal: null,
      fraction: null,
      lastError: null,
      startedAt: 0,
      updatedAt: 0,
    };
    render(<IndexingBanner banner={toProgressBanner(paused)} />);
    expect(screen.getByText('Indexing paused — Jira rate limit')).toBeDefined();
    expect(screen.getByText(/needs no action/)).toBeDefined();
    await expectNoA11yViolations();
  });

  it('surfaces the recorded error when indexing failed', async () => {
    const failed: BackfillProgress = {
      state: 'failed',
      issuesProcessed: 3,
      issuesTotal: 9,
      fraction: 1 / 3,
      lastError: 'HTTP 500 from Jira',
      startedAt: 0,
      updatedAt: 0,
    };
    render(<IndexingBanner banner={toProgressBanner(failed)} />);
    expect(screen.getByText(/HTTP 500 from Jira/)).toBeDefined();
    await expectNoA11yViolations();
  });
});

describe('SummaryTiles', () => {
  it('renders the median as the headline and the percentile as the hint', async () => {
    render(<SummaryTiles tiles={toSummaryTiles(REPORT)} />);
    expect(screen.getByText('Issues')).toBeDefined();
    expect(screen.getByRole('heading', { name: '2' })).toBeDefined();
    expect(screen.getByText('In Progress · median')).toBeDefined();
    expect(screen.getByRole('heading', { name: '12h' })).toBeDefined();
    expect(screen.getByText('85th percentile 20h, across 2 issues.')).toBeDefined();
    await expectNoA11yViolations();
  });
});

describe('PageHeader', () => {
  it('renders the title as the page heading', async () => {
    render(
      <PageHeader
        title="Time in Status"
        subtitle="Cumulative time each issue has spent in every status."
        actions={<button type="button">Export</button>}
      />,
    );
    const heading = screen.getByRole('heading', { name: 'Time in Status' });
    expect(heading.tagName).toBe('H1');
    expect(screen.getByRole('button', { name: 'Export' })).toBeDefined();
    await expectNoA11yViolations();
  });
});

describe('ReportTable', () => {
  it('orders columns as issue, status, dates, then one per status, then total', () => {
    render(<ReportTable model={toReportTable(REPORT)} />);
    expect(headerTexts()).toEqual([
      'Issue',
      'Status',
      'Created',
      'Resolved',
      'To Do',
      'In Progress',
      'Blocked',
      'Total',
    ]);
  });

  it('formats every duration at the precision a human can act on', () => {
    render(<ReportTable model={toReportTable(REPORT)} />);
    expect(rowTexts('FLOW-3')).toEqual([
      'FLOW-3',
      'Blocked',
      '2 Mar 2026',
      '—',
      '1h',
      '12hx2',
      '1d 20h',
      '2d 9h',
    ]);
  });

  it('distinguishes "never in this status" from "no time recorded"', () => {
    render(<ReportTable model={toReportTable(REPORT)} />);
    const cells = rowTexts('FLOW-4');
    expect(cells[4]).toBe('<1m'); // 30 seconds in To Do, not "0m"
    expect(cells[5]).toBe('0m'); // measured as zero
    expect(cells[6]).toBe('—'); // never entered Blocked
  });

  it('★ makes the cumulative-vs-most-recent distinction visible, not just true', () => {
    render(<ReportTable model={toReportTable(REPORT)} />);
    // The badge on the cell: this status was entered twice.
    const inProgress = rowTexts('FLOW-3')[5];
    expect(inProgress).toBe('12hx2');
    // And the footnote that says what that means, which is the whole claim.
    expect(
      screen.getByText(
        /These durations are cumulative across every visit; Jira's own control chart shows only the most recent one\./,
      ),
    ).toBeDefined();
  });

  it('marks a truncated row and explains that its total is a lower bound', () => {
    render(<ReportTable model={toReportTable(REPORT)} />);
    const row = screen.getByText('FLOW-4').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('partial history')).toBeDefined();
    expect(screen.getByText(/their totals are a lower bound/)).toBeDefined();
  });

  it('renders a real table, and passes the accessibility audit', async () => {
    render(<ReportTable model={toReportTable(REPORT)} />);
    expect(screen.getByRole('table')).toBeDefined();
    await expectNoA11yViolations();
  });
});

describe('SimpleReportTable', () => {
  it('renders headers, rows and footnotes in order', async () => {
    render(
      <SimpleReportTable
        model={{
          headers: ['Person', 'Time logged', 'Share'],
          rows: [
            ['Anna Weber', '4h 30m', '60%'],
            ['Ben Fischer', '3h', '40%'],
          ],
          footnotes: ['7h 30m logged across 3 entries.'],
        }}
      />,
    );
    expect(headerTexts()).toEqual(['Person', 'Time logged', 'Share']);
    expect(rowTexts('Anna Weber')).toEqual(['Anna Weber', '4h 30m', '60%']);
    expect(screen.getByText('7h 30m logged across 3 entries.')).toBeDefined();
    await expectNoA11yViolations();
  });

  it('renders an empty table without throwing', () => {
    render(<SimpleReportTable model={{ headers: ['A'], rows: [], footnotes: [] }} />);
    expect(screen.getByRole('table')).toBeDefined();
  });

  it('★ emphasises the column the model nominates, not always the first', () => {
    render(
      <SimpleReportTable
        model={{
          headers: ['When (UTC)', 'Issue'],
          rows: [['9 Mar 2026 12:00', 'FLOW-1']],
          footnotes: [],
          emphasisColumn: 1,
        }}
      />,
    );
    expect(screen.getByText('FLOW-1').tagName).toBe('STRONG');
    expect(screen.getByText('9 Mar 2026 12:00').tagName).not.toBe('STRONG');
  });
});

describe('CsvExport', () => {
  const CSV = 'Issue,Status,Elapsed\nFLOW-1,In Progress,3h\nFLOW-2,Done,1d\n';

  it('shows a button and nothing else until it is asked', () => {
    render(<CsvExport onRequestCsv={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('puts the CSV and its filename on screen when asked', async () => {
    const onRequestCsv = vi
      .fn()
      .mockResolvedValue({ filename: 'time-in-status-10000.csv', csv: CSV });
    render(<CsvExport onRequestCsv={onRequestCsv} />);

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    const dialog = await screen.findByRole('dialog');

    expect(onRequestCsv).toHaveBeenCalledTimes(1);
    // The whole file, not a preview: this is the only copy the user gets.
    // Read off the element rather than via getByText, which collapses the
    // newlines that make a CSV a CSV.
    expect(dialog.querySelector('pre')?.textContent).toBe(CSV);
    expect(within(dialog).getAllByText(/time-in-status-10000\.csv/).length).toBeGreaterThan(0);
  });

  it('explains why it cannot simply download the file', async () => {
    // The modal is a workaround for a sandbox with no DOM, and saying so is
    // the difference between a limitation and an apparent bug.
    render(<CsvExport onRequestCsv={vi.fn().mockResolvedValue({ filename: 'a.csv', csv: CSV })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/sandbox that cannot hand a file to the browser/)).toBeTruthy();
  });

  it('closes again', async () => {
    render(<CsvExport onRequestCsv={vi.fn().mockResolvedValue({ filename: 'a.csv', csv: CSV })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('reports a refusal instead of opening an empty dialog', async () => {
    const onRequestCsv = vi.fn().mockRejectedValue(new Error('You do not have permission.'));
    render(<CsvExport onRequestCsv={onRequestCsv} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(await screen.findByText('You do not have permission.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('survives a rejection that is not an Error', async () => {
    // A resolver refusal arrives over the bridge and need not be an Error.
    render(<CsvExport onRequestCsv={vi.fn().mockRejectedValue('nope')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText(/could not be produced/)).toBeTruthy();
  });

  it('passes an axe audit with the dialog open', async () => {
    render(<CsvExport onRequestCsv={vi.fn().mockResolvedValue({ filename: 'a.csv', csv: CSV })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await screen.findByRole('dialog');
    await expectNoA11yViolations();
  });
});
