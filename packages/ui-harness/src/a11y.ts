import axe from 'axe-core';

/**
 * Accessibility auditing, run over what the components actually rendered.
 *
 * WCAG 2.1 AA is a stated product requirement in `BUILD-PLAN.md`, and an
 * Atlassian Marketplace listing is sold to enterprises who ask about it. The
 * cheapest way to keep the claim honest is to fail the build when it stops
 * being true.
 *
 * ## What jsdom cannot check, stated rather than hidden
 *
 * jsdom does no layout and no style resolution, so every axe rule that needs a
 * computed box or a rendered colour is unreliable there. `color-contrast` is
 * the important one and it is **disabled** in the jsdom pass — not because it
 * does not matter, but because a rule that always passes for the wrong reason
 * is worse than an absent rule. It is checked instead in the Playwright pass
 * (`scripts/screens.mjs`), which runs the same audit in real Chromium with
 * real styles. Anything asserted here is asserted about structure and
 * semantics: roles, names, labels, heading order, table markup.
 */

export const WCAG_21_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

export interface A11yFinding {
  readonly id: string;
  readonly impact: string;
  readonly help: string;
  readonly nodes: readonly string[];
}

/** Rules that cannot produce a trustworthy result without layout. */
const LAYOUT_DEPENDENT_RULES = ['color-contrast', 'color-contrast-enhanced'] as const;

export async function auditA11y(
  container: Element,
  options: { readonly includeLayoutRules?: boolean } = {},
): Promise<readonly A11yFinding[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: [...WCAG_21_AA_TAGS] },
    rules:
      options.includeLayoutRules === true
        ? {}
        : Object.fromEntries(LAYOUT_DEPENDENT_RULES.map((id) => [id, { enabled: false }])),
    resultTypes: ['violations'],
  });
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact ?? 'unknown',
    help: violation.help,
    nodes: violation.nodes.map((node) => node.html),
  }));
}

/** A findings list rendered small enough to read in a failing assertion. */
export function describeFindings(findings: readonly A11yFinding[]): string {
  if (findings.length === 0) return 'no violations';
  return findings
    .map((f) => `${f.id} (${f.impact}): ${f.help}\n    ${f.nodes.slice(0, 3).join('\n    ')}`)
    .join('\n  ');
}
