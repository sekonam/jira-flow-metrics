import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // `@jfm/ui-harness` is dev-only tooling. Pointing it at source rather
      // than `dist` keeps the UI suites runnable without a build step and
      // makes stack traces land on the file being edited. Every other
      // workspace package resolves through its `exports` map, as the apps do.
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
