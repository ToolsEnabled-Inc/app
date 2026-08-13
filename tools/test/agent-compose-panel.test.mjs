/* THE PANEL THAT COLLECTS A ROLE AND A BRIEF, PROVEN WITHOUT A BROWSER.
 *
 * src/agent-compose-panel.js is the right-side panel a person fills in after
 * pressing an empty node in the fleet tree. Everything interesting about it is
 * a REFUSAL or an EMPTY STATE -- no role picked, no message written, the
 * caller's start failing halfway -- and those are exactly the states a
 * screenshot is worst at catching and a unit test is best at.
 *
 * THE SUITE'S SHARPEST ASSERTION IS ABOUT THE WORDS. src/fleet-tree-copy.js owns
 * every sentence in this flow, and a panel that quietly writes its own is how a
 * flow ends up with six voices. So one test walks the rendered panel and refuses
 * any text that is not one of that module's strings. It is written against the
 * RENDERED OUTPUT rather than the source, because a copy test that reads source
 * text passes when the table is right and the lookup is wrong.
 *
 * WHAT THIS SUITE CANNOT SEE, said plainly so nobody reads more into a green
 * run than is there: it cannot tell whether the panel is ever MOUNTED in the
 * shipped application, and it cannot measure a real focus ring or a real tab
 * order. The first belongs to whichever view wires it up; the second belongs to
 * tools/a11y-keyboard-qa.mjs, which drives the packaged window with real key
 * events. What is proven here is that every control is a real focusable element
 * with a label bound to it, which is the part a harness cannot repair later.
 *
 * THE FAKE DOM IS SMALL ON PURPOSE, in the idiom of
 * tools/test/settings-recovery-notice.test.mjs: it supports exactly what the
 * module uses, so a call to anything else fails loudly instead of being absorbed
 * by a permissive stub. It does implement event BUBBLING, because the panel's
 * Escape handler sits on the root and reads a key press that happened in the
 * message box -- a fake without bubbling would let that test pass while the real
 * panel ignored the key.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { findingsInText } from '../check-plain-language.mjs'
import { visibleTextFrom, withoutComments } from '../lib/user-visible-strings.mjs'
import { ROLES } from '../../src/vocab.js'
import {
  DEFAULT_TIER,
  FIRST_ROLE_SUGGESTION,
  ROLE_CHOICES,
  START_PANEL,
  START_REFUSAL,
  TIER_CHOICES,
  roleLabel,
  startingLine,
} from '../../src/fleet-tree-copy.js'
import {
  assignableRoles,
  composeDraftProblems,
  mountAgentComposePanel,
} from '../../src/agent-compose-panel.js'

const MODULE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'agent-compose-panel.js',
)

/* The name of the pressed node, wherever a test needs one. It is the only piece
   of caller text this panel renders, and it is rendered only inside the copy
   module's own sentence. */
const PRESSED_NODE_NAME = 'Nova'

/* Every string this flow is allowed to say, flattened out of the copy module.
   Assembled from its exports rather than retyped: a sentence reworded there
   must not be able to fail this suite. START_PANEL.underNamed is a FUNCTION --
   a name goes in and a whole sentence comes out -- so it is called rather than
   listed, which is also the proof that a bare name could never match. */
const APPROVED_WORDS = new Set([
  ...Object.values(START_PANEL).filter(value => typeof value === 'string'),
  START_PANEL.underNamed(PRESSED_NODE_NAME),
  ...Object.values(START_REFUSAL),
  FIRST_ROLE_SUGGESTION.line,
  ...ROLE_CHOICES.map(choice => choice.label),
  ...ROLE_CHOICES.map(choice => choice.summary),
  ...ROLE_CHOICES.map(choice => startingLine(choice.role)),
  ...TIER_CHOICES.map(choice => choice.label),
])

class FakeElement {
  constructor(doc, tagName) {
    this.ownerDocument = doc
    this.tagName = String(tagName).toUpperCase()
    this.children = []
    this.parentNode = null
    this.attributes = new Map()
    this.listeners = new Map()
    this.className = ''
    this.value = ''
    this.disabled = false
    this.type = ''
    this._text = ''
  }

  set textContent(value) {
    this._text = String(value)
    this.children = []
  }

  get textContent() {
    return this.children.length ? this.children.map(child => child.textContent).join('') : this._text
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null }
  removeAttribute(name) { this.attributes.delete(name) }
  hasAttribute(name) { return this.attributes.has(name) }

  appendChild(child) {
    child.parentNode = this
    this.children.push(child)
    return child
  }

  removeChild(child) {
    this.children = this.children.filter(entry => entry !== child)
    child.parentNode = null
    return child
  }

  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, [])
    this.listeners.get(name).push(listener)
  }

  /* Fires on this node and then on every ancestor, which is what a real event
     does and what the panel's root-level Escape handler depends on. */
  dispatch(name, event = {}) {
    let node = this
    while (node) {
      for (const listener of node.listeners.get(name) || []) listener(event)
      node = node.parentNode
    }
  }

  focus() { this.ownerDocument.activeElement = this }

  find(predicate) {
    if (predicate(this)) return this
    for (const child of this.children) {
      const hit = child.find(predicate)
      if (hit) return hit
    }
    return null
  }

  findAll(predicate, into = []) {
    if (predicate(this)) into.push(this)
    for (const child of this.children) child.findAll(predicate, into)
    return into
  }
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement(this, 'body')
    this.activeElement = null
  }

  createElement(tagName) { return new FakeElement(this, tagName) }
}

function open(options = {}) {
  const doc = new FakeDocument()
  const container = doc.createElement('div')
  doc.body.appendChild(container)
  const calls = { submitted: [], cancelled: 0 }
  const handle = mountAgentComposePanel({
    doc,
    container,
    onSubmit: draft => { calls.submitted.push(draft); return options.answer },
    onCancel: () => { calls.cancelled += 1 },
    ...options,
  })
  return { doc, container, handle, calls }
}

const fieldNamed = (handle, name) => handle.element().find(node => node.getAttribute('data-compose-field') === name)
const problemFor = (handle, name) => handle.element().find(node => node.getAttribute('data-compose-problem') === name)
const actionNamed = (handle, name) => handle.element().find(node => node.getAttribute('data-compose-action') === name)
const noticeLine = handle => handle.element().find(node => node.getAttribute('data-compose-notice') === 'panel')
const statusLine = handle => handle.element().find(node => node.getAttribute('data-compose-status') === 'panel')
const summaryLine = handle => handle.element().find(node => node.getAttribute('data-compose-summary') === 'role')

function fill(handle, { role, tier, message }) {
  if (role !== undefined) fieldNamed(handle, 'role').value = role
  if (tier !== undefined) fieldNamed(handle, 'tier').value = tier
  if (message !== undefined) fieldNamed(handle, 'message').value = message
}

/* Every word on screen, leaf by leaf. Elements with children are skipped
   because their text is their children's, counted already. */
const wordsOnScreen = handle => handle.element()
  .findAll(node => node.children.length === 0)
  .map(node => node.textContent.trim())
  .filter(Boolean)

/* ---------- the words are the copy module's, and nobody else's ---------- */

test('every word this panel puts on screen comes from the flow’s own copy', () => {
  for (const parent of [null, { id: 'node-17' }, { id: 'node-17', name: PRESSED_NODE_NAME }]) {
    const { handle } = open({ parent })
    const strays = wordsOnScreen(handle).filter(words => !APPROVED_WORDS.has(words))
    assert.deepEqual(strays, [], 'these sentences were written in the panel instead of src/fleet-tree-copy.js')
    assert.ok(wordsOnScreen(handle).length >= 6, 'nothing was read, so nothing was measured')
  }
})

test('the refusals and the picked role’s line are the copy module’s too', () => {
  const { handle } = open()
  actionNamed(handle, 'submit').dispatch('click')

  assert.equal(problemFor(handle, 'role').textContent, START_PANEL.needRole)
  assert.equal(problemFor(handle, 'message').textContent, START_PANEL.needMessage)
  assert.deepEqual(wordsOnScreen(handle).filter(words => !APPROVED_WORDS.has(words)), [])

  fill(handle, { role: 'manager' })
  fieldNamed(handle, 'role').dispatch('change')
  assert.deepEqual(wordsOnScreen(handle).filter(words => !APPROVED_WORDS.has(words)), [])
})

test('the panel’s own labels and buttons are the flow’s, word for word', () => {
  const { handle } = open()

  assert.equal(handle.element().find(node => node.className === 'agent-compose-title').textContent, START_PANEL.title)
  assert.equal(handle.element().find(node => node.className === 'agent-compose-intro').textContent, START_PANEL.intro)
  assert.equal(actionNamed(handle, 'submit').textContent, START_PANEL.submit)
  assert.equal(actionNamed(handle, 'cancel').textContent, START_PANEL.cancel)
  assert.equal(fieldNamed(handle, 'message').getAttribute('placeholder'), START_PANEL.messagePlaceholder)
})

/* ---------- the roles come from the product, and only labels are shown ---------- */

test('the roles offered are the flow’s own pick list, labelled from the product’s vocabulary', () => {
  const roles = assignableRoles()

  assert.deepEqual(roles.map(role => role.id), ROLE_CHOICES.map(choice => choice.role))
  for (const role of roles) {
    assert.equal(role.label, ROLES[role.id].label, 'a label was invented instead of read from the vocabulary')
  }
  // "Agent spawned" is what an agent BECOMES when another agent starts it. The
  // copy module leaves it out of the picker on purpose, and this panel defers.
  assert.ok(!roles.some(role => role.id === 'spawned'))
})

test('a caller may narrow the list, by key alone, and no key is ever printed for it', () => {
  const narrowed = assignableRoles(['manager', 'helper'])
  assert.deepEqual(narrowed.map(role => role.label), [roleLabel('manager'), roleLabel('helper')])

  // A role this build has no entry for is named by the product's own fallback
  // word, never by its key.
  const unknown = assignableRoles([{ id: 'admiral' }])
  assert.deepEqual(unknown.map(role => role.label), ['Agent'])
  assert.doesNotMatch(unknown[0].label, /admiral/)
})

test('a caller that hands over nothing gets the product’s list rather than an empty menu', () => {
  // A form nobody can complete would need a sentence saying why, and that
  // sentence does not exist in the copy module. A caller passing nothing is a
  // wiring fault, not a state a person can press their way into.
  assert.deepEqual(assignableRoles([]), assignableRoles(ROLE_CHOICES))
  assert.deepEqual(assignableRoles(null), assignableRoles(ROLE_CHOICES))
})

test('every choice on screen is a label, and no role key is anywhere in the panel’s text', () => {
  const { handle } = open()
  const options = handle.element().findAll(node => node.tagName === 'OPTION')

  assert.equal(options.length, ROLE_CHOICES.length + 1 + TIER_CHOICES.length,
    'every role plus the prompt row, and every tier')
  const roleOptions = fieldNamed(handle, 'role').children
  assert.equal(roleOptions[0].textContent, START_PANEL.rolePrompt)
  assert.equal(roleOptions[0].value, '', 'the panel opens with nothing chosen, so a press cannot pass a role nobody picked')
  assert.deepEqual(roleOptions.slice(1).map(option => option.textContent), ROLE_CHOICES.map(choice => choice.label))
  // The key travels on the value, where only the program reads it.
  assert.deepEqual(roleOptions.slice(1).map(option => option.value), ROLE_CHOICES.map(choice => choice.role))

  /* KEY-AS-A-WORD IS NOT KEY-AS-A-KEY, and the difference decides this test.
     The suggestion line reads "A coordinator sits at the top of a tree" -- that
     is the English word inside a sentence somebody wrote, and banning it would
     be banning the copy module's own prose. What must never happen is a key
     STANDING IN FOR A LABEL, which is a whole piece of text that IS the key. */
  for (const words of wordsOnScreen(handle)) {
    assert.ok(!Object.keys(ROLES).includes(words), `the key ${words} is standing where a label should be`)
    assert.ok(!TIER_CHOICES.some(choice => choice.id === words), `the tier id ${words} is standing where a label should be`)
  }
})

test('choosing a role shows that role’s own line, and only that one', () => {
  const { handle } = open()
  assert.equal(summaryLine(handle).textContent, '', 'nothing is chosen, so nothing is claimed')

  fill(handle, { role: 'manager' })
  fieldNamed(handle, 'role').dispatch('change')
  assert.equal(summaryLine(handle).textContent, ROLE_CHOICES.find(choice => choice.role === 'manager').summary)

  fill(handle, { role: 'shadow' })
  fieldNamed(handle, 'role').dispatch('change')
  assert.equal(summaryLine(handle).textContent, ROLE_CHOICES.find(choice => choice.role === 'shadow').summary)
})

/* ---------- which node was pressed ---------- */

test('an empty tree is offered the suggestion about shape, and nothing is pre-picked', () => {
  const { handle } = open({ parent: null })
  const suggestion = handle.element().find(node => node.getAttribute('data-compose-suggestion') === 'first-role')

  assert.equal(suggestion.textContent, FIRST_ROLE_SUGGESTION.line)
  assert.equal(fieldNamed(handle, 'role').value, '', 'a suggestion that picks for you is not a suggestion')
})

test('a tree that already has agents is not given the first-agent suggestion', () => {
  const { handle } = open({ parent: { id: 'node-17' } })

  assert.equal(handle.element().find(node => node.getAttribute('data-compose-suggestion') === 'first-role'), null)
})

test('a named node is named, inside the flow’s own sentence', () => {
  const { handle } = open({ parent: { id: 'node-17', name: PRESSED_NODE_NAME } })
  const under = handle.element().find(node => node.getAttribute('data-compose-under') === 'parent')

  assert.equal(under.textContent, START_PANEL.underNamed(PRESSED_NODE_NAME))
  // A bare name is a fragment a reader has to guess the meaning of. It never
  // appears without the sentence around it.
  assert.notEqual(under.textContent, PRESSED_NODE_NAME)
})

test('a node this app cannot name gets the sentence written for that, never a blank line', () => {
  const { handle } = open({ parent: { id: 'node-17' } })
  const under = handle.element().find(node => node.getAttribute('data-compose-under') === 'parent')

  assert.equal(under.textContent, START_PANEL.underUnnamed)
})

test('the pressed node’s id travels in the draft and is never rendered', () => {
  const { handle, calls } = open({ parent: { id: 'node-17', name: PRESSED_NODE_NAME } })
  assert.doesNotMatch(handle.element().textContent, /node-17/, 'an id in a sentence is the defect the gate exists to catch')

  fill(handle, { role: 'manager', message: 'Take the packaging work.' })
  actionNamed(handle, 'submit').dispatch('click')
  assert.deepEqual(calls.submitted, [{ role: 'manager', tier: DEFAULT_TIER, message: 'Take the packaging work.', parentId: 'node-17' }])
})

test('a node’s name is put on the page as text, never as markup', () => {
  const hostile = '<img src=x onerror=alert(1)>'
  const { handle } = open({ parent: { id: 'node-17', name: hostile } })
  const under = handle.element().find(node => node.getAttribute('data-compose-under') === 'parent')

  // A node name is chosen by nobody on this team. The panel builds elements and
  // assigns textContent rather than concatenating markup, so these are
  // characters.
  assert.equal(under.textContent, START_PANEL.underNamed(hostile))
  assert.equal(under.children.length, 0)
})

test('an empty tree is told nothing about a parent it does not have', () => {
  const { handle } = open({ parent: null })

  assert.equal(handle.element().find(node => node.getAttribute('data-compose-under') === 'parent'), null)
})

test('no parent at all means this begins a new tree, and the draft carries no parent', () => {
  const { handle, calls } = open({ parent: null })
  fill(handle, { role: 'manager', message: 'Take the packaging work.' })
  actionNamed(handle, 'submit').dispatch('click')

  assert.deepEqual(calls.submitted, [{ role: 'manager', tier: DEFAULT_TIER, message: 'Take the packaging work.', parentId: null }])
})

/* ---------- handing the draft back ---------- */

test('a complete draft is handed to the caller as role, message and parent', () => {
  const { handle, calls } = open({ parent: { id: 'node-17' } })
  fill(handle, { role: 'shadow', message: '  Watch the release branch.\nReport twice a day.  ' })
  actionNamed(handle, 'submit').dispatch('click')

  assert.deepEqual(calls.submitted, [{
    role: 'shadow',
    /* The tier the person did not touch is the default, stated -- never absent.
       An absent tier would make the model choice fall to whatever the engine
       happens to be set to, silently, which is the pre-4204332 defect. */
    tier: DEFAULT_TIER,
    // Trimmed at the ends and nowhere else: the line break is the person's.
    message: 'Watch the release branch.\nReport twice a day.',
    parentId: 'node-17',
  }])
})

test('a picked model rides in the draft, Claude rows included', () => {
  /* The three Claude rows are offered so a chosen model can never quietly
     become Codex; the shell refuses them by name (AGENT_TIER_NO_LAUNCHER) and
     the refusal only exists if the picked id actually reaches the draft. */
  const { handle, calls } = open({ parent: { id: 'node-17' } })
  fill(handle, { role: 'manager', tier: 'claude-fable', message: 'Take the packaging work.' })
  actionNamed(handle, 'submit').dispatch('click')

  assert.deepEqual(calls.submitted, [{ role: 'manager', tier: 'claude-fable', message: 'Take the packaging work.', parentId: 'node-17' }])
})

test('the model menu preselects the default and offers the six tiers by label', () => {
  const { handle } = open()
  const menu = fieldNamed(handle, 'tier')
  assert.equal(menu.value, DEFAULT_TIER)
  const options = menu.children
  assert.deepEqual(options.map(option => option.value), TIER_CHOICES.map(choice => choice.id))
  assert.deepEqual(options.map(option => option.textContent), TIER_CHOICES.map(choice => choice.label))
})

test('a complete draft closes the panel, so the same work cannot be handed over twice', () => {
  const { handle, container } = open({ parent: { id: 'node-17' } })
  fill(handle, { role: 'manager', message: 'Take the packaging work.' })
  actionNamed(handle, 'submit').dispatch('click')

  assert.equal(handle.element(), null)
  assert.equal(container.children.length, 0)
})

test('re-opening over another node starts from an empty draft', () => {
  const { handle, calls } = open({ parent: { id: 'node-17' } })
  fill(handle, { role: 'manager', message: 'Take the packaging work.' })

  handle.open({ parent: { id: 'node-18' } })
  /* Empty means unanswered questions are unanswered again; the model question
     arrives answered by the product default, so the default IS its empty. */
  assert.deepEqual(handle.draft(), { role: '', tier: DEFAULT_TIER, message: '', parentId: 'node-18' })

  fill(handle, { role: 'helper', message: 'Second brief.' })
  actionNamed(handle, 'submit').dispatch('click')
  assert.deepEqual(calls.submitted, [{ role: 'helper', tier: DEFAULT_TIER, message: 'Second brief.', parentId: 'node-18' }])
})

/* ---------- refusing an incomplete draft ---------- */

test('an empty role is refused with the flow’s sentence, and the message is not accused', () => {
  const { handle, calls } = open()
  fill(handle, { role: '', message: 'Take the packaging work.' })
  actionNamed(handle, 'submit').dispatch('click')

  assert.deepEqual(calls.submitted, [], 'nothing is handed over')
  assert.equal(problemFor(handle, 'role').textContent, START_PANEL.needRole)
  assert.equal(problemFor(handle, 'message').textContent, '')
  assert.equal(fieldNamed(handle, 'role').getAttribute('aria-invalid'), 'true')
  assert.equal(fieldNamed(handle, 'message').getAttribute('aria-invalid'), null)
})

test('an empty message is refused by its own sentence', () => {
  const { handle, calls } = open()
  fill(handle, { role: 'manager', message: '   \n  ' })
  actionNamed(handle, 'submit').dispatch('click')

  assert.deepEqual(calls.submitted, [])
  assert.equal(problemFor(handle, 'message').textContent, START_PANEL.needMessage)
  assert.equal(problemFor(handle, 'role').textContent, '')
})

test('both missing means both sentences, and focus lands on the first thing to fix', () => {
  const { doc, handle } = open()
  actionNamed(handle, 'submit').dispatch('click')

  assert.equal(problemFor(handle, 'role').textContent, START_PANEL.needRole)
  assert.equal(problemFor(handle, 'message').textContent, START_PANEL.needMessage)
  assert.equal(doc.activeElement, fieldNamed(handle, 'role'))
})

test('with only the message missing, focus goes to the message box', () => {
  const { doc, handle } = open()
  fill(handle, { role: 'manager', message: '' })
  actionNamed(handle, 'submit').dispatch('click')

  assert.equal(doc.activeElement, fieldNamed(handle, 'message'))
})

test('a role that is not on the list is refused rather than handed on', () => {
  assert.deepEqual(composeDraftProblems({ role: 'admiral', message: 'Do the thing.' }), [{
    field: 'role',
    sentence: START_PANEL.needRole,
  }])

  const { handle, calls } = open()
  fill(handle, { role: 'admiral', message: 'Do the thing.' })
  actionNamed(handle, 'submit').dispatch('click')
  assert.deepEqual(calls.submitted, [])
})

test('a complete draft has nothing to say about it', () => {
  assert.deepEqual(composeDraftProblems({ role: 'manager', message: 'Take the packaging work.' }), [])
})

test('editing a field clears the refusal about that field only', () => {
  const { handle } = open()
  actionNamed(handle, 'submit').dispatch('click')
  assert.notEqual(problemFor(handle, 'role').textContent, '')

  fieldNamed(handle, 'role').value = 'manager'
  fieldNamed(handle, 'role').dispatch('change')

  assert.equal(problemFor(handle, 'role').textContent, '')
  assert.equal(fieldNamed(handle, 'role').getAttribute('aria-invalid'), null)
  assert.equal(problemFor(handle, 'message').textContent, START_PANEL.needMessage, 'the message is still empty and still says so')
})

/* ---------- discarding the draft ---------- */

test('cancel discards the draft, takes the panel off the page and tells the caller', () => {
  const { handle, container, calls } = open({ parent: { id: 'node-17' } })
  fill(handle, { role: 'manager', message: 'Take the packaging work.' })

  actionNamed(handle, 'cancel').dispatch('click')

  assert.equal(calls.cancelled, 1)
  assert.equal(handle.element(), null)
  assert.equal(container.children.length, 0)

  handle.open({ parent: { id: 'node-17' } })
  assert.deepEqual(handle.draft(), { role: '', tier: DEFAULT_TIER, message: '', parentId: 'node-17' })
})

test('Escape from inside the panel discards the draft the same way', () => {
  const { handle, calls } = open()
  fill(handle, { role: 'manager', message: 'Take the packaging work.' })

  // Pressed in the message box, handled on the root. A person typing a brief
  // must not have to go and find the Cancel button with the Tab key.
  fieldNamed(handle, 'message').dispatch('keydown', { key: 'Escape', preventDefault() {} })

  assert.equal(calls.cancelled, 1)
  assert.equal(handle.element(), null)
})

test('an ordinary key press is not a cancel', () => {
  const { handle, calls } = open()
  fieldNamed(handle, 'message').dispatch('keydown', { key: 'e', preventDefault() {} })

  assert.equal(calls.cancelled, 0)
  assert.notEqual(handle.element(), null)
})

test('closing is not cancelling, so the caller is not told twice', () => {
  const { handle, calls } = open()
  handle.close()

  assert.equal(handle.element(), null)
  assert.equal(calls.cancelled, 0)
})

/* ---------- while the caller is starting, and when it fails ---------- */

function deferred() {
  let settle
  const promise = new Promise(resolve => { settle = resolve })
  return { promise, resolve: settle }
}

test('while the agent is starting, nothing can be pressed and the wait names the role', () => {
  const pending = deferred()
  const { handle, calls } = open({ answer: pending.promise })
  fill(handle, { role: 'manager', message: 'Take the packaging work.' })
  actionNamed(handle, 'submit').dispatch('click')

  assert.equal(actionNamed(handle, 'submit').disabled, true)
  assert.equal(actionNamed(handle, 'cancel').disabled, true, 'cancelling mid-start would discard a draft whose agent is already starting')
  assert.equal(fieldNamed(handle, 'message').disabled, true)
  assert.equal(statusLine(handle).textContent, startingLine('manager'))

  actionNamed(handle, 'submit').dispatch('click')
  assert.equal(calls.submitted.length, 1, 'a second press does not start the same agent twice')
})

test('a caller that refuses puts its own refusal sentence on the panel and keeps the draft', async () => {
  const pending = deferred()
  const { handle } = open({ answer: pending.promise })
  fill(handle, { role: 'manager', message: 'Take the packaging work.' })
  actionNamed(handle, 'submit').dispatch('click')

  pending.resolve({ ok: false, message: START_REFUSAL.everyAgentBusy })
  await pending.promise

  assert.notEqual(handle.element(), null, 'the panel stays, because the person has to be able to try again')
  assert.equal(noticeLine(handle).textContent, START_REFUSAL.everyAgentBusy)
  assert.equal(noticeLine(handle).getAttribute('role'), 'alert')
  assert.equal(actionNamed(handle, 'submit').disabled, false)
  assert.deepEqual(handle.draft(), { role: 'manager', tier: DEFAULT_TIER, message: 'Take the packaging work.', parentId: null })
})

test('a refusal that arrives with no words still gets the flow’s sentence', async () => {
  const pending = deferred()
  const { handle } = open({ answer: pending.promise })
  fill(handle, { role: 'manager', message: 'Take the packaging work.' })
  actionNamed(handle, 'submit').dispatch('click')

  pending.resolve({ ok: false })
  await pending.promise

  assert.equal(noticeLine(handle).textContent, START_REFUSAL.noReasonGiven)
})

test('a caller that throws is reported as a sentence, never as the error’s own words', async () => {
  const { handle } = open({ onSubmit: () => { throw new Error('ENOENT: agent runner is not a function') } })
  fill(handle, { role: 'manager', message: 'Take the packaging work.' })
  actionNamed(handle, 'submit').dispatch('click')
  await Promise.resolve()

  assert.equal(noticeLine(handle).textContent, START_REFUSAL.noReasonGiven)
  assert.doesNotMatch(noticeLine(handle).textContent, /ENOENT/)
  assert.notEqual(handle.element(), null)
})

test('a promise that rejects says the same sentence and lets the person try again', async () => {
  const rejection = Promise.reject(new Error('the connection closed'))
  const { handle } = open({ answer: rejection })
  fill(handle, { role: 'manager', message: 'Take the packaging work.' })
  actionNamed(handle, 'submit').dispatch('click')
  await rejection.catch(() => {})
  await Promise.resolve()

  assert.equal(noticeLine(handle).textContent, START_REFUSAL.noReasonGiven)
  assert.equal(actionNamed(handle, 'submit').disabled, false)
})

test('with nothing wired to receive the draft, the person is told it is a fault and not their doing', () => {
  const { handle } = open({ onSubmit: null })
  fill(handle, { role: 'manager', message: 'Take the packaging work.' })
  actionNamed(handle, 'submit').dispatch('click')

  assert.equal(noticeLine(handle).textContent, START_REFUSAL.notWired)
  /* NOT the sentence for a start that failed. That one says "try once more",
     and pressing again against a panel with no receiver can never work -- a
     loop with no exit is the dead end this flow's copy exists to remove. */
  assert.notEqual(noticeLine(handle).textContent, START_REFUSAL.noReasonGiven)
  assert.doesNotMatch(noticeLine(handle).textContent, /Try once more/)
})

test('the prompt row is a place to stand and never an answer', () => {
  const { handle, calls } = open()
  // The prompt is what a person sees before they choose; choosing it back again
  // must not become a way past the refusal.
  fill(handle, { role: '', message: 'Take the packaging work.' })
  actionNamed(handle, 'submit').dispatch('click')

  assert.deepEqual(calls.submitted, [])
  assert.equal(problemFor(handle, 'role').textContent, START_PANEL.needRole)
  assert.deepEqual(composeDraftProblems({ role: START_PANEL.rolePrompt, message: 'x' }), [{
    field: 'role',
    sentence: START_PANEL.needRole,
  }], 'the prompt’s own words are not a role either')
})

test('a caller may report a failure later, through the handle', () => {
  const { handle } = open()
  fill(handle, { role: 'manager', message: 'Take the packaging work.' })

  handle.showProblem(START_REFUSAL.enginePartMissing)

  assert.equal(noticeLine(handle).textContent, START_REFUSAL.enginePartMissing)
  assert.equal(noticeLine(handle).getAttribute('role'), 'alert')
})

test('a failure reported through the handle is not undone by a late success', async () => {
  const pending = deferred()
  const { handle } = open({ answer: pending.promise })
  fill(handle, { role: 'manager', message: 'Take the packaging work.' })
  actionNamed(handle, 'submit').dispatch('click')

  handle.showProblem(START_REFUSAL.everyAgentBusy)
  pending.resolve(undefined)
  await pending.promise

  // The panel closing out from under a failure the person is reading is the
  // worst version of this: they see the words, then the form vanishes.
  assert.notEqual(handle.element(), null)
  assert.equal(noticeLine(handle).textContent, START_REFUSAL.everyAgentBusy)
})

test('a late answer about a node the person has moved on from is dropped', async () => {
  const pending = deferred()
  const { handle } = open({ parent: { id: 'node-17' }, answer: pending.promise })
  fill(handle, { role: 'manager', message: 'Take the packaging work.' })
  actionNamed(handle, 'submit').dispatch('click')

  handle.open({ parent: { id: 'node-18' } })
  pending.resolve({ ok: false, message: START_REFUSAL.everyAgentBusy })
  await pending.promise

  // A refusal about the previous node, painted onto a panel the person has
  // since opened over a different one, is a sentence about the wrong tree.
  assert.equal(noticeLine(handle).textContent, '')
  assert.deepEqual(handle.draft(), { role: '', tier: DEFAULT_TIER, message: '', parentId: 'node-18' })
})

/* ---------- stated absences ---------- */

test('a caller’s reason switches the fields off, keeps cancel live, and refuses to submit', () => {
  const { handle, calls } = open({ unavailableReason: START_REFUSAL.assistantProgramMissing })

  assert.equal(noticeLine(handle).textContent, START_REFUSAL.assistantProgramMissing)
  assert.equal(actionNamed(handle, 'submit').disabled, true)
  assert.equal(fieldNamed(handle, 'role').disabled, true)
  assert.equal(actionNamed(handle, 'cancel').disabled, false, 'a panel a person cannot close is worse than the refusal')

  actionNamed(handle, 'submit').dispatch('click')
  assert.deepEqual(calls.submitted, [])

  actionNamed(handle, 'cancel').dispatch('click')
  assert.equal(calls.cancelled, 1)
})

test('a reason that has cleared lets the panel work again', () => {
  const { handle } = open({ unavailableReason: START_REFUSAL.assistantProgramMissing })
  handle.open({ unavailableReason: '' })

  assert.equal(noticeLine(handle).textContent, '')
  assert.equal(actionNamed(handle, 'submit').disabled, false)
  assert.equal(fieldNamed(handle, 'role').disabled, false)
})

/* ---------- it is a component, and it can be worked with a keyboard ---------- */

test('every field is a real control with its own label bound by id', () => {
  const { handle } = open()
  const labels = handle.element().findAll(node => node.tagName === 'LABEL')

  for (const name of ['role', 'message']) {
    const field = fieldNamed(handle, name)
    const id = field.getAttribute('id')
    assert.ok(id, `${name} has no id, so no label can point at it`)
    const label = labels.find(entry => entry.getAttribute('for') === id)
    assert.ok(label, `${name} has no label bound to it`)
    assert.notEqual(label.textContent.trim(), '', `${name} has an empty label`)
    // The description carries the hint AND the refusal line, so a screen reader
    // reads the problem when focus lands on the field that has it.
    assert.equal(field.getAttribute('aria-describedby'), `${id}-hint ${id}-problem`)
    assert.equal(problemFor(handle, name).getAttribute('id'), `${id}-problem`)
    assert.equal(problemFor(handle, name).getAttribute('role'), 'alert')
  }

  assert.equal(fieldNamed(handle, 'role').tagName, 'SELECT')
  assert.equal(fieldNamed(handle, 'message').tagName, 'TEXTAREA')
  for (const name of ['submit', 'cancel']) {
    const button = actionNamed(handle, name)
    assert.equal(button.tagName, 'BUTTON', `${name} must be a button, not a div wearing a click handler`)
    assert.equal(button.getAttribute('type'), 'button')
    assert.notEqual(button.textContent.trim(), '')
  }
})

test('the panel is named for a screen reader by its own title', () => {
  const { handle } = open()
  const root = handle.element()
  const titleId = root.getAttribute('aria-labelledby')

  assert.ok(titleId)
  assert.equal(root.find(node => node.getAttribute('id') === titleId).textContent, START_PANEL.title)
})

test('two panels on one page do not share an id', () => {
  const first = open()
  const second = open()

  assert.notEqual(
    fieldNamed(first.handle, 'role').getAttribute('id'),
    fieldNamed(second.handle, 'role').getAttribute('id'),
  )
})

test('focus can be handed to the panel by a caller that opened it from a key press', () => {
  const { doc, handle } = open()
  handle.focus()

  assert.equal(doc.activeElement, fieldNamed(handle, 'role'))
})

test('destroy takes it off the page for good', () => {
  const { handle, container } = open()
  handle.destroy()

  assert.equal(container.children.length, 0)
  assert.equal(handle.open({ parent: null }), null, 'a destroyed panel does not come back')
})

test('with nowhere to mount, it builds nothing rather than choosing a page for itself', () => {
  assert.equal(mountAgentComposePanel({ doc: new FakeDocument(), container: null }), null)
  assert.equal(mountAgentComposePanel({ doc: null, container: {} }), null)
})

test('it is a pure component: no window, no starting, nothing outside the document it was given', () => {
  // The suite itself is the proof that it runs with no browser globals at all.
  assert.equal(typeof globalThis.window, 'undefined')
  assert.equal(typeof globalThis.document, 'undefined')

  // Comments blanked first. The header NAMES the things this panel must not
  // reach, so a scan over raw source would find the promise and call it the
  // breach -- the same trap tools/lib/user-visible-strings.mjs exists to avoid.
  const code = withoutComments(readFileSync(MODULE_PATH, 'utf8'))
  for (const forbidden of ['mcAgent', 'ipcRenderer', 'localStorage', 'globalThis.window', 'fetch(']) {
    assert.ok(!code.includes(forbidden), `${forbidden} has no business in this panel`)
  }
})

/* ---------- the gate ---------- */

test('every string in this module passes the plain-language gate', () => {
  const source = readFileSync(MODULE_PATH, 'utf8')
  const extracted = visibleTextFrom(source)

  assert.ok(extracted.visible.length > 0, 'nothing was extracted, so nothing was measured')
  const findings = []
  for (const entry of extracted.visible) findings.push(...findingsInText(entry.text, entry.sourceLine))
  assert.deepEqual(findings, [], findings.map(finding => `${finding.rule}: ${finding.detail}`).join('\n'))
})
