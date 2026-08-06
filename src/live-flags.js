// Per-view read-source flags. Phase 2 keeps every simulation intact as the
// immediate rollback path; a missing preference means LIVE once that view's
// wiring has passed its gate battery.

export const LIVE_FLAGS_EVENT = 'mc:live-flags-changed'

export const LIVE_VIEW_FLAGS = Object.freeze([
  Object.freeze({ id: 'home', label: 'Home / coordinator', domain: 'coordinator' }),
  /* defaultLive:false is an OWNER ruling (2026-08-06, on seeing the live
     graph: "page 2 is NOT my vision. This is not the tree we had or that I
     like… go back to the old version"). The fleet projection is honest but
     flat (one root, twelve direct children) and carries no telemetry — that
     data shape cannot render the tree this page was designed around. The
     graph stays on the simulation until the projection can carry the
     design (real depth + runtime); live remains one toggle away in
     Settings → Data & Sim. */
  Object.freeze({ id: 'computers', label: 'Computers graph', domain: 'fleet', defaultLive: false }),
  Object.freeze({ id: 'agent', label: 'Agent drill-in', domain: 'agents' }),
  Object.freeze({ id: 'metrics', label: 'Metrics panel', domain: 'metrics' }),
  Object.freeze({ id: 'comms', label: 'Ops-channel board', domain: 'ops' }),
  Object.freeze({ id: 'ledger', label: 'R/Q ledger', domain: 'ledger' }),
])

const IDS = new Set(LIVE_VIEW_FLAGS.map(flag => flag.id))
const storageKey = id => `mc.live.${id}`
const defaultLive = id => LIVE_VIEW_FLAGS.find(flag => flag.id === id)?.defaultLive !== false

function assertView(id) {
  if (!IDS.has(id)) throw new TypeError(`Unknown live-view flag: ${id}`)
}

export function isLiveView(id) {
  assertView(id)
  try {
    const stored = localStorage.getItem(storageKey(id))
    if (stored === 'simulated' || stored === 'false') return false
    if (stored === 'live' || stored === 'true') return true
  } catch {}
  return defaultLive(id)
}

export function setLiveView(id, live) {
  assertView(id)
  const enabled = Boolean(live)
  try {
    // store only a non-default choice, so a view's default can evolve
    // without stale keys pinning every existing browser to the past
    if (enabled === defaultLive(id)) localStorage.removeItem(storageKey(id))
    else localStorage.setItem(storageKey(id), enabled ? 'live' : 'simulated')
  } catch {}
  window.dispatchEvent(new CustomEvent(LIVE_FLAGS_EVENT, {
    detail: Object.freeze({ view: id, live: enabled }),
  }))
  return enabled
}

export function liveViewFlag(id) {
  const definition = LIVE_VIEW_FLAGS.find(flag => flag.id === id)
  assertView(id)
  return Object.freeze({ ...definition, live: isLiveView(id) })
}
