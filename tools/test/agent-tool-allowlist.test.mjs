/* The tool checkboxes, and the allowlist they actually become.
 *
 * The owner's settings doctrine: a user setting needs a real control, real
 * persistence and real enforcement, or it is a lie. This suite pins all three
 * links for the research page's tool switches:
 *
 *   1. the LIST the checkboxes render comes from the real engine registry at
 *      the really-recorded tier (listAgentTools, run for real below);
 *   2. the SPAWN composes TOOLSENABLED_TOOL_ALLOWLIST from the same persisted
 *      row at the one place every agent child's environment is built;
 *   3. the two states that must refuse a start rather than widen it -- an
 *      unreadable row and an every-tool-disabled row -- have codes and copy.
 *
 * The engine reads an EMPTY allowlist string as the FULL profile (its own
 * registry comment calls that inversion out), which is why all-disabled must
 * never reach the spawn as an env var.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(import.meta.url)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PAYLOAD = path.join(REPO, 'capability')
const read = file => readFileSync(path.join(REPO, file), 'utf8')

const machineRecord = require_(path.join(PAYLOAD, 'src', 'lib', 'setup', 'machine-record.js'))
const { listAgentTools } = require_(path.join(REPO, 'shell', 'agent-confinement-read.cjs'))

/* The engine's own selector rule, copied as a literal on purpose: if the
   registry ever renames tools into a shape its own parser refuses, this suite
   must fail before a composed allowlist starts failing sessions. */
const ENGINE_TOOL_SELECTOR = /^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/

function stageRecord(scratch, tier) {
  const servicesRoot = path.join(scratch, `svc-${tier}`)
  const workspace = path.join(scratch, `ws-${tier}`)
  mkdirSync(servicesRoot, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  const record = machineRecord.buildMachineRecord({
    tier,
    servicesRoot,
    installRoot: PAYLOAD,
    nodePath: process.execPath,
    workspaceRoots: [workspace],
  })
  machineRecord.writeMachineRecord(record, { servicesRoot })
  return servicesRoot
}

test('the tool list is the real registry, sorted, in the shape the engine parses', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'mc-tools-list-'))
  const servicesRoot = stageRecord(scratch, 'unrestricted')
  const listed = listAgentTools({ capabilityRoot: PAYLOAD, servicesRoot })
  assert.equal(listed.ok, true)
  assert.equal(listed.tier, 'unrestricted')
  assert.ok(listed.total > 50, `a real registry has a real surface; got ${listed.total}`)
  assert.equal(listed.tools.length, listed.total)
  const names = listed.tools.map(tool => tool.name)
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), 'the list is sorted for a stable checkbox page')
  for (const name of names) {
    assert.match(name, ENGINE_TOOL_SELECTOR, `${name} would be refused by the engine's own allowlist parser`)
  }
  assert.ok(listed.tools.every(tool => tool.allowed === true),
    'unrestricted narrows nothing, so every tool must read allowed')
})

test('a confined tier marks withheld tools, and never by guessing', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'mc-tools-tier-'))
  const servicesRoot = stageRecord(scratch, 'guided')
  const listed = listAgentTools({ capabilityRoot: PAYLOAD, servicesRoot })
  assert.equal(listed.ok, true)
  assert.equal(listed.tier, 'guided')
  const allowed = listed.tools.filter(tool => tool.allowed).length
  assert.ok(allowed > 0, 'guided still carries tools')
  assert.ok(allowed < listed.total, 'guided narrows; a full count here means the tier reading is fake')
})

test('an unreadable payload answers a code, never a guess and never a path', () => {
  const listed = listAgentTools({ capabilityRoot: path.join(tmpdir(), 'mc-no-such-payload') })
  assert.equal(listed.ok, false)
  assert.equal(typeof listed.code, 'string')
  assert.equal(Object.keys(listed).sort().join(','), 'code,ok', 'a failure carries the code and nothing else')
})

/* ---------- the enforcement seam, pinned in source ----------
   main.cjs runs only under Electron, so its composition is pinned by shape:
   what matters is WHERE it runs (the one env chokepoint) and WHICH states
   refuse. The engine-side enforcement itself is the payload's own code. */

test('the spawn composes the allowlist at the environment chokepoint, and refusals refuse', () => {
  const shell = read('shell/main.cjs')
  assert.match(shell, /sessionEnvironmentExtras: agentToolAllowlistExtras/,
    'the composer is no longer wired into the agent host — the checkboxes changed nothing')
  const composer = shell.slice(shell.indexOf('function agentToolAllowlistExtras'))
  assert.match(composer.slice(0, 1600), /AGENT_TOOLS_ALL_DISABLED/,
    'all-disabled no longer refuses — an empty allowlist string means FULL profile to the engine')
  assert.match(composer.slice(0, 1600), /AGENT_TOOL_LIMITS_UNREADABLE/,
    'an unreadable row no longer refuses — a session would start wider than the person chose')
  assert.match(composer.slice(0, 1600), /ACCOUNT_NOT_SIGNED_IN/,
    'signed-out must read as narrow-nothing, not as an error that blocks every start')
  const host = read('shell/agent-host.cjs')
  assert.match(host, /extras: envExtras/, 'the extras never reach sessionLaunchEnvironment')
  assert.ok(host.indexOf('...(extras || {})') < host.indexOf('...(plan.env || {})'),
    'the plan must layer OVER the extras — a settings row must not override confinement')
  const tools = read('shell/fleet-profile-preload.cjs')
  assert.match(tools, /mc-agent:tools/, 'the renderer lost its read of the tool list')
  const handler = shell.slice(shell.indexOf(`ipcMain.handle('mc-agent:tools'`))
  assert.match(handler.slice(0, 300), /assertTrustedAgentSender/, 'the tools channel skips the sender check')
})

test('the drawer control persists the same row the spawn reads', () => {
  const drawer = read('src/quick-settings.js')
  const shell = read('shell/main.cjs')
  assert.match(drawer, /agent_tools_disabled/, 'the drawer lost the settings row')
  assert.match(shell, /'agent_tools_disabled'/, 'the shell lost the settings row')
  assert.match(drawer, /data-tools-all-on/, 'the enable-all control is gone')
  assert.match(drawer, /data-tools-all-off/, 'the disable-all control is gone')
  assert.match(drawer, /putSetting\(TOOLS_DISABLED_KEY/, 'the checkboxes no longer persist anything')
  /* Copy: both refusal codes own sentences that name a next move. */
  const copy = read('src/agent-availability-copy.js')
  assert.match(copy, /AGENT_TOOL_LIMITS_UNREADABLE:/, 'the unreadable-limits refusal has no sentence')
  assert.match(copy, /AGENT_TOOLS_ALL_DISABLED:/, 'the all-disabled refusal has no sentence')
})
