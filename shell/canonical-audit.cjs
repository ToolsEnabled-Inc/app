'use strict'

/* THE SHELL'S DOOR INTO THE CANONICAL, SIGNED, TAMPER-EVIDENT LEDGER.
 *
 * ToolsEnabled sells two sentences: a policy kernel decides what is allowed
 * before anything happens, and a tamper-evident ledger records what happened.
 * The second one was false for everything this window does. Measured on this
 * machine on 2026-08-12: creating an account, signing in, and failing a sign-in
 * wrote ZERO rows to <userData>/capability/state/audit.sqlite3, whose last
 * entry was two days old and came entirely from the capability layer's own MCP
 * tools. The ledger was honest about what it held. Nothing was asking it to
 * hold anything.
 *
 * WHY NOTHING WAS: the capability layer -- a separate child process -- owns
 * src/lib/audit.js, and every action that reaches it through the bridge gets a
 * durable receipt (see durableReceipt() in the payload's
 * src/lib/mission-bridge/actions.js). The Electron main process grew a SECOND
 * action surface beside it, the mc-account:* / mc-agent:* IPC channels, and
 * that surface never had a recorder at all. shell/product-account.cjs
 * require()s exactly node:crypto, node:fs and node:path.
 *
 * THE PREMISE THAT KEPT IT THAT WAY WAS TESTED AND IS FALSE.
 * shell/spawn-record.cjs states, as the reason it exists as a separate
 * non-canonical chain: "The canonical writer cannot close it here: the shipped
 * payload has no vault (AUDIT_SIGNING_KEY_UNAVAILABLE)". That was true when it
 * was written and stopped being true the first time the capability layer
 * booted. The installed vault at <userData>/capability/vault/secrets.json holds
 * exactly two keys, and they are the two this ledger needs:
 * toolsenabled_audit_head_v1 and toolsenabled_audit_signing_key_v1. The layer
 * creates them on first run -- which is why the app's own ledger already had 20
 * correctly signed entries under them.
 *
 * Measured, not reasoned: a plain host process pointed at the installed state
 * root appended to that ledger and audit.verify() returned valid afterwards.
 * So this module does not need a new key, a new chain, or a new format. It
 * needs to call the writer that was already there.
 *
 * WHAT THIS IS NOT. It is not a second ledger. shell/spawn-record.cjs is one,
 * deliberately and honestly labelled; it stays, because it needs only the OS
 * keystore and therefore still works on an installation whose capability
 * payload is absent. This module is the canonical path, and where both run the
 * canonical one is the record that counts.
 *
 * IT SETS TOOLSENABLED_STATE_ROOT BEFORE THE REQUIRE, AND THAT ORDER IS LOAD
 * BEARING. The payload's audit-store.js resolves its default database path at
 * MODULE LOAD (`const DEFAULT_AUDIT_DB = rootPath('state','audit.sqlite3')`).
 * Setting the variable after the first require() would silently address a
 * different file -- in a packaged build, one inside the read-only install
 * directory. The value is the same one shell/capability-layer.cjs hands the
 * child, so the window and the layer cannot end up describing two ledgers.
 *
 * IT NEVER RECORDS A SECRET. Callers pass an outcome code and an identifier.
 * No password, verifier, salt, session token or vault value reaches this file,
 * and the redaction the payload applies is a second line of defence, not the
 * first.
 */

const path = require('node:path')
const { resolveCapabilityRoot } = require('./capability-layer.cjs')

/* Declared in tools/capability-manifest.json under `hostModules`, which is what
 * puts it in the payload and what tools/check-asar-manifest.mjs gates. The
 * duplicated path is unavoidable -- the manifest is a build input and this is a
 * runtime read -- so a miss below names the manifest instead of reporting a
 * bare MODULE_NOT_FOUND. */
const AUDIT_MODULE = 'src/lib/audit.js'

/* The audit module caches its database handle and its resolved paths, so it is
 * loaded once per process and reused. A failure is cached too: a copy with no
 * payload should not pay a module resolution on every keystroke. */
let cached = null

function failure(code, reason) {
  return { ok: false, code, reason }
}

/**
 * Load the canonical writer out of the capability payload.
 *
 * @param {object} options
 * @param {string} options.stateRoot  <userData>/capability -- the SAME value
 *   shell/main.cjs passes to shell/capability-layer.cjs. Required and absolute;
 *   a relative value is refused rather than resolved against a cwd nobody chose.
 */
function loadCanonicalAudit({ stateRoot, root = resolveCapabilityRoot(), load = require, env = process.env } = {}) {
  if (typeof stateRoot !== 'string' || stateRoot.length === 0 || !path.isAbsolute(stateRoot)) {
    return failure(
      'AUDIT_STATE_ROOT_INVALID',
      'An absolute capability state root is required to address this installation’s ledger.',
    )
  }
  if (!root) {
    return failure(
      'AUDIT_PAYLOAD_ABSENT',
      'No capability payload is present, so this copy carries no canonical ledger writer.',
    )
  }

  /* BEFORE the require. See the module comment. */
  env.TOOLSENABLED_STATE_ROOT = stateRoot

  let audit
  try {
    audit = load(path.join(root, AUDIT_MODULE))
  } catch (error) {
    return failure(
      'AUDIT_MODULE_ABSENT',
      `The capability payload does not carry its ledger writer (${error.message}). It is staged by tools/capability-manifest.json under hostModules.`,
    )
  }
  if (typeof audit?.requireRecord !== 'function' || typeof audit?.verify !== 'function') {
    return failure('AUDIT_MODULE_UNRECOGNIZED', 'The capability payload carries a ledger writer this shell does not recognize.')
  }
  return { ok: true, audit }
}

function canonicalAudit(options = {}) {
  if (options.load || options.root || options.fresh) return loadCanonicalAudit(options)
  if (!cached) cached = loadCanonicalAudit(options)
  return cached
}

function resetForTests() {
  cached = null
}

/**
 * Record an action in the canonical chain, refusing to report success unless it
 * is durably appended AND covered by the monotonic head anchor.
 *
 * requireRecord, not record: `record` reports a status object that a caller can
 * ignore, and a caller that ignores it is exactly how a ledger ends up empty
 * while everybody believes it is full. requireRecord throws, so a caller has to
 * decide, in code, what happens when the action cannot be recorded.
 *
 * Returns a plain result rather than throwing, because every caller here is an
 * IPC handler whose job is to turn this into a refusal the screen can show.
 *
 * @returns {{ok: true, sequence: number, eventHash: string}
 *          |{ok: false, code: string, reason: string}}
 */
function recordCanonical(action, target, details = {}, options = {}) {
  const loaded = canonicalAudit(options)
  if (!loaded.ok) return loaded
  try {
    const receipt = loaded.audit.requireRecord(action, target, details)
    return { ok: true, sequence: receipt.sequence, eventHash: receipt.eventHash }
  } catch (error) {
    return failure(
      typeof error?.code === 'string' ? error.code : 'AUDIT_UNAVAILABLE',
      'The action was not recorded in the signed ledger, so it was not performed.',
    )
  }
}

module.exports = {
  AUDIT_MODULE,
  canonicalAudit,
  loadCanonicalAudit,
  recordCanonical,
  resetForTests,
}
