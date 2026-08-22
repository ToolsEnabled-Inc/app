import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  createLedgerArchiveController,
  verifiedLedgerArchiveReceipt,
} from '../../src/mission-bridge.js'

/* THE FIXTURE IS THE ENGINE'S RECEIPT, NOT THE RENDERER'S WISH.
 *
 * The fixture this file used to hold carried candidates as {id, reasonCode,
 * reason:string} and a movedIds/movedCount pair. The engine never produced
 * that shape: capability/src/lib/mission-bridge/actions.js
 * normalizedLedgerArchiveResult() freezes candidates as {targetKind,
 * requestId, reason:{code, detail, supersedingRequestIds}} beside
 * `restorables`, `appliedTarget` and `changedCount`, and ledgerArchive()
 * spreads exactly that into the receipt. So this suite passed against a
 * verifier that refused every real receipt, and "Preview cleanup" refused
 * every press it ever got with BRIDGE_LEDGER_ARCHIVE_PREVIEW_INVALID. The
 * shape below is copied from the engine; a verifier that drifts from it fails
 * here first. */
const PLAN = 'a'.repeat(64)
const CANDIDATES = Object.freeze([
  Object.freeze({ targetKind: 'request', requestId: 'R54', reason: Object.freeze({ code: 'completed', detail: 'status done and every declared gate is met:true', supersedingRequestIds: Object.freeze([]) }) }),
  Object.freeze({ targetKind: 'request', requestId: 'R241', reason: Object.freeze({ code: 'fully-superseded', detail: 'fully superseded by R1162', supersedingRequestIds: Object.freeze(['R1162']) }) }),
])

function receipt(dryRun, overrides = {}, { target = null, restorables = [] } = {}) {
  return {
    ok: true,
    receipt: {
      action: 'ledger-archive',
      actor: 'coordinator-sol',
      at: '2026-08-07T12:00:00.000Z',
      planSha256: PLAN,
      candidates: CANDIDATES,
      restorables,
      inconsistencies: [{
        id: 'R55',
        code: 'DONE_WITH_UNMET_GATE',
        reason: 'status is done but gate 1 is not met:true; retained in the active ledger',
      }],
      activeCount: 474,
      archiveCount: restorables.length,
      dryRun,
      appliedTarget: dryRun ? null : target,
      changedCount: dryRun ? 0 : 1,
      ...(dryRun ? {} : { intentAudit: { sequence: 40, eventHash: 'b'.repeat(64) } }),
      audit: { sequence: dryRun ? 39 : 41, eventHash: 'c'.repeat(64) },
      ...overrides,
    },
  }
}

/* A bridge that behaves like the engine's ledgerArchive(): a dry run with or
   without a target answers with the plan; a confirm answers with its target
   applied and that target now restorable. `refuse` names requests whose
   confirm the engine turns down, with the engine's own code. */
function engine({ refuse = {} } = {}) {
  const posts = []
  const restorables = []
  const postAction = async (action, body) => {
    posts.push({ action, body })
    if (body.dryRun) return receipt(true, {}, { restorables: [...restorables] })
    const id = body.target?.requestId
    if (refuse[id]) return { ok: false, code: refuse[id].code, reason: refuse[id].reason }
    restorables.push({ targetKind: 'request', requestId: id })
    return receipt(false, {}, { target: body.target, restorables: [...restorables] })
  }
  return { posts, postAction }
}

test('settings contains the owner-gated cleanup button wired to the bounded controller', () => {
  const source = readFileSync(new URL('../../src/views/settings.js', import.meta.url), 'utf8')
  const bridge = readFileSync(new URL('../../src/mission-bridge.js', import.meta.url), 'utf8')
  assert.match(source, /name: 'Archive finished requests'/)
  assert.match(source, /data-setting-action="ledger-archive"/)
  assert.match(source, /createLedgerArchiveController/)
  assert.match(bridge, /'ledger-archive': '\/v1\/actions\/ledger-archive'/)
  /* The sentence under the control says what the engine does -- one target per
     confirmation, retired to cooling, nothing deleted -- not "moves that list". */
  assert.match(source, /one at a time, each through its own preview/)
  assert.match(source, /Nothing is deleted/)
})

test('first click performs only a dry-run and second click archives each candidate through its own preview and target', async () => {
  const { posts, postAction } = engine()
  const states = []
  const controller = createLedgerArchiveController({ postAction, onState: state => states.push(state) })

  await controller.click()
  /* `operation` IS REQUIRED BY THE ACTION AND WAS NEVER SENT (an earlier
     defect on this row); the preview carries no target because it is the
     whole list the person is about to read. */
  assert.deepEqual(posts, [{ action: 'ledger-archive', body: { operation: 'archive', dryRun: true } }])
  assert.equal(controller.getState().phase, 'confirm')
  assert.match(controller.getState().message, /R54/)
  assert.match(controller.getState().message, /R241/)
  assert.match(controller.getState().message, /fully superseded by R1162/)
  assert.match(controller.getState().message, /Select again/)

  await controller.click()
  /* ONE TARGET PER CONFIRMATION. The engine refuses {dryRun:false} with no
     target (BRIDGE_LEDGER_ARCHIVE_CONFIRMATION_REQUIRED, 409) and keys its
     admitted preview to the target, so every confirm is preceded by its own
     dry run for that exact target. */
  assert.deepEqual(posts.slice(1), [
    { action: 'ledger-archive', body: { operation: 'archive', dryRun: true, target: { targetKind: 'request', requestId: 'R54' } } },
    { action: 'ledger-archive', body: { operation: 'archive', dryRun: false, target: { targetKind: 'request', requestId: 'R54' } } },
    { action: 'ledger-archive', body: { operation: 'archive', dryRun: true, target: { targetKind: 'request', requestId: 'R241' } } },
    { action: 'ledger-archive', body: { operation: 'archive', dryRun: false, target: { targetKind: 'request', requestId: 'R241' } } },
  ])
  assert.ok(posts.every(post => post.body.dryRun || post.body.target), 'a confirm was posted without a target')
  assert.equal(controller.getState().phase, 'success')
  assert.match(controller.getState().message, /^Archived R54, R241\./)
  /* What "archived" means, in the engine's terms: cooling, still on every
     list, this page's list changes only when regenerated. */
  assert.match(controller.getState().message, /finished and cooling/)
  assert.match(controller.getState().message, /stays on every list for now/)
  assert.ok(states.some(state => state.phase === 'pending-preview'))
  assert.ok(states.some(state => state.phase === 'pending-move'))
})

test('a candidate the engine refuses is reported beside the ones it archived, and the press still settles as confirmed', async () => {
  const { posts, postAction } = engine({ refuse: { R241: { code: 'LEDGER_ARCHIVE_EXPOSURE_INSUFFICIENT', reason: 'R241 has not yet been seen by enough sessions.' } } })
  const controller = createLedgerArchiveController({ postAction })
  await controller.click()
  await controller.click()
  assert.equal(controller.getState().phase, 'success')
  assert.match(controller.getState().message, /^Archived R54\./)
  assert.match(controller.getState().message, /R241 was not archived: R241 has not yet been seen by enough sessions\./)
  /* The engine's own code family lands on the new floor, which says where the
     request is and what a person can do instead. */
  assert.match(controller.getState().message, /hide it from the Ledger page instead/)
  assert.equal(posts.filter(post => !post.body.dryRun).length, 2, 'both confirms were attempted')
})

test('an applied target that is not the one confirmed never becomes success and forces a new preview', async () => {
  let calls = 0
  const controller = createLedgerArchiveController({
    postAction: async (_action, body) => {
      calls += 1
      if (body.dryRun) return receipt(true)
      return receipt(false, {}, { target: { targetKind: 'request', requestId: 'R999' } })
    },
  })

  await controller.click()
  await controller.click()
  assert.equal(calls, 5, 'one list preview, then a dry run and a confirm per candidate')
  assert.equal(controller.getState().phase, 'idle')
  assert.match(controller.getState().label, /Preview current state/)
  assert.match(controller.getState().message, /^Nothing was archived\./)
  assert.match(controller.getState().message, /Preview again/)
})

test('a candidate list that changed between the preview read and its confirm is refused locally, before any confirm is posted', async () => {
  const posts = []
  const controller = createLedgerArchiveController({
    postAction: async (_action, body) => {
      posts.push(body)
      if (!body.dryRun) return receipt(false, {}, { target: body.target })
      if (!body.target) return receipt(true)
      return receipt(true, { candidates: [CANDIDATES[0]] })
    },
  })
  await controller.click()
  await controller.click()
  assert.equal(posts.filter(body => !body.dryRun).length, 0, 'a confirm was posted against a list the person had not read')
  assert.equal(controller.getState().phase, 'idle')
})

test('receipt validation mirrors the engine: its real shape passes, the old movedIds shape is rejected, and a confirm must name its target', () => {
  const target = { targetKind: 'request', requestId: 'R54' }
  assert.equal(verifiedLedgerArchiveReceipt(receipt(true), true), true)
  assert.equal(verifiedLedgerArchiveReceipt(receipt(false, {}, { target }), false, target), true)
  /* THE SHAPE THIS SUITE USED TO ASSERT, which the engine never produced. */
  const old = receipt(true, {
    candidates: [{ id: 'R54', reasonCode: 'completed', reason: 'status done and every declared gate is met:true' }],
    movedIds: [],
    movedCount: 0,
  })
  assert.equal(verifiedLedgerArchiveReceipt(old, true), false)
  assert.equal(verifiedLedgerArchiveReceipt(receipt(false, {}, { target: { targetKind: 'request', requestId: 'R241' } }), false, target), false, 'a different applied target')
  assert.equal(verifiedLedgerArchiveReceipt(receipt(false, {}, { target }), false, null), false, 'a confirm verified against no target')
  assert.equal(verifiedLedgerArchiveReceipt(receipt(false, { changedCount: 2 }, { target }), false, target), false)
  assert.equal(verifiedLedgerArchiveReceipt(receipt(true, { appliedTarget: target }), true), false, 'a dry run applied something')
  assert.equal(verifiedLedgerArchiveReceipt(receipt(true, { audit: { sequence: 0, eventHash: 'x' } }), true), false)
  assert.equal(verifiedLedgerArchiveReceipt(receipt(true), false), false)
  assert.equal(verifiedLedgerArchiveReceipt(receipt(true, { restorables: [target, target] }), true), false, 'duplicate restorables')
  assert.equal(verifiedLedgerArchiveReceipt(receipt(true, {
    candidates: [{ targetKind: 'request', requestId: 'R54', reason: { code: 'fully-superseded', detail: 'x', supersedingRequestIds: [] } }],
  }), true), false, 'fully-superseded with no superseding ids')
})
