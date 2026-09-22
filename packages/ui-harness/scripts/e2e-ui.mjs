import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { callLiveResolver, resetLiveRuntimes } from '@jfm/ui-harness/live-resolvers';

/**
 * End-to-end UI tests: real components, real resolvers, real browser.
 *
 * `pnpm run e2e:ui` runs this. It is the only check in the repository that
 * exercises a **user doing something** rather than a screen rendering.
 *
 * The distinction matters here more than usual. The component suites mount a
 * frontend against a frozen snapshot of resolver responses, which is enough to
 * prove every state renders and nothing about what happens next: a saved SLA
 * goal that never comes back, an extended history window that leaves the
 * banner unchanged, an export button whose modal never opens — all of those
 * pass a snapshot test and fail a user.
 *
 * So each flow below drives the real component tree in real Chromium, and
 * every `invoke` it makes travels the real `@forge/bridge` client (argument
 * validation, rate limiter and error types included) to a **live
 * `ListingRuntime`** in this process: real engine, real store, seeded from the
 * recorded Jira fixtures, and kept alive between calls so state round-trips.
 * See `src/live-resolvers.ts`.
 *
 * Flows run in parallel, one browser context each, bounded by `LANES` —
 * unbounded, forty contexts hammering one dev server and one Node process
 * running real pipelines starved each other into 30-second timeouts that look
 * exactly like product failures. Parallel enough to be fast, bounded enough
 * that a red result means something.
 *
 * ⚠️ What this still does not prove: that Forge's own renderer draws this
 * tree, or that Atlassian's bridge reaches a deployed resolver. Only a real
 * tenant can, and `docs/RUNBOOK.md` § 3 is that checklist.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const E2E = join(HERE, '..', 'e2e');

/**
 * How many flows run at once.
 *
 * Every flow drives a real browser context against one dev server, and every
 * resolver call it makes runs a real report over a real store in this single
 * Node process. Past this the contexts spend their time waiting on each other
 * and time out on first paint — a failure indistinguishable from a broken
 * page, which is the worst kind to have in a suite.
 */
const LANES = Number(process.env['JFM_E2E_LANES'] ?? 6);

/** Run `work` over `items`, at most `limit` at a time, preserving order. */
async function mapWithLimit(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(lanes);
  return results;
}

/** `expect`, small enough to read and specific enough to debug from. */
function makeExpect(flowName) {
  return {
    equal(actual, expected, what) {
      if (actual !== expected) {
        throw new Error(
          `${flowName}: ${what}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`,
        );
      }
    },
    ok(value, what) {
      if (!value) throw new Error(`${flowName}: ${what} (got ${String(value)})`);
    },
    contains(haystack, needle, what) {
      if (!String(haystack).includes(needle)) {
        throw new Error(
          `${flowName}: ${what}\n  expected to contain: ${needle}\n  actual: ${String(haystack).slice(0, 400)}`,
        );
      }
    },
    absent(value, what) {
      if (value) throw new Error(`${flowName}: ${what} — but it was present`);
    },
  };
}

/**
 * Open one surface in live mode and wait for its first render to settle.
 *
 * Console errors and page exceptions are collected and failed on at the end of
 * the flow: a React error boundary or a rejected promise can leave a screen
 * that looks fine and is not.
 */
async function openSurface(context, base, { screen, app }) {
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/?screen=${screen}&live=${app}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body[data-harness-ready="true"]', { timeout: 30_000 });
  return { page, problems };
}

async function runFlow(browser, base, flow) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const expect = makeExpect(flow.name);
  const started = Date.now();
  try {
    const { page, problems } = await openSurface(context, base, flow);
    await flow.run({ page, expect });
    if (problems.length > 0) throw new Error(`${flow.name}: ${problems.join('; ')}`);
    return { name: flow.name, ok: true, ms: Date.now() - started };
  } catch (error) {
    return {
      name: flow.name,
      ok: false,
      ms: Date.now() - started,
      error: String(error?.message ?? error),
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const files = readdirSync(E2E)
    .filter((f) => f.endsWith('.flows.mjs'))
    .sort();
  if (files.length === 0) throw new Error(`no *.flows.mjs files in ${E2E}`);

  const flows = [];
  for (const file of files) {
    const module = await import(pathToFileURL(join(E2E, file)).href);
    for (const flow of module.flows ?? []) flows.push(flow);
  }

  const server = await createServer({
    configFile: join(HERE, '..', 'harness', 'vite.config.mts'),
    logLevel: 'warn',
    // The harness config pins port 5183 with `strictPort`, which is right for
    // `ui:screens` (a predictable URL to open by hand) and wrong here: two
    // concurrent runs — a developer's and CI's, or two agents' — kill each
    // other with "Port 5183 is already in use". Port 0 asks the OS for a free
    // one, and the runner reads the real URL back off the server anyway.
    server: { port: 0, strictPort: false },
    plugins: [
      {
        name: 'jfm-live-resolvers',
        configureServer(vite) {
          vite.middlewares.use('/__resolver', (req, res) => {
            const chunks = [];
            req.on('data', (chunk) => chunks.push(chunk));
            req.on('end', () => {
              void (async () => {
                try {
                  const { app, key, payload } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                  const result = await callLiveResolver(app, key, payload);
                  res.setHeader('content-type', 'application/json');
                  res.end(JSON.stringify(result ?? null));
                } catch (error) {
                  res.statusCode = 500;
                  res.end(String(error?.message ?? error));
                }
              })();
            });
          });
        },
      },
    ],
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  process.stdout.write(
    `harness at ${base}\nrunning ${String(flows.length)} flows, ${String(LANES)} at a time\n\n`,
  );

  // One set of runtimes per run, built lazily on first call and shared by the
  // flows — each flow asserts only on what it did, and the fixtures are the
  // same for all of them.
  resetLiveRuntimes();

  const browser = await chromium.launch();
  const results = await mapWithLimit(flows, LANES, (flow) => runFlow(browser, base, flow));
  await browser.close();
  await server.close();

  let failures = 0;
  for (const result of results) {
    if (result.ok) {
      process.stdout.write(`  ✓ ${result.name} (${String(result.ms)}ms)\n`);
    } else {
      failures += 1;
      process.stdout.write(`  ✗ ${result.name}\n      ${result.error}\n`);
    }
  }
  process.stdout.write(
    `\n${String(results.length - failures)}/${String(results.length)} flows passed\n`,
  );
  if (failures > 0) process.exitCode = 1;
}

await main();
