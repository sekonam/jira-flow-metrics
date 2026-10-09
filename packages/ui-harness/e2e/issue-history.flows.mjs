/**
 * End-to-end flows for the **Issue History** listing.
 *
 * The product claim is narrow and checkable: Jira's own History tab is
 * per-issue and cannot be exported, and this is the same record cross-issue,
 * ordered, and exportable. Every flow below defends one half of that claim —
 * the ordering and the identity of a row on screen, or the file the export
 * button actually produces.
 *
 * These drive the real component tree in Chromium against the live
 * `ListingRuntime` (see `scripts/e2e-ui.mjs`). Flows share one runtime per
 * app, so only the extend-history flow touches settings and only it asserts on
 * them.
 */

/** `23 Feb 2026 09:00` — `formatDateTime`'s output, which is always UTC. */
const WHEN = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A rendered timestamp as a sortable number, or `null` if it is not one. */
function whenOf(value) {
  const match = WHEN.exec(value);
  if (match === null) return null;
  const month = MONTHS.indexOf(match[2]);
  if (month < 0) return null;
  return Date.UTC(Number(match[3]), month, Number(match[1]), Number(match[4]), Number(match[5]));
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
     * Every timestamp in this table is UTC, and the reader's Jira very likely
     * is not. A change listed at "09:00" with no zone stated is unusable for
     * the thing this listing is bought for — reconstructing what happened
     * when, next to Jira's own history and next to a colleague in another
     * office. An unstated zone is not a smaller version of that answer; it is
     * an answer that silently disagrees with the reader by a few hours.
     *
     * The zone lives in the column header (`toHistoryTable`), which is one
     * string away from being tidied off. Hence a flow of its own.
     */
    name: 'history: the timestamp column names the timezone it is reporting in',
    app: 'issue-history',
    screen: 'issue-history-page',
    async run({ page, expect }) {
      await page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 30_000 });
      const headers = (await page.locator('table thead th').allInnerTexts()).map((text) =>
        text.trim(),
      );
      expect.contains(
        headers[0],
        'UTC',
        'the timestamp column states its zone in the header — a time shown in an unstated zone is ' +
          'exactly the ambiguity this listing is sold against',
      );
      expect.equal(
        headers.join('|'),
        'When (UTC)|Issue|Field|From|To|By',
        'the table reads when, on which issue, which field, from what, to what, by whom',
      );

      const rows = await tableRows(page);
      for (const row of rows) {
        expect.ok(
          whenOf(row[0]) !== null,
          `"${row[0]}" is not the unambiguous UTC timestamp the column header promises`,
        );
      }
    },
  },

  {
    /**
     * The bolded column is the one a reader scans, and here that is the issue
     * key: somebody opens this page asking "what happened to FLOW-3", not
     * "what happened at 13:00". `SimpleTable.emphasisColumn` exists for this
     * one table — every other listing leads with its identity column — and
     * the same index also decides which column is sortable, because sorting
     * a *formatted* timestamp is alphabetical rather than chronological.
     *
     * So this is not styling. Lose the emphasis index and the table both
     * emphasises the column nobody scans and offers a sort that silently puts
     * "3 Mar" before "23 Feb".
     */
    name: 'history: the issue key is the emphasised column, not the timestamp',
    app: 'issue-history',
    screen: 'issue-history-page',
    async run({ page, expect }) {
      const firstRow = page.locator('table tbody tr').first();
      await firstRow.waitFor({ state: 'visible', timeout: 30_000 });

      const emphasised = await page
        .locator('table tbody tr')
        .evaluateAll((trs) =>
          trs.map((tr) =>
            [...tr.querySelectorAll('td')].map((td) => td.querySelector('strong') !== null),
          ),
        );
      for (const row of emphasised) {
        expect.ok(
          row[1] === true,
          'the issue key cell is the bolded one — it is what a reader scans this table for',
        );
        expect.absent(
          row[0],
          'the timestamp is bolded, putting the emphasis on the one column a reader does not ' +
            'scan for and leaving the issue key plain',
        );
      }

      const rows = await tableRows(page);
      for (const row of rows) {
        expect.ok(
          /^[A-Z][A-Z0-9]+-\d+$/.test(row[1]),
          `the emphasised column holds an issue key, but one row reads "${row[1]}"`,
        );
      }

      // The sortable column follows the emphasis for the same reason: a
      // string sort over "23 Feb 2026 12:00" is not chronological.
      const sortable = await page.locator('table thead th button').allInnerTexts();
      expect.equal(
        sortable.map((text) => text.trim()).join('|'),
        'Issue',
        'the issue key is the sortable column; offering a sort on the formatted timestamp would ' +
          'order it alphabetically — "3 Mar" ahead of "23 Feb"',
      );
    },
  },

  {
    /**
     * A change log that is not in order is not a change log. The whole value
     * over Jira's per-issue History tab is that a reader can follow one
     * sequence across issues — a status flip, the assignee change that
     * followed it, the resolution at the end — and any reordering (a sort
     * applied server-side, a `Map` iteration that stopped being insertion
     * ordered) turns the page into a bag of facts.
     *
     * The footnote's count is the other half: it is how a reader knows
     * whether they are looking at everything or at the first page of it.
     */
    name: 'history: changes are listed in order and the footnote counts what is shown',
    app: 'issue-history',
    screen: 'issue-history-page',
    async run({ page, expect }) {
      const rows = await tableRows(page);
      expect.ok(rows.length > 1, 'the report lists more than one change, so order is observable');

      // ★ Newest first, and that direction is the assertion — not an
      // incidental consequence of how the rows arrive.
      //
      // This page asks for 500 rows at offset 0 and has no filter controls,
      // so the ordering decides which changes a reader can reach at all, not
      // merely the order they appear in. Ascending meant that on a large
      // project the only reachable rows were the oldest — found on a real
      // 18,736-change tenant on 2026-10-09, where every reachable change came
      // from the project's first two seconds. An audit log is opened to ask
      // what changed *recently*.
      let previous = Infinity;
      for (const row of rows) {
        const at = whenOf(row[0]);
        expect.ok(
          at <= previous,
          `the changes are out of order at "${row[0]}" — a reader cannot follow a sequence that ` +
            'is not in one, which is the only thing this view offers over Jira’s per-issue tab',
        );
        previous = at;
      }

      const first = whenOf(rows[0][0]);
      const last = whenOf(rows[rows.length - 1][0]);
      expect.ok(
        first > last,
        'the newest change leads the table — ascending order is in one order too, and would ' +
          'pass the loop above while putting the oldest 500 changes of a large project in ' +
          'front of a reader and nothing since',
      );

      const footnote = page.getByText('changes shown').first();
      await footnote.waitFor({ state: 'visible', timeout: 30_000 });
      const stated = /^(\d+) changes shown/.exec((await footnote.innerText()).trim());
      expect.ok(stated !== null, 'the footnote states how many changes are shown');
      expect.equal(
        Number(stated[1]),
        rows.length,
        'the footnote counts the rows actually on screen — a count that does not match is how a ' +
          'reader comes to believe a truncated table is the whole record',
      );

      const changes = await tile(page, 'Changes');
      expect.equal(
        changes.value,
        String(rows.length),
        'the "Changes" tile and the table footnote report the same number of changes',
      );
    },
  },

  {
    /**
     * The tile and the chart answer the same question from the same array
     * (`report.byField`): the tile takes `[0]`, the chart takes the first
     * `CHART_CATEGORY_LIMIT` in order. If the busiest-field tile ever names a
     * field other than the chart's leading bar, the page is contradicting
     * itself in two places a reader takes in at a glance — and the reader has
     * no way to tell which one is lying.
     *
     * That is one `sort` away in the report builder, and no unit test that
     * checks the two view models separately can see it.
     */
    name: 'history: the "Busiest field" tile names the chart’s leading bar',
    app: 'issue-history',
    screen: 'issue-history-page',
    async run({ page, expect }) {
      const busiest = await tile(page, 'Busiest field');
      const lines = await chartLines(page, 'Changes by field');

      // title, subtitle, then label/value per bar.
      expect.ok(lines.length >= 4, 'the chart draws at least one labelled bar');
      expect.equal(
        lines[2],
        busiest.value,
        `the "Busiest field" tile says "${busiest.value}" while the "Changes by field" chart leads ` +
          `with "${lines[2]}" — the page is contradicting itself about its own headline finding`,
      );

      // The leading bar is also the largest one, so "busiest" means what it says.
      const values = [];
      for (let index = 3; index < lines.length; index += 2) values.push(Number(lines[index]));
      expect.equal(
        values[0],
        Math.max(...values),
        'the chart is drawn busiest-first, so its leading bar carries the largest count',
      );

      // And the tile's hint is that same count, not a different measure.
      expect.contains(
        busiest.hint,
        `${String(values[0])} changes`,
        "the tile's hint states the same change count the chart draws for that field",
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
     * defaults to `'status'`), and nothing visible on the page changes when
     * it does: the button works, a modal opens, a CSV appears.
     *
     * For this listing the export *is* the product — Jira cannot export its
     * own history at all — so the header row is asserted exactly, and the
     * time-in-status header "Current status" is asserted absent.
     */
    /**
     * A summary that would execute in Excel leaves as text.
     *
     * `csvCell` prefixes a quote to any cell opening `=`, `+`, `-`, `@`, tab
     * or CR. That was unit-tested on the function and nothing carried a
     * dangerous value all the way into the file a user receives — the gap
     * `docs/E2E-TEST-PLAN.md` records as needing a fixture. `FLOW-2` now has
     * a summary change to a real `HYPERLINK` formula, and this follows it
     * through the report, the table and the export modal.
     *
     * The assertion is on the *file*, not the screen: the table renders the
     * value harmlessly whatever it says, and the whole risk lives in what a
     * spreadsheet does with the download.
     */
    name: 'history: a summary that would execute as a formula is defused in the export',
    app: 'issue-history',
    screen: 'issue-history-page',
    async run({ page, expect }) {
      await page.getByRole('button', { name: 'Export CSV' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });
      const text = await dialog.innerText();

      expect.contains(
        text,
        'HYPERLINK',
        'the formula-shaped summary reached the export at all — without it this flow would ' +
          'pass by testing nothing, which is how the escaping went unproven in the first place',
      );
      expect.contains(
        text,
        "'=HYPERLINK",
        'the cell is prefixed with a quote, so Excel reads it as text rather than running it',
      );
      expect.absent(
        /(^|[,\n])=HYPERLINK/.test(text),
        'an unescaped "=HYPERLINK" opens a cell in the file, so the export would execute in ' +
          'Excel — CSV injection, out of an issue summary anyone with create permission can set',
      );
    },
  },
  {
    name: 'history: Export CSV hands over the history report, not the time-in-status one',
    app: 'issue-history',
    screen: 'issue-history-page',
    async run({ page, expect }) {
      await page.getByRole('button', { name: 'Export CSV' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });
      const text = await dialog.innerText();

      expect.contains(
        text,
        'issue-history-10000.csv',
        'the modal names the file the history listing built, for the project on screen',
      );
      expect.contains(
        text,
        'Changed at (UTC),Issue key,Field,From,To,Author',
        'the exported header row is the one `historyReportToCsv` writes — this is the assertion ' +
          'that catches the export silently reverting to another listing’s report',
      );
      expect.absent(
        text.includes('Current status'),
        'the time-in-status header "Current status" is in this file, so the history page has ' +
          'exported the wrong report — the exact bug `report-csv.ts` was written to end',
      );
      expect.absent(
        text.includes('History complete'),
        'the time-in-status trailing column "History complete" is in this file, so the export is ' +
          'the status report rather than the history one',
      );

      // Machine-readable timestamps in the file, unlike the display table:
      // the export is what a spreadsheet or an audit pipeline reads.
      expect.contains(
        text,
        'T09:00:00.000Z,FLOW-1,status',
        'exported timestamps are full ISO-8601 UTC instants, and the rows carry the real issue keys',
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
    name: 'history: extending the indexed history stores the wider range and the control says so next time',
    app: 'issue-history',
    screen: 'issue-history-page',
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

      await page.getByRole('option', { name: 'Last 3 years', exact: true }).click();
      await page.getByRole('button', { name: 'Re-index' }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 30_000 });

      // The round trip: the resolver stored it, and the control reads it back.
      const reopened = await open();
      expect.contains(
        await reopened.innerText(),
        'This project is indexed over last 3 years',
        'after re-indexing, the control states the new range — if it still says twelve months the ' +
          'setting never reached the store and the backfill covered the old window',
      );
    },
  },

  {
    /**
     * A dashboard gadget is a card among many on somebody else's dashboard —
     * often the only surface a person who did not install the app ever sees.
     * It shows the tiles and stops there. This listing's table is the widest
     * in the product (six columns, one row per field change) and a dashboard
     * card is the worst possible place to render it.
     *
     * The gadget and the page are separate files that import the same view
     * models, so "the gadget started rendering the full table" is a one-line
     * change nothing else catches.
     */
    name: 'history: the dashboard gadget shows the summary tiles and not the whole table',
    app: 'issue-history',
    screen: 'issue-history-gadget',
    async run({ page, expect }) {
      await page.getByRole('heading', { name: 'Issue History' }).waitFor({ timeout: 30_000 });
      const changes = await tile(page, 'Changes');
      const busiest = await tile(page, 'Busiest field');
      expect.ok(
        /^\d+$/.test(changes.value),
        `the gadget states a change count, not "${changes.value}"`,
      );
      expect.ok(busiest.value.length > 0, 'the gadget names the busiest field');

      expect.equal(
        await page.locator('table').count(),
        0,
        'the gadget has rendered a table — it is a card on a shared dashboard, and the six-column ' +
          'change log belongs on the project page it links to',
      );
      expect.equal(
        await page.getByText('When (UTC)', { exact: true }).count(),
        0,
        'a table column header has reached the gadget, so the change log is being rendered there',
      );
      expect.absent(
        (await page.locator('body').innerText()).includes('FLOW-'),
        'the gadget is listing individual issues — a dashboard is shared with people who may not ' +
          'have browse permission on the project this gadget is configured for',
      );
    },
  },

  {
    /**
     * `jira:adminPage` is instance-wide and reachable by any Jira admin,
     * including admins with no browse permission on the projects this app has
     * indexed. So the page answers "what is this app storing" in rows and
     * bytes, and **nothing issue-shaped may appear on it** — one issue key
     * here is a permission leak the platform will not catch for us. This
     * listing stores the most issue-shaped rows of the five, which makes it
     * the likeliest place for one to surface.
     *
     * The estimate caveat matters for a different reason: these bytes are
     * computed from row counts and per-row constants, not measured, and an
     * admin sizing a Forge bill against them deserves to be told.
     */
    name: 'history: the admin page reports rows per table, calls the size an estimate, and names no issue',
    app: 'issue-history',
    screen: 'issue-history-admin',
    async run({ page, expect }) {
      await page
        .getByRole('heading', { name: 'Issue History — storage' })
        .waitFor({ timeout: 30_000 });

      const headers = await page.locator('table thead th').allInnerTexts();
      expect.equal(
        headers.map((header) => header.trim()).join('|'),
        'Table|Rows|Estimated size',
        'the admin table reports a row count and a size per Forge SQL table',
      );

      const rows = await tableRows(page);
      const historyRow = rows.find((row) => row[0] === 'issue_history');
      expect.ok(
        historyRow !== undefined,
        'the issue_history table this listing fills is listed by name',
      );
      expect.ok(
        /^[1-9][\d,]*$/.test(historyRow[1]),
        `the issue_history row count is a real stored count, but it reads "${historyRow[1]}"`,
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
  {
    /**
     * A field that had no previous value reads an em dash, not an empty cell
     * and not a zero.
     *
     * The same honesty requirement as the time-in-status report, on the
     * surface where it is easiest to get wrong: this table's whole content is
     * `From` and `To` pairs, and the first time any field is set there is no
     * `From`. An empty cell there is ambiguous — it reads as "the report does
     * not know" rather than "there was nothing before" — and a `0` would be
     * worse, since several of the fields this table carries are numeric and a
     * zero is a value someone could have set.
     *
     * Asserted over the whole table rather than one row, because the rule is
     * about the table and a single row passing proves only that one cell.
     */
    name: 'history: a field with no previous value reads an em dash, never a blank cell',
    app: 'issue-history',
    screen: 'issue-history-page',
    async run({ page, expect }) {
      const rows = await tableRows(page);
      expect.ok(rows.length > 0, 'the report lists changes');

      const headers = await page.evaluate(() =>
        [...document.querySelectorAll('table thead th')].map((cell) => cell.innerText.trim()),
      );
      const from = headers.indexOf('From');
      const to = headers.indexOf('To');
      expect.ok(
        from !== -1 && to !== -1,
        `the table has From and To columns; it has: ${headers.join(' | ')}`,
      );

      const blanks = rows.filter((row) => row[from] === '' || row[to] === '');
      expect.equal(
        blanks.length,
        0,
        `every From and To cell says something; ${String(blanks.length)} were empty, and an empty ` +
          'cell reads as "the report does not know" rather than "there was nothing before"',
      );

      expect.ok(
        rows.some((row) => row[from] === '—'),
        'at least one change set a field that had no previous value, and it reads as an em dash ' +
          '— if this stops being true the assertion above is passing over a table that no ' +
          'longer exercises the rule',
      );
    },
  },
];
