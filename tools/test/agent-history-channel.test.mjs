/* The IPC channel that carries the app's own agent record to the home screen.
 *
 * Separate from tools/test/agent-history-read.test.mjs, which tests the
 * recorder, because the two land in different commits: the recorder's read
 * function is self-contained, while these two shell files were carrying two
 * other lanes' in-flight work when the recorder was committed, and sweeping
 * that into someone else's commit is not a thing this repo does.
 *
 * What is asserted here is the part that is easy to lose in a merge: the
 * channel exists on the preload the application actually loads (shell/
 * preload.cjs is reachable from no window -- a bridge added there is a green
 * test over a dead feature, which is precisely the defect that removed an
 * earlier version of the agent bridge), and it carries the same sender check
 * as every other agent channel. A record of what has run on someone's computer
 * is not readable by any frame that happens to be loaded.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('the read channel is exposed on the preload the application actually loads', () => {
  const preload = readFileSync(new URL('../../shell/fleet-profile-preload.cjs', import.meta.url), 'utf8')
  assert.match(
    preload, /history: request => ipcRenderer\.invoke\('mc-agent:history'/,
    'the bridge the home screen calls exists on the loaded preload',
  )
  const exposure = preload.slice(preload.indexOf("exposeInMainWorld('mcAgent'"))
  assert.ok(exposure.indexOf('history:') < exposure.indexOf('}))'), 'and it is on the mcAgent bridge, not some other one')
})

test('the read channel carries the same sender check as every other agent channel', () => {
  const main = readFileSync(new URL('../../shell/main.cjs', import.meta.url), 'utf8')
  const start = main.indexOf("ipcMain.handle('mc-agent:history'")
  assert.ok(start >= 0, 'the channel is handled in the main process')
  const body = main.slice(start, main.indexOf('\n})', start))
  assert.match(
    body, /assertTrustedAgentSender\(event\)/,
    'a record of what ran on this machine is not readable by any frame that happens to be loaded',
  )
  assert.match(body, /agentPayload\(/, 'and the request shape is validated like every other agent channel')
  assert.match(body, /spawnRecordHistory\(/, 'and it answers from the recorder rather than reading the file itself')
})

test('the channel starts nothing', () => {
  const main = readFileSync(new URL('../../shell/main.cjs', import.meta.url), 'utf8')
  const start = main.indexOf("ipcMain.handle('mc-agent:history'")
  const body = main.slice(start, main.indexOf('\n})', start))
  for (const forbidden of [/startSession/, /sendTurn/, /getAgentHost/, /recordSpawnIntent/, /\.record\(/]) {
    assert.doesNotMatch(body, forbidden, 'a read channel must not be able to create or record anything')
  }
})
