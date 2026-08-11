'use strict'

/* The permission level, recorded where the rest of the product looks for it.
 *
 * docs/design/INSTALLER-EXPERIENCE.md 2.1 calls the permission-level question
 * the product's first impression. Until now it existed in exactly one place --
 * tools/mcsetup.js, an interactive command-line program -- so the only way to
 * answer it was to have a developer checkout and a terminal. The screen this
 * module backs asks it in the app instead.
 *
 * IT WRITES THE ENGINE'S RECORD, NOT A SECOND ONE.
 * The tempting shortcut is a small app-owned file holding one string. That
 * would produce two answers to "what level is this install", which is worse
 * than none, because the two cannot disagree loudly. So every value here comes
 * from src/lib/setup/machine-record.js out of the capability payload: it owns
 * the list of tiers, the shape of the record, the validation, and the atomic
 * write. This file resolves the four machine facts that module cannot know
 * from inside a GUI process, and otherwise gets out of the way.
 *
 * IT NEVER RETURNS AN INTERNAL PATH.
 * The services root, the install root and the runtime stay in the main process,
 * for the same reason shell/main.cjs keeps the agent resolver's path-bearing
 * message out of its IPC reply: a failure string is the easiest way for an
 * internal directory name to reach the DOM.
 *
 * ONE PATH CROSSES, AND IT IS NOT ONE OF THOSE. The workspace does, because
 * docs/design/INSTALLER-EXPERIENCE.md section 3 step 7 asks the person WHICH
 * FOLDER their assistant may work in, and that question cannot be asked without
 * naming the folder -- "Guided is shown one card containing `Documents\AI
 * Workspace`, created for her, with a single 'Use this folder' button". It is
 * also the one path here that belongs to the user rather than to the
 * installation, so showing it tells them about their own computer rather than
 * about ours. The rule it is an exception to is unchanged for every other value:
 * servicesRoot, installRoot and nodePath are still absent from every reply below,
 * including the failure ones.
 *
 * (This was the gap the first-run screen shipped with. `recordTier` writes
 * `workspaceRoots: [workspace.defaultWorkspacePath({})]` when no record exists,
 * so an installation that never answered the workspace question still has one --
 * chosen for the user, in a folder they were never shown. The functions below
 * exist to stop that being the only way it can happen.)
 */

const fs = require('node:fs')
const path = require('node:path')
const { resolveCapabilityRoot } = require('./capability-layer.cjs')

/* Declared in tools/capability-manifest.json under `hostModules`, which is what
 * puts them in the payload; a copy of the path is unavoidable (the manifest is
 * a build input and this is a runtime read), so the failure below names the
 * manifest rather than reporting a bare MODULE_NOT_FOUND. */
const MACHINE_RECORD_MODULE = 'src/lib/setup/machine-record.js'
const WORKSPACE_MODULE = 'src/lib/setup/workspace.js'

function failure(code, reason) {
  return { ok: false, code, reason }
}

function loadSetupModules({ root = resolveCapabilityRoot(), load = require } = {}) {
  if (!root) {
    return failure(
      'SETUP_PAYLOAD_ABSENT',
      'No capability payload is present, so this copy has no setup code to record a permission level with.',
    )
  }
  let machineRecord
  let workspace
  try {
    machineRecord = load(path.join(root, MACHINE_RECORD_MODULE))
    workspace = load(path.join(root, WORKSPACE_MODULE))
  } catch (error) {
    return failure(
      'SETUP_MODULES_ABSENT',
      `The capability payload does not carry its setup modules (${error.message}). They are staged by tools/capability-manifest.json under hostModules.`,
    )
  }
  if (!Array.isArray(machineRecord?.TIERS)
    || typeof machineRecord.writeMachineRecord !== 'function'
    || typeof machineRecord.writeMcpConfig !== 'function') {
    return failure('SETUP_MODULES_UNRECOGNIZED', 'The capability payload carries a setup module this shell does not recognize.')
  }
  return { ok: true, machineRecord, workspace }
}

/* Where this install lives. Packaged, process.resourcesPath is
 * <install>/resources, so the install root is its parent. In a checkout it is
 * the repo root. Derived from the same value resolveCapabilityRoot() uses, so
 * the two cannot describe different installations. */
function resolveInstallRoot({ resourcesPath = process.resourcesPath, repoRoot = path.join(__dirname, '..') } = {}) {
  if (typeof resourcesPath === 'string' && resourcesPath) return path.dirname(resourcesPath)
  return path.resolve(repoRoot)
}

/* The Node that runs the servers.
 *
 * process.execPath is the Electron binary, and that IS this installation's
 * Node: shell/capability-layer.cjs already starts the whole capability layer
 * on it under ELECTRON_RUN_AS_NODE, which is the reason no second runtime
 * ships. Recording anything else would name a runtime this install does not
 * carry. Nothing outside src/lib/setup/ reads this field today (checked across
 * the engine tree: only mcsetup.js and setup/plan.js do), so it describes the
 * install rather than driving a spawn.
 */
function resolveRuntimePath({ execPath = process.execPath } = {}) {
  return execPath
}

/**
 * What the app should show before it asks. Never throws: a first-run screen
 * that crashes on a malformed record is a product that cannot be recovered
 * from its own UI.
 */
function readTierState(options = {}) {
  const modules = options.modules || loadSetupModules(options)
  if (!modules.ok) return { ok: true, available: false, code: modules.code, reason: modules.reason, configured: false, tier: null, tiers: [] }

  const { machineRecord } = modules
  const tiers = machineRecord.TIERS.slice()
  let record
  try {
    record = machineRecord.readMachineRecord({ servicesRoot: machineRecord.resolveServicesRoot({}) })
  } catch (error) {
    /* A record that exists and is unreadable is NOT "not set up yet". Saying
     * so would invite the app to overwrite a configuration it could not read,
     * which is exactly what readMachineRecord refuses to do. */
    return {
      ok: true,
      available: true,
      configured: false,
      unreadable: true,
      code: error?.code || 'SETUP_MACHINE_RECORD_UNREADABLE',
      reason: error?.message || 'The recorded configuration could not be read.',
      tier: null,
      tiers,
    }
  }
  if (!record) return { ok: true, available: true, configured: false, tier: null, tiers }
  return { ok: true, available: true, configured: true, tier: record.tier, tiers }
}

/**
 * Record the chosen level.
 *
 * An existing record keeps every field it already has except the tier. The
 * person answering this question again -- "you can change it later" -- is
 * changing one thing, and rebuilding the record from defaults would silently
 * relocate the workspace they chose.
 */
function recordTier(tier, options = {}) {
  const modules = options.modules || loadSetupModules(options)
  if (!modules.ok) return modules

  const { machineRecord, workspace } = modules
  if (!machineRecord.TIERS.includes(tier)) {
    return failure('SETUP_TIER_UNKNOWN', 'That is not one of the permission levels this product offers.')
  }

  const servicesRoot = machineRecord.resolveServicesRoot({})
  let existing = null
  try {
    existing = machineRecord.readMachineRecord({ servicesRoot })
  } catch (error) {
    return failure(error?.code || 'SETUP_MACHINE_RECORD_UNREADABLE', error?.message || 'The recorded configuration could not be read.')
  }

  let record
  try {
    record = machineRecord.buildMachineRecord({
      ...(existing || {}),
      tier,
      installRoot: existing ? existing.installRoot : resolveInstallRoot(options),
      servicesRoot,
      nodePath: existing ? existing.nodePath : machineRecord.resolveNodePath({ execPath: resolveRuntimePath(options) }),
      workspaceRoots: existing ? existing.workspaceRoots : [workspace.defaultWorkspacePath({})],
      machineId: existing ? existing.machine.id : machineRecord.defaultMachineId(),
      machineLabel: existing ? existing.machine.label : machineRecord.defaultMachineLabel(),
      createdAtMs: existing ? existing.createdAtMs : Date.now(),
    })
  } catch (error) {
    return failure(error?.code || 'SETUP_MACHINE_RECORD_INVALID', error?.message || 'That level could not be recorded.')
  }

  try {
    machineRecord.writeMachineRecord(record, { servicesRoot })
  } catch (error) {
    return failure(error?.code || 'SETUP_MACHINE_RECORD_WRITE_FAILED', 'The permission level could not be saved on this computer.')
  }
  return { ok: true, tier: record.tier, configured: true, assistantConfig: writeAssistantConfig(record, modules) }
}

/**
 * Project the record into the `.mcp.json` an agent client reads.
 *
 * THE RECORD ALONE CONFIGURES NOTHING. tools/mcsetup.js has always written both
 * -- the record AND the generated document (mcsetup.js applyPlan) -- but the app
 * wrote only the record. An installation created through the first-run screen
 * therefore had no `.mcp.json` at all, so the answer to "how much should the
 * assistant be allowed to do" narrowed nothing for any client that reads one.
 * The command-line path and the app path produced different installations from
 * the same answer, and only one of them was configured.
 *
 * A STALE DOCUMENT IS REMOVED RATHER THAN LEFT. The dangerous case is not the
 * absent file, it is the previous one: someone moving `unrestricted` down to
 * `guided` whose old document still names the full surface would have narrowed
 * the record and nothing else, and the file that actually configures their agent
 * client would still grant what they just revoked. If the narrower document
 * cannot be written, the wider one does not get to survive.
 *
 * It never fails the recording. The level is the person's answer and it is
 * already saved; reporting `ok: false` here would tell them their choice did not
 * take when it did. The generation outcome is returned ALONGSIDE so the screen
 * can say what did and did not happen, with a code and no path.
 */
function writeAssistantConfig(record, modules) {
  const { machineRecord } = modules
  const targetDirectory = Array.isArray(record.workspaceRoots) ? record.workspaceRoots[0] : null
  if (typeof targetDirectory !== 'string' || targetDirectory.length === 0) {
    return { ok: false, code: 'SETUP_ASSISTANT_CONFIG_NO_WORKSPACE' }
  }
  try {
    fs.mkdirSync(targetDirectory, { recursive: true })
  } catch (error) {
    return { ok: false, code: error?.code === 'EACCES' || error?.code === 'EPERM' ? 'SETUP_ASSISTANT_CONFIG_DENIED' : 'SETUP_ASSISTANT_CONFIG_NO_WORKSPACE' }
  }
  try {
    const generated = machineRecord.writeMcpConfig(record, { targetDirectory })
    return {
      ok: true,
      code: 'SETUP_ASSISTANT_CONFIG_WRITTEN',
      servers: Object.keys(generated.document.mcpServers),
    }
  } catch (error) {
    try { fs.rmSync(path.join(targetDirectory, '.mcp.json'), { force: true }) } catch { /* Reported below regardless. */ }
    return { ok: false, code: error?.code || 'SETUP_ASSISTANT_CONFIG_FAILED' }
  }
}

/* ---------- the workspace question (design section 3, step 7) ---------- */

const MAX_WORKSPACE_ROOTS = 8

/**
 * What the workspace step should show before it asks.
 *
 * Never throws, for the same reason readTierState does not: a walkthrough that
 * crashes on a malformed record is a product that cannot be recovered from its
 * own first screen. Every unknown collapses to `available: false` with a code and
 * a reason, and the screen states that instead of offering a button that fails.
 */
function readWorkspaceState(options = {}) {
  const modules = options.modules || loadSetupModules(options)
  if (!modules.ok) {
    return { ok: true, available: false, code: modules.code, reason: modules.reason, roots: [], suggested: null }
  }
  const { machineRecord, workspace } = modules
  let suggested = null
  try { suggested = workspace.defaultWorkspacePath({}) } catch { suggested = null }

  let record
  try {
    record = machineRecord.readMachineRecord({ servicesRoot: machineRecord.resolveServicesRoot({}) })
  } catch (error) {
    return {
      ok: true,
      available: false,
      code: error?.code || 'SETUP_MACHINE_RECORD_UNREADABLE',
      reason: error?.message || 'The recorded configuration could not be read.',
      roots: [],
      suggested,
    }
  }
  /* No record means the permission level has not been answered yet. The
     workspace cannot be recorded before it, because the level decides which
     folders are refused -- so this reports "not yet", not an error. */
  if (!record) {
    return { ok: true, available: true, configured: false, tier: null, roots: [], suggested, recorded: false }
  }
  return {
    ok: true,
    available: true,
    configured: true,
    tier: record.tier,
    roots: Array.isArray(record.workspaceRoots) ? record.workspaceRoots.slice() : [],
    suggested,
    /* True only once the person has been shown the question and answered it.
       A record whose roots are exactly the suggested default and which was never
       asked is reported as `chosen: false`, so the walkthrough can tell "they
       picked this" from "nobody ever asked". */
    chosen: Boolean(record.workspaceChosen),
    recorded: true,
  }
}

/**
 * Would this folder be allowed, and if not, why in words the person can act on?
 *
 * The check is `src/lib/setup/workspace.js` out of the payload -- the same
 * refusals `tools/mcsetup.js` applies -- rather than a second opinion written
 * here. The install root it needs is main-process knowledge, which is why this
 * cannot live in the renderer.
 */
function checkWorkspace(candidate, options = {}) {
  const modules = options.modules || loadSetupModules(options)
  if (!modules.ok) return { ok: false, code: modules.code, reason: modules.reason }

  const { machineRecord, workspace } = modules
  let tier = 'guided'
  try {
    const record = machineRecord.readMachineRecord({ servicesRoot: machineRecord.resolveServicesRoot({}) })
    /* An unreadable or absent record leaves `guided`, the STRICTEST setting for
       this check: it applies the inside-the-installation refusal that
       `unrestricted` is allowed to waive. Defaulting the other way would waive a
       refusal because a file could not be read. */
    if (record && typeof record.tier === 'string') tier = record.tier
  } catch { /* keep guided */ }

  const verdict = workspace.checkWorkspaceCandidate(candidate, { installRoot: resolveInstallRoot(options), tier })
  if (!verdict.ok) return { ok: false, code: verdict.code, reason: verdict.message, resolved: verdict.resolved || null }
  return { ok: true, resolved: verdict.resolved }
}

/**
 * Record the folders, having created them and given them a history.
 *
 * EVERY ROOT IS CHECKED BEFORE ANY IS CREATED. A list where the third entry is
 * refused must not leave two new folders on someone's disk and no record, so the
 * refusal happens over the whole list first.
 *
 * The record keeps every other field it already has. Someone changing the folder
 * later is changing one thing, and rebuilding from defaults would silently move
 * the permission level they chose.
 */
function recordWorkspaces(roots, options = {}) {
  const modules = options.modules || loadSetupModules(options)
  if (!modules.ok) return modules

  const { machineRecord, workspace } = modules
  if (!Array.isArray(roots) || roots.length === 0) {
    return failure('SETUP_WORKSPACE_MISSING', 'Choose a folder for your assistant to work in.')
  }
  if (roots.length > MAX_WORKSPACE_ROOTS) {
    return failure('SETUP_WORKSPACE_TOO_MANY', `Setup records at most ${MAX_WORKSPACE_ROOTS} folders.`)
  }

  const servicesRoot = machineRecord.resolveServicesRoot({})
  let existing = null
  try {
    existing = machineRecord.readMachineRecord({ servicesRoot })
  } catch (error) {
    return failure(error?.code || 'SETUP_MACHINE_RECORD_UNREADABLE', error?.message || 'The recorded configuration could not be read.')
  }
  /* The permission level decides which folders are refused, so it has to exist
     before a folder can be recorded against it. In the walkthrough it always
     does -- the level is the screen before this one. */
  if (!existing) {
    return failure('SETUP_TIER_NOT_RECORDED', 'Choose a permission level first; it decides which folders can be used.')
  }

  const installRoot = existing.installRoot || resolveInstallRoot(options)
  const checked = []
  for (const candidate of roots) {
    const verdict = workspace.checkWorkspaceCandidate(candidate, { installRoot, tier: existing.tier })
    if (!verdict.ok) {
      return { ok: false, code: verdict.code, reason: verdict.message, resolved: verdict.resolved || null }
    }
    if (!checked.includes(verdict.resolved)) checked.push(verdict.resolved)
  }

  const provisioned = []
  for (const resolved of checked) {
    let result
    try {
      result = workspace.provisionWorkspace(resolved, { installRoot, tier: existing.tier })
    } catch (error) {
      return failure(error?.code || 'SETUP_WORKSPACE_UNAVAILABLE', error?.message || 'That folder could not be prepared.')
    }
    provisioned.push({
      workspace: result.workspace,
      created: Boolean(result.created),
      undoAvailable: Boolean(result.undoAvailable),
      undoUnavailableReason: result.undoUnavailableReason || null,
    })
  }

  let record
  try {
    record = machineRecord.buildMachineRecord({
      ...existing,
      workspaceRoots: checked,
      machineId: existing.machine.id,
      machineLabel: existing.machine.label,
    })
  } catch (error) {
    return failure(error?.code || 'SETUP_MACHINE_RECORD_INVALID', error?.message || 'Those folders could not be recorded.')
  }

  /* `workspaceChosen` rides ALONGSIDE the validated record rather than through
     buildMachineRecord, which constructs only the fields it knows and would drop
     it. validateMachineRecord accepts additional keys, and readMachineRecord
     validates rather than rewrites, so the flag survives a round trip while the
     engine's own schema stays exactly what src/lib/setup/machine-record.js says
     it is. It is one boolean and it means "a person was shown this question and
     answered it", which is the difference between a chosen folder and a default
     nobody saw. */
  const stamped = { ...record, workspaceChosen: true }
  try {
    machineRecord.writeMachineRecord(stamped, { servicesRoot })
  } catch (error) {
    return failure(error?.code || 'SETUP_MACHINE_RECORD_WRITE_FAILED', 'Those folders could not be saved on this computer.')
  }
  return { ok: true, roots: checked, provisioned }
}

module.exports = {
  MACHINE_RECORD_MODULE,
  WORKSPACE_MODULE,
  MAX_WORKSPACE_ROOTS,
  loadSetupModules,
  readTierState,
  recordTier,
  readWorkspaceState,
  checkWorkspace,
  recordWorkspaces,
  resolveInstallRoot,
  resolveRuntimePath,
}
