/* Codex Cloud, from inside the product: the two places it appears.
 *
 * THE GAP THIS CLOSES. The owner's ruling is blunt and was repeated: "codex
 * cloud launch is literally a product feature it should work from the
 * software." The capability was finished and proven against the real provider
 * -- cloud.task_launch / task_status / task_list are in the shipped registry,
 * permission-gated, audited, and real cloud tasks ran to completion through
 * them. The INTERFACE had nothing. A grep for "cloud" across every renderer
 * source file returned one hit, in an unrelated account module, and the built
 * bundle contained zero. So the product carried a working remote-agent
 * capability that no user could reach, which from inside the app is
 * indistinguishable from not having built it.
 *
 * AND THE HALF THAT WAS STILL MISSING AFTER THAT. The first version of this
 * surface asked the person to TYPE a 32-character environment id. That is not a
 * launcher, it is a form for someone who already has the answer: the id appears
 * only in a web URL, `codex cloud list --json` reports `environment_id: null`
 * for every task it lists, and codex-cli 0.146.0 has no environment subcommand
 * at all (all three measured 2026-08-11). Machine B's offload report named the
 * same wall from the other side. So this surface now CHOOSES from the
 * environments the configured accounts are authorized for, SHOWS the source
 * repository each one is bound to, DECLARES that repository with the launch,
 * keeps the submission receipt on the glass, and follows the task's status by
 * itself.
 *
 * WHERE IT LIVES, AND WHY NOT ON A PAGE OF ITS OWN. A cloud task is an agent
 * that runs somewhere else. It belongs where the local agents already are: the
 * agent page (`mountCloudTaskSurface`, beside the local session surface) and the
 * fleet board's control rail (`cloudControlsBox`, beside Launch, Team and Loop).
 * A separate "Cloud" route would have made the same claim the product keeps
 * making by accident -- that remote work is a different kind of thing -- and
 * would have needed its own navigation entry, its own empty state, and its own
 * answer to "where did my agents go".
 *
 * WHAT IT DOES NOT DO, stated because the spec is explicit that pretending
 * otherwise costs real time (docs/CODEX-CLOUD-INTERFACE.md):
 *   - There is no cancel. Once the provider accepts a task it runs. No control
 *     here offers one, and the confirm step says so before the launch.
 *   - It does not apply diffs. Reading and staging a task's changes is not part
 *     of this surface, and nothing here implies a task's work has landed.
 *   - Silence is not success. A task absent from the searched window is
 *     reported unknown, never finished, and never quietly dropped from the list.
 *
 * The rules live in ./cloud-tasks-controller.js, which has no DOM and no
 * stylesheet so that a plain `node --test` run can exercise them. This file is
 * markup and wiring.
 */
import { el } from './components.js'
import { setWriteEnabled } from './write-flags.js'
import { postBridgeAction } from './mission-bridge.js'
import {
  bindingText,
  cloudAvailability,
  cloudStateView,
  createCloudTaskController,
  environmentSummary,
  findEnvironment,
  readRemembered,
} from './cloud-tasks-controller.js'
import './cloud.css'

export {
  CLOUD_STATES,
  TERMINAL_CLOUD_STATES,
  accountSummary,
  cloudAvailability,
  cloudStateView,
  createCloudTaskController,
  environmentSummary,
  environmentsMessage,
} from './cloud-tasks-controller.js'

function stateNode(node, tone, text) {
  if (!node) return
  node.dataset.state = tone
  node.textContent = text
}

function taskRow(task) {
  const view = cloudStateView(task.state)
  const row = el(`<li class="cloud-task">
    <span class="cloud-task-state" data-tone=""></span>
    <span class="cloud-task-title"></span>
    <span class="cloud-task-meta"></span>
  </li>`)
  const pill = row.querySelector('.cloud-task-state')
  pill.dataset.tone = view.tone
  pill.textContent = view.label
  row.querySelector('.cloud-task-title').textContent = task.title || task.taskId
  /* The provider's own word is shown beside ours, always. Our six-value
     vocabulary is a translation, and a translation that hides the original is
     how a person loses the ability to check it against the provider's site. */
  const meta = [task.taskId]
  if (task.providerStatus && task.providerStatus !== view.label) meta.push(task.providerStatus)
  if (task.environmentLabel) meta.push(task.environmentLabel)
  if (task.updatedAt) meta.push(task.updatedAt)
  row.querySelector('.cloud-task-meta').textContent = meta.join(' · ')
  return row
}

function accountOptions(select, accounts, defaultAccount) {
  const chosen = select.value
  const options = [el(`<option value="">Automatic${defaultAccount ? ` · ${defaultAccount}` : ''}</option>`)]
  for (const account of accounts) {
    const option = document.createElement('option')
    option.value = account.name
    /* The status is IN the option text rather than only disabling the row. A
       greyed-out account tells a person they cannot pick it and not why; the
       reason ("signed out", "99% used") is the entire actionable content. */
    option.textContent = `${account.name}${account.role ? ` · ${account.role}` : ''} · ${
      account.canServe
        ? (Number.isFinite(account.usedPercent) ? `${Math.round(account.usedPercent)}% used` : 'ready')
        : String(account.status || 'unavailable').replace(/_/g, ' ')
    }`
    options.push(option)
  }
  select.replaceChildren(...options)
  if (chosen && options.some(option => option.value === chosen)) select.value = chosen
}

/* The environment picker. An environment with no single repository is LISTED and
   DISABLED with its reason attached, never hidden: hiding it would leave a
   person searching for an environment they can see on the provider's own site,
   with nothing on this glass to explain why it is not offered. */
function environmentOptions(select, state) {
  const chosen = select.value
  const options = [el(`<option value="">${state.environmentsLoaded ? 'Choose an environment' : 'Not read yet'}</option>`)]
  for (const environment of state.environments) {
    const option = document.createElement('option')
    option.value = environment.environmentId
    option.textContent = environmentSummary(environment)
    if (environment.launchable !== true) option.disabled = true
    if (environment.repository) option.dataset.repository = environment.repository
    options.push(option)
  }
  select.replaceChildren(...options)
  if (chosen && options.some(option => option.value === chosen && !option.disabled)) select.value = chosen
}

/* The receipt, rendered from the frozen record only. Every line is a fact the
   provider acknowledged; nothing here is recomputed from the form. */
function renderReceipt(node, receipt) {
  if (!node) return
  if (!receipt) {
    node.hidden = true
    node.replaceChildren()
    return
  }
  node.hidden = false
  const rows = [
    ['task', receipt.taskId],
    ['state at submission', cloudStateView(receipt.state).label],
    ['environment', `${receipt.environmentLabel ? `${receipt.environmentLabel} · ` : ''}${receipt.environment || 'not reported'}`],
    ['repository', receipt.repository || 'not reported'],
    ['branch', receipt.branch || 'not reported'],
    ['account', receipt.account?.name || 'not reported'],
    ['submitted', receipt.submittedAt || 'not reported'],
    ['binding read', receipt.bindingReadAt || 'not reported'],
  ]
  const list = el('<ul class="cloud-receipt-list"></ul>')
  for (const [key, value] of rows) {
    const row = el('<li><span class="cloud-receipt-k"></span><span class="cloud-receipt-v"></span></li>')
    row.querySelector('.cloud-receipt-k').textContent = key
    row.querySelector('.cloud-receipt-v').textContent = String(value)
    list.append(row)
  }
  const title = el('<span class="cloud-receipt-title">Submitted — this record does not change</span>')
  node.replaceChildren(title, list)
}

/* The one control a switched-off panel needs: the switch. Same durable flag
   Settings writes, so turning it on here is turning it on everywhere. */
function offSwitch() {
  const button = el('<button type="button" class="cloud-enable" data-cloud-enable>Turn on Codex Cloud launching</button>')
  button.addEventListener('click', () => { setWriteEnabled('cloud-launch', true) })
  return button
}

/* ---------------------------------------------------------------- *
 * WHAT THE AGENT PAGE SHOWS WHILE THE FEATURE IS OFF.
 *
 * THE SAME SHAPE AS ITS NEIGHBOUR, DELIBERATELY. `mountSessionSwitchedOff` in
 * agent-session.js draws the identical statement for the identical situation --
 * a write surface whose flag is off -- and the two panels sit one above the
 * other on this page. A second composition for the second one is a difference
 * with no meaning behind it, so this borrows that one exactly: header, one
 * column, the reason, the switch.
 *
 * WHAT IT DOES NOT DRAW, AND WHY THAT IS THE FIX. It used to draw the whole
 * launcher dead: an environment picker with nothing in it, a branch field, an
 * account picker, an attempts picker, a prompt box, a disabled Launch, and
 * beside them a "Tasks on Codex Cloud" column holding a disabled Refresh and
 * two more copies of the switched-off sentence. Measured on the packaged build
 * at 1440px, that was a 420px panel in which every control was inert and one
 * fact was stated three times. A form nobody can submit is not information
 * about the feature, it is furniture in front of it.
 *
 * WHAT IS UNCHANGED, and this is the half that matters. The panel is still
 * DRAWN rather than removed -- that is the whole point of the flag-off case
 * (see cloudAvailability in cloud-tasks-controller.js: a person cannot turn on
 * a switch they have never been shown). It still names the state in the header,
 * still carries the reason verbatim, still says nothing is contacted, and still
 * offers the switch on the panel itself. Nothing was softened; one fact is
 * simply said once.
 * ---------------------------------------------------------------- */
function mountCloudSwitchedOff(root, anchor, availability) {
  const surface = el(`<section class="write-surface cloud-surface" data-cloud-off aria-label="Codex Cloud">
    <header><strong>Codex Cloud</strong><span data-cloud-status role="status">off · this computer cannot start a cloud task</span></header>
    <div class="write-surface-grid">
      <div class="write-form">
        <span class="write-form-title">Launching cloud tasks is switched off</span>
        <output class="write-wide" data-cloud-off-reason role="status"></output>
      </div>
    </div>
  </section>`)
  /* The reason is the availability note verbatim. It is written by the rule
     that decided the state, so the panel cannot drift into describing a
     situation the gate is not actually in. */
  stateNode(surface.querySelector('[data-cloud-off-reason]'), 'note', availability.note)
  if (availability.code === 'CLOUD_LAUNCH_SWITCHED_OFF') {
    surface.querySelector('.write-form').append(offSwitch())
  }
  root.querySelector(anchor)?.insertAdjacentElement('afterend', surface)
  return () => { surface.remove() }
}

/* ---------------------------------------------------------------- *
 * The agent-page surface. Built from the existing write-surface markup so it
 * reads as one of the audited actions rather than a bolted-on panel.
 * ---------------------------------------------------------------- */
export function mountCloudTaskSurface(root, { live = false, anchor = '.agent-strip', postAction = postBridgeAction } = {}) {
  /* THE SAME FENCE THE LOCAL SESSION SURFACE USES, FOR A STRONGER REASON.
     `live` defaults to false so a caller that never established the page is
     real gets no real control. The demonstration copy of the agent page tells
     the reader that nothing on it is running; a Codex Cloud launcher there
     would start real, billable, uncancellable remote work from a page that has
     just said it is an example. */
  if (live !== true) return () => {}

  const availability = cloudAvailability()
  /* THE GATE IS READ ONCE AND BRANCHES ONCE. Everything below this line is the
     surface for an installation that CAN launch; the other one is its own
     function, so a control that only makes sense when the feature is on cannot
     be reached, disabled, from a state where it is off. */
  if (!availability.ok) return mountCloudSwitchedOff(root, anchor, availability)

  const surface = el(`<section class="write-surface cloud-surface" aria-label="Codex Cloud">
    <header><strong>Codex Cloud</strong><span data-cloud-status role="status">checking…</span></header>
    <div class="write-surface-grid">
      <form class="write-form" data-cloud-form>
        <span class="write-form-title">Launch a cloud task</span>
        <label class="write-wide">Environment<select name="environment" data-cloud-environments aria-label="Codex Cloud environment" required><option value="">Not read yet</option></select></label>
        <output class="cloud-binding write-wide" data-cloud-binding role="status"></output>
        <label>Branch<input name="branch" maxlength="200" placeholder="branch on the remote" required /></label>
        <label>Account<select name="account" aria-label="Codex account to run this task under"><option value="">Automatic</option></select></label>
        <label>Attempts<select name="attempts" aria-label="Assistant attempts">${[1, 2, 3, 4, 5].map(n => `<option value="${n}">${n}</option>`).join('')}</select></label>
        <label class="write-wide">Prompt<textarea name="prompt" maxlength="16000" rows="3" required></textarea></label>
        <button type="submit" data-cloud-launch>Launch on Codex Cloud</button>
        <button type="button" data-cloud-cancel hidden>Not now</button>
        <output data-cloud-launch-output role="status"></output>
        <div class="cloud-receipt write-wide" data-cloud-receipt hidden></div>
        <output class="cloud-watch write-wide" data-cloud-watch role="status"></output>
      </form>
      <!-- THE READING COLUMN, COMPOSED AS ONE BLOCK. Refresh used to sit on a
           row of its own below the title, in the left half of a two-column
           grid, which is how this column came to read as a heading, a lone
           button and then a lot of nothing. It belongs on the title row: it is
           the verb for the thing the title names. -->
      <div class="write-form cloud-list" data-cloud-list>
        <div class="cloud-list-head">
          <span class="write-form-title">Tasks on Codex Cloud</span>
          <button type="button" data-cloud-refresh>Refresh</button>
        </div>
        <output class="write-wide" data-cloud-list-output role="status"></output>
        <output class="write-wide" data-cloud-environments-output role="status"></output>
        <ul class="cloud-task-list write-wide" data-cloud-tasks></ul>
      </div>
    </div>
  </section>`)

  root.querySelector(anchor)?.insertAdjacentElement('afterend', surface)

  const status = surface.querySelector('[data-cloud-status]')
  const form = surface.querySelector('[data-cloud-form]')
  const launchButton = surface.querySelector('[data-cloud-launch]')
  const cancelButton = surface.querySelector('[data-cloud-cancel]')
  const launchOutput = surface.querySelector('[data-cloud-launch-output]')
  const listOutput = surface.querySelector('[data-cloud-list-output]')
  const environmentsOutput = surface.querySelector('[data-cloud-environments-output]')
  const bindingOutput = surface.querySelector('[data-cloud-binding]')
  const receiptNode = surface.querySelector('[data-cloud-receipt]')
  const watchNode = surface.querySelector('[data-cloud-watch]')
  const refreshButton = surface.querySelector('[data-cloud-refresh]')
  const taskList = surface.querySelector('[data-cloud-tasks]')
  const accountSelect = form.elements.account
  const environmentSelect = form.elements.environment

  const remembered = readRemembered()
  form.elements.branch.value = remembered.branch

  const controller = createCloudTaskController({
    postAction,
    availability,
    onState: next => {
      stateNode(listOutput, next.listTone, next.listMessage)
      stateNode(environmentsOutput, next.environmentsTone, next.environmentsMessage)
      stateNode(launchOutput, next.launchTone, next.launchMessage)
      stateNode(watchNode, next.watchTone, next.watchMessage)
      renderReceipt(receiptNode, next.receipt)
      launchButton.textContent = next.launchLabel
      launchButton.classList.toggle('is-confirming', next.phase === 'armed')
      launchButton.disabled = next.phase === 'launching'
      cancelButton.hidden = next.phase !== 'armed'
      refreshButton.disabled = next.phase === 'launching'
      accountOptions(accountSelect, next.accounts, next.defaultAccount)
      environmentOptions(environmentSelect, next)
      if (!environmentSelect.value && remembered.environment
          && next.environments.some(environment => environment.environmentId === remembered.environment && environment.launchable === true)) {
        environmentSelect.value = remembered.environment
        applyEnvironment(next)
      }
      /* The whole state, not just the chosen environment: with nothing chosen
         this line has to say WHY, and "not read yet", "could not be read" and
         "read, none chosen" are three different answers. */
      stateNode(bindingOutput, 'note', bindingText(findEnvironment(next, environmentSelect.value), next))
      taskList.replaceChildren(...next.tasks.map(taskRow))
    },
  })

  /* Choosing an environment fills the branch with THAT environment's default,
     and clears it when the provider states none. The old form defaulted the
     field to "main" for every environment, which is the same defect in miniature
     as the ones this feature guards against: a value nobody established,
     presented as the answer, in a field that decides which code the cloud agent
     reads. */
  function applyEnvironment(state = controller.getState()) {
    const chosen = findEnvironment(state, environmentSelect.value)
    stateNode(bindingOutput, 'note', bindingText(chosen, state))
    form.elements.branch.value = chosen?.defaultBranch || ''
  }

  stateNode(status, 'ready', 'Codex Cloud ready · every launch asks for approval')

  void controller.loadAccounts()

  const onSubmit = event => {
    event.preventDefault()
    if (!controller.isArmed() && !form.reportValidity()) return
    const data = new FormData(form)
    void controller.click({
      environment: data.get('environment'),
      branch: data.get('branch'),
      prompt: data.get('prompt'),
      attempts: Number(data.get('attempts')) || 1,
      account: data.get('account') || null,
    })
  }
  const onCancel = () => { controller.disarm() }
  const onEnvironmentChange = () => { applyEnvironment() }
  const onRefresh = () => {
    void controller.loadAccounts()
    void controller.loadTasks({ environment: environmentSelect.value || undefined })
  }
  form.addEventListener('submit', onSubmit)
  cancelButton.addEventListener('click', onCancel)
  environmentSelect.addEventListener('change', onEnvironmentChange)
  refreshButton.addEventListener('click', onRefresh)

  return () => {
    form.removeEventListener('submit', onSubmit)
    cancelButton.removeEventListener('click', onCancel)
    environmentSelect.removeEventListener('change', onEnvironmentChange)
    refreshButton.removeEventListener('click', onRefresh)
    controller.destroy()
  }
}

/* ---------------------------------------------------------------- *
 * The fleet-board box. Same controller, the board's own markup, and the same
 * position in the rail as Launch / Team / Loop -- a cloud task is one more way
 * to start an agent from this computer, so it sits with the others.
 * ---------------------------------------------------------------- */
export function cloudControlsBox({ postAction = postBridgeAction } = {}) {
  const availability = cloudAvailability()
  const remembered = readRemembered()
  const box = el(`
    <div class="board-box board-cloud-box">
      <div class="board-box-h"><span class="bh-t">Codex Cloud</span></div>
      <div class="board-cap">an agent that runs on Codex Cloud instead of this computer</div>
      <label class="ctl-field"><span class="cl">Environment</span>
        <select class="ctl-select cloud-env" data-cloud="environment" aria-label="Codex Cloud environment"><option value="">Not read yet</option></select>
      </label>
      <div class="rail-sub cloud-binding" data-cloud="binding"></div>
      <label class="ctl-field"><span class="cl">Branch</span>
        <input class="ctl-num cloud-env" type="text" data-cloud="branch" maxlength="200" placeholder="branch on the remote" aria-label="Branch the cloud task runs against"/>
      </label>
      <label class="ctl-field"><span class="cl">Account</span>
        <select class="ctl-select" data-cloud="account" aria-label="Codex account"><option value="">Automatic</option></select>
      </label>
      <label class="ctl-field ctl-cloud-prompt"><span class="cl">Task</span>
        <textarea class="ctl-textarea" data-cloud="prompt" maxlength="16000" rows="2" aria-label="Cloud task prompt"></textarea>
      </label>
      <div class="rail-sub" data-cloud="note"></div>
      <div class="ctl-dispatch">
        <button class="ctl-btn" type="button" data-cloud="go">Launch on Codex Cloud</button>
        <button class="ctl-btn" type="button" data-cloud="cancel" hidden>Not now</button>
        <output class="ctl-out" data-cloud="out" role="status"></output>
      </div>
      <div class="cloud-receipt" data-cloud="receipt" hidden></div>
      <output class="ctl-out cloud-watch" data-cloud="watch" role="status"></output>
      <div class="ctl-dispatch">
        <button class="ctl-btn" type="button" data-cloud="refresh">Refresh tasks</button>
        <output class="ctl-out" data-cloud="list-out" role="status"></output>
      </div>
      <output class="ctl-out" data-cloud="environments-out" role="status"></output>
      <ul class="cloud-task-list" data-cloud="tasks"></ul>
    </div>`)

  const field = name => box.querySelector(`[data-cloud="${name}"]`)
  const goButton = field('go')
  const cancelButton = field('cancel')
  const refreshButton = field('refresh')
  const out = field('out')
  const listOut = field('list-out')
  const environmentsOut = field('environments-out')
  const bindingOut = field('binding')
  const receiptNode = field('receipt')
  const watchNode = field('watch')
  const taskList = field('tasks')
  const accountSelect = field('account')
  const environmentSelect = field('environment')

  field('branch').value = remembered.branch
  field('note').textContent = availability.ok
    ? 'A cloud task cannot be cancelled once Codex Cloud accepts it. Each launch asks for approval before anything is sent.'
    : availability.note

  const controller = createCloudTaskController({
    postAction,
    availability,
    onState: next => {
      stateNode(out, next.launchTone, next.launchMessage)
      stateNode(listOut, next.listTone, next.listMessage)
      stateNode(environmentsOut, next.environmentsTone, next.environmentsMessage)
      stateNode(watchNode, next.watchTone, next.watchMessage)
      renderReceipt(receiptNode, next.receipt)
      goButton.textContent = next.launchLabel
      goButton.disabled = next.phase === 'launching' || !availability.ok
      cancelButton.hidden = next.phase !== 'armed'
      refreshButton.disabled = next.phase === 'launching' || !availability.ok
      accountOptions(accountSelect, next.accounts, next.defaultAccount)
      environmentOptions(environmentSelect, next)
      if (!environmentSelect.value && remembered.environment
          && next.environments.some(environment => environment.environmentId === remembered.environment && environment.launchable === true)) {
        environmentSelect.value = remembered.environment
        applyEnvironment(next)
      }
      bindingOut.textContent = bindingText(findEnvironment(next, environmentSelect.value), next)
      taskList.replaceChildren(...next.tasks.map(taskRow))
    },
  })

  function applyEnvironment(state = controller.getState()) {
    const chosen = findEnvironment(state, environmentSelect.value)
    bindingOut.textContent = bindingText(chosen, state)
    field('branch').value = chosen?.defaultBranch || ''
  }

  if (!availability.ok) {
    for (const control of box.querySelectorAll('input, select, textarea, button')) control.disabled = true
    if (availability.code === 'CLOUD_LAUNCH_SWITCHED_OFF') box.querySelector('.board-box-h').append(offSwitch())
  } else {
    void controller.loadAccounts()
    goButton.addEventListener('click', () => {
      void controller.click({
        environment: environmentSelect.value,
        branch: field('branch').value,
        prompt: field('prompt').value,
        attempts: 1,
        account: accountSelect.value || null,
      })
    })
    cancelButton.addEventListener('click', () => { controller.disarm() })
    environmentSelect.addEventListener('change', () => { applyEnvironment() })
    refreshButton.addEventListener('click', () => {
      void controller.loadAccounts()
      void controller.loadTasks({ environment: environmentSelect.value || undefined })
    })
  }

  box.__cloudController = controller
  return box
}
