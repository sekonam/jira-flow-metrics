import { describe, expect, it } from 'vitest';
import {
  WEIGHTED_SHAPES,
  missingRolesFor,
  pickShape,
  randomDueDateOffsetDays,
  randomIssuePlan,
  randomSummary,
  randomWorklogHours,
} from '../tools/seed-bulk-scenarios.mjs';
import { parseArgs } from '../tools/seed-bulk.mjs';

/** A deterministic sequence, so a test can assert on which shape was picked. */
function sequence(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe('missingRolesFor', () => {
  it('reports nothing missing for a shape with no requirement', () => {
    expect(missingRolesFor({ id: 'x', path: [] }, new Set(['TODO']))).toEqual([]);
  });

  it('reports the roles a workflow lacks', () => {
    const shape = { id: 'x', path: [], requiresRoles: ['BLOCKED', 'IN_REVIEW'] };
    expect(missingRolesFor(shape, new Set(['TODO', 'IN_REVIEW']))).toEqual(['BLOCKED']);
  });

  it('treats an unknown workflow as missing everything the shape requires', () => {
    const shape = { id: 'x', path: [], requiresRoles: ['BLOCKED'] };
    expect(missingRolesFor(shape, undefined)).toEqual(['BLOCKED']);
  });
});

describe('pickShape', () => {
  it('never returns a shape whose required role the workflow lacks', () => {
    const rng = () => 0.999; // always roll the last candidate
    for (let i = 0; i < 50; i += 1) {
      const shape = pickShape(() => Math.random(), new Set(['TODO', 'IN_PROGRESS', 'DONE']));
      expect(shape.requiresRoles ?? []).toEqual([]);
    }
    // A roll near 1 with every role available may legitimately land on a
    // role-requiring shape — assert the opposite: excluding BLOCKED/IN_REVIEW
    // support removes every shape that requires them.
    const restricted = pickShape(rng, new Set(['TODO', 'IN_PROGRESS', 'DONE']));
    expect(restricted.requiresRoles ?? []).toEqual([]);
  });

  it('picks proportionally to weight — an all-zero roll always lands on the first candidate', () => {
    const shape = pickShape(
      () => 0,
      new Set(['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'IN_REVIEW']),
    );
    expect(shape).toBe(WEIGHTED_SHAPES[0]);
  });

  it('throws if no shape qualifies', () => {
    expect(() => pickShape(Math.random, new Set(), [])).toThrow();
  });

  it('includes blocked/review shapes only when those roles are available', () => {
    const withBoth = new Set(['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'IN_REVIEW']);
    const withoutEither = new Set(['TODO', 'IN_PROGRESS', 'DONE']);
    // Roll to the very end of the weighted range: only reachable if the
    // role-gated shapes are still in the candidate pool.
    const highRoll = () => 0.9999999;
    const picked = pickShape(highRoll, withBoth);
    const pickedRestricted = pickShape(highRoll, withoutEither);
    expect(picked.requiresRoles).toBeDefined();
    expect(pickedRestricted.requiresRoles ?? []).toEqual([]);
  });
});

describe('randomDueDateOffsetDays', () => {
  it('stays within the documented [-30, 30] window', () => {
    expect(randomDueDateOffsetDays(() => 0)).toBe(-30);
    expect(randomDueDateOffsetDays(() => 0.999999)).toBe(30);
  });
});

describe('randomWorklogHours', () => {
  it('produces one entry per IN_PROGRESS visit, each 1-8 hours', () => {
    const path = ['TODO', 'IN_PROGRESS', 'TODO', 'IN_PROGRESS', 'DONE'];
    const hours = randomWorklogHours(sequence(0, 0.5, 0.999), path);
    expect(hours).toHaveLength(2);
    for (const h of hours) {
      expect(h).toBeGreaterThanOrEqual(1);
      expect(h).toBeLessThanOrEqual(8);
    }
  });

  it('produces nothing for a path that never reaches IN_PROGRESS', () => {
    expect(randomWorklogHours(Math.random, ['TODO'])).toEqual([]);
  });

  it('counts a maximal run of IN_PROGRESS as one visit, not one per step', () => {
    // No shape in WEIGHTED_SHAPES repeats a role consecutively, but the
    // counting logic should not double-count if one ever did.
    expect(randomWorklogHours(Math.random, ['IN_PROGRESS', 'IN_PROGRESS', 'DONE'])).toHaveLength(1);
  });
});

describe('randomSummary', () => {
  it('always returns a non-empty two-word-or-more string', () => {
    for (let i = 0; i < 20; i += 1) {
      const summary = randomSummary(Math.random);
      expect(summary.length).toBeGreaterThan(0);
      expect(summary.split(' ').length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('randomIssuePlan', () => {
  it('bundles a shape, summary, due date and worklog list consistent with each other', () => {
    const plan = randomIssuePlan(Math.random, new Set(['TODO', 'IN_PROGRESS', 'DONE']));
    expect(plan.path[0]).toBe('TODO');
    expect(typeof plan.summary).toBe('string');
    expect(plan.dueDateOffsetDays).toBeGreaterThanOrEqual(-30);
    expect(plan.dueDateOffsetDays).toBeLessThanOrEqual(30);
    expect(plan.worklogHours).toHaveLength(randomWorklogHours(Math.random, plan.path).length);
  });
});

describe('seed-bulk parseArgs', () => {
  it('defaults to a target of 100 issues and no batch cap', () => {
    const args = parseArgs([]);
    expect(args.target).toBe(100);
    expect(args.batch).toBeNull();
    expect(args.dryRun).toBe(false);
    expect(args.concurrency).toBe(4);
  });

  it('parses --target, --batch, --project, --concurrency and --seed', () => {
    const args = parseArgs([
      '--target',
      '500',
      '--batch',
      '100',
      '--project',
      'JFMB',
      '--concurrency',
      '8',
      '--seed',
      '42',
    ]);
    expect(args).toMatchObject({
      target: 500,
      batch: 100,
      project: 'JFMB',
      concurrency: 8,
      seed: 42,
    });
  });

  it('accepts the = form of every flag', () => {
    const args = parseArgs([
      '--target=250',
      '--batch=50',
      '--project=X',
      '--concurrency=2',
      '--seed=1',
    ]);
    expect(args).toMatchObject({ target: 250, batch: 50, project: 'X', concurrency: 2, seed: 1 });
  });

  it('rejects a non-positive-integer --target', () => {
    expect(() => parseArgs(['--target', '0'])).toThrow();
    expect(() => parseArgs(['--target', 'abc'])).toThrow();
  });

  it('rejects a flag stealing the next flag as its value', () => {
    expect(() => parseArgs(['--project', '--dry-run'])).toThrow();
  });

  it('ignores the pnpm-forwarded "--" separator', () => {
    expect(() => parseArgs(['--', '--dry-run'])).not.toThrow();
    expect(parseArgs(['--', '--dry-run']).dryRun).toBe(true);
  });

  it('rejects an unknown flag', () => {
    expect(() => parseArgs(['--bogus'])).toThrow();
  });
});
