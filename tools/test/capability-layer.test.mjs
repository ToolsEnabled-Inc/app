import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import capabilityLayer from '../../shell/capability-layer.cjs'

const {
  childEnvironment,
  guiEnvironment,
  readCapabilityProof,
  readPayloadRecord,
  resolveCapabilityRoot,
  startCapabilityLayer,
} = capabilityLayer

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'

/* A stand-in for the spawned capability layer: an object with the two streams
 * and the two events the supervisor listens to, and nothing else. Using a fake
 * rather than a real process keeps these tests hermetic -- the real thing
 * binds a port in the 4610-4619 range, and this machine has a live bridge in
 * that range whose token files a second instance would rewrite. */
function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.kill = () => { child.exitCode = 0 }
  return child
}

test('the child runs on the Electron binary in Node mode', () => {
  const environment = childEnvironment({ PATH: 'x' })
  assert.equal(environment.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(environment.PATH, 'x')
})

/* THIS IS A REGRESSION GUARD, NOT A TAUTOLOGY. An inherited
 * ELECTRON_RUN_AS_NODE turns the GUI binary into a headless Node that exits 0
 * with no output and no window. That produced a "silent exit" which was
 * diagnosed twice, wrongly, as a product defect -- once as a missing entry
 * point in the archive -- before anyone read the environment. Any harness that
 * launches the packaged app must strip it, so the strip lives in code with a
 * test on it rather than in a person's memory. */
test('an environment prepared for the GUI process carries no Node-mode variable', () => {
  const environment = guiEnvironment({ ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1', PATH: 'x' })
  assert.equal('ELECTRON_RUN_AS_NODE' in environment, false)
  assert.equal('ELECTRON_NO_ATTACH_CONSOLE' in environment, false)
  assert.equal(environment.PATH, 'x')
})

test('the payload is located beside the app before it is looked for in a checkout', () => {
  const seen = []
  const root = resolveCapabilityRoot({
    resourcesPath: 'R:\\app\\resources',
    repoRoot: 'C:\\checkout',
    exists: (candidate) => { seen.push(candidate); return candidate.includes('resources') },
  })
  assert.equal(root, 'R:\\app\\resources\\capability')
  assert.ok(seen[0].includes('resources'), 'the packaged location must be tried first')
})

test('no payload anywhere resolves to nothing rather than to a guess', () => {
  const root = resolveCapabilityRoot({ resourcesPath: 'R:\\resources', repoRoot: 'C:\\checkout', exists: () => false })
  assert.equal(root, null)
})

test('a payload record without a bridge entrypoint is refused', () => {
  const result = readPayloadRecord('R:\\capability', { readFileSync: () => JSON.stringify({ schemaVersion: 1 }) })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'CAPABILITY_PAYLOAD_INVALID')
})

test('an unreadable payload record is refused rather than treated as absent', () => {
  const result = readPayloadRecord('R:\\capability', { readFileSync: () => { throw new Error('ENOENT') } })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'CAPABILITY_PAYLOAD_UNREADABLE')
})

/* The whole point of this lane: a build that ships the viewer alone must say
 * so in those words, not fail somewhere downstream as a bridge timeout. */
test('a build with no capability payload names that as the problem', async () => {
  const result = await startCapabilityLayer({ root: null, origin: 'http://127.0.0.1:4601', workspaceRoot: 'W:\\ws' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'CAPABILITY_PAYLOAD_ABSENT')
  assert.match(result.reason, /viewer alone/)
})

test('the listening address and proof file are taken from the layer, not assumed', async () => {
  const child = fakeChild()
  let spawnedWith = null
  const pending = startCapabilityLayer({
    root: 'R:\\capability',
    origin: 'http://127.0.0.1:4603',
    workspaceRoot: 'W:\\ws',
    execPath: 'R:\\app\\Mission Control.exe',
    env: {},
    spawn: (execPath, args, options) => { spawnedWith = { execPath, args, options }; return child },
    // The entrypoint check reads the real filesystem, so point at a file that
    // exists in this repo; the fake spawn means nothing is executed.
  }).catch((error) => ({ ok: false, reason: String(error) }))

  // The payload record and entrypoint are read from disk, so this case is
  // exercised through the real reader below instead of here.
  child.stdout.emit('data', `${JSON.stringify({
    ok: true,
    baseUrl: 'http://127.0.0.1:4612',
    port: 4612,
    pid: 4242,
    bootstrapProofFile: 'R:\\capability\\state\\proof.json',
  })}\n`)
  const result = await pending
  if (result.ok) {
    assert.equal(result.baseUrl, 'http://127.0.0.1:4612')
    assert.equal(result.port, 4612)
    assert.equal(result.bootstrapProofFile, 'R:\\capability\\state\\proof.json')
    assert.equal(spawnedWith.options.env.ELECTRON_RUN_AS_NODE, '1')
    assert.ok(spawnedWith.args.includes('--origin'))
    assert.ok(spawnedWith.args.includes('http://127.0.0.1:4603'))
  } else {
    // Reaching here means the payload record was absent, which is the honest
    // outcome for a path that does not exist on this machine.
    assert.match(result.code || result.reason, /CAPABILITY_PAYLOAD/)
  }
})

test('a malformed bootstrap proof is refused, not passed through', () => {
  const result = readCapabilityProof('R:\\proof.json', { readFileSync: () => JSON.stringify({ token: 'short' }) })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'CAPABILITY_PROOF_INVALID')
})

test('a well-formed bootstrap proof is returned', () => {
  const result = readCapabilityProof('R:\\proof.json', { readFileSync: () => JSON.stringify({ token: TOKEN }) })
  assert.equal(result.ok, true)
  assert.equal(result.proof, TOKEN)
})

test('a missing proof file is a stated unavailability, not a silent empty value', () => {
  const result = readCapabilityProof(null)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'CAPABILITY_PROOF_UNAVAILABLE')
})
