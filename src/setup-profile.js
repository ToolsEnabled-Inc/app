/* THE SETUP PROFILE: few questions, many settings, nothing set where it cannot
 * be found again.
 *
 * The owner asked for a walkthrough that works like twenty questions -- "even a
 * basic user in relatively few steps we should have a very good sense of exactly
 * what they want ... and we end up on exactly the right user settings profile or
 * near it at least". Twenty questions works because each question eliminates a
 * large part of the space. The failure mode it rules out is a wall of forms that
 * enumerates every setting, so this module does the opposite: it defines a small
 * number of answers, and the DERIVATION from those answers to every individual
 * setting they imply.
 *
 * WHAT IS ACTUALLY A SETTING HERE, MEASURED RATHER THAN ASSUMED.
 * src/views/settings.js renders about ninety rows. Every one of them writes
 * `mc.set.<id>` to localStorage and NOTHING IN THIS APPLICATION READS THAT KEY --
 * grep the tree: outside settings.js itself there is not one reader. Those rows
 * are a presentation surface, not behaviour. A walkthrough that inferred ten of
 * them from a question about the user's purpose would look impressive, would test
 * green, and would change nothing whatsoever about the product. That is theatre,
 * so it is not built.
 *
 * The settings that DO something, and therefore the ones this profile decides:
 *
 *   1. The permission level (machine.json `tier`). Recorded by the screen that
 *      already ships; this module treats it as a CEILING and never as an output.
 *   2. The workspace roots (machine.json `workspaceRoots`) -- the folders an
 *      assistant may work in. A fresh record silently defaults these today.
 *   3. The six write-action flags (`mc.write.*`, src/write-flags.js). Each one
 *      gates a real control: the dispatch form, the ledger's decision buttons,
 *      the queue claim/close pair, the coordinator composer, the report reader,
 *      and starting a live agent session.
 *   4. The example toggle (`mc.example`, src/data-source.js). One switch that
 *      decides whether every screen reads this computer's own records or the
 *      labelled built-in example. It replaced seven per-view flags; the
 *      screens question maps to it directly.
 *
 * And four settings that other lanes are building the ENFORCEMENT for right now,
 * which this profile sets coherently so that their work lands on a value the user
 * actually chose rather than on a hardcoded constant: the approvals policy, what
 * attaching to an existing editor session means, whether editor sessions are
 * imported, and whether a second account is used automatically when the first is
 * exhausted. Those four are marked `enforced: false` in PROFILE_INTENT and the
 * surfaces that show them say so, in the same idiom src/setup-state.js uses for
 * the tier's own enforcement gap. Their DEFAULTS are the safe end of each axis,
 * so an intent nothing reads yet cannot do harm while it waits.
 *
 * THE TIER IS A CEILING AND IS NEVER RAISED BY AN ANSWER. `deriveProfile` clamps
 * every output to what the recorded level permits and RECORDS THE CLAMP, so the
 * review screen can say "your permission level does not allow this" instead of
 * silently dropping the answer. An unknown or missing answer collapses to the
 * safest option rather than to the most useful one.
 *
 * NO DOM, NO STYLESHEET, NO STORAGE ACCESS THAT IS NOT GUARDED. The whole
 * derivation is a pure function of (answers, tier) so it can be exercised in
 * `node --test` without a browser -- which is the point, because this decides
 * what a stranger's computer is configured to allow.
 */

export const PROFILE_SCHEMA_VERSION = 1
export const PROFILE_STORAGE_KEY = 'mc.setup.profile'

/* ---------- the questions ---------- */

/* Question 2 of 3. One question, ten settings.
 *
 * The three options are an axis of how much of the product's action surface is
 * switched on, NOT three amounts of visible menu. They are listed least-acting
 * first, so the order itself reads as an axis.
 *
 * THE RECOMMENDATION MOVED, AND THIS IS THE ACCOUNT OF WHY.
 *
 * `observe` was Recommended and preselected, on the same reasoning the tier
 * question uses for `guided`: the least confident reader must be able to proceed
 * by not deciding, and what they proceed into must be the safe end. The reasoning
 * is right. Applied to THIS question it produced a product that appeared broken.
 *
 * MEASURED, on the packaged window from a sterile profile: taking the two
 * Recommended answers -- `guided` at the tier question, `observe` here -- lands
 * on an installation with NO CONTROL ANYWHERE THAT STARTS AN AGENT.
 * `observe` requests no write flags at all, `agent-session` is one of them, and
 * src/agent-session.js is what mounts Start. To reach a running agent the person
 * had to REFUSE the recommendation. The product's own guidance led exactly the
 * readers least equipped to diagnose it into a dead end, and every measurement
 * this project has of "a new user reaches a running agent" was obtained by
 * ignoring the advice the product prints.
 *
 * A cautious default is good practice. A default that makes the product look
 * broken is not caution, and calling it Recommended is not honesty -- the label
 * is a claim that this is the answer we would give a person who asked us, and
 * "switch the product off" is not that answer.
 *
 * SO THE RECOMMENDATION IS `assisted`, and it is defensible on the safety axis
 * rather than in spite of it. The axis this question actually measures is WHAT
 * HAPPENS WITHOUT YOU. `assisted` acts only when a person presses a control:
 * it approves nothing, closes no queue item, replies to nobody, and stops to ask
 * whenever it reaches something it needs permission for. It is the least-privilege
 * answer that is still a product. `observe` is not the safe end of the axis --
 * it is off the axis, the product with its verbs removed.
 *
 * WHAT DID NOT MOVE, deliberately. SAFE_ANSWERS below still resolves to
 * `observe`, so SKIPPING the walkthrough still leaves the machine byte-identical
 * to one that never ran setup. Choosing is not the same act as declining to
 * choose, and only the first of them may switch anything on. The difference is
 * now visible in the code: RECOMMENDED_ANSWERS is what the walkthrough
 * preselects, SAFE_ANSWERS is what skip applies, and they are allowed to differ.
 *
 * AND THE DEAD END IS NAMED WHERE THE CHOICE IS MADE. `observe` is a legitimate
 * answer -- someone who wants to read before running anything is entitled to it
 * -- so it keeps its place and gains `consequence`: the sentence that says, at
 * the point of choice, that nothing will be startable until it is switched on,
 * and where to switch it. An option whose effect is invisible until the person
 * hunts for a control that was never rendered is the defect; the option itself
 * is not. See src/agent-session.js for the other half of that repair, which
 * gives the answer a destination instead of an absence. */
export const AUTONOMY_CHOICES = Object.freeze([
  Object.freeze({
    value: 'observe',
    label: 'Nothing yet — let me look around first',
    note: '',
    detail: 'Every screen still reads and reports, and nothing at all is switched on that acts: no assistant starts, nothing is approved, nothing is replied to. This is exactly what a computer that was never set up already does.',
    /* Present on exactly the answers that leave no way to start an agent, and
       pinned to that fact by the test suite rather than to this list. */
    consequence: 'Nothing on this computer will be able to start an assistant while this is the answer. The agent page shows no Start control, because there is nothing switched on for it to start. That page says so, and turns it on in one click when you want it. Settings has the same switch.',
  }),
  Object.freeze({
    value: 'assisted',
    label: 'Act when I start it',
    note: 'Recommended',
    detail: 'You start an assistant and it works; it stops and asks you whenever it needs permission for something. Nothing runs until you press start, and approving, closing queue items and replying stay off.',
    consequence: '',
  }),
  Object.freeze({
    value: 'autonomous',
    label: 'Act on its own and tell me after',
    note: '',
    detail: 'Everything this permission level allows is switched on, including approving items and replying. When it needs permission it uses its own judgement instead of waiting for you.',
    consequence: '',
  }),
])

/* Asked on the review screen rather than as its own step, because it is the one
 * choice a person can only make well while looking at the screens it changes. It
 * costs no question and it is still shown and walked through. */
export const SCREENS_CHOICES = Object.freeze([
  Object.freeze({
    value: 'live',
    label: 'My own activity',
    note: 'Recommended',
    detail: 'Every screen reads this computer’s own records. On a new installation most of them are empty until you run something, and they say so rather than filling the gap.',
  }),
  Object.freeze({
    value: 'demonstration',
    label: 'A labelled demonstration',
    note: '',
    /* One-world phrasing: the example is not a separate demonstration render
       any more, it is the product's built-in example shown through the same
       screens -- so the detail names what the screens SHOW, not a mode. */
    detail: 'Every screen shows the product’s built-in example so you can see what each one does. None of it is your data and each screen says so. Switch back at any time.',
  }),
])

/* THE ID OF THE FLAG THAT DECIDES WHETHER THIS PRODUCT CAN BE MADE TO DO
   ANYTHING. src/write-flags.js owns the flag; this names it once so the
   question "does this answer leave a way to start an agent?" has a single
   definition that the setup screens, the agent page and the test suite all
   ask the same way. */
export const START_CONTROL_FLAG = 'agent-session'

export const AUTONOMY_VALUES = Object.freeze(AUTONOMY_CHOICES.map(choice => choice.value))
export const SCREENS_VALUES = Object.freeze(SCREENS_CHOICES.map(choice => choice.value))

/* The safe end of every axis, used for a skipped walkthrough and for any answer
 * this build does not recognise. Deliberately identical to what a machine that
 * never ran setup already does, so "skip" cannot leave anyone half-configured:
 * write actions ship off, the example toggle ships off (every screen reads this
 * computer's own records), and the workspace keeps whatever the record already
 * names. */
export const SAFE_ANSWERS = Object.freeze({
  autonomy: 'observe',
  screens: 'live',
})

/* WHAT THE WALKTHROUGH PRESELECTS, which is a different question from the one
 * SAFE_ANSWERS answers, and conflating the two is what produced the dead end
 * described at AUTONOMY_CHOICES.
 *
 *   SAFE_ANSWERS       what a SKIP applies. Skipping is declining to choose, so
 *                      it may switch nothing on, and the machine it leaves is
 *                      byte-identical to one that never ran setup.
 *   RECOMMENDED_ANSWERS what the walkthrough OFFERS, and what pressing Continue
 *                      through it therefore chooses. Walking the questions is
 *                      choosing, and what it lands on must be a working product.
 *
 * These were one constant, so the answer for a person who declined to answer was
 * also the answer we recommended to a person who asked. It is asserted below and
 * in tools/test/setup-profile.test.mjs that this one leaves a start control at
 * every permission level -- that assertion is the regression test for the whole
 * defect, and it is a statement about the DERIVED settings, not about a label. */
export const RECOMMENDED_ANSWERS = Object.freeze({
  autonomy: 'assisted',
  screens: 'live',
})

/* ---------- what an answer implies ---------- */

/* src/write-flags.js owns the flag list; these are its ids. Repeating them as a
 * literal would go stale the first time a flag is added, so the derivation reads
 * the imported list and this map only says which ids an answer REQUESTS. An id
 * here that write-flags.js does not know is a programming error and is asserted
 * against in the test suite rather than silently ignored. */
/* `observe` REQUESTS NOTHING, and the empty array is the most important line in
 * this file.
 *
 * It was written as `['report-read']` first, on the reasoning that a reader is
 * harmless. That reasoning is wrong here for a reason that has nothing to do
 * with how harmful reading is: `observe` is also SAFE_ANSWERS, which is what a
 * SKIPPED walkthrough applies, and skipping is not asking. A skip that switched
 * on a write-action flag would be this profile enabling something the person
 * never chose -- the exact failure the whole design is supposed to make
 * impossible -- and it would break the property that makes skip provably safe:
 * that the state it produces is byte-for-byte the state of a machine that never
 * ran setup at all. The test suite asserts that equivalence directly. */
/* `cloud-launch` arrived from the Codex Cloud lane, which added it to
   src/write-flags.js. It is listed here for both acting answers because it is a
   launch a PERSON presses -- the flag's own description says each launch still
   asks for approval -- which is exactly what "Act when I start it" means. A flag
   that exists and no answer names is caught by the test suite, which walks the
   real flag list rather than this map. */
const AUTONOMY_WRITE_FLAGS = Object.freeze({
  observe: Object.freeze([]),
  assisted: Object.freeze(['report-read', 'agent-session', 'dispatch', 'cloud-launch']),
  autonomous: Object.freeze(['report-read', 'agent-session', 'dispatch', 'cloud-launch', 'decision', 'queue', 'thread-reply']),
})

/* The four settings other lanes are building enforcement for. Each axis is
 * ordered SAFEST FIRST, and the tier ceiling below is expressed as a maximum
 * index into that order -- so "clamp to what this level allows" is one comparison
 * and cannot accidentally be written the permissive way round. */
/* THE TWO SENTENCES THESE ROWS CAN TRUTHFULLY SAY ABOUT THEMSELVES.
 *
 * They live here, beside the rows, and not in the two screens that print
 * them. Both screens carried their own copy of one sentence about "the last
 * four rows", and the moment one row started being acted on BOTH sentences
 * became wrong -- in two files, either of which could have been missed. A
 * claim about a set of rows belongs with the rows. */
export const INTENT_IN_USE = 'This one is in use now.'
export const INTENT_RECORDED_ONLY = 'Recorded, not yet acted on.'
export const INTENT_BANNER_TITLE = 'What these rows do today.'
export const INTENT_BANNER_BODY = [
  'This program records all of them and keeps them.',
  'The row about running out of an account is acted on when you start an assistant.',
  'The parts that would act on the others are still being built.',
  'Each is set to its cautious end unless you moved it.',
].join(' ')

export const PROFILE_INTENT = Object.freeze([
  Object.freeze({
    id: 'approvals',
    name: 'When it needs permission',
    lane: 'two-path-connect',
    enforced: false,
    order: Object.freeze(['stop', 'other-work', 'judgement']),
    labels: Object.freeze({
      stop: 'Stop and ask me',
      'other-work': 'Work on something else while it waits',
      judgement: 'Use its own judgement',
    }),
    desc: 'What an assistant does when it reaches something it needs permission for.',
  }),
  Object.freeze({
    id: 'attach',
    name: 'Attaching to a session already open in your editor',
    lane: 'two-path-connect',
    enforced: false,
    order: Object.freeze(['mirror', 'fork', 'adopt']),
    labels: Object.freeze({
      mirror: 'Watch it only',
      fork: 'Continue it in a copy',
      adopt: 'Take it over',
    }),
    desc: 'Taking over means your editor stops being the one driving that session.',
  }),
  Object.freeze({
    id: 'ideImport',
    name: 'Sessions found in your editor',
    lane: 'ide-import-surface',
    enforced: false,
    order: Object.freeze(['none', 'ask', 'all-detected']),
    labels: Object.freeze({
      none: 'Do not bring any in',
      ask: 'Ask me each time',
      'all-detected': 'Bring in everything it finds',
    }),
    desc: 'Whether assistant sessions running in a code editor are listed here.',
  }),
  Object.freeze({
    id: 'failover',
    name: 'If an account runs out',
    lane: 'multi-account-build',
    /* ENFORCED SINCE 2026-08-18, AND WHAT THAT WORD HAS TO MEAN HERE.
 *
 * This row shipped as `enforced: false` and was honest about it: the screen
 * said "recorded, not yet acted on" and nothing anywhere read the answer.
 * The owner's standing rule is that a setting is a row, a real enforcement
 * site, and a control a person can reach -- anything less is a lie told in
 * a settings list. Two of the three were already here. This is the third.
 *
 * WHERE IT IS ACTED ON, precisely, so this claim can be checked rather than
 * believed: the main process reads this answer and passes it to the payload
 * rotation module as its `mode`, and that module is what decides whether a
 * spent account may hand the session to the next one. `manual` refuses the
 * switch and reports which account is spent and which is ready; `auto`
 * performs it. Both directions are asserted in the payload's own
 * tests/multi-account-rotation.test.js.
 *
 * ONE ANSWER, ONE READER. The value is not copied into a second store on
 * its way there. A settings screen that shows one thing while a different
 * copy of the answer drives the behaviour is worse than an unenforced row,
 * because it looks true. */
    enforced: true,
    enforcedBy: 'the account switching in the assistant program',
    order: Object.freeze(['manual', 'auto']),
    labels: Object.freeze({
      manual: 'Stop and let me switch',
      auto: 'Switch to another account automatically',
    }),
    /* CORRECTED WHEN THE SIGN-IN STEP LANDED. This said "signing in never
       happens on this screen and no account details are ever collected here",
       which became ambiguous the moment setup grew an account step: if "here"
       means this row it is arguably true, and if a reader takes it to mean the
       walkthrough it is false. On a disclosure the ambiguity IS the defect,
       because the reader resolves it and we do not get to say which way. The
       half that is still true is the half that matters, and it is the one
       SHIPMENT-PLAN B14 turns on. */
    /* NARROWED A THIRD TIME, and the narrowing is the point. This said
       "anywhere in this product", which is a promise about code no test of mine
       can see: another lane adding a provider key field on some other screen
       would falsify it silently, and I would never know. A claim is only worth
       making if something can keep it true, so it is scoped to setup, which is
       what the copy rules actually walk. The sentence lost nothing a reader
       needed and gained a keeper. */
    desc: 'The account setup asks for is an account on this computer, not a provider sign-in. No Claude, ChatGPT or Google subscription, key, or password is asked for anywhere in setup; you sign in to those inside their own programs.',
  }),
])

const INTENT_BY_ID = new Map(PROFILE_INTENT.map(field => [field.id, field]))

const AUTONOMY_INTENT = Object.freeze({
  observe: Object.freeze({ approvals: 'stop', attach: 'mirror', ideImport: 'none', failover: 'manual' }),
  assisted: Object.freeze({ approvals: 'other-work', attach: 'fork', ideImport: 'ask', failover: 'manual' }),
  autonomous: Object.freeze({ approvals: 'judgement', attach: 'adopt', ideImport: 'all-detected', failover: 'auto' }),
})

/* ---------- the ceiling ---------- */

/* docs/design/INSTALLER-EXPERIENCE.md 2.5: "A tier is a different amount of
 * machine access, not a different amount of visible interface ... A tier that
 * refuses nothing is a skin." These are the refusals in profile terms.
 *
 * `guided` grants one assistant in one folder and section 2.2 refuses multiple
 * agents outright, so the dispatch form -- which starts lanes -- is above its
 * ceiling however the autonomy question is answered. It keeps the report reader
 * (which only reads) and starting the one session (which is the product). The
 * three fleet-operation controls are above it as well: approving owner requests,
 * claiming and closing queue items, and replying into a coordinator thread are
 * not what an assistant confined to one folder does. Launching a Codex Cloud
 * task is above it for the same reason the dispatch form is -- it starts work
 * that is not the one confined assistant this level grants.
 *
 * WHAT EVERY LEVEL KEEPS IS `agent-session`, and that is load-bearing rather
 * than incidental: it is the flag that decides whether a control exists anywhere
 * that starts an agent, so a level that refused it would be a level at which the
 * product cannot be made to do anything. `profileCanStartAnAgent` is asserted
 * true for the recommended answers at all three levels.
 *
 * `standard` and `unrestricted` permit every flag; they still differ, in the
 * machine access the level itself grants and in the intent maxima below. */
export const TIER_CEILINGS = Object.freeze({
  guided: Object.freeze({
    writeFlags: Object.freeze(['report-read', 'agent-session']),
    intent: Object.freeze({ approvals: 'stop', attach: 'mirror', ideImport: 'none', failover: 'manual' }),
  }),
  standard: Object.freeze({
    writeFlags: Object.freeze(['report-read', 'agent-session', 'dispatch', 'cloud-launch', 'decision', 'queue', 'thread-reply']),
    intent: Object.freeze({ approvals: 'judgement', attach: 'adopt', ideImport: 'ask', failover: 'auto' }),
  }),
  unrestricted: Object.freeze({
    writeFlags: Object.freeze(['report-read', 'agent-session', 'dispatch', 'cloud-launch', 'decision', 'queue', 'thread-reply']),
    intent: Object.freeze({ approvals: 'judgement', attach: 'adopt', ideImport: 'all-detected', failover: 'auto' }),
  }),
})

/* An unrecognised level is the SMALLEST ceiling, never the largest. A record
 * written by a newer build, a typo, or a truncated read must not be the reason a
 * profile switches everything on. */
export function ceilingForTier(tier) {
  return TIER_CEILINGS[tier] || TIER_CEILINGS.guided
}

function clampIntentValue(fieldId, requested, tier) {
  const field = INTENT_BY_ID.get(fieldId)
  if (!field) return { value: null, clamped: false }
  const ceiling = ceilingForTier(tier).intent[fieldId]
  const ceilingIndex = field.order.indexOf(ceiling)
  const requestedIndex = field.order.indexOf(requested)
  /* An unknown requested value is index -1 and resolves to the safest option,
     which is index 0. An unknown ceiling would resolve to -1 as well, so it is
     floored at 0 rather than allowed to make every value "above the ceiling". */
  const maxIndex = ceilingIndex < 0 ? 0 : ceilingIndex
  const wantIndex = requestedIndex < 0 ? 0 : requestedIndex
  const finalIndex = Math.min(wantIndex, maxIndex)
  return {
    value: field.order[finalIndex],
    clamped: wantIndex > maxIndex,
    requested: field.order[wantIndex],
  }
}

/* ---------- derivation ---------- */

/* The four intent fields live IN the answers, not beside them.
 *
 * They start as whatever the autonomy answer implies -- that is the whole point
 * of asking one question instead of five -- but the review screen lets each be
 * changed on its own, and a change that survives only until the next repaint is
 * not a change. Holding them in the answers means "the set this answer implies"
 * and "the one you moved afterwards" are the same field, so nothing has to
 * reconcile two sources later.
 *
 * Picking a different autonomy answer RESETS all four, which is the behaviour a
 * person expects from choosing a different overall posture, and is why
 * `answersForAutonomy` exists rather than the view mutating one field. */
function normalizeAnswers(answers) {
  const source = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {}
  const autonomy = AUTONOMY_VALUES.includes(source.autonomy) ? source.autonomy : SAFE_ANSWERS.autonomy
  const implied = AUTONOMY_INTENT[autonomy]
  const normalized = {
    autonomy,
    screens: SCREENS_VALUES.includes(source.screens) ? source.screens : SAFE_ANSWERS.screens,
    workspaceRoots: Array.isArray(source.workspaceRoots)
      ? source.workspaceRoots.filter(entry => typeof entry === 'string' && entry.trim() !== '')
      : [],
  }
  for (const field of PROFILE_INTENT) {
    const given = source[field.id]
    normalized[field.id] = field.order.includes(given) ? given : implied[field.id]
  }
  return normalized
}

/** The coherent answer set one autonomy choice implies, intent fields included. */
export function answersForAutonomy(autonomy, answers = {}) {
  const value = AUTONOMY_VALUES.includes(autonomy) ? autonomy : SAFE_ANSWERS.autonomy
  const reset = { ...normalizeAnswers(answers), autonomy }
  for (const field of PROFILE_INTENT) reset[field.id] = AUTONOMY_INTENT[value][field.id]
  return reset
}

/**
 * Every setting the answers imply, with the tier applied as a ceiling.
 *
 * @param answers  what the person chose. Anything unrecognised becomes the safe
 *                 option; this never throws, because a profile that crashes on a
 *                 stored value from an older build is a product that cannot be
 *                 recovered from its own settings screen.
 * @param options.tier          the recorded permission level (the ceiling).
 * @param options.writeFlagIds  the ids src/write-flags.js knows, injected so the
 *                              derivation cannot drift from the real flag list.
 */
export function deriveProfile(answers, { tier, writeFlagIds = [] } = {}) {
  const chosen = normalizeAnswers(answers)
  const ceiling = ceilingForTier(tier)
  const requestedWrite = new Set(AUTONOMY_WRITE_FLAGS[chosen.autonomy] || AUTONOMY_WRITE_FLAGS.observe)
  const permitted = new Set(ceiling.writeFlags)

  const writeFlags = {}
  const refused = []
  for (const id of writeFlagIds) {
    const wanted = requestedWrite.has(id)
    const allowed = permitted.has(id)
    writeFlags[id] = wanted && allowed
    if (wanted && !allowed) refused.push(id)
  }

  /* ONE BOOLEAN WHERE A MAP OF SEVEN WAS. The demonstration answer used to
     switch every per-view flag off together; those flags are gone and the one
     example toggle (src/data-source.js) is what the answer reaches now. The
     polarity is the toggle's own: true means "show the example". */
  const exampleMode = chosen.screens === 'demonstration'

  const intent = {}
  const intentClamped = []
  for (const field of PROFILE_INTENT) {
    const result = clampIntentValue(field.id, chosen[field.id], tier)
    intent[field.id] = result.value
    if (result.clamped) intentClamped.push({ id: field.id, requested: result.requested, allowed: result.value })
  }

  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    tier: typeof tier === 'string' ? tier : null,
    answers: chosen,
    writeFlags,
    exampleMode,
    intent,
    /* What the level refused. Carried out of the derivation rather than dropped,
       so the review screen states the refusal instead of showing an answer the
       person gave next to settings that quietly disagree with it. */
    refusedWriteFlags: refused,
    clampedIntent: intentClamped,
  }
}

/**
 * Does this ANSWER ask for a way to start an agent?
 *
 * A question about the answer alone, before any ceiling: it is what the
 * `consequence` sentences on AUTONOMY_CHOICES are pinned to, so a fourth
 * autonomy option added later cannot ship without either requesting the start
 * flag or saying out loud that it does not.
 */
export function autonomyStartsAgents(value) {
  const requested = AUTONOMY_WRITE_FLAGS[value] || AUTONOMY_WRITE_FLAGS.observe
  return requested.includes(START_CONTROL_FLAG)
}

/**
 * Does this DERIVED profile leave a control that starts an agent?
 *
 * The same question asked of the outcome, ceiling included, which is the form
 * that can actually be wrong: an answer may request the flag and a permission
 * level may refuse it. Every tier permits it today -- `guided` grants one
 * assistant in one folder and that assistant has to be startable -- and the
 * test suite asserts that for the recommended answers at every level rather
 * than trusting the table to stay that way.
 */
export function profileCanStartAnAgent(derived) {
  return derived?.writeFlags?.[START_CONTROL_FLAG] === true
}

/**
 * Write the derived settings through the application's own setters.
 *
 * The setters are INJECTED rather than imported, for two reasons that are the
 * same reason: `node --test` has no localStorage, and a test that stubs storage
 * proves the storage stub works. Passing setWriteEnabled and setExampleMode in
 * means the real path and the tested path are one call graph.
 *
 * The example toggle is applied in BOTH directions, exactly as every write
 * flag is: choosing "my own activity" turns the example off, so a profile
 * finished on a machine where somebody had switched the example on lands on
 * the state the review screen showed, not on a leftover.
 *
 * Nothing here writes `mc.set.*`. See the header: nothing reads it.
 */
export function applyProfile(derived, { setWriteFlag, setExampleMode } = {}) {
  const applied = { writeFlags: {} }
  for (const [id, enabled] of Object.entries(derived?.writeFlags || {})) {
    applied.writeFlags[id] = Boolean(setWriteFlag?.(id, enabled))
  }
  if (derived && typeof derived === 'object') {
    applied.exampleMode = Boolean(setExampleMode?.(derived.exampleMode === true))
  }
  return applied
}

/* ---------- the stored record ---------- */

/* `status` is three-valued on purpose. `in-progress` exists because a person who
 * closes the window halfway through has NOT chosen the safe defaults -- they have
 * chosen nothing -- and the difference decides whether reopening setup resumes or
 * starts again. Nothing is applied while a profile is `in-progress`; the answers
 * are held and the machine is untouched. */
export const PROFILE_STATUSES = Object.freeze(['in-progress', 'skipped', 'complete'])

export function readStoredProfile(scope = globalThis) {
  let raw = null
  try { raw = scope?.localStorage?.getItem(PROFILE_STORAGE_KEY) ?? null } catch { return null }
  if (raw === null) return null
  let parsed
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  if (parsed.schemaVersion !== PROFILE_SCHEMA_VERSION) return null
  if (!PROFILE_STATUSES.includes(parsed.status)) return null
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    status: parsed.status,
    step: typeof parsed.step === 'string' ? parsed.step : null,
    answers: normalizeAnswers(parsed.answers),
    updatedAtMs: Number.isFinite(parsed.updatedAtMs) ? parsed.updatedAtMs : null,
  }
}

export function writeStoredProfile(record, scope = globalThis) {
  const payload = {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    status: PROFILE_STATUSES.includes(record?.status) ? record.status : 'in-progress',
    step: typeof record?.step === 'string' ? record.step : null,
    answers: normalizeAnswers(record?.answers),
    updatedAtMs: Number.isFinite(record?.updatedAtMs) ? record.updatedAtMs : Date.now(),
  }
  try { scope?.localStorage?.setItem(PROFILE_STORAGE_KEY, JSON.stringify(payload)) } catch { return null }
  return payload
}

/**
 * Which screen should the walkthrough open on?
 *
 * A recorded profile sends a returning visitor to the review rather than back
 * through the questions, because "change one thing" is the reason anyone reopens
 * this. An interrupted one resumes where it stopped. Nothing has been applied in
 * either case that this function needs to undo.
 */
export function resumeStep(stored, { tierRecorded, steps }) {
  const order = Array.isArray(steps) ? steps : []
  if (!tierRecorded) return order[0] ?? 'tier'
  if (!stored) return order[1] ?? 'review'
  if (stored.status === 'in-progress' && order.includes(stored.step)) return stored.step
  return order[order.length - 1] ?? 'review'
}

/* THE FLOW IS DERIVED FROM THE STEP LIST, NOT WRITTEN OUT TWICE.
 *
 * Every Continue and Back used to name its destination as a literal, which is
 * fine until someone inserts a step -- and then the list says the step exists
 * while no button goes there. That happened: an entire sign-in screen was added
 * to STEPS, built, and tested, and nothing routed to it. It was dead on arrival
 * and every test over it was green, because a test that a screen RENDERS cannot
 * see that a person can never reach it.
 *
 * So the destination is computed from the list. Adding a step to STEPS now wires
 * it into the flow by construction, and `stepsAreReachable` below asserts the
 * chain actually covers the list rather than trusting that it does.
 */
export function stepAfter(steps, current) {
  const order = Array.isArray(steps) ? steps : []
  const index = order.indexOf(current)
  if (index === -1) return order[order.length - 1] ?? null
  return order[index + 1] ?? null
}

export function stepBefore(steps, current) {
  const order = Array.isArray(steps) ? steps : []
  const index = order.indexOf(current)
  if (index <= 0) return null
  return order[index - 1]
}

/** Walking forward from the first step, is every step actually arrived at? */
export function stepsAreReachable(steps) {
  const order = Array.isArray(steps) ? steps : []
  if (order.length === 0) return false
  const seen = new Set([order[0]])
  let current = order[0]
  for (let guard = 0; guard < order.length + 1; guard += 1) {
    const next = stepAfter(order, current)
    if (next === null) break
    if (seen.has(next)) return false
    seen.add(next)
    current = next
  }
  return seen.size === order.length
}

export function intentField(id) {
  return INTENT_BY_ID.get(id) || null
}

/* WHY THERE IS NO START CONTROL, IN THE PERSON'S OWN WORDS.
 *
 * Two genuinely different ways to arrive at a machine that cannot start an
 * agent, and telling them apart is the whole value of the sentence: the
 * walkthrough's autonomy answer, or the Settings switch on a machine that never
 * recorded a profile. Telling somebody setup did it when they turned it off
 * themselves an hour ago is the product misdescribing its own state.
 *
 * IT LIVES HERE, not on the two screens that say it, because both of them say
 * it: the agent page's switched-off surface and the fleet page's start panel.
 * Two copies of one explanation is how one of them comes to be wrong. */
/* THE WORDS ON THE SWITCH THAT TURNS IT BACK ON.
 *
 * Here for the same reason startControlOffBecause() is, and the reason is now
 * literally true of two surfaces rather than one: the agent page's switched-off
 * surface has carried this button since R1529, and the fleet page's start panel
 * carries it as of 2026-08-18. Both had to name the same control, and a label
 * typed twice is a label that reads differently on the two screens the first
 * time only one is edited.
 *
 * It says what the press DOES, not what the setting is called. "Turn on running
 * agents" is a verb a person can act on; "agent-session" is the row it writes,
 * and a row identifier in front of a person is the defect
 * tools/check-plain-language.mjs exists to catch. */
export const START_CONTROL_ON = Object.freeze({
  label: 'Turn on running agents',
})

export function startControlOffBecause(scope = globalThis) {
  let stored = null
  try { stored = readStoredProfile(scope) } catch { stored = null }
  const chosen = stored ? autonomyChoice(stored.answers?.autonomy) : null
  return chosen && chosen.consequence
    ? `Setup recorded “${chosen.label}”, and that answer switches off starting an assistant.`
    : 'Starting an assistant is switched off for this computer.'
}

export function autonomyChoice(value) {
  return AUTONOMY_CHOICES.find(choice => choice.value === value) || AUTONOMY_CHOICES[0]
}

export function screensChoice(value) {
  return SCREENS_CHOICES.find(choice => choice.value === value) || SCREENS_CHOICES[0]
}
