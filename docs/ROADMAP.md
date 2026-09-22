# ROADMAP — jira-flow-metrics

> Staged around **one number**: how many installs listing 1 has at day 90. Everything before that
> is preparation and everything after it is contingent.

The point of a staged roadmap here is not project management. It is that **listing 1 alone is a
coin flip against a $1,000 MRR bar, and the portfolio is the thesis** — so the cheapest way to find
out whether the thesis holds is to ship one listing and read a counter, rather than to spend three
and a half months building five.

---

## Stage 0 — done (this repository)

| Delivered                                                                            | State                                                                                                     |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Monorepo, TypeScript strict, ESLint + Prettier, CI with an 80% coverage floor        | Green                                                                                                     |
| Shared duration-analytics engine                                                     | 434 tests, 98.8% statements / 90.9% branches                                                              |
| Working-calendar arithmetic with hand-computed golden tests                          | Green                                                                                                     |
| Incremental ingestion + chunked resumable backfill                                   | Green, against fixtures                                                                                   |
| Forge SQL store, Jira REST client, queue scheduler                                   | Statement- and request-level tests; **never executed on Forge**                                           |
| Five listing apps: manifests, composition roots, resolvers, UI Kit pages and gadgets | Manifests asserted by tests; **UI rendered and audited against a stand-in host renderer, never by Forge** |
| Product, technical, promotion, runbook and maintenance docs                          | This set                                                                                                  |

**Not delivered as of the state above.** All of `forge login`, `forge register`, `forge lint` and
`forge deploy` have since run — see Stage 1 below, which is no longer purely aspirational. What
genuinely cannot come from a coding session: `forge tunnel` (an interactive session watching the
UI render live), a vendor account, a Marketplace listing. See `RUNBOOK.md`.

---

## Stage 1 — make it real · target: 5-8 working days (1.1–1.5, 1.7, 1.7a and 1.8 done as of 2026-09-11)

The whole stage is about converting "written correctly" into "observed working". Nothing new is
built.

| #    | Step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Who    | Done when                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| 1.1  | Atlassian developer account, `forge login` — **done**: the CLI authenticates with the token in `.env` via `FORGE_EMAIL`/`FORGE_API_TOKEN`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1.1a | **Developer Space** — one exists (`AskMe Solutions`). An earlier note here claimed none did; that was wrong, and the cause is worth knowing: authenticating via `FORGE_EMAIL`/`FORGE_API_TOKEN` yields a session that reports "not a member of a Developer Space", while `forge login --non-interactive -u … -t …` sees it. Use `forge login`, not the env vars                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 1.2  | `forge register` — **done for all five apps.** The other four stopped at the Atlassian Developer Terms, which bind the account owner to billing above the free allowance; the account owner explicitly authorised accepting them via `--accept-terms`, so all five now carry a real app id                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 1.3  | `forge lint` — **done for `time-in-status`: "No issues found"**. It rejected two things first: the `sql` module was undeclared though the code uses Forge SQL, and `jira:dashboardGadget` requires a `thumbnail`. Both fixed in all five manifests. Two traps: `@forge/lint` `require()`s the ESM-only `archiver@8`, so it needs Node ≥ 22.12 or `NODE_OPTIONS=--experimental-require-module` (this machine is on 22.10); and `forge lint --fix` strips every comment from the manifest                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 1.3a | **CSV export button — done.** `CsvExport` in `@jfm/ui` is on all five project pages; it invokes `exportCsv` and shows the file in a modal to copy. No download: UI Kit 2 has no DOM, and `router.open` on a `data:` URI is blocked by Chrome, not by Forge. A real download needs a Custom UI surface — v1.1. `test/resolver-wiring.test.ts` now asserts the key **is** invoked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | either | Done                                                                                |
| 1.4  | `forge tunnel` against a free Jira Cloud dev site; walk the checklist in RUNBOOK § "First tunnel session" — **substantially done without a tunnel**: all five apps are deployed and installed, a real UI opened inside real Jira for the first time, a real backfill run to completion, and a real report rendered with real data ("104 field changes" on 9 issues, `issue-history`). No `forge tunnel` session has actually run — hot-reload local dev is still unverified — but the thing the tunnel checklist exists to prove (the product works inside Jira) is now observed, not assumed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 1.5  | **Done — and it differed six times, not one.** SQL: `bindParams` is variadic, not array-taking; DDL is refused through `prepare().execute()` and needs `migrationRunner`; a bound parameter inside `ORDER BY` is rejected; `LIMIT ?`/`OFFSET ?` are refused too — every paginated report crashed on first open in real Jira until these were inlined as validated integers. Async events: the manifest's `consumer: {resolver: {function, method}}` is the `@forge/events` v1.x form and silently never invokes anything under v3; `Queue.push()` takes one `{body, delayInSeconds}` argument, not two; the consumer receives `event.body`, not the event itself. Each was found live — a resolver's own JSON response intercepted from the browser, or Atlassian's docs read directly — because `forge logs` surfaced none of them                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 1.6  | Visual pass on every UI Kit component                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | either | Four states render on all five pages                                                |
| 1.7  | **Done, synthetically.** 5,200 synthetic issues through the real ingester, real store, real resolvers via `pnpm run backfill:scale` — `index_state` reaches `complete`, every row persisted and paginated back out correctly, ~4s. Chosen over seeding 5,200 real issues on the dev site, which would take hours under rate limiting for no code-path this doesn't already exercise. Found and fixed two real bugs on the way: `runPipeline`'s test-drain loop silently capped at 50 slices with no error, and — the more consequential one — `runBackfillSlice` left the cursor unchanged on any mid-page stop, so a slice landing there twice in a row (routine: the 40s time budget has nothing to do with page alignment) would reprocess the same items and stop at the identical spot forever. Fixed with a skip count encoded onto the cursor itself; see `encodeCursor` in `packages/engine/src/ingest/backfill.ts`. Real request-count/429 behaviour is still unconfirmed — that needs the live backfill a tunnel session would run                                                                                                                                                                                                                | either | `index_state` reaches `complete`; no 429 storm                                      |
| 1.7a | **Done, for real this time — and it found three more live-only bugs.** `pnpm run seed:bulk` grew a real project past 300 issues in minutes (`tools/seed-bulk.mjs`, weighted random re-entry shapes). At that volume: (1) `statusReport` defaulted its page `limit` to 50 while every sibling report defaults to 500 — a project past 50 issues rendered a report that looked complete and silently wasn't; (2) `store.migrate()` ran unconditionally on every resolver call and issue event, and a burst of real activity fired it enough times to trip Forge SQL's own `RATE_LIMIT_EXCEEDED`, not Jira's — fixed by memoising migration success per store instance; (3) a backfill that failed after indexing some issues had no retry affordance anywhere on screen — `EmptySurface`'s button only renders when the report is empty, which a partially-failed backfill never is. All three fixed, tested, deployed to all five apps. **Found and left open:** a backfill retried against the same 300-issue project now fails deterministically at exactly 100 issues (two 50-item pages) on a Jira-issued pagination cursor whose own payload contains `TENANT_NOT_FOUND_IN_TENANT_STORE` — a Jira-side error, not ours; see TECHNICAL-SPEC § 11 item 11 | either | `pnpm run seed:bulk -- --target 300`; report shows every issue, not a silent subset |
| 1.8  | **Done — passed, on real seeded data, 2026-09-11.** Pulled the raw changelog for JFM-11/12/13/16 straight from `/rest/api/3/issue/{key}?expand=changelog` — the same data Jira's own History tab and Control Chart read — and hand-computed the expected cumulative time per status from the transition timestamps. `JFM-16` (single visit everywhere, the simple-history case the gate cares most about) matched the app's rendered figures exactly, cross-checked visually against the issue's own History tab (`To Do → In Progress → Done`, timestamps matching to the second). `JFM-11`, `12` and `13` each carry one re-entered status whose cumulative time is dominated by an earlier visit and whose most-recent visit alone is under a second — the app showed the ~15.5h cumulative in every case, matching `tools/seed-report.md`'s precomputed margins exactly. Full working: see the session transcript; the four issues and their independently-computed expected values are reproducible from the same API call.                                                                                                                                                                                                                            | either | Cumulative ≥ most-recent, and the difference is explained by the visit count        |

**Gate: passed.** No disagreement on JFM-16's simple history. The three re-entry cases (JFM-11/12/13)
show the app reading higher than a most-recent-only figure would, by exactly the margin
`tools/seed-report.md` predicted before the app was ever opened.

---

## Stage 2 — ship listing 1 · target: 5-10 working days, mostly waiting

| #   | Step                                                                                          | Who                     |
| --- | --------------------------------------------------------------------------------------------- | ----------------------- |
| 2.1 | Vendor account, tax and bank details                                                          | 🧑 human                |
| 2.2 | Listing assets: title, tagline, description, 5-6 screenshots, privacy and security statements | 🤖 drafts, 🧑 approves  |
| 2.3 | Pricing setup — free ≤10 users, $6.50/user to 100 seats                                       | 🧑 human                |
| 2.4 | Submit for Atlassian review                                                                   | 🧑 human                |
| 2.5 | Respond to review feedback                                                                    | 🧑 human, 🤖 fixes code |
| 2.6 | Publish                                                                                       | 🧑 human                |

Budget a **full week** for 2.2. The listing page is the entire conversion surface and it is the one
input a solo developer can win on. It is consistently the most underrated line in this plan.

---

## Stage 3 — the day-90 gate ★ the decision this whole roadmap exists for

Ninety days after listing 1 is publicly available, read the install counter.

| Installs at day 90 | Decision                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| **≥ 30-40**        | The thesis holds. Proceed to stage 4 and ship listings 2-5.                                    |
| **15-30**          | Ambiguous. Re-price _or_ re-position **once** — not both, not twice — then re-read at day 150. |
| **< 15**           | **Stop.** Total loss: about five weeks and ~$50. Do not build listings 2-5.                    |

**Do not move the gate.** The temptation at day 90 with 18 installs will be to build listing 2
because "the code is already written". The code being written is exactly why the gate is cheap to
honour: nothing is lost by not submitting.

Read alongside the counter, because they change what the number means:

- **Paying share** — the one assumption every revenue figure in this project rests on. First real
  data point on it arrives here.
- **Reviews** — zero reviews at day 90 with 40 installs is a different situation from four reviews
  at 4.5 stars.
- **Support load** — if 40 installs generate a support hour a day, the portfolio does not scale
  regardless of revenue.

---

## Stage 4 — the portfolio · target: 5-6 weeks, gated on stage 3

Listings 2-5 are already implemented and tested. This stage is submission work, not engineering.

| Order | Listing           | Why this order                                                                                          | Effort                |
| ----- | ----------------- | ------------------------------------------------------------------------------------------------------- | --------------------- |
| 1     | ② Worklog reports | Flattest competition measured in any Atlassian niche: seven independents at $6-29k/month, none dominant | ~1 week to submission |
| 2     | ③ WIP aging       | Broken Build proves this exact pair works off one codebase                                              | ~4 days               |
| 3     | ⑤ Issue history   | Weakest-defended leader relative to price (SaaSJet at $750)                                             | ~1 week               |
| 4     | ④ SLA breach      | Smallest niche of the four; the counted-statuses model needs the clearest listing copy                  | ~1 week               |

**Before each submission, re-run two checks that cost minutes and have killed whole directions:**

1. Has the platform vendor shipped this natively since 2026-09-05?
2. Has a free first-party or well-funded free app appeared at the top of the niche?

Either answer being yes means dropping that listing, not shipping it anyway.

### Both checks re-run 2026-09-22 — all five still SHIP

No native Jira Cloud feature covering any of the five has shipped, and no free app has taken any
of the niches. What the sweep did change:

- **The near-term risk is consolidation, not a free entrant.** Four apps across the worklog and
  issue-history niches changed hands — Everit's Timetracker is now STAGIL by catworkx, 7pace is
  Appfire, Issue History Collector is Appfire, JXL is Appfire. **A free Appfire tier is a more
  plausible 2027 threat than a startup launch**, and the same logic applies to Tempo in the
  worklog niche, which already ships a free funnel app (Tempo Core, ~24k installs) that is project
  tracking rather than worklog reporting — so it does not trip the gate today, and it is exactly
  the shape that would.
- **The cheapest paid competitor in both niches is lower than this plan assumed** — votazz at
  $175/yr at 50 seats, $350 at 100, across its whole portfolio. The pricing table still clears it,
  but it is the floor to argue against, not the $200–400 previously noted.
- **The issue-history spread is the opportunity, confirmed**: SaaSJet holds roughly a 4× install
  lead at about 4.3× the cheapest competitor's price.
- **Three genuinely free apps exist in the worklog niche and none changes the verdict**: Clockify's
  bridge (unmaintained on the Jira side since 2023), Tempo Core (not a reporting product), and
  VIEW26 Worklog Reports (real, ~67 installs).

⚠️ **One claim to keep out of the copy until it is verified.** A rollback of Jira's native
reports is confirmed only for the Version Workload / Release Burndown / Epic Burndown trio;
whether it covers the Time Tracking and User Workload reports could not be established. Do not
write "Jira is retiring its native time reports" anywhere in listing ②.

---

## Stage 5 — v1.1 · **built, 2026-09-22**, ahead of the gate

Ordered by (value to an existing customer) ÷ (weeks). This list was explicitly _not_ meant to be
built before stage 3 — "nothing here is worth doing before stage 3" — and it was built anyway, on
an instruction to implement the roadmap in full rather than to honour its sequencing. That is a
real departure from the plan and it is recorded rather than smoothed over: **the day-90 gate in
stage 3 is unaffected and still governs whether listings 2-5 are ever submitted.** What changed is
that the work sitting behind that gate is now done, so honouring the gate costs nothing extra.

| Item                                           | State                                                                                                                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Charts on the report pages (UI Kit ships them) | **Done.** One per listing, each answering the question its listing exists to answer. Verified rendering in real Jira.                                                            |
| Cumulative flow diagram (listing 3)            | **Done** — and it needed a new table, not a week of chart work. See TECHNICAL-SPEC § 11 item 13.                                                                                 |
| Push report filters into SQL                   | **Done**, and it was a correctness fix rather than an optimisation: the in-memory path paged, counted and capped wrongly whenever a filter was set on a project past one page.   |
| "Extend history" beyond 12 months              | **Done.** Widening only; an unlisted window is refused rather than clamped.                                                                                                      |
| Stored SLA goals + a goal editor (listing 4)   | **Done.** The one piece of stored configuration in the product; a saved goal travels as its id alone so a client cannot label a table with one goal and compute it from another. |
| Issue panel showing one issue's timeline       | **Done**, as `jira:issueActivity` rather than `jira:issuePanel` — the panel form is opt-in per issue and only visible to users with _edit_ permission. § 11 item 12.             |
| Confluence embedding                           | **Not done, and now a decision rather than a backlog item.** See below.                                                                                                          |

Two items that were not on this list and are now done, because the work above kept walking into
them: an **admin storage page** on all five listings (closing TECHNICAL-SPEC § 11 item 10, open
since the first commit), and **per-visit storage**, which the flow diagram could not be built
without.

### Confluence embedding — dropped, with reasons

Researched against Atlassian's own documentation on 2026-09-22 rather than estimated. Three
findings, any one of which is enough:

1. **Forge SQL is isolated per product.** Atlassian, verbatim: "Data stored by your Forge app for
   one Atlassian app is not accessible from other Atlassian apps. For example, data stored in Jira
   is not accessible from Confluence or vice versa." A Confluence macro therefore **cannot read
   the aggregates these apps already store**, which was the entire premise — "embed a report we
   already have" becomes "build a second ingestion path", which this repository exists to avoid.
2. **Multi-product apps cannot be listed free.** Atlassian: they "can only be listed on
   Marketplace as paid apps; free listings are not supported." The pricing model here is free
   under 10 users, which is the top of the adoption funnel.
3. **It forces a new Marketplace review.** "Multi App Compatibility" is listed as a new app type,
   an explicit exception to routine-update auto-approval.

The one-line manifest change (`app.compatibility`) was never the cost. This is now a
**no** rather than a _later_, and it should only be reopened if a paying customer asks for it by
name.

---

## Stage 6 — what is actually left, and who can do it

Everything below needs an identity, a decision, or a screen — none of it is code.

| #   | Step                                                                                               | Who      |
| --- | -------------------------------------------------------------------------------------------------- | -------- |
| 6.1 | Vendor account, tax and bank details (stage 2.1, still open)                                       | 🧑 human |
| 6.2 | **Re-shoot the six listing screenshots** — every report page gained a chart, so they are all stale | 🧑 human |
| 6.3 | Screenshots for listings 2-5 (`docs/listing-assets-*`, two of four part-shot)                      | 🧑 human |
| 6.4 | Pricing setup, submit, respond to review, publish                                                  | 🧑 human |
| 6.5 | Day-90 gate — unchanged, and still the decision this roadmap exists for                            | 🧑 human |

**6.2 and 6.3 are the reason this stage exists rather than being finished.** Driving a real
browser against real Jira was enough to _read_ every new surface back — the charts, the flow
diagram, the admin page, the Activity tab all confirmed rendering with real values — but not to
click inside a Forge iframe or capture a screenshot of one. Both fail against the Forge iframe
specifically, and the known-good CSV modal fails identically, so this is an automation limit
rather than a product one.

## What is deliberately never on this roadmap

- **Predictive analytics / forecasting.** Competing with Tempo and Appfire on breadth is the losing
  position for a solo developer.
- **Anything that writes to Jira.** A write scope changes the security-review conversation and the
  trust conversation, for no revenue.
- **A scheduled re-index.** On a consumption-priced platform it makes the marginal cost of an
  install grow with the customer's size. A test asserts no manifest contains one.
- **Cold outreach of any kind.** Unlawful into the EU without prior consent (§ 7 Abs. 2 UWG has no
  B2B exemption) and worthless here anyway — see `PROMOTION.md`.

---

## Honest timeline

| Milestone                                                  | Calendar time from stage 1 start |
| ---------------------------------------------------------- | -------------------------------- |
| Listing 1 live on the Marketplace                          | ~4-6 weeks                       |
| First install                                              | ~5-7 weeks                       |
| First payout (Atlassian pays after a month accruing $500+) | **~5-8 months**                  |
| Day-90 gate                                                | ~4-5 months                      |
| Portfolio live, if the gate passes                         | ~7-8 months                      |

**Plan for roughly six months of zero income.** The cash exposure is under $100; the real cost is
the months, which is why the gate at stage 3 is the most valuable line in this document.
