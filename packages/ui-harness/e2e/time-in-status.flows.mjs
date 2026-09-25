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

/**
 * Type a date into one of the window pickers and commit it.
 *
 * ⚠️ `M/D/YYYY`, not ISO, and the difference is not cosmetic. The picker's
 * `value` prop speaks ISO — so does the filter state, and so does the
 * request — but the *typed* field is ADS's, and it parses in the display
 * locale. Typing `2026-03-02` does not fail: it parses into some other date
 * and the table narrows to the wrong rows, which reads exactly like a broken
 * filter. That cost a round of investigation into product code that turned
 * out to be correct, so the format is stated here rather than left to the
 * next reader.
 *
 * `fill()` does not work at all — it sets the DOM value under a controlled
 * React input and fires none of the events the widget commits on, so the
 * value is silently dropped. Hence `pressSequentially` and Enter.
 */
async function setDate(page, inputId, displayDate) {
  const input = page.locator(`#${inputId}`);
  await input.click();
  await input.pressSequentially(displayDate, { delay: 30 });
  await input.press('Enter');
}

/** Choose one option from an `@atlaskit/select` by its visible label. */
async function chooseOption(page, inputId, label) {
  await page.locator(`#${inputId}`).press('ArrowDown');
  const option = page.getByRole('option', { name: label, exact: true });
  await option.waitFor({ state: 'visible', timeout: 15_000 });
  await option.click();
}

export const flows = [
  {
    /**
     * The filters narrow the real store, not just the request.
     *
     * The unit tests prove the picker puts `assigneeAccountIds` on the
     * payload; this proves the *product* answers it — the same fixture
     * issues run through the real ingester, filtered by the real SQL-shaped
     * predicate, rendered back with the rows it excluded genuinely gone.
     * FLOW-1 belongs to Ben and FLOW-4 to nobody, so a filter for Anna that
     * still shows either is a picker naming a value the table ignores — the
     * defect class the round-one Select fix documented.
     */
    name: 'time-in-status: filtering by assignee narrows the table and clearing restores it',
    app: 'time-in-status',
    screen: 'time-in-status-page',
    async run({ page, expect }) {
      await page.getByText('FLOW-3').first().waitFor({ state: 'visible', timeout: 15_000 });
      expect.ok(await page.getByText('FLOW-1').count(), 'FLOW-1 visible before filtering');

      await page.locator('#filter-assignee').press('ArrowDown');
      const option = page.getByRole('option', { name: 'Anna Weber', exact: true });
      await option.waitFor({ state: 'visible', timeout: 15_000 });
      await option.click();

      // Anna's issues stay; Ben's and the unassigned one go.
      await page
        .getByText('FLOW-1')
        .first()
        .waitFor({ state: 'detached', timeout: 15_000 })
        .catch(() => undefined);
      expect.equal(await page.getByText('FLOW-1').count(), 0, 'FLOW-1 gone under the Anna filter');
      expect.equal(await page.getByText('FLOW-4').count(), 0, 'FLOW-4 gone under the Anna filter');
      expect.ok(await page.getByText('FLOW-3').count(), 'FLOW-3 still present');
      expect.ok(await page.getByText('FLOW-2').count(), 'FLOW-2 still present');

      // Clearing brings the full table back.
      await page.getByRole('button', { name: 'Clear filters' }).click();
      await page.getByText('FLOW-1').first().waitFor({ state: 'visible', timeout: 15_000 });
      expect.ok(await page.getByText('FLOW-4').count(), 'FLOW-4 back after clearing');
    },
  },
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
      // This used to fail, and the comment here used to say so at length —
      // `runPipeline` built the live runtime's `SettingsStore` on a
      // `RecordingSqlExecutor`, which answers every SELECT with no rows, so
      // `backfillMonths` reverted to 12 on the very next read. That was a
      // defect in the fixture rather than in the product, and it is fixed
      // (`SettingsSqlExecutor`). The note is kept short deliberately: a
      // stale "this is broken" comment on a passing flow is its own kind of
      // lie, and this one claimed a live data-correctness bug that does not
      // ship.
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
      // ★ And a real count is read, not just the presence of rows. Asserting
      // only that rows are *listed* passed unchanged when every count was
      // rendered as "0" — a storage page reporting an empty database for a
      // populated one is exactly what this flow is supposed to catch.
      const issueMetaRow = (
        await table.locator('tbody tr').filter({ hasText: 'issue_meta' }).first().innerText()
      ).split('\t');
      expect.ok(
        /^[1-9][\d,]*$/.test((issueMetaRow[1] ?? '').trim()),
        `issue_meta reports what the pipeline actually stored, but it reads "${(issueMetaRow[1] ?? '').trim()}"`,
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
  {
    /**
     * `Created to` means the end of the day it names, not the start of it.
     *
     * `filtersToRequest` adds a day to the picked date for exactly this
     * reason, and a comment says so — but a comment is not a guard, and the
     * half-open `[from, to)` window it corrects for is the natural thing to
     * write. Get it wrong and every "to" filter silently drops its last day,
     * which no one notices until a month-end report is short.
     *
     * FLOW-3 is the probe: created 2026-03-02 **08:00**, so a bound at UTC
     * midnight of the 2nd excludes it and a bound at the end of the 2nd keeps
     * it. FLOW-1 (02-23) must stay either way, and FLOW-2 (03-03) and FLOW-4
     * (03-05) must go either way — so the flow fails loudly if the filter
     * stopped working altogether rather than passing on a technicality.
     */
    name: 'time-in-status: "Created to" includes the whole of the day it names',
    app: 'time-in-status',
    screen: 'time-in-status-page',
    async run({ page, expect }) {
      await page.getByText('FLOW-3').first().waitFor({ state: 'visible', timeout: 15_000 });

      await setDate(page, 'filter-created-to', '3/2/2026');
      await page
        .getByText('FLOW-2')
        .first()
        .waitFor({ state: 'detached', timeout: 15_000 })
        .catch(() => undefined);

      expect.ok(
        await page.getByText('FLOW-3').count(),
        'FLOW-3 was created at 08:00 on the day the bound names, so the bound keeps it — ' +
          'a window ending at that day’s midnight would drop it',
      );
      expect.ok(await page.getByText('FLOW-1').count(), 'FLOW-1 (23 Feb) is inside the window');
      expect.equal(await page.getByText('FLOW-2').count(), 0, 'FLOW-2 (3 Mar) is outside it');
      expect.equal(await page.getByText('FLOW-4').count(), 0, 'FLOW-4 (5 Mar) is outside it');
    },
  },
  {
    /**
     * Filters compose. Choosing a second one narrows what the first left.
     *
     * The failure this catches is a filter that *replaces* rather than
     * intersects — easy to write, since each control owns one field of one
     * request, and invisible whenever the two happen to agree. Anna has only
     * Bugs and the only Task is unassigned, so "Anna" and "Task" together can
     * have no answer: under an AND the table empties, and under a replace it
     * shows one issue or the other. One assertion tells them apart.
     *
     * The empty result is worth driving for its own sake too. It is the one
     * state a user reaches by ordinary clicking rather than by a broken
     * backend, and a page that renders a blank table there says nothing at
     * all — `screen-contract.tsx` proves the empty screen exists, and this
     * proves a person can actually arrive at it.
     */
    name: 'time-in-status: a second filter narrows the first instead of replacing it',
    app: 'time-in-status',
    screen: 'time-in-status-page',
    async run({ page, expect }) {
      await page.getByText('FLOW-3').first().waitFor({ state: 'visible', timeout: 15_000 });

      await chooseOption(page, 'filter-issue-type', 'Task');
      await page
        .getByText('FLOW-3')
        .first()
        .waitFor({ state: 'detached', timeout: 15_000 })
        .catch(() => undefined);
      expect.ok(await page.getByText('FLOW-4').count(), 'the only Task survives the type filter');
      expect.equal(await page.getByText('FLOW-3').count(), 0, 'a Bug does not');

      await chooseOption(page, 'filter-assignee', 'Anna Weber');
      await page
        .getByText('FLOW-4')
        .first()
        .waitFor({ state: 'detached', timeout: 15_000 })
        .catch(() => undefined);

      expect.equal(
        await page.getByText('FLOW-').count(),
        0,
        'Anna has no Tasks, so the two filters together have no answer — a table still ' +
          'showing FLOW-4 means the assignee filter replaced the type filter rather than ' +
          'narrowing it',
      );

      // ★ The defect this flow found, now its regression guard.
      //
      // A fully indexed project answered "No indexed issues yet" here, under
      // a **Start indexing** button — a false statement above an action that
      // re-walks the whole project from Jira to fix something *Clear filters*
      // fixes. Both strings are asserted, because either one alone could come
      // back on its own.
      const body = await page.innerText('body');
      expect.contains(
        body,
        'No issues match these filters',
        'an empty result caused by filtering says that, rather than blaming the index',
      );
      expect.absent(
        body.includes('No indexed issues yet'),
        'this project is fully indexed, so the page must not say otherwise',
      );
      expect.equal(
        await page.getByRole('button', { name: 'Start indexing' }).count(),
        0,
        're-indexing would not change this result, so it is not the action offered',
      );

      // The offered action is the one that actually helps, and it works:
      // `EmptySurface`'s button clears the filters and the report comes back.
      await page.getByRole('button', { name: 'Clear filters' }).first().click();
      await page.getByText('FLOW-3').first().waitFor({ state: 'visible', timeout: 15_000 });
      expect.ok(await page.getByText('FLOW-4').count(), 'the whole project is listed again');
    },
  },
  {
    /**
     * The basis toggle re-fetches. The filters have to survive that.
     *
     * Two pieces of state feed one request, and the toggle's handler builds
     * its own payload — so "switch to working hours" is the obvious place to
     * drop the filters and quietly widen the report under a reader who is
     * watching the caption change and not the row count. The caption is
     * asserted alongside for the same reason: a toggle that keeps the filters
     * and forgets to re-label is the other half of the same bug.
     */
    name: 'time-in-status: switching to working hours keeps the filters it was read under',
    app: 'time-in-status',
    screen: 'time-in-status-page',
    async run({ page, expect }) {
      await page.getByText('FLOW-3').first().waitFor({ state: 'visible', timeout: 15_000 });

      await chooseOption(page, 'filter-assignee', 'Anna Weber');
      await page
        .getByText('FLOW-1')
        .first()
        .waitFor({ state: 'detached', timeout: 15_000 })
        .catch(() => undefined);
      expect.equal(await page.getByText('FLOW-1').count(), 0, 'Ben’s issue is filtered out');

      await page.getByRole('button', { name: 'Working hours' }).click();
      await page.waitForFunction(() => /working hours/i.test(document.body.innerText), undefined, {
        timeout: 15_000,
      });

      expect.ok(await page.getByText('FLOW-3').count(), 'Anna’s issues are still listed');
      expect.equal(
        await page.getByText('FLOW-1').count(),
        0,
        'the re-fetch carried the assignee filter with it — otherwise the toggle silently ' +
          'widens the report while the reader is watching the caption',
      );
    },
  },
  {
    /**
     * A status the issue was never in reads an em dash, never `0m`.
     *
     * PRODUCT-SPEC § 9 honesty requirement 4, and the one on that list with
     * no test anywhere: "never entered" and "entered and left within the same
     * minute" are different facts, and `0m` says the second about the first.
     * The formatter is the only thing standing between them, and a change
     * that made empty cells render a zero would look tidier and be a lie.
     *
     * FLOW-4 is still in To Do, so it has never been in In Progress.
     */
    name: 'time-in-status: a status the issue was never in reads an em dash, not 0m',
    app: 'time-in-status',
    screen: 'time-in-status-page',
    async run({ page, expect }) {
      await page.getByText('FLOW-4').first().waitFor({ state: 'visible', timeout: 15_000 });

      const cell = await reportCell(page, 'FLOW-4', 'In Progress');
      expect.equal(
        cell,
        '—',
        'FLOW-4 has never left To Do, so its In Progress cell states "no such visit" with an ' +
          'em dash; "0m" would claim it went there and came straight back',
      );
    },
  },
];
