import Resolver from '@forge/resolver';
import {
  handleBackfillJob,
  handleExportCsv,
  handleGetReport,
  handleIndexProgress,
  handleIssueEvent,
  handleStartIndexing,
  projectIdFromEvent,
  handleAgingReport,
} from '@jfm/forge-runtime';
import { getRuntime } from './runtime';

/**
 * Forge entry points for the WIP Aging & Run Charts listing.
 *
 * Every function here is a line of wiring; the behaviour lives in
 * `@jfm/forge-runtime`'s handlers, which are covered by tests. That is
 * deliberate — this file is the part that cannot be tested outside Forge, so
 * it is kept small enough to read in one screen.
 */

const resolver = new Resolver();

resolver.define('getReport', (req) => handleGetReport(getRuntime(), req));
resolver.define('exportCsv', (req) => handleExportCsv(getRuntime(), req));
resolver.define('startIndexing', (req) => handleStartIndexing(getRuntime(), req));
// The banner's data, without the report. Four of the five listings render the
// banner beside a report they fetch from a different resolver, and the gadgets
// need only "is indexing finished?" — asking `getReport` for that ran a whole
// aggregation on the surface that renders most often.
resolver.define('getIndexProgress', (req) => handleIndexProgress(getRuntime(), req));

resolver.define('getAgingReport', (req) => handleAgingReport(getRuntime(), req));

export const handler = resolver.getDefinitions();

/** Product-event trigger: `avi:jira:created|updated|deleted:issue`. */
export async function onIssueEvent(event: unknown): Promise<void> {
  await handleIssueEvent(getRuntime(), event, projectIdFromEvent(event) ?? '');
}

const backfillResolver = new Resolver();
backfillResolver.define('run-slice', (req) => handleBackfillJob(getRuntime(), req.payload));

/** Async-events consumer: one backfill slice per invocation. */
export const backfillHandler = backfillResolver.getDefinitions();
