import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import deviceClaimModule from '../../shell/device-claim.cjs'

const {
  CLAIM_ENTRY,
  CODES,
  CODE_VALUES,
  KILL_ESCALATION_MS,
  MAX_NAME_LENGTH,
  MAX_STDOUT_BYTES,
  NETWORK_TIMEOUT_MS,
  REASONS,
  STATUS_TIMEOUT_MS,
  createDeviceClaim,
} = deviceClaimModule

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SHELL_DIR = path.join(HERE, '..', '..', 'shell')
const CLAIM_FILE = path.join(SHELL_DIR, 'device-claim.cjs')
const MAIN_FILE = path.join(SHELL_DIR, 'main.cjs')
const PRELOAD_FILE = path.join(SHELL_DIR, 'preload.cjs')

const PAYLOAD_ROOT = path.join('R:', 'app', 'resources', 'capability')
const CLAIM_ENTRY_PATH = path.join(PAYLOAD_ROOT, 'tools', 'online-fra-claim-cli.js')
const STATE_ROOT = path.join('C:', 'Users', 'someone', 'AppData', 'Roaming', 'ToolsEnabled', 'capability')
const EXEC_PATH = path.join('R:', 'app', 'ToolsEnabled.exe')

/* THE POLL TOKEN THIS SUITE HUNTS FOR. It is deliberately a long, unmistakable
 * string: every renderer-facing value produced anywhere in this file is walked
 * and searched for it, so a leak through a field somebody added later is
 * caught by shape rather than by anybody remembering to look. */
const POLL_TOKEN = 'poll-token-3f9a1c77-NEVER-CROSSES-TO-A-RENDERER'
const CLAIM_CODE = 'TC-4K2P-9WQ7'

/* The credential fields the engine's own connectionState() carries and the
 * CLI already declines to print. If a future CLI starts printing them, the
 * shell must decline a second time -- these are searched for in exactly the
 * same way as the poll token. */
const DEVICE_TOKEN = 'device-token-8b2e-MUST-NOT-REACH-A-WINDOW'
const PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----MUST-NOT-REACH-A-WINDOW'

/* THE ENVIRONMENT THE PARENT IS ASSUMED TO HAVE, and it is hostile on purpose:
 * the provider credentials the payload's own tripwire enumerates, a
 * NODE_OPTIONS that would inject a require into a process about to touch the
 * vault, a proxy that would redirect its transport, a vault redirect that
 * would point it at a second state root, and an account origin that would
 * quietly send a customer's claim to somebody else's service. A bridge that
 * spreads process.env into its child passes almost every test in this file and
 * fails the four in the allowlist section. */
const PARENT_ENVIRONMENT = Object.freeze({
  PATH: 'C:\\Windows\\System32',
  PATHEXT: '.COM;.EXE;.BAT',
  SystemRoot: 'C:\\Windows',
  SystemDrive: 'C:',
  windir: 'C:\\Windows',
  ComSpec: 'C:\\Windows\\System32\\cmd.exe',
  LOCALAPPDATA: 'C:\\Users\\someone\\AppData\\Local',
  APPDATA: 'C:\\Users\\someone\\AppData\\Roaming',
  ProgramData: 'C:\\ProgramData',
  ProgramFiles: 'C:\\Program Files',
  USERPROFILE: 'C:\\Users\\someone',
  TEMP: 'C:\\Users\\someone\\AppData\\Local\\Temp',
  TMP: 'C:\\Users\\someone\\AppData\\Local\\Temp',
  TOOLSENABLED_STATE_ROOT: STATE_ROOT,
  /* None of the following may reach the child. */
  ANTHROPIC_API_KEY: 'sk-ant-should-never-cross',
  CLAUDE_CODE_OAUTH_TOKEN: 'oauth-should-never-cross',
  OPENAI_API_KEY: 'sk-should-never-cross',
  NODE_OPTIONS: '--require C:\\anything.js',
  HTTPS_PROXY: 'http://127.0.0.1:9',
  TOOLSENABLED_VAULT_PATH: 'D:\\somewhere-else\\secrets.json',
  TOOLSENABLED_ACCOUNT_ORIGIN: 'https://not-the-account-service.example',
  TOOLSENABLED_AGENT_FACADE_ORIGIN: 'http://127.0.0.1:52341',
  TOOLSENABLED_AGENT_FACADE_TOKEN: 'facade-bearer-should-never-cross',
  ELECTRON_NO_ATTACH_CONSOLE: '1',
})

const FORBIDDEN_IN_CHILD_ENVIRONMENT = Object.freeze([
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'NODE_OPTIONS',
  'HTTPS_PROXY',
  'TOOLSENABLED_VAULT_PATH',
  'TOOLSENABLED_AGENT_FACADE_ORIGIN',
  'TOOLSENABLED_AGENT_FACADE_TOKEN',
  'ELECTRON_NO_ATTACH_CONSOLE',
])

/* A clock and a timer wheel that answer to this test rather than to the
 * machine. The deadlines here are measured in tens of seconds; proving them
 * with real sleeps would make this the slowest suite in the repository and
 * would still be flaky on a loaded machine. */
function fakeClock(startMs = 1_700_000_000_000) {
  let nowMs = startMs
  let nextId = 0
  const pending = new Map()
  return {
    now: () => nowMs,
    setTimeout(fn, ms) {
      nextId += 1
      pending.set(nextId, { fn, at: nowMs + ms })
      return nextId
    },
    clearTimeout(id) { pending.delete(id) },
    advance(ms) {
      nowMs += ms
      for (const [id, timer] of [...pending.entries()]) {
        if (timer.at > nowMs) continue
        pending.delete(id)
        timer.fn()
      }
    },
    set(ms) { nowMs = ms },
    pendingCount: () => pending.size,
  }
}

/* A child that behaves like a spawned process and starts none. Its kills are
 * recorded rather than performed, which is what lets the deadline tests prove
 * escalation without a real program to escalate against. */
function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.signals = []
  child.kill = (signal) => {
    child.signals.push(signal || 'SIGTERM')
    return true
  }
  return child
}

/* The spawn seam. `script[n]` runs against the n-th child once the module has
 * finished attaching its listeners; a step of `null` is a child that simply
 * never answers, which is the hung case. */
function recordingSpawn(script = []) {
  const calls = []
  const spawn = (command, args, options) => {
    const child = fakeChild()
    calls.push({ command, args, options, child })
    const step = script[calls.length - 1]
    if (typeof step === 'function') queueMicrotask(() => step(child))
    return child
  }
  spawn.calls = calls
  spawn.last = () => calls[calls.length - 1]
  return spawn
}

/* One JSON object on stdout, prose on stderr, then exit -- the CLI's stated
 * contract, reproduced exactly so a passing test means the real child's shape
 * was handled and not a convenient one. */
function answers(object, { prose = 'human prose that is not data\n', exitCode = 0 } = {}) {
  return (child) => {
    child.stderr.emit('data', Buffer.from(prose))
    child.stdout.emit('data', Buffer.from(`${JSON.stringify(object)}\n`))
    child.emit('exit', exitCode, null)
  }
}

function claimUnderTest({
  script = [],
  env = PARENT_ENVIRONMENT,
  stateRoot = STATE_ROOT,
  accountOrigin = '',
  entryPresent = true,
  payloadRoot = PAYLOAD_ROOT,
  spawn = undefined,
  clock = fakeClock(),
} = {}) {
  const spawner = spawn || recordingSpawn(script)
  const claim = createDeviceClaim({
    spawn: spawner,
    resolvePayloadRoot: () => payloadRoot,
    exists: (candidate) => entryPresent && candidate === CLAIM_ENTRY_PATH,
    execPath: EXEC_PATH,
    env,
    stateRoot,
    accountOrigin,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  })
  return { claim, spawn: spawner, clock }
}

/* Walks any reply and answers whether a secret is anywhere inside it, at any
 * depth, in a key or in a value. A field-by-field assertion proves the fields
 * somebody thought of; this proves the ones they did not. */
function containsSecret(value, secret, seen = new Set()) {
  if (typeof value === 'string') return value.includes(secret)
  if (typeof value !== 'object' || value === null) return false
  if (seen.has(value)) return false
  seen.add(value)
  for (const [key, entry] of Object.entries(value)) {
    if (key.includes(secret)) return true
    if (containsSecret(entry, secret, seen)) return true
  }
  return false
}

const OPEN_ANSWER = Object.freeze({
  code: CLAIM_CODE,
  pollToken: POLL_TOKEN,
  expiresAtMs: 1_700_000_600_000,
  intervalSeconds: 5,
})

/* ------------------------------------------------------------------ §1
   THE ENVIRONMENT ALLOWLIST. Break relayChildEnvironment's allowlist, or
   replace childEnvironment() with `{ ...env }`, and every test in this
   section goes red. */

test('the claim child is handed an allowlist, never this process environment', async () => {
  const { claim, spawn } = claimUnderTest({ script: [answers({ connected: false })] })
  await claim.status()

  const childEnv = spawn.last().options.env
  for (const name of FORBIDDEN_IN_CHILD_ENVIRONMENT) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(childEnv, name), false,
      `${name} reached the claim child`,
    )
  }
  /* And the positive half, so the test cannot pass by handing over nothing:
     the child still gets what it demonstrably needs. */
  assert.equal(childEnv.PATH, PARENT_ENVIRONMENT.PATH)
  assert.equal(childEnv.SystemRoot, PARENT_ENVIRONMENT.SystemRoot)
  assert.equal(childEnv.TEMP, PARENT_ENVIRONMENT.TEMP)
})

test('the child is run as node and pointed at the state root this shell chose', async () => {
  const { claim, spawn } = claimUnderTest({ script: [answers({ connected: false })] })
  await claim.status()

  const childEnv = spawn.last().options.env
  assert.equal(childEnv.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(childEnv.TOOLSENABLED_STATE_ROOT, STATE_ROOT)
  /* Not the parent's redirect, which named a different file entirely. */
  assert.equal(childEnv.TOOLSENABLED_VAULT_PATH, undefined)
})

test('the agent facade bearer is not handed to a claim, which has no use for it', async () => {
  const { claim, spawn } = claimUnderTest({ script: [answers({ connected: false })] })
  await claim.status()

  const childEnv = spawn.last().options.env
  assert.equal(childEnv.TOOLSENABLED_AGENT_FACADE_TOKEN, undefined)
  assert.equal(childEnv.TOOLSENABLED_AGENT_FACADE_ORIGIN, undefined)
  assert.equal(
    containsSecret(childEnv, PARENT_ENVIRONMENT.TOOLSENABLED_AGENT_FACADE_TOKEN), false,
    'the facade bearer appeared in the claim child environment',
  )
})

test('the account origin is stated by this shell or absent, never inherited', async () => {
  const inherited = claimUnderTest({ script: [answers({ connected: false })] })
  await inherited.claim.status()
  assert.equal(
    inherited.spawn.last().options.env.TOOLSENABLED_ACCOUNT_ORIGIN, undefined,
    'an ambient account origin reached a customer claim',
  )

  const stated = claimUnderTest({
    script: [answers({ connected: false })],
    accountOrigin: 'https://staging.example',
  })
  await stated.claim.status()
  assert.equal(stated.spawn.last().options.env.TOOLSENABLED_ACCOUNT_ORIGIN, 'https://staging.example')
})

test('the environment is composed key by key, and the source says so', () => {
  const source = fs.readFileSync(CLAIM_FILE, 'utf8')
  /* A spread of the parent environment, in any of the shapes that would do it,
     is the one edit this module cannot survive. */
  assert.equal(/\.\.\.\s*process\.env/.test(source), false, 'device-claim spreads process.env')
  assert.equal(/\.\.\.\s*env\b/.test(source), false, 'device-claim spreads its injected env')
  assert.equal(/Object\.assign\(\s*\{\s*\}\s*,\s*(process\.)?env/.test(source), false)
  /* And it is not quietly requiring Electron either -- the whole module is
     driven from injected seams so this suite can run it. */
  assert.equal(/require\(\s*['"]electron['"]\s*\)/.test(source), false)
})

/* ------------------------------------------------------------------ §2
   THE POLL TOKEN. It is minted by the account service, it collects the
   credential, and it must never be in anything a window can read. */

test('begin answers the code to show and nothing that could collect the claim', async () => {
  const { claim } = claimUnderTest({ script: [answers(OPEN_ANSWER)] })
  const opened = await claim.begin({ name: 'Desk PC' })

  assert.equal(opened.ok, true)
  assert.equal(opened.code, CLAIM_CODE)
  assert.equal(opened.expiresAtMs, OPEN_ANSWER.expiresAtMs)
  assert.equal(opened.intervalSeconds, 5)
  assert.equal(opened.pollToken, undefined)
  assert.equal(
    containsSecret(opened, POLL_TOKEN), false,
    'the poll token was in the reply begin() hands a renderer',
  )
})

test('poll uses the token this process is holding and takes none from its caller', async () => {
  const { claim, spawn } = claimUnderTest({
    script: [answers(OPEN_ANSWER), answers({ state: 'pending', intervalSeconds: 5 })],
  })
  await claim.begin({ name: 'Desk PC' })
  /* A renderer trying to name its own claim. poll() has no parameter, so the
     argument is not merely refused -- there is nowhere for it to go. */
  const polled = await claim.poll('some-other-claims-token')

  assert.equal(polled.ok, true)
  assert.equal(polled.state, 'pending')
  const args = spawn.last().args
  assert.deepEqual(args, [CLAIM_ENTRY_PATH, 'poll', '--token', POLL_TOKEN])
  assert.equal(args.includes('some-other-claims-token'), false)
})

test('no value any of the four verbs hands a renderer contains the poll token', async () => {
  const { claim } = claimUnderTest({
    script: [
      answers(OPEN_ANSWER),
      answers({ state: 'pending', intervalSeconds: 5 }),
      answers({ state: 'connected', pairId: 'pair-1', deviceId: 'device-1', name: 'Desk PC' }),
      answers({ connected: true, pairId: 'pair-1', deviceId: 'device-1', name: 'Desk PC', claimedAtMs: 1 }),
    ],
  })
  const replies = []
  replies.push(await claim.begin({ name: 'Desk PC' }))
  replies.push(await claim.poll())
  replies.push(await claim.poll())
  replies.push(await claim.cancel())
  replies.push(await claim.status())

  for (const reply of replies) {
    assert.equal(containsSecret(reply, POLL_TOKEN), false, `a reply carried the poll token: ${JSON.stringify(reply)}`)
  }
  /* Serialised too, because IPC replies cross as structured clones and a
     non-enumerable hiding place would still survive that. */
  assert.equal(JSON.stringify(replies).includes(POLL_TOKEN), false)
})

test('cancel forgets the token, and a poll after it says nothing is in flight', async () => {
  const { claim, spawn } = claimUnderTest({ script: [answers(OPEN_ANSWER)] })
  await claim.begin({ name: 'Desk PC' })
  assert.equal(claim.claimOpen(), true)

  /* `dropped` SAYS WHETHER THERE WAS ANYTHING TO GIVE UP, and the surface
     cannot see this module's variable to work that out for itself. Every "Get
     a code" is routed through cancel-then-begin now -- a second press used to
     open a second live claim and orphan the first poll token, leaving a
     computer on the account page that this machine could never finish
     connecting -- so most of those cancels find nothing and must stay silent.
     The one that DID drop a live claim owes the person a sentence, because the
     code it dropped may already be typed into their browser. */
  assert.deepEqual(claim.cancel(), { ok: true, dropped: true })
  assert.equal(claim.claimOpen(), false)
  /* And a cancel with nothing in flight says so, rather than inviting the
     surface to print that sentence at somebody who never saw a code. */
  assert.deepEqual(claim.cancel(), { ok: true, dropped: false })

  const spawnsBefore = spawn.calls.length
  const polled = await claim.poll()
  assert.deepEqual(polled, { ok: true, state: 'none' })
  /* And it did not ask anybody: a claim nobody is waiting for costs no child. */
  assert.equal(spawn.calls.length, spawnsBefore)
})

/* ------------------------------------------------------------------ §3
   THE BOUNDED CHILD. A claim CLI that never exits must not wedge the shell
   behind an IPC reply that never comes. */

test('a child that never answers is stopped, and the caller gets a named refusal', async () => {
  const { claim, spawn, clock } = claimUnderTest({ script: [null] })
  const pending = claim.status()

  /* Nothing has resolved yet: the child is simply sitting there. */
  clock.advance(STATUS_TIMEOUT_MS - 1)
  const child = spawn.last().child
  assert.deepEqual(child.signals, [])

  clock.advance(2)
  const refused = await pending
  assert.equal(refused.ok, false)
  assert.equal(refused.code, CODES.TIMEOUT)
  assert.deepEqual(child.signals, ['SIGTERM'])

  /* A child that ignores the first signal is killed outright. */
  clock.advance(KILL_ESCALATION_MS)
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL'])
})

test('the network verbs get the longer deadline, because the child aborts first', async () => {
  const { claim, clock } = claimUnderTest({ script: [null] })
  const pending = claim.begin({ name: 'Desk PC' })

  /* At the status deadline a network verb is still waiting: the engine's own
     client gives up at fifteen seconds, and a shell that timed out first would
     report a timeout for what the service called a refusal. */
  clock.advance(STATUS_TIMEOUT_MS + 1)
  let settled = false
  pending.then(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, false)

  clock.advance(NETWORK_TIMEOUT_MS)
  const refused = await pending
  assert.equal(refused.code, CODES.TIMEOUT)
})

test('a timed-out step does not wedge the next one', async () => {
  const { claim, clock, spawn } = claimUnderTest({
    script: [null, answers({ connected: false })],
  })
  const hung = claim.status()
  clock.advance(STATUS_TIMEOUT_MS + 1)
  assert.equal((await hung).code, CODES.TIMEOUT)

  const second = await claim.status()
  assert.deepEqual(second, { ok: true, connected: false })
  assert.equal(spawn.calls.length, 2)
})

test('a step that WRITES is refused by name rather than by racing on one vault', async () => {
  const { claim, clock, spawn } = claimUnderTest({ script: [null] })
  const first = claim.status()
  const second = await claim.begin({ name: 'Desk PC' })

  assert.equal(second.ok, false)
  assert.equal(second.code, CODES.BUSY)
  assert.equal(spawn.calls.length, 1, 'a second child was spawned while one was in flight')

  clock.advance(STATUS_TIMEOUT_MS + 1)
  await first
})

/* ---- A READ IS NOT A WRITE, AND REFUSING IT COST A CUSTOMER THE PRODUCT -----
 *
 * WHAT WAS MEASURED. On a sterile profile, opening the connect screen drew a
 * red alert reading "This computer is already in the middle of a connection
 * step. Wait for that one to finish." -- four inches under "Nothing has been
 * sent anywhere", before the person had touched anything. Three scouts
 * reproduced it independently, roughly eight opens in fourteen.
 *
 * THE CAUSE. Two callers ask status during the same two seconds of every
 * launch: shell/main.cjs awaits one before deciding whether to start the relay
 * leg, and the renderer fires one when the connect section mounts. One child at
 * a time is the right rule for anything that WRITES; status writes nothing, and
 * its own comment says it is "safe to call at any cadence from any surface".
 * Whichever caller lost the race was told a connection step was under way.
 *
 * The second asker joins the answer now. Nothing is cached beyond the flight --
 * a remembered verdict here would be the same defect wearing the opposite face
 * -- so the spawn count is what this asserts, twice: one child while it is in
 * flight, and a fresh child for a question asked afterwards. */
test('two READS at once share one child and one answer, instead of one being refused', async () => {
  const { claim, spawn } = claimUnderTest({
    script: [answers({ connected: false }), answers({ connected: false })],
  })
  const first = claim.status()
  const second = claim.status()
  assert.equal(spawn.calls.length, 1, 'a second child was spawned for a question already being asked')

  const [one, two] = await Promise.all([first, second])
  assert.deepEqual(one, { ok: true, connected: false })
  assert.deepEqual(two, one, 'the joined caller got a different answer from the one it joined')

  /* AND THE JOIN DOES NOT BECOME A CACHE. Asked again after it settled, the
     vault is read again -- a screen that reopens must be able to learn that a
     computer was connected in the meantime. */
  await claim.status()
  assert.equal(spawn.calls.length, 2, 'a later question was answered from a remembered verdict')
})

test('a child that floods stdout is stopped instead of being read to the end', async () => {
  const flood = (child) => {
    child.stdout.emit('data', Buffer.alloc(MAX_STDOUT_BYTES + 1, 0x61))
  }
  const { claim, spawn } = claimUnderTest({ script: [flood] })
  const refused = await claim.status()

  assert.equal(refused.ok, false)
  assert.equal(refused.code, CODES.OUTPUT_TOO_LARGE)
  assert.deepEqual(spawn.last().child.signals, ['SIGTERM'])
})

test('every deadline timer is cleared by the answer that beat it', async () => {
  const { claim, clock } = claimUnderTest({ script: [answers({ connected: false })] })
  await claim.status()
  assert.equal(clock.pendingCount(), 0, 'a settled step left a timer behind')
})

/* ------------------------------------------------------------------ §4
   DEVICE_CLAIM_GONE, which is the one refusal a surface must act on: the
   code on the person's screen is dead and only a new claim helps. */

test('the service saying the claim is gone reaches the renderer as a code it can act on', async () => {
  const { claim } = claimUnderTest({
    script: [
      answers(OPEN_ANSWER),
      answers({ error: { code: 'DEVICE_CLAIM_GONE', message: 'The claim is no longer open.' } }, { exitCode: 1 }),
    ],
  })
  await claim.begin({ name: 'Desk PC' })
  const refused = await claim.poll()

  assert.equal(refused.ok, false)
  assert.equal(refused.code, CODES.GONE)
  assert.equal(typeof refused.reason, 'string')
  /* And the dead token is dropped here, so nothing can retry with it. */
  assert.equal(claim.claimOpen(), false)
  assert.deepEqual(await claim.poll(), { ok: true, state: 'none' })
})

test('a claim that outlived its own expiry is gone without asking anybody', async () => {
  const clock = fakeClock()
  const { claim, spawn } = claimUnderTest({ script: [answers(OPEN_ANSWER)], clock })
  await claim.begin({ name: 'Desk PC' })
  const spawnsBefore = spawn.calls.length

  clock.set(OPEN_ANSWER.expiresAtMs + 1)
  const refused = await claim.poll()

  assert.equal(refused.code, CODES.GONE)
  assert.equal(spawn.calls.length, spawnsBefore, 'a dead token was still put on the wire')
  assert.equal(claim.claimOpen(), false)
})

test('a refusal that is not gone leaves the claim in flight, because the code still works', async () => {
  const { claim } = claimUnderTest({
    script: [
      answers(OPEN_ANSWER),
      answers({ error: { code: 'DEVICE_CLAIM_UNREACHABLE', message: 'fetch failed' } }, { exitCode: 1 }),
    ],
  })
  await claim.begin({ name: 'Desk PC' })
  const refused = await claim.poll()

  assert.equal(refused.code, CODES.UNREACHABLE)
  assert.equal(claim.claimOpen(), true, 'a transient failure threw away a claim the person can still finish')
})

/* ------------------------------------------------------------------ §5
   WHAT A REFUSAL MAY SAY. A code from a closed set, a sentence written in
   this repository, and nothing derived from what a child printed. */

test('a child message naming a path or a vault key never becomes the reason', async () => {
  const leak = 'C:\\Users\\someone\\AppData\\Roaming\\ToolsEnabled\\capability\\vault\\secrets.json'
  const { claim } = claimUnderTest({
    script: [answers({
      error: {
        code: 'DEVICE_CLAIM_CREDENTIAL_INVALID',
        message: `The value at custom.online_fra_device_credential_v1 in ${leak} is not readable.`,
      },
    }, { exitCode: 1 })],
  })
  const refused = await claim.status()

  assert.equal(refused.code, CODES.CREDENTIAL_INVALID)
  assert.equal(refused.reason, REASONS[CODES.CREDENTIAL_INVALID])
  assert.equal(refused.reason.includes(leak), false)
  assert.equal(refused.reason.includes('custom.online_fra_device_credential_v1'), false)
  assert.equal(containsSecret(refused, 'secrets.json'), false)
})

test('a code this shell has never heard of becomes REFUSED rather than a new branch', async () => {
  const { claim } = claimUnderTest({
    script: [answers({ error: { code: 'SOME_FUTURE_CODE', message: 'x' } }, { exitCode: 1 })],
  })
  const refused = await claim.status()
  assert.equal(refused.code, CODES.REFUSED)
  assert.equal(CODE_VALUES.includes(refused.code), true)
})

/* THE SERVICE'S OWN REFUSALS, EACH ANSWERED AS ITSELF.
 *
 * online-fra-device-claim.js forwards `body.error.code` verbatim when the
 * account service refuses a claim, so what reaches this shell is the SERVICE's
 * word. None of these five were in the shell's table, so every one of them
 * became "The account service refused the request." -- the same nine words for
 * having tried too often, for the service being overloaded, and for us not
 * being able to serve the person's country at all. Three different answers with
 * three different next steps, and only one of them anything the person did.
 *
 * The sentence must also say whose fault it is. A person who has done nothing
 * wrong and is told only that they were "refused" reads it as their account
 * being broken, and the ones that are not their fault say so out loud. */
test('each refusal the account service can send is answered as itself, not as a generic no', async () => {
  const expected = [
    ['RATE_LIMITED', CODES.TOO_MANY_TRIES, /ten minutes/i],
    ['CLAIM_CAPACITY', CODES.SERVICE_BUSY, /busy/i],
    ['REGION_REFUSED', CODES.REGION_REFUSED, /country/i],
    ['NO_DEVICE_CLAIMS', CODES.NOT_OFFERED, /connect computers by code/i],
    ['CLAIM_UNKNOWN', CODES.GONE, /no longer open/i],
  ]
  const seen = new Set()
  for (const [serviceCode, shellCode, sentence] of expected) {
    const { claim } = claimUnderTest({
      script: [answers({ error: { code: serviceCode, message: 'a sentence from the service' } }, { exitCode: 1 })],
    })
    const refused = await claim.begin({ name: 'Desk PC' })
    assert.equal(refused.ok, false)
    assert.equal(refused.code, shellCode,
      `${serviceCode} still collapses to a generic refusal; the person cannot tell it from any other no`)
    assert.equal(CODE_VALUES.includes(refused.code), true)
    assert.match(refused.reason, sentence,
      `${shellCode}'s sentence does not say what actually happened`)
    /* The service's sentence is still thrown away -- text from a remote service
       must not render in this window, whatever the code beside it says. */
    assert.equal(refused.reason.includes('a sentence from the service'), false,
      "the account service's own text reached the renderer")
    assert.equal(seen.has(refused.reason), false,
      `${shellCode} reuses another refusal's sentence, so it reads as the same answer`)
    seen.add(refused.reason)
  }
})

test('every refusal this module can produce is a member of the closed set and has a sentence', async () => {
  const produced = new Set()
  const collect = (reply) => { if (reply && reply.ok === false) produced.add(reply.code) }

  collect(await claimUnderTest({ payloadRoot: null }).claim.status())
  collect(await claimUnderTest({ entryPresent: false }).claim.status())
  collect(await claimUnderTest({ stateRoot: 'capability' }).claim.status())
  collect(await claimUnderTest({
    spawn: Object.assign(() => { throw new Error(`spawn ENOENT ${EXEC_PATH}`) }, { calls: [], last: () => null }),
  }).claim.status())
  collect(await claimUnderTest({ script: [answers({ connected: false })] }).claim.begin({ name: '' }))
  collect(await claimUnderTest({ script: [(child) => { child.emit('exit', 0, null) }] }).claim.status())
  collect(await claimUnderTest({
    script: [answers({ error: { code: 'DEVICE_CLAIM_ALREADY_CONNECTED', message: 'x' } }, { exitCode: 1 })],
  }).claim.begin({ name: 'Desk PC' }))

  assert.ok(produced.size >= 6, `too few refusal paths exercised: ${[...produced].join(', ')}`)
  for (const code of produced) {
    assert.equal(CODE_VALUES.includes(code), true, `${code} is not in the closed set`)
    assert.equal(typeof REASONS[code], 'string', `${code} has no sentence`)
    assert.ok(REASONS[code].length > 0)
  }
})

test('no refusal sentence carries a path, a key name or a stack', () => {
  for (const [code, sentence] of Object.entries(REASONS)) {
    assert.equal(/[A-Za-z]:\\/.test(sentence), false, `${code} names a Windows path`)
    assert.equal(sentence.includes('/'), false, `${code} names a path`)
    assert.equal(sentence.includes('custom.'), false, `${code} names a vault key`)
    assert.equal(/\bat\s+\w+\s+\(/.test(sentence), false, `${code} carries a stack frame`)
  }
})

test('a spawn that fails asynchronously is named as a spawn failure', async () => {
  const { claim } = claimUnderTest({
    script: [(child) => { child.emit('error', new Error(`ENOENT ${EXEC_PATH}`)) }],
  })
  const refused = await claim.status()
  assert.equal(refused.code, CODES.SPAWN_FAILED)
  assert.equal(refused.reason.includes(EXEC_PATH), false)
})

test('stdout that is not one JSON object is unreadable, not guessed at', async () => {
  const { claim } = claimUnderTest({
    script: [(child) => {
      child.stdout.emit('data', Buffer.from('not json at all\n'))
      child.emit('exit', 0, null)
    }],
  })
  assert.equal((await claim.status()).code, CODES.UNREADABLE)
})

test('prose on stderr is not data, however JSON-shaped it looks', async () => {
  const { claim } = claimUnderTest({
    script: [(child) => {
      child.stderr.emit('data', Buffer.from('{"connected":true,"pairId":"forged"}\n'))
      child.stdout.emit('data', Buffer.from('{"connected":false}\n'))
      child.emit('exit', 0, null)
    }],
  })
  assert.deepEqual(await claim.status(), { ok: true, connected: false })
})

/* ------------------------------------------------------------------ §6
   NAMES. What a computer may be called in somebody's device list. */

test('a name is bounded, and a refused one is refused rather than quietly changed', async () => {
  const cases = [
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['x'.repeat(MAX_NAME_LENGTH + 1), 'too long'],
    [`Desk${String.fromCharCode(10)}PC`, 'a newline'],
    [`Desk${String.fromCharCode(0)}PC`, 'a NUL'],
    ['--name', 'looks like a flag'],
    [null, 'not a string'],
  ]
  for (const [value, why] of cases) {
    const { claim, spawn } = claimUnderTest({ script: [answers(OPEN_ANSWER)] })
    const refused = await claim.begin({ name: value })
    assert.equal(refused.ok, false, `${why} was accepted`)
    assert.equal(refused.code, CODES.NAME_INVALID)
    assert.equal(spawn.calls.length, 0, `${why} still reached a spawn`)
  }
})

test('an ordinary name is trimmed and handed over as one argv value', async () => {
  const { claim, spawn } = claimUnderTest({ script: [answers(OPEN_ANSWER)] })
  await claim.begin({ name: '  Kitchen iMac  ' })
  assert.deepEqual(spawn.last().args, [CLAIM_ENTRY_PATH, 'open', '--name', 'Kitchen iMac'])
  /* No shell between us and the program: an argv value cannot become syntax. */
  assert.equal(spawn.last().options.shell, undefined)
  assert.equal(spawn.last().options.windowsHide, true)
})

/* ------------------------------------------------------------------ §7
   THE REPLY SHAPES, and the credential fields that must not be in them. */

test('status copies four fields by name, so a chattier CLI cannot leak a credential', async () => {
  const { claim } = claimUnderTest({
    script: [answers({
      connected: true,
      pairId: 'pair-1',
      deviceId: 'device-1',
      name: 'Desk PC',
      claimedAtMs: 1_700_000_000_000,
      /* Fields the CLI does not print today. If it ever does, they stop here. */
      deviceToken: DEVICE_TOKEN,
      privateKeyPem: PRIVATE_KEY,
    })],
  })
  const status = await claim.status()

  assert.deepEqual({ ...status }, {
    ok: true,
    connected: true,
    name: 'Desk PC',
    deviceId: 'device-1',
    pairId: 'pair-1',
    claimedAtMs: 1_700_000_000_000,
  })
  assert.equal(containsSecret(status, DEVICE_TOKEN), false)
  assert.equal(containsSecret(status, PRIVATE_KEY), false)
})

test('a disconnected machine answers connected:false and nothing else', async () => {
  const { claim } = claimUnderTest({ script: [answers({ connected: false })] })
  assert.deepEqual({ ...(await claim.status()) }, { ok: true, connected: false })
})

test('a granted claim is nested into the device shape both halves were built against', async () => {
  const { claim } = claimUnderTest({
    script: [
      answers(OPEN_ANSWER),
      answers({
        state: 'connected',
        pairId: 'pair-9',
        deviceId: 'device-9',
        name: 'Desk PC',
        deviceToken: DEVICE_TOKEN,
      }),
    ],
  })
  await claim.begin({ name: 'Desk PC' })
  const granted = await claim.poll()

  assert.equal(granted.ok, true)
  assert.equal(granted.state, 'connected')
  assert.deepEqual({ ...granted.device }, { name: 'Desk PC', deviceId: 'device-9', pairId: 'pair-9' })
  assert.equal(containsSecret(granted, DEVICE_TOKEN), false)
})

test('a state this shell does not recognise is unreadable rather than reported as progress', async () => {
  const { claim } = claimUnderTest({
    script: [answers(OPEN_ANSWER), answers({ state: 'timeout' })],
  })
  await claim.begin({ name: 'Desk PC' })
  assert.equal((await claim.poll()).code, CODES.UNREADABLE)
})

test('an open that answers without a code or without a token starts no claim', async () => {
  for (const answer of [{ pollToken: POLL_TOKEN }, { code: CLAIM_CODE }]) {
    const { claim } = claimUnderTest({ script: [answers(answer)] })
    const refused = await claim.begin({ name: 'Desk PC' })
    assert.equal(refused.code, CODES.UNREADABLE)
    assert.equal(claim.claimOpen(), false)
  }
})

/* ------------------------------------------------------------------ §8
   THE PREDICATE THE RELAY LEG TURNS ON. relayMachineIsEnrolled() in
   shell/main.cjs is exactly this, wrapped in a try. */

test('nothing has been asked yet, so the machine is not enrolled', () => {
  const { claim, spawn } = claimUnderTest({ script: [answers({ connected: true, pairId: 'p' })] })
  assert.equal(claim.enrolled(), false)
  assert.equal(spawn.calls.length, 0, 'the predicate spawned a process')
})

test('enrolled becomes true only when the vault says this machine is connected', async () => {
  const { claim } = claimUnderTest({
    script: [answers({ connected: true, pairId: 'pair-1', deviceId: 'device-1', name: 'Desk PC' })],
  })
  assert.equal(claim.enrolled(), false)
  await claim.status()
  assert.equal(claim.enrolled(), true)
})

test('a vault that says no leaves the machine unenrolled', async () => {
  const { claim } = claimUnderTest({ script: [answers({ connected: false })] })
  await claim.status()
  assert.equal(claim.enrolled(), false)
})

test('a vault that answered yes and then could not be read stays enrolled', async () => {
  const { claim, clock } = claimUnderTest({
    script: [answers({ connected: true, pairId: 'pair-1' }), null],
  })
  await claim.status()
  assert.equal(claim.enrolled(), true)

  const hung = claim.status()
  clock.advance(STATUS_TIMEOUT_MS + 1)
  assert.equal((await hung).code, CODES.TIMEOUT)
  /* "I could not read the vault" is not "somebody disconnected this machine".
     A refusal is not evidence, so it does not move the answer. */
  assert.equal(claim.enrolled(), true)
})

test('collecting a grant enrols the machine without waiting for another vault read', async () => {
  const { claim } = claimUnderTest({
    script: [
      answers(OPEN_ANSWER),
      answers({ state: 'connected', pairId: 'pair-1', deviceId: 'device-1', name: 'Desk PC' }),
    ],
  })
  await claim.begin({ name: 'Desk PC' })
  assert.equal(claim.enrolled(), false)
  await claim.poll()
  assert.equal(claim.enrolled(), true)
})

test('a pending poll does not enrol anything', async () => {
  const { claim } = claimUnderTest({
    script: [answers(OPEN_ANSWER), answers({ state: 'pending', intervalSeconds: 5 })],
  })
  await claim.begin({ name: 'Desk PC' })
  await claim.poll()
  assert.equal(claim.enrolled(), false)
})

test('the predicate main.cjs installs answers false when anything throws', () => {
  /* The shape of relayMachineIsEnrolled(), over a claim whose cache read
     fails. main.cjs cannot be imported here -- it requires electron at load --
     so the wrapper is reproduced and the source assertion below proves the
     wrapper in the file is this one. */
  const broken = { enrolled() { throw new Error('the cache is gone') } }
  const relayMachineIsEnrolled = () => {
    try { return broken.enrolled() === true } catch { return false }
  }
  assert.equal(relayMachineIsEnrolled(), false)
})

/* ------------------------------------------------------------------ §9
   THE WIRING, asserted against the files that hold it. shell/main.cjs
   requires electron on its first lines and cannot be imported by a test, so
   these read it. A source assertion is weaker than a behavioural one and is
   used only where the behavioural one is unavailable. */

test('main.cjs answers enrolment from the vault instead of a flat false', () => {
  const source = fs.readFileSync(MAIN_FILE, 'utf8')
  const body = source.slice(source.indexOf('function relayMachineIsEnrolled()'))
  const end = body.indexOf('\n}\n')
  const predicate = body.slice(0, end)

  assert.ok(predicate.includes('deviceClaim.enrolled()'), 'the predicate does not ask device-claim')
  assert.equal(/return\s+false\s*\n}/.test(predicate), false, 'the predicate still returns a flat false')
  assert.ok(predicate.includes('catch'), 'the predicate can throw into the supervisor')
})

test('main.cjs asks the vault before it decides whether to start the relay leg', () => {
  const source = fs.readFileSync(MAIN_FILE, 'utf8')
  /* The start path is a block now -- the predicate, then the facade is armed,
     then start() -- so the pin matches the shape with whitespace collapsed
     rather than one literal line. What it holds: the vault is asked BEFORE the
     predicate is consulted. */
  const flat = source.split('').map(c => (c === ' ' || c === String.fromCharCode(9) || c === String.fromCharCode(10) || c === String.fromCharCode(13)) ? ' ' : c).join('').replace(/ +/g, ' ')
  const start = flat.indexOf('if (relayMachineIsEnrolled()) { await armRelayFacade() relaySupervisor.start()')
  assert.ok(start > 0, 'the relay leg start path is gone, or no longer arms the facade before starting')
  const preceding = flat.slice(Math.max(0, start - 1200), start)
  assert.ok(
    preceding.includes('await deviceClaim.status()'),
    'the predicate is consulted before the vault has been asked, so an enrolled machine stays dark until relaunch',
  )
})

test('every path that starts the relay leg arms the agent facade first', () => {
  /* The first real end-to-end run printed "relay leg started without an agent
     facade" on both machines: the leg ran, and every mcAgent call over the
     relay answered AGENT_FACADE_ABSENT, because the supervisor was built with
     facade: null and nothing ever awaited listen(). Every start() call site
     must now be preceded by `await armRelayFacade()`, and the supervisor must
     be handed a resolver rather than null. */
  const source = fs.readFileSync(MAIN_FILE, 'utf8')
  assert.ok(/facade:\s*\(\)\s*=>\s*relayFacadeCredentials/.test(source), 'the supervisor is not handed the facade credential resolver')
  assert.ok(!/facade:\s*null/.test(source.slice(source.indexOf('createRelaySupervisor({'))), 'the supervisor is still built with facade: null')
  const starts = [...source.matchAll(/relaySupervisor\.start\(\)/g)].map(m => m.index)
  assert.ok(starts.length >= 2, `expected at least the startup and the poll start sites, found ${starts.length}`)
  for (const at of starts) {
    const before = source.slice(Math.max(0, at - 160), at)
    assert.ok(before.includes('await armRelayFacade()'), `a relaySupervisor.start() at offset ${at} is not preceded by await armRelayFacade() -- the leg would run without the facade again`)
  }
})

test('every device-claim channel goes through the trusted-sender guard', () => {
  const source = fs.readFileSync(MAIN_FILE, 'utf8')
  const channels = ['status', 'begin', 'poll', 'cancel']
  for (const channel of channels) {
    const at = source.indexOf(`ipcMain.handle('mc-device-claim:${channel}'`)
    assert.ok(at > 0, `mc-device-claim:${channel} is not registered`)
    const handler = source.slice(at, at + 400)
    assert.ok(
      handler.includes('assertTrustedAgentSender(event)'),
      `mc-device-claim:${channel} does not assert its sender`,
    )
  }
})

test('the poll channel carries no token from the renderer', () => {
  const source = fs.readFileSync(MAIN_FILE, 'utf8')
  const at = source.indexOf("ipcMain.handle('mc-device-claim:poll'")
  const handler = source.slice(at, at + 400)
  /* The handler's own signature is (event) -- a second parameter would be a
     place for a page to put a claim it did not open. */
  assert.ok(/ipcMain\.handle\('mc-device-claim:poll',\s*async\s*\(event\)\s*=>/.test(handler))
  assert.ok(handler.includes('deviceClaim.poll()'))
})

test('a collected grant starts the relay leg rather than waiting for the next launch', () => {
  const source = fs.readFileSync(MAIN_FILE, 'utf8')
  const at = source.indexOf("ipcMain.handle('mc-device-claim:poll'")
  const handler = source.slice(at, at + 500)
  assert.ok(handler.includes("answer.state === 'connected'"))
  assert.ok(handler.includes('relaySupervisor.start()'))
  assert.ok(handler.includes('relayMachineIsEnrolled()'), 'the leg is started without re-checking enrolment')
})

test('the preload exposes the namespace, and its poll takes no argument', () => {
  const source = fs.readFileSync(PRELOAD_FILE, 'utf8')
  assert.ok(source.includes('deviceClaim: Object.freeze({'))
  assert.ok(source.includes("status: () => ipcRenderer.invoke('mc-device-claim:status')"))
  assert.ok(source.includes("begin: (request) => ipcRenderer.invoke('mc-device-claim:begin', request)"))
  assert.ok(source.includes("poll: () => ipcRenderer.invoke('mc-device-claim:poll')"))
  assert.ok(source.includes("cancel: () => ipcRenderer.invoke('mc-device-claim:cancel')"))
  /* The one shape that would undo the whole guarantee. */
  assert.equal(/poll:\s*\([^)]+\)\s*=>/.test(source), false, 'poll accepts a token from the page')
})

test('the claim CLI is declared shippable in both places a build checks', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'capability-manifest.json'), 'utf8'))
  assert.ok(
    manifest.spawnedPrograms.includes('tools/online-fra-claim-cli.js'),
    'the claim CLI is not a closure root, so the packer will not stage it',
  )
  const boundary = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'config', 'payload-boundary.json'), 'utf8'))
  assert.ok(
    boundary.open.paths.includes('tools/online-fra-claim-cli.js'),
    'a staged file with no classification fails the boundary guard',
  )
  assert.ok(boundary.source.open.paths.includes('shell/device-claim.cjs'))
  assert.ok(boundary.source.open.paths.includes('tools/test/device-claim.test.mjs'))
})

test('the entry this module spawns is the path the manifest stages', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'capability-manifest.json'), 'utf8'))
  const declared = manifest.spawnedPrograms.find((entry) => entry.endsWith('online-fra-claim-cli.js'))
  /* The manifest speaks posix; CLAIM_ENTRY is joined for this platform. One
     mismatch here is a child spawned at a path the packer never wrote. */
  assert.equal(CLAIM_ENTRY.split(path.sep).join('/'), declared)
})
