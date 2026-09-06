# PRODUCT-SPEC — jira-flow-metrics

> **What this document is for.** Five Marketplace listings over one engine, each scoped to the
> smallest thing that is genuinely sellable. Every "out of scope" line below is a deliberate
> decision to spend the time somewhere else, not an oversight.

**Status of the numbers in this file.** Competitor installs, ratings and prices were measured
from the Atlassian Marketplace REST API on **2026-09-05**. Every _revenue_ figure rests on an
**assumed 25% paying share that Atlassian does not publish**. Where a figure is modelled it says
so. Nothing in this file has been validated against a real customer.

---

## 1. The product in one paragraph

Jira does not report cumulative time in status. Its **Control Chart shows only the most recent
period an issue spent in a status** — if an issue re-enters a status, the earlier periods are not
summed — and **Atlassian Analytics' "Time in current status" template is gated behind
Premium/Enterprise**. This product reads issue changelogs and worklogs, reconstructs each issue's
status timeline, and reports the durations that Jira itself cannot. One engine does that work;
five separate Marketplace listings sell five different questions asked of it.

**The multi-listing structure is the distribution strategy, not a product decision.** 70% of
Atlassian vendors ship one listing and 96% of those earn under $1k/month; vendors with 4+ listings
clear it 56-65% of the time. Broken Build proves the exact pattern inside this exact niche: *Time
in Status* (863 installs, $350) and _WIP Aging & Run Charts_ (675, $275) off one codebase.

---

## 2. The honest competitive position

**There is no product wedge, and the specs below do not pretend otherwise.**

| App                          | Vendor       | Installs   | Rating (n)     | @50 users |
| ---------------------------- | ------------ | ---------- | -------------- | --------- |
| Status Time Reports **FREE** | Bloompeak    | **10,579** | 4.74 (58)      | **free**  |
| Custom Charts                | Tempo        | 8,182      | 4.49 (139)     | $1,515    |
| Time in Status               | SaaSJet      | 5,374      | 4.54 (208)     | $575      |
| Timepiece                    | OBSS         | 4,521      | **4.79 (269)** | $600      |
| Great Gadgets                | StonikByte   | 3,685      | 4.44 (49)      | $600      |
| Time in Status / Cycle Time  | Broken Build | 863        | 5.00 (5)       | $350      |

Three facts follow, and all three shape the specs:

1. **The install leader is free.** Anyone entering must answer "why not the free one?". The answer
   this product gives is _scope and price_, not features — and the free tier at ≤10 users is
   mandatory because that is how evaluation happens in this niche.
2. **Nobody is unhappy.** 4.54-4.79 stars across 200+ reviews on the leaders, all shipping monthly
   releases. There is no dissatisfaction to exploit. **Marketing copy must never claim superiority
   over these apps**, because it would be false and the reviews say so.
3. **Small independents do succeed here.** Broken Build, Agilis and votazz all operate profitably
   at the scale this project is attempting.

**The one capability worth naming in the listing copy is factual and checkable:** cumulative time
across status re-entries, which Jira's own Control Chart does not report. The UI shows the
re-entry count next to every duration so a buyer can verify the claim on their own data in a
minute.

---

## 3. Scope principle: what earns a place in v1

A feature ships in v1 only if it passes both tests:

- **Recurring** — the user meets it every time they do the work, not once at setup.
- **Visible in output** — the result appears in something they show someone else.

That pair is the sharpest discriminator available and it is free to apply. It is why CSV export
ships in v1 and a goal editor does not; why a dashboard gadget ships and a settings-import screen
does not.

The second principle is **correctness over surface area**. A metrics product that is quietly wrong
is worth less than no product, so the working-hours arithmetic is covered by hand-computed golden
tests before any feature was added on top of it.

---

## 4. Listing 1 — Time in Status & Cycle Time ★ the flagship

The only listing that must be complete and shippable. The other four exist to prove the engine
reuses; this one exists to answer the day-90 question.

### In scope for v1

| Capability                                                                          | Why it earns its place                                                                                   |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Cumulative time per status, per issue, across every re-entry**                    | The gap the niche sells into. Recurring, visible.                                                        |
| **Visit count per status** (the `x2` badge)                                         | Makes the cumulative claim checkable on the user's own data.                                             |
| **Elapsed vs working-hours basis, switchable**                                      | Every competitor has it; a report without it is not comparable.                                          |
| **Working calendar per project** — timezone, weekly pattern, holidays, split shifts | The recurring hard part. Covered by golden tests.                                                        |
| **Cycle time, lead time, flow efficiency, reopen count**                            | One extra keyword-bearing capability at near-zero engineering cost; the engine already has the timeline. |
| **Median and 85th-percentile summary tiles**                                        | Cycle-time distributions are right-skewed; a mean alone misleads.                                        |
| **Filters**: assignee, issue type, creation window                                  | The minimum a report needs to be usable in a review meeting.                                             |
| **CSV export**                                                                      | Finance and QBR users want the export more than the chart. Cheapest feature in the product.              |
| **Dashboard gadget** with the summary tiles                                         | The only organic distribution inside a customer: people who did not install the app see it.              |
| **Indexing progress banner, always shown while incomplete**                         | Non-negotiable. A report over half the history must say so.                                              |

### Explicitly out of scope for v1

| Not shipping                                   | Why                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| Predictive analytics, forecasting, Monte Carlo | Sells against Tempo and Appfire on breadth. Losing position.                         |
| Cross-project portfolio rollups                | A different buyer (a PMO), a different price point, a different listing.             |
| Confluence embedding                           | A second platform's review cycle for one feature.                                    |
| Custom-field-based duration metrics            | Unbounded scope; every instance's fields differ.                                     |
| A goal/threshold editor                        | Belongs to listing 4, and even there v1 ships view-level goals only.                 |
| Sprint/board-scoped reports                    | Board APIs are a separate surface with their own rate limits. Revisit after day 90.  |
| Charting beyond the gadget tiles               | UI Kit ships charts; using them well is a week. It is a v1.1 item, not a v1 blocker. |

### Pricing ladder — listing 1

Free at ≤10 users (mandatory). Above that, $6.50/user to 100 seats, halving twice.

| Seats           | 10     | 50       | 100      | 500        |
| --------------- | ------ | -------- | -------- | ---------- |
| **Monthly USD** | **$0** | **$325** | **$650** | **$1,950** |

Positioned against **SaaSJet at $575** and OBSS at $600. **It is not the cheapest**: votazz sells
at $150 and Bloompeak's free edition is free. The pricing config records both the incumbent
undercut and the cheapest competitor, precisely so no one later writes "the most affordable
option" into the listing copy.

At $325 and the assumed 25% paying share, **$1,000 MRR is roughly 150 installs**.

---

## 5. Listing 2 — Worklog Reports & Time Tracking

The flattest competition measured in any Atlassian niche: seven independents between $6k and
$29k/month modelled, none dominant, only one free app in the top ten.

### In scope

- Logged time grouped by **person, issue, project, day, ISO week or month**.
- Date-range window, author filter.
- Share-of-total column, entry count, distinct-issue count.
- CSV export; dashboard gadget with total and largest contributor.

**A worklog is a stated duration attached to a stated instant.** The report never re-derives a
duration from timestamps — the user typed "3h" and that is the number they expect totalled. Entries
Jira returns without a `timeSpentSeconds` are **dropped and counted**, never treated as zero.

### Out of scope

Timers, worklog editing, approval workflows, billing rates, invoicing. All of those make this a
time-tracking product competing with Tempo rather than a reporting app.

### Pricing

Free at ≤10 users; $5.00/user to 100 seats. **10 → $0 · 50 → $250 · 100 → $500 · 500 → $1,500.**

⚠️ **This listing is not the cheapest in its niche and the copy must not imply it is.** HeroCoders
Clockwork Lite (7,030 installs) and SolDevelo Worklogs (5,390) both sell at $200/50 users, below
this price. It is positioned against Decadis sumUp at $375.

---

## 6. Listing 3 — WIP Aging & Run Charts

Broken Build's second listing, in the same niche, at the same scale. The clearest evidence that a
second listing off one engine works.

### In scope

- Age of every **unfinished** issue in its current status, oldest first.
- Age buckets (0-1d, 1-3d, 3-7d, 7-14d, 14-30d, 30d+) as a histogram.
- Total age since creation; count of work older than 14 days.
- CSV export; dashboard gadget.

**Stated limitation, shown in the UI:** age-in-status is elapsed time. The stored working-hours
figure covers the _completed_ portion of the current visit, so it is displayed separately rather
than blended into a single number that would be subtly wrong.

### Out of scope

Aging by assignee or swimlane, board-scoped aging, cumulative flow diagrams, forecasting. A CFD is
a genuinely good v1.1 candidate; it is not a v1 blocker.

### Pricing

Free at ≤10 users; $5.50/user. **10 → $0 · 50 → $275 · 100 → $550 · 500 → $1,650.** Matched to
Broken Build's $275.

---

## 7. Listing 4 — SLA & Due Date Breach Reports

### In scope

- **Counted-statuses goal**: cumulative working time in a chosen set of statuses, measured against
  a target on the project's working calendar.
- Per-issue consumed / target / remaining, with overrun stated in words ("over by 22h") rather
  than as a negative duration.
- Attainment percentage; breach count.
- **Plain due-date breach** — resolved after the due date, or still open past it. Most non-JSM
  projects track only this.
- CSV export; dashboard gadget.

### ★ The model difference, stated rather than blurred

The engine implements **two** SLA models and they give different answers:

| Model                                          | Where used              | What it measures                                                                                                                                            |
| ---------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Counted statuses**                           | The project-wide report | Cumulative working time in the counted statuses. Exactly computable from the stored aggregate, so it works over a whole project without re-reading history. |
| **Start / stop / pause timer** (`evaluateSla`) | Single-issue surfaces   | Starts on entering a start status, stops on a stop status, excludes paused statuses. Strictly more expressive, needs the issue's full timeline.             |

Both are documented in the UI footnote and on the listing page. Conflating them would be the sort
of quiet difference that makes a metrics product untrustworthy, which is the one thing this product
cannot afford.

### Out of scope

Goal editing and storage, notifications, escalation rules, JSM SLA field integration, calendars
per goal. v1 ships **view-level goals** — you pick the statuses and the target on the page.

### Pricing

Free at ≤10 users; $7.00/user. **10 → $0 · 50 → $350 · 100 → $700 · 500 → $2,100.** Positioned
against Almarise SLA PowerBox at $450.

---

## 8. Listing 5 — Issue History & Audit Log

Niche leader: SaaSJet Issue History, 3,128 installs at $750/50 users.

### In scope

- Every field change across every issue in a project, flattened to one row per change.
- Filters: field, author, date window, value substring, issue key.
- "Which fields churn most" summary.
- CSV export; dashboard gadget.

**The gap this fills:** Jira's own History tab is per-issue, unfiltered, unexportable and paginated.
Cross-issue, filtered, exportable history is the whole product.

### Out of scope

Comment history, attachment history, permission/config auditing (that is the Jira audit log, a
different product), restore/undo of any kind.

### Pricing

Free at ≤10 users; $7.50/user. **10 → $0 · 50 → $375 · 100 → $750 · 500 → $2,250.** Half the
leader's price.

---

## 9. Cross-cutting requirements

### Data and privacy

- **No customer data leaves the Atlassian tenant.** Everything is Forge SQL inside the installation.
- **Read-only.** No Jira write scope is requested by any listing; a manifest test asserts it.
- Scopes are `read:jira-work`, `read:jira-user`, `storage:app` and nothing else.
- Error messages shown to users never carry Jira response bodies, and JQL is redacted before any
  log line — issue summaries can contain anything.
- CSV cells beginning `=`, `+`, `-`, `@`, tab or CR are prefixed with a quote, so an issue summary
  cannot execute as a formula in Excel.

### Accessibility

WCAG 2.1 AA on the app's own UI. Achieved by using Atlassian Design System components through
`@forge/react` rather than a bespoke design language, plus: every duration has a text label (never
colour alone), the re-entry badge carries its count as text, and every table cell that means "no
data" renders an em dash rather than an empty cell.

### The four states

Every data surface designs **loading, error, empty and ready** explicitly. The chooser is a tested
pure function; there is no path where the page renders nothing and says nothing.

### Honesty requirements (these are product requirements, not niceties)

1. While indexing is incomplete, **the banner stays visible** and says the numbers cover only what
   has been indexed.
2. An issue whose changelog was truncated is badged **"partial history"** and its totals are
   described as a lower bound.
3. Where the app estimates rather than measures — storage size, Forge cost — the word "estimated"
   appears next to the number.
4. A duration under a minute reads `<1m`, never `0m`. A status the issue was never in reads `—`,
   never `0m`. These are different facts.

---

## 10. Portfolio economics, with the assumption stated

Modelled month-12 revenue. **`payingShare = 25%` is an assumption Atlassian does not let anyone
verify**; the sensitivity row is the honest part of this table.

| Listing           | @50u | Pessimistic | Realistic    | Optimistic   |
| ----------------- | ---- | ----------- | ------------ | ------------ |
| ① Time in Status  | $325 | 40 → $271   | 150 → $1,016 | 400 → $2,708 |
| ② Worklog reports | $250 | 40 → $208   | 150 → $781   | 400 → $2,083 |
| ③ WIP aging       | $275 | 25 → $143   | 90 → $516    | 250 → $1,432 |
| ④ SLA breach      | $350 | 25 → $182   | 90 → $656    | 250 → $1,823 |
| ⑤ Issue history   | $375 | 30 → $234   | 120 → $938   | 350 → $2,734 |
| **Portfolio MRR** |      | **≈$1,038** | **≈$3,907**  | **≈$10,780** |

| Paying share            | 10%     | **25%**     | 40%     |
| ----------------------- | ------- | ----------- | ------- |
| Realistic portfolio MRR | ~$1,563 | **~$3,907** | ~$6,251 |

**Listing 1 alone is a coin flip against a $1k MRR bar. The portfolio is the thesis.** That is why
the roadmap gates listings 2-5 on listing 1's install count rather than shipping all five at once.

---

## 11. What would make this spec wrong

Recorded so the failure is recognisable early rather than rationalised away:

- **Atlassian ships cumulative time-in-status natively.** The Control Chart limitation has
  persisted for years and Atlassian's analytics push is aimed upmarket, but this is one release
  away from removing the product's only factual claim.
- **The free leader adds the same capability.** Bloompeak has 10,579 installs and nothing to lose
  by matching a $325 app.
- **The 25% paying-share assumption is wrong on the low side.** At 10% the portfolio still clears
  $1k, but only with four or five listings live — so the gate matters more than the price.
- **Installs do not arrive at all.** No audience, no paid placement, an SEO war entered at zero
  reviews. This is the risk the day-90 gate exists to price.
