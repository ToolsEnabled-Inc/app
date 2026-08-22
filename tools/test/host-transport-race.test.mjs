/* TWO CALLERS, ONE ANSWER, AND THE ONE THAT ARRIVES SECOND USED TO GUESS.
 *
 * Every page load asks whether this browser can reach the person's machine, and
 * asks it twice: the app's first bridge request, and the data-source resolver
 * choosing relay-versus-mock. The ask is one network handshake to a computer
 * somewhere else, so it takes seconds.
 *
 * The second caller used to read a boolean that meant "somebody has asked",
 * take it for "and the answer was no", and settle the page on the example
 * fleet -- while the machine was mid-handshake and about to say yes. Measured
 * live on 2026-08-22 against a machine that answered two seconds after load:
 * the relay logged the session, the machine logged the web session opening, the
 * console carried no error, and the browser still drew the example.
 *
 * A fresh import per case because the module holds this state for the life of
 * the page, which is exactly what the defect depended on. */
import { test } from 'node:test'
import assert from 'node:assert/strict'

let seq = 0
async function freshBridge() {
  seq += 1
  return import(new URL(`../../src/mission-bridge.js?case=${seq}`, import.meta.url).href)
}

/* A host whose answer takes real time, like the machine it is asking. */
function slowHost({ delayMs = 25, answers = true } = {}) {
  const calls = { count: 0 }
  const shell = {
    getBridgeTransport: async () => {
      calls.count += 1
      await new Promise(resolve => setTimeout(resolve, delayMs))
      return answers ? (() => ({ ok: true })) : null
    },
  }
  return { calls, shell }
}

/* AWAITED, not merely called. The first version of this put the window back in
   a synchronous `finally`, which ran the moment the async body returned its
   promise -- so every case that awaited anything ran the rest of itself with no
   window at all, and one of them failed for a reason that had nothing to do
   with the code under test. */
async function withWindow(shell, body) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'window')
  const previous = globalThis.window
  globalThis.window = { mcShell: shell }
  try { return await body() } finally {
    if (had) globalThis.window = previous
    else delete globalThis.window
  }
}

test('a second asker waits for the answer instead of guessing there is none', async () => {
  const { bridgeTransportAvailable } = await freshBridge()
  const { calls, shell } = slowHost()
  await withWindow(shell, async () => {
    /* Started together, exactly as a page load starts them. */
    const [first, second] = await Promise.all([
      bridgeTransportAvailable(),
      bridgeTransportAvailable(),
    ])
    assert.equal(first, true, 'the first asker must see the machine')
    assert.equal(second, true, 'the second asker must see the SAME machine, not conclude there is none')
  })
  assert.equal(calls.count, 1, 'one handshake, not two')
})

test('a host with no machine still answers no, to everyone', async () => {
  const { bridgeTransportAvailable } = await freshBridge()
  const { shell } = slowHost({ answers: false })
  await withWindow(shell, async () => {
    const [first, second] = await Promise.all([
      bridgeTransportAvailable(),
      bridgeTransportAvailable(),
    ])
    assert.equal(first, false)
    assert.equal(second, false)
  })
})

test('a host that throws is survived by every asker', async () => {
  const { bridgeTransportAvailable } = await freshBridge()
  const shell = { getBridgeTransport: async () => { throw new Error('no machine') } }
  await withWindow(shell, async () => {
    const answers = await Promise.all([
      bridgeTransportAvailable(),
      bridgeTransportAvailable(),
      bridgeTransportAvailable(),
    ])
    assert.deepEqual(answers, [false, false, false])
  })
})

test('a host that offers nothing is not asked twice by a settled page', async () => {
  const { bridgeTransportAvailable } = await freshBridge()
  const { calls, shell } = slowHost({ answers: false })
  await withWindow(shell, async () => {
    await bridgeTransportAvailable()
    await bridgeTransportAvailable()
    assert.equal(calls.count, 1, 'a settled "no" is remembered, as it always was')
  })
})

test('reask asks again once the first answer has landed', async () => {
  const { bridgeTransportAvailable } = await freshBridge()
  const { calls, shell } = slowHost({ answers: false })
  await withWindow(shell, async () => {
    await bridgeTransportAvailable()
    await bridgeTransportAvailable({ reask: true })
    assert.equal(calls.count, 2, 'a sign-in must be able to ask a host that previously had nothing')
  })
})

test('reask during an ask in flight does not start a second handshake', async () => {
  const { bridgeTransportAvailable } = await freshBridge()
  const { calls, shell } = slowHost({ delayMs: 40 })
  await withWindow(shell, async () => {
    const [plain, reasked] = await Promise.all([
      bridgeTransportAvailable(),
      bridgeTransportAvailable({ reask: true }),
    ])
    assert.equal(plain, true)
    assert.equal(reasked, true)
  })
  assert.equal(calls.count, 1, 'two handshakes racing to install one transport is a worse answer than waiting')
})

test('no host at all is still an immediate no', async () => {
  const { bridgeTransportAvailable } = await freshBridge()
  await withWindow({}, async () => {
    assert.equal(await bridgeTransportAvailable(), false)
  })
})
