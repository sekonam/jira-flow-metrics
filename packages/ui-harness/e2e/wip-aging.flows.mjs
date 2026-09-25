/**
 * End-to-end flows for the WIP Aging listing.
 *
 * The component suite already proves this page renders. What it cannot prove
 * is anything that depends on a second render or on two parts of the screen
 * agreeing with each other, and those are exactly the failures a WIP report
 * can have while looking perfectly healthy: a histogram that drops its empty
 * buckets, a cumulative flow diagram whose bands do not add up, a tile that
 * disagrees with the table underneath it, an export that quietly ships the
 * wrong listing's columns.
 *
 * Every flow below runs against the live runtime in `src/live-resolvers.ts`:
 * real engine, real store, seeded from the recorded Jira fixtures at a fixed
 * clock of 2026-03-05T12:00Z. The fixture project holds four issues — FLOW-1
 * (In Progress since 23 Feb), FLOW-2 (Blocked since 3 Mar), FLOW-4 (To Do
 * since this morning) and FLOW-3, which is Done and therefore excluded.
 *
 * ⚠️ One runtime per listing, shared by every flow in this file, and they run
 * in parallel. Only "extending the indexed history" mutates anything, and it
 * mutates the *settings*, not the stored rows — so every assertion that
 * depends on the window being 12 months lives inside that one flow, and no
 * other flow asserts on the indexing banner.
 */

/**
 * Read a `BarChart` stand-in by its title.
 *
 * `forge-host.tsx` draws each bar as `Inline(label, bar div, value)`, so the
 * first and last children of each row are the two text nodes that matter. A
 * zero bar still gets a row — which is the whole point of the histogram.
 */
async function readBars(page, title) {
  return await page.evaluate((wanted) => {
    const trim = (el) => (el === null ? '' : (el.textContent ?? '').trim());
    const heading = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(
      (el) => trim(el) === wanted,
    );
    if (heading === undefined || heading.parentElement === null) return null;
    const rows = heading.parentElement.lastElementChild;
    if (rows === null) return null;
    return [...rows.children].map((row) => ({
      label: trim(row.firstElementChild),
      value: trim(row.lastElementChild),
    }));
  }, title);
}

/**
 * Read a `LineChart` stand-in by its title: one entry per series, its points
 * parsed back out of the `"<day>: <count>  "` text nodes the stand-in emits.
 */
async function readSeries(page, title) {
  const raw = await page.evaluate((wanted) => {
    const trim = (el) => (el === null ? '' : (el.textContent ?? '').trim());
    const heading = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(
      (el) => trim(el) === wanted,
    );
    if (heading === undefined || heading.parentElement === null) return null;
    const rows = heading.parentElement.lastElementChild;
    if (rows === null) return null;
    return {
      subtitle: trim(heading.nextElementSibling),
      series: [...rows.children].map((row) => ({
        name: trim(row.firstElementChild),
        points: row.lastElementChild?.textContent ?? '',
      })),
    };
  }, title);
  if (raw === null) return null;
  return {
    subtitle: raw.subtitle,
    series: raw.series.map((entry) => ({
      name: entry.name,
      points: [...entry.points.matchAll(/(\d{1,2} \w{3} \d{4}): (\d+)/g)].map((match) => ({
        day: match[1],
        count: Number(match[2]),
      })),
    })),
  };
}

/** Read one `SummaryTiles` tile by its label: `{ value, hint }`. */
async function readTile(page, label) {
  return await page.evaluate((wanted) => {
    const trim = (el) => (el === null ? '' : (el.textContent ?? '').trim());
    const stack = [...document.querySelectorAll('div')].find(
      (el) => el.children.length === 3 && trim(el.firstElementChild) === wanted,
    );
    if (stack === undefined) return null;
    return { value: trim(stack.children[1]), hint: trim(stack.children[2]) };
  }, label);
}

/** The report table, as rows of trimmed cell text. Header row excluded. */
async function readTableRows(page) {
  return await page.evaluate(() =>
    [...document.querySelectorAll('table tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => (cell.textContent ?? '').trim()),
    ),
  );
}

export const flows = [
  {
    /**
     * A bucket with no issues in it is a fact, not an absence.
     *
     * `AgingHistogram` exists as its own component precisely because it must
     * not drop empty categories the way the status chart does. If a zero
     * bucket were filtered out, "3-7d" would simply vanish from the axis and
     * the chart would read as though that age range were not measured —
     * while the truth is the far more useful "nothing has sat that long".
     * That regression is one `.filter()` away and invisible in a screenshot,
     * because the remaining bars still look like a perfectly good histogram.
     */
    name: 'wip-aging: the ageing histogram keeps every bucket, including the empty ones',
    app: 'wip-aging',
    screen: 'wip-aging-page',
    async run({ page, expect }) {
      await page
        .getByText('Age distribution')
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 });

      const bars = await readBars(page, 'Age distribution');
      expect.ok(bars !== null, 'the ageing histogram is on the page');

      const labels = bars.map((bar) => bar.label);
      for (const bucket of ['0-1d', '1-3d', '3-7d', '7-14d', '14-30d', '30d+']) {
        expect.contains(labels.join(' | '), bucket, `the histogram shows the ${bucket} bucket`);
      }
      expect.equal(bars.length, 6, 'the histogram shows six age buckets and no others');

      // Oldest bucket last: the axis reads left-to-right as "getting worse".
      expect.equal(labels[5], '30d+', 'the oldest bucket is drawn last');

      // The fixtures put nothing in 3-7d, 14-30d or 30d+. At least one of
      // them must still be drawn, carrying a real zero.
      const zeroed = bars.filter((bar) => bar.value === '0');
      expect.ok(
        zeroed.length > 0,
        'an age range with no issues in it is still drawn, showing 0 rather than being omitted',
      );
      expect.equal(
        bars.find((bar) => bar.label === '3-7d')?.value,
        '0',
        'the 3-7d bucket reports zero issues rather than disappearing from the chart',
      );
    },
  },

  {
    /**
     * ★ The cumulative flow diagram, held to the definition of one.
     *
     * `buildFlowReport` counts an issue in a status when a visit covers the
     * **end** of the day — one instant per day — so an issue that crossed
     * four statuses on a Tuesday lands in exactly one band that Tuesday. Swap
     * that for the obvious-looking "was in this status at some point today"
     * and every chart still renders, every line still looks plausible, and
     * the bands now sum to more issues than the project contains. A CFD whose
     * total is not the work in flight is not a CFD, and nothing but this
     * assertion would notice.
     *
     * FLOW-2 is the witness: on 3 Mar 2026 it went To Do → In Progress →
     * Blocked, and it must appear once, in Blocked, the status it ended the
     * day in.
     *
     * The timezone assertion is here for the same reason it is in the
     * caption: the buckets are UTC days and the reader's Jira very likely is
     * not, so a chart that does not say so is quietly wrong for most of the
     * planet.
     */
    name: 'wip-aging: the cumulative flow bands sum to the work in flight, never more',
    app: 'wip-aging',
    screen: 'wip-aging-page',
    async run({ page, expect }) {
      await page
        .getByText('Cumulative flow')
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 });

      const chart = await readSeries(page, 'Cumulative flow');
      expect.ok(chart !== null, 'the cumulative flow diagram is on the page');
      expect.contains(
        chart.subtitle,
        'UTC',
        'the flow caption names the timezone its day buckets are cut on',
      );

      // One line per status used in the window, and only one.
      const names = chart.series.map((series) => series.name);
      expect.equal(
        new Set(names).size,
        names.length,
        'each status in the window gets exactly one line, not one line per visit',
      );

      // Every status an in-flight issue is sitting in must have a band, or
      // the chart is describing a different set of issues than the table.
      const rows = await readTableRows(page);
      for (const statusName of new Set(rows.map((row) => row[1]))) {
        expect.contains(
          names.join(' | '),
          statusName,
          `the status "${statusName}" the table reports is drawn as its own flow band`,
        );
      }

      // Every band must carry a point on every day — a band that simply
      // omits its empty days draws a straight line across the gap, which
      // reads as "steady" where the truth is "none".
      const dayCount = chart.series[0]?.points.length ?? 0;
      expect.equal(dayCount, 30, 'the 30-day window is drawn as 30 points per band');
      for (const series of chart.series) {
        expect.equal(
          series.points.length,
          dayCount,
          `the "${series.name}" band has a point on every day in the window, zeroes included`,
        );
      }

      // The report's own universe of issues: the rows it lists plus the
      // finished ones it says it left out.
      const footnote = await page.locator('body').innerText();
      const excluded = Number(/(\d+) finished issues? (?:is|are) excluded/.exec(footnote)?.[1]);
      expect.ok(
        Number.isFinite(excluded),
        'the table footnote states how many finished issues were excluded',
      );
      const knownIssues = rows.length + excluded;

      const totalByDay = new Map();
      for (const series of chart.series) {
        for (const point of series.points) {
          totalByDay.set(point.day, (totalByDay.get(point.day) ?? 0) + point.count);
        }
      }

      const overflowing = [...totalByDay.entries()].filter(([, total]) => total > knownIssues);
      expect.equal(
        overflowing.length,
        0,
        'no day stacks more issues across the bands than the project holds — an issue that ' +
          `moved several times in a day is counted once (over on: ${overflowing
            .map(([day, total]) => `${day}=${String(total)}`)
            .join(', ')})`,
      );

      expect.equal(
        Math.max(...totalByDay.values()),
        knownIssues,
        'on its fullest day the bands account for every issue the report knows about',
      );

      // FLOW-2 crossed three statuses on 3 Mar. The day's bands must total
      // three issues, not five, and FLOW-2 must sit only in the status it
      // finished the day in.
      expect.equal(
        totalByDay.get('3 Mar 2026'),
        3,
        'an issue that passed through three statuses in one day is counted once that day, ' +
          'in the status it ended the day in',
      );
      expect.equal(
        chart.series
          .find((series) => series.name === 'To Do')
          ?.points.find((p) => p.day === '3 Mar 2026')?.count,
        0,
        'a status an issue merely passed through during the day contributes nothing to that day',
      );
      expect.equal(
        chart.series
          .find((series) => series.name === 'Blocked')
          ?.points.find((p) => p.day === '3 Mar 2026')?.count,
        2,
        'the status an issue was sitting in at the end of the day is the one that counts it',
      );
    },
  },

  {
    /**
     * The tiles and the table have to be describing the same report.
     *
     * They are built by two different functions from one payload, and the
     * dashboard gadget ships the tiles *without* the table — so on the
     * surface most people see, the tiles are the entire report and nothing
     * on screen can contradict them. "In flight: 3" above four rows, or an
     * "Oldest" tile naming an issue that is not at the top of an
     * oldest-first table, is the report lying about its own contents, and
     * neither is visible without comparing the two.
     */
    name: 'wip-aging: the summary tiles agree with the table beneath them',
    app: 'wip-aging',
    screen: 'wip-aging-page',
    async run({ page, expect }) {
      await page.getByText('In flight').first().waitFor({ state: 'visible', timeout: 15_000 });
      await page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 15_000 });

      const rows = await readTableRows(page);
      expect.ok(rows.length > 0, 'the table lists the issues in flight');

      const inFlight = await readTile(page, 'In flight');
      expect.ok(inFlight !== null, 'the "In flight" tile is on the page');
      expect.equal(
        inFlight.value,
        String(rows.length),
        'the "In flight" tile counts exactly the issues the table lists',
      );

      // `buildAgingReport` sorts oldest-first, so row 0 is the oldest issue
      // and the tile must be describing that one.
      const oldest = await readTile(page, 'Oldest');
      expect.ok(oldest !== null, 'the "Oldest" tile is on the page');
      expect.contains(
        oldest.hint,
        rows[0][0],
        'the "Oldest" tile names the issue at the top of the oldest-first table',
      );
      expect.contains(
        oldest.hint,
        rows[0][1],
        'the "Oldest" tile names the status that issue is sitting in',
      );
      expect.equal(
        oldest.value,
        rows[0][2],
        'the "Oldest" tile shows the same age the table shows for that issue',
      );
    },
  },

  {
    /**
     * A row count nobody can check is not a row count.
     *
     * This report silently drops every finished issue, which is the right
     * behaviour and an alarming one to meet unannounced: a project manager
     * comparing "3 in flight" against a backlog of 40 issues needs to be told
     * where the other 37 went. The footnote is the only place the product
     * says so, and it has to carry the number — "some issues are excluded"
     * would leave the arithmetic unclosable.
     */
    name: 'wip-aging: the table states how many finished issues it left out',
    app: 'wip-aging',
    screen: 'wip-aging-page',
    async run({ page, expect }) {
      await page
        .getByText('ageing only applies to work in flight')
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 });

      const body = await page.locator('body').innerText();
      expect.contains(
        body,
        '1 finished issue is excluded; ageing only applies to work in flight.',
        'the footnote counts the finished issues held back, in singular English for one of them',
      );

      // Stated *and* true: the excluded count plus the listed rows is the
      // whole project, which is what makes the row count checkable at all.
      const rows = await readTableRows(page);
      expect.equal(rows.length, 3, 'the three unfinished fixture issues are the rows on screen');
      expect.absent(
        rows.some((row) => row[0] === 'FLOW-3'),
        'the resolved issue FLOW-3 is not aged as though it were still in flight',
      );
    },
  },

  {
    /**
     * The round trip a frozen snapshot cannot show.
     *
     * "Extend history" is the one control in the product that spends the
     * installation's entire Jira request budget, and until it round-trips it
     * is worse than absent: a user widens the window, the modal closes, and
     * nothing anywhere says whether it took. The reopen is the assertion that
     * matters — the first dialog could name the new range from local state
     * while the setting never reached the store.
     *
     * Only wider ranges may be offered. Narrowing would not delete the rows
     * already stored, so the report would keep showing history the page had
     * just claimed was out of range; the resolver refuses it, and a control
     * that offers what it knows will be refused is a bug report waiting to be
     * filed.
     *
     * ⚠️ This is the only flow that mutates the shared runtime, and the only
     * one allowed to assert on the history window.
     */
    name: 'wip-aging: extending the indexed history round-trips to the store',
    app: 'wip-aging',
    screen: 'wip-aging-page',
    async run({ page, expect }) {
      const openControl = async () => {
        await page.getByRole('button', { name: 'Extend history' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 15_000 });
        await page
          .getByText('This project is indexed over')
          .waitFor({ state: 'visible', timeout: 15_000 });
        return dialog;
      };
      const offeredRanges = async () => {
        await page.locator('#extend-history-range').press('ArrowDown');
        await page.getByRole('option').first().waitFor({ state: 'visible', timeout: 15_000 });
        return await page.evaluate(() =>
          [...document.querySelectorAll('[role="option"]')].map((o) =>
            (o.textContent ?? '').trim(),
          ),
        );
      };

      const dialog = await openControl();
      expect.contains(
        await dialog.innerText(),
        'last 12 months',
        'the modal names the range currently in force before offering to change it',
      );
      expect.contains(
        await dialog.innerText(),
        'read from Jira again',
        'the modal says what re-indexing will spend before the user commits to it',
      );

      const before = await offeredRanges();
      expect.absent(
        before.includes('Last 12 months'),
        'the range already in force is offered again, which the resolver would refuse',
      );
      for (const narrower of ['Last 3 months', 'Last 6 months']) {
        expect.absent(
          before.includes(narrower),
          `a narrower range (${narrower}) is offered, which would leave stored rows the page calls out of range`,
        );
      }
      expect.contains(before.join(' | '), 'Last 2 years', 'a wider range is offered');
      expect.contains(
        before.join(' | '),
        'All history',
        'all history is offered as the widest range',
      );

      await page.getByRole('option', { name: 'Last 2 years' }).click();
      await page.getByRole('button', { name: 'Re-index' }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 30_000 });

      // Reopened from scratch: the range below was read back out of the
      // store by a fresh `getHistoryWindow`, not remembered in the component.
      const reopened = await openControl();
      expect.contains(
        await reopened.innerText(),
        'last 2 years',
        'reopening the control shows the widened range, so the change reached the store',
      );
      const after = await offeredRanges();
      expect.absent(
        after.includes('Last 2 years'),
        'the newly-chosen range is still offered as something to extend to',
      );
      expect.contains(
        after.join(' | '),
        'Last 3 years',
        'ranges wider than the new one are still on offer',
      );
    },
  },

  {
    /**
     * Every listing's export button used to invoke the *time-in-status*
     * exporter regardless of the report on screen — a real bug, and one that
     * survives any test asserting only that "a CSV appeared". The file looked
     * entirely legitimate; it was simply a different report.
     *
     * So this asserts the ageing header row exactly, and asserts the absence
     * of the columns that would betray the time-in-status table.
     */
    name: "wip-aging: Export CSV exports the ageing report, not another listing's",
    app: 'wip-aging',
    screen: 'wip-aging-page',
    async run({ page, expect }) {
      await page.getByRole('button', { name: 'Export CSV' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });

      expect.contains(
        await dialog.innerText(),
        'wip-aging-10000.csv',
        'the export is named for this listing and this project',
      );

      // Read the `<pre>` rather than the rendered text: the CSV is CRLF and
      // a header cell contains commas, so only the raw node is checkable.
      const csv = (await dialog.locator('pre').textContent()) ?? '';
      const lines = csv.split(/\r?\n/);

      expect.equal(
        lines[0],
        'Issue key,Status,Age in status (hours),' +
          '"Age in status, working, completed portion (hours)",' +
          'Age total (hours),Entered status (UTC)',
        'the exported header row is the ageing report’s own columns',
      );

      for (const foreign of ['Current status', 'History complete', '(times entered)']) {
        expect.absent(
          csv.includes(foreign),
          `the export carries the time-in-status column "${foreign}", so the wrong report was exported`,
        );
      }

      expect.contains(csv, 'FLOW-1', 'the export carries the real rows from the store');
      expect.absent(
        csv.includes('FLOW-3'),
        'the export includes the finished issue the report on screen excludes',
      );
    },
  },

  {
    /**
     * The gadget is the tiles and nothing else, on purpose.
     *
     * A dashboard gadget is a small tile on a board of other people's tiles,
     * and it is the surface seen by colleagues who never installed the app.
     * Dropping the full table into it — one shared `SummaryTiles` import away
     * — would blow out every dashboard it is placed on, and the component
     * test that mounts the gadget would still pass because the table renders
     * perfectly well.
     */
    name: 'wip-aging: the gadget shows the tiles and withholds the table',
    app: 'wip-aging',
    screen: 'wip-aging-gadget',
    async run({ page, expect }) {
      await page.getByText('WIP Aging').first().waitFor({ state: 'visible', timeout: 15_000 });
      await page.getByText('In flight').first().waitFor({ state: 'visible', timeout: 15_000 });

      const inFlight = await readTile(page, 'In flight');
      expect.ok(inFlight !== null, 'the gadget shows the "In flight" tile');
      expect.equal(inFlight.value, '3', 'the gadget counts the issues in flight');
      expect.ok(
        (await readTile(page, 'Oldest')) !== null,
        'the gadget shows the "Oldest" tile — the one figure a dashboard reader acts on',
      );
      expect.ok(
        (await readTile(page, 'Older than 14 days')) !== null,
        'the gadget shows the "Older than 14 days" tile',
      );

      expect.equal(
        await page.locator('table').count(),
        0,
        'the gadget renders the per-issue table, which would swamp the dashboard it sits on',
      );
      const body = await page.locator('body').innerText();
      expect.absent(
        body.includes('Entered status'),
        'the gadget renders the table’s columns despite having no table',
      );
    },
  },

  {
    /**
     * The admin page answers "what is this app storing, and will it cost me?"
     * and must answer it for *this* app.
     *
     * WIP Aging is the only listing that ingests `issue_status_visit` — the
     * dataset the cumulative flow diagram is built from — so a zero there
     * would mean either the listing is not storing what it needs or the admin
     * page is reading another installation's database. Each app has its own
     * Forge SQL database; a shared runtime in the harness would hide exactly
     * that mistake, which is why `live-resolvers.ts` keeps one per listing.
     *
     * And nothing issue-shaped may appear here. `jira:adminPage` is reachable
     * by any Jira administrator, including ones with no permission on the
     * projects these rows came from, so a single issue key on this page is a
     * permissions leak rather than a cosmetic slip.
     */
    name: 'wip-aging: the admin page counts stored visits and names no issue',
    app: 'wip-aging',
    screen: 'wip-aging-admin',
    async run({ page, expect }) {
      await page
        .getByText('WIP Aging — storage')
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 });
      await page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 15_000 });

      const rows = await readTableRows(page);
      const visits = rows.find((row) => row[0] === 'issue_status_visit');
      expect.ok(visits !== undefined, 'the storage table lists the issue_status_visit table');
      expect.ok(
        Number(visits[1].replace(/,/g, '')) > 0,
        'this listing stores status visits, so its own database must report some — ' +
          'zero here means the flow diagram has nothing to read',
      );
      expect.ok(
        Number(rows.find((row) => row[0] === 'issue_meta')?.[1].replace(/,/g, '')) > 0,
        'the storage table reports the issues this installation has indexed',
      );

      const body = await page.locator('body').innerText();
      expect.absent(
        body.includes('FLOW-'),
        'an issue key reached the admin page, which any Jira admin can open regardless of ' +
          'their permission on the project the row came from',
      );
    },
  },
  {
    /**
     * The six buckets add up to the number the tile claims is in flight.
     *
     * "Every bucket is rendered, including the empty ones" is already covered;
     * what is not is whether the bars *account for* the population. A bucket
     * boundary that overlaps double-counts an issue, and one that leaves a gap
     * drops it — and both render as a perfectly plausible histogram. The tile
     * is the independent count, taken from the table rather than the chart, so
     * the two disagreeing means one of them is lying about the same project.
     *
     * This is the arithmetic a reader does by eye and trusts without checking,
     * which is exactly why nothing else checks it.
     */
    name: 'wip-aging: the age buckets account for every issue the tile counts',
    app: 'wip-aging',
    screen: 'wip-aging-page',
    async run({ page, expect }) {
      const bars = await readBars(page, 'Age distribution');
      expect.ok(bars !== null, 'the age distribution chart is on the page');
      expect.equal(bars.length, 6, 'all six buckets are drawn, empty ones included');

      const counted = bars.reduce((total, bar) => total + Number(bar.value ?? 0), 0);
      const inFlight = Number(
        (
          await page
            .getByText('In flight', { exact: true })
            .first()
            .locator('xpath=ancestor::div[1]')
            .innerText()
        )
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)[1],
      );

      expect.ok(Number.isFinite(inFlight), 'the "In flight" tile reports a number');
      expect.equal(
        counted,
        inFlight,
        'the buckets sum to the issues in flight — an overlapping boundary would count one ' +
          'issue twice and a gap would drop one, and either draws a histogram that looks right',
      );
    },
  },
];
