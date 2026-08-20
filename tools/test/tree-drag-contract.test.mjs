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

test('the corridor constrains nudges and NEVER the layout\'s own position', () => {
  /* Owner amendment (iteration 6): "keep the new version but make it act
     and feel like before". The corridor stays — iteration 5's "top circles
     stay at the top" — but its band must always CONTAIN the record's own
     slot, so an un-nudged node sits exactly where the layout put it. The
     first corridor kept the old canvas-edge floor (r + 64), which
     disagrees with the layout's padTop for big circles and pushed the
     whole top row down AT REST — the regression the owner screenshotted. */
  const graph = graphNow()
  assert.match(graph, /_rankCorridor\(record, result, slot\.y\)/, 'the offset apply no longer clamps into a slot-containing rank corridor')
  assert.match(graph, /_rankCorridor\(focusRecord, this\._layoutResult, targetSlot\.y\)/, 'the focus-animation path lost the slot-containing corridor; the settle jumps or shifts at rest')
  /* THE LIVE DRAG STARTS FROM THE CORRIDOR AND IS WIDENED BY REACH.
   *
   * This used to pin the bare corridor on the pointermove, and that pin was
   * the regression: the corridor is half the pitch to the next row, every
   * empty slot is in a DIFFERENT row from the node you would drag onto it, and
   * contact needs about 77px. So no cross-row drop could register at any
   * realistic window size -- the owner's "you cant drag and drop the nodes
   * onto the new bubbles anymore", all three of his cases at once.
   *
   * The corridor still bounds a NUDGE, which is what stops the snap on
   * release; dragBand() widens it by the reach of the targets on screen, so a
   * release outside the corridor is always either a move or a refusal with a
   * sentence. Both halves are pinned, because either one alone rots. */
  assert.match(graph, /record\.y = clamp\(point\.y \+ offset\.y, \.\.\.this\._dragBand\(record\)\)/, 'the live drag no longer uses the reach-widened band; cross-row drops cannot register')
  assert.match(graph, /corridor: this\._rankCorridor\(record, this\._layoutResult\)/, 'the drag band stopped starting from the rank corridor; nudges will jump on release again')
  assert.match(graph, /slop: DROP_SLOP/, 'the band widens by a number the hit test does not use; the two can now disagree about reach')
  assert.match(graph, /Math\.min\(Math\.max\(canvasLow, rowY - up\), slotY\)/, 'the corridor stopped containing the slot — un-nudged nodes will shift at rest again')
  /* The band is the midline between ranks, full half-pitch each way: the
     label-stack subtraction plus zero floor made tight rows refuse every
     nudge, the snap-back feel the owner rejected. The precise label veto
     below is the overlap check, not this fence. */
  assert.ok(!/TREE_LABEL_STACK \/ 2/.test(graph), 'the corridor re-grew the label-stack subtraction; tight rows will refuse nudges again (the snap-back feel)')
})

test('the override veto sees words at their TRUE width, not only circles', () => {
  const graph = graphNow()
  assert.match(graph, /rectsMeet\(recordBox, otherBox\)/, 'the veto lost its label-vs-label test')
  assert.match(graph, /circleMeetsRect\(/, 'the veto lost its label-vs-circle test')
  // One label geometry for every rule: the hardcoded 7 + 58 is gone and the
  // exported constant is the single source.
  assert.ok(!/7 \+ 58/.test(graph), 'tree-graph.js re-hardcoded the label stack; import TREE_LABEL_STACK instead')
  assert.match(graph, /_labelBox\(record\)/, 'the shared label box vanished')
  /* The box mirrors the CSS width — min(r + 59, labelMax / 2). The first
     version spanned max(r,35)+12, half the truth; a veto measuring half
     the words missed half the collisions. */
  assert.match(graph, /Math\.min\(record\.r \+ 59, \(record\.labelMax \|\| Infinity\) \/ 2\)/, '_labelBox no longer mirrors the CSS label width')
  assert.match(graph, /record\.labelMax = label\?\.maxWidth \|\| null/, 'labelMax is no longer recorded at layout time, so _labelBox measures a stale width')
})

test('a status tick moves nothing: geometry follows structure, not events', () => {
  /* Owner, iteration 7: "the tree action is a mess like the way it moves and
     such". Every reply, usage reading and status change ran the full layout
     — packers plus the vertical fitter, which may rescale every radius —
     and nodes carry no transition on left/top, so each one was an instant
     jump. The reconcile now skips the layout when the shape is unchanged. */
  const graph = graphNow()
  const reconcile = graph.slice(graph.indexOf('_reconcile({'), graph.indexOf('_structureKey() {'))
  assert.match(reconcile, /this\._layoutKey === this\._structureKey\(\)/,
    'the reconcile lays out unconditionally again; a reply will move the tree')
  const key = graph.slice(graph.indexOf('_structureKey() {'), graph.indexOf('_structureKey() {') + 900)
  for (const part of ['this.rootId', 'this.editMode', 'this.W', 'this.H', '_positionsRevision', 'agent.parentId']) {
    assert.ok(key.includes(part), `the structure key stopped reading ${part}; a real shape change would not re-lay out`)
  }
  /* Nothing that only changes what a node SAYS may enter the key, or the
     skip is defeated and we are back to laying out on every tick. */
  for (const forbidden of ['status', 'runtime', 'reply', 'usage']) {
    assert.ok(!key.includes(forbidden), `the structure key reads ${forbidden}; status ticks will re-lay out the tree again`)
  }
  assert.match(graph, /this\._layoutKey = this\._structureKey\(\)/, 'a completed layout no longer stamps its key; the skip check goes stale')
  assert.match(graph.slice(graph.indexOf('_writePositions() {'), graph.indexOf('_writePositions() {') + 300), /_positionsRevision \+= 1/,
    'a saved or cleared nudge no longer bumps the revision, so a drag would not re-lay out')
})

test('a collision revert returns to the layout position verbatim', () => {
  const graph = graphNow()
  /* Anchor past the veto's geometry helpers: the FIRST _clearPosition call
     in the file is the stale-parent branch, which restores nothing. */
  const revert = graph.slice(graph.indexOf('this._clearPosition(record.id)', graph.indexOf('rectsMeet')))
  assert.match(revert.slice(0, 600), /record\.x = record\.slot\.x/, 'the veto revert clamps again instead of restoring the slot — reverted nodes land where the layout never chose')
  assert.match(revert.slice(0, 600), /record\.y = record\.slot\.y/, 'the veto revert clamps y again instead of restoring the slot')
})

function graphNow() {
  return readFileSync(join(SRC, 'tree-graph.js'), 'utf8')
}
