// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { describeScreen, loadScenarios, resolversFor, setBridgeResolvers } from '@jfm/ui-harness';

/**
 * The Issue History project page and dashboard gadget, rendered.
 *
 * ⚠️ Rendered against the harness's stand-in for the Forge host renderer, not
 * on Forge. Nothing here shows the app works on the platform; see
 * `docs/RUNBOOK.md`.
 */

vi.mock('@forge/react', () => import('@jfm/ui-harness/forge-host'));

const scenarios = await loadScenarios();
const { App } = await import('../src/frontend/index.js');
const { Gadget } = await import('../src/frontend/gadget.js');

describeScreen(
  {
    name: 'issue-history project page',
    Component: App,
    surface: 'page',
    resolverKeys: ['getHistoryReport', 'getIndexProgress', 'startIndexing'],
    invokedOnLoad: ['getHistoryReport', 'getIndexProgress'],
    heading: 'Issue History',
    emptyText: 'No changes indexed yet',
    populatedText: 'FLOW-3',
  },
  scenarios,
);

describeScreen(
  {
    name: 'issue-history dashboard gadget',
    Component: Gadget,
    surface: 'gadget',
    resolverKeys: ['getHistoryReport', 'getIndexProgress'],
    invokedOnLoad: ['getHistoryReport', 'getIndexProgress'],
    heading: 'Issue History',
    emptyText: /Nothing to show for this project yet/,
    populatedText: 'Changes',
  },
  scenarios,
);

describe('issue-history: the listing-specific behaviour', () => {
  it('lists cross-issue field changes with the author, and says why that is the point', async () => {
    setBridgeResolvers(resolversFor(scenarios.canonical.responses));
    render(<App />);
    await screen.findAllByText('FLOW-3');
    expect(screen.getAllByText('Anna Weber').length).toBeGreaterThan(0);
    expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        /Jira's own History tab is per-issue and cannot be exported; this view is cross-issue and exportable/,
      ),
    ).toBeDefined();
    cleanup();
  });
});
