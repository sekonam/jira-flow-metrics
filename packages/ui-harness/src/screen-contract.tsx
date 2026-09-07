import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import {
  invokedResolvers,
  resetBridge,
  setBridgeResolvers,
  unregisteredResolvers,
} from './bridge.js';
import { auditA11y, describeFindings } from './a11y.js';
import {
  pendingResolvers,
  rejectingResolvers,
  resolversFor,
  type Scenario,
  type ScenarioId,
} from './scenarios.js';

/**
 * The state contract every one of the ten app surfaces must satisfy.
 *
 * `BUILD-PLAN.md` requires that "empty, loading, error and partial-data states
 * are designed explicitly, not left to chance". Ten near-identical test files
 * would make that requirement unreadable and unmaintained, so the shared
 * expectations live here and each app's suite supplies only what is genuinely
 * different: its title, its resolver keys and its empty-state wording.
 *
 * Every payload comes from `scenarios.ts`, which runs the real ingestion
 * pipeline over the recorded Jira fixtures and calls the real resolver
 * handlers. Only the bridge transport is a stand-in.
 */

export type ScenarioMap = Readonly<Record<ScenarioId, Scenario>>;

export interface ScreenSpec {
  /** e.g. `time-in-status project page`. Used as the describe block name. */
  readonly name: string;
  readonly Component: React.ComponentType;
  readonly surface: 'page' | 'gadget';
  /** Resolver keys the surface may call, and which the harness registers. */
  readonly resolverKeys: readonly string[];
  /** Resolver keys the surface must call on first render, and no others. */
  readonly invokedOnLoad: readonly string[];
  /** Heading the page shows. Gadgets use a level-3 heading. */
  readonly heading: string;
  /** Heading of the empty state (pages) or its sentence (gadgets). */
  readonly emptyText: string | RegExp;
  /** Something only the populated screen shows, to prove data arrived. */
  readonly populatedText: string | RegExp;
}

async function expectNoA11yViolations(): Promise<void> {
  const findings = await auditA11y(document.body);
  expect(describeFindings(findings)).toBe('no violations');
}

/**
 * The surface may not ask for a resolver nothing answers.
 *
 * Every frontend catches an `invoke` failure and renders "the report could not
 * be loaded", so a call to a key the manifest does not wire up produces a
 * perfectly plausible error screen. Without this the mistake is invisible.
 */
function expectNoUnregisteredResolvers(): void {
  expect(unregisteredResolvers()).toEqual([]);
}

export function describeScreen(spec: ScreenSpec, scenarios: ScenarioMap): void {
  const { Component } = spec;

  describe(spec.name, () => {
    beforeEach(() => {
      resetBridge();
    });
    afterEach(() => {
      cleanup();
    });

    function mount(id: ScenarioId): void {
      setBridgeResolvers(resolversFor(scenarios[id].responses));
      render(<Component />);
    }

    it('shows a named loading state while the resolver has not answered', async () => {
      setBridgeResolvers(pendingResolvers(spec.resolverKeys));
      render(<Component />);
      expect(await screen.findByRole('img', { name: /Loading/ })).toBeDefined();
      expectNoUnregisteredResolvers();
      await expectNoA11yViolations();
    });

    /**
     * ★ Found by rendering: the indexing banner was rendered from a `null`
     * progress value before the first response arrived, so every page opened
     * with "Not indexed yet — Start indexing to build the report" *underneath
     * a loading spinner*, on projects that were fully indexed. The banner must
     * not make a claim about the index before it has been told anything.
     */
    if (spec.surface === 'page') {
      it('★ does not claim the project is unindexed while it is still loading', async () => {
        setBridgeResolvers(pendingResolvers(spec.resolverKeys));
        render(<Component />);
        await screen.findByRole('img', { name: /Loading/ });
        expect(screen.queryByText('Not indexed yet')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Start indexing' })).toBeNull();
      });
    }

    it('renders the populated report', async () => {
      mount('populated');
      // `findAllByText` rejects on no match, so reaching the next line is the assertion.
      await screen.findAllByText(spec.populatedText);
      expectNoUnregisteredResolvers();
    });

    it('invokes exactly the resolvers it needs on first render, and no others', async () => {
      mount('populated');
      await screen.findAllByText(spec.populatedText);
      await waitFor(() => {
        expect([...new Set(invokedResolvers())].sort()).toEqual([...spec.invokedOnLoad].sort());
      });
    });

    it('passes an axe WCAG 2.1 AA audit when populated', async () => {
      mount('populated');
      await screen.findAllByText(spec.populatedText);
      await expectNoA11yViolations();
    });

    it('shows the empty state when the project has been indexed and has nothing', async () => {
      mount('empty');
      await screen.findAllByText(spec.emptyText);
      expectNoUnregisteredResolvers();
      await expectNoA11yViolations();
    });

    it('shows the refusal the resolver returned, not a generic failure', async () => {
      mount('error');
      expect(
        await screen.findByText(/You do not have permission to browse this project in Jira/),
      ).toBeDefined();
      // ★ And says nothing else. A refused call leaves `progress` null, which
      // the banner used to read as "not indexed yet" — so a user with no
      // permission was told, in a cheerful blue box directly above the
      // refusal, to start indexing a project they cannot see.
      expect(screen.queryByText('Not indexed yet')).toBeNull();
      expectNoUnregisteredResolvers();
      await expectNoA11yViolations();
    });

    it('recovers a rejected resolver call into a readable message', async () => {
      setBridgeResolvers(rejectingResolvers(spec.resolverKeys));
      render(<Component />);
      const message =
        spec.surface === 'page'
          ? /The report could not be loaded\. Try again in a moment\./
          : /Could not load this gadget\./;
      expect(await screen.findByText(message)).toBeDefined();
      expectNoUnregisteredResolvers();
      await expectNoA11yViolations();
    });

    it('★ shows partial data together with the warning that it is partial', async () => {
      mount('partial');
      // Rows are shown...
      // `findAllByText` rejects on no match, so reaching the next line is the assertion.
      await screen.findAllByText(spec.populatedText);
      // ...and the user is told they are built from an incomplete index. A
      // metrics product that reports half an instance silently is the failure
      // mode this repository exists to avoid.
      const partialNotice =
        spec.surface === 'page'
          ? /Numbers below cover only the issues indexed so far/
          : /Indexing is still in progress/;
      expect(await screen.findByText(partialNotice)).toBeDefined();
      expectNoUnregisteredResolvers();
      await expectNoA11yViolations();
    });

    if (spec.surface === 'page') {
      it('★ offers indexing exactly once on a project that has never been indexed', async () => {
        mount('not-indexed');
        expect(await screen.findByText('Not indexed yet')).toBeDefined();
        // Exactly one. The banner used to carry its own copy of this button,
        // which meant every unindexed project showed it twice.
        const buttons = await screen.findAllByRole('button', { name: 'Start indexing' });
        expect(buttons).toHaveLength(1);
        await expectNoA11yViolations();
      });

      it('actually calls startIndexing when the button is pressed', async () => {
        mount('not-indexed');
        const button = await screen.findByRole('button', { name: 'Start indexing' });
        button.click();
        await waitFor(() => {
          expect(invokedResolvers()).toContain('startIndexing');
        });
        expectNoUnregisteredResolvers();
      });

      it('retries the failed call when the user presses Try again', async () => {
        mount('error');
        const retry = await screen.findByRole('button', { name: 'Try again' });
        const before = invokedResolvers().length;
        retry.click();
        await waitFor(() => {
          expect(invokedResolvers().length).toBeGreaterThan(before);
        });
        expectNoUnregisteredResolvers();
      });

      it('starts indexing from the empty state', async () => {
        mount('empty');
        const button = await screen.findByRole('button', { name: 'Start indexing' });
        button.click();
        await waitFor(() => {
          expect(invokedResolvers()).toContain('startIndexing');
        });
        expectNoUnregisteredResolvers();
      });

      it('renders the page heading as a level-1 heading', async () => {
        mount('populated');
        const heading = await screen.findByRole('heading', { name: spec.heading, level: 1 });
        expect(heading).toBeDefined();
      });
    } else {
      it('renders the gadget heading as a level-3 heading', async () => {
        mount('populated');
        const heading = await screen.findByRole('heading', { name: spec.heading, level: 3 });
        expect(heading).toBeDefined();
      });
    }
  });
}
