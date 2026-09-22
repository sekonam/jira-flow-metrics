// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { describeScreen, loadScenarios, resolversFor, setBridgeResolvers } from '@jfm/ui-harness';

/**
 * The SLA & Due Dates project page and dashboard gadget, rendered.
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
    name: 'sla-breach project page',
    Component: App,
    surface: 'page',
    resolverKeys: [
      'getSlaReport',
      'getIndexProgress',
      'startIndexing',
      'listStatuses',
      'listSlaGoals',
    ],
    invokedOnLoad: ['getSlaReport', 'getIndexProgress', 'listStatuses', 'listSlaGoals'],
    heading: 'SLA & Due Dates',
    emptyText: 'No issues measured yet',
    populatedText: 'FLOW-3',
  },
  scenarios,
);

describeScreen(
  {
    name: 'sla-breach dashboard gadget',
    Component: Gadget,
    surface: 'gadget',
    resolverKeys: ['getSlaReport', 'getIndexProgress'],
    invokedOnLoad: ['getSlaReport', 'getIndexProgress'],
    heading: 'SLA & Due Dates',
    emptyText: /Nothing to show for this project yet/,
    populatedText: 'Attainment',
  },
  scenarios,
);

describe('sla-breach: the listing-specific behaviour', () => {
  it('★ reports working time in hours and marks the breach', async () => {
    setBridgeResolvers(resolversFor(scenarios.canonical.responses));
    render(<App />);
    const key = await screen.findByText('FLOW-3');
    const row = key.closest('tr');
    expect(row).not.toBeNull();
    const cells = within(row!)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    // 12h In Progress + 2h 30m In Review of working time against an 8h target.
    // Never "0d 14h": a working day is not 24 hours, so working time is not
    // rolled up into days.
    expect(cells[1]).toBe('14h 30m');
    expect(cells[2]).toBe('8h');
    expect(cells[3]).toBe('over by 6h 30m');
    expect(cells[4]).toBe('Breached');
    expect(
      screen.getByText(/This is a counted-statuses goal, not a start\/stop\/pause timer/),
    ).toBeDefined();
    cleanup();
  });
});

describe('sla-breach: the report chart', () => {
  it('the chart above the table bands issues by how much of the target they have used', async () => {
    setBridgeResolvers(resolversFor(scenarios.populated.responses));
    render(<App />);
    // The chart's own title, which only the ready state renders. It sits
    // above the table so a reader sees the shape before the rows.
    expect(await screen.findByText('How close to the target')).toBeDefined();
    cleanup();
  });
});
