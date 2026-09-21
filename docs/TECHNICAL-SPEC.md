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
| `packages/ui`            | View models (pure) and `@forge/react` components                                                                                                                        | Yes — the components are rendered and audited, see § 10                  |
| `packages/ui-harness`    | **Dev only, never bundled.** Stand-in Forge host renderer, Custom UI bridge stand-in, scenario builder, axe helpers, Playwright screenshot driver                       | It is the test instrument                                                |
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

**Budgets — calibrated 2026-09-15.** `issuesPerSlice` defaults to 100; `timeBudgetMs` defaults to
**630 000** (70% of 900 000). A backfill slice runs under an Async Events consumer function, whose
manifest schema allows `timeoutSeconds` up to 900 (developer.atlassian.com/platform/forge/
manifest-reference/modules/function/ and /platform/forge/limits-invocation/, both checked
2026-09-15; the un-configured default for this function type is 55 s). All five apps' manifests now
declare `timeoutSeconds: 900` on `backfill-consumer` to actually grant that ceiling — without it,
the function would still be killed at 55 s regardless of what `timeBudgetMs` says. This is a
manifest-schema ceiling, not a usage-based quota, so unlike the request-rate limits elsewhere in
this document it does not need re-checking before every release — only if Atlassian changes the
schema itself.

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

| Layer                    | Approach                                                                                                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time arithmetic          | **Hand-computed golden file**, plus an inverse-property check across DST boundaries                                                                                                                                         |
| Changelog reconstruction | Recorded Jira fixtures with a deliberate re-entry, plus synthetic cases for skew, gaps, renames and chained transitions                                                                                                     |
| Ingestion                | Fixture-backed `FakeJiraApi` that records every call, so tests assert _request counts_ — the number that decides whether a backfill trips a rate limit                                                                      |
| Store                    | `MemoryStore` is the reference implementation of the contract; `SqlMetricsStore` is asserted at the level of exact statement text and bound parameters                                                                      |
| Handlers                 | Tested against a real `ListingRuntime` over `MemoryStore`                                                                                                                                                                   |
| View models              | Pure functions, fully tested                                                                                                                                                                                                |
| UI components            | **Rendered** with `@testing-library/react` against a stand-in host renderer; every state asserted, and the structural half of an axe WCAG 2.1 AA audit on each — jsdom has no layout, so `color-contrast` is disabled there |
| App frontends            | All ten surfaces (five pages, five gadgets) rendered in loading, empty, error, refused, partial and populated states                                                                                                        |
| Pipeline → pixels        | `apps/time-in-status/test/end-to-end-ui.test.tsx` asserts the engine's numbers **in the DOM**, from the same fixture the resolver end-to-end test uses                                                                      |
| Screens a human can see  | `pnpm run ui:screens` — 60 PNGs plus an index page, and the **only** pass that checks `color-contrast`, since it has real layout. Not run in CI: it needs a browser download                                                |
| Manifests                | Parsed and asserted: no scheduled trigger, read-only scopes, handlers and resources exist                                                                                                                                   |
| Resolver wiring          | Every key a frontend `invoke()`s is `resolver.define()`d by the same app — a static scan, since neither end's suite can see the join                                                                                        |

**No test in this repository performs a live network call.** That is what makes the suite
deterministic in CI, and it is a hard rule.

Coverage floor is **80%** and CI fails below it. It now covers the app frontends as well as the
shared packages; before that the include globs matched `.ts` only, so every `.tsx` file reported no
coverage _and no gap_. Fixture-driven test support (`src/testing/`) is excluded, so the number is
about shipped code. Current: **98.6% statements, 91.5% branches** overall.

### ⚠️ What rendering does and does not establish

`@forge/react`'s UI Kit 2 exports are **string sentinels** (`exports.Box = 'Box'`), reconciled into
a ForgeDoc and posted over the bridge; the renderer that turns that document into Atlassian Design
System markup ships inside Jira and is not published. `packages/ui-harness/src/forge-host.tsx` is a
stand-in for it, mapping each sentinel onto the ADS component Forge is documented to render it as,
and `packages/ui/test/forge-host.contract.test.ts` pins that mapping to the real module.

So the suites establish that the tree is coherent, that the designed state is chosen, that the
numbers and column order reach the DOM, and that the markup is accessible. They do **not** establish
that Forge renders it identically or accepts these props. That is still `forge tunnel`'s job.

`@forge/bridge` is not mocked: it throws at _import_ time outside a Jira page because `invoke.js`
calls `getCallBridge()` at module scope. The harness installs a `globalThis.__bridge` instead, so
the real `invoke`, its payload validation and its rate limiter all run.

---

## 11. Known limitations, stated rather than hidden

1. **Report filtering happens partly in memory.** `buildStatusReport` over-fetches issue metadata
   and filters in the resolver. At the page sizes the UI uses this is not the bottleneck; pushing
   the filters into SQL is the first optimisation if a large instance is slow.

   **A 50-issue default limit — fixed.** Found bulk-seeding 150 real issues into one project and
   watching Time in Status render exactly 50 of them with no indication anything was missing:
   `ListingRuntime.statusReport` defaulted `limit` to 50 when the frontend sent none (which it
   never does — `apps/time-in-status/src/frontend/index.tsx` calls `getReport` with no `limit` at
   all), while every sibling report resolver defaults to 500 or more. Raised to 500 to match; see
   `packages/forge-runtime/test/forge-runtime.test.ts` "defaults to a limit generous enough for a
   real project, not a demo one".

   **The 500-issue ceiling — surfaced, no longer silent (2026-09-21).** `issueCount` used to be
   `filtered.length` computed _after_ `queryIssueMeta` had already capped its fetch — a page size
   posing as a total, so a project past 500 issues rendered a report that looked complete while
   quietly dropping the rest. The `COUNT(*)` query now exists: `MetricsStore.countIssueMeta`
   (with `countWorklogs`/`countHistory` for the record-shaped reports, sharing the query's own
   WHERE clauses so page and total cannot disagree), every report carries a real total
   (`projectIssueCount`/`totalEntries`/`totalMatching`) and a `capped` flag, and each of the five
   pages renders a warning banner — `toCapBanner`, through the same `IndexingBanner` component as
   the indexing states — naming "N of M" and stating that every figure is a lower bound. The
   page size itself is unchanged; what changed is that exceeding it is now visible.

2. **WIP aging in working hours is approximate.** The stored `business_ms` covers the completed
   portion of the current visit; the still-running remainder is elapsed. Shown as two separate
   numbers rather than one blended one.
3. **The project-wide SLA report uses the counted-statuses model**, not the start/stop/pause timer.
   See PRODUCT-SPEC §7. The on-page goal picker that section promises now ships (2026-09-21):
   `SlaGoalForm` in `@jfm/ui` — status toggle chips backed by a new project-authorised
   `listStatuses` resolver, and a preset working-time target `Select` — with the chosen goal sent
   to `getSlaReport` and `exportCsv` alike. An empty selection counts every status, and the form
   says so. Still a view choice, never stored configuration; the goal editor remains v1.1.
4. **Backfill defaults to 12 months of history.** Older issues are absent until "extend history"
   is run.
5. **Nothing has run on Forge.** The SQL executor, the Jira fetch adapter and every manifest are
   unverified against the platform, as is Forge's own rendering of the UI Kit tree — the components
   are rendered in CI, but through a stand-in host renderer, not by Forge.
6. **★ Residual issue-visibility risk, stated plainly.** The `BROWSE_PROJECTS` check establishes
   that a viewer may see the _project_. Within a project, Jira can restrict individual issues by
   issue security level — those are excluded at ingest — but Jira can also restrict visibility in
   ways this app does not model (for example a JQL-scoped board filter, or a permission scheme that
   grants browse but restricts a subset). The app does **not** re-check per-issue visibility per
   viewer, because doing so would mean an as-user query on every report render, which the
   consumption-priced platform makes prohibitive. **This must be stated in the Marketplace privacy
   statement rather than left for a reviewer to find.**
7. **★★ The dashboard gadgets refused on a real tenant — confirmed, and now fully fixed.** Every
   project-scoped resolver takes its project from `extension.project.id` in the platform context
   and fails closed without it. Confirmed live on 2026-09-11: adding the Time in Status gadget to
   a real dashboard rendered "This report can only be opened from inside a Jira project." every
   time — a `jira:dashboardGadget` context genuinely carries no project of its own, unlike
   `jira:projectPage`.

   **The fix:** an `edit` module (`resource: gadget`, per Forge's own manifest reference) lets the
   gadget owner choose a project explicitly; `gadget.tsx` checks
   `context.extension.entryPoint === 'edit'` and renders a picker (`GadgetConfigForm`, backed by a
   new `listProjects` resolver reading Jira as the calling user) instead of the report; the chosen
   `projectId` is submitted via `view.submit` and read back through
   `extension.gadgetConfiguration.projectId` — a second, equally-trustworthy fallback in
   `projectIdFromContext` (`packages/forge-runtime/src/handlers.ts`), since it arrives through the
   platform context, never the client payload, exactly like `extension.project.id` does. All of
   this is unit-tested and deployed.

   **Root cause of the disabled "Настроить" (Configure) menu item, found and fixed 2026-09-15:**
   the manifest's `edit:` block only declared `resource: gadget`. Forge's manifest reference lists
   `edit.render: 'native'` as a valid sibling field alongside `edit.resource` — the module's
   top-level `render: native` does not propagate down to `edit`, it needs its own. Without it, Jira
   accepts the manifest (lint and deploy both pass — the shape isn't invalid, just incomplete) but
   never wires up the edit affordance, so the "Настроить" item stays permanently disabled. Adding
   `render: native` under `edit:` and redeploying fixed it immediately: confirmed live on both the
   admin system-default dashboard and a fresh personal dashboard — the gadget now shows its project
   picker automatically when unconfigured, saves a project, and renders a real report (`Issues: 181`
   plus per-status medians against the seeded `JFMB` project, 2026-09-15). All five apps carry the
   fix, were independently lint-checked and redeployed to `development`, and `wip-aging` was
   independently re-verified live on the same dashboard (config screen → save → report render,
   confirming the fix generalizes rather than being specific to `time-in-status`). `pnpm run verify`
   is green after the change. This closes the last open question in this item — the manifest shape
   needed one more field, not a Jira-side cache or an unfixable platform gap.

8. **CSV export is reachable — resolved.** `exportCsv` had been defined by all five resolvers,
   implemented in `packages/engine/src/export/csv.ts`, defused against formula injection, covered
   by tests, listed as a v1 feature of every listing — and invoked by nothing, so no user could
   reach it. `CsvExport` in `@jfm/ui` is now on all five project pages, and
   `test/resolver-wiring.test.ts` asserts the opposite of what it used to.

   **It shows the file rather than downloading it,** which is a decision worth recording. UI Kit 2
   renders in a sandbox with no DOM: no `Blob`, no `<a download>`. The documented workaround —
   `router.open` on a `data:text/csv` URI — fails for a reason unrelated to Forge, in that Chrome
   blocks top-level navigation to `data:` URLs, so the tab opens onto nothing. A Custom UI resource
   would have real DOM and a real download, and converting one surface away from `render: native`
   to get it is a v1.1 question. Until then the export opens in a modal, selectable, with its
   filename, and says why.

   **Every listing now exports its own report (2026-09-21).** Drafting the four remaining
   Marketplace listings surfaced that all five apps wired `exportCsv` to `statusReportCsv` — the
   time-in-status table — so on listings 2–5 the button exported the wrong report (on
   worklog-reports, whose ingest stores no status durations, an empty one). `handleExportCsv` now
   takes a per-listing `CsvExportKind`; each app passes its own, and
   `packages/forge-runtime/src/report-csv.ts` renders the worklog, aging, SLA and history tables
   as CSV (hours as numbers, ISO timestamps, formula injection defused by the shared `csvCell`).
   The SLA export parses the same goal payload as the report resolver (`parseSlaGoal`), so the
   exported rows are measured against exactly the goal on screen.

9. **The WIP aging histogram is built — resolved.** `AgingReport.buckets` and `toAgingChartData`
   existed and were tested; no component rendered them. `AgingHistogram` in `@jfm/ui`
   (`packages/ui/src/components.tsx`) now does, using `@forge/react`'s native `BarChart` rather
   than a hand-rolled chart — the platform ships one. It sits on the `wip-aging` project page
   between the summary tiles and the table, rendering all six buckets (0-1d through 30d+) even
   when a bucket is empty, so the histogram cannot silently drop a category. The stand-in host
   renderer (`packages/ui-harness/src/forge-host.tsx`) draws each bar as a plain proportional
   `<div>` next to real label/value text nodes, since no `@atlaskit` chart package is installed in
   this workspace to stand in for `@atlassian/viz-platform-charts` — like every other stand-in,
   this proves the right data reaches the DOM in the right order, not that Forge's real chart
   renders identically.
10. **`getStorageEstimate` is not exposed.** `ListingRuntime.storageEstimate()` reports
    instance-wide row counts and has no project scope, so no app registers it as a resolver. It
    stays as an internal method until there is an admin surface that can authorise it properly.

11. **★★ A backfill can stall on a corrupted Jira pagination cursor — not our bug, took three
    attempts to fix correctly, the third confirmed live.** Bulk-seeding 300 real issues into one
    project inside about ten minutes (`pnpm run seed:bulk`), a listing's backfill fails with
    `Jira responded 400 for /rest/api/3/search/jql`. Decoding the rejected `nextPageToken` shows
    it is not garbage: it is a structured Jira cursor whose payload literally contains the string
    `TENANT_NOT_FOUND_IN_TENANT_STORE`, Jira's own backend error, baked into what an _earlier,
    successful_ page response handed back to us as the token to use next. The trigger position is
    not fixed — reproduced at different page/slice positions across different attempts — only the
    error shape is. `encodeCursor`/`decodeCursor` were confirmed innocent — they round-trip the raw
    token unmodified — so the corruption is in what Jira itself returned. Working theory: this free
    developer site's search index can fall behind under a synthetic write burst this fast, and
    paginating while it catches up hands back a broken cursor instead of a 5xx.

    **Attempt 1 (wrong):** classify the _error_ Jira returns when a corrupted token is presented
    back to it — `isCorruptedCursorError`, checking `HttpError.body`/`.message` for the marker
    string. Deployed, then confirmed live to never fire: calling `/rest/api/3/search/jql` directly
    with a captured corrupted token showed Jira's real rejection is a generic, localized "invalid
    or expired" message — the marker never appears in Jira's response, only in the _request_ path,
    still base64-encoded, so a plain substring check can't find it there either. Every live
    occurrence was missed.

    **Attempt 2 (correct classification, incomplete guard):** move detection to the token itself —
    `isCorruptedCursor(token)`, base64-decoding it and checking for the marker _before_ the request
    that would fail is ever sent, not after. This is the right place to look, confirmed by
    reproducing the rejection directly against Jira. On recovery, the token is discarded and the
    search reissues fresh, bounded by `created >= <last durably-written issue's created>` — Jira's
    enhanced search endpoint is token-only, no `startAt`/offset exists, so a JQL reseek is the only
    way to "restart from a computed offset". The bound travels on the cursor string itself
    (`::seek=`, alongside the existing `::skip=`), so it survives a slice boundary without a store
    schema change. Deployed — and then **caused a live incident**: `formatJqlInstant` bounds by
    _minute_, not millisecond (JQL's simple date literal has no finer grain), and a fast bulk seed
    routinely puts dozens of issues in the same created-minute. The reseek kept landing on the
    identical corrupted boundary within that minute, recovering "successfully" every time while
    making zero forward progress — `issuesProcessed` climbed to over 5,000 against a 300-issue
    project before the fix below stopped it, each cycle a real, billed Forge invocation.

    **Attempt 3 (shipped, confirmed live 2026-09-15):** a same-bound reseek must never be attempted
    twice. A fourth cursor marker, `::attempted=`, records the bound of the most recent reseek
    _attempt_, kept deliberately separate from `::seek=` (which is attached to every persisted
    cursor as a resume bookmark, corrupted or not — conflating the two was tried first and broke
    the legitimate case where a fresh corruption is discovered right at a slice boundary and
    deferred one slice, since the inherited bookmark looked identical to an already-failed attempt
    and made a recoverable interruption fail immediately instead). If a corrupted cursor's
    `lastCreatedAt` matches the persisted `::attempted=` bound — meaning a reseek from exactly this
    point was already tried, by this slice or an earlier one, with nothing written since — the
    slice throws and the backfill is marked `failed` rather than reseeking again. Confirmed live:
    the guard fired with the exact expected message after 49 slices (the queue backlog already
    in flight before the fix deployed), and `issuesProcessed` stopped climbing immediately.

    **Tested:** `packages/engine/test/ingest.test.ts` — `isCorruptedCursor`'s token-decoding
    classification (a real captured token, a synthetic one, a healthy token, null, non-base64
    input, and the marker appearing un-encoded, which must **not** match), the cursor encoding
    round-trip with all three optional markers present, and `runBackfillSlice` integration cases
    covering: single recovery mid-backfill; two recoveries in one continuous run at different,
    recomputed bounds; the no-prior-progress failure case; recovery deferred across a slice
    boundary (the case attempt 3's redesign had to keep working); and the incident itself — a
    slice inheriting an already-attempted, unresolved bound fails immediately with zero API calls,
    rather than reseeking again. `pnpm run verify` is green; `backfill.ts` is at 100%
    statement/line coverage.

    **Confirmed, not just fixture-tested:** unlike the previous two attempts, this one was verified
    against the actual failure on the actual dev site, not only against a reconstructed fixture —
    the live incident it stops is the same live incident that motivated it.

---

## 12. ⚠️ The unverified surface, exhaustively

Everything a first `forge tunnel` session must confirm, in order of risk:

| Item                                                                  | File                                                  | Risk if wrong                                                                                                                                                         |
| --------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest module schema                                                | `apps/*/manifest.yml`                                 | `forge lint` fails; fix is minutes                                                                                                                                    |
| `forgeSqlExecutor` call shape                                         | `packages/forge-runtime/src/sql/executor.ts`          | No persistence at all; fix is one function                                                                                                                            |
| `forgeJiraFetch` / `route` tagging                                    | `packages/forge-runtime/src/jira/client.ts`           | No Jira access; fix is one function                                                                                                                                   |
| Forge SQL dialect acceptance of the DDL and `ON DUPLICATE KEY UPDATE` | `packages/engine/src/store/schema.ts`, `sql-store.ts` | Schema or upserts rejected; would need a dialect pass                                                                                                                 |
| **Dashboard gadget context: does it carry `extension.project`?**      | `packages/forge-runtime/src/handlers.ts`              | **All five gadgets refuse and show no data.** Highest-risk item on this list; see § 11.7                                                                              |
| `@forge/react` component props **as Forge accepts them**              | `packages/ui/src/components.tsx`                      | Page does not render; fix is per-component. The tree, the states and the copy are verified against a stand-in renderer; the platform's acceptance of the props is not |
| Async Events queue name and consumer method                           | `apps/*/manifest.yml`, `scheduler.ts`                 | Backfill never continues past slice 0                                                                                                                                 |
| Invocation time limit vs `timeBudgetMs`                               | `packages/engine/src/ingest/backfill.ts`              | Slices time out mid-page; harmless (re-processed) but slow                                                                                                            |
