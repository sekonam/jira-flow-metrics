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
  // `interface X extends Y<Z> {` and `type X = {` both count. The first
  // version matched only `interface`, with an `extends [\w, ]+` that could
  // not span a generic argument — so two one-line edits made a stand-in
  // invisible to this scan entirely, which is the hole it exists to close.
  // The body ends at the first `}` that starts a line **or** closes the
  // declaration on the line it opened. Terminating only on `\n}` meant a
  // one-line `export type XProps = { a?: string };` ran on until the *next*
  // declaration's closing brace: its props were attributed to the previous
  // component (a false positive naming the wrong one) and the component
  // after it was never checked at all, with `checked` still non-zero so the
  // guard stayed quiet. One-line is the idiomatic form of the type-alias
  // shape this scan was just taught to read, so teaching it that opened it.
  const declarations = source.matchAll(/export (?:interface|type) (\w+Props)\b[^{]*\{([^{}]*?)\}/g);
  let checked = 0;
  for (const [, name, body] of declarations) {
    const declared = [...body!.matchAll(/^\s*(?:readonly\s+)?([a-zA-Z]\w*)\??\s*:/gm)].map(
      (m) => m[1]!,
    );
    const component = name!.replace(/Props$/, '');
    const params = componentParams(source, component);
    // ★ An unreadable signature fails rather than being skipped.
    //
    // It used to `continue` under the comment "not a component; checked
    // elsewhere" — and it is not checked elsewhere: the sibling test only
    // asserts the name exists on the host. A scan that quietly covers less
    // than it claims is the failure this file exists to catch, one level up.
    if (params === null) {
      problems.push(`${component}: has a ${name} declaration but no signature this scan can read`);
      continue;
    }
    checked += 1;
    if (/\.\.\.\w+/.test(params)) continue; // spreads the remainder
    const ignored = declared.filter((prop) => !new RegExp(`\\b${prop}\\b`).test(params));
    if (ignored.length > 0)
      problems.push(`${component}: declares ${ignored.join(', ')} and reads neither`);
  }
  // A scan that parsed nothing must not report success — the same guard the
  // sibling `USED` check has, for the same reason.
  if (checked === 0) problems.push('the scan read no stand-in signatures at all');
  return problems;
}

/**
 * The parameter list of `export const X = (…)` or `export function X(…)`.
 *
 * Braces and parentheses are counted rather than matched by regex, so a
 * destructured parameter with a default (`{ size = 'small' }`), a generic
 * (`<T,>`), any return-type annotation and an inferred return type are all
 * read correctly. The first attempt at this pinned the return type to
 * `React.JSX.Element`, which reported six perfectly correct shapes as
 * broken — and a check that cries wolf teaches people to route around it,
 * which is worse than the silent skip it replaced.
 *
 * ⚠️ Two known limits, both erring quietly rather than falsely:
 *
 *   - a bracket inside a string or comment in the parameter list is counted
 *     (`{ tone = ')' }` truncates the capture, an unbalanced one returns
 *     `null` and fails loudly);
 *   - a wrapped component (`export const Chip = memo(({ tone }: ChipProps)
 *     => …)`) captures the wrapper's whole argument, so a prop mentioned
 *     anywhere in the body reads as used. A prop mentioned nowhere is still
 *     caught.
 *
 * Neither shape exists in `forge-host.tsx`. Counting brackets is the right
 * amount of machinery for a file this scan is checking is *plain*; if a
 * stand-in ever needs one of these shapes, the answer is a real parser, not
 * a longer regex.
 */
function componentParams(source: string, component: string): string | null {
  const declaration = new RegExp(`export (?:const|function) ${component}\\b`).exec(source);
  if (declaration === null) return null;
  const open = source.indexOf('(', declaration.index);
  if (open === -1) return null;
  // The `(` has to belong to *this* declaration. `export const Panel =
  // fallbackPanel;` has none, and walking past the `;` found the parameter
  // list of some later function and reported every one of Panel's props as
  // ignored — a false positive on a correct stand-in, which is the failure
  // mode that teaches people to route around a check.
  if (source.slice(declaration.index, open).includes(';')) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
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
