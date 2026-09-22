// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { describeScreen, loadScenarios, resolversFor, setBridgeResolvers } from '@jfm/ui-harness';

/**
 * The Time in Status project page and dashboard gadget, rendered.
 *
 * ⚠️ Rendered against the harness's stand-in for the Forge host renderer, not
 * on Forge. `@forge/react`'s UI Kit 2 exports are bridge sentinels rather than
 * React components, and the code that turns them into markup ships inside
 * Jira. Nothing here shows that the app works on the platform; `forge tunnel`
 * against a real tenant is still the acceptance test (`docs/RUNBOOK.md`).
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
    name: 'time-in-status project page',
    Component: App,
    surface: 'page',
    resolverKeys: ['getReport', 'startIndexing'],
    invokedOnLoad: ['getReport'],
    heading: 'Time in Status',
    emptyText: 'No indexed issues yet',
    populatedText: 'FLOW-3',
  },
  scenarios,
);

describeScreen(
  {
    name: 'time-in-status dashboard gadget',
    Component: Gadget,
    surface: 'gadget',
    resolverKeys: ['getReport'],
    invokedOnLoad: ['getReport'],
    heading: 'Time in Status',
    emptyText: /No indexed issues in this project yet/,
    populatedText: /In Progress · median/,
  },
  scenarios,
);

describe('time-in-status: the listing-specific behaviour', () => {
  it('asks the resolver for the basis the user selected, in both directions', async () => {
    const asked: (string | undefined)[] = [];
    setBridgeResolvers({
      getReport: (payload) => {
        asked.push((payload as { basis?: string }).basis);
        return scenarios.canonical.responses.getReport;
      },
      startIndexing: () => ({ ok: true, data: { started: true } }),
    });
    render(<App />);
    await screen.findByText('FLOW-3');
    expect(asked).toEqual(['elapsed']);

    screen.getByRole('button', { name: 'Working hours' }).click();
    await waitFor(() => {
      expect(asked).toEqual(['elapsed', 'business']);
    });

    screen.getByRole('button', { name: 'Elapsed' }).click();
    await waitFor(() => {
      expect(asked).toEqual(['elapsed', 'business', 'elapsed']);
    });
  });

  it('★ shows the re-entry badge, which is the whole product argument', async () => {
    setBridgeResolvers(resolversFor(scenarios.canonical.responses));
    render(<App />);
    const key = await screen.findByText('FLOW-3');
    const row = key.closest('tr');
    expect(row).not.toBeNull();
    // "x2" on the In Progress cell: the issue entered that status twice.
    expect(within(row!).getByText('x2')).toBeDefined();
    expect(
      screen.getByText(
        /cumulative across every visit; Jira's own control chart shows only the most recent one/,
      ),
    ).toBeDefined();
  });
});

describe('★ time-in-status: a capped report says so on both surfaces', () => {
  // The page and the gadget each read `capped` and `aggregatesCapped` and
  // pass them to the banner, and *nothing held that wiring*: replacing both
  // with `aggregatesCapped: false` — deleting exactly what the commit that
  // added the flag claimed to deliver — left all 1,060 tests and all 40
  // browser flows green, because no scenario produced a capped report.
  //
  // That is this cycle's own lens one layer up: the flag was verified where
  // it is computed and nowhere where it is rendered.

  it('renders the cap banner on the project page', async () => {
    setBridgeResolvers(resolversFor(scenarios.capped.responses));
    render(<App />);
    expect(await screen.findByText(/Report capped at 2 of 4 issues/)).toBeDefined();
  });

  it('renders the cap notice in the gadget', async () => {
    setBridgeResolvers(resolversFor(scenarios.capped.responses));
    render(<Gadget />);
    expect(await screen.findByText(/Covering 2 of 4 issues/)).toBeDefined();
  });

  /**
   * The aggregate ceiling, which no fixture can reach.
   *
   * `aggregatesCapped` needs more than 9,999 aggregate rows to fire, so the
   * scenario pipeline cannot produce it without a fixture of thousands of
   * issues. The shape is taken from the real capped response and adjusted to
   * the one combination real data would give: every matching issue on the
   * page (`capped` false), some of them missing measurements.
   *
   * Asserting the first two tests alone was not enough — gutting the wiring
   * to `aggregatesCapped: false` left them green, because `capped` on its
   * own still renders a banner. The two flags have to be distinguished.
   */
  function aggregateCappedResponses(): Record<string, unknown> {
    const base = scenarios.capped.responses.getReport as {
      ok: true;
      data: { report: Record<string, unknown> };
    };
    return {
      ...scenarios.capped.responses,
      getReport: {
        ...base,
        data: {
          ...base.data,
          report: {
            ...base.data.report,
            capped: false,
            aggregatesCapped: true,
            matchingIssueCount: base.data.report['issueCount'],
          },
        },
      },
    };
  }

  it('★ distinguishes the aggregate ceiling from the issue page on the project page', async () => {
    setBridgeResolvers(resolversFor(aggregateCappedResponses()));
    render(<App />);
    expect(await screen.findByText(/are missing measurements/)).toBeDefined();
    expect(screen.queryByText(/Report capped at/)).toBeNull();
  });

  it('★ and in the gadget', async () => {
    setBridgeResolvers(resolversFor(aggregateCappedResponses()));
    render(<Gadget />);
    expect(await screen.findByText(/are missing measurements/)).toBeDefined();
  });

  it('says nothing when the report is complete', async () => {
    // A spurious banner is as wrong as a missing one.
    setBridgeResolvers(resolversFor(scenarios.populated.responses));
    render(<App />);
    await screen.findByText('FLOW-3');
    expect(screen.queryByText(/Report capped/)).toBeNull();
  });
});

describe('time-in-status: the report chart', () => {
  it('the chart above the table plots one bar per measured status', async () => {
    setBridgeResolvers(resolversFor(scenarios.populated.responses));
    render(<App />);
    // The chart's own title, which only the ready state renders. It sits
    // above the table so a reader sees the shape before the rows.
    expect(await screen.findByText('Median time in status')).toBeDefined();
  });
});
