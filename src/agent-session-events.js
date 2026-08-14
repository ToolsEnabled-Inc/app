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

/* WHAT THE TURN HAS COST, as data. The engine reports token usage on every
 * thread/tokenUsage/updated and the adapter re-emits it as a `usage` event —
 * which crossed mc-agent:event from the first day and was dropped by every
 * reader here. Same contract as the siblings: exact shape, exact session,
 * null otherwise. Only FINITE NUMBERS survive from the usage record: the
 * shape is the engine's own and unversioned here, and a filter that admits
 * only numeric fields cannot smuggle prose or paths onto a screen. */
export function sessionUsageEvent(packet, sessionId) {
  if (!packet || typeof packet !== 'object' || packet.sessionId !== sessionId) return null
  const event = packet.event
  if (!event || typeof event !== 'object' || event.type !== 'usage') return null
  const record = event.usage && typeof event.usage === 'object' && !Array.isArray(event.usage) ? event.usage : {}
  /* MEASURED SHAPE (codex 0.146 app-server, captured live 2026-08-14):
     { total: {totalTokens, inputTokens, cachedInputTokens, outputTokens, ...},
       last: {...same...}, modelContextWindow }. `total` is the session's
     lifetime reading — the one "What it has used" means. Older or flat shapes
     fall back to the record itself, and the numbers-only filter holds either
     way: prose or a path in a usage record can never reach a screen. */
  const source = record.total && typeof record.total === 'object' && !Array.isArray(record.total)
    ? record.total
    : record
  const usage = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof key === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) && Number.isFinite(value)) {
      usage[key] = value
    }
  }
  if (Number.isFinite(record.modelContextWindow)) usage.modelContextWindow = record.modelContextWindow
  return {
    turnId: typeof event.turnId === 'string' ? event.turnId : null,
    usage,
  }
}
