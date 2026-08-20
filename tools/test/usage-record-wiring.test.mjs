/* THE WIRING, WHICH IS THE HALF A UNIT TEST CANNOT REACH.
 *
 * shell/usage-record.cjs can be exercised directly and is. What no direct test
 * can see is whether anything ever CALLS it -- and a perfectly tested writer
 * that nothing feeds is exactly the shape of the defect being repaired here: the
 * `usage` event has crossed mc-agent:event since the first day and every reader
 * dropped it. So these assertions are about the seams: the one fan-out where
 * every session's events pass, the channel the page reads back through, and the
 * bridge that carries it.
 *
 * Source-text assertions, in the same style as tools/test/tree-reply-surface.mjs
 * and for the same reason: the Electron main process cannot be booted in a unit
 * test, and a wiring guard that cannot run is a guard that does not exist.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (relative) => readFileSync(path.join(REPO_ROOT, relative), 'utf8')

test('the main process writes a usage record from the event fan-out', () => {
  const main = read('shell/main.cjs')
  assert.match(main, /require\('\.\/usage-record\.cjs'\)/, 'main does not load the usage recorder at all')
  assert.match(main, /noteAgentTurnUsage\(session, packet\)/,
    'the one place every session event passes does not offer them to the recorder')
  /* The forward comes FIRST. A screen must not wait on an fsync for its text.
     Measured inside the listener itself rather than over the whole file, because
     the function's own DEFINITION carries the same call text and sits earlier. */
  const listener = main.slice(main.indexOf('removeAgentEventListener = host.onEvent('))
  const block = listener.slice(0, listener.indexOf('agentHost = host'))
  const forward = block.indexOf('session.owner.send(AGENT_EVENT_CHANNEL, packet)')
  const record = block.indexOf('noteAgentTurnUsage(session, packet)')
  assert.ok(forward > -1 && record > forward, 'the record is written before the event reaches the page')
})

test('a turn is recorded once, when the engine says the turn is over', () => {
  const main = read('shell/main.cjs')
  const start = main.indexOf('function noteAgentTurnUsage')
  const end = main.indexOf('function spawnRecordAvailability')
  const body = main.slice(start, end)
  assert.ok(start > -1 && end > start, 'noteAgentTurnUsage is not where this test thinks it is')

  /* THE DEFECT THIS PINS. Codex emits a usage event several times per turn, each
     carrying the session's running total. One record per EVENT would put the
     same tokens on the page as many times as the engine happened to report
     them. */
  assert.match(body, /event\.type === 'usage'/)
  assert.match(body, /event\.type !== 'turn_completed'/)
  assert.match(body, /recordTurn\(/)
  assert.ok(
    body.indexOf('recordTurn(') > body.indexOf("event.type !== 'turn_completed'"),
    'a record is written before the turn is known to be over',
  )
  /* Held readings are dropped once written, so one turn can never be counted
     twice, and the map is bounded so an interrupted session cannot grow it. */
  assert.match(body, /usageByTurn\.delete\(turnId\)/)
  assert.match(body, /MAX_PENDING_TURN_USAGE/)
})

test('the identity on a usage record is read in main, never accepted from the page', () => {
  const main = read('shell/main.cjs')
  const start = main.indexOf('function noteAgentTurnUsage')
  const body = main.slice(start, main.indexOf('function spawnRecordAvailability'))
  assert.match(body, /principal: accountPrincipal\(\)/,
    'an identity a page can choose is not an identity -- the same rule the run record follows')
})

test('the channel that reads the usage record checks its sender like every other agent channel', () => {
  const main = read('shell/main.cjs')
  const handler = main.slice(main.indexOf("ipcMain.handle('mc-agent:usage'"))
  assert.match(handler.slice(0, 400), /assertTrustedAgentSender\(event\)/,
    'any frame that happened to be loaded could ask what this computer has used')
})

test('the bridge carries it, and the page can therefore ask', () => {
  const preload = read('shell/fleet-profile-preload.cjs')
  assert.match(preload, /usage: request => ipcRenderer\.invoke\('mc-agent:usage', request \|\| \{\}\)/)
})

test('the new record is carried across an install rename, WITH the key that signs it', () => {
  const adoption = read('shell/userdata-adoption.cjs')
  assert.match(adoption, /'agent-turn-usage-records\.jsonl'/, 'a rename would strand the token history')
  const bound = adoption.slice(adoption.indexOf('ENTRIES_BOUND_TO_SEALED_KEY'))
  assert.match(bound.slice(0, 200), /agent-turn-usage-records\.jsonl/,
    'the usage chain would be adopted without the key whose signatures it is under')
})
