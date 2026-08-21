/* THE SHARED AGENT COMMAND SURFACE -- the one module every mc-agent:* and
 * mc-org:* body lives in, so the Electron IPC handlers and the relay facade
 * docs/relay-agent-facade-DESIGN.md names cannot drift apart.
 *
 * WHAT THIS PROVES, per command, against FAKE dependencies (the module never
 * imports electron, which is the whole reason it can be exercised here):
 *
 *   1. INVENTORY, fail-closed. The thirty channel names are read out of
 *      shell/main.cjs's ipcMain.handle() registrations, never typed here, and
 *      every one must be a command the surface knows -- and every surface
 *      command must be a channel main.cjs registers and forwards to it by
 *      name. A handler added to one side and not the other fails the suite;
 *      it never skips.
 *   2. THE WINDOW PRINCIPAL BEHAVES AS THE HANDLERS DID: same dependency
 *      called with the same shaped arguments, same refusal codes, same order
 *      of checks -- including MC_AGENT_UNKNOWN_SESSION when the session
 *      belongs to another owner, and the image fence at send.
 *   3. mayWrite:false REFUSES EVERY WRITE with MC_AGENT_PRINCIPAL_READ_ONLY
 *      before any dependency is touched, and every read still answers exactly
 *      as it does for the window.
 *   4. A PRINCIPAL THAT IS NOT THE WINDOW IS REFUSED EVERY DIALOG -- the
 *      attachment picker, the mention picker, profile creation -- and the
 *      dialog is never opened.
 *   5. CONSTRUCTION FAILS CLOSED: a missing dependency refuses the surface at
 *      construction, not a command later. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const surfaceModule = require('../../shell/agent-command-surface.cjs')
const {
  createAgentCommandSurface,
  COMMANDS,
  REQUIRED_DEPS,
  READ_ONLY_REFUSAL,
  DIALOG_REFUSAL,
  PRINCIPAL_REFUSAL,
  UNKNOWN_COMMAND_REFUSAL,
} = surfaceModule

const MAIN = readFileSync(new URL('../../shell/main.cjs', import.meta.url), 'utf8')
const SURFACE_SOURCE = readFileSync(new URL('../../shell/agent-command-surface.cjs', import.meta.url), 'utf8')

/* ---------- the inventory, derived from main.cjs ---------- */

/* Every `ipcMain.handle('mc-agent:<name>'` and `ipcMain.handle('mc-org:<name>'`
   in main.cjs, mapped to the surface's command vocabulary. */
function channelsRegisteredInMain() {
  const found = []
  for (const match of MAIN.matchAll(/ipcMain\.handle\('mc-(agent|org):([a-z-]+)'/g)) {
    found.push({ channel: `mc-${match[1]}:${match[2]}`, command: `${match[1]}:${match[2]}`, at: match.index })
  }
  return found
}

test('main.cjs registers exactly the thirty agent and org channels this suite is about', () => {
  const channels = channelsRegisteredInMain()
  assert.equal(channels.length, 30, `expected 30 channels, main.cjs registers ${channels.length}: ${channels.map(c => c.channel).join(', ')}`)
  assert.equal(new Set(channels.map(c => c.channel)).size, 30, 'a channel is registered twice')
})

test('every channel main.cjs registers is a command the surface holds, and vice versa -- absence fails', () => {
  const channels = channelsRegisteredInMain()
  const surface = createAgentCommandSurface(fakeDeps())
  const known = new Set(surface.commands)
  for (const { channel, command } of channels) {
    assert.ok(known.has(command), `${channel} is registered in main.cjs but the surface has no '${command}' body`)
    assert.ok(Object.hasOwn(COMMANDS, command), `${command} is missing from the COMMANDS inventory`)
  }
  const registered = new Set(channels.map(c => c.command))
  for (const command of surface.commands) {
    assert.ok(registered.has(command), `the surface holds '${command}' but main.cjs registers no channel for it`)
  }
  assert.equal(surface.commands.length, 30)
})

test('every main.cjs wrapper forwards its own channel name to the surface, behind the Electron frame check', () => {
  const channels = channelsRegisteredInMain()
  for (const { channel, command, at } of channels) {
    /* The wrapper ends at the first close that returns to column zero. */
    const end = MAIN.indexOf(channel.startsWith('mc-org:') ? '\n' : '\n})', at)
    const wrapper = MAIN.slice(at, MAIN.indexOf('\n\n', at))
    assert.match(wrapper, new RegExp(`\\.run\\('${command.replace(/[-]/g, '\\-')}',`),
      `${channel} does not dispatch '${command}' through the shared surface`)
    assert.match(wrapper, /windowPrincipal\(event\)/, `${channel} does not build the window principal`)
    if (channel.startsWith('mc-agent:')) {
      assert.match(wrapper, /assertTrustedAgentSender\(event\)/, `${channel} skips the Electron frame check`)
    } else {
      assert.match(wrapper, /withFleetProfileSender\(event/, `${channel} skips the fleet-profile sender envelope`)
    }
    assert.ok(end > at)
  }
})

test('the surface never imports electron', () => {
  assert.doesNotMatch(SURFACE_SOURCE, /require\(['"]electron['"]\)/, 'the surface must stay free of electron so it can be tested and so a dialog can be refused')
})

/* ---------- fakes that behave like main.cjs's own helpers ---------- */

function agentIpcError(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function rendererSafeAgentError(error) {
  const code = typeof error?.code === 'string' && error.code.length > 0 && error.code.length <= 128
    ? error.code
    : 'AGENT_SESSION_FAILED'
  const safe = new Error(code)
  safe.code = code
  return safe
}

function agentPayload(value, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    agentIpcError('MC_AGENT_INVALID_PAYLOAD', 'Agent IPC payload must be an object')
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) agentIpcError('MC_AGENT_INVALID_PAYLOAD', 'Unexpected agent IPC field: ' + key)
  }
  return value
}

function boundedAgentString(value, name, maxLength) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || value.includes('\0')) {
    agentIpcError('MC_AGENT_INVALID_PAYLOAD', name + ' must be a non-empty string of at most ' + maxLength + ' characters')
  }
  return value
}

const MAX_SESSION_ID_LENGTH = 128
const AGENT_EFFORT_VALUES = Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])

function parseAgentStart(value) {
  const payload = agentPayload(value, ['sessionId', 'cwd', 'surface', 'tier', 'effort', 'profileId', 'resumeThreadId', 'requestKeys'])
  const result = { sessionId: boundedAgentString(payload.sessionId ?? 'chat-generated', 'sessionId', MAX_SESSION_ID_LENGTH) }
  if (payload.cwd !== undefined) agentIpcError('MC_AGENT_CWD_NOT_YOURS', 'A working folder cannot be sent with a start.')
  if (payload.tier !== undefined) result.tier = boundedAgentString(payload.tier, 'tier', 64)
  if (payload.profileId !== undefined) result.profileId = boundedAgentString(payload.profileId, 'profileId', 128)
  return result
}

function parseAgentSend(value) {
  const payload = agentPayload(value, ['sessionId', 'text', 'model', 'images'])
  const request = {
    sessionId: boundedAgentString(payload.sessionId, 'sessionId', MAX_SESSION_ID_LENGTH),
    text: boundedAgentString(payload.text, 'text', 200_000),
  }
  if (payload.model !== undefined) request.model = boundedAgentString(payload.model, 'model', 128)
  if (payload.images !== undefined) {
    if (!Array.isArray(payload.images) || payload.images.length > 8) agentIpcError('MC_AGENT_INVALID_PAYLOAD', 'images')
    request.images = payload.images.map(image => ({ path: boundedAgentString(image && image.path, 'image path', 32768) }))
  }
  return request
}

function parseAgentSessionCommand(value) {
  const payload = agentPayload(value, ['sessionId'])
  return { sessionId: boundedAgentString(payload.sessionId, 'sessionId', MAX_SESSION_ID_LENGTH) }
}

/* Every dependency, with a call log, so a test can assert WHAT was touched and
   in WHAT ORDER -- and that a refused command touched nothing. */
function fakeDeps(overrides = {}) {
  const calls = []
  const note = (name, ...args) => { calls.push({ name, args }) }
  const host = {
    startSession: async (request) => { note('startSession', request); return { sessionId: request.sessionId, threadId: 'thread-1', tier: 'unrestricted', effort: 'medium', account: 'acct-1' } },
    sendTurn: async (request) => { note('sendTurn', request); return { sessionId: request.sessionId, threadId: 'thread-1', turnId: 'turn-1' } },
    interrupt: async (request) => { note('interrupt', request); return { sessionId: request.sessionId, turnId: 'turn-1' } },
    answerApproval: async (request) => { note('answerApproval', request); return { ...request } },
    rewindSession: async (request) => { note('rewindSession', request); return { ...request, threadId: 'thread-2' } },
    setSessionEffort: async (request) => { note('setSessionEffort', request); return { ...request } },
    listEngineModels: async (request) => { note('listEngineModels', request); return { ok: true, models: [] } },
    closeSession: async (request) => { note('closeSession', request); return { sessionId: request.sessionId, closed: true } },
    startableTiers: () => { note('startableTiers'); return { ok: true, tiers: ['luna'] } },
    fileStandingRequest: async (request) => { note('fileStandingRequest', request); return { ok: true, id: 'r-1', ...request } },
  }
  const agentSessions = new Map()
  let sequence = 100
  const deps = {
    agentSessions,
    currentAgentHost: () => host,
    getAgentHost: () => { note('getAgentHost'); return host },
    agentIpcError,
    agentPayload,
    boundedAgentString,
    parseAgentStart,
    parseAgentSend,
    parseAgentSessionCommand,
    rendererSafeAgentError,
    spawnRecordAvailability: () => { note('spawnRecordAvailability'); return { ok: true } },
    spawnRecordHistory: (limit) => { note('spawnRecordHistory', limit); return { ok: true, total: 0, entries: [], limit } },
    usageRecordHistory: (limit) => { note('usageRecordHistory', limit); return { ok: true, total: 0, entries: [], limit } },
    engineAvailability: (options) => { note('engineAvailability', options); return { ok: true, code: 'AGENT_ENGINE_READY' } },
    ensureWorkspaceRoot: () => { note('ensureWorkspaceRoot'); return 'C:\\fake\\workspace' },
    chosenWorkspaceCwd: () => { note('chosenWorkspaceCwd'); return null },
    readAgentConfinement: (options) => { note('readAgentConfinement', options); return { ok: true, tier: 'guided' } },
    listAgentTools: (options) => { note('listAgentTools', options); return { ok: true, tier: 'guided', total: 0, tools: [] } },
    resolveCapabilityRoot: () => { note('resolveCapabilityRoot'); return 'C:\\fake\\capability' },
    requireModule: (file) => { note('requireModule', file); return { ownerJournal: async ({ limit }) => ({ ok: true, messages: [], limit }) } },
    readStandingRequests: (request) => { note('readStandingRequests', request); return { ok: true, exists: false, entries: [] } },
    sessionProfiles: {
      list: () => { note('profiles.list'); return [{ id: 'p1', name: 'one' }] },
      create: (request) => { note('profiles.create', request); return { id: 'p2', ...request } },
      remove: (id) => { note('profiles.remove', id); return true },
      resolveCwd: (id) => { note('profiles.resolveCwd', id); if (id === 'missing') { const e = new Error('gone'); e.code = 'PROFILE_UNKNOWN'; throw e } return 'C:\\fake\\profile\\' + id },
    },
    recordSpawnIntent: (request) => { note('recordSpawnIntent', request); sequence += 1; return { sequence, eventHash: 'hash-' + sequence, durable: true, signed: true } },
    recordSpawnOutcome: (request, receipt, result, reason) => { note('recordSpawnOutcome', request, receipt, result, reason) },
    recordSessionEnd: (session, sessionId, reason) => { note('recordSessionEnd', sessionId, reason); session.ended = true },
    bindAgentOwner: (owner) => { note('bindAgentOwner', owner) },
    agentOrgRecord: {
      read: () => { note('org.read'); return { ok: true, org: {}, roles: [] } },
      reparent: (r) => { note('org.reparent', r); return { ok: true, org: {} } },
      assignRole: (r) => { note('org.assignRole', r); return { ok: true, org: {} } },
      createRole: (r) => { note('org.createRole', r); return { ok: true, roles: [] } },
      editRole: (r) => { note('org.editRole', r); return { ok: true, roles: [] } },
      resetRole: (r) => { note('org.resetRole', r); return { ok: true, roles: [] } },
      resetOrg: () => { note('org.resetOrg'); return { ok: true, org: {} } },
      exportOrg: () => { note('org.exportOrg'); return { ok: true, document: {} } },
    },
    dialog: {
      showOpenDialog: async (options) => { note('showOpenDialog', options); return { canceled: false, filePaths: ['C:\\fake\\picked.png'] } },
    },
    MAX_AGENT_SESSIONS: 8,
    MAX_SESSION_ID_LENGTH,
    AGENT_EFFORT_VALUES,
    WORKSPACE_ROOT: 'C:\\fake\\workspace',
    ...overrides,
  }
  return Object.assign(deps, { calls, host, names: () => calls.map(c => c.name) })
}

const WINDOW_OWNER = { id: 'webContents-1' }
const OTHER_OWNER = { id: 'webContents-2' }
const window = Object.freeze({ kind: 'window', owner: WINDOW_OWNER, mayWrite: true, label: 'the application window' })
const otherWindow = Object.freeze({ kind: 'window', owner: OTHER_OWNER, mayWrite: true, label: 'another window' })
const readOnly = Object.freeze({ kind: 'window', owner: WINDOW_OWNER, mayWrite: false, label: 'a read-only caller' })
/* A principal that is NOT at the keyboard. Its kind is deliberately not
   'relay' -- no relay principal exists yet and this suite does not invent one;
   the surface's rule is "not the window", whatever the other kind is called. */
const elsewhere = Object.freeze({ kind: 'elsewhere', owner: { id: 'remote-1' }, mayWrite: true, label: 'a caller that is not at the keyboard' })

async function refusal(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  assert.fail('expected a refusal')
}

/* A session owned by the window, as start leaves it. */
async function startedSession(deps, surface, sessionId = 'chat-1', principal = window) {
  const result = await surface.run('agent:start', { sessionId }, principal)
  deps.calls.length = 0
  return result
}

/* ---------- construction fails closed ---------- */

test('a missing dependency refuses construction, by name', () => {
  for (const name of Object.keys(REQUIRED_DEPS)) {
    const deps = fakeDeps()
    delete deps[name]
    assert.throws(() => createAgentCommandSurface(deps), new RegExp(name), `construction proceeded without ${name}`)
  }
  assert.throws(() => createAgentCommandSurface(), /explicit deps/)
  assert.throws(() => createAgentCommandSurface(fakeDeps({ dialog: {} })), /showOpenDialog/)
})

test('an unknown command and an unshaped principal are refused before anything runs', async () => {
  const deps = fakeDeps()
  const surface = createAgentCommandSurface(deps)
  assert.equal((await refusal(surface.run('agent:nope', {}, window))).code, UNKNOWN_COMMAND_REFUSAL)
  for (const bad of [null, undefined, {}, { kind: 'window' }, { kind: 'window', owner: WINDOW_OWNER }, { kind: 'window', owner: WINDOW_OWNER, mayWrite: 'yes', label: 'x' }, { kind: 'window', owner: null, mayWrite: true, label: 'x' }]) {
    assert.equal((await refusal(surface.run('agent:history', {}, bad))).code, PRINCIPAL_REFUSAL)
  }
  assert.deepEqual(deps.names(), [], 'a refused call touched a dependency')
})

/* ---------- the window principal, command by command ---------- */

test('availability: the recorder is asked first, then the engine about the prepared workspace', async () => {
  const deps = fakeDeps()
  const surface = createAgentCommandSurface(deps)
  const answer = await surface.run('agent:availability', undefined, window)
  assert.deepEqual(answer, { ok: true, code: 'AGENT_ENGINE_READY' })
  assert.deepEqual(deps.names(), ['spawnRecordAvailability', 'ensureWorkspaceRoot', 'engineAvailability'])
  assert.deepEqual(deps.calls[2].args[0], { defaultCwd: 'C:\\fake\\workspace' })

  const refused = fakeDeps({ spawnRecordAvailability: () => ({ ok: false, code: 'SPAWN_RECORD_UNAVAILABLE' }) })
  const answer2 = await createAgentCommandSurface(refused).run('agent:availability', {}, window)
  assert.deepEqual(answer2, { ok: false, code: 'SPAWN_RECORD_UNAVAILABLE' })
  assert.ok(!refused.names().includes('engineAvailability'), 'the engine was asked after the recorder refused')
  assert.equal((await refusal(surface.run('agent:availability', { extra: 1 }, window))).code, 'MC_AGENT_INVALID_PAYLOAD')
})

test('confinement and tools read through the capability root', async () => {
  const deps = fakeDeps()
  const surface = createAgentCommandSurface(deps)
  assert.deepEqual(await surface.run('agent:confinement', undefined, window), { ok: true, tier: 'guided' })
  assert.deepEqual(deps.calls.at(-1), { name: 'readAgentConfinement', args: [{ capabilityRoot: 'C:\\fake\\capability' }] })
  assert.deepEqual(await surface.run('agent:tools', undefined, window), { ok: true, tier: 'guided', total: 0, tools: [] })
  assert.deepEqual(deps.calls.at(-1), { name: 'listAgentTools', args: [{ capabilityRoot: 'C:\\fake\\capability' }] })
})

test('local-messages bounds the limit, loads the journal from the engine root, and degrades honestly', async () => {
  const deps = fakeDeps()
  const surface = createAgentCommandSurface(deps)
  assert.deepEqual(await surface.run('agent:local-messages', { limit: 5000 }, window), { ok: true, messages: [], limit: 200 })
  assert.deepEqual(await surface.run('agent:local-messages', { limit: 0 }, window), { ok: true, messages: [], limit: 1 })
  assert.deepEqual(await surface.run('agent:local-messages', undefined, window), { ok: true, messages: [], limit: 100 })
  assert.match(deps.calls.find(c => c.name === 'requireModule').args[0], /agent-comms-local\.js$/)
  const absent = createAgentCommandSurface(fakeDeps({ resolveCapabilityRoot: () => null }))
  assert.deepEqual(await absent.run('agent:local-messages', {}, window), { ok: false, reason: 'the live message reader is not available in this build' })
  const broken = createAgentCommandSurface(fakeDeps({ requireModule: () => { throw new Error('C:\\secret\\path') } }))
  assert.deepEqual(await broken.run('agent:local-messages', {}, window), { ok: false, reason: 'the live message reader is not available in this build' })
})

test('startable-tiers builds the host and asks it', async () => {
  const deps = fakeDeps()
  const surface = createAgentCommandSurface(deps)
  assert.deepEqual(await surface.run('agent:startable-tiers', undefined, window), { ok: true, tiers: ['luna'] })
  assert.deepEqual(deps.names(), ['getAgentHost', 'startableTiers'])
})

test('history and usage pass the bounded limit to their recorder and nothing else', async () => {
  const deps = fakeDeps()
  const surface = createAgentCommandSurface(deps)
  assert.deepEqual(await surface.run('agent:history', { limit: 7 }, window), { ok: true, total: 0, entries: [], limit: 7 })
  assert.deepEqual(await surface.run('agent:history', null, window), { ok: true, total: 0, entries: [], limit: undefined })
  assert.deepEqual(await surface.run('agent:usage', { limit: 3 }, window), { ok: true, total: 0, entries: [], limit: 3 })
  assert.deepEqual(deps.names(), ['spawnRecordHistory', 'spawnRecordHistory', 'usageRecordHistory'])
  assert.equal((await refusal(surface.run('agent:history', { scope: 'x' }, window))).code, 'MC_AGENT_INVALID_PAYLOAD')
  for (const forbidden of ['startSession', 'sendTurn', 'getAgentHost', 'recordSpawnIntent']) {
    assert.ok(!deps.names().includes(forbidden), `a read channel touched ${forbidden}`)
  }
})

test('start: records BEFORE it spawns, owns the session by the principal, and carries the receipt back', async () => {
  const deps = fakeDeps()
  const surface = createAgentCommandSurface(deps)
  const result = await surface.run('agent:start', { sessionId: 'chat-1', tier: 'luna' }, window)
  assert.deepEqual(result, {
    sessionId: 'chat-1', threadId: 'thread-1', tier: 'unrestricted', effort: 'medium', account: 'acct-1',
    record: { sequence: 101, eventHash: 'hash-101' },
  })
  const names = deps.names()
  assert.ok(names.indexOf('recordSpawnIntent') < names.indexOf('startSession'), 'the record is written first')
  assert.ok(names.indexOf('chosenWorkspaceCwd') < names.indexOf('recordSpawnIntent'), 'the chosen folder is resolved before the record')
  assert.equal(names.filter(n => n === 'startSession').length, 1, 'exactly one spawn')
  assert.deepEqual(deps.calls.find(c => c.name === 'bindAgentOwner').args, [WINDOW_OWNER])
  const session = deps.agentSessions.get('chat-1')
  assert.equal(session.owner, WINDOW_OWNER)
  assert.equal(session.state, 'ready')
  assert.equal(session.tier, 'luna', 'the MODEL ROW the person chose, not the confinement level')
  assert.equal(session.account, 'acct-1')
  assert.deepEqual(session.started, { sequence: 101 })
  assert.equal(session.turnsCompleted, 0)
  const outcome = deps.calls.find(c => c.name === 'recordSpawnOutcome')
  assert.equal(outcome.args[2], 'started')
})

test('start: a profile is resolved in the main process, a missing one refuses by name, and cwd falls back to the chosen workspace', async () => {
  const deps = fakeDeps({ chosenWorkspaceCwd: () => 'C:\\fake\\chosen' })
  const surface = createAgentCommandSurface(deps)
  await surface.run('agent:start', { sessionId: 'a', profileId: 'p1' }, window)
  const spawned = deps.calls.find(c => c.name === 'startSession').args[0]
  assert.equal(spawned.cwd, 'C:\\fake\\profile\\p1')
  assert.equal(spawned.profileId, undefined, 'profileId does not reach the host')
  await surface.run('agent:start', { sessionId: 'b' }, window)
  assert.equal(deps.calls.filter(c => c.name === 'startSession')[1].args[0].cwd, 'C:\\fake\\chosen')
  const refused = await refusal(surface.run('agent:start', { sessionId: 'c', profileId: 'missing' }, window))
  assert.equal(refused.code, 'MC_AGENT_PROFILE_UNKNOWN')
  assert.ok(!deps.agentSessions.has('c'))
  assert.equal((await refusal(surface.run('agent:start', { sessionId: 'd', cwd: 'C:\\anywhere' }, window))).code, 'MC_AGENT_CWD_NOT_YOURS')
})

test('start: an existing session and the session limit refuse before anything is recorded', async () => {
  const deps = fakeDeps({ MAX_AGENT_SESSIONS: 2 })
  const surface = createAgentCommandSurface(deps)
  await surface.run('agent:start', { sessionId: 'one' }, window)
  deps.calls.length = 0
  assert.equal((await refusal(surface.run('agent:start', { sessionId: 'one' }, window))).code, 'MC_AGENT_SESSION_EXISTS')
  assert.ok(!deps.names().includes('recordSpawnIntent'))
  await surface.run('agent:start', { sessionId: 'two' }, window)
  deps.calls.length = 0
  assert.equal((await refusal(surface.run('agent:start', { sessionId: 'three' }, window))).code, 'MC_AGENT_SESSION_LIMIT')
  assert.ok(!deps.names().includes('recordSpawnIntent'))
})

test('start: a refused spawn is recorded as refused, leaves no session, and crosses as a renderer-safe code', async () => {
  const deps = fakeDeps()
  deps.host.startSession = async () => { const e = new Error('Unable to run codex: C:\\secret\\engine'); e.code = 'AGENT_ENGINE_MISSING'; throw e }
  const surface = createAgentCommandSurface(deps)
  const refused = await refusal(surface.run('agent:start', { sessionId: 'x' }, window))
  assert.equal(refused.code, 'AGENT_ENGINE_MISSING')
  assert.equal(refused.message, 'AGENT_ENGINE_MISSING', 'the message IS the code; the engine prose stays behind')
  assert.ok(!deps.agentSessions.has('x'))
  const outcome = deps.calls.find(c => c.name === 'recordSpawnOutcome')
  assert.deepEqual([outcome.args[2], outcome.args[3]], ['refused', 'AGENT_ENGINE_MISSING'])

  const cleanup = fakeDeps()
  cleanup.host.startSession = async () => { const e = new Error('x'); e.code = 'AGENT_SESSION_CLEANUP_FAILED'; throw e }
  await refusal(createAgentCommandSurface(cleanup).run('agent:start', { sessionId: 'y' }, window))
  assert.equal(cleanup.agentSessions.get('y').state, 'close-failed', 'a session whose child could not be cleaned up stays in the map, marked')
})

test('start: a record that cannot be written means no spawn', async () => {
  const deps = fakeDeps({ recordSpawnIntent: () => agentIpcError('MC_AGENT_RECORD_UNAVAILABLE', 'not durable') })
  const surface = createAgentCommandSurface(deps)
  assert.equal((await refusal(surface.run('agent:start', { sessionId: 'z' }, window))).code, 'MC_AGENT_RECORD_UNAVAILABLE')
  assert.ok(!deps.names().includes('startSession'))
  assert.ok(!deps.agentSessions.has('z'))
})

test('send: owned sessions only, and only picked images ride', async () => {
  const deps = fakeDeps()
  const surface = createAgentCommandSurface(deps)
  await startedSession(deps, surface)
  assert.deepEqual(await surface.run('agent:send', { sessionId: 'chat-1', text: 'hello', model: 'm1' }, window),
    { sessionId: 'chat-1', threadId: 'thread-1', turnId: 'turn-1' })
  assert.deepEqual(deps.calls.at(-1).args[0], { sessionId: 'chat-1', text: 'hello', options: { model: 'm1' } })

  /* Another owner: the SAME code the window got before the extraction. */
  const foreign = await refusal(surface.run('agent:send', { sessionId: 'chat-1', text: 'hi' }, otherWindow))
  assert.equal(foreign.code, 'MC_AGENT_UNKNOWN_SESSION')
  assert.equal(foreign.message, 'MC_AGENT_UNKNOWN_SESSION', 'renderer-safe: the sessionId prose stays behind')
  assert.equal((await refusal(surface.run('agent:send', { sessionId: 'nope', text: 'hi' }, window))).code, 'MC_AGENT_UNKNOWN_SESSION')

  /* THE IMAGE FENCE. Unpicked refuses by name and nothing is sent. */
  deps.calls.length = 0
  const unpicked = await refusal(surface.run('agent:send', { sessionId: 'chat-1', text: 'look', images: [{ path: 'C:\\anything.png' }] }, window))
  assert.equal(unpicked.code, 'MC_AGENT_ATTACHMENT_UNKNOWN')
  assert.ok(!deps.names().includes('sendTurn'), 'an unpicked image reached the engine')

  /* Picked in THIS session by THIS owner's dialog: rides. */
  await surface.run('agent:pick-attachment', { sessionId: 'chat-1' }, window)
  deps.calls.length = 0
  await surface.run('agent:send', { sessionId: 'chat-1', text: 'look', images: [{ path: 'C:\\fake\\picked.png' }] }, window)
  assert.deepEqual(deps.calls.at(-1).args[0], { sessionId: 'chat-1', text: 'look', images: [{ path: 'C:\\fake\\picked.png' }] })

  /* Picked in ANOTHER session: refused -- the allowlist is per session. */
  await startedSession(deps, surface, 'chat-2')
  assert.equal((await refusal(surface.run('agent:send', { sessionId: 'chat-2', text: 'look', images: [{ path: 'C:\\fake\\picked.png' }] }, window))).code, 'MC_AGENT_ATTACHMENT_UNKNOWN')
})

test('request files through the host; requests reads the ledger without a host', async () => {
  const deps = fakeDeps()
  const surface = createAgentCommandSurface(deps)
  const filed = await surface.run('agent:request', { scope: 'tree', key: 'k1', words: 'do this' }, window)
  assert.deepEqual(filed, { ok: true, id: 'r-1', scope: 'tree', key: 'k1', words: 'do this' })
  assert.deepEqual(deps.names(), ['getAgentHost', 'fileStandingRequest'])
  await surface.run('agent:request', { scope: 'tree', words: 'no key' }, window)
  assert.equal(deps.calls.at(-1).args[0].key, null)
  assert.equal((await refusal(surface.run('agent:request', { scope: 'tree', words: 'x'.repeat(16 * 1024 + 1) }, window))).code, 'MC_AGENT_INVALID_PAYLOAD')

  deps.calls.length = 0
  assert.deepEqual(await surface.run('agent:requests', { scope: 'tree', key: 'k1' }, window), { ok: true, exists: false, entries: [] })
  assert.deepEqual(deps.names(), ['readStandingRequests'])
  assert.deepEqual(deps.calls[0].args[0], { scope: 'tree', key: 'k1' })
  assert.equal((await refusal(surface.run('agent:requests', undefined, window))).code, 'MC_AGENT_INVALID_PAYLOAD', 'scope is required')
})

test('profiles: list, create through the dialog, remove', async () => {
  const deps = fakeDeps()
  const surface = createAgentCommandSurface(deps)
  assert.deepEqual(await surface.run('agent:profiles', undefined, window), { ok: true, profiles: [{ id: 'p1', name: 'one' }] })
  assert.deepEqual(await surface.run('agent:profile-create', { name: 'work' }, window), { ok: true, profile: { id: 'p2', name: 'work', cwd: 'C:\\fake\\picked.png' } })
  assert.deepEqual(deps.calls.find(c => c.name === 'showOpenDialog').args[0], { title: 'Choose the folder agents in this profile work in', properties: ['openDirectory'] })
  const cancelled = createAgentCommandSurface(fakeDeps({ dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) } }))
  assert.deepEqual(await cancelled.run('agent:profile-create', { name: 'work' }, window), { ok: true, profile: null })
  assert.deepEqual(await surface.run('agent:profile-remove', { profileId: 'p1' }, window), { ok: true, removed: true })
  assert.deepEqual(deps.calls.at(-1), { name: 'profiles.remove', args: ['p1'] })
  assert.equal((await refusal(surface.run('agent:profile-remove', { id: 'p1' }, window))).code, 'MC_AGENT_INVALID_PAYLOAD')
})

test('pick-attachment issues into the owning session only; pick-mention issues nothing', async () => {
  const deps = fakeDeps()
  const surface = createAgentCommandSurface(deps)
  await startedSession(deps, surface)
  assert.deepEqual(await surface.run('agent:pick-attachment', { sessionId: 'chat-1' }, window), { ok: true, path: 'C:\\fake\\picked.png' })
  assert.deepEqual([...deps.agentSessions.get('chat-1').attachments], ['C:\\fake\\picked.png'])
  assert.equal((await refusal(surface.run('agent:pick-attachment', { sessionId: 'chat-1' }, otherWindow))).code, 'MC_AGENT_UNKNOWN_SESSION')
  assert.equal(deps.names().filter(n => n === 'showOpenDialog').length, 1, 'the dialog opened for a caller that does not own the session')

  deps.calls.length = 0
  assert.deepEqual(await surface.run('agent:pick-mention', { sessionId: 'chat-1' }, window), { ok: true, path: 'C:\\fake\\picked.png' })
  assert.equal(deps.calls.find(c => c.name === 'showOpenDialog').args[0].defaultPath, 'C:\\fake\\workspace')
  assert.deepEqual([...deps.agentSessions.get('chat-1').attachments], ['C:\\fake\\picked.png'], 'a mention issued an attachment right')
  assert.equal((await refusal(surface.run('agent:pick-mention', { sessionId: 'chat-1' }, otherWindow))).code, 'MC_AGENT_UNKNOWN_SESSION')
})

test('interrupt, approval-answer, rewind, effort and close drive only an owned session', async () => {
  const deps = fakeDeps()
  const surface = createAgentCommandSurface(deps)
  await startedSession(deps, surface)
  const drives = [
    ['agent:interrupt', { sessionId: 'chat-1' }, 'interrupt', { sessionId: 'chat-1' }],
    ['agent:approval-answer', { sessionId: 'chat-1', approvalId: 'ap-1', decision: 'approve' }, 'answerApproval', { sessionId: 'chat-1', approvalId: 'ap-1', decision: 'approve' }],
    ['agent:rewind', { sessionId: 'chat-1', turnId: 'turn-1' }, 'rewindSession', { sessionId: 'chat-1', turnId: 'turn-1' }],
    ['agent:effort', { sessionId: 'chat-1', effort: 'high' }, 'setSessionEffort', { sessionId: 'chat-1', effort: 'high' }],
  ]
  for (const [command, payload, hostCall, expected] of drives) {
    deps.calls.length = 0
    await surface.run(command, payload, window)
    assert.deepEqual(deps.calls.at(-1), { name: hostCall, args: [expected] }, command)
    deps.calls.length = 0
    assert.equal((await refusal(surface.run(command, payload, otherWindow))).code, 'MC_AGENT_UNKNOWN_SESSION', command)
    assert.deepEqual(deps.names(), [], `${command} touched the host for a session the caller does not own`)
  }
  assert.equal((await refusal(surface.run('agent:effort', { sessionId: 'chat-1', effort: 'banana' }, window))).code, 'MC_AGENT_EFFORT_UNKNOWN')

  deps.calls.length = 0
  const closed = await surface.run('agent:close', { sessionId: 'chat-1' }, window)
  assert.deepEqual(closed, { sessionId: 'chat-1', closed: true })
  assert.deepEqual(deps.names(), ['closeSession', 'recordSessionEnd'], 'closed is recorded AFTER the close resolves')
  assert.deepEqual(deps.calls[1].args, ['chat-1', 'closed'])
  assert.ok(!deps.agentSessions.has('chat-1'), 'and the session leaves the map')

  /* A close that rejects leaves the session and writes no ending. */
  await startedSession(deps, surface, 'chat-3')
  deps.host.closeSession = async () => { const e = new Error('x'); e.code = 'AGENT_CLOSE_FAILED'; throw e }
  assert.equal((await refusal(surface.run('agent:close', { sessionId: 'chat-3' }, window))).code, 'AGENT_CLOSE_FAILED')
  assert.ok(deps.agentSessions.has('chat-3'))
  assert.ok(!deps.names().includes('recordSessionEnd'))
})

test('models: a named session must be owned; no session asks the engine catalog outright', async () => {
  const deps = fakeDeps()
  const surface = createAgentCommandSurface(deps)
  await startedSession(deps, surface)
  await surface.run('agent:models', undefined, window)
  assert.deepEqual(deps.calls.at(-1), { name: 'listEngineModels', args: [{}] })
  await surface.run('agent:models', { sessionId: 'chat-1' }, window)
  assert.deepEqual(deps.calls.at(-1), { name: 'listEngineModels', args: [{ sessionId: 'chat-1' }] })
  assert.equal((await refusal(surface.run('agent:models', { sessionId: 'chat-1' }, otherWindow))).code, 'MC_AGENT_UNKNOWN_SESSION')
  /* No host yet: the same TypeError-turned-AGENT_SESSION_FAILED the handler raised. */
  const hostless = createAgentCommandSurface(fakeDeps({ currentAgentHost: () => null }))
  assert.equal((await refusal(hostless.run('agent:models', {}, window))).code, 'AGENT_SESSION_FAILED')
})

test('org: each command shapes its arguments exactly as the handler did and answers the record verbatim', async () => {
  const deps = fakeDeps()
  const surface = createAgentCommandSurface(deps)
  const cases = [
    ['org:read', undefined, 'org.read', []],
    ['org:reparent', { agentId: 7, parentId: undefined, expectedRevision: 3 }, 'org.reparent', [{ agentId: '7', parentId: null, expectedRevision: 3 }]],
    ['org:reparent', { agentId: 'a', parentId: 9 }, 'org.reparent', [{ agentId: 'a', parentId: '9', expectedRevision: undefined }]],
    ['org:assign-role', { agentId: 'a', role: 'lead', expectedRevision: 1 }, 'org.assignRole', [{ agentId: 'a', role: 'lead', expectedRevision: 1 }]],
    ['org:assign-role', null, 'org.assignRole', [{ agentId: '', role: '', expectedRevision: undefined }]],
    ['org:create-role', { id: 'r', baseDefaultRole: '', rules: ['x'] }, 'org.createRole', [{ id: 'r', baseDefaultRole: null, rules: ['x'] }]],
    ['org:create-role', { id: 'r', baseDefaultRole: 'worker', rules: ['x'] }, 'org.createRole', [{ id: 'r', baseDefaultRole: 'worker', rules: ['x'] }]],
    ['org:edit-role', { id: 'r', rules: ['y'] }, 'org.editRole', [{ id: 'r', rules: ['y'] }]],
    ['org:reset-role', { id: 'r' }, 'org.resetRole', [{ id: 'r' }]],
    ['org:reset', undefined, 'org.resetOrg', []],
    ['org:export', undefined, 'org.exportOrg', []],
  ]
  for (const [command, payload, recordCall, expectedArgs] of cases) {
    deps.calls.length = 0
    const answer = await surface.run(command, payload, window)
    assert.equal(answer.ok, true, command)
    assert.deepEqual(deps.calls, [{ name: recordCall, args: expectedArgs }], command)
  }
})

/* ---------- the read-only principal ---------- */

test('mayWrite:false refuses every write with the documented code before touching anything, and every read still answers', async () => {
  const deps = fakeDeps()
  const surface = createAgentCommandSurface(deps)
  await startedSession(deps, surface)
  await surface.run('agent:pick-attachment', { sessionId: 'chat-1' }, window)
  const payloads = {
    'agent:availability': undefined,
    'agent:confinement': undefined,
    'agent:tools': undefined,
    'agent:local-messages': { limit: 5 },
    'agent:startable-tiers': undefined,
    'agent:history': { limit: 2 },
    'agent:usage': { limit: 2 },
    'agent:start': { sessionId: 'ro-1' },
    'agent:send': { sessionId: 'chat-1', text: 'hi' },
    'agent:request': { scope: 'tree', words: 'w' },
    'agent:requests': { scope: 'tree' },
    'agent:profiles': undefined,
    'agent:profile-create': { name: 'n' },
    'agent:profile-remove': { profileId: 'p1' },
    'agent:pick-attachment': { sessionId: 'chat-1' },
    'agent:pick-mention': { sessionId: 'chat-1' },
    'agent:interrupt': { sessionId: 'chat-1' },
    'agent:approval-answer': { sessionId: 'chat-1', approvalId: 'a', decision: 'approve' },
    'agent:rewind': { sessionId: 'chat-1', turnId: 't' },
    'agent:effort': { sessionId: 'chat-1', effort: 'low' },
    'agent:models': { sessionId: 'chat-1' },
    'agent:close': { sessionId: 'chat-1' },
    'org:read': undefined,
    'org:reparent': { agentId: 'a', parentId: null },
    'org:assign-role': { agentId: 'a', role: 'r' },
    'org:create-role': { id: 'r', rules: [] },
    'org:edit-role': { id: 'r', rules: [] },
    'org:reset-role': { id: 'r' },
    'org:reset': undefined,
    'org:export': undefined,
  }
  assert.deepEqual(Object.keys(payloads).sort(), [...surface.commands].sort(), 'this test must name every command')

  const writes = surface.commands.filter(c => surface.isWrite(c))
  const reads = surface.commands.filter(c => !surface.isWrite(c))
  assert.deepEqual(writes.sort(), [
    'agent:approval-answer', 'agent:close', 'agent:effort', 'agent:interrupt', 'agent:pick-attachment',
    'agent:profile-create', 'agent:profile-remove', 'agent:request', 'agent:rewind', 'agent:send', 'agent:start',
    'org:assign-role', 'org:create-role', 'org:edit-role', 'org:reparent', 'org:reset', 'org:reset-role',
  ], 'the write inventory changed -- re-read every command before accepting this')
  assert.equal(writes.length + reads.length, 30)

  for (const command of writes) {
    deps.calls.length = 0
    const refused = await refusal(surface.run(command, payloads[command], readOnly))
    assert.equal(refused.code, READ_ONLY_REFUSAL, `${command} was not refused to a read-only caller`)
    assert.equal(READ_ONLY_REFUSAL, 'MC_AGENT_PRINCIPAL_READ_ONLY')
    assert.match(refused.message, /a read-only caller may read this computer's agents but not change them/, command)
    assert.match(refused.message, new RegExp(command.replace(/[-]/g, '\\-')), 'the sentence names the command')
    assert.deepEqual(deps.names(), [], `${command} touched a dependency before refusing a read-only caller`)
  }
  assert.ok(deps.agentSessions.has('chat-1'), 'a read-only close took a session away')

  for (const command of reads) {
    deps.calls.length = 0
    const asWindow = await surface.run(command, payloads[command], window)
    const windowCalls = JSON.stringify(deps.calls)
    deps.calls.length = 0
    const asReadOnly = await surface.run(command, payloads[command], readOnly)
    assert.deepEqual(asReadOnly, asWindow, `${command} answers a read-only caller differently from the window`)
    assert.equal(JSON.stringify(deps.calls), windowCalls, `${command} took a different path for a read-only caller`)
  }
})

/* ---------- the dialog gate ---------- */

test('a principal that is not the window is refused every dialog, and the dialog never opens', async () => {
  const deps = fakeDeps()
  const surface = createAgentCommandSurface(deps)
  await startedSession(deps, surface, 'remote-1', elsewhere)
  const dialogs = surface.commands.filter(c => surface.needsDialog(c))
  assert.deepEqual(dialogs.sort(), ['agent:pick-attachment', 'agent:pick-mention', 'agent:profile-create'])
  const payloads = {
    'agent:pick-attachment': { sessionId: 'remote-1' },
    'agent:pick-mention': { sessionId: 'remote-1' },
    'agent:profile-create': { name: 'n' },
  }
  for (const command of dialogs) {
    deps.calls.length = 0
    const refused = await refusal(surface.run(command, payloads[command], elsewhere))
    assert.equal(refused.code, DIALOG_REFUSAL, command)
    assert.equal(DIALOG_REFUSAL, 'MC_AGENT_DIALOG_REQUIRES_WINDOW')
    assert.deepEqual(deps.names(), [], `${command} opened a dialog for a caller that is not at the keyboard`)
  }
  assert.equal(deps.agentSessions.get('remote-1').attachments, undefined, 'an allowlist was issued without a dialog')
  /* The non-dialog commands still serve such a principal on its OWN session,
     and refuse it the window's. */
  await surface.run('agent:interrupt', { sessionId: 'remote-1' }, elsewhere)
  await startedSession(deps, surface, 'chat-1', window)
  assert.equal((await refusal(surface.run('agent:interrupt', { sessionId: 'chat-1' }, elsewhere))).code, 'MC_AGENT_UNKNOWN_SESSION')
  assert.equal((await refusal(surface.run('agent:interrupt', { sessionId: 'remote-1' }, window))).code, 'MC_AGENT_UNKNOWN_SESSION')
})

/* ---------- the facts that moved here from main.cjs, pinned in source ---------- */

test('the surface carries the refusal vocabulary the handlers carried, and no code is only a string in main.cjs', () => {
  for (const code of ['MC_AGENT_UNKNOWN_SESSION', 'MC_AGENT_ATTACHMENT_UNKNOWN', 'MC_AGENT_SESSION_EXISTS', 'MC_AGENT_SESSION_LIMIT', 'MC_AGENT_EFFORT_UNKNOWN']) {
    assert.ok(SURFACE_SOURCE.includes(`'${code}'`), `${code} left the surface`)
  }
  const start = SURFACE_SOURCE.slice(SURFACE_SOURCE.indexOf("'agent:start': async"), SURFACE_SOURCE.indexOf("'agent:send': async"))
  assert.ok(start.indexOf('recordSpawnIntent(request)') < start.indexOf('startSession('), 'the record is written before the spawn')
  assert.equal((start.match(/startSession\(/g) || []).length, 1, 'exactly one spawn')
  assert.ok(start.indexOf('chosenWorkspaceCwd()') < start.indexOf('recordSpawnIntent(request)'), 'the chosen folder is resolved before the record')
  assert.match(start, /sessionProfiles\.resolveCwd\(request\.profileId\)/)
  assert.match(start, /owner: principal\.owner/, 'the session is owned by the principal identity')
  const send = SURFACE_SOURCE.slice(SURFACE_SOURCE.indexOf("'agent:send': async"), SURFACE_SOURCE.indexOf("'agent:request': async"))
  assert.match(send, /session\.attachments instanceof Set/)
  assert.match(send, /MC_AGENT_ATTACHMENT_UNKNOWN/)
  const closeAt = SURFACE_SOURCE.indexOf("'agent:close': async")
  const close = SURFACE_SOURCE.slice(closeAt, SURFACE_SOURCE.indexOf("'org:read': async", closeAt))
  assert.ok(close.length > 100, 'the close body was not found')
  assert.ok(close.indexOf('closeSession(request)') > -1 && close.indexOf('closeSession(request)') < close.indexOf("recordSessionEnd(session, request.sessionId, 'closed')"))
  assert.ok(close.indexOf("recordSessionEnd(session, request.sessionId, 'closed')") < close.indexOf('agentSessions.delete(request.sessionId)'))
})
