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

/**
 * Files that import from `@forge/react` and are shipped in an app bundle.
 *
 * Every frontend file an app ships, read from the directory rather than from
 * a hard-coded pair. `['index.tsx', 'gadget.tsx']` missed all five
 * `admin.tsx` and `time-in-status`'s `panel.tsx` — six surfaces that do
 * import from `@forge/react` — so a UI Kit component used only there was
 * checked neither for existing in `@forge/react` nor for having a stand-in.
 * `test/resolver-wiring.test.ts` globs for exactly this reason and says so;
 * this file did not get the same treatment.
 */
function productionSources(): string[] {
  const files = [join(REPO_ROOT, 'packages/ui/src/components.tsx')];
  const appsDir = join(REPO_ROOT, 'apps');
  for (const app of readdirSync(appsDir)) {
    const frontendDir = join(appsDir, app, 'src/frontend');
    for (const file of readdirSync(frontendDir)
      .filter((f) => f.endsWith('.tsx'))
      .sort()) {
      files.push(join(frontendDir, file));
    }
  }
  return files;
}

/**
 * ★ A stand-in that accepts a prop and ignores it.
 *
 * This file checked *names* only — that every component the product imports
 * exists in `@forge/react` and has a stand-in — and three defects walked
 * straight through that: a `Select` whose `value` was declared and dropped
 * (so no test could see a control disagreeing with its own state), a `Modal`
 * asking for `x-large` and rendering at the default width, and an `onClose`
 * wired to nothing.
 *
 * The shape they share is exact and checkable without a type-checker: a prop
 * declared on the stand-in's own `*Props` interface and never read by the
 * component. If the stand-in takes a rest parameter it is spreading whatever
 * it did not name, which is fine.
 */
function standInPropsNeverRead(source: string): string[] {
  const problems: string[] = [];
  const interfaces = source.matchAll(
    /export interface (\w+Props)\s*(?:extends [\w, ]+)?\{([\s\S]*?)\n\}/g,
  );
  for (const [, name, body] of interfaces) {
    const declared = [...body!.matchAll(/^\s*(?:readonly\s+)?([a-zA-Z]\w*)\??\s*:/gm)].map(
      (m) => m[1]!,
    );
    const component = name!.replace(/Props$/, '');
    const signature = new RegExp(
      `export (?:const ${component}\\s*=\\s*|function ${component}\\s*)\\(([\\s\\S]*?)\\)\\s*:\\s*(?:React\\.)?JSX\\.Element`,
    ).exec(source);
    // ★ An unmatched signature fails rather than being skipped.
    //
    // It used to `continue` under the comment "not a component; checked
    // elsewhere" — and it is not checked elsewhere: the sibling test only
    // asserts the name exists on the host. So a stand-in written as
    // `export function Widget(props: WidgetProps)`, or returning
    // `JSX.Element` without the `React.` prefix, silently left this whole
    // check. A scan that quietly covers less than it claims is the failure
    // this file exists to catch, one level up.
    if (signature === null) {
      problems.push(`${component}: has a ${name} interface but no signature this scan can read`);
      continue;
    }
    const params = signature[1]!;
    if (/\.\.\.\w+/.test(params)) continue; // spreads the remainder
    const ignored = declared.filter((prop) => !new RegExp(`\\b${prop}\\b`).test(params));
    if (ignored.length > 0)
      problems.push(`${component}: declares ${ignored.join(', ')} and reads neither`);
  }
  return problems;
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

  it('★ never accepts a prop it then ignores', () => {
    // The whole value of a stand-in is that a test which passes through it
    // says something about the product. A prop that is declared and dropped
    // breaks exactly that, in silence and with a green suite — which is how
    // a `Select` rendered without its `value` and a modal asked for
    // `x-large` and got the default width.
    const source = readFileSync(join(REPO_ROOT, 'packages/ui-harness/src/forge-host.tsx'), 'utf8');
    expect(standInPropsNeverRead(source)).toEqual([]);
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
