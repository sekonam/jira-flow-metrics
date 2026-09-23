/**
 * Spread worklogs across additional Jira accounts, so the worklog report has
 * more than one author to group by.
 *
 * The worklog listing's whole pitch is "who logged how much, grouped" — and
 * every seeded worklog on the dev site is authored by the one API user,
 * because Jira sets a worklog's author to the caller and provides no way to
 * write one as somebody else. `docs/SHOT-LIST.md` names this as the blocker
 * for four of that listing's six screenshots: a grouped-by-author report
 * with a single row for `Sergii P1 · 100%` is not a screenshot of the
 * product's argument.
 *
 * So the fix is more callers. This tool reads additional credentials from
 * `.env` — `JIRA_EMAIL_2`/`JIRA_API_TOKEN_2`, `_3`, and so on — and logs a
 * plausible spread of work through each, on issues the two seeders already
 * created (their state files are the source of issue keys, never a JQL
 * search, for the same reason `--reset` works that way: a typo must not be
 * able to touch somebody's real backlog).
 *
 * What this tool cannot do is create the accounts. Inviting a user to the
 * site and minting their API token is account management, which stays with
 * a human; the moment the credentials exist in `.env`, this makes them
 * authors.
 *
 * ## Usage
 *
 *   # .env gains, for each extra author:
 *   #   JIRA_EMAIL_2=colleague@example.com
 *   #   JIRA_API_TOKEN_2=...
 *   pnpm run seed:worklog-authors -- --dry-run     # print the plan
 *   pnpm run seed:worklog-authors                  # log the work
 *   pnpm run seed:worklog-authors -- --per-author 12
 *
 * Idempotence: re-running adds more worklogs. That is fine for a dev site
 * and the report (totals grow), but the tool says so rather than pretending
 * to be idempotent.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jira, loadDotEnv, jiraTimestamp } from './jira-seed-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

export function parseArgs(argv) {
  const args = { dryRun: false, perAuthor: 8, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--per-author') args.perAuthor = Number(argv[(i += 1)]);
    else if (arg.startsWith('--per-author=')) args.perAuthor = Number(arg.slice(13));
    else throw new Error(`Unknown argument: ${arg} (try --help)`);
  }
  if (!Number.isInteger(args.perAuthor) || args.perAuthor < 1 || args.perAuthor > 100) {
    throw new Error('--per-author must be an integer between 1 and 100');
  }
  return args;
}

/** Every extra credential pair present in the environment, in order. */
export function extraAccounts(env) {
  const accounts = [];
  for (let n = 2; ; n += 1) {
    const email = env[`JIRA_EMAIL_${n}`];
    const token = env[`JIRA_API_TOKEN_${n}`];
    if (email === undefined || token === undefined) break;
    accounts.push({ email, token, n });
  }
  return accounts;
}

/** Issue keys the two seeders have on record, bulk project first. */
export function seededIssueKeys(root = ROOT) {
  const keys = [];
  for (const file of ['.seed-bulk-state.json', '.seed-state.json']) {
    const path = join(root, 'tools', file);
    if (!existsSync(path)) continue;
    const state = JSON.parse(readFileSync(path, 'utf8'));
    keys.push(...Object.keys(state.issues ?? {}));
  }
  return keys;
}

/**
 * A deterministic spread: author `n` logs on every `n`th issue, hours
 * varying 1-6, started on distinct past days. Deterministic so a re-run
 * with the same inputs logs the same shape (twice as much of it), and so
 * a dry run prints exactly what a real run would do.
 */
export function planFor(accountIndex, keys, perAuthor) {
  const plan = [];
  for (let i = 0; i < keys.length && plan.length < perAuthor; i += 1) {
    if (i % (accountIndex + 1) !== accountIndex % (accountIndex + 1)) continue;
    const hours = 1 + ((i * 7 + accountIndex * 3) % 6);
    plan.push({ issueKey: keys[i], hours, daysAgo: 1 + (plan.length % 14) });
  }
  return plan;
}

const say = (line = '') => process.stdout.write(`${line}\n`);

async function main() {
  loadDotEnv(ROOT);
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    say(
      'seed-worklog-authors — log work through extra accounts (JIRA_EMAIL_2/JIRA_API_TOKEN_2, _3, …)',
    );
    say('  --dry-run          print the plan, write nothing');
    say('  --per-author N     worklogs per extra author (default 8, max 100)');
    return;
  }

  const base = { baseUrl: process.env.JIRA_BASE_URL, dryRun: args.dryRun };
  const primary = new Jira({
    ...base,
    email: process.env.JIRA_EMAIL,
    token: process.env.JIRA_API_TOKEN,
  });
  const me = await primary.get('/rest/api/3/myself');

  const accounts = extraAccounts(process.env);
  if (accounts.length === 0) {
    say('No extra accounts in .env (JIRA_EMAIL_2/JIRA_API_TOKEN_2, …). Nothing to do.');
    say('Invite a user to the site, mint their API token, add both to .env, re-run.');
    process.exitCode = 1;
    return;
  }

  const keys = seededIssueKeys();
  if (keys.length === 0) {
    say('No seeded issues on record — run pnpm run seed:bulk (or seed:dev-site) first.');
    process.exitCode = 1;
    return;
  }

  for (const account of accounts) {
    const jira = new Jira({ ...base, email: account.email, token: account.token });
    // Who is this token, really? A second entry that authenticates as the
    // primary user would silently defeat the tool's whole purpose.
    const who = await jira.get('/rest/api/3/myself');
    if (!args.dryRun && who.accountId === me.accountId) {
      say(`  ✗ JIRA_EMAIL_${account.n} authenticates as the same account as JIRA_EMAIL — skipped.`);
      process.exitCode = 1;
      continue;
    }
    const plan = planFor(account.n - 2, keys, args.perAuthor);
    say(`  ${who.displayName ?? account.email}: ${plan.length} worklog(s)`);
    for (const entry of plan) {
      await jira.post(`/rest/api/3/issue/${entry.issueKey}/worklog?notifyUsers=false`, {
        started: jiraTimestamp(entry.daysAgo, 10),
        timeSpentSeconds: entry.hours * 3600,
        comment: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Seeded by tools/seed-worklog-authors.mjs' }],
            },
          ],
        },
      });
      say(`      ${args.dryRun ? '⤳ would log' : '✓ logged'} ${entry.hours}h on ${entry.issueKey}`);
    }
  }
  say('\nDone. Re-run the affected app’s indexing (or wait for issue events) before shooting.');
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  await main();
}
