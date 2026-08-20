import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { AVAILABILITY_CODES, START_REFUSAL_CODES, createAgentHost, engineAvailability, engineCandidates } from '../../shell/agent-host.cjs'
import { RECORD_AVAILABILITY_CODES } from '../../shell/spawn-record.cjs'
import { sessionEventText, sessionTurnStatus } from '../../src/agent-session-events.js'
import { MISSING_MODULE, UNAVAILABLE_TEXT, refusalCode, unavailableReason } from '../../src/agent-availability-copy.js'
import { confinementNote } from '../../src/agent-confinement-copy.js'
import { ENGINE_REASON, readAgentEngine } from '../../src/local-activity.js'
/* The compose panel's own composer, because the defect this file now also
   covers is not "the code has no copy" but "the code reaches THAT surface as
   the sentence for a refusal nobody explained". Only startRefusalSentence()
   can answer that. */
import { START_REFUSAL, startRefusalSentence } from '../../src/fleet-tree-copy.js'

// The interface can start an agent only if three things hold at once: the
// renderer can reach the agent channels, the surface can tell whether an
// engine exists BEFORE it offers a control, and nothing on that path can put
// a filesystem path on screen. Each test below pins exactly one of those.

const ROOT = resolve(import.meta.dirname, '..', '..')
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8')

test('availability reports a bounded code and never a path', () => {
  // The engine-less answer must stay {ok, code}: the resolver's real message
  // lists every path it tried, and rendering that is how a private checkout
  // path reached the DOM before.
  //
  // `capabilityRoot: null` pins that state explicitly. Deleting the env var
  // used to be sufficient, because an unconfigured shell had no other way to
  // find an engine -- but a shipped payload now legitimately resolves one, so
  // "no environment variable" no longer means "no engine". Without this the
  // test measures whether a payload happens to be staged in the checkout
  // beside it, and flips green/red on ambient state rather than on the
  // behaviour it is pinning.
  const previous = process.env.MISSION_CONTROL_ENGINE
  delete process.env.MISSION_CONTROL_ENGINE
  try {
    const result = engineAvailability({ capabilityRoot: null })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'AGENT_ENGINE_UNAVAILABLE')
    assert.deepEqual(Object.keys(result).sort(), ['code', 'ok'])
    for (const value of Object.values(result)) {
      assert.doesNotMatch(String(value), /[\\/]/, 'no availability field may contain a path separator')
    }
  } finally {
    if (previous === undefined) delete process.env.MISSION_CONTROL_ENGINE
    else process.env.MISSION_CONTROL_ENGINE = previous
  }
})

/* A complete engine tree: all three hostModules present, laid out exactly as
   the payload lays them out. Pointing at the ENGINE DIRECTORY inside it rather
   than at the tree root is deliberate -- normalizedModulePath() appends
   codex-process.js to any path not ending in .js, and engineRootOf() then walks
   three levels back up, so this is the only shape from which the host resolves
   the sibling modules the way it does on a real install. */
const COMPLETE_ENGINE = resolve(ROOT, 'tools/test/fixtures/confined-engine/src/lib/agent-engine')

/* Payload-relative paths, duplicated from shell/agent-host.cjs on purpose: a
   test that imported the constants could not notice one of them being changed
   to something the installer does not stage. */
const HOST_MODULES = Object.freeze({
  engine: 'src/lib/agent-engine/codex-process.js',
  confinement: 'src/lib/agent-session-confinement.js',
  launchEnvironment: 'src/lib/providers/subscription-launch-env.js',
})

/* Build a payload root that carries exactly the named modules, copied from the
   complete fixture tree. `omit` is what makes the negative direction real:
   every "not ready" assertion below is about a tree that is genuinely missing a
   file, not about a stub that returns a code. */
function stagePayload({ omit = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mc-capability-'))
  const source = resolve(ROOT, 'tools/test/fixtures/confined-engine')
  for (const [name, relative] of Object.entries(HOST_MODULES)) {
    if (omit.includes(name)) continue
    const target = join(root, ...relative.split('/'))
    mkdirSync(join(target, '..'), { recursive: true })
    copyFileSync(join(source, ...relative.split('/')), target)
  }
  return root
}

function withoutEngineEnvironment(run) {
  const previous = process.env.MISSION_CONTROL_ENGINE
  delete process.env.MISSION_CONTROL_ENGINE
  try {
    return run()
  } finally {
    if (previous === undefined) delete process.env.MISSION_CONTROL_ENGINE
    else process.env.MISSION_CONTROL_ENGINE = previous
  }
}

test('availability resolves a real configured engine', () => {
  // Proves the probe answers ok for an engine that genuinely exports the
  // contract, rather than only ever failing closed. THE CONVERSE DIRECTION,
  // and the one that matters most for a readiness check that got stricter: a
  // false negative here does not annoy a customer, it deletes the product's
  // core feature.
  const result = engineAvailability({ enginePath: COMPLETE_ENGINE })
  assert.equal(result.ok, true, 'a complete engine tree must report ready')
  assert.equal(result.code, 'AGENT_ENGINE_READY')
})

/* Derive the preload from main.cjs rather than naming one. An earlier version
   of this suite asserted against shell/preload.cjs, which no window loads --
   it went green while window.mcAgent was undefined in the running app. A test
   that names the wrong file is the same defect as a control that cannot work:
   both report success for something that does not exist. */
export function activePreloadPath() {
  const main = read('shell/main.cjs')
  const match = main.match(/preload:\s*path\.join\(__dirname,\s*'([^']+)'\)/)
  assert.ok(match, 'main.cjs must declare its preload via path.join(__dirname, ...)')
  return `shell/${match[1]}`
}

test('the loaded preload is the one the tests check', () => {
  const active = activePreloadPath()
  assert.equal(active, 'shell/fleet-profile-preload.cjs')
  assert.doesNotMatch(
    read('shell/preload.cjs'),
    /exposeInMainWorld\('mcAgent'/,
    'the unloaded preload must not carry an agent bridge that no window can reach',
  )
})

test('the renderer has a bounded, deliberate bridge to the agent channels', () => {
  // The inverse of the old gate. The exposure is required now -- without it
  // no agent can be started from the interface at all -- but it stays a
  // fixed, named surface, and ipcRenderer itself is never handed over.
  const preload = read(activePreloadPath())
  assert.match(preload, /exposeInMainWorld\('mcAgent'/, 'preload must expose the agent bridge')
  for (const call of ['availability', 'start', 'send', 'interrupt', 'close', 'onEvent']) {
    assert.match(preload, new RegExp(`\\b${call}:`), `preload must expose ${call}`)
  }
  assert.doesNotMatch(
    preload,
    /exposeInMainWorld\([^)]*ipcRenderer\s*\)/,
    'preload must never hand ipcRenderer itself to the renderer',
  )
})

test('the engine resolver carries no hardcoded sibling-repo default', () => {
  // Unchanged from the original gate: this clause of BLOCKER 2 is permanent.
  const agentHost = read('shell/agent-host.cjs')
  assert.doesNotMatch(agentHost, /sibling default/, 'the resolver must not carry a filesystem-guess candidate')
  assert.match(agentHost, /MISSION_CONTROL_ENGINE/, 'the engine path must come from configuration')
})

test('the spawn surface no longer claims that no tier restricts a running session', () => {
  // THIS TEST USED TO ASSERT THE OPPOSITE, and that is the point of rewriting it
  // rather than deleting it. It required the sentence "No permission tier limits
  // a running session" to be PRESENT, because when it was written the tier was
  // recorded and enforced against nothing (T5, unbuilt) and a control that
  // implied a limit would have been claiming safety the product did not have.
  //
  // T5 was then built. capability/src/lib/agent-session-confinement.js resolves
  // the recorded level into thread options and shell/agent-host.cjs startSession()
  // passes them to the engine, so the sentence became false -- and this gate went
  // on requiring it. A test that pins a claim rather than the reason for the claim
  // becomes a gate protecting the defect, which is exactly what happened here.
  //
  // So it now asserts the property the original was reaching for: the control
  // must not overstate the product's blast radius in EITHER direction.
  const surface = read('src/agent-session.js')
  assert.doesNotMatch(
    surface.replace(/\/\*[\s\S]*?\*\//g, ''),
    /No permission tier limits a running session/,
    'the retired claim must not be reachable from the shipped code path',
  )
  assert.match(surface, /confinementNote\(/, 'the sentences must be computed from a reading of this install')
  assert.match(surface, /bridge\.confinement/, 'the reading must come from the shell, not from a constant')
})

test('the spawn surface states that starts are recorded, and claims no more', () => {
  // The claim must be exactly as strong as the evidence. "Recorded on this
  // device" is true: an app-local signed chain, written before the spawn.
  // Calling it the audit ledger, or implying off-device attestation, would
  // overstate a key that lives on the same machine as the records.
  //
  // Asserted against the SENTENCE the copy module produces rather than against a
  // source constant. The constant this used to slice out of src/agent-session.js
  // no longer exists, and the previous form -- a regex match indexed at [0] --
  // threw a TypeError rather than failing with a message when it stopped
  // matching, which is a test that cannot tell you what broke.
  const sentences = confinementNote({
    ok: true, tier: 'unrestricted', sandbox: 'danger-full-access', failedClosed: false,
  }).sentences.join(' ')
  assert.match(sentences, /recorded on this device before it runs/)
  assert.doesNotMatch(
    sentences,
    /audit ledger|canonical|tamper-proof|verified by/i,
    'the note must not claim more than an app-local signed record',
  )
})

test('a spawn is refused when it cannot be recorded', () => {
  // The whole point of the gate: no receipt, no process. The record call must
  // come before any spawn, and a failure must refuse rather than continue.
  const main = read('shell/main.cjs')
  assert.match(main, /const record = recordSpawnIntent\(request\)/, 'the spawn must be recorded first')
  const start = main.slice(main.indexOf("ipcMain.handle('mc-agent:start'"))
  assert.ok(
    start.indexOf('recordSpawnIntent(request)') < start.indexOf('startSession(request)'),
    'the record must be written before the session is started, not after',
  )
  assert.match(
    main,
    /agentIpcError\(\s*'MC_AGENT_RECORD_UNAVAILABLE'/,
    'a record failure must refuse the spawn with a typed error',
  )
})

test('availability requires an engine, a usable recorder, and the workspace the session runs in', () => {
  // Reporting only some of what a start needs would let the surface offer a
  // Start control that the start handler then refuses -- a dead button by a
  // different route.
  //
  // Bounded by the handler's own closing brace rather than by a character
  // count. The earlier version sliced the first 600 characters, which made the
  // test's meaning depend on how long the comments inside the handler happened
  // to be -- it went red for a comment and would have gone green for a handler
  // that lost a check under a shorter one.
  const main = read('shell/main.cjs')
  const start = main.indexOf("ipcMain.handle('mc-agent:availability'")
  assert.ok(start > 0, 'main.cjs must register the availability channel')
  const handler = main.slice(start, main.indexOf('\n})', start))
  assert.match(handler, /engineAvailability\(\{[^)]*defaultCwd:/, 'the probe must be asked about the working directory the session will use')
  assert.match(handler, /spawnRecordAvailability\(\)/)

  /* THE SAME ORDER THE PRESS REFUSES IN. mc-agent:start records the intent
     before it asks the host for a session, so an installation with both faults
     is refused by the recorder. A probe that named the engine first would send
     that person to fix the wrong thing. */
  // Comments stripped first: this handler EXPLAINS the order in prose above
  // the code that implements it, and an index test over the raw text measures
  // the sentence rather than the statement.
  const executable = handler.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(
    executable.indexOf('spawnRecordAvailability()') < executable.indexOf('engineAvailability('),
    'availability must ask about the record before the engine, because the start does',
  )
  const startHandler = main.slice(main.indexOf("ipcMain.handle('mc-agent:start'"))
  assert.ok(
    startHandler.indexOf('recordSpawnIntent(request)') < startHandler.indexOf('getAgentHost()'),
    'this test\'s premise: the start really does record before it resolves a host',
  )

  // ONE preparation, called by both, so the probe cannot validate a directory
  // the start would only create afterwards -- which on a fresh install would
  // report a broken workspace that is about to exist.
  assert.match(handler, /ensureWorkspaceRoot\(\)/, 'the probe must prepare the workspace the same way the start does')
  const host = main.slice(main.indexOf('function getAgentHost()'))
  assert.match(host.slice(0, 400), /ensureWorkspaceRoot\(\)/, 'getAgentHost must use the same preparation the probe uses')
  assert.equal(
    (main.match(/fs\.mkdirSync\(WORKSPACE_ROOT/g) || []).length,
    1,
    'the workspace must be created in exactly one place, or the probe and the start can disagree about it',
  )
})

test('the surface renders only recognised event text', () => {
  const id = 'session-a'
  assert.equal(sessionEventText({ sessionId: id, event: { type: 'assistant_text_delta', text: 'hi' } }, id), 'hi')
  // A different session's packet must never reach this surface's transcript.
  assert.equal(sessionEventText({ sessionId: 'other', event: { type: 'assistant_text_delta', text: 'leak' } }, id), null)
  // An unrecognised event is ignored rather than rendered.
  assert.equal(sessionEventText({ sessionId: id, event: { type: 'tool_call', text: 'x' } }, id), null)
  assert.equal(sessionEventText(null, id), null)
  assert.equal(sessionTurnStatus({ sessionId: id, event: { type: 'turn_completed', status: 'completed' } }, id), 'completed')
  assert.equal(sessionTurnStatus({ sessionId: 'other', event: { type: 'turn_completed', status: 'x' } }, id), null)
})

/* THE COMPOSER IS THE SECOND READER OF THAT SAME STREAM, and a second reader is
 * how one of the two comes to be wrong in private.
 *
 * The agent page's chat box was wired to a live session and then read the
 * packets itself: `packet.text`, falling back to `packet.delta.text`. Neither
 * field exists on anything this product emits -- the test above is the shape --
 * so the condition was false for every packet and the composer rendered NOTHING
 * back from a real, running agent. The suite above could not see it: the readers
 * were correct and untouched; the surface that mattered simply did not use them.
 *
 * The second clause is the same defect from the other end. A refusal on this
 * channel arrives as a REJECTED invoke whose message shell/main.cjs has
 * deliberately replaced with the bare code, so `catch (error) { show(
 * error.message) }` prints a machine identifier to a person -- the thing
 * tools/test/refusal-copy.test.mjs exists to prevent, by the one route its scan
 * cannot see (it looks for a code in a template, and this was an Error's own
 * message). The sentence has to come from the copy tables, through `fail`.
 *
 * PINNED AS SOURCE because the listener and the catch are closures inside a view
 * builder that no unit test can reach; comment lines are dropped first, since
 * both notes above quote the very expressions being forbidden. */
test('the agent page composer reads the live stream through the shared readers, and prints no Error text', () => {
  const withoutNotes = (text) => text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n')

  const view = withoutNotes(read('src/views/agent.js'))
  assert.match(
    view,
    /import \{[^}]*\bsessionEventText\b[^}]*\bsessionTurnStatus\b[^}]*\} from '\.\.\/agent-session-events\.js'/,
    'the agent page must read live packets through agent-session-events.js, not a shape of its own',
  )
  assert.equal(
    view.match(/\bpacket\s*\.\s*(text|delta)\b/g),
    null,
    'the composer must not reach into a packet directly -- that reading was false for every packet this product emits',
  )

  const chat = withoutNotes(read('src/components.js'))
  assert.equal(
    chat.match(/\b(error|err|reason)\s*(?:\?\.|\.)\s*message\b/g),
    null,
    "the chat window must not put an Error's own message on screen: on this channel that message is the machine code",
  )
})

test('every agent channel validates its sender frame', () => {
  // These channels create and drive a real CLI child process. The shell has no
  // will-navigate or window-open guard, so the sender check is the boundary
  // that actually holds: without it, any frame reaching the preload could
  // spawn. The sibling fleet-profile handlers already did this; the spawn
  // channels did not, which was the wrong way round.
  const main = read('shell/main.cjs')
  const channels = ['availability', 'start', 'send', 'interrupt', 'close']
  for (const channel of channels) {
    assert.match(
      main,
      new RegExp(`ipcMain\\.handle\\('mc-agent:${channel}'[^\\n]*\\n\\s*assertTrustedAgentSender\\(event\\)`),
      `mc-agent:${channel} must validate its sender frame as its very first statement`,
    )
  }
  assert.match(
    main,
    /function assertTrustedAgentSender[\s\S]{0,300}trustedFleetProfileSender/,
    'the agent sender check must reuse the shell trusted-sender test, not define a second one',
  )
})

test('the agent page mounts the session surface and closes it on destroy', () => {
  const view = read('src/views/agent.js')
  assert.match(view, /mountAgentSessionSurface\(root/, 'the agent page must mount the session surface')
  assert.match(view, /destroyAgentSession\(\)/, 'navigating away must close any open session')
})

test('availability resolves the engine the installer ships, with no environment variable set', () => {
  // THE CUSTOMER PATH, and the one that was dead on every shipped copy until
  // 2026-08-10. Measured over CDP against the real installed 1.0.5:
  // mc.write.agent-session was already "enabled" and availability() still
  // answered AGENT_ENGINE_UNAVAILABLE, because engineCandidates() knew only an
  // explicit enginePath and MISSION_CONTROL_ENGINE. A customer has neither, and
  // no UI sets one, so "start an agent from inside ToolsEnabled" could never
  // work. The engine now ships in the capability payload
  // (tools/capability-manifest.json hostModules) and resolves from the same
  // root shell/setup-record.cjs already uses.
  //
  // The fixture mirrors the payload's real layout rather than working around
  // the resolver, so a change to PAYLOAD_ENGINE_MODULE breaks this test.
  const root = stagePayload()
  try {
    withoutEngineEnvironment(() => {
      const result = engineAvailability({ capabilityRoot: root })
      assert.equal(result.ok, true, 'a payload that carries every host module must resolve without any environment variable')
      assert.equal(result.code, 'AGENT_ENGINE_READY')
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------
   READINESS MEANS STARTABLE.

   The defect these pin: engineAvailability() resolved the ENGINE and answered
   AGENT_ENGINE_READY, while startSession() additionally required the
   confinement planner, the launch-environment scrub, and a working directory
   the OS will accept. Readiness and startability were computed from two
   different sources, so on any payload missing one of the other modules the
   product reported READY, enabled Start, and threw on every press.

   Not hypothetical. agent-session-confinement.js and subscription-launch-env.js
   were declared under `hostModules` AFTER the 1.0.5 installer was built, so the
   copy already delivered to the second machine is exactly that payload.
   ------------------------------------------------------------------ */

test('a payload with the engine but no confinement planner is not ready', () => {
  const root = stagePayload({ omit: ['confinement'] })
  try {
    withoutEngineEnvironment(() => {
      const result = engineAvailability({ capabilityRoot: root })
      assert.equal(result.ok, false, 'an engine alone is not a startable installation')
      assert.equal(result.code, 'AGENT_CONFINEMENT_UNAVAILABLE', 'the refusal must name the missing precondition, not a generic engine fault')
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a payload with no launch-environment scrub is not ready', () => {
  const root = stagePayload({ omit: ['launchEnvironment'] })
  try {
    withoutEngineEnvironment(() => {
      const result = engineAvailability({ capabilityRoot: root })
      assert.equal(result.ok, false, 'a copy that cannot protect the billed account is not startable')
      assert.equal(result.code, 'AGENT_LAUNCH_ENVIRONMENT_UNAVAILABLE', 'the refusal must name the launch-environment module')
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a payload missing two host modules reports the one the start would report', () => {
  // ORDER, not merely membership. A probe that named a different one of two
  // true faults would send someone to fix the wrong thing, and the start path
  // resolves confinement before the launch environment.
  const root = stagePayload({ omit: ['confinement', 'launchEnvironment'] })
  try {
    withoutEngineEnvironment(() => {
      assert.equal(
        engineAvailability({ capabilityRoot: root }).code,
        'AGENT_CONFINEMENT_UNAVAILABLE',
        'the probe must resolve preconditions in the start path order',
      )
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------
   THE FIFTH PRECONDITION, found by another lane measuring the shipped build.

   Same packaged binary, same isolated user-data directory, one variable:
     USERPROFILE with no Codex sign-in -> availability READY, start() REFUSED
     USERPROFILE with a Codex sign-in  -> availability READY, start() STARTED
   The refusal was correct -- a confined level builds its session from the
   user's auth.json -- but the probe could not see it, so the product offered an
   enabled button that refused every press.
   ------------------------------------------------------------------ */

function withCodexHome(home, run) {
  const previous = process.env.CODEX_HOME
  const previousResolved = process.env.MC_TEST_CONFINEMENT_RESOLVED
  if (home === null) delete process.env.CODEX_HOME
  else process.env.CODEX_HOME = home
  try {
    return run()
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = previous
    if (previousResolved === undefined) delete process.env.MC_TEST_CONFINEMENT_RESOLVED
    else process.env.MC_TEST_CONFINEMENT_RESOLVED = previousResolved
  }
}

test('a confined level with no Codex sign-in is not ready', () => {
  const home = mkdtempSync(join(tmpdir(), 'mc-codex-home-'))
  try {
    withCodexHome(home, () => {
      process.env.MC_TEST_CONFINEMENT_RESOLVED = JSON.stringify({ tier: 'guided', isolated: true })
      const result = engineAvailability({ enginePath: COMPLETE_ENGINE })
      assert.equal(result.ok, false, 'a confined level cannot build a session without the sign-in it links')
      assert.equal(result.code, 'AGENT_CONFINEMENT_SIGNED_OUT', 'the refusal must name the sign-in, not the packaging')
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a confined level WITH a Codex sign-in is ready', () => {
  // The converse, and the one that matters: this precondition must not report
  // a working, signed-in install as unavailable.
  const home = mkdtempSync(join(tmpdir(), 'mc-codex-home-'))
  try {
    writeFileSync(join(home, 'auth.json'), '{"tokens":"redacted"}')
    withCodexHome(home, () => {
      process.env.MC_TEST_CONFINEMENT_RESOLVED = JSON.stringify({ tier: 'guided', isolated: true })
      const result = engineAvailability({ enginePath: COMPLETE_ENGINE })
      assert.equal(result.ok, true, 'a signed-in confined install must report ready')
      assert.equal(result.code, 'AGENT_ENGINE_READY')
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('an unrestricted level is ready with no Codex sign-in at all', () => {
  /* THE FALSE NEGATIVE THIS PRECONDITION COULD EASILY HAVE CAUSED, pinned
     explicitly. `unrestricted` runs against the user's own Codex home and never
     links a credential, so demanding a sign-in there would report the DEFAULT
     level broken -- costing more than the bug being fixed. */
  const home = mkdtempSync(join(tmpdir(), 'mc-codex-home-'))
  try {
    withCodexHome(home, () => {
      process.env.MC_TEST_CONFINEMENT_RESOLVED = JSON.stringify({ tier: 'unrestricted', isolated: false })
      const result = engineAvailability({ enginePath: COMPLETE_ENGINE })
      assert.equal(result.ok, true, 'an unrestricted level must not require a sign-in it never reads')
      assert.equal(result.code, 'AGENT_ENGINE_READY')
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('the sign-in probe fails OPEN when it cannot resolve the recorded level', () => {
  /* A planner that predates this question -- exporting confinedSessionPlan and
     nothing else -- must leave readiness exactly as it was. Turning "I could not
     tell" into "unavailable" would delete the product's core feature on any
     payload shape this shell does not recognise, and the start path still fails
     closed on all of them, so a pass here is never worse than what shipped. */
  const root = stagePayload()
  try {
    const planner = join(root, ...HOST_MODULES.confinement.split('/'))
    writeFileSync(planner, "'use strict'\nmodule.exports = { confinedSessionPlan: () => ({ ok: true }) }\n")
    const home = mkdtempSync(join(tmpdir(), 'mc-codex-home-'))
    try {
      withCodexHome(home, () => {
        const result = engineAvailability({ enginePath: join(root, ...HOST_MODULES.engine.split('/')) })
        assert.equal(result.ok, true, 'an unrecognised planner must not be turned into an unavailable product')
      })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the sign-in the probe looks for is declared the way the host declares every payload module', () => {
  /* THE DUPLICATION, CHECKED AS FAR AS A TRACKED FILE CAN CHECK IT.
     shell/agent-host.cjs rebuilds the credential path because the payload module
     exports no read-only sign-in probe -- linkCredential() is private and
     writes. A copy nobody compares is how two answers to one question drift.

     THIS HALF IS UNCONDITIONAL because it reads only tracked files. An earlier
     version of this test read capability/src/lib/agent-session-confinement.js
     directly and passed here while failing in any clean checkout: `capability/`
     is DERIVED OUTPUT and gitignored, so it does not exist until
     `npm run pack:capability` cuts it. Proven by materialising the committed
     tree with `git archive` and running the suite there -- the payload was
     absent and this was the only red test. Payload-shape checks belong to the
     build pipeline (`npm run dist` runs check-payload-current, check-asar-
     manifest and check-payload-boundary), which is where the payload is
     guaranteed to exist; `npm test` must not depend on it. */
  const host = read('shell/agent-host.cjs')
  assert.match(host, /process\.env\.CODEX_HOME \|\| path\.join\(os\.homedir\(\), '\.codex'\)/, 'the probe must resolve the user Codex home as CODEX_HOME or ~/.codex')
  assert.match(host, /'auth\.json'/, 'the probe must look for the credential file the payload links')
  assert.match(host, /PAYLOAD_CONFINEMENT_MODULE = 'src\/lib\/agent-session-confinement\.js'/, 'the module the probe questions must still be the declared one')

  const manifest = JSON.parse(read('tools/capability-manifest.json'))
  assert.ok(
    manifest.hostModules.includes('src/lib/agent-session-confinement.js'),
    'the module that owns the sign-in refusal must be staged as a hostModule, or the probe questions something no customer has',
  )
})

test('the payload, when one is staged, still links the credential the probe expects', () => {
  /* THE OTHER HALF, and it is CONDITIONAL rather than skipped-in-disguise: the
     assertions below are the real drift check, and they run on every machine
     that has cut a payload -- which is every machine that can build an
     installer, including the one that cuts releases. On a bare checkout there
     is nothing to compare against and this reports that in its name rather than
     pretending to have checked. The unconditional test above is what holds when
     this cannot run. */
  const payloadPath = resolve(ROOT, 'capability/src/lib/agent-session-confinement.js')
  if (!existsSync(payloadPath)) {
    assert.ok(true, 'no payload is staged in this checkout, so there is nothing to compare')
    return
  }
  const payload = readFileSync(payloadPath, 'utf8')
  assert.match(payload, /process\.env\.CODEX_HOME \|\| path\.join\(require\('node:os'\)\.homedir\(\), '\.codex'\)/,
    'the payload still resolves the user Codex home as CODEX_HOME or ~/.codex; the probe copies that construction')
  assert.match(payload, /path\.join\(userHome, 'auth\.json'\)/, 'the payload still names auth.json as the credential')
  assert.match(payload, /'AGENT_CONFINEMENT_SIGNED_OUT'/, 'the payload still raises the code the probe reports')
  assert.match(payload, /confinement\.isolated !== true/, 'the payload still builds a confined home only for an isolated level')
})

test('a bad working directory outranks a missing planner, because construction does', () => {
  /* createAgentHost() resolves the engine and THEN validates the default cwd,
     both before anything asks for a confinement plan. An earlier version of
     this probe checked the cwd LAST, so an installation with both faults was
     told about the planner while the press would have told it about the
     directory -- the same send-them-to-the-wrong-thing defect as the
     record/engine ordering, one level down. */
  const root = stagePayload({ omit: ['confinement'] })
  const cwdRoot = mkdtempSync(join(tmpdir(), 'mc-agent-cwd-'))
  try {
    const archive = join(cwdRoot, 'resources', 'app.asar')
    mkdirSync(join(cwdRoot, 'resources'), { recursive: true })
    writeFileSync(archive, 'not a directory')
    const enginePath = join(root, ...HOST_MODULES.engine.split('/'))

    assert.equal(
      engineAvailability({ enginePath, defaultCwd: archive }).code,
      'AGENT_HOST_INVALID_CWD',
      'the probe must report the fault the host construction hits first',
    )
    assert.throws(
      () => createAgentHost({ enginePath, defaultCwd: archive }),
      (error) => {
        assert.equal(error.code, 'AGENT_HOST_INVALID_CWD', 'this test\'s premise: construction really does refuse the cwd first')
        return true
      },
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(cwdRoot, { recursive: true, force: true })
  }
})

test('availability refuses a working directory the spawn cannot use', () => {
  // The third dev-only-works bug, asked as a READINESS question. A packaged
  // build whose workspace resolved inside the archive reported ready and then
  // died at CreateProcess on every start.
  const root = mkdtempSync(join(tmpdir(), 'mc-agent-cwd-'))
  try {
    const archive = join(root, 'resources', 'app.asar')
    mkdirSync(join(root, 'resources'), { recursive: true })
    writeFileSync(archive, 'not a directory')
    const result = engineAvailability({ enginePath: COMPLETE_ENGINE, defaultCwd: archive })
    assert.equal(result.ok, false, 'a cwd the spawn will refuse must not be reported ready')
    assert.equal(result.code, 'AGENT_HOST_INVALID_CWD', 'the refusal must name the working directory, not the engine')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the probe and the start agree, code for code, on every incomplete payload', async () => {
  /* THE ANTI-DRIFT TEST, and the only one here that reads both sources at once.
     Each case below asks the SAME installation two questions -- "are you ready"
     and "start a session" -- and requires one answer. Every other test in this
     block could pass while the two drifted apart again; this one cannot.

     createAgentHost() is what a start goes through, so the comparison is
     against the real construction and start, not against a re-reading of
     availability's own logic. */
  /* The fixture planner answers with whatever MC_TEST_CONFINEMENT_PLAN holds
     and refuses by default, which would make every case below stop at the
     confinement check and never reach the one it is about. Staging a plan that
     SUCCEEDS is what lets the launch-environment case be measured at all. */
  const previousPlan = process.env.MC_TEST_CONFINEMENT_PLAN
  process.env.MC_TEST_CONFINEMENT_PLAN = JSON.stringify({
    ok: true, tier: 'unrestricted', isolated: false,
    threadOptions: { sandbox: 'danger-full-access', approvalPolicy: 'never' }, env: null,
  })
  const cases = [
    ['no confinement planner', { omit: ['confinement'] }, 'AGENT_CONFINEMENT_UNAVAILABLE'],
    ['no launch-environment scrub', { omit: ['launchEnvironment'] }, 'AGENT_LAUNCH_ENVIRONMENT_UNAVAILABLE'],
  ]
  try {
  for (const [label, staging, expected] of cases) {
    const root = stagePayload(staging)
    try {
      const enginePath = join(root, ...HOST_MODULES.engine.split('/'))
      const probe = engineAvailability({ enginePath })
      assert.equal(probe.code, expected, `${label}: the probe must report ${expected}`)
      assert.equal(probe.ok, false, `${label}: the probe must not report ready`)

      const host = createAgentHost({ enginePath, defaultCwd: root })
      let started = null
      try {
        await host.startSession({ sessionId: `probe-${label}` })
      } catch (error) {
        started = error
      }
      assert.ok(started, `${label}: the start must actually fail, or the probe is refusing a working install`)
      assert.equal(
        started.code,
        probe.code,
        `${label}: readiness and startability must be computed from one source -- the probe said ${probe.code} and the start said ${started.code}`,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
  } finally {
    if (previousPlan === undefined) delete process.env.MC_TEST_CONFINEMENT_PLAN
    else process.env.MC_TEST_CONFINEMENT_PLAN = previousPlan
  }
})

/* ------------------------------------------------------------------
   A REFUSAL NOBODY CAN READ IS A REFUSAL NOBODY CAN ACT ON.

   The main-process message names the missing module and the manifest that
   should have staged it -- and also names an absolute engine root, so it can
   never cross the bridge. The CODE carries that specificity instead, which only
   works if every surface that shows a code has a sentence for it.
   ------------------------------------------------------------------ */

test('every code availability can return has a specific sentence on both surfaces', () => {
  /* MAPPED EXPLICITLY, not merely "different from the fallback". "This copy is
     not set up to run agents yet" is the fallback AND the deliberate, correct
     sentence for AGENT_ENGINE_UNAVAILABLE, so a difference test would force
     that one entry to be reworded into something less true. The property that
     actually matters is that a code was CONSIDERED. */
  const noEngine = ENGINE_REASON.AGENT_ENGINE_UNAVAILABLE
  /* BOTH HALVES of the composed answer. mc-agent:availability returns the
     RECORDER's verdict when a record cannot be written and the ENGINE's when it
     can, and both reach the page carrying the Start control -- so walking only
     the engine codes was itself a list of two of three preconditions. */
  for (const code of [...RECORD_AVAILABILITY_CODES, ...AVAILABILITY_CODES]) {
    const page = unavailableReason(code)
    assert.ok(Object.hasOwn(UNAVAILABLE_TEXT, code), `the agent page has no entry for ${code}, so it would show the bare code`)
    assert.notEqual(page, code, `the agent page shows the bare code for ${code} instead of a sentence`)
    assert.ok(page.length > 20, `the agent page's copy for ${code} is too short to act on: ${page}`)

    assert.ok(Object.hasOwn(ENGINE_REASON, code), `the home screen has no entry for ${code} and would fall back to generic copy`)
    const home = readAgentEngine({ ok: false, code }).why
    assert.equal(home, ENGINE_REASON[code], `readAgentEngine does not render the home screen's own entry for ${code}`)
    assert.equal(readAgentEngine({ ok: false, code }).ready, false, `${code} must never read as ready`)

    /* A copy is not "not set up to run agents" when its engine resolved and one
       sibling module is missing -- that sentence sends a person to reinstall
       for a fault that has nothing to do with configuration. */
    if (code !== 'AGENT_ENGINE_UNAVAILABLE') {
      assert.notEqual(home, noEngine, `${code} reuses the no-engine sentence, which is untrue of an installation whose engine resolved`)
    }
  }
})

test('every refusal the probe never answers still reaches a person as a sentence', () => {
  /* THE GAP THIS CLOSES. The walk above covers AVAILABILITY_CODES and
     RECORD_AVAILABILITY_CODES -- what the readiness probe can answer. Four
     codes reach the same two surfaces WITHOUT the probe ever answering them:
     AGENT_HOST_CLOSED and MC_AGENT_INVALID_PAYLOAD (raised on the call itself)
     and CODEX_CLI_NOT_FOUND / CODEX_VERSION_DETECTION_FAILED (raised by the
     engine at start time, after readiness has already said yes). They had a
     sentence in both tables and NOTHING REQUIRED THEM TO, which is the same
     defect class the recorder half was repaired for: the coverage list and the
     copy list were maintained by different hands and only one was checked.

     Each is asserted the way it is actually experienced -- through
     refusalCode(), which is how a code survives the IPC boundary at all, then
     through the sentence each surface renders. */
  for (const code of START_REFUSAL_CODES) {
    assert.equal(
      refusalCode(new Error(code)),
      code,
      `${code} does not survive the IPC boundary: refusalCode() cannot recover it from the error message, so the page shows AGENT_SESSION_FAILED instead`,
    )

    assert.ok(Object.hasOwn(UNAVAILABLE_TEXT, code), `the agent page has no entry for ${code}, so it would show the bare code`)
    const page = unavailableReason(code)
    assert.notEqual(page, code, `the agent page shows the bare code for ${code} instead of a sentence`)
    assert.ok(page.length > 20, `the agent page's copy for ${code} is too short to act on: ${page}`)

    assert.ok(Object.hasOwn(ENGINE_REASON, code), `the home screen has no entry for ${code} and would fall back to generic copy`)
    const home = readAgentEngine({ ok: false, code }).why
    assert.equal(home, ENGINE_REASON[code], `readAgentEngine does not render the home screen's own entry for ${code}`)
    assert.equal(readAgentEngine({ ok: false, code }).ready, false, `${code} must never read as ready`)
  }

  /* AND THE LIST MAY NOT SHRINK TO FIT. Same reasoning as the recorder half:
     a coverage list walked by a copy test can always be made green by deleting
     the entry that was failing, so each member is tied back to something that
     really raises it. The two engine-side codes are raised in the payload's
     codex-process.js, outside this repo, so they are tied to the boundary that
     admits them instead: refusalCode()'s table, asserted above. */
  assert.ok(read('shell/agent-host.cjs').includes("fail('AGENT_HOST_CLOSED'"),
    'AGENT_HOST_CLOSED is listed as a start refusal but the host no longer raises it')
  assert.ok(read('shell/main.cjs').includes("'MC_AGENT_INVALID_PAYLOAD'"),
    'MC_AGENT_INVALID_PAYLOAD is listed as a start refusal but the agent IPC frame validator no longer raises it')
  assert.ok(read('shell/agent-host.cjs').includes("fail('AGENT_TIER_NO_LAUNCHER'"),
    'AGENT_TIER_NO_LAUNCHER is listed as a start refusal but resolveStartTier() no longer raises it')
  assert.equal(new Set(START_REFUSAL_CODES).size, START_REFUSAL_CODES.length, 'the start-refusal vocabulary repeats a code')
  for (const code of START_REFUSAL_CODES) {
    assert.equal(AVAILABILITY_CODES.includes(code), false,
      `${code} is in both vocabularies; a start-only code in AVAILABILITY_CODES fails the host's own classification test`)
    assert.equal(RECORD_AVAILABILITY_CODES.includes(code), false, `${code} is in both vocabularies`)
  }
})

test('the two surfaces name the same fault in their own register', () => {
  // Two tables exist because a home screen and a spawn control speak
  // differently, not because the product has two opinions. Each pair must be
  // about the same thing, and neither may be the other's text verbatim.
  for (const code of ['AGENT_CONFINEMENT_UNAVAILABLE', 'AGENT_LAUNCH_ENVIRONMENT_UNAVAILABLE']) {
    assert.notEqual(UNAVAILABLE_TEXT[code], ENGINE_REASON[code], `${code} has the same sentence on both surfaces; one of them is in the wrong register`)
    assert.ok(/will not start/.test(ENGINE_REASON[code]), `${code} must tell a home-screen reader what the consequence is`)
  }
  /* THE MODULE NAME IS STILL REQUIRED, AND IT MOVED OFF THE GLASS.
   *
   * These two lines used to assert that "(agent-session-confinement)" and
   * "(subscription-launch-env)" appeared IN THE SENTENCE, on the grounds that
   * the main-process message names the missing module and can never cross the
   * bridge, so if the name is nowhere a support conversation has nothing to go
   * on. That reason is right. The place was wrong: it put an internal module
   * name, in brackets, mid-sentence, in front of a customer whose only available
   * action is to reinstall.
   *
   * It is the identical situation src/refusal-copy.js settled for codes -- the
   * identifier is a machine field on `data-refusal-code`, never in the prose --
   * so the module name is now a machine field too, in MISSING_MODULE. BOTH
   * HALVES ARE ASSERTED, because either one alone reintroduces a defect: drop
   * the first and the name can vanish entirely, drop the second and it can go
   * back into the sentence. */
  assert.equal(MISSING_MODULE.AGENT_CONFINEMENT_UNAVAILABLE, 'agent-session-confinement',
    'the missing module must stay nameable somewhere a support conversation can reach it')
  assert.equal(MISSING_MODULE.AGENT_LAUNCH_ENVIRONMENT_UNAVAILABLE, 'subscription-launch-env',
    'the missing module must stay nameable somewhere a support conversation can reach it')
  for (const [code, name] of Object.entries(MISSING_MODULE)) {
    assert.ok(Object.hasOwn(UNAVAILABLE_TEXT, code), `${code} names a missing module and has no sentence`)
    assert.ok(!UNAVAILABLE_TEXT[code].includes(name),
      `${code} puts the module name "${name}" in front of a person: ${UNAVAILABLE_TEXT[code]}`)
  }
  for (const text of Object.values(UNAVAILABLE_TEXT)) {
    assert.doesNotMatch(text, /[\\]|[A-Za-z]:\//, 'no refusal sentence may carry a filesystem path')
  }
})

test('every refusal the start CHANNEL raises reaches the person as a reason, not as "we were not told why"', () => {
  /* THE GAP THIS CLOSES, and it is one level up from the two walks above.
   *
   * Those walk what the HOST and the RECORDER can answer. Ten more refusals are
   * raised by shell/main.cjs on the mc-agent:start channel itself, before the
   * host is ever reached: the trusted-sender check, the payload parse, the
   * session-profile resolve, the session limit, and the spawn recorder. Every
   * one of them crossed the IPC boundary correctly -- rendererSafeAgentError
   * makes the message the code precisely so it survives -- and then fell
   * through startRefusalSentence() to START_REFUSAL.noReasonGiven, "Nothing was
   * started, and this copy was not told why. Try once more."
   *
   * The copy WAS told why. And "try once more" is worse than saying nothing,
   * because not one of these clears on a second press: the limit is still
   * reached, the folder is still gone, the record still cannot be written.
   *
   * THE LIST IS READ FROM THE SOURCE, never typed here, so a refusal added to
   * that channel later fails this test instead of quietly reaching a person as
   * the no-reason sentence. The profile family is read the same way: the start
   * path rethrows sessionProfiles.resolveCwd's code with an MC_AGENT_ prefix,
   * so the codes come from shell/session-profiles.cjs. */
  const main = read('shell/main.cjs')
  const channelCodes = new Set([...main.matchAll(/'(MC_AGENT_[A-Z_]+)'/g)].map(match => match[1]))
  /* `'MC_AGENT_' + error.code` -- the prefix is a literal on its own and is not
     a code. Dropping it here rather than loosening the pattern keeps the
     pattern honest about what a code looks like. */
  channelCodes.delete('MC_AGENT_')
  const profiles = read('shell/session-profiles.cjs')
  for (const [, code] of profiles.matchAll(/refusal\('(PROFILE_[A-Z_]+)'/g)) {
    /* Only the ones a START can reach: resolveCwd is what mc-agent:start calls,
       and the create/remove refusals belong to their own controls. */
    if (code === 'PROFILE_UNKNOWN' || code.startsWith('PROFILE_FOLDER_')) channelCodes.add(`MC_AGENT_${code}`)
  }

  assert.ok(channelCodes.size >= 10,
    `only ${channelCodes.size} refusal codes were found in the start channel; the reader has drifted from the source`)

  /* NOT EVERY CODE ON THESE CHANNELS IS A START, and composing a send refusal
     behind "Nothing was started." would be the product asserting something it
     does not know. Each entry here is send-only for a stated reason and is
     still required to carry copy, one assertion further down. */
  const sendOnly = new Set([
    // Raised by mc-agent:send when a message names a file that was not picked
    // in that session. A session IS open and running; what failed is the
    // message.
    'MC_AGENT_ATTACHMENT_UNKNOWN',
    // Raised by send, interrupt and close for a session this RUN does not
    // hold. It already has its own sentence in the start table too, because a
    // tree node can outlive its session.
    'MC_AGENT_UNKNOWN_SESSION',
  ])

  for (const code of channelCodes) {
    assert.equal(refusalCode(new Error(code)), code,
      `${code} does not survive the IPC boundary: refusalCode() cannot recover it, so the panel shows AGENT_SESSION_FAILED instead`)
    assert.ok(Object.hasOwn(UNAVAILABLE_TEXT, code),
      `${code} has no sentence, so a person who hits it is told this copy was not told why`)
    if (sendOnly.has(code)) continue
    const sentence = startRefusalSentence({ ok: false, code })
    assert.notEqual(sentence, START_REFUSAL.noReasonGiven,
      `${code} reaches the compose panel as the no-reason sentence, which also tells the person to try again when trying again cannot work`)
    assert.ok(sentence.length > 40, `the sentence for ${code} is too short to act on: ${sentence}`)
    /* Rule 3 of the flow's copy: every failure sentence ends with something to
       do. Asserted as "the sentence has a second clause", which is the weakest
       thing that can distinguish a diagnosis from a diagnosis plus a remedy. */
    assert.ok(sentence.split(/(?<=[.!?])\s/).length >= 2,
      `the sentence for ${code} states a problem and offers no next step: ${sentence}`)
  }
})

test('a code with no copy still refuses, rather than degrading to ready', () => {
  // The fallback direction. An unmapped code is a copy gap, and a copy gap must
  // never become an enabled control -- both surfaces branch on `ok`, never on
  // whether they recognise the code.
  const unknown = readAgentEngine({ ok: false, code: 'AGENT_SOMETHING_NEW' })
  assert.equal(unknown.ready, false)
  assert.equal(unknown.supported, true)
  assert.ok(unknown.why, 'an unrecognised code must still produce a sentence')
  assert.equal(readAgentEngine({}).ready, false, 'a malformed reply must not read as ready')
  assert.equal(readAgentEngine(undefined).ready, false, 'no answer at all must not read as ready')

  const surface = read('src/agent-session.js')
  assert.match(
    surface,
    /if \(available\?\.ok !== true\) \{/,
    'the agent page must gate Start on ok, never on whether it recognises the code',
  )
})

test('every refusal code in the agent host is classified as reachable from the probe or not', () => {
  /* MECHANICAL, so a precondition added later cannot quietly return a code no
     surface can translate. Every fail() in shell/agent-host.cjs is collected
     from the source and must appear in exactly one of the two sets below --
     AVAILABILITY_CODES (which the copy test above walks) or the start-only list
     here, each entry of which is start-only for a stated reason. A new code
     lands in neither and fails this test. */
  const startOnly = new Set([
    /* AGENT_HOST_CLOSED used to be a bare literal here. It is now taken from
       START_REFUSAL_CODES so "start-only" and "must carry copy" are the same
       statement about the same code, made once. Deleting it from that list
       fails the copy walk above AND leaves it unclassified here. */
    ...START_REFUSAL_CODES,
    // Raised while a session is running or being torn down; there is nothing
    // for a readiness probe to resolve.
    'AGENT_ENGINE_INVALID_SESSION',
    'AGENT_ENGINE_INVALID_TURN',
    'AGENT_SESSION_UNKNOWN',
    'AGENT_SESSION_NOT_READY',
    'AGENT_SESSION_EXISTS',
    'AGENT_SESSION_START_CANCELLED',
    'AGENT_TURN_ACTIVE',
    'AGENT_TURN_NONE',
    /* Raised by resolveStartTier() only for a tier name outside START_TIERS.
       The tier menu is built from the same six names the host holds (the
       orchestration-controls suite pins the two tables together), so no click
       can produce an unknown tier -- only renderer/host drift or a hand-built
       payload can, which is MC_AGENT_INVALID_PAYLOAD's family: a malformed
       request, not a state a readiness probe could resolve or a person could
       choose. Its sibling AGENT_TIER_NO_LAUNCHER is one click away for a real
       person and therefore lives in START_REFUSAL_CODES with copy instead. */
    'AGENT_TIER_UNKNOWN',
    /* Resume refusals, iteration 7. Both are start-only for the same reason
       the tier ones are: they answer a request the person made THROUGH a
       control, and the sentence belongs to that control rather than to the
       availability screen. */
    'AGENT_RESUME_INVALID_THREAD',
    'AGENT_RESUME_UNSUPPORTED',
    /* Raised when the engine cannot change depth in place; the popup falls
       back to the warned restart, so the surface never dead-ends. */
    'AGENT_EFFORT_FIXED',
    'AGENT_MODELS_UNAVAILABLE',
    /* Raised by resolveEffort() only for a key outside the four the effort
       menu offers -- same family and same reasoning as AGENT_TIER_UNKNOWN
       directly above: only renderer/host drift or a hand-built payload can
       produce it, never a click, so no readiness probe could resolve it. */
    'AGENT_EFFORT_UNKNOWN',
    /* Raised by narrowTurnOptions() only when a send names a turn option that
       is not the renderer's to choose (sandbox, approvalPolicy, cwd,
       serviceTier), or by the image bound check for a malformed images array.
       The model picker offers only Codex rows and images ride only through
       the native picker's issued paths, so no click can produce either --
       only renderer/host drift or a hand-built payload can, the same
       MC_AGENT_INVALID_PAYLOAD family as AGENT_TIER_UNKNOWN above. */
    'AGENT_TURN_OPTION_FORBIDDEN',
    'AGENT_TURN_IMAGES_INVALID',
    /* Standing requests (the /Request family). KEYS_INVALID is the
       MC_AGENT_INVALID_PAYLOAD family: the view sends node ids it already
       holds, so only renderer/host drift or a hand-built payload can produce
       it -- never a click. UNAVAILABLE answers the person's own typed
       command through the chat, which writes its own sentence for it
       (src/views/computers.js fileStandingRequestFor); a readiness probe has
       nothing to resolve because the absence is the payload's age. The
       R_LEDGER-mapped refusals (AGENT_REQUEST_WORDS_*, _KEY, _SCOPE, ...)
       are raised through a computed fail(code) the literal scan cannot see,
       and the same chat sentences answer them. */
    'AGENT_REQUEST_KEYS_INVALID',
    'AGENT_REQUEST_UNAVAILABLE',
  ])
  const source = read('shell/agent-host.cjs')
  const found = new Set()
  for (const match of source.matchAll(/\bfail\(\s*\n?\s*'([A-Z_]+)'/g)) found.add(match[1])
  // startSession() re-raises the planner's own code, which is why the literal
  // appears there as a fallback; the planner loader owns it.
  assert.ok(found.size >= 10, `the code scan found only ${found.size} refusals, so its pattern has stopped matching`)
  const classified = new Set([...AVAILABILITY_CODES, ...startOnly])
  for (const code of found) {
    assert.ok(
      classified.has(code),
      `${code} is raised by shell/agent-host.cjs but classified neither as reachable from availability (with UI copy) nor as start-only`,
    )
  }
  for (const code of AVAILABILITY_CODES) {
    assert.ok(found.has(code), `${code} is exported as an availability code but nothing in the host raises it`)
  }
})

test('the recorder half of the vocabulary is derived from what the recorder can raise', () => {
  /* WITHOUT THIS, THE COPY TEST IS SELF-SELECTING. It walks
     RECORD_AVAILABILITY_CODES, so deleting an entry from that list makes the
     copy gap it was covering disappear -- coverage that shrinks to fit is the
     hand-maintained-count defect this repo already names in
     tools/check-suites-discovered.mjs.

     So the list is checked against the source instead: availability() calls
     loadOrCreateKey() and loadHead() and substitutes SPAWN_RECORD_UNAVAILABLE
     for anything without a code, and every SPAWN_RECORD_* those two can raise
     must be in the exported list. */
  const source = read('shell/spawn-record.cjs')
  const bodyOf = (name) => {
    const start = source.indexOf(`function ${name}(`)
    assert.ok(start > 0, `shell/spawn-record.cjs must still define ${name}(), or this scan is measuring nothing`)
    return source.slice(start, source.indexOf('\n  }', start))
  }
  const raised = new Set(['SPAWN_RECORD_UNAVAILABLE'])
  for (const fn of ['loadOrCreateKey', 'loadHead']) {
    for (const match of bodyOf(fn).matchAll(/'(SPAWN_RECORD_[A-Z_]+)'/g)) raised.add(match[1])
  }
  assert.ok(raised.size >= 4, `the recorder scan found only ${raised.size} codes, so its pattern has stopped matching`)
  for (const code of raised) {
    assert.ok(
      RECORD_AVAILABILITY_CODES.includes(code),
      `${code} can be reported by the availability probe but is missing from RECORD_AVAILABILITY_CODES, so no surface is required to have copy for it`,
    )
  }
  for (const code of RECORD_AVAILABILITY_CODES) {
    assert.ok(source.includes(`'${code}'`), `${code} is exported as a recorder availability code but the recorder never raises it`)
  }
})

/* THE THIRD DEV-ONLY-WORKS BUG on this path, and the last one blocking
   "start an agent from inside ToolsEnabled".

   getAgentHost() passed `path.join(__dirname, '..')` as the session cwd. In a
   checkout that is the repo root; in a packaged app `__dirname` lives inside
   the archive, so it resolved to `resources/app.asar` -- a FILE. Electron's
   asar-patched fs reports that path as a directory, so normalizeCwd() approved
   it, and child_process.spawn (which does not honour the patch) then failed at
   CreateProcess with an ENOENT blamed on the command. Every packaged agent
   start died there while every checkout stayed green.

   MEASURED 2026-08-10 with the shipped binary as the engine's script host:
     cwd = <a real directory>      -> START OK, threadId issued
     cwd = ...\resources\app.asar  -> CODEX_APP_SERVER_EXITED, spawn ... ENOENT
   Same binary, same engine, same auth; the cwd was the only difference. */

test('the agent session cwd is a real directory, not a path inside the app bundle', () => {
  // The defect in one line. A __dirname-relative default is a real directory in
  // a checkout and a virtual one inside the asar, so this can only be caught by
  // reading what the shell actually passes.
  const main = read('shell/main.cjs')
  const call = main.match(/createAgentHost\(\{[^}]*\}\)/)
  assert.ok(call, 'main.cjs must construct the agent host with an explicit default cwd')
  assert.doesNotMatch(
    call[0],
    /__dirname/,
    'the agent default cwd must not be derived from __dirname: inside a packaged app that is an asar path, which cannot be a spawn working directory',
  )
  assert.match(call[0], /defaultCwd:\s*WORKSPACE_ROOT/, 'the agent must run in the workspace root')
  assert.match(
    main,
    /const WORKSPACE_ROOT = path\.join\(app\.getPath\('userData'\), 'workspace'\)/,
    'the workspace root must be a real directory under userData',
  )
})

test('a cwd inside an asar archive is refused with a message that says so', () => {
  // The validator must reject what the spawn will reject. Named explicitly
  // because "not a directory" about a path Electron's own fs calls a directory
  // reads as a contradiction, and that confusion is what cost the time.
  const root = mkdtempSync(join(tmpdir(), 'mc-agent-cwd-'))
  try {
    const archive = join(root, 'resources', 'app.asar')
    mkdirSync(join(root, 'resources'), { recursive: true })
    writeFileSync(archive, 'not a directory')
    assert.throws(
      () => createAgentHost({
        enginePath: resolve(ROOT, 'tools/test/fixtures/agent-engine'),
        defaultCwd: archive,
      }),
      (error) => {
        assert.equal(error.code, 'AGENT_HOST_INVALID_CWD')
        assert.match(error.message, /inside an asar archive/)
        return true
      },
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the cwd check asks the question the spawn will ask, not the one fs answers', () => {
  // Under Electron, a plain fs.statSync() reports asar-internal paths as
  // directories, so the isDirectory() guard above passes on exactly the path
  // that broke. `process.noAsar` makes validation and execution agree. This is
  // asserted on the source because the divergence only exists inside Electron
  // and cannot be reproduced by the plain-node test runner.
  const agentHost = read('shell/agent-host.cjs')
  assert.match(agentHost, /process\.noAsar = true/, 'the cwd stat must run with asar interception disabled')
  assert.match(
    agentHost,
    /statAsTheOsWill\(resolved\)/,
    'normalizeCwd must use the unpatched stat, not fs.statSync directly',
  )
  assert.doesNotMatch(
    agentHost.slice(agentHost.indexOf('function normalizeCwd')),
    /fs\.statSync/,
    'normalizeCwd must not fall back to the asar-patched stat',
  )
})

test('an explicitly configured engine still wins over the shipped payload', () => {
  // A developer pointing MISSION_CONTROL_ENGINE at their own checkout must keep
  // getting that checkout, not the packaged copy -- the same precedence
  // shell/main.cjs applies to MC_BRIDGE_PROOF_FILE. Pinned because the obvious
  // way to add the payload candidate is to put it first, which would silently
  // start ignoring the override.
  //
  // Asserted on the CANDIDATE ORDER, not on engineAvailability(). The resolver
  // walks every candidate and returns the first that WORKS, so when only one of
  // them resolves the order is invisible through availability() -- an earlier
  // version of this test did exactly that and stayed GREEN when the precedence
  // was deliberately reversed. Proven by planting that swap.
  const previous = process.env.MISSION_CONTROL_ENGINE
  process.env.MISSION_CONTROL_ENGINE = resolve(ROOT, 'tools/test/fixtures/agent-engine')
  try {
    const sources = engineCandidates(undefined, { capabilityRoot: '/any/payload/root' }).map((c) => c.source)
    assert.deepEqual(
      sources,
      ['MISSION_CONTROL_ENGINE', 'capability-payload'],
      'the configured engine must be tried before the shipped payload',
    )
  } finally {
    if (previous === undefined) delete process.env.MISSION_CONTROL_ENGINE
    else process.env.MISSION_CONTROL_ENGINE = previous
  }
})
