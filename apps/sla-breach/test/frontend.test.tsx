// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { describeScreen, loadScenarios, resolversFor, setBridgeResolvers } from '@jfm/ui-harness';
import type { SlaReport } from '@jfm/forge-runtime';

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
    // ★ Data-derived, not a static label.
    //
    // This used to be the tile's *caption*, which a gadget renders whether
    // or not the report behind it holds anything: emptying the report's rows
    // and re-running left every assertion in this contract green, including
    // the ★ partial-data one. A gadget is described three files over as
    // "often the only surface someone who did not install the app ever
    // sees", so a contract that cannot tell a populated one from an empty
    // one is the wrong contract.
    // The leading digit class matters: with the rows emptied the same
    // sentence still renders, as "0 issues measured against …".
    populatedText: /[1-9]\d* issues measured against "Time to resolution"/,
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

describe('sla-breach: the saved-goal picker', () => {
  it('★ loads the goal list even when the status list fails', async () => {
    // Regression. The two fetches shared one `try`, so a failing
    // `listStatuses` swallowed the error and `listSlaGoals` never ran — one
    // transient blip taking two unrelated features off the screen.
    setBridgeResolvers({
      ...resolversFor(scenarios.populated.responses),
      listStatuses: () => {
        throw new Error('status list unavailable');
      },
      listSlaGoals: () => ({
        ok: true,
        data: [{ id: 'g-1', name: 'Time to resolution', countedStatusIds: [], targetMs: 14400000 }],
      }),
    });
    render(<App />);
    expect(await screen.findByText('Saved goal')).toBeDefined();
    cleanup();
  });
});

describe('sla-breach: an out-of-order answer must not win', () => {
  it('★ ignores a slow first report that lands after the goal has changed', async () => {
    // The race the pages had and the gadgets did not: every chip click
    // re-runs `load`, each invoke is a separate Forge lambda, and answers
    // arrive in whatever order they finish. The older reply landing last
    // left chips saying one goal above numbers computed from another, with
    // nothing loading to hint at it.
    const populated = scenarios.populated.responses;
    let firstResolve: ((value: unknown) => void) | null = null;
    let call = 0;

    setBridgeResolvers({
      ...resolversFor(populated),
      getSlaReport: () => {
        call += 1;
        if (call === 1) {
          // The first request hangs until we release it, below.
          return new Promise((resolve) => {
            firstResolve = resolve;
          });
        }
        return {
          ok: true,
          data: {
            ...(populated.getSlaReport as { data: SlaReport }).data,
            goalName: 'SECOND',
            breachedCount: 0,
            rows: [],
          },
        };
      },
    });

    render(<App />);
    // Change the goal, which fires the second request.
    fireEvent.click(await screen.findByRole('button', { name: 'Blocked' }));
    // The second answer arrives and renders.
    await screen.findByText('No issues measured yet');

    // Now let the *first* one land. It must be discarded.
    expect(firstResolve).not.toBeNull();
    firstResolve!({ ok: true, data: (populated.getSlaReport as { data: SlaReport }).data });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText('No issues measured yet')).toBeDefined();
    expect(screen.queryByText('FLOW-3')).toBeNull();
    cleanup();
  });
});
