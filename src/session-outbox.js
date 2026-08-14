// THE MESSAGES A PERSON WROTE WHILE THE AGENT WAS STILL ANSWERING.
//
// The engine runs one turn at a time and refuses an overlapping send by
// design (AGENT_TURN_ACTIVE — shell/agent-host.cjs). Before this store the
// product turned that honest refusal into a dead end: there was nowhere to
// PUT the next message, so the person either lost their words or sat watching
// a spinner to earn the right to type. The owner's ask, verbatim: "can we add
// a que/unque for messages."
//
// This is that queue, modeled line for line on src/write-outcomes.js, the
// established renderer store that outlives views:
//
//   - module-level memory keyed by sessionId, surviving navigation and rail
//     rebuilds, cleared only when the window closes. NOT durable across a
//     restart, and that is stated rather than hidden — a queued message is a
//     draft, and a draft that silently outlives the session it was addressed
//     to would be sent at something the person can no longer see.
//   - a CustomEvent on every change, so mounted surfaces repaint without
//     polling.
//   - bounded in both directions: a message is capped like the composer that
//     wrote it, and a session holds a short queue — a hundred queued messages
//     is not a plan, it is a spill.
//
// WHO SENDS. This store never touches the bridge. The view's own
// turn-completed listener asks for exactly one message (takeNext) after the
// reply is filed, sends it through the same path a typed message uses, and
// re-queues at the head (requeueFront) if the send is refused. The store
// holds words; the view holds the wire.

export const SESSION_OUTBOX_EVENT = 'mc:session-outbox'

const MAX_TEXT = 4000
const MAX_PER_SESSION = 12

// sessionId -> [{ id, text, atMs }]
const queues = new Map()
let sequence = 0

function usableSession(sessionId) {
  return typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId.trim() : null
}

function usableText(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  return trimmed.length > MAX_TEXT ? trimmed.slice(0, MAX_TEXT) : trimmed
}

function announce(sessionId) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  try {
    window.dispatchEvent(new CustomEvent(SESSION_OUTBOX_EVENT, {
      detail: { sessionId, count: (queues.get(sessionId) || []).length },
    }))
  } catch { /* a window that cannot take an event still has the store */ }
}

/** Queue a message for a session that is busy. Returns the entry, or a
 *  refusal with the sentence the composer should show. */
export function enqueue(sessionId, text) {
  const session = usableSession(sessionId)
  const clean = usableText(text)
  if (!session) return { ok: false, sentence: 'This agent has no session to queue for yet. Start it first.' }
  if (!clean) return { ok: false, sentence: 'Write the message first, then queue it.' }
  const queue = queues.get(session) || []
  if (queue.length >= MAX_PER_SESSION) {
    return { ok: false, sentence: `This agent already has ${MAX_PER_SESSION} messages waiting. Let it answer some first.` }
  }
  const entry = Object.freeze({ id: `ob-${++sequence}`, text: clean, atMs: Date.now() })
  queue.push(entry)
  queues.set(session, queue)
  announce(session)
  return { ok: true, entry }
}

/** The queue for one session, oldest first, frozen. */
export function list(sessionId) {
  const session = usableSession(sessionId)
  if (!session) return Object.freeze([])
  return Object.freeze([...(queues.get(session) || [])])
}

/** Unqueue one message by id. True if something was removed. */
export function cancel(sessionId, entryId) {
  const session = usableSession(sessionId)
  if (!session) return false
  const queue = queues.get(session) || []
  const index = queue.findIndex(entry => entry.id === entryId)
  if (index === -1) return false
  queue.splice(index, 1)
  if (queue.length === 0) queues.delete(session)
  announce(session)
  return true
}

/** Hand the view exactly ONE message to send, removing it from the queue.
 *  The turn-completed listener is the only intended caller. */
export function takeNext(sessionId) {
  const session = usableSession(sessionId)
  if (!session) return null
  const queue = queues.get(session) || []
  const entry = queue.shift() || null
  if (queue.length === 0) queues.delete(session)
  if (entry) announce(session)
  return entry
}

/** A send that was taken and then refused goes back to the FRONT — it is
 *  still the next thing the person said, and losing it to a transient refusal
 *  would be the dead end this store exists to remove. */
export function requeueFront(sessionId, entry) {
  const session = usableSession(sessionId)
  if (!session || !entry || typeof entry.text !== 'string') return false
  const queue = queues.get(session) || []
  queue.unshift(entry)
  queues.set(session, queue)
  announce(session)
  return true
}

/** A closed session's drafts have no address; drop them and say how many. */
export function clearSession(sessionId) {
  const session = usableSession(sessionId)
  if (!session) return 0
  const queue = queues.get(session) || []
  queues.delete(session)
  if (queue.length > 0) announce(session)
  return queue.length
}
