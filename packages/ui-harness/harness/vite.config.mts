import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * The visual harness.
 *
 * One alias does the load-bearing work: `@forge/react` is replaced by the
 * stand-in host renderer. UI Kit 2 exports are string sentinels serialised
 * over the Forge bridge, and the code that turns them into Atlassian Design
 * System markup ships inside Jira, so without the substitution there is
 * nothing to render.
 *
 * `@forge/bridge` is deliberately **not** aliased: the harness installs a
 * `globalThis.__bridge`, so the real module and its real `invoke` run.
 */
export default defineConfig({
  root: here('.'),
  plugins: [react()],
  resolve: {
    alias: {
      '@forge/react': here('../src/forge-host.tsx'),
      // ★ The workspace packages resolve to **source**, for the same reason
      // `vitest.config.mts` aliases them: nothing rebuilds `dist` before
      // `pnpm run e2e:ui`, so the browser flows were driving whatever build
      // artifact happened to be lying around. Dropping `WORKING_TIME` from
      // the worklog table — the factor-of-three bug `DurationFormat` exists
      // to prevent — left all forty flows green until this was added.
      '@jfm/engine': here('../../engine/src'),
      '@jfm/forge-runtime': here('../../forge-runtime/src'),
      '@jfm/ui': here('../../ui/src'),
    },
  },
  server: { port: 5183, strictPort: true },
  build: { outDir: here('../dist-harness'), emptyOutDir: true },
});
