# SHOT-LIST — the 30 screenshots for five Marketplace listings

> Planning only. Nothing here has been captured. This document answers ROADMAP items **6.2**
> (re-shoot listing 1: every report page gained a chart) and **6.3** (listings 2-5, two of four
> part-shot), and supersedes the per-listing `## Screenshots` tables in `docs/LISTING-COPY*.md`
> where the two disagree — those tables were written before the v1.1 charts, before the
> per-listing CSV fix, and before anyone had looked at what the seeded projects actually render.

**Naming and location.** `docs/listing-assets/NN-kebab-name.png` for listing 1;
`docs/listing-assets-<app>/NN-kebab-name.png` for listings 2-5, with the existing `raw/`
subdirectory holding the uncropped source. This drops the `ih-` / `wip-` / `worklog-` prefixes the
per-listing copies proposed: the directory already disambiguates, and a prefix inside a
per-listing directory is noise. Cropped, chrome-free PNGs; the `raw/` captures may stay JPEG.

**Sites and projects.** `sergiip180.atlassian.net`. `JFM` — "Flow Metrics Seed", ~19 issues, the
only project with hand-verified re-entry margins (`tools/seed-report.md`). `JFMB` — "Flow Metrics
Bulk Seed", 300 issues of which 186 re-enter at least one status (`tools/seed-bulk-report.md`).

**Read § "Preconditions" and § "Shots that would be dishonest" before capturing anything.** Several
shots below are blocked on state that is not a framing decision.

---

## Preconditions — verify before any capture

| #   | Precondition                                                     | Why, and where it is recorded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | **No development-environment badge on any surface in frame.**    | The current `docs/listing-assets/01-reentry-badge.png` carries `Среда разработки` on the Time in Status project tab, and both `docs/listing-assets-wip-aging/raw/full-page.jpg` and `docs/listing-assets-worklog-reports/raw/full-page.jpg` show `Dev` badges on three project tabs. This is a property of the _install_, not the crop — cropping the badge off a development install is covered in § "Shots that would be dishonest". Only listing 1's `05-dashboard-gadget.png` records a production install (`LISTING-COPY.md`, row 5). |
| P2  | **Site UI language is English.**                                 | `02-history-tab-comparison.png` is entirely Russian — nav, Activity tabs, the issue detail panel. The 2026-09-22 raw JPEGs are English, so something changed between 09-18 and 09-22; the repo does not say what, or whether it sticks. Check at capture time.                                                                                                                                                                                                                                                                             |
| P3  | **No real personal names in frame.**                             | `Sergii P1` appears twice in `02-history-tab-comparison.png` and is the sole row of `docs/listing-assets-worklog-reports/raw/full-page.jpg`. `tools/jira-seed-lib.mjs:222` posts every worklog as the one authenticated user, so this is systemic, not incidental.                                                                                                                                                                                                                                                                         |
| P4  | **Seeded issue summaries and labels renamed or cropped out.**    | `JFM-11`'s summary is literally `[RE-ENTRY] re-entry ×3 — bounced back to the backlog twice`, with labels `jfm-bounced-three-times` and `jfm-seed`. `PROMOTION.md` § 9 asks for "a project name that is plausible rather than `TEST`"; the same argument applies to a summary that announces the evidence was built to order.                                                                                                                                                                                                              |
| P5  | **The index for the app and project being shot reads complete.** | Per-app, not global: `TECHNICAL-SPEC.md` § 11 item 10 read two storage pages at the same moment on 2026-09-22 and found Time in Status holding **191** `issue_meta` rows and **0** visits while WIP Aging held **310** and **4**. `ROADMAP.md` 1.7a records a JFMB backfill failing deterministically at 100 issues on a Jira-issued cursor. A "Indexing in progress" banner in frame changes what a shot is allowed to claim.                                                                                                             |
| P6  | **Forge iframes cannot be captured by automation.**              | `ROADMAP.md` stage 6: a real browser could read every surface back but could not click inside a Forge iframe or screenshot one, and the known-good CSV modal fails identically. Every shot below is a human capture.                                                                                                                                                                                                                                                                                                                       |

---

## Listing 1 — Time in Status & Cycle Time · `apps/time-in-status` · `docs/listing-assets/`

Modules: `jira:projectPage` (`time-in-status-page`, title **Time in Status**), `jira:issueActivity`
(`time-in-status-activity`, title **Time in Status** — the only listing with this module),
`jira:dashboardGadget` (title **Time in Status**), `jira:adminPage` (**Time in Status storage**).

### Why shot 1 is the re-entry row and not the issue-timeline tab

`docs/LISTING-COPY.md` calls the tagline — "Cumulative time in every status — including re-entries
Jira's control chart doesn't count" — "the one factual, checkable claim the product has", and its
own stale-note argues the new issue-timeline tab is "a stronger **#2** than the History-tab
comparison". I agree with that placement and not with promoting it to #1. The timeline tab is the
better _proof_; the report table is the _product_. A buyer scanning a search-results grid has to
recognise, from a thumbnail, what they would be buying — and what they would be buying is a
project-wide report, not a tab on one issue. So: the table first, with the `×3` badge and the
footnote that explains it in the same frame, and the timeline tab immediately behind it as the
"now check me" shot.

The badge alone is ~20px and illegible at thumbnail size. **The footnote must be in frame** — it is
the sentence that carries the claim in words.

| #   | Filename               | Shot          |
| --- | ---------------------- | ------------- |
| 1   | `01-reentry-badge.png` | **RE-SHOOT.** |

- **Surface / navigation.** Projects → _Flow Metrics Seed_ → project nav tab **Time in Status** →
  default `Elapsed` basis → scroll so tiles are just out of frame and the table fills it.
- **Project: `JFM`.** `tools/seed-report.md` bolds exactly three rows with a margin big enough to
  see by eye, and `JFM-11 / В работе / 3 visits / 15.5h` is one of them. `JFMB` has 186 re-entering
  issues and **no recorded margins** — the same doc explains why a fast seed produces sub-minute
  differences. The hand-verified figure is the whole point of this shot, so it must be `JFM`.
- **In frame:** the table header row; `JFM-11`'s row showing `15h 29m ×3` under In Progress
  alongside its `Total`; at least three further rows carrying `×2`/`×3`; and the `toReportTable`
  footnote — _"A "x2" badge means the issue entered that status more than once. These durations are
  cumulative across every visit; Jira's own control chart shows only the most recent one."_
- **Not in frame:** the development badge (P1); Russian nav (P2); the duplicated heading (Jira's own
  page title "Time in Status" stacked directly above `PageHeader`'s `<h1>` of the same words — crop
  below Jira's).
- **Caption.** `Every visit counted: 15h 29m across 3 stays in In Progress, not just the last one.`
- **Stale because:** the current PNG predates `0764571` _"a chart on every report page"_ — it shows
  tiles → table with no `ReportBarChart` between them, which is not the page a customer now sees.
  It also fails P1 and P2.

| #   | Filename                    | Shot                                                                  |
| --- | --------------------------- | --------------------------------------------------------------------- |
| 2   | `02-issue-timeline-tab.png` | **NEW** — replaces `02-history-tab-comparison.png`, which is retired. |

- **Surface / navigation.** Open issue `JFM-11` → the **Activity** section at the bottom → the
  **Time in Status** tab, which sits in the same strip as Jira's own **History** and **Work log**.
  Renders `apps/time-in-status/src/frontend/panel.tsx`.
- **Project: `JFM`** — same hand-verified issue as shot 1, so the two shots cross-check each other.
- **In frame:** the Activity tab strip with Jira's **History** tab _visibly adjacent_ to ours — that
  adjacency is the entire argument; the **Totals per status** table (`toTimelineTotals`) with the
  In Progress row reading `Visits 3` plus elapsed and working-time totals; and its footnote — _"A
  status with more than one visit is one Jira's own Control Chart reports only the most recent stay
  in. The totals here cover every stay."_
- **Not in frame:** the right-hand issue detail panel (Assignee/Reporter = a real name, P3); the
  issue summary and `jfm-seed` labels (P4).
- **Caption.** `The same figure, one click from the transitions it came from — beside Jira's own History.`
- **Retiring `02-history-tab-comparison.png`:** it fails P2 (wholly Russian), P3 (the real name,
  twice, plus avatar), and P4 (the summary announces the staging). Its own row in `LISTING-COPY.md`
  already concedes the per-project Control Chart URL 404s on this team-managed project, so the
  comparison it promises is half-absent. The Activity tab makes the same argument inside one app.

| #   | Filename              | Shot                                          |
| --- | --------------------- | --------------------------------------------- |
| 3   | `03-median-chart.png` | **NEW** — the surface ROADMAP 6.2 exists for. |

- **Surface / navigation.** Same project page, scrolled to the `ReportBarChart` titled **"Median
  time in status"**, subtitle _"Hours per status, median across the issues below (elapsed time)."_
- **Project: `JFMB`.** A median needs a population. `JFM`'s existing tiles read _"85th percentile
  <1m, across 1 issues"_ — see § "Shots that would be dishonest", item 3.
- **In frame:** chart title and subtitle; every status bar labelled; the `Issues` tile immediately
  above so the bars have a stated denominator; the line _"Showing elapsed time."_
- **Not in frame:** the chart cropped away from its `Issues` tile; any bar whose status the tiles
  say is backed by one or two issues — check each tile's `across N issues` hint first.
- **Caption.** `Median time per status across 300 issues — the shape of the flow, before the rows.`
- **Blocked on P5.** If the JFMB banner says "Indexing in progress", this is not a shot, it is a
  claim about 300 issues made over however many were indexed.

| #   | Filename                      | Shot                      |
| --- | ----------------------------- | ------------------------- |
| 4   | `04-working-hours-toggle.png` | **RE-SHOOT** (was `03-`). |

- **Surface / navigation.** Same page → the header `ButtonGroup` → press **Working hours**.
- **Project: `JFM`.** The `15h 29m` elapsed → `43m` working-hours contrast on `JFM-11` is already
  hand-confirmed live and recorded in `LISTING-COPY.md` row 3.
- **In frame:** the `ButtonGroup` with **Working hours** in its selected state, legible at thumbnail
  size; the line _"Showing working hours."_; `JFM-11`'s In Progress cell showing the recomputed
  figure.
- **Not in frame:** a crop identical to shot 1 with no visible state change — if a viewer cannot see
  which button is pressed, the shot proves nothing. There is no separate calendar UI to show; do
  not imply one.
- **Caption.** `Working hours, not wall-clock: the same visit reads 15h 29m elapsed and 43m worked.`
- **Stale because:** the existing PNG predates the chart, and fails P1/P2.

| #   | Filename               | Shot                      |
| --- | ---------------------- | ------------------------- |
| 5   | `05-summary-tiles.png` | **RE-SHOOT** (was `04-`). |

- **Surface / navigation.** Same page, cropped to `PageHeader` + the `SummaryTiles` row
  (`toSummaryTiles`) alone — the existing 1052×173 crop is the right shape.
- **Project: `JFMB`.** These tiles are medians and 85th percentiles; over 300 issues that is a
  statistic, over `JFM`'s 10 it is an anecdote.
- **In frame:** the `Issues` tile with its real count; at least three status tiles whose hint reads
  _"85th percentile …, across N issues"_ with N in the tens or better.
- **Not in frame:** any tile whose hint reads `across 1 issues` or `across 2 issues`; any `—` value.
- **Caption.** `Median and 85th percentile per status — cycle times are skewed, so a mean misleads.`
- **Stale because:** the existing PNG is a `JFM` crop and ships an n=1 percentile tile.

| #   | Filename                  | Shot                       |
| --- | ------------------------- | -------------------------- |
| 6   | `06-csv-export-modal.png` | **REUSE — conditionally.** |

- **Surface / navigation.** Project page → **Export CSV** in the header actions → the `CsvExport`
  modal, whose `ModalTitle` is the filename.
- **Project:** whichever shot 1 used (`JFM`), so the CSV rows match the table the buyer just saw.
- **In frame:** the filename as the modal title; the sentence _"Select the text below and copy it,
  then save it as `<filename>`. Jira apps render in a sandbox that cannot hand a file to the
  browser."_; several real CSV lines in the `CodeBlock`.
- **Not in frame / not in caption:** anything implying a browser download. `TECHNICAL-SPEC.md` § 11
  item 8 prices the three routes to a real download and takes none of them for v1.
- **Caption.** `Copy the whole report out in one click — a copyable export, not a hidden download.`
- **Reuse verdict.** This is the one listing-1 asset the v1.1 chart did not make stale: it is a
  756×316 crop of the modal alone and contains no report page. **But** `handleExportCsv` gained a
  per-listing `CsvExportKind` on 2026-09-21 — open the PNG, confirm the visible rows are the status
  table, and only then reuse. Re-shoot if they are not, or if P2 shows in the modal chrome.

**Cut from listing 1:** the indexing banner and the admin storage page. Both are real arguments
(the honesty banner is a listed v1 capability; the storage page answers "what is it storing?"), but
six slots is the cap and the banner gets its own frame on listing 5, where real data trips a real
cap. If the Marketplace form accepts a seventh, `07-admin-storage.png` — Jira Settings → Apps →
**Time in Status storage**, showing `toStorageTiles` + `toStorageTable`, and **nothing
issue-shaped**, which a test already enforces — is the one to add.

---

## Listing 2 — Worklog Reports & Time Tracking · `apps/worklog-reports` · `docs/listing-assets-worklog-reports/`

> **This listing is blocked before it is a framing problem.** `tools/jira-seed-lib.mjs:222` posts
> every seeded worklog as the single authenticated API user. `raw/full-page.jpg` is the proof: one
> row, `Sergii P1`, `100%`, 16 entries, 9 issues. A listing whose distinguishing column is
> _Share of total_ cannot lead with a single 100% row. **Before shots 1-3 and 5: log worklogs from
> at least two further test accounts with plausible, non-personal display names.** Until that is
> done, shots 1, 2, 3 and 5 do not exist.

| #   | Filename                        | Shot                                            |
| --- | ------------------------------- | ----------------------------------------------- |
| 1   | `01-logged-time-per-person.png` | **RE-SHOOT** — `raw/full-page.jpg` is unusable. |

- **Surface / navigation.** Projects → project → nav tab **Worklog Reports**
  (`worklog-reports-page`) → ready state, no banner → crop to header + table.
- **Project: `JFMB`**, once multi-author worklogs exist there. `tools/seed-bulk-scenarios.mjs:134`
  generates one worklog per in-progress visit at 1-8 hours each across 300 issues, so the volume is
  there; `JFM`'s 16 entries across 9 issues is too thin for a Share column to mean anything.
- **In frame:** headers `Person · Time logged · Share · Entries · Issues`; at least three rows with
  a genuine spread; and the `toWorklogTable` footnote — _"Nh logged across N entries. Totals are
  the durations people entered in Jira, not durations derived from timestamps."_
- **Not in frame:** a single 100% row; a real personal name (P3); a Share column that does not
  read as summing to ~100.
- **Caption.** `Who logged how much, and what share of the total — straight from what people typed.`
- **`raw/full-page.jpg` cannot be cropped into this shot:** one row at 100%, a real name, a `Dev`
  badge, and no chart at all — it was captured at 13:43 on 2026-09-22, before the report pages'
  charts were redeployed.

| #   | Filename                   | Shot     |
| --- | -------------------------- | -------- |
| 2   | `02-time-logged-chart.png` | **NEW.** |

- **Surface / navigation.** Same page, the `ReportBarChart` titled **"Time logged per person"**,
  subtitle _"Hours logged per person, largest first. The table below lists every one."_
- **Project: `JFMB`**, same precondition.
- **In frame:** at least four labelled bars, _with the first table rows underneath_, so the chart
  reads as a summary of a record rather than as the record.
- **Not in frame:** a one- or two-bar chart; the chart cropped away from the table when more than
  12 people have logged time — `CHART_CATEGORY_LIMIT` is 12 and the chart truncates while the table
  does not. A truncated chart presented alone claims to be the whole population.
- **Caption.** `Largest contributors first — the chart summarises, the table below lists everyone.`

| #   | Filename                 | Shot                                    |
| --- | ------------------------ | --------------------------------------- |
| 3   | `03-totals-footnote.png` | **NEW** — this listing's honesty frame. |

- **Surface / navigation.** Same page, cropped to the footnote beneath the table.
- **Project:** same as shot 1.
- **In frame:** the whole sentence unbroken, _plus the last rows of the table it belongs to_.
- **Not in frame:** the footnote alone. A qualifier with nothing above it to qualify is decoration.
- **Caption.** `Totals are the durations people entered in Jira — never re-derived from timestamps.`

| #   | Filename                      | Shot                             |
| --- | ----------------------------- | -------------------------------- |
| 4   | `04-issue-work-log-check.png` | **NEW** — the checkability shot. |

- **Surface / navigation.** Open a seeded issue → **Activity** → Jira's own **Work log** tab.
- **Project: `JFM`.** `tools/seed-scenarios.mjs` states the exact `worklogHours` per scenario —
  `[2, 3]`, `[1, 1, 4]`, `[2, 2, 2, 1]` — so the durations that must sum are known before capture.
  This is the one shot where a hand-known figure beats volume.
- **In frame:** three or more individual work log entries whose stated durations visibly sum to
  that issue's contribution in the report.
- **Not in frame:** the account owner's name on every entry (P3); seeded summaries and labels (P4).
- **Caption.** `Check it yourself: the total is the sum of the durations on the issue, entry by entry.`

| #   | Filename                  | Shot     |
| --- | ------------------------- | -------- |
| 5   | `05-dashboard-gadget.png` | **NEW.** |

- **Surface / navigation.** Dashboards → **Engineering Team Dashboard** → Add gadget → **Logged
  time** (the manifest `title`; not "Worklog Reports") → **Configure** → project picker → Save.
- **Project: `JFMB`** via the gadget's own picker — a `jira:dashboardGadget` context carries no
  project of its own (`TECHNICAL-SPEC.md` § 11 item 7).
- **In frame:** `toWorklogTiles` — **Total logged** with its _"N worklog entries."_ hint and
  **Largest contributor** with their hours; other gadgets visible alongside, so it reads as a
  dashboard rather than a crop of one tile.
- **Not in frame:** a development badge (P1); a `—` Largest contributor; _"Indexing is still in
  progress."_ half-cropped — either include that line whole or wait for the index.
- **Caption.** `Logged-time totals where your team already looks — nobody else has to install it.`
- **Verify first:** `TECHNICAL-SPEC.md` § 11 item 7 confirms the `edit.render: native` fix live on
  `time-in-status` and `wip-aging` only. Confirm **Configure** is clickable on _this_ app.

| #   | Filename                  | Shot                                         |
| --- | ------------------------- | -------------------------------------------- |
| 6   | `06-csv-export-modal.png` | **RE-SHOOT** — `raw/csv-modal.jpg` is stale. |

- **Surface / navigation.** Project page → **Export CSV** → the modal.
- **Stale because:** that JPEG was captured on 2026-09-22 at 13:44, and until the 2026-09-21
  per-listing fix every app wired `exportCsv` to `statusReportCsv`. On _this_ app — whose ingest
  stores no status durations — that produced an **empty** export. Confirm the modal shows worklog
  rows before keeping anything.
- **Caption.** `Copy the whole worklog table out in one click — a copyable export, not a download.`

---

## Listing 3 — WIP Aging & Run Charts · `apps/wip-aging` · `docs/listing-assets-wip-aging/`

### Why shot 1 pairs the tiles with the table

`LISTING-COPY-wip-aging.md` puts the table at #1 and stars the histogram at #2. I would keep the
table first but widen the crop to include the tile row, because `toAgingTiles`' **Oldest** tile
names an issue key and status (_"JFMB-42 in In Review."_) that the table's top row then repeats
with its entry date. One frame, two surfaces agreeing — this listing's version of the checkability
argument, at no extra slot.

| #   | Filename                    | Shot                                                    |
| --- | --------------------------- | ------------------------------------------------------- |
| 1   | `01-oldest-first-table.png` | **RE-SHOOT** — `raw/full-page.jpg` is stale three ways. |

- **Surface / navigation.** Projects → project → nav tab **WIP Aging** (`wip-aging-page`) → ready,
  no banner.
- **Project: `JFMB`.** `raw/full-page.jpg` shows `JFM` has **four** issues in flight. Four rows is
  not a board anyone buys a report for, and five of the six age buckets are empty behind it.
- **In frame:** all six headers — `Issue · Status · Age in status · Working hours · Age total ·
Entered status`; the **Oldest** tile naming the same issue key as the top row; a visible spread
  from weeks down to hours; the footnote _"N finished issues are excluded; ageing only applies to
  work in flight."_
- **Not in frame:** a five-column table — any capture missing **Working hours** predates `127ca98`
  _"six screens that stated something untrue"_, and the old frame made a reader hunt for a column
  the footnote promised and the page did not have. Also the `Dev` badge (P1).
- **Caption.** `Every unfinished issue, oldest first — with the moment it entered the status it's in.`
- **`raw/full-page.jpg` is stale because:** five columns not six; no **Cumulative flow** chart
  (added at 14:44, thirty minutes after the capture); four rows; and a `Dev` badge on three tabs.

| #   | Filename                  | Shot     |
| --- | ------------------------- | -------- |
| 2   | `02-age-distribution.png` | **NEW.** |

- **Surface / navigation.** Same page, the `AgingHistogram` between tiles and table — title **"Age
  distribution"**, subtitle _"Unfinished issues in flight, grouped by how long they've sat in their
  current status."_
- **Project: `JFMB`.**
- **In frame:** all six bucket labels `0-1d · 1-3d · 3-7d · 7-14d · 14-30d · 30d+`; at least one
  genuinely empty bucket drawn at zero — that is the claim the caption makes; and meaningful counts
  in more than one bucket.
- **Not in frame:** the `JFM` version. One bar in `14-30d` above five empty buckets is the same
  component rendering an almost-empty project, and it reads as an app with no data.
- **Caption.** `Six buckets, always all six — an empty bucket is a fact the chart states, not a gap.`

| #   | Filename                 | Shot                                              |
| --- | ------------------------ | ------------------------------------------------- |
| 3   | `03-cumulative-flow.png` | **NEW** — the v1.1 surface nothing has ever shot. |

- **Surface / navigation.** Same page, below the histogram: the `ReportLineChart` titled
  **"Cumulative flow"**, subtitle _"Issues in each status at the end of each day, last 30 days
  (UTC)."_
- **Project: `JFMB`** — a CFD needs volume across days.
- **In frame:** several days of points per status band, legend legible. **If `toReadCapBanner`
  fires** — _"Showing N issues, and there are more"_ — it must be in the same frame as the chart it
  qualifies.
- **Not in frame:** the chart cropped away from that banner.
- **Caption.** `Where the work actually sat, day by day — one line per status over 30 days.`
- **Check before shooting, and cut the shot if it fails:** `ROADMAP.md` 1.7a says JFMB was seeded
  past 300 issues _"in minutes"_, and `tools/seed-report.md` explains that Jira stamps changelog
  entries with its own clock and REST cannot backdate one. Most JFMB status visits therefore land
  inside one or two UTC days. Thirty labelled day-axis ticks over an essentially flat line is
  § "Shots that would be dishonest", item 2. Verify the series spans real days first.

| #   | Filename               | Shot     |
| --- | ---------------------- | -------- |
| 4   | `04-summary-tiles.png` | **NEW.** |

- **Surface / navigation.** Same page cropped to `PageHeader` + `toAgingTiles`: **In flight**,
  **Oldest**, **Older than 14 days**.
- **Project: `JFMB`.**
- **In frame:** a non-zero **Older than 14 days** — at zero the tile makes no argument; the
  **Oldest** hint naming a real issue key and status.
- **Not in frame:** `JFM`'s _"In flight 4"_.
- **Caption.** `How stale the board is, in three numbers — including what hasn't moved in a fortnight.`

| #   | Filename                  | Shot     |
| --- | ------------------------- | -------- |
| 5   | `05-dashboard-gadget.png` | **NEW.** |

- **Surface / navigation.** Dashboards → **Engineering Team Dashboard** → Add gadget → **WIP
  aging** → **Configure** → `JFMB` → Save.
- **In frame:** real tiles with real values; if `toCapNotice` fires, the whole sentence — _"Covering
  N of M issues, so every figure here is a lower bound."_
- **Not in frame:** a development badge; an empty state; a half-cropped cap notice.
- **Caption.** `The ageing board where your team already looks — no install needed to read it.`
- This app's gadget config screen was independently re-verified live on 2026-09-15
  (`TECHNICAL-SPEC.md` § 11 item 7), so no extra verification step here.

| #   | Filename                  | Shot                                     |
| --- | ------------------------- | ---------------------------------------- |
| 6   | `06-csv-export-modal.png` | **RE-SHOOT** — same reason as listing 2. |

- **Surface / navigation.** Project page → **Export CSV** → the modal, whose `ModalTitle` is the
  filename (`wip-aging-<project>.csv`).
- **Project: `JFMB`**, matching shot 1, so the CSV rows are the rows the buyer just saw.
- **In frame:** the filename as the modal title, the sandbox sentence, several real CSV lines.
- `raw/csv-modal.jpg` (2026-09-22 13:45) predates the per-listing `CsvExportKind` fix, so it may be
  showing the time-in-status table rather than the ageing table. Confirm the rows before keeping it.
- **Caption.** `Copy the ageing table out in one click — a copyable export, not a hidden download.`

---

## Listing 4 — SLA & Due Date Breach Reports · `apps/sla-breach` · `docs/listing-assets-sla-breach/` (empty)

### Why shot 1 puts the goal picker in the same frame as the breach

A table of breaches is indistinguishable from every competitor's table of breaches. What this
listing has that they do not is that **the goal being measured against is on the page, visible and
changeable** — `SlaGoalForm`, shipped v1.1 (`TECHNICAL-SPEC.md` § 11 item 3) — and that the model
is stated rather than blurred (`PRODUCT-SPEC.md` § 7, "★ The model difference"). A breach count
whose goal is cropped out is precisely the unqualified number this codebase is organised around not
producing. So the goal control and the overrun row share the first frame.

| #   | Filename                  | Shot     |
| --- | ------------------------- | -------- |
| 1   | `01-goal-and-overrun.png` | **NEW.** |

- **Surface / navigation.** Projects → _Flow Metrics Bulk Seed_ → nav tab **SLA & Due Dates**
  (`sla-breach-page`). The goal form sits above the report in every non-error state.
- **Project: `JFMB`.** Attainment over 300 issues is a percentage; over `JFM`'s 19 it is not.
- **In frame:** the **Working-time target** `Select` showing one of the real presets (4 / 8 / 16 /
  24 / 40 / 80 working hours, `SLA_TARGET_OPTIONS`); the status chips showing which statuses count;
  and table rows with `Working time used · Target · Remaining`, at least one reading `over by 6h`
  against `Breached` and at least one `Within target`, worst-first order visible.
- **Not in frame:** a report with no goal control; an `Attainment` tile reading `—` (which is what
  `toSlaTiles` renders when the report is capped, and it would sit beside a breach count that still
  has a number).
- **Caption.** `Overrun in words — "over by 6h" — against a target you can see and change on the page.`

| #   | Filename                | Shot                                    |
| --- | ----------------------- | --------------------------------------- |
| 2   | `02-model-footnote.png` | **NEW** — this listing's honesty frame. |

- **Surface / navigation.** Same page, cropped to the table footer.
- **In frame:** both `toSlaTable` footnotes, whole — _"Goal "<name>": working time spent in the
  counted statuses, measured against the working calendar configured for this project."_ and _"This
  is a counted-statuses goal, not a start/stop/pause timer. The difference is documented on the
  listing page so the number cannot be misread."_ — plus the last rows of the table above them.
- **Not in frame:** either sentence cropped mid-line; the footnote with no table above it.
- **Caption.** `The measurement model stated on the report itself — counted statuses, not a timer.`

| #   | Filename               | Shot     |
| --- | ---------------------- | -------- |
| 3   | `03-summary-tiles.png` | **NEW.** |

- **Surface / navigation.** Same page cropped to `PageHeader` + `toSlaTiles`: **Attainment**,
  **Breached**, **Late against due date**.
- **Project: `JFMB`.**
- **In frame:** a real Attainment percentage with its hint _"N issues measured against "<goal>"."_
- **Not in frame:** `Attainment —`; a capped report, which withholds attainment on purpose. Note
  that `toSlaTiles` will not render 100% beside a non-zero Breached — it floors to 99 unless
  `breachedCount === 0`. If you ever see both, something is wrong; do not shoot it, file it.
- **Caption.** `Attainment, breaches and due-date lateness — the three numbers a review opens with.`

| #   | Filename                 | Shot     |
| --- | ------------------------ | -------- |
| 4   | `04-due-date-column.png` | **NEW.** |

- **Surface / navigation.** Same table, cropped to `Issue · Status · Due date`.
- **Project: `JFMB`.** `tools/seed-bulk.mjs:231` sets `duedate` from `plan.dueDateOffsetDays`
  (`tools/seed-bulk-scenarios.mjs:152` bundles it), so past-due, on-time and no-due-date rows all
  exist without hand-seeding. This retires the "verify `seed-bulk.mjs` sets `duedate`" prerequisite
  in `LISTING-COPY-sla-breach.md`: it does.
- **In frame:** all three `describeDueDate` states — `28 Aug 2026 (late by 2d 4h)`, `… (on time)`,
  and `—` for an issue with no due date.
- **Not in frame:** only the late rows. A due-date column filtered or sorted to show nothing but
  breaches misrepresents the project — see § "Shots that would be dishonest", item 7.
- **Caption.** `Plain due-date breaches too — resolved late, still open past due, or no due date.`

| #   | Filename                   | Shot     |
| --- | -------------------------- | -------- |
| 5   | `05-target-band-chart.png` | **NEW.** |

- **Surface / navigation.** Same page, the `ReportBarChart` titled **"How close to the target"**,
  subtitle _"Issues by the share of the working-time target they have used. The 80-100% band is the
  one to act on."_
- **Project: `JFMB`.**
- **In frame:** every band labelled; the subtitle legible — it carries the recommendation; the
  tiles or table above, so the bars have a population.
- **Not in frame:** only the over-100% band.
- **Caption.** `The 80-100% band is the one to act on — issues by how much of the target they've used.`

| #   | Filename                  | Shot     |
| --- | ------------------------- | -------- |
| 6   | `06-dashboard-gadget.png` | **NEW.** |

- **Surface / navigation.** Dashboards → **Engineering Team Dashboard** → Add gadget → **SLA
  breaches** → **Configure** → `JFMB` → Save.
- **In frame:** real tile values.
- **Not in frame:** a development badge; an empty state; _"Indexing is still in progress."_; a `—`
  attainment.
- **Caption.** `SLA attainment on the dashboard your team already opens — no per-user install.`
- **Verify first:** as with listing 2, the gadget `edit` fix is confirmed live only on
  `time-in-status` and `wip-aging`.

**Cut from listing 4:** the CSV modal. It is the same frame on all five listings and this listing
has six stronger ones — the goal form, the model footnote and the due-date column are arguments no
competitor's screenshots make. The CSV capability still belongs in the description copy.

---

## Listing 5 — Issue History & Audit Log · `apps/issue-history` · `docs/listing-assets-issue-history/` (empty)

| #   | Filename                     | Shot     |
| --- | ---------------------------- | -------- |
| 1   | `01-cross-issue-changes.png` | **NEW.** |

- **Surface / navigation.** Projects → _Flow Metrics Bulk Seed_ → nav tab **Issue History**
  (`issue-history-page`) → ready, fully indexed.
- **Project: `JFMB`.** "Cross-issue" is the entire claim (`PRODUCT-SPEC.md` § 8: _"Jira's own
  History tab is per-issue, unfiltered, unexportable and paginated"_), and it is only visible when
  many different issue keys are on screen at once. `ROADMAP.md` 1.4's first-ever real report —
  _"104 field changes on 9 issues"_ — was on `JFM`; fine as proof of life, thin as a screenshot.
- **In frame:** headers `When (UTC) · Issue · Field · From · To · By`; rows spanning **five or more
  distinct issue keys** and three or more distinct fields; the footnote _"N changes shown. Jira's
  own History tab is per-issue and cannot be exported; this view is cross-issue and exportable."_
- **Not in frame:** consecutive rows from a single issue — that is the thing Jira already does free.
  Also the account owner's name repeated down the whole `By` column (P3): either author some changes
  from other test accounts, or crop the `By` column out and let the caption not claim it.
- **Caption.** `Every field change across the whole project, one row each — Jira's tab is per-issue.`

| #   | Filename               | Shot                                                                 |
| --- | ---------------------- | -------------------------------------------------------------------- |
| 2   | `02-capped-banner.png` | **NEW** — and the one honest cap-banner shot in the whole portfolio. |

- **Surface / navigation.** Same page, top of the ready state.
- **Project: `JFMB`, and only `JFMB`.** This matters and is worth stating precisely. The history
  report's default page is **500** (`packages/forge-runtime/src/reports.ts:441`) and JFMB's change
  count runs to thousands at ~11 changes per issue, so `toCapBanner` fires **for real**: _"Report
  capped at 500 of N changes"_, with the `Changes` tile showing the matching total and the hint
  _"…These figures cover 500 of them."_ By contrast the status, aging and SLA project pages all
  default to **500 issues** against a 300-issue project, so their cap banners **cannot** honestly be
  produced on this site at all. Do not manufacture one.
- **In frame:** the banner, the tiles, and the top of the table, together.
- **Not in frame:** the banner alone; and never the inverse — a capped table with the banner
  scrolled off.
- **Caption.** `A capped report says so, above the numbers it caps — never a silent ceiling.`

| #   | Filename               | Shot     |
| --- | ---------------------- | -------- |
| 3   | `03-busiest-field.png` | **NEW.** |

- **Surface / navigation.** Same page cropped to `PageHeader` + `toHistoryTiles`.
- **Project: `JFMB`.**
- **In frame:** the **Changes** tile reading the matching total, and the **Busiest field** tile with
  a real hint — _"N changes across M issues."_
- **Not in frame:** the `—` / _"No changes in range."_ empty state.
- **Caption.** `Which field churns most — with how many changes, across how many issues.`

| #   | Filename                        | Shot     |
| --- | ------------------------------- | -------- |
| 4   | `04-changes-by-field-chart.png` | **NEW.** |

- **Surface / navigation.** Same page, the `ReportBarChart` titled **"Changes by field"**, subtitle
  _"Which fields churn the most in this range, busiest first."_
- **Project: `JFMB`.**
- **In frame:** four or more labelled bars, with the table beneath them.
- **Not in frame:** a full 12-bar chart cropped so that `CHART_CATEGORY_LIMIT`'s truncation reads as
  the complete field list.
- **Caption.** `Where the churn is, busiest field first — the table beneath still lists every change.`

| #   | Filename                  | Shot     |
| --- | ------------------------- | -------- |
| 5   | `05-dashboard-gadget.png` | **NEW.** |

- **Surface / navigation.** Dashboards → **Engineering Team Dashboard** → Add gadget → **Field
  changes** (the manifest `title`; not "Issue History") → **Configure** → `JFMB` → Save.
- **In frame:** real tile values.
- **Not in frame:** a development badge; an empty state.
- **Caption.** `Field-change totals on the dashboard, for people who never open a report.`

| #   | Filename                  | Shot     |
| --- | ------------------------- | -------- |
| 6   | `06-csv-export-modal.png` | **NEW.** |

- **Surface / navigation.** Project page → **Export CSV** → the modal.
- **Confirm before keeping:** the 2026-09-21 fix made this app pass `'history'` to
  `handleExportCsv`, so the modal must show `Changed at / Issue key / Field / From / To / Author` —
  **not** a status table. That bug is recorded in `LISTING-COPY-issue-history.md` § "Known
  mismatches" item 1 as resolved; the screenshot is where it gets verified.
- **Caption.** `Cross-issue history copied out in one click — the thing Jira's History tab can't do.`

**One copy correction this shot list forces.** `LISTING-COPY-issue-history.md` already records it,
but it bears repeating here because a screenshot is the easiest place to re-introduce it: **no
filter controls ship in this UI.** `filterHistory` and the resolver support filtering; the project
page calls `getHistoryReport` with an empty payload and renders no inputs. No shot may frame the
page so that a filter appears to exist.

---

## What each listing's first shot must prove

- **Listing 1 — Time in Status.** That a status entered three times reads higher than Jira's own
  chart by exactly the earlier visits, on a figure the viewer can check in one click.
- **Listing 2 — Worklog Reports.** That logged time is split across named people with each one's
  share of the total — a single 100% row proves the opposite of the thing being sold.
- **Listing 3 — WIP Aging.** That every unfinished issue is ranked by how long it has sat where it
  is, with the moment it got there, so the oldest thing on the board has a name and a date.
- **Listing 4 — SLA & Due Dates.** That the goal the breaches are measured against is visible and
  changeable on the same page as the breaches — the number is never unqualified.
- **Listing 5 — Issue History.** That field changes from many different issues sit on one page, one
  row each, which is exactly what Jira's per-issue History tab cannot do.

---

## Shots that would be dishonest

Every one of these would be a genuine, unedited screenshot of the real product. That is what makes
them worth writing down: this codebase spends whole functions on the difference between
`toCapBanner`, `toReadCapBanner` and `toAggregateCapBanner` — three sentences for three different
truncations — and the listing page is the one surface where that discipline has no test protecting
it.

1. **A cap banner without the report it qualifies, or a capped report with the banner cropped off.**
   The second is worse. `toCapBanner`'s own docstring calls an uncapped-looking capped page "the
   silent-ceiling failure documented in TECHNICAL-SPEC § 11.1"; re-creating it with a crop
   re-creates the defect in the only place a buyer will ever look. Listing 5 shot 2 exists to make
   the honest version of this frame, and it is honest only because the banner, the tiles and the
   table are in it together.

2. **The cumulative flow chart with thirty day-ticks over two days of data.** JFMB was seeded past
   300 issues in about ten minutes and Jira stamps changelog entries with its own clock
   (`tools/seed-report.md`). A 30-day axis with everything piled in one or two UTC days is a real
   render of a real chart that tells a buyer we watched their flow for a month. Verify the series
   spans real days, or cut listing 3 shot 3.

3. **A median or 85th-percentile tile computed over one issue.** The _currently shipped_
   `docs/listing-assets/04-summary-tiles.png` reads _"In Review · median <1m · 85th percentile <1m,
   across 1 issues"_. The hint is honest; the tile beside four others is not, because a percentile
   over n=1 borrows the authority of the ones over n=10. This is why listing 1 shot 5 moves to
   `JFMB`.

4. **The `JFM` Time in Status table with its uniform Total column.** In `01-reentry-badge.png` every
   one of the ten rows totals `3d 22h 58m`, because the seeder walked every issue through the same
   transitions in the same run. Nothing in the frame is false and the whole frame is unbelievable.
   Either re-seed with `--dwell` (as `tools/seed-report.md` recommends) or crop to the four or five
   rows whose per-status figures genuinely differ — and do not let the Total column be the thing the
   eye lands on.

5. **A one-row worklog report at 100%.** On a listing whose columns are `Share`, `Entries` and
   `Issues`, a single row makes all three meaningless while looking like a working report. This is
   why listing 2's first three shots are blocked on seeding rather than on framing.

6. **`JFM`'s WIP Aging page as the aging shot — and its mirror image.** Four in-flight issues with
   five of six buckets empty is an empty state dressed as a populated one. The mirror is just as
   bad and easier to reach by accident: seeding or filtering a project so that everything lands in
   `30d+` produces a crisis-shaped histogram of a project nobody has. Shoot the real distribution,
   empty buckets included — which is, after all, the caption's own claim.

7. **A due-date column showing only the late rows.** `describeDueDate` renders four distinct states
   and three of them are good news. Sorting or filtering to the breaches makes a healthy project
   look like a failing one, and it is the exact framing a buyer will later discover their own data
   does not reproduce.

8. **The re-entry proof shot taken on an issue whose summary announces the staging.** `JFM-11` is
   titled `[RE-ENTRY] re-entry ×3 — bounced back to the backlog twice` and labelled `jfm-seed`. A
   frame containing both the evidence and the note saying the evidence was manufactured to order is
   not an honest screenshot with a cosmetic flaw; it tells the viewer the number was arranged. The
   fix is to rename the issue before capture, not to crop the summary and hope.

9. **Any SLA figure with the goal cropped out.** An attainment percentage or a breach count carries
   no meaning without the counted statuses and the target. `PRODUCT-SPEC.md` § 7 records that the
   engine implements two SLA models that give _different answers_, and that a saved goal travels to
   the server as its id alone so a page cannot be headed with one goal's name and computed from
   another's numbers. A screenshot that separates the number from its goal undoes that on purpose.

10. **A development install with the badge cropped out.** The `Dev` badge is a property of the
    install, not of the frame. Cropping it is not tidying — it is presenting a development build as
    the shipping one, which is also the single thing a Marketplace reviewer is most likely to catch.
    Same for _"Indexing is still in progress."_: include it whole or wait for the index.

11. **A WIP-aging "Working hours" figure presented as the age.** `TECHNICAL-SPEC.md` § 11 item 2:
    `business_ms` covers only the _completed_ portion of the current visit, which is exactly why the
    table shows two columns and says so in a footnote. Cropping to the working-hours column alone
    would claim a precision the stored data does not have.

12. **A CSV modal framed or captioned as a download.** It is a copyable modal. `TECHNICAL-SPEC.md`
    § 11 item 8 prices the three available routes to a real download and deliberately takes none of
    them for v1. Every CSV caption in this document says "copyable export, not a hidden download"
    for that reason.

13. **An admin storage page with anything issue-shaped in frame.** A test already asserts no issue
    key can reach that page, because `jira:adminPage` is visible to people with no permission on the
    projects the rows came from. A screenshot that put one there would be a privacy claim broken in
    public.

---

## What could not be determined from this repository

Each of these changes a shot and none of them can be settled by reading code.

1. **Whether a production (non-development) install exists for listings 2-5.** Only listing 1's
   `05-dashboard-gadget.png` records one (`LISTING-COPY.md` row 5). Every other captured artefact in
   the repo shows a `Dev` badge. All five gadget shots depend on the answer.
2. **Whether the "Engineering Team Dashboard" still exists**, and which gadgets are on it. Five
   shots name it.
3. **The current index state per app per project.** `TECHNICAL-SPEC.md` § 11 item 10 found the five
   apps holding materially different row counts at the same moment, and `ROADMAP.md` 1.7a records a
   JFMB backfill stalling at 100 issues. Every `JFMB` shot is conditional on this (P5).
4. **The site's UI language at capture time.** Listing 1's assets are Russian; the 2026-09-22 raw
   JPEGs are English. The repo does not record what changed or whether it persists (P2).
5. **Whether any `JFMB` issue has a status re-entry with a margin visible to the eye.**
   `tools/seed-bulk-report.md` says 186 issues re-enter at least one status but records **no
   margins**, and `tools/seed-report.md` explains why a fast seed produces sub-minute differences.
   Until someone measures, `JFMB` cannot substitute for `JFM` on the `×N` claim.
6. **Whether the `jira:issueActivity` "Time in Status" tab currently appears in the Activity strip.**
   `ROADMAP.md` stage 6 says the Activity tab was confirmed rendering; the only captured Activity
   strip in the repo (`02-history-tab-comparison.png`) predates the module and shows only Jira's own
   four tabs. Listing 1 shot 2 depends on it.
7. **Whether the project display names may be changed.** `PROMOTION.md` § 9 asks for "a project name
   that is plausible rather than `TEST`"; _Flow Metrics Seed_ and _Flow Metrics Bulk Seed_ are
   visible in the sidebar and breadcrumb of every project-page shot and read as seed data.
8. **The Marketplace console's current image dimension and count requirements.** `PROMOTION.md` § 9
   is explicit that these move and that "a remembered number is worth nothing against the form in
   front of you". The existing assets range from 670×185 to 1227×745, which suggests no fixed
   requirement was being met.
