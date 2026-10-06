// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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
  AgingHistogram,
  CsvExport,
  DEFAULT_SLA_GOAL,
  EMPTY_FILTERS,
  EmptySurface,
  ErrorSurface,
  ExtendHistoryControl,
  GadgetConfigForm,
  IndexingBanner,
  LoadingSurface,
  PageHeader,
  ReportBarChart,
  ReportFilters,
  ReportLineChart,
  ReportTable,
  SimpleReportTable,
  SlaGoalForm,
  SummaryTiles,
  cellKey,
  useIndexingRefresh,
  filtersToRequest,
  hasActiveFilters,
  toCapBanner,
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
  matchingIssueCount: 2,
  capped: false,
  aggregatesCapped: false,
  columns: [
    { statusId: '10000', name: 'To Do', category: 'todo' },
    { statusId: '3', name: 'In Progress', category: 'inprogress' },
    { statusId: '10100', name: 'Blocked', category: 'inprogress' },
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

  /**
   * ★ The first-run screen is a progress bar, not a sentence to re-read.
   *
   * `BackfillProgress.fraction` has been computed since the backfill was
   * written and reached no screen: the banner spelled the percentage into
   * prose beside an indeterminate spinner, so the one question a first-time
   * user has — is this moving, and how far has it got — was answered only by
   * reading a number and remembering the last one. A bar answers it at a
   * glance, and this is the screen a buyer meets before any report exists.
   */
  it('★ draws how far the backfill has got, instead of only spelling it out', async () => {
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
    const bar = screen.getByRole('progressbar', { name: 'Indexing progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('30');
    // The spinner is gone: a bar that fills is the same "it is moving" claim,
    // made once rather than twice.
    expect(screen.queryByRole('img', { name: 'Indexing' })).toBeNull();
    await expectNoA11yViolations();
  });

  /**
   * Jira does not always return a total to divide by — `fraction` is null
   * then, and a bar drawn at 0% would read as "nothing has happened" over a
   * backfill that has processed thousands of issues. The spinner is the
   * honest control for an unknown share.
   */
  it('keeps the spinner when Jira gave no total to measure against', async () => {
    const running: BackfillProgress = {
      state: 'running',
      issuesProcessed: 1200,
      issuesTotal: null,
      fraction: null,
      lastError: null,
      startedAt: 0,
      updatedAt: 0,
    };
    render(<IndexingBanner banner={toProgressBanner(running)} />);
    expect(screen.getByText(/1,200 issues indexed\./)).toBeDefined();
    expect(screen.getByRole('img', { name: 'Indexing' })).toBeDefined();
    expect(screen.queryByRole('progressbar')).toBeNull();
    await expectNoA11yViolations();
  });

  /**
   * A paused backfill shows no spinner — nothing is moving — but how far it
   * got before Jira rate-limited it is exactly what the reader wants, and the
   * bar is the only thing on that banner that answers it without arithmetic.
   */
  it('still draws the bar once indexing has paused', async () => {
    const paused: BackfillProgress = {
      state: 'paused',
      issuesProcessed: 500,
      issuesTotal: 1000,
      fraction: 0.5,
      lastError: null,
      startedAt: 0,
      updatedAt: 0,
    };
    render(<IndexingBanner banner={toProgressBanner(paused)} />);
    expect(
      screen.getByRole('progressbar', { name: 'Indexing progress' }).getAttribute('aria-valuenow'),
    ).toBe('50');
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

  it('offers a retry button on failure, and calls it back on click', async () => {
    const failed: BackfillProgress = {
      state: 'failed',
      issuesProcessed: 3,
      issuesTotal: 9,
      fraction: 1 / 3,
      lastError: 'HTTP 500 from Jira',
      startedAt: 0,
      updatedAt: 0,
    };
    const onRetry = vi.fn();
    render(<IndexingBanner banner={toProgressBanner(failed)} onRetry={onRetry} />);
    const button = screen.getByRole('button', { name: 'Retry indexing' });
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledOnce();
    await expectNoA11yViolations();
  });

  it('renders no retry button when the caller gives none, even on failure', () => {
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
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('never shows a retry button on a non-failed banner, even if one is given', () => {
    const running: BackfillProgress = {
      state: 'running',
      issuesProcessed: 1,
      issuesTotal: 4,
      fraction: 0.25,
      lastError: null,
      startedAt: 0,
      updatedAt: 0,
    };
    render(<IndexingBanner banner={toProgressBanner(running)} onRetry={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('GadgetConfigForm', () => {
  const OPTIONS = [
    { label: 'Abc Project', value: '1' },
    { label: 'Zed Project', value: '2' },
  ];

  it('shows a loading state while the project list is still in flight', () => {
    render(<GadgetConfigForm options={null} saving={false} onSave={vi.fn()} />);
    expect(screen.getByText('Loading projects')).toBeDefined();
  });

  it("shows the picker's own error surface when the project list failed", () => {
    render(<GadgetConfigForm options={null} error="boom" saving={false} onSave={vi.fn()} />);
    expect(screen.getByText('boom')).toBeDefined();
  });

  it('disables Save until a project is picked', async () => {
    render(<GadgetConfigForm options={OPTIONS} saving={false} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
    await expectNoA11yViolations();
  });

  it('calls onSave with the selected project id', () => {
    const onSave = vi.fn();
    render(<GadgetConfigForm options={OPTIONS} saving={false} onSave={onSave} />);
    // react-select renders its listbox on focus/open rather than as plain
    // options in the DOM up front, so this drives it the way a user would:
    // open the menu, then select an option out of what react-select shows.
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.click(screen.getByText('Zed Project'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('2');
  });

  it('disables the picker and Save while a save is in flight', () => {
    render(<GadgetConfigForm options={OPTIONS} saving={true} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('SlaGoalForm', () => {
  const STATUSES = [
    { id: '3', name: 'In Progress' },
    { id: '10200', name: 'In Review' },
  ];

  /**
   * ★ Configuration that outranks the report it configures.
   *
   * Rendered, this form opened the page: a page-wide target dropdown, a row of
   * chips, a page-wide name field and a Save button, all above the first
   * number. The reader's question is "are we hitting the goal", and the
   * answer sat below a form most people touch once. Naming it as a section
   * and holding the controls to the width of what they hold is what turns it
   * from the page's subject into its settings.
   */
  it('★ reads as a named section rather than as the page itself', async () => {
    render(<SlaGoalForm statuses={STATUSES} goal={DEFAULT_SLA_GOAL} onChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Goal' })).toBeDefined();
    await expectNoA11yViolations();
  });

  it('renders the target picker and one chip per status', async () => {
    render(<SlaGoalForm statuses={STATUSES} goal={DEFAULT_SLA_GOAL} onChange={vi.fn()} />);
    expect(screen.getByText('Working-time target')).toBeDefined();
    expect(screen.getByRole('button', { name: 'In Progress' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'In Review' })).toBeDefined();
    expect(screen.getByText(/Counting time in every status/)).toBeDefined();
    await expectNoA11yViolations();
  });

  it('toggles a status into and out of the counted set', () => {
    const onChange = vi.fn();
    render(<SlaGoalForm statuses={STATUSES} goal={DEFAULT_SLA_GOAL} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'In Review' }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_SLA_GOAL, countedStatusIds: ['10200'] });

    cleanup();
    onChange.mockClear();
    const goal = { ...DEFAULT_SLA_GOAL, countedStatusIds: ['10200'] };
    render(<SlaGoalForm statuses={STATUSES} goal={goal} onChange={onChange} />);
    // The caption names the statuses rather than referring to them: an ADS
    // Button with `isSelected` carries its state in colour alone, so this
    // sentence is the only thing a screen reader can use to tell which
    // statuses the goal counts.
    expect(screen.getByText(/only in: In Review/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'In Review' }));
    expect(onChange).toHaveBeenCalledWith({ ...goal, countedStatusIds: [] });
  });

  it('★ shows an unlisted target exactly, not rounded to the nearest hour', () => {
    // `parseSlaGoal` accepts any target from a minute to a year; only the six
    // presets are whole hours. Rounding the label rendered a 90-minute goal
    // as "2 working hours" while every number on the page was divided by 90
    // minutes — the control disagreeing with the computation, which is the
    // defect the comment on the control above it says was fixed.
    const goal = { ...DEFAULT_SLA_GOAL, targetMs: 90 * 60_000 };
    render(<SlaGoalForm statuses={STATUSES} goal={goal} onChange={vi.fn()} />);
    expect(screen.getByText('1h 30m of working time')).toBeDefined();
    expect(screen.queryByText('2 working hours')).toBeNull();
  });

  it('reports a changed target through onChange', () => {
    const onChange = vi.fn();
    render(<SlaGoalForm statuses={STATUSES} goal={DEFAULT_SLA_GOAL} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.click(screen.getByText('40 working hours'));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_SLA_GOAL, targetMs: 40 * 3_600_000 });
  });
});

describe('SlaGoalForm as a goal editor', () => {
  const STATUSES = [
    { id: '3', name: 'In Progress' },
    { id: '10200', name: 'In Review' },
  ];
  const SAVED = [
    { id: 'g-1', name: 'Time to resolution', countedStatusIds: ['3'], targetMs: 4 * 3_600_000 },
  ];

  it('shows no editor at all when the page does not pass one', async () => {
    // Four of the five listings render this form with no save callback, and
    // the v1 picker must look exactly as it did.
    render(<SlaGoalForm statuses={STATUSES} goal={DEFAULT_SLA_GOAL} onChange={vi.fn()} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save goal' })).toBeNull();
    await expectNoA11yViolations();
  });

  it('says plainly when the selection on screen is not saved', async () => {
    render(
      <SlaGoalForm
        statuses={STATUSES}
        goal={DEFAULT_SLA_GOAL}
        savedGoals={SAVED}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText(/This selection is not saved/)).toBeDefined();
    await expectNoA11yViolations();
  });

  it('names the saved goal the numbers are measured against', () => {
    render(
      <SlaGoalForm
        statuses={STATUSES}
        goal={{ countedStatusIds: ['3'], targetMs: 4 * 3_600_000, savedGoalId: 'g-1' }}
        savedGoals={SAVED}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText(/Measuring against the saved goal "Time to resolution"/)).toBeDefined();
  });

  it('loads a saved goal as the choice, id and all', () => {
    const onChange = vi.fn();
    render(
      <SlaGoalForm
        statuses={STATUSES}
        goal={DEFAULT_SLA_GOAL}
        savedGoals={SAVED}
        onChange={onChange}
        onSave={vi.fn()}
      />,
    );
    const pickers = screen.getAllByRole('combobox');
    fireEvent.keyDown(pickers[0]!, { key: 'ArrowDown' });
    fireEvent.click(screen.getByText('Time to resolution'));
    expect(onChange).toHaveBeenCalledWith({
      countedStatusIds: ['3'],
      targetMs: 4 * 3_600_000,
      savedGoalId: 'g-1',
    });
  });

  it('saves the current selection under a typed name', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <SlaGoalForm
        statuses={STATUSES}
        goal={DEFAULT_SLA_GOAL}
        savedGoals={[]}
        onChange={vi.fn()}
        onSave={onSave}
      />,
    );
    // Nothing to save until it has a name: a goal the report cannot name is
    // one nobody can tell apart from the next.
    expect(screen.getByRole('button', { name: 'Save goal' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'First response' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save goal' }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('First response');
    });
  });

  it('offers deletion only for the goal currently in force', () => {
    const { rerender } = render(
      <SlaGoalForm
        statuses={STATUSES}
        goal={DEFAULT_SLA_GOAL}
        savedGoals={SAVED}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();

    rerender(
      <SlaGoalForm
        statuses={STATUSES}
        goal={{ countedStatusIds: ['3'], targetMs: 4 * 3_600_000, savedGoalId: 'g-1' }}
        savedGoals={SAVED}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Delete/ })).toBeDefined();
  });

  it('★ stops naming a saved goal once the selection has been edited away from it', () => {
    // Regression. The picker was uncontrolled, so after a chip toggle
    // detached the page from the goal — the caption correctly reading
    // "This selection is not saved" — the dropdown above it still displayed
    // that goal's name. Two controls on one screen disagreeing about which
    // goal the numbers are measured against.
    const { rerender } = render(
      <SlaGoalForm
        statuses={STATUSES}
        goal={{ countedStatusIds: ['3'], targetMs: 4 * 3_600_000, savedGoalId: 'g-1' }}
        savedGoals={SAVED}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText(/Measuring against the saved goal/)).toBeDefined();

    rerender(
      <SlaGoalForm
        statuses={STATUSES}
        goal={{ countedStatusIds: [], targetMs: 4 * 3_600_000 }}
        savedGoals={SAVED}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText(/This selection is not saved/)).toBeDefined();
    const pickers = screen.getAllByRole('combobox');
    expect(within(pickers[0]!.closest('div')!).queryByText('Time to resolution')).toBeNull();
  });

  it('shows the refusal when the save is rejected', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('maximum of 20 saved goals'));
    render(
      <SlaGoalForm
        statuses={STATUSES}
        goal={DEFAULT_SLA_GOAL}
        savedGoals={[]}
        onChange={vi.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'One too many' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save goal' }));
    expect(await screen.findByText(/maximum of 20 saved goals/)).toBeDefined();
  });
});

describe('toCapBanner', () => {
  it('is silent when the report covers everything', () => {
    expect(toCapBanner({ capped: false, included: 500, total: 500, noun: 'issues' })).toBeNull();
  });

  it('names the counts when the report is capped', () => {
    const banner = toCapBanner({ capped: true, included: 500, total: 1234, noun: 'issues' });
    expect(banner).not.toBeNull();
    expect(banner?.appearance).toBe('warning');
    expect(banner?.title).toBe('Report capped at 500 of 1,234 issues');
    expect(banner?.body).toContain('lower bound');
    expect(banner?.showRetry).toBe(false);
  });

  it('renders through IndexingBanner like the indexing states do', () => {
    render(
      <IndexingBanner
        banner={toCapBanner({ capped: true, included: 50, total: 80, noun: 'changes' })}
      />,
    );
    expect(screen.getByText('Report capped at 50 of 80 changes')).toBeDefined();
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

describe('AgingHistogram', () => {
  it('renders every bucket label with its count, tallest bar proportional to the rest', async () => {
    render(
      <AgingHistogram
        data={[
          { label: '0-1d', value: 3 },
          { label: '1-3d', value: 0 },
          { label: '3-7d', value: 9 },
          { label: '7-14d', value: 1 },
          { label: '14-30d', value: 0 },
          { label: '30d+', value: 2 },
        ]}
      />,
    );
    expect(screen.getByText('0-1d')).toBeDefined();
    expect(screen.getByText('3-7d')).toBeDefined();
    expect(screen.getByText('30d+')).toBeDefined();
    // A bucket can legitimately be empty (nothing has sat that long) — the
    // label and a "0" must still render, not disappear.
    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(screen.getByText('9')).toBeDefined();
    await expectNoA11yViolations();
  });
});

describe('ReportBarChart', () => {
  it('renders every category with its value', async () => {
    render(
      <ReportBarChart
        data={[
          { label: 'In Progress', value: 8 },
          { label: 'Review', value: 2.5 },
        ]}
        title="Median time in status"
        subtitle="Hours per status."
      />,
    );
    expect(screen.getByText('Median time in status')).toBeDefined();
    expect(screen.getByText('In Progress')).toBeDefined();
    expect(screen.getByText('8')).toBeDefined();
    expect(screen.getByText('2.5')).toBeDefined();
    await expectNoA11yViolations();
  });

  it('renders nothing at all for an empty series', () => {
    // Not an empty chart: every caller sits above a table showing the same
    // data, so a plot area with no bars is 400px saying less than the table
    // below it already says.
    const { container } = render(
      <ReportBarChart data={[]} title="Median time in status" subtitle="Hours per status." />,
    );
    expect(container.textContent).toBe('');
  });
});

describe('ReportLineChart', () => {
  it('groups the points into one labelled series per status', async () => {
    render(
      <ReportLineChart
        data={[
          { label: '1 Mar 2026', series: 'To Do', value: 4 },
          { label: '2 Mar 2026', series: 'To Do', value: 3 },
          { label: '1 Mar 2026', series: 'In Progress', value: 1 },
          { label: '2 Mar 2026', series: 'In Progress', value: 2 },
        ]}
        title="Cumulative flow"
        subtitle="Issues in each status at the end of each day."
      />,
    );
    expect(screen.getByText('Cumulative flow')).toBeDefined();
    expect(screen.getByText('To Do')).toBeDefined();
    expect(screen.getByText('In Progress')).toBeDefined();
    expect(screen.getByText('1 Mar 2026: 4')).toBeDefined();
    expect(screen.getByText('2 Mar 2026: 2')).toBeDefined();
    await expectNoA11yViolations();
  });

  it('renders nothing for an empty series', () => {
    const { container } = render(
      <ReportLineChart data={[]} title="Cumulative flow" subtitle="x" />,
    );
    expect(container.textContent).toBe('');
  });

  /**
   * ★ A series that is all zeroes is not data, it is the absence of data
   * wearing a chart's clothes. The cumulative flow diagram covers the last 30
   * days, so a project whose issues all predate that window plots five flat
   * lines along the axis under a confident title — which is what the rendered
   * screen showed. Saying nothing is the honest render; the table below
   * carries whatever is actually there.
   */
  it('★ renders nothing when every point in the series is zero', () => {
    const { container } = render(
      <ReportLineChart
        data={[
          { label: '1 Mar 2026', series: 'To Do', value: 0 },
          { label: '2 Mar 2026', series: 'To Do', value: 0 },
          { label: '1 Mar 2026', series: 'In Progress', value: 0 },
        ]}
        title="Cumulative flow"
        subtitle="Issues in each status at the end of each day."
      />,
    );
    expect(container.textContent).toBe('');
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

describe('useIndexingRefresh', () => {
  const progressOf = (state: BackfillProgress['state']): BackfillProgress => ({
    state,
    issuesProcessed: 10,
    issuesTotal: 900,
    fraction: 0.01,
    lastError: null,
    startedAt: 0,
    updatedAt: 0,
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('★ re-reads the report while indexing, so the banner is not frozen', () => {
    // The defect: nothing on any page ever refetched, so "Indexing in
    // progress — 0 issues indexed" was the last thing a first-time user saw
    // until they reloaded by hand.
    vi.useFakeTimers();
    const reload = vi.fn();
    renderHook(() => {
      useIndexingRefresh(progressOf('running'), reload);
    });

    expect(reload).not.toHaveBeenCalled(); // not on mount; the page just loaded
    vi.advanceTimersByTime(3_000);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(reload.mock.calls.length).toBeGreaterThan(1);
  });

  it('polls less often as it goes, because every poll is billed', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    renderHook(() => {
      useIndexingRefresh(progressOf('running'), reload);
    });

    vi.advanceTimersByTime(10_000);
    const early = reload.mock.calls.length;
    vi.advanceTimersByTime(10_000);
    const late = reload.mock.calls.length - early;
    expect(late).toBeLessThan(early);
  });

  it('gives up rather than polling an abandoned tab forever', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    renderHook(() => {
      useIndexingRefresh(progressOf('running'), reload);
    });

    vi.advanceTimersByTime(60 * 60_000);
    const total = reload.mock.calls.length;
    expect(total).toBeLessThanOrEqual(40);
    vi.advanceTimersByTime(60 * 60_000);
    expect(reload).toHaveBeenCalledTimes(total);
  });

  it('keeps watching while Jira has paused the backfill, because it resumes itself', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    renderHook(() => {
      useIndexingRefresh(progressOf('paused'), reload);
    });
    vi.advanceTimersByTime(20_000);
    expect(reload.mock.calls.length).toBeGreaterThan(0);
  });

  it('★ survives one failed progress read instead of giving up for good', () => {
    // The pages report 'unknown' when getIndexProgress refuses. Treating that
    // as "not indexing" meant a single transient failure silently restored
    // the frozen banner for the life of the page.
    vi.useFakeTimers();
    const reload = vi.fn();
    const { rerender } = renderHook(
      ({ p }: { p: Parameters<typeof useIndexingRefresh>[0] }) => {
        useIndexingRefresh(p, reload);
      },
      { initialProps: { p: progressOf('running') as Parameters<typeof useIndexingRefresh>[0] } },
    );
    vi.advanceTimersByTime(10_000);
    const before = reload.mock.calls.length;
    expect(before).toBeGreaterThan(0);

    rerender({ p: 'unknown' });
    vi.advanceTimersByTime(30_000);
    expect(reload.mock.calls.length).toBeGreaterThan(before);
  });

  it.each(['complete', 'failed'] as const)('does not poll when the index is %s', (state) => {
    vi.useFakeTimers();
    const reload = vi.fn();
    renderHook(() => {
      useIndexingRefresh(progressOf(state), reload);
    });
    vi.advanceTimersByTime(120_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not poll a project that has never been indexed, or an unknown one', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const { rerender } = renderHook(
      ({ p }: { p: Parameters<typeof useIndexingRefresh>[0] }) => {
        useIndexingRefresh(p, reload);
      },
      { initialProps: { p: null as Parameters<typeof useIndexingRefresh>[0] } },
    );
    vi.advanceTimersByTime(120_000);
    expect(reload).not.toHaveBeenCalled();
    rerender({ p: 'unknown' });
    vi.advanceTimersByTime(120_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('stops as soon as indexing finishes', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const { rerender } = renderHook(
      ({ p }: { p: Parameters<typeof useIndexingRefresh>[0] }) => {
        useIndexingRefresh(p, reload);
      },
      { initialProps: { p: progressOf('running') as Parameters<typeof useIndexingRefresh>[0] } },
    );
    vi.advanceTimersByTime(10_000);
    const whileRunning = reload.mock.calls.length;
    expect(whileRunning).toBeGreaterThan(0);

    rerender({ p: progressOf('complete') });
    vi.advanceTimersByTime(120_000);
    expect(reload).toHaveBeenCalledTimes(whileRunning);
  });

  it('a caller that rebuilds its callback every render does not restart the backoff', () => {
    // Every page closes its reload over the basis and the filters, so the
    // function identity changes on each render. Keyed on that identity, the
    // effect would tear down and re-arm on every poll — resetting the delay
    // to the shortest one and polling at that rate for as long as indexing
    // ran, which is the opposite of the cost control above.
    vi.useFakeTimers();
    const calls: number[] = [];
    const { rerender } = renderHook(() => {
      useIndexingRefresh(progressOf('running'), () => {
        calls.push(Date.now());
      });
    });
    vi.advanceTimersByTime(10_000);
    rerender();
    vi.advanceTimersByTime(10_000);
    const withRerenders = calls.length;

    cleanup();
    calls.length = 0;
    renderHook(() => {
      useIndexingRefresh(progressOf('running'), () => {
        calls.push(Date.now());
      });
    });
    vi.advanceTimersByTime(20_000);
    expect(withRerenders).toBe(calls.length);
  });
});

describe('ReportTable sorting', () => {
  /** The rendered issue keys, top to bottom. */
  function issueOrder(): string[] {
    return screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[0]?.textContent ?? '');
  }

  it('★ sorts a duration column by its value, not by how the value reads', () => {
    // The regression this exists for: every cell used to carry a constant
    // `key` ('issue', 'c-0'), and `DynamicTable` sorts a column by the key of
    // the cell beneath its header. Identical keys meant clicking a header
    // reordered nothing, silently. Sorting on the rendered text would be its
    // own bug: "1d 20h" collates before "1h" before "12h".
    render(<ReportTable model={toReportTable(REPORT)} />);
    const blocked = screen.getByRole('columnheader', { name: /Blocked/ });

    fireEvent.click(within(blocked).getByRole('button'));
    const ascending = issueOrder();
    fireEvent.click(within(blocked).getByRole('button'));
    const descending = issueOrder();

    // Something moved — the defect was that nothing did.
    expect(descending).not.toEqual(ascending);
    expect([...descending].reverse()).toEqual(ascending);
    // FLOW-3 holds the only Blocked figure (1d 20h); FLOW-4 was never in
    // Blocked and must sort below a real figure, not above it.
    expect(descending[0]).toBe('FLOW-3');
    // `startsWith`: this cell also carries the "partial history" badge.
    expect(descending[descending.length - 1]?.startsWith('FLOW-4')).toBe(true);
  });

  it('★ gives every cell in a row a distinct key, which the harness cannot check', () => {
    // On Forge the cell key is also React's key —
    // `jsx(Cell, { cellKey, ... }, cellKey)` in @forge/react's DynamicTable —
    // and duplicates among siblings are what React warns "may cause children
    // to be duplicated and/or omitted". The stand-in host keys cells by index
    // instead, so rendering proves nothing here: this asserts the model
    // directly. FLOW-4 is the shape that collides twice over — it was never in
    // Blocked, and its only duration equals its total.
    const model = toReportTable(REPORT);
    for (const row of model.rows) {
      const keys = [
        row.issueKey,
        row.currentStatus,
        row.createdAt,
        row.resolvedAt,
        ...row.cells.map((c) => c.ms),
        row.totalMs,
      ].map((value, column) => cellKey(value, column));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('sorts dates chronologically, which their rendered form does not', () => {
    render(<ReportTable model={toReportTable(REPORT)} />);
    const created = screen.getByRole('columnheader', { name: /Created/ });
    fireEvent.click(within(created).getByRole('button'));
    const ascending = issueOrder();
    expect(ascending.length).toBeGreaterThan(1);
    fireEvent.click(within(created).getByRole('button'));
    expect(issueOrder()).toEqual([...ascending].reverse());
  });
});

describe('ReportTable', () => {
  /**
   * ★ `basisLabel` existed on the model, was unit-tested, and reached no
   * screen. Meanwhile the time-in-status page built the same sentence by hand
   * into a bare line of text floating between the tiles and the chart — the
   * one orphan on an otherwise sectioned page. The caption is where it
   * belongs: attached to the numbers it qualifies, on every surface that
   * renders the table rather than on the one page that remembered to.
   */
  it('★ captions the table with what it is and what its numbers mean', async () => {
    render(<ReportTable heading="Issues" model={toReportTable(REPORT)} />);
    expect(screen.getByRole('heading', { name: 'Issues' })).toBeDefined();
    expect(screen.getByText('Measured in elapsed time')).toBeDefined();
    await expectNoA11yViolations();
  });

  it('names the basis even where the page gives the table no heading', () => {
    render(<ReportTable model={toReportTable({ ...REPORT, basis: 'business' })} />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByText('Measured in working hours')).toBeDefined();
  });

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

describe('ExtendHistoryControl', () => {
  it('reads nothing until it is opened', () => {
    // On a consumption-priced platform a control almost nobody opens must
    // not put a resolver call on every page load.
    const onLoad = vi.fn();
    render(<ExtendHistoryControl onLoad={onLoad} onExtend={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Extend history' })).toBeTruthy();
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("★ is announced under its own name, not the export modal's", async () => {
    // The stand-in host used to hardcode `aria-label="Export"` on every
    // modal, so this one — the only other modal in the product — was
    // announced to a screen reader as "Export", and axe's `aria-dialog-name`
    // rule could never fire because a name was always present. A stand-in
    // that supplies what the product does not is the same defect as one that
    // drops a prop the product does supply.
    const onLoad = vi.fn().mockResolvedValue({ months: 36 });
    render(<ExtendHistoryControl onLoad={onLoad} onExtend={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Extend history' }));
    expect(await screen.findByRole('dialog', { name: 'Extend indexed history' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Export' })).toBeNull();
  });

  it('names the range in force and offers only wider ones', async () => {
    const onLoad = vi.fn().mockResolvedValue({ months: 36 });
    render(<ExtendHistoryControl onLoad={onLoad} onExtend={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Extend history' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText(/last 3 years/)).toBeTruthy();
    fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'ArrowDown' });
    expect(within(dialog).getByText('Last 5 years')).toBeTruthy();
    expect(within(dialog).getByText('All history')).toBeTruthy();
    expect(within(dialog).queryByText('Last 12 months')).toBeNull();
  });

  it('says what re-indexing will do before it does it', async () => {
    // It spends the installation's Jira requests and Forge invocations, so
    // it must not be something a customer sets off by accident.
    render(
      <ExtendHistoryControl
        onLoad={vi.fn().mockResolvedValue({ months: 12 })}
        onExtend={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Extend history' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/read from Jira again/)).toBeTruthy();
    await expectNoA11yViolations();
  });

  it('submits the chosen range and closes', async () => {
    const onExtend = vi.fn().mockResolvedValue(undefined);
    render(
      <ExtendHistoryControl
        onLoad={vi.fn().mockResolvedValue({ months: 12 })}
        onExtend={onExtend}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Extend history' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.click(within(dialog).getByText('Last 2 years'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Re-index' }));

    await waitFor(() => {
      expect(onExtend).toHaveBeenCalledWith(24);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('keeps the dialog open and shows the refusal when the resolver says no', async () => {
    const onExtend = vi.fn().mockRejectedValue(new Error('already indexed over a longer history'));
    render(
      <ExtendHistoryControl
        onLoad={vi.fn().mockResolvedValue({ months: 12 })}
        onExtend={onExtend}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Extend history' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.click(within(dialog).getByText('All history'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Re-index' }));

    expect(await within(dialog).findByText(/already indexed over a longer history/)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('★ does not claim all history is indexed when the range could not be read', async () => {
    // Regression. A rejected `onLoad` left `current` as `undefined`, which
    // collapsed into the same branch as `null` — so a transient failure
    // rendered an error box directly above the confident, false sentence
    // "This project is indexed over all history", with the Re-index button
    // removed because the options list was empty.
    render(
      <ExtendHistoryControl
        onLoad={vi.fn().mockRejectedValue(new Error('resolver unavailable'))}
        onExtend={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Extend history' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/could not be read/)).toBeTruthy();
    expect(within(dialog).queryByText(/all history/i)).toBeNull();
    expect(within(dialog).queryByText(/nothing further to extend/)).toBeNull();
  });

  it('offers no action once all history is already indexed', async () => {
    render(
      <ExtendHistoryControl
        onLoad={vi.fn().mockResolvedValue({ months: null })}
        onExtend={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Extend history' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/nothing further to extend/)).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Re-index' })).toBeNull();
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

/**
 * The report filters, and the arithmetic under them.
 *
 * These had **no test of any kind** until 2026-09-25 — neither the component
 * nor `filtersToRequest` — which is how the one genuinely dangerous line in
 * the file came to be guarded by a comment and nothing else.
 *
 * That line is the `+ 86_400_000` on `createdTo`. A person who picks
 * "to 12 March" means the 12th included; a half-open `[from, to)` window
 * ending at 00:00 on the 12th silently drops a whole day off every report,
 * and the drop is invisible unless something was created that day. It is the
 * kind of defect that surfaces as "the month-end numbers look a bit low".
 */
describe('report filters', () => {
  const on = (partial: Record<string, unknown>) => ({ ...EMPTY_FILTERS, ...partial });
  const iso = (ms: unknown) => new Date(ms as number).toISOString();

  it('makes "created to" the end of the day it names, not the start', () => {
    const request = filtersToRequest(on({ createdTo: '2026-03-12' }));

    // The store excludes `createdAt >= createdTo`, so the bound is the first
    // instant of the *next* day and everything on the 12th is inside it.
    expect(iso(request['createdTo'])).toBe('2026-03-13T00:00:00.000Z');
  });

  it('makes "created from" the first instant of the day it names', () => {
    const request = filtersToRequest(on({ createdFrom: '2026-03-12' }));
    expect(iso(request['createdFrom'])).toBe('2026-03-12T00:00:00.000Z');
  });

  it('spans a single-day window rather than collapsing it to nothing', () => {
    // From and to on the same day is a real thing to ask for, and the naive
    // reading of it — from 00:00 to 00:00 — can match nothing at all.
    const request = filtersToRequest(on({ createdFrom: '2026-03-12', createdTo: '2026-03-12' }));
    expect((request['createdTo'] as number) - (request['createdFrom'] as number)).toBe(86_400_000);
  });

  it('sends the single-value pickers as the arrays the resolver parses', () => {
    const request = filtersToRequest(on({ assigneeAccountId: 'acc-anna', issueTypeId: '10004' }));
    expect(request['assigneeAccountIds']).toEqual(['acc-anna']);
    expect(request['issueTypeIds']).toEqual(['10004']);
  });

  it('omits every field it has no value for, rather than sending nulls', () => {
    // A null on the payload is not the same as an absent key: the handler
    // parses by type, and a null would be dropped there instead — silently,
    // and one layer further from the person who could see it.
    expect(filtersToRequest(EMPTY_FILTERS)).toEqual({});
  });

  it('drops a date it cannot parse instead of sending NaN', () => {
    const request = filtersToRequest(on({ createdFrom: 'not-a-date' }));
    expect('createdFrom' in request).toBe(false);
  });

  it('knows whether anything is filtered, one field at a time', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    for (const field of ['assigneeAccountId', 'issueTypeId', 'createdFrom', 'createdTo']) {
      expect(hasActiveFilters(on({ [field]: 'x' }))).toBe(true);
    }
  });

  it('offers Clear filters only once there is something to clear', () => {
    const { rerender } = render(
      <ReportFilters
        assignees={[{ id: 'acc-anna', name: 'Anna Weber' }]}
        issueTypes={[{ id: '10004', name: 'Bug' }]}
        filters={EMPTY_FILTERS}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();

    rerender(
      <ReportFilters
        assignees={[{ id: 'acc-anna', name: 'Anna Weber' }]}
        issueTypes={[{ id: '10004', name: 'Bug' }]}
        filters={on({ assigneeAccountId: 'acc-anna' })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
  });

  it('★ states the date format it will read, because a mistyped date does not fail', () => {
    // A date field that accepts typing and parses by locale is a trap: in the
    // viewer's locale "3/2/2026" is March in one country and February in
    // another, and the wrong one silently narrows the table to the wrong
    // rows, which reads exactly like a broken filter rather than like a typo.
    // So the format is stated in the field, and the field renders in it.
    render(
      <ReportFilters assignees={[]} issueTypes={[]} filters={EMPTY_FILTERS} onChange={vi.fn()} />,
    );
    expect(screen.getAllByText('YYYY-MM-DD')).toHaveLength(2);
  });

  it('renders a chosen date in the format it advertises', () => {
    render(
      <ReportFilters
        assignees={[]}
        issueTypes={[]}
        filters={on({ createdFrom: '2026-03-02' })}
        onChange={vi.fn()}
      />,
    );
    // Not "3/2/2026" — the ambiguous rendering is the whole defect.
    expect(screen.getByText('2026-03-02')).toBeTruthy();
  });

  it('labels both window pickers, so each is addressable by name', () => {
    render(
      <ReportFilters
        assignees={[]}
        issueTypes={[]}
        filters={on({ createdFrom: '2026-03-12', createdTo: '2026-03-20' })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Created from')).toBeTruthy();
    expect(screen.getByLabelText('Created to')).toBeTruthy();

    // ⚠️ Deliberately *not* asserted here: that the two bound each other via
    // `minDate`/`maxDate`. Those are props, invisible in the DOM, and a test
    // that renders the component and checks two labels exist would be passing
    // under the name of a claim it never touches — which is the failure this
    // suite's own mutation runs exist to catch. The guard that does cover it
    // is the stand-in's prop scanner: `forge-host.tsx` declares `minDate` and
    // `maxDate` precisely so a host that accepted and ignored them fails,
    // and `forge-host.contract.test.ts` pins the stand-in to the real module.
  });

  it('passes an axe audit', async () => {
    render(
      <ReportFilters
        assignees={[{ id: 'acc-anna', name: 'Anna Weber' }]}
        issueTypes={[{ id: '10004', name: 'Bug' }]}
        filters={on({ assigneeAccountId: 'acc-anna' })}
        onChange={vi.fn()}
      />,
    );
    await expectNoA11yViolations();
  });
});
