# LISTING-COPY — listing ② Worklog Reports, ready to paste

> Drafted from `PROMOTION.md` § 1 and `PRODUCT-SPEC.md` § 5. Every claim here is one this repository
> can back with a test or the deployed app — nothing here is aspirational copy waiting on a feature.
> Where the spec promises something the shipped surfaces do not yet expose, the claim is **withheld**
> and the gap is recorded in § "Claims withheld" rather than papered over. Paste directly into the
> Marketplace listing form; adjust only if the actual screenshots (§ "Screenshots") end up captioned
> differently than assumed here.

---

## Pre-submission checks — ROADMAP stage 4, run 2026-09-21

The two checks that cost minutes and have killed whole directions, re-run via web search on
**2026-09-21** (baseline measurement date: 2026-09-05).

### Check 1 — has Atlassian shipped native worklog/timesheet reporting in Jira Cloud?

**No evidence found.** Searches for a native Jira Cloud timesheet or worklog report announcement
since 2026-09-05 surface only Marketplace apps and 2026-dated guides that still describe the native
situation the same way this product's spec does: Jira records worklogs per issue, JQL worklog search
returns issue-level results with no aggregated per-person totals, and Atlassian's own blog answers
the timesheet question by recommending Marketplace apps. A September 2026 release found in the
results ("Timesheets for Jira" 3.19.0, 2026-09-03) is a third-party app, not a platform feature.

Sources checked 2026-09-21:

- [Time Tracking and Timesheets in Jira — Detailed Guide for 2026 (Atlassian Community)](https://community.atlassian.com/forums/App-Central-articles/Time-Tracking-and-Timesheets-in-Jira-Detailed-Guide-for-2026/ba-p/3168823)
- [The Ultimate Guide to Jira Time Tracking: Native Features, Reports, and Plugins (Atlassian Community)](https://community.atlassian.com/forums/App-Central-articles/The-Ultimate-Guide-to-Jira-Time-Tracking-Native-Features-Reports/ba-p/3175945)
- [5 Jira time tracking apps for teams to consider (Atlassian's own blog)](https://www.atlassian.com/blog/jira/time-tracking-apps)
- [Atlassian Cloud roadmap](https://www.atlassian.com/roadmap/cloud) — no timesheet/worklog-report item surfaced in search results

**Result: pass.**

### Check 2 — has a free first-party or well-funded free app appeared at the top of the niche?

**No evidence of one.** The most-installed app in the niche remains Tempo Timesheets — paid. The
free apps visible in 2026 search results are small utilities, not niche leaders: "Simple Timesheet
Export – Free Worklog Generator" and TimeEase's free edition. That matches the 2026-09-05 baseline
("only one free app in the top ten", PRODUCT-SPEC § 5); nothing found suggests a first-party or
well-funded free entrant has taken the top since.

Sources checked 2026-09-21:

- [Simple Timesheet Export – Free Worklog Generator for Jira (Marketplace)](https://marketplace.atlassian.com/apps/1235710/simple-timesheet-export-free-worklog-generator-for-jira)
- [TimeEase - Time Tracker, Timesheet & Worklog Viewer for Jira (Marketplace)](https://marketplace.atlassian.com/apps/1237668/timeease-time-tracker-timesheet-worklog-viewer-for-jira)
- [Tempo — Time Tracking Software for Jira](https://www.tempo.io/products/jira-time-tracking)

**Caveat:** web search cannot re-measure install counts. Before the actual submission day, re-run
the Marketplace REST API measurement exactly as on 2026-09-05 and compare the top ten by installs.

**Result: pass, with that caveat.**

### Conclusion: **GO**

Neither kill condition holds: Atlassian has not shipped this natively, and no free app has taken
the top of the niche. The niche is still the flattest one measured — seven independents, none
dominant. The one internal blocker this section used to carry — the CSV export button exporting
the wrong report — was fixed on 2026-09-21; see § "Claims withheld" item 1.

---

## Title

```
Worklog Reports & Time Tracking for Jira
```

The listing name in `PRODUCT-SPEC.md` § 5 and `packages/engine/src/config/pricing.ts`
(`WORKLOG_PRICING.listingName`), plus "for Jira". Under the Marketplace's list-view truncation
length. `Worklog`, `Reports`, `Time Tracking` are all searched terms; no adjectives. "Timesheet"
is deliberately **not** in the title — the app renders a grouped totals table, not a people × days
timesheet grid, and a buyer searching "timesheet" who installs this churns.

## Tagline (search results, one line)

```
Logged time totalled per person — exactly the durations people typed into Jira, never re-derived.
```

The one factual, checkable claim this listing has, and the product's stated design principle
(`packages/engine/src/metrics/worklog.ts`): a worklog is a stated duration attached to a stated
instant, and the report totals what the user typed, never a duration recomputed from timestamps.
Checkable in one click against any issue's own work log.

## Description

Paste as five sections, in order. Headings included for editing; the Marketplace form may want
them as plain paragraph breaks — check the form before pasting.

---

### The gap

Jira records every worklog faithfully — on the issue it belongs to. What it does not give you is
the project-wide answer to "who logged how much this month, and what share of the total was
that?". **Worklog Reports totals your project's logged time per person**, largest contributor
first, with each row's share of the total, its entry count and how many distinct issues it
touched — and the totals are **exactly the durations people typed into Jira**. If someone logged
"3h", three hours is what gets totalled; nothing is ever re-derived from timestamps, and an entry
Jira returns without a time-spent value is dropped rather than counted as zero.

### What you get

- **Logged time per person** across the whole project, sorted largest-first — the roll-up Jira's
  own issue-level worklogs don't give you.
- **Share of total, entry count and distinct-issue count** on every row, so "60% of last month's
  logged time was one person on two issues" is one glance, not a spreadsheet session.
- **Summary tiles** — total logged time with the entry count, and the largest contributor — the
  two numbers a review meeting opens with.
- **Totals you can check**: open any issue's own work log and the typed durations match the
  report, entry for entry.
- **Restricted worklogs stay restricted.** A worklog limited to a project role or group is
  excluded from the report entirely — it under-reports rather than shows restricted numbers to
  the wrong audience.
- **CSV export** — one click opens the person-grouped totals as CSV with its filename, ready to
  select and copy into whatever spreadsheet you already use.
- **A dashboard gadget** — the totals your team sees without anyone installing anything, with a
  per-gadget project picker.
- **An honest indexing banner** — visible for as long as the numbers are built from partial
  history, never silently hidden.

### What it does not do

No timers, no worklog editing, no approval workflows, no billing rates, no invoicing — those make
this a time-tracking suite competing with products that already do them well, rather than a
reporting app. No people × days timesheet grid. No cross-project rollups — each report covers one
project. It answers one question, properly: where did this project's logged time actually go.

### How it works

Reads worklogs through Jira's own REST API. Aggregates are stored inside **your** Atlassian tenant
via Forge SQL — nothing leaves it, nothing is sent to a third party, and the app requests no write
scope. Every report is checked against **your own** Jira permissions before it returns anything,
not the app's.

### Pricing

Free for teams up to 10 users — the whole product, not a limited trial. Above that:

| Seats       | 10       | 50       | 100      | 500        |
| ----------- | -------- | -------- | -------- | ---------- |
| **Monthly** | **Free** | **$250** | **$500** | **$1,500** |

⚠️ **Do not write "the most affordable option" anywhere in this listing.** Per `PRODUCT-SPEC.md`
§ 5 and the `WORKLOG_PRICING` positioning record: HeroCoders Clockwork Lite (7,030 installs) and
SolDevelo Worklogs (5,390) both sell at **$200**/50 users — below this price — and votazz sells at
$175. This listing is positioned against Decadis sumUp at $375, and it is not the cheapest.

---

## Privacy and security

Paste into the Marketplace's privacy and security statement field, not the description. Every line
is backed by a manifest test or a stated design decision — see `PRODUCT-SPEC.md` § 9,
`TECHNICAL-SPEC.md` § 8 and § 11 item 6, and `packages/engine/src/metrics/worklog.ts`
(`toWorklogRecord`).

- **No customer data leaves your Atlassian tenant.** Every aggregate is stored in Forge SQL,
  inside your own installation — no external service, no telemetry, no analytics.
- **Read-only.** The app requests no Jira write scope. Scopes used: `read:jira-work`,
  `read:jira-user`, `storage:app` — nothing else (`apps/worklog-reports/manifest.yml`).
- **Your own permissions are checked before anything is returned.** Every report verifies
  `BROWSE_PROJECTS` for the person viewing it, as that person — not as the app, which reads Jira
  under its own identity everywhere else.
- **Issues under an issue security level are never indexed**, and **worklogs restricted to a
  project role or group are dropped at ingest** — because the app ingests as the app, a restricted
  worklog would otherwise be totalled into a report visible to exactly the people the restriction
  excludes. Both choices under-report rather than over-disclose.
- **The residual, stated here rather than left for a reviewer to find:** the `BROWSE_PROJECTS`
  check establishes that a viewer may see the _project_. Within a project, the app does **not**
  re-check per-issue visibility for each viewer on every render — for example a JQL-scoped board
  filter, or a permission scheme that grants project browse but restricts a subset of issues, is
  not modelled. Doing that check would mean an as-user Jira call on every report render, which a
  consumption-priced platform makes prohibitive. The issue-security-level exclusion, the
  restricted-worklog drop and the project-level check happen on every ingest or read; this
  narrower, per-issue case does not.

---

## Claims withheld — spec promises the shipped surfaces do not back

Recorded so nobody re-adds them to the copy without checking. All three are claims
`PRODUCT-SPEC.md` § 5 lists as in scope; the copy above omits them because the code, as wired
today, does not deliver them to a user.

1. **CSV export — RESOLVED 2026-09-21, claim restored.** The button used to be miswired:
   `exportCsv` → `handleExportCsv` → `runtime.statusReportCsv` — the **time-in-status** CSV, on a
   listing whose ingest deliberately stores no status durations. Fixed: `handleExportCsv` now
   takes a per-listing kind, and this app passes `'worklog'`, exporting the person-grouped
   worklog table (`worklogReportToCsv` in `packages/forge-runtime/src/report-csv.ts`); listings
   ③, ④ and ⑤ carried the same miswiring and got the same fix. Tested in
   `packages/forge-runtime/test/report-caps-and-csv.test.ts`. Screenshot #6 is unblocked —
   capture only after visually confirming the modal shows the worklog CSV.
2. **Grouping by issue, day, ISO week or month — withheld.** The resolver accepts `groupBy`
   (`handleWorklogReport` validates author/issue/project/day/week/month) and the engine computes
   all six, tested — but the page sends `{}` and renders the person grouping only; no UI control
   exposes the choice. The claim returns when a picker ships. Same for the **date-range window**
   (`from`/`to` accepted by the resolver, no UI) and the **author filter** (`authorAccountIds`
   exists on `WorklogReportRequest` but the resolver handler never reads it from the payload).
   Note: the gadget's manifest `description` and the page subtitle both currently say "grouped by
   person, issue or period, over any date range" — bring those in line too, whichever way this
   goes.
3. **"Dropped and counted" — half withheld.** Unattributable and restricted worklogs are dropped
   (verified, tested), but no counter of dropped entries is stored or surfaced anywhere in the UI.
   The copy above says dropped entries are "dropped rather than counted as zero" — true — and does
   not claim the app reports how many were dropped, because it doesn't.

---

## Screenshots — 5 planned (6 if the CSV fix lands), all **pending capture**

Capture against the seeded dev site (`sergiip180.atlassian.net`) with the worklog-reports app
deployed and installed — it has been lint-checked and deployed to `development`
(TECHNICAL-SPEC § 11 item 7) but, unlike listing 1, none of its surfaces has been screenshotted
yet. `tools/seed-scenarios.mjs` seeds worklogs (`worklogHours` per scenario) spread over real past
days, so a freshly indexed project has genuine data. **One prerequisite for #1:** the seed logs
all work as the one API user, so the person grouping would render a single row — before capturing,
log a handful of worklogs from at least two other (plausible, non-personal) test accounts so the
table and the Share column mean something. Chrome-free crops, PNGs into `docs/listing-assets/`
using the `07-`-style numbering with a `worklog-` prefix.

| #   | Shows                                                                                    | Caption (draft)                                                                       | Capture instructions                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Status              |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1   | The person-grouped table: Time logged, Share %, Entries, Issues columns, ≥3 people       | "Who logged how much — with each person's share of the total."                        | Project page → Apps → Worklog Reports on the seeded project, after indexing completes (no banner visible) and after worklogs exist from ≥3 accounts. Crop to header + table. The Share column must show a spread (e.g. 55/30/15), not a single 100% row.                                                                                                                                                                                                                            | **pending capture** |
| 2   | The table footnote line under the same table                                             | "Totals are the durations people entered in Jira — never re-derived from timestamps." | Same page as #1; crop to the total line: "_Nh logged across N entries. Totals are the durations people entered in Jira, not durations derived from timestamps._" This is the honesty line — it is the product's argument, so it gets its own frame.                                                                                                                                                                                                                                 | **pending capture** |
| 3   | One seeded issue's own work log panel beside (or after) the matching report row          | "Check it yourself: the report's total is the sum of what was typed on the issue."    | Open a seeded issue with several worklogs (pick one whose `worklogHours` list has 3+ entries in `tools/seed-scenarios.mjs`), show its work log entries; the typed durations must visibly sum to that issue's contribution in the report.                                                                                                                                                                                                                                            | **pending capture** |
| 4   | Summary tiles: Total logged (+ entry count hint) and Largest contributor (+ their hours) | "The two numbers a review meeting opens with, already computed."                      | Same page as #1, crop to the tile row alone (the listing-1 `04-summary-tiles.png` crop is the model). Both tiles must show real values — no "—".                                                                                                                                                                                                                                                                                                                                    | **pending capture** |
| 5   | The dashboard gadget on a real, plausibly named dashboard                                | "Logged time totals, seen by your team — not just whoever installed it."              | Add the "Logged time" gadget to the "Engineering Team Dashboard" used for listing 1's #5, configure its project via the picker, capture the view state with real tiles. First **verify live** that this app's gadget Configure works — the fix was confirmed live on time-in-status and wip-aging, not on this app (TECHNICAL-SPEC § 11 item 7). If indexing is mid-run, either wait or deliberately include the "Indexing is still in progress" note — never crop it half-visible. | **pending capture** |
| 6   | CSV export modal — filename and full CSV text ready to select and copy                   | "Copied in one click — paste it into whatever spreadsheet you already use."           | **Blocked** on the exportCsv wiring fix (§ Claims withheld item 1). Only capture once the modal demonstrably shows the worklog table's CSV. If the fix does not land, submit with 5 screenshots and no CSV claim anywhere.                                                                                                                                                                                                                                                          | **blocked**         |

Alt text: describe what the screenshot proves, not what it contains — e.g. "Report table showing
three people's logged time with a 55% share for the largest contributor, matching the durations
entered on the issues" rather than "A table."

## Keyword placement checklist

`worklog` · `time tracking` · `timesheet` · `logged time` · `time report` · `worklog report` ·
`time spent` · `work log`

- [x] Title carries `Worklog`, `Reports` and `Time Tracking`
- [x] Tagline carries `logged time` and the core claim without keyword stuffing
- [x] First paragraph ("The gap") carries `worklog`, `logged time`, `time spent` (as "time-spent value")
- [ ] `timesheet` — deliberately absent from title and tagline (no timesheet grid exists); place it
      once, honestly, in a screenshot caption or the "what it does not do" context if the form's
      keyword field wants it
- [ ] Screenshot captions — add 1-2 more keyword terms once final captions are set
