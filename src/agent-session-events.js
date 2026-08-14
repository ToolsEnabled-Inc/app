/* Event-shape readers for a live agent session.
 *
 * Deliberately dependency-free. These decide what is allowed to reach the
 * screen, so they are the part worth testing directly, and a test should not
 * have to drag in the simulation (which schedules timers on import) to reach
 * them.
 *
 * The rule both functions enforce: read only the exact shape this surface
 * understands, from the exact session it belongs to. Anything else returns
 * null and is ignored rather than rendered -- one event stream carries every
 * open session, so a missing session check would let one session's output
 * appear in another's transcript.
 */

export function sessionEventText(packet, sessionId) {
  if (!packet || typeof packet !== 'object' || packet.sessionId !== sessionId) return null
  const event = packet.event
  if (!event || typeof event !== 'object') return null
  if (event.type === 'assistant_text_delta' && typeof event.text === 'string') return event.text
  return null
}

export function sessionTurnStatus(packet, sessionId) {
  if (!packet || typeof packet !== 'object' || packet.sessionId !== sessionId) return null
  const event = packet.event
  if (!event || typeof event !== 'object' || event.type !== 'turn_completed') return null
  return typeof event.status === 'string' ? event.status : 'completed'
}

/* WHAT THE AGENT IS DOING, as data. The engine already narrates a turn --
 * tool_call, tool_result, approval_request all reach the renderer -- and until
 * 2026-08-13 every one was dropped by the two readers above, which is half of
 * why a working agent looked like a hung one. This reader stays in the same
 * contract as its siblings: exact shape, exact session, null for everything
 * else. It returns FIELDS, never a sentence -- this module is deliberately
 * dependency-free, and the words belong to the copy modules (activityLine in
 * src/fleet-tree-copy.js), where the plain-language gate can hold them. */
export function sessionActivityEvent(packet, sessionId) {
  if (!packet || typeof packet !== 'object' || packet.sessionId !== sessionId) return null
  const event = packet.event
  if (!event || typeof event !== 'object') return null
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {}
  if (event.type === 'tool_call') {
    return {
      kind: 'call',
      tool: typeof event.tool === 'string' ? event.tool : '',
      command: typeof payload.command === 'string' ? payload.command : '',
    }
  }
  if (event.type === 'tool_result') {
    return {
      kind: 'result',
      tool: typeof event.tool === 'string' ? event.tool : '',
      exitCode: Number.isFinite(payload.exitCode) ? payload.exitCode : null,
      status: typeof payload.status === 'string' ? payload.status : '',
    }
  }
  if (event.type === 'approval_request') return { kind: 'approval' }
  return null
}
