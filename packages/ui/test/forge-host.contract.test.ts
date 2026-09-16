// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as host from '@jfm/ui-harness/forge-host';

/**
 * `@forge/react` cannot be *imported* outside an Atlassian product, never mind
 * rendered: `@forge/bridge`'s `invoke` module calls `getCallBridge()` at module
 * scope, which throws
 *
 *     Unable to establish a connection with the Custom UI bridge.
 *
 * in any environment that is not a Jira page. The global setup file installs a
 * stand-in `globalThis.__bridge` so the real package loads; nothing about
 * `@forge/react` itself is replaced in this file.
 */
const realForgeReact = await import('@forge/react');

/**
 * The contract between the real `@forge/react` and the stand-in host renderer.
 *
 * Every other UI test in this repository renders through
 * `packages/ui-harness/src/forge-host.tsx`, which maps UI Kit sentinels onto
 * Atlassian Design System components. That stand-in is only worth anything if
 * it stays aligned with the package it stands in for, so this suite imports
 * **the real module** — no mock — and checks three things:
 *
 * 1. every component the product imports from `@forge/react` exists there;
 * 2. every one of those has a stand-in;
 * 3. the sentinel values are still the plain strings the mapping assumes.
 *
 * A `@forge/react` upgrade that renames or restructures a component therefore
 * fails here, in seconds, instead of on the first deploy.
 *
 * Only the **transport** is stubbed here — a `globalThis.__bridge` object.
 * `@forge/bridge` and `@forge/react` are both the real packages.
 *
 * ⚠️ It does **not** check that the stand-in renders what Forge renders. That
 * is unknowable outside a real Atlassian tenant; see `docs/RUNBOOK.md`.
 */

/**
 * Vitest runs from the directory holding `vitest.config.mts`, which is the
 * workspace root. Deliberately not derived from `import.meta.url`: under the
 * jsdom environment the global `URL` is jsdom's, and resolving a relative path
 * against `import.meta.url` yields Vite's `/@fs/...` form rather than a real
 * filesystem path.
 */
const REPO_ROOT = process.cwd();

/** Files that import from `@forge/react` and are shipped in an app bundle. */
function productionSources(): string[] {
  const files = [join(REPO_ROOT, 'packages/ui/src/components.tsx')];
  const appsDir = join(REPO_ROOT, 'apps');
  for (const app of readdirSync(appsDir)) {
    for (const file of ['index.tsx', 'gadget.tsx']) {
      files.push(join(appsDir, app, 'src/frontend', file));
    }
  }
  return files;
}

/** Names imported from `@forge/react`, default import included as `default`. */
function importedNames(source: string): string[] {
  const names = new Set<string>();
  // Anchored at a line start and forbidden from crossing a `;`, so it cannot
  // run backwards into the preceding import statement.
  const pattern = /^import\s+([^;]*?)\s+from\s+'@forge\/react'/gm;
  for (const match of source.matchAll(pattern)) {
    const clause = match[1] ?? '';
    const braced = /\{([\s\S]*?)\}/.exec(clause);
    if (braced !== null) {
      for (const part of (braced[1] ?? '').split(',')) {
        const name = part
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim();
        if (name !== undefined && name !== '') names.add(name);
      }
    }
    const defaultName = clause
      .replace(/\{[\s\S]*?\}/, '')
      .replace(/,/g, '')
      .trim();
    if (defaultName !== '') names.add('default');
  }
  return [...names];
}

const USED = [
  ...new Set(productionSources().flatMap((file) => importedNames(readFileSync(file, 'utf8')))),
].sort();

describe('the product only imports things `@forge/react` actually exports', () => {
  it('finds imports to check at all (guards against the scan silently matching nothing)', () => {
    expect(USED.length).toBeGreaterThan(10);
    expect(USED).toContain('DynamicTable');
    expect(USED).toContain('default');
  });

  it.each(USED)('`%s` exists in the real @forge/react', (name) => {
    const key = name === 'default' ? 'default' : name;
    expect(Object.keys(realForgeReact)).toContain(key);
  });
});

describe('the stand-in host renderer covers everything the product uses', () => {
  it.each(USED)('`%s` has a stand-in', (name) => {
    expect(Object.keys(host)).toContain(name);
  });

  it('exposes a ForgeReconciler whose render call is a no-op', () => {
    expect(typeof host.default.render).toBe('function');
    expect(() => {
      host.default.render(null);
    }).not.toThrow();
  });
});

describe('the UI Kit sentinels are still plain strings named after themselves', () => {
  const SENTINELS = [
    'BarChart',
    'Box',
    'Button',
    'ButtonGroup',
    'EmptyState',
    'Heading',
    'Inline',
    'Lozenge',
    'SectionMessage',
    'Spinner',
    'Stack',
    'Strong',
    'Text',
  ] as const;

  it.each(SENTINELS)('`%s` is the string "%s"', (name) => {
    expect((realForgeReact as unknown as Record<string, unknown>)[name]).toBe(name);
  });

  /**
   * `DynamicTable` is the exception: in `@forge/react` it is a real function
   * component that restructures `head`/`rows` into `Cell`/`Row` sentinels for
   * the bridge. The stand-in passes them straight to the ADS table instead,
   * which is what the product frontend reconstructs anyway — but if this ever
   * stops being a function the mapping needs revisiting.
   */
  it('DynamicTable is a component rather than a sentinel', () => {
    expect(typeof realForgeReact.DynamicTable).toBe('function');
  });
});
