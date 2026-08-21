import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createAssignmentStore,
  parseAssignmentsRow,
  serializeAssignmentsRow,
} from '../../src/research-assignments.js'

/* Assignment: the service's table is the truth, this row is the cache and the
   outbox. A write the service did not hear stays pending WITH its sentence. */

function memoryStorage() {
  const map = new Map()
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
  }
}

test('the row parses defensively and absence is empty, not damaged', () => {
  assert.deepEqual(parseAssignmentsRow(null), { rows: [], damaged: false })
  assert.equal(parseAssignmentsRow('{broken').damaged, true)
  assert.equal(parseAssignmentsRow('{"v":2,"rows":[]}').damaged, true)
  const parsed = parseAssignmentsRow(JSON.stringify({
    v: 1,
    rows: [
      { projectId: 'rp-1', kind: 'launch', ref: 'launch_1', pending: false },
      { projectId: 'rp-1', kind: 'nonsense', ref: 'x' },
      { projectId: 'rp-1', kind: 'all', ref: '*', pending: true },
    ],
  }))
  assert.equal(parsed.rows.length, 2, 'the unknown kind is dropped on read')
  assert.equal(serializeAssignmentsRow([]), null, 'an empty store stores nothing')
})

test('an assignment the service heard settles; one it did not stays pending with the sentence', async () => {
  const storage = memoryStorage()
  let serviceUp = false
  const store = createAssignmentStore({
    storage,
    postAction: async () => serviceUp ? { ok: true, receipt: {} } : { ok: false, reason: 'bridge down' },
  })

  const offline = await store.assign('rp-1', 'launch', 'launch_abc')
  assert.equal(offline.ok, true)
  assert.equal(offline.pending, true)
  assert.match(offline.sentence, /has not heard/, 'the person is told the service does not know yet')
  assert.equal(store.snapshot().rows[0].pending, true)

  serviceUp = true
  const flushed = await store.flushPending()
  assert.equal(flushed.accepted, 1)
  assert.equal(flushed.remaining, 0)
  assert.equal(store.snapshot().rows[0].pending, false)

  const online = await store.assign('rp-1', 'all')
  assert.equal(online.ok, true)
  assert.equal(online.pending, undefined)
  assert.equal(store.snapshot().rows.find(row => row.kind === 'all').ref, '*')
})

test('projectsOfSession unions explicit rows with the all rule', async () => {
  const store = createAssignmentStore({ storage: memoryStorage(), postAction: async () => ({ ok: true }) })
  await store.assign('rp-1', 'launch', 'launch_abc')
  await store.assign('rp-2', 'all')
  assert.deepEqual(store.projectsOfSession('launch', 'launch_abc').sort(), ['rp-1', 'rp-2'])
  assert.deepEqual(store.projectsOfSession('observed', 'never-assigned'), ['rp-2'], 'the all rule covers sessions assigned to nothing')
  await store.unassign('rp-2', 'all')
  assert.deepEqual(store.projectsOfSession('observed', 'never-assigned'), [])
})

test('adopting the service rows keeps unheard local writes', async () => {
  const store = createAssignmentStore({ storage: memoryStorage(), postAction: async () => ({ ok: false, reason: 'down' }) })
  await store.assign('rp-9', 'launch', 'launch_local_only')
  store.adoptServiceRows([
    { projectId: 'rp-1', kind: 'launch', ref: 'launch_service', active: true },
    { projectId: 'rp-1', kind: 'presence', ref: 'old:run', active: false },
  ])
  const rows = store.snapshot().rows
  assert.equal(rows.some(row => row.ref === 'launch_service' && !row.pending), true)
  assert.equal(rows.some(row => row.ref === 'old:run'), false, 'inactive service rows are history, not cache')
  assert.equal(rows.some(row => row.ref === 'launch_local_only' && row.pending), true, 'the outbox survives adoption')
})

test('a duplicate assignment says so instead of writing twice', async () => {
  const store = createAssignmentStore({ storage: memoryStorage(), postAction: async () => ({ ok: true }) })
  await store.assign('rp-1', 'launch', 'launch_abc')
  const again = await store.assign('rp-1', 'launch', 'launch_abc')
  assert.equal(again.alreadyAssigned, true)
  assert.equal(store.snapshot().rows.length, 1)
})
