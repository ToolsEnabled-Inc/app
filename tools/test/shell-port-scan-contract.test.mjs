// Independent contract test for shell/port-scan.cjs (R1206 test lane).
//
// Written from the contract only, without reading shell/port-scan.cjs or
// shell/main.cjs. The module's public surface (SHELL_HOST, SHELL_PORT_MIN,
// SHELL_PORT_MAX, SHELL_PORTS, listenOnFirstFreePort) was confirmed by
// requiring the module and inspecting Object.keys()/typeof at a shell prompt
// -- not by reading its source -- because a black-box test still has to know
// how to call the thing it is testing. No behavioural assumption below comes
// from that inspection; only the call signature does.
//
// Every case below drives real sockets on 127.0.0.1 (and, for the foreign
// -host case, the real loopback address 127.0.0.2). Nothing is mocked or
// stubbed.
//
// Contract item -> test map:
//   1) scans inclusive 4601-4609, binds first available -> covered by 2-6
//   2) whole range free -> selects 4601                  -> "contract #2"
//   3) 4601 held -> 4602; general lowest-free-port claim  -> "contract #3"
//   4) 4601-4608 held -> 4609                             -> "contract #4"
//   5) all nine held -> distinguishable typed error,
//      not raw EADDRINUSE, no server left listening       -> "contract #5"
//   6) binds only 127.0.0.1; other hosts rejected          -> "contract #6"
//   7) a non-"address in use" listen error propagates
//      unchanged, is not swallowed into "port busy"        -> "contract #7"
//   8) no Electron dependency, runs under bare Node         -> "contract #8"

import assert from 'node:assert/strict'
import net from 'node:net'
import test, { before } from 'node:test'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import portScan from '../../shell/port-scan.cjs'

const {
  SHELL_HOST,
  SHELL_PORT_MIN,
  SHELL_PORT_MAX,
  SHELL_PORTS,
  listenOnFirstFreePort,
} = portScan

// ---- generic socket helpers (no mocks; every one of these touches a real
// ---- OS socket) -------------------------------------------------------

function occupy(host, port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(port, host, () => {
      server.removeListener('error', reject)
      resolve(server)
    })
  })
}

async function occupyMany(host, ports) {
  const held = []
  for (const port of ports) {
    held.push(await occupy(host, port))
  }
  return held
}

function release(server) {
  if (!server || !server.listening) return Promise.resolve()
  return new Promise((resolve) => server.close(() => resolve()))
}

function releaseAll(servers) {
  return Promise.all(servers.map(release))
}

// Attempts a real client connection; resolves true only if something is
// really accepting connections at host:port.
function probeConnect(host, port, timeoutMs = 300) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

// Runs fn(), uniformly capturing either a synchronous throw or an async
// promise rejection -- the contract does not say which shape the module
// uses, so the test must not assume one.
async function captureRejection(fn) {
  try {
    const value = await fn()
    return { rejected: false, value }
  } catch (error) {
    return { rejected: true, error }
  }
}

// ---- suite hygiene: fail loudly and early if the range is not clean,
// ---- instead of producing a confusing false result deeper in the file.
// ---- (This is a real concern here: another test file in this same
// ---- directory binds this exact port range with real sockets too, and
// ---- `node --test` runs separate files concurrently by default.) -------

before(async () => {
  const busy = []
  for (const port of SHELL_PORTS) {
    try {
      const probe = await occupy(SHELL_HOST, port)
      await release(probe)
    } catch {
      busy.push(port)
    }
  }
  assert.deepEqual(
    busy,
    [],
    `expected the full ${SHELL_PORT_MIN}-${SHELL_PORT_MAX} range to be free ` +
      `before this suite runs; found already busy: ${busy.join(', ') || 'none'}. ` +
      'Another process (possibly a concurrently running sibling port-scan test ' +
      'file) is holding one of these ports.',
  )
})

// ---- contract item 1 (range) --------------------------------------------

test('contract #1: the declared scan range is the inclusive 4601-4609 set', () => {
  assert.equal(SHELL_HOST, '127.0.0.1')
  assert.equal(SHELL_PORT_MIN, 4601)
  assert.equal(SHELL_PORT_MAX, 4609)
  assert.deepEqual(SHELL_PORTS, [4601, 4602, 4603, 4604, 4605, 4606, 4607, 4608, 4609])
})

// ---- contract item 2 -----------------------------------------------------

test('contract #2: with the whole range free, it selects and really binds 4601', async () => {
  const server = net.createServer()
  try {
    const port = await listenOnFirstFreePort(server, SHELL_PORTS, SHELL_HOST)
    assert.equal(port, 4601)
    assert.equal(server.listening, true)
    const address = server.address()
    assert.equal(typeof address, 'object')
    assert.equal(address.address, SHELL_HOST)
    assert.equal(address.port, 4601)

    assert.equal(
      await probeConnect(SHELL_HOST, 4601),
      true,
      'a real client must be able to reach the port the scan says it bound',
    )

    for (const other of SHELL_PORTS.filter((p) => p !== 4601)) {
      assert.equal(
        await probeConnect(SHELL_HOST, other),
        false,
        `port ${other} must be untouched when 4601 was free and selected`,
      )
    }
  } finally {
    await release(server)
  }
})

// ---- contract item 3 (direct case + general "lowest free" claim) --------

test('contract #3: when 4601 is already held, it selects 4602', async () => {
  const blocker = await occupy(SHELL_HOST, 4601)
  const server = net.createServer()
  try {
    const port = await listenOnFirstFreePort(server, SHELL_PORTS, SHELL_HOST)
    assert.equal(port, 4602)
    assert.equal(server.address().port, 4602)
  } finally {
    await release(server)
    await release(blocker)
  }
})

test('contract #3 (general case): it selects the lowest free port, not merely the next one after the last held port', async () => {
  // 4601 and 4603 and 4605 are held, but not 4602 -- a scan that just
  // walked past the highest held port, or resumed after the last hold,
  // would get this wrong. The lowest free port here is 4602.
  const blockers = await occupyMany(SHELL_HOST, [4601, 4603, 4605])
  const server = net.createServer()
  try {
    const port = await listenOnFirstFreePort(server, SHELL_PORTS, SHELL_HOST)
    assert.equal(port, 4602)
  } finally {
    await release(server)
    await releaseAll(blockers)
  }
})

// ---- contract item 4 -------------------------------------------------

test('contract #4: when 4601 through 4608 are all held, it selects 4609', async () => {
  const blockers = await occupyMany(SHELL_HOST, SHELL_PORTS.slice(0, SHELL_PORTS.length - 1))
  const server = net.createServer()
  try {
    const port = await listenOnFirstFreePort(server, SHELL_PORTS, SHELL_HOST)
    assert.equal(port, SHELL_PORT_MAX)
    assert.equal(port, 4609)
  } finally {
    await release(server)
    await releaseAll(blockers)
  }
})

// ---- contract item 5 -------------------------------------------------

test('contract #5: when all nine ports are held, it fails with a distinguishable typed error and leaves no server listening', async () => {
  const blockers = await occupyMany(SHELL_HOST, SHELL_PORTS)
  const server = net.createServer()
  try {
    const outcome = await captureRejection(() => listenOnFirstFreePort(server, SHELL_PORTS, SHELL_HOST))

    assert.equal(outcome.rejected, true, 'exhausting the whole range must fail, not silently succeed')
    const error = outcome.error
    assert.ok(error instanceof Error, 'the failure must be a real Error, not a plain value')

    // "distinguishable ... NOT a raw EADDRINUSE": the error must carry its
    // own identity, and that identity must not just be the underlying
    // socket error passed straight through.
    assert.notEqual(error.code, 'EADDRINUSE', 'exhaustion must not surface as a raw EADDRINUSE')
    const identity = String(error.code || error.name || '')
    assert.notEqual(identity, '', 'the error must expose a distinguishing code or name, not just a message')
    assert.notEqual(identity, 'Error', 'the error must be typed beyond the generic Error name')

    // "identifying range exhaustion": some part of the error's identity or
    // message must actually say so, in the caller's terms, not just "busy".
    const haystack = `${identity} ${error.message || ''}`.toLowerCase()
    assert.match(
      haystack,
      /exhaust|no.*(free|available)|all.*(occupied|held|busy|use)|range/,
      'the error must identify range exhaustion in some recognisable way',
    )

    assert.equal(server.listening, false, 'the server passed in must be left unbound after exhaustion')
  } finally {
    await release(server)
    await releaseAll(blockers)
  }
})

// ---- contract item 6 -------------------------------------------------

test('contract #6: a request to bind a host other than 127.0.0.1 is rejected, not honoured', async () => {
  const foreignHost = '127.0.0.2' // real, distinct loopback address; safe, no external exposure
  const candidatePort = 4601
  const server = net.createServer()
  try {
    const outcome = await captureRejection(() => listenOnFirstFreePort(server, [candidatePort], foreignHost))

    assert.equal(outcome.rejected, true, 'a non-127.0.0.1 host request must be rejected, not silently bound')
    assert.equal(server.listening, false, 'no bind may be left standing after a rejected host request')

    assert.equal(
      await probeConnect(foreignHost, candidatePort),
      false,
      'the foreign host must never actually end up with something listening on it',
    )
    assert.equal(
      await probeConnect(SHELL_HOST, candidatePort),
      false,
      'a rejected foreign-host request must not silently fall back to binding 127.0.0.1 instead',
    )
  } finally {
    await release(server)
  }
})

// ---- contract item 7 -------------------------------------------------

// Finds a TCP port on this Windows host that the OS will really refuse for a
// reason other than "address in use" -- Windows periodically reserves
// blocks of ports for Hyper-V/WinNAT, and binding one of those yields a
// genuine, OS-generated EACCES (or similar) with no privilege elevation and
// no dependency on any other test's state. This is a real socket outcome,
// discovered from the live OS, not a simulated one.
function listExcludedTcpPorts() {
  let output
  try {
    output = execFileSync(
      'netsh',
      ['interface', 'ipv4', 'show', 'excludedportrange', 'protocol=tcp'],
      { encoding: 'utf8' },
    )
  } catch {
    return []
  }
  const ports = []
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)/)
    if (!match) continue
    const start = Number(match[1])
    const end = Number(match[2])
    if (start === end && !SHELL_PORTS.includes(start)) ports.push(start)
  }
  return ports
}

function probeRealListenError(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', (error) => resolve(error.code || null))
    server.once('listening', () => server.close(() => resolve(null)))
    server.listen(port, host)
  })
}

async function findNonEaddrinuseErrorPort(host) {
  for (const port of listExcludedTcpPorts()) {
    const code = await probeRealListenError(host, port)
    if (code && code !== 'EADDRINUSE') return { port, code }
  }
  return null
}

test('contract #7: a real listen error that is not "address in use" propagates unchanged', async (t) => {
  const found = await findNonEaddrinuseErrorPort(SHELL_HOST)
  if (!found) {
    t.skip('no OS-reserved TCP port discovered on this host to force a genuine non-EADDRINUSE listen failure')
    return
  }
  const { port: reservedPort, code: expectedCode } = found
  assert.notEqual(expectedCode, 'EADDRINUSE') // sanity on the probe itself

  const server = net.createServer()
  try {
    const outcome = await captureRejection(() => listenOnFirstFreePort(server, [reservedPort], SHELL_HOST))

    assert.equal(outcome.rejected, true, `a real ${expectedCode} listen failure must not be swallowed into success`)
    const error = outcome.error
    assert.equal(
      error.code,
      expectedCode,
      'a non-EADDRINUSE listen error must propagate with its original code unchanged, not be remapped',
    )
    assert.notEqual(error.code, 'EADDRINUSE')

    const message = String(error.message || '').toLowerCase()
    assert.doesNotMatch(
      message,
      /port.*(busy|exhaust)/,
      'an unrelated listen failure must not be reworded into a "port busy" style message',
    )
  } finally {
    await release(server)
  }
})

// ---- contract item 8 -------------------------------------------------

test('contract #8: the module carries no Electron dependency and runs under bare Node', () => {
  // If port-scan.cjs required Electron and that failed, the top-of-file
  // `import portScan from '../../shell/port-scan.cjs'` would already have
  // thrown before any test in this file could run at all -- so every test
  // above having run is itself part of this evidence.
  assert.equal(typeof process.versions.electron, 'undefined', 'this whole suite must run outside any Electron runtime')

  const require = createRequire(import.meta.url)
  require('../../shell/port-scan.cjs') // idempotent; populates require.cache under this loader
  const pulledInElectron = Object.keys(require.cache).some((key) => /[\\/]electron(?:[\\/]|$)/i.test(key))
  assert.equal(pulledInElectron, false, 'loading the module must not pull an electron package into the module graph')

  assert.equal(typeof listenOnFirstFreePort, 'function')
})
