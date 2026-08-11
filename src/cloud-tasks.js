/* Codex Cloud, from inside the product.
 *
 * THE GAP THIS CLOSES. The owner's ruling is blunt and was repeated: "codex
 * cloud launch is literally a product feature it should work from the
 * software." The capability was finished and proven against the real provider
 * -- cloud.task_launch / task_status / task_list are in the shipped registry,
 * permission-gated, audited, and two real cloud tasks ran to completion through
 * them. The INTERFACE had nothing. A grep for "cloud" across every renderer
 * source file returned one hit, in an unrelated account module, and the built
 * bundle contained zero. So the product carried a working remote-agent
 * capability that no user could reach, which from inside the app is
 * indistinguishable from not having built it.
 *
 * WHERE IT LIVES, AND WHY NOT ON A PAGE OF ITS OWN. A cloud task is an agent
 * that runs somewhere else. It belongs where the local agents already are: the
 * agent page (this module's `mountCloudTaskSurface`, beside the local session
 * surface) and the fleet board's control rail (`cloudControlsBox`, beside
 * Launch, Team and Loop). A separate "Cloud" route would have made the same
 * claim the product keeps making by accident -- that remote work is a different
 * kind of thing -- and would have needed its own navigation entry, its own
 * empty state, and its own answer to "where did my agents go".
 *
 * WHAT IT DOES NOT DO, stated because the spec is explicit that pretending
 * otherwise costs real time (docs/CODEX-CLOUD-INTERFACE.md):
 *   - There is no cancel. Once the provider accepts a task it runs. No control
 *     here offers one, and the confirm step says so before the launch.
 *   - It does not apply diffs. Reading and staging a task's changes is not part
 *     of this surface, and nothing here implies a task's work has landed.
 *   - Silence is not success. A task absent from the searched window is
 *     reported unknown, never finished, and never quietly dropped from the list.
 */
import { el } from './components.js'
import { isWriteEnabled } from './write-flags.js'
import { postBridgeAction } from './mission-bridge.js'
import './cloud.css'

/* THE STATE VOCABULARY THE PERSON READS.
 *
 * The capability layer speaks a provider-neutral enum (contract.js) that maps
 * Codex Cloud's own words onto six values. Those six are the honest set and
 * this table is the ONLY place they become English, so a status can never be
 * described one way in the task list and another beside the launch button.
 *
 * `UNKNOWN` is a first-class row here rather than a fallback, and that is the
 * load-bearing decision. The provider reports statuses this product has never
 * seen -- the adapter's own comments record two that were added only after
 * being observed live -- and the failure mode a status view must not have is
 * rounding an unrecognised state toward "finished". A person who is told
 * "unknown" goes and looks; a person who is told "finished" does not.
 */
export const CLOUD_STATES = Object.freeze({
  SUBMITTED: Object.freeze({ label: 'queued', tone: 'pending' }),
  RUNNING: Object.freeze({ label: 'running', tone: 'pending' }),
  SUCCEEDED: Object.freeze({ label: 'finished', tone: 'good' }),
  FAILED: Object.freeze({ label: 'failed', tone: 'bad' }),
  CANCELLED: Object.freeze({ label: 'cancelled', tone: 'bad' }),
  UNKNOWN: Object.freeze({ label: 'unknown', tone: 'unknown' }),
})

export function cloudStateView(state) {
  return CLOUD_STATES[state] || CLOUD_STATES.UNKNOWN
}

/* The account line, from readings only. `usedPercent` is null whenever the
   provider did not answer, and null must never render as 0% -- "we could not
   ask" and "nothing used" are opposite facts and the second one invites a
   launch that the first one cannot promise. */
export function accountSummary(account) {
  if (!account || typeof account !== 'object') return 'account unknown'
  const parts = [account.name || 'unnamed']
  if (account.role) parts.push(account.role)
  parts.push(Number.isFinite(account.usedPercent) ? `${Math.round(account.usedPercent)}% used` : 'usage unknown')
  return parts.join(' · ')
}

/* Whether this installation can be asked to launch at all, expressed as the
   sentence the surface shows. Separated from the DOM so the reason is one
   string with one owner, and so the flag-off case is a described state rather
   than an absent panel. */
export function cloudAvailability({ writeEnabled = isWriteEnabled('cloud-launch'), inShell = Boolean(globalThis.mcShell) } = {}) {
  if (!inShell) {
    return Object.freeze({
      ok: false,
      code: 'CLOUD_SHELL_REQUIRED',
      note: 'Codex Cloud needs the ToolsEnabled desktop app; this surface is inert in a browser.',
    })
  }
  if (!writeEnabled) {
    return Object.freeze({
      ok: false,
      code: 'CLOUD_LAUNCH_SWITCHED_OFF',
      /* The panel is DRAWN in this state rather than removed. Every other write
         surface disappears when its flag is off, which is exactly why "switched
         off pending review" and "this product has no cloud feature" have looked
         the same from inside the app for as long as the flag has existed. A
         person cannot turn on a switch they have never been shown. */
      note: 'Codex Cloud launching is switched off. Turn on “Launch Codex Cloud tasks” in Settings › Write to use it. Nothing is contacted while it is off.',
    })
  }
  return Object.freeze({ ok: true, code: null, note: 'Codex Cloud ready.' })
}

const ENVIRONMENT_ID = /^[0-9a-f]{32}$/
const REMEMBERED_KEY = 'mc.cloud.last'

function readRemembered() {
  try {
    const parsed = JSON.parse(localStorage.getItem(REMEMBERED_KEY) || 'null')
    if (!parsed || typeof parsed !== 'object') return { environment: '', branch: '' }
    return {
      environment: typeof parsed.environment === 'string' && ENVIRONMENT_ID.test(parsed.environment) ? parsed.environment : '',
      branch: typeof parsed.branch === 'string' ? parsed.branch.slice(0, 200) : '',
    }
  } catch { return { environment: '', branch: '' } }
}

function writeRemembered(value) {
  /* The environment id and branch only. NOT the prompt: a task body is the one
     field a person is most likely to paste something sensitive into, and this
     store is a plain file on disk. The bridge already refuses credential-shaped
     prompt text before it reaches the provider; keeping it out of local
     persistence as well means a refused launch leaves nothing behind either. */
  try { localStorage.setItem(REMEMBERED_KEY, JSON.stringify({ environment: value.environment || '', branch: value.branch || '' })) }
  catch { /* a session-only memory is still better than none */ }
}

/**
 * The DOM-independent half: everything that talks to the bridge, decides what a
 * response means, and holds the two-step launch. Split out for the same reason
 * createTerminateController is -- so the confirm-then-send rule and the
 * never-report-an-unconfirmed-launch-as-sent rule can be exercised without a
 * browser, and so the two mounts below cannot drift into behaving differently.
 */
export function createCloudTaskController({
  postAction = postBridgeAction,
  onState = () => {},
  availability = cloudAvailability(),
} = {}) {
  let destroyed = false
  let armed = null
  let state = Object.freeze({
    phase: availability.ok ? 'idle' : 'unavailable',
    note: availability.note,
    accounts: Object.freeze([]),
    defaultAccount: null,
    tasks: Object.freeze([]),
    servingAccount: null,
    listMessage: availability.ok ? 'Not loaded yet.' : availability.note,
    listTone: 'note',
    launchMessage: '',
    launchTone: 'note',
    launchLabel: 'Launch on Codex Cloud',
    lastTaskId: null,
    lastTaskUrl: null,
  })

  const publish = next => {
    state = Object.freeze({ ...state, ...next })
    if (!destroyed) onState(state)
  }
  publish({})

  const refusal = result => `${result?.code || 'BRIDGE_REFUSED'} · ${result?.reason || 'The request did not complete.'}`

  async function loadAccounts() {
    if (!availability.ok) return state
    const result = await postAction('cloud-accounts', {})
    if (destroyed) return state
    if (result?.ok !== true || !Array.isArray(result.receipt?.accounts)) {
      publish({ accounts: Object.freeze([]), defaultAccount: null, listTone: 'refused', listMessage: `Accounts unavailable · ${refusal(result)}` })
      return state
    }
    publish({
      accounts: Object.freeze(result.receipt.accounts.map(account => Object.freeze({ ...account }))),
      defaultAccount: result.receipt.defaultAccount || null,
    })
    return state
  }

  async function loadTasks(request = {}) {
    if (!availability.ok) return state
    publish({ listTone: 'note', listMessage: 'Reading Codex Cloud…' })
    const body = {}
    if (request.environment) body.environment = request.environment
    if (request.account) body.account = request.account
    const result = await postAction('cloud-tasks', body)
    if (destroyed) return state
    if (result?.ok !== true || !Array.isArray(result.receipt?.tasks)) {
      publish({ listTone: 'refused', listMessage: `Tasks unavailable · ${refusal(result)}` })
      return state
    }
    const tasks = result.receipt.tasks.map(task => Object.freeze({ ...task }))
    publish({
      tasks: Object.freeze(tasks),
      servingAccount: result.receipt.account || null,
      listTone: tasks.length ? 'confirmed' : 'note',
      listMessage: tasks.length
        ? `${tasks.length} task${tasks.length === 1 ? '' : 's'} · read as ${accountSummary(result.receipt.account)}`
        : `No tasks on this account yet · read as ${accountSummary(result.receipt.account)}`,
    })
    return state
  }

  /* THE FIRST CLICK ARMS, THE SECOND SENDS. There is no cancel on the provider
     side, so the only place a person can change their mind is before the
     request leaves. The armed request is captured verbatim and the second click
     sends EXACTLY it -- re-reading the form on confirm would let a stray
     keystroke between the two clicks send something the person never saw
     confirmed. */
  function arm(request) {
    if (!availability.ok || destroyed) return state
    const environment = String(request?.environment || '').trim()
    const branch = String(request?.branch || '').trim()
    const prompt = String(request?.prompt || '')
    if (!ENVIRONMENT_ID.test(environment)) {
      publish({ phase: 'idle', launchTone: 'refused', launchLabel: 'Launch on Codex Cloud', launchMessage: 'The environment must be the 32-character id from the Codex environment URL, not the “Owner/repo” label. Nothing was sent.' })
      return state
    }
    if (!branch) {
      publish({ phase: 'idle', launchTone: 'refused', launchLabel: 'Launch on Codex Cloud', launchMessage: 'A branch is required, and it must already exist on the remote. Nothing was sent.' })
      return state
    }
    if (!prompt.trim()) {
      publish({ phase: 'idle', launchTone: 'refused', launchLabel: 'Launch on Codex Cloud', launchMessage: 'A task needs a prompt. Nothing was sent.' })
      return state
    }
    armed = Object.freeze({
      environment,
      branch,
      prompt,
      ...(Number.isSafeInteger(request?.attempts) && request.attempts > 1 ? { attempts: request.attempts } : {}),
      ...(request?.account ? { account: String(request.account) } : {}),
      confirmed: true,
    })
    writeRemembered({ environment, branch })
    publish({
      phase: 'armed',
      launchTone: 'note',
      launchLabel: 'Confirm launch',
      launchMessage: `This starts real work on Codex Cloud as ${armed.account || 'the first account that can serve'}, on branch ${branch}. A cloud task cannot be cancelled once it is accepted. Select again to send it, and approve the prompt that follows.`,
    })
    return state
  }

  async function confirm() {
    if (!armed || destroyed) return state
    const request = armed
    armed = null
    publish({ phase: 'launching', launchTone: 'note', launchLabel: 'Launching…', launchMessage: 'Waiting for approval, then submitting. Nothing has been created yet.' })
    let result
    try { result = await postAction('cloud-launch', request) }
    catch (error) { result = { ok: false, code: 'BRIDGE_REQUEST_FAILED', reason: error?.message || 'the launch request failed' } }
    if (destroyed) return state
    if (result?.ok !== true || !result.receipt) {
      publish({ phase: 'idle', launchTone: 'refused', launchLabel: 'Launch on Codex Cloud', launchMessage: `Not launched · ${refusal(result)}` })
      return state
    }
    const receipt = result.receipt
    if (receipt.launched !== true || typeof receipt.taskId !== 'string') {
      /* NOT AN ERROR AND NOT A SUCCESS. The capability layer answers ok:true
         with state UNKNOWN and a null task id when the CLI neither confirmed a
         task nor proved it failed to make one. Saying "failed" here would
         invite a retry that could create a SECOND real task, so the wording
         names the uncertainty and points at the list, which is the only thing
         that can settle it. */
      publish({
        phase: 'idle',
        launchTone: 'refused',
        launchLabel: 'Launch on Codex Cloud',
        launchMessage: `${receipt.state || 'UNKNOWN'} · ${receipt.message || 'The launch did not confirm a task id.'} A task may or may not have been created — refresh the list before trying again rather than launching a second time.`,
      })
      return state
    }
    publish({
      phase: 'idle',
      launchTone: 'confirmed',
      launchLabel: 'Launch on Codex Cloud',
      lastTaskId: receipt.taskId,
      lastTaskUrl: receipt.taskUrl || null,
      launchMessage: `${cloudStateView(receipt.state).label} · task ${receipt.taskId} on ${accountSummary(receipt.account)}${receipt.accountsConsidered?.length > 1 ? ` (after trying ${receipt.accountsConsidered.slice(0, -1).join(', ')})` : ''}.`,
    })
    await loadTasks({ environment: request.environment })
    return state
  }

  function disarm() {
    armed = null
    if (destroyed) return state
    publish({ phase: 'idle', launchLabel: 'Launch on Codex Cloud', launchTone: 'note', launchMessage: 'Not sent.' })
    return state
  }

  return Object.freeze({
    getState: () => state,
    isArmed: () => armed !== null,
    loadAccounts,
    loadTasks,
    arm,
    confirm,
    disarm,
    click(request) {
      if (destroyed || state.phase === 'launching') return Promise.resolve(state)
      if (armed) return confirm()
      return Promise.resolve(arm(request))
    },
    destroy() { destroyed = true },
  })
}

function stateNode(node, tone, text) {
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
  const surface = el(`<section class="write-surface cloud-surface" aria-label="Codex Cloud">
    <header><strong>Codex Cloud</strong><span data-cloud-status role="status">checking…</span></header>
    <div class="write-surface-grid">
      <form class="write-form" data-cloud-form>
        <span class="write-form-title">Launch a cloud task</span>
        <label class="write-wide">Environment id<input name="environment" maxlength="32" minlength="32" placeholder="32-character id from the Codex environment URL" required /></label>
        <label>Branch<input name="branch" maxlength="200" placeholder="main" required /></label>
        <label>Account<select name="account" aria-label="Codex account to run this task under"><option value="">Automatic</option></select></label>
        <label>Attempts<select name="attempts" aria-label="Assistant attempts">${[1, 2, 3, 4, 5].map(n => `<option value="${n}">${n}</option>`).join('')}</select></label>
        <label class="write-wide">Prompt<textarea name="prompt" maxlength="16000" rows="3" required></textarea></label>
        <button type="submit" data-cloud-launch>Launch on Codex Cloud</button>
        <button type="button" data-cloud-cancel hidden>Not now</button>
        <output data-cloud-launch-output role="status"></output>
      </form>
      <div class="write-form" data-cloud-list>
        <span class="write-form-title">Tasks on Codex Cloud</span>
        <button type="button" data-cloud-refresh>Refresh</button>
        <output data-cloud-list-output role="status"></output>
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
  const refreshButton = surface.querySelector('[data-cloud-refresh]')
  const taskList = surface.querySelector('[data-cloud-tasks]')
  const accountSelect = form.elements.account

  const remembered = readRemembered()
  form.elements.environment.value = remembered.environment
  form.elements.branch.value = remembered.branch || 'main'

  const controller = createCloudTaskController({
    postAction,
    availability,
    onState: next => {
      stateNode(listOutput, next.listTone, next.listMessage)
      stateNode(launchOutput, next.launchTone, next.launchMessage)
      launchButton.textContent = next.launchLabel
      launchButton.classList.toggle('is-confirming', next.phase === 'armed')
      launchButton.disabled = next.phase === 'launching' || !availability.ok
      cancelButton.hidden = next.phase !== 'armed'
      refreshButton.disabled = next.phase === 'launching' || !availability.ok
      accountOptions(accountSelect, next.accounts, next.defaultAccount)
      taskList.replaceChildren(...next.tasks.map(taskRow))
    },
  })

  if (!availability.ok) {
    stateNode(status, 'unavailable', availability.note)
    for (const control of form.querySelectorAll('input, select, textarea, button')) control.disabled = true
    refreshButton.disabled = true
    return () => { controller.destroy() }
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
  const onRefresh = () => {
    void controller.loadAccounts()
    void controller.loadTasks({ environment: form.elements.environment.value.trim() || undefined })
  }
  form.addEventListener('submit', onSubmit)
  cancelButton.addEventListener('click', onCancel)
  refreshButton.addEventListener('click', onRefresh)

  return () => {
    form.removeEventListener('submit', onSubmit)
    cancelButton.removeEventListener('click', onCancel)
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
        <input class="ctl-num cloud-env" type="text" data-cloud="environment" maxlength="32" placeholder="32-character environment id" aria-label="Codex Cloud environment id"/>
      </label>
      <label class="ctl-field"><span class="cl">Branch</span>
        <input class="ctl-num cloud-env" type="text" data-cloud="branch" maxlength="200" placeholder="main" aria-label="Branch the cloud task runs against"/>
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
      <div class="ctl-dispatch">
        <button class="ctl-btn" type="button" data-cloud="refresh">Refresh tasks</button>
        <output class="ctl-out" data-cloud="list-out" role="status"></output>
      </div>
      <ul class="cloud-task-list" data-cloud="tasks"></ul>
    </div>`)

  const field = name => box.querySelector(`[data-cloud="${name}"]`)
  const goButton = field('go')
  const cancelButton = field('cancel')
  const refreshButton = field('refresh')
  const out = field('out')
  const listOut = field('list-out')
  const taskList = field('tasks')
  const accountSelect = field('account')

  field('environment').value = remembered.environment
  field('branch').value = remembered.branch || 'main'
  field('note').textContent = availability.ok
    ? 'A cloud task cannot be cancelled once Codex Cloud accepts it. Each launch asks for approval before anything is sent.'
    : availability.note

  const controller = createCloudTaskController({
    postAction,
    availability,
    onState: next => {
      stateNode(out, next.launchTone, next.launchMessage)
      stateNode(listOut, next.listTone, next.listMessage)
      goButton.textContent = next.launchLabel
      goButton.disabled = next.phase === 'launching' || !availability.ok
      cancelButton.hidden = next.phase !== 'armed'
      refreshButton.disabled = next.phase === 'launching' || !availability.ok
      accountOptions(accountSelect, next.accounts, next.defaultAccount)
      taskList.replaceChildren(...next.tasks.map(taskRow))
    },
  })

  if (!availability.ok) {
    for (const control of box.querySelectorAll('input, select, textarea, button')) control.disabled = true
  } else {
    void controller.loadAccounts()
    goButton.addEventListener('click', () => {
      void controller.click({
        environment: field('environment').value,
        branch: field('branch').value,
        prompt: field('prompt').value,
        attempts: 1,
        account: accountSelect.value || null,
      })
    })
    cancelButton.addEventListener('click', () => { controller.disarm() })
    refreshButton.addEventListener('click', () => {
      void controller.loadAccounts()
      void controller.loadTasks({ environment: field('environment').value.trim() || undefined })
    })
  }

  box.__cloudController = controller
  return box
}
