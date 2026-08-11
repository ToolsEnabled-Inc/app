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
  SAFE_ANSWERS,
  SCREENS_CHOICES,
  TIER_CEILINGS,
  answersForAutonomy,
  applyProfile,
  ceilingForTier,
  deriveProfile,
  intentField,
  readStoredProfile,
  resumeStep,
  writeStoredProfile,
} from '../../src/setup-profile.js'
import { WRITE_ACTION_FLAGS } from '../../src/write-flags.js'
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
  assert.deepEqual(parse(steps), ['tier', 'workspace', 'autonomy', 'review'])
  /* Section 1 of docs/design/INSTALLER-EXPERIENCE.md promises a beginner "a
     total of three questions". Four would break that promise; two would mean a
     question was dropped rather than folded. */
  assert.deepEqual(parse(questions), ['tier', 'workspace', 'autonomy'])
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
  assert.equal(LIVE_IDS.length, 6)
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

test('the preselected answer is the safe one, and it is the one marked Recommended', () => {
  assert.equal(AUTONOMY_CHOICES[0].value, SAFE_ANSWERS.autonomy)
  assert.equal(AUTONOMY_CHOICES[0].note, 'Recommended')
  assert.equal(SCREENS_CHOICES[0].value, SAFE_ANSWERS.screens)
  /* The safe option being first AND recommended is the same rule the permission
     question follows, and it is what lets someone proceed by not deciding
     without that being a decision to switch things on. */
  assert.deepEqual(derive({ autonomy: AUTONOMY_CHOICES[0].value }, 'unrestricted').writeFlags,
    Object.fromEntries(WRITE_IDS.map(id => [id, false])))
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

test('no setup surface asks for or stores a credential', () => {
  for (const [name, source] of [['the walkthrough', VIEW], ['the settings section', read('src/setup-profile-settings.js')]]) {
    assert.match(source, /No account, password, or key is asked for/, `${name} no longer states that it collects nothing`)
    assert.doesNotMatch(source, /type="password"/, `${name} grew a password field`)
  }
  /* And the model drops anything it does not know, so a value cannot reach the
     stored record by being assigned somewhere careless. */
  const stored = writeStoredProfile(
    { status: 'complete', answers: { autonomy: 'observe', apiKey: 'sk-not-a-real-key', password: 'hunter2' } },
    fakeStorage(),
  )
  assert.equal(stored.answers.apiKey, undefined)
  assert.equal(stored.answers.password, undefined)
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
