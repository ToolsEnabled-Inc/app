/* CONNECTING THIS COMPUTER TO THE ACCOUNT SOMEBODY JUST MADE, AS A STATE
 * MACHINE WITH NO DOM IN IT.
 *
 * THE DEFECT THIS EXISTS TO CLOSE, in the person's own words: "as a user I dont
 * even see how after signing up that I now connect my computer". They signed up
 * on the website. The account page there asks them for a code. Nothing in this
 * application has ever shown them one. Every other half of the ceremony was
 * already built -- the account service opens and collects claims, the website
 * has the box to type into, the installed application ships the client that
 * talks to both -- and the missing piece was a screen that says the code out
 * loud.
 *
 * WHY THE RULES LIVE HERE AND NOT IN THE SECTION THAT DRAWS THEM. This flow has
 * eight states, three of which are failures, and each of the three has to leave
 * a person somewhere they can act. A branch that only exists inside a render
 * function is a branch only a driven browser can hold still, and the failure
 * states are exactly the ones a driver reaches least often. Everything below is
 * a pure function over a plain object, so `node --test` can walk idle, waiting
 * and ended without a window.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO. It never calls the installed
 * application, never reads a clock and never starts a timer. It is handed
 * `nowMs` and a result and answers with the next state;
 * src/connect-computer-settings.js owns the calls, the one interval and the
 * teardown. Keeping the clock out is what makes the expiry rule testable at all
 * -- expiry is the one transition nobody can wait for in a unit test.
 */

import { refusalCodeOf, refusalSentence } from './refusal-copy.js'

/* The section name, exported rather than spelled twice, the same way
   CHATBOX_SECTION and RESEARCH_SECTION are. src/views/settings.js routes on the
   constant, so a rename here moves the page with it. */
export const CONNECT_SECTION = 'Connect this computer'

/* One setting, for the footer's count: whether this computer is joined to the
   account. The name box is that setting's value, not a second setting -- the
   same rule the chat box section's agent list is counted by. */
export const CONNECT_SETTING_COUNT = 1

/* THE ADDRESS OF THE ONE STEP THAT TURNS THIS INTO THE PRODUCT.
 *
 * `#/settings?setting=connect_computer` lands on this row, the way every other
 * landable row on that page is reached. Until this id existed nothing anywhere
 * could send a person here: requestedSetting() in src/views/settings.js resolves
 * the query against that page's own tables, this section's rows are not in
 * SETTINGS (they are the installed application's business, like the research
 * rows), and the row carried no data-setting-id at all -- so the best any link
 * could do was drop somebody at the top of Settings. The owner's report was
 * "as a user I dont even see how after signing up that I now connect my
 * computer".
 *
 * IT IS EXPORTED, NOT SPELLED TWICE. The row renders it as its data-setting-id
 * and the settings page resolves it; a link that names it is only correct while
 * those two agree, so they read the same constant. */
export const CONNECT_SETTING_ID = 'connect_computer'

/* WHAT A PERSON IS TOLD TO TYPE INTO THEIR BROWSER, written once because a
 * wrong address here sends somebody to a page that cannot help them.
 *
 * It is the plain site, which is what is on the packaging and what they signed
 * up at. The account service's own origin is a separate name for the same box,
 * it belongs to the installed application, and it is never shown here.
 */
export const ACCOUNT_PAGE_HOST = 'toolsenabled.ai'

/* THE SHAPE A CODE HAS. Used only to decide whether what came back is showable
   at all: an answer that says ok and carries something else must not be painted
   40px high as though a person could type it anywhere. */
const CODE_SHAPE = /^TC-[A-Z0-9]{4}-[A-Z0-9]{4}$/

/* HOW OFTEN TO ASK IS THE SERVICE'S DECISION, NOT THIS FILE'S. Every wait uses
 * the `intervalSeconds` that came back with the code, and the number is re-read
 * from every answer in case the service changes its mind mid-wait.
 *
 * The clamp is not a second opinion about the cadence. It is the floor and
 * ceiling on a number this window did not compute: `0`, `-1`, `NaN` and
 * `undefined` all arrive as ordinary values, and each of them turns "ask again
 * in intervalSeconds" into either a storm of requests or a wait that never
 * ends. FALLBACK_SECONDS stands in only when the service said nothing at all,
 * and is deliberately slow rather than eager.
 */
const MIN_SECONDS = 1
const MAX_SECONDS = 300
const FALLBACK_SECONDS = 5

export function pollSeconds(value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds)) return FALLBACK_SECONDS
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(seconds)))
}

/* THE CAP APPLIES TO THE GUESS AND NEVER TO THE TYPING. A profile label is free
   text and somebody's is a paragraph; a forty-eight character default keeps the
   box readable without deciding for anyone what their computer may be called. */
const DEFAULT_NAME_MAX = 48

/* HOW LONG A NAME MAY BE, RESTATED HERE SO THE BOX CAN STOP AT IT.
 *
 * The authority is MAX_NAME_LENGTH in shell/device-claim.cjs and it stays the
 * authority -- this number never decides anything, it only lets the box refuse
 * a sixty-fifth keystroke instead of letting somebody fill it, press the
 * button, and be told by a round trip that the name they cannot see all of is
 * too long. SEEN ON GLASS: two hundred characters pasted in produced
 * DEVICE_CLAIM_NAME_INVALID as a sentence two hundred pixels above the button,
 * and forty party-popper emoji produced it too -- because that limit counts the
 * same units an <input maxlength> counts, so what looked like forty characters
 * was eighty. A box that stops is the only version of that a person can see
 * happening.
 *
 * IT IS A CEILING AND NEVER A PASS. The shell still checks; a name that gets
 * past this box because it was set some other way is still refused there. */
export const MAX_DEVICE_NAME = 64

/* The name this computer will carry on the account page. A label the person
   already chose for this system beats anything guessed from a browser they are
   not looking at, so it goes first. */
export function defaultDeviceName({ profileLabel = '', platform = '' } = {}) {
  const label = String(profileLabel || '').trim()
  if (label) return label.slice(0, DEFAULT_NAME_MAX)
  const kind = String(platform || '').toLowerCase()
  if (kind.includes('win')) return 'My Windows computer'
  if (kind.includes('mac') || kind.includes('darwin')) return 'My Mac'
  if (kind.includes('linux')) return 'My Linux computer'
  return 'My computer'
}

/* What actually goes up the wire. Somebody who clears the box has not asked for
   a nameless computer on their account -- they have cleared the box -- so the
   guess stands in rather than an empty name being filed against them. */
export function nameToClaim(state) {
  const typed = String(state?.name || '').trim()
  return typed || defaultDeviceName({ platform: state?.platform })
}

/* HOW LONG IS LEFT, SAID AS A WHOLE SENTENCE, INCLUDING WHEN THE ANSWER IS
 * "NOBODY TOLD US".
 *
 * A countdown quietly showing 0:00 forever because `expiresAtMs` was missing is
 * this codebase's signature defect wearing a clock face: absence painted as a
 * value. So the unknown case says it is unknown, and the person still has a way
 * to ask for a fresh code.
 *
 * Minutes and seconds rather than "about four minutes": the person is copying a
 * code into another device, and the difference between 4:40 and 0:40 is the
 * difference between finishing and starting again.
 */
export function remainingText(expiresAtMs, nowMs) {
  const ends = Number(expiresAtMs)
  if (!Number.isFinite(ends)) return 'This window was not told when this code stops working.'
  const left = ends - Number(nowMs || 0)
  if (!(left > 0)) return 'This code has run out. Ask for a new one below.'
  const seconds = Math.floor(left / 1000)
  const minutes = Math.floor(seconds / 60)
  return `Stops working in ${minutes}:${String(seconds % 60).padStart(2, '0')}.`
}

/* ---------- the states ----------
 *
 * checking   asking the installed application what it already knows
 * absent     this window has no way to ask at all
 * idle       nothing in flight; the name box and the button are what is shown
 * starting   a code has been asked for and has not come back
 * waiting    a code is on screen and this window is asking for the confirmation
 * orphaned   a claim is in flight whose code this screen cannot show
 * connected  the account collected it; this computer is on the account
 * ended      the code is no longer good for anything -- see `endedBecause`
 *
 * `refusal` IS NOT A STATE, IT IS A FIELD ON EVERY STATE, and that is the point
 * of it. A control that does nothing visible when pressed is the defect this
 * week is spent on, so a refusal never replaces the screen a person was looking
 * at -- it is added to it, as a whole sentence, with the controls still where
 * they were.
 */
export const CLAIM_PHASES = Object.freeze([
  'checking', 'absent', 'idle', 'starting', 'waiting', 'orphaned', 'connected', 'ended',
])

/* Why a code stopped being usable. Each is a different sentence to a person and
   the same offer -- ask for another -- so they share a phase and differ here,
   rather than multiplying states nobody can tell apart on screen.

   `stopped` IS THE ONE THE PERSON DID ON PURPOSE, and it is here because the
   alternative was a lie. Pressing "Stop waiting" used to land back on `idle`,
   whose line reads "Nothing has been sent anywhere" -- said to somebody who had
   just been shown a code that was very much sent somewhere. An ending a person
   chose is still an ending, and it belongs with the other three. */
export const ENDED_REASONS = Object.freeze(['gone', 'ran-out', 'not-tracked', 'stopped'])

export function initialState({ name = '', platform = '' } = {}) {
  return Object.freeze({
    phase: 'checking',
    name,
    platform,
    code: null,
    expiresAtMs: null,
    intervalSeconds: null,
    nextPollAtMs: null,
    device: null,
    claimedName: null,
    claimedAtMs: null,
    endedBecause: null,
    refusal: '',
    refusalCode: null,
  })
}

function next(state, patch) {
  return Object.freeze({ ...state, ...patch })
}

/* A refusal always becomes a whole sentence with something to do in it.
   src/refusal-copy.js is the one place in this product that guarantees that,
   and this flow has no business owning a second copy of the rule. The code is
   carried beside the sentence for the attribute the section writes, never for
   the glass. */
function refusalOf(result, remedy = '') {
  return {
    refusal: refusalSentence(result, {
      fallback: 'The installed application did not answer this window.',
      remedy,
    }),
    refusalCode: refusalCodeOf(result),
  }
}

/* The one remedy this flow knows better than the shared table does: a code that
   has expired or already been collected is cured by asking for another, which
   is a button on this very screen, and never by restarting anything. */
const RESTART_REMEDY = 'Ask for a new code below, then enter that one on the account page.'

/* The second one, for the same reason. A name the installed application will
 * not list this computer under is cured by changing the name -- in the box that
 * is on this screen, directly above the button that was just pressed.
 *
 * SEEN ON GLASS: the shared table's DEVICE_CLAIM_ family remedy sent that
 * person to their account page "to see which computers are joined", which for a
 * name that is too long is advice about somewhere else entirely. It is the
 * right floor for the family and the wrong sentence for this one, which is
 * exactly the case refusalSentence()'s `remedy` override exists for. */
const NAME_REMEDY = 'Change the name in the box above, then press the button again.'
const NAME_REFUSAL_CODE = 'DEVICE_CLAIM_NAME_INVALID'

/* The two states where a claim is actually in flight. Written down once
   because three branches now have to leave one alone. */
function waiting(state) {
  return state?.phase === 'waiting' || state?.phase === 'orphaned'
}

function deviceOf(source) {
  if (!source || typeof source !== 'object') return null
  const name = typeof source.name === 'string' ? source.name : ''
  const deviceId = typeof source.deviceId === 'string' ? source.deviceId : ''
  const pairId = typeof source.pairId === 'string' ? source.pairId : ''
  if (!name && !deviceId && !pairId) return null
  return Object.freeze({ name, deviceId, pairId })
}

/**
 * The whole flow, as one pure function.
 *
 * RETURNS THE SAME OBJECT WHEN NOTHING CHANGED, and the section depends on it:
 * the clock ticks once a second while a code is up, and a fresh object every
 * tick would redraw the section under a person's pointer sixty times a minute.
 * An identity check is what lets the caller repaint only the countdown.
 */
export function reduce(state, event) {
  const type = event?.type
  const nowMs = Number(event?.nowMs)

  if (type === 'bridge-absent') {
    return state.phase === 'absent' ? state : next(state, { phase: 'absent' })
  }

  if (type === 'name-changed') {
    const name = String(event.name ?? '')
    return name === state.name ? state : next(state, { name })
  }

  if (type === 'status') {
    const result = event.result
    if (result?.ok !== true) {
      /* A status this window could not read is NOT "not connected". The button
         stays, because trying is still the person's move, and the sentence says
         why the screen could not answer the question first. */
      if (waiting(state)) return next(state, refusalOf(result))
      return next(state, { phase: 'idle', ...refusalOf(result) })
    }
    if (result.connected === true) {
      return next(state, {
        phase: 'connected',
        device: deviceOf(result),
        claimedAtMs: Number.isFinite(Number(result.claimedAtMs)) ? Number(result.claimedAtMs) : null,
        code: null,
        nextPollAtMs: null,
        endedBecause: null,
        refusal: '',
        refusalCode: null,
      })
    }
    /* "NOT CONNECTED" IS WHAT A WAIT IS FOR, so it must not end one.
       status() is asked once per screen, and a screen that came back to a code
       still in flight (see `adopted-code`) asks it with that code already up.
       Answering "no account yet" by throwing the code away would take the one
       thing the person came back for, on the strength of an answer that says
       nothing except that they have not typed it in yet. */
    if (waiting(state)) return next(state, { device: null, claimedAtMs: null, refusal: '', refusalCode: null })
    return next(state, { phase: 'idle', device: null, claimedAtMs: null, refusal: '', refusalCode: null })
  }

  if (type === 'begin-requested') {
    return next(state, { phase: 'starting', endedBecause: null, refusal: '', refusalCode: null })
  }

  if (type === 'begin-result') {
    const result = event.result
    if (result?.ok !== true) {
      const remedy = refusalCodeOf(result) === NAME_REFUSAL_CODE ? NAME_REMEDY : ''
      return next(state, { phase: 'idle', ...refusalOf(result, remedy) })
    }
    const code = typeof result.code === 'string' ? result.code.trim() : ''
    if (!CODE_SHAPE.test(code)) {
      /* An answer that said ok and carried no code has given this person
         nothing to type. Painting it would be this screen inventing a fact, so
         it says what happened and leaves the button where it was. */
      return next(state, {
        phase: 'idle',
        refusal: 'The installed application answered without a code to show. Ask for one again.',
        refusalCode: null,
      })
    }
    const seconds = pollSeconds(result.intervalSeconds)
    return next(state, {
      phase: 'waiting',
      code,
      /* THE NAME AS IT WENT UP, NOT AS THE BOX READS LATER. nameToClaim() is
         called once, here, over the state that produced this claim -- so a
         screen rebuilt from the remembered code reports what the account page
         will actually show rather than recomputing a guess from a box that is
         no longer on the screen. SEEN ON GLASS at 1000x650: a claim opened as
         "Front desk", left and returned to, said "It will be listed as My
         Windows computer". */
      claimedName: nameToClaim(state),
      expiresAtMs: Number.isFinite(Number(result.expiresAtMs)) ? Number(result.expiresAtMs) : null,
      intervalSeconds: seconds,
      nextPollAtMs: Number.isFinite(nowMs) ? nowMs + seconds * 1000 : null,
      endedBecause: null,
      refusal: '',
      refusalCode: null,
    })
  }

  if (type === 'poll-result') {
    const result = event.result
    if (result?.ok !== true) {
      if (refusalCodeOf(result) === 'DEVICE_CLAIM_GONE') {
        return next(state, {
          phase: 'ended',
          endedBecause: 'gone',
          code: null,
          nextPollAtMs: null,
          ...refusalOf(result, RESTART_REMEDY),
        })
      }
      /* ANY OTHER REFUSAL MUST NOT END THE WAIT. The code on screen is still
         the code the account page is expecting, and one unanswered ask is not
         evidence against it. The sentence goes up and the next ask is still
         scheduled, so somebody mid-typing does not lose their code to a
         momentary refusal. */
      const seconds = state.intervalSeconds || FALLBACK_SECONDS
      return next(state, {
        nextPollAtMs: Number.isFinite(nowMs) ? nowMs + seconds * 1000 : state.nextPollAtMs,
        ...refusalOf(result),
      })
    }
    if (result.state === 'connected') {
      return next(state, {
        phase: 'connected',
        device: deviceOf(result.device),
        code: null,
        nextPollAtMs: null,
        endedBecause: null,
        refusal: '',
        refusalCode: null,
      })
    }
    if (result.state === 'none') {
      /* Nothing is in flight where this window believed something was. It
         happens when the application was restarted under an open screen. It is
         not a failure and it is not a connection; it is a wait that is over. */
      return next(state, {
        phase: 'ended',
        endedBecause: 'not-tracked',
        code: null,
        nextPollAtMs: null,
        refusal: '',
        refusalCode: null,
      })
    }
    const seconds = pollSeconds(result.intervalSeconds ?? state.intervalSeconds)
    return next(state, {
      intervalSeconds: seconds,
      nextPollAtMs: Number.isFinite(nowMs) ? nowMs + seconds * 1000 : null,
      refusal: '',
      refusalCode: null,
    })
  }

  /* THE CODE THIS WINDOW ALREADY SHOWED, PUT BACK.
   *
   * SEEN ON GLASS, and it is the worst thing this screen did: a person with a
   * code up who moved to another screen in the same window and came straight
   * back was shown "This computer is not on an account yet -- nothing has been
   * sent anywhere" for two seconds, and then "A code was already asked for; this
   * screen cannot show it a second time." Their code was gone, they were told it
   * could not be shown again, and the only way on was to start over -- for
   * clicking twice inside one window.
   *
   * The section rebuilds from nothing on every visit because the settings page
   * builds a new controller each time, so the memory has to outlive the
   * controller; src/connect-computer-settings.js keeps it and hands it here. It
   * is the CODE and its deadline -- the two things already on the glass -- and
   * never the poll token, which this half of the product has no name for.
   *
   * AN EXPIRED ONE IS NOT PUT BACK, and neither is anything that is not shaped
   * like a code: a remembered value is still a value this screen has to be
   * suspicious of, and painting a dead code would be worse than the state it
   * replaces. The wait it restores is confirmed the ordinary way -- the next
   * poll either says `pending`, or ends it as `gone` or `not-tracked`. */
  if (type === 'adopted-code') {
    const code = typeof event.code === 'string' ? event.code.trim() : ''
    if (!CODE_SHAPE.test(code)) return state
    const ends = Number(event.expiresAtMs)
    if (Number.isFinite(ends) && Number.isFinite(nowMs) && nowMs >= ends) return state
    const seconds = pollSeconds(event.intervalSeconds)
    return next(state, {
      phase: 'waiting',
      code,
      claimedName: typeof event.claimedName === 'string' && event.claimedName ? event.claimedName : null,
      expiresAtMs: Number.isFinite(ends) ? ends : null,
      intervalSeconds: seconds,
      nextPollAtMs: Number.isFinite(nowMs) ? nowMs + seconds * 1000 : null,
      endedBecause: null,
      refusal: '',
      refusalCode: null,
    })
  }

  if (type === 'adopted-pending') {
    /* A claim this window did not open is in flight -- somebody started one,
       walked to another screen and came back, and the code lives in the
       application's memory where this screen cannot reach it. The screen says
       exactly that and offers a fresh code; see `orphaned` above. */
    const seconds = pollSeconds(event.intervalSeconds)
    return next(state, {
      phase: 'orphaned',
      code: null,
      expiresAtMs: null,
      intervalSeconds: seconds,
      nextPollAtMs: Number.isFinite(nowMs) ? nowMs + seconds * 1000 : null,
      refusal: '',
      refusalCode: null,
    })
  }

  if (type === 'tick') {
    if (state.phase !== 'waiting') return state
    if (!Number.isFinite(Number(state.expiresAtMs))) return state
    if (nowMs < Number(state.expiresAtMs)) return state
    /* THE LOCAL CLOCK IS ALLOWED TO END A WAIT because the deadline came from
       the service, not from here -- this is the service's own expiry arriving,
       not this window's opinion of one. A clock behind the service's simply
       keeps asking until the refusal says the same thing; one ahead of it
       offers a new code slightly early. Neither is a dead end, which is the
       property that matters. */
    return next(state, { phase: 'ended', endedBecause: 'ran-out', code: null, nextPollAtMs: null })
  }

  /* STOPPING THE WAIT IS AN ENDING, AND IS SAID AS ONE. It shares the phase
     with the three that were not the person's doing, because what happens next
     is the same in all four: the code is no good, and there is a button that
     gets another. What differs is the sentence, which is the only thing
     `endedBecause` has ever been for. */
  if (type === 'cancelled') {
    return next(state, {
      phase: 'ended',
      endedBecause: 'stopped',
      code: null,
      expiresAtMs: null,
      nextPollAtMs: null,
      refusal: '',
      refusalCode: null,
    })
  }

  if (type === 'restart') {
    return next(state, {
      phase: 'idle',
      code: null,
      expiresAtMs: null,
      nextPollAtMs: null,
      endedBecause: null,
      refusal: '',
      refusalCode: null,
    })
  }

  return state
}

/**
 * Whether a state change is one a person would SEE.
 *
 * MEASURED ON GLASS, and it is why this function exists. Driving the waiting
 * state in a real browser: the section was rebuilt every two seconds, because
 * each `pending` answer moves `nextPollAtMs` and reduce() therefore returns a
 * new object. The rebuild replaced the code field -- so somebody part-way
 * through selecting their code to copy it lost the selection, silently, on the
 * service's cadence. The code was still on the screen, which is what makes it
 * the kind of defect nobody reports and everybody feels.
 *
 * So the section repaints on what is DRAWN and never on the bookkeeping. The
 * two fields deliberately left out are the ones that must not cause one:
 *
 *   nextPollAtMs / intervalSeconds  bookkeeping. Never on the glass.
 *   name                            it IS drawn, as the box's value -- but the
 *                                   box already holds what the person typed,
 *                                   and rewriting it under them is the same
 *                                   defect with a caret instead of a selection.
 */
export function repaintNeeded(previous, next) {
  if (previous === next) return false
  return previous.phase !== next.phase
    || previous.code !== next.code
    || previous.expiresAtMs !== next.expiresAtMs
    || previous.endedBecause !== next.endedBecause
    || previous.refusal !== next.refusal
    || previous.refusalCode !== next.refusalCode
    || (previous.device?.name || '') !== (next.device?.name || '')
}

/** Whether the next ask is due. The section's one interval puts this question
 *  every second rather than arming a timer per cadence, so a service that
 *  changes `intervalSeconds` mid-wait is obeyed on the very next answer. */
export function pollDue(state, nowMs) {
  if (!clockShouldRun(state)) return false
  if (!Number.isFinite(Number(state.nextPollAtMs))) return false
  return Number(nowMs) >= Number(state.nextPollAtMs)
}

/** Whether the clock should be running at all. The section starts and stops its
 *  one interval from this answer, so "which states tick" is written down once
 *  and a state added later cannot quietly leave a timer running behind it. */
export function clockShouldRun(state) {
  return state?.phase === 'waiting' || state?.phase === 'orphaned'
}
