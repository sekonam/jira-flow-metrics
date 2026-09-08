/**
 * The seeding scenarios, and the arithmetic that turns one into an expectation.
 *
 * This file is pure: no network, no clock, no filesystem. It exists separately
 * from `seed-dev-site.mjs` because the numbers it produces are the numbers the
 * first tunnel session checks the product against — `docs/RUNBOOK.md` item 9,
 * the one that can end the project. An expectation table that is quietly wrong
 * would send somebody hunting a phantom bug in the engine, so the logic that
 * builds it is tested (`test/seed-scenarios.test.ts`) rather than trusted.
 *
 * Statuses are referred to by **role**, never by name. A free Jira dev site's
 * workflow is whatever its template gave it: "In Review" may be absent, "To Do"
 * may be called "Open". The runner maps roles onto whatever the workflow
 * actually offers and records what it managed to execute; every expectation is
 * then computed from the *executed* path, not the intended one.
 */

/** @typedef {'TODO'|'IN_PROGRESS'|'BLOCKED'|'IN_REVIEW'|'DONE'} Role */

/**
 * Lower-case status names that stand in for each role.
 *
 * Names are **not** the primary signal — `statusCategory` is, because it is the
 * same three keys in every locale. These exist to tell apart the statuses that
 * share a category: In Progress, Blocked and In Review are all `indeterminate`,
 * and only the name distinguishes them.
 *
 * Russian is listed because the first site this ran against was a Russian Jira,
 * where every status name is localised at project creation and the English list
 * matched nothing at all.
 */
export const ROLE_SYNONYMS = /** @type {const} */ ({
  TODO: [
    'selected for development',
    'to do',
    'to-do',
    'todo',
    'backlog',
    'open',
    'new',
    'к выполнению',
    'сделать',
    'бэклог',
  ],
  IN_PROGRESS: ['in progress', 'in-progress', 'inprogress', 'in development', 'doing', 'в работе'],
  BLOCKED: [
    'blocked',
    'blocker',
    'on hold',
    'impediment',
    'waiting',
    'paused',
    'заблокировано',
    'заблокирован',
    'блокировано',
  ],
  IN_REVIEW: [
    'in review',
    'code review',
    'peer review',
    'reviewing',
    'review',
    'в процессе проверки',
    'на проверке',
    'проверка',
  ],
  DONE: ['done', 'closed', 'resolved', 'completed', 'complete', 'готово', 'выполнено', 'закрыто'],
});

/**
 * Jira's own status categories, which are locale-independent.
 *
 * Every Jira status carries one of exactly these three keys whatever the site's
 * language, which makes them the only trustworthy signal for the three roles
 * that matter most. Names are consulted first — they are the only way to pick
 * Blocked or In Review out of the `indeterminate` bucket — and this fills in
 * whatever the names failed to identify.
 */
export const CATEGORY_ROLE = /** @type {const} */ ({
  new: 'TODO',
  indeterminate: 'IN_PROGRESS',
  done: 'DONE',
});

/**
 * Resolve a workflow's statuses to `role -> status name`.
 *
 * Two passes, deliberately in this order:
 *
 * 1. **By name**, so `In Review` and `Blocked` are recognised as themselves
 *    rather than collapsing into In Progress — they share its category.
 * 2. **By category**, so a site in a language this file has never heard of
 *    still resolves To Do, In Progress and Done correctly.
 *
 * A status already claimed in pass 1 is never reused in pass 2; otherwise a
 * site whose only `indeterminate` status is called "In Review" would have it
 * serve as In Progress too, and the seeder would walk a re-entry that Jira
 * records as one uninterrupted visit.
 */
export function rolesFromStatuses(statuses) {
  const byRole = new Map();
  const claimed = new Set();

  for (const status of statuses) {
    const role = matchRole(status.name);
    if (role && !byRole.has(role)) {
      byRole.set(role, status.name);
      claimed.add(status.name);
    }
  }

  for (const status of statuses) {
    const role = CATEGORY_ROLE[status.statusCategory?.key];
    if (!role || byRole.has(role) || claimed.has(status.name)) continue;
    byRole.set(role, status.name);
    claimed.add(status.name);
  }

  return byRole;
}

/**
 * Map a Jira status name onto a role, or `null` if it resembles none of them.
 *
 * Matching is on the whole name after case folding and whitespace collapse.
 * Substring matching was tried and rejected: "Ready for Review" would match
 * both TODO ("ready" is not a synonym, but "review" is) and IN_REVIEW, and the
 * order of the object keys would silently decide which one won.
 */
export function matchRole(statusName) {
  const needle = String(statusName ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (needle === '') return null;
  for (const [role, synonyms] of Object.entries(ROLE_SYNONYMS)) {
    if (synonyms.includes(needle)) return /** @type {Role} */ (role);
  }
  return null;
}

/**
 * The scenarios.
 *
 * `path` is the *intended* walk, starting from the status a new issue is
 * created in. The first element is therefore the created status and is not a
 * transition — the runner only transitions from element 1 onward.
 *
 * **Every re-entry case here uses only To Do, In Progress and Done.** That
 * restraint is deliberate and was learned the hard way: a dry run against a
 * stock Jira site showed that paths built on Blocked or In Review degrade into
 * nothing. If the workflow lacks the middle status, `In Progress → Blocked →
 * In Progress` is walked as `In Progress → In Progress`, which is one
 * uninterrupted visit — Jira records no transition and the scenario silently
 * stops demonstrating anything. Richer statuses are still used where a site
 * offers them, but only through `requiresRoles`, which skips the scenario
 * outright rather than half-walking it.
 *
 * Controls are as important as the re-entry cases. The product's whole claim is
 * "we differ from Jira's Control Chart when a status is re-entered", and a
 * difference is only evidence if there is also a case where the two agree. If a
 * *control* disagrees, the engine is wrong.
 */
export const SCENARIOS = [
  {
    id: 'bounced-to-todo',
    summary: 're-entry ×2 — sent back to the backlog and picked up again',
    path: ['TODO', 'IN_PROGRESS', 'TODO', 'IN_PROGRESS', 'DONE'],
    dueDateOffsetDays: -3,
    worklogHours: [2, 3],
  },
  {
    id: 'bounced-three-times',
    summary: 're-entry ×3 — bounced back to the backlog twice',
    path: ['TODO', 'IN_PROGRESS', 'TODO', 'IN_PROGRESS', 'TODO', 'IN_PROGRESS', 'DONE'],
    dueDateOffsetDays: -10,
    worklogHours: [1, 1, 4],
  },
  {
    id: 'reopened',
    summary: 're-entry ×2 — closed, reopened, closed again',
    path: ['TODO', 'IN_PROGRESS', 'DONE', 'IN_PROGRESS', 'DONE'],
    dueDateOffsetDays: 5,
    worklogHours: [6],
  },
  {
    id: 'reopened-twice',
    summary: 're-entry ×3 — reopened twice; the worst case for a last-visit-only report',
    path: ['TODO', 'IN_PROGRESS', 'DONE', 'IN_PROGRESS', 'DONE', 'IN_PROGRESS', 'DONE'],
    dueDateOffsetDays: -1,
    worklogHours: [2, 2, 2, 1],
  },
  {
    id: 'open-re-entered',
    summary: 're-entry ×2, still open — WIP aging with a real history',
    path: ['TODO', 'IN_PROGRESS', 'TODO', 'IN_PROGRESS'],
    leaveOpen: true,
    dueDateOffsetDays: 2,
    worklogHours: [3],
  },
  {
    id: 'open-after-reopen',
    summary: 're-entry ×2, reopened and still open',
    path: ['TODO', 'IN_PROGRESS', 'DONE', 'IN_PROGRESS'],
    leaveOpen: true,
    dueDateOffsetDays: -2,
    worklogHours: [1],
  },
  {
    id: 'control-straight-through',
    summary: 'CONTROL — single visit each; must match the Control Chart exactly',
    path: ['TODO', 'IN_PROGRESS', 'DONE'],
    dueDateOffsetDays: 7,
    worklogHours: [5],
  },
  {
    id: 'control-open',
    summary: 'CONTROL — open, single visit; WIP aging with nothing to sum',
    path: ['TODO', 'IN_PROGRESS'],
    leaveOpen: true,
    dueDateOffsetDays: 21,
    worklogHours: [1],
  },
  {
    id: 'control-untouched',
    summary: 'CONTROL — never transitioned; every report must tolerate an empty changelog',
    path: ['TODO'],
    leaveOpen: true,
    worklogHours: [],
  },

  // Only run where the workflow has the status. Skipped entirely otherwise —
  // a half-walked path is worse than no path, because it still looks like a
  // seeded re-entry case in the issue list.
  {
    id: 'blocked-twice',
    summary: 're-entry ×3 — blocked, unblocked, blocked again',
    path: ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_PROGRESS', 'BLOCKED', 'IN_PROGRESS', 'DONE'],
    requiresRoles: ['BLOCKED'],
    dueDateOffsetDays: -7,
    worklogHours: [1, 2],
  },
  {
    id: 'review-rounds',
    summary: 're-entry ×2 — two review rounds',
    path: ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'],
    requiresRoles: ['IN_REVIEW'],
    dueDateOffsetDays: 14,
    worklogHours: [2, 2],
  },
];

/** Roles a scenario needs beyond the three every Jira workflow has. */
export function missingRolesFor(scenario, availableRoles) {
  if (!scenario.requiresRoles) return [];
  if (!availableRoles) return scenario.requiresRoles;
  return scenario.requiresRoles.filter((role) => !availableRoles.has(role));
}

/**
 * Split a path into two phases at a status boundary.
 *
 * Jira stamps every changelog entry with the server's clock and REST offers no
 * way to backdate one, so a path executed in a single run produces durations
 * measured in seconds. Running phase 1 today and phase 2 tomorrow is the only
 * way to get history with real days in it — hence the split. It falls on the
 * midpoint, rounded so phase 1 always makes at least one transition on any path
 * long enough to have one.
 */
export function splitPhases(path) {
  if (path.length <= 2) return { phase1: path, phase2: [] };
  const cut = Math.ceil((path.length + 1) / 2);
  return { phase1: path.slice(0, cut), phase2: path.slice(cut) };
}

/**
 * Count visits per role in an executed path.
 *
 * A "visit" is a maximal run of consecutive identical roles, not an occurrence:
 * if the runner had to collapse two steps onto the same status because the
 * workflow lacked one of them, that is one visit, not two. Jira's own changelog
 * would record no transition there either.
 */
export function countVisits(executedPath) {
  /** @type {Map<Role, number>} */
  const visits = new Map();
  let previous = null;
  for (const role of executedPath) {
    if (role !== previous) visits.set(role, (visits.get(role) ?? 0) + 1);
    previous = role;
  }
  return visits;
}

/**
 * Turn an executed path into the row of the hand-check table for one issue.
 *
 * `expectation` is the claim being tested in RUNBOOK item 9, stated per status
 * before anybody opens the app:
 *
 * - `agrees`      — one visit. The app and Jira's Control Chart must show the
 *                   same figure. A disagreement here means the engine is wrong.
 * - `app-higher`  — more than one visit. The app must show strictly more, and
 *                   the excess is the time in the earlier visits.
 *
 * The `open` flag marks the status the issue is still sitting in, whose figure
 * grows between the two readings and so can only be compared loosely.
 *
 * An issue parked in Done is deliberately **not** open. Its time-in-Done does
 * keep ticking, but nothing compares that figure, and marking the row open told
 * the reader to compare loosely on exactly the rows where they must not: a
 * finished control's whole job is to agree with the Control Chart exactly, and
 * `agrees · open` invites a shrug where item 9 wants a hard stop.
 */
export function expectationsFor(executedPath) {
  const visits = countVisits(executedPath);
  const last = executedPath[executedPath.length - 1];
  const open = last === 'DONE' ? null : last;
  return [...visits.entries()].map(([role, count]) => ({
    role,
    visits: count,
    expectation: count > 1 ? 'app-higher' : 'agrees',
    open: role === open,
  }));
}

/** True when a scenario proves the product's claim rather than controlling for it. */
export function demonstratesReEntry(executedPath) {
  return [...countVisits(executedPath).values()].some((n) => n > 1);
}

/**
 * Below this, the app and the Control Chart show a human the same thing.
 *
 * Transitions walked inside one run land in the same second or two, so a visit
 * that does not straddle the phase-1/phase-2 gap contributes an excess no UI
 * will render as a difference.
 */
export const VISIBLE_EXCESS_MS = 60_000;

/**
 * Collapse a status timeline into per-role visit durations.
 *
 * `timeline` is `{ role, at }` entries in ascending order — the moment the
 * issue *entered* that role — and `endedAt` closes the final, still-running
 * visit. Consecutive identical roles merge into one visit, exactly as
 * `countVisits` counts them, because Jira records no transition there either.
 */
export function visitDurations(timeline, endedAt) {
  const perRole = new Map();
  for (let i = 0; i < timeline.length; i += 1) {
    const { role, at } = timeline[i];
    const until = i + 1 < timeline.length ? timeline[i + 1].at : endedAt;
    const duration = Math.max(0, until - at);
    if (i > 0 && role === timeline[i - 1].role) {
      const durations = perRole.get(role);
      durations[durations.length - 1] += duration;
      continue;
    }
    if (!perRole.has(role)) perRole.set(role, []);
    perRole.get(role).push(duration);
  }
  return perRole;
}

/**
 * How much higher the app should read than a last-visit-only report, per role.
 *
 * The product sums every visit; the Control Chart shows the final one. The
 * difference is therefore everything *before* the last visit — and that is the
 * number the tunnel session can actually check. Saying "app higher" without it
 * is the trap this whole file exists to avoid: on a path walked in one run the
 * claim is true and the two figures still look identical on screen, which reads
 * as a broken engine.
 */
export function excessPerRole(timeline, endedAt) {
  const excess = new Map();
  for (const [role, durations] of visitDurations(timeline, endedAt)) {
    excess.set(
      role,
      durations.slice(0, -1).reduce((sum, duration) => sum + duration, 0),
    );
  }
  return excess;
}

/** Coarse, human-readable duration — the report is read, not parsed. */
export function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}
