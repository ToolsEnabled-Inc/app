// Desktop shell: serves the built dist/ over loopback HTTP (file:// would
// break fetch() and the router's absolute asset paths) and hosts it in a
// frameless window with native Windows caption buttons drawn over our own
// titlebar strip — the VSCode arrangement: the app owns the top strip, the
// OS owns min/max/close (which keeps Win11 snap layouts on the maximize
// button for free).
const { app, BrowserWindow, crashReporter, dialog, ipcMain, nativeTheme, Menu, safeStorage, screen } = require('electron')
const http = require('http')
const https = require('https')
const net = require('net')
const dns = require('dns')
const path = require('path')
const fs = require('fs')
const { randomBytes, randomUUID } = require('crypto')
const { createAgentHost, engineAvailability } = require('./agent-host.cjs')
const { createSpawnRecorder } = require('./spawn-record.cjs')
const { readBridgeProof } = require('./bridge-proof.cjs')
const {
  readCapabilityProof,
  resolveCapabilityRoot,
  startCapabilityLayer,
  stopCapabilityLayer,
} = require('./capability-layer.cjs')
const { readTierState, recordTier } = require('./setup-record.cjs')
const { wireSingleInstance } = require('./single-instance.cjs')
const { headlessWindowOptions } = require('./window-options.cjs')
const { startupFailureDetail } = require('./startup-failure-message.cjs')
const { createFatalStartupHandler } = require('./startup-fatal.cjs')
const { restoredWindowState, shellStateRecord } = require('./window-state.cjs')
const {
  CRASH_DUMP_DIR_NAME,
  crashReporterOptions,
  crashDumpFilesToDelete,
} = require('./crash-dumps.cjs')
const {
  SHELL_HOST,
  SHELL_PORT_MIN,
  SHELL_PORT_MAX,
  SHELL_PORTS,
  listenOnFirstFreePort,
} = require('./port-scan.cjs')

const fatalStartup = createFatalStartupHandler({
  app,
  dialog,
  detailForError: (error) => startupFailureDetail(
    error,
    { min: SHELL_PORT_MIN, max: SHELL_PORT_MAX },
  ),
})
process.on('unhandledRejection', (reason) => fatalStartup(reason, 'Unhandled promise rejection'))
process.on('uncaughtException', (error) => fatalStartup(error, 'Uncaught exception'))

const DIST = path.join(__dirname, '..', 'dist')
const TITLEBAR_H = 36
const FLEET_PROFILE_FILE = path.join(app.getPath('userData'), 'fleet-profile.json')
const MAX_FLEET_PROFILE_BYTES = 2 * 1024 * 1024
const MAX_FLEET_PROFILE_RECORD_BYTES = MAX_FLEET_PROFILE_BYTES + 4096
const FLEET_PROFILE_STORAGE_VERSION = 1
const PROJECTION_DATA_FILES = Object.freeze([
  'status.json', 'fleet.json', 'agents.json', 'metrics.json', 'ops.json',
  'ledger.json', 'coordinator.json', 'research.json', 'research-queue.json',
])
const PROJECTION_DATA_FILE_SET = new Set(PROJECTION_DATA_FILES)
const PROJECTION_CAPABILITY_HEADER = 'x-mc-projection-capability'
const projectionCapability = randomBytes(32).toString('base64url')
const bridgeProof = readBridgeProof({ env: process.env, readFileSync: fs.readFileSync })
const CRASH_DUMP_DIR = path.join(app.getPath('userData'), CRASH_DUMP_DIR_NAME)
/* The one real directory the product owns on a customer's disk. The capability
   layer already serves it as its workspace root; an agent session runs THERE,
   for the same reason, and the constant is shared so the two cannot drift into
   disagreeing about where the user's work lives. */
const WORKSPACE_ROOT = path.join(app.getPath('userData'), 'workspace')

fs.mkdirSync(CRASH_DUMP_DIR, { recursive: true })
app.setPath('crashDumps', CRASH_DUMP_DIR)
crashReporter.start(crashReporterOptions())

try {
  const dumps = fs.readdirSync(CRASH_DUMP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.dmp')
    .map((entry) => ({
      name: entry.name,
      mtimeMs: fs.statSync(path.join(CRASH_DUMP_DIR, entry.name)).mtimeMs,
    }))
  for (const name of crashDumpFilesToDelete(dumps)) {
    fs.unlinkSync(path.join(CRASH_DUMP_DIR, name))
  }
} catch { /* retention is best-effort and must never prevent startup */ }
/* Bounded, not ephemeral: the action bridge authorizes exact origins only in
   4600-4609. Scanning 4601-4609 is safe because every candidate remains in
   that allowlist; listen(0) could choose an unauthorized, drifting origin
   every launch (R1137 known issue). */

const AGENT_EVENT_CHANNEL = 'mc-agent:event'
const MAX_AGENT_SESSIONS = 8
const MAX_SESSION_ID_LENGTH = 128
const MAX_CWD_LENGTH = 32_768
const MAX_SURFACE_LENGTH = 64
const MAX_TURN_TEXT_LENGTH = 200_000

const agentSessions = new Map()
const boundAgentOwners = new WeakSet()
let agentHost = null
let removeAgentEventListener = null
let agentShutdownPromise = null
let agentShutdownComplete = false
let win = null
let shellOrigin = null
let runtimeLegacyFleetProfile = null
/* The supervised capability layer. Null until the shell server has bound,
   because the layer authorizes exactly one origin and that origin is not known
   until then. */
let capabilityLayer = null
let capabilityLayerStatus = { ok: false, code: 'CAPABILITY_NOT_STARTED', reason: 'The capability layer has not been started yet.' }

function agentIpcError(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function agentPayload(value, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    agentIpcError('MC_AGENT_INVALID_PAYLOAD', 'Agent IPC payload must be an object')
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      agentIpcError('MC_AGENT_INVALID_PAYLOAD', 'Unexpected agent IPC field: ' + key)
    }
  }
  return value
}

function boundedAgentString(value, name, maxLength) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || value.includes('\0')) {
    agentIpcError(
      'MC_AGENT_INVALID_PAYLOAD',
      name + ' must be a non-empty string of at most ' + maxLength + ' characters',
    )
  }
  return value
}

function parseAgentStart(value) {
  const payload = agentPayload(value, ['sessionId', 'cwd', 'surface'])
  const sessionId = Object.prototype.hasOwnProperty.call(payload, 'sessionId')
    ? payload.sessionId
    : `chat-${randomUUID()}`
  const result = {
    sessionId: boundedAgentString(sessionId, 'sessionId', MAX_SESSION_ID_LENGTH),
  }
  if (payload.cwd !== undefined) {
    result.cwd = boundedAgentString(payload.cwd, 'cwd', MAX_CWD_LENGTH)
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'surface')) {
    boundedAgentString(payload.surface, 'surface', MAX_SURFACE_LENGTH)
  }
  return result
}

function parseAgentSend(value) {
  const payload = agentPayload(value, ['sessionId', 'text'])
  return {
    sessionId: boundedAgentString(payload.sessionId, 'sessionId', MAX_SESSION_ID_LENGTH),
    text: boundedAgentString(payload.text, 'text', MAX_TURN_TEXT_LENGTH),
  }
}

function parseAgentSessionCommand(value) {
  const payload = agentPayload(value, ['sessionId'])
  return {
    sessionId: boundedAgentString(payload.sessionId, 'sessionId', MAX_SESSION_ID_LENGTH),
  }
}

function ownedAgentSession(sender, sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session || session.owner !== sender) {
    agentIpcError('MC_AGENT_UNKNOWN_SESSION', 'Unknown sessionId: ' + sessionId)
  }
  return session
}

/* Every agent channel must come from the application's own main frame.
   These channels start and drive a real CLI child process, so any frame that
   can reach the preload could spawn one: a main frame navigated off-origin,
   or a window the shell did not open. The shell has no will-navigate or
   window-open guard, so this is the boundary that actually holds.

   The sibling fleet-profile handlers already apply exactly this test. The
   agent channels -- the ones that create processes -- had none, which is the
   wrong way round. trustedFleetProfileSender() is the shell's generic "is
   this our own main frame, at our own origin" check despite its name; it is
   reused rather than duplicated so there is one definition of trusted sender,
   not two that can drift. */
function assertTrustedAgentSender(event) {
  if (!trustedFleetProfileSender(event)) {
    agentIpcError('MC_AGENT_SENDER_REFUSED', 'Agent request did not come from the application main frame.')
  }
}

function reportOwnerCloseFailure(sessionId, error) {
  console.error('Failed to close Codex session ' + sessionId + ':', error)
}

function bindAgentOwner(owner) {
  if (boundAgentOwners.has(owner)) return
  boundAgentOwners.add(owner)
  owner.once('destroyed', () => {
    const closing = []
    for (const [sessionId, session] of agentSessions) {
      if (session.owner !== owner) continue
      agentSessions.delete(sessionId)
      if (agentHost) {
        closing.push(
          agentHost.closeSession({ sessionId })
            .catch(error => reportOwnerCloseFailure(sessionId, error)),
        )
      }
    }
    if (closing.length) void Promise.allSettled(closing)
  })
}

/* The spawn recorder is built lazily: safeStorage is only meaningful after the
   app is ready, and userData is not resolvable before then either. */
let spawnRecorder = null
function getSpawnRecorder() {
  if (spawnRecorder) return spawnRecorder
  spawnRecorder = createSpawnRecorder({
    safeStorage,
    directory: app.getPath('userData'),
  })
  return spawnRecorder
}

function spawnRecordAvailability() {
  try {
    return getSpawnRecorder().availability()
  } catch (error) {
    return Object.freeze({
      ok: false,
      code: typeof error?.code === 'string' ? error.code : 'SPAWN_RECORD_UNAVAILABLE',
    })
  }
}

/* Starting an agent is an external mutation: it creates a process. The audited
   dispatch action refuses without a durable receipt, and this path now behaves
   the same way, against this app's OWN signed local ledger rather than the
   canonical chain -- which the shipped app cannot reach (no vault) and which
   has been observed in an anchor-integrity alarm. Recording FIRST and refusing
   on failure is the whole point: a session that could not be recorded is a
   session that does not start. */
function recordSpawnIntent(request) {
  let receipt
  try {
    receipt = getSpawnRecorder().record({
      action: 'agent_session_start',
      sessionId: request.sessionId,
      /* Null deliberately: there is no account system yet. When there is, the
         value is read HERE, in the main process, and never accepted from the
         renderer -- an identity a page can choose is not an identity. */
      principal: null,
      details: { cwd: request.cwd === undefined ? null : request.cwd },
    })
  } catch (error) {
    agentIpcError(
      'MC_AGENT_RECORD_UNAVAILABLE',
      'The agent session was not started because it could not be recorded: '
        + (typeof error?.code === 'string' ? error.code : 'SPAWN_RECORD_UNAVAILABLE'),
    )
  }
  if (!receipt || receipt.durable !== true || receipt.signed !== true) {
    agentIpcError('MC_AGENT_RECORD_UNAVAILABLE', 'The agent session was not started because its record was not durable')
  }
  return receipt
}

/* WHY THE DEFAULT CWD IS THE WORKSPACE AND NOT `__dirname/..`.
 *
 * This used to be `path.join(__dirname, '..')`. In a checkout that is the repo
 * root -- a real directory -- and every session started. In a PACKAGED app
 * `__dirname` is inside the archive, so it resolved to `resources/app.asar`,
 * which on the real filesystem is a 1.8 MB FILE.
 *
 * Nothing caught it. normalizeCwd() validates with fs.statSync, and Electron's
 * asar-patched fs answers that `app.asar` IS a directory, so validation passed
 * cleanly. child_process.spawn does not go through that patch: it hands the
 * path to CreateProcess, which refuses a file as a working directory and
 * reports ENOENT -- attributed, misleadingly, to the COMMAND rather than the
 * cwd. The Codex child therefore died at spawn on every packaged install.
 *
 * MEASURED 2026-08-10, engine run under the shipped `Mission Control.exe`:
 *   cwd = C:\Users\joshp\Desktop\wt-capability   -> START OK, threadId issued
 *   cwd = ...\resources\app.asar                 -> CODEX_APP_SERVER_EXITED
 *     "spawn C:\...\Mission Control.exe ENOENT"
 * Same binary, same engine, same auth; only the cwd differed.
 *
 * The third dev-only-works bug in this path, and the same shape as the other
 * two: a value that is a real thing in a checkout and a virtual one inside the
 * asar. The workspace root is a genuine directory that the app creates on
 * every start, so it is correct on a customer's machine and in a checkout --
 * and it is also where the user's work actually is, which is where an agent
 * should be running in the first place. */
function getAgentHost() {
  if (agentHost) return agentHost
  try { fs.mkdirSync(WORKSPACE_ROOT, { recursive: true }) } catch { /* normalizeCwd reports an unusable workspace */ }
  const host = createAgentHost({ defaultCwd: WORKSPACE_ROOT })
  removeAgentEventListener = host.onEvent((packet) => {
    const session = agentSessions.get(packet.sessionId)
    if (!session || session.owner.isDestroyed()) return
    try {
      session.owner.send(AGENT_EVENT_CHANNEL, packet)
    } catch {
      // Destruction can race this check; the owner cleanup closes the session.
    }
  })
  agentHost = host
  return host
}

/* Availability is a READ, and deliberately the only agent channel that starts
   nothing. The spawn surface calls it before it offers a Start control, so a
   build with no reachable engine renders a stated-unavailable surface instead
   of a button that always fails. The reply is {ok, code}: no path, no message,
   no error object -- see engineAvailability() in agent-host.cjs. */
ipcMain.handle('mc-agent:availability', async (event, value) => {
  assertTrustedAgentSender(event)
  agentPayload(value === undefined || value === null ? {} : value, [])
  /* Both conditions, because a spawn needs both: something to run, and
     somewhere to record that it ran. Reporting them separately would let the
     surface offer a control that the start handler will refuse. */
  const engine = engineAvailability()
  if (engine.ok !== true) return engine
  return spawnRecordAvailability()
})

ipcMain.handle('mc-agent:start', async (event, value) => {
  assertTrustedAgentSender(event)
  const request = parseAgentStart(value)
  if (agentSessions.has(request.sessionId)) {
    agentIpcError('MC_AGENT_SESSION_EXISTS', 'Session already exists: ' + request.sessionId)
  }
  if (agentSessions.size >= MAX_AGENT_SESSIONS) {
    agentIpcError('MC_AGENT_SESSION_LIMIT', 'At most ' + MAX_AGENT_SESSIONS + ' agent sessions may be open')
  }

  /* Before anything is spawned. If this throws, no process was created and
     nothing needs unwinding -- which is why it comes first. */
  const record = recordSpawnIntent(request)

  const session = { owner: event.sender, state: 'starting' }
  agentSessions.set(request.sessionId, session)
  bindAgentOwner(event.sender)
  try {
    const result = await getAgentHost().startSession(request)
    session.state = 'ready'
    /* The receipt travels back with the session so the surface can show that
       the start was recorded, rather than asserting it. */
    return { ...result, record: { sequence: record.sequence, eventHash: record.eventHash } }
  } catch (error) {
    if (error && error.code === 'AGENT_SESSION_CLEANUP_FAILED') {
      session.state = 'close-failed'
    } else if (agentSessions.get(request.sessionId) === session) {
      agentSessions.delete(request.sessionId)
    }
    throw error
  }
})

ipcMain.handle('mc-agent:send', async (event, value) => {
  assertTrustedAgentSender(event)
  const request = parseAgentSend(value)
  ownedAgentSession(event.sender, request.sessionId)
  return agentHost.sendTurn(request)
})

ipcMain.handle('mc-agent:interrupt', async (event, value) => {
  assertTrustedAgentSender(event)
  const request = parseAgentSessionCommand(value)
  ownedAgentSession(event.sender, request.sessionId)
  return agentHost.interrupt(request)
})

ipcMain.handle('mc-agent:close', async (event, value) => {
  assertTrustedAgentSender(event)
  const request = parseAgentSessionCommand(value)
  const session = ownedAgentSession(event.sender, request.sessionId)
  const result = await agentHost.closeSession(request)
  if (agentSessions.get(request.sessionId) === session) {
    agentSessions.delete(request.sessionId)
  }
  return result
})

/* Boot theme for the first frame: the renderer reports live colours the
   moment it paints, but the window background and caption buttons exist
   BEFORE that — read the persisted theme from the shell's own copy so a
   black-theme user never sees a white flash behind the chrome. */
const STATE_FILE = () => path.join(app.getPath('userData'), 'shell-state.json')
const THEME_SEED = {
  // measured from the live page per theme (body bg / ink), not guessed
  white: { bg: '#f7f8fa', ink: '#0e1726' },
  tan: { bg: '#f2e5bc', ink: '#282828' },
  black: { bg: '#0d0f12', ink: '#eef2f6' },
}

function readState() {
  try {
    return shellStateRecord(JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')))
  } catch {
    return {}
  }
}
function writeState(patch) {
  try {
    fs.writeFileSync(STATE_FILE(), JSON.stringify({ ...readState(), ...patch }))
  } catch { /* state is comfort, not correctness */ }
}

function fleetFailure(code, message) {
  return { ok: false, error: { code, message } }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyProfileText(value) {
  return typeof value === 'string' && Boolean(value.trim())
}

function safeProfileIdentifier(value) {
  return nonEmptyProfileText(value) && value.length <= 128 && /^[a-z0-9][a-z0-9._:/-]*$/i.test(value)
}

function safeProfileMarkupCopy(value) {
  return typeof value === 'string' && !/[<>\u0000-\u001f]/.test(value)
}

function invalidProfileTextArray(value, { allowEmpty = true } = {}) {
  return !Array.isArray(value)
    || (!allowEmpty && value.length === 0)
    || value.some(entry => !nonEmptyProfileText(entry))
}

function fleetProfilePayloadError(profile) {
  if (!isPlainObject(profile)) return 'Fleet profile must be a JSON object.'
  if (profile.schemaVersion !== 1) return 'Fleet profile schemaVersion must be 1.'
  if (!safeProfileIdentifier(profile.id) || profile.id === 'sample') return 'Fleet profile id is missing, unsafe, or reserved.'
  if (typeof profile.label !== 'string' || !profile.label.trim()) return 'Fleet profile label is required.'
  if (!Array.isArray(profile.machines) || profile.machines.length === 0 || profile.machines.length > 128) {
    return 'Fleet profile must contain 1 through 128 machines.'
  }
  if (!Array.isArray(profile.transports) || profile.transports.length === 0 || profile.transports.length > 32) {
    return 'Fleet profile must contain 1 through 32 transports.'
  }

  const machineIds = new Set()
  for (const machine of profile.machines) {
    if (!isPlainObject(machine) || !safeProfileIdentifier(machine.id) || machineIds.has(machine.id)) return 'Fleet profile machines need unique safe ids.'
    machineIds.add(machine.id)
    if (!nonEmptyProfileText(machine.name) || !safeProfileMarkupCopy(machine.name)) return 'Every fleet machine needs a markup-safe name.'
    if (machine.short !== undefined && !safeProfileMarkupCopy(machine.short)) return 'Fleet machine short names must be markup-safe.'
    const address = nonEmptyProfileText(machine.ip) ? machine.ip : machine.address
    if (!nonEmptyProfileText(address) || address.length > 2048 || address.includes('\0')) return 'Every fleet machine needs a valid bounded address.'
    try {
      const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(address) ? address : `tcp://${address}`)
      if (parsed.username || parsed.password) return 'Fleet machine addresses cannot contain credentials.'
    } catch {
      if (!/^[0-9a-f:]+$/i.test(address)) return 'Fleet machine address is not a valid host, IP address, or URL.'
    }
  }

  const transportIds = new Set()
  for (const transport of profile.transports) {
    if (!isPlainObject(transport) || !safeProfileIdentifier(transport.id) || transportIds.has(transport.id)) return 'Fleet transports need unique safe ids.'
    transportIds.add(transport.id)
    if (transport.port !== null && transport.port !== undefined) {
      const port = Number(transport.port)
      if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Fleet transport ports must be null or integers from 1 through 65535.'
    }
    if (transport.endpoint !== null && transport.endpoint !== undefined) {
      if (typeof transport.endpoint !== 'string' || transport.endpoint.length > 2048 || transport.endpoint.includes('\0')) return 'Fleet transport endpoints must be bounded text.'
      if (transport.endpoint.trim()) {
        try {
          const endpoint = transport.endpoint.trim()
          const legacyPort = /^:(\d+)$/.exec(endpoint)
          const parsed = legacyPort
            ? new URL(`tcp://localhost:${legacyPort[1]}`)
            : new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(endpoint) ? endpoint : `tcp://${endpoint}`)
          if (!parsed.hostname || parsed.username || parsed.password) return 'Fleet transport endpoints need a host and cannot contain credentials.'
        } catch { return 'Fleet transport endpoint is not a valid URL or host:port.' }
      }
    }
  }
  if (profile.dataSource !== undefined && profile.dataSource !== null) {
    if (!isPlainObject(profile.dataSource) || profile.dataSource.kind !== 'directory') return 'Fleet dataSource must be a directory record.'
    const sourcePath = profile.dataSource.path
    if (!nonEmptyProfileText(sourcePath) || sourcePath.length > 4096 || sourcePath.includes('\0')) return 'Fleet dataSource path is invalid.'
    if (!path.isAbsolute(sourcePath)) return 'Fleet dataSource path must be absolute.'
  }

  if (profile.spend !== undefined) {
    if (!isPlainObject(profile.spend)) return 'Fleet spend must be an object.'
    for (const key of ['creditRemaining', 'creditTotal', 'seatPct', 'dormantPct']) {
      if (typeof profile.spend[key] !== 'number' || !Number.isFinite(profile.spend[key])) return `Fleet spend.${key} must be a finite number.`
    }
  }
  if (profile.pools !== undefined) {
    if (!Array.isArray(profile.pools) || profile.pools.length === 0) return 'Fleet pools must contain at least one account pool.'
    const poolIds = new Set()
    for (const pool of profile.pools) {
      if (!isPlainObject(pool) || !safeProfileIdentifier(pool.id) || poolIds.has(pool.id)) return 'Fleet pools need unique safe ids.'
      poolIds.add(pool.id)
      if (!nonEmptyProfileText(pool.kind) || !nonEmptyProfileText(pool.desc)
        || !safeProfileMarkupCopy(pool.kind) || !safeProfileMarkupCopy(pool.desc)
        || (pool.tipKind !== undefined && !safeProfileMarkupCopy(pool.tipKind))) return 'Every fleet pool needs markup-safe kind and description text.'
      if (!['percent', 'currency', 'dormant'].includes(pool.meter)) return 'Fleet pool meter must be percent, currency, or dormant.'
    }
  }
  for (const key of ['tasks', 'feed', 'chatReplies']) {
    if (profile[key] !== undefined && invalidProfileTextArray(profile[key], { allowEmpty: false })) return `Fleet ${key} must contain non-empty text entries.`
  }
  if (profile.chat !== undefined && (!Array.isArray(profile.chat) || profile.chat.some(message =>
    !isPlainObject(message) || !nonEmptyProfileText(message.from) || !nonEmptyProfileText(message.text)))) {
    return 'Fleet chat entries need from and text values.'
  }
  if (profile.chatContextReplies !== undefined) {
    if (!isPlainObject(profile.chatContextReplies)) return 'Fleet chatContextReplies must be an object.'
    for (const replies of Object.values(profile.chatContextReplies)) {
      if (invalidProfileTextArray(replies, { allowEmpty: false })) return 'Every fleet contextual reply pool must contain text.'
    }
  }
  if (profile.channels !== undefined) {
    if (!Array.isArray(profile.channels)) return 'Fleet channels must be an array.'
    const channelIds = new Set()
    for (const channel of profile.channels) {
      if (!isPlainObject(channel) || !safeProfileIdentifier(channel.id) || channelIds.has(channel.id)
        || !nonEmptyProfileText(channel.name) || !nonEmptyProfileText(channel.key)) return 'Fleet channels need unique ids, names, and keys.'
      channelIds.add(channel.id)
    }
  }
  if (profile.board !== undefined) {
    if (!isPlainObject(profile.board)) return 'Fleet board must be an object.'
    for (const messages of Object.values(profile.board)) {
      if (!Array.isArray(messages) || messages.some(message =>
        !isPlainObject(message) || !nonEmptyProfileText(message.s) || !nonEmptyProfileText(message.t))) return 'Fleet board messages need sender and text values.'
    }
  }
  if (profile.conversations !== undefined && (!Array.isArray(profile.conversations) || profile.conversations.some(conversation =>
    !isPlainObject(conversation) || !safeProfileIdentifier(conversation.id)
    || (conversation.child != null && !safeProfileIdentifier(conversation.child)) || !nonEmptyProfileText(conversation.a)
    || !nonEmptyProfileText(conversation.b) || !nonEmptyProfileText(conversation.key) || !isPlainObject(conversation.lines)
    || invalidProfileTextArray(conversation.lines.a, { allowEmpty: false })
    || invalidProfileTextArray(conversation.lines.b, { allowEmpty: false })))) return 'Fleet conversations have an invalid shape.'
  if (profile.ledger !== undefined) {
    if (!isPlainObject(profile.ledger) || !Array.isArray(profile.ledger.requests) || !Array.isArray(profile.ledger.questions)) return 'Fleet ledger must declare request and question arrays.'
    if (profile.ledger.requests.some(record => !isPlainObject(record) || !safeProfileIdentifier(record.id)
      || (record.parent !== undefined && !safeProfileIdentifier(record.parent)) || !nonEmptyProfileText(record.title)
      || !['open', 'in-progress', 'gated', 'done', 'blocked'].includes(record.status))) return 'Fleet ledger requests need safe ids, titles, and supported status values.'
    if (profile.ledger.questions.some(record => !isPlainObject(record) || !safeProfileIdentifier(record.id)
      || !nonEmptyProfileText(record.question) || !['pending', 'answered'].includes(record.status)
      || (record.status === 'answered' && !nonEmptyProfileText(record.answer)))) return 'Fleet ledger questions need safe ids, questions, and supported status values.'
  }
  for (const key of ['session', 'arrivals']) {
    if (profile[key] !== undefined && (!Array.isArray(profile[key]) || profile[key].some(turn =>
      !isPlainObject(turn) || !nonEmptyProfileText(turn.who) || !nonEmptyProfileText(turn.text)))) return `Fleet ${key} entries need who and text values.`
  }
  for (const key of ['replies', 'replyActs']) {
    if (profile[key] !== undefined && invalidProfileTextArray(profile[key])) return `Fleet ${key} must contain only non-empty text.`
  }
  if (profile.speakers !== undefined) {
    if (!isPlainObject(profile.speakers)) return 'Fleet speakers must be an object.'
    for (const speaker of Object.values(profile.speakers)) {
      if (!isPlainObject(speaker) || typeof speaker.label !== 'string'
        || typeof speaker.cls !== 'string' || !/^[a-z_][a-z0-9_-]*(?:\s+[a-z_][a-z0-9_-]*)*$/i.test(speaker.cls)
        || (speaker.hue !== undefined && (typeof speaker.hue !== 'string' || !/^(?:#[0-9a-f]{3,8}|var\(--[a-z0-9-]+\))$/i.test(speaker.hue)))) {
        return 'Fleet speaker records need a text label and safe class/colour values.'
      }
    }
  }
  for (const key of ['sessionTitle', 'composerTarget']) {
    if (profile[key] !== undefined && typeof profile[key] !== 'string') return `Fleet ${key} must be text.`
  }
  return null
}

function fleetProfileJson(profile) {
  const payloadError = fleetProfilePayloadError(profile)
  if (payloadError) return fleetFailure('MC_FLEET_PROFILE_INVALID', payloadError)
  let text
  try { text = JSON.stringify(profile) } catch {
    return fleetFailure('MC_FLEET_PROFILE_INVALID', 'Fleet profile could not be serialized.')
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_FLEET_PROFILE_BYTES) {
    return fleetFailure('MC_FLEET_PROFILE_TOO_LARGE', 'Fleet profile exceeds the 2 MiB limit.')
  }
  return { ok: true, text }
}

/* Window geometry can fail soft, but a fleet profile cannot share that rule.
   The old shell-state writer turns any unreadable file into `{}` and the next
   resize overwrites it. A dedicated, atomic userData record means a bounds
   update can never erase the only copy of somebody's system configuration. */
function readDurableFleetProfile() {
  let raw
  try {
    const stat = fs.statSync(FLEET_PROFILE_FILE)
    if (!stat.isFile()) return fleetFailure('MC_FLEET_PROFILE_NOT_FILE', 'Durable fleet profile is not a regular file.')
    if (stat.size > MAX_FLEET_PROFILE_RECORD_BYTES) {
      return fleetFailure('MC_FLEET_PROFILE_TOO_LARGE', 'Durable fleet profile exceeds the 2 MiB limit.')
    }
    raw = fs.readFileSync(FLEET_PROFILE_FILE, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, configured: false, state: 'absent' }
    return fleetFailure('MC_FLEET_PROFILE_READ_FAILED', `Durable fleet profile could not be read (${error?.code || 'unknown error'}).`)
  }

  let record
  try { record = JSON.parse(raw) } catch {
    return fleetFailure('MC_FLEET_PROFILE_MALFORMED', 'Durable fleet profile contains malformed JSON.')
  }
  if (!isPlainObject(record) || record.storageVersion !== FLEET_PROFILE_STORAGE_VERSION) {
    return fleetFailure('MC_FLEET_PROFILE_STORAGE_VERSION', 'Durable fleet profile has an unrecognized storage version.')
  }
  if (record.state === 'reset') return { ok: true, configured: false, state: 'reset' }
  if (record.state !== 'configured') {
    return fleetFailure('MC_FLEET_PROFILE_STATE', 'Durable fleet profile has an unrecognized state.')
  }
  const encoded = fleetProfileJson(record.profile)
  if (!encoded.ok) return encoded
  return { ok: true, configured: true, state: 'configured', profile: record.profile }
}

function replaceDurableFleetProfile(record) {
  const directory = path.dirname(FLEET_PROFILE_FILE)
  fs.mkdirSync(directory, { recursive: true })
  const temp = path.join(directory, `.fleet-profile-${process.pid}-${randomUUID()}.tmp`)
  /* Bound the exact bytes we later read. Pretty-print overhead once made a
     save near the 2 MiB limit report success and then reject its own file on
     the next launch. The durable record is machine state, so compact JSON is
     the safer single contract; exported profiles remain human-readable. */
  const text = `${JSON.stringify(record)}\n`
  if (Buffer.byteLength(text, 'utf8') > MAX_FLEET_PROFILE_RECORD_BYTES) {
    throw Object.assign(new Error('durable fleet profile exceeds its record limit'), { code: 'MC_FLEET_PROFILE_TOO_LARGE' })
  }
  let fd
  try {
    fd = fs.openSync(temp, 'wx')
    fs.writeFileSync(fd, text, 'utf8')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    fs.renameSync(temp, FLEET_PROFILE_FILE)
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd) } catch {}
    }
    try { fs.unlinkSync(temp) } catch {}
  }
}

function storeFleetProfile(profile) {
  const encoded = fleetProfileJson(profile)
  if (!encoded.ok) return encoded
  try {
    replaceDurableFleetProfile({
      storageVersion: FLEET_PROFILE_STORAGE_VERSION,
      state: 'configured',
      profile,
    })
    runtimeLegacyFleetProfile = null
    return { ok: true }
  } catch (error) {
    return fleetFailure('MC_FLEET_PROFILE_WRITE_FAILED', `Durable fleet profile could not be saved (${error?.code || 'unknown error'}).`)
  }
}

function resetDurableFleetProfile() {
  try {
    /* A tombstone is intentional: a missing file means “migrate the legacy
       localStorage copy”, while reset means “do not resurrect any old port's
       browser copy.” Those two states looked identical before this record. */
    replaceDurableFleetProfile({
      storageVersion: FLEET_PROFILE_STORAGE_VERSION,
      state: 'reset',
      resetAt: new Date().toISOString(),
    })
    runtimeLegacyFleetProfile = null
    return { ok: true }
  } catch (error) {
    return fleetFailure('MC_FLEET_PROFILE_RESET_FAILED', `Durable fleet profile could not be reset (${error?.code || 'unknown error'}).`)
  }
}

function trustedFleetProfileSender(event) {
  if (!win || !shellOrigin || event.sender !== win.webContents) return false
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false
  try { return new URL(event.senderFrame.url).origin === shellOrigin } catch { return false }
}

async function withFleetProfileSender(event, action) {
  if (!trustedFleetProfileSender(event)) {
    return fleetFailure('MC_FLEET_PROFILE_SENDER_REFUSED', 'Fleet profile request did not come from the application main frame.')
  }
  try { return await action() } catch (error) {
    return fleetFailure('MC_FLEET_PROFILE_ACTION_FAILED', error?.message || String(error))
  }
}

function safeExportName(profile) {
  const base = String(profile.label || 'fleet-profile').trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${base || 'fleet-profile'}.json`
}

function sanitizedEndpoint(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `tcp://${text}`)
    parsed.username = ''
    parsed.password = ''
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
      ? parsed.toString().replace(/\/$/, '')
      : `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`
  } catch { return 'configured address' }
}

function tcpProbe(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs, () => finish({ state: 'unreachable', message: `connection timed out after ${timeoutMs} ms` }))
    socket.once('connect', () => finish({ state: 'reachable', message: 'TCP connection accepted' }))
    socket.once('error', error => finish({ state: 'unreachable', message: `connection failed (${error?.code || 'unknown error'})` }))
  })
}

function httpProbe(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const parsed = new URL(url)
    const client = parsed.protocol === 'https:' ? https : http
    const request = client.request(parsed, { method: 'HEAD', timeout: timeoutMs }, response => {
      response.resume()
      resolve({ state: 'reachable', message: `HTTP endpoint answered ${response.statusCode}` })
    })
    request.once('timeout', () => request.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
    request.once('error', error => resolve({ state: 'unreachable', message: `HTTP connection failed (${error?.code || 'unknown error'})` }))
    request.end()
  })
}

function dnsProbe(host, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), timeoutMs)
    dns.promises.lookup(host).then(
      result => { clearTimeout(timer); resolve(result) },
      error => { clearTimeout(timer); reject(error) },
    )
  })
}

async function probeEndpoint({ id, label, value, legacyPort = null }) {
  const text = String(value || '').trim()
  if (!text) {
    if (Number.isInteger(Number(legacyPort)) && Number(legacyPort) > 0) {
      return { id, label, target: `:${Number(legacyPort)}`, state: 'unverified', message: 'legacy port is configured without a host; reachability cannot be tested' }
    }
    return { id, label, target: '', state: 'not-configured', message: 'not configured' }
  }

  let parsed
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
  if (!hasScheme && net.isIP(text) === 6) {
    return { id, label, target: text, state: 'unverified', message: 'IPv6 address is valid, but no port was provided; reachability is unverified' }
  }
  try { parsed = new URL(hasScheme ? text : `tcp://${text}`) } catch {
    return { id, label, target: 'configured address', state: 'unreachable', message: 'address is malformed' }
  }
  const target = sanitizedEndpoint(text)
  if (parsed.username || parsed.password) {
    return { id, label, target, state: 'unreachable', message: 'credentials in endpoint URLs are not supported' }
  }
  const port = parsed.port || (parsed.protocol === 'http:' ? '80' : parsed.protocol === 'https:' ? '443' : '')
  if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && port) {
    const result = await httpProbe(parsed.toString())
    return { id, label, target, ...result }
  }
  if (port) {
    const result = await tcpProbe(parsed.hostname, Number(port))
    return { id, label, target, ...result }
  }
  try {
    await dnsProbe(parsed.hostname)
    return { id, label, target, state: 'unverified', message: 'address resolves, but no port was provided; reachability is unverified' }
  } catch (error) {
    return { id, label, target, state: 'unreachable', message: `address did not resolve (${error?.code || 'unknown error'})` }
  }
}

function projectionPayloadError(name, value) {
  if (!isPlainObject(value) || value.schemaVersion !== 1) return 'missing or wrong schemaVersion'
  if (name === 'status.json') {
    if (typeof value.ok !== 'boolean' || (value.reason !== null && typeof value.reason !== 'string')) return 'status envelope is malformed'
    return null
  }
  if (name === 'research-queue.json') {
    if (!Array.isArray(value.items)) return 'research queue items must be an array'
    const statuses = new Set(['queued', 'in-progress', 'complete'])
    for (const item of value.items) {
      if (!isPlainObject(item) || !nonEmptyProfileText(item.id) || !nonEmptyProfileText(item.title)
        || !statuses.has(item.status) || !nonEmptyProfileText(item.provenance)
        || !nonEmptyProfileText(item.observation) || !nonEmptyProfileText(item.researchQuestion)) {
        return 'research queue contains a malformed item'
      }
    }
    return null
  }
  const domain = name.slice(0, -'.json'.length)
  if (value.domain !== domain || typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt))) return 'projection domain or generatedAt is invalid'
  if (typeof value.ok !== 'boolean' || (value.reason !== null && typeof value.reason !== 'string')) return 'projection availability envelope is malformed'
  if (!Array.isArray(value.sources) || (value.data !== null && !isPlainObject(value.data))) return 'projection sources or data has the wrong shape'
  return null
}

async function readProjectionCandidate(root, name) {
  const file = path.join(root, name)
  try {
    const stat = await fs.promises.stat(file)
    if (!stat.isFile()) return { ok: false, message: 'not a regular file' }
    if (stat.size > MAX_FLEET_PROFILE_BYTES) return { ok: false, message: 'file exceeds 2 MiB' }
    const text = await fs.promises.readFile(file, 'utf8')
    let parsed
    try { parsed = JSON.parse(text) } catch { return { ok: false, message: 'malformed JSON' } }
    const shapeError = projectionPayloadError(name, parsed)
    return shapeError
      ? { ok: false, message: shapeError }
      : { ok: true, message: 'valid projection envelope', text }
  } catch (error) {
    return { ok: false, message: `unreadable (${error?.code || 'unknown error'})` }
  }
}

async function probeProjectionDirectory(dataSource) {
  if (!dataSource || dataSource.kind !== 'directory' || typeof dataSource.path !== 'string' || !dataSource.path.trim()) {
    return { state: 'not-configured', message: 'no local projection directory is configured', files: [] }
  }
  const root = dataSource.path.trim()
  if (!path.isAbsolute(root)) return { state: 'unavailable', message: 'projection directory must be an absolute path', files: [] }
  try {
    const stat = await fs.promises.stat(root)
    if (!stat.isDirectory()) return { state: 'unavailable', message: 'configured projection source is not a directory', files: [] }
  } catch (error) {
    return { state: 'unavailable', message: `projection directory could not be read (${error?.code || 'unknown error'})`, files: [] }
  }

  const files = await Promise.all(PROJECTION_DATA_FILES.map(async name => {
    const result = await readProjectionCandidate(root, name)
    return { name, ok: result.ok, message: result.message }
  }))
  const failed = files.filter(file => !file.ok)
  return failed.length
    ? { state: 'unavailable', message: `${failed.length} required projection file${failed.length === 1 ? '' : 's'} unavailable`, files }
    : { state: 'ready', message: `${files.length} required projection files passed structural checks`, files }
}

async function probeFleetProfile(profile) {
  const encoded = fleetProfileJson(profile)
  if (!encoded.ok) return encoded
  const machines = await Promise.all(profile.machines.map(machine => probeEndpoint({
    id: machine.id,
    label: machine.name,
    value: machine.ip || machine.address,
  })))
  const transports = await Promise.all(profile.transports.map(transport => probeEndpoint({
    id: transport.id,
    label: transport.label || transport.id,
    value: transport.endpoint,
    legacyPort: transport.port,
  })))
  const dataSource = await probeProjectionDirectory(profile.dataSource)
  return { ok: true, checkedAt: new Date().toISOString(), machines, transports, dataSource }
}

function serveConfiguredProjection(url, request, response) {
  const match = /^\/data\/([^/]+\.json)$/.exec(url)
  if (!match || !PROJECTION_DATA_FILE_SET.has(match[1])) return false
  const stored = readDurableFleetProfile()
  if (!stored.ok) {
    response.writeHead(503, 'Fleet Profile Unavailable', { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: false, reason: stored.error.message }))
    return true
  }
  const activeProfile = stored.configured ? stored.profile : runtimeLegacyFleetProfile
  if (!activeProfile) return false
  const dataSource = activeProfile.dataSource
  if (!dataSource || dataSource.kind !== 'directory' || typeof dataSource.path !== 'string' || !dataSource.path.trim()) {
    response.writeHead(503, 'Projection Source Not Configured', { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify({ ok: false, reason: 'This fleet profile does not configure a local projection directory.' }))
    return true
  }
  if (request.headers[PROJECTION_CAPABILITY_HEADER] !== projectionCapability) {
    response.writeHead(403, 'Projection Capability Required', { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify({ ok: false, reason: 'Projection access is restricted to this application window.' }))
    return true
  }
  const root = dataSource.path.trim()
  if (!path.isAbsolute(root)) {
    response.writeHead(503, 'Projection Source Unavailable', { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: false, reason: 'Configured projection directory is not an absolute path.' }))
    return true
  }
  ;(async () => {
    const result = await readProjectionCandidate(root, match[1])
    if (!result.ok) {
      response.writeHead(503, 'Projection Source Unavailable', { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify({ ok: false, reason: `${match[1]} is unavailable: ${result.message}.` }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(result.text)
  })().catch(error => {
    response.writeHead(503, 'Projection Source Unavailable', { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify({ ok: false, reason: `${match[1]} could not be served (${error?.code || 'unknown error'}).` }))
  })
  return true
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon',
}

function serveDist() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const expectedHost = shellOrigin ? new URL(shellOrigin).host : null
      if (!expectedHost || req.headers.host !== expectedHost) {
        res.writeHead(421, 'Misdirected Request', { 'content-type': 'text/plain', 'cache-control': 'no-store' })
        res.end('This loopback application only accepts its exact local origin.')
        return
      }
      const url = decodeURIComponent((req.url || '/').split('?')[0])
      if (serveConfiguredProjection(url, req, res)) return
      let file = path.normalize(path.join(DIST, url === '/' ? 'index.html' : url))
      // the hash router means every real navigation is still index.html
      if (!file.startsWith(DIST)) { res.writeHead(403); return res.end() }
      fs.readFile(file, (err, data) => {
        if (err) {
          // unknown paths fall back to the app shell, same as any SPA host
          return fs.readFile(path.join(DIST, 'index.html'), (e2, index) => {
            if (e2) { res.writeHead(404); return res.end() }
            res.writeHead(200, { 'content-type': 'text/html' })
            res.end(index)
          })
        }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
        res.end(data)
      })
    })
    listenOnFirstFreePort(server, SHELL_PORTS, SHELL_HOST).then(() => {
      server.on('error', (error) => fatalStartup(error, 'Shell server failure'))
      resolve(server)
    }, reject)
  })
}

ipcMain.on('mc-fleet-profile:bootstrap', (event) => {
  event.returnValue = trustedFleetProfileSender(event)
    ? readDurableFleetProfile()
    : fleetFailure('MC_FLEET_PROFILE_SENDER_REFUSED', 'Fleet profile bootstrap did not come from the application main frame.')
})

ipcMain.on('mc-fleet-profile:migrate-legacy', (event, profile) => {
  if (!trustedFleetProfileSender(event)) {
    event.returnValue = fleetFailure('MC_FLEET_PROFILE_SENDER_REFUSED', 'Fleet profile migration did not come from the application main frame.')
    return
  }
  const current = readDurableFleetProfile()
  if (!current.ok) { event.returnValue = current; return }
  if (current.state === 'reset') {
    event.returnValue = fleetFailure('MC_FLEET_PROFILE_RESET_ACTIVE', 'A prior reset prevents a legacy browser copy from being restored.')
    return
  }
  if (current.configured) { event.returnValue = { ok: true, migrated: false }; return }
  const stored = storeFleetProfile(profile)
  /* A disk-full/read-only userData incident must not turn a valid legacy
     profile into a configured renderer backed by bundled sample projections.
     Keep only that already-validated legacy profile for this process, so the
     source is either its declared directory or an explicit 503. The next
     launch retries durability from localStorage. */
  if (!stored.ok && fleetProfilePayloadError(profile) === null) runtimeLegacyFleetProfile = profile
  event.returnValue = { ...stored, migrated: true }
})

ipcMain.handle('mc-fleet-profile:save', (event, profile) =>
  withFleetProfileSender(event, () => storeFleetProfile(profile)))

ipcMain.handle('mc-fleet-profile:reset', event =>
  withFleetProfileSender(event, () => resetDurableFleetProfile()))

ipcMain.handle('mc-fleet-profile:import-file', event => withFleetProfileSender(event, async () => {
  const choice = await dialog.showOpenDialog(win, {
    title: 'Load fleet profile',
    properties: ['openFile'],
    filters: [{ name: 'Fleet profile', extensions: ['json'] }],
  })
  if (choice.canceled || choice.filePaths.length !== 1) return { ok: true, canceled: true }
  const selected = choice.filePaths[0]
  let stat
  try { stat = await fs.promises.stat(selected) } catch (error) {
    return fleetFailure('MC_FLEET_PROFILE_IMPORT_READ_FAILED', `Selected profile could not be read (${error?.code || 'unknown error'}).`)
  }
  if (!stat.isFile()) return fleetFailure('MC_FLEET_PROFILE_IMPORT_NOT_FILE', 'Selected profile is not a regular file.')
  if (stat.size > MAX_FLEET_PROFILE_BYTES) return fleetFailure('MC_FLEET_PROFILE_TOO_LARGE', 'Selected profile exceeds the 2 MiB limit.')
  let text
  try { text = await fs.promises.readFile(selected, 'utf8') } catch (error) {
    return fleetFailure('MC_FLEET_PROFILE_IMPORT_READ_FAILED', `Selected profile could not be read (${error?.code || 'unknown error'}).`)
  }
  let profile
  try { profile = JSON.parse(text) } catch {
    return fleetFailure('MC_FLEET_PROFILE_IMPORT_MALFORMED', 'Selected profile contains malformed JSON.')
  }
  if (!isPlainObject(profile)) return fleetFailure('MC_FLEET_PROFILE_IMPORT_INVALID', 'Selected profile must contain one JSON object.')
  return { ok: true, canceled: false, profile }
}))

ipcMain.handle('mc-fleet-profile:export-file', (event, profile) => withFleetProfileSender(event, async () => {
  const encoded = fleetProfileJson(profile)
  if (!encoded.ok) return encoded
  const exportText = `${JSON.stringify(profile, null, 2)}\n`
  if (Buffer.byteLength(exportText, 'utf8') > MAX_FLEET_PROFILE_BYTES) {
    return fleetFailure('MC_FLEET_PROFILE_TOO_LARGE', 'Pretty-printed fleet profile exceeds the 2 MiB export limit.')
  }
  const choice = await dialog.showSaveDialog(win, {
    title: 'Export fleet profile',
    defaultPath: path.join(app.getPath('documents'), safeExportName(profile)),
    filters: [{ name: 'Fleet profile', extensions: ['json'] }],
  })
  if (choice.canceled || !choice.filePath) return { ok: true, canceled: true }
  try { await fs.promises.writeFile(choice.filePath, exportText, { encoding: 'utf8', flag: 'w' }) } catch (error) {
    return fleetFailure('MC_FLEET_PROFILE_EXPORT_FAILED', `Fleet profile could not be exported (${error?.code || 'unknown error'}).`)
  }
  return { ok: true, canceled: false }
}))

ipcMain.handle('mc-fleet-profile:choose-directory', event => withFleetProfileSender(event, async () => {
  const choice = await dialog.showOpenDialog(win, {
    title: 'Choose local projection directory',
    properties: ['openDirectory'],
  })
  return choice.canceled || choice.filePaths.length !== 1
    ? { ok: true, canceled: true }
    : { ok: true, canceled: false, path: choice.filePaths[0] }
}))

ipcMain.handle('mc-fleet-profile:probe', (event, profile) =>
  withFleetProfileSender(event, () => probeFleetProfile(profile)))

/* ---------- first run: the permission level ----------
 *
 * The renderer asks what this install's permission level is, and sets it. Both
 * go through shell/setup-record.cjs, which writes the engine's own machine
 * record out of the capability payload rather than a second app-local copy.
 *
 * `bootstrap` is SYNCHRONOUS for the same reason mc-fleet-profile:bootstrap is:
 * the first-run gate has to decide which screen to paint while the renderer's
 * module graph is still evaluating. An async answer paints the fleet first and
 * then yanks it away, which reads as a glitch on the product's first
 * impression. It is a bounded read of one small JSON file.
 *
 * The write is an invoke and carries the same sender check as every other
 * mutation here: a permission level arriving from a frame that is not this
 * window's main frame is refused, not recorded. */
/* EVERY PATH MUST PRODUCE A VALUE, and the handler must have no way not to
 * assign it. A sendSync whose handler returns without setting returnValue does
 * not refuse the caller -- it blocks the renderer forever. On this channel that
 * means the window paints nothing at all on first launch: a hang, with no error
 * and no screen, on the one launch a customer forms their opinion on.
 *
 * So the outcome is computed by a function that always returns an object, and
 * the handler is a single assignment. Written first as a branch per outcome,
 * which was correct but is the shape that can leak one -- a later edit adding an
 * early return reintroduces the deadlock silently. This shape cannot.
 * (The channel was reviewed by the agents-from-ui lane, which owns the sibling
 * agent channels and asked the question.) */
function setupBootstrapReply(event) {
  if (!trustedFleetProfileSender(event)) {
    return { ok: false, code: 'MC_SETUP_SENDER_REFUSED', reason: 'Setup request did not come from the application main frame.' }
  }
  try {
    const state = readTierState()
    /* readTierState is written not to throw and always to answer. Both are
       still checked here, because the cost of it being wrong is a hang. */
    if (state && typeof state === 'object') return state
    return { ok: false, code: 'MC_SETUP_STATE_ABSENT', reason: 'Setup state could not be determined on this computer.' }
  } catch (error) {
    return { ok: false, code: 'MC_SETUP_STATE_FAILED', reason: error?.message || String(error) }
  }
}

ipcMain.on('mc-setup:bootstrap', (event) => { event.returnValue = setupBootstrapReply(event) })

ipcMain.handle('mc-setup:choose-tier', (event, tier) =>
  withFleetProfileSender(event, () => recordTier(typeof tier === 'string' ? tier : '')))

/* Two ways to get the bootstrap proof, and the order matters.
 *
 * MC_BRIDGE_PROOF_FILE is the developer path: a bridge was started outside
 * this app and its proof file was named on the environment. It wins when it is
 * set, so a developer pointing the app at a bridge they are debugging keeps
 * getting that bridge and not a second one this app started.
 *
 * The supervised path is the customer path, and it is the one that makes an
 * installed product work: no environment variable, no checkout, no developer
 * -- the app started its own layer and reads the proof that layer just minted.
 * Before this existed there was no second branch here at all, so an install
 * with nothing on its environment had no proof, and every write action failed
 * the bootstrap that gates them. */
function currentBridgeProof() {
  if (bridgeProof.ok) return bridgeProof
  if (capabilityLayer?.bootstrapProofFile) return readCapabilityProof(capabilityLayer.bootstrapProofFile)
  return capabilityLayerStatus.ok
    ? bridgeProof
    : { ok: false, reason: capabilityLayerStatus.reason }
}

ipcMain.handle('mc-bridge-proof', () => currentBridgeProof())

/* Which bridge is legitimately this app's own -- answered by the only party
 * that can know: the shell that started it.
 *
 * The renderer used to find its bridge by scanning 127.0.0.1:4610-4619 and
 * trusting the first structurally-valid /v1/runtime responder. That hands this
 * boot's bootstrap proof to whatever local process squats a lower port and
 * forges a well-formed runtime body; the squatter then replays the proof to the
 * genuine layer for a bearer and full dispatch. The proof file is owner-ACL'd
 * precisely so only the owner can read it, and discovery-by-guess gave it away.
 *
 * So the shell tells the renderer the exact origin of the layer it supervises,
 * and the renderer pins to it instead of guessing. The developer path
 * (MC_BRIDGE_PROOF_FILE) names a proof file but not a port -- the bridge was
 * started outside this app -- so the shell cannot vouch for an origin there; it
 * reports source 'env' and the renderer keeps scanning, which is the
 * developer's explicit opt-in and not a customer's exposure. */
function currentBridgeEndpoint() {
  if (bridgeProof.ok) return { ok: true, source: 'env' }
  if (capabilityLayerStatus.ok && typeof capabilityLayerStatus.baseUrl === 'string') {
    return { ok: true, source: 'supervised', baseUrl: capabilityLayerStatus.baseUrl, pid: capabilityLayerStatus.pid }
  }
  return { ok: false, source: 'none', reason: capabilityLayerStatus.reason }
}

ipcMain.handle('mc-bridge-endpoint', () => currentBridgeEndpoint())

function currentWorkAreas() {
  try {
    const primary = screen.getPrimaryDisplay().workArea
    const others = screen.getAllDisplays()
      .map((display) => display.workArea)
      .filter((area) => (
        area.x !== primary.x || area.y !== primary.y
        || area.width !== primary.width || area.height !== primary.height
      ))
    return [primary, ...others]
  } catch {
    return []
  }
}

/* Start the capability layer, and DO NOT make it fatal.
 *
 * A viewer that opens and honestly reports that its capability layer is down
 * is a worse product than one where both halves work, and a better one than a
 * window that refuses to appear at all. The failure is recorded in
 * capabilityLayerStatus, which the proof handler above already surfaces to the
 * renderer through the existing bridge-unavailable path -- so an unreachable
 * layer looks to the user exactly like it did before this supervisor existed,
 * with no new surface and nothing new to render. */
async function startSupervisedCapabilityLayer() {
  const root = resolveCapabilityRoot()
  const workspaceRoot = WORKSPACE_ROOT
  try { fs.mkdirSync(workspaceRoot, { recursive: true }) } catch { /* the layer reports its own refusal */ }

  const started = await startCapabilityLayer({ root, origin: shellOrigin, workspaceRoot })
  capabilityLayerStatus = started.ok
    ? { ok: true, baseUrl: started.baseUrl, port: started.port, pid: started.pid }
    : { ok: false, code: started.code, reason: started.reason }

  if (!started.ok) {
    console.error(`[capability-layer] not started: ${started.code} ${started.reason}`)
    return capabilityLayerStatus
  }

  capabilityLayer = started
  /* A layer that dies after a successful start must stop being reported as
     running. Without this the proof handler would keep reading a proof file
     for a process that is gone, and the renderer would see an authorization
     failure instead of an unreachable bridge. */
  started.child.once('exit', (code) => {
    if (capabilityLayer !== started) return
    capabilityLayer = null
    capabilityLayerStatus = { ok: false, code: 'CAPABILITY_EXITED', reason: `The capability layer exited with code ${code}.` }
  })
  return capabilityLayerStatus
}

async function createWindow() {
  const state = restoredWindowState(readState(), currentWorkAreas())
  const seed = THEME_SEED[state.theme] || THEME_SEED.white
  const server = await serveDist()
  const port = server.address().port
  shellOrigin = `http://127.0.0.1:${port}`
  await startSupervisedCapabilityLayer()

  const window = new BrowserWindow({
    ...state.bounds,
    // Packaged smoke gate only; default is {} so shipping behaviour is
    // unchanged. See shell/window-options.cjs.
    ...headlessWindowOptions(),
    backgroundColor: seed.bg,
    icon: path.join(__dirname, 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: seed.bg, symbolColor: seed.ink, height: TITLEBAR_H },
    webPreferences: {
      preload: path.join(__dirname, 'fleet-profile-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win = window
  let closeRequested = false
  win.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: [`${shellOrigin}/data/*`] },
    (details, callback) => callback({
      requestHeaders: {
        ...details.requestHeaders,
        'X-MC-Projection-Capability': projectionCapability,
      },
    }),
  )
  win.setMenuBarVisibility(false)
  if (state.maximized) win.maximize()

  // the menu is gone (clean chrome), so keep its two useful accelerators
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F12') { win.webContents.toggleDevTools(); e.preventDefault() }
    if (input.control && input.key.toLowerCase() === 'r') { win.webContents.reload(); e.preventDefault() }
  })

  const persistBounds = () => {
    if (!win) return
    const b = win.getNormalBounds()
    writeState({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() })
  }
  win.on('resized', persistBounds)
  win.on('moved', persistBounds)
  win.on('maximize', persistBounds)
  win.on('unmaximize', persistBounds)
  win.on('close', () => { closeRequested = true })
  win.on('closed', () => { if (win === window) win = null })

  try {
    await window.loadURL(`${shellOrigin}/`)
  } catch (error) {
    // A user can close the native window before navigation settles. That is a
    // successful close, not a startup failure; a live window still fails loud.
    if (closeRequested && (window.isDestroyed() || win !== window)) return
    throw error
  }
}

/* The renderer reports its REAL composited surface colours whenever the
   theme flips — the caption buttons and window background follow the app,
   never the other way round. */
ipcMain.on('mc-theme', (_e, { theme, bg, ink }) => {
  if (!win) return
  try {
    win.setTitleBarOverlay({ color: bg, symbolColor: ink, height: TITLEBAR_H })
    win.setBackgroundColor(bg)
  } catch { /* overlay API can reject mid-close; nothing to recover */ }
  nativeTheme.themeSource = theme === 'black' ? 'dark' : 'light'
  writeState({ theme })
})

/* Merge note (lane/research-queue -> installer/nsis).
   Both sides edited this block. The agent-host shutdown below is KEPT from the
   chat lane. Its single-instance wiring is NOT kept, because it is the older,
   defective ordering that T4f (ad51ddb) fixed: it registered the whenReady
   handler BEFORE taking the lock, so an instance that lost the lock called
   quit() and then still ran createWindow(), building a window on an app already
   tearing down. wireSingleInstance() below performs exactly the same three jobs
   -- ready, lock, second-instance focus -- in the order Electron documents.
   Keeping both literally would register whenReady twice and open two windows. */
app.on('before-quit', (event) => {
  if (!agentHost || agentShutdownComplete) return
  event.preventDefault()
  if (agentShutdownPromise) return

  const host = agentHost
  agentSessions.clear()
  agentShutdownPromise = host.closeAll()
    .catch(error => console.error('Failed to close all Codex sessions:', error))
    .finally(() => {
      if (removeAgentEventListener) removeAgentEventListener()
      removeAgentEventListener = null
      agentHost = null
      agentShutdownComplete = true
      app.quit()
    })
})

wireSingleInstance({
  requestLock: () => app.requestSingleInstanceLock(),
  quit: () => app.quit(),
  whenReady: () => app.whenReady(),
  onSecondInstance: (handler) => app.on('second-instance', handler),
  getWindow: () => win,
  start: () => {
    Menu.setApplicationMenu(null)
    return createWindow()
  },
  onStartFailure: (error) => fatalStartup(error, 'Application startup rejected'),
})
/* The capability layer is a child process, and an orphaned one holds a port in
   the 4610-4619 discovery range. The next launch would then discover a bridge
   belonging to a dead app -- a live listener that is the wrong listener, which
   is a mistake this project has already made once at the service level. */
app.on('will-quit', () => {
  const child = capabilityLayer?.child
  capabilityLayer = null
  /* Killed SYNCHRONOUSLY, before the promise-based helper is allowed to await
     anything. `will-quit` is the last point at which this process is still
     alive to act, and an awaited kill can lose the race with app teardown --
     which is not a theoretical concern: the acceptance harness caught exactly
     this leaving a live bridge behind. stopCapabilityLayer still runs, to wait
     for the exit and to escalate to SIGKILL if the first signal is ignored,
     but the signal itself is delivered before we can be interrupted. */
  try { child?.kill() } catch { /* the awaited path below escalates */ }
  void stopCapabilityLayer(child)
})
app.on('window-all-closed', () => app.quit())
