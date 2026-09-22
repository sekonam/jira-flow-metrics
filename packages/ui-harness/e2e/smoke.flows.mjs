/**
 * The flow that proves the harness itself, before any feature flow relies on
 * it: a real click, reaching a real resolver, changing what is on screen.
 *
 * If this fails, every other failure in this run is suspect.
 */
export const flows = [
  {
    name: 'smoke: the live bridge reaches a real resolver and the export modal opens',
    app: 'time-in-status',
    screen: 'time-in-status-page',
    async run({ page, expect }) {
      // The report rendered from the live runtime, not from a snapshot.
      expect.ok(
        await page.getByText('Time in Status').first().isVisible(),
        'the page heading renders',
      );

      // A real click on a real button. `CsvExport` invokes `exportCsv`, which
      // runs the real exporter over the real store and comes back over the
      // real @forge/bridge client.
      await page.getByRole('button', { name: 'Export CSV' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });

      const text = await dialog.innerText();
      expect.contains(
        text,
        'time-in-status-10000.csv',
        'the modal names the file the resolver built',
      );
      expect.contains(text, 'Issue', 'the modal holds the real CSV header row');
      expect.contains(text, 'FLOW-', 'the CSV carries real issue keys from the fixtures');
    },
  },
];
