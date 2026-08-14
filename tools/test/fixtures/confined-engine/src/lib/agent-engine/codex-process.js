'use strict'

// Records exactly what the agent host handed the engine, so a test can assert
// the RECORDED LEVEL reached the spawn rather than assert that some source file
// mentions it. Starts no process.
const calls = []
const adapterCalls = []

async function startCodexSession(options) {
  calls.push(options)
  return {
    adapter: {
      sendTurn: async request => { adapterCalls.push({ method: 'sendTurn', request }); return { turnId: 't1' } },
      interrupt: async request => { adapterCalls.push({ method: 'interrupt', request }) },
      answerApproval: answer => { adapterCalls.push({ method: 'answerApproval', answer }) },
      forkThread: async (threadId, forkOptions) => {
        adapterCalls.push({ method: 'forkThread', threadId, forkOptions })
        return { threadId: 'thread-forked' }
      },
    },
    threadId: 'thread-1',
    close() {},
  }
}

module.exports = { startCodexSession, calls, adapterCalls }
