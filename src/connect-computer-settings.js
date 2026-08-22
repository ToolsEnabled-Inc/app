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
  MAX_DEVICE_NAME,
  clockShouldRun,
  defaultDeviceName,
  initialState,
  nameToClaim,
  pollDue,
  reduce,
  remainingText,
  repaintNeeded,
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

/* How long "Copied" stands before the button goes back to offering. Two
   seconds is long enough to be read and short enough that the button is not
   still congratulating somebody about a code they have since replaced. It is
   cleared on the same one-second tick, so the real span is two to three
   seconds and nothing new ticks to shorten it. */
const COPY_ACK_MS = 2000

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
    /* THE SECOND SENTENCE HAS TO STOP REFERRING TO A NAME THAT IS NOT THERE.
       connectedReply() in shell/device-claim.cjs copies `name` by name and
       coerces a non-string to '', so a nameless connected machine is a real
       shape -- and "lists it under that name" was then a sentence about
       nothing, above a body that draws nothing either. Where to undo it is the
       part that must survive both spellings, because there is no control in
       this window that removes a computer from an account and the account page
       is genuinely the only place. */
    const name = state.device?.name?.trim()
    const undo = `To take it off again, sign in at ${ACCOUNT_PAGE_HOST} and open your account page.`
    return {
      tone: 'is-good',
      title: name ? `${name} is on your account` : 'This computer is on your account',
      detail: name ? `Your account page lists it under that name. ${undo}` : undo,
    }
  }
  if (phase === 'starting') return { tone: '', title: 'Asking for a code', detail: 'The installed application is opening a code for this computer.' }
  if (phase === 'waiting') {
    /* "LEAVE IT OPEN OR COME BACK TO IT" IS WHAT THIS USED TO SAY, and it read
       as permission to close the window. It is not. The half of this ceremony
       that collects the credential is held in the installed application's own
       memory (shell/device-claim.cjs keeps the poll token in a variable and
       nowhere else), so quitting ToolsEnabled ends the claim from this side
       whatever the account page has been told. DRIVEN: quit with a code on
       screen, start again on the same profile, and the screen is back to
       "This computer is not on an account yet" with no mention of the code
       somebody is at that moment typing into their browser. Until that token
       outlives the process, the honest thing is to say so here. */
    return {
      tone: 'is-warn',
      title: 'Waiting for you to enter the code',
      detail: `Enter it on your account page at ${ACCOUNT_PAGE_HOST}. Leave ToolsEnabled running until this screen says the computer is joined; closing it means asking for a new code. Moving to another screen in this window is fine.`,
    }
  }
  if (phase === 'orphaned') {
    return {
      tone: 'is-warn',
      title: 'A code was already asked for',
      detail: 'One is still open for this computer, and this screen cannot show it a second time. Ask for a new one below.',
    }
  }
  if (phase === 'ended') return { tone: 'is-warn', title: endedTitle(state), detail: endedDetail(state) }
  return {
    tone: '',
    title: 'This computer is not on an account yet',
    detail: 'Nothing has been sent anywhere. Choose a name below and ask for a code.',
  }
}

/* THE ROW'S OWN SENTENCE MOVES WITH THE STATE, and it had to.
 *
 * SEEN ON GLASS: with the computer already on the account and no button drawn,
 * the row still read "Nothing is sent until you press the button" -- a sentence
 * about a control that was not there, sitting under a line saying the job was
 * already done. A description that outlives what it describes is the same
 * defect as a switch that does nothing; it just fails quietly. */
function rowDetail(state) {
  if (state.phase === 'connected') {
    return 'This computer is already joined. There is nothing to press here, and nothing is sent from this screen.'
  }
  if (state.phase === 'waiting' || state.phase === 'orphaned') {
    return 'Type the code into your browser, on your account page. Your password never passes through this window.'
  }
  /* THE SAME DEFECT AGAIN, ONE STATE ALONG. `checking` and `absent` draw no
     button at all -- bodyMarkup() returns nothing for either -- and both were
     still describing "the button" and what pressing it would send. MEASURED on
     a first run: the section stands in `checking` for about two and a half
     seconds with no control on it, under a sentence about a control. Two and a
     half seconds is long enough to read a sentence and start looking for the
     thing it names. */
  if (state.phase === 'checking') {
    return 'Nothing has been sent anywhere. This screen is asking the installed application what it already knows, and the button appears when it answers.'
  }
  if (state.phase === 'absent') {
    return 'Nothing can be sent from this window, because it has no way to reach the installed application.'
  }
  return 'Nothing is sent until you press the button. The code is shown here and typed on your account page, so your password never passes through this window.'
}

/* Four different things happened and they are four different sentences. All
   four end in the same offer, which is the button directly under them. */
function endedDetail(state) {
  if (state.endedBecause === 'gone') return 'It was either entered already or it ran out of time.'
  if (state.endedBecause === 'not-tracked') return 'The installed application is no longer holding a code for this computer.'
  if (state.endedBecause === 'stopped') return 'You stopped waiting for it, so it was given up. Nothing was joined to your account.'
  return 'It ran out of time before it was entered.'
}

/* THE TITLE OF THE ENDING MOVES WITH IT TOO. "That code is no longer good" is
   the right line for three endings that happened TO somebody and the wrong one
   for the ending they chose, which needs no explaining and no alarm. */
function endedTitle(state) {
  return state.endedBecause === 'stopped' ? 'You stopped waiting' : 'That code is no longer good'
}

function statusMarkup(state) {
  const line = statusLine(state)
  return `<p class="fleet-profile-status ${esc(line.tone)}" data-connect-status aria-live="polite">
    <strong>${esc(line.title)}</strong>
    <span>${esc(line.detail)}</span>
  </p>`
}

/* EVERY REFUSAL IS ON THE GLASS AS ITS OWN SENTENCE, WHERE THE PRESS WAS, AND
 * OUT LOUD.
 *
 * It still never replaces the status line and never moves a control that was
 * already there: it is added, and it is added directly ABOVE the row of
 * buttons rather than below them, because below is off the bottom of the small
 * window a person actually uses. MEASURED at 1000x650 with the section idle:
 * the button's box ends at y=622 of a 652px viewport, so a sentence underneath
 * it would have been a refusal nobody could see without knowing to scroll.
 *
 * WHERE IT USED TO GO, AND WHY THAT WAS NOT ENOUGH. Under the status line at
 * the top of the section -- measured at 1446x906, y=417, for a button at y=630.
 * Two hundred pixels and two blocks of unrelated text above the place the
 * person was looking, on a screen where nothing else moved. It was visible and
 * it was not seen.
 *
 * role="alert" IS THE HALF THAT HAS NO PIXELS. The status line is aria-live and
 * this was not, so somebody working by ear pressed a button and heard nothing:
 * the same defect as an invisible refusal, for the people it is worst for.
 *
 * The identifier rides in an attribute a support conversation and a driver can
 * read and a person never will -- the rule src/refusal-copy.js sets for the
 * whole product. There is exactly ONE of these nodes in the section whatever
 * the state, so that attribute stays the one place to look. */
function refusalMarkup(state) {
  if (!state.refusal) return ''
  const machineChannel = state.refusalCode ? ` data-refusal-code="${esc(state.refusalCode)}"` : ''
  return `<p class="connect-refusal" data-connect-refusal role="alert"${machineChannel}>${esc(state.refusal)}</p>`
}

/* The name box. `maxlength` is the whole of the repair described at
   MAX_DEVICE_NAME in src/device-claim-flow.js: the box stops where the
   installed application stops, so a name that is too long is a keystroke that
   does not appear rather than a refusal that arrives after a round trip. The
   limit is also written under the box, because a box that silently stops
   accepting characters is its own small mystery. */
function nameFieldMarkup(state, disabled) {
  const value = state.name || defaultDeviceName({ profileLabel: profileLabel(), platform: state.platform })
  return `<label class="connect-name">
    <span>Name for this computer</span>
    <input class="fleet-profile-input" data-connect-field="name" value="${esc(value)}"
      placeholder="${esc(defaultDeviceName({ platform: state.platform }))}"
      maxlength="${MAX_DEVICE_NAME}"
      autocomplete="off" spellcheck="false" ${disabled ? 'disabled' : ''}/>
  </label>
  <small>This is the name your account page will show, up to ${MAX_DEVICE_NAME} characters. Change it before you ask for a code.</small>`
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
    <div class="connect-code-row">
      <input class="connect-code" data-connect-code readonly value="${esc(state.code || '')}"
        aria-label="The code to enter on your account page" spellcheck="false" autocomplete="off"/>
      ${copyMarkup()}
    </div>
    <p class="connect-remaining" data-connect-remaining>${esc(remainingText(state.expiresAtMs, nowMs))}</p>
  </div>`
}

/* THE COPY BUTTON, WHICH IS ALSO THE ONLY SIGN THAT THE CODE CAN BE COPIED.
 *
 * DRIVEN, and both routes already worked: a triple-click then Ctrl+C put
 * exactly TC-JJW4-GPK4 on the clipboard, and so did one click then Ctrl+C,
 * because handleFocusIn() selects the whole value. Nothing on the screen said
 * so. The code is set 34px high with no box and a hairline under it, which is
 * how a heading looks, and nobody triple-clicks a heading. A person on the same
 * computer as their browser was left transcribing eight characters by eye from
 * an alphabet that has no I, O, 0 or 1 in it precisely because transcription is
 * expected to go wrong.
 *
 * The label is lifted out of the template for the reason buttonMarkup() gives:
 * the word "code" must never appear inside an interpolation on this screen. */
const COPY_LABEL = 'Copy'
const COPY_DONE_LABEL = 'Copied'
const COPY_MANUAL_LABEL = 'Press Ctrl+C'

function copyMarkup() {
  return `<button type="button" class="ctl-btn connect-copy" data-connect-action="copy"
    aria-label="Copy the code">${COPY_LABEL}</button>`
}

function buttonMarkup(state) {
  if (state.phase === 'connected' || state.phase === 'absent' || state.phase === 'checking') return ''
  /* "Stop waiting" GIVES THE CODE UP, AND NOW SAYS SO BEFORE IT IS PRESSED.
     It reads like a control over this screen -- stop the counting, stop the
     asking -- and it is not: cancel() drops the claim in the installed
     application, and a person who pressed it hoping to pause found their code
     replaced by a name box. A destructive control has to name what it destroys
     while there is still something to lose. */
  if (state.phase === 'waiting') {
    return `<div class="fleet-profile-actions">
      <button type="button" class="ctl-btn" data-connect-action="cancel">Stop waiting</button>
    </div>
    <small>Stopping gives this code up. You can ask for another one afterwards.</small>`
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
  /* BUSY IS SAID WITH aria-disabled AND NOT WITH disabled, and that is the
     other half of the focus repair in refresh().
     A `disabled` button cannot hold focus. So pressing "Get a code" by keyboard
     went: focus on the button, one repaint into `starting`, the button replaced
     by a disabled one, focus dropped to <body> -- and by the time the refusal
     arrived there was nothing left to put the keyboard back onto. MEASURED
     exactly that way: activeElement was BODY after a refused press, which is
     sixteen tabs from the button that refused.
     Nothing is loosened by the swap. Two guards already stop a second ask and
     neither is this attribute: begin() returns early while `inFlight`, and
     shell/device-claim.cjs answers DEVICE_CLAIM_BUSY to anything that gets past
     it. handleClick() checks it as well, so the press is ignored here too. */
  const busy = state.phase === 'starting'
  const label = busy ? 'Asking&hellip;' : 'Get a code'
  return `<div class="fleet-profile-actions">
    <button type="button" class="ctl-btn armed" data-connect-action="begin" ${busy ? 'aria-disabled="true"' : ''}>${label}</button>
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
    /* THE NAME THAT ACTUALLY WENT UP, SAID BACK. The box is gone by now, and
       nameToClaim() may not have used what was in it: somebody who cleared it
       had the guess filed on their behalf, which is the right call and a
       surprise if the first they hear of it is the row on their account page.
       `claimedName` is that decision as it was made, carried on the state --
       recomputing it here was wrong and was CAUGHT ON GLASS at 1000x650: a
       claim opened as "Front desk", left and returned to, reported "My Windows
       computer", because the rebuilt screen had a fresh box with a fresh guess
       in it. The fallback is for a claim opened before that field existed. */
    return `<div class="fleet-profile-fields">
      ${codeMarkup(state, nowMs)}
      <p class="connect-known">It will be listed as <span class="connect-host">${esc(state.claimedName || nameToClaim(state))}</span>.</p>
      ${stepsMarkup()}
      ${refusalMarkup(state)}
      ${buttonMarkup(state)}
    </div>`
  }
  /* ENDED AND ORPHANED KEEP THE NAME BOX, and that was a gap rather than a
     decision: a code that ran out left a screen with one button on it, so
     somebody who had meant to rename this computer before joining it had to get
     a code they did not want, stop waiting for it, and start again. The next
     code is asked for with whatever is in this box, so the box belongs on every
     screen that offers to ask for one. */
  if (phase === 'ended' || phase === 'orphaned') {
    return `<div class="fleet-profile-fields">
      ${nameFieldMarkup(state, false)}
      ${refusalMarkup(state)}
      ${buttonMarkup(state)}
    </div>`
  }
  return `<div class="fleet-profile-fields">
    ${nameFieldMarkup(state, phase === 'starting')}
    ${refusalMarkup(state)}
    ${buttonMarkup(state)}
  </div>`
}

/* The refusal is drawn once. Inside the body it sits with the button that
   produced it; the three states that draw no body keep it under the status
   line, where it is still the only other thing on the section. */
function refusalHasABody(state) {
  return state.phase !== 'absent' && state.phase !== 'checking' && state.phase !== 'connected'
}

function profileLabel() {
  const label = FLEET_PROFILE_RESOLUTION?.rawProfile?.label
  return typeof label === 'string' ? label : ''
}

/* THE ONE THING THAT OUTLIVES A CONTROLLER, AND WHY IT HAS TO.
 *
 * src/views/settings.js builds a controller in its factory and destroys it with
 * the view, so leaving Settings and returning is a NEW controller starting from
 * `checking` with no memory. DRIVEN, with a real code up: away to another
 * screen, straight back, and the section read "This computer is not on an
 * account yet -- nothing has been sent anywhere" for two seconds, then "A code
 * was already asked for; this screen cannot show it a second time." Two clicks
 * inside one window cost the person their code and told them it could not be
 * shown again.
 *
 * WHAT IS KEPT IS WHAT WAS ALREADY ON THE GLASS: the code and its deadline. The
 * poll token is not here, is not reachable from here, and has no field to be
 * put in -- the guarantee the header makes about this whole file. It lives for
 * as long as the window does, which is the same lifetime the installed
 * application gives the claim itself, so the two cannot disagree by outliving
 * each other.
 *
 * IT IS A MEMORY AND NEVER AN AUTHORITY. Restoring it puts the code back on
 * screen; whether the claim is still good is still settled by the next poll,
 * which ends the wait honestly if the answer is `gone` or `none`. */
let rememberedClaim = null

function rememberClaim(state) {
  if (state.phase === 'waiting' && state.code) {
    rememberedClaim = {
      code: state.code,
      claimedName: state.claimedName,
      expiresAtMs: state.expiresAtMs,
      intervalSeconds: state.intervalSeconds,
    }
    return
  }
  /* Anything that is not a live wait means there is nothing to come back to.
     `starting` is the one in-between, and it is left alone so that a second
     screen built mid-request does not lose a claim that is about to exist. */
  if (state.phase !== 'starting') rememberedClaim = null
}

function claimWorthRestoring(nowMs) {
  const claim = rememberedClaim
  if (!claim || !claim.code) return null
  const ends = Number(claim.expiresAtMs)
  if (Number.isFinite(ends) && nowMs >= ends) {
    rememberedClaim = null
    return null
  }
  return claim
}

/* For the tests, which must not inherit one run's memory into the next. */
export function forgetRememberedClaim() {
  rememberedClaim = null
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
  let copiedAtMs = 0
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
      ${refusalHasABody(state) ? '' : refusalMarkup(state)}
      <div class="settings-section-rows">
        <article class="settings-row fleet-profile-block" data-connect-row>
          <div class="settings-copy">
            <div class="settings-name">Join this computer to your account</div>
            <div class="settings-desc">${esc(rowDetail(state))}</div>
          </div>
          ${bodyMarkup(state, nowMs)}
        </article>
      </div>
    </section>`
  }

  /* REDRAW ONLY ON WHAT A PERSON WOULD SEE CHANGE, which is a narrower rule
     than "the state moved" and had to be. Measured in a browser: a `pending`
     answer every two seconds moves nextPollAtMs, which moved the state, which
     rebuilt the section and took away the selection somebody had just made on
     their code. repaintNeeded() is that rule, written down where a test can
     hold it; the clock and the wire still get every change. */
  function apply(event) {
    const previous = state
    state = reduce(state, event)
    if (state === previous) return false
    rememberClaim(state)
    syncClock()
    if (repaintNeeded(previous, state)) refresh()
    return true
  }

  /* WHICH CONTROL IN THIS SECTION HAS THE KEYBOARD, said as something that
     survives the node being replaced. A selector, not a node: refresh() writes
     outerHTML, so every node in here is a different object afterwards. */
  function focusedControl() {
    const active = hostRoot?.ownerDocument?.activeElement
    if (!active || !hostRoot.contains(active)) return null
    const action = active.dataset?.connectAction
    if (action) return `[data-connect-action="${action}"]`
    const field = active.dataset?.connectField
    if (field) return `[data-connect-field="${field}"]`
    if (active.hasAttribute?.('data-connect-code')) return '[data-connect-code]'
    return null
  }

  function refresh() {
    if (!hostRoot) return
    const current = hostRoot.querySelector('[data-connect-settings]')
    if (!current) return
    const searchResult = current.querySelector('.settings-prefix') !== null
    /* THE KEYBOARD GOES BACK WHERE IT WAS, because a repaint that drops it is a
       repaint that throws somebody out of the section. MEASURED: it is sixteen
       tabs from the top of Settings to "Get a code", and a refusal replaces the
       whole section -- so pressing Space on that button and being refused left
       the focus on <body> and the sixteen tabs to do again, to reach a button
       whose refusal says to change the box directly above it. Restored by
       SELECTOR rather than by node, since none of the old nodes exist after the
       line below. A control the new state does not draw is simply not there,
       and nothing is focused, which is the honest outcome. */
    const wasFocused = focusedControl()
    /* The rebuilt copy button carries its resting label, so the acknowledgement
       cannot survive as a word on a button that no longer means it. */
    copiedAtMs = 0
    current.outerHTML = markup({ searchResult })
    if (!wasFocused) return
    hostRoot.querySelector(wasFocused)?.focus?.()
  }

  /* The countdown moves every second and NOTHING ELSE DOES, so it is written
     straight onto its own node instead of through a repaint. A person mid-way
     through selecting the code keeps their selection.
     The copy acknowledgement rides the same second, for the same reason and one
     more: this section is allowed exactly ONE timer (see the header), so a
     label that has to change back cannot have a timer of its own. `copiedAtMs`
     is deliberately not in the reduced state -- it is a fact about this screen,
     not about the claim, and putting it in the state would repaint the section
     under somebody who had just pressed Copy. */
  function paintRemaining() {
    if (!hostRoot || state.phase !== 'waiting') return
    const node = hostRoot.querySelector('[data-connect-remaining]')
    if (node) node.textContent = remainingText(state.expiresAtMs, now())
    if (copiedAtMs && now() - copiedAtMs >= COPY_ACK_MS) {
      copiedAtMs = 0
      paintCopyLabel(COPY_LABEL)
    }
  }

  function paintCopyLabel(label) {
    const node = hostRoot?.querySelector('[data-connect-action="copy"]')
    if (node) node.textContent = label
  }

  /* COPYING IS DONE BY THE SELECTION THE FIELD ALREADY OFFERS, not by asking
     for a clipboard permission this window has never asked for anything else.
     select() then the document's own copy command is the same two steps a
     person does by hand, which is why the fallback is honest: if the command
     refuses, the code is left SELECTED and the button says which two keys
     finish the job. Nothing is claimed to have been copied that was not. */
  function copyCode() {
    const field = hostRoot?.querySelector('[data-connect-code]')
    if (!field) return
    field.focus?.()
    field.select?.()
    let copied = false
    try {
      copied = globalThis.document?.execCommand?.('copy') === true
    } catch { copied = false }
    copiedAtMs = now()
    paintCopyLabel(copied ? COPY_DONE_LABEL : COPY_MANUAL_LABEL)
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
    /* THE CODE GOES BACK BEFORE ANYTHING IS ASKED, because the asking takes
       time a person watches. Measured on a first run: `status` alone is about
       two and a half seconds of a section with no controls on it, and until
       this line existed the screen spent that time claiming nothing had been
       sent anywhere to somebody looking at the code it had just given them.
       The claim is restored, not asserted -- the wait it produces is confirmed
       or ended by the polls that follow, exactly as any other wait is. */
    const remembered = claimWorthRestoring(now())
    if (remembered) {
      apply({
        type: 'adopted-code',
        code: remembered.code,
        claimedName: remembered.claimedName,
        expiresAtMs: remembered.expiresAtMs,
        intervalSeconds: remembered.intervalSeconds,
        nowMs: now(),
      })
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
    /* TWO ENDINGS, AND THE PERSON MEANT DIFFERENT THINGS BY THEM. "Stop
       waiting" is a stop and is reported as one -- `cancelled` lands on the
       ended screen that says so. "Get a new code" is not a stop at all; the
       giving-up is plumbing on the way to the next code, and announcing "You
       stopped waiting" for a fifth of a second before "Asking..." would be the
       screen narrating its own internals. `restart` is the event that clears
       without a verdict, which is what it was always for. */
    apply({ type: thenBegin ? 'restart' : 'cancelled' })
    if (thenBegin) await begin()
  }

  function handleClick(event) {
    const button = event.target.closest?.('[data-connect-action]')
    if (!button || !hostRoot?.contains(button)) return
    if (button.getAttribute?.('aria-disabled') === 'true') return
    const action = button.dataset.connectAction
    if (action === 'begin') void begin()
    else if (action === 'copy') copyCode()
    else if (action === 'cancel') void cancel()
    /* "Get a new code" is one press for the person and two calls here: the
       claim that is still open has to be given up before another can be asked
       for, or the application is holding two. */
    else if (action === 'restart') void cancel({ thenBegin: true })
  }

  /* The typed name is filed and draws nothing: repaintNeeded() leaves `name`
     out for exactly this call site. Rebuilding the section on every keystroke
     would replace the very box being typed into and throw the caret to the end
     of it; the name is only read when the button is pressed. */
  function handleInput(event) {
    const field = event.target.closest?.('[data-connect-field="name"]')
    if (!field || !hostRoot?.contains(field)) return
    apply({ type: 'name-changed', name: field.value })
  }

  /* Focus selects the whole code, so tab then Ctrl+C is the keyboard route and
     one click is the mouse route. It is read-only, so there is no caret
     position anybody could have wanted instead. */
  function handleFocusIn(event) {
    const code = event.target.closest?.('[data-connect-code]')
    if (!code || !hostRoot?.contains(code)) return
    code.select?.()
  }

  /* THE SEARCH BOX WAS HIDING THIS SECTION FROM THE PEOPLE LOOKING FOR IT.
   *
   * It was one substring test against one joined string, so a query had to be a
   * run of words in the order this file happened to write them. MEASURED, with
   * the section's own heading on the screen above the box:
   *
   *     "connect"                 found it
   *     "connect computer"        no settings match this search
   *     "connect my computer"     no settings match this search
   *     "connect this computer to my account"  no settings match this search
   *     "sign in"                 no settings match this search
   *     "computer name"           no settings match this search
   *
   * The middle one is this screen's exact title with one word added, and it is
   * also the sentence the person who paid for this work actually typed. Every
   * word present, in any order, is the rule that answers all six, and it is
   * still narrow: "sankey gradient" shares no word with any of this. */
  function matches(query) {
    const normalized = String(query || '').trim().toLowerCase()
    if (!normalized) return true
    const haystack = [
      'how do i connect this computer to my account code sign up signed up sign in website pair pairing join link add computer device claim my',
      `${ACCOUNT_PAGE_HOST} account page enter the code name for this computer get a code tc- new computer already connected`,
      statusLine(state).title,
      statusLine(state).detail,
      state.refusal,
    ].join(' ').toLowerCase()
    if (haystack.includes(normalized)) return true
    const words = normalized.split(/\s+/).filter(Boolean)
    return words.length > 0 && words.every(word => haystack.includes(word))
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
