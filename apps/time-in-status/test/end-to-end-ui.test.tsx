// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { handleGetReport, handleStartIndexing, type ListingRuntime } from '@jfm/forge-runtime';
import { EXPECTED, PIPELINE_CONTEXT, runPipeline } from '@jfm/forge-runtime/testing';
import { formatDurationForHumans, formatFor } from '@jfm/ui';
import { auditA11y, describeFindings, resetBridge, setBridgeResolvers } from '@jfm/ui-harness';

/**
 * The whole pipeline, ending on screen.
 *
 * `packages/forge-runtime/test/end-to-end.test.ts` proves that recorded Jira
 * payloads produce specific durations. It stops at the value the resolver
 * returns. This suite continues from exactly the same scenario — same fixture
 * module, same `EXPECTED` constants, so the two cannot drift — through the
 * real resolver handler, the real `@forge/bridge` `invoke`, the real React
 * frontend, and asserts the numbers in the **rendered DOM**.
 *
 * Everything in the chain is production code except two things:
 *
 * 1. the Jira REST client, which is a fixture-backed `JiraApi`;
 * 2. the bridge **transport**, which is a `globalThis.__bridge` stand-in — the
 *    real `@forge/bridge` module still runs on top of it;
 *
 * plus the host renderer, mocked below, because `@forge/react`'s UI Kit 2
 * exports are bridge sentinels and the code that renders them ships inside
 * Jira.
 *
 * ⚠️ **This is not proof the app works on Forge.** No `forge login`,
 * `forge deploy` or `forge tunnel` has ever run against this repository, no
 * manifest has been validated, and no Atlassian tenant has served a single
 * byte of it. `docs/RUNBOOK.md` § "First tunnel session" is still the
 * acceptance test.
 */

vi.mock('@forge/react', () => import('@jfm/ui-harness/forge-host'));

const { App } = await import('../src/frontend/index.js');

const HOUR = 3_600_000;

/** The resolver, wired to a runtime that has really ingested the fixtures. */
function wireResolvers(runtime: ListingRuntime): void {
  setBridgeResolvers({
    getReport: (payload) => handleGetReport(runtime, { context: PIPELINE_CONTEXT, payload }),
    startIndexing: (payload) =>
      handleStartIndexing(runtime, { context: PIPELINE_CONTEXT, payload }),
  });
}

beforeEach(() => {
  resetBridge();
});
afterEach(() => {
  cleanup();
});

function cellsOf(issueKey: string): string[] {
  const row = screen.getByText(issueKey).closest('tr');
  if (row === null) throw new Error(`no rendered row for ${issueKey}`);
  return within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent ?? '');
}

describe('end to end: recorded Jira payloads to pixels', () => {
  it('shows the cumulative elapsed durations the engine computed', async () => {
    const { runtime } = await runPipeline();
    wireResolvers(runtime);
    render(<App />);
    await screen.findByText(EXPECTED.issueKey);

    // The resolver's numbers, restated so a reader can check the two agree.
    expect(EXPECTED.elapsedByStatus['3']).toBe(12 * HOUR);
    expect(EXPECTED.elapsedTotal).toBe(76 * HOUR);

    const cells = cellsOf(EXPECTED.issueKey);
    // Columns: Issue · Status · Created · Resolved · Blocked · To Do ·
    // In Progress · In Review · Done · Total.
    expect(cells[6]).toBe('12hx2');
    expect(cells[9]).toBe(formatDurationForHumans(EXPECTED.elapsedTotal, formatFor('elapsed')));
    // 76 elapsed hours, written the way a person reads three days and four
    // hours. Spelled out so the assertion cannot pass on a formatter change.
    expect(cells[9]).toBe('3d 4h');
  });

  it('★ shows the 12 hours as one number across two separate visits', async () => {
    const { runtime } = await runPipeline();
    wireResolvers(runtime);
    render(<App />);
    await screen.findByText(EXPECTED.issueKey);

    const row = screen.getByText(EXPECTED.issueKey).closest('tr')!;
    // The badge says the status was entered twice; the duration beside it is
    // the sum of both visits (4h on Monday, 8h from Wednesday). That sum is
    // the one thing Jira's own control chart cannot report, and it is the
    // reason this product exists.
    expect(within(row).getByText(`x${EXPECTED.inProgressEntries}`)).toBeDefined();
    expect(within(row).getAllByText('12h').length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        /cumulative across every visit; Jira's own control chart shows only the most recent one/,
      ),
    ).toBeDefined();
  });

  it('shows 27 working hours after the user switches basis, from a fresh resolver call', async () => {
    const { runtime } = await runPipeline();
    wireResolvers(runtime);
    render(<App />);
    await screen.findByText(EXPECTED.issueKey);
    expect(screen.getByText('Showing elapsed time.')).toBeDefined();

    screen.getByRole('button', { name: 'Working hours' }).click();

    await waitFor(() => {
      expect(screen.getByText('Showing working hours.')).toBeDefined();
    });

    expect(EXPECTED.businessTotal).toBe(27 * HOUR);
    const cells = cellsOf(EXPECTED.issueKey);
    expect(cells[6]).toBe('12hx2'); // both visits fall inside 09:00-17:00
    expect(cells[9]).toBe('27h');
    expect(cells[9]).toBe(formatDurationForHumans(EXPECTED.businessTotal, formatFor('business')));
  });

  it('shows the status columns in workflow order, not alphabetically', async () => {
    const { runtime } = await runPipeline();
    wireResolvers(runtime);
    render(<App />);
    await screen.findByText(EXPECTED.issueKey);

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual([
      'Issue',
      'Status',
      'Created',
      'Resolved',
      ...EXPECTED.columnOrder,
      'Total',
    ]);
    // "Blocked" before "To Do" is workflow order, not alphabetical order.
    expect(EXPECTED.columnOrder[0]).toBe('Blocked');
  });

  it('drops the indexing banner once the real backfill has completed', async () => {
    const { runtime } = await runPipeline();
    wireResolvers(runtime);
    render(<App />);
    await screen.findByText(EXPECTED.issueKey);
    expect(screen.queryByText('Indexing in progress')).toBeNull();
    expect(screen.queryByText('Not indexed yet')).toBeNull();
  });

  it('★ warns that the numbers are partial when the backfill really is unfinished', async () => {
    const { runtime } = await runPipeline({ pageSize: 1, issuesPerSlice: 1, maxSlices: 0 });
    wireResolvers(runtime);
    render(<App />);
    expect(await screen.findByText('Indexing in progress')).toBeDefined();
    expect(screen.getByText(/Numbers below cover only the issues indexed so far/)).toBeDefined();
  });

  it('renders the whole populated page free of WCAG 2.1 AA violations', async () => {
    const { runtime } = await runPipeline();
    wireResolvers(runtime);
    render(<App />);
    await screen.findByText(EXPECTED.issueKey);
    expect(describeFindings(await auditA11y(document.body))).toBe('no violations');
  });
});
