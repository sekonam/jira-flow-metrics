# LISTING-COPY — listing 1, ready to paste

> Drafted from `PROMOTION.md` § 1 and `PRODUCT-SPEC.md` § 4. Every claim here is one this repository
> can back with a test, a screenshot, or the seeded dev site — nothing here is aspirational copy
> waiting on a feature. Paste directly into the Marketplace listing form; adjust only if the actual
> screenshots (see § "Screenshots" below) end up captioned differently than assumed here.

---

## Title

```
Time in Status & Cycle Time Reports for Jira
```

Under the Marketplace's list-view truncation length. No adjectives — every character here is a
keyword a buyer searches for, not a claim about the product.

## Tagline (search results, one line)

```
Cumulative time in every status — including re-entries Jira's control chart doesn't count.
```

The one factual, checkable claim the product has. Names a limitation of the native feature, not a
flaw in a competitor.

## Description

Paste as five sections, in order. Headings included for editing; the Marketplace form may want them
as plain paragraph breaks instead of literal `##` — check the form before pasting.

---

### The gap

Jira's own Control Chart reports only the **most recent** period an issue spent in a status. If an
issue is blocked and comes back, or bounces from code review back to in progress, the earlier time
is not summed — it is simply gone from the chart. **Time in Status sums every visit** and shows the
visit count next to the figure, so a status entered twice reads higher than Jira's own chart by
exactly the time of the earlier visit — and says why.

### What you get

- **Cumulative time per status, per issue, across every re-entry** — the number Jira's own chart
  cannot show you.
- **Visit count per status** (the `×2` badge) — makes the cumulative figure checkable against your
  own issue history in one click.
- **Elapsed or working-hours basis**, switchable per view.
- **A real working calendar per project** — timezone, weekly pattern, holidays, split shifts — not
  a flat 9-to-5 assumption.
- **Cycle time, lead time, flow efficiency, reopen count** — computed from the same timeline, no
  extra setup.
- **Median and 85th-percentile summary tiles** per status — cycle-time distributions are
  right-skewed; a mean alone misleads a review meeting.
- **A median-time-per-status chart** above the table, so the shape is readable before the rows are.
- **A per-issue timeline**, as a tab beside Jira's own History on the issue itself: every visit in
  order with its own duration, and the cumulative totals underneath. The place the product's claim
  is easiest to check is the issue you are already looking at.
- **"Extend history"** — the first index covers twelve months; widen it to five years or to
  everything whenever you want, from the report page.
- **An admin storage page** — exactly how many rows and how many megabytes this app holds in your
  tenant, so "what is it storing?" has an answer you can read rather than one you have to trust.
- **Filters** — assignee, issue type, creation window. Pick "Anna's bugs from
  last quarter" and both the table and the export narrow to exactly that.
- **CSV export** — for the finance and QBR audience that wants the export more than the chart.
- **A dashboard gadget** — the report your team sees without anyone installing anything.
- **An honest indexing banner** — visible for as long as the numbers are built from partial
  history, never silently hidden.

### What it does not do

No predictive analytics or forecasting. No cross-project portfolio rollups. No custom-field-based
metrics — every instance's fields differ, and guessing at yours would be worse than not trying. No
sprint-scoped reports. It does one report, properly, rather than many reports adequately.

**No Confluence embedding, and this one is a settled no rather than a not-yet.** Forge isolates an
app's storage per product — Atlassian's own words: "data stored in Jira is not accessible from
Confluence or vice versa" — so a Confluence macro could not read the aggregates this app already
holds without building a second ingestion path into a second product. Multi-product apps also
cannot be listed free, and this one is free under ten users.

### How it works

Reads issue changelogs through Jira's own REST API. Aggregates are stored inside **your** Atlassian
tenant via Forge SQL — nothing leaves it, nothing is sent to a third party, and the app requests no
write scope. Every report is checked against **your own** Jira permissions before it returns
anything, not the app's.

### Pricing

Free for teams up to 10 users — the whole product, not a limited trial. Above that:

| Seats       | 10       | 50       | 100      | 500        |
| ----------- | -------- | -------- | -------- | ---------- |
| **Monthly** | **Free** | **$325** | **$650** | **$1,950** |

---

## Privacy and security

Paste into the Marketplace's privacy and security statement field, not the description. Every
line is backed by a manifest test or a stated design decision — see `PRODUCT-SPEC.md` § 9 and
`TECHNICAL-SPEC.md` § 11 item 6.

- **No customer data leaves your Atlassian tenant.** Every aggregate is stored in Forge SQL, inside
  your own installation — nothing is sent to a third party, nothing is logged externally.
- **Read-only.** The app requests no Jira write scope. Scopes used: `read:jira-work`,
  `read:jira-user`, `storage:app` — nothing else.
- **Your own permissions are checked before anything is returned.** Every report verifies
  `BROWSE_PROJECTS` for the person viewing it, as that person — not as the app, which reads Jira
  under its own identity everywhere else.
- **Issues under an issue security level are never indexed**, and worklogs restricted to a role or
  group are dropped at ingest. Both choices under-report rather than over-disclose.
- **The residual, stated here rather than left for a reviewer to find:** the `BROWSE_PROJECTS`
  check establishes that a viewer may see the _project_. Within a project, the app does **not**
  re-check per-issue visibility for each viewer on every render — for example a JQL-scoped board
  filter, or a permission scheme that grants project browse but restricts a subset of issues, is
  not modelled. Doing that check would mean an as-user Jira call on every report render, which a
  consumption-priced platform makes prohibitive. The issue-security-level exclusion and the
  project-level check happen on every read; this narrower, per-issue case does not.

---

## Highlights (3, each paired with one screenshot)

Marketplace renders these above the description, each beside its image; three is the maximum and an
empty Highlights section is visible on the listing page, so all three are filled. Nothing new is
claimed here — every line restates something "What you get" already says and the code already does,
because a highlight is often the only copy a buyer reads before deciding whether to scroll.

The **Shot** column points into the numbered list in "Screenshots" below. Writing these is what
surfaced the gaps noted under each table: a highlight with no image beside it is a worse listing
than one fewer highlight.

| #   | Heading (≤60 chars)                               | Summary (≤180 chars)                                                                                                                                      | Shot |
| --- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | Every visit counted, not just the last one        | Jira's control chart shows the most recent stay in a status. This shows the total across every re-entry, with a badge saying how many visits it added up. | 1    |
| 2   | Elapsed or working hours, switched on the page    | One toggle, and every tile, chart and row recomputes against a real project calendar — timezone, weekly pattern, holidays, split shifts.                  | 3    |
| 3   | Checkable on the issue you are already looking at | A Time in Status tab sits beside Jira's own History: every visit in order with its own duration, and the cumulative totals underneath.                    | 2    |

All three already exist as cropped candidates in `listing-assets/candidates-2026-09-23/`
(`01-reentry-report.png`, `03-working-hours-toggle.png`, `02-issue-timeline-tab.png`). This is the
only one of the five listings whose highlights are fully illustrated today.

## Screenshots — 6, in this order

> ⚠️ **Stale as of 2026-09-22 — re-shoot before submitting.** Every report page gained a chart in
> v1.1, so screenshots 1, 3 and 4 no longer show the page a customer will see, and there is now a
> seventh surface worth showing (the issue timeline tab beside Jira's own History) that is a
> stronger #2 than the History-tab comparison currently is. An automated session could read every
> new surface back from real Jira but could not capture one: screenshot capture and clicking both
> fail against the Forge iframe specifically, and the known-good CSV modal fails identically. See
> ROADMAP stage 6.

**Finalized 2026-09-18, against v1.0.** All six are cropped, chrome-free PNGs in
`docs/listing-assets/`. Source captures were taken against the seeded dev site (`sergiip180.atlassian.net`,
project `JFM` — the hand-checked set, issue `JFM-11` named throughout). See `tools/seed-report.md`
for which issues show the clearest re-entry margins.

| #   | Shows                                                                  | Caption                                                                     | Status                                                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Report table with a visible `×2` badge and cumulative figure           | "Every re-entry counted — not just the last one."                           | **finalized** — `docs/listing-assets/01-reentry-badge.png` — `JFM-11` row shows `15h 29m ×3` in In Progress, matching this doc's own alt-text example exactly                                                                                                                          |
| 2   | The same issue's History tab, showing the re-entry transitions         | "Check it yourself: open the same issue's History tab."                     | **finalized** — `docs/listing-assets/02-history-tab-comparison.png` — `JFM-11`'s История tab, 3 To Do ↔ In Progress transitions matching the ×3 badge; the classic per-project Control Chart URL 404s on this team-managed project, unconfirmed whether one exists in a different form |
| 3   | Elapsed vs working-hours toggle, active state visible                  | "Working hours, not wall-clock — holidays and weekends excluded."           | **finalized** — `docs/listing-assets/03-working-hours-toggle.png` — toggle confirmed live (`JFM-11` In Progress: `15h 29m` elapsed → `43m` working hours); no separate calendar UI is shown, only the recomputed numbers                                                               |
| 4   | Summary tiles: median and 85th percentile per status                   | "The numbers for your next review, already summarised."                     | **finalized** — `docs/listing-assets/04-summary-tiles.png` — cropped tighter than #1 to the heading + tile row alone                                                                                                                                                                   |
| 5   | The dashboard gadget on a real dashboard                               | "Seen by your team, not just whoever installed it."                         | **finalized** — `docs/listing-assets/05-dashboard-gadget.png` — re-shot 2026-09-18 against the production install on a properly named dashboard ("Engineering Team Dashboard"); no development badge, real gadget, real data (`Issues: 50` plus per-status medians)                    |
| 6   | Export CSV modal — filename and full CSV text ready to select and copy | "Copied in one click — paste it into whatever spreadsheet you already use." | **finalized** — `docs/listing-assets/06-csv-export-modal.png` — caption describes the real copy-paste flow (TECHNICAL-SPEC § 11 item 8), not a native download                                                                                                                         |

Alt text: describe what the screenshot proves, not what it contains — e.g. "Table row for issue
FLOW-142 showing 15h 29m cumulative time in In Progress across two visits, versus the single-visit
figure Jira's own Control Chart would show" rather than "A table."

## Keyword placement checklist

`time in status` · `cycle time` · `lead time` · `status duration` · `time between statuses` ·
`workflow report` · `flow efficiency` · `time tracking report`

- [x] Title carries `Time in Status` and `Cycle Time`
- [x] Tagline carries the core claim without keyword stuffing
- [x] First paragraph ("The gap") carries `status`, `Control Chart`
- [ ] Screenshot captions — add 1-2 more keyword terms once final captions are set
