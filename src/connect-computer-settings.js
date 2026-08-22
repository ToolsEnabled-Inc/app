/* THE SETTINGS SECTION THAT SHOWS A PERSON THEIR CODE.
 *
 * "as a user I dont even see how after signing up that I now connect my
 * computer." They signed up on the website; its account page asks them for a
 * code; nothing in this application had ever shown them one. This section is
 * that missing half. src/device-claim-flow.js holds the rules and the states;
 * this holds the words, the markup, the calls and the ONE timer.
 *
 * WHY IT IS A SECTION CONTROLLER AND NOT A ROW IN THE SETTINGS CATALOGUE. Every
 * row in that catalogue is a preference this window stores under `mc.set.<id>`.
 * There is no preference here. There is a ceremony with eight states, a code
 * that expires, and a wait that has to keep running while the person walks to
 * another device -- none of which a row of that shape can express. The chat box
 * and Research sections are here for the same reason.
 *
 * THE BRIDGE MAY NOT EXIST, AND THAT IS AN ORDINARY CASE RATHER THAN AN ERROR.
 * `window.mcShell.deviceClaim` is built by another lane; this file is written
 * against the agreed shape and FEATURE-DETECTS every verb before calling it,
 * the way src/mission-bridge.js checks `typeof ask !== 'function'` before every
 * one of its own. A window without it -- a plain browser, or a build cut before
 * the other half landed -- gets an honest sentence saying so, never a button
 * that does nothing.
 *
 * THE POLL TOKEN NEVER COMES NEAR THIS FILE. begin() keeps it in the installed
 * application's own memory and poll() takes no argument; nothing here has a
 * variable for it. A secret only the application needs must not be handed to a
 * web page, and the way to guarantee that is to have no place to put it.
 *
 * ONE TIMER, AND IT DIES WITH THE SCREEN. Everything that ticks in this section
 * is a single one-second interval, started and stopped from clockShouldRun() so
 * "which states tick" is written down once. destroy() clears it and latches
 * `torn`, because a request already in flight resolves AFTER teardown and would
 * otherwise walk straight back into startClock() and leave an interval running
 * on a screen that no longer exists. This product has paid for that shape
 * before, which is why the latch is checked at the top of every continuation
 * rather than only in destroy().
 */

import { FLEET_PROFILE_RESOLUTION } from './fleet-profile.js'
import {
  ACCOUNT_PAGE_HOST,
  CONNECT_SECTION,
  clockShouldRun,
  defaultDeviceName,
  initialState,
  nameToClaim,
  pollDue,
  reduce,
  remainingText,
} from './device-claim-flow.js'
/* THE STYLESHEET IS IMPORTED BY THE PAGE, NOT BY THIS MODULE, and that is
   the same arrangement chatbox-settings.js and fleet-profile-settings.js
   already have with src/views/settings.js. It is not tidiness: a module that
   imports CSS cannot be loaded by `node --test`, and the states worth testing
   here are the failure ones -- a refusal mid-wait, a code that ran out, a
   teardown while a request is on the wire. Those are exactly the branches a
   driven browser reaches least often, so they have to be reachable from a
   plain node process. */

export { CONNECT_SECTION, CONNECT_SETTING_COUNT } from './device-claim-flow.js'

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/* ONE SECOND, AND IT IS NOT THE POLLING CADENCE. The countdown has to move
   every second to be worth showing at all; the service's `intervalSeconds` is
   how often to ASK, and pollDue() decides that against this clock. Arming a
   second interval at the service's cadence would mean two timers to clear and a
   stale cadence whenever the service changed its mind mid-wait. */
const CLOCK_MS = 1000

/* The browser this window is running in, asked once per controller. It is the
   weakest of the two guesses at a name for this computer and is only reached
   when the person has not already labelled their system. */
function currentPlatform() {
  const nav = globalThis.navigator
  return String(nav?.userAgentData?.platform || nav?.platform || '')
}

/* FEATURE DETECTION, PER VERB, EVERY TIME. Not `Boolean(mcShell.deviceClaim)`:
   the website defines `window.mcShell` too (src/data-source.js says so at
   length), so the object existing proves nothing about which verbs are on it. A
   half-built bridge with begin() and no poll() must read as absent rather than
   strand somebody on a code nothing will ever confirm. */
function deviceClaimBridge(shell = globalThis.window?.mcShell) {
  const claim = shell?.deviceClaim
  if (!claim || typeof claim !== 'object') return null
  for (const verb of ['status', 'begin', 'poll', 'cancel']) {
    if (typeof claim[verb] !== 'function') return null
  }
  return claim
}

export { deviceClaimBridge }

/* WHAT THE STRIP AT THE TOP OF THE SECTION SAYS, one line per state, so the
   answer to "where am I in this" is in the same place every time. `tone` is the
   colour of its left rule, from the same three the System section uses. */
function statusLine(state) {
  const phase = state.phase
  if (phase === 'checking') return { tone: '', title: 'Checking this computer', detail: 'Asking the installed application what this computer is already joined to.' }
  if (phase === 'absent') {
    return {
      tone: 'is-warn',
      title: 'This window cannot ask for a code',
      detail: `Open the installed ToolsEnabled application and come back to this screen. In a browser tab, sign in at ${ACCOUNT_PAGE_HOST} instead.`,
    }
  }
  if (phase === 'connected') {
    const name = state.device?.name?.trim()
    return {
      tone: 'is-good',
      title: name ? `${name} is on your account` : 'This computer is on your account',
      detail: `Your account page lists it under that name. To take it off again, sign in at ${ACCOUNT_PAGE_HOST} and open your account page.`,
    }
  }
  if (phase === 'starting') return { tone: '', title: 'Asking for a code', detail: 'The installed application is opening a code for this computer.' }
  if (phase === 'waiting') {
    return {
      tone: 'is-warn',
      title: 'Waiting for you to enter the code',
      detail: `Enter it on your account page at ${ACCOUNT_PAGE_HOST}. This screen notices on its own; leave it open or come back to it.`,
    }
  }
  if (phase === 'orphaned') {
    return {
      tone: 'is-warn',
      title: 'A code was already asked for',
      detail: 'One is still open for this computer, and this screen cannot show it a second time. Ask for a new one below.',
    }
  }
  if (phase === 'ended') return { tone: 'is-warn', title: 'That code is no longer good', detail: endedDetail(state) }
  return {
    tone: '',
    title: 'This computer is not on an account yet',
    detail: 'Nothing has been sent anywhere. Choose a name below and ask for a code.',
  }
}

/* Three different things happened and they are three different sentences. All
   three end in the same offer, which is the button directly under them. */
function endedDetail(state) {
  if (state.endedBecause === 'gone') return 'It was either entered already or it ran out of time.'
  if (state.endedBecause === 'not-tracked') return 'The installed application is no longer holding a code for this computer.'
  return 'It ran out of time before it was entered.'
}

function statusMarkup(state) {
  const line = statusLine(state)
  return `<p class="fleet-profile-status ${esc(line.tone)}" data-connect-status aria-live="polite">
    <strong>${esc(line.title)}</strong>
    <span>${esc(line.detail)}</span>
  </p>`
}

/* EVERY REFUSAL IS ON THE GLASS AS ITS OWN SENTENCE. It is added under the
   status line rather than replacing it, so the controls a person was reaching
   for are still exactly where they were. The identifier rides in an attribute a
   support conversation and a driver can read and a person never will -- the
   rule src/refusal-copy.js sets for the whole product. */
function refusalMarkup(state) {
  if (!state.refusal) return ''
  const machineChannel = state.refusalCode ? ` data-refusal-code="${esc(state.refusalCode)}"` : ''
  return `<p class="connect-refusal" data-connect-refusal${machineChannel}>${esc(state.refusal)}</p>`
}

function nameFieldMarkup(state, disabled) {
  const value = state.name || defaultDeviceName({ profileLabel: profileLabel(), platform: state.platform })
  return `<label class="connect-name">
    <span>Name for this computer</span>
    <input class="fleet-profile-input" data-connect-field="name" value="${esc(value)}"
      placeholder="${esc(defaultDeviceName({ platform: state.platform }))}"
      autocomplete="off" spellcheck="false" ${disabled ? 'disabled' : ''}/>
  </label>
  <small>This is the name your account page will show. Change it before you ask for a code.</small>`
}

/* THE THREE STEPS, SPELLED OUT, IN THE ORDER A PERSON DOES THEM. The website
   address is text and not a link on purpose: nothing else in this window opens
   an outside page, and a link that quietly does nothing when pressed is the
   exact defect this screen exists to stop repeating. Text can be read off the
   screen and typed into any browser, including one on another device, which is
   what most people will actually do. */
function stepsMarkup() {
  return `<ol class="connect-steps">
    <li>Sign in at <span class="connect-host">${esc(ACCOUNT_PAGE_HOST)}</span>.</li>
    <li>Open your account page.</li>
    <li>Enter the code above and confirm it.</li>
  </ol>`
}

/* The code, big enough to read off the screen and select in one press.
 *
 * IT IS A READ-ONLY FIELD RATHER THAN A PARAGRAPH, and that is an
 * accessibility decision, not a styling one. A person on the keyboard alone can
 * tab to a field, press Ctrl+C and have the code; there is no keyboard way to
 * select the text of a paragraph. Read-only, so the caret has nothing to do and
 * selecting the whole value on focus costs nobody anything.
 */
function codeMarkup(state, nowMs) {
  return `<div class="connect-code-wrap">
    <input class="connect-code" data-connect-code readonly value="${esc(state.code || '')}"
      aria-label="The code to enter on your account page" spellcheck="false" autocomplete="off"/>
    <p class="connect-remaining" data-connect-remaining>${esc(remainingText(state.expiresAtMs, nowMs))}</p>
  </div>`
}

function buttonMarkup(state) {
  if (state.phase === 'connected' || state.phase === 'absent' || state.phase === 'checking') return ''
  if (state.phase === 'waiting') {
    return `<div class="fleet-profile-actions">
      <button type="button" class="ctl-btn" data-connect-action="cancel">Stop waiting</button>
    </div>`
  }
  if (state.phase === 'ended' || state.phase === 'orphaned') {
    return `<div class="fleet-profile-actions">
      <button type="button" class="ctl-btn armed" data-connect-action="restart">Get a new code</button>
    </div>`
  }
  /* The label is lifted out of the template rather than written inline, so the
     word "code" never appears inside an interpolation. tools/test/refusal-copy
     scans for exactly that shape, and it is right to: `${result.code}` in a
     button is how the last bare identifier in this product got on the glass. */
  const busy = state.phase === 'starting'
  const label = busy ? 'Asking&hellip;' : 'Get a code'
  return `<div class="fleet-profile-actions">
    <button type="button" class="ctl-btn armed" data-connect-action="begin" ${busy ? 'disabled' : ''}>${label}</button>
  </div>`
}

/* The block under the status line, which is the part that changes with the
   state. Everything a given state needs and nothing it does not: no element is
   ever shipped carrying `hidden`, so the trap src/styles.css documents at
   .ctl-btn[hidden] has nothing to catch here. */
function bodyMarkup(state, nowMs) {
  const phase = state.phase
  if (phase === 'absent' || phase === 'checking') return ''
  if (phase === 'connected') {
    const device = state.device
    if (!device?.name) return ''
    return `<div class="fleet-profile-fields">
      <p class="connect-known">On your account as <span class="connect-host">${esc(device.name)}</span>.</p>
    </div>`
  }
  if (phase === 'waiting') {
    return `<div class="fleet-profile-fields">
      ${codeMarkup(state, nowMs)}
      ${stepsMarkup()}
      ${buttonMarkup(state)}
    </div>`
  }
  if (phase === 'ended' || phase === 'orphaned') {
    return `<div class="fleet-profile-fields">${buttonMarkup(state)}</div>`
  }
  return `<div class="fleet-profile-fields">
    ${nameFieldMarkup(state, phase === 'starting')}
    ${buttonMarkup(state)}
  </div>`
}

function profileLabel() {
  const label = FLEET_PROFILE_RESOLUTION?.rawProfile?.label
  return typeof label === 'string' ? label : ''
}

export function createConnectComputerSettings({
  now = () => Date.now(),
  schedule = (fn, ms) => setInterval(fn, ms),
  cancelTimer = handle => clearInterval(handle),
  resolveBridge = () => deviceClaimBridge(),
} = {}) {
  let hostRoot = null
  let clock = null
  let torn = false
  let asked = false
  let inFlight = false
  let state = initialState({
    name: defaultDeviceName({ profileLabel: profileLabel(), platform: currentPlatform() }),
    platform: currentPlatform(),
  })

  function markup({ searchResult = false } = {}) {
    /* THE FIRST PAINT READS THE CLOCK THIS CONTROLLER WAS HANDED, not the wall
       clock. They are the same thing in the product and are deliberately not in
       a test, which is how this was caught: a markup() that asked Date.now()
       painted "run out" over a code with five minutes left. */
    const nowMs = now()
    return `<section class="settings-section connect-section" data-settings-section="${esc(CONNECT_SECTION)}" data-connect-settings data-connect-phase="${esc(state.phase)}">
      ${searchResult ? '<div class="settings-prefix">Connect this computer to your account</div>' : ''}
      <h2 class="settings-section-title">${esc(CONNECT_SECTION)}</h2>
      <p class="settings-section-note host-absent-body">You signed up on the website, and its account page asks for a code. This is the screen that gives you one.</p>
      ${statusMarkup(state)}
      ${refusalMarkup(state)}
      <div class="settings-section-rows">
        <article class="settings-row fleet-profile-block" data-connect-row>
          <div class="settings-copy">
            <div class="settings-name">Join this computer to your account</div>
            <div class="settings-desc">Nothing is sent until you press the button. The code is shown here and typed on your account page, so your password never passes through this window.</div>
          </div>
          ${bodyMarkup(state, nowMs)}
        </article>
      </div>
    </section>`
  }

  /* REDRAW ONLY WHEN THE STATE ACTUALLY MOVED. reduce() returns the same object
     when nothing changed, and the clock ticks once a second, so an unguarded
     repaint here would rebuild this section sixty times a minute -- under the
     pointer, and over whatever the person was typing in the name box. */
  function apply(event, { repaint = true } = {}) {
    const previous = state
    state = reduce(state, event)
    if (state === previous) return false
    syncClock()
    if (repaint) refresh()
    return true
  }

  function refresh() {
    if (!hostRoot) return
    const current = hostRoot.querySelector('[data-connect-settings]')
    if (!current) return
    const searchResult = current.querySelector('.settings-prefix') !== null
    current.outerHTML = markup({ searchResult })
  }

  /* The countdown moves every second and NOTHING ELSE DOES, so it is written
     straight onto its own node instead of through a repaint. A person mid-way
     through selecting the code keeps their selection. */
  function paintRemaining() {
    if (!hostRoot || state.phase !== 'waiting') return
    const node = hostRoot.querySelector('[data-connect-remaining]')
    if (node) node.textContent = remainingText(state.expiresAtMs, now())
  }

  function syncClock() {
    if (clockShouldRun(state) && !torn) startClock()
    else stopClock()
  }

  function startClock() {
    if (clock !== null) return
    clock = schedule(onTick, CLOCK_MS)
  }

  function stopClock() {
    if (clock === null) return
    cancelTimer(clock)
    clock = null
  }

  function onTick() {
    if (torn) { stopClock(); return }
    const nowMs = now()
    apply({ type: 'tick', nowMs })
    paintRemaining()
    if (pollDue(state, nowMs)) void pollOnce()
  }

  /* Every call to the installed application goes through here, so a verb that
     is missing and a verb that threw land in the same place and produce the
     same shape -- a refusal object the flow turns into a whole sentence. A
     thrown error's message is passed as the reason and may itself be a code;
     refusalSentence() already refuses to print one of those as prose. */
  async function ask(verb, argument) {
    const bridge = resolveBridge()
    if (!bridge) {
      apply({ type: 'bridge-absent' })
      return null
    }
    try {
      const result = argument === undefined ? await bridge[verb]() : await bridge[verb](argument)
      return result && typeof result === 'object' ? result : { ok: false, reason: '' }
    } catch (error) {
      return { ok: false, reason: typeof error?.message === 'string' ? error.message : '' }
    }
  }

  /* THE FIRST QUESTION THIS SCREEN ASKS IS "ARE WE ALREADY CONNECTED", because
     showing somebody a button to do a thing they have already done is its own
     small lie. Asked once per controller: the settings page re-renders whenever
     the capability probes answer, and re-asking on every render would put a
     request on the wire for a repaint. */
  async function checkStatus() {
    if (asked || torn) return
    asked = true
    const bridge = resolveBridge()
    if (!bridge) {
      apply({ type: 'bridge-absent' })
      return
    }
    const result = await ask('status')
    if (torn || !result) return
    apply({ type: 'status', result })
    if (state.phase !== 'idle') return
    /* NOT CONNECTED IS NOT THE SAME AS NOTHING IN FLIGHT. Somebody who asked
       for a code and walked to another screen comes back to a claim the
       application is still holding. One poll is the only way to find out, and
       it is the reason `orphaned` exists: poll() answers `pending` without the
       code, so the honest thing is to say a code is open and offer a fresh
       one. */
    const pending = await ask('poll')
    if (torn || !pending) return
    if (pending.ok === true && pending.state === 'pending') {
      apply({ type: 'adopted-pending', intervalSeconds: pending.intervalSeconds, nowMs: now() })
    }
  }

  async function begin() {
    if (torn || inFlight) return
    inFlight = true
    apply({ type: 'begin-requested' })
    const result = await ask('begin', { name: nameToClaim(state) })
    inFlight = false
    if (torn || !result) return
    apply({ type: 'begin-result', result, nowMs: now() })
  }

  async function pollOnce() {
    if (torn || inFlight) return
    inFlight = true
    const result = await ask('poll')
    inFlight = false
    if (torn || !result) return
    apply({ type: 'poll-result', result, nowMs: now() })
  }

  /* Stopping the wait stops it in the application too, not only on the screen.
     A claim left open there is what produces the `orphaned` state next time,
     and a person who pressed "Stop waiting" has said they are done with it. */
  async function cancel({ thenBegin = false } = {}) {
    if (torn || inFlight) return
    inFlight = true
    await ask('cancel')
    inFlight = false
    if (torn) return
    apply({ type: 'cancelled' })
    if (thenBegin) await begin()
  }

  function handleClick(event) {
    const button = event.target.closest?.('[data-connect-action]')
    if (!button || !hostRoot?.contains(button)) return
    const action = button.dataset.connectAction
    if (action === 'begin') void begin()
    else if (action === 'cancel') void cancel()
    /* "Get a new code" is one press for the person and two calls here: the
       claim that is still open has to be given up before another can be asked
       for, or the application is holding two. */
    else if (action === 'restart') void cancel({ thenBegin: true })
  }

  /* The typed name is filed WITHOUT a repaint. Rebuilding the section on every
     keystroke would replace the very input being typed into and throw the caret
     to the end of it; the name is only read when the button is pressed. */
  function handleInput(event) {
    const field = event.target.closest?.('[data-connect-field="name"]')
    if (!field || !hostRoot?.contains(field)) return
    apply({ type: 'name-changed', name: field.value }, { repaint: false })
  }

  /* Focus selects the whole code, so tab then Ctrl+C is the keyboard route and
     one click is the mouse route. It is read-only, so there is no caret
     position anybody could have wanted instead. */
  function handleFocusIn(event) {
    const code = event.target.closest?.('[data-connect-code]')
    if (!code || !hostRoot?.contains(code)) return
    code.select?.()
  }

  function matches(query) {
    const normalized = String(query || '').trim().toLowerCase()
    if (!normalized) return true
    const haystack = [
      'connect this computer account code sign up signed up website pair pairing join link add computer device claim',
      `${ACCOUNT_PAGE_HOST} account page enter the code name for this computer get a code`,
      statusLine(state).title,
      statusLine(state).detail,
      state.refusal,
    ].join(' ').toLowerCase()
    return haystack.includes(normalized)
  }

  function bind(root) {
    hostRoot = root
    root.addEventListener('click', handleClick)
    root.addEventListener('input', handleInput)
    root.addEventListener('focusin', handleFocusIn)
  }

  function afterRender(root = hostRoot) {
    hostRoot = root
    void checkStatus()
    paintRemaining()
  }

  function destroy() {
    /* The latch goes up BEFORE the timer is cleared, because a request already
       on the wire resolves after this returns and would otherwise walk back
       into syncClock() and start a fresh interval on a screen that is gone. */
    torn = true
    stopClock()
    if (hostRoot) {
      hostRoot.removeEventListener('click', handleClick)
      hostRoot.removeEventListener('input', handleInput)
      hostRoot.removeEventListener('focusin', handleFocusIn)
    }
    hostRoot = null
  }

  return Object.freeze({
    markup,
    matches,
    bind,
    afterRender,
    destroy,
    /* Named so a test can drive the ceremony without a window, and so the
       settings page never has to reach past markup() to move this section. */
    begin,
    cancel,
    pollOnce,
    checkStatus,
    getState: () => state,
    isTicking: () => clock !== null,
  })
}
