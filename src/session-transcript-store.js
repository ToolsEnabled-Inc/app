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

/* THE CAPS, AND WHY THE LAST ONE IS COMPUTED RATHER THAN TYPED.
 *
 * THE DEFECT THAT MADE IT SO, measured 2026-08-18 against a hand-typed
 * `maxSerializedChars: 120_000`. One record at THIS FILE'S OWN per-record
 * bounds -- 40 lines of 600 characters -- serialises to 25,453 characters. So
 * the size cap bound at FOUR records and the 24-record cap below it never
 * bound at all. Saving a fifth node's transcript deleted the first node's
 * ENTIRE conversation, and `save()` returned true. On a research machine that
 * is destroyed work, not a trimmed excerpt.
 *
 * THE NUMBER IT AGREES WITH IS THE ONE THE STORAGE REALLY ENFORCES, and that
 * was measured on a staged packaged build rather than reasoned about. Driving a
 * save of eight full records answered:
 *
 *   Could not save setting "mc.fleet.transcripts.v1:<computer>":
 *   a settings value may not exceed 65536 characters
 *
 * That is shell/renderer-prefs.cjs's MAX_VALUE_LENGTH -- the shipped app backs
 * this page's storage with a bounded preferences file, so the envelope's real
 * ceiling is 64KB and always was. A store that believed in 120,000 was not
 * merely evicting too eagerly; above 64KB its writes were REFUSED outright and
 * the conversation simply stopped being saved.
 *
 * So the size cap is the storage's own limit, with headroom for the key and the
 * file's framing around the value, and the caps above it are what a SINGLE
 * conversation may grow to when there is room. Those two are not in conflict
 * once degrading means trimming: the record cap says how many conversations are
 * kept (24, all of them), the per-record caps say how large one may get, and
 * the envelope is the budget they share. When the budget binds, the fattest
 * records give up their OLDEST lines and every conversation survives -- see
 * save(). Nothing is ever deleted to make room while a line remains to give. */
const MAX_NODES = 24
const MAX_LINES = 40
const MAX_ACTION_LINES = 12
const MAX_LINE_CHARS = 600
const MAX_ACTION_CHARS = 240
const MAX_THREAD_ID_CHARS = 512
const MAX_NODE_ID_CHARS = 128
const MAX_ACTION_TOOL_CHARS = 24
const LINE_WRAPPER_CHARS = JSON.stringify({ who: 'action', text: '', at: 1_700_000_000_000, state: 'working', tool: '' }).length + MAX_ACTION_TOOL_CHARS + 1
const RECORD_WRAPPER_CHARS = JSON.stringify({ savedAt: 1_700_000_000_000, threadId: '', effort: 'medium', trimmed: 0, lines: [] }).length + 1
const RECORD_CHARS = RECORD_WRAPPER_CHARS
  + MAX_THREAD_ID_CHARS
  + MAX_NODE_ID_CHARS + 3
  + MAX_LINES * (MAX_LINE_CHARS + LINE_WRAPPER_CHARS)
  + MAX_ACTION_LINES * (MAX_ACTION_CHARS + LINE_WRAPPER_CHARS)
/* shell/renderer-prefs.cjs's MAX_VALUE_LENGTH. Mirrored rather than imported:
   this module is renderer-side and dependency-free by design, and the seam it
   writes through is a plain read/write pair that knows nothing about limits.
   The headroom covers the storage key travelling beside the value. */
const STORAGE_VALUE_CHARS = 64 * 1024
const STORAGE_HEADROOM_CHARS = 2_048

export const TRANSCRIPT_LIMITS = Object.freeze({
  maxNodes: MAX_NODES,
  maxLines: MAX_LINES,
  /* What the agent DID, bounded separately from what it SAID. A busy turn can
     emit thousands of tool events and a shared bound would let them push the
     conversation out of its own record. */
  maxActionLines: MAX_ACTION_LINES,
  maxLineChars: MAX_LINE_CHARS,
  maxActionChars: MAX_ACTION_CHARS,
  maxThreadIdChars: MAX_THREAD_ID_CHARS,
  /* What ONE conversation may grow to when there is room -- the ceiling, not
     an allocation. RECORD_CHARS is exported so a caller can see the two
     numbers side by side rather than rediscovering the arithmetic. */
  maxRecordChars: RECORD_CHARS,
  maxSerializedChars: STORAGE_VALUE_CHARS - STORAGE_HEADROOM_CHARS,
  seedMaxChars: 6_000,
})

/* Three kinds of line, and only the first two are speech. An 'action' line is
   one thing the agent did -- a command it ran, a file it read -- kept so a
   conversation reopened tomorrow still shows the work, not only the words. */
const WHO = Object.freeze(['you', 'agent', 'action'])
const SPOKEN = Object.freeze(['you', 'agent'])
/* What became of one action, as a key rather than as words: the sentences
   belong to src/fleet-tree-copy.js, where the plain-language gate holds them. */
const ACTION_STATES = Object.freeze(['working', 'done', 'undone', 'waiting'])
/* The engine's closed set, mirrored from shell/agent-host.cjs's EFFORT_KEYS —
   an unknown depth on a record reads as "none recorded", never as a value a
   resume would send onward for the boundary to refuse. */
const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh'])

function cleanLine(line) {
  if (!line || typeof line !== 'object') return null
  if (!WHO.includes(line.who)) return null
  if (typeof line.text !== 'string' || line.text.length === 0) return null
  const action = line.who === 'action'
  const cleaned = {
    who: line.who,
    text: line.text.slice(0, action ? TRANSCRIPT_LIMITS.maxActionChars : TRANSCRIPT_LIMITS.maxLineChars),
    at: typeof line.at === 'number' && Number.isFinite(line.at) ? line.at : null,
  }
  if (action) {
    /* An action that lost what became of it reads as still running for ever,
       so the state rides with it -- from the closed set, never from the wire.
       The tool's NAME is already a display word chosen by the copy module
       (src/fleet-tree-copy.js), never an engine identifier, and it is bounded
       and stripped of anything but letters and spaces so a record copied in
       from anywhere cannot put markup or a path into that slot. */
    cleaned.state = ACTION_STATES.includes(line.state) ? line.state : 'done'
    cleaned.tool = typeof line.tool === 'string'
      ? line.tool.replace(/[^A-Za-z ]/g, '').slice(0, MAX_ACTION_TOOL_CHARS)
      : ''
  }
  return cleaned
}

/* THE TWO BOUNDS, APPLIED WITHOUT REORDERING ANYTHING. Speech is capped at
   maxLines and actions at maxActionLines, each keeping its own newest; the
   survivors are then read back out in the order they were spoken, because the
   order is the conversation. */
function boundLines(lines) {
  const spoken = lines.filter(line => SPOKEN.includes(line.who))
  const acted = lines.filter(line => line.who === 'action')
  const keptSpoken = new Set(spoken.slice(-TRANSCRIPT_LIMITS.maxLines))
  const keptActions = new Set(acted.slice(-TRANSCRIPT_LIMITS.maxActionLines))
  return {
    lines: lines.filter(line => keptSpoken.has(line) || keptActions.has(line)),
    dropped: (spoken.length - keptSpoken.size) + (acted.length - keptActions.size),
  }
}

function cleanRecord(record) {
  if (!record || typeof record !== 'object') return null
  if (typeof record.savedAt !== 'number' || !Number.isFinite(record.savedAt)) return null
  const threadId = typeof record.threadId === 'string' && record.threadId.length > 0
    ? record.threadId.slice(0, TRANSCRIPT_LIMITS.maxThreadIdChars)
    : null
  const effort = EFFORTS.includes(record.effort) ? record.effort : null
  const admitted = Array.isArray(record.lines) ? record.lines.map(cleanLine).filter(Boolean) : []
  const bound = boundLines(admitted)
  if (bound.lines.length === 0) return null
  /* HOW MUCH THIS RECORD HAS ALREADY LOST, carried on the record itself so the
     chat that opens it can admit the gap in words rather than showing a
     shortened conversation as if it were the whole one. */
  const before = typeof record.trimmed === 'number' && Number.isFinite(record.trimmed) && record.trimmed > 0
    ? Math.floor(record.trimmed)
    : 0
  return {
    savedAt: record.savedAt,
    threadId,
    effort,
    trimmed: before + bound.dropped,
    lines: bound.lines,
  }
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
 * resumed or abandoned. `keep` is the record being saved, which is never the
 * one thrown out to make room for itself. */
function evictOldest(nodes, keep = null) {
  let oldestId = null
  let oldestAt = Infinity
  for (const [nodeId, record] of Object.entries(nodes)) {
    if (nodeId === keep) continue
    if (record.savedAt < oldestAt) { oldestAt = record.savedAt; oldestId = nodeId }
  }
  if (oldestId !== null) delete nodes[oldestId]
  return oldestId !== null
}

const envelopeChars = nodes => JSON.stringify({ v: 1, nodes }).length

/* GIVE UP LINES BEFORE GIVING UP A CONVERSATION.
 *
 * One pass drops the OLDEST line from every record that is above the average
 * size and still has more than one line -- the fattest conversations pay
 * first, and no record is ever emptied by this. Answers how many lines went,
 * so a pass that can do nothing more says 0 and the caller moves on to its
 * last resort. */
function trimFattestRecords(nodes) {
  const entries = Object.entries(nodes).filter(([, record]) => record.lines.length > 1)
  if (entries.length === 0) return 0
  const sizes = entries.map(([, record]) => JSON.stringify(record).length)
  const mean = sizes.reduce((total, size) => total + size, 0) / sizes.length
  let above = entries.filter((_, index) => sizes[index] >= mean)
  if (above.length === 0) above = entries
  for (const [, record] of above) {
    record.lines = record.lines.slice(1)
    record.trimmed += 1
  }
  return above.length
}

/**
 * The store. Same wiring discipline as createFleetTreeStore: a missing seam
 * or a bad computer id is a defect in the code, so it throws rather than
 * pretending. Every method re-reads the envelope — transcripts are written
 * once per turn, and a stale in-memory copy is how two views overwrite each
 * other's saves.
 */
export function createTranscriptStore({ computerId, storage, onLoss = null }) {
  if (typeof computerId !== 'string' || computerId.length === 0) {
    throw new TypeError('createTranscriptStore needs the computer id its records belong to')
  }
  if (!storage || typeof storage.read !== 'function' || typeof storage.write !== 'function') {
    throw new TypeError('createTranscriptStore needs a storage seam with read and write')
  }
  const key = transcriptStorageKey(computerId)
  const readNodes = () => parseTranscriptRow(storage.read(key)).nodes
  /* A save that loses anything says so. A listener that throws is the
     listener's defect and must not cost the write that was about to land. */
  const report = loss => {
    if (typeof onLoss !== 'function') return
    try { onLoss(loss) } catch { /* a broken listener never costs a save */ }
  }

  return Object.freeze({
    /** Save one node's excerpt. Clamps every bound, gives up the oldest LINES
     *  to fit, and answers whether the write really happened. */
    save(nodeId, { lines, threadId = null, effort = null } = {}) {
      if (typeof nodeId !== 'string' || nodeId.length === 0 || nodeId.length > MAX_NODE_ID_CHARS) return false
      const record = cleanRecord({ savedAt: Date.now(), threadId, effort, lines })
      if (!record) return false
      const nodes = readNodes()
      nodes[nodeId] = record
      const removed = []
      while (Object.keys(nodes).length > TRANSCRIPT_LIMITS.maxNodes) {
        const held = new Set(Object.keys(nodes))
        if (!evictOldest(nodes, nodeId)) break
        for (const id of held) if (!(id in nodes)) removed.push(id)
      }
      /* DEGRADE BY TRIMMING, NEVER BY DELETING -- and this loop is the whole
         difference between an excerpt getting shorter and a person's work
         being destroyed. Lines go first, from the fattest records, until
         either it fits or every record is down to a single line; only then is
         a whole conversation given up, oldest first, and only then is a save
         that still cannot fit refused. The bound above makes this rare rather
         than routine: it is reached by JSON escaping, not by ordinary size. */
      let trimmedLines = 0
      while (envelopeChars(nodes) > TRANSCRIPT_LIMITS.maxSerializedChars) {
        const gave = trimFattestRecords(nodes)
        if (gave > 0) { trimmedLines += gave; continue }
        const held = new Set(Object.keys(nodes))
        if (!evictOldest(nodes, nodeId)) return false
        for (const id of held) if (!(id in nodes)) removed.push(id)
      }
      if (trimmedLines > 0 || removed.length > 0) {
        report({ nodeId, trimmedLines, removedNodeIds: removed, refused: false })
      }
      const wrote = storage.write(key, { v: 1, nodes }) === true
      if (!wrote) report({ nodeId, trimmedLines, removedNodeIds: removed, refused: true })
      return wrote
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
  /* SPEECH ONLY. An action line is a command the agent ran, and framing one as
     "the agent before you said" would put words in a mouth -- the taking-over
     agent would read a shell command as a sentence somebody meant. */
  const kept = Array.isArray(lines)
    ? lines.map(cleanLine).filter(line => line && SPOKEN.includes(line.who))
    : []
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
