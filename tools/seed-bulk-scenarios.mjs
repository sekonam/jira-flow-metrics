/**
 * Randomized path generation for `seed-bulk.mjs`.
 *
 * `seed-scenarios.mjs` hand-picks ten fixed paths for a hand-check table
 * (RUNBOOK item 9): one issue per shape, correctness is what matters. Bulk
 * seeding wants a different thing — realistic *volume* to exercise pagination,
 * backfill slicing and gadget rendering under real load — so instead of one
 * issue per shape, this draws many issues from a weighted pool of shapes with
 * randomized due dates and worklogs. Pure and RNG-injected (never calls
 * `Math.random` directly) so the distribution is testable without flakiness.
 */

/** @typedef {() => number} Rng — must return a float in [0, 1). */

/**
 * Path shapes, weighted by how common that story arc should be in a
 * realistic backlog. `requiresRoles` mirrors `seed-scenarios.mjs`: a shape
 * naming a role the site's workflow does not have is skipped rather than
 * half-walked.
 */
export const WEIGHTED_SHAPES = [
  { id: 'untouched', weight: 5, path: ['TODO'], leaveOpen: true },
  { id: 'open-straight', weight: 10, path: ['TODO', 'IN_PROGRESS'], leaveOpen: true },
  { id: 'straight-through', weight: 20, path: ['TODO', 'IN_PROGRESS', 'DONE'] },
  {
    id: 'bounced-once',
    weight: 20,
    path: ['TODO', 'IN_PROGRESS', 'TODO', 'IN_PROGRESS', 'DONE'],
  },
  {
    id: 'bounced-twice',
    weight: 10,
    path: ['TODO', 'IN_PROGRESS', 'TODO', 'IN_PROGRESS', 'TODO', 'IN_PROGRESS', 'DONE'],
  },
  {
    id: 'open-re-entered',
    weight: 10,
    path: ['TODO', 'IN_PROGRESS', 'TODO', 'IN_PROGRESS'],
    leaveOpen: true,
  },
  {
    id: 'reopened',
    weight: 10,
    path: ['TODO', 'IN_PROGRESS', 'DONE', 'IN_PROGRESS', 'DONE'],
  },
  {
    id: 'reopened-twice',
    weight: 5,
    path: ['TODO', 'IN_PROGRESS', 'DONE', 'IN_PROGRESS', 'DONE', 'IN_PROGRESS', 'DONE'],
  },
  {
    id: 'blocked-once',
    weight: 5,
    path: ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_PROGRESS', 'DONE'],
    requiresRoles: ['BLOCKED'],
  },
  {
    id: 'review-rounds',
    weight: 5,
    path: ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'],
    requiresRoles: ['IN_REVIEW'],
  },
];

/** Verbs and nouns combined into a plausible-looking backlog summary. */
const VERBS = [
  'Fix',
  'Investigate',
  'Improve',
  'Add',
  'Refactor',
  'Optimize',
  'Document',
  'Migrate',
  'Stabilize',
  'Clean up',
];
const NOUNS = [
  'checkout flow',
  'login redirect',
  'search indexing',
  'payment retry logic',
  'notification service',
  'export pipeline',
  'dashboard widget',
  'pagination on the reports page',
  'worker queue backoff',
  'onboarding wizard',
  'API rate limiting',
  'cache invalidation',
  'audit log',
  'CSV export',
  'user permissions',
  'webhook delivery',
  'session handling',
  'error reporting',
  'settings page',
  'billing reconciliation',
];

/** Which roles a shape needs beyond the three every Jira workflow has. */
export function missingRolesFor(shape, availableRoles) {
  if (!shape.requiresRoles) return [];
  if (!availableRoles) return shape.requiresRoles;
  return shape.requiresRoles.filter((role) => !availableRoles.has(role));
}

/**
 * Weighted pick among the shapes whose required roles the workflow has.
 * Throws if none qualify — every workflow has at least TODO/IN_PROGRESS/DONE,
 * so this can only happen if `shapes` itself is empty.
 */
export function pickShape(rng, availableRoles, shapes = WEIGHTED_SHAPES) {
  const candidates = shapes.filter((s) => missingRolesFor(s, availableRoles).length === 0);
  if (candidates.length === 0) throw new Error('No shape qualifies for this workflow');
  const total = candidates.reduce((sum, s) => sum + s.weight, 0);
  const roll = rng() * total;
  let cumulative = 0;
  for (const shape of candidates) {
    cumulative += shape.weight;
    if (roll < cumulative) return shape;
  }
  // Unreachable for any rng() in [0, 1): roll < total always holds, and
  // cumulative reaches total on the last candidate. A loud failure here
  // beats silently returning the last candidate if that ever stops being true.
  throw new Error('pickShape: roll exceeded total weight — this should be unreachable');
}

/** Uniform integer due-date offset in [-30, 30] days — spread either side of today. */
export function randomDueDateOffsetDays(rng) {
  return Math.floor(rng() * 61) - 30;
}

/** One worklog entry per IN_PROGRESS visit in the path, 1-8 hours each. */
export function randomWorklogHours(rng, path) {
  let visits = 0;
  let previous = null;
  for (const role of path) {
    if (role === 'IN_PROGRESS' && role !== previous) visits += 1;
    previous = role;
  }
  return Array.from({ length: visits }, () => 1 + Math.floor(rng() * 8));
}

/** A plausible-looking, non-repeating-enough backlog summary. */
export function randomSummary(rng) {
  const verb = VERBS[Math.floor(rng() * VERBS.length)];
  const noun = NOUNS[Math.floor(rng() * NOUNS.length)];
  return `${verb} ${noun}`;
}

/** Bundle a full random issue plan: shape, summary, due date and worklogs. */
export function randomIssuePlan(rng, availableRoles, shapes = WEIGHTED_SHAPES) {
  const shape = pickShape(rng, availableRoles, shapes);
  return {
    shapeId: shape.id,
    path: shape.path,
    leaveOpen: Boolean(shape.leaveOpen),
    summary: randomSummary(rng),
    dueDateOffsetDays: randomDueDateOffsetDays(rng),
    worklogHours: randomWorklogHours(rng, shape.path),
  };
}
