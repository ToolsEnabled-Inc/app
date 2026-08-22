/* THE WORDS THE LEDGER PAGE USES, IN THE ONE FILE THAT HAS NO BROWSER IN IT.
 *
 * WHY THESE STRINGS LEFT THE VIEW. src/views/ledger.js imports a stylesheet, so
 * a plain `node` run cannot load it, and every sentence this page shows when it
 * has no rows was composed inside a closure in there. That matters because the
 * defect on this page is not any one sentence. The owner's word for it was "a
 * mess (not human friendly)", and what he was looking at was one state told
 * three different ways at once: a red "could not be read" in the register's
 * accessible name and in its counter, a calm "this copy does not keep one, so
 * there is nothing here to show" in the paragraph between them, and below that
 * two red forms whose fields described themselves in terms of a list that was
 * not on the screen. Every sentence, read on its own, was defensible.
 *
 * A check that reads string literals one at a time cannot see that, which is
 * how tools/check-plain-language.mjs passed the whole thing. So the strings
 * live here, where a plain `node` run can build the WHOLE panel for a state and
 * measure it as one thing -- see tools/check-composed-output.mjs.
 *
 * TWO STATES THAT LOOK THE SAME AND ARE NOT, and keeping them apart is most of
 * the repair:
 *
 *   EMPTY      the read answered, and there is nothing in it. On a copy that is
 *              not a ToolsEnabled development checkout this is the normal,
 *              permanent state: nothing in the shipped program ever files an
 *              entry here, so no amount of use will fill it. Nothing is wrong.
 *   UNREADABLE the read did not answer. Something is there and could not be
 *              trusted, or the read never finished. That is a fault, it has a
 *              different repair, and it is the only one of the two that has
 *              earned the words "could not".
 *
 * src/live-status.js already tells them apart and the page was throwing the
 * distinction away. A projection that ANSWERS with `ok: false` comes back with
 * its validated envelope attached; a read that fell over comes back with
 * nothing attached. That is the signal, and it was there all along.
 */

/* The read is still in flight. Not a failure and not an empty answer -- the
   third thing, and it is only on screen for a moment. */
export const LEDGER_LOADING = Object.freeze({
  state: 'loading',
  tone: 'note',
  label: 'Reading your requests',
  className: 'projection-loading',
  body: 'Reading your requests…',
  count: 'reading…',
  countsKnown: false,
  door: false,
})

/* WHAT THIS LIST IS, SAID PLAINLY, INSTEAD OF WHY A FILE WOULD NOT OPEN.
   Measured against the shipped payload on 2026-08-17: entries here are written
   only by the builder command run inside a ToolsEnabled source checkout, and
   nothing in the shipped program files one. So this copy has nothing here today
   and will still have nothing after any amount of use, and a sentence with
   "yet" in it would be a promise nobody can keep. */
export const LEDGER_EMPTY = Object.freeze({
  state: 'empty',
  tone: 'note',
  label: 'Your requests, of which there are none',
  className: 'projection-empty',
  body: 'This list holds requests recorded while ToolsEnabled itself is being built. This copy does not keep one, so there is nothing here to show.',
  count: 'nothing to show',
  countsKnown: true,
  door: true,
})

/* A GENUINE FAILURE, WORDED SO IT CANNOT BE MISTAKEN FOR THE ONE ABOVE. It says
   what happened, that nothing was changed, and the one thing worth doing. It
   does NOT put the underlying reason in the sentence: that reason comes from a
   file and can be a schema complaint. It rides on the element as data instead,
   the way src/refusal-copy.js carries a code. */
export const LEDGER_UNREADABLE = Object.freeze({
  state: 'unreadable',
  tone: 'refused',
  label: 'Your requests could not be read',
  className: 'projection-unavailable',
  body: 'Your requests could not be read, so this page cannot show them. Nothing was changed. Close ToolsEnabled and open it again; if it still will not read, this copy needs attention before this page will work.',
  count: 'could not be read',
  countsKnown: false,
  door: true,
})

export const QUESTIONS_EMPTY = Object.freeze({
  state: 'empty',
  tone: 'note',
  label: 'Your questions, of which there are none',
  className: 'projection-empty',
  body: 'This list holds questions that are waiting on a decision from you. There are none, so there is nothing here to show.',
  count: 'nothing to show',
  countsKnown: true,
  door: true,
})

export const QUESTIONS_UNREADABLE = Object.freeze({
  state: 'unreadable',
  tone: 'refused',
  label: 'Your questions could not be read',
  className: 'projection-unavailable',
  body: 'Your questions could not be read, so this page cannot show them. Nothing was changed. Close ToolsEnabled and open it again; if it still will not read, this copy needs attention before this page will work.',
  count: 'could not be read',
  countsKnown: false,
  door: true,
})

/* THE STATES THE REGISTER CAN BE IN WITH NOTHING TO DRAW, declared rather than
   discovered, so tools/check-composed-output.mjs measures every one of them and
   a state added later cannot arrive unmeasured. */
export const REGISTER_NOTICE_STATES = Object.freeze(['loading', 'empty', 'unreadable'])

const NOTICES = Object.freeze({
  loading: LEDGER_LOADING,
  empty: LEDGER_EMPTY,
  unreadable: LEDGER_UNREADABLE,
})

const QUESTION_NOTICES = Object.freeze({
  loading: LEDGER_LOADING,
  empty: QUESTIONS_EMPTY,
  unreadable: QUESTIONS_UNREADABLE,
})

/**
 * What the register shows when it has no rows, or null when it has rows.
 *
 * ONE NOTICE, ONE STORY. The paragraph, the accessible name, the counter, the
 * state marker and whether the totals above are knowable all come out of the
 * same object, so they cannot disagree with each other again.
 */
export function registerNotice(source, { mode = 'r' } = {}) {
  if (!source) return null
  const table = mode === 'q' ? QUESTION_NOTICES : NOTICES
  return table[source.kind] || null
}

/* ---------------------------------------------------------------- forms -- */

/* WHY THE FORMS WERE UNREADABLE, AND IT WAS NOT THE WORD COUNT.
 *
 * Both asked for "its number, as shown in the list" -- on a page whose list, in
 * the state a first-time reader meets, is empty. The field sent the person to
 * read something that was not there. And the Approve/Decline form was not
 * connected to the list above it in any way: the register shows requests, the
 * field took free text, and nothing checked that what was typed was one of the
 * things on screen.
 *
 * So the label says what the field is, the field is filled FROM the register
 * whenever the register has anything in it, and when it does not the control is
 * off with the reason beside it rather than open and useless. */
export const DECISION_FORM = Object.freeze({
  title: 'Approve or decline a request',
  targetLabel: 'Which request',
  /* When the register has rows the field is a picker and needs no example. */
  targetHint: 'Choose the one you want to answer.',
  /* When it does not -- the demonstration list, or a copy with no register --
     the field is typed, and the example is a shape rather than a pointer at
     something that may not be on screen. */
  targetHintTyped: 'Type the reference of the request, which looks like R1152.',
  reasonLabel: 'Why',
  reasonHint: 'Recorded with your decision. The rest of the system acts on this.',
  approve: 'Approve',
  decline: 'Decline',
})

export const QUEUE_FORM = Object.freeze({
  title: 'Take or finish queued work',
  reveal: 'Show queued work',
  hide: 'Hide queued work',
  rootLabel: 'Folder',
  itemLabel: 'Which item',
  itemHint: 'The item’s short number in that folder’s work list, such as 3.',
  reasonLabel: 'Why you are closing it',
  reasonHint: 'Needed only when you close one.',
  claim: 'Claim',
  close: 'Close',
})

/* THE ONE LINE UNDER THE QUEUE BUTTONS, AND THE ONE REFUSAL ON THIS SURFACE
   THAT WAS WRITTEN BY HAND INSTEAD OF THROUGH refusalSentence().
 *
 * It read: "This folder's work list could not be read, so Claim and Close are
 * off." followed by whatever the layer said -- which, until the engine's
 * typedError() stopped replacing every message with a constant, was always the
 * same six words: "The audited dependency refused the action." That is the red
 * line the owner was looking at, and it is why it read differently from every
 * other refusal in the product.
 *
 * The check on the current list is stated here rather than asked for in a box.
 * It used to be a visible 64-character field labelled "Proof you are looking at
 * the current list", filled in for the person, that they could not type into. */
export function queueSnapshotLine(snapshot) {
  const ready = snapshot?.ok === true && /^[a-f0-9]{64}$/.test(snapshot?.hash || '')
  if (ready) {
    return Object.freeze({
      ready: true,
      tone: 'ready',
      text: 'That folder’s work list was read just now, so Claim and Close will act on what you are looking at.',
    })
  }
  const said = typeof snapshot?.reason === 'string' && /[a-z]/.test(snapshot.reason) ? snapshot.reason.trim() : ''
  const because = said ? ` ${/[.!?…]$/.test(said) ? said : `${said}.`}` : ''
  return Object.freeze({
    ready: false,
    tone: 'unavailable',
    text: `Claim and Close are off, because that folder’s work list was not read.${because} Choose another folder, or press Retry above.`,
  })
}

/* WHY A CONTROL IS OFF, SAID WHERE THE CONTROL IS.
 *
 * A disabled button with no sentence beside it is the most common lie a screen
 * tells: it looks like the person did something wrong. Each of these names the
 * state, so the reason sits next to the thing it explains instead of having to
 * be inferred from a paragraph further up the page. */
/* EACH ONE CARRIES ITS OWN TONE, and that is the half of this repair that is
   easy to miss. A control that is off because there is NOTHING TO DO is not a
   failure and must not be painted as one -- painting it red is the same defect
   as the register's, one level down: the words say "there is nothing here" and
   the colour says "something went wrong". Only the unreadable case has earned
   the failure colour. */
export const DECISION_OFF = Object.freeze({
  loading: Object.freeze({
    tone: 'note',
    text: 'Approve and Decline switch on once your requests have been read.',
  }),
  empty: Object.freeze({
    tone: 'note',
    text: 'There is nothing to approve or decline: this copy keeps no request list. When it has one, this fills in from it.',
  }),
  unreadable: Object.freeze({
    tone: 'unavailable',
    text: 'Approve and Decline are off until your requests can be read, because nothing can check that what you answer is really one of them.',
  }),
})

/**
 * Why the Approve/Decline form is off, as the sentence and the colour together.
 *
 * Returns null when the control should simply work, which is the state that
 * needs no explanation.
 */
export function decisionOff(register) {
  if (!register) return null
  if (register.kind === 'loading') return DECISION_OFF.loading
  if (register.kind === 'unreadable') return DECISION_OFF.unreadable
  if (register.kind === 'empty') return DECISION_OFF.empty
  if (register.kind === 'live' && (register.items || []).length === 0) return DECISION_OFF.empty
  return null
}

/* ------------------------------------------------------- hiding a row -- */

/* THE × ON A ROW, AND EVERY WORD AROUND IT.
 *
 * WHAT THE CONTROL REALLY DOES, which is what the words must say. Three lists
 * were looked at for "delete" (plan O6) and none of them has an honest one: an
 * owner request lives in an append-only, hash-chained ledger that is never
 * shortened, an archived request still reaches every projected list until
 * three separate sessions have seen it, and an owner question is parsed out of
 * a planning file the app has no writer for. So a × here hides the row on this
 * screen, in this copy's own storage, and changes nothing else anywhere. Every
 * sentence below says so, because a × that looked like a delete and was not
 * would be the register's old defect again: chrome saying one thing, the facts
 * another.
 *
 * TONE 'note', NEVER RED. The :214-219 rule above applies one level down: a
 * row that is gone because the person hid it is not a failure and must not be
 * painted as one. Nothing in this table uses a failure word. */
export const HIDE_ROW = Object.freeze({
  tone: 'note',
  /* the control's accessible name and its tooltip */
  aria: id => `Hide ${id} from this list`,
  title: 'Hide from this list',
  /* the control on a row that is already hidden and shown on request */
  putBack: id => `Put ${id} back in this list`,
  putBackTitle: 'Put back in this list',
  /* under the row, after the first press */
  armed: id => `Hide ${id}? Press × again. It is hidden on this screen only; nothing else changes.`,
  /* in the toolbar note, after the second press */
  hiddenR: id => `${id} hidden. It is still in your records — only this list stops showing it.`,
  hiddenQ: id => `${id} hidden. It is still in the work list — only this list stops showing it.`,
  restored: id => `${id} is back in this list.`,
  /* the counter's tail and the toggle beside it */
  count: n => `${n} hidden`,
  show: 'Show hidden',
  hideAgain: 'Hide them again',
  undo: 'Undo',
})
