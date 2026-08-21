// WHAT A RUNNING CONVERSATION MAY BE SWITCHED TO, AND WHY THE OLD ANSWER LIED.
//
// The "Switch model" rows on a running session (src/views/computers.js
// modelRows()) labelled every Claude row "Claude — cannot start here yet" and
// enabled a row only when `tier.provider === 'codex'`. Both were written when
// Codex was the only engine in the payload. Measured 2026-08-20 against the
// shipped build -- shell/agent-host.cjs startableTiers() constructed over
// release/win-unpacked/resources/capability:
//
//   {"ok":true,"tiers":["luna","terra","sol","claude-fable","claude-sonnet","claude-opus"]}
//
// So "cannot start here yet" is false about this product, on a row that is not
// asking about starting at all: these rows write a PER-TURN model override that
// rides on bridge.send({sessionId, text, model}).
//
// THE PART THAT IS NOT A WORDING BUG. shell/agent-host.cjs narrowTurnOptions()
// gates on the TARGET tier's provider and never on the SESSION's, so on a
// build that starts Claude the one combination it permits for a Claude
// conversation is the cross-provider one -- `gpt-5.6-luna` offered to a Claude
// thread. It would not even fail loudly: claude-cli-adapter.js sendTurn()
// destructures `{ threadId, text, images }` and drops `options` on the floor
// (validateSendTurnRequest does return it), and the model is bound once at
// spawn as `--model` in claudeArgs(). The person would be told "Messages run on
// gpt-5.6-luna" and the turn would run on Claude.
//
// So the rule these assertions pin is: a row is switchable only when it stays
// inside the SESSION'S OWN provider, and only for a provider whose adapter
// really reads a per-turn model. Codex does. Claude does not -- its model is
// fixed at start -- and that is a property of the engine, not a missing
// feature to be papered over with an enabled row that silently does nothing.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LAUNCH_TIERS } from '../../src/orchestration-controls.js'
import { sessionModelChoices } from '../../src/fleet-tree-copy.js'

const byId = (rows, id) => rows.find(row => row.id === id)

test('a Codex conversation may switch between Codex models', () => {
  const rows = sessionModelChoices('luna')
  for (const id of ['luna', 'terra', 'sol']) {
    const row = byId(rows, id)
    assert.ok(row, `${id} row is missing`)
    assert.equal(row.enabled, true, `${id} should be switchable from a Codex conversation`)
    assert.equal(row.disabledHint, '', `${id} should carry no refusal`)
  }
})

test('a Codex conversation is NOT offered Claude models, and the reason is not about starting', () => {
  const rows = sessionModelChoices('luna')
  for (const id of ['claude-fable', 'claude-sonnet', 'claude-opus']) {
    const row = byId(rows, id)
    assert.ok(row, `${id} row is missing`)
    assert.equal(row.enabled, false, `${id} must not be switchable from a Codex conversation`)
    assert.ok(row.disabledHint.length > 0, `${id} must say why`)
    // The whole point: the old words claimed the product could not START
    // Claude. It can. The refusal is about moving a conversation, not about
    // what this copy can launch.
    assert.ok(
      !/cannot start/i.test(row.disabledHint) && !/no launcher/i.test(row.disabledHint),
      `${id} refusal must not claim Claude cannot start here: ${row.disabledHint}`
    )
    assert.ok(/start a new agent/i.test(row.disabledHint), `${id} refusal should name the way through: ${row.disabledHint}`)
  }
})

test('a Claude conversation is NOT offered Codex models — the upside-down case', () => {
  const rows = sessionModelChoices('claude-sonnet')
  for (const id of ['luna', 'terra', 'sol']) {
    const row = byId(rows, id)
    assert.ok(row, `${id} row is missing`)
    assert.equal(row.enabled, false, `${id} must not be offered to a Claude conversation`)
    assert.ok(row.disabledHint.length > 0, `${id} must say why`)
  }
})

test('a Claude conversation cannot change model at all, because its model is bound at spawn', () => {
  const rows = sessionModelChoices('claude-sonnet')
  for (const id of ['claude-fable', 'claude-opus']) {
    const row = byId(rows, id)
    assert.ok(row, `${id} row is missing`)
    assert.equal(row.enabled, false, `${id} is not switchable: claudeArgs() binds --model once at spawn`)
    assert.ok(/fixed|when it start/i.test(row.disabledHint), `${id} should say the model is fixed at start: ${row.disabledHint}`)
  }
})

test('an unrecorded tier is pessimistic rather than guessing a provider', () => {
  for (const tier of [null, undefined, '', 'not-a-tier']) {
    const rows = sessionModelChoices(tier)
    assert.ok(rows.length > 0, 'rows are still drawn so the menu is never empty')
    assert.equal(rows.some(row => row.enabled), false, `an unknown tier (${String(tier)}) must enable nothing`)
  }
})

test('every launchable tier gets a row, so the menu never hides a model that exists', () => {
  const rows = sessionModelChoices('luna')
  assert.equal(rows.length, LAUNCH_TIERS.length)
  for (const tier of LAUNCH_TIERS) {
    const row = byId(rows, tier.id)
    assert.ok(row, `${tier.id} is missing from the menu`)
    assert.equal(row.model, tier.model)
    assert.ok(row.label.includes(tier.label), `${tier.id} label should name the tier: ${row.label}`)
  }
})

test('the local tier is refused for the reason that is actually true of it', () => {
  const row = byId(sessionModelChoices('luna'), 'local')
  assert.equal(row.enabled, false)
  assert.ok(row.disabledHint.length > 0, 'local must say why')
})
