// MUST be first: it installs `globalThis.__bridge` before the app frontends
// pull in `@forge/bridge`, which throws at module scope without it.
import './bootstrap';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { setGlobalTheme } from '@atlaskit/tokens';
import { setBridgeResolvers } from '../src/bridge';
import { SCREENS } from './screens';
import scenarios from './generated/scenarios.json';

/**
 * The visual harness entry point.
 *
 * One screen, one state, per URL: `/?screen=<id>&scenario=<id>`. Playwright
 * drives it in `scripts/screens.mjs`, which is how a human sees this product
 * for the first time.
 *
 * The data is not invented. `generated/scenarios.json` is written by
 * `scripts/build-scenarios.mjs`, which runs the real ingestion pipeline over
 * the recorded Jira fixtures and calls the real resolver handlers — the same
 * function the test suites use.
 *
 * ⚠️ What is on screen is the Atlassian Design System rendering of the tree
 * these components build, produced by the stand-in host renderer in
 * `../src/forge-host.tsx`. Forge's own renderer is not installable. Treat
 * these screenshots as a faithful preview of structure, copy and state — not
 * as a screenshot of the deployed app.
 */

type ScenarioId = keyof typeof scenarios;

const params = new URLSearchParams(window.location.search);
const screenId = params.get('screen');
const scenarioId = (params.get('scenario') ?? 'populated') as ScenarioId | 'loading';

const RESOLVER_KEYS = [
  'getReport',
  'getWorklogReport',
  'getAgingReport',
  'getSlaReport',
  'getHistoryReport',
  'startIndexing',
] as const;

function wireBridge(): void {
  if (scenarioId === 'loading') {
    setBridgeResolvers(
      Object.fromEntries(RESOLVER_KEYS.map((key) => [key, () => new Promise<never>(() => {})])),
    );
    return;
  }
  const responses = scenarios[scenarioId].responses as Record<string, unknown>;
  setBridgeResolvers(
    Object.fromEntries(Object.entries(responses).map(([key, value]) => [key, () => value])),
  );
}

function Frame({ children }: { children: React.ReactNode }): React.JSX.Element {
  const screen = SCREENS.find((s) => s.id === screenId);
  const isGadget = screen?.surface === 'gadget';
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--ds-surface, #fff)',
        padding: isGadget ? 0 : 24,
        boxSizing: 'border-box',
      }}
    >
      {isGadget ? (
        // A gadget is rendered inside a card on a shared dashboard, so it is
        // framed like one. Reviewing it full-bleed would flatter it.
        <div
          style={{
            margin: 16,
            padding: 16,
            borderRadius: 8,
            border: '1px solid var(--ds-border, #dcdfe4)',
            background: 'var(--ds-surface-raised, #fff)',
            boxShadow: 'var(--ds-shadow-raised, 0 1px 1px rgba(9,30,66,.25))',
          }}
        >
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

async function main(): Promise<void> {
  await setGlobalTheme({ colorMode: 'light', light: 'light', spacing: 'spacing' });
  wireBridge();

  const screen = SCREENS.find((s) => s.id === screenId);
  const root = createRoot(document.getElementById('root')!);
  if (screen === undefined) {
    root.render(<Index />);
  } else {
    const Component = screen.Component;
    root.render(
      <Frame>
        <Component />
      </Frame>,
    );
  }

  // The screenshot driver waits for this. Every resolver in the harness
  // answers from memory, so a short settle is enough; the `loading` scenario
  // deliberately never settles and is captured mid-spinner.
  await new Promise((resolve) => setTimeout(resolve, 400));
  document.body.dataset['harnessReady'] = 'true';
}

/** Landing page, so opening the dev server by hand is useful too. */
function Index(): React.JSX.Element {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>jira-flow-metrics screen harness</h1>
      <p>
        Rendered through a stand-in for the Forge host renderer. Not a screenshot of the deployed
        app — see <code>packages/ui-harness/src/forge-host.tsx</code>.
      </p>
      {SCREENS.map((screen) => (
        <div key={screen.id} style={{ marginBottom: 12 }}>
          <strong>
            {screen.listing} — {screen.surface}
          </strong>
          <div>
            {['populated', 'partial', 'empty', 'not-indexed', 'error', 'loading'].map(
              (scenario) => (
                <a
                  key={scenario}
                  href={`/?screen=${screen.id}&scenario=${scenario}`}
                  style={{ marginRight: 12 }}
                >
                  {scenario}
                </a>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

void main();
