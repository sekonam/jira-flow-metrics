// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
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

/**
 * ★ `afterEach`, not a trailing `cleanup()` in each body.
 *
 * An inline `cleanup()` as the last statement never runs when an assertion
 * above it throws, so one real failure leaks its DOM into the next test and
 * takes unrelated tests down with it. Mutating the cap-banner wiring
 * produced four failures, two of them collateral — including a chart test
 * that had nothing to do with the change. A test suite's job in that moment
 * is to say *which* thing broke.
 */
afterEach(cleanup);

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
    // ★ Data-derived, not a static label.
    //
    // This used to be the tile's *caption*, which a gadget renders whether
    // or not the report behind it holds anything: emptying the report's rows
    // and re-running left every assertion in this contract green, including
    // the ★ partial-data one. A gadget is described three files over as
    // "often the only surface someone who did not install the app ever
    // sees", so a contract that cannot tell a populated one from an empty
    // one is the wrong contract.
    populatedText: /FLOW-1 in In Progress/,
  },
  scenarios,
);

describe('★ wip-aging: a failed index read must not contradict the report', () => {
  it('shows no indexing banner when the progress call refuses', async () => {
    // The report loaded; only the index-state call failed. The page used to
    // render "Not indexed yet — start indexing to build the report for this
    // project" directly above that project's issues, because `null` meant
    // both "never indexed" and "we could not find out".
    setBridgeResolvers({
      ...resolversFor(scenarios.populated.responses),
      getIndexProgress: () => ({ ok: false, error: 'Could not read the index state.' }),
    });
    render(<App />);
    // The report renders...
    expect(await screen.findByText('FLOW-1')).toBeDefined();
    // ...and the page makes no claim about indexing either way.
    expect(screen.queryByText('Not indexed yet')).toBeNull();
    expect(screen.queryByText(/Start indexing/)).toBeNull();
  });

  it('still invites indexing when the project genuinely has none', async () => {
    setBridgeResolvers(resolversFor(scenarios['not-indexed'].responses));
    render(<App />);
    expect(await screen.findByText('Not indexed yet')).toBeDefined();
  });
});

describe('★ wip-aging: a capped report says so on both surfaces', () => {
  /**
   * The cap banner, on the page and in the gadget.
   *
   * Neither was held by anything: deleting `capped` from both call sites —
   * removing the banner from the product entirely — left the whole suite and
   * all forty browser flows green. `getAgingReport` takes no page size, so no
   * scenario can produce a capped report for this listing and the state was
   * unreachable from every fixture. The response is therefore adjusted from
   * the real one, in the two shapes real data produces.
   */
  function withCap(over: { aggregatesCapped: boolean; total?: number }) {
    const base = scenarios.populated.responses.getAgingReport as {
      ok: true;
      data: Record<string, unknown>;
    };
    // ★ `capped` is always true here, because on these two reports it is
    // defined as `projectIssueCount > metas.length || aggregatesCapped` —
    // the aggregate ceiling is folded in. So `capped: false` alongside
    // `aggregatesCapped: true` is a shape the product cannot produce, and a
    // test asserting on it would pin an invention.
    const included =
      (base.data['rows'] as unknown[]).length + (base.data['excludedDone'] as number);
    return {
      ...scenarios.populated.responses,
      getAgingReport: {
        ...base,
        data: {
          ...base.data,
          capped: true,
          aggregatesCapped: over.aggregatesCapped,
          projectIssueCount: over.total ?? included,
        },
      },
    };
  }

  it('names both figures when the issue page was cut', async () => {
    setBridgeResolvers(resolversFor(withCap({ aggregatesCapped: false, total: 40 })));
    render(<App />);
    expect(await screen.findByText(/Report capped at \d+ of 40 issues/)).toBeDefined();
  });

  it('★ says something different when only the measurements were cut', async () => {
    // Asserting the first case alone is not enough: `capped` on its own
    // still renders a banner, so gutting `aggregatesCapped` goes unnoticed.
    setBridgeResolvers(resolversFor(withCap({ aggregatesCapped: true })));
    render(<App />);
    expect(await screen.findByText(/are missing measurements/)).toBeDefined();
    expect(screen.queryByText(/Report capped at/)).toBeNull();
  });

  it('carries the same notice into the gadget', async () => {
    setBridgeResolvers(resolversFor(withCap({ aggregatesCapped: false, total: 40 })));
    render(<Gadget />);
    // `Covering`, not a bare /of 40 issues/: the tiles now carry the same
    // denominator in their hints, so the looser pattern matched three
    // elements and said nothing about the notice it was written for.
    expect(await screen.findByText(/Covering \d+ of 40 issues/)).toBeDefined();
  });

  it('★ and distinguishes the two ceilings there too', async () => {
    // The page covered both branches and the gadget only one, so setting
    // `aggregatesCapped: false` at the gadget's call site was green — and
    // that mutation makes `toCapNotice` print "Covering 4 of 4 issues, so
    // every figure here is a lower bound", the self-contradiction its own
    // docstring says it exists to prevent.
    setBridgeResolvers(resolversFor(withCap({ aggregatesCapped: true })));
    render(<Gadget />);
    expect(await screen.findByText(/are missing measurements/)).toBeDefined();
  });

  /**
   * ★ DOM order, because nothing in this suite asserted any.
   *
   * Observed on the deployed app against JFMB: the flow chart's cap banner
   * rendered one index too early in the `Stack`, so it sat between the two
   * charts and read as the banner of the "Age distribution" chart above it.
   * Every presence assertion in this file was green throughout — "it is on
   * screen" cannot distinguish a banner from a banner attached to the wrong
   * neighbour. Position is the only assertion shape that can.
   */
  function withBothCaps() {
    const flow = scenarios.populated.responses.getFlowReport as {
      ok: true;
      data: Record<string, unknown>;
    };
    return {
      ...withCap({ aggregatesCapped: false, total: 40 }),
      getFlowReport: { ...flow, data: { ...flow.data, capped: true } },
    };
  }

  const isFollowedBy = (first: Element, second: Element): boolean =>
    Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

  it('★ keeps the flow cap banner below the title of the chart it describes', async () => {
    setBridgeResolvers(resolversFor(withBothCaps()));
    render(<App />);
    const flowTitle = await screen.findByText('Cumulative flow');
    const ageTitle = screen.getByText('Age distribution');
    const flowBanner = screen.getByText(/cumulative flow chart/);
    // The aging chart comes first — the page's order is tiles, aging, flow.
    expect(isFollowedBy(ageTitle, flowTitle)).toBe(true);
    // ...and the flow banner belongs to the flow chart, so it follows its
    // title rather than separating it from the chart above.
    expect(isFollowedBy(flowTitle, flowBanner)).toBe(true);
    // Both caps are live, so both banners are on screen and each names its
    // own block: five unreconcilable figures was one banner claiming both.
    expect(screen.getByText(/Report capped at \d+ of 40 issues/)).toBeDefined();
  });

  it('★ states the denominator on the tiles and the footnote when the page was cut', async () => {
    // "In flight 121 / Unfinished issues in this project." against a banner
    // saying 500 of 900 issues were read: 121 is counted over the 500, and
    // 121 + 379 excluded = 500, which the page said nowhere. A tile claiming
    // the project while counting a page is the silent-ceiling failure with
    // the banner still on screen.
    setBridgeResolvers(resolversFor(withCap({ aggregatesCapped: false, total: 40 })));
    render(<App />);
    await screen.findByText('FLOW-1');
    expect(screen.queryByText('Unfinished issues in this project.')).toBeNull();
    expect(screen.getByText(/Unfinished among the \d+ of 40 issues read/)).toBeDefined();
    expect(screen.getByText(/not moved in a fortnight.*of 40 issues read/)).toBeDefined();
    // The two halves add up to the page in words.
    expect(
      screen.getByText(/\d+ of the \d+ issues read (is|are) finished and excluded/),
    ).toBeDefined();
  });

  it('says nothing at all when the report is complete', async () => {
    setBridgeResolvers(resolversFor(scenarios.populated.responses));
    render(<App />);
    expect(await screen.findByText(/Report capped/).catch(() => null)).toBeNull();
  });
});

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
  });

  it('★ withholds the chart entirely when no visits are stored', async () => {
    // The "empty" scenario indexes a project with no issues, so nothing has
    // visits. A flat chart of zeroes would assert "nothing was in flight for
    // 30 days", which is a different claim from "there is nothing to read".
    setBridgeResolvers(resolversFor(scenarios.empty.responses));
    render(<App />);
    await screen.findByText('Nothing in flight');
    expect(screen.queryByText('Cumulative flow')).toBeNull();
  });
});
