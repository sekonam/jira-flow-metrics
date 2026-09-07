# MAINTENANCE — jira-flow-metrics

> How to keep five Marketplace listings alive without them becoming a full-time job. The economics
> only work if the marginal cost of an extra listing stays near zero.

---

## 1. The maintenance thesis

Five listings share one engine. That is the whole reason the portfolio is affordable — but it cuts
both ways: **a bug in `packages/engine` is a bug in five products at once.** Everything below
follows from that.

| Rule                                    | Consequence                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Fix bugs in the engine, never in an app | A per-app workaround makes the five listings diverge, and divergence is what turns a portfolio into five products |
| Every bug gets a failing test first     | A metrics product that regresses silently loses the only thing it sells                                           |
| The golden file is never regenerated    | Regenerating it asserts only that the code still does what it does                                                |
| Deploy all five, or none                | They share the engine; shipping a fix to one leaves four wrong                                                    |

---

## 2. Routine cadence

| Cadence                                    | Task                                                                             | Time    |
| ------------------------------------------ | -------------------------------------------------------------------------------- | ------- |
| **Daily** (while any listing is live)      | Skim `forge logs` for errors and 429s; answer support                            | 10 min  |
| **Weekly**                                 | Read new reviews and reply; check the install counter                            | 20 min  |
| **Monthly**                                | Dependency updates; `pnpm audit`; Forge consumption check                        | 1 hour  |
| **Quarterly**                              | Re-run the two market checks in § 6; review pricing against measured competitors | 2 hours |
| **On any Atlassian platform announcement** | Read it against § 5                                                              | varies  |

---

## 3. Dependency and platform upkeep

```bash
pnpm update --interactive --latest    # review, do not blanket-accept
pnpm audit --audit-level high         # the CI gate
pnpm run verify                       # format · lint · typecheck · coverage · build
```

CI runs `pnpm audit --audit-level high` on every push, so a high-severity advisory in a transitive
dependency fails the build rather than sitting unnoticed.

**Dependencies to treat carefully:**

| Package                                                        | Why                                                                                                                                                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@forge/api`, `@forge/sql`, `@forge/events`, `@forge/resolver` | Platform SDKs. A major bump can change the two adapter functions this codebase deliberately isolated (`forgeSqlExecutor`, `forgeJiraFetch`). Read their changelogs; do not auto-merge. |
| `@forge/react`                                                 | UI Kit component APIs move. The components are **not covered by tests**, so a bump needs a tunnel session before deploying.                                                            |
| Node runtime in `manifest.yml`                                 | Pinned to `nodejs22.x`. Atlassian deprecates runtimes on a schedule; a deprecation notice is a hard deadline, not a suggestion.                                                        |

**The engine itself has zero runtime dependencies.** No date library, no HTTP client, no ORM. That
is deliberate: it is the part that must not break, and every dependency is a way for it to break
without anyone changing it.

---

## 4. Support

**Expected volume, honestly.** At 100 installs, most of which are free-tier, expect a handful of
questions a month. The two that will actually arrive:

| Question                                         | Answer                                                                                                       | Product fix if it repeats                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| "Your number doesn't match Jira's control chart" | Correct — Jira reports only the most recent visit; the app sums all of them. Point at the visit-count badge. | None. This is the product. Make sure the tooltip says it.     |
| "The report is empty / incomplete"               | The backfill has not finished. Point at the indexing banner.                                                 | If it happens twice, the banner is not prominent enough.      |
| "Working hours look wrong"                       | Check the project's working calendar and its timezone.                                                       | Reproduce as a golden-file case **before** changing any code. |
| "Can you add X?"                                 | Usually no — see PRODUCT-SPEC's out-of-scope lists. Say why, briefly.                                        | Record it; three independent requests is a signal.            |

**Support is the review funnel.** A question answered well within a day is the highest-yield moment
to ask for a review, and reviews are the single most visible ranking signal a new listing has.

---

## 5. Platform risk watch

Recorded so the failure is recognisable early rather than rationalised away.

| Watch for                                              | Where                                               | Response                                                                                                                         |
| ------------------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Atlassian ships cumulative time-in-status natively** | Jira Cloud changelog, Atlassian Analytics templates | This removes the product's only factual claim. If it lands on Standard plans, the honest response is to stop, not to reposition. |
| **The free leader adds the same capability**           | Bloompeak's listing (10,579 installs)               | Re-read the day-90 gate criteria; a free competitor at parity changes the install curve, not the code.                           |
| **Forge pricing changes**                              | Forge pricing page                                  | Re-run `estimateMonthlySqlCost` with the new rates. Platform pricing moved twice in the year to 2026.                            |
| **KVS/SQL allowance changes**                          | Platform quotas page                                | The 730 GB-hour free allowance is what makes ~55 reference installs free.                                                        |
| **Revenue share changes**                              | Marketplace partner terms                           | 100% to $1M lifetime for Forge apps is conditional; the conditions can move.                                                     |
| **Node runtime deprecation**                           | Forge runtime docs                                  | Hard deadline. Bump `manifest.yml` and redeploy all five.                                                                        |
| **Jira REST API deprecation**                          | Jira Cloud changelog                                | The app uses `/rest/api/3/search/jql`, `/changelog`, `/worklog`, `/status`. The search endpoint has already moved once.          |

---

## 6. The two checks to re-run every quarter, and before every new listing

Both cost minutes and both have killed whole directions in the research that produced this product.

1. **Has the platform vendor shipped it natively?** Read the Jira Cloud changelog. Three of twelve
   killed ideas in this project's history died because the platform had already shipped the feature.
2. **Has a free first-party or well-funded free app appeared at the top of the niche?** Query the
   Marketplace API for the category sorted by installs and look at the top ten:
   ```
   https://marketplace.atlassian.com/rest/2/addons?...   # vendor data is in _embedded.vendor
   ```
   A free app at the top of a niche is fatal to a paid entrant, and the niche leader here is
   already free.

If either answer is yes for a listing that is not yet submitted, **drop that listing** rather than
ship it anyway.

---

## 7. Cost monitoring

Forge is consumption-priced. Usage alerts fire at 50/75/90/100% of the free allowance; treat 75% as
the point to look, not 100%.

**If consumption grows faster than installs, the cause is one of these, in order of likelihood:**

1. A large instance ran a backfill — expected, transient, and bounded by the time budget.
2. The relevance filter is letting through events it should skip — check
   `eventAffectsDatasets` against what the instance's automation rules are doing.
3. The history listing is installed on a busy instance — its per-install footprint is several times
   the reference figure by design.
4. **Someone added a scheduled trigger.** A manifest test asserts none exists. If that test was
   changed, this is why.

---

## 8. What "abandoned" would look like, and how to avoid it accidentally

An unmaintained Marketplace app is visible: no release in six months, unanswered reviews,
unanswered support. Buyers scan for exactly that.

The minimum to not look abandoned, even in a quiet quarter:

- one release per quarter, however small — a dependency bump is a release;
- every review answered within a week;
- the changelog page updated with each release.

If the day-90 gate says stop, **say so on the listing** rather than letting it rot: an app marked
end-of-life is a neutral fact, an app that silently decays is a mark against the vendor account that
the next listing inherits.

---

## 9. Code health rules

| Rule                                                       | Enforced by                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 80% coverage floor on `packages/**`                        | CI (`vitest` thresholds)                                                                   |
| No live network calls in tests                             | Convention + fixture-backed fakes; a live call would make CI flaky and it would be obvious |
| No secrets in the repository                               | `.gitignore` covers `.forge/` and `.env`; review every diff                                |
| Conventional Commits                                       | Convention                                                                                 |
| Format, lint, typecheck, test, build all green before push | `pnpm run verify` — the same command CI runs                                               |
| Bug → failing test → fix                                   | Convention, and the reason the golden file exists                                          |

**One more, specific to this product:** any change to `packages/engine/src/time/` or
`packages/engine/src/changelog/` must be reviewed against the golden file's `why` fields by hand.
Those two directories are where a silent wrongness would live, and a passing test suite is not by
itself evidence that a change to them is correct.

---

## 10. Launch week — the operations that only exist once

The first seventy-two hours after listing 1 is publicly available are the only period where
production behaviour is unknown _and_ the sample is small enough to inspect by hand. Use it.

| When                             | Do                                                                                                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Twice a day, 72 h**            | `pnpm exec forge logs -e production`. You are looking for three things: unhandled errors, 429s during a backfill, and resolver calls that return empty.                                                                                                |
| **On the first install**         | Confirm end to end that the backfill reached `complete`, that no 429 storm occurred, and that the app's own consumption moved as the cost model predicts. One real instance calibrates every estimate in `TECHNICAL-SPEC.md`.                          |
| **On the first support message** | Reply within one working day and answer the question before mentioning anything else. This is also the review funnel (§ 4).                                                                                                                            |
| **On the first paying instance** | Check the tier that was actually applied against the ladder in `packages/engine/src/config/pricing.ts`, and confirm tax and bank details are complete — payouts release 30 days after a month accruing $500+, and missing details silently defer that. |
| **On the first one-star review** | Treat as an emergency: in month one it is 100% of the visible signal. Fix the cause that day, reply publicly with what changed.                                                                                                                        |

**The first real backfill is the acceptance test for the cost model.** Record issues indexed,
wall-clock time, slices consumed and the consumption delta, and put those four numbers in the
maintenance log. Every "~55 installs fit in the free allowance" claim in this repo is an estimate
until that line exists.

---

## 11. Incident response

**Reproduce against fixtures, never debug against a customer's tenant.** The engine is
deterministic and fixture-driven precisely so that a production report can be turned into a test
case. A bug that cannot be reproduced from a recorded changelog is not understood yet.

| Severity                                          | Example                                         | Response                                                                                                                                                                                                                 |
| ------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **S1 — the numbers are wrong**                    | A duration disagrees with the changelog         | Stop other work. Golden-file case first, then the fix, then deploy **all five** listings. Tell the affected customer what was wrong and for how long. A metrics product that is silently wrong has nothing left to sell. |
| **S2 — the app is down or refuses**               | Resolver throws, page never leaves loading      | Roll forward if the fix is obvious and tested within the hour; otherwise redeploy the previous tag (§ below).                                                                                                            |
| **S3 — a surface is wrong but the data is right** | A label, a state, a broken export               | Normal queue. Failing test, fix, next release.                                                                                                                                                                           |
| **S4 — platform notice**                          | Runtime deprecation, API sunset, pricing change | `§ 5` decides. A deprecation date is a hard deadline, not a backlog item.                                                                                                                                                |

**Rolling back.** Forge has no one-click rollback, so it is a redeploy of an older commit:

```bash
git checkout <previous-tag>
pnpm run verify
pnpm exec forge deploy -e production
```

⚠️ **Code rolls back; the database does not.** `MetricsStore.migrate()` runs `CREATE TABLE IF NOT
EXISTS` at every entry point, so schema changes must stay **additive** — a new column or table an
older build simply ignores. A migration that renames or drops anything makes rollback impossible,
which means it is not an option in this codebase.

**Tag every production deploy** (`git tag -a v1.0.3 -m ...`) at the moment you deploy. Without
tags, "the previous version" is a guess made under pressure.

---

## 12. The recurring checklists

Copy these into whatever you actually read. They are the § 2 cadence in a form you can tick.

**Weekly (20 min)**

```
[ ] Install counter read and logged
[ ] Every new review answered
[ ] Support inbox at zero
[ ] forge logs skimmed for errors and 429s
```

**Monthly (1 h)**

```
[ ] pnpm update --interactive --latest  (reviewed, not blanket-accepted)
[ ] pnpm audit --audit-level high       (clean, or an issue opened)
[ ] pnpm run verify                     green
[ ] Forge consumption checked against the free allowance — look at 75%, not 100%
[ ] One release cut, however small, and the changelog page updated
```

**Quarterly (2 h)**

```
[ ] Has Atlassian shipped this natively?      (Jira Cloud changelog — § 6.1)
[ ] Has a free app appeared at the top of the niche?  (Marketplace API by installs — § 6.2)
[ ] Competitor prices re-read; our ladder still defensible
[ ] Platform-risk table (§ 5) re-read against the quarter's announcements
[ ] Golden-file `why` fields re-read if anything in engine/time or engine/changelog changed
```

---

## 13. The records worth keeping

Keep one file outside this repository. It costs a minute a week and it is the only thing that can
answer _why_ at the day-90 gate, when the counter can only answer _how many_.

| Record                                       | Why it matters later                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Weekly installs, reviews, support count      | The gate in `ROADMAP.md` stage 3 is read against a trend, not a single number                          |
| **Paying share**, once any instance converts | Every revenue figure in this project rests on an assumed 25%. This is the first real data point on it. |
| Support hours per week                       | If 40 installs generate an hour a day, the portfolio does not scale regardless of revenue              |
| Consumption per install                      | Turns the cost model from an estimate into a measurement                                               |
| Incident log: date, severity, cause, fix     | Three entries with the same cause is a design problem, not three bugs                                  |
| Feature requests, verbatim                   | Three independent requests for the same thing is a signal; one is not                                  |
