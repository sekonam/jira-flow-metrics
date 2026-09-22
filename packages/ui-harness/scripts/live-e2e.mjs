/**
 * Run the real engine over the real seeded Jira site, and check the product's
 * central claim against Jira's own changelog.
 *
 * This is as close to end to end as anything gets before Forge exists: live
 * Jira REST → the real ingester → the real store → the real resolver handler.
 * Only the transport and the UI are absent. Everything computing a number here
 * is the code that would ship.
 *
 * What it asserts, per issue and per status:
 *
 *   1. the engine's **visit count** matches the number of visits actually in
 *      Jira's changelog;
 *   2. the engine's **cumulative** figure matches the sum of those visits,
 *      computed independently here from raw timestamps;
 *   3. the engine's cumulative figure exceeds a last-visit-only reading by the
 *      margin `tools/seed-report.md` predicts — the product's one factual
 *      claim, checked against real history rather than assumed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline, PIPELINE_CONTEXT, PIPELINE_PROJECT_ID } from '@jfm/forge-runtime/testing';
import { handleGetReport } from '@jfm/forge-runtime';

/**
 * The workspace root, found rather than written down.
 *
 * This was an absolute path to one developer's home directory, so the script
 * ran on exactly one machine. `pipeline.ts` walks up for the same reason.
 */
const ROOT = (() => {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('could not find the workspace root from this script');
    dir = parent;
  }
  return dir;
})();
const say = (line = '') => process.stdout.write(`${line}\n`);

for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (match) process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
}
const BASE = process.env.JIRA_BASE_URL.replace(/\/+$/, '');
const AUTH =
  'Basic ' +
  Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');

const get = async (path) => {
  const response = await fetch(`${BASE}${path}`, {
    headers: { Authorization: AUTH, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`GET ${path} → ${response.status}`);
  return response.json();
};

const state = JSON.parse(readFileSync(join(ROOT, 'tools/.seed-state.json'), 'utf8'));
const keys = Object.keys(state.issues);

// ★ Nothing to check is a failure, not a clean run.
//
// With an empty state file — after `pnpm run seed:dev-site --reset`, say —
// the fixture loop ran zero times, `checked` and `failed` both stayed 0, the
// column check ran over an empty array and printed its `ok` line, and the
// script exited 0 having verified nothing at all. Both sibling runners guard
// this (`e2e-ui.mjs` throws on no flow files, `screens.mjs` on no screen
// ids); this one is the only comparison in the repo against *real* Jira, so
// a silent pass here is the most expensive one available.
if (keys.length === 0) {
  say('\nNo seeded issues in tools/.seed-state.json — run `pnpm run seed:dev-site` first.');
  process.exit(1);
}

say(`\nPulling ${keys.length} issues from ${BASE}\n`);

const fixtures = [];
for (const key of keys) {
  const issue = await get(
    `/rest/api/3/issue/${key}?expand=changelog&fields=summary,created,updated,resolutiondate,status,project`,
  );
  const worklog = await get(`/rest/api/3/issue/${key}/worklog`);
  fixtures.push({
    // The project is rewritten to the one the pipeline authorises against.
    // Nothing else is touched: the history, statuses and timestamps are the
    // ones Jira actually recorded, which is the entire point of this script.
    issue: {
      id: issue.id,
      key: issue.key,
      fields: { ...issue.fields, project: { id: PIPELINE_PROJECT_ID, key: 'FLOW' } },
      changelog: { total: issue.changelog?.total ?? 0, values: [], isLast: false },
    },
    changelog: issue.changelog?.histories ?? [],
    worklogs: worklog.worklogs ?? [],
  });
  say(`  ✓ ${key}  ${issue.changelog?.histories?.length ?? 0} changelog entr(ies)`);
}

// The real catalogue, so the report's column headings are the site's own
// (Russian) status names rather than the canned English fixture list. Without
// this every status the fixture does not know is headed with its numeric id.
const CATEGORY = { new: 'todo', indeterminate: 'inprogress', done: 'done' };
const statuses = (await get('/rest/api/3/status')).map((status) => ({
  id: status.id,
  name: status.name,
  category: CATEGORY[status.statusCategory?.key] ?? 'inprogress',
}));
say(`\n  status catalogue: ${statuses.length} statuses from the live site`);

const now = Date.now();
const { runtime } = await runPipeline({ issues: fixtures, statuses, now });
const envelope = await handleGetReport(runtime, {
  context: PIPELINE_CONTEXT,
  payload: { basis: 'elapsed' },
});

/**
 * Independent truth: per-status-ID visit durations straight from the changelog.
 *
 * Keyed by **status ID, never name**. Jira returns changelog `toString` values
 * in English while `fields.status.name` comes back localised — on this site,
 * Russian — so any comparison keyed on names compares two different alphabets
 * and invents failures. The IDs are stable and are what the engine stores.
 */
function visitsFromChangelog(fixture) {
  const changes = fixture.changelog
    .flatMap((history) =>
      (history.items ?? [])
        .filter((item) => item.field === 'status')
        .map((item) => ({ at: Date.parse(history.created), to: item.to, from: item.from })),
    )
    .sort((a, b) => a.at - b.at);
  const timeline = [
    {
      statusId: changes[0]?.from ?? fixture.issue.fields.status.id,
      at: Date.parse(fixture.issue.fields.created),
    },
    ...changes.map((change) => ({ statusId: change.to, at: change.at })),
  ];
  const perStatus = new Map();
  for (let i = 0; i < timeline.length; i += 1) {
    const until = i + 1 < timeline.length ? timeline[i + 1].at : now;
    const duration = Math.max(0, until - timeline[i].at);
    const { statusId } = timeline[i];
    if (i > 0 && statusId === timeline[i - 1].statusId) {
      const list = perStatus.get(statusId);
      list[list.length - 1] += duration;
      continue;
    }
    if (!perStatus.has(statusId)) perStatus.set(statusId, []);
    perStatus.get(statusId).push(duration);
  }
  return perStatus;
}

const TOLERANCE_MS = 5000; // the two reads are seconds apart; clocks drift
let checked = 0;
let failed = 0;

const report = envelope.data.report;
const nameById = new Map(report.columns.map((column) => [column.statusId, column.name]));

say(`\n${'─'.repeat(78)}`);
say("  the real engine vs Jira's own changelog\n");

for (const fixture of fixtures) {
  const key = fixture.issue.key;
  const row = report.rows.find((r) => r.issueKey === key);
  if (!row) {
    say(`  FAIL ${key}: the engine produced no row for this issue`);
    failed += 1;
    continue;
  }
  const truth = visitsFromChangelog(fixture);

  for (const [statusId, durations] of truth) {
    const statusName = nameById.get(statusId) ?? statusId;
    const engineMs = row.byStatus?.[statusId] ?? 0;
    const engineVisits = row.entriesByStatus?.[statusId] ?? 0;

    const expectedTotal = durations.reduce((sum, d) => sum + d, 0);
    const lastVisitOnly = durations[durations.length - 1];
    const expectedExcess = expectedTotal - lastVisitOnly;

    checked += 1;
    const visitsOk = engineVisits === durations.length;
    const totalOk = Math.abs(engineMs - expectedTotal) <= TOLERANCE_MS;
    // The claim: cumulative exceeds a last-visit-only reading by the margin.
    const marginOk = Math.abs(engineMs - lastVisitOnly - expectedExcess) <= TOLERANCE_MS;
    const ok = visitsOk && totalOk && marginOk;
    if (!ok) failed += 1;

    const sec = (ms) => `${Math.round(ms / 1000)}s`;
    say(
      `  ${ok ? 'ok  ' : 'FAIL'} ${key.padEnd(7)} ${statusName.padEnd(21)} ` +
        `visits ${engineVisits}/${durations.length}  ` +
        `cumulative ${sec(engineMs)}/${sec(expectedTotal)}  ` +
        `margin over last-visit ${sec(engineMs - lastVisitOnly)}/${sec(expectedExcess)}`,
    );
  }
}

// A column headed with a bare numeric id means the catalogue did not resolve.
const unnamed = report.columns.filter((column) => column.name === column.statusId);
if (unnamed.length > 0) {
  failed += unnamed.length;
  say(
    `\n  FAIL ${unnamed.length} column(s) fell back to a numeric id: ` +
      unnamed.map((column) => column.statusId).join(', '),
  );
} else {
  say(
    `\n  ok   every column resolved to a real status name: ` +
      report.columns.map((column) => column.name).join(', '),
  );
}

say(`\n  ${checked} status figures checked against live Jira, ${failed} disagreement(s)`);
say(`${'─'.repeat(78)}\n`);
// Zero comparisons is not agreement. Seeded issues that produce no status
// figures at all mean the fixtures or the pipeline stopped doing their job,
// and the run must not report success for it.
if (checked === 0) {
  say('  FAIL nothing was actually compared — no status figures were produced.\n');
  process.exit(1);
}
process.exit(failed === 0 ? 0 : 1);
