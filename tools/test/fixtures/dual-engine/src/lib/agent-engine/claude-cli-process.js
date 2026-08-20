'use strict'

// Records exactly what the agent host handed the CLAUDE engine, the same way
// the codex fixture beside it does, so a routing test can assert WHICH engine
// a start reached rather than assert that a source file mentions a provider.
const calls = []
const adapterCalls = []

async function startClaudeSession(options) {
  calls.push(options)
  return {
    adapter: {
      sendTurn: async request => { adapterCalls.push({ method: 'sendTurn', request }); return { turnId: 't1' } },
      interrupt: async request => { adapterCalls.push({ method: 'interrupt', request }) },
    },
    threadId: 'claude-thread-1',
    close() {},
  }
}

module.exports = { startClaudeSession, calls, adapterCalls }
