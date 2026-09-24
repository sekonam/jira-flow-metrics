# Documentation

<!--
DRAFT — not published. Placeholders in [BRACKETS] must be filled by the human
before this page goes anywhere. Drafted 2026-09-24. This is the page
docs/SUBMISSION-CHECKLIST.md § 2B item 10 requires ("live before submission;
reviewers open it" — PROMOTION.md:229) and the page [DOCS URL] in
support.md points at.

Every number below was read out of the code at commit c9bd8c7, and each
carries an HTML comment naming where. If a number changes, this page is
wrong until it is edited — treat it as part of the change, not as
documentation that drifts.
-->

Documentation for the Jira Cloud apps published by [VENDOR NAME]:

- **Time in Status & Cycle Time Reports** — cumulative time per status, across
  every re-entry
- **Worklog Reports & Time Tracking** — logged hours totalled per person
- **WIP Aging Reports & Charts** — how long each unfinished issue has sat
  where it is
- **SLA & Due Date Breach Reports** — working time against a target you choose
- **Issue History & Audit Log Reports** — every field change in a project, in
  one table

They are separate listings and install independently. They share one
measurement engine, so the sections below marked **shared** apply to all five.

---

## Installing, and the first run — shared

After install, each app adds a tab to the project (and, for Time in Status, a
tab on the issue view). The first time a project page is opened, the app
starts **indexing**: it reads each issue's changelog from Jira and stores the
status transitions it finds.

<!-- Modules: apps/*/manifest.yml — jira:projectPage, jira:adminPage,
     jira:dashboardGadget, plus jira:issueActivity on time-in-status. -->

While that runs, a banner says so, and the numbers under it cover only what
has been indexed so far. **The banner stays visible for as long as that is
true.** It is not a loading spinner that disappears optimistically — if the
figures are built from partial history, the page says so.

<!-- docs/PRODUCT-SPEC.md § 9 "Honesty requirements" items 1-2. -->

The first index covers the **last 12 months**. You can widen it later from
**Extend history** on any report page: 12, 24, 36, 60 or 120 months.

<!-- HISTORY_WINDOW_MONTHS = [12, 24, 36, 60, 120],
     packages/forge-runtime/src/handlers.ts:472. -->

Widening **re-indexes the project from the beginning** — every issue in the
new range is read from Jira again, and the stored rows are replaced rather
than added to. Reports stay readable while it runs. Figures cannot change
except by covering more history.

### If indexing stops

A banner reading **"Indexing failed"** with a **Retry indexing** button means
the backfill hit an error and stopped where it was; the count in the banner is
how many issues it had reached. Retry is safe and idempotent — it re-walks
from the start and replaces rows rather than duplicating them.

---

## What the numbers mean — shared

### Time in a status is measured from the changelog, not from the issue's fields

Every figure comes from Jira's own changelog: the moments an issue entered and
left each status. Nothing is inferred from `created`, `updated` or a
resolution date.

### Re-entries are counted

If an issue goes To Do → In Progress → To Do → In Progress, that is **two
visits** to In Progress, and the reported time in In Progress is the **sum of
both**. Jira's built-in control chart reports only the most recent stay. This
is the single difference the Time in Status listing is built on, and the
`×2` badge next to a figure is how many visits it is adding up.

### Elapsed vs working hours

Every figure can be read two ways, switched with one toggle on the page:

- **Elapsed** — wall-clock time.
- **Working hours** — time inside the project's working calendar only.

The working calendar is a real calendar, not a 9-to-5 assumption: timezone,
weekly pattern, holidays and split shifts. Both bases are computed from the
same timeline; switching recomputes every tile, chart and row.

### An unfinished issue's clock is still running

Where an issue is still sitting in a status, the figure grows between two
readings. Rows like that are marked, and comparisons against a screenshot
taken an hour earlier will differ by an hour. That is correct.

---

## Per app

### Time in Status & Cycle Time

On the project page: median and 85th-percentile tiles per status, a
median-time-per-status chart, and a table of issues with cumulative time per
status and a visit count per status.

**Filters** — assignee, issue type, and a created-from / created-to window.
The filters narrow the table _and_ the CSV export, so an export always matches
the report that produced it.

<!-- ReportFilters + filtersToRequest, packages/ui/src/components.tsx; applied
     to both getReport and exportCsv at
     apps/time-in-status/src/frontend/index.tsx:115-117. -->

On the issue view, a **Time in Status** tab sits beside Jira's own History:
every visit in order with its own duration, and the totals per status
underneath. It is the fastest way to check any figure the report gives you.

### Worklog Reports & Time Tracking

Logged hours totalled **per person**, with a chart above the table.

A worklog in Jira is a stated duration attached to a stated instant. This
report **adds those durations up**. It never re-derives a duration from
timestamps and never fills a gap — if nobody logged it, it is not counted.
That is why the total is checkable, entry by entry, against any issue's own
work log panel.

Worklogs the app cannot attribute to a person, and worklogs restricted to a
group the viewer is not in, are **dropped rather than counted as zero**. The
app does not report how many were dropped.

The report reads up to **10,000 worklog entries**.

<!-- packages/forge-runtime/src/reports.ts:71 — limit: request.limit ?? 10_000. -->

### WIP Aging Reports & Charts

Every unfinished issue, **oldest first**, with the moment it entered the
status it is in — so any row can be checked against that issue's History tab.

- **Age distribution** — six buckets: `0-1d`, `1-3d`, `3-7d`, `7-14d`,
  `14-30d`, `30d+`. All six are always drawn. An empty bucket is a fact the
  chart states, not a gap it hides.
- **Cumulative flow** — one line per status, one point per day, **30 days**
  back. Built from recorded visits, so it says where each issue actually was
  on a past Tuesday rather than inferring it from today's state. When the data
  to draw it honestly is not there, the chart is **withheld rather than drawn
  flat**.
- **Summary tiles** — issues in flight, the oldest item with the status it is
  stuck in, and how many have not moved in a fortnight.

Finished issues are excluded throughout: ageing applies to work in flight.

<!-- AGING_BUCKETS, packages/forge-runtime/src/reports.ts:188-195; flow days
     default 30, packages/forge-runtime/src/runtime.ts:326; withheld rather
     than flat, apps/wip-aging/src/frontend/index.tsx:230. -->

### SLA & Due Date Breach Reports

**Read this before reading the numbers.** This is not Jira Service
Management's SLA. There is no start/stop/pause timer. The model is:

> **working time spent in the statuses you choose to count**, measured against
> a target.

Both halves are controls on the page. The target is one of **4, 8, 16, 24, 40
or 80 working hours**; the counted statuses are toggle chips, and selecting
none means every status counts.

A goal can be **saved and named**, so everyone on the project opens the same
report measured the same way. Up to **20 saved goals per project**. A saved
goal is resolved on the server by its id, not by the numbers the browser sent.

<!-- SLA_TARGET_OPTIONS, packages/ui/src/listing-models.ts:240-247;
     MAX_SLA_GOALS = 20, packages/forge-runtime/src/settings.ts:55, enforced
     at packages/forge-runtime/src/runtime.ts:443. -->

A saved goal names the counted statuses and the target and **nothing else** —
no per-goal calendar, no per-goal notification, and no goal that varies by
issue type or priority.

The **Due date** column is a separate, plainer question, answered on the same
row: was this issue resolved after its due date, or is it still open past it?
An issue can sit comfortably inside its working-time target and be weeks late
against its due date. The table says both, because they are different
failures.

### Issue History & Audit Log Reports

Every field change across the whole project in one table: **When (UTC) ·
Issue · Field · From · To · By**, with a chart ranking which fields churn
most, and a CSV export of exactly what is on screen.

Jira's own History tab answers this one issue at a time and cannot be
exported. This is the cross-issue view.

There are **no filter controls** on this page.

---

## Limits, and what happens at them — shared

The apps are deliberate about saying when a figure is a lower bound.

| Report                          | Reads up to    | What you see at the limit                                  |
| ------------------------------- | -------------- | ---------------------------------------------------------- |
| WIP aging, cumulative flow, SLA | 500 issues     | A banner saying how many are shown and that there are more |
| Issue history                   | 500 changes    | "Report capped at 500 of N changes"                        |
| Worklog                         | 10,000 entries | A cap banner, if it is ever reached                        |
| Stored rows per aggregate query | 10,000 rows    | A cap banner on the affected figures                       |

<!-- 500: packages/forge-runtime/src/runtime.ts:312, :326, :332 and
     reports.ts:441. 10,000: reports.ts:71 and STORE_MAX_ROWS,
     packages/engine/src/store/types.ts:206; AGGREGATE_ROW_CAP is
     STORE_MAX_ROWS - 1 so the truncation probe survives clamping. -->

When a cap is reached, **every figure on that page is a lower bound**, and the
banner says so in those words rather than presenting the visible total as if
it were the whole. Narrowing the filters or the date range covers the
remainder.

---

## CSV export — shared

**Export CSV** opens a modal containing the CSV text, ready to select and
copy. **It is not a download.** A Jira app renders inside a sandboxed frame
that cannot hand a file to the browser; rather than pretend otherwise, the app
shows you the text and says why.

The export always matches the report on screen — the same basis, the same
filters, the same rows.

---

## Dashboard gadgets — shared

Each app ships a gadget that shows its **summary tiles** — no chart, no table.
Add it from the dashboard's **Add gadget**, then **Configure** to pick the
project. If the project is still indexing, the gadget says so, exactly as the
project page does.

---

## Admin storage page — shared

Each app adds a page under **Jira administration → Apps** showing how many
rows and roughly how many megabytes it holds in your tenant.

The figure is **instance-wide, and estimated rather than measured**. Forge SQL
is provisioned per installation, so "how much is this app holding" has no
per-project answer — which is why the page is an admin page and nowhere else.

---

## Troubleshooting

**The app's number disagrees with Jira's control chart.** Expected, when the
issue re-entered the status: Jira reports the most recent stay, the app
reports the sum of all of them. Open the issue's History tab (or, for Time in
Status, the app's own tab on the issue) and add the visits up.

**A figure looks too low.** Check for the indexing banner and for a cap
banner. Both mean the same thing said two ways: this page is a lower bound.

**"Indexing failed".** Click **Retry indexing**. If it fails repeatedly, send
the project key and the count in the banner to [SUPPORT EMAIL] — the app logs
the cause on the Atlassian side and the developer can read it from there.

**A row is badged "partial history".** That issue's changelog reaches further
back than the indexed window. Widen the window with **Extend history**.

**Nothing at all renders.** Reload the page once; Jira's own frame sometimes
loses the app on a slow first load.

---

## What these apps do not do

Stated here rather than discovered after purchase. Each listing's "What it
does not do" section is the authoritative version; in summary, across all
five: no notifications or escalation rules, no forecasting or predictive
analytics, no cross-project rollups, no writing back to Jira, and no data
leaving your Atlassian tenant.

<!-- Each LISTING-COPY-*.md "What it does not do"; the no-egress claim is the
     same one privacy-policy.md § "Where the data lives, and what leaves"
     makes and backs. -->

---

## Support and privacy

- Support: [SUPPORT URL] · [SUPPORT EMAIL]
- Privacy policy: [PRIVACY POLICY URL]
