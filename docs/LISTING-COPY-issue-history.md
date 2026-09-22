# LISTING-COPY — listing ⑤ Issue History, ready to paste

> Drafted from `PROMOTION.md` § 1, `PRODUCT-SPEC.md` § 8 and the shipped code in
> `apps/issue-history` + `packages/engine/src/metrics/history.ts`. Every claim here is one this
> repository can back with a test, the deployed app, or the seeded dev site — nothing here is
> aspirational copy waiting on a feature. Paste directly into the Marketplace listing form; adjust
> only if the actual screenshots (see § "Screenshots" below) end up captioned differently than
> assumed here.

---

## Pre-submission checks — run 2026-09-21 (ROADMAP stage 4)

The two checks that "cost minutes and have killed whole directions", re-run before this submission.
Both were performed by web search on **2026-09-21**; sources and what was actually seen are listed
so the check can be re-verified rather than trusted.

### Check 1 — has Atlassian shipped native issue-history / changelog reporting since 2026-09-05?

**No.** Searched the Jira Cloud Platform changelog
(`developer.atlassian.com/cloud/jira/platform/changelog/`), the Atlassian developer changelog, and
Atlassian's own support documentation for issue history
(`support.atlassian.com/jira/kb/how-to-analyze-the-history-or-changelog-of-an-issue-in-jira/`).
Nothing announcing cross-issue, filterable or exportable field-change reporting has shipped or been
announced since 2026-09-05. Jira's native surfaces remain what PRODUCT-SPEC § 8 says they are: the
**per-issue History tab** and the **admin audit log** (configuration events, not issue field
changes — Atlassian's "Audit activities in Jira" page confirms its scope is unchanged). Atlassian's
own KB still answers "how do I analyze the changelog" by pointing at the REST API and Marketplace
apps. The September 2026 changelog entries found were platform items (an Atlassian Analytics
dashboard-subscription deprecation, Forge maintenance) — none of them this feature.

### Check 2 — has a free first-party or well-funded free app taken the top of the niche?

**No.** The niche leader is still **SaaSJet Issue History for Jira (Work Item History)**, and it is
still a paid app in active development:

- Marketplace listing (`marketplace.atlassian.com/apps/1220385/`, read 2026-09-21): **3,091
  installs** (repo measured 3,128 on 2026-09-05 — flat, slightly down), **4.7★ over 95 reviews**,
  latest release **v11.13.0 on 2026-09-17** (sprint-transition filters, Isolated Cloud support).
  Two paid editions (Standard / Advanced — Advanced adds bulk revert, Excel reports, API access).
- **Current dollar pricing could not be read** from either the Marketplace page or SaaSJet's own
  pricing page (`help.saasjet.com/ih_cloud/pricing-plans` is a navigation hub without figures).
  The only measured figure this repo has is **$750/50 users on 2026-09-05** (Marketplace pricing
  API, recorded in `packages/engine/src/config/pricing.ts`). **Re-read the live price from the
  Marketplace pricing page on submission day** — "half the leader's price" below depends on it,
  and a Standard/Advanced split may have moved the entry price since it was measured.
- The only free app found in the niche, _Issue History Analytics Lite_ (Appalassians), has **9
  installs, zero reviews, and no release since 2025-05-05** — not a well-funded free leader, not a
  threat. No first-party free entry exists.

### Conclusion: **GO**

Neither kill condition is met: Atlassian has not shipped this natively, and no credible free app
sits on top of the niche. The competitive frame from PRODUCT-SPEC § 8 still holds — an actively
maintained, well-rated paid leader, which this listing undercuts on price and scope, never on
claimed quality (PROMOTION.md: no superiority claims; SaaSJet ships monthly and its reviews are
good).

**One blocker before submission, found while verifying claims for this copy — see § "Known
mismatch" below the screenshots table.** The GO is for the direction; the blocker is an afternoon
of wiring, not a market problem.

---

## Title

```
Issue History & Audit Log Reports for Jira
```

Under the Marketplace's list-view truncation length. `Issue History` and `Audit Log` are the
listing's own name in `pricing.ts` and both are searched terms; `Reports` matches how buyers
describe what they want. No adjectives.

## Tagline (search results, one line)

```
Every field change across the whole project in one table — not one issue's History tab at a time.
```

The one factual, checkable claim the product has. It names the shape of the native feature
(per-issue), not a flaw in a competitor, and a buyer can verify it against their own Jira in
seconds.

## Description

Paste as five sections, in order. Headings included for editing; the Marketplace form may want them
as plain paragraph breaks instead of literal `##` — check the form before pasting.

---

### The gap

Jira records every field change, but only shows it **one issue at a time**, in the History tab —
unfiltered, paginated, and with no way to ask a question across issues. "Who changed the due dates
last week?" or "which fields churn the most in this project?" means opening issues one by one.
**Issue History flattens every change in the project into one table**: one row per field change,
with the issue, the field, the old value, the new value, who made it, and when.

### What you get

- **Every field change across every issue in a project, one row per change** — timestamp (labelled
  UTC), issue key, field, from-value, to-value, author.
- **A change count and a "busiest field" summary** — the field with the most churn, with how many
  changes across how many issues, at the top of the report.
- **CSV export of the change log itself** — one click opens the rows as CSV with a filename,
  ready to select and copy into whatever spreadsheet or audit file you already use.
- **A dashboard gadget** — the change count and busiest field on a dashboard, for the people who
  never open the app. The gadget owner picks which project it reports on.
- **An honest indexing banner** — visible for as long as the table is built from partial history,
  never silently hidden.
- **12 months of history indexed by default** — stated here rather than discovered later: the
  backfill reads the most recent 12 months of changelog when a project is first indexed, and new
  changes are captured as they happen from then on.
- **A chart of changes per field**, busiest first, so churn is visible before the rows are read.
- **An admin storage page** — the rows and megabytes this app holds in your tenant.

### What it does not do

No comment history and no attachment history — this is field changes. No permission or
configuration auditing: that is Jira's own admin audit log, a different product, and this app does
not duplicate it. No restore, no undo, no rollback of any kind — it reports what changed, it never
changes anything back. If you need bulk revert or issue-level recovery, the incumbent apps in this
category do that and this one deliberately does not.

### How it works

Reads issue changelogs through Jira's own REST API. Everything is stored inside **your** Atlassian
tenant via Forge SQL — nothing leaves it, nothing is sent to a third party, and the app requests no
write scope. Every report is checked against **your own** Jira permissions before it returns
anything, not the app's.

### Pricing

Free for teams up to 10 users — the whole product, not a limited trial. Above that, $7.50/user to
100 seats, then $3.75 to 500, then $1.90:

| Seats       | 10       | 50       | 100      | 500        |
| ----------- | -------- | -------- | -------- | ---------- |
| **Monthly** | **Free** | **$375** | **$750** | **$2,250** |

Do **not** write "half the leader's price" into the public copy without re-measuring: SaaSJet's
$750/50 users was measured 2026-09-05 (`pricing.ts`), and its current Standard/Advanced pricing
could not be read on 2026-09-21. Positioning language stays out of the pasted description either
way — the table is the claim.

---

## Privacy and security

Paste into the Marketplace's privacy and security statement field, not the description. Every line
is backed by a manifest test or a stated design decision — see `PRODUCT-SPEC.md` § 9 and
`TECHNICAL-SPEC.md` § 8 and § 11 item 6.

- **No customer data leaves your Atlassian tenant.** Every record is stored in Forge SQL, inside
  your own installation — nothing is sent to a third party, no telemetry, nothing is logged
  externally.
- **Read-only.** The app requests no Jira write scope. Scopes used: `read:jira-work`,
  `read:jira-user`, `storage:app` — nothing else (asserted in `apps/issue-history/manifest.yml`
  and by manifest test).
- **Your own permissions are checked before anything is returned.** Every report verifies
  `BROWSE_PROJECTS` for the person viewing it, as that person — not as the app, which reads Jira
  under its own identity everywhere else.
- **Issues under an issue security level are never indexed.** Their field changes are excluded at
  ingest, which under-reports rather than over-discloses. Field-change history is more sensitive
  than durations — an old value survives in the history after someone edits it away — so this
  exclusion matters more on this listing than on any other in the family.
- **The residual, stated here rather than left for a reviewer to find:** the `BROWSE_PROJECTS`
  check establishes that a viewer may see the _project_. Within a project, the app does **not**
  re-check per-issue visibility for each viewer on every render — for example a JQL-scoped board
  filter, or a permission scheme that grants project browse but restricts a subset of issues, is
  not modelled. Doing that check would mean an as-user Jira call on every report render, which a
  consumption-priced platform makes prohibitive. The issue-security-level exclusion and the
  project-level check happen on every read; this narrower, per-issue case does not.

---

## Screenshots — 6, in this order · ALL PENDING CAPTURE

None captured yet. Capture against the seeded dev site (`sergiip180.atlassian.net`), the same way
listing 1's were: from the deployed Forge app, not the `ui:screens` harness; cropped, chrome-free
PNGs into `docs/listing-assets/` with an `ih-` prefix. The first-ever real report of the whole
project was this app's — **"104 field changes" on 9 issues** (ROADMAP 1.4) — so the small seeded
project is known to render; prefer the bulk-seeded project (`JFMB`, 181+ issues) where a fuller
table reads better.

| #   | Shows                                                                  | Caption (draft)                                                               | Capture instructions                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The report table: When (UTC) · Issue · Field · From · To · By          | "Every field change in the project, one row per change."                      | **pending** — Issue History project page on the seeded project, `ready` state, fully indexed (no banner). Must show multiple issue keys and at least three different fields (Status, Assignee, one more) so "cross-issue" is visible; the "_N_ changes shown" footnote in frame.                                 |
| 2   | Summary tiles: total changes + busiest field with its hint             | "Which field churns the most — with how many changes across how many issues." | **pending** — same page, cropped to heading + tile row alone (mirror listing 1's #4 crop). The busiest-field tile must show a real hint line ("_N_ changes across _M_ issues"), not the em-dash empty state.                                                                                                     |
| 3   | One issue's native History tab next to that issue's rows in our table  | "Check it yourself: it's the same history Jira shows one issue at a time."    | **pending** — pick one seeded issue with 3+ changes; capture its Jira History tab and the same rows filtered by eye in our table (same author, same values). Mirrors listing 1's checkability shot. Ensure the dev site UI language is English before capture (listing 1's #2 shipped with a Russian tab label). |
| 4   | The dashboard gadget on a real dashboard                               | "Seen by your team, not just whoever installed it."                           | **pending** — production install, "Engineering Team Dashboard" (the same dashboard listing 1's #5 used), gadget configured to the seeded project via its own project picker. Real data in the tiles, no development badge.                                                                                       |
| 5   | The indexing banner over a partially indexed project                   | "Never a silent number: while indexing runs, the report says so."             | **pending** — start indexing a freshly added project and capture while the backfill is running (the 181-issue project gives a usable window). Banner + partial table in one frame.                                                                                                                               |
| 6   | Export CSV modal — filename and full CSV text ready to select and copy | "Copied in one click — paste it into whatever spreadsheet you already use."   | **pending** — unblocked by the 2026-09-21 export fix. Click Export CSV on the project page and capture the modal only after confirming it shows history rows (Changed at/Issue key/Field/From/To/Author), not a status table.                                                                                    |

Alt text: describe what the screenshot proves, not what it contains — e.g. "Table rows for three
different issues showing assignee and due-date changes with old and new values, which Jira's
per-issue History tab cannot show on one page" rather than "A table."

### Known mismatches — status as of 2026-09-21

Found while verifying this copy against the code, recorded here so nothing is forgotten at paste
time:

1. **The CSV export exported the wrong report — RESOLVED 2026-09-21.** `exportCsv` used to call
   `runtime.statusReportCsv` (the time-in-status table). `handleExportCsv` now takes a
   per-listing kind; this app passes `'history'` and exports the change log itself
   (`historyReportToCsv` in `packages/forge-runtime/src/report-csv.ts`, formula injection defused,
   tested). A CSV bullet may be added to "What you get", and screenshot #6 is unblocked — capture
   only after visually confirming the modal shows history rows.
2. **No filter controls exist in the shipped UI — still true.** The engine (`filterHistory`) and
   the resolver (`handleHistoryReport`: `from`/`to`/`fields`/`limit`) support filtering, but the
   project page calls `getHistoryReport` with an empty payload and renders no filter inputs. The
   copy above claims none. The shipped footnote and page subtitle that over-claimed "filterable"
   were reworded on 2026-09-21 to claim only what ships; on-page filter controls remain a v1.1
   item.

Both cut the other way from ordinary listing-polish: the product under-delivers its own spec here,
and the copy follows the code, not the spec.

---

## Keyword placement checklist

`issue history` · `audit log` · `changelog` · `field changes` · `change history` · `track changes`
· `activity history` · `history report`

- [x] Title carries `Issue History` and `Audit Log`
- [x] Tagline carries the core claim without keyword stuffing
- [x] First paragraph ("The gap") carries `field change`, `History tab`
- [ ] Screenshot captions — add 1-2 more keyword terms once final captions are set
- [ ] `changelog` appears only in "How it works" — consider working it into a caption
