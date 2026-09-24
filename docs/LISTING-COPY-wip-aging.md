# LISTING-COPY — listing ③ WIP Aging, ready to paste

> Drafted from `PROMOTION.md` § 1 and `PRODUCT-SPEC.md` § 6. Every claim here is one this repository
> can back with a test, the deployed app, or the seeded dev site — nothing here is aspirational copy
> waiting on a feature. Paste directly into the Marketplace listing form; adjust only if the actual
> screenshots (see § "Screenshots" below) end up captioned differently than assumed here.

---

## Pre-submission checks — ROADMAP stage 4, run 2026-09-21

The two checks that cost minutes and have killed whole directions, re-run by web search on
**2026-09-21** (baseline: the Marketplace API measurement of 2026-09-05 in `PRODUCT-SPEC.md`;
install counts were **not** re-measured from the API for this check, only the qualitative landscape).

### Check 1 — has Atlassian shipped native WIP-aging / aging-work-item reporting since 2026-09-05?

**No evidence found that it has.** What Jira Cloud offers natively is unchanged in kind:

- The **Average Age report** remains a single aggregated average over time — it cannot list which
  issues are old, and third-party coverage in 2026 still describes it as providing "no visibility
  into distribution, outliers, or individual items"
  ([Nave, aging chart for Jira](https://getnave.com/aging-chart-for-jira);
  [Atlassian Community App Central article on WIP run charts, still describing the native gap](https://community.atlassian.com/forums/App-Central-articles/Understanding-the-WIP-Run-Chart-Your-Ultimate-Guide-to/ba-p/3160944)).
- **Board insights** did change in 2026 — insights are now enabled for all users and admins can no
  longer disable individual ones — but the documented insight set (sprint progress and similar) does
  not include a per-item aging list or histogram
  ([View insights in Jira Cloud, support.atlassian.com](https://support.atlassian.com/jira-software-cloud/docs/view-insights-in-jira-software-cloud/)).
- Neither the [Jira 2026 Spring Release announcement](https://community.atlassian.com/forums/Jira-articles/Introducing-the-Jira-2026-Spring-Release/ba-p/3227380)
  nor the [2026 Summer Release audit](https://community.atlassian.com/forums/Jira-Cloud-Admins-articles/Jira-2026-Summer-Release-what-is-actually-on-your-site-today-a/ba-p/3270505)
  mentions an aging-work-items report, and a targeted search of Atlassian's changelogs and the
  [Cloud roadmap](https://www.atlassian.com/roadmap/cloud) for "aging work items" / "work item age"
  found nothing shipped since 2026-09-05.

### Check 2 — has a free first-party or well-funded free app appeared at the top of the niche?

**No — with one adjacency worth watching.**

- The visible top of the WIP-aging niche is still paid:
  [Broken Build's Agile WIP Aging & Run Charts](https://marketplace.atlassian.com/apps/862685050/agile-wip-aging-run-charts-for-jira-gadgets-reports-kpis),
  [Great Gadgets](https://marketplace.atlassian.com/apps/1216564/great-gadgets-for-jira-cloud-agile-charts-reports-kpis),
  [ActionableAgile](https://marketplace.atlassian.com/apps/1216661/actionableagile-kanban-agile-flow-metrics-for-jira),
  [ChartCraft](https://marketplace.atlassian.com/apps/1238373/chartcraft-for-jira).
- **The adjacency:** [Flow Metrics & Forecasting for Jira](https://marketplace.atlassian.com/apps/3298816930/flow-metrics-forecasting-for-jira)
  is a Forge app with a free tier (throughput, lead-time percentiles, CSV export) — but its **Aging
  WIP view is gated behind its Pro tier**, so the free tier does not cover this listing's core
  question today. It is one pricing decision away from doing so; re-check it on submission day.
- [JiraMetrics](https://jirametrics.org/) is free and covers aging, but it is an open-source local
  tool, not a Marketplace listing — a different audience (people willing to run a script) rather
  than a buyer in Marketplace search.

### Conclusion: **GO**

Neither kill condition holds: Atlassian's native surfaces still stop at a single average, and the
niche's top remains paid. Residual watch item: the free tier of Flow Metrics & Forecasting sits one
un-gating decision away from this listing's core report — re-run this check on the actual
submission day if it is later than this one.

---

## Title

```
WIP Aging Reports & Charts for Jira
```

Under the Marketplace's list-view truncation length. Carries `WIP Aging`, `Reports` and `Charts` —
each one a searched term. **Deliberately not** "WIP Aging & Run Charts" (the name in
`packages/engine/src/config/pricing.ts` and `PRODUCT-SPEC.md` § 6): `computeRunChart` exists in the
engine and is unit-tested, but **no page or resolver renders it** — the cumulative flow diagram
shipped in v1.1 and the run chart did not, and a title keyword the buyer cannot find in the app is
a refund, not an install.

## Tagline (search results, one line)

```
The age of every unfinished issue, oldest first — where Jira's own Average Age chart shows one number.
```

The one factual, checkable claim this listing has. Names a limitation of the native feature
(a single averaged line, no per-item visibility), not a flaw in a competitor.

## Description

Paste as five sections, in order. Headings included for editing; the Marketplace form may want them
as plain paragraph breaks instead of literal `##` — check the form before pasting.

---

### The gap

The question a standup actually asks is "what has been sitting, and for how long?" Jira's own
aging surface — the Average Age report — plots **one averaged number** over time; it cannot tell
you _which_ issues are old, or how long any one of them has sat where it is. **WIP Aging lists
every unfinished issue with its age in its current status, oldest first**, and shows the exact
moment it entered that status — so you can verify any row against that issue's own History tab in
one click.

### What you get

- **The age of every unfinished issue in its current status, oldest first** — the list, not an
  average.
- **The instant each issue entered its current status**, shown per row — makes every age checkable
  against the issue's own History tab.
- **An aging histogram** — six buckets from 0–1d to 30d+, all six always rendered, so an empty
  bucket reads as a fact rather than disappearing.
- **A cumulative flow diagram** — one line per status, one point per day, thirty days back. Built
  from every recorded _visit_, so it says where each issue actually was on a past Tuesday rather
  than inferring it from today's state. Each day counts every issue exactly once, in the status it
  finished the day in, which is what makes the bands add up to the work in flight. When nothing has
  been indexed for that range yet the chart is withheld rather than drawn flat at zero: "not
  indexed" and "nothing was in flight for a month" are different answers.
- **"Extend history"** — the first index covers twelve months; widen it whenever you want.
- **An admin storage page** — the rows and megabytes this app holds in your tenant, readable
  rather than taken on trust.
- **Total age since creation** per issue, next to the age in status — different questions, both
  answered.
- **Summary tiles**: how many issues are in flight, the single oldest one (named), and how many
  have not moved in over 14 days.
- **Finished issues excluded and counted** — the report says how many were excluded, so the row
  count is checkable too.
- **An honest treatment of working hours**: age in status is elapsed time, and the report says so
  in a footnote. The stored working-hours figure covers only the completed part of the current
  visit — the still-running remainder cannot be business time until it ends — so the app keeps the
  two apart rather than blending them into a single subtly-wrong number.
- **CSV export of the aging table itself** — issue key, status, age in status, working-hours
  portion, total age and when the status was entered — shown in a
  copyable modal, ready to paste into whatever spreadsheet you already use.
- **A dashboard gadget** with the summary tiles — each gadget picks its own project, so the report
  is seen by your team, not just whoever installed it.
- **An honest indexing banner** — visible for as long as the numbers are built from partial
  history, never silently hidden.

### What it does not do

No run charts — the arithmetic exists in the engine and is tested, but no screen renders it, so it
is not claimed here. (The cumulative flow diagram _is_ rendered, on the project page; an earlier
version of this paragraph denied it while the feature list above promised it, which is the kind of
contradiction a reviewer reads as carelessness and a customer reads as untrustworthy.) No aging by
assignee or swimlane, no
board-scoped or sprint-scoped aging, no forecasting, no predictive analytics. It answers one
recurring question — what is sitting, where, and for how long — properly, rather than many
questions adequately.

### How it works

Reads issue changelogs through Jira's own REST API. Aggregates are stored inside **your** Atlassian
tenant via Forge SQL — nothing leaves it, nothing is sent to a third party, and the app requests no
write scope. Every report is checked against **your own** Jira permissions before it returns
anything, not the app's.

### Pricing

Free for teams up to 10 users — the whole product, not a limited trial. Above that:

| Seats       | 10       | 50       | 100      | 500        |
| ----------- | -------- | -------- | -------- | ---------- |
| **Monthly** | **Free** | **$275** | **$550** | **$1,650** |

> Ladder per `packages/engine/src/config/pricing.ts` (`WIP_AGING_PRICING`): $5.50/user to 100
> seats, $2.75 to 500, $1.40 beyond — **not** listing 1's $6.50 schedule. Matched to the measured
> incumbent price in this niche ($275 at 50 users, measured 2026-09-05).

---

## Privacy and security

Paste into the Marketplace's privacy and security statement field, not the description. Every line
is backed by a manifest test or a stated design decision — see `PRODUCT-SPEC.md` § 9 and
`TECHNICAL-SPEC.md` § 11 item 6. The runtime is shared with listing 1, so the same statements hold.

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

## Screenshots — 6 planned, in this order · all **pending capture**

Capture against the seeded dev site (`sergiip180.atlassian.net`) exactly as listing 1's were: the
Forge-deployed app, not the `ui:screens` harness; cropped, chrome-free PNGs into
`docs/listing-assets/` with a `wip-` prefix. Use a project whose in-flight issues span several
buckets — the bulk-seeded `JFMB` (181+ issues) is the candidate; check `tools/seed-report.md` for
which issues have sat longest. Realistic data in every shot: an empty-state screenshot reads as an
abandoned app.

| #   | Shows                                    | Capture instructions                                                                                                                                                                                                                                                                                                         | Caption (draft)                                                                 | Status              |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------- |
| 1   | Report table, oldest first               | WIP Aging project page, ready state, indexing complete (no banner). Columns Issue · Status · Age in status · Age total · Entered status all visible; top rows must show a wide age spread (days vs hours) and the "N finished issues are excluded" footnote must be in frame.                                                | "Every unfinished issue, oldest first — with the moment it entered its status." | **pending capture** |
| 2   | ★ The aging histogram                    | Same page, scrolled to the `AgingHistogram` between the tiles and the table. All six buckets (0-1d, 1-3d, 3-7d, 7-14d, 14-30d, 30d+) must be labelled and visible, with at least one empty bucket rendered at zero — that emptiness is the claim the caption makes.                                                          | "Six age buckets, always all six — an empty bucket is a fact, not a blank."     | **pending capture** |
| 3   | Summary tiles                            | Crop the same page to the heading + tile row alone (as listing 1's #4 was): In flight · Oldest (named issue key and status) · Older than 14 days. The 14-day count must be non-zero or the tile makes no argument.                                                                                                           | "How stale is the board, in three numbers."                                     | **pending capture** |
| 4   | The oldest issue's History tab           | Open the issue named in the "Oldest" tile; capture its History tab showing the transition _into_ its current status, timestamp legible. Must be the same issue and timestamp as screenshot 1's top row so the pair is checkable. (Jira may render the tab in the site language — reshoot in English if the dev site allows.) | "Check it yourself: the entry timestamp is in the issue's own History tab."     | **pending capture** |
| 5   | The dashboard gadget on a real dashboard | Production install, the named "Engineering Team Dashboard" used for listing 1's #5. WIP Aging gadget in view mode with real tiles for its configured project; no development badge, no browser chrome. The gadget's project picker was verified live on this app on 2026-09-15 (TECHNICAL-SPEC § 11 item 7).                 | "Seen by your team, not just whoever installed it."                             | **pending capture** |
| 6   | CSV export modal                         | Click Export CSV on the project page; capture the modal with the filename (`wip-aging-<project>.csv`) and the selectable CSV text visible. The caption must describe the copy flow — **the app shows the CSV to copy; it does not download a file** (TECHNICAL-SPEC § 11 item 8).                                            | "Copied in one click — paste it into whatever spreadsheet you already use."     | **pending capture** |

Alt text: describe what the screenshot proves, not what it contains — e.g. "WIP Aging table with
issue JFMB-42 at the top, 31 days in In Review since 2026-08-21, above five younger issues" rather
than "A table."

## Keyword placement checklist

`wip aging` · `aging chart` · `aging work items` · `work in progress report` · `kanban aging` ·
`age in status` · `stale issues` · `flow metrics` · `cumulative flow`

- [ ] Title carries `WIP Aging` and `Charts`
- [ ] Tagline carries the core claim without keyword stuffing
- [ ] First paragraph ("The gap") carries `aging`, `age in its current status`, `Average Age`
- [ ] Screenshot captions — add 1-2 more keyword terms once final captions are set
- [ ] `run chart` deliberately **not** targeted until a run chart actually renders (v1.1)
