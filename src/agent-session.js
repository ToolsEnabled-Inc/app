/* Start an agent from inside the interface, watch it work, and stop it.
 *
 * This is the in-app session path: the shell's agent host drives a real CLI
 * child process and streams its output back over one IPC channel. It is the
 * only path that can show output while a turn is running -- the audited
 * dispatch form next to it hands work to the action bridge and returns a
 * launch id, which is a receipt, not a view of the work.
 *
 * Every element here is existing write-surface markup. This module adds no
 * styling and introduces no visual vocabulary of its own.
 */
import { el } from './components.js'
import { isWriteEnabled } from './write-flags.js'
import { sessionEventText, sessionTurnStatus } from './agent-session-events.js'

/* Said in the UI, not just in a comment, because it is the single most
   load-bearing fact about this control.
   A session started here runs with the same access as the person using the
   desktop app. The permission tier recorded elsewhere in this product gates
   who may REQUEST a spawn and which tools the remote tool surface lists; it
   does not confine a child process once that process is running, and this
   path performs no tier check at all. A control that implied otherwise would
   be the UI telling a lie about its own blast radius. */
/* Two facts the operator has to know before pressing Start, and the second
   one changed:

   1. No tier confines a running session. The permission tier gates who may
      REQUEST a spawn and which tools the remote surface lists; it does not
      restrain a child process once it exists, and this path performs no tier
      check at all (T5, unbuilt).
   2. The session IS recorded now -- every start writes a signed, hash-chained
      entry to this app's own local ledger before anything is spawned, and a
      start that cannot be recorded does not happen.

   Precision matters on the second one: "recorded on this device" is the true
   claim. It is this app's own signed ledger, not the canonical audit chain,
   and the signing key lives on the same machine as the ledger -- so it is
   tamper-evident against edits, not proof against this OS user. Saying more
   than that would be the UI overstating its own evidence. */
const UNRESTRICTED_NOTE = 'Runs with your full local access. No permission tier limits a running session. Every start is recorded on this device before it runs.'

/* Bounded copy for the codes availability can return. An unknown code is
   shown verbatim -- codes are short, fixed identifiers, never paths. */
const UNAVAILABLE_TEXT = Object.freeze({
  AGENT_ENGINE_UNAVAILABLE: 'no agent engine is configured on this installation',
  AGENT_HOST_CLOSED: 'the agent host is shutting down',
  MC_AGENT_INVALID_PAYLOAD: 'the agent host refused the availability request',
})

const BRIDGE_ABSENT = 'the desktop shell is required; this surface is inert in a browser'

function actionState(node, kind, text) {
  node.dataset.state = kind
  node.textContent = text
}

function unavailableReason(code) {
  return UNAVAILABLE_TEXT[code] || String(code || 'unavailable')
}

export function mountAgentSessionSurface(root, { agentId, bridge = globalThis.mcAgent } = {}) {
  if (!isWriteEnabled('agent-session')) return () => {}

  const surface = el(`<section class="write-surface agent-session-surface" aria-label="Agent session">
    <header><strong>Agent session</strong><span data-session-status role="status">checking…</span></header>
    <div class="write-surface-grid">
      <form class="write-form" data-session-form>
        <span class="write-form-title">Start an agent</span>
        <label class="write-wide">Prompt<textarea name="text" maxlength="16000" rows="2" required></textarea></label>
        <button type="submit" data-session-start disabled>Start</button>
        <button type="button" data-session-stop disabled>Stop</button>
        <output data-action-output role="status"></output>
        <pre class="write-report" data-session-output hidden tabindex="0"></pre>
      </form>
    </div>
  </section>`)

  const status = surface.querySelector('[data-session-status]')
  const form = surface.querySelector('[data-session-form]')
  const startButton = surface.querySelector('[data-session-start]')
  const stopButton = surface.querySelector('[data-session-stop]')
  const output = surface.querySelector('[data-action-output]')
  const transcript = surface.querySelector('[data-session-output]')
  const prompt = form.elements.text

  actionState(output, 'unavailable', UNRESTRICTED_NOTE)
  root.querySelector('.agent-strip')?.insertAdjacentElement('afterend', surface)

  let destroyed = false
  let sessionId = null
  let unsubscribe = null
  let starting = false
  let ready = false

  const setStarted = (live) => {
    startButton.disabled = live || destroyed || !ready
    prompt.disabled = live
    stopButton.disabled = !live
  }

  /* Close is best-effort by design: the main process also closes every session
     owned by a destroyed WebContents, so a failure here cannot strand a child
     past the window's life. */
  const closeSession = async () => {
    const id = sessionId
    sessionId = null
    if (!id) return
    try { await bridge.interrupt({ sessionId: id }) } catch { /* no active turn is the common, expected case */ }
    try { await bridge.close({ sessionId: id }) } catch { /* the owner-destroyed path closes it regardless */ }
  }

  if (!bridge || typeof bridge.availability !== 'function') {
    actionState(status, 'unavailable', `unavailable · ${BRIDGE_ABSENT}`)
    return () => { destroyed = true }
  }

  void (async () => {
    let available
    try { available = await bridge.availability() }
    catch (error) { available = { ok: false, code: error?.code || 'AGENT_ENGINE_UNAVAILABLE' } }
    if (destroyed) return
    if (available?.ok !== true) {
      actionState(status, 'unavailable', `unavailable · ${unavailableReason(available?.code)}`)
      return
    }
    ready = true
    actionState(status, 'ready', 'agent engine ready')
    startButton.disabled = false
  })()

  unsubscribe = bridge.onEvent((packet) => {
    if (destroyed || !sessionId) return
    const text = sessionEventText(packet, sessionId)
    if (text) {
      transcript.hidden = false
      transcript.textContent += text
      return
    }
    const turnStatus = sessionTurnStatus(packet, sessionId)
    if (turnStatus) {
      actionState(status, turnStatus === 'completed' ? 'confirmed' : 'refused', `turn ${turnStatus} · session still open`)
    }
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (starting || sessionId || !ready) return
    const text = String(prompt.value || '').trim()
    if (text.length === 0) return

    starting = true
    setStarted(true)
    transcript.textContent = ''
    transcript.hidden = true
    actionState(status, 'pending', 'starting…')
    actionState(output, 'pending', UNRESTRICTED_NOTE)

    const id = (globalThis.crypto?.randomUUID?.() || '')
    if (!id) {
      starting = false
      setStarted(false)
      actionState(status, 'refused', 'refused · no secure session id is available')
      return
    }

    try {
      await bridge.start({ sessionId: id })
      if (destroyed) { sessionId = id; await closeSession(); return }
      sessionId = id
      actionState(status, 'ready', 'running · session open')
      await bridge.send({ sessionId: id, text })
    } catch (error) {
      /* An error message from the host can name a path. Report its code and a
         fixed sentence; never the message. */
      const code = typeof error?.code === 'string' ? error.code : 'AGENT_SESSION_FAILED'
      if (sessionId) await closeSession()
      if (!destroyed) actionState(status, 'refused', `refused · ${unavailableReason(code)}`)
    } finally {
      starting = false
      if (!destroyed) setStarted(Boolean(sessionId))
    }
  })

  stopButton.addEventListener('click', async () => {
    if (!sessionId) return
    stopButton.disabled = true
    actionState(status, 'pending', 'stopping…')
    await closeSession()
    if (destroyed) return
    setStarted(false)
    actionState(status, ready ? 'ready' : 'unavailable', 'stopped · session closed')
  })

  return () => {
    destroyed = true
    if (unsubscribe) unsubscribe()
    void closeSession()
    surface.remove()
  }
}
