// MUST be first: it installs `globalThis.__bridge` before the app frontends
// pull in `@forge/bridge`, which throws at module scope without it.
import './bootstrap';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { setGlobalTheme } from '@atlaskit/tokens';
import { RESOLVER_KEYS, setBridgeResolvers } from '../src/bridge';
import { SCREENS } from './screens';

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
 * function the test suites use. It is **fetched at runtime rather than
 * imported**: the file is a build product and is gitignored, and a static
 * import would make `pnpm run typecheck` fail on a fresh clone.
 *
 * ⚠️ What is on screen is the Atlassian Design System rendering of the tree
 * these components build, produced by the stand-in host renderer in
 * `../src/forge-host.tsx`. Forge's own renderer is not installable. Treat
 * these screenshots as a faithful preview of structure, copy and state — not
 * as a screenshot of the deployed app.
 */

interface Scenario {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly responses: Readonly<Record<string, unknown>>;
}

const params = new URLSearchParams(window.location.search);
const screenId = params.get('screen');
const scenarioId = params.get('scenario') ?? 'populated';
/**
 * `?live=<app>` swaps the frozen scenario snapshot for the **real resolvers**,
 * running in the dev server's own Node process over a real engine and a real
 * store that survives between calls.
 *
 * It is what makes an interaction testable at all: a snapshot can render every
 * state but cannot answer "and then what happened", so saving an SLA goal or
 * extending the history window had no observable effect in this harness until
 * this existed. See `src/live-resolvers.ts`.
 */
const liveApp = params.get('live');

async function loadScenarios(): Promise<Readonly<Record<string, Scenario>>> {
  const response = await fetch('/generated/scenarios.json');
  if (!response.ok) {
    throw new Error(
      'generated/scenarios.json is missing. Run `node packages/ui-harness/scripts/build-scenarios.mjs`, ' +
        'or just `pnpm run ui:screens`, which does it first.',
    );
  }
  return (await response.json()) as Readonly<Record<string, Scenario>>;
}

/**
 * Bridge handlers backed by the live resolvers.
 *
 * Every unknown key still reaches the server and is refused there, rather
 * than being answered locally — the point of the live mode is that nothing
 * about the resolver layer is simulated in the browser.
 */
function liveResolvers(app: string): Record<string, (payload: unknown) => Promise<unknown>> {
  const call = async (key: string, payload: unknown): Promise<unknown> => {
    const response = await fetch('/__resolver', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app, key, payload }),
    });
    if (!response.ok) throw new Error(`live resolver ${key} failed: ${String(response.status)}`);
    return await response.json();
  };
  // A plain object over the known key list, not a Proxy: `setBridgeResolvers`
  // spreads what it is handed, and spreading a Proxy copies its own
  // enumerable keys — of which a Proxy over `{}` has none. The first run of
  // this harness failed exactly that way, reporting every resolver as
  // unregistered.
  return Object.fromEntries(
    RESOLVER_KEYS.map((key) => [key, (payload: unknown) => call(key, payload)]),
  );
}

async function wireBridge(): Promise<void> {
  if (liveApp !== null) {
    setBridgeResolvers(liveResolvers(liveApp));
    return;
  }
  if (scenarioId === 'loading') {
    setBridgeResolvers(
      Object.fromEntries(RESOLVER_KEYS.map((key) => [key, () => new Promise<never>(() => {})])),
    );
    return;
  }
  const scenarios = await loadScenarios();
  const scenario = scenarios[scenarioId];
  if (scenario === undefined) {
    throw new Error(
      `no scenario "${scenarioId}". Known: ${Object.keys(scenarios).join(', ')}, loading.`,
    );
  }
  setBridgeResolvers(
    Object.fromEntries(
      Object.entries(scenario.responses).map(([key, value]) => [key, () => value]),
    ),
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
  await wireBridge();

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

  // The screenshot driver waits for this.
  //
  // ⚠️ It is a settle, not a readiness signal, and the distinction matters in
  // `?live=` mode. In snapshot mode the justification holds — every resolver
  // answers from memory — but live mode runs a real `runPipeline` in the dev
  // server's Node process on the first call, which takes longer than this. So
  // every flow's `openSurface` can return while the page is still a spinner.
  // The flows are disciplined about explicit waits and none currently relies
  // on this, but an assertion written without one would be evaluated against
  // a loading page, so live mode gets a longer settle and the comment no
  // longer claims something that is only true of half the harness.
  //
  // The `loading` scenario deliberately never settles and is captured
  // mid-spinner; that is what it is for.
  await new Promise((resolve) => setTimeout(resolve, liveApp === null ? 400 : 1500));
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
