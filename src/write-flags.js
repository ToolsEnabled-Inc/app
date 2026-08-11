export const WRITE_FLAGS_EVENT = 'mc:write-flags-changed'

export const WRITE_ACTION_FLAGS = Object.freeze([
  Object.freeze({ id: 'dispatch', label: 'Dispatch agent lanes', description: 'Show the audited Codex and Claude dispatch form.' }),
  Object.freeze({ id: 'decision', label: 'Approve or decline', description: 'Show durable decision controls in the ledger.' }),
  Object.freeze({ id: 'queue', label: 'Claim or close queue', description: 'Show strict BUILD-QUEUE claim and close controls.' }),
  Object.freeze({ id: 'thread-reply', label: 'Coordinator replies', description: 'Enable the durable coordinator-thread composer.' }),
  Object.freeze({ id: 'report-read', label: 'Read agent reports', description: 'Show the bounded report reader on agent drill-in.' }),
  Object.freeze({ id: 'agent-session', label: 'Run an agent session', description: 'Start, watch, and stop a live agent session from the agent page.' }),
  /* Codex Cloud. Default-off like every other write action, and that is the
     answer to "why is this feature not simply on": the flags fail closed
     (see 2c9318e, where an absent key used to read as enabled), and a cloud
     launch is the most consequential write in this list -- it starts real,
     billable work on a remote service that cannot be cancelled once accepted.

     Off does NOT mean invisible here, and that distinction is the actual fix.
     The other surfaces vanish entirely when their flag is off, which is why
     "shipped off pending review" and "the product has no such feature" looked
     identical from inside the app. The cloud panel renders either way: turned
     off it states what it is and where the switch is, so a person can find the
     feature and turn it on. A feature nobody can discover is not shipped. */
  Object.freeze({ id: 'cloud-launch', label: 'Launch Codex Cloud tasks', description: 'Launch a task on Codex Cloud and watch it from the agent page. Each launch still asks for approval.' }),
])

const IDS = new Set(WRITE_ACTION_FLAGS.map(flag => flag.id))
const storageKey = id => `mc.write.${id}`

function assertAction(id) {
  if (!IDS.has(id)) throw new TypeError(`Unknown write-action flag: ${id}`)
}

export function isWriteEnabled(id) {
  assertAction(id)
  try {
    const stored = localStorage.getItem(storageKey(id))
    return stored === 'enabled'
  } catch {
    return false
  }
}

export function setWriteEnabled(id, enabled) {
  assertAction(id)
  const on = Boolean(enabled)
  try {
    if (on) localStorage.setItem(storageKey(id), 'enabled')
    else localStorage.setItem(storageKey(id), 'disabled')
  } catch {}
  window.dispatchEvent(new CustomEvent(WRITE_FLAGS_EVENT, { detail: Object.freeze({ action: id, enabled: on }) }))
  return on
}
