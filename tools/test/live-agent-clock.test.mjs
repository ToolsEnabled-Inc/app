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
  assert.match(source, /if \(!live \|\| liveRuntime\) \{[\s\S]*epoch: ringEpoch[\s\S]*ringUpdates = !live \|\| liveRuntime\.running/)
})
