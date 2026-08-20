'use strict'

/* THE HALF OF A USER SETTING THAT DID NOT EXIST: A WAY TO CHANGE IT.
 *
 * The owner's rule, stated and re-stated: a user setting is a registry row, a
 * real enforcement, AND a control in the software -- or it is a lie. The
 * research rows had two of the three. `research.pipeline`, `research.runner_agent`,
 * `research.runner_process` and `research.runner_http` are declared in the
 * payload's config/settings-registry.json and genuinely enforced by
 * src/lib/research/settings-gate.js (the provider's submit path, the runs
 * worker, and runner selection all ask it and none of them re-reads settings on
 * its own). What nothing in this product had was a WRITER. The whole tree
 * carried exactly one settings entry point -- `settings.read` in the payload's
 * tool registry -- and no bridge action, no IPC channel and no control anywhere
 * that could set a value.
 *
 * The consequence a person met: the research page says "The research pipeline
 * is switched off in settings", and there was no such switch in Settings. The
 * only way to run anything was to hand-write
 * %LOCALAPPDATA%\ToolsEnabled\settings.json, which is what the final gate did.
 * For a research product that is fatal: the feature is unreachable by its user.
 *
 * WHY THE SHELL OWNS THIS AND NOT THE PAGE. The settings file lives beside the
 * machine record in the installation's own directory, outside the renderer's
 * reach by design -- the same reason the account boundary and the data reset are
 * main-process acts. A renderer-side "setting" would be a localStorage key that
 * the capability layer never reads, which is the defect, not the fix.
 *
 * WHY THE SHELL AND NOT THE BRIDGE. The capability payload is DERIVED from a
 * pinned engine source (private/capability-source.owner.json), so a new bridge
 * action would have to land in a different repository and be re-cut before it
 * could ship here. The shell already requires payload modules for exactly this
 * class of job (shell/canonical-audit.cjs, shell/setup-record.cjs), and doing it
 * here keeps the enforcement, the file format and the validator as the payload's
 * -- which is the property that matters. Nothing in this file re-implements a
 * rule the payload owns.
 *
 * THE VALIDATOR IS THE PAYLOAD'S, ASKED RATHER THAN COPIED. src/lib/settings.js
 * keeps its per-control validation private (`validationFailure`). Restating it
 * here would create a second opinion about what a legal value is, and the two
 * would drift in the direction that hurts: this file accepting something the
 * gate then reads as "not exactly true" and withholds, with a switch on the
 * screen that says ON. So a write is performed and then RE-READ through
 * loadSettings(), and a value that comes back rejected is rolled back to the
 * exact bytes that were there before and reported with the payload's own
 * sentence. The authority is never duplicated; it is consulted.
 *
 * PROVENANCE IS THE POINT OF THE WRITE. The gate refuses a value whose
 * provenance is not `user` or `installer` -- "a control enforcing an
 * agent-invented value is a software failure". This writer stamps `user` and
 * only `user`, because the only caller is a person moving a control in the
 * window. Nothing here can stamp `installer`, and no caller can ask it to.
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const { resolveCapabilityRoot } = require('./capability-layer.cjs')

/* Declared in tools/capability-manifest.json under `hostModules`, for the same
   reason shell/canonical-audit.cjs declares src/lib/audit.js: these are modules
   the SHELL requires out of the payload rather than programs the payload runs,
   and a require() walk from the payload's entrypoints is not what puts them
   there. A miss below names the manifest instead of reporting a bare
   MODULE_NOT_FOUND. */
const SETTINGS_MODULE = 'src/lib/settings.js'
const REGISTRY_MODULE = 'src/lib/settings-registry.js'

/* THE ROWS THIS SHELL WILL WRITE, BY NAME, AND WHY THERE IS A LIST AT ALL.
 *
 * The registry declares 50-odd settings, and most of them are enforced by parts
 * of the payload this window has never driven and this lane has not measured. A
 * writer that accepted any id would put a control on the glass for every one of
 * them -- which is the same lie in the other direction: a switch that moves a
 * value nothing in this build reads.
 *
 * So the surface is opened one row at a time, each admitted only once its
 * enforcement has been driven end to end. These four are the research family,
 * and this lane drives them: the settings gate, the provider's submit path and
 * the runs worker all consult them, and tools/research-walkthrough-qa.mjs
 * presses the switch and watches a real process run.
 *
 * ADDING A ROW HERE IS A DELIBERATE ACT WITH A DRIVE ATTACHED. It is not a
 * convenience list to grow; it is the boundary of what this product can
 * honestly say it lets you change. */
const WRITABLE_IDS = Object.freeze([
  'research.pipeline',
  'research.runner_agent',
  'research.runner_process',
  'research.runner_http',
  /* The standard tool note handed to every new agent session. Its enforcement
     is driven end to end: the payload's src/lib/agent-tool-summary.js is the
     row's named enforcer (engine suite tests/agent-tool-summary.test.js proves
     the row off means no note), and tools/test/tool-summary-injection.test.mjs
     proves the host injects on-and-only-on. Until this build's payload is
     repacked with that module, readProductSettings honestly reports the row as
     not present in this copy's registry -- which is the designed mismatch
     surface, not a dead switch. */
  'agent.tool_summary',
])

function failure(code, reason) {
  return { ok: false, code, reason }
}

let cached = null

/**
 * Load the payload's settings reader and its registry.
 *
 * Cached like shell/canonical-audit.cjs caches its writer, and for the same
 * reason: a copy with no payload should not pay a module resolution every time
 * a page asks what its settings are.
 */
function loadSettingsModules({ root = resolveCapabilityRoot(), load = require } = {}) {
  if (!root) {
    return failure(
      'SETTINGS_PAYLOAD_ABSENT',
      'No capability payload is present, so this copy carries no settings registry and nothing that would enforce one.',
    )
  }
  let settings
  let registry
  try {
    settings = load(path.join(root, SETTINGS_MODULE))
    registry = load(path.join(root, REGISTRY_MODULE))
  } catch (error) {
    return failure(
      'SETTINGS_MODULES_ABSENT',
      `The capability payload does not carry its settings modules (${error.message}). They are staged by tools/capability-manifest.json under hostModules.`,
    )
  }
  if (typeof settings?.loadSettings !== 'function' || typeof settings?.resolveValuesPath !== 'function'
    || typeof registry?.loadRegistry !== 'function') {
    return failure('SETTINGS_MODULES_UNRECOGNIZED', 'The capability payload carries a settings module this shell does not recognize.')
  }
  return { ok: true, settings, registry, registryFile: path.join(root, REGISTRY_FILE) }
}

/* THE PLAIN NAME OF EACH ROW, TAKEN FROM THE REGISTRY RATHER THAN WRITTEN AGAIN.
 *
 * config/settings-registry.json carries a `titles` map -- "Running research jobs
 * on this computer" and its three siblings -- and loadRegistry() drops it: it
 * validates and indexes `entries` and returns nothing else. Those titles are the
 * product's own words for these switches, already reviewed, and a settings page
 * that re-typed them would be a second wording to keep in step with the first.
 * So the same file is read once more, for that map alone.
 *
 * IT ASKED FOR THE WRONG KEY, AND THE MISS WAS SILENT BY DESIGN. This read
 * `parsed.labels` until 2026-08-20. The registry's top-level keys are exactly
 * ["schemaVersion","titles","entries"] and have been in every copy of it in this
 * tree, so the map was never found, and the "unreadable or nameless registry"
 * branch below -- meant for a broken copy -- was the ONLY branch on every
 * machine. src/research-settings.js then fell to its last resort and drew the
 * identifier, so a person opening Settings read "research.pipeline" where a
 * reviewed English sentence belongs, four rows running. The failure mode is the
 * instructive part: an absent key is indistinguishable here from a damaged
 * registry, which is correct behaviour for a damaged registry and no help at all
 * against a typo. tools/test/research-setting-titles.test.mjs is what makes the
 * key name checkable, by asserting the registry's shape directly.
 *
 * The path is the one settings-registry.js itself resolves (its
 * DEFAULT_REGISTRY_PATH is <payload>/config/settings-registry.json), so this
 * cannot address a different registry than the one the entries came from. An
 * unreadable or title-less registry yields no name, and the surface says the id
 * instead of inventing one. */
const REGISTRY_FILE = path.join('config', 'settings-registry.json')

/* Named for the key it reads, not for the field it fills. The whole defect above
   was a shell that called this map "labels" while the file called it "titles";
   keeping the shell's own word for it would leave the mismatch one rename away
   from coming back. The row's field stays `label` because that is what the page
   consumes. */
function registryTitles(registryFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(registryFile, 'utf8'))
    return parsed && typeof parsed.titles === 'object' && !Array.isArray(parsed.titles) ? parsed.titles : {}
  } catch { return {} }
}

function settingsModules(options = {}) {
  if (options.load || options.root || options.fresh) return loadSettingsModules(options)
  if (!cached) cached = loadSettingsModules(options)
  return cached
}

function resetForTests() {
  cached = null
}

/**
 * What every writable row is, is set to, and rests on -- read at the moment it
 * is asked for.
 *
 * `enforcement.declared` travels with each row because the payload computes it
 * and a surface must be able to say "nothing reads this" from a false. It is
 * deliberately the weaker statement in the other direction: a true means the
 * catalogue NAMES an enforcer, never that the enforcer ran.
 */
function readProductSettings(options = {}) {
  const modules = settingsModules(options)
  if (!modules.ok) return { ok: true, available: false, code: modules.code, reason: modules.reason, rows: [], valuesPath: null }

  let registry
  try {
    registry = modules.registry.loadRegistry()
  } catch (error) {
    return { ok: true, available: false, code: 'SETTINGS_REGISTRY_UNREADABLE', reason: `The settings registry could not be read: ${error.message}`, rows: [], valuesPath: null }
  }

  let resolved
  try {
    resolved = modules.settings.loadSettings({ registry })
  } catch (error) {
    return { ok: true, available: false, code: 'SETTINGS_UNREADABLE', reason: `This installation's settings could not be read: ${error.message}`, rows: [], valuesPath: null }
  }

  const titles = registryTitles(modules.registryFile)
  const rows = []
  for (const id of WRITABLE_IDS) {
    const entry = registry.byId.get(id)
    if (!entry) {
      /* A row this shell offers that the payload does not declare is a
         MISMATCH between the app and the engine it shipped with, and it is
         reported rather than skipped. Skipping it would draw a Settings page
         that silently lost a control between two builds. */
      rows.push({ id, present: false, reason: `"${id}" is not in this payload's settings registry, so this copy has no such control to offer.` })
      continue
    }
    rows.push({
      id,
      present: true,
      label: typeof titles[id] === 'string' && titles[id].trim() ? titles[id].trim() : null,
      control: entry.control,
      depth: entry.depth,
      default: entry.default,
      value: resolved.values[id],
      provenance: resolved.provenance[id],
      consequence: entry.consequence,
      capabilities: Array.isArray(entry.capabilities) ? entry.capabilities.slice() : [],
      risks: Array.isArray(entry.risks) ? entry.risks.slice() : [],
      enforcement: resolved.enforcement[id],
    })
  }

  return {
    ok: true,
    available: true,
    rows,
    valuesPath: resolved.valuesPath,
    revision: resolved.revision,
    rejected: resolved.rejected.filter(entry => entry && (entry.id === '*' || WRITABLE_IDS.includes(entry.id))),
  }
}

/* Read the settings document as BYTES first, because a rollback has to restore
   exactly what was there -- including a file that was not there at all, which
   is restored by being removed again. Reconstructing it from a parse would
   silently reformat somebody else's file. */
function readDocument(valuesPath) {
  let raw
  try {
    raw = fs.readFileSync(valuesPath, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return { existed: false, raw: null, document: null }
    throw error
  }
  let document = null
  try { document = JSON.parse(raw) } catch { document = null }
  return { existed: true, raw, document }
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/* Written to a sibling temporary file and renamed, with the same 0600 the
   payload's own state writers use. A settings file torn in half by a crash
   mid-write reads as an invalid structure, and loadSettings answers that by
   discarding EVERY stored value and falling back to defaults -- which for this
   family means every research control silently returning to off. */
function writeDocumentAtomic(valuesPath, document) {
  fs.mkdirSync(path.dirname(valuesPath), { recursive: true })
  const temporary = `${valuesPath}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(temporary, valuesPath)
  } finally {
    try { fs.rmSync(temporary, { force: true }) } catch { /* renamed away, or never written */ }
  }
}

function restoreDocument(valuesPath, before) {
  try {
    if (!before.existed) fs.rmSync(valuesPath, { force: true })
    else fs.writeFileSync(valuesPath, before.raw, { encoding: 'utf8', mode: 0o600 })
  } catch { /* the caller is already reporting a failure; this cannot make it worse */ }
}

/**
 * Set one settings row, as this person's own choice.
 *
 * Returns the same {ok,...} shape the rest of the shell's IPC uses, and on
 * success the RE-READ row rather than the value it was asked to store, because
 * what a control must show is what the enforcer will see.
 */
function setProductSetting({ id, value }, options = {}) {
  if (!WRITABLE_IDS.includes(id)) {
    return failure('SETTING_NOT_WRITABLE', `"${id}" is not a setting this window can change.`)
  }
  const modules = settingsModules(options)
  if (!modules.ok) return modules

  let registry
  try {
    registry = modules.registry.loadRegistry()
  } catch (error) {
    return failure('SETTINGS_REGISTRY_UNREADABLE', `The settings registry could not be read: ${error.message}`)
  }
  const entry = registry.byId.get(id)
  if (!entry) {
    return failure('SETTING_NOT_DECLARED', `"${id}" is not in this payload's settings registry, so there is nothing to set.`)
  }

  const valuesPath = modules.settings.resolveValuesPath({})
  let before
  try {
    before = readDocument(valuesPath)
  } catch (error) {
    return failure('SETTINGS_UNREADABLE', `This installation's settings could not be read: ${error.message}`)
  }

  /* A file that is on the disk and unparseable is NOT an empty file, and
     overwriting it would destroy every other row in it. The refusal names the
     path so a person can look. */
  if (before.existed && !plainObject(before.document)) {
    return failure(
      'SETTINGS_FILE_UNREADABLE',
      `The settings file at ${valuesPath} could not be read as settings, so nothing was changed. Nothing has been deleted; move it aside to start a fresh one.`,
    )
  }

  const current = before.document || {}
  const values = plainObject(current.values) ? { ...current.values } : {}
  const provenance = plainObject(current.provenance) ? { ...current.provenance } : {}
  const revision = Number.isFinite(current.revision) ? current.revision : 0

  values[id] = value
  provenance[id] = { source: 'user', atMs: Date.now(), directive: null }

  const document = { ...current, values, provenance, revision: revision + 1 }

  try {
    writeDocumentAtomic(valuesPath, document)
  } catch (error) {
    return failure('SETTINGS_WRITE_FAILED', `The settings file could not be written (${error.code || error.message}), so nothing was changed.`)
  }

  /* THE PAYLOAD'S OWN VERDICT ON WHAT WAS JUST WRITTEN. */
  let resolved
  try {
    resolved = modules.settings.loadSettings({ registry })
  } catch (error) {
    restoreDocument(valuesPath, before)
    return failure('SETTINGS_UNREADABLE', `The settings file could not be re-read after the change, so it was put back (${error.message}).`)
  }
  const refused = resolved.rejected.find(item => item && item.id === id)
  if (refused || resolved.values[id] !== value) {
    restoreDocument(valuesPath, before)
    return failure(
      'SETTING_VALUE_REFUSED',
      refused ? refused.reason : `"${id}" did not read back as the value it was set to, so the change was put back.`,
    )
  }

  return {
    ok: true,
    id,
    value: resolved.values[id],
    provenance: resolved.provenance[id],
    revision: resolved.revision,
    valuesPath: resolved.valuesPath,
    enforcement: resolved.enforcement[id],
  }
}

module.exports = {
  REGISTRY_FILE,
  REGISTRY_MODULE,
  SETTINGS_MODULE,
  WRITABLE_IDS,
  loadSettingsModules,
  readProductSettings,
  resetForTests,
  setProductSetting,
}
