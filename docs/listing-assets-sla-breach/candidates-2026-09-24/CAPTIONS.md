# Listing 4 — SLA & Due Dates · captured 2026-09-24, real Jira, `development` install at HEAD

Cropped from `../raw-2026-09-24/`. JFMB, 300 issues. First live render this app has ever had.

| File                              | Caption (≤120 chars)                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `01-goal-editor.png`              | Set the target in working hours, pick which statuses count, and name the goal for the project. |
| `02-attainment-and-due-dates.png` | 100% inside the working-time target — and 151 issues still late against their due date.        |
| `03-due-date-contrast-table.png`  | "Within target" and "late by 40d 8h" on the same row: two different questions, one table.      |

Shots 02 and 03 are the same render at an **80-working-hour** target, so they are a matched
pair and the 151 in the tile is the same 151 the `Due date` column is counting.

## The distribution chart is not here, and will not be

`How close to the target` renders as **one bar** on this tenant, at every target. It is not a
bug and not a crop problem: every JFMB issue carries 66h50m-66h53m of working time, three
minutes apart across 300 issues, because the seeder walked all of them through their
transitions inside one run and **REST cannot backdate a changelog entry**. JFM is no better —
`../../../tools/seed-report.md` records ten of its re-entry margins as "too small to see" for
the same reason.

So the chart is honest and useless at once, exactly like the cumulative-flow chart that
`../../CAPTURE-PLAN-2026-09-24.md` already cut from listing 3. **Unblocking it is a re-seed
with real dwell across days, not a wait and not a different target.** Do not shoot it, and do
not reach for a target value that splits the bar — none does.

The 8-hour default (in `../raw-2026-09-24/01-goal-editor-and-tiles.jpg`) reads
**Attainment 0% · Breached 300**, which is the same uniformity seen from the other side.
`01-goal-editor.png` is cropped above the tiles for that reason.
