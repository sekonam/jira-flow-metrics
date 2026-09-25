# E2E TEST PLAN — driving the product from the UI

Written 2026-09-25, while doing it. Everything marked **✓ added** below was written in that pass
and is in the suite; everything marked **gap** is not, and says why.

---

## The four layers, and what each one cannot prove

Knowing which layer a claim belongs to is most of the work. A test at the wrong layer passes for
the wrong reason.

| Layer                    | Runs                                               | Proves                                                 | Blind to                                                      |
| ------------------------ | -------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| Unit (`packages/*/test`) | Node, no DOM                                       | Arithmetic, formatting, request shaping                | Whether any screen calls it                                   |
| Component (`jsdom`)      | Stand-in Forge host                                | Every state renders; axe WCAG 2.1 AA                   | What happens on the **second** render                         |
| `screen-contract.tsx`    | jsdom, every surface × every state                 | Loading / error / empty / permission / partial-history | Whether a user can reach those states                         |
| **`e2e:ui` flows**       | Real Chromium, real components, **live** resolvers | A person doing something, and state that round-trips   | Forge's own renderer; Atlassian's bridge; a deployed resolver |

Below all four: `docs/RUNBOOK.md` § 3, on a real tenant. Nothing in this repository can replace it.

The `e2e:ui` layer is the one this plan is about. Each flow drives the real component tree in real
Chromium, and every `invoke` travels the real `@forge/bridge` client — argument validation, rate
limiter and error types included — to a live `ListingRuntime`: real engine, real store, seeded from
recorded Jira fixtures and **kept alive between calls**, so a saved goal comes back on the next
render or the flow fails.

---

## The fixture, because every assertion below is anchored to it

Four issues, clock fixed at `2026-03-05T12:00Z`:

| Issue  | Assignee   | Type | Created          | Notable                                    |
| ------ | ---------- | ---- | ---------------- | ------------------------------------------ |
| FLOW-1 | Ben Ito    | Bug  | 2026-02-23 08:00 | In Progress since 23 Feb                   |
| FLOW-2 | Anna Weber | Bug  | 2026-03-03 10:00 | Blocked since 3 Mar                        |
| FLOW-3 | Anna Weber | Bug  | 2026-03-02 08:00 | The canonical re-entry issue; Done         |
| FLOW-4 | _none_     | Task | 2026-03-05 08:00 | Unassigned, still To Do, never In Progress |

Two properties of this set do most of the work. **Anna has no Tasks and the only Task is
unassigned**, so "Anna" + "Task" is a combination with no answer — which is how a filter that
_replaces_ rather than _intersects_ can be told from one that works. And **FLOW-3 was created at
08:00**, not midnight, so a `created to` bound on 2 March distinguishes "end of that day" from
"start of it".

---

## Dimensions, and where each is covered

### 1. State that round-trips — **well covered before this pass**

Saved SLA goals surviving a reload, an extended history window coming back changed, the basis
toggle re-fetching, exports carrying the state on screen. Eight flows per listing.

### 2. Two parts of one screen agreeing — **partly covered; extended**

The existing flows pair a tile against its table. Added: the chart against its population.

- ✓ added — `wip-aging: the age buckets account for every issue the tile counts`. "All six buckets
  render" was covered; whether they _account for_ the population was not. An overlapping boundary
  double-counts and a gap drops, and both draw a perfectly plausible histogram. Mutation-checked by
  widening `7-14d` to start at 1 day: sum 4, tile 3, red.
- ✓ added — `sla: counting only some statuses changes the numbers and the caption names them`. The
  target was covered; the counted-status chips — the other half of the goal — were not. Asserts
  both directions: a caption that moves while the numbers do not describes a measurement the page
  never performed, and numbers that move under an unchanged caption are the same lie read backwards.

### 3. Controls that compose — **not covered before this pass**

- ✓ added — `time-in-status: a second filter narrows the first instead of replacing it`.
- ✓ added — `time-in-status: switching to working hours keeps the filters it was read under`. The
  toggle builds its own payload, so it is the natural place to drop the filters and silently widen
  the report under a reader who is watching the caption rather than the row count.

### 4. Boundaries — **not covered before this pass**

- ✓ added — `time-in-status: "Created to" includes the whole of the day it names`.
- ✓ added — seven unit tests for `filtersToRequest`, which had **none**. The dangerous line in it
  is the `+ 86_400_000`: a half-open window ending at 00:00 of the picked day drops a whole day
  from every report, invisibly unless something was created that day. It surfaces as "the
  month-end numbers look a bit low". Mutation-checked by deleting the term.

### 5. The honesty requirements (`PRODUCT-SPEC.md` § 9) — **one was untested anywhere**

| #   | Requirement                                            | Covered by                |
| --- | ------------------------------------------------------ | ------------------------- |
| 1   | The indexing banner stays while indexing is incomplete | `screen-contract.tsx`     |
| 2   | Truncated changelogs badged "partial history"          | `screen-contract.tsx`     |
| 3   | "Estimated" next to every estimate                     | the four admin-page flows |
| 4   | `<1m` never `0m`; never-entered reads `—` never `0m`   | ✓ added (see below)       |

- ✓ added — `time-in-status: a status the issue was never in reads an em dash, not 0m`. FLOW-4 has
  never left To Do. "Never entered" and "entered and left inside a minute" are different facts, and
  `0m` states the second about the first. A change that rendered empty cells as zero would look
  tidier and be a lie.

### 6. Claims made in the negative — **not covered before this pass**

The listings promise things the product _does not_ do, and an absence is harder to test than a
presence: nothing fails, no assertion is obviously missing, and the claim quietly stops being true.

- ✓ added — `worklog: an entry with no stated duration is dropped, never counted as a zero`. This
  listing's central promise in its negative form. Counted as zero, Cara Nowak appears at `0m` and
  `0%`, joins the share arithmetic, and makes the report state that she logged nothing this period
  — a claim about a person produced by a rounding decision. `worklogs.json` carries her entry with
  no `timeSpentSeconds` for this test and no other reason.
- ✓ added — `time-in-status: the CSV export carries the filters, not just the basis`. The existing
  export flow proved the basis half only, and the filters are the half more likely to rot: the
  basis is one scalar visible in the caption, the filters are four fields in a separate component,
  and a refactor that forgets them produces a file that opens cleanly, totals correctly and answers
  a different question. Nobody re-reads a CSV against the screen it came from. Mutation-checked by
  dropping `filtersToRequest` from the export payload.
- ✓ added — `worklog: every row states a share of the same whole`. A share computed against a
  different denominator than the total gives every row a plausible percentage and a table that adds
  to 80%, which nobody notices because nobody adds up percentages by eye.

### 7. Keyboard — **one step, where the trap would be**

- ✓ added, inside the CSV-filter flow — **Escape closes the export modal.** A modal that traps a
  keyboard user is an accessibility failure axe cannot see: the markup is correct and the behaviour
  is not. This is the only dialog in the product, and Escape is the only way out of it for someone
  not using a mouse. A full tab-order pass is still a gap.

### 8. States a user reaches by clicking — **this is where the defect was**

`screen-contract.tsx` proves the empty screen exists. It cannot prove a person can arrive at it, or
that what it says is true when they do.

**Defect found and fixed:** filtering `time-in-status` to no results answered **"No indexed issues
yet"** with a **Start indexing** button, on a fully indexed project. The statement is false and the
action re-walks the whole project from Jira to fix what one click on _Clear filters_ fixes — offered
to a reader who has just filtered, which is when they are least likely to suspect the filters. Same
confusion `gadgetEmptyMessage` was written for, one surface over. Fixed in `39e93d5`; the flow that
found it is now its regression guard.

The other four listings have no filter control, so their empty state genuinely is "nothing indexed"
or, for WIP aging, "nothing in flight". The distinction therefore lives in the time-in-status
frontend rather than in `EmptySurface`.

---

## Gaps this pass did not close, and why

- **Issue-history pagination.** The table pages at 25 rows and the fixture does not reach a second
  page, so nothing can drive one. Closing it means a larger fixture, not another flow.
- **Cap banners.** Every cap on this fixture is orders of magnitude away — 500-row reports against
  four issues. The banner arithmetic is unit-tested; the banner _rendering_ is in the component
  suite; nothing exercises a real one end to end, and nothing on this fixture can.
- **CSV formula defusing, visible in the export modal.** No fixture value starts with `=`, `+`, `-`
  or `@`. The escaping is unit-tested in `packages/engine/test`; seeing it survive to the modal
  needs a fixture written for it.
- **The two window pickers bounding each other.** `minDate`/`maxDate` are props and invisible in
  the DOM, so a component test asserting two labels exist would pass under the name of a claim it
  never touches. The guard that does cover it is the stand-in's prop scanner: `forge-host.tsx`
  declares both precisely so a host that accepted and ignored them fails.
- **Keyboard-only operation, beyond the modal.** axe audits the markup and one flow now presses
  Escape; nothing tabs through a whole page in order. Worth a pass of its own.

---

## One trap, written down because it cost real time

The filter's date fields take **`M/D/YYYY`, not ISO**, when typed. The picker's `value` prop speaks
ISO — so does the filter state, and so does the request — but the typed field is ADS's and parses in
the display locale. Typing `2026-03-02` does not fail: it parses into some other date and the table
narrows to the wrong rows, which reads exactly like a broken filter and sent one investigation into
product code that turned out to be correct.

`fill()` does not work at all: it sets the DOM value under a controlled React input and fires none
of the events the widget commits on, so the value is dropped silently. Use `pressSequentially` and
Enter. Both facts are in the helper's doc comment in `time-in-status.flows.mjs`.

---

## Running it

```
pnpm run e2e:ui                  # all flows, 6 at a time
JFM_E2E_LANES=2 pnpm run e2e:ui  # fewer lanes when debugging
```

Flows run in parallel against **one live runtime per listing**, so a flow must not assert on state
another flow could have changed. The rules in force: no flow asserts a count of saved SLA goals, each
saves under its own `E2E …` name, and the three flows that mutate settings keep every assertion that
depends on the mutation inside themselves.

At the time of writing: **50 flows, all passing**, plus 10 new unit tests for the report filters.

Every flow added in this pass was mutation-checked — the change that should break it was made, the
suite went red, and the change was reverted. A flow that stays green with the thing it tests
removed is not a test, and this suite has produced that before (`docs/SUBMISSION-CHECKLIST.md`
records two).
