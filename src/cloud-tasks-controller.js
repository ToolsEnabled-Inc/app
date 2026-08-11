/* Codex Cloud: the half that has no DOM.
 *
 * WHY THIS IS ITS OWN FILE. Everything here decides something -- what a
 * provider answer means, whether a launch may proceed, when to stop watching a
 * task -- and every one of those decisions is exactly what a test has to be able
 * to exercise without a browser. Its sibling `cloud-tasks.js` imports a
 * stylesheet, which a plain `node --test` run cannot load, so keeping the rules
 * in the same file as the markup would have made the rules untestable. The two
 * mounts over there share this one controller for the same reason: two copies of
 * the confirm-then-send rule would eventually disagree, and the one that
 * disagreed would be the one that launched something.
 *
 * The fail-closed rules this file owns, each of which is the answer to a real
 * defect class in this codebase (a missing field read as permission):
 *   - an unread environment list never permits a launch;
 *   - an environment absent from an INCOMPLETE reading is unproven, not absent;
 *   - an environment with no single source repository cannot be launched into;
 *   - a branch is never defaulted to "main" from nothing;
 *   - UNKNOWN never ends the status watch, and the watch is bounded in both
 *     interval and count so it can never become a background job nobody started.
 */
import { isWriteEnabled } from './write-flags.js'
import { postBridgeAction } from './mission-bridge.js'

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

/* The three states that end the watch. UNKNOWN is deliberately NOT one of them:
   the capability layer answers UNKNOWN for a task its bounded search window did
   not reach, and a task that has simply scrolled out of the first pages is still
   running. Stopping there would report "we stopped looking" as "it is over". */
export const TERMINAL_CLOUD_STATES = Object.freeze(['SUCCEEDED', 'FAILED', 'CANCELLED'])

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
         person cannot turn on a switch they have never been shown, so the switch
         is ALSO offered on the panel rather than only in Settings -- same flag,
         same durable setting, reachable from where the feature is. */
      note: 'Codex Cloud launching is switched off. Turn it on here or in Settings › Write. Nothing is contacted while it is off.',
    })
  }
  return Object.freeze({ ok: true, code: null, note: 'Codex Cloud ready.' })
}

export const ENVIRONMENT_ID = /^[0-9a-f]{32}$/
const REMEMBERED_KEY = 'mc.cloud.last'
/* Fifteen seconds between checks, for at most fifteen minutes of watching. Both
   bounds are here rather than open-ended for the same reason the capability
   layer's paging is bounded: an unbounded poll is a background job nobody
   started, and it would keep spawning a provider CLI long after the person who
   pressed Launch has walked away. When the budget runs out the surface SAYS the
   watch stopped and that the task may still be running -- it never implies the
   task ended. */
export const WATCH_INTERVAL_MS = 15_000
export const WATCH_FIRST_DELAY_MS = 2_000
export const WATCH_MAX_CHECKS = 60

export function readRemembered() {
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

/* One discovered environment, as one line of English.
 *
 * Two of this machine's real environments share a display label, and two more
 * differ only by which account owns them, so the label ALONE cannot identify a
 * choice. The account and a short id prefix are part of the option text for that
 * reason -- not decoration. */
export function environmentSummary(environment) {
  if (!environment || typeof environment !== 'object') return 'environment unknown'
  const parts = [environment.label || environment.repository || environment.environmentId]
  if (Array.isArray(environment.accounts) && environment.accounts.length) parts.push(environment.accounts.join(', '))
  if (typeof environment.environmentId === 'string') parts.push(environment.environmentId.slice(0, 6))
  if (environment.launchable !== true) parts.push('no single repository — cannot launch')
  return parts.join(' · ')
}

/* What the person is told about the environment list itself. The incomplete
   case has its own sentence because an environment MISSING from a partial
   reading has not been shown to be unauthorized, and a surface that renders a
   partial list as the whole set turns "we could not ask" into "you do not have
   it" -- the absence-as-answer defect this codebase keeps finding. */
export function environmentsMessage({ loaded, environments, complete }) {
  if (!loaded) return { tone: 'note', text: 'Environments not read yet.' }
  const usable = environments.filter(environment => environment.launchable === true).length
  if (environments.length === 0) {
    return complete
      ? { tone: 'note', text: 'No Codex Cloud environment is authorized for the configured accounts. Create one on Codex Cloud for the repository you want a task to run against.' }
      : { tone: 'refused', text: 'No environments could be read, and at least one account could not be asked, so this is not proof that none exist.' }
  }
  const partial = complete ? '' : ' At least one account could not be asked, so this list may be incomplete.'
  return {
    tone: complete ? 'confirmed' : 'note',
    text: `${usable} of ${environments.length} authorized environment${environments.length === 1 ? '' : 's'} can take a task.${partial}`,
  }
}

/* Looked up from a published STATE rather than from the controller, because the
   controller publishes its first state during its own construction: a callback
   that reached for the controller would be reaching for a binding that does not
   exist yet. */
export function findEnvironment(state, environmentId) {
  if (!state || !Array.isArray(state.environments) || !environmentId) return null
  return state.environments.find(environment => environment.environmentId === environmentId) || null
}

/* The binding line: what a task launched right now would land in. Written from
   the discovered environment rather than from anything typed, and explicit when
   there is nothing to bind to. */
export function bindingText(environment) {
  if (!environment) return 'No environment chosen, so no source repository is bound.'
  if (typeof environment.repository !== 'string' || !environment.repository) {
    return environment.reason || 'This environment reports no single source repository.'
  }
  return `Bound to ${environment.repository}${environment.defaultBranch ? ` · default branch ${environment.defaultBranch}` : ' · the provider states no default branch'}${environment.visibility ? ` · ${environment.visibility}` : ''}`
}

/**
 * Everything that talks to the bridge, decides what a response means, holds the
 * two-step launch, and runs the status watch.
 */
export function createCloudTaskController({
  postAction = postBridgeAction,
  onState = () => {},
  availability = cloudAvailability(),
  timers = { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) },
  watchIntervalMs = WATCH_INTERVAL_MS,
  watchFirstDelayMs = WATCH_FIRST_DELAY_MS,
  watchMaxChecks = WATCH_MAX_CHECKS,
} = {}) {
  let destroyed = false
  let armed = null
  let watchTimer = null
  let checksLeft = 0
  let state = Object.freeze({
    phase: availability.ok ? 'idle' : 'unavailable',
    note: availability.note,
    accounts: Object.freeze([]),
    defaultAccount: null,
    environments: Object.freeze([]),
    environmentsComplete: false,
    environmentsLoaded: false,
    environmentsReadAt: null,
    environmentsTone: 'note',
    environmentsMessage: availability.ok ? 'Environments not read yet.' : availability.note,
    tasks: Object.freeze([]),
    servingAccount: null,
    listMessage: availability.ok ? 'Not loaded yet.' : availability.note,
    listTone: 'note',
    launchMessage: '',
    launchTone: 'note',
    launchLabel: 'Launch on Codex Cloud',
    receipt: null,
    watchTaskId: null,
    watchTone: 'note',
    watchMessage: '',
  })

  const publish = next => {
    state = Object.freeze({ ...state, ...next })
    if (!destroyed) onState(state)
  }
  publish({})

  const refusal = result => `${result?.code || 'BRIDGE_REFUSED'} · ${result?.reason || 'The request did not complete.'}`
  const clock = () => new Date().toLocaleTimeString()

  /* ACCOUNTS AND ENVIRONMENTS ARRIVE TOGETHER, because on this provider they
     are one fact: an environment is scoped to the account that created it, so
     "which environments exist" has no answer that is not per-account. */
  async function loadAccounts() {
    if (!availability.ok) return state
    const result = await postAction('cloud-accounts', {})
    if (destroyed) return state
    if (result?.ok !== true || !Array.isArray(result.receipt?.accounts)) {
      publish({
        accounts: Object.freeze([]),
        defaultAccount: null,
        listTone: 'refused',
        listMessage: `Accounts unavailable · ${refusal(result)}`,
        /* NOT "no environments": a refused read says nothing about what exists.
           environmentsLoaded stays false so the launch path keeps refusing. */
        environmentsTone: 'refused',
        environmentsMessage: `Environments unavailable · ${refusal(result)}`,
      })
      return state
    }
    const environments = Object.freeze((Array.isArray(result.receipt.environments) ? result.receipt.environments : [])
      .map(environment => Object.freeze({ ...environment })))
    const complete = result.receipt.environmentsComplete === true
    const message = environmentsMessage({ loaded: true, environments, complete })
    publish({
      accounts: Object.freeze(result.receipt.accounts.map(account => Object.freeze({ ...account }))),
      defaultAccount: result.receipt.defaultAccount || null,
      environments,
      environmentsComplete: complete,
      environmentsLoaded: true,
      environmentsReadAt: typeof result.receipt.environmentsReadAt === 'string' ? result.receipt.environmentsReadAt : null,
      environmentsTone: message.tone,
      environmentsMessage: message.text,
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
    const idle = { phase: 'idle', launchTone: 'refused', launchLabel: 'Launch on Codex Cloud' }
    const environment = String(request?.environment || '').trim()
    const branch = String(request?.branch || '').trim()
    const prompt = String(request?.prompt || '')
    if (!ENVIRONMENT_ID.test(environment)) {
      publish({ ...idle, launchMessage: 'Choose the Codex Cloud environment this task runs in. Nothing was sent.' })
      return state
    }
    /* THE BINDING IS REQUIRED HERE AND CHECKED AGAIN AT THE BRIDGE. This surface
       declares the repository it has been SHOWING for the chosen environment;
       the capability layer re-reads the binding from the provider and refuses if
       the two differ. So a stale or wrong picture on this glass cannot become a
       task submitted against someone else's source -- which is the guarantee
       Machine B's offload report asked for. */
    if (!state.environmentsLoaded) {
      publish({ ...idle, launchMessage: 'The authorized environments have not been read yet, so the source repository cannot be declared. Refresh, then launch. Nothing was sent.' })
      return state
    }
    const chosen = findEnvironment(state, environment)
    if (!chosen) {
      publish({
        ...idle,
        launchMessage: state.environmentsComplete
          ? 'That environment is not one the configured accounts are authorized for. Nothing was sent.'
          : 'That environment is not in the list that could be read, and the reading was incomplete, so nothing about it is confirmed. Nothing was sent.',
      })
      return state
    }
    if (typeof chosen.repository !== 'string' || !chosen.repository) {
      publish({ ...idle, launchMessage: `${chosen.reason || 'That environment reports no single source repository.'} A task cannot be bound to it. Nothing was sent.` })
      return state
    }
    if (!branch) {
      publish({ ...idle, launchMessage: 'A branch is required, and it must already exist on the remote. Nothing was sent.' })
      return state
    }
    if (!prompt.trim()) {
      publish({ ...idle, launchMessage: 'A task needs a prompt. Nothing was sent.' })
      return state
    }
    armed = Object.freeze({
      environment,
      repository: chosen.repository,
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
      launchMessage: `This starts real work on Codex Cloud as ${armed.account || 'the first account that can serve'}, in ${chosen.repository} on branch ${branch}. A cloud task cannot be cancelled once it is accepted. Select again to send it, and approve the prompt that follows.`,
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
    /* THE RECEIPT IS THE PROVIDER'S ANSWER, NOT THIS PAGE'S MEMORY OF THE FORM.
       Every field is copied from what came back, and it is frozen: the status
       watch below writes to its own fields and can never edit the record of what
       was submitted. */
    publish({
      phase: 'idle',
      launchTone: 'confirmed',
      launchLabel: 'Launch on Codex Cloud',
      receipt: Object.freeze({
        taskId: receipt.taskId,
        taskUrl: receipt.taskUrl || null,
        environment: receipt.environment || null,
        environmentLabel: receipt.environmentLabel || null,
        repository: receipt.repository || null,
        branch: receipt.branch || null,
        state: receipt.state || 'UNKNOWN',
        account: receipt.account || null,
        submittedAt: receipt.submittedAt || null,
        bindingReadAt: receipt.bindingReadAt || null,
        approvalRequired: receipt.approvalRequired === true,
      }),
      launchMessage: `${cloudStateView(receipt.state).label} · task ${receipt.taskId} on ${accountSummary(receipt.account)}${receipt.accountsConsidered?.length > 1 ? ` (after trying ${receipt.accountsConsidered.slice(0, -1).join(', ')})` : ''}.`,
    })
    watch(receipt.taskId, { environment: receipt.environment || request.environment, account: receipt.account?.name || request.account || null })
    await loadTasks({ environment: request.environment })
    return state
  }

  function stopWatch() {
    if (watchTimer !== null) timers.clearTimeout(watchTimer)
    watchTimer = null
  }

  /* THE STATUS WATCH. It exists because "did my work start?" is the only
     question this surface is for, and answering it used to require the person to
     press Refresh at intervals they had to invent. It reads the same bounded
     status action an agent would; it never guesses; and its every message
     carries the time of the reading, because a status with no timestamp is a
     claim about now made from a measurement about then. */
  function watch(taskId, { environment = null, account = null } = {}) {
    if (destroyed || typeof taskId !== 'string' || !taskId) return state
    stopWatch()
    checksLeft = watchMaxChecks
    publish({ watchTaskId: taskId, watchTone: 'note', watchMessage: 'Watching this task; the first check is moments away.' })
    watchTimer = timers.setTimeout(() => { void check(taskId, { environment, account }) }, watchFirstDelayMs)
    return state
  }

  async function check(taskId, { environment = null, account = null } = {}) {
    if (destroyed) return state
    watchTimer = null
    const body = { taskId }
    if (environment) body.environment = environment
    if (account) body.account = account
    let result
    try { result = await postAction('cloud-task-status', body) }
    catch (error) { result = { ok: false, code: 'BRIDGE_REQUEST_FAILED', reason: error?.message || 'the status request failed' } }
    if (destroyed || state.watchTaskId !== taskId) return state

    if (result?.ok !== true || typeof result.receipt?.state !== 'string') {
      /* A failed READING is not a failed TASK. Say which one happened, and keep
         watching: the next check may well answer. */
      publish({ watchTone: 'refused', watchMessage: `Could not read the status at ${clock()} · ${refusal(result)}. The task itself is unaffected.` })
    } else {
      const receipt = result.receipt
      const view = cloudStateView(receipt.state)
      const found = receipt.found === true
      publish({
        watchTone: view.tone === 'good' ? 'confirmed' : (view.tone === 'bad' ? 'refused' : 'note'),
        watchMessage: found
          ? `${view.label}${receipt.providerStatus && receipt.providerStatus !== view.label ? ` (${receipt.providerStatus})` : ''} at ${clock()}${receipt.updatedAt ? ` · provider updated ${receipt.updatedAt}` : ''}`
          : `not in the searched window at ${clock()} — that is not a failure, and the task may still be running`,
      })
      if (found && TERMINAL_CLOUD_STATES.includes(receipt.state)) {
        stopWatch()
        return state
      }
    }

    checksLeft -= 1
    if (checksLeft <= 0) {
      publish({ watchMessage: `${state.watchMessage} · stopped watching after ${watchMaxChecks} checks; the task may still be running.` })
      stopWatch()
      return state
    }
    watchTimer = timers.setTimeout(() => { void check(taskId, { environment, account }) }, watchIntervalMs)
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
    isWatching: () => watchTimer !== null,
    loadAccounts,
    loadTasks,
    arm,
    confirm,
    disarm,
    watch,
    click(request) {
      if (destroyed || state.phase === 'launching') return Promise.resolve(state)
      if (armed) return confirm()
      return Promise.resolve(arm(request))
    },
    destroy() { destroyed = true; stopWatch() },
  })
}
