/**
 * End-to-end flows for the Time in Status listing.
 *
 * `test/components.test.tsx` already proves every state of these four
 * surfaces *renders*. What it cannot prove is what happens next, and every
 * claim this listing makes commercially lives in "next": the basis toggle is
 * a re-fetch, the export has to carry the basis the reader is looking at, and
 * the history window has to come back changed on the following call. Those
 * are the four ways this product can be wrong while every screenshot looks
 * right, so they are what these flows drive.
 *
 * The numbers asserted below are the ones `packages/forge-runtime/src/testing/pipeline.ts`
 * documents as `EXPECTED` for the canonical fixture — FLOW-3, created
 * 2026-03-02 08:00 UTC, which enters In Progress twice (4h, then 8h) for 12h
 * cumulative, 76h elapsed in total and 27h of working time. Nothing here is
 * hand-written: if the engine's arithmetic changes, these fail, which is the
 * intent.
 *
 * ⚠️ Flows run in parallel against **one** set of live runtimes, so nothing
 * below asserts on state another flow could have changed. The one flow that
 * mutates anything — "extend history", which rewrites the project's
 * `backfillMonths` and restarts its backfill — keeps every assertion that
 * depends on that mutation inside itself, and no other flow asserts on the
 * indexing banner or on the history window.
 */

/** The report table's column index for a header, so a reordered table fails loudly. */
async function columnIndex(table, header) {
  const headers = await table.locator('thead th').allInnerTexts();
  const index = headers.findIndex((text) => text.trim() === header);
  if (index === -1) {
    throw new Error(`the report table has no "${header}" column; it has: ${headers.join(' | ')}`);
  }
  return index;
}

/** One cell of one issue's row, by column name rather than by position. */
async function reportCell(page, issueKey, header) {
  const table = page.locator('table').first();
  const row = table.locator('tbody tr').filter({ hasText: issueKey }).first();
  await row.waitFor({ state: 'visible', timeout: 15_000 });
  return (
    await row
      .locator('td')
      .nth(await columnIndex(table, header))
      .innerText()
  ).trim();
}

/** Open an `@atlaskit/select` and return the labels it is offering. */
async function openSelect(page, inputId) {
  await page.locator(`#${inputId}`).click();
  const options = page.getByRole('option');
  await options.first().waitFor({ state: 'visible', timeout: 15_000 });
  return await options.allInnerTexts();
}

export const flows = [
  {
    /**
     * The product's entire argument in one screenshot: a status entered twice,
     * badged `x2`, against a figure that is the sum of both stays.
     *
     * Delete this flow and the listing can ship with the badge rendering from
     * one source and the duration from another — an issue shown as `x2` next
     * to only its most recent stay is the exact number Jira's own Control
     * Chart already gives, sold as the thing it is not. The two have to be on
     * screen together and they have to agree, which is why this reads one
     * cell rather than searching the page for either string.
     */
    name: 'time-in-status: a re-entered status shows its visit count beside a cumulative figure',
    app: 'time-in-status',
    screen: 'time-in-status-page',
    async run({ page, expect }) {
      const inProgress = await reportCell(page, 'FLOW-3', 'In Progress');

      // 4h on the first visit plus 8h on the second. Jira reports the 8h.
      expect.contains(
        inProgress,
        '12h',
        'FLOW-3 reports its two In Progress stays as one cumulative 12h figure',
      );
      // Compared case-insensitively on purpose: `ReportTable` writes the badge
      // as `x2`, and the Atlassian Design System's `Lozenge` uppercases its
      // own label, so what reaches the screen is `X2`. The claim under test is
      // the count beside the figure, not which case the design system picked.
      expect.contains(
        inProgress.toLowerCase(),
        'x2',
        'the same cell carries the visit-count badge, so the figure is visibly a sum and not a last stay',
      );

      // Blocked was entered once, so it carries no badge — otherwise the badge
      // would be decoration rather than a claim about this issue.
      const blocked = await reportCell(page, 'FLOW-3', 'Blocked');
      expect.contains(blocked, '1d 20h', 'FLOW-3 reports its single 44h Blocked stay');
      expect.absent(/x\d/i.test(blocked), 'a status entered once carries no visit-count badge');

      // The footnote is what makes the badge legible to a first-time reader;
      // it appears only because a re-entry is on screen.
      expect.contains(
        await page.innerText('body'),
        'entered that status more than once',
        'the table explains what the badge means, beneath the rows it applies to',
      );
    },
  },

  {
    /**
     * Elapsed vs working hours is a **re-fetch**, not a client-side reformat:
     * the button sets `basis`, which reaches `getReport` and changes which
     * arithmetic the engine runs.
     *
     * Deleted, the regression that ships is a toggle that repaints the caption
     * and leaves the numbers alone — the worst possible failure for this
     * listing, because the page would then be confidently labelling elapsed
     * time as working hours. Hence asserting the figure changed *and* changed
     * back, rather than only that the caption moved.
     */
    name: 'time-in-status: the working-hours toggle re-fetches and the figures change with the caption',
    app: 'time-in-status',
    screen: 'time-in-status-page',
    async run({ page, expect }) {
      await page.getByText('Showing elapsed time.').waitFor({ state: 'visible', timeout: 15_000 });
      const elapsedTotal = await reportCell(page, 'FLOW-3', 'Total');
      expect.equal(elapsedTotal, '3d 4h', 'FLOW-3 totals 76h of elapsed time across every status');

      await page.getByRole('button', { name: 'Working hours' }).click();
      // Wait for the caption the new response produced, not for a timeout:
      // the table unmounts while the re-fetch is in flight.
      await page.getByText('Showing working hours.').waitFor({ state: 'visible', timeout: 15_000 });

      const businessTotal = await reportCell(page, 'FLOW-3', 'Total');
      expect.equal(
        businessTotal,
        '27h',
        'the same issue totals 27h once nights and weekends are excluded',
      );
      expect.absent(
        businessTotal === elapsedTotal,
        'the numbers themselves change with the basis, not just the caption',
      );

      // Working time is reported in plain hours rather than rolled up into
      // days: "1d 3h" against an 8-hour day reads as 11 hours and means 27.
      expect.absent(
        businessTotal.includes('d'),
        'a working-time figure is never rolled up into days, which would read against an 8h day',
      );

      await page.getByRole('button', { name: 'Elapsed' }).click();
      await page.getByText('Showing elapsed time.').waitFor({ state: 'visible', timeout: 15_000 });
      expect.equal(
        await reportCell(page, 'FLOW-3', 'Total'),
        elapsedTotal,
        'switching back restores the elapsed figures, so the toggle is a view choice and not a one-way trip',
      );
    },
  },

  {
    /**
     * The export has to carry the basis the reader is looking at.
     *
     * `requestCsv` closes over `basis`, and a stale closure here is a silent,
     * plausible wrong file: the page says working hours, the spreadsheet holds
     * elapsed, and nothing on screen contradicts it. So this exports *after*
     * switching, and proves the two files hold different numbers rather than
     * only that a modal opened with a CSV in it.
     */
    name: 'time-in-status: the CSV exports the basis currently on screen, and closing returns to the report',
    app: 'time-in-status',
    screen: 'time-in-status-page',
    async run({ page, expect }) {
      const csvForFlow3 = async () => {
        await page.getByRole('button', { name: 'Export CSV' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 15_000 });
        const text = await dialog.innerText();
        expect.contains(
          text,
          'time-in-status-10000.csv',
          'the modal names the file the resolver built for this project',
        );
        const line = text.split(/\r?\n/).find((row) => row.startsWith('FLOW-3,'));
        expect.ok(line, 'the export holds a row for the canonical issue');
        return { text, line };
      };

      // Switch first: the export must follow the page, not the mount.
      await page.getByRole('button', { name: 'Working hours' }).click();
      await page.getByText('Showing working hours.').waitFor({ state: 'visible', timeout: 15_000 });

      const business = await csvForFlow3();
      // Hours to two decimals, per `statusReportToCsv`'s `durationFormat: 'hours'`.
      expect.contains(
        business.line,
        ',27,complete',
        'the working-hours export totals FLOW-3 at 27 hours, matching the page',
      );

      await page.getByRole('button', { name: 'Close' }).click();
      expect.equal(
        await page.getByRole('dialog').count(),
        0,
        'closing the export returns the reader to the report',
      );

      await page.getByRole('button', { name: 'Elapsed' }).click();
      await page.getByText('Showing elapsed time.').waitFor({ state: 'visible', timeout: 15_000 });

      const elapsed = await csvForFlow3();
      expect.contains(
        elapsed.line,
        ',76,complete',
        'the elapsed export totals the same issue at 76 hours',
      );
      expect.absent(
        elapsed.line.includes(',27,complete'),
        'the elapsed export does not carry the working-hours total it replaced',
      );
      expect.absent(
        business.text === elapsed.text,
        'the two exports differ, so the button re-exported rather than replaying a cached file',
      );
    },
  },

  {
    /**
     * Extending the indexed history is the only control in this listing that
     * writes something the next reader inherits, and the round trip is the
     * whole risk: a setting that saves but does not come back leaves the
     * control offering a widening that has already happened, and spends the
     * installation's entire Jira request budget every time somebody clicks it.
     *
     * A frozen snapshot cannot show this at all — it answers `getHistoryWindow`
     * with the same twelve months forever. So this asserts the range in force
     * *before*, that only wider ranges are offered (a narrower one would leave
     * rows on screen the page claims are out of range, and the resolver
     * refuses it), and the range in force *after* re-opening the control.
     *
     * ⚠️ This flow mutates the shared `time-in-status` runtime: it rewrites
     * `backfillMonths` and restarts the backfill. Every assertion that depends
     * on either lives here, and no other flow in this file reads the history
     * window or the indexing banner.
     */
    name: 'time-in-status: extending the indexed history offers only wider ranges and the new range sticks',
    app: 'time-in-status',
    screen: 'time-in-status-page',
    async run({ page, expect }) {
      await page.getByRole('button', { name: 'Extend history' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });
      await page.getByText('last 12 months').waitFor({ state: 'visible', timeout: 15_000 });

      expect.contains(
        await dialog.innerText(),
        'Re-indexes this project from the beginning',
        'the dialog states what the button spends before it is pressed',
      );

      const offered = (await openSelect(page, 'extend-history-range')).map((o) => o.trim());
      expect.absent(
        offered.includes('Last 12 months'),
        'the range already in force is not offered again — re-indexing for no extra coverage is refused',
      );
      expect.contains(
        offered.join(' | '),
        'Last 2 years',
        'a wider range than the one in force is offered',
      );
      expect.contains(
        offered.join(' | '),
        'All history',
        'all history is always offered, being the widest range there is',
      );

      await page.getByRole('option', { name: 'Last 2 years' }).click();
      await page.getByRole('button', { name: 'Re-index' }).click();

      // The dialog closes only once the resolver has accepted the widening.
      await dialog.waitFor({ state: 'detached', timeout: 20_000 });

      // The page reloaded: the backfill has restarted, so the report that
      // claimed a complete index now says indexing is under way. Without the
      // reload the banner would keep asserting a completeness that is no
      // longer true.
      await page.getByText('Indexing in progress').waitFor({ state: 'visible', timeout: 20_000 });

      // The round trip a snapshot cannot show: re-open the control and the
      // range in force has actually changed.
      //
      // ⚠️ FAILS TODAY, and deliberately left failing. `runPipeline` builds the
      // live runtime's `SettingsStore` on a `RecordingSqlExecutor`, which
      // records every write and answers every SELECT with no rows — so
      // `backfillMonths` reverts to the default 12 on the very next read.
      // `handlers.test.ts` already met this and built `StatefulSettingsSql` to
      // get past it ("the whole point is that the second sees the first"); the
      // fixture behind the live harness never got the same treatment. The
      // consequence is worse than a failing assertion: `setHistoryWindow`
      // writes the setting and then re-reads it to compute the backfill's lower
      // bound, so the re-index this flow just triggered covered twelve months
      // while telling the user it covered two years.
      await page.getByRole('button', { name: 'Extend history' }).click();
      const reopened = page.getByRole('dialog');
      await reopened.waitFor({ state: 'visible', timeout: 15_000 });
      await page
        .getByText('This project is indexed over')
        .waitFor({ state: 'visible', timeout: 15_000 });

      expect.contains(
        (await reopened.innerText()).replace(/\s+/g, ' '),
        'last 2 years',
        're-opening the control names the range just chosen, so the widening was stored rather than only accepted',
      );

      const reoffered = (await openSelect(page, 'extend-history-range')).map((o) => o.trim());
      expect.absent(
        reoffered.includes('Last 2 years'),
        'the range just chosen is no longer offered, so the control read back the stored window',
      );
    },
  },

  {
    /**
     * The issue panel is where the product's claim is checkable: it sits
     * directly beneath Jira's own History tab, on the same screen, and a
     * reader can compare them line by line.
     *
     * That only works if every visit is listed separately and in order. Folding
     * the two In Progress stays into one row, or dividing the 12h total by the
     * visit count, would produce two identical 6h rows — plausible, tidy, and
     * contradicted by the History tab six inches above it. Hence asserting the
     * two rows carry *different* durations.
     */
    name: 'time-in-status panel: every visit is listed in order, with re-entries as separate rows',
    app: 'time-in-status',
    screen: 'time-in-status-panel',
    async run({ page, expect }) {
      const visits = page.locator('table').first();
      await visits.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 15_000 });

      const statuses = await visits.locator('tbody tr td:nth-child(1)').allInnerTexts();
      expect.equal(
        statuses.map((s) => s.trim()).join(' → '),
        'To Do → In Progress → Blocked → In Progress → In Review → Done',
        "the panel lists FLOW-3's six visits in the order they happened",
      );

      const first = visits.locator('tbody tr').nth(1);
      const second = visits.locator('tbody tr').nth(3);
      const firstElapsed = (await first.locator('td').nth(3).innerText()).trim();
      const secondElapsed = (await second.locator('td').nth(3).innerText()).trim();
      expect.equal(firstElapsed, '4h', 'the first In Progress stay lasted 4h');
      expect.equal(secondElapsed, '8h', 'the second In Progress stay lasted 8h');
      expect.absent(
        firstElapsed === secondElapsed,
        'the two stays are measured separately rather than as the total split evenly',
      );

      expect.contains(
        (await first.innerText()).trim(),
        '2 Mar 2026 09:00',
        'each visit is timestamped in UTC so it can be checked against the History tab above it',
      );
      expect.contains(
        await visits.locator('tbody tr').nth(5).innerText(),
        'still here',
        'the visit still in progress says so rather than inventing an exit time',
      );

      // The totals table is this one issue's row on the report page, and it is
      // where the visit count is a column rather than a badge.
      const totals = page.locator('table').nth(1);
      const inProgressTotal = totals.locator('tbody tr').filter({ hasText: 'In Progress' }).first();
      expect.equal(
        (await inProgressTotal.locator('td').nth(1).innerText()).trim(),
        '2',
        'the totals table names how many visits produced the In Progress figure',
      );
      expect.equal(
        (await inProgressTotal.locator('td').nth(2).innerText()).trim(),
        '12h',
        'and totals them at 12h, the same figure the report page shows',
      );
      expect.contains(
        await page.innerText('body'),
        'more than one visit',
        "the totals table says what a multi-visit status means against Jira's Control Chart",
      );

      // The tile figure is derived from status categories, not configured by
      // anyone. Presenting it unlabelled would read as a goal somebody set.
      expect.contains(
        await page.innerText('body'),
        'Against a derived goal',
        'the goal tile says the goal is derived rather than configured',
      );
    },
  },

  {
    /**
     * An admin page is instance-wide. `jira:adminPage` is reachable by any
     * Jira administrator, and Forge SQL is provisioned per installation, so
     * every figure here spans projects the reader may hold no permission on.
     *
     * One issue key on this page is a permission leak, and it is the kind that
     * arrives by accident — someone adds a "largest issues" table, or a debug
     * row, and nothing else in the repository would notice. So this searches
     * the whole rendered body for `FLOW-`, not one component's output.
     */
    name: 'time-in-status admin: reports rows per table as an estimate and leaks no issue-shaped data',
    app: 'time-in-status',
    screen: 'time-in-status-admin',
    async run({ page, expect }) {
      await page.locator('table').first().waitFor({ state: 'visible', timeout: 15_000 });
      const body = await page.innerText('body');

      expect.contains(body, 'Issues indexed', 'the page reports what this installation is holding');
      const table = page.locator('table').first();
      expect.contains(
        (await table.locator('thead').innerText()).replace(/\s+/g, ' '),
        'Rows',
        'the storage table reports a row count per table',
      );
      expect.ok(
        (await table.locator('tbody tr').count()) > 0,
        'every table this app owns is listed, including the ones holding nothing',
      );

      // Never presented as measured: it is row counts times per-row size
      // constants, and an admin comparing it to a Forge bill needs to know.
      expect.contains(
        body,
        'not measured on disk',
        'the figures are stated as an estimate rather than as a measurement',
      );

      expect.absent(
        body.includes('FLOW-'),
        'no issue key appears anywhere on an instance-wide page whose reader may not have permission on the project',
      );
    },
  },

  {
    /**
     * A gadget is a tile on a shared dashboard — seen, by design, by people
     * who did not install the app and may be looking at five other gadgets.
     * The summary belongs there; the per-issue table does not, and a table
     * that leaked into it would be unreadable at 520px as well as wrong.
     *
     * The failure this catches is the easy one: somebody reuses the page's
     * component tree in the gadget because it is the same data.
     */
    name: 'time-in-status gadget: shows the summary tiles only, never the per-issue table',
    app: 'time-in-status',
    screen: 'time-in-status-gadget',
    async run({ page, expect }) {
      await page.getByText('Time in Status').first().waitFor({ state: 'visible', timeout: 15_000 });
      const body = await page.innerText('body');

      expect.contains(body, 'Issues', 'the gadget shows the matching-issue count tile');
      expect.contains(
        body,
        'median',
        'the gadget shows the median-per-status tiles, which is the whole of what it reports',
      );

      expect.equal(
        await page.locator('table').count(),
        0,
        'the per-issue table stays on the project page and is not rendered in a dashboard tile',
      );
      expect.absent(
        body.includes('FLOW-'),
        'no individual issue appears in the gadget — it is a summary, and the table is one click away',
      );
      expect.equal(
        await page.getByRole('button', { name: 'Export CSV' }).count(),
        0,
        'the page-level actions are not repeated in the gadget',
      );
    },
  },
];
