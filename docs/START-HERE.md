# START HERE — what it takes to launch this, and in what order

> Read this first. It answers one question: **what is actually needed to start?**
> Everything else in `docs/` answers "how", once you have started.

**Where this repository stands.** Five listing apps and a shared engine are built, tested and
reviewed — 735 tests, 97.8% statements, lint/typecheck/build green, secret-scanned. **All five
apps are now deployed and installed** on the developer site, processing real Jira issue events
without error — getting there took four fixes nothing local could have caught, see ROADMAP 1.5.
`pnpm run e2e:live` separately runs the real engine against that site and agrees with Jira on
every figure, and `pnpm run backfill:scale` proves the backfill machinery holds up past 5,000
issues (synthetically — see ROADMAP 1.7, which found and fixed a real cursor bug on the way).
What has still never happened: any UI opened inside Jira (no `forge tunnel` session has run), a
backfill at that scale against a real instance, the Control Chart comparison, and a listing.

**So the blocker is not code and it is not money.** It is three things only you can supply: an
**Atlassian identity**, roughly **half a day at a terminal with a tunnel open**, and **one week of
listing-page work**. Total cash exposure to reach the day-90 decision is **under $100**.

---

## 1. What you need

| Need                                           | Cost      | Why it cannot be done for you                                                                                                                                                  |
| ---------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Atlassian account**                          | $0        | An identity. Used for the developer console and the vendor account alike.                                                                                                      |
| **Free Jira Cloud developer site**             | $0        | `developer.atlassian.com` → _Create a free developer site_. Hosts the tunnel.                                                                                                  |
| **Atlassian API token** → `forge login`        | $0        | A credential. Never committed; `.forge/` is git-ignored for this reason.                                                                                                       |
| **Marketplace vendor account**                 | $0        | `marketplace.atlassian.com/manage/vendors`. Legal identity of the seller.                                                                                                      |
| **Tax and bank details**                       | $0        | Required before any payout can be released. Do it early; it is paperwork, not a decision.                                                                                      |
| **A domain for the docs site**                 | ~$12/yr   | The Marketplace links to it and reviewers open it. The only recurring cost before revenue.                                                                                     |
| **Node ≥ 22.12 + pnpm 9.12.3**                 | $0        | `corepack enable && corepack prepare pnpm@9.12.3 --activate`. The 22.12 floor is not cosmetic: `forge lint` `require()`s an ESM-only dependency and cannot start on older 22.x |
| **~half a day** for the first tunnel session   | your time | The single highest-value hour in this plan. See § 3.                                                                                                                           |
| **~one week** for listing copy and screenshots | your time | The listing page is the entire conversion surface. `PROMOTION.md` § 1.                                                                                                         |
| **Forge consumption** once installs arrive     | $0–25/mo  | ~55 reference installs fit inside the free allowance. `TECHNICAL-SPEC.md`.                                                                                                     |

**Not needed, deliberately:** an audience, a newsletter, a company, a budget for ads (Atlassian
sells no placement), a designer, or a second person.

---

## 2. Prerequisite checklist

Work top to bottom. Nothing below the line is worth starting until everything above it is ticked.

```
[ ] node -v                       → v22.12 or newer (forge lint needs it; see § 1)
[ ] corepack prepare pnpm@9.12.3 --activate
[ ] git clone git@github.com:sekonam/jira-flow-metrics.git && cd jira-flow-metrics && pnpm install
[ ] pnpm run verify               → green (format · typecheck · lint · coverage · build)
[ ] pnpm run ui:screens           → open packages/ui-harness/screens/index.html and look at it
─────────────────────────────────────────────────────────────────────────────────────────────
[ ] Atlassian account created
[ ] Free Jira Cloud developer site created, with one project and ≥ 50 issues with real history
[ ] pnpm exec forge login && pnpm exec forge whoami
[x] Developer Space exists — "AskMe Solutions". Use `forge login`, not FORGE_* env vars,
    which yield a session that cannot see it
[ ] Marketplace vendor account created
[ ] Tax and bank details submitted
```

**Seed the dev site properly — and let the script do it.** A project with five freshly created
issues proves nothing: the product's entire claim is about _re-entered_ statuses. `pnpm run
seed:dev-site` walks paths with real returns — sent back to the backlog, reopened after Done, two
review rounds, blocked and unblocked where the workflow has a Blocked status — alongside three
**controls** that never re-enter anything and so must agree with Jira exactly. It leaves some in
flight, backdates worklogs, and spreads due dates either side of today. A scenario the workflow
cannot express is skipped outright rather than half-walked, so the issue count depends on the site.

It then writes `tools/seed-report.md`: a per-status table of how many visits it drove and whether
the app should therefore **agree with** or **read higher than** Jira's Control Chart — computed
before the app is ever opened. That table is what makes tunnel-checklist item 9 a comparison
against a stated prediction rather than a judgement call.

⚠️ **One limit, and it decides which rows are worth checking.** Jira stamps changelog entries with
its own clock and REST cannot backdate one, so every transition walked inside a single run lands in
the same second or two. The _shape_ is right — the visits and the returns are real — but a status
re-entered twice within one run is one the app reads higher than the Control Chart by under a
second. The claim is true and no screen will show it.

So the report carries a **margin** column: the actual difference, measured from the changelog. Use
the bolded rows for item 9 and ignore the ones marked `too small to see`. Only a visit that
straddles the gap between `--phase 1` and `--phase 2` accumulates real time, which is why the two
phases exist — and why `--dwell` is worth passing if you want more than a handful of checkable
rows. Working-hours arithmetic is not exercised either way; that is what
`packages/engine/test/calendar.golden.test.ts` is for.

```bash
cp .env.example .env                       # JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
pnpm run seed:dev-site -- --dry-run        # print the plan, write nothing
pnpm run seed:dev-site -- --phase 1 --dwell 120   # ~38 min: it really does wait
# ...wait a day or two — the longer the gap, the bigger the margins...
pnpm run seed:dev-site -- --phase 2 --dwell 120   # ~30 min
pnpm run seed:dev-site -- --help           # every flag, including --reset
```

---

## 3. Next steps, in order

### Week 0 — before touching Forge (2 hours)

1. Run the checklist above.
2. Open `packages/ui-harness/screens/index.html` and read the ten surfaces in six states each.
   This is what the tunnel session is comparing against, so the session becomes a _comparison_
   rather than a _discovery_.
3. Read `RUNBOOK.md` § 3 end to end once, before running any of it.

### Week 1 — the tunnel session ★ the real gate (half a day, plus fixes)

```bash
cd apps/time-in-status
pnpm exec forge register        # rewrites app.id — this deliberately breaks test/manifests.test.ts
pnpm exec forge lint            # expect findings; the manifests have never been validated
pnpm exec forge deploy -e development
pnpm exec forge install -e development
pnpm exec forge tunnel
```

Then walk the eleven-item checklist in `RUNBOOK.md` § 3 **in order** and write down what each item
did — not just whether it passed. Items 3–7 are where an SDK shape mismatch would show up, and the
fix for each is named in that table.

**Item 9 is the one that can end the project:** compare the app's cumulative figure against Jira's
own Control Chart by hand for a handful of issues. Cumulative must be ≥ the native figure, with the
difference explained by the visit count. **If it disagrees on an issue with a simple history, stop
everything and fix the engine.** Every downstream step is worthless if the arithmetic is wrong.

### Week 1–2 — fix what the session found

| Known before you start                                                                                                                                                                     | Where                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| **Dashboard gadgets probably refuse.** Resolvers read `extension.project.id`; a dashboard is not project-scoped. Fix is manifest configuration or dropping the module — not resolver code. | `RUNBOOK.md` item 2a; pinned by `apps/time-in-status/test/end-to-end-ui.test.tsx` |
| **CSV export is implemented, tested, documented — and unreachable.** No frontend calls `exportCsv`.                                                                                        | `ROADMAP.md` step 1.3a; pinned by `test/resolver-wiring.test.ts`                  |
| **The WIP-aging histogram promised in `PRODUCT-SPEC.md` § 6 is not built.**                                                                                                                | Either build it or cut the promise before the listing goes out.                   |
| **`timeBudgetMs` is a guess.** 40,000 ms, set without reading the current platform limit.                                                                                                  | `apps/*/src/runtime.ts`; calibrate to ~70% of the published limit.                |

Every fix follows the repo protocol: failing test first, then the fix, then `pnpm run verify`.

### Week 2–3 — listing assets (the week people skip)

Follow `PROMOTION.md` § 1 and the production checklist in § 9. Draft copy can be written for you;
the screenshots need the tunnel session's real data, so they cannot be produced before week 1.

### Week 3 — submit

`RUNBOOK.md` § 4: production deploy, create the listing, set pricing (free ≤ 10 users, $6.50/user
to 100 seats → **$325 at 50 users**), write the privacy and security statements — including the
residual stated openly, see `TECHNICAL-SPEC.md` § 11.6 — then submit. **Atlassian's review is
typically 5–10 calendar days.**

### Weeks 4–6 — respond, publish, then start the promotion calendar

`PROMOTION.md` § 9 covers day −7 to day 90 as a calendar. The single highest-leverage post-launch
action is reviews: **5 by day 60, 10 by day 120.**

### Day 90 — the gate this whole plan exists for

```
installs ≥ 30-40  → the thesis holds; submit listings 2-5 (ROADMAP stage 4)
installs 15-30    → re-price OR re-position ONCE, re-read at day 150
installs < 15     → stop
```

**Do not move the gate.** At day 90 with 18 installs the temptation is to ship listing 2 because
the code already exists. That the code exists is precisely why honouring the gate is cheap.

---

## 4. Honest timeline and what it costs to be wrong

| Milestone                                                  | From the day you start |
| ---------------------------------------------------------- | ---------------------- |
| Listing 1 live                                             | ~4–6 weeks             |
| First install                                              | ~5–7 weeks             |
| Day-90 gate                                                | ~4–5 months            |
| First payout (Atlassian pays after a month accruing $500+) | ~5–8 months            |

**Plan for roughly six months of zero income.** The cash at risk is under $100; the real cost is
the calendar. That asymmetry is the reason every gate in these documents is defined on a counter
rather than on a feeling.

---

## 5. Who does what

| ✅ Can be done for you                                     | 🧑 Needs you                                           |
| ---------------------------------------------------------- | ------------------------------------------------------ |
| All code, tests, manifests, docs, CI, dependency upgrades  | Atlassian account, API token, `forge login`            |
| Fixing whatever the tunnel session reports                 | Running the tunnel session and reporting what it shows |
| Listing copy, keywords, screenshot scripts, support drafts | Vendor account, tax and bank details, pricing sign-off |
| Analysing the day-90 numbers                               | Reading the counter and making the call                |
| —                                                          | Anything said in public under your name                |

The scarce resources are your **time** and your **identity**. Everything else is on the left.

---

## 6. Where everything else lives

| Question                                                  | Document                 |
| --------------------------------------------------------- | ------------------------ |
| What does each listing do, and what does it refuse to do? | `PRODUCT-SPEC.md`        |
| How does it work, and what is still unverified?           | `TECHNICAL-SPEC.md` § 12 |
| The exact commands, in order                              | `RUNBOOK.md`             |
| Stages and gates                                          | `ROADMAP.md`             |
| Listing craft, reviews, the launch calendar               | `PROMOTION.md`           |
| Keeping five listings alive without a full-time job       | `MAINTENANCE.md`         |
