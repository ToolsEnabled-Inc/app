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
 * IT NEVER RETURNS A PATH.
 * Every reply crossing to the renderer carries a tier, a boolean and a code.
 * Paths (the services root, the install root, the workspace) stay in the main
 * process, for the same reason shell/main.cjs keeps the agent resolver's
 * path-bearing message out of its IPC reply: a failure string is the easiest
 * way for an internal directory name to reach the DOM.
 */

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
  if (!Array.isArray(machineRecord?.TIERS) || typeof machineRecord.writeMachineRecord !== 'function') {
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
  return { ok: true, tier: record.tier, configured: true }
}

module.exports = {
  MACHINE_RECORD_MODULE,
  WORKSPACE_MODULE,
  loadSetupModules,
  readTierState,
  recordTier,
  resolveInstallRoot,
  resolveRuntimePath,
}
