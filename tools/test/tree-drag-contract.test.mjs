// THE DRAG CONTRACTS PHASE 1.4 INTRODUCED, PINNED AT THE SOURCE LEVEL.
//
// The graph is DOM-heavy, so its geometry is exercised by the CDP acceptance
// pass on the installed build; what THIS file pins is the source-level shape
// of the rules — the parts that a later edit can silently undo while every
// runtime path still "works" on the happy case.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(import.meta.url)
const SRC = join(dirname(dirname(dirname(here))), 'src')
const graph = readFileSync(join(SRC, 'tree-graph.js'), 'utf8')
const view = readFileSync(join(SRC, 'views', 'computers.js'), 'utf8')

test('an override dies with its parent: v2 entries carry parentId and are validated on apply', () => {
  // Written with the parent it was measured under...
  assert.match(graph, /v:\s*2,[\s\S]{0,200}parentId:\s*record\.agent\.parentId/, 'writes no longer record the parent')
  // ...validated against the CURRENT parent at apply time...
  assert.match(graph, /offset\.v === 2 && \(offset\.parentId \?\? null\) !== \(record\.agent\.parentId \?\? null\)/, 'apply no longer checks the recorded parent')
  // ...and v1 blobs are discarded on read.
  assert.match(graph, /value\?\.v !== 2\) continue/, 'v1 position blobs are readable again -- they preserve the exact displacement defect 2 was')
})

test('the drop threshold leaves no dead annulus and nearest wins', () => {
  // The old factor: `< candidate.r + record.r * 0.55` -- smaller than the
  // packed non-overlap distance, which is what made a child-on-parent drop
  // MISS. Matched as the comparison expression, not the bare number, so the
  // explanatory comment in tree-graph.js does not trip this guard (a guard
  // reading its own documentation has bitten this repo four times).
  assert.ok(!/<\s*candidate\.r \+ record\.r \* 0\.55/.test(graph), 'the 0.55 dead-ring threshold is back')
  assert.match(graph, /candidate\.r \+ record\.r \+ DROP_SLOP/, 'the threshold no longer clears the non-overlap distance')
  assert.match(graph, /const DROP_SLOP = 8/, 'DROP_SLOP changed or vanished; re-derive against MIN_AIR before accepting')
  // Nearest, not first-in-insertion-order.
  assert.match(graph, /score < 0 && score < best/, 'drop targeting reverted to first-match insertion order')
})

test('draggability is injected, never inferred from a free-text role', () => {
  // The graph must not decide from role text...
  assert.ok(
    !/record\.agent\.role !== 'coordinator'/.test(graph),
    "the graph regained an inline role !== 'coordinator' rule; tree roles are free text, so a node NAMED coordinator goes undraggable again",
  )
  // ...the view supplies the rule, and tree nodes are always draggable.
  assert.match(view, /canDrag: agent => Boolean\(agent\.treeNode\) \|\| agent\.role !== 'coordinator'/, 'the view no longer injects canDrag')
})

test('a refused drop speaks a sentence and a parent-drop stores nothing', () => {
  assert.match(graph, /onDropRefused\('alreadyUnder'/, 'the parent-drop refusal lost its sentence')
  assert.match(graph, /onDropRefused\('wouldCycle'/, 'the cycle refusal lost its sentence')
  // The refuse branch must RETURN before the position write: a refused drop
  // that still stored an override would displace the node afterwards.
  const refuseBranch = graph.slice(graph.indexOf("classList.add('refuse')"))
  const returnAt = refuseBranch.indexOf('return')
  const writeAt = refuseBranch.indexOf('this._positions[record.id] =')
  assert.ok(returnAt !== -1 && (writeAt === -1 || returnAt < writeAt), 'the refuse branch no longer returns before the override write')
})

test('the cycle check reads the same resolver as the layout', () => {
  assert.match(graph, /hierarchyParents\(this\.computer\?\.agents/, '_wouldCycle no longer uses the shared hierarchy resolver; declared-edge cycles slip past it again')
})

test('a vertical nudge stays inside its own rank corridor', () => {
  // Owner walkthrough (iteration 5): a dragged ROOT sank into the child
  // row's band and tangled with its labels -- the old clamp knew only the
  // canvas edges. The corridor is derived from the layout's own rowYs.
  assert.match(graphNow(), /_rankCorridor\(record, result\)/, 'the offset apply no longer clamps into the rank corridor')
  assert.match(graphNow(), /_rankCorridor\(focusRecord, this\._layoutResult\)/, 'the focus-animation path lost the corridor clamp; the settle jumps')
  // Tight rows must refuse nudges rather than trade overlap for freedom.
  assert.match(graphNow(), /Math\.max\(0, \(rowY - rowYs\[rowIndex - 1\]\) \/ 2 - TREE_LABEL_STACK \/ 2\)/, 'the corridor no longer reserves the label stack')
})

test('the override veto sees words, not only circles', () => {
  const graph = graphNow()
  assert.match(graph, /rectsMeet\(recordBox, otherBox\)/, 'the veto lost its label-vs-label test')
  assert.match(graph, /circleMeetsRect\(/, 'the veto lost its label-vs-circle test')
  // One label geometry for every rule: the hardcoded 7 + 58 is gone and the
  // exported constant is the single source.
  assert.ok(!/7 \+ 58/.test(graph), 'tree-graph.js re-hardcoded the label stack; import TREE_LABEL_STACK instead')
  assert.match(graph, /_labelBox\(record\)/, 'the shared label box vanished')
})

function graphNow() {
  return readFileSync(join(SRC, 'tree-graph.js'), 'utf8')
}
