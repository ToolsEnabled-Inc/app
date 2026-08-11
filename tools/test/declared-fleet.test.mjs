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

import {
  declaredFleetData, declaredAgentsData, THIS_COMPUTER_ID, THIS_COMPUTER_LABEL,
} from '../../src/declared-fleet.js'

/* The organisation a fresh install actually holds, measured from
   window.mcOrg.read() in a packaged window with an isolated LOCALAPPDATA. */
const FRESH_INSTALL_ORG = Object.freeze({
  revision: 1,
  source: 'baseline',
  agents: [{ id: 'controller', displayName: 'Controller', role: 'controller', provider: 'none', enabled: true }],
  relationships: [],
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
  assert.equal(data.graph.nodes.length, 1)
  assert.equal(data.graph.nodes[0].id, 'controller')
  assert.equal(data.graph.nodes[0].label, 'Controller')
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
