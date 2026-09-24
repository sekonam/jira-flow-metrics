# LISTING-COPY — listing ④ SLA Breach, ready to paste

> Drafted from `PROMOTION.md` § 1 and § 9 and `PRODUCT-SPEC.md` § 7. Every claim here is one this
> repository can back with a test or the deployed app — nothing is aspirational copy waiting on a
> feature. Stored SLA goals and the goal editor shipped with v1.1 (2026-09-22) and are promised
> below because they exist; an earlier version of this note said the opposite, before they were
> built. The CSV export is described as the copyable modal it actually is, never as
> a download. `ROADMAP.md` stage 4 flags this listing specifically: _"the counted-statuses model
> needs the clearest listing copy"_ — the model section below exists because of that line, and any
> edit that blurs it should be treated as a regression, not a style choice.

---

## Pre-submission checks — run 2026-09-21

`ROADMAP.md` stage 4 requires two checks before every submission; either being "yes" means
dropping the listing, not shipping it anyway.

### Check (a): has Atlassian shipped native SLA tracking for plain Jira Software Cloud since 2026-09-05?

**No.** Searched 2026-09-21. SLA goals remain a Jira Service Management feature — Atlassian's own
documentation for setting up SLA goals lives exclusively under Jira Service Management Cloud, and
the September 2026 Jira Cloud release coverage (Atlassian Projects integration, modernised
company-managed boards, profile cards) contains no SLA capability for plain Jira. Third-party
listings continue to describe themselves as filling exactly this gap ("especially useful for Jira
Software or Jira Core projects that don't support native SLA tracking"). The only "SLA" Atlassian
attaches to plain Jira Cloud is the 99.9%/99.95% _uptime_ SLA on Premium/Enterprise plans, which
is unrelated.

Sources, all retrieved 2026-09-21:

- [Set up service level agreement (SLA) goals — Jira Service Management Cloud docs](https://support.atlassian.com/jira-service-management-cloud/docs/set-up-sla-goals/)
  (still JSM-only)
- [Create service level agreements (SLAs) — Jira Service Management Cloud docs](https://support.atlassian.com/jira-service-management-cloud/docs/create-service-level-agreements-slas/)
- [Atlassian release notes, September 2026 (Releasebot digest)](https://releasebot.io/updates/atlassian)
  (no SLA feature for plain Jira in the summer/September 2026 releases)
- [SLA Management listing, Atlassian Marketplace](https://marketplace.atlassian.com/apps/1233885/sla-management)
  (a competitor still positioning on "Jira Software or Jira Core projects that don't support
  native SLA tracking")

### Check (b): has a free first-party or well-funded free app appeared at the top of the Jira SLA niche?

**No.** Searched 2026-09-21. The visible top of the niche is unchanged in kind since the 2026-09-05
market measurement: paid independents and paid mid-size vendors — Appfire's _Time to SLA_, SaaSJet's
_SLA Time and Report for Jira_, Almarise's _SLA PowerBox_ (the app this listing is priced against),
plus smaller paid entries (_SLA Management_, _SLA Time Management_, SLA dashboard gadgets). No
Atlassian first-party app and no permanently-free app at the top of the niche was found — unlike
the time-in-status niche, where the install leader is free.

Sources, all retrieved 2026-09-21:

- [Time to SLA — Appfire, Atlassian Marketplace](https://marketplace.atlassian.com/apps/1211843/time-to-sla) (paid)
- [SLA Time and Report for Jira — SaaSJet, Atlassian Marketplace](https://marketplace.atlassian.com/apps/1220741/sla-time-and-report-for-jira) (paid)
- [SLA PowerBox — Almarise, Atlassian Marketplace](https://marketplace.atlassian.com/apps/1215330/sla-powerbox-on-time-service-delivery) (paid; the pricing anchor in `pricing.ts`)
- [SLA Management — Atlassian Marketplace](https://marketplace.atlassian.com/apps/1233885/sla-management) (paid)

### Conclusion: **GO**

Neither kill-condition holds as of 2026-09-21. The gap this listing sells into — no SLA feature in
plain Jira outside Jira Service Management — is still real, still documented by Atlassian itself,
and still being filled only by paid apps. Caveat carried forward from `PRODUCT-SPEC.md` § 11:
either condition can change in one Atlassian release, so these two checks must be re-run on the
actual submission day if it is not 2026-09-21.

---

## Title

```
SLA & Due Date Breach Reports for Jira
```

Matches `SLA_BREACH_PRICING.listingName` in `packages/engine/src/config/pricing.ts` plus the
platform qualifier. Under the Marketplace's list-view truncation length. Every word is a keyword a
buyer searches for — `SLA`, `due date`, `breach`, `reports` — and none is an adjective.

## Tagline (search results, one line)

```
SLA as working time in the statuses you count, measured against a target — plus plain due-date breaches.
```

The tagline _is_ the model statement. This listing's measurement is not Jira Service Management's
start/stop/pause timer, and burying that difference is the buyer-churn failure `ROADMAP.md` stage 4
warns about — so it goes in the one line every searcher reads, not in a footnote they find after
installing.

## Description

Paste as six sections, in order. Headings included for editing; the Marketplace form may want them
as plain paragraph breaks — check the form before pasting.

---

### The gap

Plain Jira has no SLA feature. SLA goals — time to first response, time to resolution — belong to
**Jira Service Management**; a Jira Software or Business project gets nothing, and most such teams
fall back to tracking a bare due date by eye. This app gives those projects two reports from data
Jira already holds: **working time spent against a target**, and **plain due-date breaches** —
resolved after the due date, or still open past it.

### The model, stated plainly — read this before comparing numbers

This app measures an SLA as **cumulative working time the issue has spent in the counted
statuses**, on the project's working calendar, against a target. **It is not a start/stop/pause
timer.** Jira Service Management's SLA clock starts on one event, stops on another and pauses in
between; a counted-statuses figure and a timer figure can legitimately differ on the same issue.
We state this here, and the report itself repeats it in a footnote under the table, because a
metrics product that lets you misread its central number is worse than no product. If you need
JSM-style timer semantics on a project-wide report, this app is the wrong tool — knowing that
before you install is the point of this section.

### What you get

- **Pick the goal on the page** — which statuses count and the working-time target (preset spans
  from 4 to 80 working hours), chosen with status toggle chips. Leave every chip off and every
  status counts. The exported CSV is measured against exactly the goal on screen.
- **Save a goal and name it**, so everyone on the project opens the same report measured the same
  way rather than each rebuilding it from chips. Up to twenty per project. A saved goal is resolved
  by name on the server, never rebuilt from what the browser sent — the table cannot be headed with
  one goal and computed from another. Edit any part of a saved goal and the page says plainly that
  the selection on screen is no longer that goal.
- **A chart of how close each issue is to its target** — banded under 50%, 50–80%, 80–100% and
  breached. The 80–100% band is the one to act on, and a breached/not-breached pair cannot show it.
- **An admin storage page** — the rows and megabytes this app holds in your tenant.
- **Per-issue consumed / target / remaining working time** — sorted worst-first, so the issues
  that have consumed the most of their target are at the top.
- **Overrun stated in words** — a breached issue reads "over by 22h", never a negative duration
  you have to interpret.
- **Breached / within-target status on every row**, with a breach count and an **attainment
  percentage** in the summary tiles.
- **Plain due-date breach tracking** — resolved after the due date, or still open past it, with
  the lateness spelled out ("late by 2d 4h"). Most non-JSM projects track only this, and it needs
  no SLA model at all.
- **Working time, not wall-clock** — durations are computed on a working calendar with correct
  timezone and DST arithmetic (the calendar maths is covered by hand-computed golden tests).
  Due-date lateness is deliberately the exception: lateness against a calendar date is elapsed
  time, where a day means a day.
- **CSV export** — one click opens the full CSV with its filename, ready to select and copy into
  whatever spreadsheet you already use.
- **A dashboard gadget** with the summary tiles — each gadget picks its own project, so the
  numbers reach people who never installed anything.
- **An honest indexing banner** — visible for as long as the numbers are built from partial
  history, never silently hidden.

### What it does not do

No notifications, no escalation rules, no calendars per goal — a saved goal is one target and one
set of counted statuses, deliberately. No integration with
Jira Service Management's SLA fields — if you have JSM, use JSM's SLAs. No predictive analytics.
It does one report, properly, rather than many reports adequately — and it tells you its
measurement model up front instead of letting you discover it after a quarter of wrong numbers.

### How it works

Reads issue changelogs through Jira's own REST API. Aggregates are stored inside **your**
Atlassian tenant via Forge SQL — nothing leaves it, nothing is sent to a third party, and the app
requests no write scope. Every report is checked against **your own** Jira permissions before it
returns anything, not the app's.

### Pricing

Free for teams up to 10 users — the whole product, not a limited trial. Above that, $7.00/user to
100 seats, $3.50 to 500, $1.75 beyond:

| Seats       | 10       | 50       | 100      | 500        |
| ----------- | -------- | -------- | -------- | ---------- |
| **Monthly** | **Free** | **$350** | **$700** | **$2,100** |

Per `SLA_BREACH_PRICING` in `packages/engine/src/config/pricing.ts` — note this ladder is
**steeper than listing 1's** ($7.00 vs $6.50/user), positioned against Almarise SLA PowerBox at
$450/50 users. Do not copy listing 1's dollar figures into this listing's pricing form.

---

## Privacy and security

Paste into the Marketplace's privacy and security statement field, not the description. Every line
is backed by a manifest test or a stated design decision — see `PRODUCT-SPEC.md` § 9 and
`TECHNICAL-SPEC.md` § 8 and § 11 item 6.

- **No customer data leaves your Atlassian tenant.** Every aggregate is stored in Forge SQL, inside
  your own installation — nothing is sent to a third party, nothing is logged externally, no
  telemetry.
- **Read-only.** The app requests no Jira write scope. Scopes used: `read:jira-work`,
  `read:jira-user`, `storage:app` — nothing else, asserted by a test against the manifest.
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

| #   | Heading (≤60 chars)                         | Summary (≤180 chars)                                                                                                                                     | Shot |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | The measurement model is on the page        | Working time in the statuses you choose to count, against a target you can see and change without leaving the report. No hidden timer, nothing to infer. | 1    |
| 2   | Save a goal and name it, twenty per project | Everyone on the project then opens the same report measured the same way, instead of each person rebuilding it from chips every time.                    | 3    |
| 3   | Working-time target and due date, together  | An issue can sit inside its target and still be weeks late against its due date. The table answers both questions on the same row.                       | 4    |

**Gap this surfaced.** The screenshot list below predates the goal editor and has **no shot of it**,
even though the editor is what highlight 2 is about; shot 3 only carries the goal's _name_, in the
Attainment tile's hint. A goal-editor frame is already captured —
`listing-assets-sla-breach/candidates-2026-09-24/01-goal-editor.png` — and should be added to the
list below as its own shot before this highlight is pasted.

## Screenshots — 6 planned, in this order — **all pending capture**

Nothing here is finalized. Capture against the deployed development install on the seeded dev site
(`sergiip180.atlassian.net`; `JFMB` is the bulk-seeded project with 181+ issues, `JFM` the
hand-checked one). Cropped, chrome-free PNGs, no personal names, no browser bookmarks; per
`PROMOTION.md` § 9 the shipped screenshots must come from Forge inside real Jira, not from the
`ui:screens` harness. **Prerequisite for #4 and the due-date column generally:** some seeded issues
must carry due dates (past-due open, past-due resolved, and on-time cases) — verify
`tools/seed-bulk.mjs` sets `duedate` before capturing, and seed a handful by hand if it does not.

| #   | Shows                                                                    | Caption (draft)                                                                               | Capture instructions                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Report table: consumed / target / remaining, one row reading "over by …" | "Overrun in words — 'over by 22h', never a negative duration."                                | **pending** — project page **SLA & Due Dates** on `JFMB`. Full table header row (Issue, Working time used, Target, Remaining, Status, Due date) plus 5-8 data rows: at least one "Breached" row whose Remaining cell reads `over by …` and at least one "Within target" row, worst-first order visible.     |
| 2   | The model footnote under the table                                       | "The measurement model, stated on the report itself — counted statuses, not a hidden timer."  | **pending** — same page, cropped to the table's footer: the footnote naming the goal and the line "This is a counted-statuses goal, not a start/stop/pause timer…". This screenshot is the listing's honesty argument; do not crop the footnote mid-sentence.                                               |
| 3   | Summary tiles: Attainment %, Breached count, Late against due date       | "Attainment, breaches and due-date lateness — the three numbers for your next review."        | **pending** — same page, cropped to the page heading + tile row alone (the listing-1 #4 crop, `04-summary-tiles.png`, is the framing reference). Attainment must show a real percentage, not `—`, so capture only after indexing completes.                                                                 |
| 4   | Due date column with "late by …" and "(on time)" values                  | "Plain due-date breaches — resolved late, or still open past due — with the lateness stated." | **pending** — same table, cropped to the Issue + Due date columns. Needs rows showing all three states: `… (late by 2d 4h)`, `… (on time)`, and `—` for an issue without a due date. Requires the seeded due dates named in the prerequisite above.                                                         |
| 5   | The dashboard gadget on a real dashboard                                 | "SLA attainment where your team already looks — no per-user install."                         | **pending** — add the **SLA breaches** gadget to the production-style "Engineering Team Dashboard" used for listing 1's #5, configure it to `JFMB` via its own project picker, capture the rendered tiles with real numbers. No development badge, no empty state, no "Indexing is still in progress" line. |
| 6   | CSV export modal — filename and full CSV text ready to select and copy   | "Copied in one click — paste it into whatever spreadsheet you already use."                   | **pending** — click **Export CSV** on the project page; capture the modal with the filename and several visible CSV rows. The caption describes the real copy flow (`TECHNICAL-SPEC.md` § 11 item 8) — it is a copyable modal, **not** a download, and neither caption nor image may imply one.             |

Alt text: describe what the screenshot proves, not what it contains — e.g. "Report row for issue
JFMB-42 showing 30h of working time against a 24h target, with the remaining column reading 'over
by 6h' in words" rather than "A table."

## Keyword placement checklist

`SLA` · `SLA report` · `SLA tracking` · `service level agreement` · `due date` · `breach` ·
`time to resolution` · `working time`

- [x] Title carries `SLA`, `Due Date`, `Breach`, `Reports`
- [x] Tagline carries the model claim without keyword stuffing
- [x] First paragraph ("The gap") carries `SLA`, `Jira Service Management`, `due date`
- [x] Model section carries `time to resolution` semantics honestly (as what JSM measures, not a claim this app makes)
- [ ] Screenshot captions — add 1-2 more keyword terms once final captions are set
