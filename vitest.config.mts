import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // ★ Every workspace package resolves to **source**, not to `dist`.
      //
      // Only `@jfm/ui-harness` used to, with the rest going through their
      // `exports` maps "as the apps do". That sounded principled and was a
      // hole in the safety net: `pnpm test` runs no build, and `verify` runs
      // `build` *last*, after `coverage` — so the thirteen `apps/*` suites,
      // which reach `@jfm/ui` transitively, were asserting against whatever
      // `dist` happened to be lying around.
      //
      // Measured, not assumed: replacing the whole body of
      // `formatDurationForHumans` with `return "MUTANT"` left all twelve app
      // suites green, and dropping `WORKING_TIME` from the worklog table —
      // the factor-of-three bug `DurationFormat` exists to prevent — left all
      // forty browser flows green. Both were caught the moment the alias
      // pointed at source.
      //
      // `pnpm run build` still runs in `verify`, so a genuine build failure
      // is still caught; what changed is that the tests now test the code in
      // front of you.
      '@jfm/engine': fileURLToPath(new URL('./packages/engine/src', import.meta.url)),
      '@jfm/forge-runtime/testing': fileURLToPath(
        new URL('./packages/forge-runtime/src/testing/pipeline.ts', import.meta.url),
      ),
      '@jfm/forge-runtime': fileURLToPath(new URL('./packages/forge-runtime/src', import.meta.url)),
      '@jfm/ui': fileURLToPath(new URL('./packages/ui/src', import.meta.url)),
      '@jfm/ui-harness': fileURLToPath(new URL('./packages/ui-harness/src', import.meta.url)),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    // Shims for the browser APIs jsdom lacks but the Atlassian Design System
    // reads on import. Harmless under the node environment, which has no
    // `window` at all.
    setupFiles: ['./packages/ui-harness/src/jsdom-setup.ts'],
    // `.tsx` is included for the UI suites, which render components. Those
    // files select the jsdom environment individually with a
    // `@vitest-environment` docblock; everything else stays on node, which is
    // faster and closer to where the engine actually runs.
    include: [
      'packages/**/*.test.ts',
      'packages/**/*.test.tsx',
      'apps/**/*.test.ts',
      'apps/**/*.test.tsx',
      'test/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      // The floor covers the shared packages and the app frontends. Those
      // frontends were previously outside the measurement entirely — the
      // include list matched `.ts` only, so `components.tsx` and every
      // `frontend/*.tsx` reported no coverage *and no gap*.
      include: [
        'packages/engine/src/**/*.ts',
        'packages/forge-runtime/src/**/*.ts',
        'packages/ui/src/**/*.ts',
        'packages/ui/src/**/*.tsx',
        'apps/*/src/frontend/**/*.tsx',
      ],
      exclude: [
        '**/index.ts',
        // Fixture-driven test support. It lives in a production package's src
        // so two packages can share one end-to-end scenario, but counting it
        // as production code would flatter the number the README quotes.
        'packages/forge-runtime/src/testing/**',
        // Pure type declarations, no executable statements to cover.
        'packages/engine/src/jira/types.ts',
        'packages/engine/src/store/types.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
