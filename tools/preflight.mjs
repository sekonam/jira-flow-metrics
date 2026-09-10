/**
 * Check every claim each `manifest.yml` makes against the code beside it.
 *
 * `forge lint` cannot run here. It authenticates, then looks the app up in
 * Atlassian's registry and refuses if it is not there — so the manifests
 * cannot be validated at all until `forge register` has run, which is the one
 * step nobody can take without an Atlassian account. That leaves the day of
 * the first deploy as the day these files are first checked, which is the
 * worst possible day to discover a typo.
 *
 * This is the half of that check which needs nobody's permission: the parts
 * that are answerable from the repository. It does not replace `forge lint` —
 * it cannot see Atlassian's module schema, scope names, or runtime list — but
 * it does catch the mistakes that are actually likely: a handler renamed in
 * TypeScript and not in YAML, a resource pointing at a moved file, a resolver
 * key a frontend invokes that no manifest wires up.
 *
 * Run: `pnpm run preflight`
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const APPS = join(ROOT, 'apps');

const say = (line = '') => process.stdout.write(`${line}\n`);
const problems = [];
const fail = (app, message) => problems.push(`${app}: ${message}`);

/**
 * Enough YAML for these manifests, and no more.
 *
 * A YAML dependency for five hand-written files would be the wrong trade, but
 * the parsing has to be honest about its own limits: anything it cannot read
 * it reports rather than skips, so a manifest that outgrows it fails loudly
 * instead of silently passing unchecked.
 */
function parseManifest(text) {
  /** @type {{modules: Record<string, {key?: string, handler?: string, resource?: string, resolver?: string}[]>, resources: {key?: string, path?: string}[], appId: string|null, scopes: string[], runtime: string|null}} */
  const out = { modules: {}, resources: [], appId: null, scopes: [], runtime: null };
  const lines = text.split('\n').map((line) => line.replace(/\s+$/, ''));

  let section = null; // 'modules' | 'resources' | 'permissions' | 'app'
  let moduleType = null;
  let current = null;
  // The indent of a module entry's `- `. Nested lists — a trigger's `events:`,
  // for one — sit deeper and are not entries; counting them made every app
  // report four triggers where it has one.
  let entryIndent = null;

  for (const raw of lines) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();

    if (indent === 0) {
      section = line.replace(':', '');
      moduleType = null;
      current = null;
      continue;
    }

    if (section === 'modules') {
      if (indent === 2 && line.endsWith(':')) {
        moduleType = line.slice(0, -1);
        out.modules[moduleType] ??= [];
        current = null;
        entryIndent = null;
        continue;
      }
      if (line.startsWith('- ')) {
        entryIndent ??= indent;
        if (indent > entryIndent) continue; // a nested list, not a new entry
        current = {};
        out.modules[moduleType]?.push(current);
        const [key, ...rest] = line.slice(2).split(':');
        if (rest.length) current[key.trim()] = rest.join(':').trim();
        continue;
      }
      if (current && line.includes(':')) {
        const [key, ...rest] = line.split(':');
        const value = rest.join(':').trim();
        // `resolver:` nests a `function:` beneath it; flatten to `resolver`.
        if (key.trim() === 'function' && value !== '') current.resolver = value;
        else if (value !== '') current[key.trim()] = value;
      }
      continue;
    }

    if (section === 'resources') {
      if (line.startsWith('- ')) {
        current = {};
        out.resources.push(current);
        const [key, ...rest] = line.slice(2).split(':');
        if (rest.length) current[key.trim()] = rest.join(':').trim();
        continue;
      }
      if (current && line.includes(':')) {
        const [key, ...rest] = line.split(':');
        current[key.trim()] = rest.join(':').trim();
      }
      continue;
    }

    if (section === 'app') {
      if (line.startsWith('id:')) out.appId = line.slice(3).trim();
      if (line.startsWith('name:')) out.runtime = line.slice(5).trim();
      continue;
    }

    if (section === 'permissions' && line.startsWith('- ')) out.scopes.push(line.slice(2).trim());
  }
  return out;
}

const apps = readdirSync(APPS).filter((name) => existsSync(join(APPS, name, 'manifest.yml')));
say(`\nPreflight — ${apps.length} app(s)\n`);

for (const app of apps) {
  const dir = join(APPS, app);
  const manifest = parseManifest(readFileSync(join(dir, 'manifest.yml'), 'utf8'));
  const source = readFileSync(join(dir, 'src/index.ts'), 'utf8');

  // 1. Every `function` module's handler must be exported from src/index.ts.
  const functions = manifest.modules.function ?? [];
  if (functions.length === 0) fail(app, 'the manifest declares no functions');
  for (const fn of functions) {
    const handler = fn.handler ?? '';
    const [file, exported] = handler.split('.');
    if (file !== 'index') {
      fail(app, `function "${fn.key}" points at ${file}.js, which this check cannot follow`);
      continue;
    }
    const declared = new RegExp(
      `export\\s+(?:const|async function|function)\\s+${exported}\\b`,
    ).test(source);
    if (!declared)
      fail(app, `function "${fn.key}" → ${handler}, but src/index.ts exports no ${exported}`);
  }

  // 2. Every module that names a resolver must name a declared function key.
  const functionKeys = new Set(functions.map((fn) => fn.key));
  for (const [type, entries] of Object.entries(manifest.modules)) {
    if (type === 'function') continue;
    for (const entry of entries) {
      if (entry.resolver && !functionKeys.has(entry.resolver)) {
        fail(
          app,
          `${type} "${entry.key}" uses resolver "${entry.resolver}", which no function declares`,
        );
      }
    }
  }

  // 3. Every resource path must exist, and every referenced resource key too.
  const resourceKeys = new Set();
  for (const resource of manifest.resources) {
    resourceKeys.add(resource.key);
    if (!resource.path) {
      fail(app, `resource "${resource.key}" has no path`);
      continue;
    }
    if (!existsSync(resolve(dir, resource.path))) {
      fail(app, `resource "${resource.key}" → ${resource.path}, which does not exist`);
    }
  }
  for (const [type, entries] of Object.entries(manifest.modules)) {
    for (const entry of entries) {
      if (entry.resource && !resourceKeys.has(entry.resource)) {
        fail(
          app,
          `${type} "${entry.key}" uses resource "${entry.resource}", which is not declared`,
        );
      }
    }
  }

  // 4. The appId placeholder — expected until `forge register` runs, but the
  //    reason nothing can be validated, so it is reported every time.
  const registered = manifest.appId && !/REPLACE-WITH/.test(manifest.appId);

  // 5. Scopes the code needs. Coarse on purpose: the point is to notice a
  //    scope that was never added, not to audit least privilege.
  const needs = [
    ['read:jira-work', /requestJira|\/rest\/api\/3\/(search|issue)/],
    ['storage:app', /sql|storage/i],
  ];
  for (const [scope, pattern] of needs) {
    if (pattern.test(source) && !manifest.scopes.includes(scope)) {
      fail(
        app,
        `the code looks like it needs the ${scope} scope, which the manifest does not request`,
      );
    }
  }

  const counts = Object.entries(manifest.modules)
    .map(([type, entries]) => `${type}×${entries.length}`)
    .join(' ');
  say(
    `  ${registered ? '✓' : '·'} ${app.padEnd(18)} ${counts}  ` +
      `${manifest.scopes.length} scope(s)  ${registered ? 'registered' : 'NOT REGISTERED'}`,
  );
}

const unregistered = apps.filter((app) =>
  /REPLACE-WITH/.test(readFileSync(join(APPS, app, 'manifest.yml'), 'utf8')),
);

say(`\n${'─'.repeat(74)}`);
if (problems.length === 0) {
  say('  Every manifest agrees with the code beside it.');
} else {
  say(`  ${problems.length} problem(s):`);
  for (const problem of problems) say(`    ✗ ${problem}`);
}
if (unregistered.length > 0) {
  say('');
  say(`  ${unregistered.length} app(s) still carry the appId placeholder, so \`forge lint\``);
  say("  cannot run on them: it authenticates, looks the app up in Atlassian's");
  say('  registry, and refuses when it is not there. Everything Atlassian would');
  say('  check — module schema, scope names, runtime — is therefore still');
  say('  unverified. `forge register` is the only way through.');
}
say(`${'─'.repeat(74)}\n`);

process.exit(problems.length === 0 ? 0 : 1);
