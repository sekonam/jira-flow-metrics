// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { describeScreen, loadScenarios, resolversFor, setBridgeResolvers } from '@jfm/ui-harness';

/**
 * The Worklog Reports project page and dashboard gadget, rendered.
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
    name: 'worklog-reports project page',
    Component: App,
    surface: 'page',
    resolverKeys: ['getWorklogReport', 'getIndexProgress', 'startIndexing'],
    invokedOnLoad: ['getWorklogReport', 'getIndexProgress'],
    heading: 'Worklog Reports',
    emptyText: 'No worklogs indexed yet',
    populatedText: 'Anna Weber',
  },
  scenarios,
);

describeScreen(
  {
    name: 'worklog-reports dashboard gadget',
    Component: Gadget,
    surface: 'gadget',
    resolverKeys: ['getWorklogReport', 'getIndexProgress'],
    invokedOnLoad: ['getWorklogReport', 'getIndexProgress'],
    heading: 'Worklog Reports',
    emptyText: /Nothing to show for this project yet/,
    populatedText: 'Total logged',
  },
  scenarios,
);

describe('worklog-reports: the listing-specific behaviour', () => {
  it('totals the three usable fixture worklogs and states the basis', async () => {
    setBridgeResolvers(resolversFor(scenarios.canonical.responses));
    render(<App />);
    // 10800 + 7200 + 5400 seconds = 6h 30m. The fourth fixture worklog has no
    // timeSpentSeconds and must not be counted as zero.
    expect(await screen.findByText('6h 30m')).toBeDefined();
    expect(
      screen.getByText(
        /Totals are the durations people entered in Jira, not durations derived from timestamps/,
      ),
    ).toBeDefined();
    cleanup();
  });
});
