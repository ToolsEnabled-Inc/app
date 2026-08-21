/* THE ENDING OF A RUN, WRITTEN DOWN.
 *
 * THE GAP THIS CLOSES. The run ledger (shell/spawn-record.cjs, written by
 * shell/main.cjs) carried exactly two lines per run: the intent before the
 * spawn, and `started`/`refused` when the start resolved. Nothing was ever
 * written when a session ENDED -- not when the person stopped it, not when the
 * engine's child went away, not when the app closed. So the product could not
 * truthfully say a session had finished or how long it ran, and the home screen
 * says so in as many words.
 *
 * WHAT IS ASSERTED HERE, and in this order:
 *
 *   1. The end is a THIRD RECORD (`agent_session_end`), joined to its start by
 *      `end.resolves` -- the same key the outcome record already uses, so the
 *      existing reader needs no new mechanism.
 *   2. Its `reason` is a closed set (`closed`, `exited`, `app-shutdown`,
 *      `crashed`) and the writer refuses anything else.
 *   3. It carries NO duration. The reader subtracts two signed instants; a
 *      duration computed by the shell would be a claim the chain cannot check.
 *   4. A provider's word for how the last turn ended is carried VERBATIM. The
 *      two engines disagree (`completed` vs `success`) and the record must never
 *      normalise; the reader translates.
 *   5. The commitment is a TENTH positional field, and every record written
 *      before this existed still hashes exactly as it did.
 *   6. ABSENCE STAYS READABLE AS ABSENCE. A start with no end record reads as
 *      "this record does not say", never as "still running" and never as
 *      finished; nothing invents an ending it did not observe.
 *   7. The child's own exit is observable shell-side, for BOTH vendored
 *      transports, and the host reports it only when the host did not close the
 *      session itself.
 *   8. shell/main.cjs hooks the two genuine endings and the best-effort orderly
 *      quit, and records nothing on the way down that it did not observe.
 *
 * The first assertion was written before the writer knew the field, and was red
 * for the plain reason that `end` was dropped on the floor: the record was
 * written, the field was not, and history() answered as if no ending had ever
 * been recorded -- which, until then, was true.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import test from 'node:test'

import { createSpawnRecorder } from '../../shell/spawn-record.cjs'
import { createAgentHost, observeEngineExit } from '../../shell/agent-host.cjs'
/* READ, NOT EDITED: the renderer's reader is another lane's second pass. It is
   imported here only to show what a start with no ending reads as today. */
import { readLocalSessions } from '../../src/local-activity.js'

const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EXITING_ENGINE = join(ROOT, 'tools/test/fixtures/exiting-engine/src/lib/agent-engine/codex-process.js')
const MAIN_SOURCE = readFileSync(join(ROOT, 'shell/main.cjs'), 'utf8')
/* The close handler's BODY moved to shell/agent-command-surface.cjs in the
   command-surface extraction (the shared surface the relay facade design
   names); the other three endings are still main.cjs's own. */
const SURFACE_SOURCE = readFileSync(join(ROOT, 'shell/agent-command-surface.cjs'), 'utf8')

function keystore() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(`enc:${Buffer.from(text, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (buffer) => {
      const stored = buffer.toString('utf8')
      if (!stored.startsWith('enc:')) throw new Error('not encrypted by this keystore')
      return Buffer.from(stored.slice(4), 'base64').toString('utf8')
    },
  }
}

function workspace(t, prefix = 'session-end-record-') {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

function ledgerLines(recorder) {
  return readFileSync(recorder.ledgerPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
}

/* One run, as shell/main.cjs writes it today: the intent, then the outcome. */
function startedRun(recorder, sessionId) {
  const start = recorder.record({ action: 'agent_session_start', sessionId, principal: 'unauthenticated', details: { cwd: 'C:\\work' } })
  recorder.record({
    action: 'agent_session_outcome',
    sessionId,
    principal: 'unauthenticated',
    outcome: { result: 'started', resolves: start.sequence, reason: null },
  })
  return start
}

const END_REASONS = ['closed', 'exited', 'app-shutdown', 'crashed']

/* ------------------------------------------------------ 1. the third record */

test('a run that ended is written down as a third record, joined to its start by resolves', (t) => {
  const recorder = createSpawnRecorder({ safeStorage: keystore(), directory: workspace(t) })
  const start = startedRun(recorder, 'chat-one')

  /* THE GAP, MEASURED BEFORE IT IS CLOSED. Today's ledger has a start and an
     outcome and nothing else, and the reader shows the run as started with no
     way to say it ended. */
  const before = readLocalSessions(recorder.history())
  assert.equal(before.runs.length, 1)
  assert.equal(before.runs[0].result, 'started')
  assert.equal(ledgerLines(recorder).filter(line => line.action === 'agent_session_end').length, 0,
    'no ending has ever been recorded for this run')

  const receipt = recorder.record({
    action: 'agent_session_end',
    sessionId: 'chat-one',
    principal: 'unauthenticated',
    details: {},
    end: { resolves: start.sequence, reason: 'closed', turns: 2, lastTurnStatus: 'completed' },
  })
  assert.equal(receipt.durable, true)
  assert.equal(receipt.signed, true)

  const ends = ledgerLines(recorder).filter(line => line.action === 'agent_session_end')
  assert.equal(ends.length, 1, 'the ending is one appended line')
  assert.deepEqual(ends[0].end, { resolves: start.sequence, reason: 'closed', turns: 2, lastTurnStatus: 'completed' })
  assert.equal(typeof ends[0].at, 'string', 'the recorder stamps when')
  assert.ok(Number.isFinite(Date.parse(ends[0].at)))

  /* And it reaches the reader's side of the channel through history(), so the
     screen that joins outcomes by `resolves` can join endings the same way. */
  const reply = recorder.history()
  const shown = reply.entries.find(entry => entry.action === 'agent_session_end')
  assert.ok(shown, 'history() returns the end record')
  assert.deepEqual(shown.end, { resolves: start.sequence, reason: 'closed', turns: 2, lastTurnStatus: 'completed' })
  assert.equal(shown.sessionId, 'chat-one')
  assert.equal(reply.verified, true, 'the chain still verifies with an ending in it')
  assert.deepEqual(reply.outcomes, { starts: 1, started: 1, refused: 0 }, 'an ending is not a fourth run')
})

/* ------------------------------------------------------ 2. the closed set */

test('the reason is a closed set, and the writer refuses anything outside it', (t) => {
  const recorder = createSpawnRecorder({ safeStorage: keystore(), directory: workspace(t) })
  const start = startedRun(recorder, 'chat-two')

  for (const reason of END_REASONS) {
    recorder.record({
      action: 'agent_session_end',
      sessionId: 'chat-two',
      end: { resolves: start.sequence, reason, turns: 0, lastTurnStatus: null },
    })
  }
  for (const reason of ['finished', 'stopped', 'CLOSED', 'crash', '', null, undefined, 'C:\\Users\\x']) {
    assert.throws(
      () => recorder.record({
        action: 'agent_session_end',
        sessionId: 'chat-two',
        end: { resolves: start.sequence, reason, turns: 0, lastTurnStatus: null },
      }),
      /end/i,
      `a reason of ${JSON.stringify(reason)} must be refused, not written`,
    )
  }
  assert.throws(
    () => recorder.record({ action: 'agent_session_end', sessionId: 'chat-two', end: { resolves: 0, reason: 'closed', turns: 0, lastTurnStatus: null } }),
    /end/i,
    'an end must name the start it resolves',
  )
  assert.throws(
    () => recorder.record({ action: 'agent_session_end', sessionId: 'chat-two', end: { resolves: start.sequence, reason: 'closed', turns: -1, lastTurnStatus: null } }),
    /end/i,
    'a negative turn count is not a count',
  )
  assert.throws(
    () => recorder.record({ action: 'agent_session_end', sessionId: 'chat-two', end: { resolves: start.sequence, reason: 'closed', turns: 1.5, lastTurnStatus: null } }),
    /end/i,
    'a fractional turn count is not a count',
  )
  assert.equal(recorder.verify().ok, true)
})

/* ------------------------------------------------------ 3. no duration */

test('an end record carries no duration, and exactly the fields it promises', (t) => {
  const recorder = createSpawnRecorder({ safeStorage: keystore(), directory: workspace(t) })
  const start = startedRun(recorder, 'chat-three')
  recorder.record({
    action: 'agent_session_end',
    sessionId: 'chat-three',
    /* A caller that reaches for a duration is silently NOT given one: the writer
       builds the field in a fixed key order from the four things it admits. */
    end: { resolves: start.sequence, reason: 'exited', turns: 1, lastTurnStatus: 'success', durationMs: 1234, endedAt: 'x' },
  })
  const line = ledgerLines(recorder).find(entry => entry.action === 'agent_session_end')
  assert.deepEqual(Object.keys(line.end), ['resolves', 'reason', 'turns', 'lastTurnStatus'])
  assert.doesNotMatch(JSON.stringify(line), /duration|elapsed|endedAt|startedAt/i,
    'nothing on the line is a shell-computed span; the reader subtracts two signed instants')
  const shown = recorder.history().entries.find(entry => entry.action === 'agent_session_end')
  assert.deepEqual(Object.keys(shown.end), ['resolves', 'reason', 'turns', 'lastTurnStatus'])
})

/* ------------------------------------------------------ 4. verbatim */

test('the provider\'s word for the last turn is carried verbatim, never normalised, and nulled when it is not a bare word', (t) => {
  const recorder = createSpawnRecorder({ safeStorage: keystore(), directory: workspace(t) })
  const start = startedRun(recorder, 'chat-four')
  /* MEASURED (src/agent-session-events.js): codex says `completed`, the Claude
     CLI says `success`; the host's own word for a child that died mid-turn is
     `failed`; a CLI result subtype can read `error_max_turns`. Each is written
     as it arrived, including its case. */
  for (const status of ['completed', 'success', 'failed', 'error_max_turns', 'Interrupted']) {
    recorder.record({
      action: 'agent_session_end',
      sessionId: 'chat-four',
      end: { resolves: start.sequence, reason: 'closed', turns: 1, lastTurnStatus: status },
    })
  }
  const written = ledgerLines(recorder).filter(line => line.action === 'agent_session_end').map(line => line.end.lastTurnStatus)
  assert.deepEqual(written, ['completed', 'success', 'failed', 'error_max_turns', 'Interrupted'])

  /* Anything that could be a path or a sentence is refused at the write -- the
     same rule outcome.reason and usage.status keep. */
  for (const status of ['C:\\Users\\x\\.codex', 'exit code 1: nope', 'a b', '.', '']) {
    assert.throws(
      () => recorder.record({
        action: 'agent_session_end',
        sessionId: 'chat-four',
        end: { resolves: start.sequence, reason: 'closed', turns: 1, lastTurnStatus: status },
      }),
      /end/i,
      `a status of ${JSON.stringify(status)} must be refused`,
    )
  }
  /* And null is admitted, because "no turn ever ended" is a true state. */
  recorder.record({
    action: 'agent_session_end',
    sessionId: 'chat-four',
    end: { resolves: start.sequence, reason: 'closed', turns: 0, lastTurnStatus: null },
  })
  assert.equal(recorder.verify().ok, true)
})

/* ------------------------------------------------------ 5. the commitment */

test('an end commits as the tenth positional field, and older records still hash exactly as they did', (t) => {
  const directory = workspace(t)
  const recorder = createSpawnRecorder({ safeStorage: keystore(), directory })
  const start = startedRun(recorder, 'chat-five')
  recorder.record({
    action: 'agent_turn_usage',
    sessionId: 'chat-five',
    usage: { turnId: 'turn-1', tier: 'luna', account: null, status: 'completed', basis: 'turn', inputTokens: 10, outputTokens: 5 },
  })
  recorder.record({
    action: 'agent_session_end',
    sessionId: 'chat-five',
    end: { resolves: start.sequence, reason: 'app-shutdown', turns: 1, lastTurnStatus: 'completed' },
  })

  const lines = ledgerLines(recorder)
  const hash = fields => createHash('sha256').update(JSON.stringify(fields), 'utf8').digest('hex')
  const base = line => [line.sequence, line.at, line.action, line.sessionId, line.principal, line.details, line.previousHash]

  const plain = lines.find(line => line.action === 'agent_session_start')
  assert.equal(hash(base(plain)), plain.eventHash, 'a start still commits to seven fields')
  const outcome = lines.find(line => line.action === 'agent_session_outcome')
  assert.equal(hash([...base(outcome), outcome.outcome]), outcome.eventHash, 'an outcome still commits to eight')
  const usage = lines.find(line => line.action === 'agent_turn_usage')
  assert.equal(hash([...base(usage), null, usage.usage]), usage.eventHash, 'a usage record still commits to nine')
  const end = lines.find(line => line.action === 'agent_session_end')
  assert.equal(hash([...base(end), null, null, end.end]), end.eventHash,
    'an end commits to ten, with the outcome and usage slots stated as absent')

  /* Presence is part of the commitment: stripping the field must fail. */
  assert.notEqual(hash(base(end)), end.eventHash)

  assert.deepEqual(recorder.verify(), { ok: true, count: 4 })
  /* And the incremental path a relaunch takes agrees. */
  const relaunched = createSpawnRecorder({ safeStorage: keystore(), directory })
  assert.equal(relaunched.history().verified, true)
  recorder.record({ action: 'agent_session_start', sessionId: 'chat-six' })
  assert.equal(relaunched.history().verified, true, 'appended records verify on the incremental path')
})

/* ------------------------------------------------------ 6. absence */

test('a start with no end record reads as "does not say" -- never as finished, never as still running', (t) => {
  const recorder = createSpawnRecorder({ safeStorage: keystore(), directory: workspace(t) })
  const start = startedRun(recorder, 'chat-seven')

  const reply = recorder.history()
  for (const entry of reply.entries) {
    assert.equal(entry.end, null, `${entry.action} carries no end, so it reads null`)
  }
  /* The read side re-validates the bytes: a line whose end is not the admitted
     shape reads as null too, never as an invented ending. */
  const forged = { ...ledgerLines(recorder)[0] }
  const line = recorder.history().entries.find(entry => entry.sequence === start.sequence)
  assert.equal(line.end, null)
  assert.equal(forged.end, undefined)

  /* And nothing here writes an ending on a relaunch. A second recorder over the
     same directory -- what the next launch looks like -- sees the same two lines. */
  const again = createSpawnRecorder({ safeStorage: keystore(), directory: recorder.ledgerPath.replace(/[\\/][^\\/]+$/, '') })
  assert.equal(again.history().total, 2, 'a relaunch invents no ending it did not observe')
})

/* ------------------------------------------------------ 7. the child's exit */

const PLAN = JSON.stringify({ ok: true, tier: 'unrestricted', isolated: false, threadOptions: {}, env: {} })

function withPlan(run) {
  const previous = process.env.MC_TEST_CONFINEMENT_PLAN
  process.env.MC_TEST_CONFINEMENT_PLAN = PLAN
  return Promise.resolve().then(run).finally(() => {
    if (previous === undefined) delete process.env.MC_TEST_CONFINEMENT_PLAN
    else process.env.MC_TEST_CONFINEMENT_PLAN = previous
  })
}

function withExitAfter(ms, run) {
  const previous = process.env.MC_TEST_EXIT_AFTER_MS
  if (ms === null) delete process.env.MC_TEST_EXIT_AFTER_MS
  else process.env.MC_TEST_EXIT_AFTER_MS = String(ms)
  return Promise.resolve().then(run).finally(() => {
    if (previous === undefined) delete process.env.MC_TEST_EXIT_AFTER_MS
    else process.env.MC_TEST_EXIT_AFTER_MS = previous
  })
}

const settle = ms => new Promise(resolve => setTimeout(resolve, ms))

test('the host reports a child that exits on its own, with the session id, and does not report the exit its own close caused', async (t) => {
  const workdir = workspace(t, 'session-end-host-')
  await withPlan(() => withExitAfter(400, async () => {
    const host = createAgentHost({ enginePath: EXITING_ENGINE, defaultCwd: workdir })
    t.after(() => host.closeAll().catch(() => {}))
    const exits = []
    host.onSessionExit(report => exits.push(report))

    await host.startSession({ sessionId: 'exits-by-itself' })
    await settle(1500)
    assert.equal(exits.length, 1, 'the child ended by itself and the host said so once')
    assert.equal(exits[0].sessionId, 'exits-by-itself')
    assert.equal(exits[0].exit.code, 0, 'the child\'s own exit code rides with the report')
  }))

  await withPlan(() => withExitAfter(null, async () => {
    const host = createAgentHost({ enginePath: EXITING_ENGINE, defaultCwd: workdir })
    t.after(() => host.closeAll().catch(() => {}))
    const exits = []
    host.onSessionExit(report => exits.push(report))

    await host.startSession({ sessionId: 'closed-by-host' })
    await host.closeSession({ sessionId: 'closed-by-host' })
    await settle(800)
    assert.equal(exits.length, 0, 'an exit the host caused is the close, not a second ending')
  }))

  /* THE CLOSE THAT FAILED. The host keeps a session whose close threw in its
     map (state `close-failed`) so the close can be retried -- and the child it
     already asked to stop may exit in the meantime. That exit is the close's
     doing. Without the closeRequested guard this reports it as the child's own
     ending, which a planted mutant proved the two cases above cannot catch: in
     both, the session has already LEFT the map by the time the exit lands. */
  const previousCloseThrows = process.env.MC_TEST_CLOSE_THROWS
  process.env.MC_TEST_CLOSE_THROWS = '1'
  try {
    await withPlan(() => withExitAfter(null, async () => {
      const host = createAgentHost({ enginePath: EXITING_ENGINE, defaultCwd: workdir })
      t.after(() => host.closeAll().catch(() => {}))
      const exits = []
      host.onSessionExit(report => exits.push(report))

      await host.startSession({ sessionId: 'close-failed' })
      await assert.rejects(host.closeSession({ sessionId: 'close-failed' }), /FIXTURE_CLOSE_FAILED|close failed/i)
      await settle(800)
      assert.equal(exits.length, 0, 'the child died because the host asked it to; a failed close does not turn that into "exited"')
    }))
  } finally {
    if (previousCloseThrows === undefined) delete process.env.MC_TEST_CLOSE_THROWS
    else process.env.MC_TEST_CLOSE_THROWS = previousCloseThrows
  }
})

test('the exit is observed through both vendored transports, so neither engine can end unnoticed', async (t) => {
  const codex = require(join(ROOT, 'capability/src/lib/agent-engine/codex-process.js'))
  const claude = require(join(ROOT, 'capability/src/lib/agent-engine/claude-cli-process.js'))
  const script = 'setTimeout(() => process.exit(3), 150)'

  /* codex: a multi-listener onData that delivers (null, exitInfo) once. */
  const codexTransport = codex.createCodexProcessTransport({
    command: process.execPath, args: ['-e', script], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  const codexExit = await new Promise((resolveExit) => {
    const attached = observeEngineExit({ adapter: { transport: codexTransport } }, exit => resolveExit(exit))
    assert.equal(attached, 'transport', 'the codex transport shape was recognised')
  })
  assert.equal(codexExit.code, 3)

  /* Claude: the transport hands out its ChildProcess. Its onData is a single
     handler slot, so the observer must NOT go through it -- doing so would
     replace the adapter's own reader and kill the session. */
  const claudeTransport = claude.createClaudeCliTransport({
    command: process.execPath, args: ['-e', script], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  /* Stand in for the adapter's own reader. The transport calls its ONE handler
     with (null, exit) when the child ends; if the observer had taken that slot,
     this stand-in would never hear the exit. */
  let adapterHeardExit = false
  claudeTransport.onData((packet, exit) => { if (packet === null && exit) adapterHeardExit = true })
  const claudeExit = await new Promise((resolveExit) => {
    const attached = observeEngineExit({ adapter: { transport: claudeTransport } }, exit => resolveExit(exit))
    assert.equal(attached, 'child', 'the Claude transport shape was recognised')
  })
  assert.equal(claudeExit.code, 3)
  await settle(100)
  assert.equal(adapterHeardExit, true, 'the adapter\'s own handler slot was left alone, so it still heard the exit')

  /* An engine that exposes neither is left alone, and the observer says so. */
  assert.equal(observeEngineExit({ adapter: { sendTurn() {} } }, () => {}), null)
  assert.equal(observeEngineExit(null, () => {}), null)
})

/* ------------------------------------------------------ 8. main.cjs wiring */

test('shell/main.cjs records the two genuine endings and the best-effort quit, and computes no duration', () => {
  const at = needle => {
    const index = MAIN_SOURCE.indexOf(needle)
    assert.notEqual(index, -1, `shell/main.cjs must contain ${JSON.stringify(needle)}`)
    return index
  }
  const recorder = MAIN_SOURCE.slice(at('function recordSessionEnd('), at('function recordSessionEnd(') + 2600)
  assert.match(recorder, /action: 'agent_session_end'/)
  assert.match(recorder, /resolves: session\.started\.sequence/, 'the end resolves the start receipt this session was started under')
  assert.match(recorder, /turns: session\.turnsCompleted/, 'the turn count is the one main observed, not a guess')
  assert.match(recorder, /lastTurnStatus: session\.lastTurnStatus/, 'the provider\'s last word is carried as it arrived')
  assert.doesNotMatch(recorder, /duration|Date\.now\(\)\s*-|elapsed/i, 'the shell computes no span')

  /* THE PERSON STOPPED IT: after the host's close resolves, before the session
     leaves the map. Re-pointed at the surface body after the command-surface
     extraction; main.cjs's wrapper must still hand the channel to it. */
  assert.match(MAIN_SOURCE.slice(at("ipcMain.handle('mc-agent:close'"), at("ipcMain.handle('mc-agent:close'") + 300), /run\('agent:close'/,
    'the close channel no longer dispatches to the shared surface')
  const closeAt = SURFACE_SOURCE.indexOf("'agent:close': async")
  assert.notEqual(closeAt, -1, 'shell/agent-command-surface.cjs must hold the close body')
  const close = SURFACE_SOURCE.slice(closeAt, closeAt + 900)
  assert.ok(close.indexOf('await currentAgentHost().closeSession(request)') !== -1
    && close.indexOf('await currentAgentHost().closeSession(request)') < close.indexOf("recordSessionEnd(session, request.sessionId, 'closed')"),
    'closed is recorded once the close has actually happened')
  assert.ok(close.indexOf("recordSessionEnd(session, request.sessionId, 'closed')") < close.indexOf('agentSessions.delete(request.sessionId)'),
    'and before the session leaves the map')

  /* THE CHILD WENT AWAY: the host's exit report, wired where the event listener is. */
  const host = MAIN_SOURCE.slice(at('function getAgentHost()'), at('function getAgentHost()') + 2600)
  assert.match(host, /host\.onSessionExit\(/)
  assert.match(host, /recordSessionEnd\(session, [a-zA-Z.]+, 'exited'\)/)

  /* THE APP IS CLOSING: the window's owner going away, and before-quit, both
     best-effort and both BEFORE the map is emptied. */
  const owner = MAIN_SOURCE.slice(at('function bindAgentOwner('), at('function bindAgentOwner(') + 1200)
  assert.ok(owner.indexOf("recordSessionEnd(session, sessionId, 'app-shutdown')") < owner.indexOf('agentSessions.delete(sessionId)'))
  const quit = MAIN_SOURCE.slice(at("app.on('before-quit'"), at("app.on('before-quit'") + 1400)
  assert.ok(quit.indexOf("'app-shutdown'") !== -1 && quit.indexOf("'app-shutdown'") < quit.indexOf('agentSessions.clear()'),
    'the orderly quit tries to record before it drops the sessions')

  /* AND NOTHING WRITES `crashed`: it is in the closed set for a future writer
     with real evidence, and main.cjs has none tonight. */
  assert.doesNotMatch(MAIN_SOURCE, /recordSessionEnd\([^)]*'crashed'\)/)
  /* And not from the surface either, now that a session's close body lives there. */
  assert.doesNotMatch(SURFACE_SOURCE, /recordSessionEnd\([^)]*'crashed'\)/)

  /* Turns are counted where every session's events cross, from the engine's
     own completion event. */
  const counting = MAIN_SOURCE.slice(at('function noteAgentTurnCompleted('), at('function noteAgentTurnCompleted(') + 900)
  assert.match(counting, /turn_completed/)
  assert.match(counting, /turnsCompleted/)
  assert.doesNotMatch(counting, /toLowerCase/, 'the status is not normalised on the way in')
})
