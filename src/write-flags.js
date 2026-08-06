export const WRITE_FLAGS_EVENT = 'mc:write-flags-changed'

export const WRITE_ACTION_FLAGS = Object.freeze([
  Object.freeze({ id: 'dispatch', label: 'Dispatch Codex lanes', description: 'Show the audited sol / terra / luna dispatch form.' }),
  Object.freeze({ id: 'decision', label: 'Approve or decline', description: 'Show durable decision controls in the ledger.' }),
  Object.freeze({ id: 'queue', label: 'Claim or close queue', description: 'Show strict BUILD-QUEUE claim and close controls.' }),
  Object.freeze({ id: 'thread-reply', label: 'Coordinator replies', description: 'Enable the durable coordinator-thread composer.' }),
  Object.freeze({ id: 'report-read', label: 'Read agent reports', description: 'Show the bounded report reader on agent drill-in.' }),
])

const IDS = new Set(WRITE_ACTION_FLAGS.map(flag => flag.id))
const storageKey = id => `mc.write.${id}`

function assertAction(id) {
  if (!IDS.has(id)) throw new TypeError(`Unknown write-action flag: ${id}`)
}

export function isWriteEnabled(id) {
  assertAction(id)
  try { return localStorage.getItem(storageKey(id)) === 'enabled' }
  catch { return false }
}

export function setWriteEnabled(id, enabled) {
  assertAction(id)
  const on = Boolean(enabled)
  try {
    if (on) localStorage.setItem(storageKey(id), 'enabled')
    else localStorage.removeItem(storageKey(id))
  } catch {}
  window.dispatchEvent(new CustomEvent(WRITE_FLAGS_EVENT, { detail: Object.freeze({ action: id, enabled: on }) }))
  return on
}
