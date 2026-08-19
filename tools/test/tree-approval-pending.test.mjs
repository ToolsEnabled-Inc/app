/* AN APPROVAL REQUEST THAT ARRIVES WHILE YOU ARE NOT LOOKING MUST STILL BE
 * ANSWERABLE.
 *
 * MEASURED on the shipped 1.0.20 build, driving as a new user at the
 * `standard` level with autonomy "Act when I start it": a child agent called
 * agent_comms.send_local, the engine raised approval_request, and the child's
 * card read "The tool call was blocked pending your permission." The fleet page
 * was open, but the CHILD'S RAIL was not -- and the approval branch rendered
 * its card only inside
 *
 *     if (currentRailTreeNode && currentRailTreeNode.id === nodeId)
 *
 * so the one event that could ever paint the Approve button passed unrendered.
 * Clicking the node afterwards rebuilt the rail from scratch; nothing re-read
 * the request, no control existed anywhere on any screen, and the session sat
 * blocked until interrupted. The product promised "it stops and asks you
 * whenever it needs permission" -- it stopped, and asked nobody.
 *
 * The contract these tests pin, in order of the failure they prevent:
 *   1. the request is REMEMBERED per session, before any is-the-rail-open test;
 *   2. opening a node's rail RENDERS a remembered request;
 *   3. answering it FORGETS it (the card already removes itself);
 *   4. the turn ending forgets it too -- an interrupted turn's request must not
 *      resurface as an Approve button for work nothing is waiting to do.
 *
 * Source-contract tests, in the idiom of tree-chat-transcript.test.mjs: this
 * view is not importable into a unit test, so the shape of the wiring is
 * asserted where behaviour cannot be.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const view = readFileSync(path.resolve(HERE, '..', '..', 'src', 'views', 'computers.js'), 'utf8')

test('a pending approval is remembered before anyone asks whether its rail is open', () => {
  const branch = view.slice(view.indexOf("if (activity.kind === 'approval' && activity.approvalId)"))
  assert.ok(branch.length > 100, 'the approval activity branch is gone; these tests are about it')
  const body = branch.slice(0, branch.indexOf('}'))
  assert.match(body, /sessionPendingApprovals\.set\(sessionId, activity\)/,
    'the approval request is not stored, so the only render is the one the event itself triggers -- look away once and the Approve button can never exist')
  assert.ok(
    body.indexOf('sessionPendingApprovals.set') < body.indexOf('currentRailTreeNode'),
    'the store happens inside the rail-is-open test, which is the exact defect: the memory must not depend on who was looking')
})

test('opening a node rail renders the approval that arrived while it was closed', () => {
  const open = view.slice(view.indexOf('function showTreeNodeControls(node)'))
  const body = open.slice(0, open.indexOf('\n  function ', 10))
  assert.match(body, /sessionPendingApprovals\.get\(node\.sessionId\)/,
    'showTreeNodeControls never asks whether an approval is waiting, so a person who arrives after the event finds no button')
  assert.match(body, /renderApprovalCard\(/,
    'the pending approval is read but never rendered on rail open')
})

test('answering the approval forgets it', () => {
  const card = view.slice(view.indexOf('function renderApprovalCard(sessionId, approval)'))
  const body = card.slice(0, card.indexOf('\n  function ', 10))
  assert.match(body, /sessionPendingApprovals\.delete\(sessionId\)/,
    'an answered approval stays remembered, so reopening the rail would offer an Approve button for a decision already made')
})

test('the turn ending forgets it too', () => {
  /* The completion branch is the one that files the answer; an approval whose
     turn is over (completed OR interrupted) is not a pending question. */
  const completion = view.slice(view.indexOf('if (!completionSettlesOpenTurn(packet, sessionId'))
  const body = completion.slice(0, completion.indexOf('scheduleChipRefresh'))
  assert.match(body, /sessionPendingApprovals\.delete\(sessionId\)/,
    'a dead turn leaves its approval remembered; interrupt a blocked agent and the ghost Approve button would return on the next rail open')
})
