import { describe, expect, it } from 'vitest';
import { MemoryStore } from '@jfm/engine';
import type { HistoryRecord } from '@jfm/engine';
import { RecordingSqlExecutor } from '../src/sql/executor.js';
import { SqlMetricsStore } from '../src/sql/sql-store.js';
import { buildHistoryReport } from '../src/reports.js';

/**
 * Which changes a capped audit log keeps.
 *
 * Listing 5's page asks for 500 rows at offset 0 and carries no filter
 * controls, so the store's ordering is not a presentation choice — it decides
 * the only changes a reader can ever reach. Under `changed_at ASC` that was
 * the **oldest** 500: observed on a real 18,736-change project on 2026-10-09,
 * where every reachable row came from the first two seconds of the project's
 * life and the "busiest field" tile described that slice while the total
 * beside it described the project.
 *
 * Nothing asserted the ordering before this file — the whole suite stayed
 * green with it reversed, which is why it survived to a real tenant.
 */

const DAY = 86_400_000;
const T0 = Date.parse('2026-01-01T00:00:00Z');

function change(n: number): HistoryRecord {
  return {
    changeId: `c-${String(n).padStart(4, '0')}`,
    issueId: `i-${n}`,
    issueKey: `FLOW-${n}`,
    projectId: '10000',
    at: T0 + n * DAY,
    field: 'status',
    fieldLabel: 'Status',
    fromValue: 'To Do',
    toValue: 'In Progress',
    fromId: '1',
    toId: '3',
    authorAccountId: 'acc-anna',
    authorDisplayName: 'Anna Weber',
  };
}

async function storeWith(count: number): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.migrate();
  for (let n = 1; n <= count; n += 1) {
    await store.putHistory(`i-${n}`, [change(n)]);
  }
  return store;
}

describe('a capped history read keeps the newest changes', () => {
  it('★ returns the most recent page, not the oldest', async () => {
    const store = await storeWith(50);
    const report = await buildHistoryReport(store, { projectId: '10000', limit: 10 });

    expect(report.totalMatching).toBe(50);
    expect(report.capped).toBe(true);
    // Days 50 down to 41 — not 1 to 10.
    expect(report.records.map((r) => r.issueKey)).toEqual([
      'FLOW-50',
      'FLOW-49',
      'FLOW-48',
      'FLOW-47',
      'FLOW-46',
      'FLOW-45',
      'FLOW-44',
      'FLOW-43',
      'FLOW-42',
      'FLOW-41',
    ]);
  });

  it('puts the newest change first even when the page holds everything', async () => {
    // Ordering is not only a consequence of capping: an uncapped audit log is
    // still read newest-first, and a reader must not see the order flip when
    // a project happens to fit on one page.
    const store = await storeWith(3);
    const report = await buildHistoryReport(store, { projectId: '10000', limit: 500 });

    expect(report.capped).toBe(false);
    expect(report.records.map((r) => r.issueKey)).toEqual(['FLOW-3', 'FLOW-2', 'FLOW-1']);
  });

  it('pages backwards through time without repeating or skipping a change', async () => {
    const store = await storeWith(50);
    const first = await buildHistoryReport(store, { projectId: '10000', limit: 10 });
    const second = await buildHistoryReport(store, { projectId: '10000', limit: 10, offset: 10 });

    expect(second.records[0]?.issueKey).toBe('FLOW-40');
    const keys = [...first.records, ...second.records].map((r) => r.issueKey);
    expect(new Set(keys).size).toBe(20);
  });

  it('is the order the SQL adapter actually asks for', async () => {
    // ★ The behaviour above is proved against `MemoryStore`. The shipping
    // adapter is `SqlMetricsStore`, and the test double cannot sort — so the
    // guard there is the statement text, which is what this adapter's whole
    // verification strategy rests on. Without this, reverting the SQL to
    // `ASC` leaves every assertion above green.
    const sql = new RecordingSqlExecutor();
    const store = new SqlMetricsStore(sql, { migrate: () => Promise.resolve() });
    await store.queryHistory({ projectId: '10000', limit: 10 });

    const statement = sql.sql.find((s) => s.includes('FROM issue_history'));
    expect(statement).toBeDefined();
    expect(statement).toContain('ORDER BY changed_at DESC, change_id DESC');
    expect(statement).not.toContain('changed_at ASC');
  });
});
