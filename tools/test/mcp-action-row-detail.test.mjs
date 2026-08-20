/* AN MCP TOOL CALL MUST SAY WHICH TOOL, NOT WHICH SERVER.
 *
 * MEASURED 2026-08-19, live, by a read-only tap on window.mcAgent.onEvent
 * during a real luna turn in the packaged app: the engine event carries
 * everything a person needs —
 *
 *   event.tool = 'mcpToolCall'
 *   event.payload = { server: 'toolsenabled', tool: 'task.submit', arguments: {...} }
 *
 * — and the chat row showed "toolsenabled · finished". The loss was entirely in
 * this module: DETAIL_KEYS listed 'server' BEFORE 'tool', so detailFrom()
 * returned the server name for every MCP call, and 'arguments' was not a key at
 * all. Every product tool call therefore rendered as the same anonymous line.
 *
 * Why that is a defect and not a nit: the action rows are the context window
 * the owner asked for (his finding 1). A row that cannot say which tool ran
 * cannot tell a person WHICH call failed, and it makes the rows worthless as
 * evidence — the sweep that found this had to fall back to the signed ledger
 * for tool identity because the glass would not say.
 *
 * The fix keeps the guess-nothing rule: named keys only, no shape inference,
 * and a payload with none of them still says nothing.
 *
 * Run: node --test tools/test/mcp-action-row-detail.test.mjs
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sessionActivityEvent } from '../../src/agent-session-events.js'

const call = payload => sessionActivityEvent({
  sessionId: 's1',
  event: { type: 'tool_call', tool: 'mcpToolCall', toolCallId: 't1', payload },
}, 's1')

test('an MCP call names the tool, never the server it lives on', () => {
  const row = call({ server: 'toolsenabled', tool: 'task.submit', arguments: { title: 'x' } })
  assert.equal(row.kind, 'call')
  assert.ok(row.detail.includes('task.submit'),
    `the row says ${JSON.stringify(row.detail)} — a person cannot tell which tool ran`)
  assert.ok(!/^toolsenabled$/.test(row.detail),
    'the row still shows only the server name')
})

test('the call carries its arguments, because a tool name without them is half a fact', () => {
  const row = call({ server: 'toolsenabled', tool: 'memory.set', arguments: { key: 'drive-check', value: 391 } })
  assert.match(row.detail, /drive-check/,
    'the arguments never reach the row, so two calls to one tool are indistinguishable')
})

test('the older shapes still win where they are the real subject', () => {
  /* codex puts a shell line on `command`; the Claude CLI passes the tool's own
     input. Those remain the most specific thing to say, so they still lead. */
  assert.match(call({ command: 'ls -la' }).detail, /ls -la/)
  assert.match(call({ file_path: 'C:/x/notes.txt' }).detail, /notes\.txt/)
})

test('a payload with nothing named says nothing, rather than guessing at its shape', () => {
  assert.equal(call({ mystery: 'value' }).detail, '')
  assert.equal(call({}).detail, '')
})

test('the detail stays inside the row budget', () => {
  const row = call({ server: 'toolsenabled', tool: 'http.request', arguments: { body: 'z'.repeat(5_000) } })
  assert.ok(row.detail.length <= 240, `detail is ${row.detail.length} chars`)
})
