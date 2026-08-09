import assert from 'node:assert/strict'
import test from 'node:test'

import { wireSingleInstance } from '../../shell/single-instance.cjs'

test('lock lost quits without registering readiness or starting', () => {
  let quitCalls = 0
  let readyRegistrations = 0
  let startCalls = 0

  const gotLock = wireSingleInstance({
    requestLock: () => false,
    quit: () => { quitCalls += 1 },
    whenReady: () => {
      readyRegistrations += 1
      return Promise.resolve()
    },
    onSecondInstance: () => assert.fail('second-instance handler must not be registered'),
    getWindow: () => null,
    start: () => { startCalls += 1 },
  })

  assert.equal(gotLock, false)
  assert.equal(quitCalls, 1)
  assert.equal(readyRegistrations, 0)
  assert.equal(startCalls, 0)
})

test('lock won starts once when ready resolves', async () => {
  let resolveReady
  const ready = new Promise((resolve) => { resolveReady = resolve })
  let quitCalls = 0
  let startCalls = 0

  const gotLock = wireSingleInstance({
    requestLock: () => true,
    quit: () => { quitCalls += 1 },
    whenReady: () => ready,
    onSecondInstance: () => {},
    getWindow: () => null,
    start: () => { startCalls += 1 },
  })

  assert.equal(gotLock, true)
  assert.equal(quitCalls, 0)
  assert.equal(startCalls, 0)
  resolveReady()
  await ready
  await Promise.resolve()
  assert.equal(startCalls, 1)
})

test('requests the lock before registering readiness', () => {
  const order = []

  wireSingleInstance({
    requestLock: () => { order.push('request-lock'); return true },
    quit: () => {},
    whenReady: () => { order.push('when-ready'); return new Promise(() => {}) },
    onSecondInstance: () => { order.push('second-instance') },
    getWindow: () => null,
    start: () => {},
  })

  assert.equal(order[0], 'request-lock')
  assert.ok(order.indexOf('request-lock') < order.indexOf('when-ready'))
})

test('second instance restores a minimized window, focuses it, and does not restart', () => {
  const calls = []
  let secondInstanceHandler
  let startCalls = 0
  const win = {
    isMinimized: () => true,
    restore: () => { calls.push('restore') },
    focus: () => { calls.push('focus') },
  }

  wireSingleInstance({
    requestLock: () => true,
    quit: () => {},
    whenReady: () => new Promise(() => {}),
    onSecondInstance: (handler) => { secondInstanceHandler = handler },
    getWindow: () => win,
    start: () => { startCalls += 1 },
  })

  assert.equal(typeof secondInstanceHandler, 'function')
  secondInstanceHandler()
  assert.deepEqual(calls, ['restore', 'focus'])
  assert.equal(startCalls, 0)
})
