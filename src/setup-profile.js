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
 *   4. The six live-view flags (`mc.live.*`, src/live-flags.js). Each decides
 *      whether a screen reads this computer's own records or the labelled sample
 *      demonstration.
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
 * switched on, NOT three amounts of visible menu. `observe` is preselected and
 * carries the Recommended note for exactly the reason the tier question
 * preselects `guided`: the least confident reader must be able to proceed by not
 * deciding, and what they proceed into must be the safe end.
 *
 * `observe` is a complete, working product: every screen reads, the report reader
 * is on, nothing acts. It is not a crippled state, and the review screen offers
 * the switch that turns the rest on rather than sending anyone to hunt for it. */
export const AUTONOMY_CHOICES = Object.freeze([
  Object.freeze({
    value: 'observe',
    label: 'Nothing yet — let me look around first',
    note: 'Recommended',
    detail: 'Every screen still reads and reports, and nothing at all is switched on that acts: no assistant starts, nothing is approved, nothing is replied to. This is exactly what a computer that was never set up already does. You turn things on when you want them, at the end of this or later in Settings.',
  }),
  Object.freeze({
    value: 'assisted',
    label: 'Act when I start it',
    note: '',
    detail: 'You start an assistant and it works; it stops and asks you whenever it needs permission for something. Approving, closing queue items, and replying stay off.',
  }),
  Object.freeze({
    value: 'autonomous',
    label: 'Act on its own and tell me after',
    note: '',
    detail: 'Everything this permission level allows is switched on, including approving items and replying. When it needs permission it uses its own judgement instead of waiting for you.',
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
    detail: 'Every screen shows the labelled sample fleet so you can see what each one does. None of it is your data and each screen says so. Switch back at any time.',
  }),
])

export const AUTONOMY_VALUES = Object.freeze(AUTONOMY_CHOICES.map(choice => choice.value))
export const SCREENS_VALUES = Object.freeze(SCREENS_CHOICES.map(choice => choice.value))

/* The safe end of every axis, used for a skipped walkthrough and for any answer
 * this build does not recognise. Deliberately identical to what a machine that
 * never ran setup already does, so "skip" cannot leave anyone half-configured:
 * write actions ship off, live views ship live, and the workspace keeps whatever
 * the record already names. */
export const SAFE_ANSWERS = Object.freeze({
  autonomy: 'observe',
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
const AUTONOMY_WRITE_FLAGS = Object.freeze({
  observe: Object.freeze([]),
  assisted: Object.freeze(['report-read', 'agent-session', 'dispatch']),
  autonomous: Object.freeze(['report-read', 'agent-session', 'dispatch', 'decision', 'queue', 'thread-reply']),
})

/* The four settings other lanes are building enforcement for. Each axis is
 * ordered SAFEST FIRST, and the tier ceiling below is expressed as a maximum
 * index into that order -- so "clamp to what this level allows" is one comparison
 * and cannot accidentally be written the permissive way round. */
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
    enforced: false,
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
 * not what an assistant confined to one folder does.
 *
 * `standard` and `unrestricted` permit every flag; they still differ, in the
 * machine access the level itself grants and in the intent maxima below. */
export const TIER_CEILINGS = Object.freeze({
  guided: Object.freeze({
    writeFlags: Object.freeze(['report-read', 'agent-session']),
    intent: Object.freeze({ approvals: 'stop', attach: 'mirror', ideImport: 'none', failover: 'manual' }),
  }),
  standard: Object.freeze({
    writeFlags: Object.freeze(['report-read', 'agent-session', 'dispatch', 'decision', 'queue', 'thread-reply']),
    intent: Object.freeze({ approvals: 'judgement', attach: 'adopt', ideImport: 'ask', failover: 'auto' }),
  }),
  unrestricted: Object.freeze({
    writeFlags: Object.freeze(['report-read', 'agent-session', 'dispatch', 'decision', 'queue', 'thread-reply']),
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
 * @param options.liveFlagIds   the ids src/live-flags.js knows, same reason.
 */
export function deriveProfile(answers, { tier, writeFlagIds = [], liveFlagIds = [] } = {}) {
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

  const live = chosen.screens === 'live'
  const liveFlags = {}
  for (const id of liveFlagIds) liveFlags[id] = live

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
    liveFlags,
    intent,
    /* What the level refused. Carried out of the derivation rather than dropped,
       so the review screen states the refusal instead of showing an answer the
       person gave next to settings that quietly disagree with it. */
    refusedWriteFlags: refused,
    clampedIntent: intentClamped,
  }
}

/**
 * Write the derived settings through the application's own setters.
 *
 * The setters are INJECTED rather than imported, for two reasons that are the
 * same reason: `node --test` has no localStorage, and a test that stubs storage
 * proves the storage stub works. Passing setWriteEnabled and setLiveView in means
 * the real path and the tested path are one call graph.
 *
 * Nothing here writes `mc.set.*`. See the header: nothing reads it.
 */
export function applyProfile(derived, { setWriteFlag, setLiveFlag } = {}) {
  const applied = { writeFlags: {}, liveFlags: {} }
  for (const [id, enabled] of Object.entries(derived?.writeFlags || {})) {
    applied.writeFlags[id] = Boolean(setWriteFlag?.(id, enabled))
  }
  for (const [id, live] of Object.entries(derived?.liveFlags || {})) {
    applied.liveFlags[id] = Boolean(setLiveFlag?.(id, live))
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

export function autonomyChoice(value) {
  return AUTONOMY_CHOICES.find(choice => choice.value === value) || AUTONOMY_CHOICES[0]
}

export function screensChoice(value) {
  return SCREENS_CHOICES.find(choice => choice.value === value) || SCREENS_CHOICES[0]
}
