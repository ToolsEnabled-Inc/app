// The approvals SCREEN: the surface that replaced the interrupting popup.
//
// These assertions are about the two things that are easy to get wrong when a
// card designed for a modal is reused in a list, and one thing that is easy to
// leave behind:
//
//   1. A screen must not claim to be a modal. role="dialog" + aria-modal
//      sitting inertly in a page tells a screen reader the rest of the page is
//      inert when it is not.
//   2. A screen must not claim that leaving it decides anything. The popup's
//      "Closing this window denies every line" is true of a modal whose
//      dismiss submits the defaults, and false of a screen the owner scrolls
//      away from -- there the request simply stays queued.
//   3. The auto-mount has to be gone, or committing this work quietly reships
//      the popup the owner asked us to stop showing him.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { renderOwnerPrompt } from '../../src/owner-popup.js'

/* A DOM small enough to read: renderOwnerPrompt only ever uses createElement,
   append, textContent, className, dataset, setAttribute and addEventListener. */
class FakeElement {
  constructor(tagName) {
    this.tagName = tagName
    this.children = []
    this.attributes = new Map()
    this.dataset = {}
    this.className = ''
    this._text = ''
    this.disabled = false
    this.listeners = new Map()
  }
  set textContent(value) { this._text = String(value); this.children = [] }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text }
  append(...nodes) { for (const node of nodes) this.children.push(node) }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, [])
    this.listeners.get(name).push(listener)
  }
  walk(visit) { visit(this); for (const child of this.children) child.walk?.(visit) }
  find(predicate) {
    let hit = null
    this.walk(node => { if (!hit && predicate(node)) hit = node })
    return hit
  }
  all(predicate) {
    const out = []
    this.walk(node => { if (predicate(node)) out.push(node) })
    return out
  }
}

const documentRef = { createElement: tag => new FakeElement(tag) }

const PURCHASE = Object.freeze({
  id: 'batch-1',
  kind: 'purchase_batch',
  title: 'Launch purchases',
  message: 'Approve or deny each line below.',
  createdAt: '2026-08-10T00:00:00.000Z',
  expiresAt: '2026-08-17T00:00:00.000Z',
  state: 'pending',
  defaultDecision: 'deny',
  currency: 'USD',
  totalCents: 10_900,
  items: Object.freeze([Object.freeze({
    id: 'line-1',
    description: 'Delaware Certificate of Incorporation',
    amountCents: 10_900,
    currency: 'USD',
    merchant: 'Delaware Division of Corporations',
    purpose: 'Incorporates the company.',
  })]),
})

const CONFIRMATION = Object.freeze({
  id: 'confirm-1',
  kind: 'confirmation',
  title: 'Payment path',
  message: 'Use Stripe to collect money.',
  createdAt: '2026-08-10T00:00:00.000Z',
  expiresAt: '2026-08-17T00:00:00.000Z',
  state: 'pending',
  defaultDecision: 'deny',
})

const callbacks = { dismiss() {}, submit() {} }
const ruleText = tree => tree.find(node => node.className === 'owner-popup-default-rule')?.textContent || ''

test('the screen surface is not announced as a modal dialog', () => {
  const screen = renderOwnerPrompt(documentRef, PURCHASE, callbacks, { surface: 'screen' })
  assert.equal(screen.dialog.getAttribute('role'), 'group')
  assert.equal(screen.dialog.getAttribute('aria-modal'), null,
    'a card in a list must not tell a screen reader the rest of the page is inert')
  assert.equal(screen.dialog.getAttribute('aria-labelledby'), `owner-popup-title-${PURCHASE.id}`)
})

test('the popup surface is unchanged, including for callers passing no options', () => {
  for (const rendered of [
    renderOwnerPrompt(documentRef, PURCHASE, callbacks),
    renderOwnerPrompt(documentRef, PURCHASE, callbacks, { surface: 'popup' }),
    renderOwnerPrompt(documentRef, PURCHASE, callbacks, {}),
  ]) {
    assert.equal(rendered.dialog.getAttribute('role'), 'dialog')
    assert.equal(rendered.dialog.getAttribute('aria-modal'), 'true')
    assert.ok(rendered.close, 'the modal keeps its close-and-refuse control')
    assert.match(ruleText(rendered.overlay), /Closing this window denies every line/)
  }
})

test('the screen offers no close-and-refuse control', () => {
  const screen = renderOwnerPrompt(documentRef, PURCHASE, callbacks, { surface: 'screen' })
  assert.equal(screen.close, null)
  assert.equal(screen.dialog.all(node => node.className === 'owner-popup-close').length, 0,
    'a close button on a screen would offer to deny a request the owner merely scrolled past')
})

test('the screen never claims that leaving it decides anything', () => {
  for (const prompt of [PURCHASE, CONFIRMATION]) {
    const text = ruleText(renderOwnerPrompt(documentRef, prompt, callbacks, { surface: 'screen' }).dialog)
    assert.doesNotMatch(text, /Closing this window/,
      'there is no window to close on a screen, and navigating away submits nothing')
    assert.match(text, /Leaving this screen submits nothing and decides nothing/)
    assert.match(text, /Default deny/, 'deny-by-default is still stated, because the engine still enforces it')
  }
})

test('decision controls start disabled on the screen, because presentation is measured', () => {
  const screen = renderOwnerPrompt(documentRef, PURCHASE, callbacks, { surface: 'screen' })
  assert.ok(screen.gatedControls.length >= 3, 'approve, deny and submit are all gated')
  for (const control of screen.gatedControls) {
    assert.equal(control.disabled, true,
      'the engine refuses a decision on a prompt it was never told was presented')
  }
})

test('the owner prompt module no longer mounts itself', () => {
  const source = readFileSync(new URL('../../src/owner-popup.js', import.meta.url), 'utf8')
  // createOwnerPromptController still resolves #owner-popup-root itself, and
  // must: the modal remains available for anything genuinely blocking, and its
  // own suite constructs it. What must not exist is a caller that starts one
  // at import time, which is what turned the queue into an interruption.
  assert.doesNotMatch(source, /createOwnerPromptController\([^)]*\)\s*\.start\(\)/,
    'a self-starting popup is exactly the interruption the owner replaced with a screen')
  assert.doesNotMatch(source, /typeof document !== 'undefined'/,
    'the import-time mount guard is gone, not merely disabled')
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  assert.doesNotMatch(html, /owner-popup-root/, 'no always-mounted popup root ships in the page')
  assert.doesNotMatch(html, /src\/owner-popup\.js/, 'the popup module is no longer loaded as a page script')
})

test('the approvals screen is actually reachable, not dead code in the bundle', () => {
  const main = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8')
  assert.match(main, /import \{ approvalsView \} from '\.\/views\/approvals\.js'/)
  assert.match(main, /case 'approvals': return approvalsView\(\)/, 'the router can build the view')
  assert.match(main, /parts\[0\] === 'approvals'/, 'the hash #/approvals parses to the route')
  assert.match(main, /const ORDER = \[[^\]]*'approvals'/,
    'the arrows are the only navigation, so a route missing from ORDER is unreachable')
})

test('home states the count, and states nothing at all when it cannot read one', async () => {
  const home = readFileSync(new URL('../../src/views/home.js', import.meta.url), 'utf8')
  assert.match(home, /ownerPromptSnapshot/, 'home reads the same queue the screen does')

  /* This assertion used to read `approvalsVal.textContent = '—'`: home printed
     an em dash where the number would go. That was right about the danger --
     "0 waiting" while eight decisions are queued is the one wrong thing this
     row can say -- and wrong about the remedy, because a dash beside the words
     "APPROVALS WAITING" is one more unreadable notice on a screen the owner
     reported as unreadable. Home now omits the row entirely when the queue
     cannot be read, which satisfies the original rule strictly: there is no
     rendering at all, so there is no false zero in it.

     Asserted against the decision function rather than the source text,
     because a source match cannot tell a live branch from a dead one. */
  const { describeHome } = await import('../../src/local-activity.js')
  const facts = state => describeHome({ fleetConfigured: false, approvals: state }).facts.map(f => f.id)

  assert.ok(!facts({ readable: false, count: 0 }).includes('approvals'),
    'an unreadable queue renders no approvals row, so it cannot render a false zero')
  assert.ok(!facts(null).includes('approvals'), 'and neither does a queue nobody has asked about yet')
  assert.ok(facts({ readable: true, count: 0 }).includes('approvals'), 'a genuine zero is still stated')
  assert.ok(facts({ readable: true, count: 4 }).includes('approvals'), 'and so is a genuine count')

  const waiting = describeHome({ fleetConfigured: false, approvals: { readable: true, count: 4 } })
  const row = waiting.facts.find(fact => fact.id === 'approvals')
  assert.match(row.text, /4 decisions waiting for you/)
  assert.equal(row.href, '#/approvals', 'and it goes to the screen that can act on them')
})
