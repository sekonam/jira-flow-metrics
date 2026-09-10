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

**Not delivered, and cannot be from here:** `forge login`, `forge register`, `forge lint`,
`forge tunnel`, `forge deploy`, a vendor account, a Marketplace listing. See `RUNBOOK.md`.

---

## Stage 1 — make it real · target: 5-8 working days

The whole stage is about converting "written correctly" into "observed working". Nothing new is
built.

| #    | Step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Who      | Done when                                                                    |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| 1.1  | Atlassian developer account, `forge login` — **done**: the CLI authenticates with the token in `.env` via `FORGE_EMAIL`/`FORGE_API_TOKEN`                                                                                                                                                                                                                                                                                                                                               |
| 1.1a | **Developer Space** — one exists (`AskMe Solutions`). An earlier note here claimed none did; that was wrong, and the cause is worth knowing: authenticating via `FORGE_EMAIL`/`FORGE_API_TOKEN` yields a session that reports "not a member of a Developer Space", while `forge login --non-interactive -u … -t …` sees it. Use `forge login`, not the env vars                                                                                                                         |
| 1.2  | `forge register` — **done for `time-in-status`** (app id in its manifest). The other four stop at the Atlassian Developer Terms, which bind the account owner to billing above the free allowance and need a real terminal: `forge register -s 38f9a10b-9651-4ce6-94a3-f53ae76b82e1 "<name>"`                                                                                                                                                                                           |
| 1.3  | `forge lint` — **done for `time-in-status`: "No issues found"**. It rejected two things first: the `sql` module was undeclared though the code uses Forge SQL, and `jira:dashboardGadget` requires a `thumbnail`. Both fixed in all five manifests. Two traps: `@forge/lint` `require()`s the ESM-only `archiver@8`, so it needs Node ≥ 22.12 or `NODE_OPTIONS=--experimental-require-module` (this machine is on 22.10); and `forge lint --fix` strips every comment from the manifest |
| 1.3a | **CSV export button — done.** `CsvExport` in `@jfm/ui` is on all five project pages; it invokes `exportCsv` and shows the file in a modal to copy. No download: UI Kit 2 has no DOM, and `router.open` on a `data:` URI is blocked by Chrome, not by Forge. A real download needs a Custom UI surface — v1.1. `test/resolver-wiring.test.ts` now asserts the key **is** invoked                                                                                                         | either   | Done                                                                         |
| 1.4  | `forge tunnel` against a free Jira Cloud dev site; walk the checklist in RUNBOOK § "First tunnel session" — **partly done without a tunnel**: `time-in-status` is deployed to `development` and installed on the dev site, and real `avi:jira:updated:issue` events now process without error. The UI surfaces are still unopened                                                                                                                                                       |
| 1.5  | **Done — and it did differ.** Three defects, all in the adapter layer, all invisible to local tests: `bindParams` is variadic (the array bound one argument, and Forge said only `Unknown SQL execution error`); DDL is refused through `prepare().execute()` and needs `migrationRunner`; a bound parameter inside `ORDER BY` is rejected. Diagnosing them needed `describeError` to unpack the platform error's own fields                                                            |
| 1.6  | Visual pass on every UI Kit component                                                                                                                                                                                                                                                                                                                                                                                                                                                   | either   | Four states render on all five pages                                         |
| 1.7  | Backfill a project with 5,000+ issues end to end                                                                                                                                                                                                                                                                                                                                                                                                                                        | either   | `index_state` reaches `complete`; no 429 storm                               |
| 1.8  | Compare a handful of issues against Jira's own control chart by hand                                                                                                                                                                                                                                                                                                                                                                                                                    | 🧑 human | Cumulative ≥ most-recent, and the difference is explained by the visit count |

**Gate:** if step 1.8 disagrees with Jira on an issue whose history is simple, stop and fix the
engine before anything else. Everything downstream is worthless if the arithmetic is wrong.

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

---

## Stage 5 — v1.1, only after a listing has paying customers

Ordered by (value to an existing customer) ÷ (weeks). Nothing here is worth doing before stage 3.

| Item                                           | Why it waits                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| Charts on the report pages (UI Kit ships them) | Visible polish, no new capability. Cheap once there is a customer to show it to.     |
| Cumulative flow diagram (listing 3)            | The most-requested shape in this niche; a week of chart work on data already stored. |
| Push report filters into SQL                   | Only matters once someone's instance is big enough to be slow.                       |
| "Extend history" beyond 12 months              | Only matters once someone asks.                                                      |
| Stored SLA goals + a goal editor (listing 4)   | Real work; justified only if the SLA listing sells.                                  |
| Issue panel showing one issue's timeline       | Uses `evaluateSla`'s full pause model; a genuinely different surface.                |
| Confluence embedding                           | A second platform review cycle. Only with revenue behind it.                         |

---

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
