/**
 * `@jfm/ui-harness` — dev-only tooling that renders the Forge UI Kit surfaces.
 *
 * Nothing in this package ships in an app bundle. It exists because UI Kit 2
 * components are sentinels serialised over the Forge bridge (see
 * `forge-host.tsx`), so the only way to see this product before deploying it
 * is to supply a stand-in for the half of the renderer that lives inside Jira.
 */

export * from './scenarios.js';
export * from './a11y.js';
