// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
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

/** See the note in `apps/time-in-status/test/frontend.test.tsx`. */
afterEach(cleanup);

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
    // ★ Data-derived, not a static label.
    //
    // This used to be the tile's *caption*, which a gadget renders whether
    // or not the report behind it holds anything: emptying the report's rows
    // and re-running left every assertion in this contract green, including
    // the ★ partial-data one. A gadget is described three files over as
    // "often the only surface someone who did not install the app ever
    // sees", so a contract that cannot tell a populated one from an empty
    // one is the wrong contract.
    populatedText: 'Anna Weber',
  },
  scenarios,
);

describe('★ worklog-reports: a capped report says so on both surfaces', () => {
  /**
   * The cap banner, on the page and in the gadget.
   *
   * Pinned by nothing: deleting `capped` from both call sites — removing the
   * banner from this listing entirely — left the whole suite and all forty
   * browser flows green. It had a screenshot for a while, which is not a
   * test: `screens.mjs` compares against no baseline.
   */
  function withCap(total: number) {
    const base = scenarios.populated.responses.getWorklogReport as {
      ok: true;
      data: Record<string, unknown>;
    };
    return {
      ...scenarios.populated.responses,
      getWorklogReport: {
        ...base,
        data: { ...base.data, capped: true, totalEntries: total },
      },
    };
  }

  it('names both figures on the page', async () => {
    setBridgeResolvers(resolversFor(withCap(99)));
    render(<App />);
    expect(await screen.findByText(/Report capped at \d+ of 99 worklog entries/)).toBeDefined();
  });

  it('carries the same notice into the gadget', async () => {
    setBridgeResolvers(resolversFor(withCap(99)));
    render(<Gadget />);
    expect(await screen.findByText(/of 99 worklog entries/)).toBeDefined();
  });

  it('says nothing when the report is complete', async () => {
    // A spurious banner is as wrong as a missing one.
    setBridgeResolvers(resolversFor(scenarios.populated.responses));
    render(<App />);
    expect(await screen.findByText(/Report capped/).catch(() => null)).toBeNull();
  });
});

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

describe('worklog-reports: the report chart', () => {
  it('the chart above the table plots hours logged per person', async () => {
    setBridgeResolvers(resolversFor(scenarios.populated.responses));
    render(<App />);
    // The chart's own title, which only the ready state renders. It sits
    // above the table so a reader sees the shape before the rows.
    //
    // "Time logged per person", not "Time logged": the table's own column
    // header is already "Time logged", and two nodes with identical text on
    // one screen is ambiguous to a screen reader for exactly the reason it
    // was ambiguous to this assertion.
    expect(await screen.findByText('Time logged per person')).toBeDefined();
    cleanup();
  });
});
