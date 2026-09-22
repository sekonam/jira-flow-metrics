/**
 * End-to-end flows for the **Worklog Reports** listing.
 *
 * What these add over `apps/worklog-reports/test/frontend.test.tsx`: that suite
 * mounts the page against a frozen snapshot and proves each state renders.
 * These drive the real component tree in Chromium against the live
 * `ListingRuntime` — so an export button that builds the wrong report, a
 * "wider ranges only" list the resolver would refuse, or a re-index that never
 * changes the range in force all fail here and nowhere else.
 *
 * The flows share one runtime per app (see `scripts/e2e-ui.mjs`), so only the
 * extend-history flow touches settings and only it asserts on them.
 */

/**
 * Durations rendered in working time: `<1m`, `45m`, `2h`, `4h 30m`. Never a
 * day or a week component — see `toWorklogTable` in
 * `packages/ui/src/listing-models.ts`.
 */
const HOURS_AND_MINUTES = /^(?:<1m|\d+m|\d+h(?: \d+m)?)$/;

/** `4h 30m` → 4.5. Returns `null` for anything this table should never print. */
function hoursOf(value) {
  if (value === '<1m') return 0;
  const match = /^(?:(\d+)h)?(?: ?(\d+)m)?$/.exec(value);
  if (match === null || (match[1] === undefined && match[2] === undefined)) return null;
  return Number(match[1] ?? 0) + Number(match[2] ?? 0) / 60;
}

/** Every body row of the report table, as arrays of cell text. */
async function tableRows(page) {
  const rows = page.locator('table tbody tr');
  await rows.first().waitFor({ state: 'visible', timeout: 30_000 });
  return await rows.evaluateAll((trs) =>
    trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim())),
  );
}

/**
 * One summary tile, read the way it is built: `SummaryTiles` stacks a label,
 * a heading and a hint inside one box, so the tile is the label's own stack.
 */
async function tile(page, label) {
  const labelNode = page.getByText(label, { exact: true }).first();
  await labelNode.waitFor({ state: 'visible', timeout: 30_000 });
  const lines = (await labelNode.locator('xpath=ancestor::div[1]').innerText())
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return { label: lines[0], value: lines[1], hint: lines[2] };
}

/**
 * A chart block's text, in render order: title, subtitle, then a label and a
 * value per bar. The stand-in `BarChart` draws real text nodes beside each bar
 * (`packages/ui-harness/src/forge-host.tsx`), which is the only thing about
 * the chart a test — or a screen reader — can read.
 */
async function chartLines(page, title) {
  const heading = page.getByRole('heading', { name: title, exact: true });
  await heading.waitFor({ state: 'visible', timeout: 30_000 });
  const block = page.locator('div').filter({ has: heading }).last();
  return (await block.innerText())
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export const flows = [
  {
    /**
     * The load-bearing correctness rule of this listing.
     *
     * Logged time is what a person typed into Jira's "time spent" field, and
     * Jira renders a working day as 8 hours. Roll it up the way elapsed time
     * is rolled up — 24h to a day — and 30 logged hours reads "1d 6h" here
     * against Jira's own "3d 6h": a factor-of-three disagreement with the
     * source system, on the one number this listing sells.
     *
     * Delete this and the only thing standing between the page and that bug
     * is one optional argument (`WORKING_TIME`) at one call site. The suite
     * that checks the formatter cannot see whether the page passes it.
     */
    name: 'worklog: logged time is reported in hours and never rolled up into days',
    app: 'worklog-reports',
    screen: 'worklog-reports-page',
    async run({ page, expect }) {
      const total = await tile(page, 'Total logged');
      const rows = await tableRows(page);
      expect.ok(rows.length > 0, 'the report lists at least one contributor');

      const durations = [total.value, ...rows.map((row) => row[1])];
      for (const value of durations) {
        expect.absent(
          /\d\s*[dw]\b/.test(value),
          `logged time is rendered in hours, but "${value}" carries a day or week component — ` +
            'Jira counts a working day as 8 hours, so a rolled-up total disagrees with Jira ' +
            'by a factor of three on the one figure this listing exists to report',
        );
        expect.ok(
          HOURS_AND_MINUTES.test(value),
          `"${value}" is not an hours-and-minutes duration, which is the only shape a working-time total may take`,
        );
      }

      // And the hours-only rendering still adds up: the per-person cells,
      // read as hours, come to the total the tile states. A format that
      // silently changed base would break this even where no "d" appeared.
      const perPerson = rows.map((row) => hoursOf(row[1]));
      expect.absent(
        perPerson.some((hours) => hours === null),
        'every "Time logged" cell parses as hours and minutes',
      );
      const summed = perPerson.reduce((sum, hours) => sum + hours, 0);
      const stated = hoursOf(total.value);
      expect.ok(
        stated !== null && Math.abs(summed - stated) <= rows.length / 120 + 1e-9,
        `the per-person rows sum to ${String(summed)}h but the "Total logged" tile states ` +
          `"${total.value}" — the tile and the table are reading the same totals in different units`,
      );
    },
  },

  {
    /**
     * The tiles are a summary *of the table underneath them*, not a second
     * query. Someone reading the page compares them without thinking about
     * it, so a tile that disagrees with the row it summarises destroys trust
     * in both — and the two are built by different functions
     * (`toWorklogTiles` vs `toWorklogTable`) over the same report, which is
     * exactly where they can drift apart.
     */
    name: 'worklog: the tiles and the table state the same totals',
    app: 'worklog-reports',
    screen: 'worklog-reports-page',
    async run({ page, expect }) {
      const total = await tile(page, 'Total logged');
      const largest = await tile(page, 'Largest contributor');
      const rows = await tableRows(page);

      // The footnote is the table's own statement of the total.
      const footnote = page.getByText('logged across').first();
      await footnote.waitFor({ state: 'visible', timeout: 30_000 });
      const footnoteText = await footnote.innerText();
      expect.contains(
        footnoteText,
        `${total.value} logged across`,
        `the "Total logged" tile says "${total.value}" while the table's footnote states a different total`,
      );
      expect.contains(
        footnoteText,
        'not durations derived from timestamps',
        'the footnote says these totals are what people entered in Jira, not times this app inferred',
      );

      // The table is sorted largest-first, so the tile names its first row.
      expect.equal(
        largest.value,
        rows[0][0],
        'the "Largest contributor" tile names the person at the top of the table',
      );
      expect.equal(
        largest.hint,
        rows[0][1],
        "the tile's hint repeats that person's logged time exactly as the table's row does",
      );
      expect.contains(
        total.hint,
        'worklog entries',
        'the total tile says how many worklog entries it is built from',
      );
    },
  },

  {
    /**
     * The share column is what turns a list of totals into an answer to
     * "where did the time go". It is derived (`round(group / total * 100)`)
     * rather than reported by Jira, so it can silently become a share of
     * something else — a filtered subtotal, or the largest group — and still
     * look plausible.
     *
     * Two properties pin it: the shares cover the whole total, and the row
     * the page calls the largest contributor holds the largest share. Either
     * failing means the table and the tile are ranking by different numbers.
     */
    name: 'worklog: every row states its share of the total and the largest share leads the table',
    app: 'worklog-reports',
    screen: 'worklog-reports-page',
    async run({ page, expect }) {
      const rows = await tableRows(page);
      const shares = rows.map((row) => row[2]);
      for (const share of shares) {
        expect.ok(
          /^\d+%$/.test(share),
          `every row states its share of the total as a percentage, but one reads "${share}"`,
        );
      }

      const numbers = shares.map((share) => Number(share.replace('%', '')));
      const highest = Math.max(...numbers);
      expect.equal(
        numbers[0],
        highest,
        'the table is sorted largest-first, so the top row holds the largest share of the logged time',
      );

      // Rounded to whole percents, so the sum lands within one point per row.
      const sum = numbers.reduce((a, b) => a + b, 0);
      expect.ok(
        Math.abs(sum - 100) <= rows.length,
        `the shares sum to ${String(sum)}% — they are meant to be shares of the report's own ` +
          'total, so anything but 100% (bar rounding) means they are shares of something else',
      );
    },
  },

  {
    /**
     * The export must be the report on screen.
     *
     * Every app's export button used to invoke the *time-in-status* CSV
     * regardless of the page it sat on — a real shipped bug, recorded in the
     * docstring of `packages/forge-runtime/src/report-csv.ts`. It is one
     * default argument away from coming back (`handleExportCsv`'s `kind`
     * defaults to `'status'`), and nothing about the page changes when it
     * does: the button works, a modal opens, a CSV appears. Only the columns
     * are wrong.
     *
     * So this asserts the exact header row `worklogReportToCsv` produces, and
     * that the time-in-status header "Current status" is nowhere in the file.
     */
    name: 'worklog: Export CSV hands over the worklog report, not the time-in-status one',
    app: 'worklog-reports',
    screen: 'worklog-reports-page',
    async run({ page, expect }) {
      await page.getByRole('button', { name: 'Export CSV' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });
      const text = await dialog.innerText();

      expect.contains(
        text,
        'worklog-reports-10000.csv',
        'the modal names the file the worklog listing built, for the project on screen',
      );
      expect.contains(
        text,
        'Person,Hours logged,Entries,Issues',
        'the exported header row is the one `worklogReportToCsv` writes — this is the assertion ' +
          'that catches the export silently reverting to another listing’s report',
      );
      expect.absent(
        text.includes('Current status'),
        'the time-in-status header "Current status" is in this file, so the worklog page has ' +
          'exported the wrong report — the exact bug `report-csv.ts` was written to end',
      );
      expect.absent(
        text.includes('History complete'),
        'the time-in-status trailing column "History complete" is in this file, so the export is ' +
          'the status report rather than the worklog one',
      );

      // Hours, not "4h 30m": a CSV lands in a spreadsheet, where a duration
      // string cannot be summed.
      expect.contains(
        text,
        'Anna Weber,4.5',
        'durations are exported as decimal hours a spreadsheet can total, not as display strings',
      );
    },
  },

  {
    /**
     * The only control in the product that spends a customer's whole Jira
     * request budget, and the only one whose effect is invisible until you
     * come back to it. A snapshot test proves the modal renders; it cannot
     * prove the chosen range was stored, and "re-index" doing nothing at all
     * looks identical on screen.
     *
     * Also guards the two rules the resolver enforces and the control is
     * meant to respect, so a user never meets a refusal it could have
     * avoided: the range in force is stated, and only wider ranges are
     * offered (narrowing would leave already-stored rows the page claimed
     * were out of range).
     *
     * ⚠️ This is the one flow that mutates shared settings for this app, so
     * every assertion that depends on the new range lives here.
     */
    name: 'worklog: extending the indexed history stores the wider range and the control says so next time',
    app: 'worklog-reports',
    screen: 'worklog-reports-page',
    async run({ page, expect }) {
      const open = async () => {
        await page.getByRole('button', { name: 'Extend history' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 15_000 });
        await dialog.getByText('This project is indexed over').waitFor({ timeout: 15_000 });
        return dialog;
      };

      const dialog = await open();
      expect.contains(
        await dialog.innerText(),
        'This project is indexed over last 12 months',
        'the control names the range currently in force before offering to change it',
      );

      await dialog.getByRole('combobox').click();
      const options = page.getByRole('option');
      await options.first().waitFor({ state: 'visible', timeout: 15_000 });
      const offered = await options.allInnerTexts();
      expect.ok(offered.includes('All history'), 'all history is offered as the widest range');
      expect.absent(
        offered.includes('Last 12 months'),
        'the range already in force is offered as a "new" range — re-indexing for no change in ' +
          'coverage is refused by the resolver, so offering it can only produce an error',
      );
      expect.absent(
        offered.some((label) => label === 'Last 6 months' || label === 'Last 3 months'),
        'a narrower range is offered — narrowing cannot delete the rows already stored, so the ' +
          'report would keep showing history the page had just claimed was out of range',
      );

      await page.getByRole('option', { name: 'Last 2 years', exact: true }).click();
      await page.getByRole('button', { name: 'Re-index' }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 30_000 });

      // The round trip: the resolver stored it, and the control reads it back.
      const reopened = await open();
      expect.contains(
        await reopened.innerText(),
        'This project is indexed over last 2 years',
        'after re-indexing, the control states the new range — if it still says twelve months the ' +
          'setting never reached the store and the backfill covered the old window',
      );
    },
  },

  {
    /**
     * The chart is titled "Time logged per person" rather than "Time logged"
     * on purpose: the table's own column header is "Time logged", and two
     * identical text nodes on one screen give a screen-reader user two
     * indistinguishable landmarks — "Time logged" announced twice, once as a
     * heading and once as a sortable column, with no way to tell which is
     * which.
     *
     * A future tidy-up that shortens the chart title would restore that
     * ambiguity and look like an improvement in review. This is the guard.
     */
    name: 'worklog: the chart title is distinct from the table’s own "Time logged" column',
    app: 'worklog-reports',
    screen: 'worklog-reports-page',
    async run({ page, expect }) {
      const chartTitle = page.getByRole('heading', { name: 'Time logged per person', exact: true });
      await chartTitle.waitFor({ state: 'visible', timeout: 30_000 });
      expect.equal(await chartTitle.count(), 1, 'the chart is headed "Time logged per person"');

      await page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 30_000 });
      const headers = (await page.locator('table thead th').allInnerTexts()).map((text) =>
        text.trim(),
      );
      expect.equal(
        headers.filter((header) => header === 'Time logged').length,
        1,
        'the table still carries its own "Time logged" column header',
      );

      // The point of the longer title: exactly one element on this screen
      // reads "Time logged", so the two are never announced identically.
      expect.equal(
        await page.getByText('Time logged', { exact: true }).count(),
        1,
        'two elements on this screen read exactly "Time logged" — the chart title is meant to be ' +
          '"Time logged per person" precisely so a screen reader has one of each, not two ' +
          'indistinguishable landmarks',
      );

      // Two elements, in two different places: the heading is not in the
      // table, and the column header is.
      expect.equal(
        await page
          .locator('table')
          .getByRole('heading', { name: 'Time logged per person' })
          .count(),
        0,
        'the chart heading sits outside the table, so the two "Time logged…" strings are separate ' +
          'elements in separate landmarks',
      );

      // And the chart is the same ranking as the tile above it.
      const lines = await chartLines(page, 'Time logged per person');
      const largest = await tile(page, 'Largest contributor');
      expect.equal(
        lines[2],
        largest.value,
        'the chart is drawn largest-first, so its first bar is the person the tile calls the ' +
          'largest contributor — a chart ordered differently contradicts the tile beside it',
      );
    },
  },

  {
    /**
     * A dashboard gadget is a card among many on somebody else's dashboard —
     * often the only surface a person who did not install the app ever sees.
     * It shows the tiles and stops there; dropping a 25-row table into a
     * dashboard card is how a gadget gets removed from it.
     *
     * The gadget and the page are separate files that import the same view
     * models, so "the gadget started rendering the full table" is a one-line
     * change nothing else catches.
     */
    name: 'worklog: the dashboard gadget shows the summary tiles and not the whole table',
    app: 'worklog-reports',
    screen: 'worklog-reports-gadget',
    async run({ page, expect }) {
      await page.getByRole('heading', { name: 'Worklog Reports' }).waitFor({ timeout: 30_000 });
      const total = await tile(page, 'Total logged');
      const largest = await tile(page, 'Largest contributor');
      expect.ok(
        HOURS_AND_MINUTES.test(total.value),
        `the gadget's total is a working-time duration, but it reads "${total.value}"`,
      );
      expect.ok(largest.value.length > 0, 'the gadget names the largest contributor');

      expect.equal(
        await page.locator('table').count(),
        0,
        'the gadget has rendered a table — it is a card on a shared dashboard, and the full ' +
          'per-person table belongs on the project page it links to',
      );
      expect.equal(
        await page.getByText('Share', { exact: true }).count(),
        0,
        'a table column header has reached the gadget, so the report table is being rendered there',
      );
    },
  },

  {
    /**
     * `jira:adminPage` is instance-wide and reachable by any Jira admin,
     * including admins with no browse permission on the projects this app has
     * indexed. So the page answers "what is this app storing" in rows and
     * bytes, and **nothing issue-shaped may appear on it** — one issue key
     * here is a permission leak the platform will not catch for us.
     *
     * The estimate caveat matters for a different reason: these bytes are
     * computed from row counts and per-row constants, not measured, and an
     * admin sizing a Forge bill against them deserves to be told.
     */
    name: 'worklog: the admin page reports rows per table, calls the size an estimate, and names no issue',
    app: 'worklog-reports',
    screen: 'worklog-reports-admin',
    async run({ page, expect }) {
      await page
        .getByRole('heading', { name: 'Worklog Reports — storage' })
        .waitFor({ timeout: 30_000 });

      const headers = await page.locator('table thead th').allInnerTexts();
      expect.equal(
        headers.map((header) => header.trim()).join('|'),
        'Table|Rows|Estimated size',
        'the admin table reports a row count and a size per Forge SQL table',
      );

      const rows = await tableRows(page);
      const worklogRow = rows.find((row) => row[0] === 'worklog');
      expect.ok(worklogRow !== undefined, 'the worklog table this listing fills is listed by name');
      expect.ok(
        /^[\d,]+$/.test(worklogRow[1]),
        `the worklog table's row count is a number, but it reads "${worklogRow[1]}"`,
      );

      const body = await page.locator('body').innerText();
      expect.contains(
        body,
        'Estimated from row counts',
        'the page says the size is estimated from row counts rather than measured on disk, so an ' +
          'admin does not size a Forge bill against a figure this app cannot actually measure',
      );
      expect.absent(
        body.includes('FLOW-'),
        'an issue key appears on the instance-wide admin page, which any Jira admin can open — ' +
          'including one with no browse permission on the project it came from',
      );
    },
  },
];
