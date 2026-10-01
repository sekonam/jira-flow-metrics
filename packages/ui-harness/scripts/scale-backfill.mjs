/**
 * ROADMAP 1.7: back-fill a project with 5,000+ issues, end to end.
 *
 * Synthetic rather than against the live dev site, deliberately. Creating
 * 5,000+ real Jira issues through the REST API would take hours under rate
 * limiting and permanently clutter a developer site with junk; nothing about
 * *that* would exercise code this repository does not already exercise
 * elsewhere. What ROADMAP 1.7 is actually checking is the backfill machinery
 * itself — slicing, pagination, aggregation — at a scale the small fixture
 * sets never reach. That is exactly what `runPipeline` from
 * `@jfm/forge-runtime/testing` runs: the real ingester, the real store, the
 * real resolvers, driven by the real async-events queue loop. Only the
 * transport is fixture-backed, same as every other UI-harness scenario.
 *
 * This is the run that found `runPipeline`'s drain loop silently stopped
 * after 50 slices — half of what 5,000 issues need at the default
 * `issuesPerSlice: 100` — with no error, just an incomplete `pending` queue
 * nobody was checking. Fixed in `pipeline.ts` itself; this script is what
 * proves the fix and puts a number on how far past "small fixture" scale the
 * pipeline actually holds up.
 */

import { PIPELINE_CONTEXT, PIPELINE_PROJECT_ID, runPipeline } from '@jfm/forge-runtime/testing';
import { handleGetReport, handleAgingReport, handleWorklogReport } from '@jfm/forge-runtime';

const say = (line = '') => process.stdout.write(`${line}\n`);

const ISSUE_COUNT = 5_200;
const BASE_TIME = Date.parse('2026-01-01T00:00:00.000+0000');
const DAY = 86_400_000;
const HOUR = 3_600_000;

const STATUSES = {
  TODO: ['10000', 'To Do', 'new'],
  IN_PROGRESS: ['3', 'In Progress', 'indeterminate'],
  BLOCKED: ['10100', 'Blocked', 'new'],
  IN_REVIEW: ['10200', 'In Review', 'indeterminate'],
  DONE: ['10001', 'Done', 'done'],
};

/** The same shape of walk `tools/seed-scenarios.mjs` uses against real Jira. */
const PATHS = [
  { path: ['TODO', 'IN_PROGRESS', 'DONE'], weight: 4 }, // control: single visit each
  { path: ['TODO', 'IN_PROGRESS'], weight: 2 }, // still open
  { path: ['TODO'], weight: 1 }, // untouched
  { path: ['TODO', 'IN_PROGRESS', 'TODO', 'IN_PROGRESS', 'DONE'], weight: 2 }, // re-entry x2
  { path: ['TODO', 'IN_PROGRESS', 'DONE', 'IN_PROGRESS', 'DONE'], weight: 1 }, // reopened
  { path: ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_PROGRESS', 'DONE'], weight: 1 },
  { path: ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'], weight: 1 },
];
const WEIGHTED = PATHS.flatMap((p) => Array(p.weight).fill(p.path));

function iso(ms) {
  return `${new Date(ms).toISOString().replace('Z', '')}+0000`;
}

/** A deterministic, seedable PRNG — repeat runs must be comparable. */
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0xffffffff;
  };
}

function buildIssue(index, rng) {
  const path = WEIGHTED[Math.floor(rng() * WEIGHTED.length)];
  const createdAt = BASE_TIME + Math.floor(rng() * 300) * DAY;
  const hoursPerStep = 4 + Math.floor(rng() * 20);

  const changelog = [];
  let at = createdAt;
  for (let i = 1; i < path.length; i += 1) {
    at += hoursPerStep * HOUR * (1 + Math.floor(rng() * 3));
    const [fromId, fromName] = STATUSES[path[i - 1]];
    const [toId, toName] = STATUSES[path[i]];
    changelog.push({
      id: `${9_000_000 + index}${i}`,
      created: iso(at),
      author: { accountId: 'acc-scale', displayName: 'Scale Test', active: true },
      items: [
        {
          field: 'status',
          fieldtype: 'jira',
          fieldId: 'status',
          from: fromId,
          fromString: fromName,
          to: toId,
          toString: toName,
        },
      ],
    });
  }

  const finalRole = path[path.length - 1];
  const [statusId, statusName, category] = STATUSES[finalRole];
  const resolved = finalRole === 'DONE';
  const key = `SCALE-${index}`;

  const worklogs =
    rng() < 0.3
      ? [
          {
            id: `wl-${index}`,
            author: { accountId: 'acc-scale', displayName: 'Scale Test', active: true },
            started: iso(createdAt + hoursPerStep * HOUR),
            timeSpentSeconds: 3600 * (1 + Math.floor(rng() * 6)),
          },
        ]
      : [];

  return {
    issue: {
      id: String(30_000 + index),
      key,
      fields: {
        summary: `Synthetic scale-test issue ${String(index)}`,
        created: iso(createdAt),
        updated: iso(at),
        resolutiondate: resolved ? iso(at) : null,
        duedate: null,
        status: { id: statusId, name: statusName, statusCategory: { key: category } },
        project: { id: PIPELINE_PROJECT_ID, key: 'FLOW' },
      },
      // Deliberately partial, like every other fixture here, so the changelog
      // pager actually has to page rather than trusting an inline page.
      changelog: { total: changelog.length, values: [], isLast: changelog.length === 0 },
    },
    changelog,
    worklogs,
  };
}

async function main() {
  say(`\nGenerating ${String(ISSUE_COUNT)} synthetic issues (seed 42, deterministic)...`);
  const rng = makeRng(42);
  const issues = Array.from({ length: ISSUE_COUNT }, (_, i) => buildIssue(i, rng));

  const expectedReEntry = issues.filter((f) => {
    const roles = f.changelog.map((c) => c.items[0].toString);
    return new Set(roles).size !== roles.length;
  }).length;
  const expectedNotDone = issues.filter((f) => f.issue.fields.resolutiondate === null).length;

  say(`  ${issues.length} issues built, ${expectedReEntry} include a re-entered status`);
  say(`  ${expectedNotDone} still open (not Done)`);
  say(`  total changelog entries: ${issues.reduce((n, f) => n + f.changelog.length, 0)}`);

  const start = performance.now();
  const { runtime, store, jira, pending } = await runPipeline({
    issues,
    // 100 issues/slice (the production default) × 5,200 issues ≈ 52 slices —
    // comfortably past the old, silent 50-slice cap this run exists to prove
    // is gone.
    maxSlices: Number.POSITIVE_INFINITY,
  });
  const elapsedMs = performance.now() - start;

  if (pending.length > 0) {
    say(`\n✗ FAIL: ${pending.length} backfill slice(s) never ran`);
    process.exit(1);
  }

  const progressResult = await runtime.indexProgress(PIPELINE_PROJECT_ID);
  const searchCalls = jira.requests.filter((r) => r === 'search').length;

  say(`\n${'─'.repeat(72)}`);
  say(`  Backfill completed in ${(elapsedMs / 1000).toFixed(2)}s`);
  say(`  Index state: ${progressResult.state}`);
  say(`  Issues processed: ${progressResult.issuesProcessed} / expected ${ISSUE_COUNT}`);
  say(`  Jira search calls made: ${searchCalls}`);

  let failed = false;
  if (progressResult.state !== 'complete') {
    say(`  ✗ FAIL: index state is "${progressResult.state}", expected "complete"`);
    failed = true;
  }
  if (progressResult.issuesProcessed !== ISSUE_COUNT) {
    say(`  ✗ FAIL: processed ${progressResult.issuesProcessed}, expected ${ISSUE_COUNT}`);
    failed = true;
  }

  // What "backfilled end to end" actually means for 5,200 issues: every one
  // of them landed in the store, AND the resolver's own pagination — a
  // deliberate limit (default 50, max 500 — see `runtime.ts`'s
  // `clamp(request.limit ?? 50, 1, 500)`) that keeps a project-wide report
  // from becoming an unbounded payload — correctly walks every page without
  // dropping or duplicating a row. A single unpaged call was the wrong check:
  // `getReport` is meant to page, and asserting it returns everything at once
  // would have been asserting against the product's own cost-control design.

  const storedMeta = await store.queryIssueMeta({
    projectId: PIPELINE_PROJECT_ID,
    limit: ISSUE_COUNT + 10,
    offset: 0,
  });
  say(`  rows actually persisted in the store: ${storedMeta.length} (expected ${ISSUE_COUNT})`);
  if (storedMeta.length !== ISSUE_COUNT) failed = true;

  async function collectAllPages(basis) {
    const seen = new Set();
    let offset = 0;
    let truncatedRows = 0;
    for (let page = 0; page < 20; page += 1) {
      const result = await handleGetReport(runtime, {
        context: PIPELINE_CONTEXT,
        payload: { basis, limit: 500, offset },
      });
      if (!result.ok)
        throw new Error(`getReport page at offset ${offset} refused: ${result.error}`);
      for (const row of result.data.report.rows) seen.add(row.issueKey);
      truncatedRows += result.data.report.rows.filter((r) => r.truncated).length;
      if (result.data.report.rows.length < 500) break;
      offset += 500;
    }
    return { seen, truncatedRows };
  }

  const { seen, truncatedRows } = await collectAllPages('elapsed');
  say(
    `  getReport, paginated end to end: ${seen.size} distinct issues seen (expected ${ISSUE_COUNT})`,
  );
  if (seen.size !== ISSUE_COUNT) failed = true;
  say(
    `  rows flagged truncated: ${truncatedRows} (expected 0 — none of these issues has 2000+ transitions)`,
  );
  if (truncatedRows !== 0) failed = true;

  const worklog = await handleWorklogReport(runtime, { context: PIPELINE_CONTEXT });
  if (!worklog.ok) {
    say(`  ✗ FAIL: getWorklogReport refused: ${worklog.error}`);
    failed = true;
  } else {
    say(`  getWorklogReport: ${worklog.data.entries} worklog entries aggregated`);
  }

  // Aging is spot-checked rather than paginated to completion: its request
  // type has no offset contract the way getReport's does (its default page is
  // a top-500-oldest-issues slice, then filtered to WIP), so "walk every page"
  // is not a promise it makes. Confirming it answers at all, at this scale,
  // internally consistently, is the relevant check.
  const aging = await handleAgingReport(runtime, { context: PIPELINE_CONTEXT });
  if (!aging.ok) {
    say(`  ✗ FAIL: getAgingReport refused: ${aging.error}`);
    failed = true;
  } else {
    const bucketSum = aging.data.buckets.reduce((n, b) => n + b.count, 0);
    say(
      `  getAgingReport answered at scale: ${aging.data.rows.length} WIP rows, ` +
        `buckets sum to ${bucketSum}, ${aging.data.excludedDone} excluded as done`,
    );
    if (bucketSum !== aging.data.rows.length) failed = true;
  }

  say(`${'─'.repeat(72)}`);
  say(
    failed ? '\n✗ Scale backfill test FAILED — see above.\n' : '\n✔ Scale backfill test passed.\n',
  );
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  process.stderr.write(`\n✖ ${error.stack ?? String(error)}\n`);
  process.exit(1);
});
