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
 * `--phase all` does the whole walk in one run, accepting compressed durations
 * — and resumes at phase 2 for any issue phase 1 already walked, rather than
 * starting the path over. Re-running a phase is safe: state is kept in
 * `tools/.seed-state.json` and issues already walked are skipped.
 *
 * `--help` lists every flag.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCENARIOS,
  VISIBLE_EXCESS_MS,
  excessPerRole,
  formatDuration,
  demonstratesReEntry,
  expectationsFor,
  matchRole,
  missingRolesFor,
  rolesFromStatuses,
  splitPhases,
} from './seed-scenarios.mjs';
import {
  Jira,
  sleep,
  loadDotEnv as loadDotEnvFrom,
  isoDaysFromNow,
  DEFAULT_TEMPLATE_STATUSES,
  resolveProject as resolveProjectIn,
  pickIssueType as pickIssueTypeOf,
  discoverRoles as discoverRolesOf,
  transitionTo as transitionToRole,
  logWork as logWorkOn,
  deletionMeansGone,
} from './jira-seed-lib.mjs';

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

export function parseArgs(argv) {
  const args = {
    phase: 'all',
    dryRun: false,
    project: null,
    dwellSeconds: 0,
    reset: false,
    help: false,
  };

  /**
   * Take the next argv entry as a value, refusing to swallow a flag.
   *
   * `--project --dry-run` used to set the project key to the string
   * "--dry-run" and leave `dryRun` false, so a command that looks like a
   * simulation writes to a real site. Anything starting with `--` is a
   * mistyped invocation, not a value.
   */
  const valueFor = (flag, raw) => {
    if (raw === undefined || raw.startsWith('--')) throw new UsageError(`${flag} needs a value`);
    return raw;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    // `pnpm run seed:dev-site -- --dry-run` forwards the separator itself,
    // unlike npm, which swallows it. The documented command therefore arrives
    // here as `['--', '--dry-run']`, and dying on it made every usage example
    // in START-HERE.md fail. Ignore it instead.
    if (arg === '--') continue;
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--phase') args.phase = valueFor('--phase', argv[++i]);
    else if (arg.startsWith('--phase=')) args.phase = arg.slice('--phase='.length);
    else if (arg === '--project') args.project = valueFor('--project', argv[++i]);
    else if (arg.startsWith('--project=')) args.project = arg.slice('--project='.length);
    else if (arg === '--dwell') args.dwellSeconds = dwellFrom(valueFor('--dwell', argv[++i]));
    else if (arg.startsWith('--dwell='))
      args.dwellSeconds = dwellFrom(arg.slice('--dwell='.length));
    else if (arg === '--reset') args.reset = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new UsageError(`Unknown argument: ${arg}`);
  }

  if (!['1', '2', 'all'].includes(args.phase))
    throw new UsageError(`--phase must be 1, 2 or all (got ${args.phase})`);
  return args;
}

/** `--dwell=abc` used to become NaN and be silently ignored. */
function dwellFrom(raw) {
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new UsageError(`--dwell must be a non-negative number of seconds (got ${raw})`);
  return seconds;
}

function die(message) {
  sayErr(`\n✖ ${message}\n`);
  process.exit(1);
}

/**
 * A bad command line, as opposed to a bad site.
 *
 * Thrown rather than exiting so `parseArgs` can be tested: a helper that calls
 * `process.exit` takes the test runner down with it, which is exactly why the
 * argument bugs below went unnoticed. The entry point prints these without a
 * stack, since a stack trace is noise when the answer is "you typed it wrong".
 */
class UsageError extends Error {}

// ---------------------------------------------------------------------------
// Setup: project and issue type
// ---------------------------------------------------------------------------

const resolveProject = (jira, requestedKey) =>
  resolveProjectIn(jira, requestedKey, { defaultKey: 'JFM', name: 'Flow Metrics Seed', die });

const pickIssueType = (project) => pickIssueTypeOf(project, die);

const discoverRoles = (jira, projectKey) => discoverRolesOf(jira, projectKey, rolesFromStatuses);

const transitionTo = (jira, issueKey, role, simulated) =>
  transitionToRole(jira, issueKey, role, simulated, matchRole);

const logWork = (jira, issueKey, hoursList) =>
  logWorkOn(jira, issueKey, hoursList, 'tools/seed-dev-site.mjs');

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
export async function reset(jira, state, save = saveState) {
  const keys = Object.keys(state.issues ?? {});
  if (keys.length === 0) {
    say('  · nothing recorded in the state file; nothing to delete');
    return;
  }
  say(`  ${jira.dryRun ? 'Would delete' : 'Deleting'} ${keys.length} previously seeded issue(s):`);
  // Keys whose deletion did not actually happen, kept so the record of them
  // survives. See below.
  const remaining = {};
  for (const key of keys) {
    try {
      await jira.del(`/rest/api/3/issue/${key}?deleteSubtasks=true`);
      // Never claim a deletion that did not happen: the only reason to run a
      // destructive command with --dry-run is to be told the truth about it.
      say(`      ${jira.dryRun ? '⤳ would delete' : '✓ deleted'} ${key}`);
    } catch (error) {
      const message = String(error.message).split('\n')[0];
      // A 404 means somebody already removed it by hand, which is fine — the
      // issue is gone either way, so its record may go too. Anything else
      // means it is still there.
      // Only a genuine 404 forgets the key — see `deletionMeansGone`.
      if (!deletionMeansGone(message)) remaining[key] = state.issues[key];
      say(`      ⤳ ${key}: ${message}`);
    }
  }
  if (jira.dryRun) {
    // Nothing was actually deleted, and `reset` only ever touches keys this
    // file records. Clearing it here would strand the real issues beyond the
    // reach of the tool that made them — a dry run destroying the only thing
    // that was not a dry run.
    say('  · [dry-run] state file left untouched');
    return;
  }
  // ★ Keep the keys that were *not* deleted.
  //
  // The loop above catches every error, not only 404, and this used to clear
  // the file regardless. An expired API token turns every DELETE into a 401:
  // the issues survive in Jira, the only record of what this tool created is
  // erased, and every later --reset answers "nothing recorded in the state
  // file; nothing to delete". Orphaning exactly what it was asked to remove
  // is the worst outcome available to a destructive command.
  save({ ...state, issues: remaining });
  const left = Object.keys(remaining).length;
  say(
    left === 0
      ? '  · state file cleared'
      : `  · ${left} issue(s) could not be deleted and are still recorded — fix the error above and re-run`,
  );
}

/**
 * Read an issue's real status history back out of Jira.
 *
 * The expectation table used to be built from the executed *path* alone, which
 * can say how many visits a status had but not how long they lasted. That let
 * it promise "app higher" on rows where the excess was under a second — true,
 * unobservable, and indistinguishable from a broken engine to whoever is
 * checking. Durations have to come from the changelog, so they are fetched.
 */
async function timelineFor(jira, issueKey) {
  const issue = await jira.get(
    `/rest/api/3/issue/${issueKey}?expand=changelog&fields=created,status`,
  );
  const changes = (issue.changelog?.histories ?? [])
    .flatMap((history) =>
      (history.items ?? [])
        .filter((item) => item.field === 'status')
        .map((item) => ({
          at: Date.parse(history.created),
          to: matchRole(item.toString),
          from: matchRole(item.fromString),
        })),
    )
    .sort((a, b) => a.at - b.at);

  // The changelog records transitions, not the status the issue was created
  // in; that one is the `from` of the first transition, or — for an issue that
  // never moved — whatever it is sitting in now.
  const first = changes[0]?.from ?? matchRole(issue.fields.status.name);
  const timeline = [{ role: first, at: Date.parse(issue.fields.created) }];
  for (const change of changes) timeline.push({ role: change.to, at: change.at });
  return timeline.filter((entry) => entry.role !== null);
}

async function collectExcess(jira, state) {
  const perIssue = new Map();
  const now = Date.now();
  for (const key of Object.keys(state.issues)) {
    try {
      perIssue.set(key, excessPerRole(await timelineFor(jira, key), now));
    } catch (error) {
      // A report without margins still beats no report; say so rather than
      // failing the whole run over one unreadable changelog.
      say(`  ⤳ could not read ${key}'s history for the margin column: ${error.message}`);
    }
  }
  return perIssue;
}

// ---------------------------------------------------------------------------
// The hand-check table — the actual deliverable
// ---------------------------------------------------------------------------

function writeReport(state, baseUrl, excessByIssue = new Map()) {
  const lines = [
    '# Seeded data — the hand-check table for RUNBOOK item 9',
    '',
    'Generated by `pnpm run seed:dev-site`. The verdicts come from the transitions the seeder',
    "actually executed and the margins from Jira's changelog — both **before** the app was",
    'opened, so nothing here was fitted to what the app happens to show.',
    '',
    "**How to use this.** For each issue, open Jira's own Control Chart (or the issue's",
    'History tab) and read the time in each status, then read the same figure in the app.',
    '',
    '- `agrees` — one visit. The two figures must match. **A disagreement here means the',
    '  engine is wrong, and RUNBOOK item 9 says stop everything.**',
    '- `app higher` — the status was re-entered. The app must show strictly more than Jira,',
    '  and the difference is the time spent in the earlier visits. This is the product.',
    '- The **margin** column is that difference, measured from the real changelog. It is the',
    '  number to check, not the word: a row marked `too small to see` is one where the claim',
    '  is true but the two figures round to the same thing on screen. Those rows prove nothing',
    '  by eye — skip them, or compare via the API.',
    '- `open` — the issue is still sitting in this status, so the figure grows between the',
    '  two readings. Compare loosely.',
    '',
    `Site: ${baseUrl}`,
    '',
    '| Issue | Scenario | Status | Visits | Expected vs Control Chart | Margin |',
    '| ----- | -------- | ------ | -----: | ------------------------- | ------ |',
  ];

  let invisible = 0;
  for (const [key, record] of Object.entries(state.issues)) {
    const excess = excessByIssue.get(key);
    for (const row of expectationsFor(record.executed)) {
      const name = record.statusNames?.[row.role] ?? row.role;
      let verdict = row.expectation === 'agrees' ? 'agrees' : '**app higher**';
      let margin = '—';
      if (row.expectation === 'app-higher') {
        const ms = excess?.get(row.role);
        if (ms === undefined) margin = '_unread_';
        else if (ms < VISIBLE_EXCESS_MS) {
          margin = `${formatDuration(ms)} · too small to see`;
          verdict = 'app higher, unobservably';
          invisible += 1;
        } else margin = `**${formatDuration(ms)}**`;
      }
      lines.push(
        `| ${key} | ${record.scenarioId} | ${name} | ${row.visits} | ${verdict}${row.open ? ' · open' : ''} | ${margin} |`,
      );
    }
  }

  if (invisible > 0) {
    lines.push(
      '',
      '## Why some margins are too small to see',
      '',
      `${invisible} of the re-entered rows above have a margin under ${formatDuration(VISIBLE_EXCESS_MS)}.`,
      'Jira stamps changelog entries with its own clock and REST cannot backdate one, so every',
      'transition walked inside a single run lands in the same second or two. Only a visit that',
      'straddles the gap between `--phase 1` and `--phase 2` accumulates real time.',
      '',
      'This is a limit of the *seed*, not a finding about the app. Those rows are still correct —',
      'the app should read higher — but not by enough for anyone to see it, so they cannot settle',
      'RUNBOOK item 9 either way. Use the bolded rows for that.',
      '',
      'To get more checkable rows next time: leave a longer gap between the two phases, and pass',
      '`--dwell` so that consecutive transitions within a phase are separated too — for example',
      '`pnpm run seed:dev-site -- --phase 2 --dwell 120`.',
    );
  }

  const degraded = Object.entries(state.issues).filter(([, record]) => record.degraded);
  if (degraded.length > 0) {
    lines.push(
      '',
      '## Issues that did not achieve the re-entry they intended',
      '',
      'These carry a `[RE-ENTRY]` summary in Jira, because that is what the scenario asked for,',
      'but the workflow would not walk it — so they behave as extra controls and prove nothing',
      'about re-entered statuses. Their rows above are still correct; the label on the issue is',
      'the misleading part.',
      '',
      ...degraded.map(([key, record]) => `- \`${key}\` — ${record.scenarioId}`),
    );
  }

  const skipped = Object.values(state.issues).flatMap((r) => r.skipped ?? []);
  if (skipped.length > 0) {
    lines.push(
      '',
      '## Steps the workflow could not do',
      '',
      "The site's workflow had no status matching these roles, so the seeder skipped them and",
      'the expectations above were computed without them. Adding the status to the workflow and',
      're-running after `--reset` would give a richer history, but nothing above is invalidated',
      'by their absence. A plain re-run will not revisit them: the phase is already recorded as',
      'walked, and repeating it would add visits the scenarios never asked for.',
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

/**
 * Real help text, rather than a slice of this file's header comment.
 *
 * That is what `--help` used to print: it cut off mid-word at 2200 characters,
 * showed the `*` of the comment syntax, and documented none of `--reset`,
 * `--project` or `--dwell` — the three flags somebody reaching for `--help` is
 * most likely to be looking for.
 */
const USAGE = `
Seed a Jira Cloud developer site with issues that re-enter statuses, and write
the table the first tunnel session checks the product against.

  pnpm run seed:dev-site -- [options]

Options:
  --dry-run          Print the plan and the expectations it would produce.
                     Makes no writes of any kind, including to the state file.
  --phase 1|2|all    Which half of each path to walk. Default: all.
                     Jira stamps changelog entries with its own clock and REST
                     cannot backdate one, so run --phase 1, wait a day or two,
                     then --phase 2 to get history with real elapsed days in it.
  --project KEY      Project to seed. Default: JFM, created if absent.
  --dwell SECONDS    Pause between transitions, so consecutive visits are not
                     stamped within the same second and the report's margins
                     are large enough to see on screen. Default: 0. Costs real
                     time: a full walk is about 19 transitions in phase 1 and
                     15 in phase 2, so --dwell 120 adds roughly 38 and 30
                     minutes. Ignored under --dry-run.
  --reset            Delete the issues recorded in tools/.seed-state.json and
                     clear it. Only ever touches keys that file records.
  --help, -h         This text.

Credentials come from .env (see .env.example): JIRA_BASE_URL, JIRA_EMAIL and
JIRA_API_TOKEN. .env is git-ignored; the token must never be committed.

Re-running a phase is safe — walked issues are skipped. The hand-check table
is written to tools/seed-report.md.
`.trim();

async function main() {
  loadDotEnvFrom(ROOT);
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
        '  JIRA_API_TOKEN  from id.atlassian.com/manage-profile/security/api-tokens\n\n' +
        '`.env` is git-ignored. The token is a credential — it must never be committed.',
    );
  }

  // Before the first request, not after: if the state file belongs to another
  // site there is nothing worth asking this one.
  const state = loadState();
  const recordedIssues = Object.keys(state.issues ?? {}).length;
  if (recordedIssues > 0 && state.baseUrl && state.baseUrl !== baseUrl) {
    die(
      `${STATE_FILE} records ${recordedIssues} issue(s) on ${state.baseUrl}, but JIRA_BASE_URL ` +
        `is ${baseUrl}.\n\nThose keys mean nothing here, and acting on them — resuming, or ` +
        `--reset — would hit whatever issues happen to carry those keys on this site. Point ` +
        `.env back at ${state.baseUrl}, or move the state file aside to start fresh.`,
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

  // The same reasoning for the project key, which needs the resolved project.
  if (recordedIssues > 0 && state.projectKey && state.projectKey !== project.key) {
    die(
      `${STATE_FILE} records ${recordedIssues} issue(s) in project ${state.projectKey}, but this run ` +
        `targets ${project.key}. Re-run with --project=${state.projectKey}, or move the state ` +
        `file aside to start fresh.`,
    );
  }

  state.baseUrl = baseUrl;
  state.projectKey = project.key;

  if (args.reset) {
    await reset(jira, state);
    say(
      args.dryRun
        ? '\nDry run complete — nothing was deleted.\n'
        : '\nReset complete. Re-run without --reset to seed.\n',
    );
    return;
  }

  for (const scenario of SCENARIOS) {
    const missing = missingRolesFor(scenario, availableRoles);
    if (missing.length > 0) {
      // Skipped rather than half-walked: dropping the middle status of
      // `In Progress → Blocked → In Progress` leaves one uninterrupted visit,
      // so the issue would sit in the backlog looking like a seeded re-entry
      // case while proving nothing.
      say(`  ⤳ ${scenario.id}: workflow has no ${missing.join('/')}; skipped`);
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
      // Never dwell in a dry run: it writes nothing, so there is nothing to
      // space out, and `--dry-run --dwell 120` would otherwise sit there for
      // half an hour producing exactly the output it produces instantly.
      if (args.dwellSeconds > 0 && !args.dryRun) await sleep(args.dwellSeconds * 1000);
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
  const report = writeReport(state, baseUrl, await collectExcess(jira, state));
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
if (invokedAsScript)
  main().catch((error) =>
    die(error instanceof UsageError ? error.message : (error.stack ?? String(error))),
  );
