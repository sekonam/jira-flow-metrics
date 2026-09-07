import { setBooleanFeatureFlagResolver } from '@atlaskit/platform-feature-flags/setBooleanFeatureFlagResolver';
import { installBridge } from '../src/bridge';

/**
 * Runs before anything that touches `@forge/bridge`.
 *
 * `@forge/bridge`'s `invoke` module calls `getCallBridge()` at module scope
 * and throws "Unable to establish a connection with the Custom UI bridge" if
 * `globalThis.__bridge` is absent. ES modules are evaluated in the order their
 * imports are declared, so this file is imported *first* in `main.tsx` — above
 * the screen registry, which pulls in the app frontends, which import
 * `@forge/bridge`. Reordering those two imports breaks the harness.
 */

installBridge();

/**
 * Pin every Atlassian Design System experiment to its default, so the harness
 * renders the shipped variant rather than whatever an uninitialised
 * feature-gate client happens to answer.
 */
setBooleanFeatureFlagResolver(() => false);
