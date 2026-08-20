/* WHAT A TREE-STARTED AGENT IS TOLD ABOUT ITS MANAGER.
 *
 * The owner's defect, verbatim: "This one is not realizing and not able to
 * contact its manager." A child node answered that it had no manager and asked
 * for the manager's identifier, on a tree that drew the relationship.
 *
 * Two properties are pinned here and they pull against each other, which is
 * why they are in one file. The brief must NAME the manager -- that is the
 * defect -- and it must not promise a channel that does not exist.
 *
 * BOTH HALVES MOVED WHEN THE CHANNEL BECAME REAL, and the second one is now the
 * sharper test. This file used to pin the sentence "there is no direct message
 * channel to another agent on this computer", which was TRUE: the product's
 * messenger is cross-machine and refuses a local recipient by design, so on a
 * one-machine installation a brief mentioning it would have sent a child to
 * call a number that never rings. There is now a local channel, so the brief
 * names it -- and the pin becomes the harder question. It is no longer "does
 * the brief stay silent" but "is the tool the brief names actually registered
 * and actually allowed at the level this computer runs at". A promise checked
 * against the registry cannot rot into the old defect quietly.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { composeNodeBrief, nodeManagerContext } from '../../src/tree-node-brief.js'

test('a child is told who its manager is, by the name on the canvas', () => {
  const text = composeNodeBrief({ message: 'Count the files.', selfName: 'Default', parentName: 'Manager' })
  assert.match(text, /your manager is "Manager"/)
  assert.match(text, /Tree address: you are "Default", and your manager is "Manager"\./)
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
  assert.match(text, /No agent manages you/)
  assert.match(text, /You report to the person running this tree\./)
  assert.match(text, /Tree address: you are "Coordinator", at the top of your tree\./)
  assert.doesNotMatch(text, /and your manager is/)
})

test('a child is told, by name, the tool that reaches its manager', () => {
  const text = composeNodeBrief({ message: 'Go.', selfName: 'Default', parentName: 'Manager' })
  assert.match(text, /agent_comms\.send_local/)
  assert.match(text, /from "Default"/)
  assert.match(text, /to "Manager"/)
  /* The old sentence is gone and must not creep back on any path: it is now
     false, and a false disclaimer is worse than none because an agent believes
     it and stops trying. */
  assert.doesNotMatch(text, /no direct message channel/)
})

test('the brief states the limit of the channel rather than overselling it', () => {
  const text = composeNodeBrief({ message: 'Go.', selfName: 'Default', parentName: 'Manager' })
  assert.match(text, /and nobody else/)
  assert.match(text, /permission level does not allow it/)
})

test('the CROSS-MACHINE messenger is still never OFFERED, on any path', () => {
  /* agent_comms.send is unchanged and still answers accepted:false with a code
     meaning "pick a recipient on another machine". Only the LOCAL sibling may be
     offered in a brief; offering the other one would be the product inventing a
     capability, which is the original defect wearing new words.

     "OFFERED", NOT "NAMED", AND THE DIFFERENCE WAS MEASURED. This used to pin
     that agent_comms.read never appears at all. Then a real model, driven on a
     packaged build, sent its question and reached for agent_comms.read to
     collect the answer -- the cross-machine reader, which has no local mode --
     failed on the relay credential, and told the person the channel was
     broken. The brief now names that tool precisely to say DO NOT call it. A
     pin on the bare name would forbid the warning while permitting the trap.
     What is forbidden is telling an agent to CALL it.

     AND THE OLD ASSERTION WAS A NO-OP. It read /agent_comms\.send\b/ in the
     editor and carried a literal BACKSPACE byte where \b should have been -- a
     text-mode patch consumed the escape -- so it matched nothing and had
     guarded nothing since it was written. Byte-exact now, and the assertion
     below fails first if the brief ever offers the wrong tool. */
  for (const options of [
    { message: 'Go.', selfName: 'Default', parentName: 'Manager' },
    { message: 'Go.', selfName: 'Coordinator' },
  ]) {
    const text = composeNodeBrief(options)
    assert.doesNotMatch(text, /call agent_comms\.send\b/, 'the brief tells an agent to call the messenger that refuses local recipients')
    /* An OFFER reads "call X with ..."; the warning reads "Do not call X to ...".
       The negative pins the offering form so the warning is allowed to exist. */
    assert.doesNotMatch(text, /(?<!not )call agent_comms\.(read|acknowledge)\b/, 'the brief tells an agent to call a cross-machine reader for a local reply')
    /* And the warning is present, because the trap was hit on a real run. */
    assert.match(text, /Do not call agent_comms\.read/)
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
  assert.ok(offered.length <= 12, 'the brief grew another clause; check it names a channel that really works')
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
