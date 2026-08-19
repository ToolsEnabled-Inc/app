/* THE FIRST THING THIS FILE DOES, AND IT MUST STAY FIRST: refuse to start the
 * application when what was actually asked for is one of our own programs.
 *
 * THE DEFECT, MEASURED ON A STAGED BUILD 2026-08-18. A generated `.mcp.json` (or
 * the confined `config.toml`) names this executable as the runtime for
 * `<engine>\src\mcp-server.js`. An Electron binary handed a script argument
 * WITHOUT ELECTRON_RUN_AS_NODE ignores the argument and boots the whole
 * application, so the agent CLI got a window instead of a server: no answer to
 * `initialize`, 0 tools advertised, 5 new top-level windows owned by that child.
 * The user saw "a second ToolsEnabled that looks outdated" every time they
 * started an agent, and -- the half nobody had seen -- every app-started session
 * ran with NONE of this product's own MCP tools.
 *
 * The generators no longer write such a document. THIS EXISTS FOR THE ONES
 * ALREADY ON DISK: a `.mcp.json` in a person's own folder, written by an
 * earlier build, that their agent client will read tomorrow morning. Nothing
 * regenerates a file this application does not know about, so the repair has to
 * live at the point the mistake arrives.
 *
 * THE TEST IS "A SCRIPT INSIDE THIS BUILD'S OWN RESOURCES", NOT "AN EXTRA
 * ARGUMENT". Re-entering as Node on any unrecognised argv would turn every
 * mistyped shortcut, every file association and every future command-line flag
 * into a silent headless exit with no window -- which is the SAME failure in the
 * other direction, and this project has already lost two diagnoses to it. The
 * question asked is narrow and answerable: does argv name a .js/.cjs/.mjs file
 * that lives under process.resourcesPath, i.e. a program we ship.
 *
 * It uses only node built-ins and runs before `require('electron')`, so nothing
 * in this file has resolved userData or written a byte when it decides. */
;(() => {
  if (process.env.ELECTRON_RUN_AS_NODE === '1') return
  const resources = typeof process.resourcesPath === 'string' ? process.resourcesPath : ''
  if (!resources) return
  const nodePath = require('node:path')
  const root = nodePath.resolve(resources)
  const forwarded = process.argv.slice(1)
  const ours = forwarded.some((argument) => {
    if (typeof argument !== 'string' || !/\.[cm]?js$/i.test(argument)) return false
    const resolved = nodePath.resolve(argument)
    return resolved === root || resolved.startsWith(root + nodePath.sep)
  })
  if (!ours) return
  /* stdio is INHERITED, which is the whole point: the handles this process was
     given are the pipes the agent CLI is speaking JSON-RPC over, and they must
     reach the program that can answer. windowsHide because the child is our own
     Node-mode binary and STANDING-ORDERS class LOCAL-WORK rule 3 is absolute. */
  const { spawnSync } = require('node:child_process')
  const result = spawnSync(process.execPath, forwarded, {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    windowsHide: true,
  })
  process.exit(typeof result.status === 'number' ? result.status : 1)
})()

// Desktop shell: serves the built dist/ over loopback HTTP (file:// would
// break fetch() and the router's absolute asset paths) and hosts it in a
// frameless window with native Windows caption buttons drawn over our own
// titlebar strip — the VSCode arrangement: the app owns the top strip, the
// OS owns min/max/close (which keeps Win11 snap layouts on the maximize
// button for free).
/* `shell` is here for exactly one thing: handing a Google sign-in URL to the
   operating system's default browser. It is never given a URL from the page. */
const { app, BrowserWindow, crashReporter, dialog, ipcMain, nativeTheme, Menu, safeStorage, screen, shell: electronShell } = require('electron')
const http = require('http')
const https = require('https')
const net = require('net')
const dns = require('dns')
const path = require('path')
const fs = require('fs')
const { randomBytes, randomUUID, createHash } = require('crypto')
const { createAgentHost, engineAvailability, engineCandidates } = require('./agent-host.cjs')
const { readAgentConfinement, listAgentTools } = require('./agent-confinement-read.cjs')
const { providerCliPresence } = require('./provider-cli-presence.cjs')
const { createSpawnRecorder } = require('./spawn-record.cjs')
const { createUsageRecorder, turnUsageFrom } = require('./usage-record.cjs')
const { recordCanonical: recordCanonicalIn, closeCanonical: closeCanonicalLedger } = require('./canonical-audit.cjs')
const { sharedAccountStore, UNAUTHENTICATED_PRINCIPAL } = require('./product-account.cjs')
const { createGoogleSignIn } = require('./google-signin.cjs')
const { resolveGoogleSignInConfig } = require('./google-signin-config.cjs')
const { vaultRecordPresence: readVaultRecordPresence } = require('./vault-presence.cjs')
const { readBridgeProof } = require('./bridge-proof.cjs')
const { resolveEnvBridgeProof, recordEnvProofRefusal } = require('./bridge-env-path.cjs')
const {
  guiEnvironment,
  readCapabilityProof,
  resolveCapabilityRoot,
  startCapabilityLayer,
  stopCapabilityLayer,
} = require('./capability-layer.cjs')
/* Passed back INTO startCapabilityLayer through its own `spawn` seam, so this
   shell can hold the layer's child from the moment it exists rather than only
   from the moment it speaks. See capabilityLayerChild. */
const { spawn: spawnChildProcess } = require('node:child_process')
const {
  readTierState,
  recordTier,
  readWorkspaceState,
  checkWorkspace,
  recordWorkspaces,
  ensureDispatchAssistantConfig,
  refreshChosenAssistantConfig,
} = require('./setup-record.cjs')
const { createAgentOrgRecord } = require('./agent-org-record.cjs')
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
  preferredPortFirst,
} = require('./port-scan.cjs')
const { createRendererPrefs } = require('./renderer-prefs.cjs')
const { adoptLegacyUserData } = require('./userdata-adoption.cjs')
const { RETENTION_PREF_KEY, syncRecordedChoice } = require('./uninstall-retention.cjs')
const { planReset, eraseLocalData } = require('./local-data-reset.cjs')
const { readProductSettings, setProductSetting } = require('./product-settings.cjs')
const { createSubscribeEndpoint } = require('./subscribe-endpoint.cjs')

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

/* BEFORE ANY LINE BELOW RESOLVES userData. Renaming the product from "Mission
   Control" to "ToolsEnabled" moved userData to a directory that does not exist
   yet, so an existing customer's settings, workspace and spawn records are
   sitting in the old one reading as "new user". This carries them across once.
   It has to run above FLEET_PROFILE_FILE, CRASH_DUMP_DIR, WORKSPACE_ROOT and
   the renderer-prefs store, because each of those resolves -- and the last of
   them writes -- at module scope. See shell/userdata-adoption.cjs.

   The outcome is deliberately not bound to a variable here: it is written
   durably to <userData>/.userdata-adoption.json, which outlives the process and
   is what support would actually read. A console line would not -- shell build
   diagnostics are stripped from the shipped app. */
adoptLegacyUserData({
  userDataPath: app.getPath('userData'),
  /* dirname(userData) IS appData: Electron defines one as the other joined with
     productName. Deriving it keeps the search beside wherever this install's
     data actually lives rather than in a fixed OS folder it might not be in. */
  searchRoot: path.dirname(app.getPath('userData')),
  fs,
  path,
  /* THE KEYSTORE ANSWERS FOR ITSELF, on the real bytes, before they are adopted.
     safeStorage on Windows is Chromium OSCrypt, whose AES key lives in the
     PROFILE's Local State -- so a blob written under the old productName cannot
     be opened here, and adopting it disabled Start permanently. This is the
     probe that catches that; see shell/userdata-adoption.cjs.

     A THROW IS AN ANSWER: decryptString raises on a blob that does not
     authenticate, which is exactly the production case. Returning false rather
     than propagating keeps a launch-time carry-over from becoming a launch
     failure, and the adoption module records WHY the key was left behind.

     isEncryptionAvailable() is asked first because decryptString on an
     unavailable keystore throws for a reason that has nothing to do with these
     bytes, and calling that "REFUSED" would put a wrong cause in the record. */
  canDecrypt: (bytes) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false
      safeStorage.decryptString(bytes)
      return true
    } catch {
      return false
    }
  },
})

/* WHERE THE CAPABILITY LAYER KEEPS WHAT IT WRITES, AND WHY THE SHELL DECIDES IT.
 *
 * MEASURED, on the real per-user install at %LOCALAPPDATA%\Programs\toolsenabled:
 * after one session the INSTALL DIRECTORY contained
 * resources/capability/state/mission-bridge-token.json (a live bearer),
 * state/audit.sqlite3 (the signed ledger), logs/actions.jsonl and
 * vault/secrets.json -- the customer's credential vault. The layer was
 * resolving those from its own module directory, so "next to the program" and
 * "the user's data" were the same place.
 *
 * They must not be. An update REPLACES the install directory, so the vault and
 * the audit ledger were living inside the blast radius of the next version; a
 * per-machine install puts that directory under Program Files, where the writes
 * fail or demand an elevation this product has no business asking for; and a
 * program directory is world-readable by default, which is the wrong ACL for a
 * bearer token.
 *
 * The layer can work this out for itself -- it does, from the PAYLOAD.json
 * marker, so a payload started by something other than this shell is still
 * safe -- but the shell is the component that knows where THIS install's user
 * data actually is, including when a profile has been relocated. So it states
 * the answer rather than letting two components derive it separately and drift.
 *
 * It is a subdirectory of userData rather than userData itself so the layer's
 * state/, logs/ and vault/ cannot collide with the shell's own files there
 * (renderer-prefs.json, shell-state.json, workspace/, purchase-catalog.json).
 *
 * SET ON THIS PROCESS TOO, not only on the child: shell/setup-record.cjs and
 * shell/agent-org-record.cjs require capability modules IN THIS PROCESS, and
 * they resolve their state root at require() time. This assignment is above
 * every one of those requires for the same reason adoptLegacyUserData() is
 * above the paths it protects. */
const CAPABILITY_STATE_ROOT = path.join(app.getPath('userData'), 'capability')
process.env.TOOLSENABLED_STATE_ROOT = CAPABILITY_STATE_ROOT
try { fs.mkdirSync(CAPABILITY_STATE_ROOT, { recursive: true }) } catch { /* the layer reports its own refusal to start */ }

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
/* THE PURCHASE LIST IS THE OPERATOR'S OWN DOCUMENT AND IS NOT PART OF THE PRODUCT.
 *
 * It used to be authored at public/data/purchase-catalog.json, which vite copies
 * into dist/ and electron-builder packs into app.asar under "dist/**". So every
 * installer carried it, and #/checkout put it one click from home on a stranger's
 * fresh install: internal repo paths, internal request ids, the builder's own
 * second-person deliberations, and a written admission that the installer is
 * unsigned. Reproduced on the packaged build before this change.
 *
 * Hiding the screen would not have been a fix. app.asar is a documented archive
 * anyone can list; the leak is the BYTES, so the bytes had to leave the payload.
 *
 * It is served from the install's own userData directory instead. Present means
 * the person running this copy put their list there; absent means there is no
 * list and the screen does not exist (src/checkout-visibility.js turns the route
 * and the ring stop off, so absence is a closed door rather than an empty shop).
 *
 * The capability header is the same fence the projection route uses, for the same
 * reason: the shell injects it into the app window's own /data/* requests, so any
 * other page or process that reaches this origin cannot read the file. */
const OWNER_PURCHASE_LIST_URL = '/data/purchase-catalog.json'
const OWNER_PURCHASE_LIST_FILE = () => path.join(app.getPath('userData'), 'purchase-catalog.json')
const MAX_OWNER_PURCHASE_LIST_BYTES = 2 * 1024 * 1024
/* The env proof is fenced to unpackaged builds. MC_BRIDGE_PROOF_FILE lives in
   HKCU\Environment, which the user can write with no elevation, so "the
   developer set it" is an assumption a packaged install cannot make. Fencing
   here -- at the single point the value is produced -- rather than at each
   reader is deliberate: currentBridgeProof() below can hand back this value
   from two different branches. See shell/bridge-env-path.cjs for the attack
   this closes and for why a packaged build ignores the variable instead of
   refusing to launch. */
const bridgeProof = resolveEnvBridgeProof({
  env: process.env,
  isPackaged: app.isPackaged,
  readBridgeProof,
  readFileSync: fs.readFileSync,
})
/* Not silent: a tampered packaged launch leaves a record beside the user's
   data, because shell build diagnostics are stripped from the shipped app and a
   console line would reach nobody. A clean launch clears it. */
recordEnvProofRefusal({
  directory: app.getPath('userData'),
  refused: bridgeProof.envProofRefused === true,
  fs,
  path,
})
const CRASH_DUMP_DIR = path.join(app.getPath('userData'), CRASH_DUMP_DIR_NAME)
/* The one real directory the product owns on a customer's disk. The capability
   layer already serves it as its workspace root; an agent session runs THERE,
   for the same reason, and the constant is shared so the two cannot drift into
   disagreeing about where the user's work lives. */
const WORKSPACE_ROOT = path.join(app.getPath('userData'), 'workspace')

/* Session profiles: the person's own named working folders, resolved ONLY in
   this process. The renderer sends a profileId; shell/session-profiles.cjs
   holds folders picked through the OS dialog and refuses everything else. */
const { createSessionProfileStore } = require('./session-profiles.cjs')
const sessionProfiles = createSessionProfileStore({
  file: path.join(app.getPath('userData'), 'session-profiles.json'),
})

/* The person's own provider accounts: which Codex and Claude sign-ins this
   computer knows about, and where each one keeps its home.

   ITS FILE IS THE ENGINE'S FILE, AND THAT IS THE ONLY REASON IT WORKS. The
   rotation reads <LOCALAPPDATA>\ToolsEnabled\accounts.json, beside machine.json,
   and it is the only reader that matters -- a list kept next to
   session-profiles.json in userData would be a screen showing one answer while
   the thing that starts agents obeyed another. So the path is resolved the way
   the engine's resolveServicesRoot() resolves it, in shell/account-registry.cjs,
   rather than assembled here from app.getPath(). */
const { createAccountRegistryStore, accountsRegistryFile } = require('./account-registry.cjs')
const accountRegistry = createAccountRegistryStore({ file: accountsRegistryFile() })

/* The renderer's settings, kept where no port can partition them. See
   shell/renderer-prefs.cjs for what was wrong and why this is one file rather
   than a second copy of anything. */
const rendererPrefs = createRendererPrefs({
  directory: app.getPath('userData'),
  fs,
  path,
  randomUUID,
})

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
/* The provider's own reasoning-effort vocabulary (codex-cli 0.146.0). The
   authoritative per-model list comes from model/list at runtime; this is the
   boundary's closed set, kept because codex itself accepts values outside
   its own catalog without complaint. */
const AGENT_EFFORT_VALUES = Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
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
/* THE START, WHILE IT IS STILL HAPPENING.
 *
 * The window used to be constructed only after the layer had announced itself,
 * so "starting" was a state no renderer could ever observe and these two
 * variables were unnecessary. Measured on this machine, that wait is a median
 * 525ms (worst 626ms) of a packaged cold start whose whole median is 1503ms --
 * roughly a third of the launch spent on a subsystem the first screen does not
 * read. The window is now built while the layer boots, which makes "starting"
 * observable, and an observable state has to be answered honestly:
 *
 *   capabilityLayerStarting  the in-flight promise. Every reader of the layer's
 *     status awaits it, so nobody is ever told "no capability layer" during the
 *     window where the truthful answer is "not yet". That is the absence case
 *     and it is the whole risk of this change: an unstarted layer read as an
 *     ABSENT one would make a working install report BRIDGE_UNREACHABLE for
 *     half a second on every launch, which is a lie the renderer would act on.
 *
 *   capabilityLayerChild  the child as soon as it EXISTS, rather than only once
 *     it has spoken. `will-quit` can now arrive mid-start -- a person can close
 *     the window while the layer is still coming up -- and a child nobody holds
 *     a handle to is an orphan holding a port in the 4610-4619 discovery range,
 *     which is precisely the failure the will-quit handler below exists to
 *     prevent. */
let capabilityLayerStarting = null
let capabilityLayerChild = null

function agentIpcError(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

/* Carry the CODE across the IPC boundary, and leave the message behind.
 *
 * THE DEFECT THIS REPAIRS IS WHY EVERY REFUSAL LOOKED IDENTICAL. Electron
 * reconstructs a rejected invoke() in the renderer from the error's name,
 * message and stack. Own properties do not survive -- so `error.code`, which is
 * the ONLY thing src/agent-session.js is willing to render, arrived undefined
 * for every start refusal without exception. Its `typeof error?.code ===
 * 'string'` test therefore always failed and the code constant-folded to
 * AGENT_SESSION_FAILED. That is the bare string a customer was shown: not a
 * missing translation, a code that never crossed the boundary. Adding copy for
 * the real codes without this would have changed nothing at all.
 *
 * THE MESSAGE IS DISCARDED RATHER THAN FORWARDED, and that is a second fix
 * rather than a cost. The message is exactly what may name a path -- the engine
 * raises `Unable to run codex --version: <stderr>` and the module loaders name
 * absolute engine roots -- and today that text crosses into the renderer
 * process inside an Error object even though the renderer is careful never to
 * print it. Data that is not sent cannot be printed by the next person who
 * forgets. So the replacement's message IS the code: a short fixed identifier
 * from a closed vocabulary, which is the one thing the surface wanted.
 *
 * The renderer still refuses to trust it as text -- src/agent-session.js
 * matches what arrives against its own copy table and renders nothing it cannot
 * find there -- so this is a channel, not a licence to print. */
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
  // `tier` IS ACCEPTED HERE BECAUSE WITHOUT IT NOBODY CAN CHOOSE A MODEL.
  //
  // Owner, 2026-08-13: "i cant even choose the provider or model". He was right
  // in the most literal way -- this allowlist held exactly three keys and
  // agentPayload() THROWS on anything else, so a renderer that sent a tier was
  // refused before it reached the host. Below it, startSession() had no model
  // parameter and the engine module was a hardcoded constant. The choice did not
  // exist anywhere on this channel; it was not disabled, it was absent.
  //
  // Adding the key here is only the first of three edits -- see agent-host.cjs
  // startSession(), which resolves it, and the compose panel, which must offer
  // it. Shipping any one of them alone leaves a control that looks real and is
  // not, which is the defect f1ce3ec removed three sliders for.
  const payload = agentPayload(value, ['sessionId', 'cwd', 'surface', 'tier', 'effort', 'profileId', 'resumeThreadId'])
  const sessionId = Object.prototype.hasOwnProperty.call(payload, 'sessionId')
    ? payload.sessionId
    : `chat-${randomUUID()}`
  const result = {
    sessionId: boundedAgentString(sessionId, 'sessionId', MAX_SESSION_ID_LENGTH),
  }
  if (payload.cwd !== undefined) {
    /* Retired 2026-08-14 (session profiles, iteration 5 W6). A working folder
       is not the renderer's to choose: the field was accepted for years and
       sent by NOBODY — the fleet-trees suite's section-8 guard measures every
       caller — and now that profileId exists there is a consented route (a
       folder the person picked through the OS dialog). So the free-string
       route refuses by name instead of quietly working for whoever forges a
       payload. The key stays in the allowlist exactly so this sentence, not
       a generic unexpected-key error, is the answer. */
    boundedAgentString(payload.cwd, 'cwd', MAX_CWD_LENGTH)
    agentIpcError(
      'MC_AGENT_CWD_NOT_YOURS',
      'A working folder cannot be sent with a start. Assign a session profile instead - a profile is a folder picked by hand in the app.',
    )
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'surface')) {
    boundedAgentString(payload.surface, 'surface', MAX_SURFACE_LENGTH)
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'tier')) {
    // Validated here rather than in the host so an unknown id is refused at the
    // boundary with a message naming what IS available, instead of silently
    // starting the default engine and reporting success -- which is how the app
    // came to run every agent on Codex while appearing to offer a choice.
    result.tier = boundedAgentString(payload.tier, 'tier', 64)
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'effort')) {
    // Same doctrine as tier: refused AT THE BOUNDARY with the available set
    // named, never silently defaulted -- a control that accepts anything and
    // starts something else is the defect the tier comment above records.
    //
    // THE SET IS THE PROVIDER'S, not one we invented. Measured against
    // codex-cli 0.146.0 (2026-08-16): model/list reports each model's own
    // supported efforts, and `codex` accepts every value below. It also
    // accepts a value that is NOT one of them -- `-c
    // model_reasoning_effort=banana` was taken and echoed back untouched --
    // so this list is load-bearing: the engine will not catch a bad value
    // for us. `ultra` is the one that is not merely "more thinking": it is
    // the provider's switch for automatic task delegation, and refusing it
    // here was why the product could never start that agent at all.
    const effort = boundedAgentString(payload.effort, 'effort', 8)
    if (!AGENT_EFFORT_VALUES.includes(effort)) {
      agentIpcError(
        'MC_AGENT_EFFORT_UNKNOWN',
        `effort must be one of: ${AGENT_EFFORT_VALUES.join(', ')}`,
      )
    }
    result.effort = effort
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'resumeThreadId')) {
    // The name of a conversation codex already holds on disk. It is an
    // opaque id like every other identifier that crosses here, and the host
    // hands it straight to thread/resume -- which refuses an id it does not
    // have, so a forged one buys a refusal rather than somebody else's
    // conversation. Bounded to the adapter's own threadId ceiling.
    result.resumeThreadId = boundedAgentString(payload.resumeThreadId, 'resumeThreadId', 512)
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'profileId')) {
    // An ID, never a path: the main-process profile store resolves it after
    // parse (see mc-agent:start), so a hand-built payload can name a profile
    // or be refused -- it cannot smuggle a working directory.
    result.profileId = boundedAgentString(payload.profileId, 'profileId', 128)
  }
  return result
}

function parseAgentSend(value) {
  const payload = agentPayload(value, ['sessionId', 'text', 'model', 'images'])
  const request = {
    sessionId: boundedAgentString(payload.sessionId, 'sessionId', MAX_SESSION_ID_LENGTH),
    text: boundedAgentString(payload.text, 'text', MAX_TURN_TEXT_LENGTH),
  }
  if (payload.model !== undefined) {
    request.model = boundedAgentString(payload.model, 'model', 128)
  }
  if (payload.images !== undefined) {
    if (!Array.isArray(payload.images) || payload.images.length > 8) {
      agentIpcError('MC_AGENT_INVALID_PAYLOAD', 'images must be an array of at most 8 picked files')
    }
    request.images = payload.images.map(image => ({
      path: boundedAgentString(image && image.path, 'image path', 32768),
    }))
  }
  return request
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
      /* THE WINDOW IS GONE, so the app is on its way out (window-all-closed
         quits it) and these sessions end because of that. Best-effort and
         synchronous, BEFORE the session leaves the map -- see recordSessionEnd. */
      recordSessionEnd(session, sessionId, 'app-shutdown')
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

/* The usage recorder is built lazily for exactly the two reasons the spawn
   recorder above is: safeStorage is only meaningful after the app is ready, and
   userData is not resolvable before then. It shares that recorder's key and
   keeps its own chain -- see shell/usage-record.cjs. */
let usageRecorder = null
function getUsageRecorder() {
  if (usageRecorder) return usageRecorder
  usageRecorder = createUsageRecorder({
    safeStorage,
    directory: app.getPath('userData'),
  })
  return usageRecorder
}

/* WHAT THE TURNS ON THIS COMPUTER COST, for the metrics page. A read, like
   history() beside it, and with the same never-throws contract. */
function usageRecordHistory(limit) {
  try {
    return getUsageRecorder().usage({ limit })
  } catch (error) {
    return Object.freeze({
      ok: false,
      code: typeof error?.code === 'string' ? error.code : 'SPAWN_RECORD_UNAVAILABLE',
    })
  }
}

/* THE LABELS THAT RIDE WITH A USAGE RECORD, BOUNDED HERE RATHER THAN AT THE
 * WRITER.
 *
 * The writer refuses anything outside these shapes outright, and that strictness
 * is the guarantee that a figure on a screen cannot be a path. But a person may
 * name their own provider sign-in anything at all, and a refused LABEL must
 * never cost us the READING it was attached to -- losing a turn's tokens because
 * an account is called "work (old)" would be this feature failing for a reason
 * nobody could see. So a label that is not the bounded shape becomes null here,
 * which every reader downstream already renders as "the record does not say".
 */
function usageLabel(value, pattern) {
  return typeof value === 'string' && pattern.test(value) ? value : null
}
const USAGE_TURN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const USAGE_TIER_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
const USAGE_ACCOUNT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const USAGE_STATUS_PATTERN = /^[a-z][a-z_]{0,31}$/

/* How many unfinished turns one session may hold a reading for. A turn that
   never completes never writes one, so without a ceiling a session that is
   interrupted repeatedly would grow this map for the life of the process. */
const MAX_PENDING_TURN_USAGE = 32

/* WRITE DOWN WHAT A TURN COST, FROM THE EVENTS THAT ALREADY PASS THROUGH HERE.
 *
 * This is the recording side of the metrics repair, and it lives in the event
 * fan-out because that is the one place every session's events cross -- one
 * listener, in the main process, which is also the only process that may hold
 * the signing key. Doing it in the renderer would make the count depend on which
 * page happened to be open.
 *
 * RECORDED AT `turn_completed`, NOT AT EVERY `usage` EVENT, and the difference
 * is the difference between a figure and a fiction. Codex emits a usage event on
 * every thread/tokenUsage/updated -- several per turn -- each carrying the
 * session's RUNNING TOTAL and the last turn's figures. Writing one record per
 * event would put the same tokens on the page as many times as the engine
 * happened to report them. So the latest reading for a turn is held, and it is
 * written once, when the engine says that turn is over.
 *
 * AND NOTHING IS FLUSHED WHEN A SESSION CLOSES MID-TURN, deliberately. The
 * reading held for an unfinished turn is whatever the engine last said, and for
 * codex that can still be the PREVIOUS turn's figures -- so writing it out at
 * close would attribute one turn's tokens to another. A turn that never
 * completed is a turn this record has no figure for, which is the honest state
 * and the one the page can say.
 */
function noteAgentTurnUsage(session, packet) {
  const event = packet && typeof packet === 'object' ? packet.event : null
  if (!event || typeof event !== 'object') return
  const turnId = typeof event.turnId === 'string' && event.turnId.length > 0 ? event.turnId : ''

  if (event.type === 'usage') {
    const reading = turnUsageFrom(event.usage)
    if (!reading) return
    if (!session.usageByTurn) session.usageByTurn = new Map()
    if (!session.usageByTurn.has(turnId) && session.usageByTurn.size >= MAX_PENDING_TURN_USAGE) {
      session.usageByTurn.delete(session.usageByTurn.keys().next().value)
    }
    session.usageByTurn.set(turnId, reading)
    return
  }
  if (event.type !== 'turn_completed') return
  const reading = session.usageByTurn && session.usageByTurn.get(turnId)
  if (!reading) return
  session.usageByTurn.delete(turnId)

  try {
    getUsageRecorder().recordTurn({
      sessionId: packet.sessionId,
      /* The same identity the run record carries, read in the main process from
         the account store -- never from the renderer, for the reason
         accountPrincipal() states at length. */
      principal: accountPrincipal(),
      turnId: usageLabel(turnId, USAGE_TURN_PATTERN),
      tier: usageLabel(session.tier, USAGE_TIER_PATTERN),
      account: usageLabel(session.account, USAGE_ACCOUNT_PATTERN),
      status: usageLabel(typeof event.status === 'string' ? event.status.toLowerCase() : null, USAGE_STATUS_PATTERN),
      usage: reading,
    })
  } catch {
    /* A record that cannot be written must never be able to stop an agent from
       answering. The page reads an empty record as an empty record and says so. */
  }
}

/* COUNT THE TURNS THAT ENDED, AND KEEP THE ENGINE'S LAST WORD FOR ONE, so the
 * session's end record can say how much it did and how its last turn went.
 *
 * COUNTED HERE, IN THE SAME FAN-OUT THE USAGE RECORD USES, because this is the
 * one place every session's events cross in the main process. `usageByTurn`
 * beside it holds only PENDING readings and forgets a turn the moment it ends,
 * so it never was a count of anything; this is. It counts the engine's own
 * `turn_completed` events -- the contract's single word for "this turn is over",
 * whatever its status -- so a turn the person interrupted counts as a turn that
 * ended, which is what it was.
 *
 * ZERO IS A TRUE ANSWER, not an unknown. The session is put in the map before
 * the engine is asked to start it (mc-agent:start), and this listener is bound
 * when the host is built, so every completion for a session this process holds
 * passes through here. A session stopped before it answered genuinely completed
 * none. (For a RESUMED thread this counts the turns of THIS run only; the turns
 * an earlier run completed were that run's to record.)
 *
 * THE STATUS IS KEPT VERBATIM. codex says `completed`, the Claude CLI says
 * `success`, the host says `failed` for a child that died mid-turn -- three
 * words for two outcomes, and the two engines disagree on the first. Nothing
 * here lower-cases, maps or normalises it (the usage record beside this does
 * lower-case its copy, for its own reasons; this one does not). The recorder
 * bounds it to a bare word and REFUSES anything else, and the reader translates. */
function noteAgentTurnCompleted(session, packet) {
  const event = packet && typeof packet === 'object' ? packet.event : null
  if (!event || typeof event !== 'object' || event.type !== 'turn_completed') return
  session.turnsCompleted = (Number.isSafeInteger(session.turnsCompleted) ? session.turnsCompleted : 0) + 1
  session.lastTurnStatus = typeof event.status === 'string' && event.status.length > 0 ? event.status : null
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

/* What has actually run on this computer. The home screen asks, because a
   person opening this product on one machine with nothing else connected has a
   real answer available -- their own sessions -- and used to be shown five
   unavailability notices about a fleet they never had instead.

   The recorder drops paths, hashes and signatures before returning (see
   history() there); this wrapper adds only the same never-throws contract every
   other agent channel keeps. */
function spawnRecordHistory(limit) {
  try {
    return getSpawnRecorder().history({ limit })
  } catch (error) {
    return Object.freeze({
      ok: false,
      code: typeof error?.code === 'string' ? error.code : 'SPAWN_RECORD_UNAVAILABLE',
    })
  }
}

/* The product account, built lazily for the same two reasons the spawn
   recorder is: safeStorage is only meaningful after the app is ready, and
   userData is not resolvable before then. */
let accountStore = null
function getAccountStore() {
  if (accountStore) return accountStore
  /* `sharedAccountStore`, not `createAccountStore`. Any other main-process
     consumer that needs to know who is signed in -- the purchase-approval
     surface is the first -- must call the same function and get this same
     instance. Two instances would each hold their own idea of the session
     whenever the OS keystore is unavailable, and the audit record would then
     name whichever one it happened to ask. */
  accountStore = sharedAccountStore({
    safeStorage,
    directory: app.getPath('userData'),
  })
  return accountStore
}

/**
 * Who this installation is recording work against.
 *
 * READ HERE, IN THE MAIN PROCESS. This function is the whole reason the spawn
 * record's `principal` stopped being `null`, and the rule attached to it has
 * not changed: the value is never accepted from the renderer, because an
 * identity a page can choose is not an identity. Nothing in the `mc-account:*`
 * channels below sets it either -- they act on a username and a password and
 * the store decides what comes out.
 *
 * It CANNOT throw, and it never returns null. A damaged account file must not
 * be able to stop an agent from starting, so every failure resolves to the
 * stated `unauthenticated` -- an honest "nobody was signed in", which is a
 * fact worth recording rather than a reason to refuse.
 */
function accountPrincipal() {
  try {
    const value = getAccountStore().principal()
    return typeof value === 'string' && value.length > 0 && value.length <= 200
      ? value
      : UNAUTHENTICATED_PRINCIPAL
  } catch {
    return UNAUTHENTICATED_PRINCIPAL
  }
}

/* ---------- the account channels, in the signed ledger ----------
 *
 * Creating an account and signing in are external mutations: they write durable
 * state and they change who this installation acts as. Until now they wrote
 * NOTHING to the ledger -- measured 2026-08-12, an account creation, a saved
 * decision and a refused sign-in produced zero rows -- which made the product's
 * second sentence ("a tamper-evident ledger records what happened") false for
 * the whole `mc-account:*` surface. shell/canonical-audit.cjs explains why the
 * writer was reachable all along.
 *
 * WHO THE RECORD NAMES, AND WHAT IT REFUSES TO NAME. The target is a stable
 * digest of the normalized username, never the username itself and never the
 * password, verifier, salt or session token. That is enough to correlate an
 * intent with its outcome and to count attempts against one account, and it is
 * not a copy of somebody's personal data sitting in a file that is designed to
 * be impossible to edit afterwards. Where the account id is already known the
 * ledger carries the same `account:<id>` principal the spawn record uses, so
 * the two agree about who acted. */
/* WHICH installation's ledger, stated once. CAPABILITY_STATE_ROOT is the same
   value handed to shell/capability-layer.cjs, so the window and the layer
   cannot end up writing two different chains. Passed explicitly rather than
   left to the environment: the environment is already correct here, and a
   recorder that silently addresses whatever root it happens to find is how a
   packaged build ends up logging into its own read-only install directory. */
function recordCanonical(action, target, details) {
  return recordCanonicalIn(action, target, details, { stateRoot: CAPABILITY_STATE_ROOT })
}

function accountSubject(username) {
  const normalized = typeof username === 'string' ? username.trim().toLowerCase() : ''
  if (!normalized) return 'account:anonymous'
  return `account:${createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 32)}`
}

/* INTENT FIRST, THEN THE MUTATION, THEN THE OUTCOME.
 *
 * This is the shape the capability layer already uses for every bridge action
 * (durableReceipt() in the payload's src/lib/mission-bridge/actions.js) and the
 * reason it is that shape is the product's first sentence: the decision is
 * recorded BEFORE the thing happens, so an action that could not be recorded is
 * an action that did not happen. If the intent cannot be appended and anchored,
 * `run` is never called and the screen is told plainly.
 *
 * THE OUTCOME IS RECORDED EVEN WHEN IT IS A REFUSAL, and especially then: a
 * ledger that holds only successes cannot answer "who kept trying to get in",
 * which is most of what an account ledger is for. A failed sign-in is a fact.
 *
 * The outcome append is best-effort BY DESIGN. The mutation has already
 * happened by then, and throwing an error at somebody whose account was in fact
 * created would report a false failure -- the intent record already proves the
 * attempt, and a missing outcome next to a present intent is itself visible. */
async function auditedAccountAction({ action, username, run }) {
  const target = accountSubject(username)
  const intent = recordCanonical(`${action}.intent`, target, { surface: 'app.ipc' })
  /* ABSENT IS NOT FAILED -- the same distinction recordSpawnIntent draws, and
     for the same reason. A copy with no capability payload has no ledger to be
     missing from, and refusing every sign-in on a missing optional file would
     lock a person out of their own computer to protect a record that does not
     exist there. That case proceeds, and it is a real stated limit of such an
     install rather than something this code pretends away.

     A ledger that is PRESENT and refused is the case the product's first
     sentence is about, and it stops here. */
  if (!intent.ok && intent.code !== 'AUDIT_PAYLOAD_ABSENT') {
    return {
      ok: false,
      code: 'ACCOUNT_AUDIT_UNAVAILABLE',
      reason: 'This action was not recorded in the signed ledger, so it was not carried out.',
    }
  }
  const result = await run()
  const outcome = result && result.ok === true
  recordCanonical(action, target, {
    surface: 'app.ipc',
    outcome: outcome ? 'ok' : 'refused',
    /* The store's own typed refusal code -- never its prose, which can quote a
       value the person typed. */
    code: outcome ? null : (typeof result?.code === 'string' ? result.code : 'UNKNOWN'),
    principal: outcome && typeof result?.account?.id === 'string' ? `account:${result.account.id}` : null,
    intentSequence: intent.ok ? intent.sequence : null,
  })
  return result
}

/* Starting an agent is an external mutation: it creates a process. The audited
   dispatch action refuses without a durable receipt, and this path now behaves
   the same way. It writes BOTH records: the canonical signed chain first, and
   this app's own keystore-backed chain (shell/spawn-record.cjs) as well.

   THE CANONICAL ONE IS NEW HERE AND THE REASON IS THAT ITS STATED BLOCKER WAS
   FALSE. spawn-record.cjs was built as a separate chain because "the shipped
   payload has no vault (AUDIT_SIGNING_KEY_UNAVAILABLE)". The installed vault
   holds toolsenabled_audit_signing_key_v1 and toolsenabled_audit_head_v1 -- the
   capability layer creates them on first boot -- so the canonical writer was
   reachable. The app-local chain is KEPT rather than replaced: it needs only the
   OS keystore, so it still records on an installation whose payload is missing,
   which is exactly when the canonical one cannot.

   Recording FIRST and refusing on failure is the whole point: a session that
   could not be recorded is a session that does not start. */
function recordSpawnIntent(request) {
  /* The canonical chain first, and it is a GATE, exactly like the app-local one
     below: this is the record the product's claim is about, and a launch that
     is missing from it is the defect being fixed. `controller.agent.launch` is
     the action the rest of the system already reads for this -- see the
     payload's src/lib/controller-launch-record.js and the attribution
     projection that correlates sessions against it -- so an agent started from
     this window lands in the same place as one started by the controller
     instead of in a shape only this window writes. */
  const canonical = recordCanonical('controller.agent.launch', request.sessionId, {
    surface: 'app.ipc',
    principal: accountPrincipal(),
    cwd: request.cwd === undefined ? null : request.cwd,
  })
  /* ABSENT IS NOT THE SAME AS FAILED, and collapsing the two would brick the
     installation this fallback was built for.

     No payload means this copy has no canonical writer AT ALL -- there is no
     ledger here to be missing from, and the app-local chain below is the whole
     record by design. Refusing here would mean an install without the payload
     could no longer start an agent, which is a regression this change has no
     business causing.

     A payload that is present and REFUSED is the opposite: there is a ledger,
     it declined to record, and starting anyway is exactly the silent gap being
     fixed. That one refuses. */
  if (!canonical.ok && canonical.code !== 'AUDIT_PAYLOAD_ABSENT') {
    agentIpcError(
      'MC_AGENT_RECORD_UNAVAILABLE',
      'The agent session was not started because it could not be recorded: '
        + (typeof canonical.code === 'string' ? canonical.code : 'AUDIT_UNAVAILABLE'),
    )
  }
  let receipt
  try {
    receipt = getSpawnRecorder().record({
      action: 'agent_session_start',
      sessionId: request.sessionId,
      /* Read HERE, in the main process, and never accepted from the renderer:
         an identity a page can choose is not an identity. This was `null` until
         the product had an account system; it now carries the signed-in
         account, or the stated word `unauthenticated` when nobody is signed in.

         IT IS A RECORD, NOT A GATE. Starting an agent does not require being
         signed in, and this line must not be read as though it did. The record
         states who it was when it can and says plainly that it could not when
         it cannot; whether the product should refuse to start an agent for a
         signed-out person is a decision for the owner, and until he makes it
         the honest record is the one that does not pretend to be a lock. */
      principal: accountPrincipal(),
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

/* WHAT THE START ACTUALLY DID, recorded after it is known.
 *
 * THE LEDGER USED TO RECORD ONLY THE INTENT, and the intent is written BEFORE
 * the spawn on purpose (a session that could not be recorded does not start).
 * So the one record a run produced was written at the only moment its result
 * could not yet be known -- and nothing was ever appended afterwards. Three
 * starts that all refused left three `agent_session_start` lines byte-shaped
 * exactly like three that worked, and the home screen, having nothing else to
 * read, counted them and reported "3 agent runs on this computer. All 3 runs
 * still check out." That sentence was true of the RECORD and false about the
 * product, which is the worst way for a screen to be wrong: it does not fail,
 * it reassures.
 *
 * A SECOND RECORD, NOT A MUTATED FIRST ONE. The ledger is append-only and hash-
 * chained; going back to stamp a result onto the start record would mean
 * rewriting a signed line, which is the one thing this file exists to make
 * impossible. `outcome.resolves` carries the start's sequence, so the pair is
 * explicit rather than inferred from adjacency -- two sessions starting at once
 * interleave, and "the record before this one" would have quietly mispaired
 * them.
 *
 * IT CANNOT FAIL A RUN, WHICH IS THE OPPOSITE OF recordSpawnIntent's RULE, and
 * the asymmetry is deliberate. Refusing to start something that cannot be
 * recorded is correct: nothing has happened yet. Killing a session that IS
 * ALREADY RUNNING because the note about it did not save would destroy the very
 * thing the note describes. So every failure here is swallowed, and the run is
 * left with no outcome record -- which the screen reports as an outcome it does
 * not know, never as a success. Silence must read as silence. */
function recordSpawnOutcome(request, receipt, result, reason) {
  if (!receipt || !Number.isSafeInteger(receipt.sequence)) return
  try {
    getSpawnRecorder().record({
      action: 'agent_session_outcome',
      sessionId: request.sessionId,
      principal: accountPrincipal(),
      details: {},
      outcome: {
        resolves: receipt.sequence,
        result,
        /* A bare code or nothing. The recorder enforces this too -- it refuses
           anything that is not /^[A-Z][A-Z0-9_]{0,63}$/ -- so a caller that
           reached for error.message would be rejected rather than published. */
        reason: typeof reason === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(reason) ? reason : null,
      },
    })
  } catch {
    /* Deliberately silent; see the note above on why this must not fail a run. */
  }
}

/* HOW THE SESSION ENDED, recorded when it is known.
 *
 * THE LEDGER WROTE TWO LINES PER RUN AND NEVER A THIRD. The intent before the
 * spawn; started/refused when the start resolved; and then nothing, ever, no
 * matter how the session ended -- so the product could not truthfully show a
 * finished state or a duration anywhere, and the home screen says so in as many
 * words. This is the third record. It is a SEPARATE line, for the same reason
 * the outcome is: the chain is append-only, and `end.resolves` names the start
 * it ends explicitly rather than by adjacency.
 *
 * WHERE THE ENDINGS ARE OBSERVABLE, VERIFIED AGAINST THE CODE RATHER THAN
 * ASSUMED, and each one hooked where it is:
 *
 *   closed        mc-agent:close, AFTER agentHost.closeSession() resolves. A
 *                 close that rejects leaves the session in the map and this
 *                 record unwritten, because the process may still be alive.
 *   exited        the host's onSessionExit report (shell/agent-host.cjs
 *                 observeEngineExit), which is the ONLY place the child's own
 *                 exit is visible shell-side: neither adapter emits an event
 *                 for it, and this file had no view of it at all before that
 *                 hook existed. The host reports it only for a session it did
 *                 not close itself.
 *   app-shutdown  best-effort, on the two orderly ways out: the window's owner
 *                 being destroyed (bindAgentOwner) and before-quit. Written
 *                 synchronously before the session leaves the map, so an
 *                 orderly quit usually lands it. A quit that does not -- a hard
 *                 kill, a crash, a power cut -- leaves NO end record, and that
 *                 absence must keep reading as "this record does not say".
 *                 NOTHING backfills it on the next launch: an ending this
 *                 process did not observe is not this process's to assert.
 *   crashed       in the recorder's closed set and written by NOTHING here.
 *                 A truthful `crashed` needs evidence -- a start with no end
 *                 AND a dead pid this app owns -- and this file records no pid.
 *
 * ONE END PER SESSION, ENFORCED HERE. The endings race: a stop from the
 * interface kills the child, whose exit the host then suppresses because the
 * close was requested -- but the owner-destroyed path and before-quit can both
 * see the same session, and `ended` is what keeps a second line from being
 * written for it. It is set BEFORE the write, so a write that throws leaves the
 * session with no end record rather than with a later, different reason.
 *
 * NO DURATION, BY DESIGN. The start record and this one are two signed instants
 * and the reader subtracts them; a span computed here would be a claim the chain
 * cannot check, signed with an authority it has not earned.
 *
 * IT CANNOT FAIL ANYTHING. Same rule as recordSpawnOutcome: a session that has
 * ended is not made un-ended by a note about it failing to save. Every failure
 * is swallowed and the run is left with no end record, which the reader shows
 * as an ending it does not know -- never as still running, never as finished. */
function recordSessionEnd(session, sessionId, reason) {
  if (!session || session.ended === true) return
  /* Only a session whose start was recorded as `started` has a start to
     resolve. A refused start never ran, and its cleanup is not an ending. */
  if (!session.started || !Number.isSafeInteger(session.started.sequence)) return
  session.ended = true
  try {
    getSpawnRecorder().record({
      action: 'agent_session_end',
      sessionId,
      principal: accountPrincipal(),
      details: {},
      end: {
        resolves: session.started.sequence,
        reason,
        turns: session.turnsCompleted,
        lastTurnStatus: session.lastTurnStatus,
      },
    })
  } catch {
    /* Deliberately silent; see above. */
  }
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
 * MEASURED 2026-08-10, engine run under the shipped `ToolsEnabled.exe`:
 *   cwd = <any real directory>     -> START OK, threadId issued
 *   cwd = <app>\resources\app.asar -> CODEX_APP_SERVER_EXITED
 *     "spawn <app>\ToolsEnabled.exe ENOENT"
 * Same binary, same engine, same auth; only the cwd differed.
 *
 * (Those paths are written as placeholders on purpose: this comment ships
 * inside the asar, and check-no-owner-data.js correctly rejected the build
 * when an earlier draft pasted the builder's real checkout path here.)
 *
 * The third dev-only-works bug in this path, and the same shape as the other
 * two: a value that is a real thing in a checkout and a virtual one inside the
 * asar. The workspace root is a genuine directory that the app creates on
 * every start, so it is correct on a customer's machine and in a checkout --
 * and it is also where the user's work actually is, which is where an agent
 * should be running in the first place. */
/* The one place the agent's working directory is prepared, called by BOTH the
   probe and the start. Availability has to answer the question the start will
   ask, and it cannot do that by validating a directory the start would have
   created after the probe ran: a fresh install would report "no workspace" once
   and be told it was broken. Creating it here, from both callers, is idempotent
   and keeps the two answers derived from one act rather than two. */
function ensureWorkspaceRoot() {
  try { fs.mkdirSync(WORKSPACE_ROOT, { recursive: true }) } catch { /* normalizeCwd reports an unusable workspace */ }
  return WORKSPACE_ROOT
}

/* THE FOLDER THE PERSON CHOSE IN SETUP, OR NULL — the answer to "where should
 * an agent that names no folder run".
 *
 * Measured on the 2026-08-18 fresh-install walkthrough: setup created and
 * git-initialised the chosen folder, and the agent then ran in
 * <userData>\workspace while the audit recorded cwd:null. The fence — the
 * permission level's write confinement, which both engines anchor on the
 * session's working directory — was real but anchored on a folder nobody
 * chose, and the promised undo history sat on a folder nothing used.
 *
 * `chosen` IS THE GATE, not the mere presence of roots. recordTier picks a
 * default folder silently before the workspace question is shown, and
 * setup-record.cjs stamps `workspaceChosen` only when a person was shown the
 * question and answered it. A default nobody saw stays what it always was:
 * nothing, and the start falls back to WORKSPACE_ROOT above.
 *
 * The folder is re-created if it was deleted — an empty directory is the same
 * promise setup made, and refusing every future start over a folder the person
 * removed would strand them. A folder that cannot be created is left for
 * normalizeCwd in the host, which refuses the start loudly and by name rather
 * than silently moving the agent somewhere nobody chose. */
function chosenWorkspaceCwd() {
  try {
    const state = readWorkspaceState()
    if (!state || state.ok !== true || state.available !== true) return null
    if (state.chosen !== true) return null
    const roots = Array.isArray(state.roots)
      ? state.roots.filter(entry => typeof entry === 'string' && entry.trim() !== '')
      : []
    if (roots.length === 0) return null
    const root = roots[0]
    try { fs.mkdirSync(root, { recursive: true }) } catch { /* the host's normalizeCwd refuses an unusable folder loudly */ }
    return root
  } catch {
    return null
  }
}

/* THE TOOL CHECKBOXES, ENFORCED — the settings row the research page writes,
 * read back at the one point every agent child's environment is composed.
 *
 * The row is `agent_tools_disabled`: a JSON array of registry tool names the
 * signed-in person switched OFF. The env var the engine enforces is an
 * ALLOWLIST, so the composition is registry-minus-disabled — and three
 * absences all mean "narrow nothing": nobody signed in (settings belong to an
 * account), no row, an empty list. Two states REFUSE the start instead of
 * widening it: a damaged read (the person recorded limits this process cannot
 * see) and every-tool-disabled — the engine reads an EMPTY allowlist string as
 * the full profile, the exact absence-as-consent inversion its own registry
 * comment warns about, so that state must never reach the spawn. */
const AGENT_TOOLS_DISABLED_KEY = 'agent_tools_disabled'

function agentToolAllowlistExtras() {
  const read = getAccountStore().getSetting(AGENT_TOOLS_DISABLED_KEY)
  if (!read.ok) {
    if (read.code === 'ACCOUNT_NOT_SIGNED_IN') return { ok: true, env: null }
    return { ok: false, code: 'AGENT_TOOL_LIMITS_UNREADABLE' }
  }
  if (read.value === null || read.value === undefined) return { ok: true, env: null }
  let disabled
  try { disabled = JSON.parse(read.value) } catch { return { ok: false, code: 'AGENT_TOOL_LIMITS_UNREADABLE' } }
  if (!Array.isArray(disabled) || disabled.some(name => typeof name !== 'string')) {
    return { ok: false, code: 'AGENT_TOOL_LIMITS_UNREADABLE' }
  }
  if (disabled.length === 0) return { ok: true, env: null }
  const listed = listAgentTools({ capabilityRoot: resolveCapabilityRoot() })
  if (!listed.ok) return { ok: false, code: 'AGENT_TOOL_LIMITS_UNREADABLE' }
  const disabledSet = new Set(disabled)
  const allowed = listed.tools.map(tool => tool.name).filter(name => !disabledSet.has(name))
  if (allowed.length === 0) return { ok: false, code: 'AGENT_TOOLS_ALL_DISABLED' }
  if (allowed.length === listed.tools.length) return { ok: true, env: null }
  return { ok: true, env: { TOOLSENABLED_TOOL_ALLOWLIST: allowed.join(',') } }
}

/* WHICH OF THE PERSON'S OWN SIGN-INS A SESSION RUNS ON, AND WHO DECIDES.
 *
 * THE ANSWER COMES FROM THE ROW THE PERSON ACTUALLY SET. `failover` is the
 * walkthrough question "If an account runs out", and its two answers are its
 * own words: "Stop and let me switch" and "Switch to another account
 * automatically". Until now nothing read it, which is what made it a setting in
 * name only. This is the reader. There is exactly ONE, and it reads the store
 * the screen writes -- not a copy -- so the screen and the behaviour cannot
 * disagree.
 *
 * IT DEFAULTS TO THE CAUTIOUS HALF ON EVERY UNCERTAINTY. An unreadable record, a
 * missing answer, an answer that is not one of the two: all mean "stop and let
 * me switch". Switching accounts spends a different subscription, and doing that
 * because a file would not parse is not a decision anybody made.
 *
 * IT NEVER STOPS A START IT HAS NO REASON TO STOP. A payload without the module,
 * a machine with no account list, a fault anywhere in here: all answer null, and
 * null is the path this program took before any of this existed.
 *
 * PROVIDER LIMITS ARE SURFACED, NEVER WORKED AROUND. Rotation moves between
 * accounts the same person subscribes to; each account's own limit is respected
 * on its own terms, an exhausted one is skipped rather than retried, and moving
 * at all is the person's explicit choice recorded above. */
function failoverModeFromProfile() {
  try {
    const stored = rendererPrefs.snapshot().values['mc.setup.profile']
    if (typeof stored !== 'string') return 'manual'
    const parsed = JSON.parse(stored)
    const answer = parsed && parsed.answers && parsed.answers.failover
    return answer === 'auto' ? 'auto' : 'manual'
  } catch {
    return 'manual'
  }
}

let rotationModule
function loadRotation() {
  if (rotationModule !== undefined) return rotationModule
  rotationModule = null
  try {
    /* The SAME engine trees the agent host itself resolves, in the same order,
       so rotation can never be read out of one copy while sessions start from
       another. engineCandidates() names the engine module; its tree is three
       directories up, which is how the host derives it too. */
    for (const candidate of engineCandidates()) {
      try {
        const engineRoot = path.resolve(path.dirname(candidate.value), '..', '..', '..')
        const loaded = require(path.join(engineRoot, 'src', 'lib', 'multi-account', 'rotation.js'))
        if (loaded && typeof loaded.resolveAccountForSession === 'function') { rotationModule = loaded; break }
      } catch { /* try the next tree */ }
    }
  } catch {
    /* A copy whose engine predates this module keeps starting sessions on the
       one sign-in it has, which is exactly what it did before. */
  }
  return rotationModule
}

async function resolveSessionAccount({ provider }) {
  const rotation = loadRotation()
  if (!rotation) return null
  try {
    return await rotation.resolveAccountForSession({
      provider,
      servicesRoot: resolveServicesRootForAccounts(),
      mode: failoverModeFromProfile(),
    })
  } catch {
    return null
  }
}

/* The same directory the machine record lives in, resolved the same way the
   payload resolves it. Two answers to "where is this computer's account list"
   would be two account lists. */
function resolveServicesRootForAccounts() {
  const localAppData = process.env.LOCALAPPDATA
  if (typeof localAppData === 'string' && path.isAbsolute(localAppData)) {
    return path.join(localAppData, 'ToolsEnabled')
  }
  return path.join(require('node:os').homedir(), '.toolsenabled')
}

function getAgentHost() {
  if (agentHost) return agentHost
  ensureWorkspaceRoot()
  const host = createAgentHost({
    defaultCwd: WORKSPACE_ROOT,
    sessionEnvironmentExtras: agentToolAllowlistExtras,
    accountResolver: resolveSessionAccount,
  })
  removeAgentEventListener = host.onEvent((packet) => {
    const session = agentSessions.get(packet.sessionId)
    if (!session) return
    if (!session.owner.isDestroyed()) {
      try {
        session.owner.send(AGENT_EVENT_CHANNEL, packet)
      } catch {
        // Destruction can race this check; the owner cleanup closes the session.
      }
    }
    /* AFTER the forward, and outside the owner check. After, because a screen
       must not wait on a disk write for its text; outside, because what a turn
       cost is a fact about this computer, not about whether a window is still
       open to look at it. */
    noteAgentTurnUsage(session, packet)
    noteAgentTurnCompleted(session, packet)
  })
  /* THE CHILD'S OWN EXIT -- the second genuine ending, and the one this file
     could not see until the host reported it. Recorded against the session
     this process holds; the session is deliberately LEFT in the map, exactly
     as the host leaves its own, so a stop the person presses afterwards still
     resolves (and writes no second ending, see recordSessionEnd). */
  host.onSessionExit((report) => {
    const session = agentSessions.get(report.sessionId)
    if (!session) return
    if (!session.started) {
      /* Died before the start was written down as started: remember it, and
         let mc-agent:start record the ending once the start receipt exists. */
      session.exitedBeforeStarted = true
      return
    }
    recordSessionEnd(session, report.sessionId, 'exited')
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
  /* EVERY condition a start needs, from the same values the start uses, IN THE
     ORDER THE START REFUSES IN.

     Reporting a subset would let the surface offer a control that the start
     handler then refuses -- which is exactly what shipped: this used to ask
     engineAvailability() a question about the ENGINE ALONE while startSession()
     additionally required the confinement planner, the launch-environment
     scrub, and a usable working directory. `defaultCwd` is passed rather than
     defaulted so the probe validates the directory the session will actually
     run in, prepared by the same ensureWorkspaceRoot() getAgentHost() calls.

     THE RECORDER FIRST, because that is the order mc-agent:start refuses in:
     recordSpawnIntent() runs before getAgentHost().startSession(). Asking in
     the other order meant that an installation with BOTH faults was told about
     the engine while the press would have told it about the record -- the
     smaller version of the same defect, sending a person to fix the wrong
     thing. Both are still required; only which one is named first changed. */
  const record = spawnRecordAvailability()
  if (record.ok !== true) return record
  return engineAvailability({ defaultCwd: ensureWorkspaceRoot() })
})

/* WHAT A SESSION STARTED HERE WOULD BE ALLOWED TO DO. A read, like availability
   and history, and for the same reason it sits beside them: the agent page has to
   describe the session before it offers to start one, and until this channel
   existed it could not. It described it anyway -- from a frozen sentence written
   before tier confinement landed -- which is the defect this repairs.

   Same sender check as every other agent channel. The reply carries a tier name,
   a sandbox word and two counts; it carries no path, because the resolver's own
   messages name absolute roots and rendering one into the DOM is BLOCKER 2.
   See shell/agent-confinement-read.cjs for what it measures and why nothing here
   is a constant. */
ipcMain.handle('mc-agent:confinement', async (event) => {
  assertTrustedAgentSender(event)
  return readAgentConfinement({ capabilityRoot: resolveCapabilityRoot() })
})

/* The tool surface BY NAME, for the research page's checkboxes. A read like
   the confinement channel above: starts nothing, carries registry identifiers
   only (never a path), {ok:false, code} when the payload cannot answer. */
ipcMain.handle('mc-agent:tools', async (event) => {
  assertTrustedAgentSender(event)
  return listAgentTools({ capabilityRoot: resolveCapabilityRoot() })
})

/* THE MESSAGES THIS COMPUTER HAS ALREADY WRITTEN DOWN, for the comms page.
 *
 * A fourth channel that starts nothing. It exists because the preload is
 * sandboxed under contextIsolation and cannot reach the message fabric itself,
 * and no existing mc-agent channel carries messages -- so the page had no way to
 * show a real one and was showing nothing, or something it made up.
 *
 * IT IS A READ OF A RECORD THAT ALREADY EXISTS. Every local send writes the
 * owner journal; this reads it. It is emphatically not a second copy of the
 * message store, which would be two answers to one question the first time they
 * disagreed.
 *
 * IT CARRIES NO PATH AND NO INTERNAL IDENTIFIER a person cannot act on: a
 * message is {id, sender, at, text}, `at` RFC3339, `sender` the circle name.
 *
 * IT DEGRADES HONESTLY RATHER THAN THROWING. A payload cut before the provider
 * grew ownerJournal() answers {ok:false, reason} -- a sentence the page can show
 * -- instead of rejecting the invoke, because "this build cannot read messages
 * yet" and "the messages could not be read" are different things to be told. */
ipcMain.handle('mc-agent:local-messages', async (event, value) => {
  assertTrustedAgentSender(event)
  try {
    const engineRoot = resolveCapabilityRoot()
    if (!engineRoot) return { ok: false, reason: 'the live message reader is not available in this build' }
    const journal = require(path.join(engineRoot, 'src', 'lib', 'providers', 'agent-comms-local.js'))
    /* Bounded here rather than trusted from the page: the renderer is the one
       caller, and a caller that can ask for everything is a caller that can be
       made to. */
    const limit = Number.isSafeInteger(value?.limit) ? Math.min(Math.max(value.limit, 1), 200) : 100
    return await journal.ownerJournal({ limit })
  } catch {
    return { ok: false, reason: 'the live message reader is not available in this build' }
  }
})

/* WHICH TIERS THIS INSTALLATION CAN ACTUALLY START.
 *
 * The renderer used to answer this from a frozen list of provider names, so the
 * tier menu said "cannot start from a tree yet" on a build that could, and would
 * have kept saying it after the engine shipped. This is the shell answering with
 * what it really resolved: startableTiers() runs the SAME resolveStartTier() the
 * press runs, so the menu and the press cannot disagree.
 *
 * FAIL-CLOSED AT THE OTHER END. A renderer that gets no answer, or an answer it
 * cannot parse, must fall back to codex-only -- exactly today's behaviour -- so
 * an older payload or a browser with no bridge is unchanged. This end simply
 * refuses to invent one: if the host cannot be built, the invoke rejects and the
 * renderer takes its fallback.
 *
 * It starts nothing and carries no path; tier ids are the renderer's own words. */
ipcMain.handle('mc-agent:startable-tiers', async (event) => {
  assertTrustedAgentSender(event)
  const host = await getAgentHost()
  return host.startableTiers()
})

/* WHICH ASSISTANT PROGRAMS ARE ON THIS COMPUTER, AND WHICH ARE SIGNED IN.
 *
 * The third channel that starts nothing. It exists because the product could
 * not answer the first question a person has after being told an agent needs
 * Codex, Claude or Gemini: have I got it, and am I signed in. The guide printed
 * the commands and could not say whether they had already been run.
 *
 * IT READS NO CREDENTIAL AND SPAWNS NOTHING, and neither is a promise made
 * here. shell/provider-cli-presence.cjs contains no call that returns file
 * contents and none that starts a process; tools/test/provider-cli-presence.test.mjs
 * reads that source and fails on eighteen of them, because the property is an
 * ABSENCE of code and no behavioural test can observe an absence.
 *
 * IT CARRIES NO PATH, exactly like the two channels above it. The answer is
 * {ok, providers:[{id, installed, signedIn}]} and every value is a word from a
 * closed set -- so the resolution can look at %APPDATA%, at PATH, and at a home
 * directory without any of those reaching a renderer. That is the BLOCKER 2 rule
 * this file already applies to the engine resolver's own message.
 *
 * SAME SENDER CHECK AS EVERY OTHER AGENT CHANNEL. What is installed on this
 * machine and who is signed in to it is not something any frame that happens to
 * be loaded may ask for, even though nothing here can change anything.
 *
 * IT CANNOT FAIL, which is why there is no {ok:false} branch to write. Every
 * uncertainty this read can suffer is already expressed as 'unknown' on the one
 * provider it applies to; an envelope-level failure would be a second way of
 * saying the same thing, and a caller branching on it would be branching on
 * nothing. */
ipcMain.handle('mc-providers:presence', async (event) => {
  assertTrustedAgentSender(event)
  return providerCliPresence()
})

/* THE PERSON'S OWN ACCOUNTS, OVER THE SAME BOUNDARY AND UNDER THE SAME CHECK.
 *
 * SAME SENDER TEST AS EVERY OTHER AGENT CHANNEL, and here it is not a formality:
 * `add` writes a file the engine reads to decide which sign-in an agent runs on.
 * A frame that could reach it could point somebody's next agent at a directory
 * they never chose.
 *
 * THE COMMAND IS BUILT HERE, NOT IN THE WINDOW. Each listed account carries the
 * exact line a person pastes into their terminal to sign that folder in, and
 * that line contains a resolved absolute path. The window never assembles one --
 * it prints what this process worked out, which is the same division the session
 * profiles already use for folders.
 *
 * `active` RIDES ALONG WITH THE LIST because they are one question on screen:
 * "which of my accounts is this computer on right now" is unanswerable from the
 * list alone. It is a separate read in the store and a separate optional file on
 * disk, and a missing one degrades to "not known" rather than to a failure. */
ipcMain.handle('mc-accounts:list', (event) => {
  assertTrustedAgentSender(event)
  try {
    const answer = accountRegistry.list()
    return {
      ...answer,
      accounts: answer.accounts.map(account => ({
        ...account,
        command: accountRegistry.signInCommand({ provider: account.provider, directory: account.directory }),
      })),
      active: accountRegistry.activeAccount(),
    }
  } catch (error) {
    throw rendererSafeAgentError(error)
  }
})

ipcMain.handle('mc-accounts:add', (event, value) => {
  assertTrustedAgentSender(event)
  try {
    const payload = agentPayload(value, ['name', 'provider', 'directory', 'priority'])
    return accountRegistry.add({
      name: boundedAgentString(payload.name, 'name', 64),
      provider: boundedAgentString(payload.provider, 'provider', 32),
      directory: boundedAgentString(payload.directory, 'directory', 1024),
      ...(payload.priority === undefined ? {} : { priority: payload.priority }),
    })
  } catch (error) {
    throw rendererSafeAgentError(error)
  }
})

ipcMain.handle('mc-accounts:remove', (event, value) => {
  assertTrustedAgentSender(event)
  try {
    const payload = agentPayload(value, ['name', 'provider'])
    return accountRegistry.remove({
      name: boundedAgentString(payload.name, 'name', 64),
      provider: boundedAgentString(payload.provider, 'provider', 32),
    })
  } catch (error) {
    throw rendererSafeAgentError(error)
  }
})

/* The second agent channel that starts nothing, and the only one that reads
   backwards. Same sender check as every other agent channel: this returns a
   record of what ran on this machine, which is not something any frame that
   happens to be loaded may ask for. */
ipcMain.handle('mc-agent:history', async (event, value) => {
  assertTrustedAgentSender(event)
  const payload = agentPayload(value === undefined || value === null ? {} : value, ['limit'])
  return spawnRecordHistory(payload.limit)
})

/* The third agent channel that starts nothing. Same sender check and same
   never-throws contract as history() above; it returns what the turns on this
   computer cost, which is no more anybody's to ask for than the run record is. */
ipcMain.handle('mc-agent:usage', async (event, value) => {
  assertTrustedAgentSender(event)
  const payload = agentPayload(value === undefined || value === null ? {} : value, ['limit'])
  return usageRecordHistory(payload.limit)
})

ipcMain.handle('mc-agent:start', async (event, value) => {
  assertTrustedAgentSender(event)
  const request = parseAgentStart(value)
  if (request.profileId) {
    /* Resolved HERE, not in the renderer and not in the host: the store only
       holds folders the person picked through the OS dialog, and a stale or
       unknown profile refuses the start loudly instead of spawning an agent
       somewhere nobody chose. The resolved cwd replaces any renderer-sent
       one; profileId is authoritative when present. */
    try {
      request.cwd = sessionProfiles.resolveCwd(request.profileId)
    } catch (error) {
      agentIpcError(
        'MC_AGENT_' + (typeof error?.code === 'string' ? error.code : 'PROFILE_UNKNOWN'),
        'That session profile could not be used: pick the folder again in its settings.',
      )
    }
    delete request.profileId
  }
  /* A START THAT NAMES NO FOLDER RUNS IN THE ONE THE PERSON CHOSE IN SETUP.
     Resolved HERE, before recordSpawnIntent below, so the signed record and
     the app-local record both carry the real folder instead of cwd:null —
     and so the confinement the host binds at spawn anchors on the chosen
     folder rather than on <userData>\workspace, which stays only as the
     fallback for a machine where nobody was ever asked (chosenWorkspaceCwd
     answers null there, and the host's defaultCwd takes over exactly as it
     always has). A profile pick above still wins: it is the more specific
     answer, given per-session rather than once at setup. */
  if (request.cwd === undefined) {
    const chosen = chosenWorkspaceCwd()
    if (chosen) request.cwd = chosen
  }
  if (agentSessions.has(request.sessionId)) {
    agentIpcError('MC_AGENT_SESSION_EXISTS', 'Session already exists: ' + request.sessionId)
  }
  if (agentSessions.size >= MAX_AGENT_SESSIONS) {
    agentIpcError('MC_AGENT_SESSION_LIMIT', 'At most ' + MAX_AGENT_SESSIONS + ' agent sessions may be open')
  }

  /* Before anything is spawned. If this throws, no process was created and
     nothing needs unwinding -- which is why it comes first. */
  const record = recordSpawnIntent(request)

  /* `turnsCompleted` starts at ZERO, not undefined, because zero is the true
     count for a session that is stopped before it ever answered, and the end
     record must be able to say so rather than "unknown". */
  const session = { owner: event.sender, state: 'starting', turnsCompleted: 0, lastTurnStatus: null, ended: false }
  agentSessions.set(request.sessionId, session)
  bindAgentOwner(event.sender)
  try {
    const result = await getAgentHost().startSession(request)
    session.state = 'ready'
    /* WHAT THIS SESSION IS RUNNING AS, kept so every usage record it writes can
       say which model row and which of the person's own sign-ins it belongs to.
     *
     * `request.tier`, NOT `result.tier`, AND THAT WAS MEASURED THE WRONG WAY
     * ROUND FIRST. The two fields share a name and mean different things:
     * `request.tier` is the MODEL ROW a person chose (`luna`, `claude-sonnet` --
     * the START_TIERS table in shell/agent-host.cjs), while the result's `tier`
     * is the CONFINEMENT level the session was planned at. A real luna turn on
     * 2026-08-18 wrote `tier: "unrestricted"` into its usage record, so the
     * metrics page grouped a Codex session under "Not recorded" -- a true
     * statement about a sandbox level, filed as an answer to "which assistant".
     *
     * Null when the person named no row, which is the honest "this record does
     * not say" every reader downstream already handles. The account comes from
     * the result because the result is the only place that says which of the
     * person's sign-ins actually served. */
    session.tier = typeof request.tier === 'string' ? request.tier : null
    session.account = typeof result.account === 'string' ? result.account : null
    recordSpawnOutcome(request, record, 'started', null)
    /* THE START THIS SESSION'S ENDING WILL RESOLVE. Kept on the session object
       so recordSessionEnd() can name it from any of the places a session ends,
       and set only now -- after `started` is written -- because a refused start
       has no run to end. If the child was already reported gone (see the
       onSessionExit hook in getAgentHost), that ending is written here. */
    session.started = { sequence: record.sequence }
    if (session.exitedBeforeStarted === true) recordSessionEnd(session, request.sessionId, 'exited')
    /* The receipt travels back with the session so the surface can show that
       the start was recorded, rather than asserting it. */
    return { ...result, record: { sequence: record.sequence, eventHash: record.eventHash } }
  } catch (error) {
    if (error && error.code === 'AGENT_SESSION_CLEANUP_FAILED') {
      session.state = 'close-failed'
    } else if (agentSessions.get(request.sessionId) === session) {
      agentSessions.delete(request.sessionId)
    }
    /* Recorded BEFORE the throw, because the throw leaves this process and the
       reason is only in scope here. `error.code` is the engine's or the host's
       own bounded identifier -- the same value the renderer is about to be
       given -- so the ledger and the screen name the failure identically. */
    recordSpawnOutcome(request, record, 'refused', typeof error?.code === 'string' ? error.code : null)
    throw rendererSafeAgentError(error)
  }
})

/* The same boundary discipline as mc-agent:start, and it was missing here:
   without the wrap, a send to a session this run does not hold arrived in the
   renderer as raw prose ("Unknown sessionId: chat-…"), the code stayed behind
   as a stripped own-property, and the surface fell back to AGENT_SESSION_FAILED
   -- which tells the person to try again, the one thing that cannot work. */
ipcMain.handle('mc-agent:send', async (event, value) => {
  assertTrustedAgentSender(event)
  try {
    const request = parseAgentSend(value)
    const session = ownedAgentSession(event.sender, request.sessionId)
    /* THE SECURITY LINE FOR IMAGES: the renderer can never name an arbitrary
       disk path for the engine to read into model context. Only paths a
       person picked in this session's own native dialog ride — anything else
       refuses by name, whether typed, guessed or replayed from another
       session. */
    if (request.images && request.images.length) {
      const issued = session.attachments instanceof Set ? session.attachments : new Set()
      for (const image of request.images) {
        if (!issued.has(image.path)) {
          agentIpcError('MC_AGENT_ATTACHMENT_UNKNOWN', 'An attached file was not picked in this session, so nothing was sent')
        }
      }
    }
    return await agentHost.sendTurn({
      sessionId: request.sessionId,
      text: request.text,
      ...(request.images ? { images: request.images } : {}),
      ...(request.model ? { options: { model: request.model } } : {}),
    })
  } catch (error) {
    throw rendererSafeAgentError(error)
  }
})

/* THE ATTACHMENT PICKER — the only way a file path enters a session's image
   allowlist. A native dialog the person drives; the chosen path is issued to
   exactly this session and refused everywhere else. */
/* SESSION PROFILES over IPC. list/remove are plain store calls; create runs
   the OS folder dialog IN THIS PROCESS, so the only way a folder enters the
   store is the person choosing it in a native picker -- that dialog is the
   consent boundary the whole design rests on. */
ipcMain.handle('mc-agent:profiles', (event) => {
  assertTrustedAgentSender(event)
  return { ok: true, profiles: sessionProfiles.list() }
})

ipcMain.handle('mc-agent:profile-create', async (event, value) => {
  assertTrustedAgentSender(event)
  try {
    const payload = agentPayload(value, ['name'])
    const name = boundedAgentString(payload.name, 'name', 64)
    const picked = await dialog.showOpenDialog({
      title: 'Choose the folder agents in this profile work in',
      properties: ['openDirectory'],
    })
    if (picked.canceled || !picked.filePaths.length) return { ok: true, profile: null }
    const profile = sessionProfiles.create({ name, cwd: picked.filePaths[0] })
    return { ok: true, profile }
  } catch (error) {
    throw rendererSafeAgentError(error)
  }
})

ipcMain.handle('mc-agent:profile-remove', (event, value) => {
  assertTrustedAgentSender(event)
  try {
    const payload = agentPayload(value, ['profileId'])
    const removed = sessionProfiles.remove(boundedAgentString(payload.profileId, 'profileId', 128))
    return { ok: true, removed }
  } catch (error) {
    throw rendererSafeAgentError(error)
  }
})

ipcMain.handle('mc-agent:pick-attachment', async (event, value) => {
  assertTrustedAgentSender(event)
  try {
    const request = parseAgentSessionCommand(value)
    const session = ownedAgentSession(event.sender, request.sessionId)
    const picked = await dialog.showOpenDialog({
      title: 'Attach an image to this message',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    })
    if (picked.canceled || !picked.filePaths.length) return { ok: true, path: null }
    const chosen = picked.filePaths[0]
    if (!(session.attachments instanceof Set)) session.attachments = new Set()
    session.attachments.add(chosen)
    return { ok: true, path: chosen }
  } catch (error) {
    throw rendererSafeAgentError(error)
  }
})

/* THE MENTION PICKER — returns a path for the renderer to insert as TEXT.
   No allowlist: it becomes words in the message, and the agent's own
   confined tools do (or refuse) the reading. */
ipcMain.handle('mc-agent:pick-mention', async (event, value) => {
  assertTrustedAgentSender(event)
  try {
    const request = parseAgentSessionCommand(value)
    ownedAgentSession(event.sender, request.sessionId)
    const picked = await dialog.showOpenDialog({
      title: 'Mention a file in this message',
      defaultPath: WORKSPACE_ROOT,
      properties: ['openFile'],
    })
    if (picked.canceled || !picked.filePaths.length) return { ok: true, path: null }
    return { ok: true, path: picked.filePaths[0] }
  } catch (error) {
    throw rendererSafeAgentError(error)
  }
})

ipcMain.handle('mc-agent:interrupt', async (event, value) => {
  assertTrustedAgentSender(event)
  try {
    const request = parseAgentSessionCommand(value)
    ownedAgentSession(event.sender, request.sessionId)
    return await agentHost.interrupt(request)
  } catch (error) {
    throw rendererSafeAgentError(error)
  }
})

/* THE APPROVAL ANSWER — the reply half of approval_request. approvalPolicy is
   'never' at every tier, so nothing fires this today; the path exists FIRST,
   which is the ordering the confinement module's own comment demands before
   'on-request' may ever be offered. */
ipcMain.handle('mc-agent:approval-answer', async (event, value) => {
  assertTrustedAgentSender(event)
  try {
    const payload = agentPayload(value, ['sessionId', 'approvalId', 'decision'])
    const request = {
      sessionId: boundedAgentString(payload.sessionId, 'sessionId', MAX_SESSION_ID_LENGTH),
      approvalId: boundedAgentString(payload.approvalId, 'approvalId', 1024),
      decision: boundedAgentString(payload.decision, 'decision', 64),
    }
    ownedAgentSession(event.sender, request.sessionId)
    return await agentHost.answerApproval(request)
  } catch (error) {
    throw rendererSafeAgentError(error)
  }
})

/* REWIND — fork the session's thread at one of the person's own turns. The
   turnId must be one this session really returned; the host refuses a busy
   session so a rewind can never race the turn it erases. */
ipcMain.handle('mc-agent:rewind', async (event, value) => {
  assertTrustedAgentSender(event)
  try {
    const payload = agentPayload(value, ['sessionId', 'turnId'])
    const request = {
      sessionId: boundedAgentString(payload.sessionId, 'sessionId', MAX_SESSION_ID_LENGTH),
      turnId: boundedAgentString(payload.turnId, 'turnId', 512),
    }
    ownedAgentSession(event.sender, request.sessionId)
    return await agentHost.rewindSession(request)
  } catch (error) {
    throw rendererSafeAgentError(error)
  }
})

/* HOW HARD A RUNNING AGENT THINKS. The engine's own knob, so this changes a
   live thread rather than restarting it — the restart the product used to
   perform, and charge for, on a premise that was wrong. */
ipcMain.handle('mc-agent:effort', async (event, value) => {
  assertTrustedAgentSender(event)
  try {
    const payload = agentPayload(value, ['sessionId', 'effort'])
    const effort = boundedAgentString(payload.effort, 'effort', 8)
    if (!AGENT_EFFORT_VALUES.includes(effort)) {
      agentIpcError('MC_AGENT_EFFORT_UNKNOWN', `effort must be one of: ${AGENT_EFFORT_VALUES.join(', ')}`)
    }
    const request = {
      sessionId: boundedAgentString(payload.sessionId, 'sessionId', MAX_SESSION_ID_LENGTH),
      effort,
    }
    ownedAgentSession(event.sender, request.sessionId)
    return await agentHost.setSessionEffort(request)
  } catch (error) {
    throw rendererSafeAgentError(error)
  }
})

/* WHAT THIS ENGINE ACTUALLY OFFERS: the provider's model catalog, each
   model's real reasoning efforts in the provider's own words, and its
   default. The menus are built from this instead of from a table in the
   renderer that quietly disagrees with the engine. */
ipcMain.handle('mc-agent:models', async (event, value) => {
  assertTrustedAgentSender(event)
  try {
    const payload = agentPayload(value || {}, ['sessionId'])
    const request = {}
    if (Object.prototype.hasOwnProperty.call(payload, 'sessionId')) {
      request.sessionId = boundedAgentString(payload.sessionId, 'sessionId', MAX_SESSION_ID_LENGTH)
      ownedAgentSession(event.sender, request.sessionId)
    }
    return await agentHost.listEngineModels(request)
  } catch (error) {
    throw rendererSafeAgentError(error)
  }
})

ipcMain.handle('mc-agent:close', async (event, value) => {
  assertTrustedAgentSender(event)
  try {
    const request = parseAgentSessionCommand(value)
    const session = ownedAgentSession(event.sender, request.sessionId)
    const result = await agentHost.closeSession(request)
    /* THE PERSON STOPPED IT -- the first genuine ending. Recorded once the
       close has actually resolved (a close that rejects throws past this line
       and leaves the session, and its record, exactly as they were), and
       before the session leaves the map. */
    recordSessionEnd(session, request.sessionId, 'closed')
    if (agentSessions.get(request.sessionId) === session) {
      agentSessions.delete(request.sessionId)
    }
    return result
  } catch (error) {
    throw rendererSafeAgentError(error)
  }
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
/* SET ONCE, BY THE RESET CHANNEL, AND NEVER CLEARED.
 *
 * After a person has removed this computer's data, this process must stop
 * writing into the directory it just emptied. Closing the window normally saves
 * its position there, which would recreate the folder and leave a file in it --
 * so the screen's "it is gone" would be false within a second of being read,
 * and the person would find the folder still there. See `mc-reset:erase`. */
let localDataErased = false

function writeState(patch) {
  if (localDataErased) return
  try {
    fs.writeFileSync(STATE_FILE(), JSON.stringify({ ...readState(), ...patch }))
  } catch { /* state is comfort, not correctness */ }
}

/* The theme the first frame should be painted in. `mc.theme` is the key the
   renderer itself reads, so seeding from it is reading the same answer the
   page is about to reach rather than a parallel record of it. shell-state's
   copy remains the fallback for an install whose settings file has not been
   written yet. */
function bootTheme(shellState) {
  const stored = rendererPrefs.snapshot().values['mc.theme']
  return typeof stored === 'string' && stored ? stored : shellState.theme
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

/* The operator's purchase list, read from this install's own data directory.
 *
 * Every refusal here answers with 404 and a JSON body. Not 503, and not the app
 * shell: the renderer decides whether the checkout surface exists AT ALL from
 * this response, and it must only exist when a real list was really served. A
 * "temporarily unavailable" would be read as "maybe later"; an HTML body would
 * be read as a 200 by anything checking response.ok. Absent means absent. */
function serveOwnerPurchaseList(url, request, response) {
  if (url !== OWNER_PURCHASE_LIST_URL) return false
  const refuse = (reason) => {
    response.writeHead(404, 'Purchase List Not Installed', {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    })
    response.end(JSON.stringify({ ok: false, reason }))
  }
  if (request.headers[PROJECTION_CAPABILITY_HEADER] !== projectionCapability) {
    refuse('The purchase list is readable only from this application window.')
    return true
  }
  ;(async () => {
    const file = OWNER_PURCHASE_LIST_FILE()
    let stat
    try {
      stat = await fs.promises.stat(file)
    } catch {
      refuse('No purchase list is installed for this copy.')
      return
    }
    if (!stat.isFile()) { refuse('No purchase list is installed for this copy.'); return }
    if (stat.size > MAX_OWNER_PURCHASE_LIST_BYTES) { refuse('The installed purchase list is too large to read.'); return }
    let text
    try {
      text = await fs.promises.readFile(file, 'utf8')
    } catch (error) {
      refuse(`The installed purchase list could not be read (${error?.code || 'unknown error'}).`)
      return
    }
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(text)
  })().catch(error => {
    refuse(`The installed purchase list could not be read (${error?.code || 'unknown error'}).`)
  })
  return true
}

/* THE SIGNUP SERVICE, BUILT ONCE THE FIRST TIME SOMEBODY ASKS FOR IT.
 *
 * The subscription page posts to /v1/signup. Until this existed, the fallback
 * below answered that POST with index.html and a 200, so the page could only
 * read it as "not answering" and told the customer they were offline. See the
 * head of shell/subscribe-endpoint.cjs.
 *
 * `siteOrigin` is passed as a FUNCTION, not as a string. The provider's return
 * URLs have to name the origin this window actually ended up on, and the port
 * scan has not finished when this module is constructed; capturing shellOrigin
 * at construction would bake in `null` and strand a paying customer on a dead
 * address. Read at request time it cannot be null -- the host check at the top
 * of serveDist refuses every request with 421 until shellOrigin is set, so
 * nothing reaches here before there is an origin to name. */
let subscribeEndpoint = null
function serveSignup(url, request, response) {
  if (!subscribeEndpoint) {
    subscribeEndpoint = createSubscribeEndpoint({
      dataDirectory: app.getPath('userData'),
      siteOrigin: () => shellOrigin,
    })
  }
  return subscribeEndpoint.serve(url, request, response)
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon',
}

function serveDist() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      /* frame-ancestors works only as a RESPONSE HEADER — Chrome ignores the
         directive inside a <meta> policy, which left every page on this
         loopback origin frameable by any website in the person's browser
         (reports/lanes/preview-frame-ancestors-inert.md, measured
         2026-08-14; a page can iframe http://127.0.0.1:<port>/ and the Host
         check rightly passes). Set on EVERY branch, before any of them
         writes: nothing this server answers is a third party's to embed.
         The preview page alone allows the same-origin embed its design
         expects — its honesty banner can be overlaid by a hostile framer,
         which is exactly the audit-that-looks-like-it-ran defect the page
         itself argues against. */
      res.setHeader('Content-Security-Policy', "frame-ancestors 'none'")
      const expectedHost = shellOrigin ? new URL(shellOrigin).host : null
      if (!expectedHost || req.headers.host !== expectedHost) {
        res.writeHead(421, 'Misdirected Request', { 'content-type': 'text/plain', 'cache-control': 'no-store' })
        res.end('This loopback application only accepts its exact local origin.')
        return
      }
      const url = decodeURIComponent((req.url || '/').split('?')[0])
      if (url === '/preview' || url.startsWith('/preview/')) {
        res.setHeader('Content-Security-Policy', "frame-ancestors 'self'")
      }
      if (serveOwnerPurchaseList(url, req, res)) return
      if (serveConfiguredProjection(url, req, res)) return
      if (serveSignup(url, req, res)) return
      let file = path.normalize(path.join(DIST, url === '/' ? 'index.html' : url))
      // the hash router means every real navigation is still index.html
      if (!file.startsWith(DIST)) { res.writeHead(403); return res.end() }
      fs.readFile(file, (err, data) => {
        if (err) {
          /* A MISSING DATA FILE IS NOT A NAVIGATION. The SPA fallback below is
             right for /#/anything, and wrong for /data/x.json: it answered a
             JSON request with 200 and an HTML body, so every caller that reads
             response.ok -- which is all of them -- saw success and only failed
             later, on the parse, with a message about malformed JSON rather
             than about a file that is not there. The checkout surface now
             decides whether it exists at all from exactly this response, so
             "not installed" has to be distinguishable from "here it is". */
          if (/^\/data\/.+\.json$/.test(url)) {
            res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' })
            return res.end(JSON.stringify({ ok: false, reason: `${url} is not part of this build.` }))
          }
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
    /* PREFER THE PORT THIS INSTALL USED LAST, then scan as before.
       The durable settings file already means a moved port cannot lose
       anything, so this is not what makes the fix correct -- it is what keeps
       the origin STABLE in the ordinary case, which matters for two reasons:
       a stable origin is one the browser copy can still be rescued from, and
       every other origin-scoped browser behaviour (permissions, IndexedDB, and
       anything a later feature reaches for) stops silently resetting too.
       An occupied preferred port is not an error; the scan continues. */
    const ports = preferredPortFirst(SHELL_PORTS, readState().port)
    listenOnFirstFreePort(server, ports, SHELL_HOST).then((port) => {
      writeState({ port })
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

/* ---------- the renderer's settings ----------
 *
 * SYNCHRONOUS, ALL OF THEM, because these channels are what `localStorage`
 * means in this application now (public/durable-storage.js) and the API they
 * stand in for is synchronous. A person's theme is read before first paint and
 * their setting is durable when the setter returns; both of those stop being
 * true the moment any of this becomes a promise.
 *
 * The sender check is trustedFleetProfileSender for the reason given where it
 * is defined: it is the shell's generic "our own main frame, at our own origin"
 * test, and reusing it keeps ONE definition of a trusted sender rather than two
 * that drift. Nothing secret is stored here -- no password, no token, no
 * account principal -- so this gate is about keeping a stray frame from
 * rewriting somebody's settings, not about protecting a credential. */
function prefsRefusal(what) {
  return { ok: false, error: { code: 'MC_PREFS_SENDER_REFUSED', message: `Settings ${what} did not come from the application main frame.` } }
}

ipcMain.on('mc-prefs:bootstrap', (event) => {
  if (!trustedFleetProfileSender(event)) { event.returnValue = prefsRefusal('bootstrap'); return }
  const snapshot = rendererPrefs.snapshot()
  event.returnValue = {
    ok: true,
    values: snapshot.values,
    /* THE THREE FACTS A PERSON IS OWED WHEN THEIR SETTINGS DID NOT LOAD.
       The store already preserves an unreadable file instead of replacing it;
       these fields are what stops that from being a silent recovery. `damaged`
       is why the app is showing defaults, `file` is where their settings are
       supposed to live, and `preservedAt` is where the unreadable copy was put
       once a write has actually moved it. src/settings-recovery-notice.js is
       the only consumer and it says all three out loud. */
    damaged: typeof snapshot.damaged === 'string' ? snapshot.damaged : null,
    preservedAt: typeof snapshot.preservedAt === 'string' ? snapshot.preservedAt : null,
    file: rendererPrefs.file,
    /* The renderer is asked to hand over its browser copy only while THIS
       origin has never been drained. After a port change the new origin is
       undrained and empty, so the drain is a no-op -- and the settings the
       person is still using come from the durable file, not from it. If a
       later launch lands back on the old port, that origin is still undrained
       and its copy is finally rescued. */
    drainRequired: !snapshot.drainedOrigins.includes(shellOrigin),
  }
})

ipcMain.on('mc-prefs:drain', (event, request) => {
  if (!trustedFleetProfileSender(event)) { event.returnValue = prefsRefusal('migration'); return }
  /* The same fence as the three writers below, and it belongs here too: a
     migration is a write, and a browser copy rescued into a directory the person
     just emptied would put their old settings back. */
  if (localDataErased) { event.returnValue = prefsErasedRefusal('migration'); return }
  const drained = rendererPrefs.drain(shellOrigin, request && request.entries)
  if (!drained.ok) { event.returnValue = drained; return }
  event.returnValue = {
    ok: true,
    migrated: drained.migrated,
    values: rendererPrefs.snapshot().values,
    /* MEASURED, by the packaged proof, on the version of this line that built
       its reply from scratch and left this field out: the drain is the FIRST
       write of a launch, so on a damaged record it is the call that moves the
       unreadable file aside -- and it was the only call that knew where the
       file went. Dropping the field here meant the page kept saying "your
       settings file is still where it was" about a file that had already been
       moved thirty milliseconds earlier, and the person was never given the
       path. The rescue happened and remained unfindable. */
    preservedAt: typeof drained.preservedAt === 'string' ? drained.preservedAt : null,
  }
})

/* THE UNINSTALL CHOICE HAS TO REACH SOMETHING NSIS CAN READ.
 *
 * The person makes this choice on the settings page, so it lands in
 * renderer-prefs.json like every other setting. The uninstaller cannot read
 * that: it is NSIS, with no JSON parser and no Node. So every write that could
 * have changed the choice re-renders it as the one-token file
 * shell/uninstall-retention.cjs owns, which build/installer.nsh reads.
 *
 * MIRRORED ON EVERY PATH THAT CAN CHANGE IT, including remove and clear. A
 * mirror wired only to `set` would leave a stale `remove-everything` on disk
 * after the person switched back to "ask me" or reset their settings -- and
 * that stale token deletes their data at uninstall on a decision they had
 * already withdrawn. The destructive direction is the one that must not be
 * reachable by forgetting a branch.
 *
 * Failures are deliberately NOT surfaced as a refusal of the settings write.
 * The preference itself saved correctly; what failed is a derived file. Turning
 * that into "your setting could not be saved" would be a lie about the thing
 * the person actually did, and would make an unrelated disk problem look like a
 * broken settings page. */
function mirrorUninstallRetention() {
  const snapshot = rendererPrefs.snapshot()
  const value = snapshot && snapshot.values ? snapshot.values[RETENTION_PREF_KEY] : undefined
  return syncRecordedChoice({ userDataDir: app.getPath('userData'), value })
}

function mirrorUninstallRetentionIfRelevant(key) {
  if (key !== RETENTION_PREF_KEY) return
  mirrorUninstallRetention()
}

/* WRITING A SETTING BACK INTO A DIRECTORY SOMEBODY JUST EMPTIED.
 *
 * Every one of these writes recreates userData and puts a file in it. After
 * `mc-reset:erase` the page is still alive -- it has to be, to show what
 * happened -- and an ordinary repaint that touches the theme would restore
 * renderer-prefs.json under a screen saying the data is gone. Refused with a
 * sentence rather than silently dropped, so a caller can tell the difference
 * between "saved" and "we are not writing here any more". */
function prefsErasedRefusal(what) {
  return { ok: false, error: { code: 'MC_PREFS_DATA_ERASED', message: `Settings ${what} is refused: this computer’s data was removed, and nothing is written back into that folder.` } }
}

ipcMain.on('mc-prefs:write', (event, request) => {
  if (!trustedFleetProfileSender(event)) { event.returnValue = prefsRefusal('save'); return }
  if (localDataErased) { event.returnValue = prefsErasedRefusal('save'); return }
  event.returnValue = rendererPrefs.set(request && request.key, request && request.value)
  mirrorUninstallRetentionIfRelevant(request && request.key)
})

ipcMain.on('mc-prefs:remove', (event, request) => {
  if (!trustedFleetProfileSender(event)) { event.returnValue = prefsRefusal('removal'); return }
  if (localDataErased) { event.returnValue = prefsErasedRefusal('removal'); return }
  event.returnValue = rendererPrefs.remove(request && request.key)
  mirrorUninstallRetentionIfRelevant(request && request.key)
})

ipcMain.on('mc-prefs:clear', (event) => {
  if (!trustedFleetProfileSender(event)) { event.returnValue = prefsRefusal('reset'); return }
  if (localDataErased) { event.returnValue = prefsErasedRefusal('reset'); return }
  event.returnValue = rendererPrefs.clear()
  /* A reset clears the choice along with everything else, so the mirror runs
     unconditionally rather than on a key comparison there is no longer a key
     for. */
  mirrorUninstallRetention()
})

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

/* THE DISPATCH ROOT IS PASSED IN, not derived inside the setup module. It is the
   same constant the capability layer is handed as its `main` root, and the whole
   point of the document written there is that the two agree about which
   directory a lane runs in; deriving it twice is how they would stop agreeing.
   See ensureDispatchAssistantConfig() in shell/setup-record.cjs. */
/* THE PERMISSION LEVEL GOES INTO THE SIGNED LEDGER, AND THE WIDEST LEVEL IS
   REFUSED WITHOUT A CONFIRMED CONSENT (owner, X4, 2026-08-15). This channel
   used to write the machine record and nothing else: a person moving this
   computer to the level at which an agent can read, change and delete any file
   on it left no signed trace. It now goes through shell/tier-consent.cjs --
   intent row, the write, outcome row, the same shape auditedAccountAction uses
   above and for the same reason -- and it refuses to move TO the widest level
   unless the page hands over a consent saying the risk was shown, in which
   words, and confirmed. The refusal lives here rather than only on the screen so
   a renderer that forgot to ask could not widen anything.

   The level this computer holds NOW is read here, never taken from the page: it
   decides whether this is an enable (consent required) or a re-record of a
   level already held (not), and it is what the ledger row names as `from`.
   The principal is read here for the reason accountPrincipal() states.

   The require sits beside its one caller on purpose: this block is the whole
   of this file's use of the module, and a sibling lane holds other regions of
   this file, so the edit stays in one place. */
const { auditedTierChoice, readConsentState } = require('./tier-consent.cjs')
const { canonicalAudit: canonicalAuditFor } = require('./canonical-audit.cjs')

ipcMain.handle('mc-setup:choose-tier', (event, tier, consent) =>
  withFleetProfileSender(event, () => {
    const requested = typeof tier === 'string' ? tier : ''
    let known = []
    let previousTier = null
    try {
      const state = readTierState()
      known = Array.isArray(state?.tiers) ? state.tiers : []
      previousTier = state && state.configured === true && typeof state.tier === 'string' ? state.tier : null
    } catch { /* recordTier below answers with its own refusal */ }
    /* A level this product does not offer is refused by recordTier with
       SETUP_TIER_UNKNOWN and is not worth two ledger rows; only a real level
       is recorded. */
    if (!known.includes(requested)) return recordTier(requested, { dispatchRoot: WORKSPACE_ROOT })
    return auditedTierChoice({
      tier: requested,
      previousTier,
      consent,
      principal: accountPrincipal(),
      record: recordCanonical,
      run: () => recordTier(requested, { dispatchRoot: WORKSPACE_ROOT }),
    })
  }))

/* What the ledger holds about the widest level: whether a CONFIRMED choice of
   it is on record here, and when. Read from the same canonical chain the row
   above writes to, so the Settings row can say "confirmed on <date>" only when
   that is what the record says, and say plainly that nothing is on record for
   a machine that reached this level before this product asked. */
ipcMain.handle('mc-setup:tier-consent', event =>
  withFleetProfileSender(event, () => {
    const loaded = canonicalAuditFor({ stateRoot: CAPABILITY_STATE_ROOT })
    if (!loaded.ok) return { ok: false, code: loaded.code, reason: loaded.reason }
    return readConsentState({ findEvents: selector => loaded.audit.findEvents(selector) })
  }))

/* ---------- the installation's own settings, changed from inside the window ----------
 *
 * WHAT WAS MISSING, in the owner's own rule: a user setting is a registry row,
 * a real enforcement, and a control in the software -- or it is a lie. The
 * research family had a row and an enforcer and NO control anywhere, so the
 * research page's sentence ("the research pipeline is switched off in settings")
 * pointed at a switch that did not exist and the only way to run anything was to
 * hand-write the settings file. See shell/product-settings.cjs for why the
 * writer lives in the shell and why it consults the payload's validator rather
 * than restating it.
 *
 * SAME SENDER CHECK AS EVERY OTHER WRITE HERE, for the same reason: this changes
 * a record on disk that decides whether unattended work may run on this
 * computer, and only this application's own main frame may do that.
 *
 * THE CHANGE IS RECORDED, AND A FAILURE TO RECORD DOES NOT SILENTLY PASS. This
 * is a permission being granted, which is exactly the class of act the signed
 * ledger exists for. It is reported rather than thrown, and the write is NOT
 * rolled back on an unrecordable ledger: a person who has turned research on has
 * turned it on, and quietly reverting their choice because a log was unavailable
 * would be a worse lie than an unrecorded change. The control says which
 * happened. */
ipcMain.handle('mc-settings:read', event =>
  withFleetProfileSender(event, () => readProductSettings()))

ipcMain.handle('mc-settings:set', (event, request) =>
  withFleetProfileSender(event, () => {
    const id = typeof request?.id === 'string' ? request.id : ''
    const value = request ? request.value : undefined
    const result = setProductSetting({ id, value })
    if (!result.ok) return result
    /* The BOUND wrapper, never the raw import: the raw call carried no state
     * root, was refused, and -- before canonical-audit.cjs stopped caching
     * caller errors -- poisoned every later record in the process. */
    const recorded = recordCanonical('settings.set', id, {
      value: result.value,
      revision: result.revision,
      provenance: result.provenance?.source ?? null,
    })
    if (!recorded.ok) {
      console.warn(`[settings] the change to "${id}" was applied but could not be written to the signed record: ${recorded.code ?? ''} ${recorded.reason ?? ''}`)
    }
    return { ...result, recorded }
  }))

/* ---------- the declared organisation ----------
 *
 * The agent page can move an agent under a different manager, give it a
 * different role, and define roles of its own. All three used to be either
 * missing or an in-memory edit the next projection load discarded.
 *
 * These carry the SAME sender check as everything above, and for the same
 * reason: they change a record on disk that governs routing and claim
 * eligibility. The check is not about secrecy -- there is nothing secret in an
 * org chart -- it is that only this application's own main frame, at its own
 * origin, may rewrite the organisation the rest of the product reads.
 *
 * The tier is NOT consulted here, and that is deliberate rather than an
 * omission. A permission tier governs what an agent may do to this computer:
 * which tools it holds, whether its sandbox may write, what workspace roots it
 * has. Naming a manager or writing a role description is none of those things --
 * it is a statement of intent that grants no authority, which the engine's own
 * model says on the record it returns (`stateKind: 'declared'`,
 * `grantsAuthority: false`). Gating org editing on tier would imply a guided
 * installation is less entitled to describe its own fleet, while changing
 * nothing about what that fleet may actually do.
 *
 * What a role CANNOT do is widen anything: src/lib/agent-org.js derives a custom
 * role's authority from the default it is based on, and a custom role with no
 * base cannot claim work at all. So a role is a subdivision of a tier's
 * authority, never a route around it. */
const agentOrgRecord = createAgentOrgRecord()

ipcMain.handle('mc-org:read', (event) =>
  withFleetProfileSender(event, () => agentOrgRecord.read()))

ipcMain.handle('mc-org:reparent', (event, request) =>
  withFleetProfileSender(event, () => agentOrgRecord.reparent({
    agentId: String(request?.agentId ?? ''),
    parentId: request?.parentId === null || request?.parentId === undefined ? null : String(request.parentId),
    expectedRevision: request?.expectedRevision,
  })))

ipcMain.handle('mc-org:assign-role', (event, request) =>
  withFleetProfileSender(event, () => agentOrgRecord.assignRole({
    agentId: String(request?.agentId ?? ''),
    role: String(request?.role ?? ''),
    expectedRevision: request?.expectedRevision,
  })))

ipcMain.handle('mc-org:create-role', (event, request) =>
  withFleetProfileSender(event, () => agentOrgRecord.createRole({
    id: String(request?.id ?? ''),
    baseDefaultRole: request?.baseDefaultRole ? String(request.baseDefaultRole) : null,
    rules: request?.rules,
  })))

ipcMain.handle('mc-org:edit-role', (event, request) =>
  withFleetProfileSender(event, () => agentOrgRecord.editRole({
    id: String(request?.id ?? ''),
    rules: request?.rules,
  })))

ipcMain.handle('mc-org:reset-role', (event, request) =>
  withFleetProfileSender(event, () => agentOrgRecord.resetRole({ id: String(request?.id ?? '') })))

ipcMain.handle('mc-org:reset', (event) =>
  withFleetProfileSender(event, () => agentOrgRecord.resetOrg()))

ipcMain.handle('mc-org:export', (event) =>
  withFleetProfileSender(event, () => agentOrgRecord.exportOrg()))

/* ---------- first run: the workspace ----------
 *
 * Step 7 of docs/design/INSTALLER-EXPERIENCE.md section 3, and the half of first
 * run that shipped missing: the level was asked, the folder was not, so
 * `recordTier` chose one silently. These four channels let the walkthrough ask.
 *
 * Every one of them carries the same sender check as `mc-setup:choose-tier`.
 * `record-workspaces` creates directories and starts a history in them, which is
 * the most consequential thing this window can be asked to do to a disk, so it is
 * an invoke behind the sender check and never a sendSync convenience.
 *
 * The candidate a person typed is validated in the MAIN process, not the
 * renderer, because the refusals depend on the install root and on the recorded
 * level -- neither of which the renderer has, and neither of which it should. */
ipcMain.handle('mc-setup:workspace-state', event =>
  withFleetProfileSender(event, () => readWorkspaceState()))

ipcMain.handle('mc-setup:check-workspace', (event, candidate) =>
  withFleetProfileSender(event, () => checkWorkspace(typeof candidate === 'string' ? candidate : '')))

ipcMain.handle('mc-setup:record-workspaces', (event, roots) =>
  withFleetProfileSender(event, () => recordWorkspaces(
    Array.isArray(roots) ? roots.filter(entry => typeof entry === 'string' && entry.trim() !== '') : [],
  )))

ipcMain.handle('mc-setup:choose-workspace', event => withFleetProfileSender(event, async () => {
  const choice = await dialog.showOpenDialog(win, {
    title: 'Choose a folder for your assistant to work in',
    /* `createDirectory` because the answer to this question is very often a
       folder that does not exist yet, and sending someone out to File Explorer
       to make one is how a first run ends. */
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: app.getPath('documents'),
  })
  if (choice.canceled || choice.filePaths.length !== 1) return { ok: true, canceled: true }
  /* Checked here rather than only on save: a picker that accepts a refused
     folder and reports it three screens later has wasted the click. */
  const verdict = checkWorkspace(choice.filePaths[0])
  if (!verdict.ok) return { ...verdict, canceled: false }
  return { ok: true, canceled: false, path: verdict.resolved }
}))

/* ---------- the product account ----------
 *
 * Step 6 of docs/design/INSTALLER-EXPERIENCE.md section 3, and the owner's
 * ruling that a user login is a launch requirement.
 *
 * WHAT CROSSES THIS BOUNDARY, IN EACH DIRECTION, IS THE POINT OF THE BLOCK.
 * Inward: a username, a display name, and a password, all as ordinary strings
 * from a form. Outward: NEVER a password, a verifier, a salt, a session token
 * or an account id that was not asked for -- the replies are status words and
 * a display name. There is no channel here that returns a secret, which is why
 * the whole surface is safe to log.
 *
 * The password is used and dropped inside `shell/product-account.cjs`; nothing
 * in this file holds one, writes one, or puts one in an error message.
 *
 * Every channel carries the same sender check as `mc-setup:*`, and every one is
 * an `invoke` rather than a `sendSync` convenience -- these mutate durable state
 * and deliberately take about a second, because that second is what makes a
 * stolen verifier expensive to attack.
 *
 * THE SIGNED-IN VALUE IS NOT SENT INWARD. There is no `mc-account:set-principal`
 * and there must never be one. `accountPrincipal()` above reads the store
 * directly, so the audit record's identity cannot be chosen by the page. */
ipcMain.handle('mc-account:availability', event =>
  withFleetProfileSender(event, () => getAccountStore().availability()))

/* The read the interface actually renders from. `currentForRenderer`, NOT
   `current`: the session identifier that main-process consumers use to say
   which sign-in approved something is projected out here. The page gets
   `signedIn`, a display name and an expiry, and nothing else. */
ipcMain.handle('mc-account:current', event =>
  withFleetProfileSender(event, () => getAccountStore().currentForRenderer()))

ipcMain.handle('mc-account:create', (event, value) =>
  withFleetProfileSender(event, () => auditedAccountAction({
    action: 'account.create',
    username: typeof value?.username === 'string' ? value.username : '',
    run: () => getAccountStore().createAccount({
      username: typeof value?.username === 'string' ? value.username : '',
      displayName: typeof value?.displayName === 'string' ? value.displayName : '',
      password: typeof value?.password === 'string' ? value.password : '',
    }),
  })))

/* A REFUSED SIGN-IN IS RECORDED TOO. `signIn` answers a wrong password and an
   account that does not exist with the identical refusal, on purpose, so that a
   stranger cannot enumerate the account list; the ledger inherits that -- it
   holds the digest of what was typed and the store's refusal code, which is the
   same code either way. It can therefore show that somebody tried repeatedly
   without telling a reader which names exist. */
ipcMain.handle('mc-account:sign-in', (event, value) =>
  withFleetProfileSender(event, () => auditedAccountAction({
    action: 'account.sign_in',
    username: typeof value?.username === 'string' ? value.username : '',
    run: () => getAccountStore().signIn({
      username: typeof value?.username === 'string' ? value.username : '',
      password: typeof value?.password === 'string' ? value.password : '',
    }),
  })))

/* Signing out names the session that ENDS, which is known before it ends and
   unknowable after, so the principal is read first. */
ipcMain.handle('mc-account:sign-out', event =>
  withFleetProfileSender(event, () => {
    const principal = accountPrincipal()
    return auditedAccountAction({
      action: 'account.sign_out',
      username: principal,
      run: () => getAccountStore().signOut(),
    })
  }))

ipcMain.handle('mc-account:sign-out-everywhere', event =>
  withFleetProfileSender(event, () => getAccountStore().signOutEverywhere()))

ipcMain.handle('mc-account:change-password', (event, value) =>
  withFleetProfileSender(event, () => getAccountStore().changePassword({
    currentPassword: typeof value?.currentPassword === 'string' ? value.currentPassword : '',
    newPassword: typeof value?.newPassword === 'string' ? value.newPassword : '',
  })))

/* THE NAME THIS PROGRAM SHOWS, changed after the fact.
 *
 * The one channel on this surface whose absent value is NOT coerced to `''`.
 * Every other handler above reads a missing string as the empty one, and that
 * is right for them: an empty password is refused and an empty username is
 * refused. Here the empty string is a MEANING -- "show me as my username
 * again" -- so coercing a malformed call into it would silently clear
 * somebody's name because a field arrived undefined. `null` reaches the store,
 * which refuses it. Absence read as consent is this codebase's signature
 * defect and this is precisely the shape of it.
 *
 * The slice is the boundary doing its own job. The store bounds it again. */
ipcMain.handle('mc-account:change-display-name', (event, value) =>
  withFleetProfileSender(event, () => getAccountStore().changeDisplayName({
    displayName: typeof value?.displayName === 'string' ? value.displayName.slice(0, 1024) : null,
  })))

/* ---------- what belongs to the signed-in account ----------
 *
 * The partition, reached from the page. Same sender check as every other
 * account channel, and the same rule about direction: the page names a KEY, it
 * never names an ACCOUNT. Which account's data this is comes from the session
 * in the main process, exactly like the audit principal does, because a page
 * that could choose whose settings it is reading is a page that can read
 * anybody's.
 *
 * There is deliberately no channel that lists accounts or reads another
 * account's partition. `shell/product-account.cjs` will not answer that
 * question and nothing here asks it. */
ipcMain.handle('mc-account:data', event =>
  withFleetProfileSender(event, () => getAccountStore().accountDataForRenderer()))

ipcMain.handle('mc-account:setting-get', (event, value) =>
  withFleetProfileSender(event, () => getAccountStore().getSetting(typeof value?.key === 'string' ? value.key : '')))

ipcMain.handle('mc-account:setting-put', (event, value) =>
  withFleetProfileSender(event, () => getAccountStore().putSetting({
    key: typeof value?.key === 'string' ? value.key : '',
    /* `null` removes. Anything that is not a string and not null is refused by
       the store rather than coerced -- a setting stored as "[object Object]" is
       a setting nobody can read back. */
    value: value?.value === null || value?.value === undefined ? null : value.value,
  })))

/* ATTACHMENT ONLY, and the vault key is the ONLY thing that crosses.
 *
 * This binds a vault record to the signed-in account as its payment method. It
 * cannot read the record, cannot decrypt it, cannot validate a card and cannot
 * reach a payment provider -- the store accepts a key name from a fixed
 * allowlist and writes it down. Nothing here moves money and there is no code
 * path from this channel to anything that does. */
ipcMain.handle('mc-account:payment-attach', (event, value) =>
  withFleetProfileSender(event, () => getAccountStore().attachPaymentMethod({
    vaultKey: typeof value?.vaultKey === 'string' ? value.vaultKey : '',
    vaultStore: path.join(CAPABILITY_STATE_ROOT, 'vault', 'secrets.json'),
    note: typeof value?.note === 'string' ? value.note : null,
  })))

ipcMain.handle('mc-account:payment-detach', event =>
  withFleetProfileSender(event, () => getAccountStore().detachPaymentMethod()))

/* IS THE ATTACHED RECORD ACTUALLY IN THIS INSTALLATION'S VAULT.
 *
 * Separate from the attachment on purpose. The binding says which record is
 * this person's card; this says whether the installation can currently see it.
 * They can disagree, and on this machine they DO: the card was entered into the
 * engine checkout's vault and this installation resolves its own under
 * `<userData>/capability/vault/`. A screen with only a boolean turns that into
 * "no card on file", which is false. See shell/vault-presence.cjs. */
ipcMain.handle('mc-account:payment-presence', event =>
  withFleetProfileSender(event, () => {
    const state = getAccountStore().current()
    if (!state.signedIn) {
      return { ok: false, code: 'ACCOUNT_NOT_SIGNED_IN', reason: 'Nobody is signed in, so there is no payment method to check.' }
    }
    const data = getAccountStore().accountDataForRenderer()
    if (data.ok !== true) return { ok: false, code: data.code, reason: data.reason }
    if (!data.paymentMethod) {
      return { ok: true, attached: false, present: false, checked: true, code: 'ACCOUNT_PAYMENT_NOT_ATTACHED' }
    }
    const presence = readVaultRecordPresence(data.paymentMethod.vaultKey, {
      capabilityRoot: resolveCapabilityRoot(),
      stateRoot: CAPABILITY_STATE_ROOT,
    })
    return {
      ok: true,
      attached: true,
      vaultKey: data.paymentMethod.vaultKey,
      attachedAtMs: data.paymentMethod.attachedAtMs,
      present: presence.present,
      checked: presence.readable,
      code: presence.code,
      detail: presence.detail,
    }
  }))

/* ---------- SIGN IN WITH GOOGLE ----------
 *
 * THE DIRECTION IS THE SAME AS EVERY OTHER ACCOUNT CHANNEL: the page presses a
 * button, and NOTHING the page sends decides who gets signed in. There is no
 * parameter on any of these handlers. The identity comes back from Google,
 * through shell/google-oidc.cjs, which checks the signature, the issuer, the
 * audience, the expiry and the nonce before it is a name at all -- and
 * shell/product-account.cjs refuses an identity that did not come out of that
 * verifier. A page that could hand in an email address would be a page that
 * could sign in as anybody, so no channel here takes one.
 *
 * NOTHING GOOGLE ISSUES REACHES THE PAGE OR THE DISK. The authorization code,
 * the access token and the id_token exist inside one function call in the main
 * process and are gone when it returns. What comes back to the renderer is the
 * same `{ok, code, reason}` shape every other account channel uses.
 *
 * ONE ATTEMPT AT A TIME. Pressing the button again cancels the previous attempt
 * rather than running two loopback listeners -- which is also what a person who
 * lost the browser window will do, and they should get a fresh window, not a
 * refusal. */
let googleSignInAttempt = null

function googleSignInConfig() {
  return resolveGoogleSignInConfig({
    userDataDir: app.getPath('userData'),
    /* The shipped default lives beside the shell inside the package. */
    appRoot: path.join(__dirname, '..'),
    env: process.env,
  })
}

ipcMain.handle('mc-account:google-availability', event =>
  withFleetProfileSender(event, () => {
    const config = googleSignInConfig()
    if (config.ok !== true) return { ok: false, code: config.code, reason: config.reason }
    return {
      ok: true,
      available: true,
      source: config.source,
      /* SAID OUT LOUD, ALWAYS. A build pointed at a test identity provider must
         never look like a build pointed at Google -- the screen prints this. */
      testProvider: config.testProvider ? { issuer: config.testProvider.issuer } : null,
    }
  }))

ipcMain.handle('mc-account:google-sign-in', event =>
  withFleetProfileSender(event, async () => {
    const config = googleSignInConfig()
    if (config.ok !== true) return { ok: false, code: config.code, reason: config.reason }

    if (googleSignInAttempt) {
      try { googleSignInAttempt.cancel() } catch { /* already finished */ }
      googleSignInAttempt = null
    }
    const attempt = createGoogleSignIn({
      clientId: config.clientId,
      /* REQUIRED BY GOOGLE FOR A DESKTOP CLIENT, and measured rather than
         assumed: a PKCE-S256 exchange sent without this gets HTTP 400
         invalid_request "client_secret is missing." Google's secret-free
         exemption covers Android, iOS and Chrome clients only, and PKCE does
         not substitute for it. Omitting this line ships a build that reaches
         Google, signs the customer in, and then fails on the very last step,
         every single time. It goes in the token POST body only -- never the
         URL, never a log, never a refusal message -- and PKCE is unchanged and
         still always sent, which is what actually protects the exchange. */
      clientSecret: config.clientSecret,
      /* THE SYSTEM BROWSER, NOT A WINDOW THIS PROGRAM CAN SEE INTO. The URL is
         built in shell/google-signin.cjs from constants and freshly generated
         random values; nothing from the renderer reaches it. */
      openExternal: url => electronShell.openExternal(url),
      ...(config.testProvider
        ? {
          authorizationEndpoint: config.testProvider.authorizationEndpoint,
          tokenEndpoint: config.testProvider.tokenEndpoint,
          jwksUri: config.testProvider.jwksUri,
          issuers: [config.testProvider.issuer],
        }
        : {}),
    })
    googleSignInAttempt = attempt
    let outcome
    try {
      outcome = await attempt.run()
    } finally {
      if (googleSignInAttempt === attempt) googleSignInAttempt = null
    }
    /* EVERY REFUSAL IS SIGNED OUT, AND SAYS WHY. There is no branch below that
       falls back to another way of signing in: a person whose Google sign-in
       failed is still signed out, and the screen offers the account on this
       computer as a choice they make, not as one made for them. */
    if (!outcome || outcome.ok !== true) {
      return {
        ok: false,
        code: outcome?.code || 'GOOGLE_SIGNIN_FAILED',
        reason: outcome?.reason || 'The Google sign-in did not complete, so nobody was signed in.',
      }
    }
    const signedIn = await getAccountStore().signInWithGoogle({ identity: outcome.identity })
    if (!signedIn || signedIn.ok !== true) {
      return { ok: false, code: signedIn?.code || 'ACCOUNT_GOOGLE_SIGNIN_FAILED', reason: signedIn?.reason || 'The sign-in could not be recorded on this computer, so nobody was signed in.' }
    }
    return {
      ok: true,
      created: signedIn.created === true,
      persisted: signedIn.persisted,
      /* The display name, exactly as `mc-account:sign-in` answers. No token, no
         subject identifier and no session id crosses. */
      account: signedIn.account,
      expiresAtMs: signedIn.expiresAtMs,
      usedTestProvider: Boolean(config.testProvider),
    }
  }))

/* WHERE THE BROWSER WAS SENT, for the attempt that is running right now.
 *
 * "The browser did not open" is a real state -- a computer with no default
 * browser association, or a broken one -- and without this it is a dead end
 * with a message and nothing to do. The screen shows this address so the person
 * can open it themselves, which is what every command-line sign-in has always
 * done.
 *
 * It carries no credential: a public client id, a loopback address, a SHA-256
 * hash of a verifier that never leaves the main process, and this attempt's
 * single-use state and nonce. It answers `null` the moment the attempt settles,
 * so nothing can offer a link to a sign-in that is already over. */
ipcMain.handle('mc-account:google-url', event =>
  withFleetProfileSender(event, () => {
    const address = googleSignInAttempt?.authorizationAddress || null
    return address
      ? { ok: true, url: address }
      : { ok: false, code: 'GOOGLE_SIGNIN_NOT_RUNNING', reason: 'No Google sign-in is waiting for a browser just now.' }
  }))

ipcMain.handle('mc-account:google-cancel', event =>
  withFleetProfileSender(event, () => {
    if (!googleSignInAttempt) return { ok: true, cancelled: false }
    try { googleSignInAttempt.cancel() } catch { /* already finished */ }
    googleSignInAttempt = null
    return { ok: true, cancelled: true }
  }))

/**
 * The two directories this installation owns, and the folders it must not touch.
 *
 * THE INSTALLATION ROOT IS ASKED FOR, NEVER DERIVED HERE. `%LOCALAPPDATA%\ToolsEnabled`
 * is the payload's answer (src/lib/setup/machine-record.js resolveServicesRoot),
 * and shell/agent-org-record.cjs already states the rule this follows: the shell
 * does not get a second opinion about where an installation lives. A copy with
 * no payload therefore reports that root as UNKNOWN rather than guessing at it,
 * and the screen says it was not removed -- an unmeasured folder reported as
 * deleted is the failure mode this whole lane exists to prevent.
 *
 * `require` is local rather than at the top of the file because this is the only
 * caller, and because loading a payload module at startup for a screen almost
 * nobody opens would put a disk read on every launch.
 */
function localDataResetPlan() {
  let servicesRoot = null
  try {
    const modules = require('./setup-record.cjs').loadSetupModules()
    if (modules.ok) servicesRoot = modules.machineRecord.resolveServicesRoot({})
  } catch { servicesRoot = null }

  let workspaceRoots = []
  try {
    const workspace = readWorkspaceState()
    if (Array.isArray(workspace?.roots)) workspaceRoots = workspace.roots.slice()
  } catch { workspaceRoots = [] }

  return planReset({
    userDataDir: app.getPath('userData'),
    servicesRoot,
    workspaceRoots,
    /* Where the program itself is installed. Named so the screen can say the
       program is still there and how to remove it, and never swept. */
    installDir: app.isPackaged && typeof process.resourcesPath === 'string'
      ? path.dirname(process.resourcesPath)
      : null,
  })
}

/* ---------- removing this product's data, from inside this product ----------
 *
 * WHY THIS IS HERE AND NOT IN THE PAGE. A renderer can clear its own settings
 * and nothing else. The credential vault, the signed audit ledger, the accounts
 * file, the sealed session and the permission-level record are all outside the
 * page's reach by design -- that is most of the point of the account boundary
 * above. So "delete my data" is either a main-process act or it is a button
 * that lies about what it did.
 *
 * TWO CHANNELS, NOT ONE, AND THE ORDER IS THE SAFETY. `plan` only measures; it
 * is what the screen shows before anything is destroyed. `erase` is the act.
 * A single channel that measured and deleted in one call would mean the first
 * press was the destructive one, and there would be no moment at which the
 * person had seen what they were about to lose.
 *
 * WHAT ERASE DOES FIRST, AND WHY THAT ORDER. The sign-in is revoked EVERYWHERE
 * before a byte is deleted, because deleting the accounts file alone leaves any
 * copy of the sealed session taken earlier still replayable -- deleting a lock
 * is not the same as changing it. Advancing the epoch is what actually ends
 * those sessions (shell/product-account.cjs), and it has to happen while the
 * file still exists. Then the capability layer is stopped, because it is a
 * child process holding the ledger's sqlite handles open and a file Windows
 * holds open is a file that does not get deleted.
 *
 * NOTHING HERE REPORTS SUCCESS IT DID NOT MEASURE. The reply is the per-entry
 * outcome from shell/local-data-reset.cjs, which re-stats every entry after
 * removing it. */
ipcMain.handle('mc-reset:plan', event =>
  withFleetProfileSender(event, () => localDataResetPlan()))

ipcMain.handle('mc-reset:erase', event =>
  withFleetProfileSender(event, async () => {
    const plan = localDataResetPlan()

    /* Revoked before anything is deleted. A refusal is reported rather than
       thrown: a damaged accounts file must not be able to stop a person
       removing their data, and the screen says which half happened. */
    let revoked = { ok: false, reason: 'The sign-in could not be ended.' }
    try { revoked = getAccountStore().signOutEverywhere() } catch (error) {
      revoked = { ok: false, reason: error?.message || 'The sign-in could not be ended.' }
    }

    /* THIS PROCESS WAS ONE OF THE HOLDERS, AND NOBODY HAD ASKED IT TO LET GO.
       Stopping the child below was written on the belief that the capability
       layer held the ledger open. It does -- and so does this window, which
       loads the payload's ledger writer into itself and keeps its database
       handle for the life of the process (shell/canonical-audit.cjs). Measured
       2026-08-18: the removal reported the vault, its access log and the signed
       ledger still on the disk, and sweeping four more times over 2.7s did not
       shift them, because the handle was in the process doing the sweeping.
       Closed BEFORE the child is stopped, because this half costs nothing and
       failing to do it is what made the promise false. */
    const ledgerClosed = closeCanonicalLedger()

    /* The layer holds the ledger and the vault open too. It is stopped here
       rather than at quit, because quit is after the deletion. */
    const child = capabilityLayer?.child || capabilityLayerChild
    capabilityLayer = null
    capabilityLayerChild = null
    capabilityLayerStarting = null
    capabilityLayerStatus = { ok: false, code: 'CAPABILITY_STOPPED_FOR_RESET', reason: 'The capability layer was stopped so this computer’s data could be removed.' }
    try { child?.kill() } catch { /* the awaited stop escalates */ }
    try { await stopCapabilityLayer(child) } catch { /* a layer that never started needs no stop */ }

    /* ONLY WHAT THE MEASUREMENT FOUND, AND ONLY WHAT THIS BUILD WOULD LOOK AT.
       A root the module refused to guard, or one that is not there, is not swept
       -- and the screen has already said so about each of them by name. */
    const sweepRoots = plan.roots.filter(root => root.guarded === true && root.present === true)

    /* NO FURTHER SHELL STATE IS WRITTEN FROM HERE, and the flag is set BEFORE
       the sweep rather than after it. Sweeping two directory trees takes a
       second or two, the window is still alive and painting throughout, and a
       theme write landing in that gap would recreate the directory mid-removal.
       It is set only when there is something to sweep: flipping it on a run that
       deleted nothing would silently stop saving a person's settings for the
       rest of the session. */
    if (sweepRoots.length > 0) localDataErased = true

    const swept = eraseLocalData({
      roots: sweepRoots,
      /* The person's own data first, the browser's scratch last. See the note
         on `priority` in shell/local-data-reset.cjs. */
      priority: ['capability', 'product-accounts.json', 'product-session.enc', 'agent-spawn-key.enc',
        'agent-spawn-records.jsonl', 'purchase-catalog.json', 'fleet-profile.json', 'renderer-prefs.json',
        'uninstall-data-policy.txt', 'workspace', 'Local Storage', 'shell-state.json'],
    })

    return {
      ok: true,
      plan,
      revoked: { ok: revoked.ok === true, revokedSessions: revoked.revoked === true },
      /* Reported, never assumed: a ledger this process could not close is the
         one thing most likely to leave a file behind, and the screen has to be
         able to say so rather than presenting an unexplained survivor. */
      ledgerClosed: { ok: ledgerClosed.ok === true, closed: ledgerClosed.closed === true, reason: ledgerClosed.reason ?? null },
      swept,
    }
  }))

/* Two ways to get the bootstrap proof, and the order matters.
 *
 * MC_BRIDGE_PROOF_FILE is the developer path: a bridge was started outside
 * this app and its proof file was named on the environment. It wins when it is
 * set AND this build is not packaged, so a developer pointing the app at a
 * bridge they are debugging keeps getting that bridge and not a second one this
 * app started. In a packaged build it is ignored -- the variable is settable by
 * any same-user process without elevation, so it cannot be treated as proof
 * that a developer is present. The fence is applied where bridgeProof is
 * produced, not here, which is why the tail of this function is safe as well:
 * it returns the same env-derived value and would otherwise leak it.
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

ipcMain.handle('mc-bridge-proof', async () => {
  await capabilityLayerSettled()
  return currentBridgeProof()
})

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
 * reports source 'env' and the renderer keeps scanning.
 *
 * That scan is the exposure this pin exists to prevent, so it is now reachable
 * only in an unpackaged build, where a developer really did opt in. A packaged
 * build never produces an ok env proof at all (see the bridgeProof declaration
 * above), so this function cannot reach 'env' there and the customer path is
 * always the pinned, non-scanning one. envProofRefused rides along so a
 * tampered launch is legible to the renderer and not only to the record on
 * disk. */
function currentBridgeEndpoint() {
  const envProofRefused = bridgeProof.envProofRefused === true
  if (bridgeProof.ok) return { ok: true, source: 'env' }
  if (capabilityLayerStatus.ok && typeof capabilityLayerStatus.baseUrl === 'string') {
    return {
      ok: true,
      source: 'supervised',
      baseUrl: capabilityLayerStatus.baseUrl,
      pid: capabilityLayerStatus.pid,
      envProofRefused,
    }
  }
  return { ok: false, source: 'none', reason: capabilityLayerStatus.reason, envProofRefused }
}

ipcMain.handle('mc-bridge-endpoint', async () => {
  await capabilityLayerSettled()
  return currentBridgeEndpoint()
})

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
function startSupervisedCapabilityLayer() {
  /* Idempotent. The window no longer awaits this before it is built, so the
     call site and the readers below can both reach it; two layers on two ports
     is not a performance improvement. */
  if (capabilityLayerStarting) return capabilityLayerStarting
  capabilityLayerStarting = (async () => {
    const root = resolveCapabilityRoot()
    const workspaceRoot = WORKSPACE_ROOT
    try { fs.mkdirSync(workspaceRoot, { recursive: true }) } catch { /* the layer reports its own refusal */ }
    /* THE ASSISTANT CONFIGURATION IS WRITTEN WHERE THE ROOT IS DECLARED, in the
       same three lines that create the directory and hand it to the bridge.
       Every Claude lane the bridge starts is launched with
       `--mcp-config <root>\.mcp.json --strict-mcp-config`, and a missing file
       there is not "an agent with no tools" -- the CLI exits before it runs.
       This is also the only path that repairs an installation upgraded from a
       build that never wrote the file, since its owner has no reason to answer
       the permission question a second time.

       It cannot fail the launch and is not awaited for a verdict: a window that
       opens and honestly reports a broken lane is better than no window, which
       is the same rule the layer supervisor above it already follows. */
    const dispatchAssistantConfig = ensureDispatchAssistantConfig({ dispatchRoot: workspaceRoot })
    if (!dispatchAssistantConfig.ok) {
      console.error(`[capability-layer] the dispatch root has no assistant configuration: ${dispatchAssistantConfig.code}`)
    }
    /* AND THE PERSON'S OWN COPY, WHICH NOTHING HAS EVER REVISITED. Their folder's
       `.mcp.json` names an executable and an engine directory belonging to the
       COPY THAT WROTE IT, and setup runs once -- so an updated, moved or second
       installation left them a document pointing at the old build. Their agent
       client then started that build: an extra application window per session,
       and no ToolsEnabled tools in it, because a GUI launch never speaks
       JSON-RPC. Refreshed only where a document already exists, so the
       unanswered folder question still provisions nothing. */
    const chosenAssistantConfig = refreshChosenAssistantConfig({})
    if (!chosenAssistantConfig.ok && chosenAssistantConfig.code !== 'SETUP_ASSISTANT_CONFIG_ABSENT'
      && chosenAssistantConfig.code !== 'SETUP_ASSISTANT_CONFIG_NOT_RECORDED') {
      console.error(`[capability-layer] the chosen folder's assistant configuration was not refreshed: ${chosenAssistantConfig.code}`)
    }

    const started = await startCapabilityLayer({
      root,
      origin: shellOrigin,
      workspaceRoot,
      /* Stated, not inherited. The layer would derive the same directory on its
         own, but a relocated profile (--user-data-dir, a portable install, a test
         harness) is exactly the case where deriving it twice produces two
         half-populated state roots. */
      stateRoot: CAPABILITY_STATE_ROOT,
      /* The spawn seam capability-layer.cjs already exposes, used for the one
         thing this shell needs that its resolved value cannot give: a handle to
         the child BEFORE it has announced itself. See capabilityLayerChild.

         THE CHILD'S ENVIRONMENT IS NEVER INHERITED BLIND. The command this seam
         is handed is process.execPath -- packaged, the ToolsEnabled executable
         itself. The layer composes that child's env explicitly (childEnvironment
         in capability-layer.cjs, where ELECTRON_RUN_AS_NODE='1' is deliberate:
         the engine reuses this binary as its Node runtime), and an explicit env
         passes through here untouched. But if any future caller reaches this
         seam WITHOUT one, Node would fall back to this process's full
         process.env -- and under an agent harness that inherits
         ELECTRON_RUN_AS_NODE=1, a GUI launch of the packaged exe becomes plain
         node: read stdin, EOF, exit 0, no window, indistinguishable from a
         crash (it broke two harness runs on 2026-08-11 alone). So the absent-env
         case gets guiEnvironment(process.env) -- the shared strip from
         capability-layer.cjs -- instead of the raw inheritance. */
      spawn: (command, args, options) => {
        const child = spawnChildProcess(command, args, {
          ...options,
          env: options && options.env ? options.env : guiEnvironment(process.env),
        })
        capabilityLayerChild = child
        return child
      },
    })
    capabilityLayerStatus = started.ok
      ? { ok: true, baseUrl: started.baseUrl, port: started.port, pid: started.pid }
      : { ok: false, code: started.code, reason: started.reason }

    if (!started.ok) {
      capabilityLayerChild = null
      console.error(`[capability-layer] not started: ${started.code} ${started.reason}`)
      return capabilityLayerStatus
    }

    capabilityLayer = started
    /* A layer that dies after a successful start must stop being reported as
       running. Without this the proof handler would keep reading a proof file
       for a process that is gone, and the renderer would see an authorization
       failure instead of an unreachable bridge. */
    started.child.once('exit', (code) => {
      if (capabilityLayerChild === started.child) capabilityLayerChild = null
      if (capabilityLayer !== started) return
      capabilityLayer = null
      capabilityLayerStatus = { ok: false, code: 'CAPABILITY_EXITED', reason: `The capability layer exited with code ${code}.` }
    })
    return capabilityLayerStatus
  })()
  return capabilityLayerStarting
}

/* THE ANSWER EVERY READER OF THE LAYER'S STATUS MUST WAIT FOR.
 *
 * `capabilityLayerStatus` begins life as a refusal -- CAPABILITY_NOT_STARTED --
 * and that value is now reachable by a renderer, because the window is built
 * while the layer is still coming up. Handing it out would be this codebase's
 * signature defect pointed at the bridge: a state that means "not yet" read as
 * a state that means "there is none". So the readers await the start they know
 * is in flight, and only a start that has actually SETTLED can produce a
 * refusal. A launch where the layer was never started at all still answers
 * immediately, with the same refusal it always gave. */
async function capabilityLayerSettled() {
  if (capabilityLayerStarting) {
    try { await capabilityLayerStarting } catch { /* the status field carries the outcome */ }
  }
  return capabilityLayerStatus
}

async function createWindow() {
  /* THE BOOT THEME COMES FROM THE SETTINGS FILE, NOT FROM shell-state.json.
     Both files carry a theme, and before the settings file existed they could
     disagree in a way a person actually saw: shell-state.json remembered black
     from the last launch, so the native window and caption buttons were seeded
     black, while the renderer -- whose only copy was in the browser partition
     the port change had just emptied -- painted white. The page and the frame
     around it were two different themes and neither was wrong about what it
     knew. The settings file is now the source and shell-state's copy is a
     cache of what was last painted, so the two cannot diverge across a
     relaunch. */
  const shellState = readState()
  const state = restoredWindowState({ ...shellState, theme: bootTheme(shellState) }, currentWorkAreas())
  const seed = THEME_SEED[state.theme] || THEME_SEED.white
  const server = await serveDist()
  const port = server.address().port
  shellOrigin = `http://127.0.0.1:${port}`
  /* STARTED HERE, AWAITED AT THE BOTTOM. Not a micro-optimisation: this line
     used to be `await`ed, and everything below it -- constructing the window,
     Chromium creating a renderer, parsing 1.3MB of application -- waited on a
     node process booting the mission bridge, opening its vault and binding a
     port. Measured on this machine that is a median 525ms of a 1503ms cold
     start, spent showing nothing. The two are independent: the layer needs
     only `shellOrigin`, which the line above just produced, and the first
     screen reads nothing from the layer. So they now run at the same time.

     createWindow()'s contract is unchanged -- it still does not resolve until
     the layer has settled -- so every caller and every startup gate downstream
     of it sees exactly what it saw before. What changed is only WHEN the
     person gets their window. */
  const capabilityLayerStart = startSupervisedCapabilityLayer()

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
  /* The other half of the concurrency above. Awaited AFTER the window is on
     screen and loaded, so the wait costs the person nothing, and awaited at
     all so that a caller which has seen createWindow() resolve can still rely
     on the layer having settled -- the same guarantee it had when this was the
     first thing that happened. */
  await capabilityLayerStart
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
  /* THE APP IS CLOSING -- best-effort, synchronous, before the map is emptied.
     Each write is fsync'd, so on an orderly quit these usually land; a quit
     that never reaches here (a hard kill, a crash) leaves no end record, and
     that absence stays readable as "does not say". Nothing backfills it. */
  for (const [sessionId, session] of agentSessions) {
    recordSessionEnd(session, sessionId, 'app-shutdown')
  }
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
  /* `capabilityLayerChild` covers the case `capabilityLayer` cannot: a quit
     that lands while the layer is still starting. Since the window is built
     concurrently with that start, a person closing it during launch is an
     ordinary event, and the child they would leave behind is exactly the
     orphaned port-holder this handler exists to prevent. */
  const child = capabilityLayer?.child || capabilityLayerChild
  capabilityLayer = null
  capabilityLayerChild = null
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
