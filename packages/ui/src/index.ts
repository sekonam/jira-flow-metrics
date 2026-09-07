/**
 * `@jfm/ui` — the shared presentation layer.
 *
 * Split deliberately in two: `view-model.ts` holds every formatting and state
 * decision as pure, tested functions, and `components.tsx` holds declarative
 * Forge UI Kit markup. The markup is rendered in tests through the stand-in
 * host renderer in `@jfm/ui-harness`, because UI Kit 2 components are bridge
 * sentinels rather than DOM components.
 */

export * from './view-model.js';
export * from './listing-models.js';
export * from './components.js';
