/* WHAT A TREE-STARTED AGENT IS TOLD ABOUT ITS MANAGER.
 *
 * The owner's defect, verbatim: "This one is not realizing and not able to
 * contact its manager." A child node answered that it had no manager and asked
 * for the manager's identifier, on a tree that drew the relationship.
 *
 * Two properties are pinned here and they pull against each other, which is
 * why they are in one file. The brief must NAME the manager -- that is the
 * defect -- and it must not promise a channel that does not exist. The product
 * ships a cross-machine messenger that refuses a local recipient by design, so
 * a brief mentioning it would send a child to call a number that never rings.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { composeNodeBrief, nodeManagerContext } from '../../src/tree-node-brief.js'

test('a child is told who its manager is, by the name on the canvas', () => {
  const text = composeNodeBrief({ message: 'Count the files.', selfName: 'Default', parentName: 'Manager' })
  assert.match(text, /Your manager is Manager\./)
  assert.match(text, /Begin your report with "Manager:"/)
})

test('the person\'s words come first and are not altered', () => {
  const brief = 'Reply with exactly the word OMEGA.'
  const text = composeNodeBrief({ message: brief, selfName: 'Worker 2', parentName: 'Manager' })
  assert.ok(text.startsWith(brief), 'the brief no longer leads')
  assert.equal(text.slice(0, brief.length), brief, 'the brief was rewritten')
  assert.match(text, /\n\n/, 'the context is not a separate paragraph')
})

test('a node at the top is told it has no manager, and who it does report to', () => {
  const text = composeNodeBrief({ message: 'Plan the work.', selfName: 'Coordinator' })
  assert.match(text, /no agent manages you/)
  assert.match(text, /You report to the person running this tree\./)
  assert.doesNotMatch(text, /Your manager is/)
})

test('every brief says plainly that there is no agent-to-agent channel here', () => {
  const text = composeNodeBrief({ message: 'Go.', selfName: 'Default', parentName: 'Manager' })
  assert.match(text, /no direct message channel to another agent on this computer/)
})

test('the cross-machine messenger is never named, on any path', () => {
  // capability/src/lib/providers/agent-comms.js answers accepted:false with a
  // code meaning "pick a recipient on another machine" for a local recipient.
  // Naming it here would be the product inventing a capability.
  for (const options of [
    { message: 'Go.', selfName: 'Default', parentName: 'Manager' },
    { message: 'Go.', selfName: 'Coordinator' },
  ]) {
    const text = composeNodeBrief(options)
    assert.doesNotMatch(text, /agent_comms|agent-comms/, 'the brief names a channel that refuses local recipients')
  }
})

test('no brief offers a second channel, because there is not one to offer', () => {
  /* A draft of this module named the builder's own coordination namespace as a
     place to leave a note for a manager. tools/test/chat-agent-bridge-gated.test.mjs
     forbids that name anywhere under src/ or shell/ -- it is classed with the
     owner's private account aliases, because it is an internal arrangement and
     not something a customer was sold. The honest brief has exactly one
     reporting sentence, and this pins that it stays that way. */
  const source = readFileSync(join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'src', 'tree-node-brief.js'), 'utf8')
  const offered = source.match(/said\.push\(/g) || []
  assert.ok(offered.length <= 8, 'the brief grew another clause; check it names a channel that really works')
  for (const options of [
    { message: 'Go.', selfName: 'Default', parentName: 'Manager' },
    { message: 'Go.', selfName: 'Coordinator' },
  ]) {
    const text = composeNodeBrief(options)
    assert.doesNotMatch(text, /memory tool|coordination board|shared space/, 'the brief offers a channel again')
  }
})

test('a missing name never puts an internal id in front of an agent', () => {
  const text = nodeManagerContext({ selfName: '', parentName: '  ' })
  assert.match(text, /You are this agent on this computer's agent tree\./)
  assert.doesNotMatch(text, /Your manager is/)
})
