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
      // The coverage floor is enforced on the shared engine only. The engine is
      // where every load-bearing calculation lives; the app packages are thin
      // presentation shells over it.
      include: ['packages/engine/src/**/*.ts'],
      exclude: ['packages/engine/src/**/index.ts', 'packages/engine/src/**/*.types.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
