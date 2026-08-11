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

/* The three properties the vertical fitter and the grouped packer are FOR.
   Written as unit tests rather than screenshots because the interesting
   inputs here are the degenerate ones — no nodes, one node, no room — and a
   screenshot is worst at exactly those. */

test('a rank under one parent is packed under it, not smeared across the canvas', () => {
  const family = [
    { id: 'root', name: 'Coordinator', role: 'coordinator', bornAt: 1 },
    ...['a', 'b', 'c', 'd'].map(key => ({
      id: `manager-${key}`, name: `Manager ${key.toUpperCase()}`, role: 'manager', parentId: 'root', bornAt: 1,
    })),
  ]
  const narrow = layoutTree({ nodes: family, W: 840, H: 700 })
  const wide = layoutTree({ nodes: family, W: 1260, H: 700 })
  const pitchOf = (result) =>
    result.slots.get('manager-b').x - result.slots.get('manager-a').x
  // The rank keeps ONE spacing as the canvas grows: a wider window buys the
  // tree room around itself, never a rank stretched to the window's width.
  assert.equal(pitchOf(wide), pitchOf(narrow))
  const span = wide.slots.get('manager-d').x - wide.slots.get('manager-a').x
  assert.ok(span < 1260 / 2, `rank span ${span} should stay a family, not fill the canvas`)
  // ...and it stays centred on its own parent.
  const mid = (wide.slots.get('manager-a').x + wide.slots.get('manager-d').x) / 2
  assert.ok(Math.abs(mid - wide.slots.get('root').x) < 2, `${mid} vs ${wide.slots.get('root').x}`)
})

test('a canvas too short for the tiers shrinks the circles instead of overlapping them', () => {
  const deep = [
    { id: 'root', name: 'Coordinator', role: 'coordinator', bornAt: 1 },
    { id: 'mid', name: 'Manager', role: 'manager', parentId: 'root', bornAt: 1 },
    { id: 'leaf', name: 'Lane', role: 'default', parentId: 'mid', bornAt: 1 },
  ]
  const roomy = layoutTree({ nodes: deep, W: 900, H: 760 })
  const cramped = layoutTree({ nodes: deep, W: 900, H: 339 })
  assert.equal(roomy.radii.get('root'), 62, 'a canvas with room keeps the full role size')
  const pitch = cramped.slots.get('mid').y - cramped.slots.get('root').y
  const circles = cramped.radii.get('root') + cramped.radii.get('mid')
  assert.ok(circles <= pitch, `circles ${circles} must clear the ${pitch}px row pitch`)
  assert.ok(cramped.radii.get('root') >= 34, 'never below the readable floor')
  // Growing the window back must give the full size back, not ratchet down.
  assert.equal(layoutTree({ nodes: deep, W: 900, H: 760 }).radii.get('root'), 62)
})

test('absence is answered without a slot, a radius or a throw', () => {
  const empty = layoutTree({ nodes: [], W: 1260, H: 800 })
  assert.equal(empty.slots.size, 0)
  assert.equal(empty.radii.size, 0)
  assert.equal(empty.drillRequired, false)
  assert.deepEqual(empty.rowYs, [])
  // No argument at all is the same answer as an empty fleet.
  assert.equal(layoutTree().slots.size, 0)
  // One node, no parent, no edges: centred, full size, nothing culled.
  const lone = layoutTree({ nodes: [{ id: 'only', name: 'Only', role: 'coordinator', bornAt: 1 }], W: 1260, H: 800 })
  assert.equal(lone.slots.get('only').x, 630)
  assert.equal(lone.radii.get('only'), 62)
  assert.equal(lone.culled.size, 0)
  assert.equal(lone.drillRequired, false)
})
