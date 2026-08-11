'use strict'

/* THE ORGANISATION THE PERSON EDITS, AND WHERE THE EDIT GOES.
 *
 * The agent page lets someone drag an agent onto a new manager, give it a
 * different role, and define roles of their own. Before this file, the first of
 * those wrote a field on an in-memory object that the next projection load
 * rebuilt from JSON, and the other two did not exist. The control looked like it
 * worked; it could not have worked, because nothing in the product could write
 * the declared organisation at all.
 *
 * IT WRITES THE ENGINE'S RECORD, NOT A SECOND ONE. Every rule about what a
 * legal organisation is -- one controller, one manager per agent, no management
 * cycle, no relationship naming an agent that does not exist, no role outside
 * the declared vocabulary -- lives in the payload's own src/lib/agent-org.js and
 * is applied by src/lib/agent-org-store.js. This file resolves those modules and
 * hands them arguments. It contains no opinion about organisations, because a
 * second opinion here is a second implementation, and the second one is always
 * the one that drifts.
 *
 * (This is the same shape, and the same reasoning, as shell/setup-record.cjs,
 * which delegates the permission level to src/lib/setup/machine-record.js
 * rather than keeping a shell-side copy of what a tier means.)
 *
 * NOTHING HERE THROWS. Every function returns {ok:true, ...} or {ok:false, code,
 * reason}. An IPC handler that throws gives the renderer an Error with a
 * stringified message and no code to branch on, and the page then has to decide
 * what a failure means by reading English. The codes below are what the page
 * turns into a sentence a person can act on.
 */

const path = require('node:path')
const { resolveCapabilityRoot } = require('./capability-layer.cjs')

/* Declared in tools/capability-manifest.json under `hostModules`, which is what
 * stages them into the payload. A copy of each path is unavoidable -- the
 * manifest is a build input and this is a runtime read -- so a miss is reported
 * as "the payload does not carry this" and names the manifest, rather than
 * surfacing a bare MODULE_NOT_FOUND that reads like a bug in this file. */
const ORG_STORE_MODULE = 'src/lib/agent-org-store.js'
const CUSTOM_ROLE_MODULE = 'src/lib/custom-role-store.js'
const DURABLE_MEMORY_MODULE = 'src/lib/durable-memory-file.js'
const AGENT_ORG_MODULE = 'src/lib/agent-org.js'
const AGENT_ROLES_MODULE = 'src/lib/agent-roles.js'
const BASELINE_ORG_FILE = 'config/agent-org.json'
const CUSTOM_ROLES_FILE = 'custom-roles.json'

function failure(code, reason) {
  return { ok: false, code, reason }
}

/* A payload error carries a `code` from the engine (AGENT_ORG_CYCLE,
 * CUSTOM_ROLE_RESERVED_ID, ...). That code is the useful part and is passed
 * through unchanged: the page branches on it, and inventing a shell-side code
 * here would mean the page had two vocabularies for the same failure. */
function fromError(error, fallbackCode) {
  const code = error && typeof error.code === 'string' ? error.code : fallbackCode
  const reason = error && typeof error.message === 'string' ? error.message : 'The organisation could not be changed.'
  return { ok: false, code, reason }
}

function loadModules({ root = resolveCapabilityRoot(), load = require } = {}) {
  if (!root) {
    return failure(
      'ORG_PAYLOAD_ABSENT',
      'No capability payload is present, so this copy has no organisation to read or edit.',
    )
  }
  let orgStore
  let customRoleStore
  let durableMemory
  let agentOrg
  let agentRoles
  try {
    orgStore = load(path.join(root, ORG_STORE_MODULE))
    customRoleStore = load(path.join(root, CUSTOM_ROLE_MODULE))
    durableMemory = load(path.join(root, DURABLE_MEMORY_MODULE))
    agentOrg = load(path.join(root, AGENT_ORG_MODULE))
    agentRoles = load(path.join(root, AGENT_ROLES_MODULE))
  } catch (error) {
    return failure(
      'ORG_MODULES_ABSENT',
      `The capability payload does not carry its organisation modules (${error.message}). They are staged by tools/capability-manifest.json under hostModules.`,
    )
  }
  if (typeof orgStore?.createAgentOrgStore !== 'function'
    || typeof customRoleStore?.createCustomRoleStore !== 'function'
    || typeof durableMemory?.createDurableMemoryFile !== 'function'
    || typeof durableMemory?.resolveServicesRoot !== 'function'
    || !Array.isArray(agentOrg?.ROLES)
    || !Array.isArray(agentRoles?.ROLE_LIBRARY)) {
    return failure('ORG_MODULES_UNRECOGNIZED', 'The capability payload carries organisation modules this shell does not recognize.')
  }
  return { ok: true, root, orgStore, customRoleStore, durableMemory, agentOrg, agentRoles }
}

/* The custom-role store and the org store share one installation directory --
 * %LOCALAPPDATA%\ToolsEnabled, resolved by the payload rather than guessed at
 * here, so this shell cannot disagree with the engine about where an
 * installation lives. */
function composeStores(modules, { env = process.env } = {}) {
  const servicesRoot = modules.durableMemory.resolveServicesRoot({ env })
  const customRoles = modules.customRoleStore.createCustomRoleStore({
    stateStore: modules.durableMemory.createDurableMemoryFile({
      file: path.join(servicesRoot, CUSTOM_ROLES_FILE),
    }),
  })
  const org = modules.orgStore.createAgentOrgStore({
    baselineFile: path.join(modules.root, BASELINE_ORG_FILE),
    customRoles,
    env,
  })
  return { customRoles, org, servicesRoot }
}

/* WHAT THE PAGE IS TOLD ABOUT A ROLE, AND WHY `enforced` IS PART OF IT.
 *
 * src/lib/agent-roles.js carries, for every shipped role, both what the role is
 * asked to do (`mustNot`) and what the product mechanically guarantees
 * (`enforced`). Those are different claims. A surface that offers someone a role
 * in a menu is making the role's description into a promise, so the description
 * and the enforcement travel together to the page and the page shows both.
 *
 * `mayClaimWork` is the one that matters in practice: it is the difference
 * between a role that is described as read-only and a role that is read-only. */
function describeRoles(modules, stores) {
  const library = new Map(modules.agentRoles.ROLE_LIBRARY.map((role) => [role.id, role]))
  const defaults = new Set(modules.agentOrg.ROLES)
  return stores.customRoles.listRoles().map((stored) => {
    const shipped = library.get(stored.id) || null
    const isDefault = defaults.has(stored.id)
    const base = stored.baseDefaultRole || null
    /* A custom role's authority comes from the default it is based on, and a
       custom role with no base cannot claim work. That is the engine's rule
       (agent-org.js claimPostureFor); it is restated to the page as data, not
       re-decided here. */
    const postureSource = isDefault ? stored.id : base
    const mayClaimWork = postureSource
      ? !modules.agentOrg.NON_CLAIMING_ROLES.includes(postureSource)
      : false
    return {
      id: stored.id,
      name: shipped ? shipped.name : stored.id,
      custom: !isDefault,
      baseDefaultRole: base,
      summary: shipped ? shipped.summary : null,
      owns: stored.rules.owns,
      mustNot: stored.rules.mustNot,
      handoff: stored.rules.handoff,
      rules: shipped ? [...shipped.rules] : [],
      enforced: {
        mayClaimWork,
        singleSeat: shipped ? shipped.enforced.singleSeat : false,
      },
    }
  })
}

function projectOrg(read) {
  return {
    revision: read.org.revision,
    contentHash: read.org.contentHash,
    source: read.source,
    damaged: read.damaged,
    baselineDrift: read.baselineDrift,
    agents: read.org.agents.map((agent) => ({
      id: agent.id,
      displayName: agent.displayName,
      role: agent.role,
      provider: agent.provider,
      enabled: agent.enabled,
      assignedPhase: agent.assignedPhase,
      phasePriority: [...agent.phasePriority],
    })),
    relationships: read.org.relationships.map((relation) => ({ ...relation })),
  }
}

function createAgentOrgRecord({ env = process.env, modules = loadModules() } = {}) {
  /* Resolved once per call rather than cached across calls. The store reads its
     files on demand, and a cached store would keep serving an organisation that
     another window had already changed. */
  function withStores(operation, fallbackCode) {
    if (!modules.ok) return modules
    let stores
    try {
      stores = composeStores(modules, { env })
    } catch (error) {
      return fromError(error, 'ORG_STORE_UNAVAILABLE')
    }
    try {
      return operation(stores)
    } catch (error) {
      return fromError(error, fallbackCode)
    }
  }

  return {
    /* Everything the page needs to draw the organisation AND its editing
       controls, in one call: the org, the role vocabulary that may be assigned,
       and what each role actually enforces. Split across three calls the page
       could render a role menu that disagreed with the org it was drawn over. */
    read() {
      return withStores((stores) => ({
        ok: true,
        org: projectOrg(stores.org.read()),
        roles: describeRoles(modules, stores),
        overlayFile: stores.org.overlayFile,
      }), 'ORG_READ_FAILED')
    },

    reparent({ agentId, parentId, expectedRevision }) {
      return withStores((stores) => {
        stores.org.reparent(
          { agentId, parentId: parentId === undefined ? null : parentId },
          expectedRevision === undefined ? {} : { expectedRevision },
        )
        return { ok: true, org: projectOrg(stores.org.read()) }
      }, 'ORG_REPARENT_FAILED')
    },

    assignRole({ agentId, role, expectedRevision }) {
      return withStores((stores) => {
        stores.org.assignRole({ agentId, role }, expectedRevision === undefined ? {} : { expectedRevision })
        return { ok: true, org: projectOrg(stores.org.read()) }
      }, 'ORG_ASSIGN_ROLE_FAILED')
    },

    createRole({ id, baseDefaultRole, rules }) {
      return withStores((stores) => {
        stores.customRoles.createCustomRole({ id, baseDefaultRole: baseDefaultRole || null, rules })
        return { ok: true, roles: describeRoles(modules, stores) }
      }, 'ORG_CREATE_ROLE_FAILED')
    },

    /* Editing a DEFAULT role and editing a CUSTOM one are different operations
       in the engine -- a default is overridden and can be rolled back, a custom
       role is simply changed -- so the choice is made from the store's own
       record of which it is, not from anything the renderer asserts. */
    editRole({ id, rules }) {
      return withStores((stores) => {
        const record = stores.customRoles.getRoleRecord(id)
        if (!record) return failure('CUSTOM_ROLE_NOT_FOUND', `There is no role "${id}".`)
        const isDefault = modules.agentOrg.ROLES.includes(id)
        if (isDefault) {
          stores.customRoles.editDefaultRole({ id, rules, expectedRevision: record.revision })
        } else {
          stores.customRoles.editRole({ id, rules, expectedRevision: record.revision })
        }
        return { ok: true, roles: describeRoles(modules, stores) }
      }, 'ORG_EDIT_ROLE_FAILED')
    },

    resetRole({ id }) {
      return withStores((stores) => {
        if (!modules.agentOrg.ROLES.includes(id)) {
          return failure('CUSTOM_ROLE_NOT_DEFAULT', `"${id}" is not a shipped role, so there is no shipped wording to restore.`)
        }
        const record = stores.customRoles.getRoleRecord(id)
        stores.customRoles.rollbackDefaultRole({ id, expectedRevision: record ? record.revision : 0 })
        return { ok: true, roles: describeRoles(modules, stores) }
      }, 'ORG_RESET_ROLE_FAILED')
    },

    exportOrg() {
      return withStores((stores) => ({ ok: true, document: stores.org.exportOrg() }), 'ORG_EXPORT_FAILED')
    },

    resetOrg() {
      return withStores((stores) => {
        stores.org.resetToBaseline()
        return { ok: true, org: projectOrg(stores.org.read()) }
      }, 'ORG_RESET_FAILED')
    },
  }
}

module.exports = {
  AGENT_ORG_MODULE,
  AGENT_ROLES_MODULE,
  BASELINE_ORG_FILE,
  CUSTOM_ROLES_FILE,
  CUSTOM_ROLE_MODULE,
  DURABLE_MEMORY_MODULE,
  ORG_STORE_MODULE,
  createAgentOrgRecord,
  loadModules,
}
