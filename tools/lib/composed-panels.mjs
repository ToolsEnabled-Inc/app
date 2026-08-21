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
  bindingText,
  cloudAvailability,
  createCloudTaskController,
  findEnvironment,
} from '../../src/cloud-tasks-controller.js'
import {
  DECISION_FORM,
  QUEUE_FORM,
  REGISTER_NOTICE_STATES,
  decisionOff,
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
  /* Through the panel's own refresh, in the order the Refresh button uses, so
     the matrix measures what a person actually gets. */
  await controller.refresh()
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
      /* The line that says where a task would land. It is on the panel at the
         same moment as everything above, so it is measured with them. */
      { name: 'the binding line', tone: 'note', text: bindingText(findEnvironment(state, state.environments[0]?.environmentId), state) },
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

/* THE REFUSAL THIS READ CAN STILL PRODUCE, and it is deliberately not the one
   the panel used to show.
 *
 * A MISSING registry is no longer a refusal at all -- it is the empty state
   above, because "nobody has signed in here" is an answer. What is left is a
   registry that IS there and cannot be trusted, which is a different fact with
   a different repair. The reason below is the engine's own sentence for it,
   exactly as it arrives after typedError() scrubs the file path out of it. */
const REGISTRY_UNREADABLE = Object.freeze({
  ok: false,
  code: 'ACCOUNTS_REGISTRY_UNPARSABLE',
  reason: 'The account registry is not valid JSON, so no account can be selected.',
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
      id: 'account-registry-unreadable',
      why: 'a registry that is there and cannot be trusted, which is not the same as one that is absent',
      availability: READY,
      replies: { 'cloud-accounts': REGISTRY_UNREADABLE, 'cloud-tasks': REGISTRY_UNREADABLE },
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

/* TWO SUBJECTS ON ONE PAGE, and the panel is allowed to say different things
   about them. The register is the person's requests. The line under Claim and
   Close is about a FOLDER's build queue, which is a different list with a
   different reason for being unreadable. What the page may not do is tell two
   stories about the same one. */
const REQUESTS = 'your requests'
const WORK_LIST = 'a folder’s work list'

function ledgerState({ id, why, source, itemCount, snapshot, formsOn = true }) {
  const notice = registerNotice(source)
  const line = queueSnapshotLine(snapshot)
  /* The state the surface is handed, exactly as src/views/ledger.js hands it. */
  const register = { kind: notice ? notice.state : (source.kind === 'live' ? 'live' : source.kind), items: rowsFor(itemCount) }
  const slots = [
    { name: 'the register’s paragraph', subject: REQUESTS, tone: notice ? notice.tone : 'note', text: notice ? notice.body : '' },
    { name: 'the register’s accessible name', subject: REQUESTS, tone: notice ? notice.tone : 'note', text: notice ? notice.label : '' },
    { name: 'the counter above the register', subject: REQUESTS, tone: notice ? notice.tone : 'note', text: notice ? notice.count : `${itemCount} requests` },
  ]
  if (formsOn) {
    /* The hint the form really shows: the reason it is off when it is off, and
       otherwise the sentence that matches whether the field is a picker or a
       typed box. This is the same choice src/write-surfaces.js makes. */
    const off = decisionOff(register)
    const hint = off ? off.text : (register.items.length > 0 ? DECISION_FORM.targetHint : DECISION_FORM.targetHintTyped)
    slots.push(
      { name: 'the Approve/Decline form title', subject: REQUESTS, tone: 'note', text: DECISION_FORM.title },
      { name: 'the “Which request” field', subject: REQUESTS, tone: off ? off.tone : 'note', text: `${DECISION_FORM.targetLabel} — ${hint}` },
      { name: 'the Claim/Close form title', subject: WORK_LIST, tone: 'note', text: QUEUE_FORM.title },
      { name: 'the “Which item” field', subject: WORK_LIST, tone: 'note', text: `${QUEUE_FORM.itemLabel} — ${QUEUE_FORM.itemHint}` },
      { name: 'the line under Claim and Close', subject: WORK_LIST, tone: line.tone, text: line.text },
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

function rowsFor(itemCount) {
  return Array.from({ length: itemCount }, (unused, index) => ({
    id: `R${1100 + index}`,
    label: `R${1100 + index} · open`,
  }))
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
