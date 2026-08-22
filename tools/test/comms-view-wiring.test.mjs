/* Source pins for the Agent comms view and its stylesheet.
 *
 * src/views/comms.js imports a stylesheet and builds DOM, so a plain node run
 * cannot load it; what CAN be measured is the text, and every pin below is a
 * defect that shipped: a third-party messaging service named on the page (the
 * owner's ruling: "i dont think we have need for discord or to mention discord
 * at all"), six names for one surface, the constant "observed" tag on every
 * row, a detail card minted per channel and filtered out of the stack, the
 * shared composer seeding canned lines into every expanded tile, one failure
 * OR'd into every channel's log, and a stylesheet with rules for an unread dot,
 * a pin tag, a pulse and a branch spine nothing emitted.
 *
 * THE CSS CENSUS at the end is the ratchet that keeps the last one from coming
 * back: every class selector in comms.css must appear literally in comms.js,
 * the shared-component classes excepted (hidden-display-honesty.test.mjs walks
 * stylesheets the same way).
 *
 * Run: node --test tools/test/comms-view-wiring.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { COMMS_NAME } from '../../src/comms-copy.js'

const ROOT = new URL('../../', import.meta.url)
const read = (file) => readFileSync(new URL(file, ROOT), 'utf8')
const view = read('src/views/comms.js')
const css = read('src/comms.css')

test('no third-party messaging service is named on the page or in its stylesheet', () => {
  assert.doesNotMatch(view, /discord/i)
  assert.doesNotMatch(css, /discord/i)
  assert.doesNotMatch(view, /integ-row|integ-tag|integ-dot|integ-main|integ-note/)
  assert.doesNotMatch(css, /integ-/)
})

test('the names the page was cleared of are gone, and the copy module is the only source of words', () => {
  for (const gone of [
    'message board', 'watch board', 'Ops projection', 'observed</span>', 'role-default',
    'projectionDetailCard', ':source', 'railFootMarkup', 'head-count', 'head-meta', 'head-wt',
    'buildChat(', 'seed:', 'unavailable: liveMessagesReason', '|| liveMessagesReason', 'declared:',
    'SENDERS', 'impOf', 'domOf', 'toggleBranch', 'wb-branch', 'wb-dismiss', 'has-unread', 'ch-rail-sep',
    'composerReason', "from '../fleet-profile.js'", 'cmsg-mach"',
  ]) {
    assert.ok(!view.includes(gone), `comms.js still carries ${JSON.stringify(gone)}`)
  }
  assert.match(view, /from '\.\.\/comms-copy\.js'/)
  /* the page's one name is printed from the module, never retyped */
  assert.equal((view.match(/Agent comms/g) || []).length, 1, 'the name appears once, in the header comment; the h1 reads COMMS_NAME')
  assert.match(view, /\$\{esc\(COMMS_NAME\)\}/)
  assert.equal(COMMS_NAME, 'Agent comms')
})

test('the fold reuses the shared disclosure helpers rather than a second implementation', () => {
  assert.match(view, /import \{ el, attachSeg, openMemory, ownDisclosure \} from '\.\.\/components\.js'/)
  assert.match(view, /openMemory\('mc\.comms\.fold:'\)/)
  assert.match(view, /ownDisclosure\(wrap, \{ within: wrap\.querySelector\('summary'\)/)
  for (const cls of ['chat-context', 'chat-context-head', 'chat-action-mark', 'chat-context-say', 'chat-context-body']) {
    assert.ok(view.includes(cls), `the fold lost the shared class ${cls}`)
  }
  /* the expanded tile is a header and a log, nothing else */
  assert.match(view, /<div class="chat">\s*<div class="chat-head">/)
  assert.doesNotMatch(view, /chat-input|chat-send|Nothing is connected/)
})

test('the one notice is created in one function and the board does not repeat it', () => {
  const sites = view.match(/data-comms-notice="true"/g) || []
  assert.equal(sites.length, 1, 'one element carries data-comms-notice')
  assert.equal((view.match(/const setNotice = /g) || []).length, 1)
  /* the refusals come from the copy module, never composed here */
  assert.match(view, /READER_REFUSALS\.NO_READER/)
  assert.match(view, /READER_REFUSALS\.NO_ANSWER/)
  assert.match(view, /READER_REFUSALS\.READ_THREW\(error\)/)
  assert.match(view, /LOAD_FAILED\(err\)/)
  assert.doesNotMatch(view, /could not be read \(/, 'no failure sentence is composed in the view')
  /* the whole-read failure keeps the host-absent markup the first-run driver reads */
  assert.match(view, /setNotice\(hostAbsentMarkup\(reason, \{ compact: true \}\)\)/)
  assert.match(view, /subEl\.textContent = UNREADABLE_SUB/)
  /* the quiet notice still mounts, and mounts once */
  assert.match(view, /el\(commsQuietMarkup\(\)\)/)
  assert.match(view, /\[data-comms-quiet\]/)
})

test('the attributes the QA drivers read survive', () => {
  for (const literal of [
    'data-projection-state="loading"', "root.dataset.projectionState = 'unavailable'", "root.dataset.projectionState = 'simulated'",
    "messagesReason ? 'partial-unavailable' : 'ready'", 'data-live-mode="live"', 'data-example-badge="true"', 'class="head-live"',
    "from '../page-frames.js'", "from '../first-run-needs.js'",
  ]) {
    assert.ok(view.includes(literal), `comms.js lost ${JSON.stringify(literal)}`)
  }
})

test('tiles are channels; services are rail rows; the drag switches off under 720px', () => {
  assert.match(view, /const cards = observed\.map\(/)
  assert.doesNotMatch(view, /for \(const service of services\) \{\s*const id =/)
  assert.match(view, /row\.textContent = serviceLine\(service\)/)
  assert.match(view, /class="ch-service" data-empty="true">\$\{esc\(NO_SERVICES\)\}/)
  const down = view.slice(view.indexOf('function onBoxPointerDown'), view.indexOf('function beginDrag'))
  assert.match(down, /matchMedia\('\(max-width: 720px\)'\)\.matches/)
  assert.match(down, /let denied = narrow/)
})

test('the stylesheet has the three breakpoints and lifts the one-line clamps under 720', () => {
  assert.match(css, /@media \(max-width: 1000px\)/)
  assert.match(css, /@media \(max-width: 720px\)/)
  assert.match(css, /@media \(max-width: 480px\)/)
  assert.doesNotMatch(css, /@media \(max-width: 900px\)/)
  const narrow = css.slice(css.indexOf('@media (max-width: 720px)'), css.indexOf('@media (max-width: 480px)'))
  assert.match(narrow, /\.ch-topic \{ white-space: normal/)
  assert.match(narrow, /\.wb-desc \{ white-space: normal/)
  assert.match(narrow, /\.comms-sheet \{ flex-direction: column; \}/)
  assert.match(narrow, /\.wb-split\.row \{ flex-direction: column; \}/)
  assert.match(narrow, /\.wb-cell \.chip-preview \{ max-height: var\(--pv-h\); \}/)
  assert.match(css, /touch-action: pan-y/)
  /* the shared notices are re-faced for prose on this page */
  assert.match(css, /\.comms \.projection-unavailable,\s*\.comms \.projection-state,\s*\.comms \.host-absent-reason \{\s*font-family: var\(--font-ui\)/)
  assert.match(css, /\.comms \.cmsg \.chat-context/)
  /* .day-div and .cmsg.fresh are emitted now and keep their rules */
  assert.match(css, /\.day-div \{/)
  assert.match(css, /\.cmsg\.fresh \{/)
  assert.match(view, /class="day-div"/)
  assert.match(view, /classList\.add\('fresh'\)/)
})

/* THE CSS CENSUS. Every `.class` in a selector must be a class the view
   writes, with the shared-component families excepted. */
const SHARED = /^(chat-.*|chip.*|seg.*|host-absent.*|projection-.*|msg|who|cl|glass|them)$/
test('every class the stylesheet styles is a class the view writes (dead-CSS ratchet)', () => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors = [...stripped.matchAll(/(^|\})\s*([^{}]+)\{/g)].map(m => m[2])
  const classes = new Set()
  for (const selector of selectors) {
    for (const m of selector.matchAll(/\.([A-Za-z_-][\w-]*)/g)) classes.add(m[1])
  }
  assert.ok(classes.size > 40, `census found only ${classes.size} classes; the scan is broken`)
  const dead = [...classes].filter(cls => !SHARED.test(cls) && !view.includes(cls))
  assert.deepEqual(dead, [], `comms.css styles classes the view never writes: ${dead.join(', ')}`)
})
