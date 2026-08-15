import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const require_ = createRequire(import.meta.url)
const ROOT = resolve(import.meta.dirname, '..', '..')
const read = file => readFileSync(resolve(ROOT, file), 'utf8')
const { narrowTurnOptions } = require_(resolve(ROOT, 'shell', 'agent-host.cjs'))

/* C3: the wire widens without the plan losing an inch. The renderer may pick
   a MODEL per turn; everything else it might ask for refuses by name, and the
   plan's approvalPolicy rides over whatever survives. */

const TIERS = Object.freeze({
  luna: { provider: 'codex', model: 'gpt-5.6-luna' },
  terra: { provider: 'codex', model: 'gpt-5.6-terra' },
  'claude-opus': { provider: 'claude', model: 'claude/opus' },
})
const PLAN = Object.freeze({ sandbox: 'read-only', approvalPolicy: 'never' })

test('a codex model rides; the plan re-asserts its policy over it', () => {
  const narrowed = narrowTurnOptions(PLAN, { model: 'gpt-5.6-terra' }, TIERS)
  assert.deepEqual(narrowed, { model: 'gpt-5.6-terra', approvalPolicy: 'never' })
  assert.equal(narrowTurnOptions(PLAN, undefined, TIERS), null, 'no request narrows nothing')
  assert.equal(narrowTurnOptions(PLAN, {}, TIERS), null, 'an empty request narrows nothing')
})

test('the plan-owned axes refuse BY NAME, whatever the value', () => {
  for (const forbidden of [
    { sandbox: 'danger-full-access' },
    { approvalPolicy: 'on-request' },
    { approvalPolicy: 'never' },
    { cwd: 'C:/anywhere' },
    { serviceTier: 'priority' },
    { lastTurnId: 'turn-1' },
  ]) {
    assert.throws(() => narrowTurnOptions(PLAN, forbidden, TIERS),
      error => error.code === 'AGENT_TURN_OPTION_FORBIDDEN',
      `${Object.keys(forbidden)[0]} must refuse by name — even re-stating the plan's own value is not the renderer's sentence to say`)
  }
})

test('a model without a launcher refuses like the start channel does', () => {
  assert.throws(() => narrowTurnOptions(PLAN, { model: 'claude/opus' }, TIERS),
    error => error.code === 'AGENT_TIER_NO_LAUNCHER')
  assert.throws(() => narrowTurnOptions(PLAN, { model: 'gpt-9-imaginary' }, TIERS),
    error => error.code === 'AGENT_TIER_UNKNOWN')
})

test('the send channel takes model and images, and images only from the picker', () => {
  const shell = read('shell/main.cjs')
  assert.match(shell, /agentPayload\(value, \['sessionId', 'text', 'model', 'images'\]\)/,
    'the send allowlist no longer carries the widened fields')
  const send = shell.slice(shell.indexOf(`ipcMain.handle('mc-agent:send'`))
  assert.match(send.slice(0, 1800), /MC_AGENT_ATTACHMENT_UNKNOWN/,
    'an unpicked image path no longer refuses — the renderer could name any file on disk for model context')
  assert.ok(send.slice(0, 1800).indexOf('session.attachments') !== -1,
    'the per-session picker allowlist is not consulted at send')
  for (const channel of ['mc-agent:pick-attachment', 'mc-agent:pick-mention']) {
    const handler = shell.slice(shell.indexOf(`ipcMain.handle('${channel}'`))
    assert.ok(handler.length > 100, `${channel} left the shell`)
    assert.match(handler.slice(0, 400), /assertTrustedAgentSender/, `${channel} skips the sender check`)
  }
  /* The attachment picker ISSUES; the mention picker only returns text. */
  const attach = shell.slice(shell.indexOf(`ipcMain.handle('mc-agent:pick-attachment'`), shell.indexOf(`ipcMain.handle('mc-agent:pick-mention'`))
  assert.match(attach, /session\.attachments/, 'the attachment picker no longer issues to the session allowlist')
  const mention = shell.slice(shell.indexOf(`ipcMain.handle('mc-agent:pick-mention'`))
  assert.ok(!mention.slice(0, 1200).includes('session.attachments'),
    'the mention picker must not issue image rights — a mention is words, not an attachment')
  const preload = read('shell/fleet-profile-preload.cjs')
  assert.match(preload, /pickAttachment/, 'the renderer lost the attachment picker')
  assert.match(preload, /pickMention/, 'the renderer lost the mention picker')
})

test('the host passes images and narrowed options to the adapter, and the plan is per-session state', () => {
  const host = read('shell/agent-host.cjs')
  assert.match(host, /planThreadOptions: plan\.threadOptions/, 'the session no longer keeps the plan it was started under')
  const send = host.slice(host.indexOf('async function sendTurn'))
  assert.match(send.slice(0, 1200), /narrowTurn\(session\.planThreadOptions, options\)/,
    'per-turn options are no longer narrowed against the SAME plan that bound the thread')
  assert.match(send.slice(0, 2000), /images: turnImages/, 'picked images no longer reach the adapter')
  assert.ok(!/images: \[\]/.test(send.slice(0, 2000)), 'the images: [] literal is back — the pipe is cut again')
})

test('effort is a start-time property: boundary-validated, tier-defaulted, bound at spawn', () => {
  // Iteration 5, W10. The codex app-server protocol has no effort field, so
  // effort rides the CLI's own -c flag on the spawn -- and every layer of the
  // chain is pinned, because a control that looks real and is not is the
  // defect the tier comment in main.cjs records.
  const mainSource = readFileSync(new URL('../../shell/main.cjs', import.meta.url), 'utf8')
  assert.match(mainSource, /'sessionId', 'cwd', 'surface', 'tier', 'effort'/, 'the start IPC no longer accepts effort')
  assert.match(mainSource, /MC_AGENT_EFFORT_UNKNOWN/, 'the boundary no longer refuses unknown efforts by name')
  const hostSource = readFileSync(new URL('../../shell/agent-host.cjs', import.meta.url), 'utf8')
  assert.match(hostSource, /const EFFORT_KEYS = new Set\(\['low', 'medium', 'high', 'xhigh'\]\)/, 'the host lost its closed effort set')
  assert.match(hostSource, /resolveEffort\(effort, startTier\)/, 'startSession no longer resolves effort against the tier default')
  assert.match(hostSource, /model_reasoning_effort=\$\{sessionEffort\}/, 'the spawn seam no longer binds effort; the dead tier field is dead again')
  assert.match(hostSource, /effort: sessionEffort/, 'the session record no longer keeps the spawned effort')
})
