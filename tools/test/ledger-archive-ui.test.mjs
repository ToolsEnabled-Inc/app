import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  createLedgerArchiveController,
  verifiedLedgerArchiveReceipt,
} from '../../src/mission-bridge.js'

const PLAN = 'a'.repeat(64)
const CANDIDATES = Object.freeze([
  Object.freeze({ id: 'R54', reasonCode: 'completed', reason: 'status done and every declared gate is met:true' }),
  Object.freeze({ id: 'R241', reasonCode: 'fully-superseded', reason: 'fully superseded by R1162', supersedingRequestIds: ['R1162'] }),
])

function receipt(dryRun, overrides = {}) {
  return {
    ok: true,
    receipt: {
      action: 'ledger-archive',
      actor: 'coordinator-sol',
      at: '2026-08-07T12:00:00.000Z',
      planSha256: PLAN,
      candidates: CANDIDATES,
      inconsistencies: [{
        id: 'R55',
        code: 'DONE_WITH_UNMET_GATE',
        reason: 'status is done but gate 1 is not met:true; retained in the active ledger',
      }],
      activeCount: dryRun ? 474 : 472,
      archiveCount: dryRun ? 0 : 2,
      dryRun,
      movedIds: dryRun ? [] : CANDIDATES.map(candidate => candidate.id),
      movedCount: dryRun ? 0 : CANDIDATES.length,
      ...(dryRun ? {} : { intentAudit: { sequence: 40, eventHash: 'b'.repeat(64) } }),
      audit: { sequence: dryRun ? 39 : 41, eventHash: 'c'.repeat(64) },
      ...overrides,
    },
  }
}

test('settings contains the owner-gated cleanup button wired to the bounded controller', () => {
  const source = readFileSync(new URL('../../src/views/settings.js', import.meta.url), 'utf8')
  const bridge = readFileSync(new URL('../../src/mission-bridge.js', import.meta.url), 'utf8')
  assert.match(source, /name: 'Clean up old R'/)
  assert.match(source, /data-setting-action="ledger-archive"/)
  assert.match(source, /createLedgerArchiveController/)
  assert.match(bridge, /'ledger-archive': '\/v1\/actions\/ledger-archive'/)
})

test('first click performs only a dry-run and second explicit click moves the exact preview', async () => {
  const posts = []
  const states = []
  const controller = createLedgerArchiveController({
    postAction: async (action, body) => {
      posts.push({ action, body })
      return receipt(body.dryRun)
    },
    onState: state => states.push(state),
  })

  await controller.click()
  assert.deepEqual(posts, [{ action: 'ledger-archive', body: { dryRun: true } }])
  assert.equal(controller.getState().phase, 'confirm')
  assert.match(controller.getState().message, /R54/)
  assert.match(controller.getState().message, /R241/)
  assert.match(controller.getState().message, /fully superseded by R1162/)
  assert.match(controller.getState().message, /Select again/)

  await controller.click()
  assert.deepEqual(posts[1], { action: 'ledger-archive', body: { dryRun: false } })
  assert.equal(controller.getState().phase, 'success')
  assert.match(controller.getState().message, /R54, R241/)
  assert.ok(states.some(state => state.phase === 'pending-preview'))
  assert.ok(states.some(state => state.phase === 'pending-move'))
})

test('malformed or changed receipts never become success and force a new preview', async () => {
  let calls = 0
  const controller = createLedgerArchiveController({
    postAction: async (_action, body) => {
      calls += 1
      if (body.dryRun) return receipt(true)
      return receipt(false, { planSha256: 'd'.repeat(64) })
    },
  })

  await controller.click()
  await controller.click()
  assert.equal(calls, 2)
  assert.equal(controller.getState().phase, 'idle')
  assert.match(controller.getState().label, /Preview current state/)
  assert.match(controller.getState().message, /Preview again/)
})

test('receipt validation requires canonical audit data and exact moved ids', () => {
  assert.equal(verifiedLedgerArchiveReceipt(receipt(true), true), true)
  assert.equal(verifiedLedgerArchiveReceipt(receipt(false), false), true)
  assert.equal(verifiedLedgerArchiveReceipt(receipt(false, { movedIds: ['R241', 'R54'] }), false), false)
  assert.equal(verifiedLedgerArchiveReceipt(receipt(true, { audit: { sequence: 0, eventHash: 'x' } }), true), false)
  assert.equal(verifiedLedgerArchiveReceipt(receipt(true), false), false)
})
