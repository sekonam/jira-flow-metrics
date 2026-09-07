import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The wiring between each frontend and its own resolver.
 *
 * Two separate suites cover the ends of this: the handler tests exercise the
 * resolver bodies, and the frontend suites render the pages against a bridge
 * stand-in. Neither can see the join. A frontend that invokes `getRepoort`
 * type-checks, renders, and fails only at runtime on a real tenant — as a
 * perfectly ordinary "the report could not be loaded" error screen, because
 * that is what every frontend does with a rejected `invoke`.
 *
 * This is a static scan of the sources, so it needs no Forge and no browser.
 * It is deliberately kept in the root suite next to the manifest assertions:
 * both are checks on the shape of the app rather than on its behaviour.
 */

const APPS_DIR = join(process.cwd(), 'apps');
const APPS = readdirSync(APPS_DIR).sort();

function read(app: string, ...parts: string[]): string {
  return readFileSync(join(APPS_DIR, app, ...parts), 'utf8');
}

/** Keys the app's composition root registers with `@forge/resolver`. */
function definedKeys(app: string): string[] {
  const source = read(app, 'src', 'index.ts');
  return [...source.matchAll(/resolver\.define\('([^']+)'/g)].map((m) => m[1]!);
}

/** Keys the app's two frontends invoke over the bridge. */
function invokedKeys(app: string): string[] {
  const sources = ['index.tsx', 'gadget.tsx'].map((file) => read(app, 'src', 'frontend', file));
  return [
    ...new Set(
      sources.flatMap((source) => [...source.matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]!)),
    ),
  ].sort();
}

describe('every listing wires its own frontends to its own resolver', () => {
  it('finds five apps to check', () => {
    expect(APPS).toEqual([
      'issue-history',
      'sla-breach',
      'time-in-status',
      'wip-aging',
      'worklog-reports',
    ]);
  });

  it.each(APPS)('%s: the scan finds keys at both ends', (app) => {
    expect(definedKeys(app).length).toBeGreaterThan(2);
    expect(invokedKeys(app).length).toBeGreaterThan(0);
  });

  it.each(APPS)('%s: every key a frontend invokes is defined by its resolver', (app) => {
    const defined = new Set(definedKeys(app));
    const missing = invokedKeys(app).filter((key) => !defined.has(key));
    expect(missing).toEqual([]);
  });

  /**
   * ★ The reverse direction, and it is not clean.
   *
   * `exportCsv` is defined by all five resolvers, implemented in the engine,
   * covered by tests, and listed as a v1 feature of every listing in
   * `docs/PRODUCT-SPEC.md` — and **no frontend invokes it**, so there is no
   * way for a user to reach it. It was invisible until every screen was
   * rendered and looked at: there is no export button anywhere.
   *
   * This test pins the gap rather than hiding it. UI Kit 2 has no file
   * download primitive, so closing it needs a platform decision that cannot be
   * validated from here; it is recorded in `docs/TECHNICAL-SPEC.md` § 11 and
   * in `docs/ROADMAP.md`. **When the export button ships, this assertion is
   * the thing that must change.**
   */
  it.each(APPS)('%s: records exportCsv as defined but unreachable from the UI', (app) => {
    expect(definedKeys(app)).toContain('exportCsv');
    expect(invokedKeys(app)).not.toContain('exportCsv');
  });
});

describe('test-support code cannot reach a Forge bundle', () => {
  /**
   * `packages/forge-runtime/src/testing/pipeline.ts` is fixture-driven test
   * support living inside a production package's `src`, because two packages
   * need the identical end-to-end scenario and duplicating it would let the
   * two drift. It reads fixture JSON with `node:fs`, which does not exist in
   * the Forge sandbox, so it must stay unreachable from the package index —
   * the only entry point an app's bundler follows.
   */
  it('the forge-runtime index does not re-export the testing module', () => {
    const index = readFileSync(
      join(process.cwd(), 'packages', 'forge-runtime', 'src', 'index.ts'),
      'utf8',
    );
    expect(index).not.toMatch(/testing/);
  });

  it('no app source imports it', () => {
    for (const app of APPS) {
      const dir = join(APPS_DIR, app, 'src');
      const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) =>
        /\.tsx?$/.test(f),
      );
      for (const file of files) {
        expect(readFileSync(join(dir, file), 'utf8')).not.toContain('@jfm/forge-runtime/testing');
      }
    }
  });
});
