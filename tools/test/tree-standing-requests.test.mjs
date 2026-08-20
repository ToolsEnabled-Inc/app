/* THE RULES A PERSON HAS ALREADY WRITTEN FOR A TREE, READ BACK.
 *
 * THE GAP THIS CLOSES, measured rather than assumed. The /Request family is
 * wired end to end: the tree chat parses "/RequestTree ..." before anything
 * is sent, shell/main.cjs's `mc-agent:request` files it through the payload's
 * own r-ledger module, every start carries `requestKeys` and the engine's
 * onboarding injects those scopes at boot beside the global layer. So a
 * person's per-tree instructions ALREADY reach every agent of that tree.
 *
 * What did not exist anywhere in shell/ or src/ was a way to READ THEM BACK.
 * The channel was write-only: a person could file a rule, see a one-sentence
 * confirmation, and then had no way to find out what rules this tree carries
 * — while every agent in it was being told. That is the owner's statement 4
 * ("a session file ... users need to be able to edit them easily") failing on
 * its second half only.
 *
 * WHY THE REGISTER AND NOT A SECOND FILE. The 2026-08-16 brief left this open
 * (its Q3: is the session file the ledger's editable face, or separate free
 * text?). It is the ledger's face. Two mechanisms both writing per-tree
 * instructions, each with its own injection path, is a merge problem nobody
 * asked for — and the register already ships, already injects, and already
 * survives a restart because it is anchored on node ids rather than session
 * ids.
 *
 * WHAT THIS FILE PINS:
 *   the reply carries WORDS AND IDS AND NO PATH — the same rule the write
 *   handler states in its own header, and the reason a read is safe to add:
 *   the caller names a scope and an id it already holds, never a file
 *   a damaged or absent ledger reads as NOTHING, never as an error the person
 *   has to interpret — absence and damage are the same honest answer
 *   the anchors a rail reads are the SAME ids a start carries, so what the
 *   person is shown and what the agent is told cannot disagree
 */

import { strict as assert } from 'node:assert'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(import.meta.url)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { readStandingRequests } = require_(path.join(REPO, 'shell', 'standing-requests-read.cjs'))

/* THE PAYLOAD IS A BUILD ARTIFACT, NOT SOURCE — `/capability/` is gitignored.
 *
 * MEASURED, and it is the reason this file is shaped the way it is: an
 * earlier version of these tests read through the REAL ledger module and
 * passed on this machine because a payload happened to be staged here. Built
 * from the git tree alone — a fresh clone, CI, or the pre-commit check that
 * builds exactly what is about to be committed — `capability/` does not
 * exist, the loader honestly answers nothing, and three tests failed for a
 * reason that had nothing to do with what they were about.
 *
 * So the split below is deliberate. The reader's OWN contract — what it
 * strips, what it refuses, what it does with an absence — is proven
 * unconditionally through the module seam it already exposes. The real
 * ledger FORMAT is proven only when a payload is genuinely staged, and says
 * so in its own name rather than skipping in disguise. Nothing here
 * reimplements the ledger format: the stub returns the shape the real
 * parser returns, and the format itself is the payload's business. */
const PAYLOAD_ROOT = path.join(REPO, 'capability')
const PAYLOAD_STAGED = existsSync(path.join(PAYLOAD_ROOT, 'src', 'lib', 'r-ledger.js'))

/* A stand-in for the payload module, returning what the real readLedger
   returns — including the `path` and the per-entry coordinates this reader is
   required to drop before answering. */
const stubLedger = ({ entries = [], exists = true, throws = null } = {}) => () => ({
  readLedger: (scope, key, options) => {
    if (throws) { const error = new Error('refused'); error.code = throws; throw error }
    return {
      scope,
      key,
      path: 'C:/somewhere/state/r-ledger/tree-node-7.md',
      exists,
      entries: entries.map((entry, at) => ({ ...entry, number: at + 1, stamp: '2026-08-20', line: at * 3 })),
      warnings: [],
    }
  },
})

/* A ledger tree the payload module would itself write into: state/r-ledger/
   under a root, in the module's own on-disk shape. Written as TEXT here on
   purpose — this is the file a person edits by hand, and the reader has to
   cope with what a hand leaves behind. */
function ledgerRoot(files = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'standing-requests-'))
  mkdirSync(path.join(root, 'state', 'r-ledger'), { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(root, 'state', 'r-ledger', name), text)
  }
  return root
}

const TREE_LEDGER = `# Owner requests — tree node-7

Applies to: this agent and every agent below it.

## RT1 — 2026-08-20
Never write outside this folder.

## RT2 — 2026-08-20
Ask before installing anything.
`

test('the words come back with their ids, and nothing else does', () => {
  const answer = readStandingRequests({
    scope: 'tree',
    key: 'node-7',
    loadModule: stubLedger({ entries: [
      { id: 'RT1', words: 'Never write outside this folder.' },
      { id: 'RT2', words: 'Ask before installing anything.' },
    ] }),
  })
  assert.equal(answer.ok, true)
  assert.deepEqual(answer.entries, [
    { id: 'RT1', words: 'Never write outside this folder.' },
    { id: 'RT2', words: 'Ask before installing anything.' },
  ])
  /* NO PATH CROSSES THE BRIDGE. The stub hands back the real module's `path`
     and per-entry coordinates; none of it may survive into the answer. */
  const flat = JSON.stringify(answer)
  assert.equal(flat.includes('C:/somewhere'), false, 'the reply must not carry the ledger path')
  assert.equal('path' in answer, false)
  for (const entry of answer.entries) assert.deepEqual(Object.keys(entry).sort(), ['id', 'words'])
})

test('an absent ledger is nothing, not a failure', () => {
  const answer = readStandingRequests({ scope: 'tree', key: 'node-never-used', loadModule: stubLedger({ entries: [], exists: false }) })
  assert.equal(answer.ok, true)
  assert.deepEqual(answer.entries, [])
  assert.equal(answer.exists, false)
})

test('a refusal about the key is a refusal, never a silent empty list', () => {
  /* An id that is not an id must never reach a file: the payload module's own
     SAFE_KEY decides that, and this reader passes the refusal on with its
     code rather than answering "no rules" — which would read to a person as
     "this tree has none". */
  const answer = readStandingRequests({ scope: 'tree', key: '../../reports/R-LEDGER', loadModule: stubLedger({ throws: 'R_LEDGER_KEY_INVALID' }) })
  assert.equal(answer.ok, false)
  assert.equal(answer.code, 'AGENT_REQUEST_KEY_INVALID')
  assert.deepEqual(answer.entries, [])
})

test('an entry with no words is not shown as a blank rule', () => {
  const answer = readStandingRequests({
    scope: 'tree',
    key: 'node-7',
    loadModule: stubLedger({ entries: [{ id: 'RT1', words: '   ' }, { id: 'RT2', words: 'Keep the tests green.' }] }),
  })
  assert.deepEqual(answer.entries, [{ id: 'RT2', words: 'Keep the tests green.' }])
})

test('the real ledger format, when a payload is staged, parses as this reader expects', () => {
  /* CONDITIONAL RATHER THAN SKIPPED-IN-DISGUISE, the pattern this repository
     already uses for payload-dependent checks (tools/test/agent-session-
     surface.test.mjs says the same thing in its own name). On a bare checkout
     there is no payload to read through and this says so; on any machine that
     has cut one — including the one that cuts releases — it is the real
     drift check between this reader and the owner's ledger format. */
  if (!PAYLOAD_STAGED) {
    assert.ok(true, 'no payload is staged in this checkout, so there is no ledger module to read through')
    return
  }
  const root = ledgerRoot({ 'tree-node-7.md': TREE_LEDGER })
  try {
    const answer = readStandingRequests({ scope: 'tree', key: 'node-7', root, engineRoot: PAYLOAD_ROOT })
    assert.equal(answer.ok, true)
    assert.deepEqual(answer.entries, [
      { id: 'RT1', words: 'Never write outside this folder.' },
      { id: 'RT2', words: 'Ask before installing anything.' },
    ])
    assert.equal(JSON.stringify(answer).includes(root), false, 'the reply must not carry the ledger path')

    /* A HAND-DAMAGED LEDGER yields the entries it can and never throws: the
       owner edits this file by hand, and a rail that blanked over a stray
       heading would punish them for doing what the product invited. */
    const damaged = ledgerRoot({
      'tree-node-7.md': `# Owner requests — tree node-7

## not-an-id — 2026-08-20
stray heading a person left behind

## RT4 — 2026-08-20
Keep the tests green.
`,
    })
    try {
      const read = readStandingRequests({ scope: 'tree', key: 'node-7', root: damaged, engineRoot: PAYLOAD_ROOT })
      assert.equal(read.ok, true)
      assert.deepEqual(read.entries.map(entry => entry.id), ['RT4'])
    } finally { rmSync(damaged, { recursive: true, force: true }) }

    /* And a key that is not an id is refused by the module's own SAFE_KEY. */
    for (const key of ['../../reports/R-LEDGER', 'a/b']) {
      const refused = readStandingRequests({ scope: 'tree', key, root, engineRoot: PAYLOAD_ROOT })
      assert.equal(refused.ok, false, `a key of ${JSON.stringify(key)} must be refused`)
      assert.deepEqual(refused.entries, [])
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a build with no payload says so instead of pretending there are no rules', () => {
  /* The distinction the whole product is built on: "there are no rules" and
     "this copy could not look" are different answers, and painting the second
     as the first is the lie this codebase keeps fixing. */
  const answer = readStandingRequests({ scope: 'tree', key: 'node-7', root: null, loadModule: () => null })
  assert.equal(answer.ok, false)
  assert.equal(answer.code, 'AGENT_REQUEST_UNAVAILABLE')
  assert.deepEqual(answer.entries, [])
})

test('the rail reads the same anchors a start carries', async () => {
  /* treeAnchorsFor()/nodeRequestKeys() in src/views/computers.js decide which
     ids ride a start as requestKeys. A rail that read a DIFFERENT set would
     show a person rules their agents are not getting, or hide rules they are
     — so the surface is required to derive its scopes from the same shape.
     Pinned here as the contract both sides quote. */
  const module_ = await import(new URL('../../src/tree-standing-requests.js', import.meta.url))
  assert.equal(typeof module_.standingRequestScopesFor, 'function',
    'the scope derivation the rail and the start share must be importable without a DOM')
  const node = { id: 'node-7', parentId: 'node-1', sessionId: 'session-3' }
  const scopes = module_.standingRequestScopesFor(node, { anchors: ['node-1', 'node-7'] })
  /* Global always; the tree anchors nearest-last; the thread is this node. A
     session scope only when a session is really running — a session rule
     filed against no session is the one case the filing path already
     refuses. */
  assert.deepEqual(scopes, [
    { scope: 'global', key: null },
    { scope: 'tree', key: 'node-1' },
    { scope: 'tree', key: 'node-7' },
    { scope: 'thread', key: 'node-7' },
    { scope: 'session', key: 'session-3' },
  ])
  const noSession = module_.standingRequestScopesFor({ id: 'node-7', parentId: null }, { anchors: ['node-7'] })
  assert.equal(noSession.some(entry => entry.scope === 'session'), false)
})
