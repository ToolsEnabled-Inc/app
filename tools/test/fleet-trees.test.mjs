// The rules behind the trees a person builds by pressing empty placeholders.
//
// Three of these assertions are the ones worth reading twice, because they are
// the ones a future change is most likely to break while everything still looks
// right on screen:
//
//   1. A new store on a fresh computer holds NOTHING. The owner's first
//      sentence about this surface is that the tree is empty until he has
//      started something, and seed data is the kind of helpfulness that shows a
//      person a structure they did not build.
//   2. Saved state that is broken in any way reads back as NO trees, never as
//      the readable half. A dropped parent silently promotes a child to the top
//      of a tree, which is a structure nobody drew being shown as one they did.
//   3. A node is a DRAFT before any session exists, and running means there IS
//      a session id. Those two facts are what every screen reading this state
//      acts on.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  EMPTY_FLEET_TREES,
  FLEET_TREES_RECORD_VERSION,
  FLEET_TREE_LIMITS,
  NODE_STATUSES,
  TREE_BOUNDS,
  createFleetTreeStore,
  displayName,
  fleetTreesStorageKey,
  parseFleetTrees,
  planNodeAdd,
  planTreeAdd,
  planTreeRemove,
  safeTreeStorage,
  seatShortageSentence,
  treeRecord,
  treeStatus,
} from '../../src/fleet-trees.js'

const COMPUTER = 'c1'

/* A storage seam with no disk behind it. This is the whole point of the seam:
   every rule below is exercised without a browser, a file, or a temp folder. */
function memoryStorage(seed = new Map()) {
  const cells = new Map(seed)
  return {
    cells,
    read(key) { return cells.has(key) ? JSON.parse(cells.get(key)) : null },
    write(key, value) { cells.set(key, JSON.stringify(value)); return true },
  }
}

const failingStorage = () => ({ read: () => null, write: () => false })

function stamps() {
  let tick = 0
  return () => {
    tick += 1
    return `2026-08-12T00:00:${String(tick).padStart(2, '0')}.000Z`
  }
}

function counterIds() {
  let count = 0
  return kind => {
    count += 1
    return `${kind}-${count}`
  }
}

const storeOf = (overrides = {}) => createFleetTreeStore({
  computerId: COMPUTER,
  storage: memoryStorage(),
  now: stamps(),
  makeId: counterIds(),
  ...overrides,
})

function record(overrides = {}) {
  return {
    version: FLEET_TREES_RECORD_VERSION,
    computerId: COMPUTER,
    trees: [{ id: 'tree-1', name: 'Front desk', createdAt: 'a', updatedAt: 'a' }],
    nodes: [{
      id: 'node-1', treeId: 'tree-1', parentId: null, role: 'planner', message: 'plan it',
      status: 'draft', statusNote: '', sessionId: null, createdAt: 'a', updatedAt: 'a',
    }],
    ...overrides,
  }
}

/* --------------------------------------------------------------- constants */

test('the storage key names the computer the trees belong to', () => {
  assert.notEqual(fleetTreesStorageKey('c1'), fleetTreesStorageKey('c2'))
  assert.ok(fleetTreesStorageKey('c1').includes('c1'))
})

test('the six states are fixed and frozen', () => {
  /* 'turn-failed' joined 2026-08-19: a TURN that ended badly on a session that
     really ran, distinct from 'failed' (a START that never happened) so the
     chip cannot un-say a start the signed record shows. */
  assert.deepEqual([...NODE_STATUSES], ['draft', 'starting', 'running', 'finished', 'failed', 'turn-failed'])
  assert.ok(Object.isFrozen(NODE_STATUSES))
  assert.ok(Object.isFrozen(FLEET_TREE_LIMITS))
  assert.equal(FLEET_TREES_RECORD_VERSION, 1)
})

test('empty means empty, and cannot be edited by a caller', () => {
  assert.equal(EMPTY_FLEET_TREES.trees.length, 0)
  assert.equal(EMPTY_FLEET_TREES.nodes.length, 0)
  assert.equal(EMPTY_FLEET_TREES.computerId, null)
  assert.ok(Object.isFrozen(EMPTY_FLEET_TREES))
  assert.throws(() => { EMPTY_FLEET_TREES.trees.push({}) })
})

/* ----------------------------------------------------------- storage seam */

test('the storage face survives a backing that throws', () => {
  const throwing = safeTreeStorage({
    getItem() { throw new Error('private mode') },
    setItem() { throw new Error('quota') },
  })
  assert.equal(throwing.read('k'), null)
  assert.equal(throwing.write('k', { a: 1 }), false)

  const cells = new Map()
  const working = safeTreeStorage({
    getItem: key => (cells.has(key) ? cells.get(key) : null),
    setItem: (key, value) => cells.set(key, value),
  })
  assert.equal(working.read('k'), null)
  assert.equal(working.write('k', { a: 1 }), true)
  assert.deepEqual(working.read('k'), { a: 1 })

  cells.set('bad', '{not json')
  assert.equal(working.read('bad'), null)
})

/* ------------------------------------------------------- reading saved state */

test('a good record reads back whole, from an object or from text', () => {
  const fromObject = parseFleetTrees(record(), { computerId: COMPUTER })
  assert.equal(fromObject.trees.length, 1)
  assert.equal(fromObject.nodes[0].status, 'draft')
  assert.ok(Object.isFrozen(fromObject.nodes[0]))

  const fromText = parseFleetTrees(JSON.stringify(record()), { computerId: COMPUTER })
  assert.deepEqual(fromText.nodes, fromObject.nodes)
})

test('anything unreadable means no trees at all', () => {
  const cases = [
    ['nothing saved', null],
    ['not an object', 42],
    ['a list', []],
    ['text that is not data', '{oh no'],
    ['a version this build does not write', record({ version: 99 })],
    ['no computer named', record({ computerId: null })],
    ['a tree with no name', record({ trees: [{ id: 'tree-1', name: '  ', createdAt: 'a', updatedAt: 'a' }] })],
    ['a tree with no time on it', record({ trees: [{ id: 'tree-1', name: 'x', createdAt: '', updatedAt: 'a' }] })],
  ]
  for (const [why, value] of cases) {
    assert.equal(parseFleetTrees(value, { computerId: COMPUTER }), EMPTY_FLEET_TREES, why)
  }
})

test('a record from another computer is not adopted', () => {
  assert.equal(parseFleetTrees(record({ computerId: 'c2' }), { computerId: COMPUTER }), EMPTY_FLEET_TREES)
  assert.equal(parseFleetTrees(record({ computerId: 'c2' })).computerId, 'c2')
})

test('one broken agent throws away the whole file, never half of it', () => {
  const orphan = record({
    nodes: [
      { id: 'node-1', treeId: 'tree-1', parentId: null, role: '', message: '', status: 'draft', statusNote: '', sessionId: null, createdAt: 'a', updatedAt: 'a' },
      { id: 'node-2', treeId: 'tree-1', parentId: 'node-gone', role: '', message: '', status: 'draft', statusNote: '', sessionId: null, createdAt: 'a', updatedAt: 'a' },
    ],
  })
  // The readable half is one perfectly good top agent. It is still refused.
  assert.equal(parseFleetTrees(orphan, { computerId: COMPUTER }), EMPTY_FLEET_TREES)
})

test('the invariants are checked on the way in', () => {
  const node = extra => ({
    id: 'node-1', treeId: 'tree-1', parentId: null, role: '', message: '',
    status: 'draft', statusNote: '', sessionId: null, createdAt: 'a', updatedAt: 'a', ...extra,
  })
  const second = extra => node({ id: 'node-2', ...extra })
  const trees = [
    { id: 'tree-1', name: 'One', createdAt: 'a', updatedAt: 'a' },
    { id: 'tree-2', name: 'Two', createdAt: 'a', updatedAt: 'a' },
  ]
  const cases = [
    ['an id used twice', record({ nodes: [node(), node()] })],
    ['a tree and an agent sharing an id', record({ nodes: [node({ id: 'tree-1' })] })],
    ['an agent in a tree that is not there', record({ nodes: [node({ treeId: 'tree-9' })] })],
    ['two tops in one tree', record({ nodes: [node(), second()] })],
    ['a parent in another tree', record({
      trees,
      nodes: [node(), second({ treeId: 'tree-2', parentId: 'node-1' })],
    })],
    ['a loop', record({ nodes: [node({ parentId: 'node-2' }), second({ parentId: 'node-1' })] })],
    ['running with no session', record({ nodes: [node({ status: 'running' })] })],
    ['a draft holding a session', record({ nodes: [node({ sessionId: 'run-1' })] })],
    ['two agents on one session', record({
      nodes: [node({ status: 'finished', sessionId: 'run-1' }), second({ status: 'finished', sessionId: 'run-1' })],
    })],
    ['a state this build does not know', record({ nodes: [node({ status: 'paused' })] })],
  ]
  for (const [why, value] of cases) {
    assert.equal(parseFleetTrees(value, { computerId: COMPUTER }), EMPTY_FLEET_TREES, why)
  }
})

/* ---------------------------------------------------------------- the store */

test('a store cannot be built without a computer and a place to save', () => {
  assert.throws(() => createFleetTreeStore({ storage: memoryStorage() }), TypeError)
  assert.throws(() => createFleetTreeStore({ computerId: COMPUTER }), TypeError)
  assert.throws(() => createFleetTreeStore({ computerId: 'not an id!', storage: memoryStorage() }), TypeError)
})

test('a fresh computer holds nothing at all', () => {
  const store = storeOf()
  assert.deepEqual([...store.listTrees()], [])
  assert.deepEqual([...store.snapshot().nodes], [])
  assert.equal(store.snapshot().computerId, COMPUTER)
})

test('trees are made, renamed and removed by name', () => {
  const store = storeOf()
  const made = store.createTree({ name: 'Support' })
  assert.equal(made.ok, true)
  assert.equal(store.getTree(made.tree.id).name, 'Support')
  assert.equal(store.listTrees().length, 1)

  // One empty tree at a time. A second blank page is not a second structure.
  const tooSoon = store.createTree({ name: 'Research' })
  assert.equal(tooSoon.ok, false)
  assert.ok(tooSoon.problems.join(' ').includes('Support'), 'the refusal names the one they already have')
  store.addNode({ treeId: made.tree.id, role: 'manager', message: 'Ship the installer' })

  const unnamed = store.createTree({})
  assert.equal(unnamed.ok, true, 'a tree nobody has typed into yet has no name of its own')
  assert.equal(unnamed.tree.name, null)
  assert.equal(store.removeTree(unnamed.tree.id).ok, true)
  assert.equal(store.createTree({ name: 'x'.repeat(FLEET_TREE_LIMITS.maxNameChars + 1) }).ok, false)

  assert.equal(store.renameTree(made.tree.id, 'Support desk').ok, true)
  assert.equal(store.getTree(made.tree.id).name, 'Support desk')
  assert.equal(store.renameTree(made.tree.id, '  ').ok, true, 'clearing a name goes back to the derived one')
  assert.equal(store.getTree(made.tree.id).name, null)
  store.renameTree(made.tree.id, 'Support desk')
  assert.equal(store.renameTree('tree-nope', 'x').ok, false)

  const second = store.createTree({ name: 'Research' })
  assert.equal(second.ok, true)
  assert.equal(store.listTrees().length, 2, 'one computer may hold more than one tree')

  const removed = store.removeTree(second.tree.id)
  assert.equal(removed.ok, true)
  assert.equal(store.getTree(second.tree.id), null)
  assert.equal(store.removeTree(second.tree.id).ok, false)
})

test('a new agent is a draft with no session, wherever it was added', () => {
  const store = storeOf()
  const first = store.addNode({ role: 'planner', message: 'sketch the release' })
  assert.equal(first.ok, true)
  assert.equal(first.node.status, 'draft')
  assert.equal(first.node.sessionId, null)
  assert.equal(first.node.parentId, null)
  assert.equal(store.getTree(first.node.treeId).name, null, 'nothing is named on the person\'s behalf')
  assert.equal(store.treeLabel(first.node.treeId), 'sketch the release', 'the first message is the name')

  // The owner's flow: press the placeholder first, fill the panel in second.
  const blank = store.addNode({ parentId: first.node.id })
  assert.equal(blank.node.role, '')
  assert.equal(blank.node.message, '')
  assert.equal(blank.node.status, 'draft')
  assert.equal(blank.node.treeId, first.node.treeId)
})

test('an agent is added under a parent, at the top of a tree, or in a new one', () => {
  const store = storeOf()
  const tree = store.createTree({ name: 'Ops' })
  const top = store.addNode({ treeId: tree.tree.id, role: 'manager' })
  assert.equal(top.node.parentId, null)
  assert.equal(store.rootOf(tree.tree.id).id, top.node.id)

  const child = store.addNode({ parentId: top.node.id, role: 'worker' })
  assert.equal(child.node.parentId, top.node.id)
  assert.equal(store.childrenOf(top.node.id).length, 1)
  assert.equal(store.listNodes(tree.tree.id).length, 2)
  assert.equal(store.getNode(child.node.id).role, 'worker')

  assert.equal(store.addNode({ treeId: tree.tree.id }).ok, false, 'a tree has one top agent')
  assert.equal(store.addNode({ treeId: 'tree-nope' }).ok, false)
  assert.equal(store.addNode({ parentId: 'node-nope' }).ok, false)

  const other = store.createTree({ name: 'Other' })
  assert.equal(store.addNode({ treeId: other.tree.id, parentId: top.node.id }).ok, false, 'a parent and a tree that disagree')
  assert.equal(store.addNode({ role: 'x'.repeat(FLEET_TREE_LIMITS.maxRoleChars + 1) }).ok, false)
  assert.equal(store.addNode({ message: 'x'.repeat(FLEET_TREE_LIMITS.maxMessageChars + 1) }).ok, false)
})

test('the placeholders offered are the places an agent may actually go', () => {
  const store = storeOf()
  assert.deepEqual([...store.extensionPoints()], [{ kind: 'tree', treeId: null, parentId: null }])

  const tree = store.createTree({ name: 'Ops' })
  const points = store.extensionPoints()
  assert.ok(points.some(point => point.kind === 'root' && point.treeId === tree.tree.id))

  const top = store.addNode({ treeId: tree.tree.id })
  const after = store.extensionPoints()
  assert.equal(after.some(point => point.kind === 'root'), false, 'the top is taken')
  assert.ok(after.some(point => point.kind === 'child' && point.parentId === top.node.id))
  // Every offered slot is one addNode accepts.
  for (const point of after.filter(entry => entry.kind !== 'tree')) {
    assert.equal(store.addNode({ treeId: point.treeId, parentId: point.parentId }).ok, true)
  }
})

test('the role and the message are editable only while it is a draft', () => {
  const store = storeOf()
  const node = store.addNode({}).node
  assert.equal(store.updateNode(node.id, { role: 'reviewer', message: 'read the diff' }).ok, true)
  assert.equal(store.getNode(node.id).role, 'reviewer')
  assert.equal(store.getNode(node.id).message, 'read the diff')
  assert.equal(store.updateNode(node.id, { message: 'a line\nand another' }).ok, true, 'a brief may have paragraphs')
  assert.equal(store.updateNode(node.id, { role: 'two\nlines' }).ok, false, 'a role is one line')
  assert.equal(store.updateNode('node-nope', { role: 'x' }).ok, false)

  store.attachSession(node.id, 'run-1')
  const refused = store.updateNode(node.id, { message: 'changed my mind' })
  assert.equal(refused.ok, false)
  assert.equal(store.getNode(node.id).message, 'a line\nand another', 'what was sent stays what was sent')
})

test('a branch moves inside its tree and never into itself', () => {
  const store = storeOf()
  const top = store.addNode({ role: 'top' }).node
  const middle = store.addNode({ parentId: top.id, role: 'middle' }).node
  const leaf = store.addNode({ parentId: middle.id, role: 'leaf' }).node

  assert.equal(store.moveNode(leaf.id, top.id).ok, true)
  assert.equal(store.getNode(leaf.id).parentId, top.id)
  assert.equal(store.moveNode(leaf.id, top.id).ok, true, 'moving where it already is changes nothing')

  assert.equal(store.moveNode(top.id, top.id).ok, false)
  assert.equal(store.moveNode(top.id, middle.id).ok, false, 'a loop')
  assert.equal(store.moveNode(top.id, null).ok, true, 'it is already the top')
  assert.equal(store.moveNode(middle.id, null).ok, false, 'the top is taken')
  assert.equal(store.moveNode('node-nope', top.id).ok, false)
  assert.equal(store.moveNode(leaf.id, 'node-nope').ok, false)

  /* ACROSS TREES IS A CONNECTION. Every agent starts as its own single-node
     tree, so "connect these two" is a cross-tree move — supported since
     2026-08-13 as a deliberate adoption: the branch joins the parent's tree,
     and a tree left empty is removed instead of lingering as a husk. */
  const elsewhere = store.addNode({ role: 'other tree' }).node
  const treesBefore = store.listTrees().length
  const adopted = store.moveNode(leaf.id, elsewhere.id)
  assert.equal(adopted.ok, true, 'a cross-tree move is a connection, not an accident')
  assert.equal(adopted.node.treeId, elsewhere.treeId, 'the moved agent joins the parent\'s tree')
  assert.equal(store.getNode(leaf.id).parentId, elsewhere.id)
  assert.equal(store.listTrees().length, treesBefore, 'the source tree survives while it still holds agents')
  // Moving the LAST agent out of a tree removes the emptied tree.
  const lonely = store.addNode({ role: 'lonely tree' }).node
  const treesWithLonely = store.listTrees().length
  assert.equal(store.moveNode(lonely.id, elsewhere.id).ok, true)
  assert.equal(store.getNode(lonely.id).treeId, elsewhere.treeId)
  assert.equal(store.listTrees().length, treesWithLonely - 1, 'an emptied tree is removed, not kept as a husk')

  // Whatever the moves, the saved shape still reads back.
  assert.notEqual(parseFleetTrees(store.snapshot().nodes.length ? recordFrom(store) : null, { computerId: COMPUTER }), EMPTY_FLEET_TREES)
})

test('a move answers to the same caps the placeholders draw by, and movePoints only offers what moveNode accepts', () => {
  /* Until 2026-08-13 moveNode checked neither cap, so it was the one write
     that could build a ninth child or a four-level branch — shapes every "+"
     refuses by construction — after which extensionPoints() silently withdrew
     the person's own placeholders. These are the missing halves. */
  const store = storeOf()
  const top = store.addNode({ role: 'top' }).node
  const children = []
  for (let i = 0; i < TREE_BOUNDS.maxChildren; i += 1) {
    children.push(store.addNode({ parentId: top.id, role: `child ${i}` }).node)
  }
  const spare = store.addNode({ parentId: children[0].id, role: 'spare' }).node

  // Fan-out: the ninth child a "+" refuses cannot arrive by move, or by offer.
  assert.equal(store.moveNode(spare.id, top.id).ok, false, 'a move must not build the ninth child')
  assert.equal(store.movePoints(spare.id).some(point => point.parentId === top.id), false, 'a full parent is never offered')

  // Depth: the branch's HEIGHT rides in the check, not the one node's.
  const deep = store.addNode({ parentId: children[1].id, role: 'deep' }).node
  const deepest = store.addNode({ parentId: deep.id, role: 'deepest' }).node
  assert.equal(store.moveNode(spare.id, deepest.id).ok, false, 'past the depth cap')
  const b1 = store.addNode({ parentId: children[2].id, role: 'b1' }).node
  store.addNode({ parentId: b1.id, role: 'b2' })
  assert.equal(store.moveNode(b1.id, deep.id).ok, false, 'the branch under the moved node comes with it')
  assert.equal(store.movePoints(b1.id).some(point => point.parentId === deep.id), false)

  // The offer list and the write agree: an offered move is an accepted move.
  const offers = store.movePoints(spare.id)
  assert.ok(offers.length > 0, 'a movable node has somewhere to go')
  assert.equal(store.moveNode(spare.id, offers[0].parentId).ok, true)

  // What a node carries survives its move: the session, the status, the reply.
  store.attachSession(spare.id, 'run-move')
  store.setNodeReply(spare.id, 'kept')
  const before = store.getNode(spare.id)
  const target = store.movePoints(spare.id)[0]
  assert.ok(target)
  const moved = store.moveNode(spare.id, target.parentId)
  assert.equal(moved.ok, true)
  assert.equal(moved.node.sessionId, 'run-move')
  assert.equal(moved.node.reply, 'kept')
  assert.equal(moved.node.status, before.status)
})

function recordFrom(store) {
  const current = store.snapshot()
  return {
    version: FLEET_TREES_RECORD_VERSION,
    computerId: current.computerId,
    trees: current.trees.map(tree => ({ ...tree })),
    nodes: current.nodes.map(node => ({ ...node })),
  }
}

test('removing takes the branch with it, and a tree takes its agents', () => {
  const store = storeOf()
  const top = store.addNode({ role: 'top' }).node
  const middle = store.addNode({ parentId: top.id }).node
  const leaf = store.addNode({ parentId: middle.id }).node

  const removed = store.removeNode(middle.id)
  assert.equal(removed.ok, true)
  assert.deepEqual([...removed.removedNodeIds].sort(), [leaf.id, middle.id].sort())
  assert.equal(store.getNode(leaf.id), null)
  assert.equal(store.getNode(top.id).id, top.id)
  assert.equal(store.removeNode(middle.id).ok, false)

  const treeId = top.treeId
  const gone = store.removeTree(treeId)
  assert.deepEqual([...gone.removedNodeIds], [top.id])
  assert.equal(store.listNodes(treeId).length, 0)
})

test('running means there is a session, and draft means there is not', () => {
  const store = storeOf()
  const node = store.addNode({ role: 'worker' }).node

  assert.equal(store.setNodeStatus(node.id, 'running').ok, false, 'no session to point at')
  assert.equal(store.setNodeStatus(node.id, 'nonsense').ok, false)
  assert.equal(store.setNodeStatus('node-nope', 'failed').ok, false)
  assert.equal(store.setNodeStatus(node.id, 'starting').ok, true, 'a launch was asked for; the id has not come back')

  assert.equal(store.attachSession(node.id, 'run-1').ok, true)
  assert.equal(store.setNodeStatus(node.id, 'running').ok, true)
  assert.equal(store.setNodeStatus(node.id, 'draft').ok, false, 'a draft cannot hold a session')

  const failed = store.setNodeStatus(node.id, 'failed', { note: 'It stopped before the first check.' })
  assert.equal(failed.ok, true)
  assert.equal(store.getNode(node.id).statusNote, 'It stopped before the first check.')
  assert.equal(store.setNodeStatus(node.id, 'failed', { note: 'x'.repeat(FLEET_TREE_LIMITS.maxNoteChars + 1) }).ok, false)

  store.setNodeStatus(node.id, 'finished')
  assert.equal(store.getNode(node.id).statusNote, '', 'the note belongs to the state now showing')
})

test('a session belongs to one agent, and letting go of it says so', () => {
  const store = storeOf()
  const first = store.addNode({ role: 'one' }).node
  const second = store.addNode({ parentId: first.id, role: 'two' }).node

  const attached = store.attachSession(first.id, 'run-1')
  assert.equal(attached.ok, true)
  assert.equal(attached.node.sessionId, 'run-1')
  assert.equal(attached.node.status, 'starting', 'a draft cannot stay a draft with a session on it')

  assert.equal(store.attachSession(second.id, 'run-1').ok, false, 'two boxes, one run')
  assert.equal(store.attachSession(first.id, '').ok, false)
  assert.equal(store.attachSession('node-nope', 'run-2').ok, false)

  store.setNodeStatus(first.id, 'running')
  const detached = store.detachSession(first.id)
  assert.equal(detached.node.sessionId, null)
  assert.equal(detached.node.status, 'draft', 'nothing to open, stop or read')

  store.attachSession(second.id, 'run-1')
  store.setNodeStatus(second.id, 'running')
  store.setNodeStatus(second.id, 'finished', { note: 'It answered.' })
  const ended = store.detachSession(second.id)
  assert.equal(ended.node.status, 'finished', 'history does not need a live session')
  assert.equal(ended.node.statusNote, 'It answered.')
  assert.equal(store.detachSession('node-nope').ok, false)
})

test('ids are unique on this computer, and a generator that repeats is refused', () => {
  const store = storeOf({ makeId: () => 'same-id' })
  assert.equal(store.createTree({ name: 'One' }).ok, true)
  const clash = store.createTree({ name: 'Two' })
  assert.equal(clash.ok, false)
  assert.equal(store.listTrees().length, 1)

  const honest = storeOf()
  const a = honest.addNode({ role: 'a' }).node
  const b = honest.addNode({ role: 'b' }).node
  assert.notEqual(a.id, b.id)
  assert.notEqual(a.treeId, a.id)
})

test('the structure is saved on the same beat and read back next launch', () => {
  const storage = memoryStorage()
  const first = createFleetTreeStore({ computerId: COMPUTER, storage, now: stamps(), makeId: counterIds() })
  const top = first.addNode({ role: 'manager', message: 'run the release' }).node
  first.addNode({ parentId: top.id, role: 'worker' })
  assert.equal(first.snapshot().persistenceFailed, false)

  const next = createFleetTreeStore({ computerId: COMPUTER, storage, now: stamps(), makeId: counterIds() })
  assert.equal(next.listTrees().length, 1)
  assert.equal(next.listNodes(top.treeId).length, 2)
  assert.equal(next.getNode(top.id).message, 'run the release')

  // The same storage under a different computer is not this computer's work.
  const stranger = createFleetTreeStore({ computerId: 'c2', storage, now: stamps(), makeId: counterIds() })
  assert.equal(stranger.listTrees().length, 0)

  // Damaged storage is reported, not hidden, and never guessed at.
  storage.cells.set(fleetTreesStorageKey(COMPUTER), '{half a file')
  const recovered = createFleetTreeStore({ computerId: COMPUTER, storage, now: stamps(), makeId: counterIds() })
  assert.equal(recovered.listTrees().length, 0)
})

test('a save that does not land is reported on every snapshot', () => {
  const store = createFleetTreeStore({
    computerId: COMPUTER, storage: failingStorage(), now: stamps(), makeId: counterIds(),
  })
  const added = store.addNode({ role: 'worker' })
  assert.equal(added.ok, true, 'the work is still on screen')
  assert.equal(added.snapshot.persistenceFailed, true)
  assert.equal(store.snapshot().persistenceFailed, true)
})

test('listeners hear every change, and can stop listening', () => {
  const seen = []
  const built = []
  const store = storeOf({ onChange: current => built.push(current.nodes.length) })
  const stop = store.subscribe(current => seen.push(current.nodes.length))
  assert.equal(typeof store.subscribe('not a function'), 'function')

  const node = store.addNode({ role: 'a' }).node
  store.addNode({ parentId: node.id, role: 'b' })
  assert.deepEqual(seen, [1, 2])
  assert.deepEqual(built, [1, 2])

  stop()
  store.addNode({ parentId: node.id, role: 'c' })
  assert.deepEqual(seen, [1, 2], 'a listener that stopped is not called again')
  assert.deepEqual(built, [1, 2, 3])
})

test('nothing comes back off disk running', () => {
  const storage = memoryStorage()
  const first = createFleetTreeStore({ computerId: COMPUTER, storage, now: stamps(), makeId: counterIds() })
  const node = first.addNode({ role: 'worker' }).node
  first.attachSession(node.id, 'run-1')
  first.setNodeStatus(node.id, 'running')

  const reopened = createFleetTreeStore({ computerId: COMPUTER, storage, now: stamps(), makeId: counterIds() })
  const back = reopened.getNode(node.id)
  assert.notEqual(back.status, 'running', 'a session cannot outlive the window that started it')
  assert.equal(back.status, 'starting', 'asked for, and not yet answered for')
  assert.equal(back.sessionId, 'run-1', 'the id is the only handle anything has for asking')
})

test('removing hands back the agents, not only their names', () => {
  const store = storeOf()
  const node = store.addNode({ role: 'worker' }).node
  store.attachSession(node.id, 'run-1')
  const removal = store.removeTree(node.treeId)
  assert.ok(removal.removedNodes.some(entry => entry.sessionId === 'run-1'),
    'nothing could stop a run that was removed with only its id handed back')

  const second = storeOf()
  const top = second.addNode({ role: 'top' }).node
  const child = second.addNode({ parentId: top.id }).node
  second.attachSession(child.id, 'run-2')
  const cut = second.removeNode(top.id)
  assert.ok(cut.removedNodes.some(entry => entry.sessionId === 'run-2'))
})

test('no placeholder is offered where the engine would refuse the agent', () => {
  const store = storeOf()
  const top = store.addNode({ role: 'top' }).node
  for (let index = 0; index < TREE_BOUNDS.maxChildren; index += 1) {
    assert.equal(store.addNode({ parentId: top.id }).ok, true, `child ${index + 1}`)
  }
  assert.deepEqual(store.extensionPoints().filter(point => point.parentId === top.id), [])
  assert.equal(store.addNode({ parentId: top.id }).ok, false, 'the rule is the store\'s, not the drawing\'s')

  const deep = storeOf()
  const chain = [deep.addNode({}).node]
  for (let depth = 1; depth <= TREE_BOUNDS.maxDepth; depth += 1) {
    chain.push(deep.addNode({ parentId: chain[depth - 1].id }).node)
  }
  const deepest = chain[TREE_BOUNDS.maxDepth]
  assert.ok(deep.extensionPoints().some(point => point.parentId === chain[TREE_BOUNDS.maxDepth - 1].id))
  assert.deepEqual(deep.extensionPoints().filter(point => point.parentId === deepest.id), [])
  assert.equal(deep.addNode({ parentId: deepest.id }).ok, false)
})

/* The seven helpers docs/design/FLEET-TREES.md section 7 names, over the record
   shape that document describes. tools/test/fleet-trees-multi.test.mjs holds
   them to the engine's own numbers; these hold them to this module's record. */

test('the engine bounds are restated, not re-decided', () => {
  assert.deepEqual({ ...TREE_BOUNDS }, { maxChildren: 8, maxDepth: 3, maxEmptyTrees: 1 })
})

test('one tree is read in both records, and says the same thing in each', () => {
  const store = storeOf()
  const node = store.addNode({ role: 'builder', message: 'Ship the installer' }).node
  const asRecord = treeRecord(store.snapshot(), node.treeId)
  assert.equal(asRecord.id, node.treeId)
  assert.equal(asRecord.nodes.length, 1)
  assert.equal(treeRecord(store.snapshot(), 'tree-nope'), null)

  assert.equal(displayName(asRecord), 'Ship the installer', 'the words the person wrote')
  assert.equal(store.treeLabel(node.treeId), 'Ship the installer', 'and the store says the same')
  assert.equal(displayName({ nodes: [] }), 'New tree')
  assert.ok(!displayName({ id: 'tree-zzq', nodes: [] }).includes('tree-zzq'))
  const long = displayName({ nodes: [{ id: 'n', parentId: null, agent: { message: `${'word '.repeat(30)}` } }] })
  assert.ok(long.length <= 48 && !long.includes('\n'))

  // A tree nobody has typed into is counted, and only then.
  const blank = storeOf()
  const made = blank.createTree({})
  assert.equal(blank.treeLabel(made.tree.id), 'Tree 1')
  assert.equal(blank.treeLabel('tree-nope'), null)
})

test('a tree is empty, running, or finished, in either record', () => {
  const store = storeOf()
  const tree = store.createTree({}).tree
  assert.equal(treeStatus(treeRecord(store.snapshot(), tree.id)), 'empty')

  const node = store.addNode({ treeId: tree.id, role: 'builder', message: 'go' }).node
  assert.notEqual(treeStatus(treeRecord(store.snapshot(), tree.id)), 'running', 'a draft is not a running agent')

  store.attachSession(node.id, 'run-1')
  store.setNodeStatus(node.id, 'running')
  assert.equal(treeStatus(treeRecord(store.snapshot(), tree.id)), 'running')

  store.setNodeStatus(node.id, 'finished')
  assert.equal(treeStatus(treeRecord(store.snapshot(), tree.id)), 'finished')
})

test('a second empty tree is refused and points at the first', () => {
  const empty = { id: 'tree-a', name: null, nodes: [{ id: 'n1', parentId: null, agent: null }] }
  const busy = { id: 'tree-b', name: 'Ship it', nodes: [{ id: 'n1', parentId: null, agent: { message: 'go', state: 'running' } }] }

  const refused = planTreeAdd([empty])
  assert.equal(refused.allowed, false)
  assert.equal(refused.switchTo, 'tree-a')
  assert.ok(!refused.reason.includes('tree-a'), 'an id was printed at a person')

  assert.equal(planTreeAdd([busy]).allowed, true)
  assert.equal(planTreeAdd([]).allowed, true)
  assert.ok(planTreeAdd([]).reason.length > 0)
})

test('a position the engine refuses is refused here first', () => {
  const nodes = [{ id: 'n1', parentId: null, agent: { state: 'running' } }]
  for (let index = 0; index < TREE_BOUNDS.maxChildren; index += 1) {
    nodes.push({ id: `c${index}`, parentId: 'n1', agent: null })
  }
  assert.equal(planNodeAdd({ nodes }, 'n1').allowed, false, 'a ninth child')
  assert.equal(planNodeAdd({ nodes }, 'c0').allowed, true)
  assert.equal(planNodeAdd({ nodes }, 'nope').allowed, false)
  assert.equal(planNodeAdd({ nodes }, null).allowed, false, 'the top is taken')
  assert.equal(planNodeAdd({ nodes: [] }, null).allowed, true)

  const chain = []
  for (let depth = 0; depth <= TREE_BOUNDS.maxDepth; depth += 1) {
    chain.push({ id: `d${depth}`, parentId: depth === 0 ? null : `d${depth - 1}`, agent: { state: 'finished' } })
  }
  assert.equal(planNodeAdd({ nodes: chain }, `d${TREE_BOUNDS.maxDepth - 1}`).allowed, true)
  assert.equal(planNodeAdd({ nodes: chain }, `d${TREE_BOUNDS.maxDepth}`).allowed, false)
})

test('removing a tree says how many agents it would stop', () => {
  const quiet = planTreeRemove({ name: 'Ship it', nodes: [{ id: 'n1', parentId: null, agent: { state: 'finished' } }] })
  assert.equal(quiet.stopsFirst, false)
  assert.equal(quiet.running, 0)
  assert.ok(quiet.sentence.includes('Ship it'))

  const busy = planTreeRemove({
    name: 'Ship it',
    nodes: [
      { id: 'n1', parentId: null, agent: { state: 'running' } },
      { id: 'n2', parentId: 'n1', agent: { state: 'running' } },
    ],
  })
  assert.equal(busy.stopsFirst, true)
  assert.equal(busy.running, 2)
  assert.match(busy.sentence, /\btwo\b/i, 'the number is the whole point of the ask')
})

test('the seat shortage names the trees holding the agents', () => {
  const mine = { id: 'tree-a', name: 'Fix the login screen', nodes: [] }
  const holder = {
    id: 'tree-b',
    name: 'Ship the installer',
    nodes: [{ id: 'n1', parentId: null, agent: { state: 'running' } }],
  }

  const sentence = seatShortageSentence({ trees: [mine, holder], currentTreeId: mine.id })
  assert.ok(sentence.includes('Ship the installer'))
  for (const id of ['tree-a', 'tree-b']) assert.ok(!sentence.includes(id))

  const alone = seatShortageSentence({ trees: [holder], currentTreeId: holder.id })
  assert.ok(alone.includes('this computer can run'))

  const nothing = seatShortageSentence({})
  assert.ok(!/\bnull\b|\bundefined\b/.test(nothing), 'an absent value leaked into a sentence')
})

test('what a caller reads back cannot be edited under the store', () => {
  const store = storeOf()
  store.addNode({ role: 'a' })
  const current = store.snapshot()
  assert.ok(Object.isFrozen(current))
  assert.throws(() => { current.nodes.push({}) })
  assert.throws(() => { current.nodes[0].status = 'running' })
  assert.throws(() => { store.listTrees().push({}) })
})

/* ---------- detachToNewTree: the drag OUT of a tree, as a verb ---------- */

test('detaching a branch mints a tree and takes the whole branch along', () => {
  const store = storeOf()
  const root = store.addNode({ role: 'coordinator', message: 'run the fleet' }).node
  const mid = store.addNode({ parentId: root.id, role: 'manager', message: 'run a lane' }).node
  const leaf = store.addNode({ parentId: mid.id, role: 'default', message: 'do the work' }).node

  const out = store.detachToNewTree(mid.id)
  assert.equal(out.ok, true)
  assert.notEqual(out.treeId, root.treeId, 'the branch must land in a NEW tree')
  const after = store.snapshot()
  const byId = new Map(after.nodes.map(node => [node.id, node]))
  assert.equal(byId.get(mid.id).parentId, null, 'the detached node is its new tree\'s root')
  assert.equal(byId.get(mid.id).treeId, out.treeId)
  assert.equal(byId.get(leaf.id).treeId, out.treeId, 'descendants ride along')
  assert.equal(byId.get(root.id).treeId, root.treeId, 'the old tree keeps what was not dragged')
  assert.equal(after.trees.length, 2)
})

test('detaching a sole root is a no-op accept, not a refusal and not a new id', () => {
  const store = storeOf()
  const root = store.addNode({ role: 'coordinator', message: 'solo' }).node
  const out = store.detachToNewTree(root.id)
  assert.equal(out.ok, true)
  assert.equal(out.treeId, root.treeId, 'it already IS its own tree')
  assert.equal(out.unchanged, true)
  assert.equal(store.snapshot().trees.length, 1)
})

test('detaching the last branch of a tree removes the emptied husk', () => {
  const store = storeOf()
  const root = store.addNode({ role: 'coordinator', message: 'alone up top' }).node
  const child = store.addNode({ parentId: root.id, role: 'default', message: 'below' }).node
  // Detach the ROOT's whole tree? No -- detach the child, then the root is a
  // sole root; detach the root's branch from a tree that has another member.
  const out = store.detachToNewTree(child.id)
  assert.equal(out.ok, true)
  const after = store.snapshot()
  assert.equal(after.trees.length, 2, 'old tree still holds the root; new tree holds the child')
  // Now move the root over too -- its old tree empties and must vanish.
  const move = store.moveNode(root.id, child.id)
  assert.equal(move.ok, true)
  assert.equal(store.snapshot().trees.length, 1, 'a tree left empty is removed, not kept as a husk')
})

test('detaching refuses at the tree cap with the same sentence the button uses', () => {
  const store = storeOf()
  const root = store.addNode({ role: 'coordinator', message: 'first' }).node
  const child = store.addNode({ parentId: root.id, role: 'default', message: 'second' }).node
  for (let index = store.snapshot().trees.length; index < 64; index += 1) {
    const made = store.createTree({ name: `t${index}` })
    assert.equal(made.ok, true, `tree ${index} should fit under the cap`)
    const seeded = store.addNode({ treeId: made.tree.id, role: 'default', message: 'hold the tree open' })
    assert.equal(seeded.ok, true)
  }
  const out = store.detachToNewTree(child.id)
  assert.equal(out.ok, false)
  assert.match(out.problems[0], /64 trees already/)
})
