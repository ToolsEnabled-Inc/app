/* THE STANDING-REQUEST CONTRACT AT THE HOST SEAM — filing and boot carriage.
 *
 * The owner's design (engine src/lib/r-ledger.js, 2026-08-15): four plain
 * markdown ledgers he edits by hand; /Request-family commands file his words
 * verbatim; agents READ the applicable scopes at boot. The PRODUCT does the
 * filing — the agent needs no tool and just sees the confirmation and, at its
 * next start, the rule.
 *
 * What this suite proves, all against a verbatim COPY of the real engine
 * module (tools/test/fixtures/confined-engine/src/lib/r-ledger.js):
 *
 *   FILE      host.fileStandingRequest appends the words verbatim into the
 *             right ledger file and answers the id; a payload without the
 *             module refuses by name instead of pretending.
 *   CARRY     a session started with requestKeys gets the applicable layers
 *             on its FIRST turn, after the person's words and before the tool
 *             note; absent layers are STATED; the contract paragraph rides;
 *             the second turn carries none of it. A RESUMED session gets the
 *             block too — the tool note stays start-only, the rules do not,
 *             because a restarted conversation is exactly when a thread rule
 *             must be re-asserted.
 *   ISOLATE   session A's rules never reach session B's brief on other keys.
 *   CEILING   an absurd ledger (hundreds of entries, oversized words) cannot
 *             brick or bloat a start: the session still starts, the block is
 *             capped, every withheld layer says so and names its file. The
 *             precedent is the engine's own packet-ceiling incident
 *             (agent-onboarding.js — ~36 entries stopped EVERY agent start).
 *   ABSENT    an engine payload with no r-ledger module starts sessions and
 *             injects nothing.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const { createAgentHost } = require_(path.join(ROOT, 'shell/agent-host.cjs'))

const CONFINED_ENGINE = path.join(ROOT, 'tools/test/fixtures/confined-engine/src/lib/agent-engine/codex-process.js')
const SUMMARYLESS_ENGINE = path.join(ROOT, 'tools/test/fixtures/summaryless-engine/src/lib/agent-engine/codex-process.js')
const FIXTURE_LEDGER = require_(path.join(ROOT, 'tools/test/fixtures/confined-engine/src/lib/r-ledger.js'))

function adapterCalls() {
  return require_(CONFINED_ENGINE).adapterCalls
}

function guidedPlan(workdir) {
  return {
    ok: true, tier: 'guided', isolated: true,
    threadOptions: { sandbox: 'read-only', approvalPolicy: 'never' },
    env: { CODEX_HOME: path.join(workdir, 'agent-home') },
    servers: ['toolsenabled-readonly'],
  }
}

/* One scratch world per test: a state root the fixture r-ledger writes under,
   a workdir, a host over the confined engine, and the plan in place. */
async function inWorld(run) {
  const workdir = mkdtempSync(path.join(tmpdir(), 'mc-request-'))
  const stateRoot = path.join(workdir, 'state-root')
  mkdirSync(stateRoot, { recursive: true })
  const previousRoot = process.env.MC_TEST_STATE_ROOT
  const previousPlan = process.env.MC_TEST_CONFINEMENT_PLAN
  process.env.MC_TEST_STATE_ROOT = stateRoot
  process.env.MC_TEST_CONFINEMENT_PLAN = JSON.stringify(guidedPlan(workdir))
  const host = createAgentHost({ enginePath: CONFINED_ENGINE, defaultCwd: workdir })
  try {
    return await run({ host, workdir, stateRoot })
  } finally {
    await host.closeAll().catch(() => {})
    if (previousRoot === undefined) delete process.env.MC_TEST_STATE_ROOT
    else process.env.MC_TEST_STATE_ROOT = previousRoot
    if (previousPlan === undefined) delete process.env.MC_TEST_CONFINEMENT_PLAN
    else process.env.MC_TEST_CONFINEMENT_PLAN = previousPlan
    rmSync(workdir, { recursive: true, force: true, maxRetries: 5 })
  }
}

function endTurn() {
  const startCall = require_(CONFINED_ENGINE).calls.at(-1)
  startCall.onEvent({ type: 'turn_completed', threadId: 'thread-1', turnId: 't1', status: 'completed' })
}

test('filing writes the words verbatim into the right ledger and answers the id', async () => {
  await inWorld(async ({ host, stateRoot }) => {
    const filed = await host.fileStandingRequest({ scope: 'thread', key: 'node-7', words: 'Always answer in one sentence.' })
    assert.equal(filed.ok, true)
    assert.equal(filed.id, 'RTH1')
    assert.equal(filed.scope, 'thread')
    const file = path.join(stateRoot, 'state', 'r-ledger', 'thread-node-7.md')
    assert.ok(existsSync(file), 'the thread ledger file was not written')
    const text = readFileSync(file, 'utf8')
    assert.ok(text.includes('Always answer in one sentence.'), 'the words are not in the file verbatim')
    assert.ok(text.includes('## RTH1'), 'the entry head is missing')

    const second = await host.fileStandingRequest({ scope: 'thread', key: 'node-7', words: 'Second rule.' })
    assert.equal(second.id, 'RTH2', 'ids must advance, never reissue')

    const global = await host.fileStandingRequest({ scope: 'global', words: 'Ask before spending money.' })
    assert.equal(global.id, 'R2000', 'the global floor is the module\'s own R2000')
    assert.ok(existsSync(path.join(stateRoot, 'reports', 'R-LEDGER.md')), 'the global ledger file was not written')
  })
})

test('an empty rule and a bad scope refuse by name and file nothing', async () => {
  await inWorld(async ({ host, stateRoot }) => {
    await assert.rejects(() => host.fileStandingRequest({ scope: 'thread', key: 'node-7', words: '   ' }),
      error => /AGENT_REQUEST/.test(error.code), 'empty words must refuse with a named code')
    await assert.rejects(() => host.fileStandingRequest({ scope: 'week-old-nonsense', key: 'x', words: 'rule' }),
      error => /AGENT_REQUEST/.test(error.code), 'an unknown scope must refuse with a named code')
    assert.ok(!existsSync(path.join(stateRoot, 'state', 'r-ledger')), 'a refusal wrote a ledger anyway')
  })
})

test('the first turn carries the applicable layers, stated absences, and the contract paragraph', async () => {
  await inWorld(async ({ host }) => {
    await host.fileStandingRequest({ scope: 'global', words: 'Ask before spending money.' })
    await host.fileStandingRequest({ scope: 'tree', key: 'node-root', words: 'Use the staging server.' })
    await host.fileStandingRequest({ scope: 'thread', key: 'node-7', words: 'Always answer in one sentence.' })

    await host.startSession({
      sessionId: 'carry-1',
      requestKeys: { treeAnchors: ['node-root', 'node-7'], threadId: 'node-7' },
    })
    const before = adapterCalls().length
    await host.sendTurn({ sessionId: 'carry-1', text: 'Summarize the notes folder.' })
    const first = adapterCalls()[before]
    const text = first.request.text
    assert.ok(text.startsWith('Summarize the notes folder.'), 'the person\'s own words no longer come first')
    assert.ok(text.includes('Ask before spending money.'), 'the global rule is missing from the brief')
    assert.ok(text.includes('Use the staging server.'), 'the tree rule is missing from the brief')
    assert.ok(text.includes('Always answer in one sentence.'), 'the thread rule is missing from the brief')
    assert.match(text, /\[session carry-1\] none filed/, 'an absent layer must be STATED, not skipped — an agent must know what it read')
    assert.match(text, /\/RequestThread/, 'the contract paragraph never teaches the commands')
    assert.match(text, /ToolsEnabled itself files/, 'the contract paragraph must say the PRODUCT files them — no tool needed')
    assert.ok(text.indexOf('Standing requests') < text.indexOf('FIXTURE TOOL SUMMARY'),
      'the rules must come before the tool note — they are the section that must not be missed')

    endTurn()
    await host.sendTurn({ sessionId: 'carry-1', text: 'Second thing.' })
    const second = adapterCalls()[before + 1]
    assert.equal(second.request.text, 'Second thing.', 'the block leaked onto a later turn')
  })
})

test('a resumed session still gets the block — a restart is when a thread rule matters most', async () => {
  await inWorld(async ({ host }) => {
    await host.fileStandingRequest({ scope: 'thread', key: 'node-7', words: 'Always answer in one sentence.' })
    await host.startSession({
      sessionId: 'resume-1',
      resumeThreadId: 'thread-old',
      requestKeys: { treeAnchors: ['node-7'], threadId: 'node-7' },
    })
    const before = adapterCalls().length
    await host.sendTurn({ sessionId: 'resume-1', text: 'Where were we?' })
    const first = adapterCalls()[before]
    assert.ok(first.request.text.startsWith('Where were we?'))
    assert.ok(first.request.text.includes('Always answer in one sentence.'),
      'the resumed session was not re-told its standing rules; restart carriage is the product\'s proof')
    assert.ok(!first.request.text.includes('FIXTURE TOOL SUMMARY'),
      'the tool note is start-only by design and must not replay on a resume')
  })
})

test('scope isolation: another session\'s and another thread\'s rules stay out', async () => {
  await inWorld(async ({ host }) => {
    await host.fileStandingRequest({ scope: 'session', key: 'session-a', words: 'RULE-FOR-SESSION-A only.' })
    await host.fileStandingRequest({ scope: 'thread', key: 'node-a', words: 'RULE-FOR-THREAD-A only.' })
    await host.startSession({
      sessionId: 'session-b',
      requestKeys: { treeAnchors: ['node-b'], threadId: 'node-b' },
    })
    const before = adapterCalls().length
    await host.sendTurn({ sessionId: 'session-b', text: 'Hello.' })
    const text = adapterCalls()[before].request.text
    assert.ok(!text.includes('RULE-FOR-SESSION-A'), 'a session rule crossed into another session\'s brief')
    assert.ok(!text.includes('RULE-FOR-THREAD-A'), 'a thread rule crossed into another conversation\'s brief')
  })
})

test('an absurd ledger cannot brick or bloat a start: capped, announced, still running', async () => {
  await inWorld(async ({ host, stateRoot }) => {
    /* Hundreds of entries plus an oversized one, planted the way the owner
       would produce them: through the module itself. */
    for (let index = 0; index < 300; index += 1) {
      FIXTURE_LEDGER.fileRequest({ scope: 'global', words: `Global rule number ${index} with some padding words to carry real weight.` })
    }
    FIXTURE_LEDGER.fileRequest({ scope: 'global', words: `NEWEST-GLOBAL-RULE ${'x'.repeat(12_000)}` })
    for (let index = 0; index < 100; index += 1) {
      FIXTURE_LEDGER.fileRequest({ scope: 'thread', key: 'node-7', words: `Thread rule ${index} ${'y'.repeat(200)}` })
    }
    await host.startSession({
      sessionId: 'ceiling-1',
      requestKeys: { treeAnchors: ['node-7'], threadId: 'node-7' },
    })
    const before = adapterCalls().length
    await host.sendTurn({ sessionId: 'ceiling-1', text: 'Start anyway.' })
    const text = adapterCalls()[before].request.text
    assert.ok(text.startsWith('Start anyway.'), 'the session did not start cleanly under ledger pressure')
    assert.ok(Buffer.byteLength(text, 'utf8') <= 24_000 + Buffer.byteLength('Start anyway.', 'utf8'),
      `the block is unbounded: ${Buffer.byteLength(text, 'utf8')} bytes reached the engine`)
    assert.match(text, /withheld for space/, 'a trimmed block must ANNOUNCE the trim')
    assert.ok(text.includes(path.join(stateRoot, 'state', 'r-ledger', 'thread-node-7.md')),
      'a withheld layer must name the file where its rules live')
    assert.ok(text.includes('NEWEST-GLOBAL-RULE'),
      'the newest global entry must always survive — newer owner directives amend older ones')
  })
})

test('a corrupt or oversized ledger file degrades to an announced absence, never a dead start', async () => {
  await inWorld(async ({ host, stateRoot }) => {
    const dir = path.join(stateRoot, 'state', 'r-ledger')
    mkdirSync(dir, { recursive: true })
    /* Over the module's own MAX_LEDGER_BYTES: readLedger THROWS on this file.
       The session must still start, saying what it could not read. */
    writeFileSync(path.join(dir, 'thread-node-7.md'), `# big\n${'z'.repeat(2 * 1024 * 1024 + 10)}`, 'utf8')
    await host.startSession({
      sessionId: 'corrupt-1',
      requestKeys: { treeAnchors: [], threadId: 'node-7' },
    })
    const before = adapterCalls().length
    await host.sendTurn({ sessionId: 'corrupt-1', text: 'Still here?' })
    const text = adapterCalls()[before].request.text
    assert.ok(text.startsWith('Still here?'), 'an unreadable ledger killed the start — worse than no feature')
    assert.match(text, /could not be read/, 'the unreadable layer must be stated, not skipped')
  })
})

test('a payload with no r-ledger module starts sessions, injects nothing, and refuses filing by name', async () => {
  const workdir = mkdtempSync(path.join(tmpdir(), 'mc-request-absent-'))
  try {
    const host = createAgentHost({
      enginePath: SUMMARYLESS_ENGINE,
      defaultCwd: workdir,
      confinementPlanner: () => guidedPlan(workdir),
    })
    await host.startSession({ sessionId: 'absent-1', requestKeys: { treeAnchors: ['node-1'], threadId: 'node-1' } })
    const engine = require_(SUMMARYLESS_ENGINE)
    const before = engine.adapterCalls.length
    await host.sendTurn({ sessionId: 'absent-1', text: 'Old payload, ordinary start.' })
    assert.equal(engine.adapterCalls[before].request.text, 'Old payload, ordinary start.',
      'an older payload cannot read ledgers, so nothing may be injected')
    await assert.rejects(() => host.fileStandingRequest({ scope: 'global', words: 'rule' }),
      error => error.code === 'AGENT_REQUEST_UNAVAILABLE',
      'filing on an old payload must refuse by name, never pretend')
    await host.closeAll()
  } finally {
    rmSync(workdir, { recursive: true, force: true, maxRetries: 5 })
  }
})

/* The keyless path: a session with no requestKeys (the single-agent page)
   still gets GLOBAL rules when any exist — and stays byte-identical to today
   when none do, which is what keeps every older suite's exact-text pins true. */
test('a keyless session carries global rules when they exist, and nothing when none do', async () => {
  await inWorld(async ({ host }) => {
    await host.startSession({ sessionId: 'keyless-empty' })
    const before = adapterCalls().length
    await host.sendTurn({ sessionId: 'keyless-empty', text: 'Plain start.' })
    const text = adapterCalls()[before].request.text
    assert.ok(!text.includes('Standing requests'),
      'an empty world must inject nothing — token-lean is a contract')

    await host.fileStandingRequest({ scope: 'global', words: 'Ask before spending money.' })
    await host.startSession({ sessionId: 'keyless-full' })
    const before2 = adapterCalls().length
    await host.sendTurn({ sessionId: 'keyless-full', text: 'Plain start.' })
    const text2 = adapterCalls()[before2].request.text
    assert.ok(text2.includes('Ask before spending money.'),
      'a global rule must reach every agent, keys or none — that is what "global" says')
  })
})
