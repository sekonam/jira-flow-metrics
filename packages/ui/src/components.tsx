import React from 'react';
import {
  BarChart,
  Box,
  Button,
  CodeBlock,
  DynamicTable,
  EmptyState,
  Heading,
  Inline,
  LoadingButton,
  Lozenge,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Label,
  ModalTransition,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Strong,
  Text,
} from '@forge/react';
import type {
  ChartPoint,
  ProgressBanner,
  ProjectOption,
  ReportTableModel,
  SummaryTile,
} from './view-model.js';
import {
  SLA_TARGET_OPTIONS,
  describeHistoryWindow,
  historyWindowOptions,
  parseHistoryWindowValue,
  toggleCountedStatus,
  type SimpleTable,
  type SlaGoalChoice,
} from './listing-models.js';

/**
 * Shared Forge UI Kit components.
 *
 * These follow the Atlassian Design System through `@forge/react` rather than
 * introducing a bespoke visual language — partly because the design system is
 * good, mostly because a Marketplace app that looks foreign inside Jira reads
 * as untrustworthy, and this product's only asset is being trusted with
 * numbers.
 *
 * ## How these are tested
 *
 * UI Kit 2 components are string sentinels reconciled into a ForgeDoc and sent
 * over the bridge; the code that turns that document into Atlassian Design
 * System markup ships inside Jira and is not installable. `test/components.test.tsx`
 * therefore renders these against a stand-in host renderer
 * (`packages/ui-harness/src/forge-host.tsx`) which maps each sentinel onto the
 * ADS component the Forge host is documented to render it as.
 *
 * ⚠️ That proves the tree is coherent, the states are chosen correctly, the
 * numbers reach the DOM, and the markup passes the **structural** half of an
 * axe WCAG 2.1 AA audit — jsdom has no layout, so `color-contrast` is disabled
 * there and is checked instead by `pnpm run ui:screens` in real Chromium,
 * which CI does not run. It
 * does **not** prove Forge renders it identically or accepts these props —
 * only `forge tunnel` against a real tenant can, and no Atlassian credentials
 * exist in this repository. That check is still item 1 in `docs/RUNBOOK.md`
 * § "First tunnel session".
 */

export function LoadingSurface({ label }: { label: string }): React.JSX.Element {
  return (
    <Box padding="space.200">
      <Inline alignBlock="center" space="space.100">
        <Spinner size="medium" label={label} />
        <Text>{label}</Text>
      </Inline>
    </Box>
  );
}

export function ErrorSurface({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <SectionMessage title="Could not load this report" appearance="error">
      {/*
        Stacked, not inline. Left as siblings the button sits hard against the
        end of the sentence with no separation, which reads as part of the
        text rather than as an action.
      */}
      <Stack space="space.150" alignInline="start">
        <Text>{message}</Text>
        {onRetry !== undefined ? <Button onClick={onRetry}>Try again</Button> : null}
      </Stack>
    </SectionMessage>
  );
}

export function EmptySurface({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <EmptyState
      header={title}
      description={body}
      primaryAction={
        actionLabel !== undefined && onAction !== undefined ? (
          <Button appearance="primary" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : undefined
      }
    />
  );
}

/**
 * The dashboard gadget's edit-mode project picker.
 *
 * A `jira:dashboardGadget` context carries no project of its own — confirmed
 * live, every gadget refused with "This report can only be opened from
 * inside a Jira project" the first time one was added to a real dashboard —
 * so the gadget owner chooses one explicitly here, once, through Jira's own
 * edit-mode chrome. `onSave` is expected to call `view.submit`, which is a
 * bridge API this package does not depend on directly, keeping the picker
 * testable without Forge.
 */
export function GadgetConfigForm({
  options,
  error,
  saving,
  onSave,
}: {
  options: readonly ProjectOption[] | null;
  error?: string | undefined;
  saving: boolean;
  onSave: (projectId: string) => void;
}): React.JSX.Element {
  const [selected, setSelected] = React.useState<ProjectOption | null>(null);

  if (error !== undefined) return <ErrorSurface message={error} />;
  if (options === null) return <LoadingSurface label="Loading projects" />;

  return (
    <Stack space="space.150">
      <Text>Choose the project this gadget reports on.</Text>
      <Label labelFor="gadget-config-project">Project</Label>
      <Select
        inputId="gadget-config-project"
        options={options}
        placeholder="Select a project"
        isLoading={saving}
        isDisabled={saving}
        onChange={(option) => setSelected(option as ProjectOption | null)}
      />
      <Button
        appearance="primary"
        isDisabled={selected === null || saving}
        onClick={() => {
          if (selected !== null) onSave(selected.value);
        }}
      >
        Save
      </Button>
    </Stack>
  );
}

/**
 * The SLA page's goal picker — the counted statuses and the working-time
 * target every row is measured against.
 *
 * Status chips are toggle `Button`s rather than a multi-select because UI
 * Kit 2's `Select` is single-value; the target is a preset `Select` (see
 * `SLA_TARGET_OPTIONS`). An empty selection means every status counts, and
 * the caption says so — the goal is a view choice, and the reader must be
 * able to tell what the numbers on screen are measured against.
 */
export function SlaGoalForm({
  statuses,
  goal,
  onChange,
}: {
  statuses: readonly { id: string; name: string }[];
  goal: SlaGoalChoice;
  onChange: (next: SlaGoalChoice) => void;
}): React.JSX.Element {
  const defaultTarget = SLA_TARGET_OPTIONS.find((o) => o.value === String(goal.targetMs));
  return (
    <Stack space="space.150">
      <Label labelFor="sla-goal-target">Working-time target</Label>
      <Select
        inputId="sla-goal-target"
        options={SLA_TARGET_OPTIONS}
        {...(defaultTarget === undefined ? {} : { defaultValue: defaultTarget })}
        onChange={(option) => {
          const value = (option as { value?: string } | null)?.value;
          if (value !== undefined) onChange({ ...goal, targetMs: Number(value) });
        }}
      />
      <Text size="small">
        {goal.countedStatusIds.length === 0
          ? 'Counting time in every status. Select statuses to count only those.'
          : 'Counting time only in the selected statuses.'}
      </Text>
      <Inline space="space.100" shouldWrap>
        {statuses.map((status) => (
          <Button
            key={status.id}
            isSelected={goal.countedStatusIds.includes(status.id)}
            onClick={() => {
              onChange(toggleCountedStatus(goal, status.id));
            }}
          >
            {status.name}
          </Button>
        ))}
      </Inline>
    </Stack>
  );
}

/**
 * The indexing banner. Informational only, except on failure.
 *
 * It used to carry its own "Start indexing" button unconditionally. Looking
 * at the rendered screen showed why that was wrong: a project with no index
 * has no rows, so the empty state is on screen at the same time — and the
 * empty state's centred primary action is the same action. Every unindexed
 * project showed the button twice. One action, one place — for every state
 * except `failed`.
 *
 * A failed backfill breaks that assumption: it fails after processing some
 * issues, not before, so the report is not empty and `EmptySurface`'s button
 * never renders. Found live bulk-seeding past 300 issues — a project whose
 * backfill failed partway had no way back on screen at all. `onRetry` is
 * only rendered when `banner.showRetry` is set, which is only ever true for
 * `failed`, so every other state still shows exactly the one button it did.
 */
export function IndexingBanner({
  banner,
  onRetry,
}: {
  banner: ProgressBanner | null;
  onRetry?: (() => void) | undefined;
}): React.JSX.Element | null {
  if (banner === null) return null;
  return (
    <SectionMessage title={banner.title} appearance={banner.appearance}>
      <Inline alignBlock="center" space="space.100">
        {banner.showSpinner ? <Spinner size="small" label="Indexing" /> : null}
        <Text>{banner.body}</Text>
      </Inline>
      {banner.showRetry && onRetry !== undefined ? (
        <Button appearance="warning" onClick={onRetry}>
          Retry indexing
        </Button>
      ) : null}
    </SectionMessage>
  );
}

export function SummaryTiles({ tiles }: { tiles: readonly SummaryTile[] }): React.JSX.Element {
  return (
    <Inline space="space.200" shouldWrap>
      {tiles.map((tile) => (
        <Box key={tile.label} padding="space.150" backgroundColor="color.background.neutral">
          <Stack space="space.050">
            <Text size="small">{tile.label}</Text>
            <Heading as="h3">{tile.value}</Heading>
            <Text size="small">{tile.hint}</Text>
          </Stack>
        </Box>
      ))}
    </Inline>
  );
}

/**
 * A labelled bar chart over a `ChartPoint` series.
 *
 * Renders through `@forge/react`'s native `BarChart`, not a hand-rolled
 * chart: the platform ships one, so building a second is the "beyond what
 * the task requires" this repo avoids elsewhere. `xAccessor`/`yAccessor`
 * name the fields on each `ChartPoint`; `BarChart` itself accepts an
 * `unknown[]`, which is why the cast is here and nowhere else.
 *
 * An empty series renders nothing rather than an empty axis. Every caller
 * sits above a table that is already showing the same data, so a chart with
 * no bars adds a confusing 400px of blank plot area and says nothing the
 * table does not.
 */
export function ReportBarChart({
  data,
  title,
  subtitle,
}: {
  data: readonly ChartPoint[];
  title: string;
  subtitle: string;
}): React.JSX.Element | null {
  if (data.length === 0) return null;
  return (
    <BarChart
      data={data as unknown[]}
      xAccessor="label"
      yAccessor="value"
      title={title}
      subtitle={subtitle}
    />
  );
}

/**
 * The WIP-aging bucket histogram — 0-1d, 1-3d, ... 30d+, oldest bucket last.
 *
 * The one chart that renders its empty categories: a bucket with no issues
 * in it is a real, meaningful zero ("nothing has sat that long"), unlike the
 * dropped categories in `toStatusChartData`. Hence the explicit `data` rather
 * than a filtered series, and hence its own component rather than a call to
 * `ReportBarChart` with a different title.
 */
export function AgingHistogram({ data }: { data: readonly ChartPoint[] }): React.JSX.Element {
  return (
    <BarChart
      data={data as unknown[]}
      xAccessor="label"
      yAccessor="value"
      title="Age distribution"
      subtitle="Unfinished issues in flight, grouped by how long they've sat in their current status."
    />
  );
}

/**
 * The report table.
 *
 * The "x2" lozenge on a re-entered status is the one piece of visual design
 * that carries the product's argument: it is the number Jira's own control
 * chart cannot show, and it is why the cumulative total differs from what the
 * user sees natively.
 */
export function ReportTable({ model }: { model: ReportTableModel }): React.JSX.Element {
  const head = {
    cells: model.headers.map((header, index) => ({
      key: `h-${index}`,
      content: header,
      isSortable: index === 0,
    })),
  };

  const rows = model.rows.map((row, rowIndex) => ({
    key: `${row.issueKey}-${rowIndex}`,
    cells: [
      {
        key: 'issue',
        content: (
          <Inline space="space.075" alignBlock="center">
            <Strong>{row.issueKey}</Strong>
            {row.truncated ? <Lozenge appearance="moved">partial history</Lozenge> : null}
          </Inline>
        ),
      },
      { key: 'status', content: <Text>{row.currentStatus}</Text> },
      { key: 'created', content: <Text>{row.created}</Text> },
      { key: 'resolved', content: <Text>{row.resolved}</Text> },
      ...row.cells.map((cell, index) => ({
        key: `c-${index}`,
        content: (
          <Inline space="space.075" alignBlock="center">
            <Text>{cell.text}</Text>
            {cell.reentered ? (
              <Lozenge appearance="inprogress">{`x${cell.entries ?? 0}`}</Lozenge>
            ) : null}
          </Inline>
        ),
      })),
      { key: 'total', content: <Strong>{row.total}</Strong> },
    ],
  }));

  return (
    <Stack space="space.150">
      <DynamicTable head={head} rows={rows} rowsPerPage={25} />
      {model.footnotes.map((note) => (
        <Text key={note} size="small">
          {note}
        </Text>
      ))}
    </Stack>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: React.ReactNode | undefined;
}): React.JSX.Element {
  return (
    <Stack space="space.100">
      <Heading as="h1">{title}</Heading>
      <Inline spread="space-between" alignBlock="center">
        <Text>{subtitle}</Text>
        {actions}
      </Inline>
    </Stack>
  );
}

/** A plain table for the listings whose data is a flat list of rows. */
export function SimpleReportTable({ model }: { model: SimpleTable }): React.JSX.Element {
  // Clamped: an out-of-range index would silently emphasise nothing.
  const emphasis = Math.min(Math.max(model.emphasisColumn ?? 0, 0), model.headers.length - 1);
  const head = {
    cells: model.headers.map((header, index) => ({
      key: `h-${index}`,
      content: header,
      // Sort on the identity column, which is not always the first. The
      // history table leads with a formatted timestamp, and sorting
      // "9 Mar 2026 12:00" as a string is alphabetical, not chronological.
      isSortable: index === emphasis,
    })),
  };
  const rows = model.rows.map((row, rowIndex) => ({
    key: `r-${rowIndex}`,
    cells: row.map((value, index) => ({
      key: `c-${index}`,
      content: index === emphasis ? <Strong>{value}</Strong> : <Text>{value}</Text>,
    })),
  }));
  return (
    <Stack space="space.150">
      <DynamicTable head={head} rows={rows} rowsPerPage={25} />
      {model.footnotes.map((note) => (
        <Text key={note} size="small">
          {note}
        </Text>
      ))}
    </Stack>
  );
}

/**
 * The "extend history" control.
 *
 * A backfill covers twelve months by default, to keep a first index bounded
 * on a large instance. Until now nothing could change that, so the "extend
 * history once the initial pass is complete" mitigation the settings
 * docstring has always promised did not exist.
 *
 * It loads the current window only when opened, not on every page render:
 * almost nobody opens it, and on a consumption-priced platform a field on the
 * report envelope would be paid for by every reader of every page.
 *
 * The modal states what pressing the button does — re-read this project from
 * Jira, from the beginning — because it spends the installation's Jira
 * requests and its Forge invocations, and a control that quietly does that is
 * not one a customer should meet by accident.
 */
export function ExtendHistoryControl({
  onLoad,
  onExtend,
}: {
  onLoad: () => Promise<{ months: number | null }>;
  onExtend: (months: number | null) => Promise<void>;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [current, setCurrent] = React.useState<number | null | undefined>(undefined);
  const [chosen, setChosen] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const close = React.useCallback(() => {
    setOpen(false);
    setError(null);
    setChosen(null);
  }, []);

  const load = React.useCallback(() => {
    setOpen(true);
    setError(null);
    setCurrent(undefined);
    onLoad()
      .then((window) => {
        setCurrent(window.months);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'The current range could not be read.');
      });
  }, [onLoad]);

  const submit = React.useCallback(() => {
    if (chosen === null) return;
    const months = parseHistoryWindowValue(chosen);
    if (months === undefined) {
      setError('Choose one of the listed ranges.');
      return;
    }
    setBusy(true);
    setError(null);
    onExtend(months)
      .then(close)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'The range could not be changed.');
      })
      .finally(() => {
        setBusy(false);
      });
  }, [chosen, close, onExtend]);

  const options = current === undefined || current === null ? [] : historyWindowOptions(current);

  return (
    <>
      <Button onClick={load}>Extend history</Button>
      <ModalTransition>
        {open && (
          <Modal onClose={close}>
            <ModalHeader>
              <ModalTitle>Extend indexed history</ModalTitle>
            </ModalHeader>
            <ModalBody>
              {current === undefined && error === null ? (
                <LoadingSurface label="Reading the current range" />
              ) : (
                <Stack space="space.150">
                  <Text>
                    This project is indexed over{' '}
                    <Strong>{describeHistoryWindow(current ?? null).toLowerCase()}</Strong>.
                  </Text>
                  {options.length === 0 ? (
                    <Text>
                      All available history is already indexed. There is nothing further to extend.
                    </Text>
                  ) : (
                    <>
                      <Label labelFor="extend-history-range">New range</Label>
                      <Select
                        inputId="extend-history-range"
                        options={options}
                        placeholder="Choose a range"
                        isDisabled={busy}
                        onChange={(option) => {
                          const value = (option as { value?: string } | null)?.value;
                          setChosen(value ?? null);
                        }}
                      />
                      <Text size="small">
                        Re-indexes this project from the beginning: every issue in the new range is
                        read from Jira again. Reports stay readable while it runs and the banner
                        shows progress. Figures cannot change except by covering more history —
                        indexing replaces an issue&apos;s stored rows rather than adding to them.
                      </Text>
                    </>
                  )}
                  {error !== null && (
                    <SectionMessage title="Could not extend the range" appearance="error">
                      <Text>{error}</Text>
                    </SectionMessage>
                  )}
                </Stack>
              )}
            </ModalBody>
            <ModalFooter>
              <Button onClick={close}>Cancel</Button>
              {options.length === 0 ? null : (
                <LoadingButton
                  appearance="primary"
                  isLoading={busy}
                  isDisabled={chosen === null}
                  onClick={submit}
                >
                  Re-index
                </LoadingButton>
              )}
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </>
  );
}

/**
 * The CSV export control.
 *
 * ## Why this shows the file instead of downloading it
 *
 * UI Kit 2 renders in a sandboxed frame with no DOM, so the usual mechanisms
 * are all unavailable: there is no `Blob`, no `<a download>`, no way to hand
 * the browser a file. The obvious workaround — `router.open` on a
 * `data:text/csv` URI — does not work either, and not because of Forge:
 * Chrome blocks top-level navigation to `data:` URLs outright, so the tab
 * opens onto nothing. A Custom UI resource would have real DOM and could do a
 * proper download, but these listings are `render: native` throughout and
 * converting one surface to Custom UI to add a download button would cost more
 * than it returns.
 *
 * So the export is shown, selectable, with its filename. It is honest about
 * what it is, and it is reachable — which beats the resolver that has existed
 * since the beginning with nothing calling it.
 *
 * `onRequestCsv` is a callback rather than an `invoke` here on purpose: this
 * package holds presentation, and the bridge belongs to the app frontends.
 */
export function CsvExport({
  onRequestCsv,
}: {
  onRequestCsv: () => Promise<{ filename: string; csv: string }>;
}): React.JSX.Element {
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ filename: string; csv: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const run = React.useCallback(() => {
    setBusy(true);
    setError(null);
    onRequestCsv()
      .then(setResult)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'The export could not be produced.');
      })
      .finally(() => {
        setBusy(false);
      });
  }, [onRequestCsv]);

  return (
    <>
      <LoadingButton isLoading={busy} onClick={run}>
        Export CSV
      </LoadingButton>

      {error !== null && (
        <SectionMessage title="Export failed" appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      <ModalTransition>
        {result !== null && (
          <Modal
            onClose={() => {
              setResult(null);
            }}
            width="x-large"
          >
            <ModalHeader>
              <ModalTitle>{result.filename}</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Stack space="space.100">
                <Text>
                  Select the text below and copy it, then save it as{' '}
                  <Strong>{result.filename}</Strong>. Jira apps render in a sandbox that cannot hand
                  a file to the browser.
                </Text>
                <CodeBlock language="text" text={result.csv} />
              </Stack>
            </ModalBody>
            <ModalFooter>
              <Button
                onClick={() => {
                  setResult(null);
                }}
              >
                Close
              </Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </>
  );
}
