import { el } from './components.js'
import { bridgeStatus, postBridgeAction } from './mission-bridge.js'
import { isWriteEnabled } from './write-flags.js'

const esc = value => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

function actionState(node, kind, text) {
  node.dataset.state = kind
  node.textContent = text
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
      actionState(output, ready ? 'ready' : 'unavailable', ready
        ? `strict snapshot ready · ${snapshot.indexed ? 'indexed corpus' : 'single queue'}`
        : `queue unavailable · ${snapshot?.reason || 'no strict snapshot'}`)
    }
    select.addEventListener('change', update)
    update()
  }
}

async function prepareSurface(surface) {
  const status = surface.querySelector('[data-write-status]')
  for (const control of surface.querySelectorAll('button, input, textarea, select')) control.disabled = true
  actionState(status, 'checking', 'checking audited bridge…')
  const result = await bridgeStatus()
  if (!result.ok) {
    actionState(status, 'unavailable', `bridge unavailable · ${result.reason}`)
    surface.dataset.bridgeState = 'unavailable'
    for (const control of surface.querySelectorAll('button, input, textarea, select')) control.disabled = true
    return result
  }
  populateRoots(surface, Array.isArray(result.roots) ? result.roots : [])
  surface.dataset.bridgeState = 'ready'
  const discord = result.channels?.discord
  actionState(status, 'ready', discord?.ok === false
    ? 'audited bridge ready · discord channel unavailable'
    : 'audited bridge ready')
  for (const control of surface.querySelectorAll('button, input, textarea, select')) control.disabled = false
  configureQueueSnapshots(surface, result.queues)
  return result
}

export function mountAgentWriteSurface(root, { agentId }) {
  const dispatchEnabled = isWriteEnabled('dispatch')
  const reportEnabled = isWriteEnabled('report-read')
  if (!dispatchEnabled && !reportEnabled) return () => {}

  const surface = el(`<section class="write-surface agent-write-surface" aria-label="Audited agent actions">
    <header><strong>Audited actions</strong><span data-write-status role="status">not connected</span></header>
    <div class="write-surface-grid">
      ${dispatchEnabled ? `<form class="write-form" data-dispatch-form>
        <span class="write-form-title">Dispatch agent lane</span>
        <label>Root<select data-root-select aria-label="Dispatch worktree root"></select></label>
        <label>Tier<select name="tier"><optgroup label="Codex"><option value="luna">Luna · medium</option><option value="terra">Terra · high</option><option value="sol">Sol · ultra</option></optgroup><optgroup label="Claude"><option value="claude-fable">Fable</option><option value="claude-sonnet">Sonnet</option><option value="claude-opus">Opus</option></optgroup></select></label>
        <label>Objective<input name="objectiveRef" maxlength="80" value="agent-${esc(agentId)}" required /></label>
        <label class="write-wide">Brief<textarea name="brief" maxlength="16000" rows="2" required></textarea></label>
        <button type="submit">Dispatch</button>
        <output data-action-output role="status"></output>
      </form>` : ''}
      ${reportEnabled ? `<form class="write-form" data-report-form>
        <span class="write-form-title">Read agent report</span>
        <label>Root<select data-root-select aria-label="Report worktree root"></select></label>
        <label class="write-wide">Report path<input name="relativePath" maxlength="260" value="P5-REPORT.md" required /></label>
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
  dispatchForm?.addEventListener('submit', async event => {
    event.preventDefault()
    const output = dispatchForm.querySelector('[data-action-output]')
    const data = new FormData(dispatchForm)
    setBusy(dispatchForm, true)
    actionState(output, 'pending', 'dispatching…')
    const result = await postBridgeAction('dispatch', {
      rootId: dispatchForm.querySelector('[data-root-select]').value,
      tier: data.get('tier'), objectiveRef: data.get('objectiveRef'), brief: data.get('brief'),
      cap: { kind: 'turns', value: 8, capMs: 20 * 60_000 },
    })
    if (destroyed) return
    setBusy(dispatchForm, false)
    actionState(output, result.ok ? 'confirmed' : 'refused', result.ok
      ? `confirmed · ${result.receipt.launchId}`
      : `refused · ${result.code || 'BRIDGE_REFUSED'} · ${result.reason}`)
  })

  const reportForm = surface.querySelector('[data-report-form]')
  reportForm?.addEventListener('submit', async event => {
    event.preventDefault()
    const output = reportForm.querySelector('[data-action-output]')
    const content = reportForm.querySelector('[data-report-content]')
    const data = new FormData(reportForm)
    content.hidden = true
    setBusy(reportForm, true)
    actionState(output, 'pending', 'reading…')
    const result = await postBridgeAction('report-read', {
      rootId: reportForm.querySelector('[data-root-select]').value,
      relativePath: data.get('relativePath'),
    })
    if (destroyed) return
    setBusy(reportForm, false)
    actionState(output, result.ok ? 'confirmed' : 'refused', result.ok
      ? `confirmed · ${result.receipt.bytes} bytes`
      : `refused · ${result.reason}`)
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
    <header><strong>Audited actions</strong><span data-write-status role="status">not connected</span></header>
    <div class="write-surface-grid">
      ${decisionEnabled ? `<form class="write-form" data-decision-form>
        <span class="write-form-title">Decision record</span>
        <label>Target<input name="target" maxlength="160" placeholder="R or Q id" required /></label>
        <label class="write-wide">Reason<input name="reason" maxlength="2000" required /></label>
        <div class="write-choice"><button type="button" data-decision="approve">Approve</button><button type="button" data-decision="decline">Decline</button></div>
        <output data-action-output role="status"></output>
      </form>` : ''}
      ${queueEnabled ? `<form class="write-form" data-queue-form>
        <span class="write-form-title">Strict queue transition</span>
        <label>Root<select data-root-select aria-label="Queue worktree root"></select></label>
        <label>Phase<input name="phaseId" maxlength="4" placeholder="Q103" required /></label>
        <label class="write-wide">Observed queue SHA-256<input name="expectedHash" minlength="64" maxlength="64" required /></label>
        <label class="write-wide">Close reason<input name="reason" maxlength="2000" placeholder="required only for close" /></label>
        <div class="write-choice"><button type="button" data-queue-operation="claim">Claim</button><button type="button" data-queue-operation="close">Close</button></div>
        <output data-action-output role="status"></output>
      </form>` : ''}
    </div>
  </section>`)
  root.querySelector('.ledger-toolbar')?.insertAdjacentElement('afterend', surface)
  let destroyed = false
  void prepareSurface(surface).then(() => { if (destroyed) surface.remove() })

  const decisionForm = surface.querySelector('[data-decision-form]')
  decisionForm?.addEventListener('click', async event => {
    const button = event.target.closest('button[data-decision]')
    if (!button || !decisionForm.reportValidity()) return
    const data = new FormData(decisionForm)
    const output = decisionForm.querySelector('[data-action-output]')
    setBusy(decisionForm, true)
    actionState(output, 'pending', 'recording…')
    const result = await postBridgeAction('decision', {
      idempotencyKey: crypto.randomUUID(), target: data.get('target'),
      decision: button.dataset.decision, reason: data.get('reason'),
    })
    if (destroyed) return
    setBusy(decisionForm, false)
    actionState(output, result.ok ? 'confirmed' : 'refused', result.ok
      ? `confirmed · revision ${result.receipt.revision}`
      : `refused · ${result.reason}`)
  })

  const queueForm = surface.querySelector('[data-queue-form]')
  queueForm?.addEventListener('click', async event => {
    const button = event.target.closest('button[data-queue-operation]')
    if (!button || !queueForm.reportValidity()) return
    const data = new FormData(queueForm)
    const output = queueForm.querySelector('[data-action-output]')
    setBusy(queueForm, true)
    actionState(output, 'pending', `${button.dataset.queueOperation} pending…`)
    const result = await postBridgeAction('queue', {
      rootId: queueForm.querySelector('[data-root-select]').value,
      expectedHash: data.get('expectedHash'), phaseId: data.get('phaseId'),
      operation: button.dataset.queueOperation, reason: data.get('reason') || undefined,
    })
    if (destroyed) return
    setBusy(queueForm, false)
    actionState(output, result.ok ? 'confirmed' : 'refused', result.ok
      ? `confirmed · ${result.receipt.action}`
      : `refused · ${result.reason}`)
    if (result.ok) queueForm.elements.expectedHash.value = result.receipt.nextHash
  })

  return () => { destroyed = true }
}
