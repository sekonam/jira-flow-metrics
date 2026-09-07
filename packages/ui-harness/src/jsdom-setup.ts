/**
 * Browser APIs jsdom does not implement, which the Atlassian Design System
 * touches on import.
 *
 * `@atlaskit/tokens` reads `matchMedia` at module scope to follow the OS
 * colour-scheme preference, and several ADS components observe element size.
 * jsdom has neither. Each shim is the smallest thing that satisfies the caller
 * — none of them change what is rendered, and none of them is used by app
 * code, so nothing here can mask a defect in this product.
 *
 * Loaded for every test file; a `node`-environment test has no `window` and
 * falls straight through.
 */

import { setBooleanFeatureFlagResolver } from '@atlaskit/platform-feature-flags/setBooleanFeatureFlagResolver';
import { installBridge } from './bridge.js';

/**
 * Install the stand-in Custom UI bridge before anything imports
 * `@forge/bridge`, which reads `globalThis.__bridge` at module scope and
 * throws without it. See `bridge.ts`.
 */
installBridge();

/**
 * Pin every Atlassian Design System experiment to its default.
 *
 * ADS components query a feature-gate client that is only initialised inside
 * an Atlassian product. Left alone it throws on first use and logs a stack
 * trace into the test output; worse, whether a gate is on decides which markup
 * some components emit, so an uninitialised client makes rendering
 * non-deterministic. Resolving every flag to `false` is the documented test
 * hook and gives the shipped, non-experimental rendering.
 */
setBooleanFeatureFlagResolver(() => false);

if (typeof window !== 'undefined') {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    });
  }

  if (typeof window.ResizeObserver !== 'function') {
    window.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }

  if (typeof window.IntersectionObserver !== 'function') {
    window.IntersectionObserver = class {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds: readonly number[] = [];
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): [] {
        return [];
      }
    };
  }
}
