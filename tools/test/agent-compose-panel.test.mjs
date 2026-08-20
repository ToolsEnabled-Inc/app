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
  startableTierIds,
  tierChoicesFor,
  EFFORT_CHOICES,
  effortOptionLabel,
  roleLabel,
  startingLine,
} from '../../src/fleet-tree-copy.js'
import {
  assignableRoles,
  composeDraftProblems,
  mountAgentComposePanel,
} from '../../src/agent-compose-panel.js'
/* The confinement sentences are NOT this flow's copy and are deliberately not
   added to APPROVED_WORDS: they arrive as a caller-supplied line, the same door
   the refusal sentence uses, and the panel renders nothing of them by default.
   Imported here so the assertions run the real copy module rather than a
   literal that could drift away from what ships. */
import {
  FAIL_CLOSED_CLAUSE,
  SANDBOX_EFFECT,
  UNKNOWN_CONFINEMENT,
  startControlLine,
} from '../../src/agent-confinement-copy.js'

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
  ...EFFORT_CHOICES.map(choice => choice.label),
  /* The depth rows read "<provider name> — <provider sentence>", composed by
     the copy module so the panel still writes none of it. */
  ...EFFORT_CHOICES.map(choice => effortOptionLabel(choice)),
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

  /* A real browser refuses focus on a disabled control -- the call simply does
     nothing and focus stays where it was. Without modelling that, a focus()
     aimed at a switched-off field reads as landing, and the suite would bless
     a panel whose Escape is dead exactly when the form ships disabled. */
  focus() { if (this.disabled) return; this.ownerDocument.activeElement = this }

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
const confinementLineOf = handle => handle.element().find(node => node.getAttribute('data-compose-confinement') === 'panel')
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

  /* The title lives in the nav row's title slot (2026-08-14: the separate h3
     was ~30px that pushed Start below the fold of an 832px window). Found via
     the root's own aria-labelledby, the same wiring the screen-reader test
     follows, so this assertion survives any future re-homing of the words. */
  const titleId = handle.element().getAttribute('aria-labelledby')
  assert.equal(handle.element().find(node => node.getAttribute('id') === titleId).textContent, START_PANEL.title)
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

  /* THE FOLDER MENU IS THE +1 AT THE END. open() passes no parent, so this is a
     panel that would START A TREE, and a tree being started is asked where its
     agents work (owner, 2026-08-16). No folders are handed to this panel, so
     the menu holds exactly its first row -- "the product's own workspace",
     which is what every tree ran in before folders existed. */
  assert.equal(options.length, ROLE_CHOICES.length + 1 + TIER_CHOICES.length + EFFORT_CHOICES.length + 1,
    'every role plus the prompt row, every tier, every effort level, and the folder menu')
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
  assert.deepEqual(calls.submitted, [{ role: 'manager', tier: DEFAULT_TIER, effort: 'medium', message: 'Take the packaging work.', parentId: 'node-17', profileId: null }])
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

  assert.deepEqual(calls.submitted, [{ role: 'manager', tier: DEFAULT_TIER, effort: 'medium', message: 'Take the packaging work.', parentId: null, profileId: null }])
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
    effort: 'medium',
    // Trimmed at the ends and nowhere else: the line break is the person's.
    message: 'Watch the release branch.\nReport twice a day.',
    parentId: 'node-17',
    /* A start UNDER an existing agent draws no folder menu -- that tree already
       has a folder, and one nested start must not re-point it. Null here is
       that absence, and it is the same null the caller has always sent. */
    profileId: null,
  }])
})

test('a picked model rides in the draft, Claude rows included', () => {
  /* The three Claude rows are offered so a chosen model can never quietly
     become Codex; the shell refuses them by name (AGENT_TIER_NO_LAUNCHER) and
     the refusal only exists if the picked id actually reaches the draft. */
  const { handle, calls } = open({ parent: { id: 'node-17' } })
  fill(handle, { role: 'manager', tier: 'claude-fable', message: 'Take the packaging work.' })
  actionNamed(handle, 'submit').dispatch('click')

  assert.deepEqual(calls.submitted, [{ role: 'manager', tier: 'claude-fable', effort: 'medium', message: 'Take the packaging work.', parentId: 'node-17', profileId: null }])
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
  assert.deepEqual(handle.draft(), { role: '', tier: DEFAULT_TIER, effort: 'medium', message: '', parentId: 'node-18', profileId: null })

  fill(handle, { role: 'helper', message: 'Second brief.' })
  actionNamed(handle, 'submit').dispatch('click')
  assert.deepEqual(calls.submitted, [{ role: 'helper', tier: DEFAULT_TIER, effort: 'medium', message: 'Second brief.', parentId: 'node-18', profileId: null }])
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
  assert.deepEqual(handle.draft(), { role: '', tier: DEFAULT_TIER, effort: 'medium', message: '', parentId: 'node-17', profileId: null })
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

/* THE MOUSE-OPEN ORDERING, measured dead on the packaged build 2026-08-20
 * (order-drive lane): press the empty tree slot with the MOUSE, press Escape --
 * the panel stayed standing, because the view moved focus into the panel only
 * for keyboard opens, so the key landed on the page body and never bubbled
 * through this root. The panel's own contract says Escape cancels; that has to
 * hold however the panel was opened. The fix is focus placement, and these two
 * tests pin the pieces this module owns: a root a browser will accept focus on,
 * a way to focus it without moving the caret into a field, and a focus() that
 * still lands INSIDE the panel when the form ships switched off (a disabled
 * select refuses focus, and focus left outside is Escape left dead). */

test('a pointer-opened panel can hear Escape: the root takes focus and cancels', () => {
  const { doc, handle, calls } = open()
  assert.equal(handle.element().getAttribute('tabindex'), '-1',
    'the root is not programmatically focusable; a real browser would bounce focus off it')
  handle.focusRoot()
  assert.equal(doc.activeElement, handle.element(), 'focusRoot() did not move focus to the panel root')
  doc.activeElement.dispatch('keydown', { key: 'Escape', preventDefault() {} })
  assert.equal(calls.cancelled, 1)
  assert.equal(handle.element(), null)
})

test('focus() with the form switched off still lands inside the panel', () => {
  const { doc, handle } = open({ unavailableReason: 'Starting an assistant is switched off for this computer.' })
  assert.equal(fieldNamed(handle, 'role').disabled, true, 'this test is about the switched-off form')
  handle.focus()
  const inside = handle.element().find(node => node === doc.activeElement)
  assert.ok(inside, 'focus landed outside the panel; Escape would be dead there')
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
  assert.deepEqual(handle.draft(), { role: 'manager', tier: DEFAULT_TIER, effort: 'medium', message: 'Take the packaging work.', parentId: null, profileId: null })
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
  assert.deepEqual(handle.draft(), { role: '', tier: DEFAULT_TIER, effort: 'medium', message: '', parentId: 'node-18', profileId: null })
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

/* ---------- the fold ---------- */

test('the form scrolls, so Start can always be reached', () => {
  /* Owner, verbatim: "I also cant scroll down to even press start." The rail
     clips (`.rail { overflow: hidden }`) and its pages are absolutely
     positioned, so this panel can never make the rail taller — it can only
     overflow and be cut off. Twice now the answer was to buy pixels back by
     deleting content (a heading, once), and the next field spent them. The
     fix that cannot be spent is a scroller, and the class is the one every
     other rail page already scrolls with. */
  const { handle } = open()
  const body = handle.element().find(node => node.getAttribute('data-compose-body') === 'form')
  assert.ok(body, 'the panel body is gone; the form is unscrollable again')
  assert.ok(String(body.className).includes('rail-scroll'),
    'the panel body lost .rail-scroll — the class that carries flex:1, min-height:0 and overflow-y:auto')
  /* START IS PINNED BESIDE THE SCROLLER, AND BOTH FAILURES ARE PINNED HERE.
     This assertion used to demand the opposite -- that Start live INSIDE the
     scroller -- because the earlier defect was a panel that overflowed the
     clipping rail and cut the button off. Putting it in the scroller fixed
     reachability and lost VISIBILITY: measured on installed 1.0.21, the form
     wants ~765px against a rail of 560-700, so Start began ~100px below the
     fold and the owner reported, again, "there is no way to start an agent".
     A control that is off-screen at first paint is absent to the person
     looking at it.
     Beside the scroller is safe precisely because of the two rules asserted
     below: the root is a bounded flex column, so a `flex: none` row after a
     `flex: 1; min-height: 0` scroller is laid out inside the rail rather than
     past it. Keep all four assertions together -- each one alone permits one
     of the two defects. */
  const submit = actionNamed(handle, 'submit')
  assert.ok(submit, 'the Start button vanished')
  assert.ok(!body.find(node => node === submit),
    'Start went back inside the scroller, which is how it fell below the fold and read as missing')
  assert.ok(handle.element().find(node => node === submit),
    'Start left the panel entirely')
  const css = readFileSync(path.resolve(path.dirname(MODULE_PATH), 'agent-compose-panel.css'), 'utf8')
  const rootRule = css.slice(css.indexOf('.agent-compose {'), css.indexOf('.agent-compose {') + 400)
  assert.match(rootRule, /flex-direction: column/, 'the panel root stopped being a column; the body cannot own the scroll')
  assert.match(rootRule, /min-height: 0/, 'the panel root lost min-height:0 and will push its body past the clip')
  /* The pinned row is only safe while it refuses to be squeezed: without
     `flex: none` a tall form pushes it back off the bottom of the rail. */
  const actionsRule = css.slice(css.indexOf('.agent-compose-actions {'), css.indexOf('.agent-compose-actions {') + 300)
  assert.match(actionsRule, /flex: none/, 'the action row can be squeezed again; Start returns to below the fold')
  assert.ok(!/\.agent-compose-text \{[^}]*resize: vertical/s.test(css),
    'the message box can be dragged taller again, which only deepens the clip')
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

/* ------------------------------------------------------------------------
   WHICH ENGINES THE MENU SAYS IT CAN START, AND WHO DECIDES.

   The renderer used to decide this itself, from a frozen ['codex'] in
   src/fleet-tree-copy.js. The shell's tier gate now opens on the payload
   genuinely carrying an engine, so a build WITH the Claude engine would start a
   Claude tier while these rows went on saying it could not -- a menu
   contradicting the button, which is worse than either answer alone. These pin
   the renderer's whole half of that: believe the shell, and refuse to believe
   anything else.
   ------------------------------------------------------------------------ */

test('the menu believes the shell about which engines can start', () => {
  const rows = tierChoicesFor(startableTierIds({ ok: true, tiers: ['luna', 'terra', 'sol', 'claude-fable'] }))
  const claude = rows.find(row => row.id === 'claude-fable')
  const luna = rows.find(row => row.id === 'luna')
  const local = rows.find(row => row.id === 'local')
  assert.ok(claude, 'the Claude row vanished from the menu instead of being relabelled')
  assert.ok(!/cannot start/i.test(claude.label),
    `a tier the shell says it can start is still labelled unstartable: ${claude.label}`)
  assert.ok(!/cannot start/i.test(luna.label), luna.label)
  /* The one that proves it reads real launchers rather than provider names. */
  assert.ok(/cannot start/i.test(local.label),
    `local was not in the shell's list and must still say so: ${local.label}`)
})

test('a shell that answers nothing leaves the menu exactly where it was', () => {
  /* Every one of these learned NOTHING about what this copy can start -- no
     bridge, no channel, a rejected call, a malformed reply, a tier table from
     some other product. None of them may widen the menu, and none of them may
     narrow it either: the fallback is the three Codex tiers, which is what
     every build could always start. */
  for (const reply of [null, undefined, {}, { ok: false }, { ok: true }, { ok: true, tiers: 'luna' },
    { ok: true, tiers: ['not-a-tier', 'also-not'] }]) {
    assert.deepEqual([...startableTierIds(reply)], ['luna', 'terra', 'sol'],
      `an unusable reply changed the menu: ${JSON.stringify(reply)}`)
  }
})

test('an empty answer is an answer, and is not read as "everything starts"', () => {
  /* {ok:true, tiers:[]} means the shell resolved every tier and none can start.
     Falling back to the Codex three here would be the renderer overruling the
     shell on the one question it was asked, and would put "startable" under a
     row that refuses. */
  const rows = tierChoicesFor(startableTierIds({ ok: true, tiers: [] }))
  assert.ok(rows.every(row => /cannot start/i.test(row.label)),
    `an empty answer left some row claiming it can start: ${JSON.stringify(rows.map(row => row.label))}`)
})

test('the compose panel renders the engine rows it is handed, not a list of its own', () => {
  const handed = tierChoicesFor(['luna', 'claude-opus'])
  const { handle } = open({ tiers: handed })
  const labels = fieldNamed(handle, 'tier').children.map(option => option.textContent)
  assert.deepEqual(labels, handed.map(choice => choice.label),
    'the panel drew its own tier list instead of the one it was given')
})

/* ---------------------------------------------------------------------------
 * THE FOLDER A TREE'S AGENTS WORK IN, ASKED WHERE THE TREE IS STARTED.
 *
 * Owner, 2026-08-16: "when a user starts a tree they should select a folder,
 * they can have a default folder, where the agents spawn". Owner again,
 * 2026-08-19, having gone looking for it: "what happened to sessions and
 * choosing a folder for each tree and such?" It existed only AFTER the fact, on
 * an existing tree's rail, 614px down a 3825px scroll (driven, packaged,
 * tools/rail-inventory-drive.mjs).
 * ------------------------------------------------------------------------- */

const FOLDERS = [{ id: 'p-1', name: 'Client work' }, { id: 'p-2', name: 'The website' }]

test('starting a TREE asks which folder its agents work in', () => {
  const { handle } = open({ folders: FOLDERS })
  const folder = fieldNamed(handle, 'profile')
  assert.ok(folder, 'a panel that would start a tree must ask for its folder')
  /* The first row is a real answer, not a prompt: before folders existed every
     tree ran in the product's own workspace, and that is still what it means. */
  assert.equal(folder.children[0].value, '', 'the first row must be the product’s own workspace, and must carry no id')
  assert.equal(folder.children[0].textContent, START_PANEL.folderWorkspace)
  assert.deepEqual(folder.children.slice(1).map(option => option.textContent), ['Client work', 'The website'],
    'the menu shows the NAMES a person gave their folders')
  assert.deepEqual(folder.children.slice(1).map(option => option.value), ['p-1', 'p-2'],
    'the id travels on the value, where only the program reads it')
})

test('a start UNDER an existing agent asks nothing, because that tree already has a folder', () => {
  /* The hazard this closes: a tree's folder is a property of the TREE. Offering
     the menu on a nested start would let one press silently re-point every
     agent in the tree, including ones already running. */
  const { handle } = open({ parent: { id: 'node-17', name: 'Manager' }, folders: FOLDERS })
  assert.equal(fieldNamed(handle, 'profile'), null, 'a nested start must not offer to change the tree’s folder')
})

test('the chosen folder rides in the draft, and an untouched menu means the product’s own workspace', () => {
  const { handle, calls } = open({ folders: FOLDERS })
  fill(handle, { role: 'manager', message: 'Take the packaging work.' })
  actionNamed(handle, 'submit').dispatch('click')
  assert.equal(calls.submitted[0].profileId, null, 'an unanswered menu is the product’s own workspace, sent as null')

  const second = open({ folders: FOLDERS })
  fill(second.handle, { role: 'manager', message: 'Take the packaging work.' })
  fieldNamed(second.handle, 'profile').value = 'p-2'
  actionNamed(second.handle, 'submit').dispatch('click')
  assert.equal(second.calls.submitted[0].profileId, 'p-2', 'the folder the person chose must reach the caller')
})

test('the menu opens on the folder this person used last', () => {
  const { handle } = open({ folders: FOLDERS, folderSelectedId: 'p-2' })
  assert.equal(fieldNamed(handle, 'profile').value, 'p-2', 'a remembered folder pre-fills the menu')
})

test('a remembered folder that no longer exists falls back, it does not point at nothing', () => {
  /* A person removes a profile between two starts. The id is remembered posture,
     not a promise, so it simply stops matching a row. */
  const { handle } = open({ folders: FOLDERS, folderSelectedId: 'p-gone' })
  assert.equal(fieldNamed(handle, 'profile').value, '', 'a folder that is gone leaves the product’s own workspace selected')
})

test('with no folders set up, the panel says where to make one and still starts', () => {
  const { handle, calls } = open({ folders: [] })
  const folder = fieldNamed(handle, 'profile')
  assert.equal(folder.children.length, 1, 'only the product’s own workspace is offered')
  const words = wordsOnScreen(handle)
  assert.ok(words.includes(START_PANEL.folderNone), 'the panel must say where folders are made')
  /* NOT A REFUSAL. Starting works fine without a profile. */
  fill(handle, { role: 'manager', message: 'Take the packaging work.' })
  actionNamed(handle, 'submit').dispatch('click')
  assert.equal(calls.submitted.length, 1, 'no folders is not a reason to refuse a start')
})

test('re-opening with only tiers keeps the folder menu that was already read', () => {
  /* readStartableTiers() re-opens an open panel with `{ tiers }` alone the
     moment the shell answers. A merge that reset the folders would empty the
     menu out from under somebody reading it. */
  const { handle } = open({ folders: FOLDERS, folderSelectedId: 'p-1' })
  handle.open({ tiers: tierChoicesFor(['luna']) })
  const folder = fieldNamed(handle, 'profile')
  assert.equal(folder.children.length, 3, 'the folders survived a re-open that did not mention them')
  assert.equal(folder.value, 'p-1', 'and so did the remembered choice')
})

/* ---------- WHAT A SESSION STARTED HERE WOULD ACTUALLY BE ALLOWED TO DO ------
 *
 * THE DEFECT THESE PIN. A driver walked the whole happy path on a scratch
 * install at the RECOMMENDED level and the last step failed: the agent's first
 * write was refused by the operating system, and the only thing on screen about
 * it was the agent's own prose. src/agent-confinement-copy.js has owned the
 * honest sentence for that state since it was written -- SANDBOX_EFFECT
 * 'read-only', "It can read files, and this computer refuses any attempt it
 * makes to change one" -- and src/agent-session.js renders it under ITS Start
 * button. This panel is the OTHER Start button, the one a first-time person
 * actually presses, and it said nothing at all.
 *
 * THE PANEL STILL WRITES NO WORDS OF ITS OWN. The sentence arrives as a
 * caller-supplied line, which is the same door the refusal sentence already
 * comes through (header rule 4). So these assertions run the REAL copy module
 * rather than a literal: a panel that rendered an invented sentence, or a copy
 * module that started saying something reassuring, both fail here.
 *
 * BOTH DIRECTIONS, because a line that always says "it cannot write" would
 * satisfy the first assertion and be a new lie at the two levels that do ask
 * for write access. */

test('the start control says what a session started here would be allowed to do', () => {
  const line = startControlLine({
    ok: true, tier: 'guided', sandbox: 'read-only', failedClosed: false,
  })
  const { handle } = open({ confinementLine: line })
  const said = confinementLineOf(handle)

  assert.ok(said, 'the panel a first-time person presses Start on must carry this line')
  assert.equal(said.textContent, line)
  assert.ok(
    said.textContent.includes(SANDBOX_EFFECT['read-only']),
    'the refusal a person is about to meet must be stated in the confinement module’s own words',
  )
})

test('the line is pinned with Start, so it cannot be scrolled away from the button it qualifies', () => {
  const { handle } = open({
    confinementLine: startControlLine({ ok: true, tier: 'guided', sandbox: 'read-only', failedClosed: false }),
  })
  const said = confinementLineOf(handle)
  const scroller = handle.element().find(node => node.className.includes('agent-compose-body'))

  assert.ok(scroller, 'the form still scrolls')
  assert.equal(scroller.findAll(node => node === said).length, 0, 'a disclosure inside the scroller is a disclosure nobody reads')
  /* AFTER the action row, never before it: the panel's own header records that
     Start below the fold was an owner-reported defect twice, and a block added
     ABOVE the button moves the button down. */
  const root = handle.element()
  const actions = root.find(node => node.className.includes('agent-compose-actions'))
  assert.ok(root.children.indexOf(said) > root.children.indexOf(actions), 'Start must not move down to make room for this')
})

test('a panel with no reading of this computer says nothing, rather than something reassuring', () => {
  const { handle } = open()
  const said = confinementLineOf(handle)
  assert.ok(said, 'the element exists so a later answer has somewhere to land')
  assert.equal(said.textContent, '')
  assert.equal(said.getAttribute('hidden'), 'hidden', 'an empty line must not leave a gap that reads as a fault')
  assert.deepEqual(wordsOnScreen(handle).filter(words => !APPROVED_WORDS.has(words)), [], 'and it must not invent a sentence of its own')
})

test('an unreadable computer is answered as unreadable, never as read-only and never as write', () => {
  for (const reading of [null, undefined, { ok: false, code: 'AGENT_CONFINEMENT_UNAVAILABLE' }, { ok: true, tier: 'guided', sandbox: 'nonsense' }]) {
    const line = startControlLine(reading)
    assert.ok(line.includes(UNKNOWN_CONFINEMENT), `${JSON.stringify(reading)} must be answered as unknown`)
    assert.equal(line.includes(SANDBOX_EFFECT['read-only']), false)
    assert.equal(line.includes(SANDBOX_EFFECT['workspace-write']), false)
    assert.equal(line.includes(SANDBOX_EFFECT['danger-full-access']), false)
  }
})

test('a level that asks for write access says so, and the fail-closed case says why', () => {
  const writing = startControlLine({ ok: true, tier: 'standard', sandbox: 'workspace-write', failedClosed: false })
  assert.ok(writing.includes(SANDBOX_EFFECT['workspace-write']))
  assert.equal(writing.includes(SANDBOX_EFFECT['read-only']), false, 'a hardcoded refusal sentence would be a new lie here')

  const unrecorded = startControlLine({ ok: true, tier: 'guided', sandbox: 'read-only', failedClosed: true })
  assert.ok(unrecorded.includes(FAIL_CLOSED_CLAUSE), 'a person whose answer was never recorded is entitled to know that')
})
