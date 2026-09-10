/**
 * Forge SQL schema.
 *
 * Forge SQL is MySQL-compatible (TiDB), so the DDL below is plain MySQL 8. It
 * is applied by `MetricsStore.migrate()`, which every entry point calls; the
 * statements are all `IF NOT EXISTS`, so migration is idempotent and costs one
 * round trip when there is nothing to do.
 *
 * ## Sizing
 *
 * `issue_status_agg` is the only table that grows with both issues and
 * statuses. At ~100 bytes/row, a 20,000-issue instance touching 8 statuses is
 * ~160,000 rows ≈ 16 MB — the figure the cost model in
 * `docs/TECHNICAL-SPEC.md` is built on.
 *
 * ## Why no ON DELETE CASCADE / foreign keys
 *
 * Issues are deleted rarely and always through `deleteIssue`, which removes
 * every table's rows explicitly. Skipping constraints keeps writes cheap, and
 * cheap writes are the whole reason for choosing SQL over KVS here.
 */

export const SCHEMA_VERSION = 1;

export const CREATE_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS issue_meta (
     issue_id              VARCHAR(32)  NOT NULL,
     issue_key             VARCHAR(64)  NOT NULL,
     project_id            VARCHAR(32)  NOT NULL,
     issue_type_id         VARCHAR(32)  NULL,
     priority_id           VARCHAR(32)  NULL,
     assignee_account_id   VARCHAR(128) NULL,
     current_status_id     VARCHAR(32)  NULL,
     created_at            BIGINT       NOT NULL,
     resolved_at           BIGINT       NULL,
     due_at                BIGINT       NULL,
     history_through_at    BIGINT       NOT NULL,
     truncated             TINYINT(1)   NOT NULL DEFAULT 0,
     updated_at            BIGINT       NOT NULL,
     PRIMARY KEY (issue_id),
     KEY idx_issue_meta_project (project_id, created_at),
     KEY idx_issue_meta_status (project_id, current_status_id)
   )`,

  `CREATE TABLE IF NOT EXISTS issue_status_agg (
     issue_id          VARCHAR(32) NOT NULL,
     status_id         VARCHAR(32) NOT NULL,
     project_id        VARCHAR(32) NOT NULL,
     elapsed_ms        BIGINT      NOT NULL,
     business_ms       BIGINT      NOT NULL,
     entries           INT         NOT NULL,
     last_entered_at   BIGINT      NOT NULL,
     last_exited_at    BIGINT      NULL,
     updated_at        BIGINT      NOT NULL,
     PRIMARY KEY (issue_id, status_id),
     KEY idx_agg_project_status (project_id, status_id),
     KEY idx_agg_project_updated (project_id, updated_at)
   )`,

  `CREATE TABLE IF NOT EXISTS status_meta (
     status_id     VARCHAR(32)  NOT NULL,
     name          VARCHAR(255) NOT NULL,
     category      VARCHAR(16)  NOT NULL,
     first_seen_at BIGINT       NOT NULL,
     last_seen_at  BIGINT       NOT NULL,
     PRIMARY KEY (status_id)
   )`,

  `CREATE TABLE IF NOT EXISTS status_name_history (
     status_id     VARCHAR(32)  NOT NULL,
     name          VARCHAR(255) NOT NULL,
     first_seen_at BIGINT       NOT NULL,
     last_seen_at  BIGINT       NOT NULL,
     PRIMARY KEY (status_id, name)
   )`,

  `CREATE TABLE IF NOT EXISTS worklog (
     worklog_id           VARCHAR(32)  NOT NULL,
     issue_id             VARCHAR(32)  NOT NULL,
     issue_key            VARCHAR(64)  NOT NULL,
     project_id           VARCHAR(32)  NOT NULL,
     author_account_id    VARCHAR(128) NOT NULL,
     author_display_name  VARCHAR(255) NOT NULL,
     started_at           BIGINT       NOT NULL,
     time_spent_ms        BIGINT       NOT NULL,
     created_at           BIGINT       NULL,
     updated_at           BIGINT       NULL,
     PRIMARY KEY (worklog_id),
     KEY idx_worklog_project_started (project_id, started_at),
     KEY idx_worklog_issue (issue_id),
     KEY idx_worklog_author (project_id, author_account_id, started_at)
   )`,

  `CREATE TABLE IF NOT EXISTS issue_history (
     change_id           VARCHAR(64)  NOT NULL,
     issue_id            VARCHAR(32)  NOT NULL,
     issue_key           VARCHAR(64)  NOT NULL,
     project_id          VARCHAR(32)  NOT NULL,
     changed_at          BIGINT       NOT NULL,
     author_account_id   VARCHAR(128) NULL,
     author_display_name VARCHAR(255) NOT NULL,
     field               VARCHAR(128) NOT NULL,
     field_label         VARCHAR(255) NOT NULL,
     from_value          TEXT         NULL,
     to_value            TEXT         NULL,
     from_id             VARCHAR(128) NULL,
     to_id               VARCHAR(128) NULL,
     PRIMARY KEY (change_id),
     KEY idx_history_project_time (project_id, changed_at),
     KEY idx_history_issue (issue_id, changed_at),
     KEY idx_history_field (project_id, field, changed_at)
   )`,

  `CREATE TABLE IF NOT EXISTS index_state (
     project_id        VARCHAR(32) NOT NULL,
     state             VARCHAR(16) NOT NULL,
     backfill_cursor   VARCHAR(512) NULL,
     backfill_from     BIGINT      NULL,
     issues_processed  INT         NOT NULL DEFAULT 0,
     issues_total      INT         NULL,
     last_processed_at BIGINT      NULL,
     last_error        VARCHAR(1024) NULL,
     started_at        BIGINT      NULL,
     updated_at        BIGINT      NOT NULL,
     PRIMARY KEY (project_id)
   )`,

  `CREATE TABLE IF NOT EXISTS app_settings (
     scope_key  VARCHAR(64)   NOT NULL,
     settings   TEXT          NOT NULL,
     updated_at BIGINT        NOT NULL,
     PRIMARY KEY (scope_key)
   )`,

  `CREATE TABLE IF NOT EXISTS schema_meta (
     id      TINYINT NOT NULL,
     version INT     NOT NULL,
     PRIMARY KEY (id)
   )`,
];

/**
 * The schema as named migrations.
 *
 * Forge SQL will not accept DDL through `prepare().execute()` — that path
 * answers `ForgeSQLError: Unknown SQL execution error`, which is what the first
 * deployed build did on every issue event. Schema has to go through
 * `migrationRunner`, which records each migration by name and skips the ones it
 * has already applied.
 *
 * Names are derived from the statement rather than written out beside it, so
 * they cannot drift from the table they create. They are also the migration's
 * identity forever: renaming one makes Forge run it again.
 */
export const MIGRATIONS: readonly { name: string; statement: string }[] = CREATE_STATEMENTS.map(
  (statement) => {
    const match = /CREATE TABLE IF NOT EXISTS\s+(\w+)/i.exec(statement);
    if (match === null)
      throw new Error(`Cannot derive a migration name from: ${statement.slice(0, 60)}`);
    return { name: `v${String(SCHEMA_VERSION)}-create-${match[1]}`, statement };
  },
);

/** Rows to delete, in order, when an issue is removed from Jira. */
export const DELETE_ISSUE_STATEMENTS: readonly string[] = [
  'DELETE FROM issue_status_agg WHERE issue_id = ?',
  'DELETE FROM worklog WHERE issue_id = ?',
  'DELETE FROM issue_history WHERE issue_id = ?',
  'DELETE FROM issue_meta WHERE issue_id = ?',
];

/**
 * Rough per-row byte costs, used by the in-app usage panel and by the cost
 * model in the technical spec. These are estimates of stored size including
 * index overhead, not measurements — labelled as such wherever displayed.
 */
export const ESTIMATED_ROW_BYTES = {
  issue_meta: 160,
  issue_status_agg: 100,
  worklog: 200,
  issue_history: 320,
  status_meta: 80,
  status_name_history: 80,
  index_state: 120,
  app_settings: 512,
} as const;
