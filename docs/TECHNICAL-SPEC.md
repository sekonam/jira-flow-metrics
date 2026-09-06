# TECHNICAL-SPEC — jira-flow-metrics

> One engine, five listings, on Atlassian Forge. This document covers the data model, the
> ingestion pipeline, the backfill algorithm, the per-listing module map and the cost model.

**What has and has not been verified.** Everything in `packages/` is covered by 434 automated
tests against recorded fixtures. **Nothing in this repository has ever executed on the Forge
platform** — there is no Atlassian developer account here, so `forge lint`, `forge tunnel` and
`forge deploy` cannot be run. Sections marked ⚠️ UNVERIFIED name the exact surface that the first
tunnel session has to confirm.

---

## 1. Shape of the system

```
                    Jira Cloud
                        │
        ┌───────────────┴───────────────┐
        │ product events                │ REST (read-only)
        │ avi:jira:*:issue              │ /search/jql, /changelog, /worklog, /status
        ▼                               ▼
  ┌──────────────────────────────────────────────┐
  │  @jfm/forge-runtime                          │
  │   JiraRestClient · QueueScheduler            │
  │   SqlMetricsStore · SettingsStore            │
  │   ListingRuntime · handlers                  │
  └───────────────┬──────────────────────────────┘
                  │  ports (JiraApi, MetricsStore, Scheduler, Clock, Sleeper)
                  ▼
  ┌──────────────────────────────────────────────┐
  │  @jfm/engine        ← all the arithmetic     │
  │   changelog → timeline → durations           │
  │   working calendars · interval algebra       │
  │   incremental ingest · resumable backfill    │
  └───────────────┬──────────────────────────────┘
                  ▼
            Forge SQL (per install)
                  │
                  ▼
  ┌──────────────────────────────────────────────┐
  │  @jfm/ui   view models (tested) + UI Kit     │
  └───────────────┬──────────────────────────────┘
                  ▼
   apps/{time-in-status, worklog-reports, wip-aging, sla-breach, issue-history}
```

**Why the ports layer exists.** It is not architecture for its own sake: it is what makes the
untestable surface small. Without it, every URL, every SQL statement and every retry decision would
be reachable only from inside Forge. With it, the only code that cannot be tested here is
`forgeSqlExecutor` (about 15 lines) and `forgeJiraFetch` (about 5), both explicitly labelled.

---

## 2. Package map

| Package                  | Contains                                                                                                                                                                | Tested                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/engine`        | Interval algebra, IANA/DST arithmetic, working calendars, changelog reconstruction, all metrics, ingestion pipeline, backfill, store contract, CSV, pricing, cost model | Yes — this is where the coverage floor applies                           |
| `packages/forge-runtime` | Forge SQL store, Jira REST client, async-events scheduler, settings, per-listing runtime, resolver handlers, listing 2-5 reports                                        | Yes, against a recording SQL executor and fixture-backed Jira            |
| `packages/ui`            | View models (pure, tested) and `@forge/react` components (⚠️ never rendered)                                                                                            | View models yes; components no                                           |
| `apps/*`                 | Manifest, composition root, resolver wiring, UI Kit pages                                                                                                               | Manifests asserted by a test suite; the SDK wiring cannot be tested here |

---

## 3. Data model

Forge SQL is MySQL-compatible. The DDL lives in `packages/engine/src/store/schema.ts` and is applied
by `migrate()`, which every entry point calls; all statements are `IF NOT EXISTS`, so migration
costs one round trip when there is nothing to do.

```sql
issue_meta(issue_id PK, issue_key, project_id, issue_type_id, priority_id,
           assignee_account_id, current_status_id, created_at, resolved_at, due_at,
           history_through_at, truncated, updated_at)
  KEY (project_id, created_at), KEY (project_id, current_status_id)

issue_status_agg(issue_id, status_id) PK
  project_id, elapsed_ms, business_ms, entries, last_entered_at, last_exited_at, updated_at
  KEY (project_id, status_id), KEY (project_id, updated_at)

status_meta(status_id PK, name, category, first_seen_at, last_seen_at)
status_name_history(status_id, name) PK, first_seen_at, last_seen_at

worklog(worklog_id PK, issue_id, issue_key, project_id, author_account_id,
        author_display_name, started_at, time_spent_ms, created_at, updated_at)
  KEY (project_id, started_at), KEY (issue_id), KEY (project_id, author_account_id, started_at)

issue_history(change_id PK, issue_id, issue_key, project_id, changed_at,
              author_account_id, author_display_name, field, field_label,
              from_value, to_value, from_id, to_id)
  KEY (project_id, changed_at), KEY (issue_id, changed_at), KEY (project_id, field, changed_at)

index_state(project_id PK, state, backfill_cursor, backfill_from,
            issues_processed, issues_total, last_processed_at, last_error,
            started_at, updated_at)

app_settings(scope_key PK, settings JSON-as-TEXT, updated_at)
schema_meta(id PK, version)
```

### Four decisions worth defending

**Aggregates key on `status_id`, never on the name.** Statuses get renamed; a report keyed on the
name would silently split one status into two columns, and the user would never know. Names live
in `status_meta` (current) and `status_name_history` (every name ever observed).

**Timestamps are `BIGINT` epoch milliseconds, UTC.** Local time exists only inside
`time/calendar.ts`. This removes a class of timezone bug from every aggregation path.

**No foreign keys, no cascades.** Issue deletion always goes through `deleteIssue`, which removes
rows from every table explicitly and removes `issue_meta` _last_ — so a partial failure leaves the
issue visible and therefore re-processable, rather than orphaning aggregate rows.

**Replace, never merge.** `putIssueAggregate` deletes an issue's aggregate rows and re-inserts them.
Recomputing an issue's whole timeline from its changelog is cheap, and replacement is the only way
to stay correct when history is edited, an issue moves between projects, or an event is delivered
twice. **This is what makes ingestion idempotent**, and idempotency is what lets the backfill be
at-least-once.

---

## 4. The core calculation

`changelog/reconstruct.ts` turns a changelog into a status timeline:

1. Extract every item whose field is `status`, with its timestamp.
2. Sort by `(created, numeric id)` — Jira pages are ordered but ties are real, because one
   transition screen writes several items at once.
3. The status before the first transition is that transition's `from`; with no transitions it is
   the issue's current status.
4. Emit one interval per segment: `[created, t₁)`, `[t₁, t₂)`, …, `[tₙ, null)`.
5. Number each visit, so a re-entry is visible in the output.

`metrics/time-in-status.ts` then sums **every** visit per status. `mostRecentVisitMs` computes what
Jira's Control Chart would show, so the UI can display both and the product's one factual claim is
checkable rather than asserted.

### Deliberate behaviours, all covered by tests

| Input reality                                                                | Behaviour                                                                                                   |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Two transitions with identical timestamps                                    | Zero-length interval kept, counted as a visit. An admin auditing a workflow expects to see it.              |
| Transition timestamped before issue creation (clock skew, back-dated import) | Clamped to the creation instant, never a negative duration.                                                 |
| A transition leaving a status the timeline never entered                     | Trusted as recorded (that is what Jira displays), timeline marked `truncated`.                              |
| Changelog longer than the configured cap                                     | Stops paging, marks `truncated`; the UI badges the row "partial history" and calls the total a lower bound. |
| Status renamed mid-history                                                   | Aggregates unaffected (keyed on id); the latest observed name is displayed.                                 |

---

## 5. Working calendars — the part that must not be quietly wrong

A calendar is a timezone, a weekly pattern of windows in **minutes from local midnight**, and a set
of non-working local dates. Windows are half-open; `1440` is local midnight ending the day.

**Why minutes-from-local-midnight and not a fixed UTC offset.** "09:00-17:00 Europe/Berlin" is eight
hours every day of the year, but it maps to a _different_ UTC range in summer and winter. A naive
implementation shifts every report by an hour for half the year and nobody notices for months.
Resolving windows per local day through the zone database is the only correct approach.

Consequently a 24/7 calendar measures **23 hours** on a spring-forward day and **25** on a
fall-back day. That is the physically correct answer and it is asserted in the golden file.

No date library is used. Node 22 ships full ICU, so `Intl.DateTimeFormat` already knows every zone
and every historical DST rule, and the Forge bundle is smaller without a tzdata copy.

**Ambiguity policy, documented because it is unavoidable:**

- A **nonexistent** local time (the hour skipped in spring) resolves forward — 02:30 reads as 03:30.
- An **ambiguous** local time (the hour repeated in autumn) resolves to the **first** occurrence.

Both are pinned by tests. `businessMsIn` and `addBusinessMs` are asserted to be inverses across
DST boundaries in Europe/Berlin.

### The golden file

`packages/engine/test/golden/business-hours.golden.json` holds eleven duration cases and four
"add working time" cases. **Every expected value was computed by hand and the arithmetic is written
into the file's `why` field.** Nothing is generated from the implementation — a regenerated golden
file only asserts that the code still does what it currently does, which is worth nothing. If a
change makes a case fail, the change is wrong until the arithmetic in `why` says otherwise.

---

## 6. Ingestion

### 6.1 Steady state: incremental only

**There is no scheduled trigger in any of the five manifests, and a test asserts it.** Forge went
consumption-priced on 1 January 2026. A nightly re-index would make the marginal cost of an install
grow with the customer's instance size while the price stays flat — the failure mode that turned
Xero's developer ecosystem into a liability for its developers.

Instead each app subscribes to `avi:jira:created|updated|deleted:issue`. Cost per event is bounded
by the issue's own history, not by the instance's size.

**Relevance filter — the single biggest lever on steady-state cost.** Most issue-updated events are
comment edits and description tweaks that cannot move any number the product reports.
`eventAffectsDatasets` inspects the changelog already present on the event payload and skips the
rest. Per listing:

| Listing datasets | Woken by                                                                    |
| ---------------- | --------------------------------------------------------------------------- |
| status durations | `status`, `resolution`, `project`, `key`, `duedate`, `priority`, `assignee` |
| worklogs         | `worklogId`, `timespent`, plus the filterable meta fields                   |
| history          | everything — that listing records every field change by definition          |

An event with no changelog attached is always processed, because we cannot tell.

### 6.2 First index: chunked, resumable, rate-limit-aware backfill

This is roughly 60% of the engine's engineering, and none of the obvious approaches work:

- one "index everything" call times out on any real instance;
- a nightly full re-index inverts the unit economics;
- an unthrottled loop trips Jira's per-tenant rate limit and gets the app noticed for the wrong
  reasons.

So backfill runs as a **sequence of slices**, each its own Forge invocation. One slice:

1. reads the persisted cursor from `index_state`;
2. pulls one page of issues ordered `created ASC` — a stable ordering even while the instance keeps
   changing underneath us, which a `updated DESC` ordering would not be;
3. processes issues until the page is exhausted, the **issue budget** is spent, or the **time
   budget** is spent;
4. **writes aggregates, then advances the cursor** — in that order, so a crash between them
   re-processes a page rather than skipping one;
5. enqueues the next slice through the Async Events queue, or marks the project complete.

```
       ┌──────────────┐   no work left
       │ not_started  │──────────────────────┐
       └──────┬───────┘                      │
              │ startBackfill                ▼
       ┌──────▼───────┐  budget spent  ┌───────────┐
   ┌──▶│   running    │───────────────▶│ complete  │
   │   └──┬────────┬──┘   enqueue next └───────────┘
   │      │        │
   │  429 │        │ other error
   │   ┌──▼────┐ ┌─▼──────┐
   └───│paused │ │ failed │
       └───────┘ └────────┘
       auto-retry  needs a human
```

**Budgets.** `issuesPerSlice` defaults to 100; `timeBudgetMs` defaults to **40 000**.
⚠️ The Forge asynchronous invocation limit is a platform quota that changes — **confirm the current
value before release** and set `timeBudgetMs` from it. The default is chosen to be safe, not
optimal.

**Rate limiting.** Every Jira call goes through `withRetry`: up to 5 attempts, exponential backoff
with **full jitter**, and a server-supplied `Retry-After` always wins (padded by 250 ms). Full
jitter rather than "exponential plus a little random" because otherwise every install that
backfills at the same time retries in lockstep. Non-retryable statuses (403, 404) propagate
immediately — a 403 will not fix itself and burning four more requests makes the rate-limit
situation worse.

A 429 that survives all retries moves the project to `paused` and re-enqueues; the UI reports it as
expected behaviour on a large instance rather than as a fault.

**Request cost per issue.** The search page is fetched with `expand=changelog`; when the inlined
changelog is complete the issue costs **zero** extra requests. Only issues whose changelog exceeds
one page are paged separately. A 20,000-issue instance at 50 per page is ≈ 400 search requests plus
≈ 2,000 changelog requests for the ~5% with long histories.

**History window.** The default backfill covers **12 months**, bounded by JQL, to keep the first
pass finite on a large instance. "Extend history" is a later action, not a first-run cost.

---

## 7. Forge module map per listing

Identical across all five; only the titles and one resolver differ.

| Manifest module        | Key                       | Handler                              | Purpose                                                                                         |
| ---------------------- | ------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `jira:projectPage`     | `<listing>-page`          | resolver                             | The report                                                                                      |
| `jira:dashboardGadget` | `<listing>-gadget`        | resolver                             | Summary tiles — the only organic distribution inside a customer                                 |
| `function`             | `resolver`                | `index.handler`                      | `getReport`, `exportCsv`, `startIndexing`, `getStorageEstimate` + one listing-specific resolver |
| `function`             | `issue-event-handler`     | `index.onIssueEvent`                 | Incremental ingestion                                                                           |
| `function`             | `backfill-consumer`       | `index.backfillHandler`              | One backfill slice                                                                              |
| `trigger`              | `issue-events`            | —                                    | `avi:jira:created                                                                               | updated | deleted:issue` |
| `consumer`             | `backfill-queue-consumer` | queue `backfill`, method `run-slice` | Backfill continuation                                                                           |

Listing-specific resolvers: `getWorklogReport` (2), `getAgingReport` (3), `getSlaReport` (4),
`getHistoryReport` (5).

**Scopes, all five apps:** `read:jira-work`, `read:jira-user`, `storage:app`. No write scope. A
test asserts this and would fail if one were added.

---

## 8. Security

| Concern                   | Treatment                                                                                                                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project authorisation** | The project id comes from the Forge resolver _context_, never from the client payload. Taking it from the payload would let any user of the instance read any project's metrics regardless of their Jira permissions.                     |
| **SQL injection**         | Every value is bound. The only thing ever interpolated into statement text is a placeholder count from `placeholders(n)`. A test feeds `"10000'; DROP TABLE issue_meta; --"` as a project id and asserts it lands in the parameter array. |
| **Unbounded reads**       | Every `LIMIT` is clamped to 10,000 and every `OFFSET` to ≥ 0. An unbounded read on a consumption-priced platform is a cost incident.                                                                                                      |
| **Log leakage**           | JQL is redacted from any error message before it reaches a log line; issue summaries can contain anything.                                                                                                                                |
| **Client leakage**        | Errors crossing to the browser are mapped to one of three fixed messages. Jira response bodies never cross that boundary.                                                                                                                 |
| **CSV injection**         | Cells starting `=`, `+`, `-`, `@`, tab or CR are quote-prefixed, so a renamed status cannot execute as a formula in Excel or LibreOffice.                                                                                                 |
| **Secrets**               | None in the repository. `.forge/` and `.env` are git-ignored.                                                                                                                                                                             |
| **Data residency**        | Nothing leaves the Atlassian tenant. There is no external service, no telemetry, no analytics.                                                                                                                                            |

---

## 9. Cost model per install

**Provenance:** Forge SQL free allowance **730 GB-hours/month**, then **$0.00076850/GB-hour**; Forge
KVS free allowance 0.1 GB/month for reads and writes respectively, with **writes ≈ 20× the cost of
reads**. Recorded from Atlassian's pricing pages on 2026-09-05. **Confirm before release** —
platform pricing moved twice in the year to 2026.

### Why Forge SQL and not KVS

The aggregate is rewritten on every relevant issue update. KVS meters _writes_ at roughly twenty
times reads, which is exactly the wrong shape. Forge SQL is priced on bytes held, which is the
right shape for a table that is small and often rewritten.

### Reference instance: 20,000 issues, 8 statuses each

| Table              | Rows    | Bytes/row (est.) | Total       |
| ------------------ | ------- | ---------------- | ----------- |
| `issue_meta`       | 20,000  | 160              | 3.2 MB      |
| `issue_status_agg` | 160,000 | 100              | 16.0 MB     |
| —                  |         |                  | **≈ 19 MB** |

`estimateStorage` returns ~18.3 MB for this profile and the test asserts it lands between 14 and
22 MB.

| Installs of this size | GB-hours/month | Billable | Cost      |
| --------------------- | -------------- | -------- | --------- |
| 1                     | 13             | 0        | **$0**    |
| 40                    | 522            | 0        | **$0**    |
| 55                    | 718            | 0        | **$0**    |
| 100                   | 1,305          | 575      | **$0.44** |
| 500                   | 6,527          | 5,797    | **$4.45** |

**Storage is not the cost driver, and exactly 55 reference-sized installs fit inside the free
tier** (the figure `estimateMonthlySqlCost` reports). These are _estimates from row counts and per-row constants_, not measurements; anywhere the
app displays them it says so.

### What actually constrains the system

1. **Jira request volume during backfill** — per-tenant rate limits, not money. A 20,000-issue
   instance is 2,400 requests spread over 200 slices, per `estimateIngestVolume`.
2. **Compute (GB-seconds) during backfill** — bounded by the time budget per slice and the
   incremental-only steady state.
3. **Storage** — last, and small.

The listings that add worklog and history rows are larger per install: a history-heavy instance can
be several times the reference figure. That is the reason `IngestDatasets` exists — each listing
ingests and stores only what it reads, so the history listing's cost does not land on the
time-in-status listing's installs.

---

## 10. Testing strategy

| Layer                    | Approach                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Time arithmetic          | **Hand-computed golden file**, plus an inverse-property check across DST boundaries                                                                    |
| Changelog reconstruction | Recorded Jira fixtures with a deliberate re-entry, plus synthetic cases for skew, gaps, renames and chained transitions                                |
| Ingestion                | Fixture-backed `FakeJiraApi` that records every call, so tests assert _request counts_ — the number that decides whether a backfill trips a rate limit |
| Store                    | `MemoryStore` is the reference implementation of the contract; `SqlMetricsStore` is asserted at the level of exact statement text and bound parameters |
| Handlers                 | Tested against a real `ListingRuntime` over `MemoryStore`                                                                                              |
| View models              | Pure functions, fully tested                                                                                                                           |
| UI components            | **Not tested.** UI Kit renders only inside Forge.                                                                                                      |
| Manifests                | Parsed and asserted: no scheduled trigger, read-only scopes, handlers and resources exist                                                              |

**No test in this repository performs a live network call.** That is what makes the suite
deterministic in CI, and it is a hard rule.

Coverage floor is **80%** on `packages/**` and CI fails below it. Current: **98.8% statements,
90.8% branches** across engine, forge-runtime and ui.

---

## 11. Known limitations, stated rather than hidden

1. **Report filtering happens partly in memory.** `buildStatusReport` over-fetches issue metadata
   and filters in the resolver. At the page sizes the UI uses this is not the bottleneck; pushing
   the filters into SQL is the first optimisation if a large instance is slow.
2. **WIP aging in working hours is approximate.** The stored `business_ms` covers the completed
   portion of the current visit; the still-running remainder is elapsed. Shown as two separate
   numbers rather than one blended one.
3. **The project-wide SLA report uses the counted-statuses model**, not the start/stop/pause timer.
   See PRODUCT-SPEC §7.
4. **Backfill defaults to 12 months of history.** Older issues are absent until "extend history"
   is run.
5. **Nothing has run on Forge.** The SQL executor, the Jira fetch adapter, every manifest and every
   UI Kit component are unverified against the platform.
6. **★ Residual issue-visibility risk, stated plainly.** The `BROWSE_PROJECTS` check establishes
   that a viewer may see the _project_. Within a project, Jira can restrict individual issues by
   issue security level — those are excluded at ingest — but Jira can also restrict visibility in
   ways this app does not model (for example a JQL-scoped board filter, or a permission scheme that
   grants browse but restricts a subset). The app does **not** re-check per-issue visibility per
   viewer, because doing so would mean an as-user query on every report render, which the
   consumption-priced platform makes prohibitive. **This must be stated in the Marketplace privacy
   statement rather than left for a reviewer to find.**
7. **`getStorageEstimate` is not exposed.** `ListingRuntime.storageEstimate()` reports
   instance-wide row counts and has no project scope, so no app registers it as a resolver. It
   stays as an internal method until there is an admin surface that can authorise it properly.

---

## 12. ⚠️ The unverified surface, exhaustively

Everything a first `forge tunnel` session must confirm, in order of risk:

| Item                                                                  | File                                                  | Risk if wrong                                              |
| --------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| Manifest module schema                                                | `apps/*/manifest.yml`                                 | `forge lint` fails; fix is minutes                         |
| `forgeSqlExecutor` call shape                                         | `packages/forge-runtime/src/sql/executor.ts`          | No persistence at all; fix is one function                 |
| `forgeJiraFetch` / `route` tagging                                    | `packages/forge-runtime/src/jira/client.ts`           | No Jira access; fix is one function                        |
| Forge SQL dialect acceptance of the DDL and `ON DUPLICATE KEY UPDATE` | `packages/engine/src/store/schema.ts`, `sql-store.ts` | Schema or upserts rejected; would need a dialect pass      |
| `@forge/react` component props                                        | `packages/ui/src/components.tsx`                      | Page does not render; fix is per-component                 |
| Async Events queue name and consumer method                           | `apps/*/manifest.yml`, `scheduler.ts`                 | Backfill never continues past slice 0                      |
| Invocation time limit vs `timeBudgetMs`                               | `packages/engine/src/ingest/backfill.ts`              | Slices time out mid-page; harmless (re-processed) but slow |
