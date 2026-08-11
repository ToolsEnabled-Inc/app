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
