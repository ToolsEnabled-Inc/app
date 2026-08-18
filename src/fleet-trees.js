/* THE TREES A PERSON BUILDS BY HAND. The state, not the drawing.
 *
 * The owner described this surface in four sentences, and every rule in this
 * file exists to keep one of them literally true rather than approximately
 * true:
 *
 *   1. "the node tree is EMPTY unless the user has started a session" — nothing
 *      is pre-populated. A fresh computer holds no trees and no agents, and
 *      this module has no seed data of any kind. That is a deliberate reversal
 *      of src/fleet-profile.js, which ships a labelled sample fleet on purpose
 *      so the demonstration screens have something to draw. A demonstration
 *      roster is honest when the screen says it is a demonstration; a
 *      demonstration entry in a structure the person is told THEY built is not,
 *      because there is no wording that makes "you added this" true about
 *      something the program added.
 *
 *   2. "the user sees empty placeholder nodes and presses one to EXTEND their
 *      existing structure" — the placeholders are the view's pixels, but WHERE
 *      a placeholder may legally appear is state, and it is answered here by
 *      extensionPoints(). Left to the view, that question gets answered twice,
 *      by two files, and the second answer offers a slot the store then
 *      refuses.
 *
 *   3. "pressing one opens a right-side panel where they assign a role and a
 *      message" — so an agent EXISTS, on screen, with an id, before any session
 *      does. That is what `draft` is. Without a draft state the panel would
 *      have to hold the half-filled agent in a variable of its own and the tree
 *      would only learn about it at the moment of launch, which loses the
 *      person's typing on any reload and makes "extend the structure" mean
 *      "start an agent right now", which is not what was asked for.
 *
 *   4. "a computer may hold MORE THAN ONE tree" — so a tree is a first-class
 *      record with its own id and name, and a node names the tree it belongs
 *      to. It also decides the shape question underneath: one tree has ONE top
 *      agent. A tree that tolerated several unrelated tops would be a forest
 *      wearing a single name, and then "more than one tree" would have no
 *      meaning a person could see or act on.
 *
 * NO DOM, NO WINDOW, NO CONNECTION TO THE PROGRAM. Everything here is data and
 * arithmetic, so tools/test/fleet-trees.test.mjs exercises the rules in plain
 * node rather than through a screenshot of a panel.
 *
 * THE PERSISTENCE SEAM IS THE ONE IN src/checkout-selection.js, deliberately
 * copied rather than re-invented: a `{ read(key), write(key, value) }` face
 * that cannot throw, handed in by the caller. safeTreeStorage() below wraps a
 * getItem/setItem backing into it, and its shape is identical to safeStorage()
 * in that file, so a caller that already built one may pass the same object
 * here. Saving on the browser side throws in private mode and on quota, and a
 * store that lets that reach the panel loses the structure the person is in the
 * middle of building; a store that swallows it silently tells them their work
 * is kept when it is not. So a save that does not land is REPORTED, on every
 * snapshot, as persistenceFailed.
 *
 * BROKEN SAVED STATE MEANS NO TREES, NEVER SOME TREES. parseFleetTrees()
 * returns everything or nothing. A half-read tree is the worst of the three
 * outcomes available: an agent whose parent was dropped becomes a second top
 * agent nobody placed, and the person is looking at a structure they did not
 * build while being told it is theirs. Losing the file is visible and can be
 * started again. Silently rearranging it is neither.
 */

export const FLEET_TREES_RECORD_VERSION = 1

/* One saved record per computer, and the computer's id is IN the key as well as
   inside the record. Both, not either: the key keeps two computers' structures
   from overwriting each other in the same storage area, and the field inside
   catches a record that was copied, restored or synced under the wrong key —
   which parseFleetTrees treats as somebody else's data and refuses. */
const STORAGE_KEY_BASE = 'mc.fleet.trees.v1'
export const fleetTreesStorageKey = computerId => `${STORAGE_KEY_BASE}:${computerId}`

/* WHO HOLDS A LIVE STORE, so nobody else writes beside it.
 *
 * A store instance persists the WHOLE record on every mutation. Two live
 * instances over one computer id therefore clobber each other's writes blob
 * for blob — the second writer silently discards everything the first added
 * since it loaded. Views never overlap (one route is mounted at a time), but
 * the research dispatcher's module-level results listener outlives every view
 * and files worker outcomes whenever a turn completes. This registry is how
 * it knows whether a view's instance is live: if one is, the listener leaves
 * the tree to that view's own event wiring; if none is, the listener may open
 * a transient instance, write, and drop it. */
const liveStores = new Map()

export function markTreeStoreLive(computerId) {
  const id = typeof computerId === 'string' ? computerId : ''
  if (!id) return () => {}
  liveStores.set(id, (liveStores.get(id) || 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const count = liveStores.get(id) || 0
    if (count <= 1) liveStores.delete(id)
    else liveStores.set(id, count - 1)
  }
}

export function isTreeStoreLive(computerId) {
  return liveStores.has(typeof computerId === 'string' ? computerId : '')
}

/* THE FIVE STATES, AND WHY THERE ARE FIVE.
 *
 *   draft      created by pressing a placeholder, and given a role and a
 *              message in the panel. No session exists. This is the state the
 *              owner's flow spends most of its time in and the only one in
 *              which the brief may still be edited.
 *   starting   a launch has been asked for and no id has come back yet. It is
 *              a real state and not an animation: the id arrives on a separate
 *              beat, and a node that jumped straight to running would spend
 *              that gap claiming a session nothing can point at.
 *   running    a live session, whose id this node holds.
 *   finished   the session ended.
 *   failed     the session ended badly. Kept apart from finished because the
 *              two ask different things of the person looking at the tree.
 *
 * The transitions are NOT enumerated as a table here. What is enforced instead
 * is the pair of facts a table would only be a proxy for: running means there
 * is a session id, and draft means there is not. Those two are what any screen
 * reading this state will act on, and they are checked on every write and on
 * every read of saved state. */
export const NODE_STATUSES = Object.freeze(['draft', 'starting', 'running', 'finished', 'failed'])
const LIVE_STATUSES = Object.freeze(new Set(['starting', 'running']))

/* Bounds, so that a saved record cannot grow without limit and a damaged one
   cannot ask this module to walk a million entries before refusing it. They are
   generous on purpose: they exist to bound the failure, not to ration the
   person's structure. */
export const FLEET_TREE_LIMITS = Object.freeze({
  maxTrees: 64,
  maxNodes: 512,
  maxNameChars: 80,
  maxRoleChars: 60,
  maxMessageChars: 4000,
  maxNoteChars: 240,
  /* The agent's own answer, kept on the node so "What it said" survives a
     restart. Bounded like the message that asked for it; the WRITER trims
     rather than refuses, because this is machine output — refusing an
     oversized answer would throw the whole answer away to punish its length. */
  maxReplyChars: 4000,
  /* THE LOOP GUARD, NOT THE PRODUCT RULE. How many steps a walk up the parents
     may take before it gives up on the data. The rule a person meets is
     TREE_BOUNDS.maxDepth at the foot of this file, which is the ENGINE's own
     cap and is far smaller; this number only has to be large enough that no
     honest structure hits it and small enough that a looping file cannot spin. */
  maxChainSteps: 64,
})

/* What "no trees" IS. One frozen value, returned by every refusing path in the
   reader, so that a caller comparing against it cannot be fooled by a second
   empty-looking object with a subtly different shape. */
export const EMPTY_FLEET_TREES = Object.freeze({
  version: FLEET_TREES_RECORD_VERSION,
  computerId: null,
  trees: Object.freeze([]),
  nodes: Object.freeze([]),
})

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/* The same identifier rule src/fleet-profile.js applies to machine, pool and
   channel ids, kept in the same shape so an id minted here is acceptable
   anywhere in the app that already validates one. */
const safeIdentifier = value => typeof value === 'string'
  && value.length > 0 && value.length <= 128
  && /^[a-z0-9][a-z0-9._:/-]*$/i.test(value)

const safeStamp = value => typeof value === 'string' && value.length > 0 && value.length <= 64

/* A NAME AND A ROLE ARE ONE LINE; A MESSAGE IS NOT.
 *
 * Line breaks and tabs are allowed in the message and nowhere else, because the
 * message is the brief a person types for an agent and briefs have paragraphs.
 * Every other control character is refused in all of them: they are invisible
 * in a panel, so a person cannot see, remove, or even suspect one, and a name
 * that draws differently from the characters it holds is a name that can
 * impersonate another entry in the same list.
 *
 * Angle brackets are NOT refused in the message. A person writing a brief types
 * "->" and "<see the note>" without meaning markup, and refusing their typing
 * to compensate for a screen that might paste it into markup would put the cost
 * of that screen's bug on them.
 *
 * SO THIS IS A REQUIREMENT ON EVERY VIEW THAT DRAWS A MESSAGE, not an
 * observation about the one that draws it today: a role or a message goes to
 * the screen as TEXT — textContent, or escaped the way src/tree-graph.js
 * escapes it — and never as markup a browser is asked to parse. Escaping at
 * rest is not the alternative: it would hand back a person's own words with
 * &amp; in them the next time the panel opened.
 *
 * Deliberately not enforced by a test that reads another lane's file. A guard
 * that greps a view for an escape call fails on the day somebody renames a
 * helper, which red-lights this suite for an edit that changed nothing about
 * the rule — and a gate that cries wolf is one somebody deletes. The rule is
 * stated where the decision that depends on it is made. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const CONTROL_CHARS_EXCEPT_BREAKS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

const oneLineText = (value, max) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > max) return null
  return CONTROL_CHARS.test(trimmed) ? null : trimmed
}

const briefText = (value, max) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length > max) return null
  return CONTROL_CHARS_EXCEPT_BREAKS.test(trimmed) ? null : trimmed
}

/* A role and a message may be EMPTY on a draft, and that is the whole point of
   a draft: the placeholder is pressed first and the panel is filled in second,
   so between those two beats an agent legitimately exists with neither. An
   empty role is stored as '' rather than null so that every node has the same
   shape and no reader has to handle two spellings of "not said yet". */
const optionalOneLine = (value, max) => {
  if (value == null) return ''
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length > max) return null
  return CONTROL_CHARS.test(trimmed) ? null : trimmed
}

const frozenList = list => Object.freeze(list.map(entry => Object.freeze(entry)))
const refuse = (...problems) => Object.freeze({ ok: false, problems: Object.freeze(problems) })

/** A storage face that cannot throw, matching safeStorage in src/checkout-selection.js. */
export function safeTreeStorage(backing) {
  return Object.freeze({
    read(key) {
      try {
        const raw = backing?.getItem(key)
        return typeof raw === 'string' ? JSON.parse(raw) : null
      } catch { return null }
    },
    write(key, value) {
      try { backing?.setItem(key, JSON.stringify(value)); return true }
      catch { return false }
    },
  })
}

/* Walking up from a node to its top, with a hard step limit.
 *
 * The limit is not defensive decoration. This walk runs over data that may have
 * come off disk, and a loop in that data is exactly the damage the walk is
 * being used to detect, so a walk that trusted the data to end would hang the
 * window on the very file it was checking. A chain longer than the step limit is
 * refused rather than followed. */
function ancestorChainIsSound(node, byId) {
  const seen = new Set([node.id])
  let current = node
  for (let step = 0; step < FLEET_TREE_LIMITS.maxChainSteps; step += 1) {
    if (current.parentId == null) return true
    const parent = byId.get(current.parentId)
    if (!parent) return false
    if (parent.treeId !== node.treeId) return false
    if (seen.has(parent.id)) return false
    seen.add(parent.id)
    current = parent
  }
  return false
}

/**
 * Read saved state, whole or not at all.
 *
 * Accepts either the object a storage seam already read or the raw text, so the
 * same rules apply whether the record came from browser storage, a file, or a
 * test fixture. `computerId` is optional: when given, a record belonging to a
 * different computer is refused rather than adopted, which is what makes the
 * key-plus-field pair above worth having.
 *
 * EVERY REFUSAL RETURNS EMPTY_FLEET_TREES. There is no partial success and no
 * repair pass, for the reason stated at the top of this file.
 */
export function parseFleetTrees(value, { computerId = null } = {}) {
  let raw = value
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { return EMPTY_FLEET_TREES }
  }
  if (!isPlainObject(raw)) return EMPTY_FLEET_TREES
  if (raw.version !== FLEET_TREES_RECORD_VERSION) return EMPTY_FLEET_TREES
  if (!safeIdentifier(raw.computerId)) return EMPTY_FLEET_TREES
  if (computerId != null && raw.computerId !== computerId) return EMPTY_FLEET_TREES
  if (!Array.isArray(raw.trees) || !Array.isArray(raw.nodes)) return EMPTY_FLEET_TREES
  if (raw.trees.length > FLEET_TREE_LIMITS.maxTrees) return EMPTY_FLEET_TREES
  if (raw.nodes.length > FLEET_TREE_LIMITS.maxNodes) return EMPTY_FLEET_TREES

  /* ONE ID SPACE FOR TREES AND AGENTS TOGETHER. The owner's rule is that ids are
     unique per computer, and the cheapest way for that to stay true under every
     future reader is for it to be true of the ids themselves rather than of
     each list separately. A caller holding a bare id is then never one lookup
     away from the wrong kind of record. */
  const ids = new Set()
  const trees = []
  for (const entry of raw.trees) {
    if (!isPlainObject(entry)) return EMPTY_FLEET_TREES
    if (!safeIdentifier(entry.id) || ids.has(entry.id)) return EMPTY_FLEET_TREES
    /* A TREE MAY HAVE NO NAME OF ITS OWN, and usually does. Its label comes from
       the first message the person typed into it (see treeLabel below), so the
       stored name is only what they typed over that. Null is therefore an
       ordinary value here and not a broken record. */
    const name = entry.name == null ? null : oneLineText(entry.name, FLEET_TREE_LIMITS.maxNameChars)
    if (entry.name != null && name === null) return EMPTY_FLEET_TREES
    if (!safeStamp(entry.createdAt) || !safeStamp(entry.updatedAt)) return EMPTY_FLEET_TREES
    ids.add(entry.id)
    /* profileId is additive and forgiving on purpose: it is a POINTER to a
       main-process profile store, so a dangling id costs nothing here -- the
       start path refuses it loudly there. Anything not a plausible id reads
       as null rather than poisoning the whole record. */
    const profileId = typeof entry.profileId === 'string' && entry.profileId.length <= 128 ? entry.profileId : null
    trees.push({ id: entry.id, name, createdAt: entry.createdAt, updatedAt: entry.updatedAt, profileId })
  }

  const treeIds = new Set(trees.map(tree => tree.id))
  const roots = new Set()
  const sessions = new Set()
  const nodes = []
  const byId = new Map()
  for (const entry of raw.nodes) {
    if (!isPlainObject(entry)) return EMPTY_FLEET_TREES
    if (!safeIdentifier(entry.id) || ids.has(entry.id)) return EMPTY_FLEET_TREES
    if (!treeIds.has(entry.treeId)) return EMPTY_FLEET_TREES
    if (!NODE_STATUSES.includes(entry.status)) return EMPTY_FLEET_TREES
    if (!safeStamp(entry.createdAt) || !safeStamp(entry.updatedAt)) return EMPTY_FLEET_TREES

    const role = optionalOneLine(entry.role, FLEET_TREE_LIMITS.maxRoleChars)
    if (role === null) return EMPTY_FLEET_TREES
    const message = briefText(entry.message ?? '', FLEET_TREE_LIMITS.maxMessageChars)
    if (message === null) return EMPTY_FLEET_TREES
    const statusNote = briefText(entry.statusNote ?? '', FLEET_TREE_LIMITS.maxNoteChars)
    if (statusNote === null) return EMPTY_FLEET_TREES

    const sessionId = entry.sessionId == null ? null : entry.sessionId
    if (sessionId !== null && !safeIdentifier(sessionId)) return EMPTY_FLEET_TREES
    if (sessionId !== null && sessions.has(sessionId)) return EMPTY_FLEET_TREES
    if (entry.status === 'draft' && sessionId !== null) return EMPTY_FLEET_TREES
    if (entry.status === 'running' && sessionId === null) return EMPTY_FLEET_TREES

    /* NOTHING COMES BACK OFF DISK RUNNING.
     *
     * A session cannot outlive the window that owns it, so `running` in a saved
     * file is a claim about a process that stopped when the app closed. Drawing
     * it would put a live-looking agent on the tree with a stop button that
     * reaches nothing, which is the failure src/agent-session-registry.js
     * describes in its own header and deliberately persists nothing to avoid.
     *
     * It comes back as `starting` rather than as a draft, and that is the point
     * of having `starting` at all: it means "a session was asked for, and this
     * window has not been told whether it is live". The id is kept, because it
     * is the only handle anything has for asking. The program answers on mount
     * and the state follows the answer. */
    const status = entry.status === 'running' ? 'starting' : entry.status

    const parentId = entry.parentId == null ? null : entry.parentId
    if (parentId !== null && !safeIdentifier(parentId)) return EMPTY_FLEET_TREES
    if (parentId === null) {
      if (roots.has(entry.treeId)) return EMPTY_FLEET_TREES
      roots.add(entry.treeId)
    }

    ids.add(entry.id)
    if (sessionId !== null) sessions.add(sessionId)
    const node = {
      id: entry.id,
      treeId: entry.treeId,
      parentId,
      role,
      message,
      status,
      statusNote,
      /* Forgiving on purpose, unlike the structural fields around it: a reply
         is display text, not shape. An absent one is the empty answer (records
         written before the field existed), and an oversized one is trimmed
         rather than costing the person their whole saved forest. */
      reply: typeof entry.reply === 'string' ? entry.reply.slice(0, FLEET_TREE_LIMITS.maxReplyChars) : '',
      /* Same forgiveness as reply: the tier a node started on is display and
         restart guidance, not shape. Absent means the record predates the
         field, and a restart falls back to the default tier and says so. */
      tier: typeof entry.tier === 'string' ? entry.tier.slice(0, 64) : '',
      sessionId,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }
    nodes.push(node)
    byId.set(node.id, node)
  }

  /* The parent checks run in a second pass because a record is a list, not a
     drawing: a child may be written before its parent and that is not a
     mistake. What IS one is a parent that is missing, that sits in another
     tree, or that leads back to the child, and none of those can be judged
     until every node has been read. */
  for (const node of nodes) {
    if (!ancestorChainIsSound(node, byId)) return EMPTY_FLEET_TREES
  }

  return Object.freeze({
    version: FLEET_TREES_RECORD_VERSION,
    computerId: raw.computerId,
    trees: frozenList(trees),
    nodes: frozenList(nodes),
  })
}

/* Ids are minted here rather than by the caller so that the uniqueness rule has
   one owner. The store still checks the result: an injected generator is a seam
   a test drives, and a seam a test can drive is a seam that can hand back the
   same id twice. */
function defaultIdFactory() {
  let counter = 0
  return kind => {
    counter += 1
    const unique = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    return `${kind}-${counter}-${unique}`
  }
}

/**
 * The store for one computer's trees.
 *
 * ONE STORE IS ONE COMPUTER. That is why every read here is already scoped and
 * `listTrees()` takes no argument: "the trees on this computer" is the question
 * the owner asked, and a store that also answered it for other computers would
 * invite a screen to draw one computer's structure under another's name.
 *
 * MUTATIONS ARE REPORTED, NOT THROWN. Every write returns a frozen
 * `{ ok, problems, ... }`, because each refusal below corresponds to something
 * a person did in a panel and the panel has to be able to say which one. An
 * exception would leave that sentence to be invented at the call site.
 *
 * BAD WIRING IS THE EXCEPTION, and deliberately so: a missing storage seam or a
 * computer id that is not an id is a mistake in the code that built the store,
 * not something a person can do, and returning a polite refusal for it would
 * hide the defect behind an empty tree that looks like a fresh install.
 */
export function createFleetTreeStore({
  computerId,
  storage,
  now = () => new Date().toISOString(),
  makeId = defaultIdFactory(),
  onChange = () => {},
} = {}) {
  if (!safeIdentifier(computerId)) {
    throw new TypeError('createFleetTreeStore needs the id of the computer these trees belong to')
  }
  if (!storage || typeof storage.read !== 'function' || typeof storage.write !== 'function') {
    throw new TypeError('createFleetTreeStore needs a storage seam with read and write')
  }

  /* THE SEAM IS TRUSTED TO ANSWER, NOT TO BEHAVE. safeTreeStorage cannot throw,
     and that is the seam this store expects — but the seam is the caller's to
     supply, and a caller that hands in a bare localStorage face gets a throw out
     of a private-mode read or a full quota write. Losing the window over the
     save file is a worse answer than either of the two this store already knows
     how to give: an empty tree, or a saved-state warning. So both calls are
     wrapped once, here, rather than the rule being written in a comment other
     people are trusted to have read. */
  const key = fleetTreesStorageKey(computerId)
  const readSaved = () => {
    try { return storage.read(key) } catch { return null }
  }
  const writeSaved = value => {
    try { return storage.write(key, value) === true } catch { return false }
  }
  const loaded = parseFleetTrees(readSaved(), { computerId })
  const trees = new Map(loaded.trees.map(tree => [tree.id, tree]))
  const nodes = new Map(loaded.nodes.map(node => [node.id, node]))
  const listeners = new Set()
  let persistenceFailed = false

  const record = () => ({
    version: FLEET_TREES_RECORD_VERSION,
    computerId,
    trees: [...trees.values()],
    nodes: [...nodes.values()],
  })

  const snapshot = () => Object.freeze({
    computerId,
    trees: frozenList([...trees.values()]),
    nodes: frozenList([...nodes.values()]),
    persistenceFailed,
  })

  /* Save on the same beat as the change, the way createSelectionStore does:
     there is no save button on a tree the person is building by pressing
     placeholders, so a structure that is on screen and not in storage is a lie
     the next launch tells. */
  function commit() {
    persistenceFailed = !writeSaved(record())
    const current = snapshot()
    onChange(current)
    for (const listener of listeners) listener(current)
    return current
  }

  const accept = payload => Object.freeze({ ok: true, problems: Object.freeze([]), ...payload, snapshot: commit() })

  /* A fresh id, checked against everything this computer already holds. The
     retry is for a generator that collides by accident; the refusal is for one
     that collides every time, which is a defect that must not be answered by an
     endless loop. */
  function mintId(kind) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = makeId(kind)
      if (safeIdentifier(candidate) && !trees.has(candidate) && !nodes.has(candidate)) return candidate
    }
    return null
  }

  const childrenOf = nodeId => frozenList([...nodes.values()].filter(node => node.parentId === nodeId))
  const nodesOfTree = treeId => [...nodes.values()].filter(node => node.treeId === treeId)
  const rootOf = treeId => nodesOfTree(treeId).find(node => node.parentId === null) || null

  function descendantsOf(nodeId) {
    const collected = []
    const queue = [nodeId]
    while (queue.length > 0) {
      const current = queue.shift()
      for (const node of nodes.values()) {
        if (node.parentId !== current) continue
        collected.push(node.id)
        queue.push(node.id)
      }
    }
    return collected
  }

  function depthOf(node) {
    let depth = 0
    let current = node
    while (current && current.parentId != null && depth < FLEET_TREE_LIMITS.maxChainSteps) {
      current = nodes.get(current.parentId)
      depth += 1
    }
    return depth
  }

  /* How far the structure UNDER this node reaches — 0 for a leaf. A move
     carries the whole branch, so the depth a move must answer for is the
     BRANCH's, not the one node's: dropping a two-level branch under a depth-2
     parent puts its deepest agent past the cap even though the moved node
     itself would fit. */
  function branchHeight(nodeId) {
    let height = 0
    const queue = [[nodeId, 0]]
    while (queue.length > 0) {
      const [current, depth] = queue.shift()
      for (const node of nodes.values()) {
        if (node.parentId !== current) continue
        if (depth + 1 > height) height = depth + 1
        if (depth + 1 < FLEET_TREE_LIMITS.maxChainSteps) queue.push([node.id, depth + 1])
      }
    }
    return height
  }

  const putNode = (node, fields) => {
    const next = Object.freeze({ ...node, ...fields, updatedAt: now() })
    nodes.set(next.id, next)
    return next
  }

  return Object.freeze({
    snapshot,
    listTrees: () => frozenList([...trees.values()]),
    getTree: treeId => trees.get(treeId) || null,
    listNodes: treeId => frozenList(nodesOfTree(treeId)),
    getNode: nodeId => nodes.get(nodeId) || null,
    childrenOf,
    rootOf,

    /**
     * WHAT A TREE IS CALLED, DECIDED IN ONE PLACE.
     *
     * The tab, the graph and the panel all ask this function, because three
     * files each deriving a name is three names for one tree the first time one
     * of them is changed.
     *
     * The order is the owner's: the words the person typed over it, then the
     * FIRST MESSAGE they sent an agent in it, then a counted fallback. The
     * middle step is the one that does the work — telling two trees apart is the
     * whole reason a computer may hold more than one, and "Ship the installer"
     * beside "Fix the login bug" does that where "Tree 1" beside "Tree 2" is
     * only a way of saying there are two.
     *
     * The count is last and is never the answer while any message exists.
     */
    treeLabel(treeId) {
      const tree = trees.get(treeId)
      if (!tree) return null
      if (tree.name) return tree.name
      const derived = displayName(treeRecord(snapshot(), treeId))
      if (derived !== 'New tree') return derived
      return `Tree ${[...trees.keys()].indexOf(treeId) + 1}`
    },

    /* A second way to hear about a change, next to the onChange handed in at
       build time. Two listeners is not a luxury here: the graph and the panel
       are separate pieces of the same screen and either can be built or thrown
       away without the other. Returns the way to stop listening, because a
       listener that outlives its panel keeps a dead view alive in memory and
       paints into a container nobody can see. */
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {}
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    /**
     * Where a placeholder may be pressed, which is the owner's flow expressed
     * as data.
     *
     * Three kinds, and they are separate because they read differently on
     * screen and cost differently to press: `child` extends an existing
     * structure below an agent that is already there, `root` fills the empty
     * top of a tree that has no agents yet, and `tree` starts a second
     * structure on this computer. The last one disappears at the tree limit
     * rather than being offered and then refused.
     */
    extensionPoints() {
      const points = []
      for (const tree of trees.values()) {
        if (rootOf(tree.id) === null) points.push({ kind: 'root', treeId: tree.id, parentId: null })
      }
      for (const node of nodes.values()) {
        /* A SLOT THE ENGINE WOULD REFUSE IS NOT DRAWN. The caps are its own —
           eight agents under one, four levels in all — and a placeholder past
           either of them can only be pressed, filled in, and turned down by
           something the person cannot see. Refusing to offer it is the only
           version of that refusal they can act on. */
        if (childrenOf(node.id).length >= TREE_BOUNDS.maxChildren) continue
        if (depthOf(node) + 1 > TREE_BOUNDS.maxDepth) continue
        points.push({ kind: 'child', treeId: node.treeId, parentId: node.id })
      }
      if (trees.size < FLEET_TREE_LIMITS.maxTrees) points.push({ kind: 'tree', treeId: null, parentId: null })
      return frozenList(points)
    },

    /* A NAME IS OPTIONAL, because the name that matters is derived. A tree
       nobody has typed into yet has nothing to be called, and inventing
       something for it is how a tab ends up saying a word the person never
       wrote. treeLabel() below is where the words come from. */
    createTree({ name = null } = {}) {
      const clean = name == null || String(name).trim() === ''
        ? null
        : oneLineText(name, FLEET_TREE_LIMITS.maxNameChars)
      if (name != null && String(name).trim() !== '' && clean === null) {
        return refuse(`Keep the name to one line of ${FLEET_TREE_LIMITS.maxNameChars} characters or fewer.`)
      }
      if (trees.size >= FLEET_TREE_LIMITS.maxTrees) {
        return refuse(`This computer holds ${FLEET_TREE_LIMITS.maxTrees} trees already. Remove one to add another.`)
      }
      /* One empty tree at a time, and the reason is planTreeAdd's to give. What
         belongs here is that the rule is checked in the STORE and not only
         where the button is drawn, and that the sentence comes from that same
         function, so what a caller is told and what the tab shows cannot
         drift. */
      const plan = planTreeAdd([...trees.keys()].map(existing => treeRecord(snapshot(), existing)))
      if (!plan.allowed) return refuse(plan.reason)
      const id = mintId('tree')
      if (id === null) return refuse('Could not make a name for this tree. Try again.')
      const stamp = now()
      const tree = Object.freeze({ id, name: clean, createdAt: stamp, updatedAt: stamp, profileId: null })
      trees.set(id, tree)
      return accept({ tree })
    },

    /* WHICH PROFILE THIS TREE'S AGENTS START UNDER. A pointer, not a path:
       the main process owns the folders and refuses dangling ids at start.
       Null means the product's own workspace, which is what every tree meant
       before profiles existed. */
    setTreeProfile(treeId, profileId) {
      const tree = trees.get(treeId)
      if (!tree) return refuse('That tree is not on this computer.')
      const clean = typeof profileId === 'string' && profileId && profileId.length <= 128 ? profileId : null
      trees.set(treeId, Object.freeze({ ...tree, profileId: clean, updatedAt: now() }))
      /* accept() commits, which saves AND tells every listener -- see commit()
         above. This used to call `persist()` and `notify()` first: two names
         nothing in this file ever bound, so assigning a folder to a tree threw
         a ReferenceError before it could return, on every press. */
      return accept({ treeId, profileId: clean })
    },

    treeProfile(treeId) {
      return trees.get(treeId)?.profileId || null
    },

    renameTree(treeId, name) {
      const tree = trees.get(treeId)
      if (!tree) return refuse('That tree is not on this computer.')
      /* Renaming to nothing is not a mistake to refuse: it is "go back to
         calling it what I said to my first agent", which is the name it had
         before anybody typed over it. */
      const blank = name == null || String(name).trim() === ''
      const clean = blank ? null : oneLineText(name, FLEET_TREE_LIMITS.maxNameChars)
      if (!blank && clean === null) {
        return refuse(`Keep the name to one line of ${FLEET_TREE_LIMITS.maxNameChars} characters or fewer.`)
      }
      const next = Object.freeze({ ...tree, name: clean, updatedAt: now() })
      trees.set(treeId, next)
      return accept({ tree: next })
    },

    /* Removing a tree removes its agents with it. The alternative — agents left
       behind naming a tree that is gone — is the exact shape the reader above
       refuses to load, so letting a store produce it would mean building a
       structure that cannot survive a restart. */
    removeTree(treeId) {
      const tree = trees.get(treeId)
      if (!tree) return refuse('That tree is not on this computer.')
      /* THE AGENTS COME BACK, NOT JUST THEIR IDS. Once they are out of this
         store nothing can look their sessions up, so a caller holding only ids
         has no way to stop a run it just removed from the screen — work still
         going with nothing on the page naming it. Handing back the records
         themselves is what makes "remove this tree, and stop what was in it" a
         thing the caller can actually do. */
      const removedNodes = nodesOfTree(treeId)
      const removedNodeIds = removedNodes.map(node => node.id)
      for (const nodeId of removedNodeIds) nodes.delete(nodeId)
      trees.delete(treeId)
      return accept({
        removedTreeId: treeId,
        removedTree: tree,
        removedNodeIds: Object.freeze(removedNodeIds),
        removedNodes: frozenList(removedNodes),
      })
    },

    /**
     * Add an agent, as a draft, in one of three places.
     *
     *   under a parent       `parentId` names an agent that already exists; the
     *                        new one joins that agent's tree.
     *   at the top of a tree `treeId` names an existing tree that has no top
     *                        agent yet.
     *   in a new tree        neither is given, so a tree is made for it.
     *
     * IT IS ALWAYS A DRAFT, whatever was passed. The panel that fills in a role
     * and a message opens AFTER the placeholder is pressed, so a caller cannot
     * yet know either, and a caller that thinks it does is describing a launch
     * rather than a placeholder.
     */
    addNode({ treeId = null, parentId = null, role = '', message = '', tier = '' } = {}) {
      const cleanTier = optionalOneLine(tier, 64)
      if (cleanTier === null) {
        return refuse('Keep the tier to one line of 64 characters or fewer.')
      }
      const cleanRole = optionalOneLine(role, FLEET_TREE_LIMITS.maxRoleChars)
      if (cleanRole === null) {
        return refuse(`Keep the role to one line of ${FLEET_TREE_LIMITS.maxRoleChars} characters or fewer.`)
      }
      const cleanMessage = briefText(message ?? '', FLEET_TREE_LIMITS.maxMessageChars)
      if (cleanMessage === null) {
        return refuse(`Shorten the message to ${FLEET_TREE_LIMITS.maxMessageChars} characters or fewer.`)
      }
      if (nodes.size >= FLEET_TREE_LIMITS.maxNodes) {
        return refuse(`This computer holds ${FLEET_TREE_LIMITS.maxNodes} agents already. Remove one to add another.`)
      }

      let parent = null
      let targetTreeId = treeId
      if (parentId != null) {
        parent = nodes.get(parentId)
        if (!parent) return refuse('That agent is not on this computer.')
        if (treeId != null && treeId !== parent.treeId) {
          return refuse('That agent belongs to a different tree. Add the new agent under one in the same tree.')
        }
        targetTreeId = parent.treeId
        /* The same two engine caps extensionPoints draws by. They are checked
           again here because a caller may add without ever asking where a
           placeholder was: a rule kept only in the drawing is not a rule. */
        const refusal = planNodeAdd(treeRecord(snapshot(), parent.treeId), parent.id)
        if (!refusal.allowed) return refuse(refusal.reason)
      } else if (treeId != null) {
        if (!trees.has(treeId)) return refuse('That tree is not on this computer.')
        if (rootOf(treeId) !== null) {
          return refuse('That tree already has a top agent. Add this one under an agent that is there.')
        }
      } else {
        if (trees.size >= FLEET_TREE_LIMITS.maxTrees) {
          return refuse(`This computer holds ${FLEET_TREE_LIMITS.maxTrees} trees already. Remove one to add another.`)
        }
        const treeIdForNew = mintId('tree')
        if (treeIdForNew === null) return refuse('Could not make a name for this tree. Try again.')
        const stamp = now()
        /* NO NAME IS PUT ON IT HERE. The role was briefly used for this and it
           was wrong twice over: a role is a job title, not a subject, and two
           trees whose top agent is a builder would then wear the same tab. The
           label comes from the first message instead — see treeLabel(). */
        trees.set(treeIdForNew, Object.freeze({
          id: treeIdForNew,
          name: null,
          createdAt: stamp,
          updatedAt: stamp,
        }))
        targetTreeId = treeIdForNew
      }

      const id = mintId('node')
      if (id === null) return refuse('Could not make a name for this agent. Try again.')
      const stamp = now()
      const node = Object.freeze({
        id,
        treeId: targetTreeId,
        parentId: parent ? parent.id : null,
        role: cleanRole,
        message: cleanMessage,
        status: 'draft',
        statusNote: '',
        reply: '',
        tier: cleanTier,
        sessionId: null,
        createdAt: stamp,
        updatedAt: stamp,
      })
      nodes.set(id, node)
      return accept({ node, tree: trees.get(targetTreeId) })
    },

    /**
     * Write what the right-side panel collected.
     *
     * ONLY WHILE IT IS A DRAFT. Once a session has been asked for, the message
     * is what was SENT, and a panel that let it be edited afterwards would show
     * the person a brief their agent never received. Editing is refused with a
     * sentence saying so, rather than accepted and quietly dropped.
     */
    updateNode(nodeId, { role, message } = {}) {
      const node = nodes.get(nodeId)
      if (!node) return refuse('That agent is not on this computer.')
      if (node.status !== 'draft') {
        return refuse('This agent has already started, so its role and message stay as they were sent.')
      }
      const fields = {}
      if (role !== undefined) {
        const cleanRole = optionalOneLine(role, FLEET_TREE_LIMITS.maxRoleChars)
        if (cleanRole === null) {
          return refuse(`Keep the role to one line of ${FLEET_TREE_LIMITS.maxRoleChars} characters or fewer.`)
        }
        fields.role = cleanRole
      }
      if (message !== undefined) {
        const cleanMessage = briefText(message ?? '', FLEET_TREE_LIMITS.maxMessageChars)
        if (cleanMessage === null) {
          return refuse(`Shorten the message to ${FLEET_TREE_LIMITS.maxMessageChars} characters or fewer.`)
        }
        fields.message = cleanMessage
      }
      return accept({ node: putNode(node, fields) })
    },

    /**
     * Re-hang a branch — inside its tree, or under a parent in another one.
     *
     * This is where the no-loop rule earns its keep. Adding always appends below
     * something that already exists, so a loop cannot be built by adding alone;
     * it takes a move, or a saved file somebody edited. Both are guarded, by the
     * same walk.
     *
     * Moving between trees was refused until 2026-08-13 on the ground that it
     * would "silently rewrite the tree of every agent under it". The measured
     * first run showed why that had to change: every agent begins as its own
     * single-node tree, so connecting two agents — the owner's stated ask — IS
     * a cross-tree move. The rewrite is now the move's explicit meaning, done
     * here in the store where the caps and the cleanup live, never implied.
     */
    moveNode(nodeId, parentId = null) {
      const node = nodes.get(nodeId)
      if (!node) return refuse('That agent is not on this computer.')
      if (parentId === node.parentId) return accept({ node })

      if (parentId == null) {
        const currentRoot = rootOf(node.treeId)
        if (currentRoot && currentRoot.id !== node.id) {
          return refuse('This tree already has a top agent. Move that one first, or pick a parent.')
        }
        return accept({ node: putNode(node, { parentId: null }) })
      }

      const parent = nodes.get(parentId)
      if (!parent) return refuse('That agent is not on this computer.')
      if (parent.id === node.id || descendantsOf(node.id).includes(parent.id)) {
        return refuse('An agent cannot report to itself or to one of its own agents. Pick another.')
      }
      /* THE SAME CAPS THE "+" BUTTONS LIVE BY. Until 2026-08-13 a move checked
         neither, so it was the one write that could build a ninth child or a
         four-level branch — shapes every other path refuses — after which
         extensionPoints() silently withdrew the person's own "+" slots. The
         branch's HEIGHT rides in the depth check because the move carries
         everything under the node. */
      if (childrenOf(parent.id).length >= TREE_BOUNDS.maxChildren) {
        return refuse(`This agent already has ${numberWord(TREE_BOUNDS.maxChildren)} agents under it. Pick another parent.`)
      }
      if (depthOf(parent) + 1 + branchHeight(node.id) > TREE_BOUNDS.maxDepth) {
        return refuse(`A tree goes ${numberWord(TREE_BOUNDS.maxDepth + 1)} levels deep at most, and this agent's own branch comes with it. Pick a parent higher up.`)
      }
      /* ACROSS TREES IS A CONNECTION, NOT AN ACCIDENT. The old contract
         refused this outright because a DRAG that silently rewrote the tree
         of everything underneath would show a person a structure they did not
         draw. But the measured first-run reality (2026-08-13) is that every
         agent starts as its own single-node tree — the top-level "+" makes
         one each — so "connect these two" IS a cross-tree move, and the owner
         asked for exactly that in words. The rewrite is now the deliberate,
         stated meaning of the move: the node and everything under it join the
         parent's tree, and a tree left empty is removed rather than kept as
         an invisible husk that blocks the one-empty-tree rule. */
      const sourceTreeId = node.treeId
      const movedIds = [node.id, ...descendantsOf(node.id)]
      for (const movedId of movedIds) {
        const moved = nodes.get(movedId)
        if (moved && moved.treeId !== parent.treeId) putNode(moved, { treeId: parent.treeId })
      }
      const result = putNode(nodes.get(node.id), { parentId })
      if (sourceTreeId !== parent.treeId && nodesOfTree(sourceTreeId).length === 0) {
        trees.delete(sourceTreeId)
      }
      return accept({ node: result })
    },

    /**
     * The drag OUT of a tree, as a verb: this node and everything under it
     * become their own tree. The owner's ask, verbatim: nodes should be
     * "dragged to its own seperate tree". The inverse of the cross-tree move
     * above, built from the same pieces — treeId restamped across the branch,
     * a source tree left empty removed rather than kept as an invisible husk
     * — and refused with createTree's own sentence at the same cap, so the
     * gesture and the button can never disagree about how many trees fit.
     */
    detachToNewTree(nodeId) {
      const node = nodes.get(nodeId)
      if (!node) return refuse('That agent is not on this computer.')
      /* Already a sole root: it IS its own tree, and inventing a fresh id for
         the same shape would churn every reference for nothing. Accepted, not
         refused — the gesture's meaning is satisfied. */
      if (node.parentId == null && nodesOfTree(node.treeId).length === 1 + descendantsOf(node.id).length) {
        return accept({ node, treeId: node.treeId, unchanged: true })
      }
      if (trees.size >= FLEET_TREE_LIMITS.maxTrees) {
        return refuse(`This computer holds ${FLEET_TREE_LIMITS.maxTrees} trees already. Remove one to add another.`)
      }
      const id = mintId('tree')
      if (id === null) return refuse('Could not make a name for this tree. Try again.')
      const stamp = now()
      trees.set(id, Object.freeze({ id, name: null, createdAt: stamp, updatedAt: stamp, profileId: null }))
      const sourceTreeId = node.treeId
      for (const movedId of [node.id, ...descendantsOf(node.id)]) {
        const moved = nodes.get(movedId)
        if (moved) putNode(moved, { treeId: id })
      }
      const result = putNode(nodes.get(node.id), { parentId: null })
      if (nodesOfTree(sourceTreeId).length === 0) trees.delete(sourceTreeId)
      return accept({ node: result, treeId: id })
    },

    /**
     * Every parent this agent could legally move under, as data — the same
     * construction extensionPoints() uses for "+" slots, and for the same
     * reason: a picker built from this list can only offer moves the store
     * will accept, so the menu and the refusal can never disagree.
     */
    movePoints(nodeId) {
      const node = nodes.get(nodeId)
      if (!node) return frozenList([])
      const blocked = new Set([node.id, ...descendantsOf(node.id)])
      const height = branchHeight(node.id)
      const points = []
      for (const candidate of nodes.values()) {
        if (blocked.has(candidate.id)) continue
        if (candidate.id === node.parentId) continue
        if (childrenOf(candidate.id).length >= TREE_BOUNDS.maxChildren) continue
        if (depthOf(candidate) + 1 + height > TREE_BOUNDS.maxDepth) continue
        points.push({ parentId: candidate.id, treeId: candidate.treeId })
      }
      return frozenList(points)
    },

    /* Removing takes the branch with it. A child whose parent is gone is the
       state the reader refuses to load, and "move the children up" would be this
       module inventing a structure the person did not draw. */
    removeNode(nodeId) {
      const node = nodes.get(nodeId)
      if (!node) return refuse('That agent is not on this computer.')
      const removedNodeIds = [nodeId, ...descendantsOf(nodeId)]
      const removedNodes = removedNodeIds.map(id => nodes.get(id)).filter(Boolean)
      for (const id of removedNodeIds) nodes.delete(id)
      return accept({ removedNodeIds: Object.freeze(removedNodeIds), removedNodes: frozenList(removedNodes) })
    },

    /**
     * Move an agent between the five states, with the sentence that goes with
     * the move.
     *
     * `note` is one plain sentence for the screen — why it stopped, what it
     * finished. It is REPLACED on every call and defaults to empty, so the
     * sentence always belongs to the state now showing. Carrying an old note
     * forward is how a running agent ends up captioned with the reason its last
     * run stopped.
     */
    setNodeStatus(nodeId, status, { note = '' } = {}) {
      const node = nodes.get(nodeId)
      if (!node) return refuse('That agent is not on this computer.')
      if (!NODE_STATUSES.includes(status)) {
        return refuse(`Pick one of these for an agent: ${NODE_STATUSES.join(', ')}.`)
      }
      const statusNote = briefText(note ?? '', FLEET_TREE_LIMITS.maxNoteChars)
      if (statusNote === null) {
        return refuse(`Keep the note to ${FLEET_TREE_LIMITS.maxNoteChars} characters or fewer.`)
      }
      if (status === 'running' && node.sessionId === null) {
        return refuse('Attach the session before marking this agent as running.')
      }
      if (status === 'draft' && node.sessionId !== null) {
        return refuse('Detach the session before turning this agent back into a draft.')
      }
      return accept({ node: putNode(node, { status, statusNote }) })
    },

    /**
     * Keep what the agent said, on the node that said it.
     *
     * Written when a turn completes, so the rail's "What it said" is still
     * there after a reload — the reply used to live only in a view-closure Map
     * and evaporated on navigation, which read as the agent never having
     * answered. Only a node that has held a session can have said anything.
     */
    setNodeReply(nodeId, reply) {
      const node = nodes.get(nodeId)
      if (!node) return refuse('That agent is not on this computer.')
      if (node.sessionId === null) return refuse('This agent has never run, so there is nothing it said to keep.')
      const text = typeof reply === 'string' ? reply.slice(0, FLEET_TREE_LIMITS.maxReplyChars) : ''
      return accept({ node: putNode(node, { reply: text }) })
    },

    /**
     * Point this agent at the session that was started for it.
     *
     * A draft is promoted to `starting` on attach, because a draft is DEFINED as
     * having no session and leaving it a draft would break the rule the rest of
     * this file relies on. Any later state is left alone: attaching is not the
     * caller's chance to overwrite a state it did not watch.
     *
     * ONE SESSION BELONGS TO ONE AGENT. Two boxes on the tree pointing at the
     * same run would each offer to stop it, and stopping it from one would leave
     * the other showing a live agent that is not.
     */
    attachSession(nodeId, sessionId) {
      const node = nodes.get(nodeId)
      if (!node) return refuse('That agent is not on this computer.')
      if (!safeIdentifier(sessionId)) return refuse('Give the session the id it was started with.')
      const holder = [...nodes.values()].find(other => other.sessionId === sessionId && other.id !== nodeId)
      if (holder) return refuse('Another agent already holds that session. Detach it there first.')
      const status = node.status === 'draft' ? 'starting' : node.status
      return accept({ node: putNode(node, { sessionId, status }) })
    },

    /**
     * Let go of the session.
     *
     * An agent that was starting or running becomes a draft again, because both
     * of those states mean "there is a session, and it is this one". Keeping the
     * state while dropping the id would leave a box on the tree claiming to be
     * running with nothing to open, stop, or read. A finished or failed agent
     * keeps its state and its note: that is history, and history does not need a
     * live session to stay true.
     */
    detachSession(nodeId) {
      const node = nodes.get(nodeId)
      if (!node) return refuse('That agent is not on this computer.')
      const demoted = LIVE_STATUSES.has(node.status)
      return accept({
        node: putNode(node, {
          sessionId: null,
          status: demoted ? 'draft' : node.status,
          statusNote: demoted ? '' : node.statusNote,
        }),
      })
    },
  })
}

/* ===================================================================
   WHAT THE ENGINE WOULD REFUSE, AND WHAT THE TAB SAYS.
   ===================================================================
 *
 * ONE STORED RECORD, ONE RENDERED SHAPE, AND THEY ARE NOT THE SAME KIND OF
 * THING. Decided above this file; written here because the distinction is what
 * every function below depends on.
 *
 * WHAT IS STORED is the record above: a flat list of agents, each naming its
 * tree and its parent, each starting as a DRAFT. The draft is not an
 * implementation convenience that a tidier record could do without — it is the
 * interaction the owner asked for. He presses an empty node, and THEN the panel
 * asks him for a role and a message. A record with no draft cannot represent
 * the moment between the press and the start, which is the only moment the
 * panel exists to fill.
 *
 * WHAT IS DRAWN is docs/design/FLEET-TREES.md section 7's shape: nodes nested
 * inside their tree, an `agent` that is null on an empty node, and three states
 * (running, finished, unknown). That document specifies what the GRAPH RENDERS,
 * and specifying that is a legitimate and separate job from saying what is
 * kept. The seven functions below answer questions about the drawing — what the
 * tab says, where a placeholder may go, what removing would cost — so they take
 * the drawn shape, and tools/test/fleet-trees-multi.test.mjs holds them to it.
 *
 * THE PROJECTION RUNS ONE WAY. treeNodesOf() turns the stored record into the
 * drawn shape and nothing turns it back. A view that wanted to change something
 * calls the store; there is no path by which a rendered node becomes state.
 *
 * WHY THE ENGINE'S NUMBERS ARE COPIED RATHER THAN IMPORTED: this module is pure
 * and the engine is not on the renderer's side of the wall.
 * tools/test/fleet-trees-multi.test.mjs parses the engine's own source and fails
 * if these drift, which is the same guard src/agent-teams.js uses for the same
 * two numbers.
 */
export const TREE_BOUNDS = Object.freeze({
  maxChildren: 8,
  maxDepth: 3,
  maxEmptyTrees: 1,
})

const NUMBER_WORDS = Object.freeze([
  'no', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
])
const numberWord = count => NUMBER_WORDS[count] ?? String(count)

/* STORE RECORD -> VIEW SHAPE. One direction, one place, and nothing maps back.
 *
 * This is the only crossing between what is kept and what is drawn. A node from
 * the store has a role, a message and a state of its own; a drawn node carries
 * an `agent` that is null when nobody has filled the placeholder in. It also
 * accepts a node that is already in the drawn shape, so the seven functions
 * below can be called on a hand-built tree — a test fixture, or a tree a view
 * assembled itself — without every one of them repeating the check.
 *
 *   draft, nothing typed       -> agent is null. It is an empty node.
 *   draft, something typed     -> agent, state `unknown`.
 *   starting, running          -> state `running`
 *   finished, failed           -> state `finished`
 *
 * THE SECOND ROW LOOKS LOSSY AND IS NOT, so do not "repair" it by adding a
 * fourth state to the drawn shape. `draft` is never lost: it lives in the
 * stored record, which is the authoritative one, and flattens only on the way
 * to the pixels because the drawing has one question to answer about a node the
 * person has typed into but not started — is it live? — and the honest answer
 * is that it is not. Adding `draft` to the drawn vocabulary would put a second
 * copy of a state word in a shape that cannot be written back to, and the copy
 * that drifts is the one on the screen.
 *
 * Nothing here ever reports `running` for a state it did not read as running. */
function treeNodesOf(tree) {
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes : []
  return nodes.map(node => {
    if (node && Object.prototype.hasOwnProperty.call(node, 'agent')) {
      return { id: node.id, parentId: node.parentId ?? null, agent: node.agent || null }
    }
    const started = node?.status && node.status !== 'draft'
    const typed = Boolean(node?.role) || Boolean(node?.message)
    if (!started && !typed) return { id: node?.id, parentId: node?.parentId ?? null, agent: null }
    const state = LIVE_STATUSES.has(node?.status)
      ? 'running'
      : (node?.status === 'finished' || node?.status === 'failed' ? 'finished' : 'unknown')
    return {
      id: node?.id,
      parentId: node?.parentId ?? null,
      agent: { role: node?.role || '', message: node?.message || '', launchId: node?.sessionId ?? null, kind: null, state },
    }
  })
}

/**
 * One tree from this module's own record, in the shape section 7 describes.
 *
 * The bridge is a function rather than a second copy of the state, so there is
 * no moment where the two records can disagree about the same tree.
 */
export function treeRecord(snapshot, treeId) {
  const tree = (snapshot?.trees || []).find(entry => entry.id === treeId)
  if (!tree) return null
  return Object.freeze({
    id: tree.id,
    computerId: snapshot.computerId,
    name: tree.name || null,
    /* THERE IS NO `folder` HERE, AND ITS ABSENCE IS THE POINT. No tree owns a
       working folder and the product has nowhere to put one: shell/main.cjs
       parseAgentStart() takes an optional cwd and not one caller in src/ passes
       it, so every agent started from this page runs in the same shared
       workspace root. Measured and recorded in docs/design/FLEET-TREES.md
       section 8. Do not add the field back as an empty one — a folder a person
       chose and nothing acted on is worse than the shared folder they have,
       because it reads as a promise of separation. */
    nodes: frozenList((snapshot.nodes || []).filter(node => node.treeId === treeId).map(node => ({ ...node }))),
  })
}

/**
 * The words on a tree's tab.
 *
 * Never an id, in any branch. A tab is read by a person and a tree id means
 * nothing outside this program, so the fallbacks are the name they gave it, then
 * the first thing they asked an agent to do, then a plain default — and never
 * the machine field sitting right there.
 */
export function displayName(tree) {
  const named = typeof tree?.name === 'string' ? tree.name.trim() : ''
  if (named) return named
  for (const node of treeNodesOf(tree)) {
    const message = typeof node.agent?.message === 'string' ? node.agent.message : ''
    const firstLine = message.split('\n')[0].replace(/\s+/g, ' ').trim()
    if (!firstLine) continue
    return firstLine.length <= 48 ? firstLine : `${firstLine.slice(0, 47).trimEnd()}…`
  }
  return 'New tree'
}

/**
 * Empty, running, or finished.
 *
 * A tree just read off disk can never answer `running` here, and that is not a
 * second guard — it is the demotion in parseFleetTrees() seen from downstream,
 * where the argument for it is written. This function is only ever as honest as
 * the states it is handed.
 */
export function treeStatus(tree) {
  const nodes = treeNodesOf(tree)
  const agents = nodes.filter(node => node.agent)
  if (agents.length === 0) return 'empty'
  return agents.some(node => node.agent.state === 'running') ? 'running' : 'finished'
}

/**
 * May another tree be started on this computer?
 *
 * ONE EMPTY TREE AT A TIME. A second tree with nothing in it is not a second
 * structure, it is the same blank page twice, and the person who pressed the
 * button is now looking at two identical tabs wondering which one they were
 * using. The refusal therefore points at the empty one they already have, by
 * name, and hands back its id in `switchTo` for the view to act on — the id
 * travels in a field, never in the sentence.
 */
export function planTreeAdd(trees) {
  const list = Array.isArray(trees) ? trees : []
  const empty = list.find(tree => treeStatus(tree) === 'empty')
  if (empty) {
    return Object.freeze({
      allowed: false,
      switchTo: empty.id ?? null,
      reason: `You already have an empty tree called “${displayName(empty)}”. Open it and press one of its empty nodes.`,
    })
  }
  return Object.freeze({
    allowed: true,
    switchTo: null,
    reason: list.length === 0
      ? 'This computer has no trees yet, so this one starts your first.'
      : 'Every tree here has work in it, so this one starts a new structure.',
  })
}

/**
 * May an empty node be offered in this position?
 *
 * A placeholder the engine would refuse is worse than no placeholder: the person
 * presses it, fills in a brief, and is told no by something they cannot see. The
 * two numbers are the engine's own, and both count EMPTY nodes as well as
 * started ones, because the position is what is being claimed.
 */
export function planNodeAdd(tree, parentNodeId = null) {
  const nodes = treeNodesOf(tree)
  if (parentNodeId == null) {
    const hasTop = nodes.some(node => node.parentId == null)
    return hasTop
      ? Object.freeze({ allowed: false, reason: 'This tree already has a top agent. Add the next one under an agent that is there.' })
      : Object.freeze({ allowed: true, reason: 'You can start this tree with a top agent.' })
  }

  const parent = nodes.find(node => node.id === parentNodeId)
  if (!parent) {
    return Object.freeze({ allowed: false, reason: 'That agent is not in this tree. Pick one that is drawn here.' })
  }

  const children = nodes.filter(node => node.parentId === parentNodeId).length
  if (children >= TREE_BOUNDS.maxChildren) {
    return Object.freeze({
      allowed: false,
      reason: `This agent already has ${numberWord(TREE_BOUNDS.maxChildren)} agents under it. Add the next one somewhere else.`,
    })
  }

  let depth = 0
  let current = parent
  const seen = new Set()
  while (current && current.parentId != null && !seen.has(current.id)) {
    seen.add(current.id)
    current = nodes.find(node => node.id === current.parentId)
    depth += 1
  }
  if (depth + 1 > TREE_BOUNDS.maxDepth) {
    return Object.freeze({
      allowed: false,
      reason: `A tree goes ${numberWord(TREE_BOUNDS.maxDepth + 1)} levels deep at most. Add the next agent higher up.`,
    })
  }
  return Object.freeze({ allowed: true, reason: 'You can add an agent here.' })
}

/**
 * What removing this tree would cost, said before it happens.
 *
 * The count is the point. "This will stop your agents" is a warning a person
 * skims; "this stops three agents that are still working" is a number they can
 * weigh, and it is the difference between an undo they wanted and one they did
 * not.
 */
export function planTreeRemove(tree) {
  const running = treeNodesOf(tree).filter(node => node.agent?.state === 'running').length
  const name = displayName(tree)
  if (running === 0) {
    return Object.freeze({
      stopsFirst: false,
      running: 0,
      sentence: `Nothing is running in “${name}”. Removing it takes its agents and their messages with it.`,
    })
  }
  return Object.freeze({
    stopsFirst: true,
    running,
    sentence: `Removing “${name}” stops ${numberWord(running)} ${running === 1 ? 'agent' : 'agents'} that ${running === 1 ? 'is' : 'are'} still working. Stop them and remove it?`,
  })
}

/**
 * Who is holding the agents, when there are none left to start.
 *
 * This is the second line under the shipped seat refusal, and the whole reason
 * more than one tree needs its own sentence: the first line says every agent is
 * busy, and a person with two trees open immediately asks which one has them.
 * Trees are NAMED here and never identified — an id in this sentence would be
 * the program talking to itself in front of somebody.
 *
 * When nothing can be attributed, it says that instead of guessing. A wrong name
 * here sends a person to stop the wrong work.
 */
export function seatShortageSentence({ trees = [], currentTreeId = null } = {}) {
  const holders = (Array.isArray(trees) ? trees : [])
    .map(tree => ({ tree, running: treeNodesOf(tree).filter(node => node.agent?.state === 'running').length }))
    .filter(entry => entry.running > 0)

  if (holders.length === 0) {
    return 'This app did not start them, so it cannot say what has them. Wait, or stop one from the list below.'
  }
  const others = holders.filter(entry => entry.tree.id !== currentTreeId)
  if (others.length === 0) {
    return 'This tree is already holding every agent this computer can run.'
  }
  const named = others.slice(0, 3)
  const parts = named.map(entry => `“${displayName(entry.tree)}” has ${numberWord(entry.running)}`)
  const rest = others.length - named.length
  const tail = rest > 0 ? `, and ${numberWord(rest)} more` : ''
  return `${numberWord(others.length)} other ${others.length === 1 ? 'tree is' : 'trees are'} holding them: ${parts.join(', ')}${tail}.`
}
