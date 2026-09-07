// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { describeScreen, loadScenarios, resolversFor, setBridgeResolvers } from '@jfm/ui-harness';

/**
 * The WIP Aging project page and dashboard gadget, rendered.
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
    name: 'wip-aging project page',
    Component: App,
    surface: 'page',
    resolverKeys: ['getAgingReport', 'getReport', 'startIndexing'],
    invokedOnLoad: ['getAgingReport', 'getReport'],
    heading: 'WIP Aging',
    emptyText: 'Nothing in flight',
    populatedText: 'FLOW-1',
  },
  scenarios,
);

describeScreen(
  {
    name: 'wip-aging dashboard gadget',
    Component: Gadget,
    surface: 'gadget',
    resolverKeys: ['getAgingReport', 'getReport'],
    invokedOnLoad: ['getAgingReport', 'getReport'],
    heading: 'WIP Aging',
    emptyText: /Nothing to show for this project yet/,
    populatedText: 'In flight',
  },
  scenarios,
);

describe('wip-aging: the listing-specific behaviour', () => {
  it('excludes finished issues and says how many it excluded', async () => {
    setBridgeResolvers(resolversFor(scenarios.populated.responses));
    render(<App />);
    await screen.findByText('FLOW-1');
    // The canonical issue is resolved, so it is not ageing.
    expect(screen.queryByText('FLOW-3')).toBeNull();
    expect(
      screen.getByText(/1 finished issues are excluded; ageing only applies to work in flight/),
    ).toBeDefined();
    cleanup();
  });
});
