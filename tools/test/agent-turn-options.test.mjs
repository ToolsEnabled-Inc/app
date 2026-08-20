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
  /* TWO WRITE SITES SINCE 2026-08-18, AND BOTH ARE PINNED.

     This read `planThreadOptions: plan.threadOptions`, one literal, back when
     there was one plan. There are now two: the session is CONSTRUCTED holding the
     plan built synchronously, and if account switching picks one of the several
     sign-ins a person has, the session is RE-planned onto that account and the
     field is re-pointed at the plan that actually bound the thread.

     Matching only the first would let the second drift; matching only the second
     would allow a session to exist holding no plan at all between construction and
     the re-plan, which is the window a turn must never be sent in. Requiring both
     is a STRICTER pin than the one it replaces, not an accommodation of the change
     that broke it. */
  assert.match(host, /planThreadOptions: basePlan\.threadOptions/,
    'the session is no longer constructed holding the plan it was started under')
  assert.match(host, /session\.planThreadOptions = plan\.threadOptions/,
    'a session re-planned onto a chosen account no longer keeps the plan that actually bound it')
  const send = host.slice(host.indexOf('async function sendTurn'))
  assert.match(send.slice(0, 1200), /narrowTurn\(session\.planThreadOptions, options\)/,
    'per-turn options are no longer narrowed against the SAME plan that bound the thread')
  /* The window grew from 2000 with the first-turn tool-note assembly (the
     introduction block between the turn bookkeeping and the adapter call --
     see "THE INTRODUCTION RIDES THE FIRST TURN" in shell/agent-host.cjs).
     Wider on BOTH assertions, so the negative pin covers at least everything
     the positive one does. */
  assert.match(send.slice(0, 3200), /images: turnImages/, 'picked images no longer reach the adapter')
  assert.ok(!/images: \[\]/.test(send.slice(0, 3200)), 'the images: [] literal is back — the pipe is cut again')
})

test('effort is a start-time property: boundary-validated, tier-defaulted, bound at spawn', () => {
  // Iteration 5 W10, CORRECTED in iteration 7. The spawn flag is real and
  // proven to land (config/read and thread/start both report it back), so
  // every layer of that chain stays pinned -- a control that looks real and
  // is not is the defect the tier comment in main.cjs records. What was
  // WRONG was the claim that the protocol has no effort field: it has two
  // (turn/start's `effort`, and thread/settings/update), and the app now
  // uses the latter so a running agent can change depth without a restart.
  // The values are the provider's own, and the closed set is load-bearing
  // because codex accepts an unknown effort silently -- measured: it took
  // `banana` and echoed it back untouched.
  const mainSource = readFileSync(new URL('../../shell/main.cjs', import.meta.url), 'utf8')
  assert.match(mainSource, /'sessionId', 'cwd', 'surface', 'tier', 'effort'/, 'the start IPC no longer accepts effort')
  assert.match(mainSource, /const AGENT_EFFORT_VALUES = Object\.freeze\(\['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'\]\)/,
    "the boundary's effort set drifted from the provider's own vocabulary")
  assert.match(mainSource, /MC_AGENT_EFFORT_UNKNOWN/, 'the boundary no longer refuses unknown efforts by name')
  const hostSource = readFileSync(new URL('../../shell/agent-host.cjs', import.meta.url), 'utf8')
  assert.match(hostSource, /const EFFORT_KEYS = new Set\(\['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'\]\)/,
    "the host's effort set drifted from the provider's own vocabulary")
  assert.match(hostSource, /async function setSessionEffort/,
    'the host lost the in-place depth change, so the product is back to restarting an agent to think harder')
  assert.match(hostSource, /resolveEffort\(effort, startTier\)/, 'startSession no longer resolves effort against the tier default')
  assert.match(hostSource, /model_reasoning_effort=\$\{sessionEffort\}/, 'the spawn seam no longer binds effort; the dead tier field is dead again')
  assert.match(hostSource, /effort: sessionEffort/, 'the session record no longer keeps the spawned effort')
})
