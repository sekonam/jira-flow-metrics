# CAPTURE PLAN — 2026-09-24 · listings 2-5

Operational companion to `docs/SHOT-LIST.md`. That document holds the reasoning — why each shot,
why each project, and § "Shots that would be dishonest", which this plan's final checklist
compresses. **This document is only the clicks.** Where the two disagree, this one is newer: it was
written against what the site rendered this morning, not against what the seeds promised.

---

## What is true on the site this morning

- All five apps are deployed to `development` at HEAD and installed. The `Dev` lozenge appears
  **only in Jira's project-tab strip**, never inside app content — so it neither has to be cropped
  nor may be.
- **The tab strip overflows.** On JFMB only **WIP Aging** shows; the other four apps sit behind
  **More 9**. Every project-page navigation below goes through that menu.
- Every project page renders Jira's own page title directly above `PageHeader`'s `<h1>` — the same
  words twice. **Crop below Jira's.**
- Header actions, top right of all four pages: **Export CSV**, then **Extend history**.
- **JFMB**, observed 09:52 today (`docs/listing-assets-wip-aging/raw-2026-09-24/`):
  In flight **66** · Oldest **12d 3h 33m** (JFMB-2 in In Progress) · Older than 14 days **0**.
  Every in-flight issue entered its current status on **11 Sep 2026**, so: the age histogram is a
  **single bar in `7-14d`** with five empty buckets, and the ageing table's `Entered status` column
  reads the same date on every row.
- **JFM**: 10 issues, plausible summaries, labels cleared, hand-verified margins in
  `tools/seed-report.md` (`JFM-11 / В работе / 3 visits / 15.5h` is the checkable one).
- **One worklog author site-wide.** `tools/seed-worklog-authors.mjs` is the fix and needs
  credentials that do not exist yet.

### Update, 10:40 — what changed since the morning notes above

- **JFMB indexes cleanly now, on every app.** The key-ordered reseek shipped to all five and has
  been watched through a full walk on `issue-history`, `sla-breach` and `worklog-reports`
  (`forge logs -e development` shows `switching to a key-ordered walk` stepping
  `JFMB-50 → 100 → 150 → 200 → 250 → 300`, and no `Backfill stuck` after it). A page that still
  shows **Indexing failed** is showing a _stale_ failure: click **Retry indexing** once and the
  banner clears. Do that before shooting anything on JFMB.
- **Issue History is the strongest of the four.** 2,985 changes with a real cap banner over them,
  and **five** bars in _Changes by field_ — `status · timeestimate · timespent · WorklogId ·
resolution` — because of the priority and label edits. Frames banked and cropped.
- **SLA & Due Dates rendered live for the first time**, and its distribution chart turns out to be
  unusable for the same reason listing 3's cumulative-flow chart is. See
  `docs/listing-assets-sla-breach/candidates-2026-09-24/CAPTIONS.md`; the short version is that
  all 300 JFMB issues carry 66h50m-66h53m of working time, three minutes apart, so the chart is
  one bar at **every** target and no target value splits it. Shoot the goal editor, the tiles and
  the table; do not shoot the chart.
- **The WIP Aging frames in `docs/listing-assets-wip-aging/raw-2026-09-24/` predate action 2** —
  single bar in `7-14d`, _Older than 14 days_ at `0`. They are the record of the blocked state, not
  candidates. Re-shoot that page now that a dozen issues have moved.

### Two site-level actions that pay for themselves before you shoot

1. **Rename the Atlassian account display name** to something neutral and plausible. One edit,
   no data change, and it clears P3 from listing 5's `By` column, Jira's own Work log tab
   (listing 2 shot 4) and every CSV modal at once.
2. **Transition 10-15 in-flight JFMB issues now.** They enter a status today, so the ageing table
   gains rows dated 24 Sep with ages in minutes and the histogram gains a `0-1d` bar. This single
   action unblocks listing 3 shots 1, 2 and 4. It stages nothing: it is work moving.

---

## Project-page URLs

```
https://sergiip180.atlassian.net/jira/software/projects/<KEY>/apps/<appId>/<moduleInstanceId>
```

| Listing | App               | `appId` (manifest `app.id`, ari prefix stripped) | Project tab     | Gadget title   |
| ------- | ----------------- | ------------------------------------------------ | --------------- | -------------- |
| 2       | `worklog-reports` | `1bdd9c5e-f1fb-47ca-b847-448dbd8eb021`           | Worklog Reports | Logged time    |
| 3       | `wip-aging`       | `0e259744-1e08-4511-b59d-8fe07cc63621`           | WIP Aging       | WIP aging      |
| 4       | `sla-breach`      | `b149665a-b013-4688-b2e7-bf1304de2955`           | SLA & Due Dates | SLA breaches   |
| 5       | `issue-history`   | `b7a70548-f901-43a4-be30-55e632b70468`           | Issue History   | Field changes  |
| (1)     | `time-in-status`  | `05b589b7-c96b-40eb-8ded-0cc100ef851b`           | Time in Status  | Time in Status |

### The JFMB module instance ids, collected 2026-09-24

Read straight out of the **More** menu's anchors, so they are the ids Jira actually routes on. The
`Dev` row is the `development` deployment — the one this work installs to — and the plain row is the
same module from an earlier install; they are different instances of the same app and they do not
share data. **Shoot the `Dev` row.**

| App               | `Dev` instance                         | other instance                         |
| ----------------- | -------------------------------------- | -------------------------------------- |
| `time-in-status`  | `fde3c0c8-379b-499a-961c-f9fd7f3c2f7f` | `239eaf4e-5adb-47fa-9eb9-95c06d11f03b` |
| `worklog-reports` | `feae5eaa-b3ac-4b5c-bb8d-07d4d8b7aaa2` | `ff19d429-6269-4460-85d7-b524a703f717` |
| `wip-aging`       | `47f79ea7-77c2-44ee-9d83-91a58f3924db` | `cf14724d-db7a-4659-bb88-b92db0facebd` |
| `sla-breach`      | `a353ce2c-8607-4496-b594-3e5af38c01a3` | (none in the menu)                     |
| `issue-history`   | `553260fe-526a-4f8c-878e-af7ea6f44335` | `1e92b446-f773-4b39-a528-17b735f142f8` |

Collecting them by hand is no longer necessary, and the **More** menu is awkward to drive: its items
are not in the DOM until it opens. Reading them back out afterwards is one line in the page console —

```js
Array.from(document.querySelectorAll('a[href*="/apps/"]')).map(
  (a) => a.textContent.trim() + ' | ' + a.getAttribute('href').split('?')[0],
);
```

**`<moduleInstanceId>` is not in this repository.** Jira mints it per installed module instance.
Get it by clicking the tab (**More 9** → the title above) once per app and copying the URL from the
address bar; it is stable for the life of the install. Collect all four at the start, then navigate
by URL for the rest of the session. The `appId` column is there so you can tell from the URL which
tab you landed on when four of them look alike.

---

## Listing 2 — Worklog Reports · `docs/listing-assets-worklog-reports/`

**Four of six shots are still blocked on the single-author problem.** Capture the two that work,
and do not improvise around the rest.

### `04-issue-work-log-check.png` — JFM · CAPTURABLE

- **Do:** open `JFM-12` (or `JFM-13`) → scroll to **Activity** → click Jira's own **Work log** tab →
  wait for the entries to render → crop to the entry list.
- **Frame:** three or more individual work log entries whose stated durations visibly sum to that
  issue's contribution in our report. `tools/seed-scenarios.mjs` fixes the hours per scenario
  (`[2, 3]`, `[1, 1, 4]`, `[2, 2, 2, 1]`), so you know the sum before you look.
- **Out of frame:** the right-hand detail panel (real names on Assignee/Reporter).
- **Caption:** `Check it yourself: the total is the sum of the durations on the issue, entry by entry.`

### `06-csv-export-modal.png` — JFMB · CAPTURABLE

- **Do:** Worklog Reports tab on JFMB → **Export CSV** → wait for the modal → crop to the modal.
- **Frame:** the filename as `ModalTitle`; the sentence _"Select the text below and copy it, then
  save it as …. Jira apps render in a sandbox that cannot hand a file to the browser."_; CSV rows
  whose header reads `Person,Hours logged,Entries,Issues`.
- **Kill it if:** the header row is a status table — that is the pre-2026-09-21 `CsvExportKind` bug
  and the shot becomes a bug report, not an asset.
- **Caption:** `Copy the whole worklog table out in one click — a copyable export, not a download.`

### Blocked, and what unblocks them

- **`01-logged-time-per-person.png`, `02-time-logged-chart.png`, `03-totals-footnote.png`,
  `05-dashboard-gadget.png`.** All four need a grouped report with more than one row; every worklog
  on the site is authored by the one API user, so the table is one row at `100%`, the chart is one
  bar, the footnote qualifies one row, and the gadget's **Largest contributor** tile names the
  account owner. **Unblock:** invite ≥2 users, mint their API tokens into `.env` as
  `JIRA_EMAIL_2`/`JIRA_API_TOKEN_2` (`_3`…), then `pnpm run seed:worklog-authors`. Account creation
  is the human half and the tool says so.
- `05` additionally needs **Configure** confirmed clickable on _this_ gadget: the `edit.render:
native` fix is verified live only on `time-in-status` and `wip-aging`.
- **No cap banner is available here.** The worklog report's limit is 10,000 entries against a few
  hundred; `toCapBanner` cannot fire honestly on this site. Do not chase one.

---

## Listing 3 — WIP Aging · `docs/listing-assets-wip-aging/`

Everything below is JFMB. JFM has four in-flight issues and is not a candidate for any of it.

### `01-oldest-first-table.png` — JFMB · AMBER (do action 2 first)

- **Do:** JFMB → **More 9** → **WIP Aging** → wait out the SPA "busy" period (20-60s) → scroll so
  the three tiles sit at the top of the frame and the table fills the rest.
- **Frame:** all six headers `Issue · Status · Age in status · Working hours · Age total · Entered
status`; the **Oldest** tile naming the same issue key as the top row; the footnotes
  _"N finished issues are excluded; ageing only applies to work in flight."_ and the working-hours
  sentence beneath it.
- **Check before saving:** today the `Entered status` column reads `11 Sep 2026` on every visible
  row and the ages differ only by minutes. That is § "dishonest" item 4 wearing a different table.
  Either do site action 2 first, or scroll to a window of rows that genuinely differ and let the
  eye land on the `Age in status` column rather than on `Entered status`.
- **Caption:** `Every unfinished issue, oldest first — with the moment it entered the status it's in.`

### `02-age-distribution.png` — JFMB · BLOCKED until action 2

- **Do:** same page, crop to the `AgingHistogram` — title **"Age distribution"**, subtitle
  _"Unfinished issues in flight, grouped by how long they've sat in their current status."_
- **Frame:** all six labels `0-1d · 1-3d · 3-7d · 7-14d · 14-30d · 30d+`, counts in **more than one**
  bucket, and at least one honest zero.
- **Blocked because:** all 66 in-flight issues are in `7-14d`. One bar over five empty buckets is
  the empty-state-dressed-as-data frame the caption itself disclaims. Transitioning a dozen issues
  today produces a `0-1d` bar and makes the shot true.
- **Caption:** `Six buckets, always all six — an empty bucket is a fact the chart states, not a gap.`

### `04-summary-tiles.png` — JFMB · AMBER (better on/after 26 Sep)

- **Do:** same page, crop to `PageHeader` + the three tiles.
- **Frame:** **In flight 66**, **Oldest 12d 3h 33m** with its hint _"JFMB-2 in In Progress."_,
  **Older than 14 days**.
- **Check before saving:** the third tile reads **0** today. It makes no argument at zero. The
  11 Sep cohort crosses fourteen days on **25-26 Sep 2026**, at which point the tile becomes a real
  number by itself — shoot this then, or caption it without the staleness claim.
- **Caption:** `How stale the board is, in three numbers — including what hasn't moved in a fortnight.`

### `05-dashboard-gadget.png` — JFMB · CAPTURABLE

- **Do:** Dashboards → **Engineering Team Dashboard** → Add gadget → **WIP aging** → **Configure** →
  pick `Flow Metrics Bulk Seed` → Save → wait for tiles.
- **Frame:** real tile values, with neighbouring gadgets visible so it reads as a dashboard. If a
  cap notice fires, the whole sentence is in frame.
- **Out of frame:** an empty state; a half-cropped notice. This app's config screen is already
  verified live, so no extra check.
- **Caption:** `The ageing board where your team already looks — no install needed to read it.`

### `06-csv-export-modal.png` — JFMB · CAPTURABLE

- **Do:** WIP Aging page → **Export CSV** → modal.
- **Frame:** the filename as title, the sandbox sentence, and rows whose header is
  `Issue key,Status,Age in status (hours),Age in status, working, completed portion (hours),Age
total (hours),Entered status (UTC)`.
- **Note:** the filename is `wip-aging-<numeric project id>.csv`, not `-JFMB.csv`. That is correct;
  do not caption it as the project key.
- **Caption:** `Copy the ageing table out in one click — a copyable export, not a hidden download.`

### Currently impossible

- **`03-cumulative-flow.png` — cut it.** The live chart is flat from 25 Aug to 10 Sep, steps once on
  11 Sep, then flat to 23 Sep: thirty day-ticks over one day of movement, which is § "dishonest"
  item 2 verbatim. **Unblock:** only a re-seed with real dwell across days would fix it, and REST
  cannot backdate a changelog entry — so it is a re-seed, not a wait.
- **A report-level cap banner.** The aging report's limit is 500 issues against 300; it cannot fire.
  The banner that _does_ fire on this page — _"Showing 105 issues, and there are more"_ — is
  `toReadCapBanner` on the **flow chart**, and it qualifies the one chart above that we are cutting.
  Honest banner, unusable frame. (Note this corrects SHOT-LIST, which says only listing 5 can
  produce a real cap banner on this site.)

---

## Listing 4 — SLA & Due Dates · `docs/listing-assets-sla-breach/` (empty)

Nothing here has ever been rendered live. **Every expectation below is derived from the seeds and
the code, and must be read off the screen before it is believed.** All JFMB.

### `01-goal-and-overrun.png` — JFMB · target **8 working hours** (the default)

- **Do:** JFMB → **More 9** → **SLA & Due Dates** → wait → leave the target at its default, leave
  every status counted → crop from the **Working-time target** control down through the first table
  rows.
- **Frame:** the target `Select`; the line _"Counting time in every status. Select statuses to count
  only those."_ with the status chips beneath it; and rows showing `Working time used · Target ·
Remaining · Status`, at least one reading `over by …` against **Breached** and at least one
  **Within target**. The 66 in-flight issues carry ~66h of working time, so overruns against an
  8-hour target should be plentiful and the 234 finished ones supply the compliant rows.
- **Out of frame:** any number without the goal control above it.
- **Caption:** `Overrun in words — "over by 6h" — against a target you can see and change on the page.`

### `03-summary-tiles.png` — JFMB · same goal, shoot immediately after 01

- **Do:** scroll up, crop to `PageHeader` + the three tiles.
- **Frame:** a real **Attainment** percentage with its hint _"N issues measured against "<goal>"."_,
  **Breached**, **Late against due date**.
- **Kill it if:** Attainment reads `—` (a capped report withholds it), or 100% sits beside a
  non-zero Breached — the second is impossible by construction, so file it rather than shoot it.
- **Caption:** `Attainment, breaches and due-date lateness — the three numbers a review opens with.`

### `02-model-footnote.png` — JFMB · same goal

- **Do:** scroll to the bottom of the table, crop to the last rows plus both footnotes.
- **Frame:** both sentences unbroken — _"Goal "<name>": working time spent in the counted statuses,
  measured against the working calendar configured for this project."_ and _"This is a
  counted-statuses goal, not a start/stop/pause timer…"_ — with table rows above them.
- **Caption:** `The measurement model stated on the report itself — counted statuses, not a timer.`

### `04-due-date-column.png` — JFMB · same goal

- **Do:** same table, crop to `Issue · Status · Due date`, scrolling until all three states are in
  one window. Due dates are seeded uniformly across ±30 days, so all three exist; do not sort or
  filter to find them.
- **Frame:** `28 Aug 2026 (late by 2d 4h)`, `… (on time)`, and `—`.
- **Caption:** `Plain due-date breaches too — resolved late, still open past due, or no due date.`

### `05-target-band-chart.png` — JFMB · **change the target to 80 working hours first**

- **Do:** same page → **Working-time target** → select **80 working hours** → wait for the reload →
  crop so the chart and the control above it are both in frame.
- **Why the change:** at 8 hours nearly everything in flight is already breached and the
  **80-100%** band — the one the subtitle tells the reader to act on — is likely empty. At 80 hours
  the in-flight cohort sits at roughly 66h of 80h, which lands in that band. Changing the target is
  not staging: the control is in the frame and the caption names it.
- **Frame:** title **"How close to the target"**, the subtitle whole (it carries the
  recommendation), all four bands labelled, and the target `Select` showing `80 working hours`.
- **Out of frame:** the chart cropped away from the control that set it.
- **Caption:** `The 80-100% band is the one to act on — issues by how much of the target they've used.`

### `06-dashboard-gadget.png` — JFMB · verify first

- **Do:** Dashboards → **Engineering Team Dashboard** → Add gadget → **SLA breaches** →
  **Configure** → `Flow Metrics Bulk Seed` → Save.
- **Verify first:** the `edit.render: native` fix is confirmed live only on `time-in-status` and
  `wip-aging`. If **Configure** is disabled, this shot does not exist today.
- **Frame:** real tile values, neighbouring gadgets visible.
- **Out of frame:** an empty state, _"Indexing is still in progress."_, a `—` attainment.
- **Caption:** `SLA attainment on the dashboard your team already opens — no per-user install.`

### Currently impossible

- **Any cap-banner frame.** 500-issue limit, 300-issue project.
- **A saved-goal frame** (`Saved goal` picker, _"Measuring against the saved goal …"_). The picker
  only renders once a goal is saved — save one named plausibly (e.g. `Time to resolution`) if you
  want it, otherwise the row is simply absent and nothing is misrepresented.
- The CSV modal stays cut from this listing, per SHOT-LIST: six stronger frames, and the capability
  lives in the description copy.

---

## Listing 5 — Issue History · `docs/listing-assets-issue-history/` (empty)

All JFMB. ~300 issues at ~11 changes each puts the change count in the thousands against a 500-row
page, so this is the one listing whose cap banner fires for real.

### `02-capped-banner.png` — JFMB · shoot this **first**, at the top of the page

- **Do:** JFMB → **More 9** → **Issue History** → wait → do not scroll; crop the banner, the two
  tiles and the first table rows as one frame.
- **Frame:** _"Report capped at 500 of N changes"_ with its body sentence, the **Changes** tile
  showing the matching total with the hint _"…These figures cover 500 of them."_, and the top of the
  table.
- **Kill it if:** no banner appears — then the change count is under 500 and the shot is a claim
  about a ceiling that did not apply.
- **Caption:** `A capped report says so, above the numbers it caps — never a silent ceiling.`

### `03-busiest-field.png` — JFMB

- **Do:** same page, crop to `PageHeader` + the two tiles.
- **Frame:** **Changes** with the matching total, **Busiest field** with a real hint
  _"N changes across M issues."_
- **Caption:** `Which field churns most — with how many changes, across how many issues.`

### `04-changes-by-field-chart.png` — JFMB · AMBER

- **Do:** same page, scroll to the `ReportBarChart` titled **"Changes by field"**, subtitle _"Which
  fields churn the most in this range, busiest first."_ — crop so the first table rows sit beneath
  it.
- **Check before saving:** the seeds move **status** and little else, so this chart may render one
  or two bars. Below three it is not a churn chart and should be cut. **Unblock:** bulk-edit
  assignee / priority / labels across a slice of JFMB to create real churn.
- **Out of frame:** a 12-bar chart cropped so `CHART_CATEGORY_LIMIT`'s truncation reads as the
  complete field list.
- **Caption:** `Where the churn is, busiest field first — the table beneath still lists every change.`

### `01-cross-issue-changes.png` — JFMB

- **Do:** same page, scroll into the table body, crop to a window of rows spanning **five or more
  distinct issue keys** and three or more fields, with the footnote if it fits.
- **Frame:** headers `When (UTC) · Issue · Field · From · To · By`; the footnote _"N changes shown.
  Jira's own History tab is per-issue and cannot be exported; this view is cross-issue and
  exportable."_
- **Out of frame:** consecutive rows from one issue — that is the thing Jira does for free. The `By`
  column repeats the account owner on every row: do site action 1, or crop the column and let the
  caption not claim it.
- **Not in frame, ever:** anything that implies a filter control. **This UI ships none.**
- **Caption:** `Every field change across the whole project, one row each — Jira's tab is per-issue.`

### `06-csv-export-modal.png` — JFMB

- **Do:** same page → **Export CSV** → modal.
- **Frame:** filename as title, sandbox sentence, and a header row reading
  `Changed at (UTC),Issue key,Field,From,To,Author`. This is where the 2026-09-21 per-listing fix
  gets verified; a status header means the bug is back.
- **Caption:** `Cross-issue history copied out in one click — the thing Jira's History tab can't do.`

### `05-dashboard-gadget.png` — JFMB · verify first

- **Do:** Dashboards → **Engineering Team Dashboard** → Add gadget → **Field changes** →
  **Configure** → `Flow Metrics Bulk Seed` → Save.
- **Verify first:** same unverified `edit.render` question as listing 4.
- **Caption:** `Field-change totals on the dashboard, for people who never open a report.`

### Currently impossible

- Nothing on this listing is blocked outright. Two are conditional: `04` on there being ≥3 fields
  with churn, and `05` on the gadget's **Configure** being live. The `By` column is a rename away
  from clean.

---

## Order of capture

Top to bottom. One project, then one app, then one page-load per group.

**Before anything:** rename the account display name (site action 1); transition 10-15 in-flight
JFMB issues (site action 2); open each of the four tabs once via **More 9** and record the four
`moduleInstanceId`s.

1. JFMB → **WIP Aging** → tiles + table → `wip-aging/01-oldest-first-table.png`
2. same page → histogram → `wip-aging/02-age-distribution.png` _(only if ≥2 buckets have counts)_
3. same page → tiles alone → `wip-aging/04-summary-tiles.png` _(or defer to 26 Sep)_
4. same page → **Export CSV** → `wip-aging/06-csv-export-modal.png`, then close the modal
5. JFMB → **SLA & Due Dates** → goal control + first rows → `sla-breach/01-goal-and-overrun.png`
6. same page, scroll up → tiles → `sla-breach/03-summary-tiles.png`
7. same page, scroll down → last rows + both footnotes → `sla-breach/02-model-footnote.png`
8. same page → due-date column window → `sla-breach/04-due-date-column.png`
9. same page → set target to **80 working hours**, wait → chart + control →
   `sla-breach/05-target-band-chart.png`
10. JFMB → **Issue History** → banner + tiles + top rows → `issue-history/02-capped-banner.png`
11. same page → tiles alone → `issue-history/03-busiest-field.png`
12. same page → "Changes by field" + rows beneath → `issue-history/04-changes-by-field-chart.png`
13. same page, scroll into the body → `issue-history/01-cross-issue-changes.png`
14. same page → **Export CSV** → `issue-history/06-csv-export-modal.png`, then close
15. JFMB → **Worklog Reports** → **Export CSV** → `worklog-reports/06-csv-export-modal.png`
16. JFM → open `JFM-12` → Activity → **Work log** →
    `worklog-reports/04-issue-work-log-check.png`
17. Dashboards → Engineering Team Dashboard → **WIP aging** gadget →
    `wip-aging/05-dashboard-gadget.png`
18. same dashboard → **SLA breaches** gadget → `sla-breach/06-dashboard-gadget.png`
    _(skip if Configure is disabled)_
19. same dashboard → **Field changes** gadget → `issue-history/05-dashboard-gadget.png`
    _(skip if Configure is disabled)_

Raw captures go to `docs/listing-assets-<app>/raw-2026-09-24/`; cropped PNGs to the directory root.

---

## Honesty checks at capture time

Five seconds per frame, before you save it.

1. **Banner rule.** Is there a yellow or blue banner anywhere on the page? Then it is _in_ this
   frame or this frame is void. Never a capped report with the banner scrolled off; never a banner
   without the report it qualifies.
2. **Dev lozenge.** It belongs in the tab strip. Do not crop it off to make a development install
   look like a shipping one — that is the one thing a reviewer catches.
3. **Heading.** Jira's page title cropped out, our `<h1>` kept. No doubled title.
4. **Denominator.** Any median, percentile or share in frame — does the hint say `across N issues`
   with N in the tens? `across 1 issues` kills the shot.
5. **Uniform column.** Does any column read the same value on every visible row? Reframe. Nothing is
   false and the whole frame is unbelievable.
6. **Names.** No real personal name, no avatar of one, in any cell or panel.
7. **Seed tells.** No `[RE-ENTRY]`-style summary, no `jfm-seed`/`jfmb-*` label, in frame.
8. **Chart vs table.** A bar chart is capped at 12 categories; if it might be truncated, the table
   is in the same frame. The chart summarises; the table is the record.
9. **SLA only.** Every number shares its frame with the target `Select` and the counted-statuses
   line. A breach count with the goal cropped out is the unqualified number this product exists to
   not produce.
10. **Due dates.** All three states visible — late, on time, `—`. Never filtered or sorted to the
    breaches.
11. **Ageing only.** `Age in status` and `Working hours` are two columns for a reason; never crop to
    the working-hours column and present it as the age.
12. **CSV modals.** The sandbox sentence is in frame, and neither the frame nor the caption implies
    a browser download.
13. **Language.** Nav, tabs and chrome in English.
14. **Listing 5 only.** Nothing in frame that could read as a filter control — this UI ships none.

---

## Site changes made during the 2026-09-24 capture session

Three of this plan's own blockers were cleared by changing the seeded data
rather than by working around it. Recorded here because the plan's shot
notes above were written against the _old_ site state and will read as wrong
otherwise.

1. **The in-flight cohort is no longer uniform.** All 66 JFMB in-flight
   issues had entered their status on 11 Sep, so the age histogram was one
   bar in `7-14d` over five empty buckets and the ageing table's
   `Entered status` column read the same date on every row. Twelve issues
   were transitioned (to `In Review`, back to `To Do`), which re-dates each
   one's current visit to now and spreads the distribution across buckets.

2. **`status` is no longer the only field that churns.** The seeders move
   status and nothing else, so listing 5's "Changes by field" chart had one
   bar — a chart whose own subtitle promises "which fields churn the most"
   proving nothing. Priority and labels were varied across twelve issues.

3. **All five apps now run HEAD on `development`.** Only `wip-aging` had the
   key-ordered reseek fix when this plan was written; the other four still
   failed their backfill at issue 100. Confirmed live on `sla-breach` after
   redeploying: tier 1 (created-date) then the key-ordered escalation past
   `JFMB-50` and `JFMB-100`, exactly as `wip-aging` did.

Still blocked, unchanged: **worklog-by-author** needs a second Jira account
(`JIRA_EMAIL_2` / `JIRA_API_TOKEN_2` and `pnpm run seed:worklog-authors`),
and the **display name** `Sergii P1` still appears in listing 2's tiles and
listing 5's `By` column.
