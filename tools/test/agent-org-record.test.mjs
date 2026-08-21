/* The shell's organisation bridge -- the layer between the window and the
   payload's org engine.

   These are unit tests over that layer, and they are NECESSARY AND NOT
   SUFFICIENT. Two other files decide whether the capability actually works:
   tools/org-persistence-proof.mjs, which drives the PACKAGED binary against a
   sterile LOCALAPPDATA and kills it between phases so "it persisted" cannot be
   satisfied by an in-memory cache, and tools/org-window-proof.mjs, which calls
   window.mcOrg from inside the real packaged window so a bridge that is perfect
   here but unreachable from the page cannot pass.

   That split matters for this file in particular. The defect this whole lane
   exists to remove was a control that looked real and did nothing, and a unit
   test over the module behind such a control is exactly the kind of green that
   would not have caught it. */
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const record = require('../../shell/agent-org-record.cjs')

const PAYLOAD = path.resolve(process.cwd(), 'capability')
const havePayload = fs.existsSync(path.join(PAYLOAD, 'src/lib/agent-org-store.js'))

/* Every test gets its own LOCALAPPDATA. Sharing one would let an earlier test's
   custom role decide a later test's role count, which is the same class of
   mistake as inheriting the builder's profile, one scope down. */
function isolated() {
  const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'org-record-'))
  const modules = record.loadModules({ root: PAYLOAD })
  assert.equal(modules.ok, true, `payload modules must load: ${modules.reason || ''}`)
  return record.createAgentOrgRecord({ modules, env: { ...process.env, LOCALAPPDATA: localAppData } })
}

test('a missing payload is a named refusal, not a crash', () => {
  const absent = record.loadModules({ root: null })
  assert.equal(absent.ok, false)
  assert.equal(absent.code, 'ORG_PAYLOAD_ABSENT')
  assert.match(absent.reason, /no capability payload/i)
})

test('a payload without the organisation modules names the manifest that stages them', () => {
  const broken = record.loadModules({
    root: PAYLOAD,
    load: () => { throw new Error('MODULE_NOT_FOUND') },
  })
  assert.equal(broken.ok, false)
  assert.equal(broken.code, 'ORG_MODULES_ABSENT')
  /* The message has to point at the manifest. A bare MODULE_NOT_FOUND reads as
     a bug in the shell rather than as a payload that was cut without them. */
  assert.match(broken.reason, /capability-manifest\.json/)
  assert.match(broken.reason, /hostModules/)
})

test('a payload carrying the wrong shape is refused rather than half-used', () => {
  const wrong = record.loadModules({ root: PAYLOAD, load: () => ({}) })
  assert.equal(wrong.ok, false)
  assert.equal(wrong.code, 'ORG_MODULES_UNRECOGNIZED')
})

test('read returns the organisation, the role vocabulary, and what each role enforces', { skip: !havePayload }, () => {
  const api = isolated()
  const read = api.read()
  assert.equal(read.ok, true)
  assert.equal(read.org.source, 'baseline', 'a fresh profile has no overlay yet')
  assert.equal(read.roles.length, 9, 'the nine shipped roles')

  /* THE HONESTY REQUIREMENT. A surface that offers someone a role in a menu
     turns that role's description into a promise. So the page is given what the
     product actually enforces alongside what the role says, and this pins the
     set by name -- a count would also be satisfied by enforcing the wrong five. */
  const cannotClaim = read.roles.filter((role) => role.enforced.mayClaimWork === false).map((role) => role.id).sort()
  assert.deepEqual(cannotClaim,
    ['coordinator-assistant', 'observer', 'planner', 'reviewer', 'shadow-manager'])
  assert.ok(read.roles.every((role) => typeof role.summary === 'string' && role.summary.length > 0),
    'a role reaches the page with the one sentence someone choosing it will read')
  assert.ok(read.roles.every((role) => typeof role.mustNot === 'string' && role.mustNot.length > 0),
    'a role reaches the page with what it refuses')
})

test('a custom role can be created, and is reported with the authority of its base', { skip: !havePayload }, () => {
  const api = isolated()
  const made = api.createRole({
    id: 'watcher',
    baseDefaultRole: 'observer',
    rules: {
      owns: 'Watching one named surface and reporting what it shows.',
      mustNot: 'Change the thing it is watching.',
      handoff: 'Receives access only; publishes what it measured.',
    },
  })
  assert.equal(made.ok, true, made.reason)
  const watcher = made.roles.find((role) => role.id === 'watcher')
  assert.ok(watcher, 'the new role comes back in the list')
  assert.equal(watcher.custom, true)
  assert.equal(watcher.baseDefaultRole, 'observer')
  /* The escalation guard, at the surface: copying a read-only role under a new
     name must not produce a role the page will describe as able to reserve work. */
  assert.equal(watcher.enforced.mayClaimWork, false)
})

test('a reserved identifier is refused with a code the page can branch on', { skip: !havePayload }, () => {
  const api = isolated()
  for (const reserved of ['owner', 'me', 'act']) {
    const refused = api.createRole({
      id: reserved, baseDefaultRole: 'builder',
      rules: { owns: 'a', mustNot: 'b', handoff: 'c' },
    })
    assert.equal(refused.ok, false, `"${reserved}" must be refused`)
    assert.equal(refused.code, 'CUSTOM_ROLE_RESERVED_ID')
  }
})

test('an illegal reparent is refused with a sentence a person can act on', { skip: !havePayload }, () => {
  const api = isolated()
  const refused = api.reparent({ agentId: 'controller', parentId: 'controller' })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'AGENT_ORG_STORE_CONTROLLER_ROOTED')
  /* Not a stack, not an error name. The page shows this to somebody. */
  assert.match(refused.reason, /accountable root/i)
})

test('nothing throws; every refusal is a value', { skip: !havePayload }, () => {
  const api = isolated()
  /* An IPC handler that throws hands the renderer an Error with a stringified
     message and no code, and the page then has to decide what went wrong by
     reading English. Each of these is a different failure shape. */
  for (const call of [
    () => api.reparent({ agentId: 'nobody', parentId: 'controller' }),
    () => api.assignRole({ agentId: 'nobody', role: 'builder' }),
    () => api.assignRole({ agentId: 'controller', role: 'not-a-role' }),
    () => api.createRole({ id: '', baseDefaultRole: 'builder', rules: {} }),
    () => api.editRole({ id: 'no-such-role', rules: { owns: 'a', mustNot: 'b', handoff: 'c' } }),
    () => api.resetRole({ id: 'no-such-role' }),
  ]) {
    const result = call()
    assert.equal(result.ok, false)
    assert.equal(typeof result.code, 'string', 'a refusal carries a code')
    assert.ok(result.code.length > 0)
    assert.equal(typeof result.reason, 'string', 'a refusal carries a reason')
  }
})

test('an export is a document that can be read back as an organisation', { skip: !havePayload }, () => {
  const api = isolated()
  const exported = api.exportOrg()
  assert.equal(exported.ok, true)
  assert.deepEqual(Object.keys(exported.document).sort(), ['agents', 'relationships', 'revision', 'schemaVersion'])
  const agentOrg = require(path.join(PAYLOAD, 'src/lib/agent-org.js'))
  assert.doesNotThrow(() => agentOrg.normalizeOrg(exported.document))
})
