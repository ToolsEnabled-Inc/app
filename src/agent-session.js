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
import { refusalCode, unavailableReason } from './agent-availability-copy.js'
import { confinementNote } from './agent-confinement-copy.js'
import { isWriteEnabled, setWriteEnabled } from './write-flags.js'
import { sessionEventText, sessionTurnStatus, sessionTurnSucceeded } from './agent-session-events.js'
import { createTranscriptAppender } from './agent-session-transcript.js'
import { publishLiveSession } from './agent-session-registry.js'
import { START_CONTROL_ON, startControlOffBecause } from './setup-profile.js'
/* What turning this on would grant and what it would risk, from the one place
   those statements live (owner, R1529). */
import { withheldMarkup } from './guided-step.js'

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

/* WHAT THIS SAID, AND WHY IT CHANGED. "the desktop shell is required; this
   surface is inert in a browser" -- three words from inside the program in one
   short line. "Desktop shell" is the installed application, "surface" is this
   panel, and "inert" is what a person is being told about a control they can
   see. None of the three names anything the reader owns, and the line offered
   nothing to do. This one says which of the two things they are looking at, and
   what to open instead. */
const BRIDGE_ABSENT = 'this page is open in a browser, not in the installed ToolsEnabled application. Nothing here can start an agent. Open the installed app to use these controls'

/* One per mounted session surface, so the status row's id stays unique while a
   rebuilt agent page and its predecessor are both briefly in the document. */
let sessionSurfaces = 0

function actionState(node, kind, text) {
  node.dataset.state = kind
  node.textContent = text
}


/* The frame scheduler is injectable ONLY so a test can drive the transcript
   flush deterministically instead of waiting on a real animation frame. The
   shipped call passes nothing and gets requestAnimationFrame, so production
   behaviour is unchanged. */
export function mountAgentSessionSurface(root, options = {}) {
  /* THE `live` FENCE IS ASKED FIRST AND ONCE, before either branch below, and
     it is the only question whose answer is "render nothing at all". Everything
     after it is about a real page. See the long note in mountSessionControls()
     for the measurement that put it there. */
  if (options.live !== true) return () => {}

  /* THE SWITCHED-OFF PATH IS A DESTINATION, NOT AN ABSENCE.
   *
   * This used to be `if (!isWriteEnabled('agent-session')) return () => {}`, and
   * that one line is the second half of the recommended-answer defect. The
   * setup walkthrough recommended the answer that leaves this flag off, so the
   * ordinary first-run install rendered NOTHING here -- no control, no reason,
   * nothing naming the setting that removed it. A person who took the product's
   * own advice arrived at an agent page with no way to start an agent and no
   * way to find out why. Absence is unfalsifiable to the person looking at it:
   * a missing Start and a broken build look exactly alike.
   *
   * So the off state renders, says which answer switched it off, and carries
   * the switch. Turning it on is an explicit act by the person on their own
   * machine -- the same act Settings offers, moved to the place where they
   * discover they want it -- and nothing starts as a result of it: it reveals
   * the Start control, which they then have to press.
   *
   * It is inside the `live` fence, so the demonstration page still renders no
   * session surface of any kind and the example-page write fence is unchanged. */
  let disposed = false
  let release = null
  const mount = () => {
    release = isWriteEnabled('agent-session')
      ? mountSessionControls(root, options, remount)
      : mountSessionSwitchedOff(root, remount)
  }
  const remount = () => {
    if (disposed) return
    release?.()
    release = null
    mount()
  }
  mount()
  return () => {
    disposed = true
    release?.()
    release = null
  }
}

/* WHAT THE PERSON IS LOOKING AT WHEN THERE IS NO START CONTROL.
 *
 * The same `.write-surface` markup as the real one, so it lands in the same
 * place in the page with the same vocabulary; no new visual language, and no
 * form, because there is nothing to submit. */
function mountSessionSwitchedOff(root, remount) {
  const surface = el(`<section class="write-surface agent-session-surface" data-session-off aria-label="Agent session">
    <header><strong>Agent session</strong><span data-session-status role="status">off · this computer cannot start an assistant</span></header>
    <div class="write-surface-grid">
      <div class="write-form">
        <span class="write-form-title">Running agents is switched off</span>
        <output data-action-output role="status"></output>
        <button type="button" data-session-enable>${START_CONTROL_ON.label}</button>
        ${/* WHAT IT WOULD GIVE AND WHAT IT WOULD COST, beside the button that
              gives it (owner, R1529). This surface already said what is off and
              where the switch is; a person deciding whether to press it was
              still missing the other half, and a switch offered with only its
              benefit named is the kind of nudge this directive is against. The
              same statement is used on the settings page and in the setup
              review, from src/permission-guidance.js. */''}
        ${withheldMarkup('write_agent-session', {
          label: 'Running an agent session',
          reason: 'Turning it on starts nothing by itself. It puts the Start control here, and you decide what to run.',
        })}
      </div>
    </div>
  </section>`)
  const output = surface.querySelector('[data-action-output]')
  actionState(output, 'note', switchedOffReason())
  root.querySelector('.agent-strip')?.insertAdjacentElement('afterend', surface)

  const enable = surface.querySelector('[data-session-enable]')
  const onEnable = () => {
    enable.disabled = true
    setWriteEnabled('agent-session', true)
    /* Re-mounts into the real surface in place. The person pressed a switch and
       the control they were told about appears where the switch was, rather
       than after a navigation they have to work out for themselves. */
    remount()
  }
  enable.addEventListener('click', onEnable)

  /* Nothing was published to the session registry and nothing needs clearing:
     an off surface owns no session. */
  return () => {
    enable.removeEventListener('click', onEnable)
    surface.remove()
  }
}

/* WHICH ANSWER SWITCHED IT OFF, NAMED IN THE PERSON'S OWN WORDS.
 *
 * Read from the recorded setup profile rather than asserted, because there are
 * two genuinely different ways to arrive here and telling them apart is the
 * whole value of the sentence: the walkthrough's autonomy answer, or the
 * Settings switch on a machine that never recorded a profile. Claiming setup
 * did it to someone who turned it off themselves an hour ago would be the
 * product misdescribing its own state, which is the failure this repair is
 * about. */
function switchedOffReason() {
  /* The first sentence is startControlOffBecause()'s, shared with the fleet
     page's start panel, which says the same thing about the same switch. */
  const because = startControlOffBecause()
  /* THREE SENTENCES, NOT ONE. This was a single thirty-word run-on carrying
     three separate facts: that nothing runs yet, that the switch starts nothing
     by itself, and where the switch is. One idea per sentence is the whole of
     the change; not a word of meaning was dropped. */
  return `${because} Nothing runs on this computer until you turn it on. Turning it on starts nothing by itself: it puts the Start control here, and you decide what to run. The same switch is in Settings → Write → Run an agent session.`
}

function mountSessionControls(root, {
  agentId,
  bridge = globalThis.mcAgent,
  scheduleFrame = (fn) => globalThis.requestAnimationFrame(fn),
  cancelFrame = (handle) => globalThis.cancelAnimationFrame(handle),
} = {}, remount = () => {}) {
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
   * `agentId` IS NOW READ, and the sentence that used to end this note --
   * "this surface never read `agentId` at all, so the session it started was
   * never the agent whose page it sat on" -- described the second defect this
   * file was carrying. An anonymous session is a session nothing can be mapped
   * to, which is why Pause, Respawn and Terminate could only ever refuse. The
   * association is recorded at the one moment it is certain: a person pressing
   * Start on a named agent's page. See src/agent-session-registry.js. */
  /* THE STATUS ROW IS THE START BUTTON'S OWN DESCRIPTION, not merely a sentence
   * near it.
   *
   * The row already carries every reason this control can be refused --
   * "unavailable · Codex is installed on this computer but nobody is signed in
   * to it...", the bridge-absent line, the confinement refusals -- and the
   * comment below is right that a disabled control with a reason beats an
   * enabled one with a warning beside it. But the association was VISUAL only.
   * Measured with Tab on the packaged build from a sterile profile: a disabled
   * button is not in the tab order at all, so a keyboard-only person walks the
   * whole agent page (17 stops) and never meets Start, and a screen reader that
   * does reach it in scan mode was told "Start, button, dimmed" with the reason
   * an unrelated sentence somewhere above.
   *
   * aria-describedby ties the two together, so the reason is read out AS PART OF
   * the control, in every mode, without a second copy of the sentence existing.
   * The id is per-mount: the agent page can be rebuilt while an old copy is
   * still on screen, and two elements sharing one id is an ambiguous reference
   * exactly when it matters. */
  const statusId = `agent-session-status-${sessionSurfaces += 1}`
  const surface = el(`<section class="write-surface agent-session-surface" aria-label="Agent session">
    <header><strong>Agent session</strong><span data-session-status id="${statusId}" role="status">checking…</span></header>
    <div class="write-surface-grid">
      <form class="write-form" data-session-form>
        <span class="write-form-title">Start an agent</span>
        <label class="write-wide">Prompt<textarea name="text" maxlength="16000" rows="2" required></textarea></label>
        <!-- THE WORD ON THE BUTTON IS NOT THE NAME OF THE ACTION.
             Measured by tools/a11y-keyboard-qa on the packaged build: the
             accessible name Chromium handed the platform was exactly "Start" --
             five characters that name no object. A screen-reader user landing
             here in scan mode is told "Start, button" and has to go looking for
             what it starts; a person reading the visible layout has the form
             title "Start an agent" six pixels above it and never notices the
             gap. aria-label supplies the object the visible word borrows from
             its surroundings, and it is the SAME object -- an agent session
             from the prompt in this form -- so nothing is announced that the
             screen does not also show. The visible word stays "Start", because
             a button that reads "Start an agent session using the prompt above"
             on the glass would not fit the control it labels. -->
        <button type="submit" data-session-start aria-label="Start an agent session using the prompt above" aria-describedby="${statusId}" disabled>Start</button>
        <button type="button" data-session-stop aria-label="Stop the agent session started here" aria-describedby="${statusId}" disabled>Stop</button>
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
  let stopping = false
  let ready = false
  /* Is a TURN running, as distinct from a session being open. The Controls
     panel's Pause is the only thing that needs the difference, and it needs it
     badly: interrupt() over an idle session succeeds and stops nothing, which
     is precisely the kind of control this product refuses to ship. */
  let working = false
  /* The prompt the current session was started with. Respawn is "the same work
     in a new process", so it needs the text; nothing else reads it and it never
     leaves this closure. */
  let lastPrompt = ''
  /* Assigned once, at the bottom of this mount, and published with every record
     so the Controls panel acts through this surface rather than around it. */
  let control = null

  const setStarted = (open) => {
    startButton.disabled = open || destroyed || !ready
    prompt.disabled = open
    stopButton.disabled = !open
  }

  /* EVERY CHANGE OF STATE IS ANNOUNCED, from one place.
     The Controls panel decides what it may do from this record, so a transition
     that forgot to publish would leave a live control pointed at a session that
     had ended. Publishing from a single helper called on every transition is
     what makes "the control is enabled" and "the session is open" the same
     fact rather than two facts that agree most of the time. */
  const publish = () => {
    if (destroyed || !sessionId) {
      publishLiveSession(null)
      return
    }
    publishLiveSession({
      agentId,
      sessionId,
      phase: stopping ? 'stopping' : (starting ? 'starting' : (working ? 'working' : 'open')),
      control,
    })
  }

  /* Close is best-effort by design: the main process also closes every session
     owned by a destroyed WebContents, so a failure here cannot strand a child
     past the window's life. */
  const closeSession = async () => {
    const id = sessionId
    if (!id) return
    stopping = true
    publish()
    sessionId = null
    /* THE INTERRUPT IS ASKED FOR ONLY WHEN THERE IS A TURN TO INTERRUPT.
     *
     * It used to be unconditional with the rejection swallowed, on the reasoning
     * that "no active turn is the common, expected case". The swallow works --
     * nothing user-visible went wrong -- but the rejection is not silent one
     * level up: Electron prints `Error occurred in handler for
     * 'mc-agent:interrupt': AgentHostError: Session <id> has no active turn`
     * with a full stack, and it did so on EVERY press of Stop, Respawn and
     * Terminate over an idle session. MEASURED on the real window
     * (tools/steering-controls-e2e.cjs): one such stack per respawn, on the
     * completely correct path. A product that logs an error while doing exactly
     * what was asked teaches whoever reads that log to ignore it, which is how
     * the next real fault goes unnoticed.
     *
     * ASKING FIRST IS NOT A WEAKER TEARDOWN. `working` false and a turn still
     * running would skip a graceful interrupt, and close() below still ends the
     * child either way -- so the failure mode of a wrong reading is a less
     * polite stop, never a surviving process. The opposite default, interrupting
     * something that is not there, buys nothing at all. */
    const hadTurn = working
    working = false
    if (hadTurn) {
      try { await bridge.interrupt({ sessionId: id }) } catch { /* the turn may finish between the read and the call */ }
    }
    try { await bridge.close({ sessionId: id }) } catch { /* the owner-destroyed path closes it regardless */ }
    stopping = false
    publish()
  }

  if (!bridge || typeof bridge.availability !== 'function') {
    actionState(status, 'unavailable', `unavailable · ${BRIDGE_ABSENT}`)
    /* No shell means no way to ask what a session would be confined to, so the
       copy states that absence instead of leaving the pending sentence up
       forever -- or, worse, falling back to the claim this repair removed. */
    renderConfinement(null)
    return () => { destroyed = true; surface.remove() }
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
      working = false
      publish()
      actionState(status, sessionTurnSucceeded(turnStatus) ? 'confirmed' : 'refused', `turn ${turnStatus} · session still open`)
    }
  })

  /* ONE START PATH, used by the form and by Respawn.
     Respawn is "this work again, in a new process". If it built its own start
     call the two would drift, and the half that drifted would be the one nobody
     watches -- so there is one, and Respawn passes the same text back into it. */
  const startSession = async (text) => {
    if (starting || sessionId || !ready || destroyed) return { ok: false, code: 'AGENT_SESSION_NOT_READY' }
    if (typeof text !== 'string' || text.trim() === '') return { ok: false, code: 'AGENT_SESSION_NO_PROMPT' }

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
      /* The table already has the sentence for this, with the remedy on it --
         "close ToolsEnabled and open it again". Printing a shorter, remedy-less
         version of a sentence that exists is how two copies of one message come
         to disagree. */
      actionState(status, 'refused', `refused · ${unavailableReason('AGENT_SESSION_NO_ID')}`)
      return { ok: false, code: 'AGENT_SESSION_NO_ID' }
    }

    try {
      sessionId = id
      publish()
      await bridge.start({ sessionId: id })
      if (destroyed) { await closeSession(); return { ok: false, code: 'AGENT_SESSION_VIEW_CLOSED' } }
      lastPrompt = text
      starting = false
      working = true
      publish()
      actionState(status, 'ready', 'running · session open')
      await bridge.send({ sessionId: id, text })
      return { ok: true }
    } catch (error) {
      /* An error message from the host can name a path. Report its code and a
         fixed sentence; never the message.

         READ THROUGH refusalCode() RATHER THAN OFF THE PROPERTY, because the
         property is gone by the time it gets here: Electron does not carry own
         properties across an IPC rejection, so this line used to resolve to
         AGENT_SESSION_FAILED for every refusal without exception -- which is
         the bare string a customer was shown. refusalCode() prefers
         `error.code` when it exists and otherwise recovers it from the message,
         accepting only values that are already keys of the copy table, so no
         text from the host can reach the DOM by that route. */
      const code = refusalCode(error)
      working = false
      if (sessionId) await closeSession()
      if (!destroyed) actionState(status, 'refused', `refused · ${unavailableReason(code)}`)
      return { ok: false, code }
    } finally {
      starting = false
      if (!destroyed) setStarted(Boolean(sessionId))
      publish()
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void startSession(String(prompt.value || '').trim())
  })

  const stopSession = async () => {
    if (!sessionId) return
    stopButton.disabled = true
    actionState(status, 'pending', 'stopping…')
    await closeSession()
    if (destroyed) return
    setStarted(false)
    actionState(status, ready ? 'ready' : 'unavailable', 'stopped · session closed')
  }
  stopButton.addEventListener('click', () => { void stopSession() })

  /* THE THREE STEERING ACTIONS, owned here because the session is owned here.
     Each returns {ok, code} rather than throwing: the Controls panel renders a
     refusal, and a rejected promise crossing a module boundary is how a control
     ends up reporting success for something that did not happen. */
  control = Object.freeze({
    /* Stops the running TURN. The session stays open, so the transcript, the
       Stop control and the record all stay exactly where they were. */
    async pause() {
      if (!sessionId || !working) return { ok: false, code: 'AGENT_TURN_NONE' }
      const id = sessionId
      try {
        await bridge.interrupt({ sessionId: id })
      } catch (error) {
        return { ok: false, code: typeof error?.code === 'string' ? error.code : 'AGENT_SESSION_FAILED' }
      }
      if (destroyed || sessionId !== id) return { ok: true }
      /* Set here rather than waited for. The host may or may not emit a turn
         status for an interrupted turn, and a control whose effect is only
         visible if an optional event arrives is a control that intermittently
         appears to do nothing. The event handler sets the same flag the same
         way if it does arrive. */
      working = false
      publish()
      actionState(status, 'ready', 'stopped · turn interrupted · session still open')
      return { ok: true }
    },
    async terminate() {
      if (!sessionId) return { ok: false, code: 'AGENT_SESSION_UNKNOWN' }
      await stopSession()
      return { ok: true }
    },
    /* Close, then start the same work again in a new child process. The two
       halves are reported separately: a respawn whose close succeeded and whose
       start failed has ENDED the session, and saying "respawned" over that
       would be the product describing a state it is not in. */
    async respawn() {
      if (!sessionId) return { ok: false, code: 'AGENT_SESSION_UNKNOWN' }
      const text = lastPrompt
      await stopSession()
      if (destroyed) return { ok: false, code: 'AGENT_SESSION_VIEW_CLOSED' }
      if (!text) return { ok: false, code: 'AGENT_SESSION_NO_PROMPT' }
      return startSession(text)
    },
  })

  return () => {
    destroyed = true
    /* A scheduled frame outlives the element it would write into, so it is
       cancelled here rather than left to fire against a detached surface. */
    appender.dispose()
    if (unsubscribe) unsubscribe()
    void closeSession()
    /* The record goes with the surface. A stale record would leave the Controls
       panel offering Terminate for a session whose owner has navigated away --
       and closeSession() above is asynchronous, so waiting for it to publish
       would leave a window in which exactly that is true. */
    publishLiveSession(null)
    surface.remove()
  }
}
