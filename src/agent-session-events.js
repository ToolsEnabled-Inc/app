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

/* WHOSE WORDS THIS COMPLETION IS ALLOWED TO TAKE.
 *
 * THE DEFECT (owner, 2026-08-18, the other half of "combine into each other").
 * The turn-completion branch read sessionTurnStatus, which carries the STATUS
 * and not the turn id, and then filed whatever was in the session's
 * accumulator as this completion's answer. Order two turns like this --
 *
 *     delta(turn-a)  ->  delta(turn-b)  ->  turn_completed(turn-a)
 *
 * -- and turn B's partial words are recorded as turn A's answer, on the node,
 * in the durable record and in every waiting surface, and B's accumulator is
 * emptied under it. settleTurnBoundary guards the opposite ordering only.
 *
 * So the completion is asked which turn it belongs to before it is allowed to
 * take anything. Answering false does not mean the turn did not end; it means
 * this completion may not touch the LIVE accumulator, because the words in it
 * belong to a turn that is still speaking.
 *
 * IT FALLS BACK TO THE OLD BEHAVIOUR WHENEVER IT CANNOT TELL, and that
 * direction is deliberate. Claude's CLI result packets carry no turn id at
 * all; a rule that refused to file a nameless completion would stop recording
 * completions entirely on that engine, which is a worse defect than the one
 * this fixes. Unknown means "behave exactly as before".
 */
export function completionSettlesOpenTurn(packet, sessionId, openTurnId) {
  if (!sessionTurnStatus(packet, sessionId)) return false
  const completed = sessionEventTurnId(packet, sessionId)
  if (!completed) return true
  if (typeof openTurnId !== 'string' || openTurnId.length === 0) return true
  return completed === openTurnId
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

/* THE SENTENCE A FAILED TURN ENDED WITH, when the engine carried one.
 *
 * MEASURED (fresh-install walkthrough 2026-08-18, re-measured 2026-08-19 on
 * claude 2.1.186): a refused turn ends is_error:true with the provider's one
 * human sentence in the result -- "You're out of usage credits · resets
 * Aug 25, 12am" -- and no assistant text before it. The engine now puts that
 * sentence on the completion event's `text` field; this is the one reader of
 * it, same contract as its siblings: exact shape, exact session, null for
 * everything else. Null for a SUCCESSFUL completion by design -- on success
 * the result text duplicates the assistant text already delivered, so a
 * surface that rendered it would print the answer twice. */
export function sessionTurnFailureText(packet, sessionId) {
  const status = sessionTurnStatus(packet, sessionId)
  if (!status || sessionTurnSucceeded(status)) return null
  const text = packet.event.text
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  return trimmed.length > 0 ? trimmed : null
}

/* WHAT THE ACTIONS COST, AND WHY EACH BOUND EXISTS.
 *
 * maxDetailChars   one line in a chat log. A command longer than this is
 *                  truncated on the row and shown whole when it is opened.
 * maxOutputChars   a single `Read` result can be a whole file. What is kept is
 *                  an excerpt to open, never the file.
 * maxPerTurn       a turn can emit thousands of tool events. Beyond this the
 *                  rows FOLD into a count -- see createActionBuffer -- because
 *                  a cap a person cannot see is a cap that lies.
 * maxPerSession    the buffer is otherwise unbounded, and an unbounded buffer
 *                  reaches the durable record, where an oversized save would
 *                  cost the node's conversation. */
export const ACTION_LIMITS = Object.freeze({
  maxDetailChars: 240,
  maxOutputChars: 4_000,
  maxPerTurn: 200,
  maxPerSession: 400,
})

/* WHAT THE AGENT IS DOING, AS ONE LINE OF DETAIL. The engines disagree about
 * where the interesting argument lives: codex puts a shell line on
 * `payload.command`, and the Claude CLI passes the tool's own input through --
 * `file_path` for a Read, `command` for a Bash, `pattern` for a search. Each
 * spelling is looked up by name, and a payload with none of them says nothing
 * rather than having its shape guessed at. */
const DETAIL_KEYS = Object.freeze(['command', 'file_path', 'path', 'pattern', 'url', 'notebook_path', 'server', 'tool'])

function detailFrom(payload) {
  for (const key of DETAIL_KEYS) {
    const value = payload[key]
    if (typeof value === 'string' && value.length > 0) return value.slice(0, ACTION_LIMITS.maxDetailChars)
  }
  return ''
}

/* THE OUTPUT KEYS, same rule: codex aggregates a command's output, the Claude
 * CLI hands the tool's result back as text. Only a STRING is ever admitted --
 * an object rendered into a chat row is a JSON blob in front of a person. */
const OUTPUT_KEYS = Object.freeze(['aggregatedOutput', 'output', 'result', 'error'])

function outputFrom(event, payload) {
  if (typeof event.text === 'string' && event.text.length > 0) return event.text.slice(0, ACTION_LIMITS.maxOutputChars)
  for (const key of OUTPUT_KEYS) {
    const value = payload[key]
    if (typeof value === 'string' && value.length > 0) return value.slice(0, ACTION_LIMITS.maxOutputChars)
  }
  return ''
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
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload : {}
  /* THE NAME A RESULT IS JOINED TO ITS CALL BY. Both adapters already put it on
     the event -- codex as the item id, the Claude CLI as the tool_use_id -- and
     without it a result can only be appended as a SECOND row, which is how a
     list of five commands reads as ten. */
  const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : ''
  if (event.type === 'tool_call') {
    return {
      kind: 'call',
      toolCallId,
      tool: typeof event.tool === 'string' ? event.tool : '',
      command: typeof payload.command === 'string' ? payload.command : '',
      detail: detailFrom(payload),
      exitCode: null,
      status: '',
      output: '',
    }
  }
  if (event.type === 'tool_result') {
    return {
      kind: 'result',
      toolCallId,
      tool: typeof event.tool === 'string' ? event.tool : '',
      command: typeof payload.command === 'string' ? payload.command : '',
      detail: detailFrom(payload),
      exitCode: Number.isFinite(payload.exitCode) ? payload.exitCode : null,
      /* THE CLAUDE CLI PUTS THIS ON THE EVENT, NOT IN THE PAYLOAD (its adapter
         emits `status: part.is_error === true ? 'error' : 'ok'` alongside the
         payload). Reading only payload.status read every failed Claude tool
         call as an unremarkable one. */
      status: typeof payload.status === 'string' && payload.status
        ? payload.status
        : (typeof event.status === 'string' ? event.status : ''),
      output: outputFrom(event, payload),
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
      /* An approval has no tool call to join to, so it is its own row and its
         own id -- and answering it is what closes it. */
      toolCallId: '',
      tool: typeof approval.kind === 'string' ? approval.kind : '',
      command: '',
      detail: detailFrom(approval.details && typeof approval.details === 'object' ? approval.details : {}),
      exitCode: null,
      status: '',
      output: '',
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

/* WHAT THE AGENT DID, KEPT IN ORDER AND BOUNDED IN PUBLIC.
 *
 * WHY A BUFFER AT ALL. The rows have to survive two things the live event
 * stream does not: a chat opened halfway through a turn (which must already
 * show the work taken so far) and a chat that is not open at all (a person
 * watching the tree, who opens the circle afterwards). So the actions are held
 * per session beside the transcript, exactly the way the words are.
 *
 * WHY IT IS CAPPED, and why the caps are the visible kind. A turn can emit
 * thousands of tool events, and this buffer feeds the DURABLE record. An
 * unbounded buffer therefore reaches a save, and an oversized save is the
 * defect that used to cost a node its whole conversation. Two caps, and
 * neither is silent:
 *
 *   per turn     beyond it the rows FOLD into a count -- `folded(turnId)` --
 *                so a screen can say "and 412 more steps" instead of quietly
 *                showing the first two hundred as if they were all of them.
 *   per session  the OLDEST rows leave, the newest stay (the newest are where
 *                the work is), and `dropped` says how many went.
 *
 * A RESULT UPDATES ITS CALL'S ROW; it never appends a second one. Both engines
 * name the call -- codex with the item id, the Claude CLI with the tool_use_id
 * -- so the join is a fact on the wire. An engine that names NOTHING keeps
 * every row separate, because folding every unnamed action onto one row would
 * be worse than an extra row.
 */
export function createActionBuffer({
  maxPerTurn = ACTION_LIMITS.maxPerTurn,
  maxPerSession = ACTION_LIMITS.maxPerSession,
} = {}) {
  let rows = []
  const byCallId = new Map()
  const foldedPerTurn = new Map()
  let dropped = 0

  const stateOf = (activity) => {
    if (activity.kind === 'approval') return 'waiting'
    if (activity.kind === 'call') return 'working'
    if (Number.isFinite(activity.exitCode)) return activity.exitCode === 0 ? 'done' : 'undone'
    if (activity.status === 'error' || activity.status === 'failed') return 'undone'
    return 'done'
  }

  return {
    /** File one activity. Answers what it did, so the caller can append a row,
     *  repaint one, or repaint only the fold count. */
    add(activity, { turnId = null, at = Date.now() } = {}) {
      if (!activity || typeof activity !== 'object') return { row: null, change: 'ignored' }
      const key = activity.toolCallId ? `${turnId || ''}:${activity.toolCallId}` : ''
      const held = key ? byCallId.get(key) : null
      if (held) {
        /* The row keeps the moment it OPENED. Re-stamping it on the result
           would move a finished command to the end of a conversation it
           started five minutes earlier. */
        held.state = stateOf(activity)
        if (activity.tool) held.tool = activity.tool
        if (activity.detail) held.detail = activity.detail
        if (Number.isFinite(activity.exitCode)) held.exitCode = activity.exitCode
        if (activity.output) held.output = activity.output
        return { row: held, change: 'updated' }
      }
      if (turnId) {
        const already = rows.filter(row => row.turnId === turnId).length
        if (already >= maxPerTurn) {
          foldedPerTurn.set(turnId, (foldedPerTurn.get(turnId) || 0) + 1)
          return { row: null, change: 'folded', folded: foldedPerTurn.get(turnId) }
        }
      }
      const row = {
        id: activity.toolCallId || `${turnId || 'turn'}-${at}-${rows.length}`,
        turnId: turnId || null,
        at,
        kind: activity.kind,
        tool: activity.tool || '',
        detail: activity.detail || '',
        exitCode: Number.isFinite(activity.exitCode) ? activity.exitCode : null,
        output: activity.output || '',
        state: stateOf(activity),
      }
      rows.push(row)
      if (key) byCallId.set(key, row)
      if (rows.length > maxPerSession) {
        const leaving = rows.slice(0, rows.length - maxPerSession)
        rows = rows.slice(rows.length - maxPerSession)
        dropped += leaving.length
        for (const gone of leaving) {
          for (const [heldKey, heldRow] of byCallId) if (heldRow === gone) byCallId.delete(heldKey)
        }
      }
      return { row, change: 'added' }
    },
    list() { return rows.slice() },
    folded(turnId) { return foldedPerTurn.get(turnId) || 0 },
    get dropped() { return dropped },
  }
}
