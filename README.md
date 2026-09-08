# jira-flow-metrics

One duration-analytics engine over Jira issue changelogs and worklogs, published as **five separate
Atlassian Marketplace listings**.

```
packages/engine         all the arithmetic — no platform dependencies, no runtime dependencies
packages/forge-runtime  Forge SQL store, Jira REST client, queue scheduler, per-listing wiring
packages/ui             view models + Atlassian UI Kit components, both tested by rendering
packages/ui-harness     dev only — stand-in Forge host renderer, screenshots, axe audit
apps/time-in-status     ① the flagship listing
apps/worklog-reports    ②
apps/wip-aging          ③
apps/sla-breach         ④
apps/issue-history      ⑤
```

**New here?** Everything is built and tested; nothing has ever run on Forge. What it takes to
change that — accounts, costs, hours, and the order — is in
[`docs/START-HERE.md`](docs/START-HERE.md).

---

## What it does

Jira's Control Chart reports only the **most recent** period an issue spent in a status. If an issue
goes To Do → In Progress → Blocked → In Progress, Jira shows only the second In Progress period.
This engine keeps every visit and sums them, and shows the visit count next to the figure so the
claim is checkable on the user's own data.

On top of that one timeline it builds four more reports — worklog totals, WIP aging, SLA and
due-date breach, and cross-issue field history — **with no second ingestion pipeline and no extra
Jira calls**. That reuse is the point: the multi-listing structure is the distribution strategy.

---

## Status

|                                           |                                                       |
| ----------------------------------------- | ----------------------------------------------------- |
| Tests                                     | **711 passing**                                       |
| Coverage on `packages/**` + app frontends | **98.6% statements · 91.5% branches** (CI floor: 80%) |
| Lint, typecheck, build                    | Green                                                 |
| Deployed to Forge                         | **No**                                                |
| Published to the Marketplace              | **No**                                                |

### ⚠️ What has never been verified

**Nothing in this repository has executed on the Atlassian Forge platform.** There is no Atlassian
developer account here, so `forge login`, `forge lint`, `forge tunnel` and `forge deploy` could not
be run. Specifically unverified:

- the five `manifest.yml` files (written against Atlassian's published module reference);
- `forgeSqlExecutor` and `forgeJiraFetch` — the two adapter functions that touch the Forge SDKs;
- whether Forge SQL accepts the DDL and the `ON DUPLICATE KEY UPDATE` upserts;
- **how Forge itself renders the UI.** Every screen is rendered and audited in CI, but through a
  stand-in host renderer (`packages/ui-harness`): `@forge/react`'s UI Kit 2 exports are string
  sentinels serialised over the bridge, and the code that turns them into Atlassian Design System
  markup ships inside Jira and is not on npm. Structure, copy, state and numbers are verified;
  Forge's own rendering and its acceptance of these props are not.

Everything else — the arithmetic, the ingestion pipeline, the backfill state machine, the store
contract, the request URLs, the SQL statement text and its bound parameters — is covered by tests
against recorded fixtures. `docs/TECHNICAL-SPEC.md` § 12 lists the unverified surface exhaustively,
in order of risk, and `docs/RUNBOOK.md` § 3 is the checklist that closes it.

---

## Getting started

```bash
corepack enable && corepack prepare pnpm@9.12.3 --activate
pnpm install
pnpm run verify        # format · lint · typecheck · coverage · build — the same as CI
```

Useful:

```bash
pnpm run ui:screens    # render every screen in every state to a PNG, and audit it with axe
pnpm run seed:dev-site # seed a Jira dev site with re-entered statuses (needs .env)
pnpm test              # vitest, no coverage gate
pnpm run coverage      # with the 80% floor enforced
pnpm run typecheck     # project references + the test project
```

Node 22 is required. The engine uses `Intl` for all timezone arithmetic and takes no date library.

---

## Design decisions that are load-bearing

**Forge SQL, never KVS.** The aggregate is rewritten on every relevant issue update; KVS meters
writes at roughly 20× reads, which is the wrong shape. Forge SQL is priced on bytes held — about
18 MB per reference install, so ~55 installs fit inside the free allowance.

**Incremental ingestion only — there is no scheduled trigger in any manifest, and a test asserts
it.** Forge went consumption-priced on 1 January 2026; a nightly re-index would make the marginal
cost of an install grow with the customer's instance size while the price stays flat.

**Replace, never merge.** An issue's aggregate rows are deleted and re-inserted from a freshly
reconstructed timeline. That is what makes ingestion idempotent, and idempotency is what lets the
backfill be at-least-once — it writes results _before_ advancing its cursor, so a crash re-processes
a page instead of skipping one.

**Aggregates key on status _id_, never the name.** Statuses get renamed; a report keyed on the name
would silently split one status into two columns.

**Working calendars resolve per local day through the zone database.** "09:00-17:00 Europe/Berlin"
is eight hours every day of the year but a different UTC range in summer and winter. A 24/7 calendar
correspondingly measures 23 hours on a spring-forward day and 25 on a fall-back day — asserted in a
hand-computed golden file whose expected values were never generated from the implementation.

**Ports everywhere the platform is touched.** Not architecture for its own sake: it is what shrinks
the untestable surface to about twenty lines.

---

## Documentation

| Document                                           | What it answers                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`docs/START-HERE.md`](docs/START-HERE.md)         | **Read first.** What you need to launch this — accounts, costs, time — and the order to do it in |
| [`docs/PRODUCT-SPEC.md`](docs/PRODUCT-SPEC.md)     | What each listing does, what it deliberately does not, and the pricing ladder                    |
| [`docs/TECHNICAL-SPEC.md`](docs/TECHNICAL-SPEC.md) | Data model, ingestion, backfill algorithm, module map, cost model, unverified surface            |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)               | Stages, and the day-90 install gate that decides whether listings 2-5 ship                       |
| [`docs/PROMOTION.md`](docs/PROMOTION.md)           | Listing craft, keywords, the first-ten-reviews plan. No cold email.                              |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md)               | The exact human steps: login, register, tunnel checklist, vendor account, submission             |
| [`docs/MAINTENANCE.md`](docs/MAINTENANCE.md)       | Cadence, platform risk watch, support, cost monitoring                                           |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)               | Standards, the per-step protocol, and the rules about the golden file                            |

---

## Honest framing

The market analysis behind this is in the parent research project. Its conclusion, kept here so
nobody has to rediscover it:

> **There is no product wedge.** The incumbents are mature, actively maintained and genuinely
> well-liked — 4.54-4.79 stars over 200+ reviews each — and **the install leader in the niche is
> free**. The entry is price and narrow scope, which is exactly the position a profitable
> independent (Broken Build, 863 + 675 installs) already occupies here.
>
> Every revenue figure in these docs rests on an **assumed 25% paying share that Atlassian does not
> publish**. Listing 1 alone is roughly a coin flip against a $1,000 MRR bar. The portfolio is the
> thesis, and the day-90 install counter is the only thing that will settle it.

---

## Licence

Proprietary. See [`LICENSE`](LICENSE). Distribution to end users happens solely through the
Atlassian Marketplace; nothing here grants any right to the source.
