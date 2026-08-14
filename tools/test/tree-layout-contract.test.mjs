// THE CONTRACTS PHASE 1.3 INTRODUCED, PINNED.
//
// Four claims became true when defect 1a's root cause was fixed, and each is
// the kind that silently rots: a constant edited in one place, a rung added to
// a ladder, a "should converge" that stops converging. Every test here reads
// the real modules; nothing is mocked.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { layoutTree, TREE_LABEL_STACK } from '../../src/tree-layout.js'

const here = fileURLToPath(import.meta.url)
const SRC = join(dirname(dirname(dirname(here))), 'src')

test('tree nodes carry NO explicit tierRank -- a four-level tree gets four ranks', () => {
  // The exact shape defect 1a shipped with: root -> child -> grandchild ->
  // great-grandchild. Under `tierRank: parentId ? 2 : 0` this drew as TWO
  // rows; the fix walks parentId chains.
  const lineage = [
    { id: 'root', name: 'Coordinator', role: 'coordinator' },
    { id: 'child', name: 'Manager', role: 'manager', parentId: 'root' },
    { id: 'grand', name: 'Worker', role: 'default', parentId: 'child' },
    { id: 'great', name: 'Helper', role: 'default', parentId: 'grand' },
  ]
  const result = layoutTree({ nodes: lineage, W: 900, H: 760 })
  const ys = new Set([...result.slots.values()].map(slot => slot.y))
  assert.equal(ys.size, 4, `a 4-deep lineage must occupy 4 distinct rank rows, got ${ys.size}`)
  // And no hierarchy link may connect two nodes within one rank.
  for (const [child, parent] of result.parents) {
    assert.notEqual(
      result.slots.get(child)?.y,
      result.slots.get(parent)?.y,
      `${parent} -> ${child} runs within one rank; the connector would be a flat diagonal`,
    )
  }
  // The view really does send null: the record builder in views/computers.js
  // must not reintroduce a computed tierRank for tree nodes.
  const view = readFileSync(join(SRC, 'views', 'computers.js'), 'utf8')
  assert.ok(!/tierRank:\s*node\.parentId/.test(view), 'views/computers.js reintroduced a parentId-derived tierRank for tree nodes')
})

test('the packing ladder never sanctions overlap', async () => {
  const source = readFileSync(join(SRC, 'tree-layout.js'), 'utf8')
  const ladder = source.match(/const PACKING_LADDER = Object\.freeze\(\[[\s\S]*?\]\)/)?.[0]
  assert.ok(ladder, 'PACKING_LADDER not found')
  const airs = [...ladder.matchAll(/\[\s*\d+\s*,\s*(-?\w+)\s*\]/g)].map(match => match[1])
  assert.ok(airs.length >= 2, 'ladder should have rungs')
  for (const air of airs) {
    assert.ok(!air.startsWith('-'), `ladder rung with negative air: ${air} -- that is overlap by sanction`)
  }
})

test('label budgets are per-neighbour, not the rank minimum', () => {
  // One tight pair (long-named siblings under one parent) next to a record
  // with open space: the spaced record's budget must exceed the tight pair's.
  const nodes = [
    { id: 'root', name: 'Coordinator', role: 'coordinator', bornAt: 1 },
    { id: 'a', name: 'Left crowded worker seat', role: 'default', parentId: 'root', bornAt: 1 },
    { id: 'b', name: 'Right crowded worker seat', role: 'default', parentId: 'root', bornAt: 1 },
    // A second family far to the side: its sole child has a whole flank free.
    { id: 'root2', name: 'Second Coordinator', role: 'coordinator', bornAt: 1 },
    { id: 'solo', name: 'Solo worker with room', role: 'default', parentId: 'root2', bornAt: 1 },
  ]
  const result = layoutTree({ nodes, W: 1100, H: 700 })
  const budgetOf = (id) => result.labels.get(id).maxWidth
  if (budgetOf('a') != null && budgetOf('solo') != null) {
    assert.ok(
      budgetOf('solo') >= budgetOf('a'),
      `the record with open space (${budgetOf('solo')}) must not inherit the tight pair's budget (${budgetOf('a')})`,
    )
  }
  // And every named, laid-out record keeps at least the readable floor.
  for (const [id, label] of result.labels) {
    if (label.maxWidth != null) assert.ok(label.maxWidth >= 70, `${id} label budget ${label.maxWidth} under the 70px readable floor`)
  }
})

test('minHeight is a fixed point: re-laying at the asked height fits', () => {
  // Five tiers into 300px cannot fit even at the 34px radius floor, so the
  // layout must ask for height -- and the ask must be SUFFICIENT, because the
  // wrap grows exactly once on the strength of it.
  const deep = ['root']
  const nodes = [{ id: 'root', name: 'Coordinator', role: 'coordinator', bornAt: 1 }]
  for (let index = 1; index < 5; index += 1) {
    nodes.push({ id: `n${index}`, name: `Tier ${index} agent`, role: 'default', parentId: index === 1 ? 'root' : `n${index - 1}`, bornAt: 1 })
    deep.push(`n${index}`)
  }
  const cramped = layoutTree({ nodes, W: 900, H: 300 })
  assert.ok(Number.isFinite(cramped.minHeight), 'a tree the floor cannot save must ask for height')
  assert.ok(cramped.minHeight > 300)

  const grown = layoutTree({ nodes, W: 900, H: cramped.minHeight })
  assert.equal(grown.minHeight, null, `laying out at the asked height (${cramped.minHeight}) must fit -- the ask was insufficient`)
  // No adjacent pair of tiers may overlap at the granted height.
  const rows = grown.rowYs
  for (let index = 0; index + 1 < rows.length; index += 1) {
    const upper = [...grown.slots.entries()].filter(([, slot]) => slot.y === rows[index])
    const lower = [...grown.slots.entries()].filter(([, slot]) => slot.y === rows[index + 1])
    const tallestUpper = Math.max(...upper.map(([id]) => grown.radii.get(id)))
    const tallestLower = Math.max(...lower.map(([id]) => grown.radii.get(id)))
    assert.ok(
      rows[index + 1] - rows[index] >= tallestUpper + tallestLower,
      `tiers ${index} and ${index + 1} overlap at the granted height`,
    )
  }
})

test('the label stack constant and the stylesheet agree', () => {
  const css = readFileSync(join(SRC, 'tree-graph.css'), 'utf8')
  const declared = css.match(/--tree-label-stack:\s*(\d+)px/)?.[1]
  assert.ok(declared, 'tree-graph.css no longer declares --tree-label-stack')
  assert.equal(
    Number(declared),
    TREE_LABEL_STACK,
    `tree-graph.css says ${declared}px but tree-layout.js reserves ${TREE_LABEL_STACK}px -- the sheet and the layout have drifted`,
  )
  // The role row must stay clamped to ONE line: the constant's worst case is
  // computed from one role line, and a two-line role overflows the reserve.
  assert.match(css, /\.node-role\s*{[^}]*-webkit-line-clamp:\s*1/s, 'the role row is no longer one-line; TREE_LABEL_STACK is now a lie')
})
