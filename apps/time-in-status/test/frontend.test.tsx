// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
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
    heading: 'Time in status',
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
    cleanup();
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
    cleanup();
  });
});
