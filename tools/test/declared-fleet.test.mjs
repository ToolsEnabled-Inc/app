/* THE COMPUTER A CUSTOMER CAN ACTUALLY SEE.
 *
 * Measured on the packaged build with a fresh profile before this adapter
 * existed: /data/fleet.json ok:false, /data/agents.json ok:false,
 * window.mcOrg.read() ok:true with one declared agent — and zero nodes on the
 * fleet page. Both projections are build-time files; they ship `ok:false` on
 * every install and can never say anything else. The organisation record is the
 * only per-machine source either surface has, and it was read and discarded.
 *
 * The packaged proof is tools/agent-route-reachability.mjs, which drives a real
 * window by clicking. This suite pins the decisions that harness cannot reach
 * from inside a packaged app — above all the NULL cases, because "there is
 * nothing here" has to stay a possible answer or the empty state becomes
 * unreachable code that quietly rots.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  declaredFleetData, declaredAgentsData, THIS_COMPUTER_ID, THIS_COMPUTER_LABEL,
} from '../../src/declared-fleet.js'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/* THE ORGANISATION A FRESH INSTALL ACTUALLY HOLDS — READ, NOT REMEMBERED.
 *
 * This fixture used to be a literal, annotated "measured from window.mcOrg.read()
 * in a packaged window with an isolated LOCALAPPDATA": one controller, no
 * relationships. That measurement was true when it was taken and is now false.
 * capability-defaults/config/agent-org.json is the file the build stages in
 * place of the builder's own organisation, and it declares a controller plus
 * the codex and claude seats a dispatch resolves against; before that, EVERY
 * dispatch on EVERY packaged install refused because no agent was declared for
 * any tier.
 *
 * So the fixture is now READ from that file rather than restated next to it. A
 * copy of a shipped default in a suite is a second declaration of it, and the
 * copy is the one nobody updates — this suite went on asserting a one-agent
 * fresh install for as long as it took somebody to notice. Reading the file
 * means the shipped default and the thing this suite calls "a fresh install"
 * cannot drift apart again, and it means the assertions below have to be about
 * PROPERTIES rather than about a count somebody typed. */
const SHIPPED_DEFAULT_ORG = JSON.parse(
  readFileSync(path.join(REPO, 'capability-defaults', 'config', 'agent-org.json'), 'utf8'),
)

/* The record shape the fleet page is handed, which is what the org store hands
   it: the declaration plus the revision and provenance the store adds. */
const FRESH_INSTALL_ORG = Object.freeze({
  revision: SHIPPED_DEFAULT_ORG.revision,
  source: 'baseline',
  agents: SHIPPED_DEFAULT_ORG.agents,
  relationships: SHIPPED_DEFAULT_ORG.relationships,
})

const TWO_AGENT_ORG = Object.freeze({
  revision: 4,
  source: 'overlay',
  agents: [
    { id: 'controller', displayName: 'Controller', role: 'controller', provider: 'none', enabled: true },
    { id: 'helper-1', displayName: 'Helper', role: 'manager', provider: 'codex', enabled: false },
  ],
  relationships: [{ from: 'controller', to: 'helper-1', type: 'manages' }],
})

test('a fresh install puts this computer on the fleet page', () => {
  const data = declaredFleetData(FRESH_INSTALL_ORG)
  assert.ok(data, 'the organisation a fresh install ships with must produce a computer')
  assert.equal(data.computers.length, 1)
  assert.equal(data.computers[0].id, THIS_COMPUTER_ID)
  assert.equal(data.computers[0].label, THIS_COMPUTER_LABEL)
  /* Every declared agent is drawn, and drawn in the order it was declared: the
     page's own drill-in resolves by id from this list, so an agent the shipped
     default declares and this projection drops is an agent a customer can never
     open. */
  assert.deepEqual(
    data.graph.nodes.map(node => node.id),
    SHIPPED_DEFAULT_ORG.agents.map(agent => agent.id),
  )
  const controller = data.graph.nodes.find(node => node.role === 'controller')
  assert.ok(controller, 'the fleet page must show the agent that acts on this window\'s behalf')
  assert.equal(controller.label, 'Controller')
})

test('a fresh install ships an agent for each engine a dispatch can ask for', () => {
  /* THE PROPERTY THE ONE-AGENT FIXTURE COULD NOT HAVE HELD. The mission bridge
     resolves a dispatch by finding a declared agent whose provider matches the
     requested tier's, so a default declaring the controller alone made every
     tier undispatchable on every install. This suite cannot POST a dispatch —
     tools/agent-dispatch-packaged-qa.mjs does that against a real bridge — but
     it can hold the half the bridge reads. */
  const providers = new Set(declaredFleetData(FRESH_INSTALL_ORG).graph.nodes
    .filter(node => node.enabled)
    .map(node => node.provider))
  for (const provider of ['codex', 'claude']) {
    assert.ok(providers.has(provider), `a fresh install declares no enabled ${provider} agent, so every ${provider} tier refuses`)
  }
})

test('every agent a fresh install declares is reachable from the controller', () => {
  /* Not decoration. An agent with no management edge survives the lane resolver
     (it falls back to the enabled controller) and then becomes UN-TERMINABLE,
     because termination authorises through the declared management graph. The
     shipped default states this rule about itself; this is where it is checked. */
  const data = declaredFleetData(FRESH_INSTALL_ORG)
  const managed = new Set(data.graph.edges.filter(edge => edge.type === 'manages').map(edge => edge.to))
  for (const node of data.graph.nodes) {
    if (node.role === 'controller') continue
    assert.ok(managed.has(node.id), `${node.id} is declared with no manager, so nothing can stop it`)
  }
})

test('the computer id is a stable route segment and carries no machine identity', () => {
  /* It is the middle segment of #/agent/<computer>/<agent>, so a host name here
     would rot every bookmark on rename AND put an owner-identifying string into
     every screenshot of a URL. */
  assert.match(THIS_COMPUTER_ID, /^[a-z][a-z0-9-]*$/)
  const first = declaredFleetData(FRESH_INSTALL_ORG).computers[0].id
  const second = declaredFleetData(TWO_AGENT_ORG).computers[0].id
  assert.equal(first, second, 'the id must not vary with the organisation it was built from')
})

test('nothing that was not observed is reported as observed', () => {
  const node = declaredFleetData(TWO_AGENT_ORG).graph.nodes[1]
  /* A declared agent has never run. A zero here would be read as "ran and did
     nothing", which is the hollow-metric defect this project has already been
     bitten by; the field must be ABSENT so the view prints its own
     "not provided by fleet projection". */
  for (const field of ['bornAt', 'stoppedAt', 'tasksDone', 'failRate', 'origin']) {
    assert.equal(Object.hasOwn(node, field), false, `${field} must not be synthesised`)
  }
  assert.deepEqual(declaredFleetData(TWO_AGENT_ORG).computers[0].services, [])
  assert.equal(declaredAgentsData(TWO_AGENT_ORG).observedSessions.ok, false)
})

test('declared state travels intact, including disabled', () => {
  const [controller, helper] = declaredFleetData(TWO_AGENT_ORG).graph.nodes
  assert.equal(controller.enabled, true)
  assert.equal(helper.enabled, false, 'a disabled agent must not be drawn as enabled')
  assert.equal(helper.role, 'manager')
  assert.equal(helper.provider, 'codex')
  assert.deepEqual(declaredFleetData(TWO_AGENT_ORG).graph.edges, [
    { from: 'controller', to: 'helper-1', type: 'manages', sourceKind: 'declared' },
  ])
})

test('an edge to an agent that is not declared is dropped, not drawn', () => {
  const data = declaredFleetData({
    ...TWO_AGENT_ORG,
    relationships: [
      { from: 'controller', to: 'helper-1', type: 'manages' },
      { from: 'controller', to: 'ghost', type: 'manages' },
    ],
  })
  assert.equal(data.graph.edges.length, 1)
  assert.equal(data.graph.edges[0].to, 'helper-1')
})

test('no organisation means no computer, so the empty state stays reachable', () => {
  /* THE HALF THAT MAKES THIS SAFE. A plain browser has no organisation store,
     and a copy with nothing declared has nothing to draw. Returning a computer
     with no agents on it would put a node on screen that opens onto nothing —
     the same dead end, one screen further along. */
  for (const nothing of [null, undefined, {}, { agents: [] }, { agents: null }, { agents: [{}] }, { agents: [{ id: '' }] }]) {
    assert.equal(declaredFleetData(nothing), null, `${JSON.stringify(nothing)} must not produce a computer`)
    assert.equal(declaredAgentsData(nothing), null, `${JSON.stringify(nothing)} must not produce an agent projection`)
  }
})

test('the drill-in resolves from the same record the graph was drawn from', () => {
  /* A node that opens onto "Agent projection unavailable" is a door drawn on a
     wall. Every id the graph offers has to be resolvable by the agent page. */
  const graph = declaredFleetData(TWO_AGENT_ORG)
  const agents = declaredAgentsData(TWO_AGENT_ORG)
  const resolvable = new Set(agents.declared.map(agent => agent.id))
  for (const node of graph.nodes ?? graph.graph.nodes) assert.ok(resolvable.has(node.id), `${node.id} is drawn but cannot be opened`)
  assert.equal(agents.revision, 4)
})
