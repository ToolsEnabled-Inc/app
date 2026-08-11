/* The permission-level question: its words, and whether it still has to be asked.
 *
 * docs/design/INSTALLER-EXPERIENCE.md 2.1 states that this screen's wording is
 * part of the specification and not an implementation detail. The strings below
 * are therefore COPIED, not composed: they are the same three choices
 * tools/mcsetup.js asks on the command line, so a person who sets this product
 * up from a terminal and a person who sets it up from the window are answering
 * one question rather than two that resemble each other.
 *
 * This module holds no DOM and touches no stylesheet, so the first-run gate can
 * be tested without a browser -- which is the point, because the gate decides
 * what the product shows on the one launch a customer forms their opinion on.
 */

/* The three tiers in the order the question presents them, `guided` first
   because it is preselected: the least confident reader must be able to proceed
   by not deciding. Verbatim from tools/mcsetup.js TIER_CHOICES. */
export const TIER_CHOICES = Object.freeze([
  Object.freeze({
    tier: 'guided',
    label: 'I’m new to this',
    note: 'Recommended',
    detail: 'The assistant works inside one folder that you pick, and cannot reach anything else on this computer.',
  }),
  Object.freeze({
    tier: 'standard',
    label: 'I’ve used AI coding tools before',
    note: '',
    detail: 'The assistant works inside the projects you add, and cannot reach the rest of the computer.',
  }),
  Object.freeze({
    tier: 'unrestricted',
    label: 'I run agents with permissions bypassed',
    note: '',
    detail: 'The assistant can read, change, and delete any file on this computer and run any program, without asking.',
  }),
])

export const TIER_IDS = Object.freeze(TIER_CHOICES.map(choice => choice.tier))
export const DEFAULT_TIER = TIER_IDS[0]

export const TIER_QUESTION = 'How much should the assistant be allowed to do?'
export const TIER_QUESTION_SUB = 'This is the only thing you need to decide right now. You can change it later in Settings.'

/* SHOWN WHERE THE CHOICE IS MADE, NOT ONLY WHERE IT IS AUDITED.
 *
 * The three sentences above say "cannot reach anything else on this computer".
 * Tier enforcement against a RUNNING agent is task T5 and is not built, so
 * until it is, that sentence describes the configuration this level generates
 * and not a lock. A person reading it has no way to know that, which is why the
 * notice sits between the choices and the button rather than in a log, a
 * document, or a verify command a customer never runs.
 *
 * Copied from tools/mcsetup.js TIER_LIMIT_NOTICE, with ONE deliberate
 * difference. The command-line version's first paragraph ends "...and setup
 * shows you the set it wrote", which is true of the CLI: it generates the
 * configuration in the same run and prints it. This screen records the level
 * and does not generate that file, so repeating the clause here would be the
 * exact kind of small overclaim the notice exists to prevent. The clause is
 * dropped; nothing else is reworded.
 *
 * IT BECOMES UNTRUE THE DAY T5 LANDS. Delete it then.
 */
export const TIER_LIMIT_LEAD = 'Before you choose, one thing this program will not pretend about.'
export const TIER_LIMIT_NOTICE = Object.freeze([
  'This level decides which tools setup writes into the assistant’s configuration. That part is real: a narrower level generates a smaller set of tools.',
  'It does not yet confine an assistant once that assistant is running. Wording like “cannot reach anything else on this computer” describes what the configuration hands over, not a limit enforced while the assistant works. That enforcement is not built yet.',
])

/**
 * Normalize whatever the shell handed the renderer into one shape.
 *
 * Every unknown collapses to `available: false` with a code, never to a
 * cheerful default. A first-run screen that assumes it can write when it cannot
 * offers a button guaranteed to fail, which is the failure mode
 * mcAgent.availability() was added to stop.
 */
export function readSetupState(scope = globalThis) {
  const bridge = scope?.mcSetup
  if (!bridge || typeof bridge.chooseTier !== 'function') {
    return {
      available: false,
      configured: false,
      tier: null,
      code: 'MC_SETUP_SHELL_ABSENT',
      reason: 'This page is running in a browser rather than the installed application, so there is no computer here to configure.',
    }
  }
  const bootstrap = bridge.bootstrap
  /* Arrays are rejected explicitly. `typeof [] === 'object'`, so the obvious
     guard lets one through, and an array then answers `undefined` to every
     field below -- which reads as "available, nothing recorded yet" and opens
     the question with a button guaranteed to fail. That is the precise trap
     failing open exists to avoid. shell/main.cjs rejects arrays the same way in
     isPlainObject(); this is the renderer half of the same rule. */
  if (!bootstrap || typeof bootstrap !== 'object' || Array.isArray(bootstrap)) {
    return { available: false, configured: false, tier: null, code: 'MC_SETUP_STATE_ABSENT', reason: 'The application did not report whether this computer has been set up.' }
  }
  if (bootstrap.ok === false || bootstrap.available === false) {
    return {
      available: false,
      configured: false,
      tier: null,
      code: bootstrap.code || 'MC_SETUP_UNAVAILABLE',
      reason: bootstrap.reason || 'This copy cannot record a permission level.',
    }
  }
  if (bootstrap.unreadable) {
    /* A record that exists and cannot be parsed is NOT "not set up yet".
       Treating it as absent invites this screen to overwrite a configuration
       nobody could read -- exactly what readMachineRecord refuses to do. */
    return {
      available: false,
      configured: false,
      tier: null,
      code: bootstrap.code || 'SETUP_MACHINE_RECORD_UNREADABLE',
      reason: bootstrap.reason || 'This computer already has a configuration, and it could not be read.',
    }
  }
  const tier = TIER_IDS.includes(bootstrap.tier) ? bootstrap.tier : null
  return {
    available: true,
    configured: Boolean(bootstrap.configured) && tier !== null,
    tier,
    code: null,
    reason: null,
  }
}

/**
 * Should this launch open on the question instead of the fleet?
 *
 * Only when the app can actually record an answer AND no level has been
 * recorded yet. A build that cannot write one must never trap someone on a
 * screen whose only button fails, so unavailable means "carry on into the app",
 * not "block".
 */
export function firstRunPending(state) {
  return Boolean(state && state.available && !state.configured)
}

/**
 * Should the router send this navigation to the question?
 *
 * The decision lives here, as a pure function of state and route name, rather
 * than as a condition inside render(). That is not tidiness: src/main.js cannot
 * be executed without a DOM, so a guard written inline there can only be tested
 * by matching source text -- and a source match cannot tell `if (pending)` from
 * `if (false && pending)`. Both were tried; the second slipped through and the
 * gate silently stopped existing. As a function it is exercised for real.
 */
export function shouldOpenSetup(state, routeName) {
  return firstRunPending(state) && routeName !== 'setup'
}

/* The live copy, resolved once while the module graph evaluates -- the same
   moment the shell's synchronous bootstrap is available, and before the router
   paints. `noteTierRecorded` keeps it current after a save, because the
   bootstrap snapshot is from page load and would otherwise send the gate
   straight back to a question that has just been answered. */
export const SETUP_RESOLUTION = readSetupState()

export function noteTierRecorded(tier) {
  if (!TIER_IDS.includes(tier)) return SETUP_RESOLUTION
  SETUP_RESOLUTION.configured = true
  SETUP_RESOLUTION.tier = tier
  return SETUP_RESOLUTION
}
