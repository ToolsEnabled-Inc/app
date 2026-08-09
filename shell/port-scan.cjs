const SHELL_HOST = '127.0.0.1'
const SHELL_PORT_MIN = 4601
const SHELL_PORT_MAX = 4609
const SHELL_PORTS = Object.freeze(
  Array.from(
    { length: SHELL_PORT_MAX - SHELL_PORT_MIN + 1 },
    (_, index) => SHELL_PORT_MIN + index,
  ),
)

const RETRYABLE_LISTEN_ERRORS = new Set(['EADDRINUSE', 'EACCES'])

function listenOnce(server, port, host) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.removeListener('error', onError)
      server.removeListener('listening', onListening)
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const onListening = () => {
      cleanup()
      resolve()
    }

    server.once('error', onError)
    server.once('listening', onListening)
    try {
      server.listen(port, host)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

function closeFailedAttempt(server) {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve) => server.close(() => resolve()))
}

function describePorts(ports) {
  if (ports.length === 0) return '(none)'
  const contiguous = ports.every((port, index) => index === 0 || port === ports[index - 1] + 1)
  return contiguous && ports.length > 1
    ? `${ports[0]}-${ports[ports.length - 1]}`
    : ports.join(', ')
}

async function listenOnFirstFreePort(server, ports = SHELL_PORTS, host = SHELL_HOST) {
  if (host !== SHELL_HOST) {
    throw new TypeError(`Shell server must bind to ${SHELL_HOST}`)
  }

  const attemptedPorts = []
  const failures = []
  let lastError
  for (const port of ports) {
    attemptedPorts.push(port)
    try {
      await listenOnce(server, port, host)
      return port
    } catch (error) {
      await closeFailedAttempt(server)
      if (!error || !RETRYABLE_LISTEN_ERRORS.has(error.code)) throw error
      failures.push(Object.freeze({ port, code: error.code, message: error.message }))
      lastError = error
    }
  }

  const error = new Error(
    `No shell port is available on ${host}; attempted ${describePorts(attemptedPorts)}`,
    { cause: lastError },
  )
  error.code = 'SHELL_PORT_RANGE_EXHAUSTED'
  error.host = host
  error.ports = Object.freeze([...attemptedPorts])
  error.failures = Object.freeze([...failures])
  throw error
}

module.exports = {
  SHELL_HOST,
  SHELL_PORT_MIN,
  SHELL_PORT_MAX,
  SHELL_PORTS,
  listenOnFirstFreePort,
}
