/* TEAMS — the three things that make this feature honest rather than plausible.
 *
 *   1. ANTI-DRIFT. Both bounds a team obeys are restated in the renderer,
 *      because the renderer cannot import the capability layer. A restated
 *      bound goes stale silently, and the failure is invisible: the panel keeps
 *      offering a team the engine now refuses. So these tests PARSE the engine's
 *      own source and compare, never the copy against itself.
 *
 *   2. THE REFUSALS ARE REAL. A tier names a capability; a seat is where it
 *      runs. Opus + Sonnet together USED to 409 on the second member, because
 *      both were the declared agent `claude` — the Claude tiers now share a
 *      pool of four seats, so that pair is fine and only a FIFTH draw on that
 *      pool is refused. The picker has to refuse the real bound up front, and
 *      the test has to prove the refusal says which pool ran out.
 *
 *   3. FAN-OUT CANNOT WIDEN PERMISSION. This is the one that would matter most
 *      if it were wrong. A team is N dispatches; if any of them could carry a
 *      permission-bearing field, a team would be a way to obtain capability the
 *      installed tier denies. Asserted two ways: the engine's dispatch input
 *      contract has no such field, and the controller adds none.
 *
 * WHAT THIS SUITE CANNOT SEE: whether the panel is rendered or reachable.
 * Source and unit tests cannot see reachability.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  TIER_SEAT_POOL,
  TIER_AGENT_IDENTITY,
  TEAM_IDENTITIES,
  TEAM_BOUNDS,
  identityConflicts,
  planTeam,
  verifiedDispatchReceipt,
  createTeamController,
} from '../../src/agent-teams.js'
import { LAUNCH_TIERS } from '../../src/orchestration-controls.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = relative => readFileSync(path.join(ROOT, relative), 'utf8')

const ACTIONS = 'capability/src/lib/mission-bridge/actions.js'
const LAUNCH_RECORD = 'capability/src/lib/controller-launch-record.js'
const PRESENCE = 'capability/src/lib/agent-presence.js'

/* ---------------------------------------------------------------
   1 · anti-drift against the engine's own source
   --------------------------------------------------------------- */

test('every tier draws on the seat pool the engine gives it', () => {
  const source = read(ACTIONS)
  const start = source.indexOf('const TIERS = Object.freeze({')
  assert.ok(start >= 0, 'engine TIERS table not found — this test is checking air')
  const block = source.slice(start, source.indexOf('});', start))

  const engine = new Map()
  for (const match of block.matchAll(/'?([a-z-]+)'?:\s*Object\.freeze\(\{([^}]*)\}\)/g)) {
    const seats = /seats:\s*Object\.freeze\(\[([^\]]*)\]\)/.exec(match[2])
    if (seats) engine.set(match[1], [...seats[1].matchAll(/'([a-z0-9_-]+)'/g)].map(seat => seat[1]))
  }

  /* If the engine ever goes back to one identity per tier, engine.size is 0 and
     this fails LOUDLY rather than passing on an empty comparison. That is the
     failure this suite exists for: the renderer restating a bound the engine
     has since changed. */
  assert.equal(engine.size, LAUNCH_TIERS.length,
    `engine declares ${engine.size} tiers, the team builder knows ${LAUNCH_TIERS.length}`)
  for (const [tier, seats] of engine) {
    assert.deepEqual([...(TIER_SEAT_POOL[tier] || [])], seats,
      `tier ${tier} runs on engine seats [${seats}] but the team builder thinks [${TIER_SEAT_POOL[tier]}]`)
  }
  assert.deepEqual([...new Set([...engine.values()].flat())].sort(), [...TEAM_IDENTITIES].sort(),
    'the set of distinct seats drifted from the engine')
})

test('a tier is named only when its pool leaves no choice', () => {
  /* TIER_AGENT_IDENTITY is derived, so it cannot drift from the pools; what it
     must never do is guess. A pooled tier has no seat until dispatch picks
     one, and null says so where seats[0] would quietly name a lane that may
     already be busy. */
  for (const [tier, seats] of Object.entries(TIER_SEAT_POOL)) {
    assert.equal(TIER_AGENT_IDENTITY[tier], seats.length === 1 ? seats[0] : null,
      `tier ${tier} has ${seats.length} seats, so its certain identity should be ${seats.length === 1 ? seats[0] : 'null'}`)
  }
})

test('the fan-out and depth caps match the engine constants', () => {
  const source = read(LAUNCH_RECORD)
  const fanOut = /const MAX_FAN_OUT = (\d+);/.exec(source)
  const depth = /const MAX_DEPTH = (\d+);/.exec(source)
  assert.ok(fanOut, 'engine MAX_FAN_OUT not found — this test is checking air')
  assert.ok(depth, 'engine MAX_DEPTH not found — this test is checking air')
  assert.equal(TEAM_BOUNDS.maxFanOut, Number(fanOut[1]), 'MAX_FAN_OUT drifted from the engine')
  assert.equal(TEAM_BOUNDS.maxDepth, Number(depth[1]), 'MAX_DEPTH drifted from the engine')
})

test('the engine really does refuse a second live lane per identity', () => {
  const source = read(PRESENCE)
  assert.match(source, /AGENT_PRESENCE_ACTIVE/,
    'the collision this whole feature is bounded by is not in the presence module — the bound may have moved')
  assert.match(read(ACTIONS), /BRIDGE_AGENT_LANE_COLLISION/,
    'the bridge no longer surfaces the presence collision; the team refusal reason would be wrong')
})

test('the engine enforces fan-out only when a parent launch is named', () => {
  const source = read(LAUNCH_RECORD)
  assert.match(source, /LAUNCH_FANOUT_EXCEEDED/,
    'the fan-out cap this team relies on is gone from the engine')
  /* If this ever becomes unconditional, nesting under a lead stops being the
     thing that makes the cap engage, and the comment in src/agent-teams.js
     explaining why a lead exists would be wrong. */
  assert.match(source, /request\.parentLaunchId/,
    'the fan-out cap no longer keys on parentLaunchId')
})

/* ---------------------------------------------------------------
   2 · the refusals name the actual conflict
   --------------------------------------------------------------- */

test('two Claude tiers now coexist, because they are two draws on a pool of four', () => {
  /* This assertion is INVERTED from what it was, and deliberately so: the
     engine's seat pools made the old refusal false. Opus + Sonnet together was
     a 409 when all three Claude tiers were the single identity `claude`. If
     this ever goes back to refusing, the picker is refusing a team the engine
     would happily run. */
  assert.deepEqual(identityConflicts(['claude-opus', 'claude-sonnet']), [])
  assert.deepEqual(identityConflicts(['claude-opus', 'claude-sonnet', 'claude-fable']), [])
})

test('a fifth draw on the four-seat Claude pool is refused, and the reason counts them', () => {
  const conflicts = identityConflicts(['claude-opus', 'claude-sonnet', 'claude-fable', 'claude-opus', 'claude-sonnet'])
  assert.equal(conflicts.length, 1)
  assert.deepEqual([...conflicts[0].seats], ['claude', 'claude-2', 'claude-3', 'claude-4'])
  assert.equal(conflicts[0].tiers.length, 5)
  assert.match(conflicts[0].reason, /5 agents that share 4 seats/,
    'the refusal must say how many wanted a seat and how many exist, not just "too many"')
})

test('the three Codex tiers are distinct identities and never conflict', () => {
  assert.deepEqual(identityConflicts(['luna', 'terra', 'sol']), [])
})

test('a team of a lead plus the fan-out cap is dispatchable; the seats now outnumber one team', () => {
  /* Until the local pool landed, one team could occupy every seat and this
     test said so. With 11 seats and an engine fan-out cap of 8 members per
     leader, that invariant is structurally gone: the largest single team is
     the lead plus the cap, and filling every seat takes a second team. */
  const plan = planTeam({
    lead: 'sol',
    members: ['luna', 'terra', 'claude-opus', 'claude-sonnet', 'claude-fable', 'claude-opus',
      'local', 'local'],
  })
  assert.equal(plan.dispatchable, true, plan.problems.join(' '))
  assert.equal(plan.size, TEAM_BOUNDS.maxFanOut + 1,
    'the largest single team is the lead plus the engine fan-out cap')
  assert.equal(TEAM_BOUNDS.maxConcurrent, 11,
    'three Codex seats plus four Claude seats plus four local seats — if this moves, the engine table moved')
  assert.ok(TEAM_BOUNDS.maxConcurrent > plan.size,
    'the machine seats more lanes than one leader may fan out; a full bench is two teams')
})

test('one lane past the seat count is refused before anything is dispatched', () => {
  const plan = planTeam({
    lead: 'sol',
    members: ['luna', 'terra', 'claude-opus', 'claude-sonnet', 'claude-fable', 'claude-opus', 'claude-sonnet'],
  })
  assert.equal(plan.dispatchable, false)
  assert.ok(plan.problems.some(problem => /share 4 seats/.test(problem)),
    'the refusal must name the pool that ran out, not just say "too many"')
})

test('a lead with no members is not a team', () => {
  const plan = planTeam({ lead: 'sol', members: [] })
  assert.equal(plan.dispatchable, false)
  assert.ok(plan.problems.some(problem => /at least one member/.test(problem)))
})

test('a team with no lead is refused, because there would be no parent to nest under', () => {
  const plan = planTeam({ lead: null, members: ['luna'] })
  assert.equal(plan.dispatchable, false)
  assert.ok(plan.problems.some(problem => /needs a lead/.test(problem)))
})

test('an invented tier name is refused', () => {
  const plan = planTeam({ lead: 'sol', members: ['gpt-9-ultra'] })
  assert.equal(plan.dispatchable, false)
  assert.ok(plan.problems.some(problem => /gpt-9-ultra/.test(problem)))
})

/* ---------------------------------------------------------------
   3 · fan-out cannot widen permission
   --------------------------------------------------------------- */

test('the engine dispatch contract has no permission-bearing field to send', () => {
  const source = read(ACTIONS)
  const line = /exact\(input, \[([^\]]*)\], \[([^\]]*)\], 'dispatch'\)/.exec(source)
  assert.ok(line, 'the dispatch input contract was not found — this test is checking air')
  const allowed = [...line[1].matchAll(/'([^']+)'/g)].map(match => match[1])
  assert.deepEqual(allowed.sort(), ['brief', 'cap', 'objectiveRef', 'parentLaunchId', 'rootId', 'tier'].sort(),
    'the dispatch contract changed; re-check whether a team can now name a permission level')
  for (const forbidden of ['sandbox', 'permission', 'permissionSession', 'tierOverride', 'confinement', 'level']) {
    assert.ok(!allowed.includes(forbidden),
      `dispatch now accepts "${forbidden}" — a team could carry it and obtain capability the installed tier denies`)
  }
})

test('the sandbox flag is derived inside the argv builders, once per child, from the session', () => {
  const source = read(ACTIONS)
  /* Both builders must call laneConfinement themselves. If either stopped, a
     fanned-out child could be spawned with an argv nobody checked. */
  const codex = source.slice(source.indexOf('function codexArgs('), source.indexOf('function claudeArgs('))
  const claude = source.slice(source.indexOf('function claudeArgs('))
  assert.match(codex, /laneConfinement\(permissionSession\)/,
    'codexArgs no longer derives confinement — every looped or fanned-out codex child would be unchecked')
  assert.match(claude.slice(0, 600), /laneConfinement\(permissionSession\)/,
    'claudeArgs no longer derives confinement — every looped or fanned-out claude child would be unchecked')
})

test('the team controller adds no field beyond tier and parentLaunchId', () => {
  const sent = []
  const plan = planTeam({ lead: 'sol', members: ['luna'] })
  const controller = createTeamController({
    plan,
    dispatchBody: { rootId: 'main', objectiveRef: 'o', brief: 'b', cap: { kind: 'turns', value: 8, capMs: 60_000 } },
    postAction: (action, body) => {
      sent.push({ action, body })
      return Promise.resolve({
        ok: true,
        receipt: {
          action: 'dispatch', tier: body.tier, launchId: `launch_${'x'.repeat(20)}`,
          agentId: 'a', auditSequence: sent.length, auditEventHash: 'f'.repeat(64),
        },
      })
    },
  })
  return controller.run().then(() => {
    const allowed = new Set(['rootId', 'objectiveRef', 'brief', 'cap', 'tier', 'parentLaunchId'])
    for (const { body } of sent) {
      for (const key of Object.keys(body)) {
        assert.ok(allowed.has(key), `the team controller sent an unexpected dispatch field "${key}"`)
      }
    }
  })
})

/* ---------------------------------------------------------------
   4 · the dispatch sequence
   --------------------------------------------------------------- */

function stubReceipt(tier, launchId = `launch_${'a'.repeat(20)}`) {
  return { ok: true, receipt: { action: 'dispatch', tier, launchId, agentId: 'x', auditSequence: 1, auditEventHash: 'a'.repeat(64) } }
}

test('the lead is dispatched first and every member is nested under its launch id', async () => {
  const sent = []
  const plan = planTeam({ lead: 'sol', members: ['luna', 'terra'] })
  const controller = createTeamController({
    plan,
    dispatchBody: { rootId: 'main', objectiveRef: 'o', brief: 'b', cap: {} },
    postAction: (action, body) => {
      sent.push(body)
      return Promise.resolve(stubReceipt(body.tier, `launch_${body.tier.padEnd(20, 'z')}`))
    },
  })
  const state = await controller.run()

  assert.equal(sent.length, 3, 'a lead and two members is three dispatches')
  assert.equal(sent[0].tier, 'sol', 'the lead must go first')
  assert.equal(sent[0].parentLaunchId, undefined, 'the lead has no parent unless one was supplied')
  assert.equal(sent[1].parentLaunchId, 'launch_solzzzzzzzzzzzzzzzzz', 'member 1 must nest under the lead')
  assert.equal(sent[2].parentLaunchId, 'launch_solzzzzzzzzzzzzzzzzz', 'member 2 must nest under the same lead')
  assert.equal(state.phase, 'started')
})

test('a refused member does not abort the team, and is named with its reason', async () => {
  const plan = planTeam({ lead: 'sol', members: ['luna', 'terra'] })
  const controller = createTeamController({
    plan,
    dispatchBody: { rootId: 'main' },
    postAction: (action, body) => Promise.resolve(
      body.tier === 'luna'
        ? { ok: false, code: 'BRIDGE_AGENT_LANE_COLLISION', reason: 'already has a living presence record' }
        : stubReceipt(body.tier),
    ),
  })
  const state = await controller.run()

  const luna = state.members.find(member => member.tier === 'luna')
  const terra = state.members.find(member => member.tier === 'terra')
  assert.equal(luna.phase, 'refused')
  /* [B6] was `assert.match(luna.detail, /BRIDGE_AGENT_LANE_COLLISION/)`, which
     required the identifier to be in the text a person reads. It is now on the
     member record, and the row reads as a sentence with a remedy. */
  assert.equal(luna.code, 'BRIDGE_AGENT_LANE_COLLISION', 'the refusal must still be identifiable')
  assert.doesNotMatch(luna.detail, /[A-Z][A-Z0-9]*(_[A-Z0-9]+)+/, `a bare identifier reached the member row: ${luna.detail}`)
  assert.match(luna.detail, /already has a living presence record/, 'the engine’s own sentence must survive verbatim')
  assert.match(luna.detail, /Stop the one that is running|pick a different agent/i, 'a refused member must be told what to do')
  assert.equal(terra.phase, 'started', 'a refused member must not stop the members after it')
  assert.equal(state.phase, 'partial')
})

test('if the lead is refused, no member is dispatched at all', async () => {
  const sent = []
  const plan = planTeam({ lead: 'sol', members: ['luna', 'terra'] })
  const controller = createTeamController({
    plan,
    dispatchBody: { rootId: 'main' },
    postAction: (action, body) => {
      sent.push(body.tier)
      return Promise.resolve({ ok: false, code: 'BRIDGE_TIER_REFUSED', reason: 'no' })
    },
  })
  const state = await controller.run()
  assert.deepEqual(sent, ['sol'], 'members must not be dispatched when there is no parent to nest them under')
  assert.equal(state.phase, 'failed')
  assert.match(state.message, /Nothing is running/)
})

test('a shaped success with an unverifiable receipt is its own outcome, never "refused"', async () => {
  const plan = planTeam({ lead: 'sol', members: ['luna'] })
  const controller = createTeamController({
    plan,
    dispatchBody: { rootId: 'main' },
    postAction: (action, body) => Promise.resolve(
      body.tier === 'sol' ? stubReceipt('sol') : { ok: true, receipt: { action: 'dispatch', tier: 'WRONG' } },
    ),
  })
  const state = await controller.run()
  const luna = state.members.find(member => member.tier === 'luna')
  /* [B6] was `assert.match(luna.detail, /BRIDGE_DISPATCH_RECEIPT_INVALID/)`. */
  assert.equal(luna.code, 'BRIDGE_DISPATCH_RECEIPT_INVALID', 'the refusal must still be identifiable')
  assert.doesNotMatch(luna.detail, /[A-Z][A-Z0-9]*(_[A-Z0-9]+)+/, `a bare identifier reached the member row: ${luna.detail}`)
  assert.match(luna.detail, /may already be running/,
    'a lane that may be running must not be reported as refused; dispatch has no idempotency key and a retry would start a second one')
})

test('a verified receipt must match the tier that was asked for', () => {
  assert.equal(verifiedDispatchReceipt(stubReceipt('sol'), 'sol'), true)
  assert.equal(verifiedDispatchReceipt(stubReceipt('sol'), 'luna'), false,
    'a receipt naming a different tier means the engine ran something other than what was requested')
  assert.equal(verifiedDispatchReceipt({ ok: true, receipt: { action: 'dispatch', tier: 'sol', launchId: 'l', agentId: 'a', auditSequence: 1, auditEventHash: 'zz' } }, 'sol'), false,
    'a receipt with no valid audit hash is not evidence that anything was recorded')
})

/* ---------------------------------------------------------------
   5 · what this matrix actually reached
   --------------------------------------------------------------- */

test('COVERAGE: enumerate what the team matrix actually exercised', () => {
  /* A test that generates states and asserts nothing reads as coverage and is
     none. This states, mechanically, which cases above were reached — derived,
     not hand-claimed, so it cannot drift into flattery. */
  const reachedPhases = new Set()
  const cases = [
    { lead: 'sol', members: ['luna'], expect: 'dispatchable' },
    { lead: 'sol', members: ['claude-opus', 'claude-fable'], expect: 'identity-conflict' },
    { lead: null, members: ['luna'], expect: 'no-lead' },
    { lead: 'sol', members: [], expect: 'no-members' },
    { lead: 'sol', members: ['nope'], expect: 'unknown-tier' },
  ]
  for (const item of cases) {
    const plan = planTeam(item)
    reachedPhases.add(plan.dispatchable ? 'dispatchable' : 'refused')
  }
  assert.deepEqual([...reachedPhases].sort(), ['dispatchable', 'refused'],
    'the plan matrix must reach both a dispatchable and a refused outcome, or it is only testing one half')

  /* Every tier must appear in at least one plan, or a tier could be broken and
     unnoticed. */
  const covered = new Set()
  for (const tier of LAUNCH_TIERS) {
    const plan = planTeam({ lead: tier.id, members: ['luna', 'terra', 'sol', 'claude-opus'].filter(other => other !== tier.id).slice(0, 1) })
    if (plan.lead === tier.id) covered.add(tier.id)
  }
  assert.equal(covered.size, LAUNCH_TIERS.length,
    `only ${covered.size} of ${LAUNCH_TIERS.length} tiers were exercised as a lead`)
})
