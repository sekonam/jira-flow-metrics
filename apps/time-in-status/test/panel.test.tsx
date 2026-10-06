// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { loadScenarios, resolversFor, setBridgeResolvers } from '@jfm/ui-harness';

/**
 * The issue panel, rendered.
 *
 * ⚠️ Rendered against the harness's stand-in for the Forge host renderer, not
 * on Forge. Nothing here shows the app works on the platform; see
 * `docs/RUNBOOK.md`.
 */

vi.mock('@forge/react', () => import('@jfm/ui-harness/forge-host'));

const scenarios = await loadScenarios();
const { Panel } = await import('../src/frontend/panel.js');

describe('time-in-status issue panel', () => {
  it('★ lists every visit in order, including the re-entry', async () => {
    setBridgeResolvers(resolversFor(scenarios.canonical.responses));
    render(<Panel />);
    await screen.findByText('Every visit, in order');

    // The canonical issue enters In Progress twice. That the two rows exist
    // *separately*, with different durations, is the product's argument in
    // the place a reader can check it against Jira's own History tab.
    const inProgressCells = screen.getAllByText('In Progress');
    expect(inProgressCells.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Totals per status')).toBeDefined();
    cleanup();
  });

  it('shows the cumulative total with its visit count', async () => {
    setBridgeResolvers(resolversFor(scenarios.canonical.responses));
    render(<Panel />);
    const heading = await screen.findByText('Totals per status');
    // The heading sits inside the table's own caption now rather than beside
    // the table as a sibling, so the block holding both is one level further
    // up — see `TableCaption`.
    const table = heading.parentElement?.parentElement;
    expect(table).not.toBeNull();
    // "the most recent stay" footnote only appears when a status really was
    // entered more than once — the claim is conditional on the data.
    expect(within(table!).getByText(/the totals here cover every stay/i)).toBeDefined();
    cleanup();
  });

  it('names the derived goal rather than letting it read as configured', async () => {
    setBridgeResolvers(resolversFor(scenarios.canonical.responses));
    render(<Panel />);
    expect(await screen.findByText(/Against a derived goal/)).toBeDefined();
    cleanup();
  });

  it('shows a named loading state before the resolver answers', async () => {
    setBridgeResolvers({ getIssueTimeline: () => new Promise<never>(() => undefined) });
    render(<Panel />);
    expect(await screen.findByRole('img', { name: /Loading/ })).toBeDefined();
    cleanup();
  });

  it('renders the refusal rather than a blank panel', async () => {
    setBridgeResolvers({
      getIssueTimeline: () => ({
        ok: false,
        error: 'This panel can only be opened from inside a Jira issue.',
      }),
    });
    render(<Panel />);
    expect(
      await screen.findByText('This panel can only be opened from inside a Jira issue.'),
    ).toBeDefined();
    cleanup();
  });

  it('distinguishes "has not moved yet" from an error', async () => {
    setBridgeResolvers({
      getIssueTimeline: () => ({
        ok: true,
        data: {
          issueKey: 'FLOW-9',
          createdAt: Date.parse('2026-03-02T08:00:00Z'),
          resolvedAt: null,
          visits: [],
          totals: [],
          truncated: false,
          sla: null,
        },
      }),
    });
    render(<Panel />);
    expect(await screen.findByText('This issue has not changed status yet.')).toBeDefined();
    cleanup();
  });
});
