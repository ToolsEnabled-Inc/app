/* MORE THAN ONE TREE PER COMPUTER — the contract, not the internals.
 *
 * Written against docs/design/FLEET-TREES.md and against the ENGINE'S OWN
 * SOURCE. src/fleet-trees.js is being built by another lane while this is being
 * written, so this suite is deliberately built to be worth running in all three
 * of the states it will pass through, and to say which state it is in.
 *
 * THE THREE-WAY RULE, which is the whole design of this file:
 *
 *   PART 1 needs no new module. It parses the engine for the numbers the design
 *   doc claims, checks every seat the tier table names is really declared in the
 *   shipped organisation, and checks the sentence a person reads when the seats
 *   run out is the shipped one. It runs today and fails today if any drifts.
 *
 *   PART 2 tests what src/fleet-trees.js ACTUALLY EXPOSES. A behaviour that
 *   contradicts the engine, or that lets a person lose a running agent, is a
 *   FAILURE — those are not preferences, they are the product refusing a thing
 *   it drew, or work left running with nothing naming it.
 *
 *   PART 3 is the part of the doc the module has not adopted. Those SKIP, each
 *   naming the doc section it comes from. A proposal is not a breach, and
 *   red-lighting a shared suite over one would stop four other lanes over an
 *   opinion. A skip here means "nobody has decided yet", never "this passed".
 *
 * If the module is absent entirely, Parts 2 and 3 skip and say so by name. A
 * suite that goes green by testing nothing is the defect
 * tools/check-suites-discovered.mjs already exists to prevent: "a gate that
 * passes because it found nothing is worse than no gate".
 *
 * WHAT THIS SUITE CANNOT SEE: whether any of it is drawn, reachable, or wired to
 * a real dispatch. Source and unit tests cannot see reachability.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { IDENTIFIER_RE, REFUSAL_REMEDY } from '../../src/refusal-copy.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = relative => readFileSync(path.join(ROOT, relative), 'utf8')

const ACTIONS = 'capability/src/lib/mission-bridge/actions.js'
const LAUNCH_RECORD = 'capability/src/lib/controller-launch-record.js'
const SHIPPED_ORG = 'capability-defaults/config/agent-org.json'
const DESIGN_DOC = 'docs/design/FLEET-TREES.md'
const TREES_MODULE = 'src/fleet-trees.js'

/* ---------------------------------------------------------------
   Reading the engine, the shipped organisation, and the doc
   --------------------------------------------------------------- */

/** The engine's tier table, as { tier -> { provider, seats[] } }. */
function engineTiers() {
  const source = read(ACTIONS)
  const start = source.indexOf('const TIERS = Object.freeze({')
  assert.ok(start >= 0, 'the engine TIERS table was not found — this suite is checking air')
  const block = source.slice(start, source.indexOf('});', start))
  const tiers = new Map()
  for (const row of block.matchAll(/'?([a-z][a-z-]*)'?:\s*Object\.freeze\(\{([^}]*)\}\)/g)) {
    const body = row[2]
    const provider = /provider:\s*'([a-z0-9-]+)'/.exec(body)
    const seats = /seats:\s*Object\.freeze\(\[([^\]]*)\]\)/.exec(body)
    if (!provider || !seats) continue
    tiers.set(row[1], {
      provider: provider[1],
      seats: [...seats[1].matchAll(/'([a-z0-9_-]+)'/g)].map(match => match[1]),
    })
  }
  assert.ok(tiers.size > 0, 'no tier rows parsed out of the engine table — the shape changed')
  return tiers
}

/** A bare `const NAME = <number>;` from the engine. */
function engineNumber(relative, name) {
  const match = new RegExp(`const ${name} = (\\d+);`).exec(read(relative))
  assert.ok(match, `${name} was not found in ${relative} — this suite is checking air`)
  return Number(match[1])
}

/** The doc's machine-readable bounds block, as { key -> number }. */
function documentedBounds() {
  const source = read(DESIGN_DOC)
  const match = /```bounds\n([\s\S]*?)```/.exec(source)
  assert.ok(match, `${DESIGN_DOC} carries no bounds block — the doc and this suite disagree`)
  const bounds = new Map()
  for (const line of match[1].split('\n')) {
    const pair = /^([a-z-]+):\s*(\d+)$/.exec(line.trim())
    if (pair) bounds.set(pair[1], Number(pair[2]))
  }
  return bounds
}

const MAX_CHILDREN = engineNumber(LAUNCH_RECORD, 'MAX_FAN_OUT')
const MAX_DEPTH = engineNumber(LAUNCH_RECORD, 'MAX_DEPTH')

/* ---------------------------------------------------------------
   Copy rules, applied to whatever a function actually returns.
   Mirrors tools/check-plain-language.mjs, which scans src/ only and so
   cannot see a sentence a module composes at run time.
   --------------------------------------------------------------- */

const EMBEDDED_IDENTIFIER = new RegExp(
  IDENTIFIER_RE.source.replace(/^\^/, '\\b').replace(/\$$/, '\\b'),
  'g',
)
const MAX_WORDS = 25

function assertPlain(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a sentence, not ${typeof value}`)
  assert.ok(value.trim().length > 0, `${label} is empty — absence is not a message`)
  const identifiers = value.match(EMBEDDED_IDENTIFIER) || []
  assert.deepEqual(identifiers, [],
    `${label} prints an identifier at a person: ${identifiers.join(', ')}`)
  for (const sentence of value.split(/(?<=[.!?])\s+/)) {
    const words = sentence.trim().split(/\s+/).filter(Boolean).length
    assert.ok(words <= MAX_WORDS,
      `${label} has a ${words}-word sentence; the plain-language gate stops at ${MAX_WORDS}: "${sentence.trim()}"`)
  }
}

/* ---------------------------------------------------------------
   PART 1 — runs whether or not src/fleet-trees.js exists.
   --------------------------------------------------------------- */

test('the design doc states the engine\'s own tree bounds, not its own numbers', () => {
  const bounds = documentedBounds()
  assert.equal(bounds.get('children-per-node'), MAX_CHILDREN,
    `the doc says ${bounds.get('children-per-node')} children per node, the engine enforces ${MAX_CHILDREN}`)
  assert.equal(bounds.get('max-depth-value'), MAX_DEPTH,
    `the doc says a depth cap of ${bounds.get('max-depth-value')}, the engine enforces ${MAX_DEPTH}`)
  /* Root is depth 0, so the number of LEVELS a person sees is one more than the
     depth cap. The doc states both because a reader counts levels and the engine
     counts depth, and confusing the two is an off-by-one in a drawing. */
  assert.equal(bounds.get('levels'), MAX_DEPTH + 1,
    'the doc\'s level count and the engine\'s depth cap are off by more than the root')
})

test('seven agents can run at once, and every seat the engine names is really declared', () => {
  const tiers = engineTiers()
  const bounds = documentedBounds()

  const codexSeats = new Set()
  const claudeSeats = new Set()
  for (const [tier, row] of tiers) {
    assert.ok(row.seats.length > 0, `tier ${tier} declares no seat, so it can never dispatch`)
    for (const seat of row.seats) (row.provider === 'claude' ? claudeSeats : codexSeats).add(seat)
  }

  assert.equal(codexSeats.size, bounds.get('codex-seats'),
    `the engine has ${codexSeats.size} Codex seats, the doc says ${bounds.get('codex-seats')}`)
  assert.equal(claudeSeats.size, bounds.get('claude-seats'),
    `the engine has ${claudeSeats.size} Claude seats, the doc says ${bounds.get('claude-seats')}`)

  const all = new Set([...codexSeats, ...claudeSeats])
  assert.equal(all.size, bounds.get('agents-at-once'),
    `the engine can run ${all.size} agents at once, the doc says ${bounds.get('agents-at-once')}`)

  /* A seat the tier table names but the shipped organisation does not declare is
     a declaration refusal on a customer machine — the exact defect
     capability-defaults/config/agent-org.json's own header was written about. */
  const org = JSON.parse(read(SHIPPED_ORG))
  const declared = new Map(org.agents.map(agent => [agent.id, agent]))
  for (const [tier, row] of tiers) {
    for (const seat of row.seats) {
      const agent = declared.get(seat)
      assert.ok(agent, `tier ${tier} allocates seat "${seat}", which the shipped organisation does not declare`)
      assert.equal(agent.provider, row.provider, `seat "${seat}" is declared for a different provider than tier ${tier} needs`)
      assert.equal(agent.enabled, true, `seat "${seat}" is declared but disabled, so it dies one step past the tier check`)
    }
  }
})

test('all three Claude kinds share one pool, which is why two trees can starve each other', () => {
  const tiers = engineTiers()
  const claude = [...tiers.entries()].filter(([, row]) => row.provider === 'claude')
  assert.ok(claude.length >= 2, 'fewer than two Claude tiers — the shared-pool premise no longer holds')
  const [, first] = claude[0]
  for (const [tier, row] of claude) {
    assert.deepEqual(row.seats, first.seats,
      `tier ${tier} no longer shares the Claude pool; the seat-exhaustion section of the doc needs rewriting`)
  }
})

test('the seat refusal a person reads is the shipped sentence, quoted verbatim in the doc', () => {
  const shipped = REFUSAL_REMEDY.BRIDGE_ALL_SEATS_BUSY
  assert.equal(typeof shipped, 'string', 'the seat-busy refusal has no shipped remedy')
  assertPlain(shipped, 'the shipped seat-busy remedy')
  assert.match(shipped, /\b(wait|stop|start)\b/i, 'the shipped seat-busy remedy names nothing to do')

  /* The doc quotes it so an implementer copies rather than rewrites. A second
     wording for one condition is how four screens end up describing it four
     ways, which src/views/computers.js already carries a comment about. */
  const quoted = read(DESIGN_DOC)
    .split('\n')
    .filter(line => line.startsWith('> '))
    .map(line => line.slice(2).trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  /* THE MESSAGE HAS TO BE READABLE BY SOMEBODY WHO HAS NEVER SEEN THE DOC.
     This is the one assertion in the suite that a person can break without
     touching a single file of this lane's: it fails when REFUSAL_REMEDY's
     seat-busy sentence is edited, and the person editing it is working in
     src/refusal-copy.js on some unrelated errand. So it names both ends, the
     exact constant, and the fix — not "the doc", which leaves them searching. */
  assert.equal(quoted, shipped,
    'The seat refusal quoted in docs/design/FLEET-TREES.md section 5 no longer matches '
    + 'REFUSAL_REMEDY.BRIDGE_ALL_SEATS_BUSY in src/refusal-copy.js, so one of them is now lying to somebody.\n'
    + 'This is deliberate coupling, not a stale test: the tree page must not grow a second wording for a '
    + 'condition the product already has words for.\n'
    + 'If you meant to rewrite the sentence, rewrite it — but move the block quote in that doc section in '
    + 'the SAME commit. Nothing here needs to go in a baseline.')
})

test('section 8\'s limitation is still true: no agent start passes a working folder', () => {
  /* WHY THIS TEST EXISTS, and it is a rule worth generalising.
   *
   * Section 8 tells the owner that two trees can edit the same files, and rests that
   * on three statements about OTHER files. A claim about another file's contents has
   * an expiry date, and nothing in a build reads prose — so the day somebody threads a
   * working folder through, the doc silently becomes a false statement in front of the
   * person who has to decide whether to fund fixing it.
   *
   * So both halves are asserted here. Line numbers deliberately are not: the first
   * draft of section 8 cited src/views/agent.js:772 and the line had moved to 781
   * within the hour. A guard that breaks on unrelated edits above it would red-light
   * this suite for every other lane, which is how a true gate gets deleted. */
  const shell = read('shell/main.cjs')
  const parse = shell.slice(shell.indexOf('function parseAgentStart('))
  /* Re-measured 2026-08-13: the allowlist gained `tier` (the provider/model
     choice, 4204332). `cwd` is still accepted and still passed by nobody, so
     the folder limitation this section records is unchanged. The slice is
     wider than the original 400 because the allowlist now sits below the
     comment explaining why tier exists. */
  assert.ok(/\['sessionId', 'cwd', 'surface', 'tier'\]/.test(parse.slice(0, 1600)),
    'parseAgentStart\'s allowlist moved again, so section 8\'s first bullet is wrong. '
    + 'Re-measure that section rather than editing this assertion.')

  const callers = ['src/agent-session.js', 'src/views/agent.js', 'src/views/computers.js']
  let starts = 0
  for (const file of callers) {
    for (const call of read(file).matchAll(/\.start\(\s*\{([^}]*)\}/g)) {
      starts += 1
      assert.ok(!/\bcwd\b/.test(call[1]),
        `${file} now passes a working folder to a start: {${call[1].trim()}}.\n`
        + 'That makes section 8 of docs/design/FLEET-TREES.md false — it tells the owner every agent '
        + 'on this computer shares one folder, which is the basis of a recorded limitation he is being '
        + 'asked to weigh.\n'
        + 'Update section 8 in the same commit. If per-tree folders now exist, the product may say '
        + 'something about keeping files apart that today it must not.')
    }
  }
  assert.ok(starts >= 3,
    `only ${starts} start call(s) found across ${callers.join(', ')}; section 8 was measured against three. `
    + 'The flow moved, so re-measure that section rather than trusting it.')
})

/* ---------------------------------------------------------------
   Loading the module under test
   --------------------------------------------------------------- */

const modulePresent = existsSync(path.join(ROOT, TREES_MODULE))
let fleetTrees = null
let loadFailure = null
if (modulePresent) {
  try { fleetTrees = await import('../../src/fleet-trees.js') }
  catch (error) { loadFailure = error }
}

const ABSENT = `${TREES_MODULE} does not exist yet. The contract it must meet is `
  + `${DESIGN_DOC} section 7. These assertions are written and waiting; they are NOT passing.`

if (!modulePresent) console.log(`\n[fleet-trees-multi] ${ABSENT}\n`)

/** A behaviour the module must get right. Skips only while the file is absent. */
const behaviour = (name, fn) => test(name, { skip: modulePresent ? false : ABSENT }, fn)

/** A part of the doc nobody has adopted yet. Skips loudly, never passes quietly. */
const proposal = (name, section, fn) => test(name, {
  skip: `NOT DECIDED: ${DESIGN_DOC} ${section} proposes this and ${TREES_MODULE} has not adopted it. `
    + 'This is an open decision, not a passing test.',
}, fn)

/**
 * Something this release deliberately does NOT do, kept as a skip so the gap has a
 * name and a place to be found.
 *
 * NOT THE SAME AS A PROPOSAL, and the difference is why it has its own helper. A
 * proposal is waiting on somebody to decide. A limitation HAS been decided, decided
 * against, and written down with the argument for building it attached. So this skip
 * is not a to-do nobody picked up — it is the shape of a feature that is not in this
 * release, and the only executable record that the question was asked and answered.
 * Implementing it to make the skip go away would be reversing a decision by tidying.
 */
const limitation = (name, section, fn) => test(name, {
  skip: `RECORDED LIMITATION, NOT A GAP TO FILL: ${DESIGN_DOC} ${section} records that this was `
    + 'decided against for this release, with the argument for building it attached so the owner can '
    + 'weigh it. Do not implement this to make the skip go away.',
}, fn)

function store(options = {}) {
  assert.equal(loadFailure, null,
    `${TREES_MODULE} exists but could not be imported: ${loadFailure && loadFailure.message}`)
  assert.equal(typeof fleetTrees.createFleetTreeStore, 'function',
    `${TREES_MODULE} exports no createFleetTreeStore; ${DESIGN_DOC} section 7 needs somewhere to hold a tree`)
  let minted = 0
  return fleetTrees.createFleetTreeStore({
    computerId: 'this-computer',
    makeId: kind => `${kind}-${(minted += 1)}`,
    now: () => '2026-08-12T00:00:00.000Z',
    ...options,
  })
}

/** The `{ read, write }` seam the store takes, backed by a plain map. */
function seam() {
  const cells = new Map()
  return {
    cells,
    read: key => (cells.has(key) ? cells.get(key) : null),
    write: (key, value) => { cells.set(key, JSON.stringify(value)); return true },
  }
}

/** The result of a store call, or a failure naming what it refused. */
function accepted(result, label) {
  assert.ok(result && result.ok === true,
    `${label} was refused: ${(result && result.problems ? result.problems.join(' ') : 'no reason given')}`)
  return result
}

/* ---------------------------------------------------------------
   PART 2 — what the module must get right.
   --------------------------------------------------------------- */

behaviour('a computer with no trees holds nothing at all, and says so as an empty list', () => {
  const empty = store({ storage: seam() })
  assert.deepEqual([...empty.listTrees()], [], 'a fresh computer was given a tree nobody made')
  assert.deepEqual([...empty.snapshot().nodes], [], 'a fresh computer was given an agent nobody made')
  /* The owner's first sentence: empty until a session is started. A seeded tree
     would be a structure the person is told they built. */
})

behaviour('two trees really coexist on one computer, and neither can reach into the other', () => {
  const held = store({ storage: seam() })
  const first = accepted(held.addNode({}), 'first tree')
  const second = accepted(held.addNode({}), 'second tree')

  assert.notEqual(first.tree.id, second.tree.id, 'the second tree reused the first tree\'s identity')
  assert.equal(held.listTrees().length, 2, 'one computer could not hold two trees, which is the owner\'s ask')
  assert.equal(held.listNodes(first.tree.id).length, 1, 'a tree\'s agents leaked into the other tree')
  assert.equal(held.listNodes(second.tree.id).length, 1, 'a tree\'s agents leaked into the other tree')

  /* A CROSS-TREE MOVE IS A CONNECTION SINCE 2026-08-13. Every agent begins as
     its own single-node tree, so "connect these two" IS this move — the owner
     asked for it in words. What coexistence still means: nothing leaks WITHOUT
     a deliberate move, the adoption re-trees the whole branch explicitly, and
     the emptied tree is removed rather than left as a husk. */
  const crossed = held.moveNode(second.node.id, first.node.id)
  assert.equal(crossed.ok, true, 'connecting two agents across trees is the owner\'s ask')
  assert.equal(crossed.node.treeId, first.tree.id, 'the adopted agent joins the parent\'s tree')
  assert.equal(held.listTrees().length, 1, 'the emptied source tree is removed, not kept as a husk')
  assert.equal(held.listNodes(first.tree.id).length, 2, 'the connected pair lives in one tree')

  /* Removing the merged tree takes exactly its own agents and nothing else. */
  const third = accepted(held.addNode({}), 'third tree')
  accepted(held.removeTree(first.tree.id), 'removing the merged tree')
  assert.equal(held.listTrees().length, 1)
  assert.equal(held.listNodes(third.tree.id).length, 1, 'removing one tree took an agent out of another')
})

behaviour('no empty node is offered where the engine would refuse the agent: width', () => {
  const held = store({ storage: seam() })
  const top = accepted(held.addNode({}), 'the top agent').node
  for (let index = 0; index < MAX_CHILDREN; index += 1) {
    accepted(held.addNode({ parentId: top.id }), `child ${index + 1}`)
  }
  const offered = held.extensionPoints().filter(point => point.parentId === top.id)
  assert.deepEqual(offered, [],
    `the drawing offers a ${MAX_CHILDREN + 1}th agent under one parent. The engine refuses it `
    + `(MAX_FAN_OUT is ${MAX_CHILDREN} in ${LAUNCH_RECORD}), so pressing that placeholder can only fail. `
    + 'Either stop offering the slot, or say in the doc that launches are not nested and the cap never applies.')
})

behaviour('no empty node is offered where the engine would refuse the agent: depth', () => {
  const held = store({ storage: seam() })
  const chain = [accepted(held.addNode({}), 'the top agent').node]
  for (let depth = 1; depth <= MAX_DEPTH; depth += 1) {
    chain.push(accepted(held.addNode({ parentId: chain[depth - 1].id }), `agent at depth ${depth}`).node)
  }
  const deepest = chain[MAX_DEPTH]
  const oneAbove = chain[MAX_DEPTH - 1]

  assert.ok(held.extensionPoints().some(point => point.parentId === oneAbove.id),
    'a slot the engine would accept was withheld, one level above the cap')
  assert.deepEqual(held.extensionPoints().filter(point => point.parentId === deepest.id), [],
    `the drawing offers an agent at depth ${MAX_DEPTH + 1}. The engine refuses it `
    + `(MAX_DEPTH is ${MAX_DEPTH} in ${LAUNCH_RECORD}), so pressing that placeholder can only fail.`)
})

behaviour('removing a tree does not lose the agents that are still running in it', () => {
  const held = store({ storage: seam() })
  const made = accepted(held.addNode({}), 'the agent')
  accepted(held.attachSession(made.node.id, 'session-1'), 'attaching the session')
  accepted(held.setNodeStatus(made.node.id, 'running'), 'marking it running')

  const removal = held.removeTree(made.tree.id)
  if (removal.ok === false) {
    /* Refusing until it is stopped is a correct answer, and the better one. */
    assertPlain(removal.problems.join(' '), 'the refusal for removing a tree with running agents')
    return
  }
  /* If removal is allowed, the caller must come away able to STOP what it just
     removed. Ids alone are not enough: the agents are gone from the store, so
     nothing can look their sessions up afterwards, and a run nobody can name
     keeps going — the failure src/agent-teams.js already refuses to allow. */
  const removed = removal.removedNodes || removal.removed || null
  assert.ok(Array.isArray(removed) && removed.some(entry => entry && entry.sessionId === 'session-1'),
    'removeTree deleted a running agent and handed back only its id. After the delete nothing can look '
    + 'up its session, so the run cannot be stopped and nothing on screen names it. Return the removed '
    + 'agents themselves, or refuse until they are stopped.')
})

behaviour('a saved agent never comes back claiming to be running', () => {
  const storage = seam()
  const first = store({ storage })
  const made = accepted(first.addNode({}), 'the agent')
  accepted(first.attachSession(made.node.id, 'session-1'), 'attaching the session')
  accepted(first.setNodeStatus(made.node.id, 'running'), 'marking it running')

  const reopened = store({ storage })
  const reloaded = reopened.getNode(made.node.id)
  assert.ok(reloaded, 'the saved agent did not survive the restart at all')
  assert.notEqual(reloaded.status, 'running',
    'a saved file brought an agent back as running. A live session cannot outlive the window that owns '
    + 'it (see the header of src/agent-session-registry.js), so this is a claim that is false on the next '
    + 'launch. Load it as not-running-yet and let the program answer.')
})

behaviour('a finished tree persists across a restart, with its names and messages intact', () => {
  const storage = seam()
  const first = store({ storage })
  const made = accepted(first.addNode({}), 'the agent')
  accepted(first.updateNode(made.node.id, { role: 'builder', message: 'Ship the installer' }), 'filling the panel in')
  accepted(first.setNodeStatus(made.node.id, 'finished'), 'finishing it')

  const reopened = store({ storage })
  assert.equal(reopened.listTrees().length, 1,
    'a tree whose agents had all finished did not survive a restart; the doc says it stays until removed')
  const reloaded = reopened.getNode(made.node.id)
  assert.equal(reloaded.status, 'finished', 'a finished agent lost its outcome across a restart')
  assert.equal(reloaded.message, 'Ship the installer', 'a finished agent lost the message a person typed')
  /* And it is still extendable, which is what makes an archive state unnecessary. */
  assert.ok(reopened.extensionPoints().some(point => point.parentId === made.node.id),
    'a finished tree cannot be picked back up, so finishing one silently ends it')
})

behaviour('every sentence this store hands a person survives the plain-language gate', () => {
  const held = store({ storage: seam() })
  const made = accepted(held.addNode({}), 'the agent')

  const refusals = [
    ['a message that is far too long', held.addNode({ message: 'x'.repeat(1_000_000) })],
    ['an agent that is not on this computer', held.updateNode('no-such-agent', { role: 'builder' })],
    ['a tree that is not on this computer', held.removeTree('no-such-tree')],
    ['a state nobody defined', held.setNodeStatus(made.node.id, 'nearly-done')],
    ['an agent reporting to itself', held.moveNode(made.node.id, made.node.id)],
  ]
  for (const [label, result] of refusals) {
    assert.equal(result.ok, false, `${label} was accepted`)
    assert.ok(result.problems.length > 0, `${label} was refused with no reason, which is a dead end`)
    assertPlain(result.problems.join(' '), `the refusal for ${label}`)
  }
})

behaviour('the seat shortage names the trees holding the agents, by name and never by id', () => {
  /* THE ANSWER THE OWNER'S QUESTION NEEDS. Tree A can hold every seat and tree B
     then cannot start. The shipped refusal says "every agent is already working"
     and stops there, so the person on tree B has no way to learn that tree A is
     the one holding them. This is the second line that closes that. */
  assert.equal(typeof fleetTrees.seatShortageSentence, 'function',
    `${TREES_MODULE} exports no seatShortageSentence; ${DESIGN_DOC} section 5 needs it`)

  const held = store({ storage: seam() })
  const mine = accepted(held.addNode({ message: 'Fix the login screen' }), 'my tree')
  const holder = accepted(held.addNode({ message: 'Ship the installer' }), 'the other tree')
  accepted(held.attachSession(holder.node.id, 'session-1'), 'attaching a session')
  accepted(held.setNodeStatus(holder.node.id, 'running'), 'marking it running')

  const trees = held.listTrees().map(tree => fleetTrees.treeRecord(held.snapshot(), tree.id))
  const shortage = fleetTrees.seatShortageSentence({ trees, currentTreeId: mine.tree.id })
  assertPlain(shortage, 'seatShortageSentence() when another tree holds the agents')
  assert.ok(shortage.includes('Ship the installer'),
    'the shortage does not name the tree holding the agents, which is the whole point of the change')
  for (const tree of held.listTrees()) {
    assert.ok(!shortage.includes(tree.id), `the shortage prints the tree id "${tree.id}" at a person`)
  }

  /* The two cases a person meets that are NOT "somebody else has them". Neither
     may guess: a wrong name here sends somebody to stop the wrong work. */
  assertPlain(fleetTrees.seatShortageSentence({ trees, currentTreeId: holder.tree.id }),
    'seatShortageSentence() when this tree holds them all')
  const unattributable = fleetTrees.seatShortageSentence({ trees: [], currentTreeId: null })
  assertPlain(unattributable, 'seatShortageSentence() with nothing to attribute it to')
  assert.ok(!/\bnull\b|\bundefined\b/.test(unattributable), 'the shortage leaked an absent value into a sentence')
})

behaviour('only one tree with nothing in it may exist at a time', () => {
  const held = store({ storage: seam() })
  accepted(held.createTree({ name: 'Ship the installer' }), 'the first empty tree')
  const second = held.createTree({ name: 'Fix the login screen' })
  assert.equal(second.ok, false,
    'a second tree with nothing in it was made. An unbounded pile of empty trees is the same noise as '
    + 'an unbounded pile of empty nodes; switch to the empty one instead.')
  assertPlain(second.problems.join(' '), 'the refusal for a second empty tree')

  /* The refusal has to point at the one they already have, or it is a dead end
     wearing a reason. planTreeAdd is where that answer lives. */
  const plan = fleetTrees.planTreeAdd(held.listTrees().map(tree => fleetTrees.treeRecord(held.snapshot(), tree.id)))
  assert.equal(plan.allowed, false)
  assert.equal(plan.switchTo, held.listTrees()[0].id, 'the refusal does not say which tree to switch to')
  assertPlain(plan.reason, 'planTreeAdd().reason')
  assert.ok(!plan.reason.includes(plan.switchTo), 'the refusal prints a tree id at a person; name the tree instead')
})

behaviour('a tree is named after the work, and a counting number is only the fallback', () => {
  /* DECIDED by the coordinator after three schemes turned up at once: the name
     the person typed, then the first message they sent, then a count. A number
     is not an identifier and no gate would ever catch it — but "Tree 1" beside
     "Tree 2" tells a person nothing about which job is which, which is the only
     reason to have two. */
  const held = store({ storage: seam() })
  const made = accepted(held.addNode({ role: 'builder', message: 'Ship the installer\nand then the notes' }), 'the agent')

  const label = held.treeLabel(made.tree.id)
  assert.equal(label, 'Ship the installer',
    `a tree with a message in it is labelled "${label}" instead of the words the person typed`)
  assert.ok(!/^Tree \d+$/.test(label), 'a counted fallback was used while a real message existed')
  assertPlain(label, 'treeLabel() for a tree with a message')

  /* The fallback is still there for a tree nobody has typed into, and it is
     still not an id. */
  const blank = accepted(held.createTree({ name: 'Untitled' }), 'a tree with no agents')
  const blankLabel = held.treeLabel(blank.tree.id)
  assert.ok(!blankLabel.includes(blank.tree.id), 'a tab label prints a tree id')
  assert.equal(fleetTrees.displayName(fleetTrees.treeRecord(held.snapshot(), made.tree.id)), 'Ship the installer',
    'displayName and treeLabel disagree about the same tree')
})

behaviour('a typed-but-unstarted agent is not mistaken for an empty spot or a running one', () => {
  /* THE LOSSY SEAM, pinned. The store has a `draft` state because the owner's
     flow is "press the placeholder, THEN fill in role and message" — so an agent
     exists, with the person's typing in it, before any session does. Collapsing
     that into either neighbour loses something a person can see: into "empty" it
     loses their typing, into "running" it claims a session that was never asked
     for. */
  assert.ok(fleetTrees.NODE_STATUSES.includes('draft'),
    'the draft state is gone, so a half-filled panel has nowhere to live between presses')

  const held = store({ storage: seam() })
  const typed = accepted(held.addNode({ role: 'builder', message: 'Ship the installer' }), 'a typed draft')
  const record = fleetTrees.treeRecord(held.snapshot(), typed.tree.id)

  assert.notEqual(fleetTrees.treeStatus(record), 'running',
    'an agent nobody started was reported as running')
  assert.notEqual(fleetTrees.treeStatus(record), 'empty',
    'a tree holding a person\'s typing was reported as empty, so their words are invisible')
})

/* ---------------------------------------------------------------
   PART 3 — the doc's proposals, not yet adopted. Skipped, never green.
   --------------------------------------------------------------- */

limitation('two trees would keep out of each other\'s files', 'section 8', () => {
  /* DECIDED AGAINST for this release, and the measurement is in section 8: the flow
     never passes a working folder, so every agent from this page runs in one shared
     folder. Two trees running at once are two sets of agents editing one working tree
     with no boundary — against eight recorded incidents of concurrent lanes clobbering
     each other's uncommitted work.

     This test is kept, and kept failing-if-run, so that the day somebody threads a
     folder through they have an assertion waiting rather than a paragraph. It is NOT
     a request to build it. */
  const held = store({ storage: seam() })
  const made = accepted(held.createTree({ name: 'Ship the installer', folder: 'app' }), 'a tree with a folder')
  assert.equal(made.tree.folder, 'app',
    'a tree holds no folder, which is the recorded limitation in section 8 rather than a defect. '
    + 'If this now passes, per-tree folders were built — update section 8, because the product may '
    + 'then say something about files that it currently must not.')
})
