/**
 * Listing 4 — SLA & Due Dates — as a user drives it.
 *
 * Every screen this listing can show is already covered by the component
 * suites against a frozen snapshot. What a snapshot cannot show is the half of
 * this listing that is *stateful*: the goal is not decoration, it is the
 * divisor under every number on the page, and it can be toggled, retargeted,
 * saved for the whole project, reloaded, edited and deleted. Each of those is
 * a place where the table can end up headed with one goal and computed from
 * another — the single failure this product is sold against.
 *
 * So these flows change the goal and then read the numbers back.
 *
 * ## Parallelism
 *
 * The runner runs every flow at once against **one live runtime per app**, so
 * the saved-goal list is shared by all of them. The rule chosen here is
 * **uniquely-named goals, never a count**: each flow below that saves anything
 * saves it under its own `E2E …` name and asserts only on that name. No flow
 * asserts how many goals exist, and no flow deletes a goal it did not save.
 * That keeps them independent without serialising them behind a lifecycle.
 */

// --------------------------------------------------------------- helpers ---

/** The whole table, cells trimmed. Column 2 is "Target". */
async function tableCells(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('table tbody tr')].map((row) =>
      [...row.cells].map((cell) => cell.innerText.trim()),
    ),
  );
}

/**
 * The summary tiles, by label.
 *
 * `SummaryTiles` renders each tile as label / value / hint, with the value as
 * the only `h3` whose previous sibling is its label — which is also what tells
 * a tile apart from the chart heading above it.
 */
async function summaryTiles(page) {
  return page.evaluate(() => {
    const tiles = {};
    for (const value of document.querySelectorAll('h3')) {
      const label = value.previousElementSibling?.textContent?.trim();
      if (label !== undefined && label !== '') tiles[label] = value.textContent?.trim() ?? '';
    }
    return tiles;
  });
}

/** The banded chart, by band label. Scoped to the chart, not the page. */
/**
 * The chart's bands, waiting for it to actually be on screen.
 *
 * Sampling once was flaky, and for a real reason rather than a slow machine:
 * changing the goal re-fetches, the ready state unmounts while the request is
 * in flight, and `waitForTableChange` can return in the window where the
 * table has already re-rendered and the chart has not. The read then hit a
 * `null` heading and the flow died on `Cannot read properties of null`.
 *
 * Polling until the bands are present is the honest fix: the assertion is
 * about what the chart eventually shows, not about when React got there.
 */
async function chartBands(page, { timeout = 20_000 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const bands = await readChartBands(page);
    if (bands !== null && Object.keys(bands).length > 0) return bands;
    if (Date.now() > deadline) return bands;
    await page.waitForTimeout(50);
  }
}

async function readChartBands(page) {
  return page.evaluate(() => {
    const heading = [...document.querySelectorAll('h3')].find(
      (node) => node.textContent?.trim() === 'How close to the target',
    );
    if (heading === undefined || heading.parentElement === null) return null;
    const lines = heading.parentElement.innerText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    const bands = {};
    for (let i = 0; i < lines.length - 1; i += 1) {
      if (/^\d+$/.test(lines[i + 1])) bands[lines[i]] = lines[i + 1];
    }
    return bands;
  });
}

/**
 * What a picker currently *displays* — the placeholder, or the chosen label.
 *
 * Walks out from the `inputId` react-select puts on its input to the
 * shallowest ancestor that still holds exactly that one input and has text of
 * its own, which is the value container.
 */
async function pickerText(page, inputId) {
  return page.evaluate((id) => {
    const input = document.getElementById(id);
    if (input === null) return null;
    let node = input;
    while (node.parentElement !== null) {
      const parent = node.parentElement;
      if (parent.querySelectorAll('input').length === 1 && parent.innerText.trim() !== '') {
        return parent.innerText.trim();
      }
      node = parent;
    }
    return '';
  }, inputId);
}

/** Drive an ADS `Select` the way a user does: open the menu, click an option. */
async function choose(page, inputId, optionLabel) {
  await page.locator(`#${inputId}`).press('ArrowDown');
  const option = page.getByRole('option', { name: optionLabel, exact: true });
  await option.waitFor({ state: 'visible', timeout: 15_000 });
  await option.click();
}

/** The options a picker offers right now, without choosing any of them. */
async function pickerOptions(page, inputId) {
  await page.locator(`#${inputId}`).press('ArrowDown');
  await page.getByRole('option').first().waitFor({ state: 'visible', timeout: 15_000 });
  const options = await page.getByRole('option').allInnerTexts();
  await page.keyboard.press('Escape');
  return options.map((option) => option.trim());
}

/** Wait for the report to come back changed, rather than sleeping and hoping. */
/**
 * Wait for the table to be *re-rendered with different content* — not merely
 * to differ from what it said before.
 *
 * The obvious version (`innerText !== before`) is satisfied the instant the
 * table **disappears**: changing the goal puts the page into its loading
 * state, where there is no table at all, so `?? ''` compared unequal and the
 * wait returned while the request was still in flight. The flow then read an
 * empty table and reported the perfectly healthy page as having lost a row —
 * a failure that looked like a product bug and was a race in the test.
 *
 * Requiring a present, non-empty table that also differs waits for the thing
 * the assertion is actually about.
 */
async function waitForTableChange(page, previousText) {
  await page.waitForFunction(
    (before) => {
      const text = document.querySelector('table')?.innerText ?? '';
      return text !== '' && text !== before;
    },
    previousText,
    { timeout: 20_000 },
  );
}

async function tableText(page) {
  return page.evaluate(() => document.querySelector('table')?.innerText ?? '');
}

/**
 * Type a name, press "Save goal", and wait for the page to settle either way.
 *
 * Both outcomes are waited for together on purpose. If the goal cannot be read
 * back the page does not hang, it swaps the whole report for the "that saved
 * goal no longer exists" refusal — so racing the success caption against the
 * refusal is what turns a 20-second timeout into a failure message that says
 * what actually happened.
 */
async function saveGoalNamed(page, expect, name) {
  await page.locator('#sla-goal-name').fill(name);
  await page.getByRole('button', { name: 'Save goal' }).click();
  await page.waitForFunction(
    (goalName) => {
      const text = document.body.innerText;
      return (
        text.includes(`Measuring against the saved goal "${goalName}"`) ||
        text.includes('That saved goal no longer exists') ||
        text.includes('Could not save the goal')
      );
    },
    name,
    { timeout: 20_000 },
  );
  const body = await page.locator('body').innerText();
  expect.absent(
    body.includes('That saved goal no longer exists'),
    `a goal that was just saved can be read back by the report resolver — the page attached ` +
      `itself to "${name}" and the very next getSlaReport refused it as unknown, replacing the ` +
      'whole report with a dead end',
  );
  expect.absent(body.includes('Could not save the goal'), `saving the goal "${name}" is accepted`);
  expect.contains(
    body,
    `Measuring against the saved goal "${name}"`,
    'the caption names the goal the numbers are now measured against',
  );
}

/** The CSV text out of the export modal, as rows of cells. */
async function exportedCsv(page) {
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 20_000 });
  const csv = await dialog.locator('pre').innerText();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 15_000 });
  return csv
    .split(/\r?\n/)
    .filter((line) => line !== '')
    .map((line) => line.split(','));
}

// ----------------------------------------------------------------- flows ---

export const flows = [
  {
    /**
     * The goal is the divisor under every figure on this page, and the two
     * controls that change it — the status chips and the target — are the only
     * reason the page is interactive at all.
     *
     * Delete this and a chip row that has come unwired from `onChange`, or a
     * target `Select` whose value never reaches `getSlaReport`, ships looking
     * perfectly correct: the caption flips, the chips light up, and every
     * number on screen is still the one computed for a different goal. Nobody
     * would notice until a customer disputed a breach count.
     */
    name: 'sla: choosing the goal changes the numbers',
    app: 'sla-breach',
    screen: 'sla-breach-page',
    async run({ page, expect }) {
      const captionEvery = page.getByText('Counting time in every status', { exact: false });
      await captionEvery.waitFor({ state: 'visible', timeout: 20_000 });

      const before = await tableCells(page);
      const tilesBefore = await summaryTiles(page);
      const textBefore = await tableText(page);
      expect.equal(before.length, 4, 'the default goal measures all four fixture issues');
      expect.equal(
        tilesBefore['Attainment'],
        '25%',
        'three of the four issues breach an 8h target',
      );
      expect.equal(tilesBefore['Breached'], '3', 'the Breached tile agrees with that');

      // Count only time spent Blocked. FLOW-1 was never blocked, so its
      // consumed time must fall to zero — a re-computation, not a re-render.
      await page.getByRole('button', { name: 'Blocked' }).click();
      await page
        .getByText('Counting time only in the selected statuses')
        .waitFor({ state: 'visible', timeout: 20_000 });
      await waitForTableChange(page, textBefore);

      const blocked = await tableCells(page);
      const tilesBlocked = await summaryTiles(page);
      const flow1 = blocked.find((row) => row[0] === 'FLOW-1');
      expect.ok(flow1 !== undefined, 'FLOW-1 is still measured under the narrowed goal');
      expect.equal(
        flow1[1],
        '0m',
        'counting only Blocked time leaves FLOW-1, which was never blocked, at zero working time',
      );
      expect.equal(
        tilesBlocked['Breached'],
        '2',
        'the Breached tile re-computes against the narrowed goal rather than keeping its old count',
      );

      // …and back off again. A toggle that only worked in one direction would
      // strand a reader on a goal they cannot undo.
      const textBlocked = await tableText(page);
      await page.getByRole('button', { name: 'Blocked' }).click();
      await captionEvery.waitFor({ state: 'visible', timeout: 20_000 });
      await waitForTableChange(page, textBlocked);
      expect.equal(
        (await summaryTiles(page))['Breached'],
        '3',
        'un-selecting the last chip returns the report to counting time in every status',
      );

      // The target is the other half of the goal, and it is what the "Target"
      // column and the attainment tile are both derived from.
      const textEveryStatus = await tableText(page);
      await choose(page, 'sla-goal-target', '40 working hours');
      await waitForTableChange(page, textEveryStatus);

      const retargeted = await tableCells(page);
      const targets = [...new Set(retargeted.map((row) => row[2]))];
      expect.equal(targets.length, 1, 'every row is measured against the one chosen target');
      expect.equal(targets[0], '40h', 'the Target column shows the target the picker was set to');
      expect.equal(
        (await summaryTiles(page))['Attainment'],
        '75%',
        'a 40-hour target leaves only FLOW-1 in breach, so attainment rises from 25% to 75%',
      );
    },
  },

  {
    /**
     * ★ The whole point of a *saved* goal.
     *
     * An ad-hoc goal is a view choice that dies with the tab. A saved goal is
     * shared configuration — "the goal everyone on this project sees", as the
     * form says — and the only observable difference between the two is that
     * one survives a page load. A snapshot harness cannot tell them apart,
     * which is exactly how a save that round-trips through React state and
     * never reaches storage ships unnoticed: the caption changes, the picker
     * fills in, and the goal is gone the next morning.
     *
     * The reload is the assertion. Everything before it is setup.
     *
     * Saves under its own name so it cannot collide with the other saving
     * flows running beside it.
     */
    name: 'sla: a saved goal survives a page reload',
    app: 'sla-breach',
    screen: 'sla-breach-page',
    async run({ page, expect }) {
      const NAME = 'E2E round-trip goal';
      await page
        .getByText('This selection is not saved', { exact: false })
        .waitFor({ state: 'visible', timeout: 20_000 });

      await saveGoalNamed(page, expect, NAME);

      expect.contains(
        await pickerOptions(page, 'sla-saved-goal'),
        NAME,
        'the saved-goal picker offers the goal that was just saved',
      );

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('body[data-harness-ready="true"]', { timeout: 30_000 });

      expect.ok(
        (await page.locator('#sla-saved-goal').count()) > 0,
        'the saved-goal picker is still on the page after a reload, which it only is when ' +
          'listSlaGoals came back with at least one stored goal',
      );
      expect.contains(
        await pickerOptions(page, 'sla-saved-goal'),
        NAME,
        'the goal saved before the reload is still offered after it — stored configuration, ' +
          'not component state',
      );
    },
  },

  {
    /**
     * ★ The invariant that stops the page lying about its own numbers.
     *
     * A saved goal travels to the resolver as an id alone, so the *server*
     * decides what the numbers mean. The moment a chip is toggled, the chips on
     * screen no longer describe that stored goal — and if the page kept the id,
     * the table would be headed "Measuring against the saved goal X" while
     * every figure in it came from X's stored definition instead of what the
     * reader can see. Both halves have to let go at once: the caption and the
     * picker.
     *
     * `toggleCountedStatus` dropping `savedGoalId` is one line, and the
     * controlled `value` on the picker is one prop. Either regressing gives a
     * report that is confidently, silently wrong.
     *
     * The picker assertion also guards the stand-in host, which is the only
     * reason it can be made at all: `forge-host.tsx`'s `Select` used to drop
     * `value` on the floor, so the picker was uncontrolled in every test and
     * screenshot this repository takes and went on naming a detached goal no
     * matter what the product did. This flow is what found that.
     */
    name: 'sla: editing a saved goal detaches the page from it',
    app: 'sla-breach',
    screen: 'sla-breach-page',
    async run({ page, expect }) {
      const NAME = 'E2E detach goal';
      await page
        .getByText('This selection is not saved', { exact: false })
        .waitFor({ state: 'visible', timeout: 20_000 });

      await saveGoalNamed(page, expect, NAME);

      // Load it through the picker, the way a second reader would arrive at
      // it, rather than relying on the attachment the save left behind.
      await choose(page, 'sla-saved-goal', NAME);
      await page
        .getByText(`Measuring against the saved goal "${NAME}"`)
        .waitFor({ state: 'visible', timeout: 20_000 });
      expect.contains(
        await pickerText(page, 'sla-saved-goal'),
        NAME,
        'the picker names the goal the page is measuring against',
      );

      const attached = await tableText(page);
      await page.getByRole('button', { name: 'In Review' }).click();

      await page
        .getByText('This selection is not saved', { exact: false })
        .waitFor({ state: 'visible', timeout: 20_000 });
      await waitForTableChange(page, attached);

      expect.absent(
        (await page.locator('body').innerText()).includes(
          `Measuring against the saved goal "${NAME}"`,
        ),
        'editing the selection stops the page claiming to measure against the saved goal',
      );
      const shown = await pickerText(page, 'sla-saved-goal');
      expect.ok(
        !shown.includes(NAME),
        'the saved-goal picker stops naming a goal the report is no longer computed from — a ' +
          'control naming one goal above a table computed from another is the failure this ' +
          `listing exists to avoid, and the picker still reads "${shown}"`,
      );
    },
  },

  {
    /**
     * A goal the report cannot name is a goal nobody can pick again, and the
     * resolver refuses it outright (`GOAL_NAME_REQUIRED`). The button being
     * disabled is what keeps that refusal from ever being something a user has
     * to read.
     *
     * The whitespace case is the one that regresses: `isDisabled` reads
     * `name.trim()`, and dropping the trim gives a goal named " " that saves
     * happily and renders as an empty row in everyone else's picker.
     *
     * Saves nothing, so it is inert with respect to every other flow here.
     */
    name: 'sla: a goal with no name cannot be saved',
    app: 'sla-breach',
    screen: 'sla-breach-page',
    async run({ page, expect }) {
      const save = page.getByRole('button', { name: 'Save goal' });
      await save.waitFor({ state: 'visible', timeout: 20_000 });

      expect.ok(await save.isDisabled(), 'Save goal is disabled while the name is empty');

      await page.locator('#sla-goal-name').fill('   ');
      expect.ok(
        await save.isDisabled(),
        'Save goal stays disabled for a name that is only whitespace',
      );

      await page.locator('#sla-goal-name').fill('E2E named at last');
      expect.absent(
        await save.isDisabled(),
        'Save goal becomes available as soon as the goal has a real name',
      );
    },
  },

  {
    /**
     * Deleting the goal the page is measuring against is the one moment the
     * client holds an id the server has just dropped. Left attached, the next
     * `getSlaReport` sends a `goalId` that no longer resolves and the reader's
     * report is replaced by "that saved goal no longer exists" — for an action
     * they themselves took deliberately. Falling back to the default goal is
     * the difference between a delete button and a trap.
     *
     * Saves and deletes only its own name, and never asserts on how many goals
     * exist, so the other saving flows are invisible to it.
     */
    name: 'sla: deleting a saved goal falls back to the default goal',
    app: 'sla-breach',
    screen: 'sla-breach-page',
    async run({ page, expect }) {
      const NAME = 'E2E doomed goal';
      await page
        .getByText('This selection is not saved', { exact: false })
        .waitFor({ state: 'visible', timeout: 20_000 });

      await choose(page, 'sla-goal-target', '24 working hours');
      await saveGoalNamed(page, expect, NAME);

      await page.getByRole('button', { name: `Delete “${NAME}”` }).click();
      await page
        .getByText('This selection is not saved', { exact: false })
        .waitFor({ state: 'visible', timeout: 20_000 });

      const body = await page.locator('body').innerText();
      expect.absent(
        body.includes('That saved goal no longer exists'),
        'deleting the goal in force leaves a working report rather than a refusal aimed at the ' +
          'person who pressed the button',
      );
      expect.absent(body.includes(NAME), 'the deleted goal is gone from the page, picker included');

      if ((await page.locator('#sla-saved-goal').count()) > 0) {
        // Other flows' goals may still be stored; only this one must be gone.
        expect.absent(
          (await pickerOptions(page, 'sla-saved-goal')).includes(NAME),
          'the deleted goal is no longer offered by the picker',
        );
      }

      const targets = [...new Set((await tableCells(page)).map((row) => row[2]))];
      expect.equal(
        targets.join(),
        '8h',
        'the report falls back to the default 8-hour goal rather than to the deleted goal ' +
          'it was measuring against, or to nothing at all',
      );
    },
  },

  {
    /**
     * The export must be the report on screen.
     *
     * `buildCsvFor` resolves the goal a second time, independently of
     * `handleSlaReport` — which is the right design and also the reason the two
     * can drift apart. An export that quietly re-parsed the payload instead of
     * resolving the saved goal, or that fell back to the 8-hour default, hands
     * a customer a spreadsheet whose "Target (hours)" column contradicts the
     * page they exported it from, and spreadsheets are what get forwarded to
     * people who never saw the page.
     *
     * Both goal shapes are checked because they take different code paths:
     * the ad-hoc goal travels as fields, the saved goal as an id alone.
     */
    name: 'sla: the CSV export is measured against the goal on screen',
    app: 'sla-breach',
    screen: 'sla-breach-page',
    async run({ page, expect }) {
      const NAME = 'E2E export goal';
      const before = await tableText(page);

      // A target no default could be mistaken for.
      await choose(page, 'sla-goal-target', '40 working hours');
      await waitForTableChange(page, before);

      const adHoc = await exportedCsv(page);
      const header = adHoc[0];
      const target = header.indexOf('Target (hours)');
      expect.ok(target >= 0, 'the exported SLA CSV carries a "Target (hours)" column');
      expect.ok(adHoc.length > 1, 'the export carries the report rows, not just a header');
      const adHocTargets = [...new Set(adHoc.slice(1).map((row) => row[target]))];
      expect.equal(
        adHocTargets.join(),
        '40',
        'every exported row is measured against the 40-hour target chosen on the page, not the ' +
          '8-hour default',
      );

      // The same target, now as stored configuration resolved server-side.
      await saveGoalNamed(page, expect, NAME);
      const saved = await exportedCsv(page);
      const savedTargets = [...new Set(saved.slice(1).map((row) => row[target]))];
      expect.equal(
        savedTargets.join(),
        '40',
        'exporting while attached to a saved goal measures against that goal, so the file and ' +
          'the page cannot disagree about what the target was',
      );
    },
  },

  {
    /**
     * The chart and the tile are two renderings of one number, derived by two
     * different expressions over the same rows.
     *
     * `toSlaChartData` builds its bands from `row.breached`; the tile reads
     * `report.breachedCount`. Re-deriving either as `consumedFraction >= 1`
     * puts an issue that has consumed exactly its target on one side of the
     * line in the chart and the other in the table directly beneath it. Nobody
     * files a bug about that — they just stop trusting the page.
     *
     * Checked under two different goals, because a disagreement that only
     * appears at a particular breach count is the kind that survives one
     * assertion.
     */
    name: 'sla: the banded chart and the Breached tile never disagree',
    app: 'sla-breach',
    screen: 'sla-breach-page',
    async run({ page, expect }) {
      await page
        .getByText('How close to the target')
        .waitFor({ state: 'visible', timeout: 20_000 });

      const bands = await chartBands(page);
      expect.ok(bands !== null, 'the banded chart renders under its own heading');
      for (const band of ['Under 50%', '50-80%', '80-100%', 'Breached']) {
        expect.ok(
          band in bands,
          `the chart shows the "${band}" band — the bands are the whole reason this is not a ` +
            'breached/not-breached pair',
        );
      }
      expect.equal(
        bands['Breached'],
        (await summaryTiles(page))['Breached'],
        "the chart's Breached band and the Breached tile report the same count",
      );

      // Narrow the goal so the count moves, then check they moved together.
      const before = await tableText(page);
      await page.getByRole('button', { name: 'Blocked' }).click();
      await waitForTableChange(page, before);

      const narrowed = await chartBands(page);
      const tiles = await summaryTiles(page);
      expect.equal(
        narrowed['Breached'],
        tiles['Breached'],
        'the chart and the tile still agree after the goal changes, rather than one of them ' +
          "keeping the previous goal's count",
      );
      expect.equal(
        tiles['Breached'],
        '2',
        'counting only Blocked time drops the breach count from three to two',
      );
    },
  },

  {
    /**
     * The admin page answers "what is this app storing, and will it cost me?"
     * for **this listing's own database** — and it is reachable by any Jira
     * administrator, including ones with no permission on the projects the
     * rows came from.
     *
     * So the second assertion is a privacy boundary, not a formatting check.
     * The temptation on a storage page is to show *what* is stored — a sample
     * row, the largest issue, the most recent one indexed — and every one of
     * those leaks an issue key to someone who may not be allowed to see it.
     * Searching the whole rendered page for `FLOW-` is the cheapest way to
     * keep that from creeping back in.
     */
    name: 'sla: the admin surface reports rows per table and never an issue key',
    app: 'sla-breach',
    screen: 'sla-breach-admin',
    async run({ page, expect }) {
      await page
        .getByText('SLA and Due Dates — storage')
        .waitFor({ state: 'visible', timeout: 20_000 });

      const headers = await page.evaluate(() =>
        [...document.querySelectorAll('table thead th')].map((cell) => cell.innerText.trim()),
      );
      expect.contains(headers.join('|'), 'Table', 'the storage table names each table');
      expect.contains(headers.join('|'), 'Rows', 'the storage table reports rows per table');

      const rows = await tableCells(page);
      expect.ok(rows.length > 0, 'every table this app owns is listed, including empty ones');
      const issueMeta = rows.find((row) => row[0] === 'issue_meta');
      expect.ok(issueMeta !== undefined, 'issue_meta is one of the tables reported');
      expect.equal(
        issueMeta[1],
        '4',
        "the row count is the real one from this installation's store — the four indexed fixture issues",
      );

      const body = await page.locator('body').innerText();
      expect.absent(
        body.includes('FLOW-'),
        'no issue key appears anywhere on the admin page, which is visible to administrators ' +
          'who may have no permission on the projects these rows came from',
      );
    },
  },
];
