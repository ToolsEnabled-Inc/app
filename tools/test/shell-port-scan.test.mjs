import assert from 'node:assert/strict'
import net from 'node:net'
import test from 'node:test'
import portScan from '../../shell/port-scan.cjs'

const {
  SHELL_HOST,
  SHELL_PORT_MIN,
  SHELL_PORT_MAX,
  SHELL_PORTS,
  listenOnFirstFreePort,
} = portScan

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, SHELL_HOST)
  })
}

function close(server) {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

async function occupy(ports) {
  const servers = []
  try {
    for (const port of ports) {
      const server = net.createServer()
      servers.push(server)
      await listen(server, port)
    }
    return servers
  } catch (error) {
    await Promise.allSettled(servers.map(close))
    throw error
  }
}

async function closeAll(servers) {
  const results = await Promise.allSettled(servers.map(close))
  const failure = results.find((result) => result.status === 'rejected')
  if (failure) throw failure.reason
}

function assertLoopbackBinding(server, expectedPort) {
  const address = server.address()
  assert.notEqual(address, null)
  assert.equal(typeof address, 'object')
  assert.equal(address.address, SHELL_HOST)
  assert.equal(address.port, expectedPort)
}

test('binds 4601 when the range is free', async () => {
  const server = net.createServer()
  try {
    const port = await listenOnFirstFreePort(server, SHELL_PORTS, SHELL_HOST)
    assert.equal(port, SHELL_PORT_MIN)
    assertLoopbackBinding(server, SHELL_PORT_MIN)
  } finally {
    await close(server)
  }
})

test('skips occupied 4601 and binds 4602', async () => {
  const occupied = await occupy([SHELL_PORT_MIN])
  const server = net.createServer()
  try {
    const port = await listenOnFirstFreePort(server, SHELL_PORTS, SHELL_HOST)
    assert.equal(port, SHELL_PORT_MIN + 1)
    assertLoopbackBinding(server, SHELL_PORT_MIN + 1)
  } finally {
    await close(server)
    await closeAll(occupied)
  }
})

test('binds 4609 when 4601 through 4608 are occupied', async () => {
  const portsBeforeLast = SHELL_PORTS.slice(0, -1)
  const occupied = await occupy(portsBeforeLast)
  const server = net.createServer()
  try {
    const port = await listenOnFirstFreePort(server, SHELL_PORTS, SHELL_HOST)
    assert.equal(port, SHELL_PORT_MAX)
    assertLoopbackBinding(server, SHELL_PORT_MAX)
  } finally {
    await close(server)
    await closeAll(occupied)
  }
})

test('reports range exhaustion when all shell ports are occupied', async () => {
  const occupied = await occupy(SHELL_PORTS)
  const server = net.createServer()
  try {
    await assert.rejects(
      listenOnFirstFreePort(server, SHELL_PORTS, SHELL_HOST),
      (error) => {
        assert.equal(error.code, 'SHELL_PORT_RANGE_EXHAUSTED')
        assert.notEqual(error.code, 'EADDRINUSE')
        assert.deepEqual(error.ports, SHELL_PORTS)
        assert.match(error.message, /4601-4609/)
        return true
      },
    )
    assert.equal(server.listening, false)
    assert.equal(server.listenerCount('error'), 0)
  } finally {
    await close(server)
    await closeAll(occupied)
  }
})
