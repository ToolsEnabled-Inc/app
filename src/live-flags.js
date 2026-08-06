// Per-view read-source flags. Phase 2 keeps every simulation intact as the
// immediate rollback path; a missing preference means LIVE once that view's
// wiring has passed its gate battery.

export const LIVE_FLAGS_EVENT = 'mc:live-flags-changed'

export const LIVE_VIEW_FLAGS = Object.freeze([
  Object.freeze({ id: 'home', label: 'Home / coordinator', domain: 'coordinator' }),
  Object.freeze({ id: 'computers', label: 'Computers graph', domain: 'fleet' }),
  Object.freeze({ id: 'agent', label: 'Agent drill-in', domain: 'agents' }),
  Object.freeze({ id: 'metrics', label: 'Metrics panel', domain: 'metrics' }),
  Object.freeze({ id: 'comms', label: 'Ops-channel board', domain: 'ops' }),
  Object.freeze({ id: 'ledger', label: 'R/Q ledger', domain: 'ledger' }),
])

const IDS = new Set(LIVE_VIEW_FLAGS.map(flag => flag.id))
const storageKey = id => `mc.live.${id}`

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
  return true
}

export function setLiveView(id, live) {
  assertView(id)
  const enabled = Boolean(live)
  try {
    if (enabled) localStorage.removeItem(storageKey(id))
    else localStorage.setItem(storageKey(id), 'simulated')
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
