/* THE TWO PANELS THE OWNER COULD NOT READ, BUILT FROM THE PRODUCT'S OWN CODE.
 *
 * Every string below comes out of a module the application loads. Nothing here
 * retypes a sentence: a fixture that carried its own copy of the words would go
 * on passing after the product's words changed, which is the failure mode that
 * makes a copy suite worthless.
 *
 * WHAT A "STATE" IS HERE. One panel, one situation, and every string that
 * situation puts in front of a person at the same moment -- the status lines,
 * the form labels and placeholders, the counter, the accessible name of the
 * register. Plus how many rows the register has, because two of the three rules
 * in ./composed-output-rules.mjs are about the relationship between the words
 * and the list.
 *
 * THE STATES ARE THE ONES A PERSON REACHES, not a sampling. A fresh profile with
 * nothing signed in is first, because that is the state the owner met.
 */

import {
  cloudAvailability,
  createCloudTaskController,
} from '../../src/cloud-tasks-controller.js'
import {
  DECISION_FORM,
  QUEUE_FORM,
  REGISTER_NOTICE_STATES,
  queueSnapshotLine,
  registerNotice,
} from '../../src/ledger-copy.js'

const NEVER = Object.freeze({ setTimeout: () => 0, clearTimeout: () => {} })

/* A bridge that answers from a table. Every reply below is a shape this
   product's own mission bridge really returns. */
function replier(table) {
  return async (action, body) => {
    const answer = table[action]
    if (typeof answer === 'function') return answer(body)
    if (answer === undefined) return { ok: false, code: 'BRIDGE_ACTION_UNKNOWN', reason: 'unknown bridge action' }
    return answer
  }
}

async function cloudState({ id, why, availability, replies, list = null }) {
  const controller = createCloudTaskController({
    postAction: replier(replies),
    availability,
    timers: NEVER,
  })
  await controller.loadAccounts()
  await controller.loadTasks()
  const state = controller.getState()
  controller.destroy()
  return {
    panel: 'codex-cloud',
    state: id,
    why,
    slots: [
      { name: 'the panel’s own note', tone: 'note', text: state.note },
      { name: 'the task list line', tone: state.listTone, text: state.listMessage },
      { name: 'the environments line', tone: state.environmentsTone, text: state.environmentsMessage },
      { name: 'the launch line', tone: state.launchTone, text: state.launchMessage },
      { name: 'the watch line', tone: state.watchTone, text: state.watchMessage },
    ],
    list: list === null ? { name: 'the task list', itemCount: state.tasks.length } : list,
  }
}

const READY = cloudAvailability({ writeEnabled: true, inShell: true })
const SWITCHED_OFF = cloudAvailability({ writeEnabled: false, inShell: true })

const ACCOUNT = Object.freeze({ name: 'work', role: 'builder', canServe: true, usedPercent: 12 })
const ENVIRONMENT = Object.freeze({
  environmentId: 'a'.repeat(32),
  label: 'Owner/repo',
  repository: 'Owner/repo',
  defaultBranch: 'main',
  accounts: ['work'],
  launchable: true,
})

/* THE REFUSAL A CLEAN MACHINE REALLY GETS. Measured by driving the packaged
   build on a sterile profile: with no accounts.json anywhere, the bridge
   answered ACCOUNTS_REGISTRY_MISSING, and the renderer put the SAME sentence in
   two adjacent boxes. */
const REGISTRY_MISSING = Object.freeze({
  ok: false,
  code: 'ACCOUNTS_REGISTRY_MISSING',
  reason: 'No account registry. Create it before switching accounts.',
})

export async function cloudPanels() {
  return [
    await cloudState({
      id: 'no-account-signed-in',
      why: 'a fresh profile: the reader has never signed in to Codex Cloud on this computer',
      availability: READY,
      replies: {
        'cloud-accounts': { ok: true, receipt: { accounts: [], defaultAccount: null, environments: [], environmentsComplete: true, environmentsReadAt: '2026-08-18T00:00:00.000Z' } },
        'cloud-tasks': { ok: true, receipt: { tasks: [], account: null } },
      },
    }),
    await cloudState({
      id: 'account-registry-refused',
      why: 'the account list genuinely could not be read',
      availability: READY,
      replies: { 'cloud-accounts': REGISTRY_MISSING, 'cloud-tasks': REGISTRY_MISSING },
    }),
    await cloudState({
      id: 'bridge-unreachable',
      why: 'the background service this window talks to is not answering',
      availability: READY,
      replies: {
        'cloud-accounts': { ok: false, code: 'BRIDGE_UNREACHABLE', reason: 'The audited connection is not answering.' },
        'cloud-tasks': { ok: false, code: 'BRIDGE_UNREACHABLE', reason: 'The audited connection is not answering.' },
      },
    }),
    await cloudState({
      id: 'switched-off',
      why: 'the feature ships off and the panel is drawn anyway, so the switch can be found',
      availability: SWITCHED_OFF,
      replies: {},
    }),
    await cloudState({
      id: 'populated',
      why: 'one account, one environment, one finished task',
      availability: READY,
      replies: {
        'cloud-accounts': { ok: true, receipt: { accounts: [ACCOUNT], defaultAccount: 'work', environments: [ENVIRONMENT], environmentsComplete: true, environmentsReadAt: '2026-08-18T00:00:00.000Z' } },
        'cloud-tasks': { ok: true, receipt: { tasks: [{ taskId: 'task-00000001', title: 'Read the README', state: 'SUCCEEDED' }], account: ACCOUNT } },
      },
    }),
  ]
}

/* ------------------------------------------------------------ the ledger -- */

/* The bridge's status reply carries one entry per folder. `ok: false` is what a
   folder whose work list could not be inspected looks like. */
const QUEUE_READY = Object.freeze({ ok: true, hash: 'f'.repeat(64) })
const QUEUE_REFUSED = Object.freeze({ ok: false, code: 'BRIDGE_GUARD_REFUSED', reason: 'That folder has no work list to read.' })

function ledgerState({ id, why, source, itemCount, snapshot, formsOn = true }) {
  const notice = registerNotice(source)
  const line = queueSnapshotLine(snapshot)
  const slots = [
    { name: 'the register’s paragraph', tone: notice ? notice.tone : 'note', text: notice ? notice.body : '' },
    { name: 'the register’s accessible name', tone: notice ? notice.tone : 'note', text: notice ? notice.label : '' },
    { name: 'the counter above the register', tone: notice ? notice.tone : 'note', text: notice ? notice.count : `${itemCount} requests` },
  ]
  if (formsOn) {
    slots.push(
      { name: 'the Approve/Decline form title', tone: 'note', text: DECISION_FORM.title },
      { name: 'the “Which request” field', tone: 'note', text: fieldText(DECISION_FORM, 'target') },
      { name: 'the Claim/Close form title', tone: 'note', text: QUEUE_FORM.title },
      { name: 'the “Which item” field', tone: 'note', text: fieldText(QUEUE_FORM, 'item') },
      { name: 'the line under Claim and Close', tone: line.tone, text: line.text },
    )
  }
  return {
    panel: 'r-ledger',
    state: id,
    why,
    slots,
    list: { name: 'the request register', itemCount },
  }
}

/* A field is its label AND whatever stands in the box, because that is what the
   person reads as one thing. The two shapes are the placeholder this panel used
   to carry and the hint sentence that replaced it. */
function fieldText(form, prefix) {
  const label = form[`${prefix}Label`] || ''
  const extra = form[`${prefix}Placeholder`] || form[`${prefix}Hint`] || form[`${prefix}HintTyped`] || ''
  return [label, extra].filter(Boolean).join(' — ')
}

export function ledgerPanels() {
  /* Every no-rows state the copy module declares, plus the one with rows. A
     state added to the product arrives here without anybody remembering to add
     it, which is the only way a matrix stays honest. */
  const notices = REGISTER_NOTICE_STATES.map(kind => ledgerState({
    id: `register-${kind}`,
    why: `the register has no rows to draw and says so as "${kind}"`,
    source: { kind },
    itemCount: 0,
    snapshot: QUEUE_REFUSED,
  }))
  return [
    ...notices,
    ledgerState({
      id: 'register-populated',
      why: 'a checkout that really does keep a register, with the work list read',
      source: { kind: 'live' },
      itemCount: 4,
      snapshot: QUEUE_READY,
    }),
  ]
}

export async function composedPanels() {
  return [...(await cloudPanels()), ...ledgerPanels()]
}
