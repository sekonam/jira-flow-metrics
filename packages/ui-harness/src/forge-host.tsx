import React from 'react';
import AdsBox from '@atlaskit/primitives/box';
import AdsInline from '@atlaskit/primitives/inline';
import AdsStack from '@atlaskit/primitives/stack';
import AdsText from '@atlaskit/primitives/text';
import AdsHeading from '@atlaskit/heading';
import AdsButton from '@atlaskit/button/new';
import AdsButtonGroup from '@atlaskit/button/button-group';
import AdsLozenge from '@atlaskit/lozenge';
import AdsSectionMessage from '@atlaskit/section-message';
import AdsSpinner from '@atlaskit/spinner';
import AdsDynamicTable from '@atlaskit/dynamic-table';

/**
 * A stand-in for the Forge **host** renderer.
 *
 * ## Why this file exists, stated bluntly
 *
 * `@forge/react`'s UI Kit 2 "components" are not React components. Read
 * `@forge/react/out/components/ui-kit-components.js` and every one of them is a
 * string:
 *
 * ```js
 * exports.Box = 'Box';
 * exports.Text = 'Text';
 * ```
 *
 * A Forge app's React tree is reconciled by `react-reconciler` into a
 * **ForgeDoc** — a JSON description of the intended UI — which is posted over
 * the bridge to the Atlassian product frontend. The *product* holds the code
 * that turns `{ type: 'Box' }` into an Atlassian Design System `<Box>` in the
 * DOM. That code ships inside Jira and is not published on npm.
 *
 * So there is no honest way to render a UI Kit 2 app in jsdom or a browser
 * using only what is installable. This module supplies the missing half: it
 * maps each UI Kit sentinel onto the Atlassian Design System component the
 * Forge host is documented to render it as, using the same `@atlaskit`
 * packages `@forge/react` itself depends on (via
 * `@atlaskit/forge-react-types`).
 *
 * ## What this proves, and what it does not
 *
 * **Proves:** our components and app frontends assemble a coherent tree; the
 * right screen is chosen for each of the four designed states; the numbers,
 * column order and lozenges reach the DOM; the resulting markup passes an axe
 * WCAG 2.1 AA audit.
 *
 * **Does not prove:** that Forge's real host renders it identically, that the
 * manifest is valid, that the bridge round-trip works, or that the props are
 * accepted by the platform. Only `forge tunnel` against a real Atlassian
 * tenant can show that, and no Atlassian credentials exist in this repository.
 * `docs/RUNBOOK.md` § "First tunnel session" is still the acceptance test.
 *
 * The mapping is pinned to reality by `packages/ui/test/forge-host.contract.test.ts`, which
 * asserts against the *real* `@forge/react` module that every name we stand in
 * for exists and still carries the sentinel value we expect.
 */

type Space = string | undefined;

/** UI Kit spacing tokens and ADS spacing tokens are the same strings. */
function space(value: Space): never | undefined | Space {
  return value;
}

export interface BoxProps {
  readonly children?: React.ReactNode;
  readonly padding?: string;
  readonly backgroundColor?: string;
}

export const Box = ({ children, padding, backgroundColor }: BoxProps): React.JSX.Element => (
  <AdsBox
    {...(padding === undefined ? {} : { padding: padding as never })}
    {...(backgroundColor === undefined ? {} : { backgroundColor: backgroundColor as never })}
  >
    {children}
  </AdsBox>
);

export interface InlineProps {
  readonly children?: React.ReactNode;
  readonly space?: string;
  readonly alignBlock?: string;
  readonly spread?: string;
  readonly shouldWrap?: boolean;
}

export const Inline = ({
  children,
  space: gap,
  alignBlock,
  spread,
  shouldWrap,
}: InlineProps): React.JSX.Element => (
  <AdsInline
    {...(gap === undefined ? {} : { space: space(gap) as never })}
    {...(alignBlock === undefined ? {} : { alignBlock: alignBlock as never })}
    {...(spread === undefined ? {} : { spread: spread as never })}
    {...(shouldWrap === undefined ? {} : { shouldWrap })}
  >
    {children}
  </AdsInline>
);

export interface StackProps {
  readonly children?: React.ReactNode;
  readonly space?: string;
  readonly alignBlock?: string;
  /** Cross-axis alignment. Without it a Stack stretches its children. */
  readonly alignInline?: string;
}

export const Stack = ({
  children,
  space: gap,
  alignBlock,
  alignInline,
}: StackProps): React.JSX.Element => (
  <AdsStack
    {...(gap === undefined ? {} : { space: space(gap) as never })}
    {...(alignBlock === undefined ? {} : { alignBlock: alignBlock as never })}
    {...(alignInline === undefined ? {} : { alignInline: alignInline as never })}
  >
    {children}
  </AdsStack>
);

export interface TextProps {
  readonly children?: React.ReactNode;
  readonly size?: string;
}

export const Text = ({ children, size }: TextProps): React.JSX.Element => (
  <AdsText {...(size === undefined ? {} : { size: size as never })}>{children}</AdsText>
);

/** UI Kit 1 leftover, still exported by `@forge/react` and still used here. */
export const Strong = ({ children }: { children?: React.ReactNode }): React.JSX.Element => (
  <strong>{children}</strong>
);

/**
 * UI Kit `Heading` takes `as`; ADS `Heading` takes a `size` and an optional
 * `as`. The Forge host derives one from the other, so the mapping is explicit
 * here rather than implied.
 */
const HEADING_SIZE: Readonly<Record<string, 'large' | 'medium' | 'small' | 'xsmall'>> = {
  h1: 'large',
  h2: 'medium',
  h3: 'small',
  h4: 'xsmall',
  h5: 'xsmall',
  h6: 'xsmall',
};

export interface HeadingProps {
  readonly children?: React.ReactNode;
  readonly as?: string;
}

export const Heading = ({ children, as }: HeadingProps): React.JSX.Element => (
  <AdsHeading size={HEADING_SIZE[as ?? 'h3'] ?? 'small'} as={(as ?? 'h3') as never}>
    {children}
  </AdsHeading>
);

export interface ButtonProps {
  readonly children?: React.ReactNode;
  readonly onClick?: (() => void) | undefined;
  readonly appearance?: string;
  readonly isSelected?: boolean;
  readonly isDisabled?: boolean;
}

export const Button = ({
  children,
  onClick,
  appearance,
  isSelected,
  isDisabled,
}: ButtonProps): React.JSX.Element => (
  <AdsButton
    {...(onClick === undefined ? {} : { onClick })}
    {...(appearance === undefined ? {} : { appearance: appearance as never })}
    {...(isSelected === undefined ? {} : { isSelected })}
    {...(isDisabled === undefined ? {} : { isDisabled })}
  >
    {children}
  </AdsButton>
);

export const ButtonGroup = ({ children }: { children?: React.ReactNode }): React.JSX.Element => (
  <AdsButtonGroup>{children}</AdsButtonGroup>
);

export interface LozengeProps {
  readonly children?: React.ReactNode;
  readonly appearance?: string;
}

export const Lozenge = ({ children, appearance }: LozengeProps): React.JSX.Element => (
  <AdsLozenge {...(appearance === undefined ? {} : { appearance: appearance as never })}>
    {children}
  </AdsLozenge>
);

export interface SectionMessageProps {
  readonly children?: React.ReactNode;
  readonly title?: string;
  readonly appearance?: string;
}

export const SectionMessage = ({
  children,
  title,
  appearance,
}: SectionMessageProps): React.JSX.Element => (
  <AdsSectionMessage
    {...(title === undefined ? {} : { title })}
    {...(appearance === undefined ? {} : { appearance: appearance as never })}
  >
    {children}
  </AdsSectionMessage>
);

export interface SpinnerProps {
  readonly size?: string;
  readonly label?: string;
}

export const Spinner = ({ size, label }: SpinnerProps): React.JSX.Element => (
  <AdsSpinner
    {...(size === undefined ? {} : { size: size as never })}
    {...(label === undefined ? {} : { label })}
  />
);

/**
 * ADS has no `EmptyState` in the dependency set `@forge/react` pulls in, so
 * this is composed from primitives. Structure follows the ADS empty-state
 * anatomy: heading, description, primary action — which is also what an
 * accessibility audit needs to see (a heading, not a bare paragraph).
 */
export interface EmptyStateProps {
  readonly header: string;
  readonly description?: React.ReactNode;
  readonly primaryAction?: React.ReactNode;
}

export const EmptyState = ({
  header,
  description,
  primaryAction,
}: EmptyStateProps): React.JSX.Element => (
  <AdsBox padding="space.400" testId="empty-state">
    <AdsStack space="space.150" alignInline="center">
      <AdsHeading size="medium" as="h2">
        {header}
      </AdsHeading>
      {description === undefined ? null : <AdsText>{description}</AdsText>}
      {primaryAction}
    </AdsStack>
  </AdsBox>
);

// ------------------------------------------------------------ table ---

export interface TableCell {
  readonly key?: string;
  readonly content: React.ReactNode;
  readonly isSortable?: boolean;
}

export interface TableRow {
  readonly key?: string;
  readonly cells: readonly TableCell[];
}

export interface DynamicTableProps {
  readonly head?: { readonly cells: readonly TableCell[] };
  readonly rows?: readonly TableRow[];
  readonly rowsPerPage?: number;
  readonly caption?: React.ReactNode;
}

/**
 * `DynamicTable` is the one UI Kit export that *is* a real React component in
 * `@forge/react` — but it only restructures `head`/`rows` into `Cell`/`Row`
 * sentinels for the bridge, and the product frontend turns them straight back
 * into the ADS `head`/`rows` props. Passing them through directly is what the
 * host effectively does, and it keeps a real `<table>` in the DOM, which is
 * what the accessibility audit and the column-order assertions need.
 */
export const DynamicTable = ({
  head,
  rows,
  rowsPerPage,
  caption,
}: DynamicTableProps): React.JSX.Element => (
  <AdsDynamicTable
    {...(head === undefined
      ? {}
      : {
          head: {
            cells: head.cells.map((cell, index) => ({
              key: cell.key ?? `h-${index}`,
              content: cell.content,
              ...(cell.isSortable === undefined ? {} : { isSortable: cell.isSortable }),
            })),
          },
        })}
    {...(rows === undefined
      ? {}
      : {
          rows: rows.map((row, rowIndex) => ({
            key: row.key ?? `r-${rowIndex}`,
            cells: row.cells.map((cell, index) => ({
              key: cell.key ?? `c-${index}`,
              content: cell.content,
            })),
          })),
        })}
    {...(rowsPerPage === undefined ? {} : { rowsPerPage })}
    {...(caption === undefined ? {} : { caption })}
  />
);

// -------------------------------------------------------- reconciler ---

/**
 * Stand-in for `ForgeReconciler`, the default export of `@forge/react`.
 *
 * The app frontends call `ForgeReconciler.render(<App />)` at module scope.
 * On Forge that starts the reconciler and posts the ForgeDoc over the bridge;
 * here it records the element so importing a frontend module in a test is
 * side-effect free, and so the visual harness can mount exactly the element
 * the app asked the platform to render.
 */
class ForgeReconcilerStub {
  private lastRendered: React.ReactNode = null;

  render(element: React.ReactNode): void {
    this.lastRendered = element;
  }

  /** The element the app most recently asked Forge to render. */
  rendered(): React.ReactNode {
    return this.lastRendered;
  }

  addConfig(): void {
    /* Configuration surfaces are not exercised by this harness. */
  }
}

const ForgeReconciler = new ForgeReconcilerStub();
export default ForgeReconciler;

/** UI Kit's `xcss` is the identity function in `@forge/react` too. */
export const xcss = <T,>(style: T): T => style;
