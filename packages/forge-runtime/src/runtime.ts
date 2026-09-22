import {
  DEFAULT_BACKFILL_OPTIONS,
  ESTIMATED_ROW_BYTES,
  buildStatusReport,
  handleIssueDeleted,
  handleIssueUpdated,
  initialIndexState,
  runBackfillSlice,
  statusReportToCsv,
  systemClock,
  toProgress,
  type BackfillProgress,
  type Clock,
  type DurationBasis,
  type IngestConfig,
  type IngestDatasets,
  type JiraApi,
  type JiraIssueUpdatedEvent,
  type JiraProjectRef,
  type Logger,
  type MetricsStore,
  type Millis,
  type Scheduler,
  type Sleeper,
  type StatusMetaRow,
  type StatusReport,
} from '@jfm/engine';
import { buildIssueTimeline, type IssueTimelineReport } from './issue-timeline.js';
import {
  MAX_SLA_GOALS,
  type ProjectSettings,
  type SettingsStore,
  type StoredSlaGoal,
} from './settings.js';
import {
  buildAgingReport,
  buildFlowReport,
  buildHistoryReport,
  buildSlaReport,
  buildWorklogReport,
  type AgingReport,
  type FlowReport,
  type HistoryReport,
  type HistoryReportRequest,
  type SlaCountedGoal,
  type SlaReport,
  type WorklogReport,
  type WorklogReportRequest,
} from './reports.js';

/**
 * Per-listing runtime wiring.
 *
 * Each of the five Marketplace listings is the *same* object built with a
 * different `datasets` value and a different UI. Nothing below is
 * listing-specific, which is the portfolio thesis expressed in code: listings
 * 2-5 cost presentation work, not engine work.
 */

export interface ListingRuntimeDeps {
  readonly api: JiraApi;
  readonly store: MetricsStore;
  readonly settings: SettingsStore;
  readonly scheduler: Scheduler;
  readonly sleeper: Sleeper;
  readonly clock?: Clock;
  readonly logger?: Logger;
}

export interface ListingRuntimeOptions {
  readonly listingId: string;
  readonly datasets: IngestDatasets;
  /** Overrides for the ingest tuning constants. Defaults are conservative. */
  readonly pageSize?: number;
  readonly maxChangelogEntries?: number;
  readonly issuesPerSlice?: number;
  readonly timeBudgetMs?: number;
  readonly throttleMs?: number;
}

export interface StatusReportRequest {
  readonly projectId: string;
  readonly basis?: DurationBasis;
  readonly limit?: number;
  readonly offset?: number;
  readonly assigneeAccountIds?: readonly string[];
  readonly issueTypeIds?: readonly string[];
  readonly createdFrom?: Millis;
  readonly createdTo?: Millis;
}

export interface ReportEnvelope {
  readonly report: StatusReport;
  readonly progress: BackfillProgress | null;
  /**
   * True when the backfill has not finished, so the report is over a partial
   * corpus. The UI must show this; a metrics product that silently reports
   * incomplete data is the failure mode this repository is built to avoid.
   */
  readonly partial: boolean;
  readonly settings: ProjectSettings;
}

export class ListingRuntime {
  private readonly clock: Clock;

  constructor(
    private readonly deps: ListingRuntimeDeps,
    private readonly options: ListingRuntimeOptions,
  ) {
    this.clock = deps.clock ?? systemClock;
  }

  /**
   * Drop per-invocation caches.
   *
   * The apps memoise their `ListingRuntime` at module scope so a warm Forge
   * container does not rebuild it on every event. That memoisation would
   * otherwise make `SettingsStore`'s cache outlive the invocation, so a
   * customer who changes their working calendar would keep seeing the old
   * numbers until the container recycled — a silently-wrong report, which is
   * the failure mode this codebase exists to avoid. Every entry point calls
   * this first.
   */
  beginInvocation(): void {
    this.deps.settings.clearCache();
  }

  /**
   * May the calling user browse this project?
   *
   * Delegates to the Jira port, which asks Jira **as the user**. Everything
   * else this runtime does reads as the app, so this is the only place a
   * caller's own Jira permissions are consulted — and every project-scoped
   * resolver goes through it before returning a single row.
   */
  canBrowseProject(projectId: string): Promise<boolean> {
    return this.deps.api.canBrowseProject(projectId);
  }

  /** Build the ingest config for one project, using its stored calendar. */
  async ingestConfig(projectId: string): Promise<IngestConfig> {
    const settings = await this.deps.settings.get(projectId);
    const base: IngestConfig = {
      datasets: this.options.datasets,
      calendar: settings.calendar,
      pageSize: this.options.pageSize ?? 50,
      maxChangelogEntries: this.options.maxChangelogEntries ?? 2000,
      retry: { sleeper: this.deps.sleeper },
    };
    return this.deps.logger === undefined ? base : { ...base, logger: this.deps.logger };
  }

  /** `avi:jira:created:issue` and `avi:jira:updated:issue`. */
  async onIssueChanged(event: JiraIssueUpdatedEvent, projectIdHint: string): Promise<void> {
    await this.deps.store.migrate();
    const config = await this.ingestConfig(projectIdHint);
    await handleIssueUpdated(event, {
      api: this.deps.api,
      store: this.deps.store,
      clock: this.clock,
      config,
      ...(this.deps.logger === undefined ? {} : { logger: this.deps.logger }),
    });
  }

  /** `avi:jira:deleted:issue`. */
  async onIssueDeleted(event: JiraIssueUpdatedEvent, projectIdHint: string): Promise<void> {
    const config = await this.ingestConfig(projectIdHint);
    await handleIssueDeleted(event, {
      api: this.deps.api,
      store: this.deps.store,
      clock: this.clock,
      config,
      ...(this.deps.logger === undefined ? {} : { logger: this.deps.logger }),
    });
  }

  /** Start (or restart) the backfill for a project. */
  async startBackfill(projectId: string): Promise<void> {
    await this.deps.store.migrate();
    const now = this.clock.now();
    const settings = await this.deps.settings.get(projectId);
    const from =
      settings.backfillMonths === null ? null : now - settings.backfillMonths * 30 * 86_400_000;
    await this.deps.store.putIndexState(initialIndexState(projectId, now, from));
    await this.deps.scheduler.enqueueBackfill({ projectId, cursor: null, slice: 0 });
  }

  /** Run one backfill slice. Called by the async-events consumer. */
  async runBackfill(projectId: string, slice: number): Promise<void> {
    await this.deps.store.migrate();
    const config = await this.ingestConfig(projectId);
    const settings = await this.deps.settings.get(projectId);
    const now = this.clock.now();

    // Refresh status metadata each slice: it is one small request and it is how
    // a status renamed mid-backfill still shows its current name.
    const statuses = await this.deps.api.getStatuses();
    await this.deps.store.upsertStatusMeta(
      statuses.map((s) => ({
        statusId: s.id,
        name: s.name,
        category: s.category,
        firstSeenAt: now,
        lastSeenAt: now,
      })),
    );

    await runBackfillSlice(
      {
        api: this.deps.api,
        store: this.deps.store,
        scheduler: this.deps.scheduler,
        clock: this.clock,
        config,
        ...(this.deps.logger === undefined ? {} : { logger: this.deps.logger }),
      },
      {
        ...DEFAULT_BACKFILL_OPTIONS,
        projectId,
        issuesPerSlice: this.options.issuesPerSlice ?? DEFAULT_BACKFILL_OPTIONS.issuesPerSlice,
        timeBudgetMs: this.options.timeBudgetMs ?? DEFAULT_BACKFILL_OPTIONS.timeBudgetMs,
        pageSize: this.options.pageSize ?? DEFAULT_BACKFILL_OPTIONS.pageSize,
        throttleMs: this.options.throttleMs ?? 0,
        historyFrom:
          settings.backfillMonths === null ? null : now - settings.backfillMonths * 30 * 86_400_000,
        // Issues carrying a Jira issue security level are never indexed. The
        // app reads as itself, so a restricted issue would otherwise be
        // aggregated into a report shown to people the restriction excludes.
        excludeRestrictedIssues: true,
      },
      slice,
    );
  }

  /** Everything the report page needs, in one round trip. */
  async statusReport(request: StatusReportRequest): Promise<ReportEnvelope> {
    await this.deps.store.migrate();
    const settings = await this.deps.settings.get(request.projectId);
    const state = await this.deps.store.getIndexState(request.projectId);
    const report = await buildStatusReport(this.deps.store, {
      projectId: request.projectId,
      basis: request.basis ?? settings.defaultBasis,
      limit: clamp(request.limit ?? 500, 1, 500),
      offset: Math.max(0, request.offset ?? 0),
      ...(request.assigneeAccountIds === undefined
        ? {}
        : { assigneeAccountIds: request.assigneeAccountIds }),
      ...(request.issueTypeIds === undefined ? {} : { issueTypeIds: request.issueTypeIds }),
      ...(request.createdFrom === undefined ? {} : { createdFrom: request.createdFrom }),
      ...(request.createdTo === undefined ? {} : { createdTo: request.createdTo }),
    });
    return {
      report,
      progress: state === null ? null : toProgress(state),
      partial: state === null || state.state !== 'complete' || report.anyTruncated,
      settings,
    };
  }

  /**
   * The index state, and nothing else.
   *
   * Split out from `statusReport` because four of the five listings need only
   * this: their pages and gadgets show the indexing banner beside a report
   * they fetched from a different resolver. Reading it through
   * `statusReport({ limit: 1 })` worked, but ran `migrate`, a settings read
   * and a whole `buildStatusReport` aggregation to return one enum — on a
   * consumption-priced platform, on a dashboard gadget, which is the surface
   * that renders most often.
   *
   * It is also *correct* where the paged report was not: `ReportEnvelope.partial`
   * folds in `anyTruncated`, which is computed over the returned page, so a
   * one-row page could only ever see one row's truncation.
   */
  async indexProgress(projectId: string): Promise<BackfillProgress | null> {
    await this.deps.store.migrate();
    const state = await this.deps.store.getIndexState(projectId);
    return state === null ? null : toProgress(state);
  }

  /** CSV of the same report, for the export button. */
  async statusReportCsv(request: StatusReportRequest): Promise<string> {
    const envelope = await this.statusReport({ ...request, limit: request.limit ?? 500 });
    return statusReportToCsv(envelope.report, { durationFormat: 'hours' });
  }

  /** Listing 2 — worklog totals grouped by author, issue, day, week or month. */
  async worklogReport(request: WorklogReportRequest): Promise<WorklogReport> {
    await this.deps.store.migrate();
    const settings = await this.deps.settings.get(request.projectId);
    return buildWorklogReport(this.deps.store, request, settings.calendar.timeZone);
  }

  /** Listing 3 — how long each unfinished issue has sat where it is. */
  async agingReport(projectId: string, limit = 500): Promise<AgingReport> {
    await this.deps.store.migrate();
    return buildAgingReport(this.deps.store, projectId, this.clock.now(), limit);
  }

  /**
   * Listing 3 — cumulative flow: how many issues sat in each status at the
   * end of each day.
   *
   * The only report that reads `issue_status_visit`, because it is the only
   * one that asks where an issue was on a day in the past. Listings that do
   * not set `datasets.statusVisits` have no visits stored and get
   * `unavailable: true` rather than a chart of zeroes.
   */
  async flowReport(projectId: string, days = 30, limit = 500): Promise<FlowReport> {
    await this.deps.store.migrate();
    return buildFlowReport(this.deps.store, projectId, this.clock.now(), { days, limit });
  }

  /** Listing 4 — working time in the counted statuses against a target. */
  async slaReport(projectId: string, goal: SlaCountedGoal, limit = 500): Promise<SlaReport> {
    await this.deps.store.migrate();
    return buildSlaReport(this.deps.store, projectId, goal, this.clock.now(), limit);
  }

  /** Listing 5 — filtered, exportable field-change history across issues. */
  async historyReport(request: HistoryReportRequest): Promise<HistoryReport> {
    await this.deps.store.migrate();
    return buildHistoryReport(this.deps.store, request);
  }

  /**
   * Storage footprint, for the admin usage page. Estimated, not measured.
   *
   * Instance-wide by design — Forge SQL is provisioned per installation, so
   * "how much is this app holding" has no project-scoped answer. That is
   * exactly why it is on an admin page and nowhere else: the numbers are
   * facts about the app's own footprint, never about issues, and an admin
   * page is the only surface Jira itself restricts to people entitled to
   * ask instance-wide questions.
   */
  async storageEstimate(): Promise<{
    bytes: number;
    note: string;
    tables: readonly { table: string; rows: number; bytes: number }[];
  }> {
    const counts = await this.deps.store.countRows();
    const tables = Object.entries(ESTIMATED_ROW_BYTES)
      .map(([table, perRow]) => ({
        table,
        rows: counts[table] ?? 0,
        bytes: (counts[table] ?? 0) * perRow,
      }))
      .sort((a, b) => b.bytes - a.bytes || a.table.localeCompare(b.table));
    return {
      bytes: tables.reduce((total, row) => total + row.bytes, 0),
      note:
        'Estimated from row counts and per-row size constants, not measured on disk. ' +
        'Check the real figure against your Forge usage dashboard.',
      tables,
    };
  }

  /**
   * The project's indexed-history window, in months. `null` means all history.
   *
   * Its own resolver rather than a field on the report envelope, and read
   * only when the user opens the control that needs it: every page load pays
   * for what the envelope carries, on a consumption-priced platform, and
   * almost nobody opens this.
   */
  async historyWindow(projectId: string): Promise<{ months: number | null }> {
    const settings = await this.deps.settings.get(projectId);
    return { months: settings.backfillMonths };
  }

  /**
   * Widen the indexed-history window and re-index the project.
   *
   * ROADMAP stage 5, "extend history beyond 12 months". The backfill has
   * always taken its lower bound from `settings.backfillMonths` — twelve
   * months by default, to keep a first backfill bounded on a large instance —
   * and nothing could change it, so the mitigation the settings docstring
   * promised did not exist.
   *
   * Writes the setting, then restarts the backfill from scratch. Not a
   * partial "fetch only the older part": Jira's enhanced search pages forward
   * from a bound and ingestion is idempotent (`putIssueAggregate` replaces an
   * issue's rows outright), so re-reading the newer issues costs requests but
   * cannot produce a wrong number. A resumable older-only pass would need its
   * own cursor state and its own failure modes to save those requests, which
   * is not a trade worth making before a customer asks.
   */
  async setHistoryWindow(projectId: string, months: number | null): Promise<void> {
    const settings = await this.deps.settings.get(projectId);
    await this.deps.settings.put(
      projectId,
      { ...settings, backfillMonths: months },
      this.clock.now(),
    );
    await this.startBackfill(projectId);
  }

  /** The project's saved SLA goals. Empty until someone saves one. */
  async slaGoals(projectId: string): Promise<readonly StoredSlaGoal[]> {
    const settings = await this.deps.settings.get(projectId);
    return settings.slaGoals;
  }

  /**
   * Save a goal, creating it or replacing it by id.
   *
   * Returns the whole list rather than the one goal: the caller is a picker
   * that has to re-render anyway, and one round trip beats two on a
   * consumption-priced platform.
   *
   * Refuses past `MAX_SLA_GOALS` rather than evicting the oldest. Silently
   * dropping a goal somebody saved — and measuring a report against a
   * different one next time the page opens — is the failure mode this
   * product exists to avoid; a refusal the user can see is not.
   */
  async saveSlaGoal(
    projectId: string,
    goal: StoredSlaGoal,
  ): Promise<{ saved: true; goals: readonly StoredSlaGoal[] } | { saved: false; reason: 'full' }> {
    const settings = await this.deps.settings.get(projectId);
    const existing = settings.slaGoals.findIndex((g) => g.id === goal.id);
    if (existing === -1 && settings.slaGoals.length >= MAX_SLA_GOALS) {
      return { saved: false, reason: 'full' };
    }
    const goals =
      existing === -1
        ? [...settings.slaGoals, goal]
        : settings.slaGoals.map((g) => (g.id === goal.id ? goal : g));
    await this.deps.settings.put(projectId, { ...settings, slaGoals: goals }, this.clock.now());
    return { saved: true, goals };
  }

  /** Delete a goal by id. Deleting one that is not there is not an error. */
  async deleteSlaGoal(projectId: string, goalId: string): Promise<readonly StoredSlaGoal[]> {
    const settings = await this.deps.settings.get(projectId);
    const goals = settings.slaGoals.filter((g) => g.id !== goalId);
    await this.deps.settings.put(projectId, { ...settings, slaGoals: goals }, this.clock.now());
    return goals;
  }

  /**
   * One issue's timeline — the issue panel.
   *
   * Reads Jira rather than the store, and returns the project id it found so
   * the caller can authorise against it. That ordering is deliberate: the
   * panel's context names an *issue*, and the only trustworthy way to learn
   * which project it belongs to is to ask Jira, not to take it from the
   * client. See `handleIssueTimeline`, which refuses before returning a
   * single figure if the caller cannot browse that project.
   */
  async issueTimeline(
    issueIdOrKey: string,
    projectIdHint: string,
  ): Promise<{ report: IssueTimelineReport; projectId: string }> {
    const settings = await this.deps.settings.get(projectIdHint);
    return buildIssueTimeline(issueIdOrKey, {
      api: this.deps.api,
      calendar: settings.calendar,
      now: this.clock.now(),
      maxChangelogEntries: this.options.maxChangelogEntries ?? 2000,
      pageSize: this.options.pageSize ?? 50,
      // One working day. The panel's goal is derived, not configured, and
      // the target only decides where "breached" falls — the consumed and
      // paused figures beside it are true regardless.
      targetMs: 8 * 3_600_000,
      sleeper: this.deps.sleeper,
    });
  }

  /** Projects the calling user may browse — the dashboard gadget's picker. */
  async listProjects(): Promise<readonly JiraProjectRef[]> {
    return this.deps.api.listProjects();
  }

  /**
   * The SLA goal picker's options — statuses seen in *this* project.
   *
   * Status metadata is stored instance-wide, and two projects routinely carry
   * same-named statuses under different ids; offering them all rendered a
   * picker with every chip doubled (observed live). Before the project is
   * indexed it has no aggregates, so the full list stands in — a usable
   * picker beats an empty row while indexing runs.
   */
  async listStatuses(projectId: string): Promise<readonly StatusMetaRow[]> {
    await this.deps.store.migrate();
    const all = await this.deps.store.getStatusMeta();
    const projectIds = new Set(await this.deps.store.listProjectStatusIds(projectId));
    if (projectIds.size === 0) return all;
    return all.filter((status) => projectIds.has(status.statusId));
  }

  /** The runtime's clock, for handlers that need to stamp something. */
  now(): Millis {
    return this.clock.now();
  }

  get listingId(): string {
    return this.options.listingId;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
