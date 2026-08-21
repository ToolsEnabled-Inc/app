/* WHERE THE DATA ON EVERY SCREEN COMES FROM -- one axis, three answers.
 *
 *   'local'  this is the desktop app; the machine in front of the person is
 *            the host, reached over its own loopback bridge and preload IPC.
 *   'relay'  this is a signed-in browser with a machine connected; every
 *            reading and every command crosses the sealed tunnel to that
 *            machine, and nothing touches the computer the browser runs on.
 *   'mock'   there is no host: a signed-out browser, or the example toggle.
 *            The screens render the product's own example fleet, and every
 *            surface showing it is badged, because the badge follows the
 *            SOURCE and never the look of the data.
 *
 * WHAT THIS REPLACES. live-flags.js held seven per-view 'mc.live.<view>' keys
 * whose off state selected a SECOND RENDER -- a separate demonstration face
 * with its own rails, its own tabs, and most of the product missing. That
 * conflated three independent things in one flag: which render runs, where
 * data comes from, and where commands go. The owner's ruling collapsed it:
 * "all simulated pages ARE the UI pages, just mock data." So there is one
 * render, and this module answers only the question that remains.
 *
 * RESOLUTION IS ASYNC AND CACHED. On a public origin the relay-versus-mock
 * answer needs the host asked for its transport, which cannot happen at import
 * time (no session, no machine pair exist yet). Views already load their data
 * asynchronously, so they resolve the source in the same breath. The cached
 * answer is exposed synchronously for render-time checks, and a host that
 * changes state (sign-in, sign-out) dispatches DATA_SOURCE_EVENT so open views
 * re-resolve rather than trusting a stale verdict.
 *
 * THE EXAMPLE TOGGLE IS ONE SWITCH, NOT SEVEN. The per-view flags were
 * Phase-2 rollback machinery -- live-flags.js said so itself -- and seven
 * independent switches meant seven ways for a screen to disagree with its
 * neighbour about what world it was in. One toggle, one world. The /example
 * route segment (main.js) survives unchanged: a URL is the right lifetime for
 * "show me one example page", where a stored preference is the wrong one.
 */
import { bridgeTransportAvailable } from './mission-bridge.js'

export const DATA_SOURCE_EVENT = 'mc:data-source-changed'

const EXAMPLE_KEY = 'mc.example'

/* The desktop discriminator. mcShell EXISTING is not enough -- the website
 * defines one too (endpoint + relay transport). getBridgeProof is exposed by
 * the desktop preload and deliberately withheld by the site's host bridge
 * ("a second closed door behind the first"), so its presence means the shell
 * that actually hosts an engine is behind this page. */
export function onDesktop() {
  return typeof globalThis.window?.mcShell?.getBridgeProof === 'function'
}

export function isExampleMode() {
  try { return localStorage.getItem(EXAMPLE_KEY) === 'on' } catch { return false }
}

export function setExampleMode(on) {
  const enabled = Boolean(on)
  try {
    /* Store only the non-default choice, so the default can evolve without a
       stale key pinning existing installs to the past -- the same rule the
       per-view flags followed. */
    if (enabled) localStorage.setItem(EXAMPLE_KEY, 'on')
    else localStorage.removeItem(EXAMPLE_KEY)
  } catch { /* private mode; the toggle then lives for this page only */ }
  announceDataSourceChange('example-toggle')
  return enabled
}

let resolved = null

/**
 * Resolve where data comes from, and cache the verdict.
 * `reask: true` re-asks the host for a transport (sign-in just happened);
 * meaningless and harmless when one is already installed.
 */
export async function resolveDataSource({ reask = false } = {}) {
  if (isExampleMode()) {
    /* The person asked for the example. On any host. One rule, no surprises:
       example on means mock, badged, everywhere. */
    resolved = 'mock'
    return resolved
  }
  if (onDesktop()) {
    resolved = 'local'
    return resolved
  }
  /* A public page: the only machine it may reach is the person's own, over the
     tunnel the host supplies. mission-bridge separately refuses every loopback
     path on a public origin (BRIDGE_FORBIDDEN_ON_PUBLIC_ORIGIN), so 'relay'
     versus 'mock' is the whole decision left to make here. */
  const relay = await bridgeTransportAvailable({ reask })
  resolved = relay ? 'relay' : 'mock'
  return resolved
}

/** The last resolved source, or null before the first resolution completes.
 *  Null must be treated as "not yet known", never defaulted to a source --
 *  defaulting to 'mock' would badge real data and defaulting to anything else
 *  would unbadge the example. Callers that render before resolving await
 *  resolveDataSource() in their load path instead. */
export function currentDataSource() {
  return resolved
}

/** Badge rule, in one place so no surface derives its own: mock is badged,
 *  real data -- local or relay alike -- never is. */
export function sourceIsBadged(source = resolved) {
  return source === 'mock'
}

export function announceDataSourceChange(why) {
  /* The host (or the toggle above) says "the world changed"; open views
     re-resolve. The event deliberately carries no verdict -- a stale verdict
     in an event payload is how two views end up in different worlds. */
  try {
    globalThis.window?.dispatchEvent(new CustomEvent(DATA_SOURCE_EVENT, {
      detail: Object.freeze({ why: typeof why === 'string' ? why : 'host' }),
    }))
  } catch { /* no window: a test importing this for the pure parts */ }
}
