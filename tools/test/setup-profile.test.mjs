// THE SETUP WALKTHROUGH: does it stay few, safe, visible, and reversible?
//
// The owner asked for a first run that behaves like twenty questions -- a small
// number of maximally informative questions landing on the right profile -- and
// named four properties the result has to have. Each section below is one of
// them, because each is a way this feature can be built, demoed, and still be
// wrong:
//
//   1. FEW. Three questions, and the derivation from three answers to nineteen
//      settings actually happens. A walkthrough that asks three questions and
//      sets three settings has not done the thing.
//   2. SAFE. The permission level is a CEILING an answer can never raise, an
//      unrecognised anything collapses to the cautious end, and the skip path
//      lands on exactly the state of a machine that never ran setup. That last
//      one is asserted as an equivalence rather than described, because "safe
//      default" is the kind of claim that is always made and rarely checked.
//   3. VISIBLE. Every setting the questions produce is reachable afterwards.
//   4. REVERSIBLE. Nothing is written until Finish, so a window closed halfway
//      through leaves the machine as it was.
//
// The shell half is exercised for REAL rather than matched in source: every
// function in shell/setup-record.cjs takes its payload modules by injection, so
// the tests below drive the actual code with a fake machine record and observe
// what it does -- including what it does NOT do on a refusal.

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'

import {
  AUTONOMY_CHOICES,
  PROFILE_INTENT,
  PROFILE_SCHEMA_VERSION,
  PROFILE_STORAGE_KEY,
  RECOMMENDED_ANSWERS,
  SAFE_ANSWERS,
  SCREENS_CHOICES,
  START_CONTROL_FLAG,
  TIER_CEILINGS,
  answersForAutonomy,
  applyProfile,
  autonomyStartsAgents,
  ceilingForTier,
  deriveProfile,
  intentField,
  profileCanStartAnAgent,
  readStoredProfile,
  resumeStep,
  stepAfter,
  stepBefore,
  stepsAreReachable,
  writeStoredProfile,
} from '../../src/setup-profile.js'
import { WRITE_ACTION_FLAGS } from '../../src/write-flags.js'
import { createSetupProfileSettings } from '../../src/setup-profile-settings.js'
import { LIVE_VIEW_FLAGS } from '../../src/live-flags.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = relative => readFileSync(path.join(REPO_ROOT, relative), 'utf8')
const require_ = createRequire(import.meta.url)

const VIEW = read('src/views/setup.js')
const SETTINGS_VIEW = read('src/views/settings.js')
const SHELL = read('shell/main.cjs')
const PRELOAD = read('shell/fleet-profile-preload.cjs')

const WRITE_IDS = WRITE_ACTION_FLAGS.map(flag => flag.id)
const LIVE_IDS = LIVE_VIEW_FLAGS.map(flag => flag.id)

const derive = (answers, tier) => deriveProfile(answers, { tier, writeFlagIds: WRITE_IDS, liveFlagIds: LIVE_IDS })

/* ---------- 1. FEW: three questions, nineteen settings ---------- */

test('the walkthrough is three questions and a review, not a form', () => {
  const steps = /const STEPS = Object\.freeze\(\[([^\]]*)\]\)/.exec(VIEW)
  const questions = /const QUESTION_STEPS = Object\.freeze\(\[([^\]]*)\]\)/.exec(VIEW)
  assert.ok(steps, 'src/views/setup.js no longer declares a STEPS list')
  assert.ok(questions, 'src/views/setup.js no longer declares which steps are questions')

  const parse = match => match[1].split(',').map(part => part.trim().replace(/^'|'$/g, '')).filter(Boolean)
  const stepList = parse(steps)
  const questionList = parse(questions)

  /* THE PROMISE, not the list. Section 1 of docs/design/INSTALLER-EXPERIENCE.md
     promises a beginner "a total of three questions", and THAT is what must not
     drift. Pinning the whole of STEPS was too tight for a file several lanes
     touch: the account lane added a sign-in step, correctly kept it OUT of
     QUESTION_STEPS because it derives none of the nineteen settings, and turned
     this red for doing exactly the right thing. A step may be added; a QUESTION
     may not be, because each question is a promise about how few there are. */
  assert.deepEqual(questionList, ['tier', 'workspace', 'autonomy'])
  assert.equal(stepList.at(-1), 'review', 'the walkthrough no longer ends on the page that shows what was chosen')
  for (const question of questionList) {
    assert.ok(stepList.includes(question), `${question} is counted as a question but is not a step`)
  }
  assert.ok(!questionList.includes('review'), 'the review is not a question and must not be counted as one')

  /* EVERY STEP IS ARRIVED AT. This is the assertion that would have caught the
     worst defect of the session: an entire sign-in screen was added to STEPS,
     built, and covered by green tests, while the workspace step's Continue still
     named 'autonomy' -- so nothing routed to it and no user could ever reach it.
     A test that a screen RENDERS cannot see that. */
  assert.ok(stepsAreReachable(stepList), `walking forward from ${stepList[0]} does not arrive at every step: ${stepList.join(' -> ')}`)
})

test('a step is reachable by construction, not by remembering to wire it', () => {
  /* The destinations are computed from STEPS. A literal here is how the flow and
     the list drift apart, so literals are banned rather than merely discouraged:
     the previous version of this file named every destination by hand, which is
     exactly how a step got added with nothing pointing at it. */
  const literals = [...VIEW.matchAll(/next: '([a-z-]+)'/g)].map(match => match[1]).filter(value => value !== 'finish')
  assert.deepEqual(literals, [], `these Continue targets are hardcoded instead of derived from STEPS: ${literals.join(', ')}`)
  assert.match(VIEW, /stepAfter\(STEPS,/, 'the walkthrough no longer derives its Continue target from the step list')
  assert.match(VIEW, /stepBefore\(STEPS,/, 'the walkthrough no longer derives its Back target from the step list')
})

test('the step helpers walk the list and refuse a broken one', () => {
  const steps = ['a', 'b', 'c']
  assert.equal(stepAfter(steps, 'a'), 'b')
  assert.equal(stepAfter(steps, 'c'), null, 'the last step must not claim a next one')
  assert.equal(stepBefore(steps, 'a'), null, 'the first step must not claim a previous one')
  assert.equal(stepBefore(steps, 'c'), 'b')
  assert.equal(stepsAreReachable(steps), true)
  /* An unknown current step resolves to the END rather than to the beginning: a
     stale stored step must never drop someone back at the start of a walkthrough
     they already finished. */
  assert.equal(stepAfter(steps, 'nonsense'), 'c')
  assert.equal(stepsAreReachable([]), false)
})

test('one answer moves ten settings, which is what earns it a step', () => {
  const observing = derive({ autonomy: 'observe' }, 'unrestricted')
  const acting = derive({ autonomy: 'autonomous' }, 'unrestricted')

  const movedFlags = WRITE_IDS.filter(id => observing.writeFlags[id] !== acting.writeFlags[id])
  const movedIntent = PROFILE_INTENT.filter(field => observing.intent[field.id] !== acting.intent[field.id])
  assert.equal(movedFlags.length, WRITE_IDS.length, 'the autonomy answer does not reach every write-action flag')
  assert.equal(movedIntent.length, PROFILE_INTENT.length, 'the autonomy answer does not reach every cross-lane setting')
  assert.ok(movedFlags.length + movedIntent.length >= 10, 'one question moving fewer than ten settings has not earned a step')
})

test('the other answer reaches every screen', () => {
  const live = derive({ screens: 'live' }, 'unrestricted')
  const demonstration = derive({ screens: 'demonstration' }, 'unrestricted')
  assert.deepEqual(Object.values(live.liveFlags), LIVE_IDS.map(() => true))
  assert.deepEqual(Object.values(demonstration.liveFlags), LIVE_IDS.map(() => false))
  /* The canary: 7 = home, computers, agent, metrics, comms, ledger, research.
     A new screen must raise this ON PURPOSE, here, so a register edit cannot
     silently widen what one setup answer switches. */
  assert.equal(LIVE_IDS.length, 7)
})

/* A typo in the derivation's flag list would leave one flag off at the most
   permissive combination and nothing else would notice. */
test('every flag the most permissive answer names is a flag that exists', () => {
  const profile = derive({ autonomy: 'autonomous' }, 'unrestricted')
  for (const id of WRITE_IDS) {
    assert.equal(profile.writeFlags[id], true, `${id} is never switched on by any answer, so the derivation names it wrongly or not at all`)
  }
})

/* ---------- 2. SAFE ---------- */

/* THE PROPERTY THAT MAKES SKIP DEFENSIBLE, asserted as an equivalence.
   src/write-flags.js returns true only for the literal 'enabled', and
   src/live-flags.js defaults every view live. So the state a skipped
   walkthrough applies has to be: every write flag false, every live flag true.
   Anything else means skipping changed the machine. */
test('skipping applies exactly the state of a machine that never ran setup', () => {
  for (const tier of ['guided', 'standard', 'unrestricted']) {
    const skipped = derive(SAFE_ANSWERS, tier)
    for (const id of WRITE_IDS) {
      assert.equal(skipped.writeFlags[id], false, `skipping switched on ${id} at ${tier}`)
    }
    for (const id of LIVE_IDS) {
      assert.equal(skipped.liveFlags[id], true, `skipping changed the ${id} screen's source at ${tier}`)
    }
  }
})

/* THIS TEST USED TO ASSERT THE DEFECT, and the replacement is deliberate rather
 * than an adjustment, so the next reader knows which way round it went.
 *
 * It said: "the preselected answer is the safe one, and it is the one marked
 * Recommended", and it pinned AUTONOMY_CHOICES[0] -- `observe` -- as both. It
 * was green for the whole life of the defect it was protecting. Taking the two
 * Recommended answers produced an installation with NO CONTROL ANYWHERE that
 * starts an agent, because `observe` requests no write-action flag and
 * `agent-session` is one. The product's own guidance led a trusting reader into
 * a dead end, and every "eight clicks to a running agent" measurement this
 * project has was obtained by refusing the recommendation.
 *
 * The rule the old test was reaching for is kept and split into the two
 * questions it had merged:
 *   - SKIP still leaves the machine untouched. That is the test above, and it
 *     is unchanged, because declining to choose may still switch nothing on.
 *   - WHAT WE RECOMMEND must leave a working product. That is this test, and
 *     it is stated as a property of the DERIVED settings at every permission
 *     level -- not as a property of a label, which is what let a recommendation
 *     and an unusable outcome coexist. */
test('the recommended answer leaves a control that starts an agent, at every level', () => {
  assert.ok(WRITE_IDS.includes(START_CONTROL_FLAG), 'the flag that decides whether an agent can be started has been renamed or removed')
  for (const tier of ['guided', 'standard', 'unrestricted']) {
    const recommended = derive(RECOMMENDED_ANSWERS, tier)
    assert.equal(
      profileCanStartAnAgent(recommended),
      true,
      `taking the recommended answers at ${tier} leaves no way to start an agent, which is the defect this test exists for`,
    )
  }
  /* And the recommendation is the thing the screen preselects. Two constants
     that are allowed to differ have to be checked against each other, or the
     label and the default drift apart and the label is the one that lies. */
  const recommended = AUTONOMY_CHOICES.filter(choice => choice.note === 'Recommended')
  assert.equal(recommended.length, 1, 'exactly one autonomy answer may carry the Recommended note')
  assert.equal(recommended[0].value, RECOMMENDED_ANSWERS.autonomy)
  assert.equal(SCREENS_CHOICES[0].value, RECOMMENDED_ANSWERS.screens)
  /* Recommending an acting answer is only defensible while it acts ONLY when a
     person presses something. The moment it approves, closes or replies on its
     own, the recommendation has to be re-argued rather than inherited. */
  const flags = derive(RECOMMENDED_ANSWERS, 'unrestricted').writeFlags
  for (const id of ['decision', 'queue', 'thread-reply']) {
    assert.equal(flags[id], false, `the recommended answer switches on ${id}, which acts without the person pressing anything`)
  }
})

/* The ORDER is still safest-first, which is what makes the three options read
   as an axis; it is simply no longer the same thing as the recommendation. */
test('the answers are listed least-acting first', () => {
  assert.equal(AUTONOMY_CHOICES[0].value, SAFE_ANSWERS.autonomy)
  assert.deepEqual(derive({ autonomy: AUTONOMY_CHOICES[0].value }, 'unrestricted').writeFlags,
    Object.fromEntries(WRITE_IDS.map(id => [id, false])))
  let previous = -1
  for (const choice of AUTONOMY_CHOICES) {
    const count = WRITE_IDS.filter(id => derive({ autonomy: choice.value }, 'unrestricted').writeFlags[id]).length
    assert.ok(count > previous, `${choice.value} switches on no more than the answer before it, so the list is not an axis`)
    previous = count
  }
})

/* THE DEAD END IS ALLOWED TO EXIST; BEING SILENT ABOUT IT IS NOT.
   `observe` is a legitimate answer -- someone who wants to read before running
   anything is entitled to it -- so the repair is not to remove it but to make
   its consequence visible where the choice is made. Pinned to the derivation,
   so a fourth answer cannot be added that quietly leaves no start control. */
test('an answer that leaves no way to start an agent says so at the point of choice', () => {
  for (const choice of AUTONOMY_CHOICES) {
    const starts = autonomyStartsAgents(choice.value)
    assert.equal(
      Boolean(choice.consequence),
      !starts,
      `"${choice.label}" ${starts ? 'starts agents but carries a consequence sentence' : 'leaves no way to start an agent and says nothing about it'}`,
    )
    if (starts) continue
    assert.match(choice.consequence, /start an assistant|start an agent/i, 'the consequence must name what becomes impossible')
    assert.match(choice.consequence, /Settings|turn(s)? it on|one click/i, 'the consequence must say where it is turned back on')
  }
  /* And the walkthrough must actually print it. A sentence in a frozen table
     that no screen renders is the same as no sentence. */
  assert.match(VIEW, /choice\.consequence/, 'the autonomy step must render the consequence of each option')
  assert.match(VIEW, /data-setup-consequence/, 'the walkthrough must state the consequence of the CURRENT answer, not only the options')
})

test('the permission level is a ceiling no answer can raise', () => {
  const asked = derive({ autonomy: 'autonomous' }, 'guided')
  for (const id of ['dispatch', 'decision', 'queue', 'thread-reply']) {
    assert.equal(asked.writeFlags[id], false, `the guided level let ${id} through`)
    assert.ok(asked.refusedWriteFlags.includes(id), `${id} was dropped silently instead of being reported as refused`)
  }
  // ...and the two it does permit are still reachable, or the level is unusable
  assert.equal(asked.writeFlags['agent-session'], true)
  assert.equal(asked.writeFlags['report-read'], true)
})

test('the ceiling clamps the cross-lane settings too, and says that it did', () => {
  const guided = derive({ autonomy: 'autonomous' }, 'guided')
  assert.equal(guided.intent.attach, 'mirror', 'the beginner level allowed taking over a live editor session')
  assert.equal(guided.intent.approvals, 'stop')
  assert.equal(guided.intent.ideImport, 'none')
  assert.equal(guided.intent.failover, 'manual')
  assert.equal(guided.clampedIntent.length, 4, 'four settings were clamped and fewer than four were reported')

  const standard = derive({ autonomy: 'autonomous' }, 'standard')
  assert.equal(standard.intent.ideImport, 'ask', 'the standard level imported every editor session it could find')
  assert.equal(standard.intent.attach, 'adopt')
})

/* An unknown level is a record from a newer build, a typo, or a truncated read.
   Resolving it to the LARGEST ceiling would make an unreadable file the reason a
   stranger's machine switched everything on. */
test('an unrecognised permission level gets the smallest ceiling, not the largest', () => {
  assert.deepEqual(ceilingForTier('omnipotent'), TIER_CEILINGS.guided)
  assert.deepEqual(ceilingForTier(undefined), TIER_CEILINGS.guided)
  const profile = derive({ autonomy: 'autonomous' }, 'omnipotent')
  assert.equal(profile.writeFlags.dispatch, false)
  assert.equal(profile.intent.attach, 'mirror')
})

test('an unrecognised or missing answer collapses to the cautious end', () => {
  for (const answers of [undefined, null, 'nonsense', [], { autonomy: 'yolo', screens: 'sideways' }]) {
    const profile = derive(answers, 'unrestricted')
    assert.equal(profile.answers.autonomy, SAFE_ANSWERS.autonomy, `${JSON.stringify(answers)} was not read as no answer`)
    assert.equal(profile.answers.screens, SAFE_ANSWERS.screens)
    for (const id of WRITE_IDS) assert.equal(profile.writeFlags[id], false)
  }
})

test('a hand-moved cross-lane setting is kept, and a nonsense one is not', () => {
  const moved = derive({ autonomy: 'observe', attach: 'fork' }, 'unrestricted')
  assert.equal(moved.intent.attach, 'fork', 'an individually changed setting was overwritten by the answer it came from')
  assert.equal(moved.intent.approvals, 'stop', 'changing one setting changed another')

  const nonsense = derive({ autonomy: 'observe', attach: 'obliterate' }, 'unrestricted')
  assert.equal(nonsense.intent.attach, 'mirror', 'an unrecognised value became an answer')
})

test('choosing a different overall answer resets the settings that answer implies', () => {
  const moved = { ...SAFE_ANSWERS, attach: 'adopt', approvals: 'judgement', workspaceRoots: [] }
  const reset = answersForAutonomy('observe', moved)
  assert.equal(reset.attach, 'mirror')
  assert.equal(reset.approvals, 'stop')
  assert.equal(reset.autonomy, 'observe')
  const raised = answersForAutonomy('autonomous', moved)
  assert.equal(raised.ideImport, 'all-detected')
})

/* ---------- 3. VISIBLE ---------- */

test('every setting the questions produce is reachable in Settings afterwards', () => {
  /* The six write flags and the six live flags already had rows; the assertion
     that matters is that they are still generated FROM the shared lists rather
     than from a copy that can go stale. */
  assert.match(SETTINGS_VIEW, /WRITE_ACTION_FLAGS\.map/, 'the write flags stopped being rows in Settings')
  assert.match(SETTINGS_VIEW, /LIVE_VIEW_FLAGS\.map/, 'the live flags stopped being rows in Settings')
  // ...and the settings that had no home at all now have one
  assert.match(SETTINGS_VIEW, /createSetupProfileSettings/, 'Settings no longer mounts the setup profile section')
  assert.match(SETTINGS_VIEW, /'Setup',/, 'Settings has no Setup category in its rail')

  /* IMPORTED IS NOT RENDERED, and the two assertions above cannot tell the
     difference. Replacing the Setup branch's body with '' left every one of
     them true and the whole section gone -- the unreachable-step defect again,
     in a different file, found by planting it rather than by reading. So the
     dispatcher's own branch is asserted, and the rail entry is asserted to
     reach it: a category with no branch renders an empty section, which is the
     silent half of the same bug. */
  const dispatcher = SETTINGS_VIEW.slice(
    SETTINGS_VIEW.indexOf('function sectionNodeMarkup('),
    SETTINGS_VIEW.indexOf('function renderSectioned('),
  )
  assert.ok(dispatcher.length > 0, 'src/views/settings.js no longer dispatches sections through one function')
  assert.match(
    dispatcher, /section === 'Setup'\) return setupController\.markup\(\)/,
    'the Setup category exists in the rail but its section renders nothing',
  )
  for (const category of ["'System'", "'Setup'"]) {
    assert.ok(dispatcher.includes(category), `${category} is a category with no branch in the dispatcher`)
  }

  /* AND THE ASSERTIONS ABOVE ARE NOT ENOUGH, which is the whole lesson.
   *
   * Every one of them reads SOURCE TEXT, and a defect that empties markup()
   * leaves all of it untouched: the dispatcher still says
   * `return setupController.markup()`, the import is still there, the rail entry
   * is still there, and the section renders nothing. Planting `return ''` at the
   * top of markup() with the real builder still below it kept this suite GREEN.
   * Dead code matches a text search exactly as well as live code does, so no
   * assertion over source can see reachability -- it can only see presence, and
   * presence is what survives every defect of this family.
   *
   * A sibling lane had to move its markup into a DOM-free module to make this
   * checkable. Mine already is one: src/setup-profile-settings.js imports no
   * stylesheet and touches no DOM, so the test CALLS it and reads what comes
   * back. That is a rendered result, not a description of one.
   *
   * The view itself (src/views/setup.js) cannot be called here -- it imports
   * three stylesheets and builds DOM -- so its rendering is covered by the
   * packaged run instead, which drives the real window and reads real text. */
  const rendered = createSetupProfileSettings().markup()
  assert.ok(rendered.length > 400, `the Setup section rendered ${rendered.length} characters; it is empty or nearly so`)
  for (const row of ['Permission level', 'Working folders', 'Acting on its own', 'What the screens show', 'Walk through setup again']) {
    assert.ok(rendered.includes(row), `the Setup section renders without its "${row}" row`)
  }
  for (const field of PROFILE_INTENT) {
    assert.ok(rendered.includes(field.name), `the Setup section renders without the "${field.name}" row, so that setting is unreachable after first run`)
  }

  const SECTION = read('src/setup-profile-settings.js')
  assert.match(SECTION, /chooseTier/, 'the permission level is not changeable in Settings, so "you can change it later in Settings" is still untrue')
  assert.match(SECTION, /recordWorkspaces/, 'the working folder is not changeable in Settings')
  for (const field of PROFILE_INTENT) {
    assert.match(SECTION, new RegExp(`intent:\\$\\{field\\.id\\}|${field.id}`), `${field.id} has no row in Settings`)
  }
})

test('a setting that is recorded but not yet acted on says so where it is shown', () => {
  const SECTION = read('src/setup-profile-settings.js')
  for (const field of PROFILE_INTENT) assert.equal(field.enforced, false)
  /* The same honesty rule src/setup-state.js applies to the permission level's
     own enforcement gap. A row that silently does nothing is worse than no row. */
  assert.match(SECTION, /Recorded, not yet acted on/, 'the four cross-lane rows no longer state what they do today')
  assert.match(VIEW, /still being built/, 'the review no longer states which of its settings are not yet acted on')
})

/* WHAT THIS ASSERTED FIRST, AND WHY THAT WAS THE WRONG PROPERTY.
 *
 * It used to assert that no setup surface contained `type="password"` at all,
 * and that both surfaces stated "No account, password, or key is asked for
 * anywhere in this setup". That went red the moment the account lane added a
 * sign-in step to this same walkthrough -- and it was right to, because the
 * sentence had become FALSE: a password IS asked for now, for a local account on
 * this computer. A first-impression screen promising it collects nothing while
 * collecting something is the worst defect either lane could ship, so the copy
 * was corrected rather than the assertion deleted.
 *
 * The property worth defending is not "no field exists". It is that whatever any
 * setup surface collects CANNOT REACH THE STORED PROFILE, which is serialised to
 * localStorage and rendered on the review page. That is asserted below against
 * the fields actually present in the walkthrough, so it keeps holding as other
 * lanes add steps, instead of going stale the way the literal ban did. */
test('nothing a setup surface collects can reach the stored profile', () => {
  const collected = [...VIEW.matchAll(/data-setup-account-field="([a-zA-Z]+)"/g)].map(match => match[1])
  const fields = [...new Set([...collected, 'password', 'apiKey', 'token', 'secret'])]
  const stored = writeStoredProfile(
    { status: 'complete', answers: { autonomy: 'observe', ...Object.fromEntries(fields.map(field => [field, 'a-value-that-must-not-persist'])) } },
    fakeStorage(),
  )
  for (const field of fields) {
    assert.equal(stored.answers[field], undefined, `${field} survived into the stored profile`)
  }
  assert.equal(JSON.stringify(stored).includes('a-value-that-must-not-persist'), false)
})

/* EVERY SENTENCE THE WALKTHROUGH SHOWS, WALKED UNDER ONE RULE.
 *
 * Twenty-nine user-facing sentences live as literals in src/views/setup.js and,
 * until this test, exactly two of them were looked at by anything. The rest could
 * have named a mechanism, leaked an internal identifier, or made a promise the
 * product had stopped keeping, and every test in this repo would have stayed
 * green. That is not hypothetical here: the credential sentence went false TWICE
 * in one session, and only one of the two was caught by a test -- the other was
 * caught by another lane reading it.
 *
 * WHY THE COPY IS NOT MOVED INTO A `COPY` OBJECT, which is the stronger fix and
 * the one a sibling lane applied to its own view. src/views/setup.js is now
 * shared: the account step and its sentences belong to another lane and are
 * being edited concurrently. Hoisting every string would rewrite their work to
 * make my test tidier, which is the collision the coordination board exists to
 * prevent. Walking the rendered source gets the same RULES over the same
 * sentences without touching a line anyone else owns. If this file ever settles
 * to one owner, hoist them.
 *
 * KNOWN BOUND, stated rather than papered over: this reads text nodes plus
 * aria-label and placeholder values. Copy assembled at runtime from a variable
 * is not visible to it. The model's own copy -- the choices and the four
 * cross-lane fields -- is covered separately, because those ARE structured data
 * and are asserted against by name elsewhere in this file.
 */
function renderedCopy(source) {
  const text = [...source.matchAll(/>([A-Z][a-z][^<>{}$]{10,})</g)].map(match => match[1])
  const attributes = [...source.matchAll(/(?:aria-label|placeholder)="([^"${}]{10,})"/g)].map(match => match[1])
  return [...text, ...attributes]
}

/* THE MODEL'S COPY IS WALKED AS DATA, NOT AS SOURCE.
 *
 * The choices and the four cross-lane fields are structured objects, so the test
 * reads the real exported values instead of regexing the file. That is strictly
 * stronger: a sentence assembled from two halves, or moved between fields, is
 * still seen. */
function modelCopy() {
  const strings = []
  for (const choice of [...AUTONOMY_CHOICES, ...SCREENS_CHOICES]) {
    /* `consequence` is walked for the same reason `detail` is, and it was the
       first thing checked when it was added: a new copy field that no rule
       reads is a sentence in front of a stranger that nothing is watching, and
       the consequence sentences are the most absolute copy on the screen. */
    strings.push(choice.label, choice.note, choice.detail, choice.consequence)
  }
  for (const field of PROFILE_INTENT) {
    strings.push(field.name, field.desc, ...Object.values(field.labels))
  }
  return strings.filter(value => typeof value === 'string' && value.trim().length >= 10)
}

/* ALL THREE PLACES THIS LANE PUTS WORDS IN FRONT OF A PERSON.
 *
 * The first version of these rules walked ONE of them -- the view -- and that
 * was the same error the rules exist to catch, committed inside the fix for it.
 * Measured immediately afterwards: seven absolute claims were sitting
 * unregistered in the other two files, including the very sentence that had
 * already gone false twice. Fixing one instance and not asking what else is
 * unwatched is apparently the hardest habit here to break; this is the third
 * time in one session it has come up, and the first time it was mine twice. */
function everySentenceThisLaneShows() {
  return [
    ...renderedCopy(VIEW),
    ...renderedCopy(read('src/setup-profile-settings.js')),
    ...modelCopy(),
  ]
}

test('no sentence this lane shows names a mechanism', () => {
  const copy = everySentenceThisLaneShows()
  assert.ok(copy.length >= 60, `only ${copy.length} sentences were found; the extraction broke and this test is checking nothing`)
  /* A stranger reads this screen before they have any idea what the program is
     made of. An internal identifier here is not jargon-as-style, it is a leak. */
  const mechanism = /\b(localStorage|sessionStorage|IPC|ipcRenderer|preload|renderer|asar|machine\.json|workspaceRoots|mc\.write|mc\.live|mc\.set|JSON|schema|payload|boolean|null|undefined|serialise|serialize|git|repository|commit)\b/i
  /* COUNTED, because a loop that iterates nothing passes.
     Asserting on `copy` and then looping over something else is the shape that
     lets a guard go inert while reporting success -- the same rule
     tools/check-no-owner-data.mjs applies to itself ("scanned 0 files" is an
     error there, not a pass). A planted `for (const sentence of [])` kept this
     test green until this counter existed. */
  let checked = 0
  for (const sentence of copy) {
    checked += 1
    assert.doesNotMatch(sentence, mechanism, `a user-facing sentence names a mechanism: "${sentence}"`)
  }
  assert.equal(checked, copy.length, 'the loop did not examine every sentence that was collected')
  assert.ok(checked >= 60, `only ${checked} sentences were examined; this guard is checking air`)
})

/* THE CLASS THAT ACTUALLY BIT, TWICE, so it gets the strictest rule.
 *
 * An absolute claim about what the product never does is the most fragile
 * sentence a first-run screen can carry: it is written when it is true, and it
 * is falsified by a lane that never reads it. So every one of them has to be
 * REGISTERED HERE with the reason it is still true. A new absolute claim fails
 * this test until someone writes that reason down, which is the whole point --
 * the cost of the sentence is paid at the moment it is added, by the person who
 * knows why they added it, instead of by whoever finds it false later. */
/* Two kinds of entry, because a word is not a promise.
 *
 * `pinned` is a claim about what the product does, and its reason must name the
 * MECHANISM that keeps it true -- ideally a test in this file, so falsifying the
 * behaviour turns something red before the sentence becomes a lie.
 * `not-a-promise` is a sentence where the word appears without any claim being
 * made: the name of an ANSWER a person is choosing, not an assertion by us.
 *
 * Splitting them is the precise repair rather than the loose one. The loose
 * repair -- exempting short strings, or dropping "nothing" from the pattern --
 * would have silenced a real promise the next time one was written short. */
const PINNED_ABSOLUTE_CLAIMS = Object.freeze([
  {
    match: /Nothing has been written yet/,
    kind: 'pinned',
    pinnedBy: 'the review step applies nothing until Finish; asserted by "nothing but the permission level is written before Finish", which counts applyDerived() call sites and allows exactly two, and observed in a real packaged run with every mc.write.* key still absent at that point',
  },
  {
    /* REWRITTEN FROM A NEGATIVE-SUBJECT SENTENCE INTO AN ACTIVE ONE. It read
       "No subscription, key, or password for Claude, ChatGPT or Google is asked
       for anywhere in this setup or stored by this program", which is
       twenty-eight words in the passive voice on a screen a stranger reads once.
       It is now "Nothing in this setup asks for a subscription, key or password
       for Claude, ChatGPT or Google, and this program stores none." Same two
       claims -- nothing is asked for, nothing is stored -- and the pattern is
       written against the subjects rather than against the word order, so a
       later rewording that keeps the promise does not turn this red. */
    match: /(setup|product) (asks|is asked).{0,40}(subscription|key|password)|(subscription|key,? or password).{0,60}(asked for|stores none)/i,
    kind: 'pinned',
    pinnedBy: 'no setup surface collects a provider credential; asserted by "nothing a setup surface collects can reach the stored profile", which discovers the collected fields rather than listing them, and by the credential-claims test',
  },
  {
    /* The settings-drawer copy of the same claim, deliberately scoped to THIS
       SCREEN rather than to the product: it said "anywhere in this product"
       until a lane could have falsified it on a screen no test of mine can see,
       and a claim nothing can keep is not worth making. */
    match: /This screen asks for no subscription, key or password for Claude, ChatGPT or Google/,
    kind: 'pinned',
    pinnedBy: 'same mechanism as above. Deliberately scoped to the screen it is printed on, for the reason recorded above it',
  },
  {
    match: /nothing at all is switched on that acts: no assistant starts/,
    kind: 'pinned',
    pinnedBy: 'AUTONOMY_WRITE_FLAGS.observe is the empty array, so the answer requests no write-action flag; asserted by "skipping applies exactly the state of a machine that never ran setup", which checks every flag false at all three levels',
  },
  {
    match: /None of it is your data and each screen says so/,
    kind: 'pinned',
    pinnedBy: 'the demonstration answer sets every live-view flag false, so each surface reads its preserved simulation and labels itself; asserted by "the other answer reaches every screen"',
  },
  {
    match: /These are the shipped defaults: nothing that acts is switched on/,
    kind: 'pinned',
    pinnedBy: 'shown only when no profile is stored, where the flags are untouched and src/write-flags.js returns false for anything but the literal "enabled"; same mechanism the skip-equivalence test asserts',
  },
  {
    match: /Nothing that acts is switched on and the working folder is whatever was already recorded/,
    kind: 'pinned',
    pinnedBy: 'shown only for status "skipped", which applies SAFE_ANSWERS and records no workspace; asserted by the skip-equivalence test and by the packaged skip run, which read workspaceChosen back as undefined',
  },
  {
    match: /Nothing is written until you finish it, and leaving partway changes nothing/,
    kind: 'pinned',
    pinnedBy: 'the walkthrough holds answers in an in-progress record and applies them only from Finish or Skip; asserted by the applyDerived() call-site count and by the packaged run, which found every write flag still absent mid-walkthrough',
  },
  {
    match: /^Nothing yet — let me look around first$/,
    kind: 'not-a-promise',
    pinnedBy: 'the NAME of the answer a person is choosing, not an assertion about the product. The promise that answer carries is the detail beneath it, which is pinned separately above',
  },
  {
    match: /With this answer, nothing here will start an agent/,
    kind: 'pinned',
    pinnedBy: 'rendered only when profileCanStartAnAgent() is false for the CURRENT answers with the tier ceiling applied, so the sentence and the state it describes are computed from one value; asserted by "the recommended answer leaves a control that starts an agent, at every level", which is the test that would go red if the two ever disagreed',
  },
  {
    match: /Nothing on this computer will be able to start an assistant while this is the answer/,
    kind: 'pinned',
    pinnedBy: 'AUTONOMY_WRITE_FLAGS.observe is the empty array so the answer requests no start flag, and src/agent-session.js mounts no Start control without it; asserted by "an answer that leaves no way to start an agent says so at the point of choice", which pins this sentence to autonomyStartsAgents() rather than to the label',
  },
  {
    /* Not a new sentence: it has been on the review since the block existed,
       but it sat inside a ternary, and the scanner cannot see copy assembled
       through an interpolation -- the known bound stated at renderedCopy(). The
       R1529 rewrite of that block split the branches into literals, which is
       what brought it into view. It is registered rather than reworded because
       it is true and because a sentence becoming VISIBLE to the guard is the
       guard working. */
    match: /Nothing that acts is switched on\. Every screen still reads and reports/,
    kind: 'pinned',
    pinnedBy: 'rendered only when the derived profile leaves every write-action flag false, computed from the same value the row list is built from, so the sentence and the state it describes cannot disagree; the skip-equivalence test asserts that state is exactly a machine that never ran setup',
  },
  {
    /* R1529. The lede over the block that explains every switch the answers
       left off. It is the sentence that makes the block guidance rather than a
       nudge, so it is the one sentence in that block that must be true. */
    match: /None of these is required\. This program works as it is/,
    kind: 'pinned',
    pinnedBy: 'no write-action flag is a precondition for any other surface: each one gates only its own mount and every mount returns a no-op when its flag is off, which tools/test/write-flags-fail-closed.test.mjs asserts flag by flag. The guidance module that supplies the rest of the block is asserted to contain no writer at all, so nothing it renders can switch anything on -- see "nothing in the guidance module can turn anything on" in tools/test/permission-guidance.test.mjs',
  },
  {
    match: /Nothing runs until you press start/,
    kind: 'pinned',
    pinnedBy: 'the recommended answer requests report-read, agent-session, dispatch and cloud-launch, and every one of those is a control a person presses; asserted by the recommended-answer test, which fails if decision, queue or thread-reply are ever switched on by it',
  },
])

test('every absolute claim on screen is registered with the reason it is true', () => {
  const absolute = /\b(never|nothing|no one|anywhere|always|none)\b/i
  const claims = everySentenceThisLaneShows().filter(sentence => absolute.test(sentence))
  /* THE DETECTOR MUST FIND SOMETHING. A sibling lane shipped this exact rule
     with a word-boundary escape that a heredoc had eaten into a literal
     backspace: it compiled, it ran, it matched nothing, and it reported zero
     absolute sentences in copy that had thirteen. A green test over an empty
     scan, committed inside the fix for green tests over empty scans. The
     registry is the floor -- every pinned sentence is one the detector is known
     to be able to find, so finding fewer than that means the pattern died. */
  assert.ok(
    claims.length >= PINNED_ABSOLUTE_CLAIMS.length,
    `the detector found ${claims.length} absolute sentences but ${PINNED_ABSOLUTE_CLAIMS.length} are registered; the pattern has gone inert and this guard is checking air`,
  )
  for (const claim of claims) {
    const pin = PINNED_ABSOLUTE_CLAIMS.find(entry => entry.match.test(claim))
    assert.ok(
      pin,
      `this sentence promises something absolute and nothing pins it true:\n    "${claim}"\n  Register it in PINNED_ABSOLUTE_CLAIMS with the reason, or soften it. Two sentences of this exact shape went false in one session.`,
    )
    assert.ok(pin.pinnedBy.length > 40, 'a pinned claim needs a real reason, not a placeholder')
    assert.ok(['pinned', 'not-a-promise'].includes(pin.kind), `${pin.kind} is not a kind of entry this registry has`)
  }
  /* And the pins are not allowed to rot into decoration: a registered claim that
     no longer appears means the sentence was reworded and its reason was left
     behind describing nothing. */
  for (const entry of PINNED_ABSOLUTE_CLAIMS) {
    assert.ok(
      claims.some(claim => entry.match.test(claim)),
      `a claim is pinned here but no longer appears on screen: ${entry.match}. Remove the pin, or restore the sentence.`,
    )
  }
})

test('the setup surfaces claim only what is still true about credentials', () => {
  for (const [name, source] of [['the walkthrough', VIEW], ['the settings section', read('src/setup-profile-settings.js')]]) {
    /* The absolute claim is banned, not merely absent: it read well, it is the
       obvious sentence to write, and it is now untrue. */
    assert.doesNotMatch(
      source, /No account, password, or key is asked for anywhere in this setup/,
      `${name} still claims setup asks for no account, which stopped being true when the sign-in step landed`,
    )
    assert.match(
      source, /stay in their own programs/,
      `${name} no longer says where an assistant subscription actually lives`,
    )
    assert.doesNotMatch(source, /ANTHROPIC_API_KEY|sk-[a-zA-Z0-9]{10}/, `${name} names a provider credential`)
  }
})

/* ---------- 4. REVERSIBLE ---------- */

test('nothing but the permission level is written before Finish', () => {
  const finish = VIEW.slice(VIEW.indexOf('async function finish()'), VIEW.indexOf('  /**\n   * Skip'))
  assert.ok(finish.includes('recordWorkspaces'), 'Finish does not record the folders')
  const beforeFinish = VIEW.slice(0, VIEW.indexOf('async function finish()'))
  assert.ok(!beforeFinish.includes('recordWorkspaces('), 'a folder is recorded before the person finishes setup')

  /* Settings reach storage through exactly one helper, and that helper is called
     from exactly two places: Finish and Skip. Both are terminal -- the person
     has said they are done. Matching on `applyProfile(` instead was the obvious
     way to write this and was worthless: the import line and the helper's own
     body both contain it, so it passed while proving nothing. Counting CALL
     SITES is the assertion that means what the comment above it says. */
  const declaration = VIEW.indexOf('function applyDerived()') + 'function '.length
  const callSites = [...VIEW.matchAll(/applyDerived\(\)/g)]
    .map(match => match.index)
    .filter(index => index !== declaration)
  assert.equal(callSites.length, 2, `the settings are applied from ${callSites.length} places; only Finish and Skip may apply them`)
  for (const index of callSites) {
    assert.ok(index > VIEW.indexOf('async function finish()'),
      'settings are applied somewhere earlier than Finish, so leaving the walkthrough halfway changes the machine')
  }

  /* The folder write goes FIRST and a failure stops everything: applying the
     switches and then failing to record the folder leaves a machine that
     half-agrees with the screen the person is looking at. */
  assert.ok(finish.indexOf('recordWorkspaces') < finish.indexOf('applyDerived()'),
    'the switches are applied before the write that can fail')
})

test('a walkthrough left halfway holds its answers and applies none of them', () => {
  const storage = fakeStorage()
  writeStoredProfile({ status: 'in-progress', step: 'autonomy', answers: { autonomy: 'autonomous' } }, storage)
  const stored = readStoredProfile(storage)
  assert.equal(stored.status, 'in-progress')
  assert.equal(stored.answers.autonomy, 'autonomous')
  assert.equal(resumeStep(stored, { tierRecorded: true, steps: ['tier', 'workspace', 'autonomy', 'review'] }), 'autonomy')
})

test('the walkthrough opens where the person actually is', () => {
  const steps = ['tier', 'workspace', 'autonomy', 'review']
  assert.equal(resumeStep(null, { tierRecorded: false, steps }), 'tier', 'a fresh machine does not open on the permission question')
  assert.equal(resumeStep(null, { tierRecorded: true, steps }), 'workspace', 'a machine with a level but no profile does not continue the walkthrough')
  const complete = { status: 'complete', step: 'review', answers: SAFE_ANSWERS }
  assert.equal(resumeStep(complete, { tierRecorded: true, steps }), 'review', 'reopening setup asks the questions again instead of showing the answers')
})

test('skip is offered on every step that has one, and cannot be hidden by a caller', () => {
  const actions = VIEW.slice(VIEW.indexOf('function actionsMarkup('), VIEW.indexOf('function stepMarkup('))
  assert.match(actions, /skip = true/, 'skip is no longer the default for a step')
  assert.match(actions, /data-setup-skip/, 'the skip control is not rendered')
  assert.ok(!VIEW.includes('skip: false'), 'a step suppresses the skip control, which makes the walkthrough a trap')
})

/* ---------- the stored record refuses what it cannot trust ---------- */

function fakeStorage(initial = null) {
  let value = initial
  return {
    localStorage: {
      getItem: () => value,
      setItem: (_key, next) => { value = next },
    },
  }
}

test('a stored profile this build cannot trust is read as no profile', () => {
  for (const raw of ['not json', '[]', '42', 'null', JSON.stringify({ schemaVersion: 99, status: 'complete' }), JSON.stringify({ schemaVersion: PROFILE_SCHEMA_VERSION, status: 'invented' })]) {
    assert.equal(readStoredProfile(fakeStorage(raw)), null, `${raw} was accepted as a profile`)
  }
})

test('storage that throws does not take the walkthrough down with it', () => {
  const hostile = { localStorage: { getItem() { throw new Error('quota') }, setItem() { throw new Error('quota') } } }
  assert.equal(readStoredProfile(hostile), null)
  assert.equal(writeStoredProfile({ status: 'complete', answers: SAFE_ANSWERS }, hostile), null)
})

test('the stored key is the one the settings section reads', () => {
  assert.equal(PROFILE_STORAGE_KEY, 'mc.setup.profile')
  const storage = fakeStorage()
  writeStoredProfile({ status: 'complete', answers: { autonomy: 'assisted', screens: 'demonstration' } }, storage)
  const back = readStoredProfile(storage)
  assert.equal(back.answers.autonomy, 'assisted')
  assert.equal(back.answers.screens, 'demonstration')
})

test('applying the profile goes through the application’s own setters', () => {
  const wrote = []
  const lived = []
  const profile = derive({ autonomy: 'assisted', screens: 'demonstration' }, 'unrestricted')
  applyProfile(profile, {
    setWriteFlag: (id, on) => { wrote.push([id, on]); return on },
    setLiveFlag: (id, on) => { lived.push([id, on]); return on },
  })
  assert.equal(wrote.length, WRITE_IDS.length, 'not every write flag was written, so one keeps a stale value')
  assert.equal(lived.length, LIVE_IDS.length)
  assert.deepEqual(wrote.find(entry => entry[0] === 'agent-session'), ['agent-session', true])
  assert.deepEqual(wrote.find(entry => entry[0] === 'decision'), ['decision', false])
  assert.ok(lived.every(entry => entry[1] === false))
})

/* ---------- the shell: the folder question, driven for real ---------- */

const SETUP_RECORD = require_(path.join(REPO_ROOT, 'shell', 'setup-record.cjs'))

/* Real temporary directories, not invented absolute paths. `recordWorkspaces`
   now writes an assistant configuration into the chosen folder, so a fixture
   naming `C:\Work` would have this suite create that directory on the machine
   running it. Every path below lives under one temp root that is removed after. */
const SANDBOX = mkdtempSync(path.join(tmpdir(), 'mc-setup-profile-'))
const inSandbox = (...parts) => path.join(SANDBOX, ...parts)
const SERVICES_ROOT = inSandbox('services-root')
const INSTALL_ROOT = inSandbox('install-root')
const NODE_PATH = inSandbox('install-root', 'node.exe')
const DEFAULT_WORKSPACE = inSandbox('home', 'Documents', 'AI Workspace')
const WORK = inSandbox('work')
const REFUSED_ROOT = inSandbox('refused')

after(() => rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 10 }))

function baseRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    tier: 'standard',
    machine: { id: 'test-machine', label: 'Test machine' },
    installRoot: INSTALL_ROOT,
    servicesRoot: SERVICES_ROOT,
    nodePath: NODE_PATH,
    workspaceRoots: [DEFAULT_WORKSPACE],
    loopbackHost: '127.0.0.1',
    shellPortRange: { first: 4601, last: 4609 },
    bridgePortRange: { first: 4610, last: 4619 },
    createdAtMs: 1,
    ...overrides,
  }
}

function fakeModules({ record = baseRecord(), readThrows = null, refuse = () => null, provisionThrows = false } = {}) {
  const calls = { provisioned: [], written: [], configured: [] }
  return {
    calls,
    modules: {
      ok: true,
      machineRecord: {
        TIERS: ['guided', 'standard', 'unrestricted'],
        resolveServicesRoot: () => SERVICES_ROOT,
        readMachineRecord: () => { if (readThrows) throw readThrows; return record },
        buildMachineRecord: input => ({ ...baseRecord(), ...input, machine: { id: input.machineId, label: input.machineLabel } }),
        writeMachineRecord: written => { calls.written.push(written); return 'written' },
        writeMcpConfig: (record, { targetDirectory }) => {
          calls.configured.push(targetDirectory)
          writeFileSync(path.join(targetDirectory, '.mcp.json'), '{"mcpServers":{}}\n')
          return { document: { mcpServers: { 'toolsenabled-readonly': {} } } }
        },
      },
      workspace: {
        defaultWorkspacePath: () => DEFAULT_WORKSPACE,
        checkWorkspaceCandidate: candidate => {
          const refusal = refuse(candidate)
          return refusal || { ok: true, resolved: candidate }
        },
        provisionWorkspace: candidate => {
          if (provisionThrows) throw Object.assign(new Error('no'), { code: 'SETUP_WORKSPACE_UNAVAILABLE' })
          calls.provisioned.push(candidate)
          mkdirSync(candidate, { recursive: true })
          return { workspace: candidate, created: true, undoAvailable: true }
        },
      },
    },
  }
}

test('the folder question refuses to answer before the permission level does', () => {
  const { modules, calls } = fakeModules({ record: null })
  const result = SETUP_RECORD.recordWorkspaces(['C:\\Work'], { modules })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'SETUP_TIER_NOT_RECORDED')
  assert.equal(calls.written.length, 0, 'a record was written with no permission level in it')
  assert.equal(calls.provisioned.length, 0)
})

/* A list whose third entry is refused must not leave two new folders on
   someone's disk and no record to show for them. */
test('every folder is checked before any folder is created', () => {
  const { modules, calls } = fakeModules({
    refuse: candidate => (candidate === 'C:\\Windows'
      ? { ok: false, code: 'SETUP_WORKSPACE_DRIVE_ROOT_REFUSED', message: 'That is the top of a whole drive.', resolved: candidate }
      : null),
  })
  const result = SETUP_RECORD.recordWorkspaces(['C:\\Fine', 'C:\\AlsoFine', 'C:\\Windows'], { modules })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'SETUP_WORKSPACE_DRIVE_ROOT_REFUSED')
  assert.equal(calls.provisioned.length, 0, 'folders were created before the whole list was known to be allowed')
  assert.equal(calls.written.length, 0)
})

test('recording a folder keeps every other thing the record already said', () => {
  const { modules, calls } = fakeModules({ record: baseRecord({ tier: 'unrestricted', createdAtMs: 12345 }) })
  const result = SETUP_RECORD.recordWorkspaces(['C:\\Work', 'C:\\Work'], { modules })
  assert.equal(result.ok, true)
  assert.deepEqual(result.roots, ['C:\\Work'], 'a repeated folder was recorded twice')
  const written = calls.written[0]
  assert.equal(written.tier, 'unrestricted', 'recording a folder moved the permission level')
  assert.equal(written.createdAtMs, 12345)
  assert.equal(written.nodePath, NODE_PATH)
  assert.deepEqual(written.workspaceRoots, ['C:\\Work'])
  /* The one added field, and what it is for: a folder the person was shown and
     chose is a different fact from the default nobody was asked about. */
  assert.equal(written.workspaceChosen, true)
})

test('a folder that cannot be prepared is reported, not half-recorded', () => {
  const { modules, calls } = fakeModules({ provisionThrows: true })
  const result = SETUP_RECORD.recordWorkspaces(['C:\\Work'], { modules })
  assert.equal(result.ok, false)
  assert.equal(calls.written.length, 0, 'a folder that could not be created was recorded anyway')
})

test('an empty or oversized list of folders is refused', () => {
  const { modules } = fakeModules()
  assert.equal(SETUP_RECORD.recordWorkspaces([], { modules }).code, 'SETUP_WORKSPACE_MISSING')
  const many = Array.from({ length: SETUP_RECORD.MAX_WORKSPACE_ROOTS + 1 }, (_, index) => inSandbox(`work-${index}`))
  assert.equal(SETUP_RECORD.recordWorkspaces(many, { modules }).code, 'SETUP_WORKSPACE_TOO_MANY')
})

/* The check applies the inside-the-installation refusal that `unrestricted`
   waives. Defaulting to the permissive level because a file could not be read
   would waive a refusal for the worst possible reason. */
test('an unreadable record makes the folder check stricter, not looser', () => {
  const seen = []
  const { modules } = fakeModules({ readThrows: Object.assign(new Error('malformed'), { code: 'SETUP_MACHINE_RECORD_MALFORMED' }) })
  modules.workspace.checkWorkspaceCandidate = (candidate, options) => {
    seen.push(options.tier)
    return { ok: true, resolved: candidate }
  }
  SETUP_RECORD.checkWorkspace('C:\\Work', { modules, repoRoot: INSTALL_ROOT })
  assert.deepEqual(seen, ['guided'])
})

test('the folder state distinguishes chosen from never asked', () => {
  const asked = SETUP_RECORD.readWorkspaceState({ modules: fakeModules({ record: baseRecord({ workspaceChosen: true }) }).modules })
  assert.equal(asked.chosen, true)
  const never = SETUP_RECORD.readWorkspaceState({ modules: fakeModules().modules })
  assert.equal(never.chosen, false, 'a folder nobody was asked about is reported as one they chose')
  assert.equal(never.tier, 'standard')
})

test('a copy with no setup code says so instead of pretending', () => {
  const absent = { ok: false, code: 'SETUP_PAYLOAD_ABSENT', reason: 'no payload' }
  const state = SETUP_RECORD.readWorkspaceState({ modules: absent })
  assert.equal(state.available, false)
  assert.equal(state.code, 'SETUP_PAYLOAD_ABSENT')
  assert.deepEqual(state.roots, [])
  assert.equal(SETUP_RECORD.checkWorkspace('C:\\Work', { modules: absent }).ok, false)
  assert.equal(SETUP_RECORD.recordWorkspaces(['C:\\Work'], { modules: absent }).ok, false)
})

/* ---------- the assistant configuration follows the folder ----------
 *
 * FOUND IN A REAL PACKAGED BUILD, not deduced. `recordTier` generates
 * `.mcp.json` into `workspaceRoots[0]`, which during first run is the folder
 * setup picked by itself -- so answering only the permission question created
 * `<profile>\Documents\AI Workspace` AND configured an assistant inside it,
 * before anyone had been asked which folder they wanted. Answering the folder
 * question then moved the record and left that document behind, describing a
 * workspace the person had just declined.
 */

test('choosing a folder configures the assistant in THAT folder', () => {
  const { modules, calls } = fakeModules()
  const result = SETUP_RECORD.recordWorkspaces([WORK], { modules })
  assert.equal(result.ok, true)
  assert.deepEqual(calls.configured, [WORK], 'the assistant was configured somewhere other than the folder the person chose')
  assert.equal(result.assistantConfig.ok, true)
  assert.ok(existsSync(path.join(WORK, '.mcp.json')))
})

test('the folder nobody chose gives its assistant configuration back', () => {
  mkdirSync(DEFAULT_WORKSPACE, { recursive: true })
  writeFileSync(path.join(DEFAULT_WORKSPACE, '.mcp.json'), '{"mcpServers":{"stale":{}}}\n')
  writeFileSync(path.join(DEFAULT_WORKSPACE, 'a-note-from-the-user.txt'), 'mine\n')

  const { modules } = fakeModules({ record: baseRecord({ workspaceRoots: [DEFAULT_WORKSPACE] }) })
  const result = SETUP_RECORD.recordWorkspaces([WORK], { modules })
  assert.equal(result.ok, true)
  assert.deepEqual(result.releasedRoots, ['SETUP_ASSISTANT_CONFIG_RELEASED'])
  assert.equal(existsSync(path.join(DEFAULT_WORKSPACE, '.mcp.json')), false, 'a declined folder kept an assistant configuration')
  /* Only the document. The folder and anything in it are the person's. */
  assert.equal(existsSync(DEFAULT_WORKSPACE), true, 'the folder itself was deleted')
  assert.equal(existsSync(path.join(DEFAULT_WORKSPACE, 'a-note-from-the-user.txt')), true, 'something the person put in that folder was deleted')
})

/* THE PREVIOUS FOLDER HERE IS THE DEFAULT ONE, and that is the whole point of
   the test. Written first with a folder that was not the default, it passed
   with the `workspaceChosen` guard REMOVED -- the "only the invented folder"
   condition was quietly doing all the work, so the test could not tell "spared
   because the person chose it" from "spared because it was never ours". A
   planted defect found that; this version isolates the guard by making every
   other condition point at stripping. It is also the realistic case: someone
   who accepted the suggested folder at Finish and later moves elsewhere. */
test('a folder the person actually chose is never stripped', () => {
  mkdirSync(DEFAULT_WORKSPACE, { recursive: true })
  writeFileSync(path.join(DEFAULT_WORKSPACE, '.mcp.json'), '{"mcpServers":{}}\n')
  const { modules } = fakeModules({ record: baseRecord({ workspaceRoots: [DEFAULT_WORKSPACE], workspaceChosen: true }) })
  const result = SETUP_RECORD.recordWorkspaces([WORK], { modules })
  assert.deepEqual(result.releasedRoots, [], 'changing to a second folder was treated as consent to strip the first')
  assert.equal(existsSync(path.join(DEFAULT_WORKSPACE, '.mcp.json')), true)
})

/* Condition 3 of the rule, on its own: only the exact path the default produces.
   A folder that merely happens to be abandoned is not setup's to touch. */
test('only the folder setup invented is ever touched', () => {
  const typed = inSandbox('typed-by-hand')
  mkdirSync(typed, { recursive: true })
  writeFileSync(path.join(typed, '.mcp.json'), '{"mcpServers":{}}\n')
  const { modules } = fakeModules({ record: baseRecord({ workspaceRoots: [typed] }) })
  const result = SETUP_RECORD.recordWorkspaces([WORK], { modules })
  assert.deepEqual(result.releasedRoots, [])
  assert.equal(existsSync(path.join(typed, '.mcp.json')), true)
})

test('keeping the same folder does not release it', () => {
  mkdirSync(DEFAULT_WORKSPACE, { recursive: true })
  writeFileSync(path.join(DEFAULT_WORKSPACE, '.mcp.json'), '{"mcpServers":{}}\n')
  const { modules } = fakeModules({ record: baseRecord({ workspaceRoots: [DEFAULT_WORKSPACE] }) })
  const result = SETUP_RECORD.recordWorkspaces([DEFAULT_WORKSPACE], { modules })
  assert.deepEqual(result.releasedRoots, [])
  assert.equal(existsSync(path.join(DEFAULT_WORKSPACE, '.mcp.json')), true, 'confirming the suggested folder removed its own configuration')
})

/* shell/setup-record.cjs states that the workspace is the ONE path allowed to
   cross to the renderer. This checks the other half of that sentence. */
test('no reply carries an internal path to the renderer', () => {
  const { modules } = fakeModules()
  const replies = [
    SETUP_RECORD.readWorkspaceState({ modules }),
    SETUP_RECORD.checkWorkspace('C:\\Work', { modules }),
    SETUP_RECORD.recordWorkspaces(['C:\\Work'], { modules }),
    SETUP_RECORD.readWorkspaceState({ modules: { ok: false, code: 'SETUP_MODULES_ABSENT', reason: `cannot find ${INSTALL_ROOT}\\thing` } }),
  ]
  for (const reply of replies) {
    const serialized = JSON.stringify(reply)
    assert.ok(!serialized.includes(SERVICES_ROOT.replace(/\\/g, '\\\\')), `a reply named the services root: ${serialized}`)
    assert.ok(!serialized.includes(NODE_PATH.replace(/\\/g, '\\\\')), `a reply named the runtime: ${serialized}`)
  }
})

/* ---------- the channels exist and are guarded ---------- */

test('every new setup channel is behind the same sender check as the level', () => {
  for (const channel of ['mc-setup:workspace-state', 'mc-setup:check-workspace', 'mc-setup:record-workspaces', 'mc-setup:choose-workspace']) {
    const at = SHELL.indexOf(`ipcMain.handle('${channel}'`)
    assert.notEqual(at, -1, `shell/main.cjs does not register ${channel}`)
    const registration = SHELL.slice(at, SHELL.indexOf('\n}))', at) + 4)
    assert.match(registration, /withFleetProfileSender/, `${channel} accepts a request from any frame`)
  }
  /* A folder write is the most consequential thing this window can do to a
     disk, so it must be an invoke and never a sendSync convenience. */
  assert.ok(!SHELL.includes("ipcMain.on('mc-setup:record-workspaces'"), 'the folder write became a synchronous channel')
  for (const method of ['workspaceState', 'checkWorkspace', 'chooseWorkspace', 'recordWorkspaces']) {
    assert.match(PRELOAD, new RegExp(`${method}:`), `the preload does not expose ${method}, so the control cannot work on an installed copy`)
  }
})

test('the model and the flag lists cannot drift apart', () => {
  for (const field of PROFILE_INTENT) {
    assert.equal(intentField(field.id), field)
    assert.ok(field.order.length >= 2, `${field.id} is not a choice`)
    for (const value of field.order) {
      assert.equal(typeof field.labels[value], 'string', `${field.id} has no label for ${value}`)
    }
    /* Ordered safest first: the ceiling is a maximum INDEX into this list, so an
       order written the other way round would silently invert every clamp. */
    const guided = TIER_CEILINGS.guided.intent[field.id]
    assert.equal(field.order.indexOf(guided), 0, `${field.id} does not put its safest option first`)
  }
})
