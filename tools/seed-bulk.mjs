/**
 * Bulk-seed a Jira Cloud developer site with a large, randomized backlog.
 *
 * `seed-dev-site.mjs` exists to produce a hand-checkable table (RUNBOOK item
 * 9): ten fixed scenarios, one issue each, correctness over volume. This
 * script is the opposite tool — it exists to answer "what does the product
 * look like, and does it still work, under real load?" — pagination through
 * hundreds of issues, backfill slicing across many pages, gadget render time.
 * It draws issues from the same kind of status-re-entry shapes but weighted
 * and randomized (`seed-bulk-scenarios.mjs`), and keeps no per-issue
 * correctness expectation because none is checked by hand at this scale.
 *
 * Seeds into its own project (default `JFMB`) and its own state file
 * (`tools/.seed-bulk-state.json`) so it never shares bookkeeping with the
 * hand-check scenarios, and `--reset` can delete exactly what this tool
 * created without touching anything else.
 *
 * ## Usage
 *
 *   cp .env.example .env                        # then fill in the three JIRA_* values
 *   pnpm run seed:bulk -- --dry-run --target 500      # print the plan, touch nothing
 *   pnpm run seed:bulk -- --target 500 --batch 100    # create up to 100 more issues
 *   # ...repeat until the target is reached; re-running tops up, never duplicates...
 *   pnpm run seed:bulk -- --target 500 --batch 100
 *
 * `--help` lists every flag.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demonstratesReEntry, matchRole, rolesFromStatuses } from './seed-scenarios.mjs';
import { randomIssuePlan, WEIGHTED_SHAPES } from './seed-bulk-scenarios.mjs';
import {
  Jira,
  loadDotEnv,
  isoDaysFromNow,
  resolveProject as resolveProjectIn,
  pickIssueType as pickIssueTypeOf,
  discoverRoles as discoverRolesOf,
  transitionTo as transitionToRole,
  logWork as logWorkOn,
} from './jira-seed-lib.mjs';

const say = (line = '') => process.stdout.write(`${line}\n`);
const sayErr = (line = '') => process.stderr.write(`${line}\n`);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const STATE_FILE = join(HERE, '.seed-bulk-state.json');
const REPORT_FILE = join(HERE, 'seed-bulk-report.md');
const SEED_LABEL = 'jfm-bulk-seed';
const DEFAULT_PROJECT_KEY = 'JFMB';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

class UsageError extends Error {}

function die(message) {
  sayErr(`\n✖ ${message}\n`);
  process.exit(1);
}

export function parseArgs(argv) {
  const args = {
    target: 100,
    batch: null,
    project: null,
    concurrency: 4,
    seed: null,
    dryRun: false,
    reset: false,
    help: false,
  };

  const valueFor = (flag, raw) => {
    if (raw === undefined || raw.startsWith('--')) throw new UsageError(`${flag} needs a value`);
    return raw;
  };
  const intFor = (flag, raw, { min = 1 } = {}) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min)
      throw new UsageError(`${flag} must be an integer ≥ ${min} (got ${raw})`);
    return n;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue; // pnpm forwards the separator; ignore it
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--reset') args.reset = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--target') args.target = intFor('--target', valueFor('--target', argv[++i]));
    else if (arg.startsWith('--target='))
      args.target = intFor('--target', arg.slice('--target='.length));
    else if (arg === '--batch') args.batch = intFor('--batch', valueFor('--batch', argv[++i]));
    else if (arg.startsWith('--batch='))
      args.batch = intFor('--batch', arg.slice('--batch='.length));
    else if (arg === '--project') args.project = valueFor('--project', argv[++i]);
    else if (arg.startsWith('--project=')) args.project = arg.slice('--project='.length);
    else if (arg === '--concurrency')
      args.concurrency = intFor('--concurrency', valueFor('--concurrency', argv[++i]));
    else if (arg.startsWith('--concurrency='))
      args.concurrency = intFor('--concurrency', arg.slice('--concurrency='.length));
    else if (arg === '--seed')
      args.seed = intFor('--seed', valueFor('--seed', argv[++i]), { min: 0 });
    else if (arg.startsWith('--seed='))
      args.seed = intFor('--seed', arg.slice('--seed='.length), { min: 0 });
    else throw new UsageError(`Unknown argument: ${arg}`);
  }
  return args;
}

const USAGE = `
Bulk-seed a Jira Cloud developer site with a large, randomized backlog — for
load-testing pagination, backfill slicing and gadget rendering, not for the
hand-check table (that's seed:dev-site).

  pnpm run seed:bulk -- [options]

Options:
  --target N         Total issues this project should hold when done.
                     Default: 100. Re-running tops up to the target rather
                     than adding N more each time.
  --batch N          Cap on how many NEW issues this invocation creates, even
                     if the target is further away. Default: no cap (creates
                     until the target is reached). Use this to seed in
                     batches and check the UI in between.
  --project KEY      Project to seed. Default: JFMB, created if absent.
  --concurrency N    How many issues to walk at once. Default: 4. Higher is
                     faster but leans harder on the site's rate limit; the
                     client already retries 429s with backoff either way.
  --seed N           Seed the random plan generator for a reproducible run.
                     Default: unseeded (a different mix each time).
  --dry-run          Print the plan. Makes no writes of any kind.
  --reset            Delete every issue this tool recorded creating and clear
                     the state file. Only ever touches recorded keys.
  --help, -h         This text.

Credentials come from .env (see .env.example): JIRA_BASE_URL, JIRA_EMAIL and
JIRA_API_TOKEN.
`.trim();

// ---------------------------------------------------------------------------
// A tiny seedable PRNG, so --seed is reproducible without a dependency.
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function loadState() {
  if (!existsSync(STATE_FILE)) return { issues: {} };
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}

function saveState(state) {
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Delete the issues this tool created, and forget them.
 *
 * Only touches keys recorded in `tools/.seed-bulk-state.json` — never a JQL
 * search, never the project itself — for the same reason `seed-dev-site.mjs`
 * does it this way: a label query is one typo away from someone's real work.
 */
async function reset(jira, state) {
  const keys = Object.keys(state.issues ?? {});
  if (keys.length === 0) {
    say('  · nothing recorded in the state file; nothing to delete');
    return;
  }
  say(`  ${jira.dryRun ? 'Would delete' : 'Deleting'} ${keys.length} previously seeded issue(s)`);
  let done = 0;
  // Keys whose deletion did not actually happen — see the save below. This
  // script's default target is thousands of issues, so getting it wrong here
  // orphans a whole seeded project at once.
  const remaining = {};
  for (const key of keys) {
    try {
      await jira.del(`/rest/api/3/issue/${key}?deleteSubtasks=true`);
    } catch (error) {
      const message = String(error.message).split('\n')[0];
      // ★ Anchored on the status position, not a bare word boundary.
      //
      // `jira-seed-lib` formats the message as `DELETE <path> → <status>`,
      // and the path contains the issue key — so `/\b404\b/` matched
      // `DELETE /rest/api/3/issue/FLOW-404?… → 401`, forgetting the one
      // issue whose key happens to end in -404 while every other 401 was
      // correctly kept. A bulk seed of thousands produces such a key with
      // near certainty, so the fix against orphaning orphaned one issue per
      // project. It also matched the "gave up after 5 attempts" message,
      // where the issue certainly still exists.
      if (!/→ 404\b/.test(message)) remaining[key] = state.issues[key];
      say(`      ⤳ ${key}: ${message}`);
    }
    done += 1;
    if (done % 25 === 0 || done === keys.length) say(`      ${done}/${keys.length}`);
  }
  if (jira.dryRun) {
    say('  · [dry-run] state file left untouched');
    return;
  }
  // ★ Keep the keys that were not deleted — see `seed-dev-site.mjs`'s reset
  // for the failure this prevents.
  saveState({ ...state, issues: remaining });
  const left = Object.keys(remaining).length;
  say(
    left === 0
      ? '  · state file cleared'
      : `  · ${left} issue(s) could not be deleted and are still recorded — fix the error above and re-run`,
  );
}

// ---------------------------------------------------------------------------
// Creating and walking one issue
// ---------------------------------------------------------------------------

async function createIssue(jira, { projectKey, issueType, plan, index }) {
  const fields = {
    project: { key: projectKey },
    issuetype: { name: issueType },
    summary: `${plan.summary}`,
    labels: [SEED_LABEL, `jfm-bulk-${plan.shapeId}`],
    duedate: isoDaysFromNow(plan.dueDateOffsetDays),
  };
  const created = await jira.post('/rest/api/3/issue', { fields });
  return created.key ?? `${projectKey}-DRYRUN-${index}`;
}

async function walkIssue(jira, issueKey, plan, statusNames, simulated) {
  const executed = ['TODO'];
  const skipped = [];
  for (const role of plan.path.slice(1)) {
    const reached = await transitionToRole(jira, issueKey, role, simulated, matchRole);
    if (reached === null) {
      skipped.push(role);
      continue;
    }
    statusNames[role] = reached;
    executed.push(role);
  }
  if (plan.worklogHours.length > 0) {
    await logWorkOn(jira, issueKey, plan.worklogHours, 'tools/seed-bulk.mjs');
  }
  return { executed, skipped };
}

/** A tiny concurrency-limited map, so N issues can be walked at once. */
async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function writeReport(state, baseUrl) {
  const records = Object.values(state.issues);
  const byShape = new Map();
  for (const r of records) byShape.set(r.shapeId, (byShape.get(r.shapeId) ?? 0) + 1);
  const reEntered = records.filter((r) => demonstratesReEntry(r.executed)).length;

  const lines = [
    '# Bulk-seeded data — a volume test, not a hand-check',
    '',
    'Generated by `pnpm run seed:bulk`. Unlike `tools/seed-report.md`, there is no',
    'per-issue expectation here — at this scale nobody checks each one by hand. This',
    'exists to describe the shape of the load: how many issues, how they are',
    'distributed across scenarios, and how many actually demonstrate a re-entered',
    'status (the thing pagination and backfill slicing need to be exercised against).',
    '',
    `Site: ${baseUrl}`,
    `Project: ${state.projectKey}`,
    '',
    `- **${records.length}** issues seeded, of which **${reEntered}** re-enter at least one status`,
    '',
    '| Shape | Count |',
    '| ----- | ----: |',
    ...[...byShape.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([shapeId, count]) => `| ${shapeId} | ${count} |`),
    '',
  ];
  writeFileSync(REPORT_FILE, `${lines.join('\n')}\n`);
  return REPORT_FILE;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadDotEnv(ROOT);
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    say(USAGE);
    return;
  }

  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !token) {
    die(
      'Missing credentials. Copy `.env.example` to `.env` and fill in:\n' +
        '  JIRA_BASE_URL   https://your-site.atlassian.net\n' +
        '  JIRA_EMAIL      the Atlassian account email\n' +
        '  JIRA_API_TOKEN  from id.atlassian.com/manage-profile/security/api-tokens',
    );
  }

  const state = loadState();
  const recordedIssues = Object.keys(state.issues ?? {}).length;
  if (recordedIssues > 0 && state.baseUrl && state.baseUrl !== baseUrl) {
    die(
      `${STATE_FILE} records ${recordedIssues} issue(s) on ${state.baseUrl}, but JIRA_BASE_URL ` +
        `is ${baseUrl}. Point .env back at ${state.baseUrl}, or move the state file aside.`,
    );
  }

  const jira = new Jira({ baseUrl, email, token, dryRun: args.dryRun });
  say(`\nBulk-seeding ${baseUrl}${args.dryRun ? '  (dry run — nothing will be written)' : ''}`);

  const project = await resolveProjectIn(jira, args.project, {
    defaultKey: DEFAULT_PROJECT_KEY,
    name: 'Flow Metrics Bulk Seed',
    die,
  });
  const issueType = pickIssueTypeOf(project, die);
  say(`  ✓ issue type: ${issueType}`);

  if (recordedIssues > 0 && state.projectKey && state.projectKey !== project.key) {
    die(
      `${STATE_FILE} records ${recordedIssues} issue(s) in project ${state.projectKey}, but this ` +
        `run targets ${project.key}. Re-run with --project=${state.projectKey}, or move the state ` +
        `file aside.`,
    );
  }
  state.baseUrl = baseUrl;
  state.projectKey = project.key;

  if (args.reset) {
    await reset(jira, state);
    say(args.dryRun ? '\nDry run complete — nothing was deleted.\n' : '\nReset complete.\n');
    return;
  }

  const discovered = await discoverRolesOf(jira, project.key, rolesFromStatuses);
  const availableRoles = discovered
    ? new Set(discovered.keys())
    : new Set(['TODO', 'IN_PROGRESS', 'DONE']);
  say(`  · workflow offers: ${[...availableRoles].join(', ')}`);
  const simulated = args.dryRun ? { names: discovered } : null;

  const already = recordedIssues;
  const remainingToTarget = Math.max(0, args.target - already);
  const toCreate =
    args.batch === null ? remainingToTarget : Math.min(args.batch, remainingToTarget);
  say(`  · ${already} already seeded, target ${args.target} → creating ${toCreate} this run\n`);

  if (toCreate === 0) {
    say('Nothing to do — target already reached. Raise --target to add more.\n');
    return;
  }

  const rng = args.seed === null ? Math.random : mulberry32(args.seed);
  const plans = Array.from({ length: toCreate }, () => randomIssuePlan(rng, availableRoles));

  let created = 0;
  await mapWithConcurrency(plans, args.concurrency, async (plan, index) => {
    const issueKey = await createIssue(jira, { projectKey: project.key, issueType, plan, index });
    const statusNames = { TODO: 'To Do' };
    const { executed, skipped } = await walkIssue(jira, issueKey, plan, statusNames, simulated);
    state.issues[issueKey] = { shapeId: plan.shapeId, executed, statusNames, skipped };
    created += 1;
    if (created % 10 === 0 || created === plans.length) {
      say(`  [${created}/${plans.length}] ${issueKey}  ${plan.shapeId}`);
      if (!args.dryRun) saveState(state);
    }
  });

  if (args.dryRun) {
    const byShape = new Map();
    for (const plan of plans) byShape.set(plan.shapeId, (byShape.get(plan.shapeId) ?? 0) + 1);
    say(`\n${'─'.repeat(72)}`);
    say(`  Would create ${plans.length} issue(s) in ${project.key}:\n`);
    for (const [shapeId, count] of [...byShape.entries()].sort((a, b) => b[1] - a[1])) {
      say(`    ${shapeId.padEnd(20)} ${count}`);
    }
    say(`${'─'.repeat(72)}`);
    say('\nDry run complete — nothing was written.\n');
    return;
  }

  saveState(state);
  const report = writeReport(state, baseUrl);
  say(`\n${'─'.repeat(72)}`);
  say(`  ${Object.keys(state.issues).length}/${args.target} issues seeded in ${project.key}`);
  say(`  ${jira.calls} Jira API calls this run`);
  say(`  Report: ${report}`);
  say(`${'─'.repeat(72)}\n`);
}

const invokedAsScript =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch((error) =>
    die(error instanceof UsageError ? error.message : (error.stack ?? String(error))),
  );
}

export { WEIGHTED_SHAPES };
