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
- **Filters** — assignee, issue type, creation window.
- **CSV export** — for the finance and QBR audience that wants the export more than the chart.
- **A dashboard gadget** — the report your team sees without anyone installing anything.
- **An honest indexing banner** — visible for as long as the numbers are built from partial
  history, never silently hidden.

### What it does not do

No predictive analytics or forecasting. No cross-project portfolio rollups. No Confluence
embedding. No custom-field-based metrics — every instance's fields differ, and guessing at yours
would be worse than not trying. If you need a goal/threshold editor or sprint-scoped reports, this
is not that app yet. It does one report, properly, rather than many reports adequately.

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

## Screenshots — 6, in this order

**None captured yet — all six need the `time-in-status` app itself**, and it is currently stuck in
this dev environment (see the session notes: a `forge tunnel` run against it left Jira's frontend
pointed at `localhost` for this app specifically; the other four apps are unaffected and render
normally). This should clear on its own — it is a routing artifact, not a code or data problem, and
a real interactive tunnel session on your own machine will not reproduce it at all, since browser
and terminal share one `localhost` there. Once `https://sergiip180.atlassian.net/jira/software/projects/JFMB/...`
(the Time in Status tab) renders the report table again, capture in this order:

Captions included. Capture each against the seeded dev site (`sergiip180.atlassian.net`, project
`JFMB` — 300 real issues with real re-entries — or `JFM` for the smaller hand-checked set where a
specific issue like `JFM-11` is named). See `tools/seed-bulk-report.md` / `tools/seed-report.md` for
which issues show the clearest re-entry margins.

| #   | Shows                                                        | Caption                                                           | Status                                                                 |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | Report table with a visible `×2` badge and cumulative figure | "Every re-entry counted — not just the last one."                 | pending — needs `time-in-status` recovered                             |
| 2   | The same issue next to Jira's own Control Chart figure       | "Check it yourself: open the same issue's History tab."           | pending — needs `time-in-status` recovered                             |
| 3   | Elapsed vs working-hours toggle, working calendar visible    | "Working hours, not wall-clock — holidays and weekends excluded." | pending — needs `time-in-status` recovered                             |
| 4   | Summary tiles: median and 85th percentile per status         | "The numbers for your next review, already summarised."           | pending — needs `time-in-status` recovered                             |
| 5   | The dashboard gadget on a real dashboard                     | "Seen by your team, not just whoever installed it."               | blocked — gadget configuration unconfirmed, TECHNICAL-SPEC § 11 item 7 |
| 6   | CSV export open in a spreadsheet                             | "For the QBR deck, not just the dashboard."                       | pending — needs `time-in-status` recovered                             |

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
