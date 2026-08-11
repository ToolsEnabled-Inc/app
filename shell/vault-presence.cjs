'use strict'

/* IS THE OWNER'S CARD ON FILE -- asked by the installed product, of its own vault.
 *
 * WHY THE PRODUCT COULD NOT ANSWER THIS. Two separate faults, and only one of
 * them was in the engine:
 *
 *   1. `payment_method.card_status` asked `secretExists()`, which answers by
 *      FETCHING the record -- and `payment_card_default` is on
 *      tools/secrets.ps1's $VaultOracleDenylist precisely so that fetch is
 *      refused. The refusal was caught and returned as `false`. Fixed in the
 *      engine tree by a presence-only verb; this file is its shell-side caller.
 *
 *   2. The installed product's vault is NOT the vault the owner entered his
 *      card into. `shell/main.cjs` points the capability layer at
 *      `<userData>/capability`, so the product resolves
 *      `<userData>/capability/vault/secrets.json`, while the record lives in
 *      the engine checkout's `vault/secrets.json`. Measured on this machine:
 *      the installation's own vault holds two audit keys and no card.
 *
 * The second one is why this module reports WHICH STORE it asked. A screen that
 * only has a boolean can say "no card on file" when the truth is "this
 * installation has never been shown your card", and those are different
 * sentences with different next steps for the person reading them.
 *
 * NOTHING ABOUT THE RECORD CROSSES THIS BOUNDARY. The verb it runs prints
 * nothing, decrypts nothing, and answers through an exit code. There is no
 * branch here that can return a card number, an expiry, a token or a length,
 * because no such value is ever produced on the other side of the spawn.
 *
 * FAIL CLOSED MEANS FAIL UNKNOWN. A vault that cannot be read answers
 * `present: null`, never `false`. "I could not check" rendered as "you have no
 * card" is a false statement about the owner's money made out of a file error.
 */

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

/* Exit codes of the `present` action in tools/secrets.ps1. Named on both sides
   so a change to either is a visible edit to both. */
const PRESENT = 0
const ABSENT = 3
const UNREADABLE = 4
const NO_STORE = 5

const VAULT_KEY_RE = /^[A-Za-z0-9_.-]{1,120}$/
/* Bounded because this spawns a program. The presence question is answered in
   well under a second on this machine; anything past this is a hung shell, and
   a hung shell must become "unknown" rather than a frozen screen. */
const TIMEOUT_MS = 15_000

function answer(present, readable, code, detail, extra = {}) {
  return Object.freeze({ present, readable, code, detail, ...extra })
}

/**
 * Ask the installation's own vault whether a record is on file.
 *
 * @param {string} vaultKey the vault record's key NAME. Never a value.
 * @param {object} options
 * @param {string} options.capabilityRoot directory holding `tools/secrets.ps1`
 * @param {string} options.stateRoot the state root whose `vault/` is the store
 */
function vaultRecordPresence(vaultKey, { capabilityRoot, stateRoot, run = execFileSync } = {}) {
  if (typeof vaultKey !== 'string' || !VAULT_KEY_RE.test(vaultKey)) {
    return answer(null, false, 'VAULT_KEY_INVALID', 'That is not a vault record this product will ask about.')
  }
  if (typeof capabilityRoot !== 'string' || !capabilityRoot) {
    return answer(null, false, 'VAULT_TOOLING_ABSENT', 'This installation cannot find the program that reads its vault, so whether a card is on file is unknown.')
  }
  const script = path.join(capabilityRoot, 'tools', 'secrets.ps1')
  try {
    if (!fs.existsSync(script)) {
      return answer(null, false, 'VAULT_TOOLING_ABSENT', 'This installation cannot find the program that reads its vault, so whether a card is on file is unknown.')
    }
  } catch {
    return answer(null, false, 'VAULT_TOOLING_ABSENT', 'This installation cannot find the program that reads its vault, so whether a card is on file is unknown.')
  }

  const store = typeof stateRoot === 'string' && stateRoot
    ? path.join(stateRoot, 'vault', 'secrets.json')
    : null
  const environment = { ...process.env }
  if (typeof stateRoot === 'string' && stateRoot) environment.TOOLSENABLED_STATE_ROOT = stateRoot
  /* The script resolves TOOLSENABLED_VAULT_PATH first and TOOLSENABLED_STATE_ROOT
     second. An ambient VAULT_PATH inherited from whatever shell launched the
     app would silently point this question at a different file from the one the
     product actually uses, so it is cleared rather than trusted. */
  delete environment.TOOLSENABLED_VAULT_PATH

  let status
  try {
    run('powershell.exe', [
      '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', script, 'present', vaultKey,
    ], { env: environment, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true, shell: false, timeout: TIMEOUT_MS })
    status = 0
  } catch (error) {
    status = error && Number.isInteger(error.status) ? error.status : null
  }

  if (status === PRESENT) {
    return answer(true, true, 'VAULT_RECORD_PRESENT', 'A record is on file under this key in this installation’s vault. Nothing about its contents was read.', { store })
  }
  if (status === ABSENT) {
    return answer(false, true, 'VAULT_RECORD_ABSENT', 'This installation’s vault was read and holds no record under this key.', { store })
  }
  if (status === NO_STORE) {
    return answer(false, true, 'VAULT_STORE_ABSENT', 'This installation has no vault store yet, so nothing is on file in it.', { store })
  }
  /* Everything else, including a spawn that could not start and any exit code
     this file does not know, is UNKNOWN. */
  return answer(null, false, 'VAULT_UNREADABLE', 'This installation’s vault could not be read, so whether a record is on file is unknown. That is not the same as having none.', { store })
}

module.exports = {
  vaultRecordPresence,
  PRESENT_EXIT: PRESENT,
  ABSENT_EXIT: ABSENT,
  UNREADABLE_EXIT: UNREADABLE,
  NO_STORE_EXIT: NO_STORE,
}
