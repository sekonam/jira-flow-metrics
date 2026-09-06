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
    bindParams(params: readonly unknown[]): { execute(): Promise<{ rows?: T[] }> };
    execute(): Promise<{ rows?: T[] }>;
  };
}

/**
 * Adapt the `@forge/sql` default export to {@link SqlExecutor}.
 *
 * ⚠️ **UNVERIFIED against the live platform.** The call shape follows
 * Atlassian's Forge SQL documentation (`sql.prepare(...).bindParams(...)
 * .execute()` returning `{ rows }`), but it has never been executed here.
 * The first task in `docs/RUNBOOK.md` after `forge login` is to confirm it in a
 * `forge tunnel` session and fix this function if the SDK differs.
 */
export function forgeSqlExecutor(sql: ForgeSqlLike): SqlExecutor {
  const run = async <T>(statement: string, params: readonly unknown[] = []): Promise<T[]> => {
    const prepared = sql.prepare<T>(statement);
    const result =
      params.length === 0 ? await prepared.execute() : await prepared.bindParams(params).execute();
    return result.rows ?? [];
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

function normalise(statement: string): string {
  return statement.replace(/\s+/g, ' ').trim();
}
