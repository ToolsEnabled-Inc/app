/* THE ORGANISATION CONTROLS, AND WHY THEY LIVE IN THEIR OWN FILE.
 *
 * src/views/computers.js draws the fleet. These three panels are the only part
 * of that page that WRITES anything about the declared organisation, and they
 * are the only part that has to keep saying what the engine actually enforces
 * next to what a role's wording claims. Kept inline they would have doubled the
 * view; kept here they can be read as one thing: the editing surface, its
 * failure sentences, and the disabled shape it takes when there is nothing
 * behind it.
 *
 * NOTHING HERE DECIDES WHETHER AN EDIT IS LEGAL. One controller, one manager
 * per agent, no cycle, no unknown role, no reserved role id, at most ten custom
 * roles — every one of those rules lives in the payload
 * (capability/src/lib/agent-org.js and custom-role-store.js) and is applied by
 * the store behind window.mcOrg. This file renders what the store returns and
 * prints the store's own sentence when it refuses. A second guard here would be
 * a second implementation, and the copy is the one that drifts.
 *
 * THE PANELS DEGRADE RATHER THAN PRETEND. The same page is served in a plain
 * browser from dist/, where window.mcOrg does not exist. Every builder below
 * takes an `availability` record and, when it is not `ready`, renders the
 * controls DISABLED with the reason on them instead of rendering an enabled
 * control with no backend attached. */

import { el } from './components.js'
import { refusalSentence } from './refusal-copy.js'

const escapeMarkup = (value) => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]))

/* Mirrors MAX_RULE_TEXT in capability/src/lib/custom-role-store.js. It is used
   only to tell a person the limit before they hit it; the refusal itself is
   still the store's. */
export const MAX_RULE_TEXT = 1500

export const ORG_ABSENT_REASON = 'This copy is running in a browser, so there is no organisation store behind this page. The desktop app is where the declared organisation is saved.'

const RULE_FIELDS = Object.freeze([
  Object.freeze({ key: 'owns', label: 'Owns' }),
  Object.freeze({ key: 'mustNot', label: 'Must not' }),
  Object.freeze({ key: 'handoff', label: 'Hands off to' }),
])

/** Is there an organisation store behind this window at all? */
export function orgBridge() {
  const bridge = globalThis.mcOrg
  return bridge && typeof bridge.read === 'function' ? bridge : null
}

/**
 * The one availability record every panel below branches on.
 *
 *   { state: 'absent',  reason }              no bridge — a plain browser
 *   { state: 'failed',  code, reason }        a bridge that could not answer
 *   { state: 'ready',   org, roles, overlayFile }
 *
 * It never rejects and never throws, so a caller can await it in the same
 * Promise.all as the fleet fetch without a second failure vocabulary.
 */
export async function readOrg() {
  const bridge = orgBridge()
  if (!bridge) return { state: 'absent', code: 'ORG_BRIDGE_ABSENT', reason: ORG_ABSENT_REASON }
  let result = null
  try {
    result = await bridge.read()
  } catch (error) {
    return { state: 'failed', code: 'ORG_READ_THREW', reason: `The organisation could not be read: ${error?.message || error}` }
  }
  if (!result?.ok) {
    return {
      state: 'failed',
      code: result?.code || 'ORG_READ_FAILED',
      reason: result?.reason || 'The organisation could not be read.',
    }
  }
  return { state: 'ready', org: result.org, roles: result.roles, overlayFile: result.overlayFile }
}

/**
 * The sentence a refusal is shown as.
 *
 * The engine already writes readable English into `reason` — "The controller is
 * the accountable root and cannot report to another agent." — so that is what
 * is shown, verbatim. The code is appended only when there is no reason to
 * show, because a bare code with no sentence is worse than a long sentence.
 */
export function failureSentence(result, fallback = 'The change was refused.') {
  /* [B6] `${fallback} (${code})` used to be this function's middle branch, so a
     refusal that carried a code and no reason put the identifier in brackets in
     front of a person -- and the bottom branch returned a fallback with nothing
     to do in it. Both now go through the shared composer, which never shows the
     identifier and always ends with an action. The engine's own `reason` is
     still preferred and still shown verbatim; that judgement was right and is
     unchanged, it just no longer stops there. */
  return refusalSentence(result, { fallback })
}

/** Whether a refusal means "your window is out of date", which has its own cure. */
export const isRevisionConflict = (result) => result?.code === 'AGENT_ORG_STORE_REVISION_CONFLICT'

export const REVISION_CONFLICT_ADVICE = 'Another window changed the organisation first. This page has re-read it — look at the current hierarchy and make the change again.'

/* THE ONE FACT A ROLE MENU MUST NOT OMIT.
   A role's wording is a description; `enforced.mayClaimWork` is what the
   product mechanically guarantees. Five shipped roles are described as not
   dispatching work AND are prevented from reserving it; a custom role with no
   base is prevented too. Offering a role in a menu turns its description into a
   promise, so the enforced half travels with it everywhere the role is named. */
/* The label says the consequence a person can SEE, not the mechanism. "Can
   reserve work" named an internal lease no customer surface exhibits — the
   dropdown asserted a mechanic nobody could observe, twice per option. The
   enforced flag itself still travels on the role detail card, where there is
   room for its sentence. */
export const claimLabel = (role) => role?.enforced?.mayClaimWork ? 'can be given jobs' : 'watch only'
const claimFlag = (role) => role?.enforced?.mayClaimWork ? 'yes' : 'no'

export const roleOptionLabel = (role) => `${role?.name || role?.id} · ${claimLabel(role)}`

/**
 * What the person is told about the org they are looking at, before they touch
 * it. `damaged` and `baselineDrift` are the two facts that are invisible unless
 * something says them out loud, and both change what an edit MEANS.
 */
export function orgNotices(org) {
  const notices = []
  if (!org) return notices
  if (org.damaged) {
    notices.push({
      kind: 'damaged',
      text: `Your saved organisation could not be loaded, so this is the one the app ships with: ${org.damaged}. Any change you make starts from that, not from what you had saved.`,
    })
  }
  /* NO HASHES IN FRONT OF A PERSON (owner, 2026-08-18, reading this very
     notice on the fleet rail). It used to quote both content hashes, so the
     sentence read `You saved yours from "60132024e9efbfe…"` and then ran off
     the edge of a 330px rail mid-hash. Neither hash is something anybody can
     act on, and the two facts that ARE actionable -- the default moved, and
     your version is the one running -- were the half getting truncated away.
     The hashes are still on `org.baselineDrift` for anything that debugs. */
  if (org.baselineDrift) {
    notices.push({
      kind: 'drift',
      text: 'The organisation this app ships with has changed since you saved your own. Your version is still the one in force, and the newer default is not being applied.',
    })
  }
  return notices
}

export function orgNoticeMarkup(org) {
  return orgNotices(org).map(notice =>
    `<div class="org-notice" data-notice="${notice.kind}">${escapeMarkup(notice.text)}</div>`).join('')
}

/* The single line that explains why an editing control is off, and the reason
   it fails CLOSED. Anything that is not a completed successful read — a bridge
   that is absent, a read that failed, a read that has not answered yet — leaves
   the panel with no revision to write against, and a control offered in that
   state would be a control with no backend. */
function disabledReason(availability) {
  if (availability?.state === 'ready') return null
  return failureSentence(availability, 'The declared organisation has not been read, so it cannot be edited here.')
}

function ruleFieldsMarkup(values, { prefix, disabled }) {
  return RULE_FIELDS.map(field => `
    <label class="role-field">
      <span class="cl">${field.label}</span>
      <textarea class="role-text" rows="2" maxlength="${MAX_RULE_TEXT}" data-field="${field.key}"
        aria-label="${escapeMarkup(`${field.label} — ${prefix}`)}"${disabled ? ' disabled' : ''}>${escapeMarkup(values?.[field.key] || '')}</textarea>
    </label>`).join('')
}

function roleFactsMarkup(role) {
  if (!role) return '<div class="rail-sub">No role selected.</div>'
  const enforced = [
    `<span class="role-claim" data-claim="${claimFlag(role)}">${escapeMarkup(claimLabel(role))}</span>`,
    role.enforced?.singleSeat ? '<span class="role-claim" data-claim="seat">one seat only</span>' : '',
  ].filter(Boolean).join('')
  const rules = Array.isArray(role.rules) && role.rules.length
    ? `<div class="role-rule"><b>Rules</b><span>${role.rules.map(escapeMarkup).join('<br>')}</span></div>`
    : ''
  return `
    <div class="role-enforced">${enforced}</div>
    <div class="rail-sub">${escapeMarkup(role.summary || 'This role ships no summary.')}</div>
    ${role.custom ? `<div class="rail-sub">Custom role${role.baseDefaultRole ? ` · based on ${escapeMarkup(role.baseDefaultRole)}` : ' · no base, so it can only watch'}</div>` : ''}
    ${RULE_FIELDS.map(field => `<div class="role-rule"><b>${field.label}</b><span>${escapeMarkup(role[field.key] || 'not stated')}</span></div>`).join('')}
    ${rules}`
}

/**
 * THE ROLE OF ONE AGENT.
 *
 * `agent` is a node of the fleet projection. It is only editable when that node
 * is also an agent of the declared organisation — the projection is generated
 * FROM the org, so normally it is, but a stale fleet.json can name an agent the
 * org no longer has. When it does, the control is disabled and says which fact
 * is missing, rather than offering a menu whose every choice returns
 * AGENT_ORG_STORE_UNKNOWN_AGENT.
 *
 * `onAssign(roleId)` must return the awaited {ok, ...} result of
 * mcOrg.assignRole. This builder does not call the bridge itself: the view owns
 * the revision it is holding and what has to be re-drawn afterwards.
 */
export function buildRoleAssignBox({ agent, availability, onAssign }) {
  const roles = availability?.state === 'ready' ? availability.roles : []
  const declared = availability?.state === 'ready'
    ? availability.org.agents.find(entry => entry.id === agent.id) || null
    : null
  const blocked = disabledReason(availability)
    || (declared ? null : `This agent is not part of the organisation saved on this computer, so its role cannot be changed here. The fleet record still names it "${agent.declaredRole || agent.id}".`)
  const current = declared?.role || agent.declaredRole || ''
  const disabled = Boolean(blocked)

  const box = el(`
    <div class="board-box board-role-box">
      <div class="board-box-h"><span class="bh-t">Role</span></div>
      <div class="board-cap">what this agent is declared to be, and what that is enforced to mean</div>
      ${blocked ? `<div class="org-notice" data-notice="off">${escapeMarkup(blocked)}</div>` : ''}
      <label class="ctl-field"><span class="cl">Role</span>
        <select class="ctl-select" data-role="pick" aria-label="Declared role"${disabled ? ' disabled' : ''}>
          ${roles.length
            ? roles.map(role => `<option value="${escapeMarkup(role.id)}"${role.id === current ? ' selected' : ''}>${escapeMarkup(roleOptionLabel(role))}</option>`).join('')
            : `<option value="">${escapeMarkup(current || 'unavailable')}</option>`}
        </select>
      </label>
      <div class="role-facts" data-role="facts">${roleFactsMarkup(roles.find(role => role.id === current))}</div>
      <div class="ctl-dispatch">
        <button class="ctl-btn" type="button" data-role="apply"${disabled ? ' disabled' : ''}${blocked ? ` title="${escapeMarkup(blocked)}"` : ''}>Save role</button>
        <output class="ctl-out" data-role="out" role="status"></output>
      </div>
    </div>`)

  if (disabled) return box

  const select = box.querySelector('[data-role="pick"]')
  const facts = box.querySelector('[data-role="facts"]')
  const apply = box.querySelector('[data-role="apply"]')
  const output = box.querySelector('[data-role="out"]')

  select.addEventListener('change', () => {
    facts.innerHTML = roleFactsMarkup(roles.find(role => role.id === select.value))
    output.textContent = select.value === current ? '' : 'not saved yet'
  })

  apply.addEventListener('click', async () => {
    if (select.value === current) {
      output.textContent = 'already this role'
      return
    }
    apply.disabled = true
    output.textContent = 'saving…'
    const result = await onAssign(select.value)
    if (!box.isConnected) return
    apply.disabled = false
    output.textContent = result?.ok
      ? 'saved'
      : (isRevisionConflict(result) ? REVISION_CONFLICT_ADVICE : failureSentence(result, 'The role was not changed.'))
  })

  return box
}

/**
 * THE ROLE LIBRARY.
 *
 * Every role this copy can assign, what each one is enforced to mean, and the
 * three rule fields a person may rewrite. Defaults are editable too — the
 * engine records a default's override separately from a custom role precisely
 * so it can be rolled back — and only a default is offered the rollback.
 *
 * The callbacks return the awaited bridge results. `roles` is replaced from
 * whatever they return, so the list can never drift from what was stored.
 */
export function buildRoleLibraryBox({ availability, onCreate, onEdit, onReset }) {
  const blocked = disabledReason(availability)
  const disabled = Boolean(blocked)
  let roles = availability?.state === 'ready' ? availability.roles : []

  const box = el(`
    <div class="board-box board-roles-box">
      <div class="board-box-h"><span class="bh-t">Role library</span></div>
      <div class="board-cap">every role that can be assigned on this computer, and what each one is enforced to mean</div>
      ${blocked ? `<div class="org-notice" data-notice="off">${escapeMarkup(blocked)}</div>` : ''}
      <div class="role-list" data-roles="list"></div>
      <output class="ctl-out" data-roles="out" role="status"></output>
    </div>`)

  const list = box.querySelector('[data-roles="list"]')
  const output = box.querySelector('[data-roles="out"]')

  const say = (text) => { output.textContent = text }

  function defaultRoleIds() {
    return roles.filter(role => !role.custom).map(role => role.id)
  }

  function createFormMarkup() {
    const bases = defaultRoleIds()
    return `
      <details class="role-item role-new">
        <summary><b>Create a role</b><span class="role-kind">new</span></summary>
        <div class="role-body">
          <label class="role-field"><span class="cl">Id</span>
            <input class="role-input" type="text" data-field="id" maxlength="64" placeholder="release-warden"
              aria-label="New role id"${disabled ? ' disabled' : ''}/>
          </label>
          <div class="rail-sub">Lowercase letters, numbers, hyphen or underscore. It cannot be one of the shipped ids, and "owner", "me" and "act" are reserved because other parts of the product read them as proof that no agent is involved.</div>
          <label class="role-field"><span class="cl">Based on</span>
            <select class="ctl-select" data-field="base" aria-label="Base default role"${disabled ? ' disabled' : ''}>
              <option value="">No base · watch only</option>
              ${bases.map(id => {
                const base = roles.find(role => role.id === id)
                return `<option value="${escapeMarkup(id)}">${escapeMarkup(id)} · ${escapeMarkup(claimLabel(base))}</option>`
              }).join('')}
            </select>
          </label>
          <div class="rail-sub" data-field="base-note">The base decides what the new role may do. A role with no base can only watch, whatever its wording says.</div>
          ${ruleFieldsMarkup(null, { prefix: 'new role', disabled })}
          <div class="rail-sub">All three are required, and each is at most ${MAX_RULE_TEXT} characters.</div>
          <div class="role-actions">
            <button class="ctl-btn" type="button" data-act="create"${disabled ? ' disabled' : ''}${blocked ? ` title="${escapeMarkup(blocked)}"` : ''}>Create role</button>
          </div>
        </div>
      </details>`
  }

  function roleItemMarkup(role) {
    return `
      <details class="role-item" data-role-id="${escapeMarkup(role.id)}">
        <summary>
          <b>${escapeMarkup(role.name || role.id)}</b>
          <span class="role-claim" data-claim="${claimFlag(role)}">${escapeMarkup(claimLabel(role))}</span>
          <span class="role-kind">${role.custom ? 'custom' : 'shipped'}</span>
        </summary>
        <div class="role-body">
          <div class="rail-sub">${escapeMarkup(role.summary || 'This role ships no summary.')}</div>
          ${role.custom
            ? `<div class="rail-sub">${role.baseDefaultRole ? `Based on ${escapeMarkup(role.baseDefaultRole)}.` : 'No base role, so it can only watch.'}</div>`
            : ''}
          ${role.enforced?.singleSeat ? '<div class="rail-sub">Exactly one agent may hold this role.</div>' : ''}
          ${ruleFieldsMarkup(role, { prefix: role.id, disabled })}
          <div class="role-actions">
            <button class="ctl-btn" type="button" data-act="save"${disabled ? ' disabled' : ''}${blocked ? ` title="${escapeMarkup(blocked)}"` : ''}>Save wording</button>
            ${role.custom ? '' : `<button class="ctl-btn" type="button" data-act="reset"${disabled ? ' disabled' : ''}${blocked ? ` title="${escapeMarkup(blocked)}"` : ''}>Restore shipped wording</button>`}
          </div>
        </div>
      </details>`
  }

  function readRules(scope) {
    const values = {}
    for (const field of RULE_FIELDS) {
      values[field.key] = String(scope.querySelector(`[data-field="${field.key}"]`)?.value ?? '').trim()
    }
    return values
  }

  function render() {
    const open = new Set([...list.querySelectorAll('details[open]')].map(node => node.dataset.roleId || 'new'))
    list.innerHTML = roles.length
      ? roles.map(roleItemMarkup).join('') + createFormMarkup()
      : `<div class="rail-sub">${escapeMarkup(blocked || 'No roles were returned by the organisation store.')}</div>`
    for (const node of list.querySelectorAll('details')) {
      if (open.has(node.dataset.roleId || 'new')) node.open = true
    }
  }

  function setRoles(next) {
    if (Array.isArray(next)) roles = next
    render()
  }

  list.addEventListener('change', (event) => {
    const select = event.target.closest?.('[data-field="base"]')
    if (!select) return
    const note = select.closest('.role-body')?.querySelector('[data-field="base-note"]')
    if (!note) return
    const base = roles.find(role => role.id === select.value)
    note.textContent = base
      ? `Based on ${base.id}, this role ${claimLabel(base)}. The base decides what the role may do; the wording below only describes it.`
      : 'The base decides what the new role may do. A role with no base can only watch, whatever its wording says.'
  })

  list.addEventListener('click', async (event) => {
    const button = event.target.closest?.('[data-act]')
    if (!button || disabled) return
    const item = button.closest('.role-item')
    const scope = button.closest('.role-body')
    if (!item || !scope) return
    const action = button.dataset.act
    button.disabled = true
    say(action === 'reset' ? 'restoring…' : 'saving…')
    let result = null
    if (action === 'create') {
      result = await onCreate({
        id: String(scope.querySelector('[data-field="id"]')?.value ?? '').trim(),
        baseDefaultRole: String(scope.querySelector('[data-field="base"]')?.value ?? '') || null,
        rules: readRules(scope),
      })
    } else if (action === 'save') {
      result = await onEdit({ id: item.dataset.roleId, rules: readRules(scope) })
    } else if (action === 'reset') {
      result = await onReset({ id: item.dataset.roleId })
    }
    if (!box.isConnected) return
    button.disabled = false
    if (result?.ok) {
      say(action === 'create' ? 'role created' : action === 'reset' ? 'shipped wording restored' : 'wording saved')
      setRoles(result.roles)
      return
    }
    say(failureSentence(result, action === 'create' ? 'The role was not created.' : 'The role was not changed.'))
  })

  render()
  box.setRoles = setRoles
  return box
}

/* WHAT A PERSON HAD OPEN AND TYPED IN A ROLE LIBRARY BOX, AS DATA.
 *
 * src/write-flags.js and src/data-source.js announce every change, and
 * src/main.js re-renders the whole route when it hears one. That remount
 * rebuilt this box from the stored roles -- so wording a person had typed but
 * not yet saved was silently destroyed by pressing an UNRELATED switch:
 * measured on the packaged build 2026-08-20 (order-variation drive), typed
 * wording survived opening and cancelling the start panel, and died the
 * moment "Turn on running agents" was pressed. The compose panel already
 * rides that remount (composeToRestore in src/views/computers.js); these two
 * functions are the same treatment for this box, and they live here because
 * this file owns the markup they read and rewrite.
 *
 * The snapshot keeps an entry for every role item that is open OR carries an
 * edit (a value that differs from what the render painted), so wording typed
 * into a closed item rides too. It is plain data, safe to hold across the
 * teardown. */
export function snapshotRoleLibrary(box) {
  const list = box?.querySelector?.('[data-roles="list"]')
  if (!list) return null
  const items = []
  for (const item of list.querySelectorAll('details.role-item')) {
    const id = item.dataset.roleId || 'new'
    const open = item.open === true
    const fields = {}
    let edited = false
    for (const control of item.querySelectorAll('input[data-field], textarea[data-field], select[data-field]')) {
      const key = control.dataset.field
      if (!key) continue
      const value = String(control.value ?? '')
      fields[key] = value
      if ('defaultValue' in control && value !== String(control.defaultValue ?? '')) edited = true
    }
    if (open || edited) items.push({ id, open, fields })
  }
  return items.length ? items : null
}

/** Reapply a snapshot to a freshly built box: reopen what was open, put back
 * what was typed. Only fields the new render still has are written -- a role
 * deleted in between simply has nowhere to restore to, and nothing invents
 * one. Returns how many items it touched, because the caller's contract is
 * apply-until-the-person-interacts and a restore that found nothing must not
 * count as having happened. */
export function restoreRoleLibrary(box, snapshot) {
  const list = box?.querySelector?.('[data-roles="list"]')
  if (!list || !Array.isArray(snapshot)) return 0
  const itemFor = (id) => [...list.querySelectorAll('details.role-item')]
    .find(node => (node.dataset.roleId || 'new') === id)
  let applied = 0
  for (const saved of snapshot) {
    const item = itemFor(saved.id)
    if (!item) continue
    if (saved.open) item.open = true
    for (const [key, value] of Object.entries(saved.fields || {})) {
      const control = item.querySelector(`input[data-field="${key}"], textarea[data-field="${key}"], select[data-field="${key}"]`)
      if (control && !control.disabled) control.value = value
    }
    applied += 1
  }
  return applied
}
