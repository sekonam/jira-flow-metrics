import {
  DATASETS_HISTORY,
  DATASETS_TIME_IN_STATUS,
  DATASETS_TIME_IN_STATUS_WITH_VISITS,
  DATASETS_WORKLOG,
  type IngestDatasets,
} from '@jfm/engine';
import type { CsvExportKind } from './handlers.js';

/**
 * What each of the five Marketplace listings is, in one place.
 *
 * Every listing already declares these two facts for itself, in its own
 * `src/runtime.ts` and `src/index.ts`, and that is where production reads
 * them — a listing's wiring should be legible in the listing's own files.
 *
 * This table exists because everything *else* that needs the same facts was
 * guessing. The test harness ran all five listings against a store that had
 * ingested every dataset, so a listing configured to skip the dataset its own
 * report is built from looked perfectly healthy in all 1023 tests, all 96
 * screenshots and all 40 browser flows; and the live harness fell back to the
 * time-in-status CSV for any listing id it did not recognise, which is the
 * one defect its five export flows were written to catch.
 *
 * `test/listing-registry.test.ts` asserts this table against what each app
 * actually passes, so the two cannot drift apart silently.
 */
export const LISTING_IDS = [
  'time-in-status',
  'worklog-reports',
  'wip-aging',
  'sla-breach',
  'issue-history',
] as const;

export type ListingId = (typeof LISTING_IDS)[number];

export function isListingId(value: string): value is ListingId {
  return (LISTING_IDS as readonly string[]).includes(value);
}

/** What each listing ingests. Mirrors the `datasets` each app's `runtime.ts` passes. */
export const LISTING_DATASETS: Readonly<Record<ListingId, IngestDatasets>> = {
  'time-in-status': DATASETS_TIME_IN_STATUS,
  'worklog-reports': DATASETS_WORKLOG,
  // The only listing that stores individual visits: its cumulative flow
  // diagram needs to know what each issue's status was on a past day.
  'wip-aging': DATASETS_TIME_IN_STATUS_WITH_VISITS,
  'sla-breach': DATASETS_TIME_IN_STATUS,
  'issue-history': DATASETS_HISTORY,
};

/** Which report each listing's export button exports. Mirrors each app's `index.ts`. */
export const LISTING_CSV_KIND: Readonly<Record<ListingId, CsvExportKind>> = {
  'time-in-status': 'status',
  'worklog-reports': 'worklog',
  'wip-aging': 'aging',
  'sla-breach': 'sla',
  'issue-history': 'history',
};
