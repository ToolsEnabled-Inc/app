import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const AGENT_SOURCE = new URL('../../src/views/agent.js', import.meta.url)

function loadRuntimeSource() {
  const source = readFileSync(AGENT_SOURCE, 'utf8')
  const match = source.match(/export function liveAgentRuntimeSource\([\s\S]*?^\}/m)
  assert.ok(match, 'agent view must expose its live runtime source normalizer')
  const runtime = Function(`${match[0].replace(/^export /, '')}\nreturn liveAgentRuntimeSource`)()
  return { runtime, source }
}

function loadRingAppender() {
  const source = readFileSync(AGENT_SOURCE, 'utf8')
  const match = source.match(/export function appendAgentRingNode\([\s\S]*?^\}/m)
  assert.ok(match, 'agent view must expose its guarded runtime-ring appender')
  const append = Function(`${match[0].replace(/^export /, '')}\nreturn appendAgentRingNode`)()
  return { append, source }
}

test('live agent runtime advances, freezes, and stays unavailable without epochs', () => {
  const { runtime, source } = loadRuntimeSource()
  const bornAt = 1_000

  assert.deepEqual(runtime({ bornAt }, 6_000), {
    bornAt,
    stoppedAt: null,
    elapsedMs: 5_000,
    running: true,
  })
  assert.deepEqual(runtime({ bornAt }, 9_000), {
    bornAt,
    stoppedAt: null,
    elapsedMs: 8_000,
    running: true,
  })
  assert.deepEqual(runtime({ bornAt, stoppedAt: 5_000 }, 6_000), {
    bornAt,
    stoppedAt: 5_000,
    elapsedMs: 4_000,
    running: false,
  })
  assert.deepEqual(runtime({ bornAt, stoppedAt: 5_000 }, 90_000), {
    bornAt,
    stoppedAt: 5_000,
    elapsedMs: 4_000,
    running: false,
  })
  assert.equal(runtime({ stoppedAt: 5_000 }, 6_000), null)
  assert.equal(runtime({ bornAt, controlTarget: { status: 'finished' } }, 6_000), null)
  assert.deepEqual(runtime({ bornAt, stoppedAt: '5_000' }, 6_000), {
    bornAt,
    stoppedAt: null,
    elapsedMs: 5_000,
    running: true,
  })
  assert.match(source, /const runtime = liveAgentRuntimeSource\(declaredAgent\)/)
  /* RE-AIMED with the one-render cutover. This pinned `if (!live || liveRuntime)`
     -- the shape in which the old simulated render skipped the normalizer,
     because the simulator's agents were always running. Every source now feeds
     the same projection (the mock included, and the mock has a seat that never
     started and a lane that ran and stopped), so the ring answers to the
     normalizer alone: no epochs, no ring; a finite stop freezes it. The fact
     being fenced is unchanged -- the ring's epoch and its updating both come
     from liveAgentRuntimeSource's verdict, never from a raw field. */
  assert.match(source, /if \(agentRuntime\) \{[\s\S]*epoch: ringEpoch[\s\S]*ringUpdates = agentRuntime\.running/)
})

test('live rail rebuild restores the runtime-ring mount and contains bad appends', () => {
  const { append, source } = loadRingAppender()
  const railChildren = [{ stale: true }]
  const ringChildren = []
  const rail = {
    replaceChildren() { railChildren.length = 0 },
    appendChild(child) { railChildren.push(child) },
  }
  const mount = { appendChild(child) { ringChildren.push(child) } }
  const ring = { kind: 'runtime-ring' }

  rail.replaceChildren()
  assert.equal(append(rail, mount), true)
  assert.deepEqual(railChildren, [mount])
  assert.equal(append(mount, ring), true)
  assert.deepEqual(ringChildren, [ring])

  const missingMount = { querySelector() { return null } }.querySelector('.agent-ring-wrap')
  assert.throws(
    () => missingMount.appendChild(ring),
    { name: 'TypeError', message: /appendChild/ },
    'the baseline direct append crashes on the destroyed mount',
  )
  assert.equal(append(missingMount, ring), false)

  let corruptAttempts = 0
  const corruptMount = {
    appendChild() {
      corruptAttempts += 1
      throw new TypeError('corrupt mount')
    },
  }
  assert.equal(append(corruptMount, ring), false)
  assert.equal(corruptAttempts, 1)

  assert.match(source, /runtimeRingMount = el\('<div class="agent-ring-wrap"><\/div>'\)/)
  assert.match(source, /appendAgentRingNode\(rail, runtimeRingMount\)/)
  assert.match(source, /appendAgentRingNode\(runtimeRingMount, ring\.el\)/)
})
