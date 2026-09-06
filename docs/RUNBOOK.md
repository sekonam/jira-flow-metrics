# RUNBOOK — jira-flow-metrics

> The exact human steps. Everything in this file needs credentials, an identity or money, which is
> why none of it was done here.

**Hard boundary.** This repository was built without an Atlassian account. `forge login`,
`forge register`, `forge lint`, `forge tunnel`, `forge deploy`, the vendor account and the
Marketplace submission **have not been run or created**. The code stops at the deploy button on
purpose.

---

## 0. Prerequisites

| Need                       | Detail                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------- |
| Node 22                    | `node -v` → `v22.x`                                                                    |
| pnpm 9.12.3                | `corepack enable && corepack prepare pnpm@9.12.3 --activate`                           |
| An Atlassian account       | Free. Used for both the developer console and the vendor account.                      |
| A free Jira Cloud dev site | `developer.atlassian.com` → _Create a free developer site_. Needed for `forge tunnel`. |
| Tax and bank details       | Only for stage 2, when money can arrive.                                               |

Local check before touching Forge:

```bash
git clone git@github.com:sekonam/jira-flow-metrics.git
cd jira-flow-metrics
pnpm install
pnpm run verify        # format · lint · typecheck · coverage · build
```

`pnpm run verify` must be green before anything below. It is the same command CI runs.

---

## 1. Forge CLI login

```bash
pnpm add -Dw @forge/cli          # already a devDependency of each app
pnpm exec forge login            # opens a browser; needs an Atlassian API token
pnpm exec forge whoami           # confirms
```

**🧑 Human only.** The API token is a credential; it must never be committed, and `.forge/` is
git-ignored for that reason.

---

## 2. Register listing 1 and validate the manifest

```bash
cd apps/time-in-status
pnpm exec forge register         # choose a name, e.g. "Time in Status & Cycle Time"
```

`forge register` rewrites `app.id` in `manifest.yml`. **This deliberately breaks a test** —
`test/manifests.test.ts` asserts the placeholder is still present, so that nobody can believe an
app is registered when it is not. When you register, change that assertion from "still the
placeholder" to "matches `ari:cloud:ecosystem::app/`".

```bash
pnpm exec forge lint
```

⚠️ **Expect findings.** The manifests were written against Atlassian's published module reference
and have never been validated. Fix what lint reports; the module shapes most likely to need
adjustment are `jira:dashboardGadget`, `consumer`, and the `resources` paths.

---

## 3. First tunnel session — the acceptance test for everything unverified

```bash
pnpm exec forge deploy -e development
pnpm exec forge install -e development     # pick your dev Jira site
pnpm exec forge tunnel
```

Then walk this checklist **in order**. Each item is something that cannot be verified from a test
suite, listed by how much depends on it.

| #   | Check                                                                                                                                                                              | If it fails                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | The project page renders at all                                                                                                                                                    | UI Kit component props differ — fix `packages/ui/src/components.tsx`             |
| 2   | The four states appear: loading, error, empty, ready                                                                                                                               | Same file                                                                        |
| 3   | "Start indexing" writes `index_state`                                                                                                                                              | `forgeSqlExecutor` shape is wrong — `packages/forge-runtime/src/sql/executor.ts` |
| 4   | The Forge SQL DDL is accepted                                                                                                                                                      | Dialect differences in `packages/engine/src/store/schema.ts`                     |
| 5   | A Jira search returns issues                                                                                                                                                       | `forgeJiraFetch` / `route` tagging — `packages/forge-runtime/src/jira/client.ts` |
| 6   | The backfill advances past slice 0                                                                                                                                                 | Async Events queue name or consumer method in `manifest.yml`                     |
| 7   | Transitioning an issue in the UI updates the report within a minute                                                                                                                | Product-event trigger wiring                                                     |
| 8   | An issue with a re-entered status shows a `x2` badge and a cumulative figure                                                                                                       | The engine's headline capability, end to end                                     |
| 9   | **Cross-check by hand**: open Jira's own Control Chart for one issue and confirm the app's cumulative figure is ≥ the native one, with the difference explained by the visit count | If not, **stop everything and fix the engine**                                   |
| 10  | CSV export downloads and opens in a spreadsheet                                                                                                                                    | `packages/engine/src/export/csv.ts`                                              |
| 11  | Watch `forge logs` during a backfill for 429s                                                                                                                                      | If they appear, raise `throttleMs` in the app's `ListingRuntime` options         |

**Time-budget calibration.** Look up the current Forge asynchronous invocation limit in Atlassian's
"Platform quotas and limits" page and set `timeBudgetMs` in `apps/*/src/runtime.ts` to roughly 70%
of it. The committed default of 40,000 ms is a safe guess, not a measurement.

Repeat steps 1-2 and 6-8 for each of the other four apps once listing 1 is confirmed.

---

## 4. Vendor account and Marketplace listing (listing 1 only, at first)

**🧑 Human only, every step.**

1. **Vendor account** — `marketplace.atlassian.com/manage/vendors` → create. Free.
2. **Tax and bank details** — required before any payout. Atlassian pays 30 days after a month in
   which you accrue **$500+** in profit; below that it rolls forward.
3. **Production deploy**
   ```bash
   pnpm exec forge deploy -e production
   ```
4. **Create the listing** in the Marketplace vendor console against the deployed app.
5. **Pricing** — set from `packages/engine/src/config/pricing.ts`:
   - free at ≤ 10 users (**mandatory** — almost every competitor is, and the install leader in this
     niche is free at every tier);
   - $6.50/user to 100 seats, $3.25/user to 500, $1.60/user beyond → **$325 at 50 users**.
6. **Listing content** — see `PROMOTION.md`. Budget a full week.
7. **Privacy and security statements** — the honest version is short: read-only Jira access, all
   data stays inside the customer's Atlassian tenant, no external service, no telemetry.
   **State the residual explicitly** (see `TECHNICAL-SPEC.md` § 11.6): reports are authorised on
   `BROWSE_PROJECTS` for the viewer, issues under an issue security level are excluded from
   indexing, restricted worklogs are dropped — but the app does not re-check per-issue visibility
   per viewer on every render. A reviewer will ask; saying it first is cheaper than being asked.
8. **Submit for review.** Atlassian's Forge review is typically 5-10 calendar days.
9. **Respond to feedback**, redeploy, resubmit.
10. **Publish.**

**Revenue share.** Forge apps keep **100% up to $1M lifetime**, conditional (as of the 2026-09-05
check) on no Connect modules, OAuth authentication and Forge UI — all of which this app satisfies.
Confirm the current terms before pricing anything.

---

## 5. Day-90 gate

Ninety days after listing 1 is publicly available:

```
installs ≥ 30-40  → build the portfolio: submit listings 2-5 (ROADMAP stage 4)
installs 15-30    → re-price OR re-position once, re-read at day 150
installs < 15     → stop
```

The counter is in the vendor console under the app's _Reporting_ tab. **This decision is the whole
reason the roadmap is staged.** See `ROADMAP.md` § stage 3.

---

## 6. Publishing listings 2-5

Only after the gate passes. Per listing:

```bash
cd apps/<listing>
pnpm exec forge register
pnpm exec forge lint
pnpm exec forge deploy -e production
```

then repeat § 4 steps 4-10. Before each submission re-run the two checks in `ROADMAP.md` stage 4:
has Atlassian shipped it natively, and has a free competitor appeared at the top of the niche.

---

## 7. Routine operations

| Task                 | Command                                                          | Notes                                              |
| -------------------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| Watch logs           | `pnpm exec forge logs -e production`                             | The only production observability Forge gives      |
| Check consumption    | Developer console → _Usage_                                      | Alerts fire at 50/75/90/100% of the free allowance |
| Deploy a fix         | `pnpm run verify && pnpm exec forge deploy -e production`        | `verify` first, always                             |
| Roll back            | `pnpm exec forge deploy -e production` from the previous git tag | Forge has no one-click rollback                    |
| Re-index one project | "Start indexing" in the app's UI                                 | Idempotent; safe to re-run                         |

---

## 8. The execution split

| ✅ Claude Code, autonomously                     | 🧑 Requires the human                                  |
| ------------------------------------------------ | ------------------------------------------------------ |
| Every line of engine, runtime, UI and test code  | Atlassian account, `forge login`, API tokens           |
| Manifests, schema, cost model, pricing config    | `forge register`, `forge lint`, `forge deploy`         |
| Fixing whatever the first tunnel session finds   | Running the tunnel session and reporting what it shows |
| Listing copy, keyword drafts, screenshot scripts | Vendor account, tax and bank details                   |
| Docs, CI, dependency upgrades                    | Approving the pricing decision                         |
| Support-reply drafts                             | Sending them; every customer-facing message            |
| Analysing the day-90 numbers                     | Reading the counter; the go/no-go decision             |
| —                                                | Community participation under a real identity          |
| —                                                | Asking early installers for reviews                    |

The scarce resources are the owner's **time** and **identity** — accounts, money, and anything said
in public under their name. Everything else is on the left column.
