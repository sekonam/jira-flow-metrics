import Resolver from '@forge/resolver';
import {
  handleBackfillJob,
  handleExportCsv,
  handleGetReport,
  handleIssueEvent,
  handleStartIndexing,
  handleStorageEstimate,
  projectIdFromEvent,
  handleHistoryReport,
} from '@jfm/forge-runtime';
import { getRuntime } from './runtime.js';

/**
 * Forge entry points for the Issue History & Audit Log listing.
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
resolver.define('getStorageEstimate', () => handleStorageEstimate(getRuntime()));

resolver.define('getHistoryReport', (req) => handleHistoryReport(getRuntime(), req));

export const handler = resolver.getDefinitions();

/** Product-event trigger: `avi:jira:created|updated|deleted:issue`. */
export async function onIssueEvent(event: unknown): Promise<void> {
  await handleIssueEvent(getRuntime(), event, projectIdFromEvent(event) ?? '');
}

const backfillResolver = new Resolver();
backfillResolver.define('run-slice', (req) => handleBackfillJob(getRuntime(), req.payload));

/** Async-events consumer: one backfill slice per invocation. */
export const backfillHandler = backfillResolver.getDefinitions();
