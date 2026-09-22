import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LISTING_CSV_KIND,
  LISTING_DATASETS,
  LISTING_IDS,
  type ListingId,
} from '@jfm/forge-runtime';
import {
  DATASETS_HISTORY,
  DATASETS_TIME_IN_STATUS,
  DATASETS_TIME_IN_STATUS_WITH_VISITS,
  DATASETS_WORKLOG,
  type IngestDatasets,
} from '@jfm/engine';

/**
 * `LISTING_DATASETS` and `LISTING_CSV_KIND` against what each app passes.
 *
 * Production reads these two facts from each listing's own files, which is
 * where they belong — a listing's wiring should be legible in the listing.
 * The registry exists for everything else that needs them, and a registry
 * that drifts from the thing it mirrors is worse than no registry.
 *
 * Why it exists at all: the test harness ran all five listings against a
 * store that ingested every dataset, so a listing configured to skip the
 * dataset its own report is built from looked healthy in every test, every
 * screenshot and every browser flow. And no test asserted any app's
 * `datasets` value — this is the first.
 *
 * A static scan of the sources, in the root suite beside the manifest and
 * resolver-wiring checks, for the same reason: it is a check on the shape of
 * the app rather than on its behaviour.
 */

const APPS_DIR = join(process.cwd(), 'apps');
const APPS = readdirSync(APPS_DIR).sort();

const BY_NAME: Readonly<Record<string, IngestDatasets>> = {
  DATASETS_TIME_IN_STATUS,
  DATASETS_TIME_IN_STATUS_WITH_VISITS,
  DATASETS_WORKLOG,
  DATASETS_HISTORY,
};

function read(app: string, ...parts: string[]): string {
  return readFileSync(join(APPS_DIR, app, ...parts), 'utf8');
}

describe('the listing registry mirrors the five apps', () => {
  it('lists exactly the apps that exist', () => {
    expect([...LISTING_IDS].sort()).toEqual(APPS);
  });

  it.each(APPS)('%s: ingests the datasets the registry says it does', (app) => {
    const source = read(app, 'src', 'runtime.ts');
    const match = /listingId:\s*'([^']+)',\s*datasets:\s*(\w+)/.exec(source);
    expect(match, `${app}/src/runtime.ts has no { listingId, datasets } pair`).not.toBeNull();

    const [, listingId, datasetsName] = match!;
    // The id the app reports itself as is the id it is installed under.
    expect(listingId).toBe(app);
    const declared = BY_NAME[datasetsName!];
    expect(declared, `unknown dataset constant ${String(datasetsName)}`).toBeDefined();
    expect(LISTING_DATASETS[app as ListingId]).toEqual(declared);
  });

  it.each(APPS)('%s: exports the CSV kind the registry says it does', (app) => {
    const source = read(app, 'src', 'index.ts');
    const match = /handleExportCsv\(getRuntime\(\), req(?:, '([^']+)')?\)/.exec(source);
    expect(match, `${app}/src/index.ts does not define exportCsv`).not.toBeNull();
    // An omitted kind is `handleExportCsv`'s own default, which is 'status'.
    expect(LISTING_CSV_KIND[app as ListingId]).toBe(match![1] ?? 'status');
  });

  it('★ gives only one listing the status visits the flow chart needs', () => {
    // The cumulative flow diagram is the only report built from individual
    // visits, and `wip-aging` is the only listing that pays to store them.
    // If that ever stops being true in one place and not the other, the
    // chart goes permanently "unavailable" in production while every test
    // and screenshot — which ingest everything — keep showing it populated.
    const withVisits = LISTING_IDS.filter((id) => LISTING_DATASETS[id].statusVisits === true);
    expect(withVisits).toEqual(['wip-aging']);
    const definesFlowReport = APPS.filter((app: string) =>
      read(app, 'src', 'index.ts').includes("resolver.define('getFlowReport'"),
    );
    expect(definesFlowReport).toEqual(['wip-aging']);
  });
});
