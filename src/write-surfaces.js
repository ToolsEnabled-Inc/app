/* THE AUDITED ACTIONS PANEL, IN WORDS SOMEBODY WHO DID NOT WRITE IT CAN USE.
 *
 * This is the panel a person meets the first time they switch a write action on,
 * which is the first moment this product does anything on their behalf. It was
 * written from inside the system, and it read like it: "audited bridge ready",
 * "strict snapshot ready · indexed corpus", "queue unavailable · no strict
 * snapshot", "bridge unavailable · ...", a field labelled "Observed queue
 * SHA-256", and four confirmations that answered with a launch id, a byte count,
 * a revision number and an internal action name.
 *
 * Not one of those names a thing the reader owns. src/local-activity.js wrote
 * the rule down for the home screen -- "A person opening this product owns
 * agents, a computer, and some decisions waiting on them; they do not own a
 * projection" -- and it was enforced on exactly one screen. This is the same
 * rule here.
 *
 * THE FIELD LABELS CHANGED AND THE FIELD NAMES DID NOT. `name="objectiveRef"`,
 * `name="expectedHash"` and the rest are what the audited connection is posted,
 * so they are untouched; what changed is the word above the box. A label is for
 * the person and a field name is for the wire, and this file had been using one
 * string for both.
 *
 * EVERY REFUSAL NOW GOES THROUGH refusalSentence(). Three of the five did not:
 * they printed the engine's `reason` alone, which is a diagnosis, and a
 * diagnosis is not something a person can act on. src/refusal-copy.js is the
 * module that owns the remedy half, and its own header lists this file among the
 * nine sites that were still printing raw.
 */

import { el } from './components.js'
import { bridgeStatus, bridgeReachable, postBridgeAction } from './mission-bridge.js'
/* THE ANSWER TO A WRITE THIS SURFACE ALREADY SENT AND NEVER GOT TO SHOW.
 *
 * Three keys -- BRIDGE_DISPATCH, BRIDGE_DECISION, BRIDGE_QUEUE -- were declared
 * in ./write-outcomes.js and consumed by NOTHING. Every settle path in this file
 * returned on `destroyed` BEFORE it had a sentence, so an audited dispatch, an
 * approval or a queue close whose answer arrived a moment after the person left
 * the page ended in silence, and silence about a write reads as "it did not
 * happen". The three sibling controllers that got this right -- agent-loops,
 * agent-teams, cloud-tasks-controller, mission-bridge's archive -- file the
 * outcome first and ask about their own screen second. So does this file now,
 * and the stylesheet's `.write-restated` rules, which have shipped for a line no
 * code rendered, finally have one to colour. */
import {
  WRITE_OUTCOME_KEYS,
  clearUndeliveredWrite,
  recordUndeliveredWrite,
  restatedMessage,
  undeliveredWrite,
} from './write-outcomes.js'
import { retryWhileUnavailable } from './bridge-retry.js'
import { isWriteEnabled } from './write-flags.js'
/* The identifier goes on the node as `data-refusal-code`, never into the
   sentence — see ./refusal-copy.js. */
import { markRefusalCode, refusalCodeOf, refusalSentence } from './refusal-copy.js'
/* The assistants this copy can hand work to, read from the one place that
   declares them. They were typed out here as six <option> elements with their
   ids and effort words in the visible text -- a second copy of a list that is
   already data, and one that would go stale silently. */
import { LAUNCH_TIERS } from './orchestration-controls.js'
/* The panel's words for how a job ended, and the loop that waits for them.
   Kept in their own module so a test can drive them without a browser. */
import { launchOutcomeCopy, watchLaunchOutcome } from './launch-outcome-copy.js'

const esc = value => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

function actionState(node, kind, text) {
  node.dataset.state = kind
  node.textContent = text
}


/* THE ASSISTANTS, GROUPED BY WHO MAKES THEM AND ORDERED AS THEY ARE DECLARED.
 *
 * The six options were typed out here by hand as `Luna · medium`, `Terra ·
 * high`, `Sol · ultra` and three bare Claude names -- a second copy of
 * LAUNCH_TIERS with two problems. It could go stale without anything noticing,
 * and "Luna · medium" tells a first-time reader nothing: `medium` is the
 * reasoning effort, and the word does not say so.
 *
 * The VALUE is still the tier id, because that is what the audited connection is
 * posted; only the words above it changed. An id is for the wire and a label is
 * for the person, and this control had been using one string for both. */
function assistantOptions() {
  const groups = [
    { provider: 'codex', label: 'From OpenAI' },
    { provider: 'claude', label: 'From Anthropic' },
  ]
  return groups.map(group => {
    const tiers = LAUNCH_TIERS.filter(tier => tier.provider === group.provider)
    if (tiers.length === 0) return ''
    return `<optgroup label="${esc(group.label)}">${tiers.map(tier => {
      /* Effort is a real difference a person pays for in time, so it is named in
         words rather than left as the engine's own key. A tier with no effort
         setting says nothing rather than inventing one. */
      const effort = { medium: 'thinks a little', high: 'thinks harder', xhigh: 'thinks hardest' }[tier.effort]
      return `<option value="${esc(tier.id)}">${esc(tier.label)}${effort ? ` — ${esc(effort)}` : ''}</option>`
    }).join('')}</optgroup>`
  }).join('')
}

function setBusy(form, busy) {
  for (const control of form.querySelectorAll('button, input, textarea, select')) control.disabled = busy
  form.toggleAttribute('aria-busy', busy)
}

function populateRoots(surface, roots) {
  for (const select of surface.querySelectorAll('select[data-root-select]')) {
    select.replaceChildren(...roots.map(rootId => {
      const option = document.createElement('option')
      option.value = rootId
      option.textContent = rootId
      return option
    }))
  }
}

function configureQueueSnapshots(surface, queues) {
  for (const form of surface.querySelectorAll('[data-queue-form]')) {
    const select = form.querySelector('[data-root-select]')
    const hash = form.elements.expectedHash
    const output = form.querySelector('[data-action-output]')
    hash.readOnly = true
    const update = () => {
      const snapshot = queues?.[select.value]
      const ready = snapshot?.ok === true && /^[a-f0-9]{64}$/.test(snapshot.hash)
      hash.value = ready ? snapshot.hash : ''
      for (const button of form.querySelectorAll('button[data-queue-operation]')) button.disabled = !ready
      /* WHAT THIS LINE USED TO SAY: "strict snapshot ready · indexed corpus",
         or "queue unavailable · no strict snapshot". Three mechanism names in
         two states, above a field the person cannot type into anyway. What they
         need to know is whether the two buttons will work and, if not, why. */
      actionState(output, ready ? 'ready' : 'unavailable', ready
        ? 'This folder’s work list was read just now, so Claim and Close are ready.'
        : `This folder’s work list could not be read, so Claim and Close are off. ${snapshot?.reason || 'Pick another folder, or press Retry above.'}`)
    }
    select.addEventListener('change', update)
    update()
  }
}

function unavailableState(surface, status, result) {
  /* THE SENTENCE, NOT THE DIAGNOSIS. This printed `bridge unavailable · ` and
     then whatever the layer said, which on a clean machine is a sentence about
     a service the reader has never heard of and cannot start. refusalSentence()
     keeps that diagnosis verbatim and puts a remedy after it, every time,
     including for a refusal that arrived with nothing in it at all. */
  actionState(status, 'unavailable', refusalSentence(result, {
    fallback: 'The audited connection is not answering, so nothing on this panel can be sent yet.',
  }))
  markRefusalCode(status, result)
  surface.dataset.bridgeState = 'unavailable'
  for (const control of surface.querySelectorAll('button, input, textarea, select')) control.disabled = true

  const retry = document.createElement('button')
  retry.type = 'button'
  retry.className = 'write-status-retry'
  retry.textContent = 'Retry'
  retry.setAttribute('aria-label', 'Try the audited connection again')
  retry.addEventListener('click', async () => {
    retry.disabled = true
    await prepareSurface(surface)
  })
  status.append(' ', retry)
}

async function prepareSurface(surface) {
  const status = surface.querySelector('[data-write-status]')
  for (const control of surface.querySelectorAll('button, input, textarea, select')) control.disabled = true
  actionState(status, 'checking', 'Checking the audited connection…')
  // Reachability first. NOTE, corrected 2026-08-09: this is NOT "the cheap
  // unauthenticated probe" the previous wording claimed. bridgeReachable()
  // calls session(), which resolves /v1/runtime discovery across the declared
  // port range AND performs the authenticated /v1/bootstrap handshake. It is
  // cheap only RELATIVE to /v1/status, which parses every root's queue and
  // writes durable audit receipts per root (~12s measured) — a snapshot cost,
  // not a heartbeat cost; blocking the panel on it made a healthy bridge read
  // as "unavailable · timed out".
  //
  // The distinction is load-bearing, which is why the wording is being fixed
  // rather than left to read well: a comment that understates a call's cost is
  // what invites the next reader to wrap it in a retry loop believing it is
  // free. Reachability IS retried below, deliberately and boundedly; /v1/status
  // is called at most once and must never be retried.
  const reach = await retryWhileUnavailable(() => bridgeReachable())
  if (!reach.ok) {
    unavailableState(surface, status, reach)
    return reach
  }
  const result = await bridgeStatus()
  if (!result.ok) {
    unavailableState(surface, status, result)
    return result
  }
  populateRoots(surface, Array.isArray(result.roots) ? result.roots : [])
  surface.dataset.bridgeState = 'ready'
  const discord = result.channels?.discord
  /* "audited bridge ready · discord channel unavailable" said two things a
     person does not have and one they do. The connection is this product's own,
     started with the window, so "Ready" is the whole of the good news; the
     Discord half is a real limit and now says what it costs. */
  actionState(status, 'ready', discord?.ok === false
    ? 'Ready. One message channel is offline, so a message sent to Discord will not arrive.'
    : 'Ready. Everything you do here is written down on this computer as it happens.')
  for (const control of surface.querySelectorAll('button, input, textarea, select')) control.disabled = false
  configureQueueSnapshots(surface, result.queues)
  return result
}

/**
 * The carried-over answer, drawn into the form that would have shown it.
 *
 * ITS OWN LINE, NEVER THE <output>. prepareSurface() finishes a fraction of a
 * second after mount and writes the bridge handshake's state into every
 * `[data-action-output]` on the surface, and configureQueueSnapshots() writes
 * the ready line after that. A restatement placed in the output is erased by
 * both, which is exactly the race tools/write-outcome-restate-qa.cjs was written
 * to catch. It sits ABOVE the output so the two read in the order they happened.
 *
 * `role="status"` and not `alert`: this is something that already finished. An
 * assertive live region interrupts whatever a screen reader is reading to
 * announce a result the person can act on at their leisure, which is shouting.
 */
function restateInto(form, key) {
  if (!form) return
  const missedOutcome = undeliveredWrite(key)
  if (!missedOutcome) return
  const line = el(`<p class="write-restated" role="status" data-undelivered-outcome="true"></p>`)
  line.dataset.state = missedOutcome.tone
  line.textContent = restatedMessage(missedOutcome)
  const output = form.querySelector('[data-action-output]')
  if (output) output.insertAdjacentElement('beforebegin', line)
  else form.appendChild(line)
}

/**
 * File the outcome, THEN ask whether this screen is still here.
 *
 * The order is the whole repair. Every caller below used to read
 * `if (destroyed) return` before it had composed its sentence, so the sentence
 * was never composed and the outcome was never filed -- and a refusal that
 * vanishes is indistinguishable from a write that succeeded quietly, which is
 * the direction this project has decided never to guess in.
 *
 * Returns whether the surface survived, so the caller paints only when there is
 * something to paint on.
 */
function settleWrite({ destroyed, key, tone, message }) {
  if (destroyed) recordUndeliveredWrite(key, { tone, message })
  else clearUndeliveredWrite(key)
  return !destroyed
}

export function mountAgentWriteSurface(root, { agentId, live = false }) {
  /* SAME FENCE, SAME REASON as mountAgentSessionSurface -- see the long note at
     its head for the measurement. This surface dispatches a real audited agent
     lane and reads real report files off a real worktree, and it was mounted on
     the demonstration copy of the agent page too, under the banner that says no
     control on that page reaches a real session. It was the quieter half of the
     same defect only because prepareSurface leaves its controls disabled until
     the bridge answers; that is a timing property of the bridge handshake, not a
     fence, and it is not the thing standing between a fake page and a real
     dispatch. `live` defaults to false so a caller that never considered the
     question cannot accidentally answer yes. */
  if (live !== true) return () => {}
  const dispatchEnabled = isWriteEnabled('dispatch')
  const reportEnabled = isWriteEnabled('report-read')
  if (!dispatchEnabled && !reportEnabled) return () => {}

  const surface = el(`<section class="write-surface agent-write-surface" aria-label="Audited agent actions">
    <header><strong>Audited actions</strong><span data-write-status role="status">Not connected yet</span></header>
    <div class="write-surface-grid">
      ${dispatchEnabled ? `<form class="write-form" data-dispatch-form>
        <span class="write-form-title">Hand work to an agent</span>
        <label>Folder<select data-root-select aria-label="The folder the work runs in"></select></label>
        <label>Which assistant<select name="tier">${assistantOptions()}</select></label>
        <label>Name for this job<input name="objectiveRef" maxlength="80" value="agent-${esc(agentId)}" required /></label>
        <label class="write-wide">What you want done<textarea name="brief" maxlength="16000" rows="2" required></textarea></label>
        <button type="submit">Hand it over</button>
        <output data-action-output role="status"></output>
      </form>` : ''}
      ${reportEnabled ? `<form class="write-form" data-report-form>
        <span class="write-form-title">Read agent report</span>
        <label>Folder<select data-root-select aria-label="The folder the report is read from"></select></label>
        <label class="write-wide">Which report<input name="relativePath" maxlength="260" value="P5-REPORT.md" required /></label>
        <button type="submit">Read report</button>
        <output data-action-output role="status"></output>
        <pre class="write-report" data-report-content hidden tabindex="0"></pre>
      </form>` : ''}
    </div>
  </section>`)
  root.querySelector('.agent-strip')?.insertAdjacentElement('afterend', surface)
  let destroyed = false
  void prepareSurface(surface).then(() => { if (destroyed) surface.remove() })

  const dispatchForm = surface.querySelector('[data-dispatch-form]')
  restateInto(dispatchForm, WRITE_OUTCOME_KEYS.BRIDGE_DISPATCH)
  dispatchForm?.addEventListener('submit', async event => {
    event.preventDefault()
    const output = dispatchForm.querySelector('[data-action-output]')
    const data = new FormData(dispatchForm)
    setBusy(dispatchForm, true)
    actionState(output, 'pending', 'Handing it over…')
    const result = await postBridgeAction('dispatch', {
      rootId: dispatchForm.querySelector('[data-root-select]').value,
      tier: data.get('tier'), objectiveRef: data.get('objectiveRef'), brief: data.get('brief'),
      cap: { kind: 'turns', value: 8, capMs: 20 * 60_000 },
    })
    /* The code is resolved ONCE and used for both channels. Resolving it matters
       on the sentence side too: an unresolved code falls to the generic remedy,
       and `BRIDGE_REFUSED` has a curated one. */
    const refusal = result.ok ? null : { code: refusalCodeOf(result) || 'BRIDGE_REFUSED', reason: result.reason }
    /* WHAT A CONFIRMATION SAYS. It said `confirmed · ` and then the launch id --
       a 20-character key, in front of a person who had just handed a job to an
       assistant and wanted to know whether it had started. The id is kept where
       a support conversation can still reach it and out of the sentence. */
    const tone = result.ok ? 'confirmed' : 'refused'
    const message = result.ok
      ? 'Handed over, and written down on this computer. The assistant is working on it now.'
      : `Nothing was handed over. ${refusalSentence(refusal, { fallback: 'The audited connection refused it and gave no receipt.' })}`
    /* A REAL LANE MAY HAVE STARTED. Composed and filed before this asks whether
       its own screen survived -- see settleWrite(). */
    if (!settleWrite({ destroyed, key: WRITE_OUTCOME_KEYS.BRIDGE_DISPATCH, tone, message })) return
    setBusy(dispatchForm, false)
    if (result.ok) output.dataset.launchId = result.receipt.launchId
    else delete output.dataset.launchId
    actionState(output, tone, message)
    markRefusalCode(output, refusal)
    /* AND THEN KEEP LOOKING. Everything above happens in the first second; the
       job runs for minutes. Without this the sentence above was the panel's last
       word, whatever actually became of the assistant. */
    if (!result.ok) return
    const watchedId = result.receipt.launchId
    void watchLaunchOutcome({
      launchId: watchedId,
      capMs: 20 * 60_000,
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      /* `false` means stop asking: the panel is gone, or the person has handed
         over another job and this answer is no longer the one on screen. */
      ask: id => (destroyed || output.dataset.launchId !== watchedId
        ? false
        : postBridgeAction('launch-status', { launchId: id })),
      onOutcome: receipt => {
        if (destroyed || output.dataset.launchId !== watchedId) return
        const copy = launchOutcomeCopy(receipt)
        actionState(output, copy.kind === 'pending' ? 'confirmed' : copy.kind, copy.text)
      },
    })
  })

  const reportForm = surface.querySelector('[data-report-form]')
  reportForm?.addEventListener('submit', async event => {
    event.preventDefault()
    const output = reportForm.querySelector('[data-action-output]')
    const content = reportForm.querySelector('[data-report-content]')
    const data = new FormData(reportForm)
    content.hidden = true
    setBusy(reportForm, true)
    actionState(output, 'pending', 'Reading…')
    const result = await postBridgeAction('report-read', {
      rootId: reportForm.querySelector('[data-root-select]').value,
      relativePath: data.get('relativePath'),
    })
    if (destroyed) return
    setBusy(reportForm, false)
    /* A byte count is not what a person came for, and the raw `reason` was a
       diagnosis with no next step. Both are replaced; the code still travels on
       the node for a support conversation. */
    actionState(output, result.ok ? 'confirmed' : 'refused', result.ok
      ? 'Read. Nothing on this computer was changed — the report is below.'
      : `The report was not read. ${refusalSentence(result, { fallback: 'The audited connection refused it and did not say why.' })}`)
    markRefusalCode(output, result.ok ? null : result)
    if (result.ok) {
      content.textContent = result.receipt.content
      content.hidden = false
    }
  })

  return () => { destroyed = true }
}

export function mountLedgerWriteSurface(root) {
  const decisionEnabled = isWriteEnabled('decision')
  const queueEnabled = isWriteEnabled('queue')
  if (!decisionEnabled && !queueEnabled) return () => {}
  const surface = el(`<section class="write-surface ledger-write-surface" aria-label="Audited ledger actions">
    <header><strong>Audited actions</strong><span data-write-status role="status">Not connected yet</span></header>
    <div class="write-surface-grid">
      ${decisionEnabled ? `<form class="write-form" data-decision-form>
        <span class="write-form-title">Approve or decline a request</span>
        <label>Which request<input name="target" maxlength="160" placeholder="its number, as shown in the list" required /></label>
        <label class="write-wide">Why<input name="reason" maxlength="2000" required /></label>
        <div class="write-choice"><button type="button" data-decision="approve">Approve</button><button type="button" data-decision="decline">Decline</button></div>
        <output data-action-output role="status"></output>
      </form>` : ''}
      ${queueEnabled ? `<form class="write-form" data-queue-form>
        <span class="write-form-title">Take or finish queued work</span>
        <label>Folder<select data-root-select aria-label="The folder whose work list this is"></select></label>
        <label>Which item<input name="phaseId" maxlength="4" placeholder="its number, as shown in the list" required /></label>
        <!-- THE FIELD A PERSON CANNOT TYPE INTO, AND USED TO BE ASKED TO.
             It was labelled "Observed queue SHA-256". It is filled in for them
             from the list that was just read, it is read-only, and its whole job
             is to make sure nobody closes an item on a stale view of the list.
             So the label says what it is FOR. The field name is unchanged. -->
        <label class="write-wide">Proof you are looking at the current list<input name="expectedHash" minlength="64" maxlength="64" required /></label>
        <label class="write-wide">Why you are closing it<input name="reason" maxlength="2000" placeholder="needed only when you close one" /></label>
        <div class="write-choice"><button type="button" data-queue-operation="claim">Claim</button><button type="button" data-queue-operation="close">Close</button></div>
        <output data-action-output role="status"></output>
      </form>` : ''}
    </div>
  </section>`)
  root.querySelector('.ledger-toolbar')?.insertAdjacentElement('afterend', surface)
  let destroyed = false
  void prepareSurface(surface).then(() => { if (destroyed) surface.remove() })

  const decisionForm = surface.querySelector('[data-decision-form]')
  restateInto(decisionForm, WRITE_OUTCOME_KEYS.BRIDGE_DECISION)
  decisionForm?.addEventListener('click', async event => {
    const button = event.target.closest('button[data-decision]')
    if (!button || !decisionForm.reportValidity()) return
    const data = new FormData(decisionForm)
    const output = decisionForm.querySelector('[data-action-output]')
    setBusy(decisionForm, true)
    actionState(output, 'pending', 'Recording…')
    const result = await postBridgeAction('decision', {
      idempotencyKey: crypto.randomUUID(), target: data.get('target'),
      decision: button.dataset.decision, reason: data.get('reason'),
    })
    /* A REVISION NUMBER IS NOT AN ANSWER. What a person wants to know, having
       just approved something, is that it is recorded and that other parts of
       the system will act on it. The revision is kept on the node. */
    const tone = result.ok ? 'confirmed' : 'refused'
    const message = result.ok
      ? `${button.dataset.decision === 'approve' ? 'Approved' : 'Declined'}, with your reason, on the permanent record. This is what the rest of the system acts on.`
      : `Nothing was recorded, so nothing was ${button.dataset.decision === 'approve' ? 'approved' : 'declined'}. ${refusalSentence(result, { fallback: 'The audited connection refused it and did not say why.' })}`
    /* An approval is permanent. Filed before this asks about its own screen. */
    if (!settleWrite({ destroyed, key: WRITE_OUTCOME_KEYS.BRIDGE_DECISION, tone, message })) return
    setBusy(decisionForm, false)
    if (result.ok) output.dataset.revision = String(result.receipt.revision)
    else delete output.dataset.revision
    actionState(output, tone, message)
    markRefusalCode(output, result.ok ? null : result)
  })

  const queueForm = surface.querySelector('[data-queue-form]')
  restateInto(queueForm, WRITE_OUTCOME_KEYS.BRIDGE_QUEUE)
  queueForm?.addEventListener('click', async event => {
    const button = event.target.closest('button[data-queue-operation]')
    if (!button || !queueForm.reportValidity()) return
    const data = new FormData(queueForm)
    const output = queueForm.querySelector('[data-action-output]')
    const claiming = button.dataset.queueOperation === 'claim'
    setBusy(queueForm, true)
    actionState(output, 'pending', claiming ? 'Claiming it…' : 'Closing it…')
    const result = await postBridgeAction('queue', {
      rootId: queueForm.querySelector('[data-root-select]').value,
      expectedHash: data.get('expectedHash'), phaseId: data.get('phaseId'),
      operation: button.dataset.queueOperation, reason: data.get('reason') || undefined,
    })
    /* `result.receipt.action` is the operation's own key, so the confirmation
       used to answer a press of Claim with the word "claim". It said nothing the
       press had not already said, and nothing about what it now means. */
    const tone = result.ok ? 'confirmed' : 'refused'
    const message = result.ok
      ? (claiming
        ? 'Claimed. It is yours now, and nobody else will pick it up.'
        : 'Closed. Everything else in the system now treats this work as finished.')
      : `${claiming ? 'It was not claimed' : 'It was not closed'}, and nothing changed. ${refusalSentence(result, { fallback: 'The audited connection refused it and did not say why.' })}`
    /* A claim other people are now excluded from, or a close the whole system
       acts on. Filed before this asks about its own screen. */
    if (!settleWrite({ destroyed, key: WRITE_OUTCOME_KEYS.BRIDGE_QUEUE, tone, message })) return
    setBusy(queueForm, false)
    actionState(output, tone, message)
    markRefusalCode(output, result.ok ? null : result)
    if (result.ok) queueForm.elements.expectedHash.value = result.receipt.nextHash
  })

  return () => { destroyed = true }
}
