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
import { unavailableReason } from './agent-availability-copy.js'
import { confinementNote } from './agent-confinement-copy.js'
import { isWriteEnabled } from './write-flags.js'
import { sessionEventText, sessionTurnStatus } from './agent-session-events.js'
import { createTranscriptAppender } from './agent-session-transcript.js'

/* WHAT THIS CONTROL SAYS ABOUT THE SESSION IT IS ABOUT TO START.
 *
 * It used to say one frozen sentence, and two of its three clauses went false
 * underneath it:
 *
 *   "Runs with your full local access. No permission tier limits a running
 *    session. Every start is recorded on this device before it runs."
 *
 * That was true when it was written -- the tier gated who could REQUEST a spawn
 * and which tools the remote surface listed, and confined nothing that ran. Tier
 * confinement then landed (capability/src/lib/agent-session-confinement.js,
 * bound by startSession() in shell/agent-host.cjs, which passes the resolved
 * `threadOptions` straight to the engine's thread/start), and nothing recomputed
 * the sentence. MEASURED per tier on this tree, with a real machine record at
 * each level so the tier was the only variable:
 *
 *   guided        sandbox read-only           isolated assistant home
 *   standard      sandbox workspace-write     isolated assistant home
 *   unrestricted  sandbox danger-full-access  the user's own home, unnarrowed
 *
 * and a machine with NO record fails closed to `guided`. So on a fresh install --
 * the normal first experience -- this control promised full local access and no
 * tier limit over a session whose sandbox refuses every write.
 *
 * WHY IT IS NOW COMPUTED AND NOT REWRITTEN. Replacing one frozen sentence with a
 * better frozen sentence would repeat the defect on a longer fuse: the claim is
 * a property of THIS INSTALL's recorded level, and the level is changeable from
 * Settings after first run. So the sentences come from mc-agent:confinement,
 * which reads the same resolver the spawn uses -- one source, so the screen
 * cannot describe a confinement the start would not apply.
 *
 * THE ONE CLAUSE THAT SURVIVES IS THE THIRD, unedited and for the same reason it
 * was true before: mc-agent:start calls recordSpawnIntent() before
 * getAgentHost().startSession(), and mc-agent:availability refuses on the
 * recorder before it even asks about the engine. See RECORD_CLAUSE in
 * src/agent-confinement-copy.js for why its wording is deliberately not stronger.
 *
 * NOTHING HERE IS ALLOWED TO SOUND SAFER THAN THE MEASUREMENT. At `unrestricted`
 * the rendered copy is blunter than the sentence it replaces: "Nothing narrows
 * it: it can read, change and delete any file on this computer and run any
 * program, without asking." A product understating its own blast radius is the
 * defect; a product overstating its safety is the same defect pointed at someone
 * who will get hurt by it. */
const CONFINEMENT_PENDING = 'Checking what a session here would be allowed to do…'

const BRIDGE_ABSENT = 'the desktop shell is required; this surface is inert in a browser'

function actionState(node, kind, text) {
  node.dataset.state = kind
  node.textContent = text
}


/* The frame scheduler is injectable ONLY so a test can drive the transcript
   flush deterministically instead of waiting on a real animation frame. The
   shipped call passes nothing and gets requestAnimationFrame, so production
   behaviour is unchanged. */
export function mountAgentSessionSurface(root, {
  agentId,
  live = false,
  bridge = globalThis.mcAgent,
  scheduleFrame = (fn) => globalThis.requestAnimationFrame(fn),
  cancelFrame = (handle) => globalThis.cancelAnimationFrame(handle),
} = {}) {
  /* THE PAGE MUST SAY IT IS SHOWING REAL DATA BEFORE A REAL CONTROL APPEARS ON IT.
   *
   * This is the surface that starts an actual CLI child process on the user's
   * actual machine. Until this check existed it asked exactly one question --
   * "is the agent-session write flag on?" -- and mounted a working Start
   * whenever the answer was yes, with no idea whether the page around it was
   * the live drill-in or the demonstration copy.
   *
   * MEASURED on the packaged build (release/win-unpacked, tier unrestricted),
   * at #/agent/c1/terra-01 with the view in simulated mode: the page rendered
   * its own banner reading "Example data. These are not your agents -- nothing
   * here is running, and no control on this page reaches a real session", and
   * in the same viewport this surface rendered an ENABLED Start over the note
   * "This computer is set to Unrestricted. Nothing narrows it: it can read,
   * change and delete any file on this computer and run any program, without
   * asking." Pressing it took mcAgent.history().total from 0 to 1 and the
   * status from "agent engine ready" to "running - session open". A real
   * spawn, recorded on the device, from a page that told the person nothing on
   * it was real.
   *
   * `live` DEFAULTS TO FALSE, and that direction is the whole point. This
   * project's recurring defect is absence read as consent -- a missing field or
   * a falsy check turning "nothing specified" into "allowed". A caller that
   * says nothing about its provenance is a caller that has not established the
   * page is real, so it gets no real control. The one caller that can prove it
   * (src/views/agent.js, which only has a projection when the fetch returned
   * one) passes `live` explicitly.
   *
   * The demonstration page loses nothing a person could legitimately use: this
   * surface never read `agentId` at all, so the session it started was never
   * the agent whose page it sat on. */
  if (live !== true) return () => {}
  if (!isWriteEnabled('agent-session')) return () => {}

  const surface = el(`<section class="write-surface agent-session-surface" aria-label="Agent session">
    <header><strong>Agent session</strong><span data-session-status role="status">checking…</span></header>
    <div class="write-surface-grid">
      <form class="write-form" data-session-form>
        <span class="write-form-title">Start an agent</span>
        <label class="write-wide">Prompt<textarea name="text" maxlength="16000" rows="2" required></textarea></label>
        <button type="submit" data-session-start disabled>Start</button>
        <button type="button" data-session-stop disabled>Stop</button>
        <!-- THE SIGN-IN PRECONDITION IS NOT RESTATED HERE, and that is a
             decision rather than an omission. This lane built a second notice
             for it, and while it was being built a peer lane repaired the
             probe itself: engineAvailability() now runs
             confinedSessionIsSignedOut() and answers
             {ok:false, AGENT_CONFINEMENT_SIGNED_OUT}, which DISABLES Start and
             renders the remedy through unavailableReason() in the status row
             above. That is strictly the better fix -- a disabled control with a
             reason beats an enabled one with a warning beside it -- so the
             second notice was removed rather than shipped alongside it. Two
             elements saying one thing is how a screen starts contradicting
             itself the first time only one of them is updated. -->
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

  actionState(output, 'note', CONFINEMENT_PENDING)
  root.querySelector('.agent-strip')?.insertAdjacentElement('afterend', surface)

  /* The confinement reading, asked for once per mount and rendered as sentences
     by the pure copy module. `catch` collapses to the unknown reading rather than
     to a cheerful default: a bridge that cannot answer is exactly the case where
     guessing "full local access" would be the original defect all over again. */
  let confinementText = ''
  const renderConfinement = (reading) => {
    const note = confinementNote(reading)
    confinementText = note.sentences.join(' ')
    /* 'note', not 'unavailable'. The shared write-surface stylesheet paints
       [data-state="unavailable"] in --s-serious, which rendered this accurate
       description of a perfectly healthy install in alarm red on all three
       themes -- caught by looking at the screenshots, not by any assertion,
       because every word of it was correct. Nothing here is a fault: the
       refusal, when there is one, is the status row above. */
    actionState(output, 'note', confinementText)
  }

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
    /* No shell means no way to ask what a session would be confined to, so the
       copy states that absence instead of leaving the pending sentence up
       forever -- or, worse, falling back to the claim this repair removed. */
    renderConfinement(null)
    return () => { destroyed = true }
  }

  /* Asked separately from availability, and allowed to fail separately. A copy
     of the product whose confinement cannot be read must still be able to say
     why Start is disabled, and an install that is perfectly startable must still
     describe itself even if this read fails. Coupling them would let either
     failure blank the other's answer. */
  void (async () => {
    let reading = null
    try {
      reading = typeof bridge.confinement === 'function' ? await bridge.confinement() : null
    } catch { reading = null }
    if (!destroyed) renderConfinement(reading)
  })()

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

  /* Transcript appends are batched per animation frame and written in bounded
     chunks. This used to be `transcript.textContent += text` once per delta,
     which is quadratic in the transcript's length -- 20,000 deltas measured at
     1051 ms of blocked main thread, against 1.1 ms batched. The engine emits
     one delta PER TOKEN, so that path ran tens of thousands of times per turn
     and got worse the longer a session lived. Nothing is dropped or capped;
     see src/agent-session-transcript.js for the full reasoning and numbers. */
  const appender = createTranscriptAppender({
    node: transcript,
    createTextNode: text => document.createTextNode(text),
    scheduleFrame,
    cancelFrame,
  })

  unsubscribe = bridge.onEvent((packet) => {
    if (destroyed || !sessionId) return
    const text = sessionEventText(packet, sessionId)
    if (text) {
      appender.push(text)
      return
    }
    const turnStatus = sessionTurnStatus(packet, sessionId)
    if (turnStatus) {
      /* Flush before the status flips, so "turn completed" is never shown
         beside a transcript that is still missing that turn's last frame of
         output. */
      appender.flushNow()
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
    appender.reset()
    actionState(status, 'pending', 'starting…')
    /* The same measured sentences, kept on screen while the session starts.
       They describe what this start is about to do, so removing them at the
       moment it happens would be exactly backwards. */
    actionState(output, 'note', confinementText)

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
    /* A scheduled frame outlives the element it would write into, so it is
       cancelled here rather than left to fire against a detached surface. */
    appender.dispose()
    if (unsubscribe) unsubscribe()
    void closeSession()
    surface.remove()
  }
}
