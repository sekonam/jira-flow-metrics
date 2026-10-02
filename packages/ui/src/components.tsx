import React from 'react';
import {
  BarChart,
  Box,
  Button,
  CodeBlock,
  DatePicker,
  DynamicTable,
  EmptyState,
  Heading,
  Inline,
  LineChart,
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
  Textfield,
  xcss,
} from '@forge/react';
import {
  WORKING_TIME,
  formatDurationForHumans,
  type ChartPoint,
  type MaybeProgress,
  type ProgressBanner,
  type SeriesPoint,
  type ProjectOption,
  type ReportTableModel,
  type SummaryTile,
} from './view-model.js';
import {
  SLA_TARGET_OPTIONS,
  describeHistoryWindow,
  historyWindowOptions,
  parseHistoryWindowValue,
  toGoalChoice,
  toggleCountedStatus,
  withTarget,
  type SavedSlaGoal,
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
 * The SLA page's goal picker and editor.
 *
 * Status chips are toggle `Button`s rather than a multi-select because UI
 * Kit 2's `Select` is single-value; the target is a preset `Select` (see
 * `SLA_TARGET_OPTIONS`). An empty selection means every status counts, and
 * the caption says so — the goal is what the numbers on screen are measured
 * against, and the reader must be able to tell what it is.
 *
 * ★ Saved goals are the one piece of **stored configuration** in the
 * product; everything else a page offers is a view choice that changes
 * nothing for anyone else. Two people opening this report are meant to see
 * the same numbers measured the same way, which is the whole reason
 * PRODUCT-SPEC § 7 asked for an editor rather than another dropdown.
 *
 * Three states the design has to keep apart, because conflating them is how
 * a report ends up labelled with a goal it is not computing:
 *
 * - **a saved goal, unmodified** — the report is resolved from storage by id;
 * - **a saved goal, since edited** — `toggleCountedStatus`/`withTarget` drop
 *   the id, so the report reverts to the ad-hoc path and the caption says the
 *   selection is unsaved;
 * - **never saved** — the v1 behaviour, unchanged.
 */
/** The chosen statuses by name, in the order the chips are shown. */
function countedNames(
  statuses: readonly { id: string; name: string }[],
  countedStatusIds: readonly string[],
): string {
  const chosen = statuses.filter((status) => countedStatusIds.includes(status.id));
  // An id with no matching status is still worth naming: it means the goal
  // counts something this project no longer has, and silently dropping it
  // would make the caption disagree with the numbers.
  const unknown = countedStatusIds.filter((id) => !statuses.some((s) => s.id === id));
  return [...chosen.map((s) => s.name), ...unknown].join(', ');
}

export function SlaGoalForm({
  statuses,
  goal,
  savedGoals,
  onChange,
  onSave,
  onDelete,
}: {
  statuses: readonly { id: string; name: string }[];
  goal: SlaGoalChoice;
  savedGoals?: readonly SavedSlaGoal[] | undefined;
  onChange: (next: SlaGoalChoice) => void;
  onSave?: ((name: string) => Promise<void>) | undefined;
  onDelete?: ((id: string) => Promise<void>) | undefined;
}): React.JSX.Element {
  const goals = savedGoals ?? [];
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const defaultTarget = SLA_TARGET_OPTIONS.find((o) => o.value === String(goal.targetMs));
  const active = goals.find((saved) => saved.id === goal.savedGoalId);

  const run = React.useCallback((work: Promise<void>) => {
    setBusy(true);
    setError(null);
    work
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'That could not be saved.');
      })
      .finally(() => {
        setBusy(false);
      });
  }, []);

  return (
    <Stack space="space.150">
      {onSave !== undefined && goals.length > 0 ? (
        <>
          <Label labelFor="sla-saved-goal">Saved goal</Label>
          <Select
            inputId="sla-saved-goal"
            options={goals.map((saved) => ({ label: saved.name, value: saved.id }))}
            placeholder="Choose a saved goal"
            // Controlled, like the target picker below it. Left uncontrolled
            // the dropdown kept displaying a goal's name after a chip toggle
            // had already detached the page from it — the caption said "not
            // saved" while the control above still named the goal.
            value={active === undefined ? null : { label: active.name, value: active.id }}
            isDisabled={busy}
            onChange={(option) => {
              const id = (option as { value?: string } | null)?.value;
              const saved = goals.find((candidate) => candidate.id === id);
              if (saved !== undefined) onChange(toGoalChoice(saved));
            }}
          />
        </>
      ) : null}

      <Label labelFor="sla-goal-target">Working-time target</Label>
      <Select
        inputId="sla-goal-target"
        options={SLA_TARGET_OPTIONS}
        // ★ Always controlled, even when the target is not one of the
        // presets. Dropping `value` for an unlisted target left the control
        // showing whatever was last picked while the page computed against
        // something else — a saved 6-hour goal rendered under "8 working
        // hours". That is verbatim the defect the comment on the saved-goal
        // `Select` above says was fixed, still live on the next control.
        // The label for an unlisted target is formatted, not rounded to
        // hours: `Math.round` rendered a 90-minute goal as "2 working hours"
        // and a 1-minute goal as "0 working hours" while the page divided
        // every number on it by the real value — the control disagreeing
        // with the computation, which is the same defect one control up,
        // narrowed rather than fixed. `parseSlaGoal` accepts any target from
        // a minute to a year; only the presets are whole hours.
        value={
          defaultTarget ?? {
            label: `${formatDurationForHumans(goal.targetMs, WORKING_TIME)} of working time`,
            value: String(goal.targetMs),
          }
        }
        onChange={(option) => {
          const value = (option as { value?: string } | null)?.value;
          if (value !== undefined) onChange(withTarget(goal, Number(value)));
        }}
      />
      {/*
        ★ The caption names the counted statuses rather than referring to
        them. An ADS `Button` with `isSelected` emits no `aria-pressed`,
        `aria-selected` or `aria-current` — the state is carried by
        background colour alone, so a screen-reader user toggling "In
        Progress" hears "In Progress, button" before and after, with no way
        to tell which statuses the goal counts. Every number on this page is
        divided by that goal, so a text fallback is not a nicety. axe does
        not flag it (an absent `aria-pressed` is not a violation), which is
        why it survived the audit that runs on every screen.
      */}
      <Text size="small">
        {goal.countedStatusIds.length === 0
          ? 'Counting time in every status. Select statuses to count only those.'
          : `Counting time only in: ${countedNames(statuses, goal.countedStatusIds)}.`}
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

      {onSave === undefined ? null : (
        <Stack space="space.100">
          <Text size="small">
            {active === undefined
              ? 'This selection is not saved. Name it to make it the goal everyone on this project sees.'
              : `Measuring against the saved goal "${active.name}".`}
          </Text>
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Label labelFor="sla-goal-name">Goal name</Label>
            <Textfield
              id="sla-goal-name"
              value={name}
              placeholder="Time to resolution"
              isDisabled={busy}
              onChange={(event) => {
                // `SerialisableEvent.target.value` is typed `any` by
                // `@forge/react` — the bridge hands back whatever the host
                // serialised. Coerced here rather than asserted, so an
                // absent or non-string value becomes an empty name the
                // resolver refuses, not an `any` laundered into state.
                setName(String(event.target.value ?? ''));
              }}
            />
            <LoadingButton
              isLoading={busy}
              isDisabled={name.trim() === ''}
              onClick={() => {
                run(
                  onSave(name.trim()).then(() => {
                    setName('');
                  }),
                );
              }}
            >
              Save goal
            </LoadingButton>
            {active !== undefined && onDelete !== undefined ? (
              <Button
                appearance="subtle"
                isDisabled={busy}
                onClick={() => {
                  run(onDelete(active.id));
                }}
              >
                Delete &ldquo;{active.name}&rdquo;
              </Button>
            ) : null}
          </Inline>
          {error !== null && (
            <SectionMessage title="Could not save the goal" appearance="error">
              <Text>{error}</Text>
            </SectionMessage>
          )}
        </Stack>
      )}
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

/**
 * The tile card. A bordered, rounded surface with a fixed minimum width —
 * not a flat neutral slab — so a row of tiles reads as a deliberate stat row
 * rather than leftover table cells, and a wrap produces a second row of
 * equal cards instead of a ragged one. Styled with design tokens only, so
 * the card follows the user's Jira theme the way every ADS card does.
 */
const TILE_STYLE = xcss({
  backgroundColor: 'elevation.surface',
  borderColor: 'color.border',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'radius.large',
  minWidth: '180px',
});

/**
 * Re-read the report by itself while the project is still indexing.
 *
 * ## The problem this solves
 *
 * Nothing on any of these pages ever refetched. A first-time user pressed
 * **Start indexing**, got "Indexing in progress — 0 issues indexed", and then
 * watched that sentence for as long as they were willing to: the banner is
 * painted from the envelope fetched when the page loaded, and the only way to
 * see any progress at all was to reload by hand. A 900-issue project takes a
 * couple of minutes, during which a correct, honest banner is indistinguishable
 * from a hung app. This is the first thing a buyer does with the product.
 *
 * ## Why it is bounded rather than a plain interval
 *
 * Forge went consumption-priced on 1 January 2026 and every poll is a billed
 * invocation, so this is deliberately the smallest thing that fixes the
 * problem:
 *
 * - it runs **only** while the index is actually moving (`running` /
 *   `not_started`), which is a transient state a project passes through once;
 * - the gap grows from {@link FIRST_POLL_MS} toward {@link SLOWEST_POLL_MS}, so
 *   a small project that finishes in seconds is caught almost immediately while
 *   a large one costs a poll every fifteen seconds rather than every three;
 * - it gives up after {@link MAX_POLLS}, around ten minutes, instead of
 *   polling an abandoned tab until the browser closes. Note that one poll is
 *   one page `load()`, which is two resolver calls on most listings and three
 *   on WIP aging — so the ceiling is nearer 80-120 invocations than 40. The banner stays
 *   truthful when it stops — it still says indexing is in progress, which it
 *   is — so giving up costs the user a manual reload, not a wrong screen.
 */
const FIRST_POLL_MS = 3_000;
const SLOWEST_POLL_MS = 15_000;
const MAX_POLLS = 40;

export function useIndexingRefresh(progress: MaybeProgress, reload: () => void): void {
  // Held in a ref so a caller that rebuilds its reload callback every render —
  // which every one of these pages does, since the callback closes over the
  // basis and the filters — does not restart the schedule on every render and
  // poll far faster than intended.
  const latest = React.useRef(reload);
  // Updated after commit rather than during render: a render React discards
  // must not be able to leave a callback behind in the ref.
  React.useEffect(() => {
    latest.current = reload;
  });

  // `paused` is in here deliberately. It means Jira rate-limited the backfill
  // and it will resume by itself — which is exactly the long, large-instance
  // case the backoff above exists for. Excluding it tore the schedule down for
  // good at the first 429 and left the page reading "Indexing paused" until
  // someone reloaded.
  const moving =
    progress !== 'unknown' &&
    progress !== null &&
    (progress.state === 'running' ||
      progress.state === 'not_started' ||
      progress.state === 'paused');

  // ★ A failed progress read must not end the watch.
  //
  // The pages set `'unknown'` when `getIndexProgress` refuses, which is right
  // for the banner — not knowing is not a claim — but fatal here: one
  // transient failure of a cheap resolver flipped this false, the effect tore
  // down, and nothing ever refetched again, silently restoring the frozen
  // banner this hook exists to fix. So once indexing has been seen, `unknown`
  // keeps the schedule alive; only a state that is genuinely finished stops it.
  const seenIndexing = React.useRef(false);
  if (moving) seenIndexing.current = true;
  else if (progress !== 'unknown') seenIndexing.current = false;
  const indexing = moving || (seenIndexing.current && progress === 'unknown');

  React.useEffect(() => {
    if (!indexing) return undefined;
    let stopped = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (): void => {
      const delay = Math.min(FIRST_POLL_MS * Math.pow(1.4, polls), SLOWEST_POLL_MS);
      timer = setTimeout(() => {
        if (stopped) return;
        polls += 1;
        latest.current();
        if (polls < MAX_POLLS) schedule();
      }, delay);
    };
    schedule();

    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
    // `indexing` only — a reload that leaves the state unchanged must not
    // restart the schedule, or the backoff resets on every poll and the gap
    // never grows.
  }, [indexing]);
}

export function SummaryTiles({ tiles }: { tiles: readonly SummaryTile[] }): React.JSX.Element {
  return (
    <Inline space="space.150" shouldWrap>
      {tiles.map((tile) => (
        <Box key={tile.label} padding="space.200" xcss={TILE_STYLE}>
          <Stack space="space.075">
            <Text size="small" color="color.text.subtlest" weight="medium">
              {tile.label}
            </Text>
            <Heading as="h3">{tile.value}</Heading>
            <Text size="small" color="color.text.subtlest">
              {tile.hint}
            </Text>
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
 * A multi-series line chart — the cumulative flow diagram's shape.
 *
 * `colorAccessor` is what makes one flat array of points render as several
 * lines; `@forge/react` ships that natively, so as with `ReportBarChart`
 * there is no hand-rolled chart here.
 *
 * ⚠️ `colorPalette` is deliberately not passed. Forge's own chart components
 * accept the prop and, as of a confirmed and still-open Atlassian defect
 * (ECO-1390, raised March 2026), ignore it — so passing one would read as a
 * choice this code had made and the platform had honoured, and it would not
 * have been.
 */
export function ReportLineChart({
  data,
  title,
  subtitle,
}: {
  data: readonly SeriesPoint[];
  title: string;
  subtitle: string;
}): React.JSX.Element | null {
  if (data.length === 0) return null;
  return (
    <LineChart
      data={data as unknown[]}
      xAccessor="label"
      yAccessor="value"
      colorAccessor="series"
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
/**
 * Jira renders a status as a lozenge coloured by its category everywhere a
 * user meets one — boards, issue views, JQL results. A metrics table that
 * prints the same status as plain text reads as foreign; this map keeps the
 * product speaking Jira's own visual language. `default` for `todo` is
 * deliberate: ADS's neutral lozenge is exactly Jira's To Do grey.
 */
const STATUS_LOZENGE = {
  todo: 'default',
  inprogress: 'inprogress',
  done: 'success',
  unknown: 'default',
  // Judgements the product made, not categories Jira supplies — see
  // `CellTone`. A breach is the one value a reader scans an SLA table for.
  danger: 'removed',
  success: 'success',
} as const;

/**
 * ★ How a table cell's `key` has to satisfy two masters.
 *
 * **Sorting.** `DynamicTable` finds the column whose *head* cell `key` matches
 * the active sort key, then orders rows by the *row* cell `key` at that index.
 * So the key has to carry the value. This table used to pass a constant —
 * `key: 'issue'`, `key: 'c-0'` — for every row, so the one column marked
 * sortable sorted every row by the same value and did nothing at all: clicking
 * the header reordered nothing and reported no error.
 *
 * **React identity.** `@forge/react` renders each cell as
 * `jsx(Cell, { cellKey, ... }, cellKey)` — the key is also React's key for the
 * cell among its siblings. Duplicates within one row are the case React warns
 * "may cause children to be duplicated and/or omitted", and they are the
 * common case here, not an edge one: every status an issue never entered
 * carries the same `NO_DURATION`, and a single-status issue's column equals
 * its total.
 *
 * ⚠️ Nothing in this repository can catch that. The stand-in host renderer
 * keys cells by index (`@atlaskit/dynamic-table` does), so the whole suite,
 * the screenshots and the e2e flows are structurally blind to a collision that
 * only exists on Forge.
 *
 * So the key is a **padded value plus its column index**: the padding makes it
 * order by magnitude under both plain and numeric collation, and the column
 * index makes it unique within the row without touching the ordering, because
 * it is constant down any one column. `+ 1` lifts `NO_DURATION` (-1) to zero,
 * below every real duration including `0m`, and keeps the token free of a
 * minus sign that collates as punctuation rather than as a negative.
 */
const SORT_TOKEN_WIDTH = 16;

export function cellKey(value: number | string, column: number): string {
  const token =
    typeof value === 'number'
      ? String(Math.max(0, value + 1)).padStart(SORT_TOKEN_WIDTH, '0')
      : value;
  return `${token}#${column}`;
}
export function ReportTable({ model }: { model: ReportTableModel }): React.JSX.Element {
  const head = {
    cells: model.headers.map((header, index) => ({
      key: `h-${index}`,
      content: header,
      isSortable: true,
    })),
  };

  const rows = model.rows.map((row, rowIndex) => ({
    key: `${row.issueKey}-${rowIndex}`,
    cells: [
      {
        key: cellKey(row.issueKey, 0),
        content: (
          <Inline space="space.075" alignBlock="center">
            <Strong>{row.issueKey}</Strong>
            {row.truncated ? <Lozenge appearance="moved">partial history</Lozenge> : null}
          </Inline>
        ),
      },
      {
        key: cellKey(row.currentStatus, 1),
        content:
          row.currentStatusCategory === null ? (
            <Text>{row.currentStatus}</Text>
          ) : (
            <Lozenge appearance={STATUS_LOZENGE[row.currentStatusCategory]}>
              {row.currentStatus}
            </Lozenge>
          ),
      },
      { key: cellKey(row.createdAt, 2), content: <Text>{row.created}</Text> },
      { key: cellKey(row.resolvedAt, 3), content: <Text>{row.resolved}</Text> },
      ...row.cells.map((cell, index) => ({
        // +4: the four fixed columns above.
        key: cellKey(cell.ms, index + 4),
        content: (
          <Inline space="space.075" alignBlock="center">
            <Text>{cell.text}</Text>
            {cell.reentered ? (
              <Lozenge appearance="inprogress">{`x${cell.entries ?? 0}`}</Lozenge>
            ) : null}
          </Inline>
        ),
      })),
      {
        key: cellKey(row.totalMs, row.cells.length + 4),
        content: <Strong>{row.total}</Strong>,
      },
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

/**
 * The page's lead line and its action row.
 *
 * `title` is optional, and the project pages must not pass one: Jira itself
 * renders the module's name directly above a `jira:projectPage`, so an in-app
 * `<h1>` repeated the page's own name twice in a row — confirmed on the live
 * dev site, and the single loudest "not finished" signal on every screen.
 * Surfaces whose host chrome does not title them (the admin pages) still pass
 * a title and get the heading.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title?: string | undefined;
  subtitle: string;
  actions?: React.ReactNode | undefined;
}): React.JSX.Element {
  return (
    <Stack space="space.100">
      {title === undefined ? null : <Heading as="h1">{title}</Heading>}
      <Inline spread="space-between" alignBlock="center" shouldWrap space="space.150">
        <Text color="color.text.subtle">{subtitle}</Text>
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
      // The cell's own value, so the sortable column sorts by it; a constant
      // here — which is what this was — makes the header clickable and inert.
      // Suffixed by column, because these collide too: "Entries 1" beside
      // "Issues 1", or an age equal to its total.
      key: cellKey(typeof value === 'string' ? value : value.text, index),
      content:
        typeof value === 'string' ? (
          index === emphasis ? (
            <Strong>{value}</Strong>
          ) : (
            <Text>{value}</Text>
          )
        ) : (
          // A state, not a value: drawn the way Jira draws one. Emphasis is
          // the lozenge itself, so an identity column never arrives here.
          <Lozenge appearance={STATUS_LOZENGE[value.tone]}>{value.text}</Lozenge>
        ),
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

  // `undefined` is "not read yet or could not be read" and `null` is "all
  // history". Collapsing the two made a failed load render an error box
  // above the confident, false claim that everything was already indexed.
  const unknown = current === undefined;
  const options = unknown || current === null ? [] : historyWindowOptions(current);

  return (
    <>
      <Button onClick={load}>Extend history</Button>
      <ModalTransition>
        {open && (
          // ★ `label`, not just `ModalTitle`. UI Kit 2's `ModalProps` takes
          // one, and whether Forge's host derives an accessible name from
          // the title is not something this repo can verify — so the name is
          // given rather than assumed. The harness's stand-in used to supply
          // `aria-label="Export"` for every modal, which both mislabelled
          // this one and made axe's `aria-dialog-name` rule unable to fire.
          <Modal onClose={close} label="Extend indexed history">
            <ModalHeader>
              <ModalTitle>Extend indexed history</ModalTitle>
            </ModalHeader>
            <ModalBody>
              {unknown && error === null ? (
                <LoadingSurface label="Reading the current range" />
              ) : (
                <Stack space="space.150">
                  {unknown ? (
                    <Text>The range currently indexed could not be read.</Text>
                  ) : (
                    <Text>
                      This project is indexed over{' '}
                      <Strong>{describeHistoryWindow(current).toLowerCase()}</Strong>.
                    </Text>
                  )}
                  {unknown ? null : options.length === 0 ? (
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
            label="Export CSV"
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

// --------------------------------------------------------------- filters ---

export interface FilterOption {
  readonly id: string;
  readonly name: string;
}

export interface ReportFilterState {
  readonly assigneeAccountId: string | null;
  readonly issueTypeId: string | null;
  /** ISO dates (`YYYY-MM-DD`), as UI Kit's DatePicker speaks them. */
  readonly createdFrom: string | null;
  readonly createdTo: string | null;
}

export const EMPTY_FILTERS: ReportFilterState = {
  assigneeAccountId: null,
  issueTypeId: null,
  createdFrom: null,
  createdTo: null,
};

/**
 * Whether the reader has narrowed the report at all.
 *
 * Two callers, and keeping them on one predicate is the point: the *Clear
 * filters* button uses it to decide whether there is anything to clear, and
 * the page uses it to decide whether an empty result is the filters' doing.
 * Written twice, the two drift — and the shape they drift into is a page
 * saying "nothing is indexed" beside a *Clear filters* button that would fix
 * it, which is worse than either message alone.
 */
export function hasActiveFilters(filters: ReportFilterState): boolean {
  return (
    filters.assigneeAccountId !== null ||
    filters.issueTypeId !== null ||
    filters.createdFrom !== null ||
    filters.createdTo !== null
  );
}

/**
 * The report filters — assignee, issue type, creation window.
 *
 * PRODUCT-SPEC scopes these into v1 as "the minimum a report needs to be
 * usable in a review meeting", and the listing copy sold them while no
 * screen rendered them — the submission audit caught the gap, and this
 * closes it in the direction of more product rather than less copy.
 *
 * Single-select per dimension, deliberately: the resolver accepts arrays,
 * but "Anna's bugs from last quarter" is the review-meeting question, and a
 * multi-select's chrome costs more than its answer here. Every control is
 * controlled, like the SLA goal picker after its round-one defect — a
 * filter naming a value the table is not filtered by is the same lie one
 * listing over.
 *
 * The two date pickers bound each other: a window cannot be constructed
 * inverted from this UI, which is why the parser passes an inverted pair
 * through rather than guessing at intent.
 */
export const ReportFilters = ({
  assignees,
  issueTypes,
  filters,
  isDisabled,
  onChange,
}: {
  assignees: readonly FilterOption[];
  issueTypes: readonly FilterOption[];
  filters: ReportFilterState;
  isDisabled?: boolean;
  onChange: (next: ReportFilterState) => void;
}): React.JSX.Element => {
  const toOption = (option: FilterOption): { label: string; value: string } => ({
    label: option.name,
    value: option.id,
  });
  const selected = (
    options: readonly FilterOption[],
    id: string | null,
  ): { label: string; value: string } | null => {
    const found = options.find((option) => option.id === id);
    return found === undefined ? null : toOption(found);
  };

  return (
    <Inline space="space.150" alignBlock="end" shouldWrap>
      <Stack space="space.050">
        <Label labelFor="filter-assignee">Assignee</Label>
        <Select
          inputId="filter-assignee"
          placeholder="All assignees"
          options={assignees.map(toOption)}
          value={selected(assignees, filters.assigneeAccountId)}
          isDisabled={isDisabled === true}
          onChange={(option) => {
            onChange({
              ...filters,
              assigneeAccountId: (option as { value?: string } | null)?.value ?? null,
            });
          }}
        />
      </Stack>
      <Stack space="space.050">
        <Label labelFor="filter-issue-type">Issue type</Label>
        <Select
          inputId="filter-issue-type"
          placeholder="All types"
          options={issueTypes.map(toOption)}
          value={selected(issueTypes, filters.issueTypeId)}
          isDisabled={isDisabled === true}
          onChange={(option) => {
            onChange({
              ...filters,
              issueTypeId: (option as { value?: string } | null)?.value ?? null,
            });
          }}
        />
      </Stack>
      <Stack space="space.050">
        <Label labelFor="filter-created-from">Created from</Label>
        <DatePicker
          id="filter-created-from"
          // ★ This control can be typed into, and a mistyped date does not
          // fail — it parses into a different date and narrows the table to
          // the wrong rows, which reads exactly like a broken filter. The
          // picker's default rendering is the viewer's locale, so "3/2/2026"
          // means March in one country and February in another.
          //
          // `dateFormat` fixes what the field *displays*; parsing typed text
          // still goes through the locale unless Atlassian's
          // `platform-dst-dp-parse-date-format` gate is on, so the thing
          // actually protecting the reader is the placeholder telling them
          // what to type. Together they make the ambiguity visible rather
          // than silent. The placeholder doubles as the empty state,
          // replacing a stray locale sample date that read as corrupted.
          placeholder="YYYY-MM-DD"
          dateFormat="YYYY-MM-DD"
          value={filters.createdFrom ?? ''}
          {...(filters.createdTo === null ? {} : { maxDate: filters.createdTo })}
          isDisabled={isDisabled === true}
          onChange={(value) => {
            onChange({ ...filters, createdFrom: value === '' ? null : value });
          }}
        />
      </Stack>
      <Stack space="space.050">
        <Label labelFor="filter-created-to">Created to</Label>
        <DatePicker
          id="filter-created-to"
          placeholder="YYYY-MM-DD"
          dateFormat="YYYY-MM-DD"
          value={filters.createdTo ?? ''}
          {...(filters.createdFrom === null ? {} : { minDate: filters.createdFrom })}
          isDisabled={isDisabled === true}
          onChange={(value) => {
            onChange({ ...filters, createdTo: value === '' ? null : value });
          }}
        />
      </Stack>
      {hasActiveFilters(filters) ? (
        <Button
          onClick={() => {
            onChange(EMPTY_FILTERS);
          }}
        >
          Clear filters
        </Button>
      ) : null}
    </Inline>
  );
};

/**
 * Filter state as the `getReport` payload fields the resolver parses.
 *
 * Dates become epoch milliseconds at UTC midnight; `createdTo` is the *end*
 * of its chosen day, because a person picking "to 12 Mar" means including
 * the 12th — a half-open `[from, to)` window that ends at 00:00 of the
 * picked day would silently drop a day from every query.
 */
export function filtersToRequest(filters: ReportFilterState): Record<string, unknown> {
  const request: Record<string, unknown> = {};
  if (filters.assigneeAccountId !== null)
    request['assigneeAccountIds'] = [filters.assigneeAccountId];
  if (filters.issueTypeId !== null) request['issueTypeIds'] = [filters.issueTypeId];
  if (filters.createdFrom !== null) {
    const at = Date.parse(`${filters.createdFrom}T00:00:00Z`);
    if (Number.isFinite(at)) request['createdFrom'] = at;
  }
  if (filters.createdTo !== null) {
    const at = Date.parse(`${filters.createdTo}T00:00:00Z`);
    if (Number.isFinite(at)) request['createdTo'] = at + 86_400_000;
  }
  return request;
}
