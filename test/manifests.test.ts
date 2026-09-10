import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ALL_PRICING } from '@jfm/engine';

/**
 * Manifest invariants.
 *
 * `forge lint` cannot run here — it needs credentials — so these assertions
 * are the only automated check the manifests get. They cover the things that
 * would be expensive to discover late:
 *
 * - **No scheduled trigger anywhere.** A periodic re-index would invert the
 *   unit economics on a consumption-priced platform, and it is the kind of
 *   thing that gets added "temporarily" and never removed.
 * - **Least privilege, and no write scopes.** A write scope on a read-only
 *   reporting app fails Marketplace security review and, worse, deserves to.
 * - **Every declared handler exists** in the app's entry point.
 * - **One app directory per priced listing**, so the pricing config and the
 *   shipped apps cannot drift apart.
 */

const APPS_DIR = fileURLToPath(new URL('../apps', import.meta.url));
const APP_KEYS = readdirSync(APPS_DIR).sort();

/**
 * The apps `forge register` has claimed and `forge lint` has accepted.
 *
 * Listed by hand rather than inferred from the manifests, because the point of
 * the assertions below is that nobody reads this repository and believes more
 * has been proven than has. Registering an app should require saying so here.
 *
 * The other four stop at Atlassian's Developer Terms, which bind the account
 * owner to billing above the free allowance — not a step automation should
 * take on someone's behalf.
 */
const REGISTERED = new Set(['time-in-status']);

interface Manifest {
  modules?: Record<string, unknown>;
  resources?: { key: string; path: string }[];
  app?: { runtime?: { name?: string }; id?: string };
  permissions?: { scopes?: string[] };
}

function manifestFor(key: string): Manifest {
  return parse(readFileSync(`${APPS_DIR}/${key}/manifest.yml`, 'utf8')) as Manifest;
}

function entryPointFor(key: string): string {
  return readFileSync(`${APPS_DIR}/${key}/src/index.ts`, 'utf8');
}

describe('app inventory', () => {
  it('ships exactly one app per priced listing', () => {
    expect(APP_KEYS).toEqual([...ALL_PRICING.map((p) => p.listingId)].sort());
  });
});

describe.each(APP_KEYS)('manifest: %s', (key) => {
  const manifest = manifestFor(key);

  it('is valid YAML with the expected top-level sections', () => {
    expect(Object.keys(manifest).sort()).toEqual(['app', 'modules', 'permissions', 'resources']);
  });

  it('declares no scheduled trigger — ingestion is incremental only', () => {
    expect(manifest.modules?.['scheduledTrigger']).toBeUndefined();
    const raw = readFileSync(`${APPS_DIR}/${key}/manifest.yml`, 'utf8');
    expect(raw).not.toContain('scheduledTrigger');
  });

  it('subscribes to the three issue events the engine needs', () => {
    const triggers = manifest.modules?.['trigger'] as { events?: string[] }[] | undefined;
    expect(triggers?.[0]?.events).toEqual([
      'avi:jira:created:issue',
      'avi:jira:updated:issue',
      'avi:jira:deleted:issue',
    ]);
  });

  it('declares a queue consumer for the resumable backfill', () => {
    const consumers = manifest.modules?.['consumer'] as
      { queue?: string; resolver?: { method?: string } }[] | undefined;
    expect(consumers?.[0]?.queue).toBe('backfill');
    expect(consumers?.[0]?.resolver?.method).toBe('run-slice');
  });

  it('requests least privilege and asks for no write scope', () => {
    const scopes = manifest.permissions?.scopes ?? [];
    expect(scopes.sort()).toEqual(['read:jira-user', 'read:jira-work', 'storage:app']);
    expect(scopes.some((s) => s.startsWith('write:') || s.startsWith('manage:'))).toBe(false);
    expect(scopes.some((s) => s.startsWith('delete:'))).toBe(false);
  });

  it('pins the Node 22 runtime the code is written for', () => {
    expect(manifest.app?.runtime?.name).toBe('nodejs22.x');
  });

  it('carries a real app id only once it has actually been registered', () => {
    if (REGISTERED.has(key)) {
      expect(manifest.app?.id).toMatch(
        /^ari:cloud:ecosystem::app\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    } else {
      expect(manifest.app?.id).toContain('REPLACE-WITH-forge-register-OUTPUT');
    }
  });

  it('points every declared function at an export that exists', () => {
    const functions = manifest.modules?.['function'] as { handler?: string }[] | undefined;
    const source = entryPointFor(key);
    expect(functions?.length).toBeGreaterThan(0);
    for (const fn of functions ?? []) {
      const [module, name] = (fn.handler ?? '').split('.');
      expect(module).toBe('index');
      expect(name).toBeDefined();
      expect(source).toMatch(new RegExp(`export (const|async function|function) ${name!}\\b`));
    }
  });

  it('points every declared resource at a file that exists', () => {
    for (const resource of manifest.resources ?? []) {
      expect(() => readFileSync(`${APPS_DIR}/${key}/${resource.path}`, 'utf8')).not.toThrow();
    }
  });

  it('says in a comment whether forge lint has ever accepted it', () => {
    // "UNVALIDATED" contains "VALIDATED", so the negative is asserted too —
    // otherwise a stale warning banner would satisfy the validated branch.
    const text = readFileSync(`${APPS_DIR}/${key}/manifest.yml`, 'utf8');
    if (REGISTERED.has(key)) {
      expect(text).toContain('✔ VALIDATED');
      expect(text).not.toContain('UNVALIDATED');
    } else {
      expect(text).toContain('UNVALIDATED');
    }
  });
});
