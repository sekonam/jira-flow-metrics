/**
 * A stand-in for the **Custom UI bridge**, not for `@forge/bridge`.
 *
 * `@forge/bridge` is not mocked anywhere in this repository. It does not need
 * to be: everything it does is real JavaScript, and the only thing it cannot
 * do outside a Jira page is reach the other end of the postMessage channel.
 * Reading `@forge/bridge/out/bridge.js` shows where that seam is —
 *
 * ```js
 * const getCallBridge = () => {
 *   if (!isBridgeAvailable(globalThis.__bridge)) throw new BridgeAPIError(...);
 *   return globalThis.__bridge.callBridge;
 * };
 * ```
 *
 * — so installing a `globalThis.__bridge` is enough. The real `invoke()` then
 * runs: its argument validation, its 500-requests-per-25-seconds rate limiter
 * and its error types are all exercised, and only the transport is ours. That
 * is a tighter seam than replacing the module, and it is the reason the
 * package can be imported at all in a test process — without it, importing
 * `@forge/bridge` (and therefore `@forge/react`) throws
 * "Unable to establish a connection with the Custom UI bridge" at module
 * scope, before a single line of product code runs.
 *
 * What this still does not show: that a real Forge resolver is reachable, that
 * the manifest wires these function keys up, or that Atlassian's frame answers
 * at all. Nothing outside a real tenant can.
 */

export type ResolverHandler = (payload: unknown) => unknown;

/** Thrown when a frontend invokes a resolver key nothing has registered. */
export class UnregisteredResolverError extends Error {
  constructor(key: string) {
    super(
      `The frontend invoked resolver "${key}", which the harness has not registered. ` +
        'Register it with setBridgeResolvers, or the app is calling a key its manifest does not wire up.',
    );
    this.name = 'UnregisteredResolverError';
  }
}

export interface BridgeCall {
  readonly cmd: string;
  readonly data: unknown;
}

/** The product context a project page receives. Matches the pipeline fixture. */
export const HARNESS_CONTEXT = {
  extension: {
    type: 'jira:projectPage',
    project: { id: '10000', key: 'FLOW', type: 'software' },
  },
  localId: 'harness',
  accountId: 'acc-anna',
  cloudId: 'harness-cloud',
  theme: { colorMode: 'light' },
};

let handlers: Record<string, ResolverHandler> = {};
let calls: BridgeCall[] = [];
let unregistered: string[] = [];

export function setBridgeResolvers(next: Record<string, ResolverHandler>): void {
  handlers = { ...next };
}

export function resetBridge(): void {
  handlers = {};
  calls = [];
  unregistered = [];
}

/** Every bridge command the frontend issued, in order. */
export function bridgeCalls(): readonly BridgeCall[] {
  return calls;
}

/** The resolver keys the frontend invoked, in order. */
export function invokedResolvers(): readonly string[] {
  return calls
    .filter((call) => call.cmd === 'invoke')
    .map((call) => (call.data as { functionKey?: string }).functionKey ?? '');
}

/**
 * Resolver keys the frontend asked for that nothing answers.
 *
 * Worth recording rather than only throwing: the frontends catch every
 * `invoke` failure and turn it into "the report could not be loaded", so a
 * component calling a key its manifest never wires up would otherwise be
 * indistinguishable from an ordinary error state — and would look like a
 * correctly-rendered error screen in a test.
 */
export function unregisteredResolvers(): readonly string[] {
  return [...unregistered];
}

async function callBridge(cmd: string, data: unknown): Promise<unknown> {
  calls.push({ cmd, data });
  switch (cmd) {
    case 'invoke': {
      const { functionKey, payload } = data as { functionKey: string; payload: unknown };
      const handler = handlers[functionKey];
      if (handler === undefined) {
        unregistered.push(functionKey);
        throw new UnregisteredResolverError(functionKey);
      }
      return await handler(payload);
    }
    case 'getContext':
      return HARNESS_CONTEXT;
    default:
      // `onError` and the other reconciler commands never arrive here: the
      // suites render through the stand-in host renderer rather than through
      // `ForgeReconciler`, so nothing drives them.
      return undefined;
  }
}

/**
 * Install the stand-in bridge on `globalThis`.
 *
 * Idempotent, and safe to call from a setup file that also runs under the node
 * environment: `globalThis` exists in both.
 */
export function installBridge(): void {
  (globalThis as unknown as { __bridge?: unknown }).__bridge = { callBridge };
}
