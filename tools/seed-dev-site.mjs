/**
 * Seed a free Jira Cloud developer site with issues that re-enter statuses.
 *
 * `docs/START-HERE.md` § 2 says it plainly: a project with five freshly created
 * issues proves nothing, because the product's entire claim is about *re-entered*
 * statuses. This script creates the history that claim needs, and — the part
 * that matters more — prints the table the first tunnel session checks the
 * product against, **before** anybody opens the app.
 *
 * ## The one thing this cannot do
 *
 * Jira stamps every changelog entry with the server's own clock, and the REST
 * API offers no way to backdate one. So a full path executed in a single run
 * produces a real *shape* — the visits, the returns, the ordering — with
 * durations measured in seconds rather than days. Three consequences:
 *
 * 1. **RUNBOOK item 9 still works.** It compares the app against Jira's own
 *    Control Chart, and both read the same changelog. Seconds compare exactly
 *    as well as days, and the re-entry arithmetic is what is under test.
 * 2. **Working-hours arithmetic is not exercised** by a single run. Every visit
 *    lands inside one business day, so the calendar code never crosses a
 *    weekend or a DST boundary. That path is covered by
 *    `packages/engine/test/calendar.golden.test.ts` against a hand-computed
 *    golden file; the tunnel session is not where it gets verified.
 * 3. **WIP aging needs elapsed time**, because an issue's age starts at its
 *    creation. Run `--phase 1` today and `--phase 2` in a day or two and the
 *    gap between two visits of the same status spans real days.
 *
 * Worklogs and due dates are exempt: both accept an explicit date, so the
 * worklog and SLA listings get realistic data from a single run.
 *
 * ## Usage
 *
 *   cp .env.example .env      # then fill in the three JIRA_* values
 *   pnpm run seed:dev-site -- --dry-run     # print the plan, touch nothing
 *   pnpm run seed:dev-site -- --phase 1
 *   # ...wait a day or two...
 *   pnpm run seed:dev-site -- --phase 2
 *
 * `--phase all` does the whole walk in one run, accepting compressed durations.
 * Re-running a phase is safe: state is kept in `tools/.seed-state.json` and
 * issues already walked are skipped.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCENARIOS,
  demonstratesReEntry,
  expectationsFor,
  matchRole,
  missingRolesFor,
  rolesFromStatuses,
  splitPhases,
} from './seed-scenarios.mjs';

/**
 * Scripts in this repository write to the stream directly rather than through
 * `console` — see `packages/ui-harness/scripts/screens.mjs`. The lint rule
 * that forbids `console.log` is what keeps stray debugging out of the
 * packages, and a dev script is not a reason to relax it.
 */
const say = (line = '') => process.stdout.write(`${line}\n`);
const sayErr = (line = '') => process.stderr.write(`${line}\n`);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const STATE_FILE = join(HERE, '.seed-state.json');
const REPORT_FILE = join(HERE, 'seed-report.md');
const SEED_LABEL = 'jfm-seed';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Minimal `.env` reader. A dependency for this would be absurd. */
function loadDotEnv() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

export function parseArgs(argv) {
  const args = { phase: 'all', dryRun: false, project: null, dwellSeconds: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    // `pnpm run seed:dev-site -- --dry-run` forwards the separator itself,
    // unlike npm, which swallows it. The documented command therefore arrives
    // here as `['--', '--dry-run']`, and dying on it made every usage example
    // in START-HERE.md fail. Ignore it instead.
    if (arg === '--') continue;
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--phase') args.phase = argv[++i];
    else if (arg.startsWith('--phase=')) args.phase = arg.slice('--phase='.length);
    else if (arg === '--project') args.project = argv[++i];
    else if (arg.startsWith('--project=')) args.project = arg.slice('--project='.length);
    else if (arg.startsWith('--dwell=')) args.dwellSeconds = Number(arg.slice('--dwell='.length));
    else if (arg === '--reset') args.reset = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else die(`Unknown argument: ${arg}`);
  }
  if (!['1', '2', 'all'].includes(args.phase))
    die(`--phase must be 1, 2 or all (got ${args.phase})`);
  return args;
}

function die(message) {
  sayErr(`\n✖ ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Jira REST
// ---------------------------------------------------------------------------

class Jira {
  constructor({ baseUrl, email, token, dryRun }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
    this.dryRun = dryRun;
    this.calls = 0;
  }

  async request(method, path, body) {
    if (this.dryRun && method !== 'GET') {
      say(`      · [dry-run] ${method} ${path}`);
      return { dryRun: true };
    }
    const url = `${this.baseUrl}${path}`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      this.calls += 1;
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: this.auth,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

      // 429 is the one a real backfill will meet too, so honour Retry-After
      // rather than hammering. 5xx gets the same treatment on the assumption
      // it is transient; a 4xx never is, and is reported immediately.
      if (response.status === 429 || response.status >= 500) {
        const wait = Number(response.headers.get('retry-after') ?? 2 ** attempt) * 1000;
        say(`      · ${response.status}; retrying in ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`${method} ${path} → ${response.status}\n${text.slice(0, 600)}`);
      }
      return text ? JSON.parse(text) : {};
    }
    throw new Error(`${method} ${path} — gave up after 5 attempts`);
  }

  get = (path) => this.request('GET', path);
  post = (path, body) => this.request('POST', path, body);
  del = (path) => this.request('DELETE', path);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Setup: project and issue type
// ---------------------------------------------------------------------------

async function resolveProject(jira, requestedKey) {
  const key = requestedKey ?? 'JFM';
  try {
    const project = await jira.get(`/rest/api/3/project/${key}`);
    say(`  ✓ using existing project ${key} — ${project.name}`);
    return project;
  } catch {
    say(`  · project ${key} not found; creating it`);
  }

  const me = await jira.get('/rest/api/3/myself');
  try {
    await jira.post('/rest/api/3/project', {
      key,
      name: 'Flow Metrics Seed',
      projectTypeKey: 'software',
      projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-agility-kanban',
      leadAccountId: me.accountId,
    });
  } catch (error) {
    // Project creation is the step most likely to be refused — permissions,
    // a template the site does not have, a key already taken on another
    // project. None of it is worth guessing at; creating a project by hand
    // takes a minute and the rest of the script does not care how it appeared.
    die(
      `Could not create project ${key}:\n${error.message}\n\n` +
        `Create a Kanban software project in the Jira UI, then re-run with --project=<KEY>.`,
    );
  }
  if (jira.dryRun) {
    return {
      key,
      name: 'Flow Metrics Seed',
      issueTypes: [{ name: 'Task', subtask: false, hierarchyLevel: 0 }],
    };
  }
  say(`  ✓ created project ${key}`);
  return jira.get(`/rest/api/3/project/${key}`);
}

/**
 * Pick a standard issue type.
 *
 * `hierarchyLevel === 0` is the selector, not the name: level 1 is Epic and
 * level -1 is Subtask, and both have workflows and semantics a seeded issue
 * should not inherit. Matching on the name "Task" was tried first and picked
 * **Epic** on a Russian site, where the standard type is called "Задача" and
 * the English list matched nothing, leaving the first entry to win by default.
 */
function pickIssueType(project) {
  const standard = (project.issueTypes ?? []).filter((t) => !t.subtask && t.hierarchyLevel === 0);
  if (standard.length === 0) {
    die('The project exposes no standard (hierarchy level 0) issue types.');
  }
  const preferred = ['task', 'задача', 'story', 'история'];
  const found = standard.find((t) => preferred.includes(String(t.name).toLowerCase()));
  return (found ?? standard[0]).name;
}

// ---------------------------------------------------------------------------
// Walking an issue through its path
// ---------------------------------------------------------------------------

/**
 * Which roles this project's workflow can actually reach, as `role -> status name`.
 *
 * Only needed for the dry run. A real run discovers transitions per issue from
 * its current status, which is both more accurate and the only thing Jira will
 * act on; this is a whole-project approximation so `--dry-run` can say which
 * steps it would have to skip without creating an issue to ask about.
 */
async function discoverRoles(jira, projectKey) {
  try {
    const perType = await jira.get(`/rest/api/3/project/${projectKey}/statuses`);
    const seen = new Map();
    for (const type of perType) {
      for (const status of type.statuses ?? []) seen.set(status.name, status);
    }
    return rolesFromStatuses([...seen.values()]);
  } catch {
    // The project does not exist yet, so its workflow cannot be inspected.
    return null;
  }
}

/**
 * Move an issue to a role, returning the status name reached or null.
 *
 * `simulated` is set only under `--dry-run`, where no issue exists to ask
 * about: the answer comes from the project-wide status list instead. A null
 * `simulated.names` means even that was unavailable, so the walk is reported
 * against the statuses a default Jira template ships with.
 */
async function transitionTo(jira, issueKey, role, simulated) {
  if (simulated) {
    const names = simulated.names ?? DEFAULT_TEMPLATE_STATUSES;
    return names.get(role) ?? null;
  }
  const { transitions = [] } = await jira.get(`/rest/api/3/issue/${issueKey}/transitions`);
  const match = transitions.find((t) => matchRole(t.to?.name) === role);
  if (!match) return null;
  await jira.post(`/rest/api/3/issue/${issueKey}/transitions`, { transition: { id: match.id } });
  return match.to.name;
}

/** What a simplified Jira software template gives you, and nothing more. */
const DEFAULT_TEMPLATE_STATUSES = new Map([
  ['TODO', 'To Do'],
  ['IN_PROGRESS', 'In Progress'],
  ['DONE', 'Done'],
]);

function isoDaysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Jira wants `+0000`, not the `Z` that `toISOString` produces. */
function jiraTimestamp(daysAgo, hour) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, 0, 0, 0);
  return `${date.toISOString().replace('Z', '')}+0000`;
}

async function createIssue(jira, { projectKey, issueType, scenario }) {
  const marker = demonstratesReEntry(scenario.path) ? 'RE-ENTRY' : 'CONTROL';
  const fields = {
    project: { key: projectKey },
    issuetype: { name: issueType },
    summary: `[${marker}] ${scenario.summary}`,
    labels: [SEED_LABEL, `jfm-${scenario.id}`],
  };
  if (typeof scenario.dueDateOffsetDays === 'number') {
    fields.duedate = isoDaysFromNow(scenario.dueDateOffsetDays);
  }
  const created = await jira.post('/rest/api/3/issue', { fields });
  return created.key ?? `${projectKey}-DRYRUN-${scenario.id}`;
}

async function logWork(jira, issueKey, hoursList) {
  // Worklogs accept an explicit `started`, so unlike status history these can
  // be spread across real past days from a single run.
  for (const [index, hours] of hoursList.entries()) {
    await jira.post(`/rest/api/3/issue/${issueKey}/worklog?notifyUsers=false`, {
      started: jiraTimestamp(hoursList.length - index, 9 + index),
      timeSpentSeconds: hours * 3600,
      comment: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Seeded by tools/seed-dev-site.mjs' }],
          },
        ],
      },
    });
  }
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
 * Delete the issues this seeder created, and forget them.
 *
 * Only the keys recorded in `tools/.seed-state.json` are touched — never a JQL
 * search, never the project itself. A label query would be one typo away from
 * deleting somebody's real backlog, and the state file is an exact record of
 * what this script is responsible for.
 */
async function reset(jira, state) {
  const keys = Object.keys(state.issues ?? {});
  if (keys.length === 0) {
    say('  · nothing recorded in the state file; nothing to delete');
    return;
  }
  say(`  Deleting ${keys.length} previously seeded issue(s):`);
  for (const key of keys) {
    try {
      await jira.del(`/rest/api/3/issue/${key}?deleteSubtasks=true`);
      say(`      ✓ deleted ${key}`);
    } catch (error) {
      // A 404 means somebody already removed it by hand, which is fine.
      say(`      ⤳ ${key}: ${String(error.message).split('\n')[0]}`);
    }
  }
  saveState({ ...state, issues: {} });
  say('  · state file cleared');
}

// ---------------------------------------------------------------------------
// The hand-check table — the actual deliverable
// ---------------------------------------------------------------------------

function writeReport(state, baseUrl) {
  const lines = [
    '# Seeded data — the hand-check table for RUNBOOK item 9',
    '',
    'Generated by `pnpm run seed:dev-site`. Every expectation below was computed from the',
    'transitions the seeder actually executed, **before** the app was opened.',
    '',
    "**How to use this.** For each issue, open Jira's own Control Chart (or the issue's",
    'History tab) and read the time in each status, then read the same figure in the app.',
    '',
    '- `agrees` — one visit. The two figures must match. **A disagreement here means the',
    '  engine is wrong, and RUNBOOK item 9 says stop everything.**',
    '- `app higher` — the status was re-entered. The app must show strictly more than Jira,',
    '  and the difference is the time spent in the earlier visits. This is the product.',
    '- `open` — the issue is still sitting in this status, so the figure grows between the',
    '  two readings. Compare loosely.',
    '',
    `Site: ${baseUrl}`,
    '',
    '| Issue | Scenario | Status | Visits | Expected vs Control Chart |',
    '| ----- | -------- | ------ | -----: | ------------------------- |',
  ];

  for (const [key, record] of Object.entries(state.issues)) {
    for (const row of expectationsFor(record.executed)) {
      const name = record.statusNames?.[row.role] ?? row.role;
      const verdict = row.expectation === 'agrees' ? 'agrees' : '**app higher**';
      lines.push(
        `| ${key} | ${record.scenarioId} | ${name} | ${row.visits} | ${verdict}${row.open ? ' · open' : ''} |`,
      );
    }
  }

  const skipped = Object.values(state.issues).flatMap((r) => r.skipped ?? []);
  if (skipped.length > 0) {
    lines.push(
      '',
      '## Steps the workflow could not do',
      '',
      "The site's workflow had no status matching these roles, so the seeder skipped them and",
      'the expectations above were computed without them. Adding the status to the workflow and',
      're-running would give a richer history, but nothing above is invalidated by their absence.',
      '',
      ...[...new Set(skipped)].map((role) => `- \`${role}\``),
    );
  }

  writeFileSync(REPORT_FILE, `${lines.join('\n')}\n`);
  return REPORT_FILE;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    say(readFileSync(fileURLToPath(import.meta.url), 'utf8').slice(0, 2200));
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
        '  JIRA_API_TOKEN  from id.atlassian.com/manage-profile/security/api-tokens\n\n' +
        '`.env` is git-ignored. The token is a credential — it must never be committed.',
    );
  }

  const jira = new Jira({ baseUrl, email, token, dryRun: args.dryRun });
  say(`\nSeeding ${baseUrl}${args.dryRun ? '  (dry run — nothing will be written)' : ''}`);
  say(`Phase: ${args.phase}\n`);

  const project = await resolveProject(jira, args.project);
  const issueType = pickIssueType(project);
  say(`  ✓ issue type: ${issueType}\n`);

  const discovered = await discoverRoles(jira, project.key);
  const names = discovered ?? DEFAULT_TEMPLATE_STATUSES;
  const availableRoles = new Set(names.keys());
  const simulated = args.dryRun ? { names: discovered } : null;
  say(
    discovered
      ? `  · workflow offers: ${[...discovered.values()].join(', ')}\n`
      : '  · project not created yet; assuming the default To Do / In Progress / Done\n',
  );

  const state = loadState();
  state.baseUrl = baseUrl;
  state.projectKey = project.key;

  if (args.reset) {
    await reset(jira, state);
    say('\nReset complete. Re-run without --reset to seed.\n');
    return;
  }

  const unsupported = [];
  for (const scenario of SCENARIOS) {
    const missing = missingRolesFor(scenario, availableRoles);
    if (missing.length > 0) {
      // Skipped rather than half-walked: dropping the middle status of
      // `In Progress → Blocked → In Progress` leaves one uninterrupted visit,
      // so the issue would sit in the backlog looking like a seeded re-entry
      // case while proving nothing.
      say(`  ⤳ ${scenario.id}: workflow has no ${missing.join('/')}; skipped`);
      unsupported.push(scenario.id);
      continue;
    }
    const { phase1, phase2 } = splitPhases(scenario.path);
    const existing = Object.entries(state.issues).find(([, r]) => r.scenarioId === scenario.id);

    // Phase 1 creates the issue; phase 2 resumes one that phase 1 left behind.
    let issueKey = existing?.[0];
    let record = existing?.[1];
    if (!record) {
      if (args.phase === '2') {
        say(`  ⤳ ${scenario.id}: no phase-1 issue to resume; skipping`);
        continue;
      }
      issueKey = await createIssue(jira, { projectKey: project.key, issueType, scenario });
      record = {
        scenarioId: scenario.id,
        executed: ['TODO'],
        // The status an issue is created in never comes back from a
        // transition, so its name has to be taken from the workflow here or
        // the report labels that row with the internal role name.
        statusNames: { TODO: names.get('TODO') ?? 'To Do' },
        skipped: [],
        done: [],
      };
      state.issues[issueKey] = record;
      say(`  ✓ ${issueKey}  ${scenario.summary}`);
    } else {
      say(`  ↻ ${issueKey}  ${scenario.summary}`);
    }

    // `--phase all` against an issue phase 1 already walked must *resume*, not
    // start over: replaying the whole path from the issue's current status
    // drives more re-entries than the scenario describes, so the expectation
    // table would faithfully describe a seed nobody asked for. This matters
    // most for `--dry-run`, which defaults to `all` and is the first command
    // START-HERE.md tells you to run.
    const resuming = args.phase === 'all' && record.done.includes('p1');

    // `path[0]` is the status the issue was created in, not a transition.
    const steps =
      args.phase === '1'
        ? phase1.slice(1)
        : args.phase === '2' || resuming
          ? phase2
          : scenario.path.slice(1);

    // `all` walks both halves, so it records both — otherwise a later
    // `--phase 2` would see no `p2` tag and walk the second half a second time.
    const phaseTags =
      args.phase === '1' ? ['p1'] : args.phase === '2' || resuming ? ['p2'] : ['p1', 'p2'];
    if (phaseTags.every((tag) => record.done.includes(tag))) {
      say('      · already walked; skipping');
      continue;
    }

    for (const role of steps) {
      if (args.dwellSeconds > 0) await sleep(args.dwellSeconds * 1000);
      const reached = await transitionTo(jira, issueKey, role, simulated);
      if (reached === null) {
        // Not fatal, and not silent: a missing status changes the expectation
        // table, and the table says so.
        say(`      ⤳ no transition to ${role} in this workflow — skipped`);
        record.skipped.push(role);
        continue;
      }
      record.statusNames[role] = reached;
      record.executed.push(role);
      say(`      → ${reached}`);
    }

    if (scenario.worklogHours?.length && !record.worklogged) {
      await logWork(jira, issueKey, scenario.worklogHours);
      record.worklogged = true;
      say(`      → ${scenario.worklogHours.length} worklog(s)`);
    }

    const intended = demonstratesReEntry(scenario.path);
    const achieved = demonstratesReEntry(record.executed);
    if (intended && !achieved && args.phase !== '1') {
      record.degraded = true;
      say('      ⚠ intended a re-entry but did not achieve one — this issue proves nothing');
    }

    record.done.push(...phaseTags.filter((tag) => !record.done.includes(tag)));
    if (!args.dryRun) saveState(state);
  }

  if (args.dryRun) {
    say(`\n${'─'.repeat(72)}`);
    say('  Expectations this plan would produce (RUNBOOK item 9):\n');
    for (const [key, record] of Object.entries(state.issues)) {
      for (const row of expectationsFor(record.executed)) {
        const name = record.statusNames?.[row.role] ?? row.role;
        const verdict = row.expectation === 'agrees' ? 'agrees with Jira' : 'APP HIGHER';
        say(`    ${key.padEnd(26)} ${name.padEnd(14)} ${String(row.visits)} visit(s)  ${verdict}`);
      }
    }
    const skipped = [...new Set(Object.values(state.issues).flatMap((r) => r.skipped ?? []))];
    if (skipped.length > 0) say(`\n  Steps this workflow cannot do: ${skipped.join(', ')}`);
    say(`${'─'.repeat(72)}`);
    say('\nDry run complete — nothing was written.\n');
    return;
  }

  saveState(state);
  const report = writeReport(state, baseUrl);
  const reEntered = Object.values(state.issues).filter((r) => demonstratesReEntry(r.executed));

  say(`\n${'─'.repeat(72)}`);
  say(
    `  ${Object.keys(state.issues).length} issues seeded · ${reEntered.length} with a re-entered status`,
  );
  say(`  ${jira.calls} Jira API calls`);
  say(`  Hand-check table: ${report}`);
  if (args.phase === '1') {
    say('\n  Wait a day or two, then run --phase 2 so the gap between two visits');
    say('  of the same status spans real days rather than seconds.');
  }
  say(`${'─'.repeat(72)}\n`);
}

// Guarded so `parseArgs` can be imported by a test without the module
// immediately trying to talk to somebody's Jira site.
const invokedAsScript =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) main().catch((error) => die(error.stack ?? String(error)));
