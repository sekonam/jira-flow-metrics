import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      // The coverage floor is enforced on the shared packages. They hold every
      // load-bearing calculation; the app packages are thin presentation shells.
      include: ['packages/engine/src/**/*.ts', 'packages/forge-runtime/src/**/*.ts'],
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
