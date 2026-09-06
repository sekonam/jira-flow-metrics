# CONTRIBUTING

This is a single-owner proprietary repository. These are the standards it is held to, written down
so they survive gaps between working sessions.

---

## The gate

```bash
pnpm run verify        # format · lint · typecheck · coverage · build
```

**Nothing is done until `verify` is green and the work is pushed.** CI runs the same steps plus
`pnpm audit --audit-level high`.

---

## Per-step protocol

1. **Specify** — write or update the spec section first.
2. **Implement.**
3. **Test** — the new test must fail before the change and pass after.
4. **Review** — self-review against this file; run `verify`.
5. **Fix** — resolve everything found; re-run.
6. **Commit** — Conventional Commits, scoped.
7. **Push.**

---

## Standards

**Language.** TypeScript strict everywhere, plus `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature` and `verbatimModuleSyntax`. Node 22. `pnpm` workspaces.

**Dependencies.** `packages/engine` has **zero runtime dependencies** and it stays that way. It is
the part that must not break, and every dependency is a way for it to break without anyone changing
it. Timezone arithmetic uses `Intl`; there is no date library and there will not be one.

**Layering.** The engine knows nothing about Forge. Everything platform-specific lives in
`packages/forge-runtime` behind a port. If a change makes the engine import a `@forge/*` package,
the change is in the wrong place.

**Where bugs get fixed.** In the engine, never in an app. Five listings share it; a per-app
workaround is how a portfolio turns into five products.

---

## Testing

| Rule                                              | Why                                                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **No live network calls, ever**                   | Determinism in CI. Use the fixtures in `packages/engine/test/fixtures/` and `FakeJiraApi`.                      |
| **Every bug gets a failing test first**           | A metrics product that regresses silently loses the only thing it sells.                                        |
| **80% coverage floor on `packages/**`**           | Enforced by vitest thresholds; CI fails below it.                                                               |
| **Assert request counts, not just results**       | In ingestion tests, the number of Jira calls is what decides whether a real backfill trips a rate limit.        |
| **`MemoryStore` is the reference implementation** | The SQL adapter is expected to match its observable behaviour row for row. Resolve any ambiguity by reading it. |

### ★ The golden file

`packages/engine/test/golden/business-hours.golden.json` holds the business-hours expectations.

- **Every value in it was computed by hand**, and the arithmetic is written into the case's `why`
  field.
- **It is never regenerated from the implementation.** A regenerated golden file asserts only that
  the code still does what it currently does, which is worth nothing.
- If a change makes a case fail, **the change is wrong until the arithmetic in `why` says
  otherwise.**

Any change under `packages/engine/src/time/` or `packages/engine/src/changelog/` must be reviewed
against those `why` fields by hand. Those two directories are where a silent wrongness would live,
and a green test suite is not by itself evidence that a change to them is correct.

---

## Honesty rules

These are engineering standards here, not style preferences. The product sells numbers; the moment
a number is presented as more certain than it is, the product is worth less than nothing.

1. **Never claim a capability that has not been executed.** Anything unverified says so, in the
   code and in the docs. `forgeSqlExecutor`, `forgeJiraFetch`, the manifests and every UI Kit
   component are currently marked UNVERIFIED, and they stay marked until a tunnel session says
   otherwise.
2. **Estimates are labelled as estimates.** Storage size and Forge cost are modelled from row
   counts and published rates; the word "estimated" appears next to the number in the UI.
3. **Modelled revenue is never presented as measured.** Every such figure rests on an assumed 25%
   paying share Atlassian does not publish, and the assumption is restated wherever the figure is.
4. **Partial data is announced.** Incomplete indexing keeps a banner on screen; a truncated
   changelog badges the row and calls its total a lower bound.
5. **`0m` means zero, `—` means "never in this status", `<1m` means a real short interval.** These
   are three different facts and the formatter keeps them apart.
6. **Never claim superiority over a competitor.** The incumbents are rated 4.5-4.8 over hundreds of
   reviews. The one claim this product makes is about a documented limitation of Jira's own
   feature, and it is checkable in the UI.

---

## Security

- Least-privilege Forge scopes; **no write scope on any listing** — a manifest test asserts it.
- The project id comes from the Forge resolver **context**, never from a client payload.
- Every SQL value is bound. The only thing interpolated into statement text is a placeholder count.
- Every `LIMIT` is clamped. An unbounded read on a consumption-priced platform is a cost incident.
- JQL is redacted before any log line; Jira response bodies never cross to the browser.
- CSV cells beginning `=`, `+`, `-`, `@`, tab or CR are quote-prefixed.
- **No secrets in the repository.** `.forge/` and `.env` are git-ignored.

---

## Commits

Conventional Commits, scoped to the package or app:

```
feat(engine): sum status durations across re-entries
fix(forge-runtime): bind the project id instead of interpolating it
test(ui): cover the indexing banner's paused state
docs(runbook): add the first-tunnel checklist
```

Every commit message ends with:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: <session url>
```

Commit frequently. One giant commit at the end of a working session is not reviewable, and this
repository's history is part of its documentation.

---

## Adding a listing

The whole point of the architecture is that this is cheap. In order:

1. Add a `ListingPricing` entry in `packages/engine/src/config/pricing.ts`, including the honest
   `positioning` block (who you undercut **and** who is cheaper than you).
2. `apps/<key>/` with `package.json`, `tsconfig.json`, `manifest.yml`, `src/runtime.ts` (fifteen
   lines), `src/index.ts` (resolver wiring), `src/frontend/index.tsx` and `src/frontend/gadget.tsx`.
3. Add the project reference to the root `tsconfig.json`.
4. A report builder in `packages/forge-runtime/src/reports.ts` **only if** the question genuinely
   cannot be answered from the stored aggregates. If it needs a new ingestion path, stop and
   reconsider — that would falsify the portfolio thesis this repository exists to test.
5. A view model in `packages/ui/src/listing-models.ts`, with tests.
6. `test/manifests.test.ts` will fail until the app count matches the priced listings. That is
   intentional.
