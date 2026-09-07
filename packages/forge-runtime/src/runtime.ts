import {
  DEFAULT_BACKFILL_OPTIONS,
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
  type Logger,
  type MetricsStore,
  type Millis,
  type Scheduler,
  type Sleeper,
  type StatusReport,
} from '@jfm/engine';
import { type SettingsStore, type ProjectSettings } from './settings.js';
import {
  buildAgingReport,
  buildHistoryReport,
  buildSlaReport,
  buildWorklogReport,
  type AgingReport,
  type HistoryReport,
  type HistoryReportRequest,
  type SlaCountedGoal,
  type SlaReport,
  type WorklogReportRequest,
} from './reports.js';
import type { WorklogAggregateResult } from '@jfm/engine';

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
      limit: clamp(request.limit ?? 50, 1, 500),
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
  async worklogReport(request: WorklogReportRequest): Promise<WorklogAggregateResult> {
    await this.deps.store.migrate();
    const settings = await this.deps.settings.get(request.projectId);
    return buildWorklogReport(this.deps.store, request, settings.calendar.timeZone);
  }

  /** Listing 3 — how long each unfinished issue has sat where it is. */
  async agingReport(projectId: string, limit = 500): Promise<AgingReport> {
    await this.deps.store.migrate();
    return buildAgingReport(this.deps.store, projectId, this.clock.now(), limit);
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

  /** Storage footprint, for the admin usage panel. Estimated, not measured. */
  async storageEstimate(): Promise<{ bytes: number; note: string }> {
    const bytes = await this.deps.store.estimateBytes();
    return {
      bytes,
      note:
        'Estimated from row counts and per-row size constants, not measured on disk. ' +
        'Check the real figure against your Forge usage dashboard.',
    };
  }

  get listingId(): string {
    return this.options.listingId;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
