/* What the Start control says about the session it is about to start.
 *
 * WHY THIS MODULE EXISTS, AND WHAT IT REPLACES.
 *
 * Until now src/agent-session.js carried one frozen sentence:
 *
 *   "Runs with your full local access. No permission tier limits a running
 *    session. Every start is recorded on this device before it runs."
 *
 * Two of those three clauses are now FALSE, and they were measured false rather
 * than argued false. capability/src/lib/agent-session-confinement.js resolves a
 * recorded level into `threadOptions: {sandbox, approvalPolicy}`, and
 * wt-capability/shell/agent-host.cjs startSession() passes exactly that object to
 * the engine's thread/start. Measured on this tree, 2026-08-11:
 *
 *   guided       -> sandbox read-only          (isolated assistant home)
 *   standard     -> sandbox workspace-write    (isolated assistant home)
 *   unrestricted -> sandbox danger-full-access (the user's own home, unnarrowed)
 *
 * and a machine with NO record fails closed to `guided`. So on a fresh install --
 * the normal first experience -- the screen promised full local access and no
 * tier limit over a session that cannot write a single file. The one clause that
 * survives is the third: mc-agent:start calls recordSpawnIntent() before
 * getAgentHost().startSession(), and mc-agent:availability refuses on the
 * recorder before it even asks about the engine.
 *
 * WHY THE NUMBER IS NOT A CONSTANT IN THIS FILE.
 *
 * The obvious way to "state what this level permits" is to write the tool counts
 * down. That is how the sentence above went false in the first place: a true
 * measurement, frozen into source, outliving the thing it measured. Measured
 * three ways on one machine on one night:
 *
 *   this checkout's payload        guided 109   standard 256   total 265
 *   release/win-unpacked payload   guided 116   standard 296   total 305
 *
 * One number, two answers, because the count is a property of the INSTALLED
 * payload and not of the product. A build that stages one more server moves it
 * again. So no count is written here: the caller passes what the main process
 * measured from the real registry at the moment of asking, and a reading that
 * carries no count simply does not get that sentence. A missing true number is a
 * smaller defect than a present false one.
 *
 * PURE ON PURPOSE. No DOM, no stylesheet, no bridge. src/agent-session.js reaches
 * the DOM through components.js, whose module graph starts the demonstration
 * simulator's timers on import and never lets a plain-node test process exit --
 * so a suite that wanted to assert this copy would be reduced to asserting on
 * source TEXT, which passes just as well when the table is right and the lookup
 * is wrong. This module is importable by `node --test` and the suite asserts the
 * SENTENCES a reading produces.
 */

import { TIER_CHOICES } from './setup-state.js'

/* The level's own words, taken from the question that asked them rather than
   rewritten here. tools/mcsetup.js and src/views/setup.js already put these
   exact sentences in front of the person choosing; a second vocabulary on this
   screen would make one decision look like two. */
const TIER_DETAIL = Object.freeze(Object.fromEntries(
  TIER_CHOICES.map(choice => [choice.tier, choice.detail]),
))

/* WHAT THE OS DOES TO THE RUNNING PROCESS, keyed by the sandbox word actually
   sent to thread/start -- not by the tier name. The tier is what was chosen; the
   sandbox is what is enforced, and this line is the one a person is entitled to
   read as a promise about their disk. Each is the behaviour
   agent-session-confinement.js records as measured against a user config that
   says danger-full-access, where the thread option won. */
export const SANDBOX_EFFECT = Object.freeze({
  'read-only': 'It can read files, and this computer refuses any attempt it makes to change one.',
  'workspace-write': 'It can change files in the folder you chose, and this computer refuses any attempt it makes to change one outside it.',
  'danger-full-access': 'Nothing narrows it: it can read, change and delete any file on this computer and run any program, without asking.',
})

/* The clause that is still true, and the only one carried over unedited.
   Precision matters here and the wording is deliberately not stronger: this is
   the app's own signed, hash-chained local ledger, and the signing key lives on
   the same machine as the ledger -- tamper-evident against edits, not proof
   against this OS user. "Recorded on this device" is exactly that claim and not
   one word more. */
export const RECORD_CLAUSE = 'Every start is recorded on this device before it runs.'

/* Said when the level could not be read rather than chosen. The product's own
   fail-closed direction is `guided`, so this is not a warning about degraded
   safety -- it is the opposite, and saying it plainly stops a person concluding
   their unrestricted choice is in force when it is not. */
export const FAIL_CLOSED_CLAUSE = 'No level is recorded on this computer yet, so a session runs at the most restrictive one.'

/* Shown when the shell is not there to ask (a browser, vite preview). It states
   an absence rather than assuming either answer -- the same rule
   mcAgent.availability() and mcSetup.bootstrap already follow. */
export const UNKNOWN_CONFINEMENT = 'This page cannot tell what a session here would be allowed to do, so it is not going to guess.'

const TIER_NAME = Object.freeze({
  guided: 'Guided',
  standard: 'Standard',
  unrestricted: 'Unrestricted',
})

/** The tools sentence, or null when no count was measured.
 *
 *  `allowed === null` is the deliberate shape for `unrestricted`: the level
 *  narrows nothing, so there is no allowlist to count and `total` is the whole
 *  surface. Reporting "305 of 305" would be arithmetically true and would still
 *  misdescribe the mechanism, which is that no narrowing is applied at all. */
export function toolsSentence({ allowed = null, total = null } = {}) {
  const wholeNumber = value => Number.isInteger(value) && value >= 0
  if (!wholeNumber(total) || total === 0) return null
  if (allowed === null) return `It is offered all ${total} of this copy's tools.`
  if (!wholeNumber(allowed) || allowed > total) return null
  return `It is offered ${allowed} of this copy's ${total} tools.`
}

/**
 * Every sentence the Start control should show, for one confinement reading.
 *
 * Returns `{ level, effect, tools, record, note, sentences }`. `sentences` is the
 * ordered list actually rendered, so a caller cannot show a different set than
 * the one this module decided on, and a test can assert the whole screenful.
 *
 * NEVER THROWS AND NEVER INVENTS. An unreadable or absent reading collapses to
 * the unknown state above rather than to the cheerful one. The old sentence was
 * the cheerful default written down, and it survived a tier system landing
 * underneath it precisely because nothing recomputed it.
 */
export function confinementNote(reading) {
  if (!reading || typeof reading !== 'object' || Array.isArray(reading) || reading.ok !== true) {
    return Object.freeze({
      level: null,
      effect: UNKNOWN_CONFINEMENT,
      tools: null,
      record: RECORD_CLAUSE,
      note: null,
      sentences: Object.freeze([UNKNOWN_CONFINEMENT, RECORD_CLAUSE]),
    })
  }

  const tier = typeof reading.tier === 'string' ? reading.tier : null
  const name = TIER_NAME[tier] || null
  const effect = SANDBOX_EFFECT[reading.sandbox] || null
  /* An unrecognised sandbox word is the one case that must not fall through to a
     reassuring sentence. It means this renderer is older than the confinement
     table it is reading, and the honest answer is that it does not know. */
  const level = name ? `This computer is set to ${name}.` : null
  const detail = tier && TIER_DETAIL[tier] ? TIER_DETAIL[tier] : null
  const tools = toolsSentence({
    allowed: reading.toolsAllowed === undefined ? null : reading.toolsAllowed,
    total: reading.toolsTotal === undefined ? null : reading.toolsTotal,
  })
  const note = reading.failedClosed === true ? FAIL_CLOSED_CLAUSE : null

  if (!level || !effect) {
    return Object.freeze({
      level: null,
      effect: UNKNOWN_CONFINEMENT,
      tools: null,
      record: RECORD_CLAUSE,
      note,
      sentences: Object.freeze([UNKNOWN_CONFINEMENT, ...(note ? [note] : []), RECORD_CLAUSE]),
    })
  }

  /* `detail` is the level's own promise and `effect` is what the OS does about
     it. Both are shown at the confined levels because they answer different
     questions -- "where does it work" and "what stops it leaving" -- and a person
     deciding to press Start is owed both. At `unrestricted` they collapse into
     the same statement, so only one is shown rather than saying it twice. */
  const sentences = tier === 'unrestricted'
    ? [level, effect, ...(note ? [note] : []), ...(tools ? [tools] : []), RECORD_CLAUSE]
    : [level, detail, effect, ...(note ? [note] : []), ...(tools ? [tools] : []), RECORD_CLAUSE]

  return Object.freeze({
    level,
    effect,
    tools,
    record: RECORD_CLAUSE,
    note,
    sentences: Object.freeze(sentences.filter(Boolean)),
  })
}

/** The one-line form, for the status row under the Start button. */
export function confinementLine(reading) {
  return confinementNote(reading).sentences.join(' ')
}
