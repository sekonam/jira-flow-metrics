import React from 'react';
import {
  Box,
  Button,
  DynamicTable,
  EmptyState,
  Heading,
  Inline,
  Lozenge,
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
 * ⚠️ **These components have not been rendered.** UI Kit components only run
 * inside the Forge runtime, and `forge tunnel` cannot be run in this
 * environment. The *logic* they display is in `view-model.ts` and is fully
 * tested; the markup below is written against the UI Kit component API and
 * needs a visual pass on first deploy. That check is item 1 in
 * `docs/RUNBOOK.md` § "First tunnel session".
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
      <Text>{message}</Text>
      {onRetry !== undefined ? <Button onClick={onRetry}>Try again</Button> : null}
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

export function IndexingBanner({
  banner,
  onStart,
}: {
  banner: ProgressBanner | null;
  onStart?: (() => void) | undefined;
}): React.JSX.Element | null {
  if (banner === null) return null;
  return (
    <SectionMessage title={banner.title} appearance={banner.appearance}>
      <Inline alignBlock="center" space="space.100">
        {banner.showSpinner ? <Spinner size="small" label="Indexing" /> : null}
        <Text>{banner.body}</Text>
      </Inline>
      {onStart !== undefined ? <Button onClick={onStart}>Start indexing</Button> : null}
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
  const head = {
    cells: model.headers.map((header, index) => ({
      key: `h-${index}`,
      content: header,
      isSortable: index === 0,
    })),
  };
  const rows = model.rows.map((row, rowIndex) => ({
    key: `r-${rowIndex}`,
    cells: row.map((value, index) => ({
      key: `c-${index}`,
      content: index === 0 ? <Strong>{value}</Strong> : <Text>{value}</Text>,
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
