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

/* WHICH TURN A PACKET BELONGS TO, when the engine says so.
 *
 * THE DEFECT THIS EXISTS FOR (owner, 2026-08-18): "the messages in history
 * disappear or combine into each other." The view sums every delta into one
 * string per session and repaints one open bubble with it, and both are
 * released in exactly one place -- a `turn_completed` packet. A turn that ends
 * any other way therefore left the string and the bubble standing, and the NEXT
 * turn's first delta appended to the previous turn's words and repainted the
 * SAME bubble. Two answers became one, silently, and the first one's ending was
 * never recorded.
 *
 * The engine already names the turn on its events -- shell/agent-host.cjs reads
 * exactly this field to announce a turn and to close one -- so the boundary is
 * a fact on the wire rather than something a surface has to infer. Same
 * contract as its siblings: exact shape, exact session, null for everything
 * else, and null for an engine that does not name its turns (which then behaves
 * exactly as it did before this existed).
 */
export function sessionEventTurnId(packet, sessionId) {
  if (!packet || typeof packet !== 'object' || packet.sessionId !== sessionId) return null
  const event = packet.event
  if (!event || typeof event !== 'object') return null
  if (typeof event.turnId !== 'string' || event.turnId.length === 0 || event.turnId.length > 512) return null
  return event.turnId
}

export function sessionTurnStatus(packet, sessionId) {
  if (!packet || typeof packet !== 'object' || packet.sessionId !== sessionId) return null
  const event = packet.event
  if (!event || typeof event !== 'object' || event.type !== 'turn_completed') return null
  return typeof event.status === 'string' ? event.status : 'completed'
}

/* DID THAT TURN SUCCEED -- asked once, here, because the engines do not use the
 * same word for it and three separate surfaces were comparing against one.
 *
 * MEASURED 2026-08-17, the status each engine really put on `turn_completed`
 * for the same successful question:
 *
 *   codex  luna           "completed"   (the codex turn status)
 *   claude claude-sonnet  "success"     (the CLI's result subtype)
 *
 * Each is its own provider's word for the same outcome, and the reader above
 * carries it through unaltered on purpose -- a surface that wants to SHOW what
 * the engine said must still be able to. What was wrong was every caller then
 * testing `status === 'completed'`, which reads a successful Claude turn as a
 * failure: the tree would have painted the node red beside a correct answer.
 *
 * IT IS AN ALLOWLIST AND IT FAILS CLOSED. Success is the claim that needs
 * evidence; error, interrupted, cancelled and anything an engine adds later are
 * all NOT-success until somebody measures them and adds the word here. Calling
 * an unknown outcome a success is the direction that lies to a person. */
const TURN_SUCCESS_STATUSES = Object.freeze(['completed', 'success'])

export function sessionTurnSucceeded(status) {
  return typeof status === 'string' && TURN_SUCCESS_STATUSES.includes(status)
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
  if (event.type === 'approval_request') {
    /* The whole request rides as FIELDS: the id the reply must name, the kind,
       the engine's stated decision vocabulary, and the details a person needs
       to actually decide (the command, the file). Until 2026-08-14 this
       returned {kind:'approval'} alone — enough to print the waiting line and
       structurally impossible to answer. */
    const approval = event.approval && typeof event.approval === 'object' ? event.approval : {}
    return {
      kind: 'approval',
      approvalId: typeof approval.approvalId === 'string' ? approval.approvalId : '',
      approvalKind: typeof approval.kind === 'string' ? approval.kind : '',
      availableDecisions: Array.isArray(approval.availableDecisions)
        ? approval.availableDecisions.filter(decision => typeof decision === 'string' && decision.length <= 64)
        : [],
      details: approval.details && typeof approval.details === 'object' ? approval.details : {},
    }
  }
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
