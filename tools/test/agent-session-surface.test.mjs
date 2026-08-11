import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { engineAvailability, engineCandidates } from '../../shell/agent-host.cjs'
import { sessionEventText, sessionTurnStatus } from '../../src/agent-session-events.js'

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

test('availability resolves a real configured engine', () => {
  // Proves the probe answers ok for an engine that genuinely exports the
  // contract, rather than only ever failing closed.
  const previous = process.env.MISSION_CONTROL_ENGINE
  try {
    // A directory, not a file: the resolver appends codex-process.js to any
    // path that does not already end in .js, so the fixture mirrors the real
    // engine's layout rather than working around the resolver.
    const result = engineAvailability({ enginePath: resolve(ROOT, 'tools/test/fixtures/agent-engine') })
    assert.equal(result.ok, true)
    assert.equal(result.code, 'AGENT_ENGINE_READY')
  } finally {
    if (previous === undefined) delete process.env.MISSION_CONTROL_ENGINE
    else process.env.MISSION_CONTROL_ENGINE = previous
  }
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

test('the spawn surface states that no tier restricts a running session', () => {
  // The permission tier is recorded but not enforced against a running child
  // (T5, unbuilt). A spawn control that omitted this would imply a limit the
  // product does not have.
  const surface = read('src/agent-session.js')
  assert.match(surface, /No permission tier limits a running session/)
  assert.match(surface, /UNRESTRICTED_NOTE/, 'the note must be rendered, not only defined')
})

test('the spawn surface states that starts are recorded, and claims no more', () => {
  // The claim must be exactly as strong as the evidence. "Recorded on this
  // device" is true: an app-local signed chain, written before the spawn.
  // Calling it the audit ledger, or implying off-device attestation, would
  // overstate a key that lives on the same machine as the records.
  const surface = read('src/agent-session.js')
  assert.match(surface, /recorded on this device before it runs/)
  assert.doesNotMatch(
    surface.match(/const UNRESTRICTED_NOTE = '[^']*'/)[0],
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

test('availability requires both an engine and a usable recorder', () => {
  // Reporting only the engine would let the surface offer a Start control that
  // the start handler then refuses -- a dead button by a different route.
  const main = read('shell/main.cjs')
  const handler = main.slice(main.indexOf("ipcMain.handle('mc-agent:availability'"))
  assert.match(handler.slice(0, 600), /engineAvailability\(\)/)
  assert.match(handler.slice(0, 600), /spawnRecordAvailability\(\)/)
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
  // no UI sets one, so "start an agent from inside Mission Control" could never
  // work. The engine now ships in the capability payload
  // (tools/capability-manifest.json hostModules) and resolves from the same
  // root shell/setup-record.cjs already uses.
  //
  // The fixture mirrors the payload's real layout rather than working around
  // the resolver, so a change to PAYLOAD_ENGINE_MODULE breaks this test.
  const root = mkdtempSync(join(tmpdir(), 'mc-capability-'))
  try {
    const engineDir = join(root, 'src', 'lib', 'agent-engine')
    mkdirSync(engineDir, { recursive: true })
    copyFileSync(
      resolve(ROOT, 'tools/test/fixtures/agent-engine/codex-process.js'),
      join(engineDir, 'codex-process.js'),
    )

    const previous = process.env.MISSION_CONTROL_ENGINE
    delete process.env.MISSION_CONTROL_ENGINE
    try {
      const result = engineAvailability({ capabilityRoot: root })
      assert.equal(result.ok, true, 'a payload that carries the engine must resolve without any environment variable')
      assert.equal(result.code, 'AGENT_ENGINE_READY')
    } finally {
      if (previous === undefined) delete process.env.MISSION_CONTROL_ENGINE
      else process.env.MISSION_CONTROL_ENGINE = previous
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
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
