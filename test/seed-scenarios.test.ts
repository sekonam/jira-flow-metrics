import { describe, expect, it } from 'vitest';
import { isoDaysFromNow, parseArgs } from '../tools/seed-dev-site.mjs';
import {
  SCENARIOS,
  countVisits,
  demonstratesReEntry,
  expectationsFor,
  matchRole,
  missingRolesFor,
  rolesFromStatuses,
  splitPhases,
} from '../tools/seed-scenarios.mjs';

/**
 * The seeder's arithmetic.
 *
 * `tools/seed-dev-site.mjs` writes to somebody's Jira site and cannot be tested
 * here. What can be tested is the part that decides *what the first tunnel
 * session should see* — the expectation table that RUNBOOK item 9 is checked
 * against. If that table is wrong the session concludes the engine is broken
 * when it is not, or worse, that it is fine when it is not.
 */

describe('matchRole', () => {
  it('maps the names a default Jira template actually uses', () => {
    expect(matchRole('To Do')).toBe('TODO');
    expect(matchRole('In Progress')).toBe('IN_PROGRESS');
    expect(matchRole('Done')).toBe('DONE');
  });

  it('folds case and collapses whitespace', () => {
    expect(matchRole('  IN   PROGRESS  ')).toBe('IN_PROGRESS');
    expect(matchRole('in progress')).toBe('IN_PROGRESS');
  });

  it('accepts the renamed equivalents a site may have instead', () => {
    expect(matchRole('Open')).toBe('TODO');
    expect(matchRole('Selected for Development')).toBe('TODO');
    expect(matchRole('On Hold')).toBe('BLOCKED');
    expect(matchRole('Code Review')).toBe('IN_REVIEW');
    expect(matchRole('Closed')).toBe('DONE');
  });

  it('returns null rather than guessing at a name it does not know', () => {
    // Whole-name matching, not substring: "Ready for Review" contains
    // "review" but is not a review status, and a substring match would have
    // claimed it. Unrecognised is the safe answer — the runner skips the step
    // and records that it did.
    expect(matchRole('Ready for Review')).toBeNull();
    expect(matchRole('Awaiting Customer')).toBeNull();
    expect(matchRole('')).toBeNull();
    expect(matchRole(undefined)).toBeNull();
  });
});

describe('countVisits', () => {
  it('counts a status once per uninterrupted stay', () => {
    const visits = countVisits(['TODO', 'IN_PROGRESS', 'DONE']);
    expect(visits.get('IN_PROGRESS')).toBe(1);
  });

  it('counts each return separately — the entire product claim', () => {
    const visits = countVisits(['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_PROGRESS', 'DONE']);
    expect(visits.get('IN_PROGRESS')).toBe(2);
    expect(visits.get('BLOCKED')).toBe(1);
  });

  it('collapses consecutive duplicates into one visit', () => {
    // The runner emits these when the workflow lacked the status in between,
    // so no transition was recorded and Jira saw no second visit either.
    expect(countVisits(['TODO', 'IN_PROGRESS', 'IN_PROGRESS', 'DONE']).get('IN_PROGRESS')).toBe(1);
  });

  it('handles a path that never moved', () => {
    expect([...countVisits(['TODO']).entries()]).toEqual([['TODO', 1]]);
  });
});

describe('expectationsFor', () => {
  it('predicts agreement with the Control Chart on single visits', () => {
    const rows = expectationsFor(['TODO', 'IN_PROGRESS', 'DONE']);
    expect(rows.every((r) => r.expectation === 'agrees')).toBe(true);
  });

  it('predicts the app reads higher exactly where a status was re-entered', () => {
    const rows = expectationsFor(['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_PROGRESS', 'DONE']);
    const byRole = new Map(rows.map((r) => [r.role, r]));
    expect(byRole.get('IN_PROGRESS')?.expectation).toBe('app-higher');
    expect(byRole.get('BLOCKED')?.expectation).toBe('agrees');
    expect(byRole.get('TODO')?.expectation).toBe('agrees');
  });

  it('flags the status the issue is still sitting in', () => {
    const rows = expectationsFor(['TODO', 'IN_PROGRESS', 'BLOCKED']);
    expect(rows.find((r) => r.open)?.role).toBe('BLOCKED');
    expect(rows.filter((r) => r.open)).toHaveLength(1);
  });
});

describe('splitPhases', () => {
  it('leaves a path with nothing to transition in phase 1', () => {
    expect(splitPhases(['TODO'])).toEqual({ phase1: ['TODO'], phase2: [] });
  });

  it('gives phase 1 at least one transition on any path that has one', () => {
    const { phase1 } = splitPhases(['TODO', 'IN_PROGRESS', 'DONE']);
    expect(phase1.length).toBeGreaterThanOrEqual(2);
  });

  it('reassembles into the original path', () => {
    for (const scenario of SCENARIOS) {
      const { phase1, phase2 } = splitPhases(scenario.path);
      expect([...phase1, ...phase2]).toEqual(scenario.path);
    }
  });

  it('puts a re-entry on both sides of the split where the path allows', () => {
    // The point of phasing is that the *gap between two visits* spans real
    // days. A split that left every visit of a status in one phase would give
    // a long total but a re-entry gap of seconds.
    const { phase1, phase2 } = splitPhases([
      'TODO',
      'IN_PROGRESS',
      'BLOCKED',
      'IN_PROGRESS',
      'BLOCKED',
      'IN_PROGRESS',
      'DONE',
    ]);
    expect(phase1).toContain('IN_PROGRESS');
    expect(phase2).toContain('IN_PROGRESS');
  });
});

describe('the scenario set', () => {
  it('has unique ids', () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
  });

  it('starts every path in TODO, where a created issue lands', () => {
    expect(SCENARIOS.every((s) => s.path[0] === 'TODO')).toBe(true);
  });

  it('keeps every control free of re-entry', () => {
    // A control that quietly gained a second visit would stop being evidence
    // of anything, and the disagreement it then showed would read as a bug.
    const controls = SCENARIOS.filter((s) => s.id.startsWith('control-'));
    expect(controls.length).toBeGreaterThanOrEqual(3);
    for (const control of controls) {
      expect(demonstratesReEntry(control.path)).toBe(false);
    }
  });

  it('gives every non-control a re-entry to demonstrate', () => {
    const cases = SCENARIOS.filter((s) => !s.id.startsWith('control-'));
    expect(cases.length).toBeGreaterThanOrEqual(4);
    for (const scenario of cases) {
      expect(demonstratesReEntry(scenario.path)).toBe(true);
    }
  });

  it('leaves issues open in more than one status, so WIP aging has a spread', () => {
    const openStatuses = SCENARIOS.filter((s) => s.leaveOpen).map((s) => s.path[s.path.length - 1]);
    expect(openStatuses.length).toBeGreaterThanOrEqual(3);
    expect(new Set(openStatuses).size).toBeGreaterThanOrEqual(2);
  });

  it('spans breached and unbreached due dates, so SLA reports show both', () => {
    const due = SCENARIOS.map((s) => s.dueDateOffsetDays).filter((d) => typeof d === 'number');
    expect(due.some((d) => d < 0)).toBe(true);
    expect(due.some((d) => d > 0)).toBe(true);
  });
});

describe('workflow portability', () => {
  const UNIVERSAL = new Set(['TODO', 'IN_PROGRESS', 'DONE']);

  it('builds every unconditional scenario from statuses any Jira workflow has', () => {
    // Learned from a dry run against a stock developer site: a path through
    // Blocked or In Review degrades to nothing when the workflow lacks that
    // status, because dropping the middle of `In Progress → Blocked → In
    // Progress` leaves one uninterrupted visit. Anything needing more than the
    // three universal statuses must declare `requiresRoles` and be skipped
    // outright instead.
    for (const scenario of SCENARIOS.filter((s) => !s.requiresRoles)) {
      for (const role of scenario.path) {
        expect(UNIVERSAL.has(role), `${scenario.id} uses ${role}`).toBe(true);
      }
    }
  });

  it('still demonstrates re-entry on a three-status workflow', () => {
    const portable = SCENARIOS.filter(
      (s) => !s.requiresRoles && !s.id.startsWith('control-'),
    ).filter((s) => demonstratesReEntry(s.path));
    expect(portable.length).toBeGreaterThanOrEqual(4);
  });

  it('declares requiresRoles for every scenario that needs a richer workflow', () => {
    for (const scenario of SCENARIOS) {
      const needed = scenario.path.filter((role) => !UNIVERSAL.has(role));
      for (const role of needed) {
        expect(scenario.requiresRoles ?? [], `${scenario.id} needs ${role}`).toContain(role);
      }
    }
  });
});

describe('missingRolesFor', () => {
  const scenario = { id: 'x', requiresRoles: ['BLOCKED', 'IN_REVIEW'], path: [] };

  it('is empty for a scenario that requires nothing', () => {
    expect(missingRolesFor({ id: 'y', path: [] }, new Set(['TODO']))).toEqual([]);
  });

  it('reports only the roles the workflow lacks', () => {
    expect(missingRolesFor(scenario, new Set(['TODO', 'BLOCKED']))).toEqual(['IN_REVIEW']);
    expect(missingRolesFor(scenario, new Set(['BLOCKED', 'IN_REVIEW']))).toEqual([]);
  });

  it('treats an undiscoverable workflow as lacking everything optional', () => {
    // The project may not exist yet, so its statuses cannot be inspected.
    // Assuming the richer statuses are present would half-walk the path.
    expect(missingRolesFor(scenario, null)).toEqual(['BLOCKED', 'IN_REVIEW']);
  });
});

describe('rolesFromStatuses', () => {
  /** Exactly what a Russian-language Jira developer site returns. */
  const RUSSIAN = [
    { name: 'К выполнению', statusCategory: { key: 'new' } },
    { name: 'В работе', statusCategory: { key: 'indeterminate' } },
    { name: 'Готово', statusCategory: { key: 'done' } },
    { name: 'В процессе проверки', statusCategory: { key: 'indeterminate' } },
  ];

  it('resolves a Russian workflow, names and all', () => {
    // The bug this pins: matching English names only, the seeder resolved
    // nothing, skipped every transition, and created nine issues with no
    // status history whatsoever.
    const roles = rolesFromStatuses(RUSSIAN);
    expect(roles.get('TODO')).toBe('К выполнению');
    expect(roles.get('IN_PROGRESS')).toBe('В работе');
    expect(roles.get('DONE')).toBe('Готово');
    expect(roles.get('IN_REVIEW')).toBe('В процессе проверки');
  });

  it('keeps In Review distinct from In Progress despite the shared category', () => {
    const roles = rolesFromStatuses(RUSSIAN);
    expect(roles.get('IN_PROGRESS')).not.toBe(roles.get('IN_REVIEW'));
  });

  it('resolves the three core roles in a language it has never seen', () => {
    // Category keys are the same in every locale, which is the whole reason
    // they are consulted rather than trusted to a translation table.
    const japanese = [
      { name: '未着手', statusCategory: { key: 'new' } },
      { name: '進行中', statusCategory: { key: 'indeterminate' } },
      { name: '完了', statusCategory: { key: 'done' } },
    ];
    const roles = rolesFromStatuses(japanese);
    expect(roles.get('TODO')).toBe('未着手');
    expect(roles.get('IN_PROGRESS')).toBe('進行中');
    expect(roles.get('DONE')).toBe('完了');
    expect(roles.has('IN_REVIEW')).toBe(false);
  });

  it('never lets one status serve two roles', () => {
    // A site whose only `indeterminate` status is called "In Review" must not
    // have it double as In Progress: the seeder would then walk
    // `In Review → In Progress → In Review` as one uninterrupted visit and
    // record a re-entry that Jira never saw.
    const roles = rolesFromStatuses([
      { name: 'To Do', statusCategory: { key: 'new' } },
      { name: 'In Review', statusCategory: { key: 'indeterminate' } },
      { name: 'Done', statusCategory: { key: 'done' } },
    ]);
    expect(roles.get('IN_REVIEW')).toBe('In Review');
    expect(roles.has('IN_PROGRESS')).toBe(false);
    expect(new Set(roles.values()).size).toBe(roles.size);
  });

  it('prefers the name over the category when both apply', () => {
    const roles = rolesFromStatuses([
      { name: 'Blocked', statusCategory: { key: 'indeterminate' } },
      { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    ]);
    expect(roles.get('BLOCKED')).toBe('Blocked');
    expect(roles.get('IN_PROGRESS')).toBe('In Progress');
  });

  it('tolerates a status with no category', () => {
    expect(rolesFromStatuses([{ name: 'Mystery' }]).size).toBe(0);
  });
});

describe('parseArgs', () => {
  it('ignores the bare `--` that pnpm forwards', () => {
    // `pnpm run seed:dev-site -- --dry-run` is the command START-HERE.md and
    // the script's own header both document, and pnpm passes the separator
    // through rather than swallowing it as npm does. Rejecting it made every
    // documented invocation exit 1 before doing anything.
    expect(parseArgs(['--', '--dry-run']).dryRun).toBe(true);
    expect(parseArgs(['--', '--phase', '2']).phase).toBe('2');
    expect(parseArgs(['--', '--project=ABC']).project).toBe('ABC');
  });

  it('still reads the flags without a separator', () => {
    expect(parseArgs(['--dry-run']).dryRun).toBe(true);
    expect(parseArgs(['--phase=1']).phase).toBe('1');
  });

  it('defaults to walking the whole path, writing for real', () => {
    const args = parseArgs([]);
    expect(args.phase).toBe('all');
    expect(args.dryRun).toBe(false);
    expect(args.project).toBeNull();
  });
});

describe('expectationsFor — the open marker', () => {
  it('does not mark a finished issue open', () => {
    // A control that ran straight through is the one row that must agree with
    // the Control Chart *exactly*. Marking its Done row `open` told the reader
    // to compare loosely there, softening the check that RUNBOOK item 9 leans
    // on hardest.
    const rows = expectationsFor(['TODO', 'IN_PROGRESS', 'DONE']);
    expect(rows.every((row) => row.open === false)).toBe(true);
  });

  it('marks the status an in-flight issue is actually sitting in', () => {
    const rows = expectationsFor(['TODO', 'IN_PROGRESS', 'TODO', 'IN_PROGRESS']);
    expect(rows.find((row) => row.role === 'IN_PROGRESS')?.open).toBe(true);
    expect(rows.find((row) => row.role === 'TODO')?.open).toBe(false);
  });

  it('marks a reopened-and-still-open issue on its current status, not on Done', () => {
    const rows = expectationsFor(['TODO', 'IN_PROGRESS', 'DONE', 'IN_PROGRESS']);
    expect(rows.find((row) => row.role === 'IN_PROGRESS')?.open).toBe(true);
    expect(rows.find((row) => row.role === 'DONE')?.open).toBe(false);
  });
});

describe('isoDaysFromNow', () => {
  it('formats the local calendar date, never the UTC one', () => {
    // `toISOString()` converts to UTC before slicing, so a late-evening run in
    // a negative offset and an early-morning run in a positive one each land a
    // day off. Both ends are pinned so that wherever this runs, at least one of
    // them differs from UTC and would catch a regression.
    expect(isoDaysFromNow(0, new Date(2026, 2, 15, 23, 30))).toBe('2026-03-15');
    expect(isoDaysFromNow(0, new Date(2026, 2, 15, 0, 30))).toBe('2026-03-15');
  });

  it('shifts by whole days in either direction, and pads', () => {
    const base = new Date(2026, 2, 15, 12, 0);
    expect(isoDaysFromNow(-3, base)).toBe('2026-03-12');
    expect(isoDaysFromNow(7, base)).toBe('2026-03-22');
    expect(isoDaysFromNow(-14, base)).toBe('2026-03-01');
  });

  it('does not mutate the date it was handed', () => {
    // It is called once per scenario off the same clock; a mutating helper
    // would make every due date relative to the previous one.
    const base = new Date(2026, 2, 15, 12, 0);
    isoDaysFromNow(30, base);
    expect(base.getDate()).toBe(15);
  });
});

describe('parseArgs — rejecting a malformed command line', () => {
  it('refuses to swallow a flag as the value of another flag', () => {
    // `--project --dry-run` used to set the project key to "--dry-run" and
    // leave dryRun false, so a command that reads as a simulation writes to a
    // real Jira site. That is the one misparse with a blast radius.
    expect(() => parseArgs(['--project', '--dry-run'])).toThrow(/--project needs a value/);
    expect(() => parseArgs(['--phase', '--dry-run'])).toThrow(/--phase needs a value/);
  });

  it('refuses a value-taking flag with nothing after it', () => {
    expect(() => parseArgs(['--project'])).toThrow(/--project needs a value/);
    expect(() => parseArgs(['--phase'])).toThrow(/--phase needs a value/);
    expect(() => parseArgs(['--dwell'])).toThrow(/--dwell needs a value/);
  });

  it('refuses a dwell that is not a non-negative number', () => {
    // `Number('abc')` is NaN, which failed the `> 0` guard silently: the run
    // proceeded with no dwell at all rather than saying the flag was garbage.
    expect(() => parseArgs(['--dwell=abc'])).toThrow(/non-negative number/);
    expect(() => parseArgs(['--dwell=-5'])).toThrow(/non-negative number/);
    expect(parseArgs(['--dwell=0']).dwellSeconds).toBe(0);
    expect(parseArgs(['--dwell', '90']).dwellSeconds).toBe(90);
  });

  it('refuses an unknown flag and an out-of-range phase', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/Unknown argument/);
    expect(() => parseArgs(['--phase=3'])).toThrow(/must be 1, 2 or all/);
  });

  it('throws rather than exiting, so a bad flag cannot kill the test run', () => {
    // The argument bugs above survived precisely because the validation used
    // `process.exit`, which no test can call without taking vitest with it.
    expect(() => parseArgs(['--bogus'])).toThrow(Error);
  });

  it('defaults every flag it did not see', () => {
    expect(parseArgs([])).toEqual({
      phase: 'all',
      dryRun: false,
      project: null,
      dwellSeconds: 0,
      reset: false,
      help: false,
    });
  });
});
