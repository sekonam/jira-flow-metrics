/**
 * `@jfm/ui` — the shared presentation layer.
 *
 * Split deliberately in two: `view-model.ts` holds every formatting and state
 * decision as pure, tested functions, and `components.tsx` holds declarative
 * Forge UI Kit markup that cannot be rendered outside the Forge runtime.
 */

export * from './view-model.js';
export * from './listing-models.js';
export * from './components.js';
