/* LOOPS — proving the four bounds are real, and that a loop loops and stops.
 *
 * A loop is the one control on this page a person is meant to start and then
 * WALK AWAY from. Everything else here fails in front of someone. That is why
 * this suite spends most of its assertions on the bounds rather than the happy
 * path: an unbounded self-spawning agent loop is a footgun the customer cannot
 * un-fire, and every one of the four bounds is load-bearing.
 *
 *   1. ANTI-DRIFT. The bounds are restated in the renderer because the renderer
 *      cannot import the capability layer. So these tests PARSE the engine's own
 *      source and compare against it — never the copy against itself. A restated
 *      bound that goes stale is invisible: the panel keeps offering a loop the
 *      engine now refuses, or worse, keeps promising a bound the engine no
 *      longer enforces.
 *
 *   2. IT ACTUALLY LOOPS AND ACTUALLY STOPS. A single scheduled run is not a
 *      loop, and a stop that returns "stopped" is not a stop. Both are driven
 *      here through real elapsed intervals on injected timers and asserted by
 *      COUNTING THE DISPATCHES THAT REACHED THE WIRE, not by reading a phase.
 *
 *   3. THE CHILDREN ARE NESTED. This is the bound that makes the engine's
 *      fan-out cap apply at all. If run 2 went out without a parentLaunchId it
 *      would be a depth-0 orphan and the cap would silently not exist — which is
 *      what every dispatch in this product was until 2026-08-11.
 *
 *   4. LOOPING CANNOT WIDEN PERMISSION. The one that would matter most if it
 *      were wrong. A loop is N dispatches; if any could carry a permission-
 *      bearing field, a loop would be a way to obtain capability the installed
 *      tier denies. Asserted two ways: the engine's dispatch contract has no
 *      such field, and the controller adds none.
 *
 * WHAT THIS SUITE CANNOT SEE: whether the panel is rendered or reachable, and
 * whether a real child process is confined. Source and unit tests cannot see
 * reachability, and cannot see a spawned process. Those are proven separately by
 * tools/loop-packaged-proof.mjs (reachability, by clicking) and by the engine
 * suite tests/loop-guided-child-confinement.test.js (the spawned child's argv).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  LOOP_BOUNDS,
  LOOP_OVERRUN,
  LOOP_RUN_CAP,
  clampLoopIntervalMs,
  clampLoopIterations,
  planLoop,
  verifiedLoopReceipt,
  createLoopController,
} from '../../src/agent-loops.js'
import { LAUNCH_TIERS } from '../../src/orchestration-controls.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = relative => readFileSync(path.join(ROOT, relative), 'utf8')

const ACTIONS = 'capability/src/lib/mission-bridge/actions.js'
const LAUNCH_RECORD = 'capability/src/lib/controller-launch-record.js'
const PRESENCE = 'capability/src/lib/agent-presence.js'
const LANE_DISPATCH = 'capability/src/lib/mission-bridge/agent-lane-dispatch.js'
const SCHEDULED_ACTIONS = 'capability/src/lib/scheduled-actions.js'

/* A dispatch receipt the controller will accept. Built by a helper so that a
   test which needs an INVALID one has to say which field it broke. */
let receiptSequence = 0
const goodReceipt = (tier, launchId) => ({
  action: 'dispatch',
  tier,
  launchId,
  agentId: 'luna',
  auditSequence: (receiptSequence += 1),
  auditEventHash: 'a'.repeat(64),
})

/* An injected timer the test drives by hand. `fire()` runs the pending callback,
   which is how a real elapsed interval is simulated without wall clock.
 *
 * A timer fires AT MOST ONCE, like a real setTimeout. The first version of this
 * helper re-fired the most recent timer every call, so `fire()` returned true
 * forever once a loop had finished — the callback was a no-op by then, so the
 * lie was invisible except as a non-terminating drain. A harness that reports
 * work it did not do can only ever manufacture false passes, so this returns
 * false the moment there is genuinely nothing left to fire. */
function manualTimers() {
  const pending = []
  return {
    setTimer(fn, ms) { pending.push({ fn, ms, fired: false, cleared: false }); return pending.length },
    clearTimer(handle) { if (pending[handle - 1]) pending[handle - 1].cleared = true },
    get depth() { return pending.length },
    lastMs() { return pending.length ? pending[pending.length - 1].ms : null },
    cleared(handle) { return Boolean(pending[handle - 1]?.cleared) },
    async fire() {
      const next = pending[pending.length - 1]
      if (!next || next.cleared || next.fired) return false
      next.fired = true
      await next.fn()
      return true
    },
  }
}

/* Records every action that reached the wire, in order, with its full body. */
function recordingPost(responder) {
  const calls = []
  return {
    calls,
    dispatches: () => calls.filter(call => call.action === 'dispatch'),
    post: async (action, body) => {
      calls.push({ action, body })
      return responder(action, body, calls.length)
    },
  }
}

const runnablePlan = (overrides = {}) => planLoop({ tier: 'luna', iterations: 3, intervalMs: 60_000, ...overrides })

/* ---------------------------------------------------------------
   1 · anti-drift against the engine's own source
   --------------------------------------------------------------- */

test('the fan-out and depth bounds match the engine constants', () => {
  const source = read(LAUNCH_RECORD)
  const fanOut = /const MAX_FAN_OUT = (\d+);/.exec(source)
  const depth = /const MAX_DEPTH = (\d+);/.exec(source)
  assert.ok(fanOut, 'engine MAX_FAN_OUT not found — this test is checking air')
  assert.ok(depth, 'engine MAX_DEPTH not found — this test is checking air')
  assert.equal(LOOP_BOUNDS.maxFanOut, Number(fanOut[1]), 'MAX_FAN_OUT drifted from the engine')
  assert.equal(LOOP_BOUNDS.maxDepth, Number(depth[1]), 'MAX_DEPTH drifted from the engine')
})

test('a full loop stays strictly inside the cap the engine would refuse at', () => {
  /* The anchor is run 1 and its children are runs 2..N, so the engine sees
     N-1 siblings. Staying under MAX_FAN_OUT keeps LAUNCH_FANOUT_EXCEEDED a
     backstop that never fires in correct operation. */
  assert.ok(LOOP_BOUNDS.maxIterations - 1 < LOOP_BOUNDS.maxFanOut,
    `a full ${LOOP_BOUNDS.maxIterations}-run loop nests ${LOOP_BOUNDS.maxIterations - 1} children, which the engine cap of ${LOOP_BOUNDS.maxFanOut} must not refuse`)
})

test('the engine still enforces the fan-out cap only when a parent is named', () => {
  /* If this ever stops being true the nesting bound becomes decoration, and the
     comment in agent-loops.js explaining why nesting matters becomes false. */
  const source = read(LAUNCH_RECORD)
  const guard = /if \(request\.parentLaunchId\) \{([\s\S]{0,900}?)\n  \}/.exec(source)
  assert.ok(guard, 'the engine parentLaunchId guard was not found — this test is checking air')
  assert.match(guard[1], /siblings >= MAX_FAN_OUT/, 'the fan-out cap is no longer inside the parent guard')
  assert.match(guard[1], /depth > MAX_DEPTH/, 'the depth cap is no longer inside the parent guard')
})

test('the overrun refusal this loop calls a skip is the code the engine really sends', () => {
  const presence = read(PRESENCE)
  assert.match(presence, /AGENT_PRESENCE_ACTIVE/, 'the presence registry no longer refuses a second live lane')
  const actions = read(ACTIONS)
  const mapping = /if \(code === 'AGENT_PRESENCE_ACTIVE'\) \{([\s\S]{0,400}?)\}/.exec(actions)
  assert.ok(mapping, 'the engine no longer maps AGENT_PRESENCE_ACTIVE — this test is checking air')
  assert.ok(mapping[1].includes(LOOP_OVERRUN.code),
    `the loop treats ${LOOP_OVERRUN.code} as its overrun signal, but the engine maps the collision to something else`)
})

test('the run cap named in the loop copy really does kill the process tree', () => {
  /* Bound 4. The sentence shipped on this page for weeks while the behaviour was
     a bare child.kill(). It is asserted here rather than trusted because a loop
     is the case where an orphaned tree compounds. */
  const source = read(LANE_DISPATCH)
  assert.match(source, /taskkill\.exe/, 'the cap no longer reaches taskkill')
  const killer = /function killLaneTree\(([\s\S]{0,1200}?)\n\}/.exec(source)
  assert.ok(killer, 'killLaneTree not found — this test is checking air')
  assert.match(killer[1], /'\/T'/, 'the cap kill no longer walks the tree (/T)')
  assert.match(killer[1], /'\/F'/, 'the cap kill is no longer forced (/F)')
  /* And it must be wired to the cap timer, not merely defined. */
  assert.match(source, /timeoutState\.timedOut = true;\s*\n\s*killTree\(child, timers\);/,
    'the cap timer no longer calls the tree kill')
})

test('the loop cites addresses that exist, so a reader who checks is not misled', () => {
  for (const citation of [LOOP_OVERRUN.evidence, LOOP_RUN_CAP.evidence]) {
    const [relative, line] = citation.split(':')
    const source = read(relative)
    const lines = source.split('\n')
    assert.ok(Number(line) > 0 && Number(line) <= lines.length,
      `${citation} points past the end of ${relative} (${lines.length} lines)`)
  }
  /* Named separately from mere existence: a citation that lands on a blank line
     is an address that passes a range check and teaches a reader nothing. */
  const [overrunFile, overrunLine] = LOOP_OVERRUN.evidence.split(':')
  assert.match(read(overrunFile).split('\n')[Number(overrunLine) - 1], /AGENT_PRESENCE_ACTIVE/,
    'the overrun citation no longer lands on the refusal it names')
  const [capFile, capLine] = LOOP_RUN_CAP.evidence.split(':')
  assert.match(read(capFile).split('\n')[Number(capLine) - 1], /killLaneTree/,
    'the run-cap citation no longer lands on the tree kill it names')
})

test('the scheduler saga still cannot spawn an agent, which is why this loop is not built on it', () => {
  /* The design note in agent-loops.js rests on this. If an agent-spawn action is
     ever allowlisted, that note is wrong and the loop should be rebuilt on the
     durable scheduler — so this test is the tripwire for that. */
  const source = read(SCHEDULED_ACTIONS)
  const list = /SUPPORTED_SCHEDULED_ACTIONS = Object\.freeze\(\[([\s\S]*?)\]\)/.exec(source)
  assert.ok(list, 'SUPPORTED_SCHEDULED_ACTIONS not found — this test is checking air')
  assert.match(list[1], /telegram\.send/, 'the allowlist is not the list this test thinks it is')
  assert.equal(/dispatch|agent\.(loop|spawn|start)/.test(list[1]), false,
    'an agent-spawn action is now schedulable — rebuild the loop on the durable scheduler and delete this test')
})

/* ---------------------------------------------------------------
   2 · the plan refuses what it cannot honour
   --------------------------------------------------------------- */

test('a runnable plan names its tier, identity and overrun rule', () => {
  const plan = runnablePlan()
  assert.equal(plan.runnable, true, plan.problems.join(' '))
  assert.equal(plan.tier, 'luna')
  assert.equal(plan.identity, 'luna')
  assert.equal(plan.iterations, 3)
  assert.equal(plan.overrun.behaviour, 'skip')
  assert.deepEqual(plan.problems, [])
})

test('a loop longer than the engine admits is refused, naming the engine refusal', () => {
  const plan = planLoop({ tier: 'luna', iterations: 99 })
  assert.equal(plan.runnable, false)
  assert.equal(plan.problems.length > 0, true, 'a refusal with no reason is not a refusal')
  assert.match(plan.problems.join(' '), /LAUNCH_FANOUT_EXCEEDED/)
  assert.equal(plan.iterations, LOOP_BOUNDS.maxIterations, 'the clamped value must still be inside the bound')
})

test('a one-run loop is refused as an ordinary dispatch', () => {
  const plan = planLoop({ tier: 'luna', iterations: 1 })
  assert.equal(plan.runnable, false)
  assert.match(plan.problems.join(' '), /ordinary dispatch/)
})

test('an unknown tier is refused and a known one is not', () => {
  /* Positive first: without it, the negative below would pass on a planner that
     refused everything. */
  assert.equal(planLoop({ tier: LAUNCH_TIERS[0].id, iterations: 2 }).runnable, true)
  const plan = planLoop({ tier: 'not-a-tier', iterations: 2 })
  assert.equal(plan.runnable, false)
  assert.match(plan.problems.join(' '), /not one of/)
})

test('absent is not zero for the interval and the run count', () => {
  for (const absent of [null, undefined, '']) {
    assert.equal(clampLoopIntervalMs(absent), LOOP_BOUNDS.defaultIntervalMs, `${String(absent)} must mean "not chosen", not the floor`)
    assert.equal(clampLoopIterations(absent), LOOP_BOUNDS.maxIterations)
  }
  assert.equal(clampLoopIntervalMs(1), LOOP_BOUNDS.minIntervalMs, 'a chosen too-small value clamps to the floor')
  assert.equal(clampLoopIntervalMs(9e99), LOOP_BOUNDS.maxIntervalMs)
  assert.equal(clampLoopIterations(500), LOOP_BOUNDS.maxIterations)
})

test('the plan states the worst case in the units that matter', () => {
  const plan = runnablePlan()
  assert.equal(Number.isSafeInteger(plan.maxRunMs), true)
  assert.ok(plan.maxRunMs > 0, 'a worst case of zero would be a promise the loop cannot keep')
})

/* ---------------------------------------------------------------
   3 · it actually loops, and it actually stops
   --------------------------------------------------------------- */

test('a loop LOOPS: three runs reach the wire across two elapsed intervals', async () => {
  const timers = manualTimers()
  const wire = recordingPost((action, body) => ({ ok: true, receipt: goodReceipt(body.tier, `launch_${wire.calls.length}`) }))
  const controller = createLoopController({
    plan: runnablePlan(),
    dispatchBody: { rootId: 'r', objectiveRef: 'o', brief: 'b', cap: { kind: 'turns', value: 1, capMs: 60_000 } },
    postAction: wire.post,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })

  await controller.start()
  assert.equal(wire.dispatches().length, 1, 'starting a loop must dispatch immediately, not only after one interval')

  assert.equal(await timers.fire(), true, 'the loop must have armed a timer for the second run')
  assert.equal(wire.dispatches().length, 2, 'one elapsed interval must produce a second run — a single run is not a loop')

  assert.equal(await timers.fire(), true)
  assert.equal(wire.dispatches().length, 3, 'the loop must reach its third run')

  const state = controller.getState()
  assert.equal(state.phase, 'completed')
  assert.equal(state.started, 3)
  assert.equal(state.attempts, 3)
  assert.equal(timers.lastMs(), 60_000, 'the loop must wait the configured interval, not a different one')
})

test('a loop STOPS: after stop, an elapsed interval produces no further run', async () => {
  const timers = manualTimers()
  const wire = recordingPost((action, body) => (action === 'dispatch'
    ? { ok: true, receipt: goodReceipt(body.tier, 'launch_anchor') }
    : { ok: false, code: 'NOTHING_TO_STOP' }))
  const controller = createLoopController({
    plan: runnablePlan({ iterations: 8 }),
    dispatchBody: { rootId: 'r', objectiveRef: 'o', brief: 'b', cap: { kind: 'turns', value: 1, capMs: 60_000 } },
    postAction: wire.post,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })

  await controller.start()
  assert.equal(wire.dispatches().length, 1)
  /* Positive control: the loop is genuinely still going, so the assertion after
     the stop is measuring the stop and not an already-finished loop. */
  assert.equal(controller.getState().phase, 'running')
  assert.equal(controller.getState().stoppable, true, 'a running loop must offer a stop')

  await controller.stop()
  assert.equal(controller.getState().phase, 'stopped')

  const fired = await timers.fire()
  assert.equal(fired, false, 'the pending interval must have been cleared by the stop')
  assert.equal(wire.dispatches().length, 1, 'no run may start after a stop')
})

test('stop is offered exactly while a loop is running and never otherwise', () => {
  const timers = manualTimers()
  const controller = createLoopController({
    plan: runnablePlan(),
    dispatchBody: {},
    postAction: async () => ({ ok: false, code: 'X' }),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })
  assert.equal(controller.getState().stoppable, false, 'an idle loop must not offer a stop')
})

/* ---------------------------------------------------------------
   4 · the children are nested
   --------------------------------------------------------------- */

test('run 1 is the anchor and every later run nests under its launch id', async () => {
  const timers = manualTimers()
  const wire = recordingPost((action, body) => ({ ok: true, receipt: goodReceipt(body.tier, 'launch_ANCHOR') }))
  const controller = createLoopController({
    plan: runnablePlan(),
    dispatchBody: { rootId: 'r', objectiveRef: 'o', brief: 'b', cap: { kind: 'turns', value: 1, capMs: 60_000 } },
    postAction: wire.post,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })

  await controller.start()
  await timers.fire()
  await timers.fire()

  const bodies = wire.dispatches().map(call => call.body)
  assert.equal(bodies.length, 3)
  /* Positive: runs 2 and 3 carry the anchor. Stated before the negative about
     run 1, so the negative is measuring an omission rather than passing on an
     empty list. */
  assert.equal(bodies[1].parentLaunchId, 'launch_ANCHOR', 'run 2 must nest under run 1 or the engine cap does not apply')
  assert.equal(bodies[2].parentLaunchId, 'launch_ANCHOR', 'run 3 must nest under run 1')
  assert.equal(Object.hasOwn(bodies[0], 'parentLaunchId'), false,
    'run 1 is the anchor and must not name a parent; the engine rejects unknown parents')
})

test('the nested body is otherwise identical to the anchor body', async () => {
  const timers = manualTimers()
  const wire = recordingPost((action, body) => ({ ok: true, receipt: goodReceipt(body.tier, 'launch_A') }))
  const dispatchBody = { rootId: 'r', objectiveRef: 'o', brief: 'b', cap: { kind: 'turns', value: 1, capMs: 60_000 } }
  const controller = createLoopController({
    plan: runnablePlan(), dispatchBody, postAction: wire.post,
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  })
  await controller.start()
  await timers.fire()

  const [first, second] = wire.dispatches().map(call => call.body)
  const { parentLaunchId, ...secondRest } = second
  assert.equal(parentLaunchId, 'launch_A')
  assert.deepEqual(secondRest, first,
    'nesting must be the ONLY difference between a loop run and the run before it')
})

/* ---------------------------------------------------------------
   5 · overrun is a skip, and the loop still terminates
   --------------------------------------------------------------- */

test('a collision is reported as a skip, not as a failure', async () => {
  const timers = manualTimers()
  const wire = recordingPost((action, body, index) => (index === 1
    ? { ok: true, receipt: goodReceipt(body.tier, 'launch_A') }
    : { ok: false, code: 'BRIDGE_AGENT_LANE_COLLISION', reason: 'live presence' }))
  const controller = createLoopController({
    plan: runnablePlan(), dispatchBody: {}, postAction: wire.post,
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  })

  await controller.start()
  await timers.fire()

  const state = controller.getState()
  const second = state.runs.find(run => run.index === 2)
  assert.equal(second.phase, 'skipped', 'an overrun must be a skip')
  assert.equal(state.skipped, 1)
  /* Negative, after the positive above: it must not be counted as a refusal, or
     a person would shorten their cap to make the errors stop. */
  assert.equal(second.phase === 'refused', false)
  assert.match(second.detail, /still going/)
})

test('a loop that skips every run after the first still terminates', async () => {
  const timers = manualTimers()
  const wire = recordingPost((action, body, index) => (index === 1
    ? { ok: true, receipt: goodReceipt(body.tier, 'launch_A') }
    : { ok: false, code: 'BRIDGE_AGENT_LANE_COLLISION', reason: 'live presence' }))
  const controller = createLoopController({
    plan: runnablePlan({ iterations: 4 }), dispatchBody: {}, postAction: wire.post,
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  })

  await controller.start()
  let guard = 0
  while (await timers.fire()) { guard += 1; if (guard > 20) break }

  const state = controller.getState()
  assert.equal(state.phase, 'completed', 'a loop that only skips must still end — attempts are the bound, not successes')
  assert.equal(state.attempts, 4)
  assert.equal(state.started, 1)
  assert.equal(state.skipped, 3)
  assert.ok(guard <= 20, 'the loop did not terminate within its attempt bound')
})

test('a genuine refusal is reported as a refusal and does not stop the loop', async () => {
  const timers = manualTimers()
  const wire = recordingPost((action, body, index) => (index === 2
    ? { ok: false, code: 'BRIDGE_ROOT_UNKNOWN', reason: 'no such root' }
    : { ok: true, receipt: goodReceipt(body.tier, 'launch_A') }))
  const controller = createLoopController({
    plan: runnablePlan(), dispatchBody: {}, postAction: wire.post,
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  })

  await controller.start()
  await timers.fire()
  assert.equal(controller.getState().runs.find(run => run.index === 2).phase, 'refused')
  await timers.fire()
  assert.equal(wire.dispatches().length, 3, 'one refused run must not abandon the remaining runs')
})

test('a shaped success with an unverifiable receipt is its own code, never a silent success', async () => {
  const timers = manualTimers()
  const wire = recordingPost(() => ({ ok: true, receipt: { action: 'dispatch', tier: 'luna', launchId: '' } }))
  const controller = createLoopController({
    plan: runnablePlan(), dispatchBody: {}, postAction: wire.post,
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  })
  await controller.start()
  const first = controller.getState().runs.find(run => run.index === 1)
  assert.equal(first.phase, 'refused')
  assert.match(first.detail, /BRIDGE_DISPATCH_RECEIPT_INVALID/)
  assert.equal(controller.getState().started, 0, 'an unverifiable receipt must not count as a started run')
})

test('verifiedLoopReceipt accepts a good receipt and rejects each broken field', () => {
  const good = goodReceipt('luna', 'launch_A')
  assert.equal(verifiedLoopReceipt({ ok: true, receipt: good }, 'luna'), true)
  assert.equal(verifiedLoopReceipt({ ok: true, receipt: good }, 'terra'), false, 'a receipt for another tier must not verify')
  assert.equal(verifiedLoopReceipt({ ok: false, receipt: good }, 'luna'), false)
  assert.equal(verifiedLoopReceipt({ ok: true, receipt: { ...good, launchId: '' } }, 'luna'), false)
  assert.equal(verifiedLoopReceipt({ ok: true, receipt: { ...good, auditEventHash: 'short' } }, 'luna'), false)
  assert.equal(verifiedLoopReceipt({ ok: true, receipt: { ...good, auditSequence: 0 } }, 'luna'), false)
})

/* ---------------------------------------------------------------
   6 · the stop tells the truth about what it did
   --------------------------------------------------------------- */

test('stop terminates the run in flight with the observed run id and pid', async () => {
  const timers = manualTimers()
  const wire = recordingPost((action, body) => (action === 'dispatch'
    ? { ok: true, receipt: goodReceipt(body.tier, 'launch_A') }
    : {
      ok: true,
      receipt: {
        action: 'terminate',
        idempotencyKey: body.idempotencyKey,
        agentId: body.agentId,
        runId: body.expectedRunId,
        pid: body.expectedPid,
        verifiedGone: true,
        terminalStatus: 'failed',
      },
    }))
  const controller = createLoopController({
    plan: runnablePlan({ iterations: 8 }), dispatchBody: {}, postAction: wire.post,
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    observeLiveTarget: async () => ({ agentId: 'luna', runId: 'run_7', pid: 4242, status: 'running' }),
    createIdempotencyKey: () => 'key-1',
  })

  await controller.start()
  await controller.stop()

  const terminate = wire.calls.find(call => call.action === 'terminate')
  assert.ok(terminate, 'stop must send a terminate when a run is observed in flight')
  assert.deepEqual(terminate.body, { idempotencyKey: 'key-1', agentId: 'luna', expectedRunId: 'run_7', expectedPid: 4242 })

  const state = controller.getState()
  assert.equal(state.stopReport.terminated, true)
  assert.equal(state.stopReport.scheduleStopped, true)
  assert.match(state.message, /PID 4242 is gone/)
})

test('stop with nothing in flight stops the schedule and does NOT claim a kill', async () => {
  const timers = manualTimers()
  const wire = recordingPost((action, body) => ({ ok: true, receipt: goodReceipt(body.tier, 'launch_A') }))
  const controller = createLoopController({
    plan: runnablePlan({ iterations: 8 }), dispatchBody: {}, postAction: wire.post,
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    observeLiveTarget: async () => null,
  })

  await controller.start()
  await controller.stop()

  const state = controller.getState()
  assert.equal(state.stopReport.scheduleStopped, true, 'the schedule always stops')
  /* Positive above, negative here: it must not say it terminated something. */
  assert.equal(state.stopReport.terminated, false)
  assert.equal(wire.calls.some(call => call.action === 'terminate'), false, 'no terminate may be sent with no target')
  assert.match(state.message, /No run was observed in flight/)
})

test('an unverified terminate is reported as NOT stopped, and still names the remaining bound', async () => {
  const timers = manualTimers()
  const wire = recordingPost((action, body) => (action === 'dispatch'
    ? { ok: true, receipt: goodReceipt(body.tier, 'launch_A') }
    : { ok: false, code: 'BRIDGE_TERMINATE_STALE_PID', reason: 'pid moved on' }))
  const controller = createLoopController({
    plan: runnablePlan({ iterations: 8 }), dispatchBody: {}, postAction: wire.post,
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    observeLiveTarget: async () => ({ agentId: 'luna', runId: 'run_7', pid: 4242, status: 'running' }),
    createIdempotencyKey: () => 'key-1',
  })

  await controller.start()
  await controller.stop()

  const state = controller.getState()
  assert.equal(state.stopReport.terminated, false, 'an unverified terminate must never read as a stop')
  assert.match(state.message, /NOT confirmed stopped/)
  assert.match(state.message, /BRIDGE_TERMINATE_STALE_PID/)
  /* The schedule still stopped, which is the promise that CAN always be kept. */
  assert.equal(state.stopReport.scheduleStopped, true)
})

test('a terminate is never sent for a target that is not observably running', async () => {
  for (const target of [
    { agentId: 'luna', runId: 'run_7', pid: 4242, status: 'finished' },
    { agentId: 'luna', runId: 'run_7', pid: 0, status: 'running' },
    { agentId: 'luna', runId: '', pid: 4242, status: 'running' },
  ]) {
    const timers = manualTimers()
    const wire = recordingPost((action, body) => ({ ok: true, receipt: goodReceipt(body.tier, 'launch_A') }))
    const controller = createLoopController({
      plan: runnablePlan({ iterations: 8 }), dispatchBody: {}, postAction: wire.post,
      setTimer: timers.setTimer, clearTimer: timers.clearTimer,
      observeLiveTarget: async () => target,
    })
    await controller.start()
    await controller.stop()
    assert.equal(wire.calls.some(call => call.action === 'terminate'), false,
      `a terminate must not be sent for ${JSON.stringify(target)}`)
    assert.equal(controller.getState().stopReport.terminated, false)
  }
})

test('an observation that throws still stops the schedule', async () => {
  const timers = manualTimers()
  const wire = recordingPost((action, body) => ({ ok: true, receipt: goodReceipt(body.tier, 'launch_A') }))
  const controller = createLoopController({
    plan: runnablePlan({ iterations: 8 }), dispatchBody: {}, postAction: wire.post,
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    observeLiveTarget: async () => { throw new Error('projection unreachable') },
  })
  await controller.start()
  await controller.stop()
  assert.equal(controller.getState().phase, 'stopped')
  assert.equal(controller.getState().stopReport.scheduleStopped, true)
})

/* ---------------------------------------------------------------
   7 · looping cannot widen permission
   --------------------------------------------------------------- */

test('the engine dispatch contract has no permission-bearing field for a loop to set', () => {
  const source = read(ACTIONS)
  const contract = /exact\(input, \[([^\]]*)\], \[([^\]]*)\], 'dispatch'\)/.exec(source)
  assert.ok(contract, 'the engine dispatch contract was not found — this test is checking air')
  const allowed = contract[1].split(',').map(part => part.trim().replace(/'/g, ''))
  assert.ok(allowed.includes('parentLaunchId'), 'nesting is no longer accepted by the engine')
  assert.ok(allowed.includes('tier'), 'the contract is not the one this test thinks it is')
  for (const forbidden of ['permissionSession', 'sandbox', 'profile', 'tierOverride', 'confinement', 'allowedTools']) {
    assert.equal(allowed.includes(forbidden), false,
      `the dispatch contract now accepts "${forbidden}", which a loop could use to widen permission`)
  }
})

test('the controller sends only contract fields, and adds nothing of its own', async () => {
  const timers = manualTimers()
  const wire = recordingPost((action, body) => ({ ok: true, receipt: goodReceipt(body.tier, 'launch_A') }))
  const controller = createLoopController({
    plan: runnablePlan(),
    dispatchBody: { rootId: 'r', objectiveRef: 'o', brief: 'b', cap: { kind: 'turns', value: 1, capMs: 60_000 } },
    postAction: wire.post, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  })
  await controller.start()
  await timers.fire()

  const allowed = new Set(['rootId', 'tier', 'objectiveRef', 'brief', 'cap', 'parentLaunchId'])
  for (const call of wire.dispatches()) {
    for (const key of Object.keys(call.body)) {
      assert.ok(allowed.has(key), `the loop sent "${key}", which is not in the engine dispatch contract`)
    }
  }
  assert.equal(wire.dispatches().length, 2, 'this check must have inspected real dispatches, not an empty list')
})

test('destroy clears the pending interval so a destroyed loop cannot fire again', async () => {
  const timers = manualTimers()
  const wire = recordingPost((action, body) => ({ ok: true, receipt: goodReceipt(body.tier, 'launch_A') }))
  const controller = createLoopController({
    plan: runnablePlan({ iterations: 8 }), dispatchBody: {}, postAction: wire.post,
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  })
  await controller.start()
  assert.equal(wire.dispatches().length, 1)
  controller.destroy()
  assert.equal(await timers.fire(), false, 'a destroyed loop must not have a live timer')
  assert.equal(wire.dispatches().length, 1)
})
