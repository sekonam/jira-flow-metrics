// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
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

/** See the note in `apps/time-in-status/test/frontend.test.tsx`. */
afterEach(cleanup);

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
    // ★ Data-derived, not a static label.
    //
    // This used to be the tile's *caption*, which a gadget renders whether
    // or not the report behind it holds anything: emptying the report's rows
    // and re-running left every assertion in this contract green, including
    // the ★ partial-data one. A gadget is described three files over as
    // "often the only surface someone who did not install the app ever
    // sees", so a contract that cannot tell a populated one from an empty
    // one is the wrong contract.
    populatedText: /changes across \d+ issues/,
  },
  scenarios,
);

describe('★ issue-history: a capped report says so on both surfaces', () => {
  /**
   * The cap banner, on the page and in the gadget.
   *
   * Pinned by nothing: deleting `capped` from both call sites — removing the
   * banner from this listing entirely — left the whole suite and all forty
   * browser flows green. It had a screenshot for a while, which is not a
   * test: `screens.mjs` compares against no baseline.
   */
  function withCap(total: number) {
    const base = scenarios.populated.responses.getHistoryReport as {
      ok: true;
      data: Record<string, unknown>;
    };
    return {
      ...scenarios.populated.responses,
      getHistoryReport: {
        ...base,
        data: { ...base.data, capped: true, totalMatching: total },
      },
    };
  }

  it('names both figures on the page', async () => {
    setBridgeResolvers(resolversFor(withCap(99)));
    render(<App />);
    expect(await screen.findByText(/Report capped at \d+ of 99 changes/)).toBeDefined();
  });

  it('carries the same notice into the gadget', async () => {
    setBridgeResolvers(resolversFor(withCap(99)));
    render(<Gadget />);
    expect(await screen.findByText(/of 99 changes/)).toBeDefined();
  });

  it('says nothing when the report is complete', async () => {
    // A spurious banner is as wrong as a missing one.
    setBridgeResolvers(resolversFor(scenarios.populated.responses));
    render(<App />);
    expect(await screen.findByText(/Report capped/).catch(() => null)).toBeNull();
  });
});

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

describe('issue-history: the report chart', () => {
  it('the chart above the table plots changes per field', async () => {
    setBridgeResolvers(resolversFor(scenarios.populated.responses));
    render(<App />);
    // The chart's own title, which only the ready state renders. It sits
    // above the table so a reader sees the shape before the rows.
    expect(await screen.findByText('Changes by field')).toBeDefined();
    cleanup();
  });
});
