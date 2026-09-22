import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

/**
 * Screenshot every screen in every state, and audit each one with axe.
 *
 * `pnpm run ui:screens` runs this. It is the only way anybody can look at this
 * product before it is deployed, which — for a repository where nothing has
 * ever run on Forge — is worth a script.
 *
 * Three things happen per screen:
 *
 * 1. it is rendered in real Chromium, with the real Atlassian Design System
 *    stylesheet and design tokens loaded, at the viewport the Forge module
 *    actually gets;
 * 2. a full-page PNG is written to `packages/ui-harness/screens/`;
 * 3. **axe-core runs with layout available**, so the `color-contrast` rules
 *    that jsdom cannot evaluate are checked here. The script exits non-zero on
 *    any WCAG 2.1 AA violation, and on any console error or page exception.
 *
 * Playwright is pinned to an exact version rather than a range: the browser
 * download is the thing that breaks, and newer releases have already dropped
 * support for older macOS. Raise the pin deliberately when the dependency
 * audit asks for it.
 *
 * ⚠️ These are not screenshots of the deployed app. `@forge/react`'s UI Kit 2
 * exports are sentinels serialised over the bridge and the renderer that turns
 * them into markup ships inside Jira; `../src/forge-host.tsx` is a stand-in
 * for it. Structure, copy, state and data are real. Pixel-for-pixel fidelity
 * with Forge is unverified and cannot be verified here.
 */

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'screens');
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const SCENARIOS = [
  { id: 'populated', label: 'Populated', note: 'Four issues, indexing complete.' },
  {
    id: 'partial',
    label: 'Backfill running',
    note: 'Half the issues indexed. Numbers must be labelled partial.',
  },
  { id: 'empty', label: 'Empty', note: 'Indexed, nothing to report.' },
  { id: 'not-indexed', label: 'Never indexed', note: 'Freshly installed.' },
  { id: 'error', label: 'Refused', note: 'Caller cannot browse the project.' },
  { id: 'loading', label: 'Loading', note: 'Resolver has not answered yet.' },
];

/**
 * Kept in step with `harness/screens.tsx`.
 *
 * The registry is TSX and this script is plain Node, so it cannot be imported
 * here. `assertScreenListIsCurrent` reads the source instead and fails loudly
 * if a screen was added there and not here — a silently missing screenshot is
 * exactly the failure this script exists to prevent.
 */
const SCREENS = [
  { id: 'time-in-status-panel', listing: 'Time in Status', surface: 'panel' },
  { id: 'time-in-status-admin', listing: 'Time in Status', surface: 'admin' },
  { id: 'worklog-reports-admin', listing: 'Worklog Reports', surface: 'admin' },
  { id: 'wip-aging-admin', listing: 'WIP Aging', surface: 'admin' },
  { id: 'sla-breach-admin', listing: 'SLA & Due Dates', surface: 'admin' },
  { id: 'issue-history-admin', listing: 'Issue History', surface: 'admin' },
  { id: 'time-in-status-page', listing: 'Time in Status', surface: 'page' },
  { id: 'time-in-status-gadget', listing: 'Time in Status', surface: 'gadget' },
  { id: 'worklog-reports-page', listing: 'Worklog Reports', surface: 'page' },
  { id: 'worklog-reports-gadget', listing: 'Worklog Reports', surface: 'gadget' },
  { id: 'wip-aging-page', listing: 'WIP Aging', surface: 'page' },
  { id: 'wip-aging-gadget', listing: 'WIP Aging', surface: 'gadget' },
  { id: 'sla-breach-page', listing: 'SLA & Due Dates', surface: 'page' },
  { id: 'sla-breach-gadget', listing: 'SLA & Due Dates', surface: 'gadget' },
  { id: 'issue-history-page', listing: 'Issue History', surface: 'page' },
  { id: 'issue-history-gadget', listing: 'Issue History', surface: 'gadget' },
];

const VIEWPORT = {
  page: { width: 1280, height: 900 },
  gadget: { width: 520, height: 420 },
  // An issueActivity tab renders inside the issue view's Activity panel:
  // narrower than a project page, taller than a gadget.
  panel: { width: 880, height: 900 },
  admin: { width: 1280, height: 700 },
};

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

function log(line) {
  process.stdout.write(`${line}\n`);
}

function assertScreenListIsCurrent() {
  const registry = readFileSync(join(HERE, '..', 'harness', 'screens.tsx'), 'utf8');
  const declared = [...registry.matchAll(/^\s*id: '([a-z0-9-]+)',$/gm)].map((m) => m[1]);
  const known = new Set(SCREENS.map((screen) => screen.id));
  const missing = declared.filter((id) => !known.has(id));
  const extra = SCREENS.map((s) => s.id).filter((id) => !declared.includes(id));
  if (declared.length === 0) throw new Error('could not read any screen ids from screens.tsx');
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `screens.mjs is out of step with harness/screens.tsx — missing: ${missing.join(', ') || 'none'}; unknown: ${extra.join(', ') || 'none'}`,
    );
  }
}

async function main() {
  assertScreenListIsCurrent();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const server = await createServer({
    configFile: join(HERE, '..', 'harness', 'vite.config.mts'),
    logLevel: 'warn',
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  log(`harness at ${base}`);

  const browser = await chromium.launch();
  const results = [];
  let failures = 0;

  for (const screen of SCREENS) {
    for (const scenario of SCENARIOS) {
      const name = `${screen.id}--${scenario.id}`;
      const context = await browser.newContext({
        viewport: VIEWPORT[screen.surface],
        deviceScaleFactor: 2,
        colorScheme: 'light',
      });
      const page = await context.newPage();
      const problems = [];
      page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`console: ${message.text()}`);
      });
      page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

      await page.goto(`${base}/?screen=${screen.id}&scenario=${scenario.id}`, {
        waitUntil: 'load',
      });
      await page.waitForSelector('body[data-harness-ready="true"]', { timeout: 15_000 });

      const file = `${name}.png`;
      await page.screenshot({ path: join(OUT, file), fullPage: true });

      // axe with real layout: this is where `color-contrast` is meaningful.
      await page.addScriptTag({ content: AXE_SOURCE });
      const violations = await page.evaluate(async (tags) => {
        const run = await window.axe.run(document, {
          runOnly: { type: 'tag', values: tags },
          resultTypes: ['violations'],
        });
        return run.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.slice(0, 3).map((n) => n.html),
        }));
      }, WCAG_TAGS);

      await context.close();

      if (violations.length > 0) {
        failures += 1;
        log(`✗ ${name}: ${violations.length} accessibility violation(s)`);
        for (const violation of violations) {
          log(`    ${violation.id} (${violation.impact}): ${violation.help}`);
          for (const node of violation.nodes) log(`      ${node}`);
        }
      }
      if (problems.length > 0) {
        failures += 1;
        log(`✗ ${name}: ${problems.length} page problem(s)`);
        for (const problem of problems) log(`    ${problem}`);
      }
      if (violations.length === 0 && problems.length === 0) log(`✓ ${name}`);

      results.push({ screen, scenario, file, violations, problems });
    }
  }

  await browser.close();
  await server.close();

  writeFileSync(join(OUT, 'index.html'), indexPage(results), 'utf8');
  log(`\n${results.length} screens written to ${OUT}`);
  log(`open ${join(OUT, 'index.html')}`);

  if (failures > 0) {
    log(`\n${failures} screen(s) failed their audit.`);
    process.exitCode = 1;
  }
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
}

function indexPage(results) {
  const byListing = new Map();
  for (const result of results) {
    const key = result.screen.listing;
    if (!byListing.has(key)) byListing.set(key, []);
    byListing.get(key).push(result);
  }
  const sections = [...byListing.entries()]
    .map(
      ([listing, rows]) => `
      <h2>${escapeHtml(listing)}</h2>
      <div class="grid">
        ${rows
          .map(
            (row) => `
          <figure>
            <a href="${escapeHtml(row.file)}"><img src="${escapeHtml(row.file)}" alt="${escapeHtml(
              `${row.screen.listing} ${row.screen.surface}, ${row.scenario.label}`,
            )}" loading="lazy" /></a>
            <figcaption>
              <strong>${escapeHtml(row.screen.surface)} · ${escapeHtml(row.scenario.label)}</strong>
              <span>${escapeHtml(row.scenario.note)}</span>
              <span class="${row.violations.length === 0 && row.problems.length === 0 ? 'ok' : 'bad'}">
                ${
                  row.violations.length === 0 && row.problems.length === 0
                    ? 'axe WCAG 2.1 AA: clean'
                    : `${row.violations.length} violation(s), ${row.problems.length} page problem(s)`
                }
              </span>
            </figcaption>
          </figure>`,
          )
          .join('')}
      </div>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>jira-flow-metrics — screens</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         margin: 0 auto; max-width: 1200px; padding: 32px 24px 64px; }
  h1 { margin-bottom: 4px; }
  .warn { border-left: 4px solid #d97008; background: #fff7e6; color: #3b2a10;
          padding: 12px 16px; margin: 16px 0 32px; }
  .grid { display: grid; gap: 24px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
  figure { margin: 0; border: 1px solid #dcdfe4; border-radius: 8px; overflow: hidden; background: #fff; }
  img { display: block; width: 100%; height: auto; border-bottom: 1px solid #dcdfe4; }
  figcaption { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; font-size: 13px; color: #44546f; }
  .ok { color: #216e4e; } .bad { color: #ae2e24; font-weight: 600; }
</style>
</head>
<body>
<h1>jira-flow-metrics — every screen, every state</h1>
<p>Generated by <code>pnpm run ui:screens</code>.</p>
<div class="warn">
  <strong>These are not screenshots of the deployed app.</strong>
  <code>@forge/react</code>'s UI Kit 2 exports are sentinels serialised over the Forge bridge, and
  the renderer that turns them into markup ships inside Jira. These pages were rendered through a
  stand-in for it (<code>packages/ui-harness/src/forge-host.tsx</code>) using the same Atlassian
  Design System components. Structure, copy, state and data are real — every number came from the
  real ingestion pipeline over recorded Jira payloads. Pixel fidelity with Forge is unverified,
  and nothing here has run on an Atlassian tenant.
</div>
${sections}
</body>
</html>
`;
}

await main();
