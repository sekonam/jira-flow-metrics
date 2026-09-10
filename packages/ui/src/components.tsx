import React from 'react';
import {
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
  ModalTransition,
  SectionMessage,
  Spinner,
  Stack,
  Strong,
  Text,
} from '@forge/react';
import type { ProgressBanner, ReportTableModel, SummaryTile } from './view-model.js';
import type { SimpleTable } from './listing-models.js';

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
 * The indexing banner. Informational only, deliberately.
 *
 * It used to carry its own "Start indexing" button. Looking at the rendered
 * screen showed why that was wrong: a project with no index has no rows, so
 * the empty state is on screen at the same time — and the empty state's
 * centred primary action is the same action. Every unindexed project showed
 * the button twice. One action, one place.
 */
export function IndexingBanner({
  banner,
}: {
  banner: ProgressBanner | null;
}): React.JSX.Element | null {
  if (banner === null) return null;
  return (
    <SectionMessage title={banner.title} appearance={banner.appearance}>
      <Inline alignBlock="center" space="space.100">
        {banner.showSpinner ? <Spinner size="small" label="Indexing" /> : null}
        <Text>{banner.body}</Text>
      </Inline>
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
