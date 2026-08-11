'use strict'

// This module intentionally has no Electron dependency. It owns Codex session
// lifecycles; shell/main.cjs is only the IPC boundary around it.
const fs = require('node:fs')
const path = require('node:path')
// capability-layer.cjs is itself Electron-free (node:child_process, node:fs,
// node:path only), so requiring it here preserves the property above.
const { resolveCapabilityRoot } = require('./capability-layer.cjs')

const CLIENT_INFO = Object.freeze({
  name: 'mission-control',
  title: 'Mission Control',
  version: '1.0.0',
})

class AgentHostError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AgentHostError'
    this.code = code
  }
}

function fail(code, message) {
  throw new AgentHostError(code, message)
}

function boundedString(value, label, max, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > max) {
    fail('AGENT_HOST_INVALID_ARGUMENT', `${label} must be ${allowEmpty ? 'a' : 'a non-empty'} string of at most ${max} characters`)
  }
  return value
}

function normalizedModulePath(candidate) {
  const resolved = path.resolve(candidate)
  return path.extname(resolved).toLowerCase() === '.js'
    ? resolved
    : path.join(resolved, 'codex-process.js')
}

// The engine module the payload carries, declared in
// tools/capability-manifest.json under `hostModules`. The path is duplicated
// here because the manifest is a BUILD input and this is a RUNTIME read; the
// same unavoidable duplication shell/setup-record.cjs documents for the setup
// modules. tools/check-asar-manifest.mjs gates every hostModules entry against
// the built payload, so a build that lists this file without shipping it fails
// rather than reaching a customer.
const PAYLOAD_ENGINE_MODULE = 'src/lib/agent-engine/codex-process.js'

function engineCandidates(enginePath, { capabilityRoot = resolveCapabilityRoot() } = {}) {
  // An explicit path is useful to embedders and focused tests.
  //
  // BLOCKER 2 (R1162 non-author review): this used to fall back to a
  // hardcoded path into a private sibling checkout one level above this repo
  // -- unreachable from build.files (`dist/**`, `shell/**`), so it existed on
  // no shipped installation. The chat feature that depended on it was
  // therefore guaranteed dead everywhere it shipped, and the resulting
  // AGENT_ENGINE_UNAVAILABLE failure rendered that internal path into the
  // DOM. Removing it was right. Replacing it with NOTHING was not, and that
  // is what this function did until now.
  //
  // MEASURED 2026-08-10 in the real installed 1.0.5, over CDP:
  //   localStorage['mc.write.agent-session'] -> "enabled"   (the flag was ON)
  //   await window.mcAgent.availability()    -> {ok:false, code:"AGENT_ENGINE_UNAVAILABLE"}
  // A customer has no checkout and no MISSION_CONTROL_ENGINE, and there is no
  // UI anywhere to set one, so with only the two candidates below this could
  // never resolve. "Start an agent from inside Mission Control" was dead on
  // every shipped copy BY CONSTRUCTION -- not misconfigured, and not something
  // onboarding could fix.
  //
  // The fix is the same shape the setup modules already use: ship the engine
  // in the capability payload and resolve it from the root the shell already
  // computes. The environment variable still WINS when set, so a developer
  // pointing at their own checkout keeps getting that checkout rather than the
  // packaged copy -- the same precedence shell/main.cjs applies to
  // MC_BRIDGE_PROOF_FILE.
  if (enginePath !== undefined && enginePath !== null) {
    return [{ source: 'enginePath', value: boundedString(enginePath, 'enginePath', 32_768) }]
  }

  const candidates = []
  if (process.env.MISSION_CONTROL_ENGINE) {
    candidates.push({ source: 'MISSION_CONTROL_ENGINE', value: process.env.MISSION_CONTROL_ENGINE })
  }
  if (capabilityRoot) {
    candidates.push({ source: 'capability-payload', value: path.join(capabilityRoot, PAYLOAD_ENGINE_MODULE) })
  }
  return candidates
}

function loadStartCodexSession(enginePath) {
  const attempts = []
  for (const candidate of engineCandidates(enginePath)) {
    let modulePath
    try {
      modulePath = normalizedModulePath(candidate.value)
    } catch (error) {
      attempts.push(`${candidate.source}: ${String(candidate.value)} (${error.message})`)
      continue
    }

    if (!fs.existsSync(modulePath)) {
      attempts.push(`${candidate.source}: ${modulePath} (not found)`)
      continue
    }

    try {
      const engine = require(modulePath)
      if (!engine || typeof engine.startCodexSession !== 'function') {
        attempts.push(`${candidate.source}: ${modulePath} (does not export startCodexSession())`)
        continue
      }
      return engine.startCodexSession
    } catch (error) {
      attempts.push(`${candidate.source}: ${modulePath} (${error.code || error.name || 'load error'}: ${error.message})`)
    }
  }

  fail(
    'AGENT_ENGINE_UNAVAILABLE',
    attempts.length > 0
      ? `Unable to resolve the real Codex engine. Paths tried:\n- ${attempts.join('\n- ')}`
      : 'Unable to resolve the real Codex engine: no enginePath was passed and MISSION_CONTROL_ENGINE is not set.',
  )
}

/**
 * Resolve the engine WITHOUT starting a session, and report only a bounded
 * code. The resolver's own message names every path it tried; that message is
 * a diagnostic for the main process, never for a renderer, because rendering
 * it is precisely how a private checkout path reached the DOM before
 * (BLOCKER 2). Callers that show this to a person get {ok, code} and nothing
 * else -- there is no path, no message, and no error object to leak.
 *
 * This exists so a spawn surface can be HONEST about its own availability.
 * Without it the only way to learn whether an engine is reachable is to try
 * to start one, which means the UI must offer a control that may be dead --
 * the exact defect the regression gate was written to prevent.
 */
function engineAvailability({ enginePath } = {}) {
  try {
    loadStartCodexSession(enginePath)
    return Object.freeze({ ok: true, code: 'AGENT_ENGINE_READY' })
  } catch (error) {
    return Object.freeze({
      ok: false,
      code: typeof error?.code === 'string' ? error.code : 'AGENT_ENGINE_UNAVAILABLE',
    })
  }
}

function normalizeSessionId(value) {
  return boundedString(value, 'sessionId', 128)
}

function normalizeCwd(value, fallback) {
  const raw = value === undefined ? fallback : boundedString(value, 'cwd', 32_768)
  const resolved = path.resolve(raw)
  let stats
  try {
    stats = fs.statSync(resolved)
  } catch (error) {
    fail('AGENT_HOST_INVALID_CWD', `cwd is not accessible: ${resolved} (${error.code || error.message})`)
  }
  if (!stats.isDirectory()) fail('AGENT_HOST_INVALID_CWD', `cwd is not a directory: ${resolved}`)
  return resolved
}

function validateStartedSession(value) {
  if (!value || typeof value !== 'object') {
    fail('AGENT_ENGINE_INVALID_SESSION', 'startCodexSession() did not return a session object')
  }
  if (!value.adapter || typeof value.adapter.sendTurn !== 'function' || typeof value.adapter.interrupt !== 'function') {
    fail('AGENT_ENGINE_INVALID_SESSION', 'startCodexSession() returned an invalid adapter')
  }
  if (typeof value.threadId !== 'string' || value.threadId.length === 0 || value.threadId.length > 512) {
    fail('AGENT_ENGINE_INVALID_SESSION', 'startCodexSession() returned an invalid threadId')
  }
  if (typeof value.close !== 'function') {
    fail('AGENT_ENGINE_INVALID_SESSION', 'startCodexSession() returned no close() function')
  }
  return value
}

function createAgentHost({ enginePath, defaultCwd = process.cwd() } = {}) {
  const startCodexSession = loadStartCodexSession(enginePath)
  const fallbackCwd = normalizeCwd(defaultCwd, process.cwd())
  const sessions = new Map()
  const listeners = new Set()
  let closed = false

  function emit(session, event) {
    if (sessions.get(session.sessionId) !== session) return

    if (event && event.type === 'turn_completed') {
      if (typeof event.turnId === 'string') {
        if (session.activeTurnId === event.turnId) session.activeTurnId = null
        else if (session.sendPromise) session.completedDuringSend.add(event.turnId)
      } else if (session.activeTurnId) {
        session.activeTurnId = null
      } else if (session.sendPromise) {
        session.completedWithoutTurnId = true
      }
    }

    const packet = Object.freeze({ sessionId: session.sessionId, event })
    for (const listener of [...listeners]) {
      try {
        listener(packet)
      } catch {
        // A renderer/listener bug must not break the engine's stdio reader.
        process.emitWarning('An agent host event listener threw', { code: 'AGENT_HOST_EVENT_LISTENER' })
      }
    }
  }

  async function closeReadySession(session) {
    if (session.closePromise) return session.closePromise
    session.closeRequested = true
    session.state = 'closing'
    const closePromise = (async () => {
      if (session.engineClose) await Promise.resolve(session.engineClose())
      session.state = 'closed'
      if (sessions.get(session.sessionId) === session) sessions.delete(session.sessionId)
    })()
    session.closePromise = closePromise
    try {
      return await closePromise
    } catch (error) {
      // Keep the cleanup handle and map entry so closeSession()/closeAll() can
      // retry instead of reporting success while a child may still be alive.
      if (session.closePromise === closePromise) {
        session.closePromise = null
        session.state = 'close-failed'
      }
      throw error
    }
  }

  function assertOpen() {
    if (closed) fail('AGENT_HOST_CLOSED', 'The agent host is closed')
  }

  function readySession(sessionId) {
    const id = normalizeSessionId(sessionId)
    const session = sessions.get(id)
    if (!session) fail('AGENT_SESSION_UNKNOWN', `Unknown sessionId: ${id}`)
    if (session.state !== 'ready') {
      fail('AGENT_SESSION_NOT_READY', `Session ${id} is ${session.state}`)
    }
    return session
  }

  function startSession({ sessionId, cwd } = {}) {
    assertOpen()
    const id = normalizeSessionId(sessionId)
    if (sessions.has(id)) fail('AGENT_SESSION_EXISTS', `Session already exists: ${id}`)
    const sessionCwd = normalizeCwd(cwd, fallbackCwd)
    const session = {
      sessionId: id,
      cwd: sessionCwd,
      state: 'starting',
      closeRequested: false,
      closePromise: null,
      engineClose: null,
      adapter: null,
      threadId: null,
      activeTurnId: null,
      sendPromise: null,
      completedDuringSend: new Set(),
      completedWithoutTurnId: false,
      startPromise: null,
    }
    // Reserve before the asynchronous engine start so duplicate starts cannot
    // race and leak a second child process.
    sessions.set(id, session)

    session.startPromise = (async () => {
      try {
        const startedValue = await startCodexSession({
          cwd: sessionCwd,
          clientInfo: CLIENT_INFO,
          threadOptions: {},
          onEvent: (event) => emit(session, event),
        })
        // Retain a usable close handle before validating the rest of the
        // contract. A malformed adapter must not strand a spawned child.
        if (startedValue && typeof startedValue === 'object' && typeof startedValue.close === 'function') {
          session.engineClose = startedValue.close
        }
        const started = validateStartedSession(startedValue)
        session.adapter = started.adapter
        session.threadId = started.threadId
        session.engineClose = started.close

        if (closed || session.closeRequested) {
          await closeReadySession(session)
          fail('AGENT_SESSION_START_CANCELLED', `Session closed while starting: ${id}`)
        }

        session.state = 'ready'
        return Object.freeze({ sessionId: id, threadId: session.threadId })
      } catch (error) {
        let cleanupError = null
        if (session.engineClose && session.state !== 'closed') {
          try { await closeReadySession(session) } catch (closeError) { cleanupError = closeError }
        }
        if (cleanupError) {
          const combined = new AggregateError(
            [error, cleanupError],
            `Session ${id} failed to start and its Codex child failed to close`,
          )
          combined.code = 'AGENT_SESSION_CLEANUP_FAILED'
          throw combined
        }
        session.state = session.state === 'closed' ? 'closed' : 'failed'
        if (sessions.get(id) === session) sessions.delete(id)
        throw error
      }
    })()

    return session.startPromise
  }

  async function sendTurn({ sessionId, text } = {}) {
    assertOpen()
    const session = readySession(sessionId)
    const turnText = boundedString(text, 'text', 200_000, { allowEmpty: false })
    if (session.sendPromise || session.activeTurnId) {
      fail('AGENT_TURN_ACTIVE', `Session ${session.sessionId} already has an active turn`)
    }

    session.completedDuringSend.clear()
    session.completedWithoutTurnId = false
    const sendPromise = (async () => {
      const result = await session.adapter.sendTurn({
        threadId: session.threadId,
        text: turnText,
        images: [],
      })
      if (!result || typeof result.turnId !== 'string' || result.turnId.length === 0 || result.turnId.length > 512) {
        fail('AGENT_ENGINE_INVALID_TURN', 'Codex sendTurn() returned an invalid turnId')
      }
      const alreadyCompleted = session.completedWithoutTurnId || session.completedDuringSend.delete(result.turnId)
      session.activeTurnId = alreadyCompleted ? null : result.turnId
      return Object.freeze({
        sessionId: session.sessionId,
        threadId: session.threadId,
        turnId: result.turnId,
      })
    })()
    session.sendPromise = sendPromise

    try {
      return await sendPromise
    } finally {
      if (session.sendPromise === sendPromise) session.sendPromise = null
      session.completedDuringSend.clear()
      session.completedWithoutTurnId = false
    }
  }

  async function interrupt({ sessionId } = {}) {
    assertOpen()
    let session = readySession(sessionId)
    if (session.sendPromise) await session.sendPromise
    session = readySession(sessionId)
    if (!session.activeTurnId) {
      fail('AGENT_TURN_NONE', `Session ${session.sessionId} has no active turn`)
    }
    const turnId = session.activeTurnId
    await session.adapter.interrupt({ threadId: session.threadId, turnId })
    return Object.freeze({ sessionId: session.sessionId, turnId })
  }

  async function closeSession({ sessionId } = {}) {
    const id = normalizeSessionId(sessionId)
    const session = sessions.get(id)
    if (!session) fail('AGENT_SESSION_UNKNOWN', `Unknown sessionId: ${id}`)
    session.closeRequested = true

    if (session.state === 'starting') {
      try { await session.startPromise } catch { /* Retry cleanup below when a close handle remains. */ }
    }
    if (session.state !== 'closed' && session.engineClose) await closeReadySession(session)
    if (sessions.get(id) === session) sessions.delete(id)
    return Object.freeze({ sessionId: id, closed: true })
  }

  function onEvent(listener) {
    assertOpen()
    if (typeof listener !== 'function') fail('AGENT_HOST_INVALID_ARGUMENT', 'onEvent requires a listener function')
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  async function closeAll() {
    if (closed && sessions.size === 0) return
    closed = true
    const pending = [...sessions.values()].map(async (session) => {
      session.closeRequested = true
      if (session.state === 'starting') {
        try { await session.startPromise } catch { /* Startup failure already cleaned itself up. */ }
      }
      if (session.state !== 'closed' && session.engineClose) await closeReadySession(session)
    })
    const results = await Promise.allSettled(pending)
    listeners.clear()
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
    if (failures.length) throw new AggregateError(failures, 'One or more Codex sessions failed to close')
  }

  return Object.freeze({
    startSession,
    sendTurn,
    interrupt,
    closeSession,
    onEvent,
    closeAll,
  })
}

module.exports = { createAgentHost, engineAvailability }
