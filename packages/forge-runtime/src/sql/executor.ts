/**
 * The one-method boundary between this codebase and Forge SQL.
 *
 * ## Why the indirection exists
 *
 * Nothing in this repository has ever executed against a real Forge SQL
 * instance — there is no Atlassian developer account here and `forge deploy`
 * cannot be run (see `docs/RUNBOOK.md`). Isolating every call behind this
 * interface means:
 *
 * 1. all the statement-building and row-mapping logic is ordinary code that
 *    the test suite covers properly;
 * 2. the untested surface is reduced to `forgeSqlExecutor()` below, roughly
 *    twenty lines, which is the only thing the first `forge tunnel` session has
 *    to verify.
 *
 * **Do not treat the Forge SQL adapter as verified until it has run against a
 * real instance.** The MemoryStore in `@jfm/engine` is what the tests exercise.
 */

export interface SqlExecutor {
  /** Run a statement that returns rows. */
  query<T>(statement: string, params?: readonly unknown[]): Promise<T[]>;
  /** Run a statement that returns no rows. */
  execute(statement: string, params?: readonly unknown[]): Promise<void>;
}

/**
 * Shape of the `@forge/sql` default export this adapter relies on.
 * Declared structurally rather than imported so that the package builds and
 * tests without `@forge/sql` installed (it is an optional peer dependency and
 * only resolves inside a Forge bundle).
 */
export interface ForgeSqlLike {
  prepare<T = unknown>(
    statement: string,
  ): {
    /**
     * **Variadic**, not array-taking: `bindParams(a, b)`, never
     * `bindParams([a, b])`. This was declared as taking an array — a
     * reasonable reading of the documentation, and wrong. Forge accepted the
     * array as a single argument and answered every statement with
     * `ForgeSQLError: Unknown SQL execution error`, whose `context.debug`
     * field said what the message never did: `argument mismatch, need 2 but
     * got 1`. `@forge/sql`'s own migration runner is the reference —
     * `prepare(q).bindParams(migration.name)`.
     */
    bindParams(...params: readonly unknown[]): { execute(): Promise<{ rows?: T[] }> };
    execute(): Promise<{ rows?: T[] }>;
  };
}

/**
 * Adapt the `@forge/sql` default export to {@link SqlExecutor}.
 *
 * ✔ **Verified against the live platform** on 2026-09-10, and it did differ
 * from the reading of the documentation this was written against: `bindParams`
 * is variadic. Passing the array bound one argument where the statement wanted
 * several, and Forge reported only `Unknown SQL execution error` — the reason
 * `describeError` in `handlers.ts` now unpacks a platform error's own fields,
 * because `context.debug` held the actual answer.
 */
export function forgeSqlExecutor(sql: ForgeSqlLike): SqlExecutor {
  const run = async <T>(statement: string, params: readonly unknown[] = []): Promise<T[]> => {
    try {
      const prepared = sql.prepare<T>(statement);
      const result =
        params.length === 0
          ? await prepared.execute()
          : await prepared.bindParams(...params).execute();
      return result.rows ?? [];
    } catch (cause: unknown) {
      // Forge answers a failed statement with `ForgeSQLError: Unknown SQL
      // execution error` and nothing else — no statement, no position. In an
      // environment whose only feedback channel is `forge logs`, that is not
      // enough to act on, so the statement is attached here. It is static
      // text from `schema.ts` or `sql-store.ts` and carries no user data;
      // parameters are deliberately not logged, because those do.
      throw new Error(`Forge SQL rejected: ${statement.replace(/\s+/g, ' ').slice(0, 160)}`, {
        cause,
      });
    }
  };
  return {
    query: run,
    execute: async (statement, params) => {
      await run(statement, params);
    },
  };
}

/**
 * An executor that records every statement instead of running it.
 * Used by the adapter's tests, and useful in a tunnel session to see exactly
 * what the store would emit before letting it write anything.
 */
export class RecordingSqlExecutor implements SqlExecutor {
  readonly statements: { statement: string; params: readonly unknown[] }[] = [];

  constructor(private readonly rowsFor: (statement: string) => unknown[] = () => []) {}

  query<T>(statement: string, params: readonly unknown[] = []): Promise<T[]> {
    this.statements.push({ statement: normalise(statement), params });
    return Promise.resolve(this.rowsFor(statement) as T[]);
  }

  execute(statement: string, params: readonly unknown[] = []): Promise<void> {
    this.statements.push({ statement: normalise(statement), params });
    return Promise.resolve();
  }

  /** Statements emitted, whitespace-normalised, in order. */
  get sql(): string[] {
    return this.statements.map((s) => s.statement);
  }

  clear(): void {
    this.statements.length = 0;
  }
}

/**
 * A `RecordingSqlExecutor` that also **remembers what was written** to
 * `app_settings`.
 *
 * `RecordingSqlExecutor` answers every SELECT with no rows, which is exactly
 * right for asserting on statement shape and quietly wrong for anything that
 * writes and then reads. Every stored setting in this product is that shape:
 * extending the history window and saving an SLA goal are both a `put`
 * followed by a `get`, and the whole point is that the second sees the first.
 *
 * Without this, a harness built on `RecordingSqlExecutor` shows both of those
 * as having silently failed — and cannot see the sharper consequence:
 * `setHistoryWindow` writes the setting and then calls `startBackfill`, which
 * **re-reads** `backfillMonths` to compute the backfill's lower bound. Against
 * a store that forgets, the re-index a user just asked for covers the old
 * range while the UI reports the new one.
 *
 * Only `app_settings` is modelled, because it is the only table reached
 * through this port — the metrics tables go through `MetricsStore`, whose
 * in-memory reference implementation already persists.
 */
export class SettingsSqlExecutor extends RecordingSqlExecutor {
  private readonly rows = new Map<string, string>();

  override query<T>(statement: string, params: readonly unknown[] = []): Promise<T[]> {
    void super.query(statement, params);
    if (!statement.includes('app_settings')) return Promise.resolve([]);
    // `SettingsStore.get` selects the project scope and the global one in a
    // single `IN (?, ?)` and chooses between them in code — see the comment
    // there about Forge SQL refusing a bound parameter inside ORDER BY.
    const found = params
      .filter((param): param is string => typeof param === 'string')
      .flatMap((scope) => {
        const settings = this.rows.get(scope);
        return settings === undefined ? [] : [{ scope_key: scope, settings }];
      });
    return Promise.resolve(found as T[]);
  }

  override execute(statement: string, params: readonly unknown[] = []): Promise<void> {
    void super.execute(statement, params);
    if (statement.includes('app_settings')) {
      this.rows.set(String(params[0]), String(params[1]));
    }
    return Promise.resolve();
  }
}

function normalise(statement: string): string {
  return statement.replace(/\s+/g, ' ').trim();
}

/**
 * Applying schema, which Forge SQL treats as a separate thing from querying.
 *
 * Kept apart from {@link SqlExecutor} because it is a different platform API,
 * not a different statement: `prepare().execute()` runs queries, and DDL sent
 * that way is refused.
 */
export interface SqlMigrator {
  migrate(migrations: readonly { name: string; statement: string }[]): Promise<void>;
}

/** The part of `@forge/sql`'s `migrationRunner` this adapter uses. */
export interface ForgeMigrationRunnerLike {
  enqueue(name: string, statement: string): ForgeMigrationRunnerLike;
  run(): Promise<string[]>;
}

/**
 * Adapt `@forge/sql`'s `migrationRunner` to {@link SqlMigrator}.
 *
 * ✔ **Verified against the live platform** on 2026-09-10: the first deployed
 * build failed every issue event with `ForgeSQLError: Unknown SQL execution
 * error` because `migrate()` pushed `CREATE TABLE` through the query path.
 *
 * Forge records applied migrations by name, so calling this repeatedly never
 * re-applies DDL — but it is **not free to call repeatedly**: verified live
 * on 2026-09-11 bulk-seeding 300 issues into one project, where every event
 * calling this once each tripped `ForgeSQLError: RATE_LIMIT_EXCEEDED` within
 * minutes. Each call still costs a real platform request regardless of
 * whether it does anything. `SqlMetricsStore.migrate` is what actually keeps
 * this cheap, by calling in here at most once per store instance.
 */
export function forgeSqlMigrator(runner: ForgeMigrationRunnerLike): SqlMigrator {
  return {
    async migrate(migrations) {
      let queued = runner;
      for (const { name, statement } of migrations) queued = queued.enqueue(name, statement);
      try {
        await queued.run();
      } catch (cause: unknown) {
        throw new Error(
          `Forge SQL migration failed (${migrations.map((m) => m.name).join(', ')})`,
          { cause },
        );
      }
    },
  };
}
