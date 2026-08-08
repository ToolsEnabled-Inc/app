import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutTree } from '../../src/tree-layout.js'

const nodes = [
  { id: 'root', name: 'Coordinator', role: 'coordinator' },
  { id: 'manager-a', name: 'Manager A', role: 'manager', parentId: 'root' },
  { id: 'manager-b', name: 'Manager B', role: 'manager', parentId: 'root' },
  { id: 'worker-a', name: 'Worker A', role: 'default', parentId: 'manager-a' },
]

test('layoutTree is deterministic and layered by hierarchy depth', () => {
  const first = layoutTree({ nodes, W: 900, H: 600 })
  const second = layoutTree({ nodes, W: 900, H: 600 })
  assert.deepEqual([...first.slots], [...second.slots])
  assert.equal(first.slots.get('root').x, 450)
  assert.ok(first.slots.get('root').y < first.slots.get('manager-a').y)
  assert.equal(first.slots.get('manager-a').y, first.slots.get('manager-b').y)
  assert.ok(first.slots.get('manager-a').y < first.slots.get('worker-a').y)
  assert.equal(first.drillRequired, false)
})

test('explicit tier ranks win over parent depth', () => {
  const ranked = nodes.map((node, index) => ({ ...node, tierRank: index === 0 ? 0 : 2 }))
  const result = layoutTree({ nodes: ranked, W: 900, H: 600 })
  assert.equal(result.slots.get('manager-a').y, result.slots.get('worker-a').y)
})

test('over-capacity tiers remain readable, request drill, and cull by priority', () => {
  const crowded = [{ id: 'root', name: 'Coordinator', role: 'coordinator' }]
  for (let index = 0; index < 18; index += 1) {
    crowded.push({
      id: `worker-release-seat-${index}`,
      name: `Long worker name release seat ${index}`,
      role: 'spawned',
      parentId: 'root',
      cullable: true,
      cullRank: index,
    })
  }
  const result = layoutTree({ nodes: crowded, W: 640, H: 420 })
  assert.equal(result.drillRequired, true)
  assert.ok(result.culled.size > 0)
  assert.ok(result.slots.has('worker-release-seat-0'))
  assert.ok(!result.slots.has('worker-release-seat-17'))
  assert.ok(result.labels.get('worker-release-seat-0').maxWidth >= 70)
})

test('declared hierarchy edges are consumed without accepting a cycle', () => {
  const flat = [
    { id: 'a', name: 'A', role: 'coordinator' },
    { id: 'b', name: 'B', role: 'manager' },
    { id: 'c', name: 'C', role: 'default' },
  ]
  const result = layoutTree({
    nodes: flat,
    edges: [
      { from: 'a', to: 'b', type: 'manages' },
      { from: 'b', to: 'c', type: 'delegates_to' },
      { from: 'c', to: 'a', type: 'manages' },
    ],
    W: 800,
    H: 500,
  })
  assert.equal(result.slots.size, 3)
  assert.ok(new Set([...result.slots.values()].map(slot => slot.y)).size >= 2)
})
