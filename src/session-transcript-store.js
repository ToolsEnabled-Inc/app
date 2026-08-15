// The conversation, kept after the session that spoke it is gone.
//
// The window keeps each session's back-and-forth in memory (computers.js's
// sessionTranscripts) and says plainly that closing the window loses it. This
// store is the durable half the owner asked for (iteration 5 W7): a bounded
// excerpt of every conversation, saved per NODE — the circle on the tree —
// so a dead session can be resumed by a fresh agent that first reads what was
// said. The record also keeps the engine's threadId when one was reported, so
// a future engine-side resume has a name to ask for instead of a data gap.
//
// DELIBERATELY NOT inside the fleet-trees record: that parser is
// all-or-nothing on purpose (a broken forest must read as no forest), and one
// oversized transcript riding in it would erase every tree. Here the failure
// grain is one node's record: a damaged entry is dropped alone, and a damaged
// envelope degrades to empty rather than taking the page down.
//
// Storage crosses the SAME seam the forest uses (safeTreeStorage's read/write
// face), under its own key per computer. Everything is bounded: lines per
// node, characters per line, node records per computer, and the envelope's
// serialized size — a conversation is excerpted here, never archived.

export const TRANSCRIPT_STORAGE_KEY_BASE = 'mc.fleet.transcripts.v1'
export const transcriptStorageKey = computerId => `${TRANSCRIPT_STORAGE_KEY_BASE}:${computerId}`

export const TRANSCRIPT_LIMITS = Object.freeze({
  maxNodes: 24,
  maxLines: 40,
  maxLineChars: 600,
  maxThreadIdChars: 512,
  maxSerializedChars: 120_000,
  seedMaxChars: 6_000,
})

const WHO = Object.freeze(['you', 'agent'])
/* The engine's closed set, mirrored from shell/agent-host.cjs's EFFORT_KEYS —
   an unknown depth on a record reads as "none recorded", never as a value a
   resume would send onward for the boundary to refuse. */
const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh'])

function cleanLine(line) {
  if (!line || typeof line !== 'object') return null
  if (!WHO.includes(line.who)) return null
  if (typeof line.text !== 'string' || line.text.length === 0) return null
  return {
    who: line.who,
    text: line.text.slice(0, TRANSCRIPT_LIMITS.maxLineChars),
    at: typeof line.at === 'number' && Number.isFinite(line.at) ? line.at : null,
  }
}

function cleanRecord(record) {
  if (!record || typeof record !== 'object') return null
  if (typeof record.savedAt !== 'number' || !Number.isFinite(record.savedAt)) return null
  const threadId = typeof record.threadId === 'string' && record.threadId.length > 0
    ? record.threadId.slice(0, TRANSCRIPT_LIMITS.maxThreadIdChars)
    : null
  const effort = EFFORTS.includes(record.effort) ? record.effort : null
  const lines = Array.isArray(record.lines) ? record.lines.map(cleanLine).filter(Boolean) : []
  if (lines.length === 0) return null
  return { savedAt: record.savedAt, threadId, effort, lines: lines.slice(-TRANSCRIPT_LIMITS.maxLines) }
}

/** Read an envelope the seam handed back. A damaged envelope reads as empty
 *  and says so; a damaged RECORD inside a sound envelope is dropped alone —
 *  one broken conversation must not erase the others. */
export function parseTranscriptRow(raw) {
  const empty = { nodes: {}, damaged: false }
  if (raw === null || raw === undefined) return empty
  if (typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 1) return { ...empty, damaged: true }
  const nodes = {}
  if (raw.nodes && typeof raw.nodes === 'object' && !Array.isArray(raw.nodes)) {
    for (const [nodeId, record] of Object.entries(raw.nodes)) {
      if (typeof nodeId !== 'string' || nodeId.length === 0 || nodeId.length > 128) continue
      const cleaned = cleanRecord(record)
      if (cleaned) nodes[nodeId] = cleaned
    }
  }
  return { nodes, damaged: false }
}

/* Oldest records leave first when a cap is hit. savedAt is the eviction key:
 * the record touched longest ago is the conversation most likely already
 * resumed or abandoned. */
function evictOldest(nodes) {
  let oldestId = null
  let oldestAt = Infinity
  for (const [nodeId, record] of Object.entries(nodes)) {
    if (record.savedAt < oldestAt) { oldestAt = record.savedAt; oldestId = nodeId }
  }
  if (oldestId !== null) delete nodes[oldestId]
  return oldestId !== null
}

/**
 * The store. Same wiring discipline as createFleetTreeStore: a missing seam
 * or a bad computer id is a defect in the code, so it throws rather than
 * pretending. Every method re-reads the envelope — transcripts are written
 * once per turn, and a stale in-memory copy is how two views overwrite each
 * other's saves.
 */
export function createTranscriptStore({ computerId, storage }) {
  if (typeof computerId !== 'string' || computerId.length === 0) {
    throw new TypeError('createTranscriptStore needs the computer id its records belong to')
  }
  if (!storage || typeof storage.read !== 'function' || typeof storage.write !== 'function') {
    throw new TypeError('createTranscriptStore needs a storage seam with read and write')
  }
  const key = transcriptStorageKey(computerId)
  const readNodes = () => parseTranscriptRow(storage.read(key)).nodes

  return Object.freeze({
    /** Save one node's excerpt. Clamps every bound, evicts oldest records to
     *  fit, and answers whether the write really happened. */
    save(nodeId, { lines, threadId = null, effort = null } = {}) {
      if (typeof nodeId !== 'string' || nodeId.length === 0 || nodeId.length > 128) return false
      const record = cleanRecord({ savedAt: Date.now(), threadId, effort, lines })
      if (!record) return false
      const nodes = readNodes()
      nodes[nodeId] = record
      while (Object.keys(nodes).length > TRANSCRIPT_LIMITS.maxNodes) {
        if (!evictOldest(nodes)) break
      }
      let envelope = { v: 1, nodes }
      while (JSON.stringify(envelope).length > TRANSCRIPT_LIMITS.maxSerializedChars) {
        /* The record just saved is never the one evicted to make room for
           itself — evict the oldest OTHER record, and if this record alone
           is somehow over the envelope bound, refuse the save. */
        const others = Object.fromEntries(Object.entries(nodes).filter(([id]) => id !== nodeId))
        if (!evictOldest(others)) return false
        const survivor = { ...others, [nodeId]: record }
        for (const id of Object.keys(nodes)) if (!(id in survivor)) delete nodes[id]
        envelope = { v: 1, nodes }
      }
      return storage.write(key, envelope) === true
    },
    get(nodeId) {
      if (typeof nodeId !== 'string') return null
      return readNodes()[nodeId] || null
    },
    has(nodeId) {
      if (typeof nodeId !== 'string') return false
      return Boolean(readNodes()[nodeId])
    },
    remove(nodeId) {
      if (typeof nodeId !== 'string') return false
      const nodes = readNodes()
      if (!(nodeId in nodes)) return true
      delete nodes[nodeId]
      return storage.write(key, { v: 1, nodes }) === true
    },
  })
}

/**
 * The first message a resuming agent reads: the saved conversation, oldest
 * first, inside a frame that says whose words are whose. Bounded — when the
 * excerpt cannot fit, the OLDEST lines are dropped and the frame says so,
 * because the newest words are where the work stands.
 */
export function transcriptSeedText(lines) {
  const kept = Array.isArray(lines) ? lines.map(cleanLine).filter(Boolean) : []
  if (kept.length === 0) return ''
  const spoken = []
  let used = 0
  let dropped = false
  for (let i = kept.length - 1; i >= 0; i -= 1) {
    const line = kept[i]
    const said = `${line.who === 'you' ? 'The person said' : 'The agent before you said'}: ${line.text}`
    if (used + said.length > TRANSCRIPT_LIMITS.seedMaxChars && spoken.length > 0) { dropped = true; break }
    spoken.unshift(said)
    used += said.length
  }
  return [
    'You are taking over from an earlier agent whose session ended. This is that conversation, oldest first:',
    ...(dropped ? ['(Older messages were left out to fit.)'] : []),
    '',
    ...spoken,
    '',
    'Continue from where it stands. Work the conversation shows as finished is finished — do not redo it. Reply with a short note on where things stand.',
  ].join('\n')
}
