import Resolver from '@forge/resolver';
import {
  handleBackfillJob,
  handleExportCsv,
  handleGetReport,
  handleIndexProgress,
  handleIssueEvent,
  handleListProjects,
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
resolver.define('exportCsv', (req) => handleExportCsv(getRuntime(), req, 'aging'));
resolver.define('startIndexing', (req) => handleStartIndexing(getRuntime(), req));
// The banner's data, without the report. Four of the five listings render the
// banner beside a report they fetch from a different resolver, and the gadgets
// need only "is indexing finished?" — asking `getReport` for that ran a whole
// aggregation on the surface that renders most often.
resolver.define('getIndexProgress', (req) => handleIndexProgress(getRuntime(), req));
// The dashboard gadget's edit-mode project picker. No project context exists
// yet at this point — that is what the picker is for.
resolver.define('listProjects', () => handleListProjects(getRuntime()));

resolver.define('getAgingReport', (req) => handleAgingReport(getRuntime(), req));

export const handler = resolver.getDefinitions();

/** Product-event trigger: `avi:jira:created|updated|deleted:issue`. */
export async function onIssueEvent(event: unknown): Promise<void> {
  await handleIssueEvent(getRuntime(), event, projectIdFromEvent(event) ?? '');
}

/**
 * Async-events consumer: one backfill slice per invocation.
 *
 * A plain function, not a `Resolver` — this app's live tenant is the reason
 * why. The manifest originally wired this the way `@forge/events` v1.x
 * needed (`consumer.resolver.function`/`.method`, a `Resolver` bound to a
 * method name), which Atlassian's own docs mark as the legacy form; the
 * `@forge/events` v3 actually installed here wants `consumer.function`
 * pointing straight at a function that receives the raw queue payload. The
 * legacy form still deploys and lints clean — nothing local or server-side
 * validates the mismatch — but on the real platform the consumer never
 * fired: a five-issue backfill sat at "0 issues indexed" indefinitely, with
 * nothing in `forge logs` because the function was never invoked at all.
 */
export async function backfillHandler(event: unknown): Promise<'ran' | 'ignored'> {
  // The pushed payload lives on `event.body`, not on `event` itself — this is
  // the sixth SDK-shape assumption on this project that only a live tenant
  // exposed. Atlassian's own docs call the mistake out by name: "There is no
  // `payload` property; if you read `event.payload` you get `undefined`. The
  // `payload` argument belonged to the 1.x resolver-based consumer, which
  // 2.0.0 replaced." Passing the whole event through, unwrapped, made
  // `jobFromPayload` find no `projectId` at the top level, return `null`, and
  // `handleBackfillJob` return 'ignored' — no error, no log, just a backfill
  // that enqueues successfully and then never does anything.
  const body =
    typeof event === 'object' && event !== null ? (event as { body?: unknown }).body : undefined;
  return handleBackfillJob(getRuntime(), body);
}
