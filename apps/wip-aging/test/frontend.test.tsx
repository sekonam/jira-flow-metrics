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
    resolverKeys: ['getAgingReport', 'getIndexProgress', 'startIndexing', 'getFlowReport'],
    invokedOnLoad: ['getAgingReport', 'getIndexProgress', 'getFlowReport'],
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
    resolverKeys: ['getAgingReport', 'getIndexProgress'],
    invokedOnLoad: ['getAgingReport', 'getIndexProgress'],
    heading: 'WIP Aging',
    emptyText: /Nothing to show for this project yet/,
    populatedText: 'In flight',
  },
  scenarios,
);

describe('wip-aging: the listing-specific behaviour', () => {
  /**
   * ★ The gadget's second call is isolated on purpose.
   *
   * The report has already loaded by the time the index state is fetched.
   * Losing that second call is not a reason to replace a working gadget with
   * "could not load this gadget" — the banner simply goes quiet.
   */
  it('keeps a loaded gadget when only the index-state call fails', async () => {
    setBridgeResolvers({
      getAgingReport: () => scenarios.populated.responses.getAgingReport,
      getIndexProgress: () => {
        throw new Error('index state unavailable');
      },
    });
    render(<Gadget />);
    expect(await screen.findByText('In flight')).toBeDefined();
    expect(screen.queryByText('Could not load this gadget.')).toBeNull();
    expect(screen.queryByText('Indexing is still in progress.')).toBeNull();
    cleanup();
  });

  it('renders the age-bucket histogram alongside the table', async () => {
    setBridgeResolvers(resolversFor(scenarios.populated.responses));
    render(<App />);
    await screen.findByText('FLOW-1');
    expect(screen.getByText('Age distribution')).toBeDefined();
    // Every bucket label renders even at zero — the histogram must not
    // silently drop the buckets nothing has aged into.
    for (const bucket of ['0-1d', '1-3d', '3-7d', '7-14d', '14-30d', '30d+']) {
      expect(screen.getByText(bucket)).toBeDefined();
    }
    cleanup();
  });

  it('excludes finished issues and says how many it excluded', async () => {
    setBridgeResolvers(resolversFor(scenarios.populated.responses));
    render(<App />);
    await screen.findByText('FLOW-1');
    // The canonical issue is resolved, so it is not ageing.
    expect(screen.queryByText('FLOW-3')).toBeNull();
    expect(
      screen.getByText(/1 finished issue is excluded; ageing only applies to work in flight/),
    ).toBeDefined();
    cleanup();
  });
});

describe('wip-aging: the cumulative flow diagram', () => {
  it('draws one line per status the project used in the window', async () => {
    setBridgeResolvers(resolversFor(scenarios.populated.responses));
    render(<App />);
    expect(await screen.findByText('Cumulative flow')).toBeDefined();
    // The caption has to name the zone: the buckets are UTC days and the
    // reader's Jira may not be.
    expect(screen.getByText(/last 30 days \(UTC\)/)).toBeDefined();
    cleanup();
  });

  it('★ withholds the chart entirely when no visits are stored', async () => {
    // The "empty" scenario indexes a project with no issues, so nothing has
    // visits. A flat chart of zeroes would assert "nothing was in flight for
    // 30 days", which is a different claim from "there is nothing to read".
    setBridgeResolvers(resolversFor(scenarios.empty.responses));
    render(<App />);
    await screen.findByText('Nothing in flight');
    expect(screen.queryByText('Cumulative flow')).toBeNull();
    cleanup();
  });
});
