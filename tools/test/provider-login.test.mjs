/* The sign-in spawn, and the four ways it could quietly become a hazard.
 *
 * WHAT IS BEING GUARDED. shell/provider-login.cjs is the one place this product
 * starts a provider's own sign-in program for a person. The friend who installed
 * 1.0.20 got stuck exactly where the owner predicted: the guide told them to run
 * "codex login" in the window the install had just finished in, and that window
 * answered "'codex' is not recognized" -- a PATH written by the installer is not
 * re-read by a shell that is already open. This module removes the terminal from
 * the path entirely: the product resolves the program fresh and starts the
 * program's OWN login flow, so a stale window cannot exist.
 *
 * FOUR PROPERTIES, EACH WITH A TEST THAT FAILS WITHOUT IT:
 *
 *   1. NO CREDENTIAL CAN TRANSIT THIS CODE, STRUCTURALLY. The child's stdin is
 *      'ignore' -- the paste-back leg of a login flow cannot pass through us
 *      because there is no pipe to write into. The module contains no call that
 *      returns file contents, so it cannot read what the login writes. Both are
 *      absences of code, so both are asserted against the source text, the same
 *      way tools/test/provider-cli-presence.test.mjs asserts its probe.
 *   2. IT ONLY EVER USES THE HIDDEN-SPAWN SEAM. A direct child_process call is
 *      how a console window reaches the desktop (STANDING-ORDERS LOCAL-WORK
 *      rule 3); the seam is injected and the source never requires the module
 *      that could bypass it.
 *   3. IT REFUSES WHAT IT CANNOT DO, IN SENTENCES. An absent program is a
 *      refusal naming the fix, not a spawn error. Gemini has no login
 *      subcommand (gemini 0.53.0, read off its own help), so asking is refused
 *      rather than invented.
 *   4. WHAT IT FORWARDS IS READABLE AND BOUNDED. Terminal colour codes are
 *      stripped, output is capped, and the one thing a person must not miss --
 *      the https line the flow prints -- is surfaced as its own event.
 *
 * Run: node --test tools/test/provider-login.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const MODULE_FILE = path.join(REPO_ROOT, 'shell', 'provider-login.cjs')

const { createProviderLoginService, LOGIN_PROVIDER_IDS } = require_(MODULE_FILE)

/* A child the suite can drive: emits what a test tells it to, records kills. */
function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = false
  child.kill = () => { child.killed = true; child.emit('exit', null); return true }
  return child
}

function harness({ files = [], env = {}, execPath = 'C:/app/ToolsEnabled.exe' } = {}) {
  const lower = new Set(files.map(file => file.toLowerCase()))
  const spawns = []
  const child = fakeChild()
  const service = createProviderLoginService({
    spawnHidden: (command, args, options) => { spawns.push({ command, args, options }); return child },
    resolveHiddenInvocation: (command, args) => ({ command, args, env: {}, resolved: null }),
    env: { APPDATA: 'C:/u/AppData/Roaming', PATH: '', PATHEXT: '.COM;.EXE;.BAT;.CMD', ...env },
    platform: 'win32',
    execPath,
    statSync: target => {
      if (lower.has(String(target).replace(/\\/g, '/').toLowerCase())) return { isFile: () => true }
      const error = new Error('ENOENT'); error.code = 'ENOENT'; throw error
    },
  })
  return { service, spawns, child }
}

const NPM_CODEX_LAUNCHER = 'C:/u/AppData/Roaming/npm/node_modules/@openai/codex/bin/codex.js'
const NPM_CLAUDE_EXE = 'C:/u/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe'

/* ------------------------------------------------------------------
   1. The absences, asserted against the source because they are absences.
   ------------------------------------------------------------------ */

test('no code path can read a file, wire stdin, or bypass the hidden seam', () => {
  const source = readFileSync(MODULE_FILE, 'utf8')
  for (const forbidden of [
    'readFile', 'readFileSync', 'createReadStream', 'openSync', 'readSync',
    'writeFile', 'writeFileSync', 'appendFile',
    "require('node:child_process')", 'require("node:child_process")',
    "require('child_process')", 'require("child_process")',
    'stdin.write', "stdio: ['pipe'", 'stdio: ["pipe"',
  ]) {
    assert.ok(!source.includes(forbidden), `the login spawn module contains ${forbidden}`)
  }
  /* The child's stdin must be closed by construction, not by restraint. */
  assert.match(source, /'ignore'\s*,\s*'pipe'\s*,\s*'pipe'/, "stdin is not 'ignore'")
})

/* ------------------------------------------------------------------
   2. Which programs have a login to start, and what each one runs.
   ------------------------------------------------------------------ */

test('only the two programs with a real login subcommand are offered', () => {
  assert.deepEqual([...LOGIN_PROVIDER_IDS].sort(), ['claude', 'codex'])
})

test('gemini and unknown names are refused in a sentence, never spawned', () => {
  const { service, spawns } = harness()
  for (const wrong of ['gemini', 'nonsense', '', null, undefined, 7]) {
    const answer = service.start(wrong, () => {})
    assert.equal(answer.ok, false)
    assert.equal(answer.code, 'PROVIDER_LOGIN_UNKNOWN')
    assert.ok(answer.reason.length > 0)
  }
  assert.equal(spawns.length, 0)
})

test('codex resolves the npm launcher so the stale-PATH window can never happen', () => {
  const { service, spawns } = harness({ files: [NPM_CODEX_LAUNCHER] })
  const answer = service.start('codex', () => {})
  assert.equal(answer.ok, true)
  assert.equal(spawns.length, 1)
  /* The launcher rides through the seam, which resolves it to the native
     binary exactly as agent sessions already do. */
  assert.equal(spawns[0].command, 'C:/app/ToolsEnabled.exe')
  assert.equal(spawns[0].args[0].replace(/\\/g, '/'), NPM_CODEX_LAUNCHER)
  assert.deepEqual(spawns[0].args.slice(1), ['login'])
  assert.deepEqual(spawns[0].options.stdio, ['ignore', 'pipe', 'pipe'])
})

test('claude resolves the native binary the npm package installs', () => {
  const { service, spawns } = harness({ files: [NPM_CLAUDE_EXE] })
  const answer = service.start('claude', () => {})
  assert.equal(answer.ok, true)
  assert.equal(spawns[0].command.replace(/\\/g, '/'), NPM_CLAUDE_EXE)
  assert.deepEqual(spawns[0].args, ['auth', 'login'])
})

test('without an npm layout the program is found on a FRESH read of PATH', () => {
  const { service, spawns } = harness({
    files: ['C:/somewhere/bin/codex.exe'],
    env: { PATH: 'C:/other;C:/somewhere/bin' },
  })
  const answer = service.start('codex', () => {})
  assert.equal(answer.ok, true)
  /* Case-insensitively, because that is what the filesystem being modelled is:
     the extension comes from PATHEXT, which Windows ships upper-case. */
  assert.equal(spawns[0].command.replace(/\\/g, '/').toLowerCase(), 'c:/somewhere/bin/codex.exe')
})

test('a program that is nowhere is a refusal that names the install, not a spawn error', () => {
  const { service, spawns } = harness()
  const answer = service.start('codex', () => {})
  assert.equal(answer.ok, false)
  assert.equal(answer.code, 'PROVIDER_LOGIN_NOT_INSTALLED')
  assert.match(answer.reason, /install/i)
  assert.equal(spawns.length, 0)
})

test('the environment the child gets is the real one, never a redirected home', () => {
  const { service, spawns } = harness({ files: [NPM_CLAUDE_EXE] })
  service.start('claude', () => {})
  const childEnv = spawns[0].options.env || {}
  /* The program must write its sign-in where it always does. A CLAUDE_CONFIG_DIR
     or CODEX_HOME set here would move a person's credential without their say. */
  assert.ok(!('CLAUDE_CONFIG_DIR' in childEnv && childEnv.CLAUDE_CONFIG_DIR !== undefined) || childEnv.CLAUDE_CONFIG_DIR === process.env.CLAUDE_CONFIG_DIR)
  assert.ok(!('CODEX_HOME' in childEnv && childEnv.CODEX_HOME !== undefined) || childEnv.CODEX_HOME === process.env.CODEX_HOME)
})

/* ------------------------------------------------------------------
   3. One flight per program, and a stop that answers.
   ------------------------------------------------------------------ */

test('a second press while the first still runs is refused, not doubled', () => {
  const { service, spawns } = harness({ files: [NPM_CODEX_LAUNCHER] })
  assert.equal(service.start('codex', () => {}).ok, true)
  const again = service.start('codex', () => {})
  assert.equal(again.ok, false)
  assert.equal(again.code, 'PROVIDER_LOGIN_RUNNING')
  assert.equal(spawns.length, 1)
})

test('stop kills the child and the next start is allowed', () => {
  const { service, child } = harness({ files: [NPM_CODEX_LAUNCHER] })
  service.start('codex', () => {})
  assert.equal(service.stop('codex').stopped, true)
  assert.equal(child.killed, true)
  assert.equal(service.start('codex', () => {}).ok, true)
})

test('an exit frees the flight and reaches the listener with its code', () => {
  const { service, child } = harness({ files: [NPM_CODEX_LAUNCHER] })
  const events = []
  service.start('codex', event => events.push(event))
  child.emit('exit', 0)
  assert.deepEqual(events.at(-1), { kind: 'exit', op: 'login', code: 0 })
  assert.equal(service.start('codex', () => {}).ok, true)
})

/* ------------------------------------------------------------------
   3b. The install, over the same plumbing and under the same rules.
   ------------------------------------------------------------------ */

const NPM_CMD = 'C:/nodejs/npm.CMD'.toLowerCase()

test('install runs the official package command through npm found fresh on PATH', () => {
  const { service, spawns } = harness({
    files: ['C:/nodejs/npm.cmd'],
    env: { PATH: 'C:/nodejs' },
  })
  const answer = service.installStart('codex', () => {})
  assert.equal(answer.ok, true)
  assert.equal(spawns[0].command.replace(/\\/g, '/').toLowerCase(), NPM_CMD)
  assert.deepEqual(spawns[0].args, ['install', '-g', '@openai/codex'])
  assert.deepEqual(spawns[0].options.stdio, ['ignore', 'pipe', 'pipe'])
  const claude = harness({ files: ['C:/nodejs/npm.cmd'], env: { PATH: 'C:/nodejs' } })
  claude.service.installStart('claude', () => {})
  assert.deepEqual(claude.spawns[0].args, ['install', '-g', '@anthropic-ai/claude-code'])
})

test('a machine without npm gets the real fix named, not an npm error', () => {
  const { service, spawns } = harness()
  const answer = service.installStart('codex', () => {})
  assert.equal(answer.ok, false)
  assert.equal(answer.code, 'PROVIDER_LOGIN_NPM_MISSING')
  assert.match(answer.reason, /Node\.js/, 'the refusal does not say where npm comes from')
  assert.equal(spawns.length, 0)
})

test('an install and a login cannot run over each other', () => {
  const { service } = harness({ files: [NPM_CODEX_LAUNCHER, 'C:/nodejs/npm.cmd'], env: { PATH: 'C:/nodejs' } })
  assert.equal(service.installStart('codex', () => {}).ok, true)
  assert.equal(service.start('codex', () => {}).code, 'PROVIDER_LOGIN_RUNNING')
  assert.equal(service.installStart('codex', () => {}).code, 'PROVIDER_LOGIN_RUNNING')
})

test('every event says which kind of flight it came from', () => {
  const { service, child } = harness({ files: ['C:/nodejs/npm.cmd'], env: { PATH: 'C:/nodejs' } })
  const events = []
  service.installStart('codex', event => events.push(event))
  child.stdout.emit('data', Buffer.from('added 1 package\n'))
  child.emit('exit', 0)
  assert.ok(events.every(event => event.op === 'install'), JSON.stringify(events))
})

/* ------------------------------------------------------------------
   4. What a person sees: readable lines, the https line surfaced, a cap.
   ------------------------------------------------------------------ */

test('output arrives as colour-stripped lines and the https line is its own event', () => {
  const { service, child } = harness({ files: [NPM_CODEX_LAUNCHER] })
  const events = []
  service.start('codex', event => events.push(event))
  child.stdout.emit('data', Buffer.from('\u001b[94mhttps://auth.openai.com/codex/device\u001b[0m\nplain words\n'))
  const lines = events.filter(event => event.kind === 'line').map(event => event.text)
  assert.deepEqual(lines, ['https://auth.openai.com/codex/device', 'plain words'])
  const urls = events.filter(event => event.kind === 'url')
  assert.deepEqual(urls, [{ kind: 'url', op: 'login', url: 'https://auth.openai.com/codex/device' }])
  assert.equal(service.lastUrl('codex'), 'https://auth.openai.com/codex/device')
})

test('a prompt with no newline still reaches the person', () => {
  const { service, child } = harness({ files: [NPM_CLAUDE_EXE] })
  const events = []
  service.start('claude', event => events.push(event))
  child.stdout.emit('data', Buffer.from('Paste code here if prompted > '))
  child.emit('exit', 1)
  const lines = events.filter(event => event.kind === 'line').map(event => event.text)
  assert.ok(lines.includes('Paste code here if prompted >'), `flushed on exit, got ${JSON.stringify(lines)}`)
})

test('only https may become a link event; plain http stays a line', () => {
  const { service, child } = harness({ files: [NPM_CODEX_LAUNCHER] })
  const events = []
  service.start('codex', event => events.push(event))
  child.stdout.emit('data', Buffer.from('go to http://localhost:1455 now\n'))
  assert.equal(events.filter(event => event.kind === 'url').length, 0)
  assert.equal(service.lastUrl('codex'), null)
})

test('a flood is capped instead of forwarded forever', () => {
  const { service, child } = harness({ files: [NPM_CODEX_LAUNCHER] })
  const events = []
  service.start('codex', event => events.push(event))
  for (let index = 0; index < 4000; index += 1) {
    child.stdout.emit('data', Buffer.from(`line number ${index} of a very long stream\n`))
  }
  const lines = events.filter(event => event.kind === 'line')
  assert.ok(lines.length < 3000, `forwarded ${lines.length} lines`)
})

/* ------------------------------------------------------------------
   5. The listener never receives what a renderer must not hold.
   ------------------------------------------------------------------ */

test('no event carries a filesystem path field or an environment', () => {
  const { service, child } = harness({ files: [NPM_CODEX_LAUNCHER] })
  const events = []
  service.start('codex', event => events.push(event))
  child.stdout.emit('data', Buffer.from('hello\n'))
  child.emit('exit', 0)
  for (const event of events) {
    assert.deepEqual(Object.keys(event).sort(), event.kind === 'exit' ? ['code', 'kind', 'op'] : (event.kind === 'url' ? ['kind', 'op', 'url'] : ['kind', 'op', 'text']))
  }
})

test('an install log link never becomes the open-the-page control', () => {
  /* npm prints advisory and funding links; "open the sign-in page" pointed at
     one would send a person to a page that signs nobody in. */
  const { service, child } = harness({ files: ['C:/nodejs/npm.cmd'], env: { PATH: 'C:/nodejs' } })
  const events = []
  service.installStart('codex', event => events.push(event))
  child.stdout.emit('data', Buffer.from('found 0 vulnerabilities, see https://npmjs.com/advisories\n'))
  assert.equal(events.filter(event => event.kind === 'url').length, 0)
  assert.equal(service.lastUrl('codex'), null)
})
