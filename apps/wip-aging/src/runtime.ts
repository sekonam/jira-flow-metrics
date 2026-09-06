import api, { route } from '@forge/api';
import { Queue } from '@forge/events';
import sql from '@forge/sql';
import { DATASETS_TIME_IN_STATUS, realSleeper, systemClock } from '@jfm/engine';
import {
  JiraRestClient,
  ListingRuntime,
  QueueScheduler,
  SettingsStore,
  SqlMetricsStore,
  forgeJiraFetch,
  forgeSqlExecutor,
} from '@jfm/forge-runtime';

/**
 * Composition root for the WIP Aging & Run Charts listing.
 *
 * This is the only file in the app that touches a Forge SDK. Everything below
 * it is `@jfm/engine` and `@jfm/forge-runtime`, both of which are covered by
 * the test suite. The other four listings have the same file with a different
 * `datasets` value — that is the portfolio thesis in fifteen lines.
 *
 * ⚠️ The SDK wiring here has never run: `forge tunnel` and `forge deploy`
 * need credentials this repository does not have. See `docs/RUNBOOK.md`.
 */

export const BACKFILL_QUEUE = 'backfill';

let cached: ListingRuntime | null = null;

export function getRuntime(): ListingRuntime {
  if (cached !== null) return cached;

  const executor = forgeSqlExecutor(sql as unknown as Parameters<typeof forgeSqlExecutor>[0]);
  const store = new SqlMetricsStore(executor);
  const settings = new SettingsStore(executor);
  // Two Jira clients on purpose. Ingestion reads as the app, because a
  // background event has no user; the permission check reads as the calling
  // user, because that is the only way to honour their Jira permissions.
  const jira = new JiraRestClient(
    forgeJiraFetch(() => api.asApp(), route),
    forgeJiraFetch(() => api.asUser(), route),
  );
  const scheduler = new QueueScheduler(new Queue({ key: BACKFILL_QUEUE }));

  cached = new ListingRuntime(
    {
      api: jira,
      store,
      settings,
      scheduler,
      sleeper: realSleeper,
      clock: systemClock,
      logger: {
        log: (level, message, context) => {
          // Forge captures stderr as app logs. Context carries ids and counts
          // only — never issue summaries or user names.
          if (level === 'error' || level === 'warn') {
            console.error(JSON.stringify({ level, message, ...context }));
          }
        },
      },
    },
    { listingId: 'wip-aging', datasets: DATASETS_TIME_IN_STATUS },
  );
  return cached;
}

/** Reset the memoised runtime. Only used by tests. */
export function resetRuntime(): void {
  cached = null;
}
