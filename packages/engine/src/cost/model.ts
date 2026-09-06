import { ESTIMATED_ROW_BYTES } from '../store/schema.js';

/**
 * Forge consumption cost model.
 *
 * ## Provenance of every number here
 *
 * These constants come from Atlassian's published Forge pricing as recorded in
 * the market analysis on 2026-09-05:
 *
 * - Forge SQL: **730 GB-hours per month free**, then **$0.00076850 per GB-hour**.
 * - Forge KVS: **0.1 GB/month free for reads and for writes respectively**, and
 *   **writes cost roughly 20x reads** — which is why this product does not use
 *   KVS for aggregates at all.
 *
 * **They are inputs to an estimate, not a measurement of this app.** Nothing in
 * this repository has ever run on Forge, so the outputs below are modelled.
 * Any UI that displays them must label them as estimates — see
 * `docs/TECHNICAL-SPEC.md`.
 *
 * Confirm the rates against Atlassian's current pricing page before release;
 * platform pricing moved twice in the year to 2026 and will move again.
 */

export const FORGE_SQL_FREE_GB_HOURS_PER_MONTH = 730;
export const FORGE_SQL_USD_PER_GB_HOUR = 0.0007685;
export const HOURS_PER_MONTH = 730;
export const BYTES_PER_GB = 1024 ** 3;

export interface InstanceProfile {
  readonly issues: number;
  /** Distinct statuses an average issue passes through. */
  readonly statusesPerIssue: number;
  readonly worklogsPerIssue: number;
  readonly historyEntriesPerIssue: number;
}

/** The profile the sizing claim in the technical spec is based on. */
export const REFERENCE_PROFILE: InstanceProfile = {
  issues: 20_000,
  statusesPerIssue: 8,
  worklogsPerIssue: 0,
  historyEntriesPerIssue: 0,
};

export interface StorageEstimate {
  readonly bytes: number;
  readonly megabytes: number;
  readonly gigabytes: number;
}

export function estimateStorage(
  profile: InstanceProfile,
  datasets: { statusDurations: boolean; worklogs: boolean; history: boolean },
): StorageEstimate {
  let bytes = profile.issues * ESTIMATED_ROW_BYTES.issue_meta;
  if (datasets.statusDurations) {
    bytes += profile.issues * profile.statusesPerIssue * ESTIMATED_ROW_BYTES.issue_status_agg;
  }
  if (datasets.worklogs) {
    bytes += profile.issues * profile.worklogsPerIssue * ESTIMATED_ROW_BYTES.worklog;
  }
  if (datasets.history) {
    bytes += profile.issues * profile.historyEntriesPerIssue * ESTIMATED_ROW_BYTES.issue_history;
  }
  return {
    bytes,
    megabytes: bytes / (1024 * 1024),
    gigabytes: bytes / BYTES_PER_GB,
  };
}

export interface MonthlyCostEstimate {
  readonly totalGigabytes: number;
  readonly gbHours: number;
  readonly freeGbHours: number;
  readonly billableGbHours: number;
  readonly usd: number;
  /** How many installs of this size fit inside the free allowance. */
  readonly installsWithinFreeTier: number;
}

/** Monthly Forge SQL cost for `installs` instances of the given size. */
export function estimateMonthlySqlCost(
  perInstall: StorageEstimate,
  installs: number,
): MonthlyCostEstimate {
  const totalGigabytes = perInstall.gigabytes * installs;
  const gbHours = totalGigabytes * HOURS_PER_MONTH;
  const billableGbHours = Math.max(0, gbHours - FORGE_SQL_FREE_GB_HOURS_PER_MONTH);
  const perInstallGbHours = perInstall.gigabytes * HOURS_PER_MONTH;
  return {
    totalGigabytes,
    gbHours,
    freeGbHours: FORGE_SQL_FREE_GB_HOURS_PER_MONTH,
    billableGbHours,
    usd: billableGbHours * FORGE_SQL_USD_PER_GB_HOUR,
    installsWithinFreeTier:
      perInstallGbHours === 0
        ? Number.POSITIVE_INFINITY
        : Math.floor(FORGE_SQL_FREE_GB_HOURS_PER_MONTH / perInstallGbHours),
  };
}

export interface IngestVolumeEstimate {
  /** Jira requests to complete the first backfill. */
  readonly backfillRequests: number;
  /** Backfill slices needed, given the per-slice issue budget. */
  readonly backfillSlices: number;
  /** Store writes during backfill (batched). */
  readonly backfillWrites: number;
  /** Steady-state Jira requests per month. */
  readonly monthlyRequests: number;
}

/**
 * Request volume, which is the constraint that actually bites: Jira rate limits
 * are per-tenant, and a backfill that needs 40,000 requests is a backfill that
 * takes days no matter what the compute budget says.
 */
export function estimateIngestVolume(
  profile: InstanceProfile,
  options: {
    issuesPerSlice: number;
    pageSize: number;
    /** Share of issues whose changelog exceeds one page. */
    multiPageChangelogShare?: number;
    /** Issue updates per month that pass the relevance filter. */
    relevantUpdatesPerMonth: number;
  },
): IngestVolumeEstimate {
  const searchRequests = Math.ceil(profile.issues / options.pageSize);
  const extraChangelogRequests = Math.round(
    profile.issues * (options.multiPageChangelogShare ?? 0.05) * 2,
  );
  return {
    backfillRequests: searchRequests + extraChangelogRequests,
    backfillSlices: Math.ceil(profile.issues / options.issuesPerSlice),
    backfillWrites: Math.ceil(profile.issues / options.pageSize),
    monthlyRequests: options.relevantUpdatesPerMonth * 2,
  };
}
