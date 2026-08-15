// The live composer (src/components.js buildChat, iteration 6): the send
// button's two faces, the queue strip, and the actions popup. The rules being
// pinned are the owner's, near-verbatim: "stop should be a button that
// replaces the send button when a agent is replying, unless a user types then
// it turns back into a send to send while the agent is working, unless the
// have que on then it gets loaded and waits and we should [show] a little
// preview of it waiting to be sent" — and the popup is "a clean pop up just
// like vscode is" behind a button "next to the attachments icon".
//
// Source pins, deliberately: buildChat needs a DOM to run, and the harness
// here has none. Each assertion anchors on the code shape that carries the
// rule, so the day the shape changes this suite says which rule to re-measure.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')
const components = readFileSync(join(SRC, 'components.js'), 'utf8')
const chat = components.slice(components.indexOf('export function buildChat'))

test('every new power is optional; the old callers compile unchanged', () => {
  assert.match(chat.slice(0, 800), /status = null, queue = null, actions = null, actionsNote = null, onStop = null/,
    'a new composer option lost its null default; agent.js and comms.js would have to change')
  for (const caller of ['views/agent.js', 'views/comms.js']) {
    const source = readFileSync(join(SRC, caller), 'utf8')
    const call = source.slice(source.indexOf('buildChat('), source.indexOf('buildChat(') + 1400)
    assert.ok(!/onStop|queue:|actions:|status:/.test(call),
      `${caller} passes a live-composer option; those belong to the fleet page's config alone`)
  }
})

test('the stop face shows only while busy with an empty input, and a press stops', () => {
  const sync = chat.slice(chat.indexOf('const syncComposer'), chat.indexOf('const syncComposer') + 700)
  assert.match(sync, /isBusy\(\) && !input\.value\.trim\(\) && typeof onStop === 'function'/,
    "the stop-face rule changed — it must be exactly: busy AND empty input AND a stop handler")
  assert.match(sync, /is-stop/, 'the stop face lost its class; the button cannot morph')
  const send = chat.slice(chat.indexOf('const send = ()'), chat.indexOf('const send = ()') + 900)
  assert.match(send, /if \(isBusy\(\) && typeof onStop === 'function'\) void runStop\(\)/,
    'pressing the empty-input button while busy no longer stops')
  /* Typing repaints instantly — the moment there are words, the arrow is
     back, because sending the person's words outranks the interrupt. */
  assert.match(chat, /input\.addEventListener\('input', onInputTyped\)/, 'typing no longer repaints the composer; the stop face lingers over words')
})

test('a busy typed send queues with NO me-bubble — the strip is the preview', () => {
  const send = chat.slice(chat.indexOf('const send = ()'), chat.indexOf('replyQueue.push'))
  /* End the branch slice at `pinned = true` — the first line of the idle
     path — with no newline in the anchor (the file is CRLF on Windows). */
  const busyBranch = send.slice(send.indexOf('if (isBusy() && queue)'), send.indexOf('pinned = true'))
  assert.ok(busyBranch.includes('queue.add(v)'), 'a busy typed send no longer queues')
  assert.ok(!/addMsg\('me'/.test(busyBranch),
    'the busy queue branch prints a me-bubble — that claims the words were SENT when they are waiting')
  assert.match(chat, /queueStrip\.hidden = entries\.length === 0/, 'the strip no longer follows the queue')
  /* The person's words render as text, never markup. */
  assert.match(chat, /text\.textContent = entry\.text/, "the strip renders the person's words some way other than textContent")
  assert.match(chat, /queue\.cancel\(entry\.id\)/, 'a waiting row lost its way out (Unqueue)')
})

test('the actions button sits in the composer row and the popup closes honestly', () => {
  assert.match(chat, /data-chat-actions/, 'the composer lost its actions button')
  /* Placement: after the mention button, before the input — "next to the
     attachments icon". Pinned by order of appearance in the template. */
  const template = chat.slice(0, chat.indexOf('const log ='))
  const attachAt = template.indexOf('data-chat-attach')
  const actionsAt = template.indexOf('data-chat-actions')
  const inputAt = template.indexOf('<input type="text"')
  assert.ok(attachAt < actionsAt && actionsAt < inputAt, 'the actions button left its place beside the attach and mention tools')
  assert.match(chat, /addEventListener\('pointerdown', onDocPointer, true\)/, 'the popup no longer closes on an outside press')
  assert.match(chat, /event\.key === 'Escape'/, 'the popup no longer closes on Escape')
  assert.match(chat, /'openActions'/, 'root.openActions vanished — the slash commands and palette ids have no door to the stages')
  /* Dispose tears the popup and the subscriptions down with the chat. */
  const dispose = chat.slice(chat.indexOf('const dispose = ()'), chat.indexOf('const dispose = ()') + 1400)
  assert.match(dispose, /closeActionsPop\(\)/, 'dispose leaves the popup standing over a dead chat')
  assert.match(dispose, /statusUnsub\?\.\(\)/, 'dispose leaks the status subscription')
  assert.match(dispose, /queueUnsub\?\.\(\)/, 'dispose leaks the queue subscription')
})

test('the effort stage cannot restart without the token-cost sentence', () => {
  /* The warned-restart contract survives the move into the popup: the pick
     shows EFFORT_SWITCH.warn as the confirm row's hint, and only the confirm
     row's own press reaches resumeNodeSession. */
  const view = readFileSync(join(SRC, 'views', 'computers.js'), 'utf8')
  const effortStage = view.slice(view.indexOf('const effortRows'), view.indexOf('const modelRows'))
  assert.match(effortStage, /hint: EFFORT_SWITCH\.warn/, 'the depth confirm lost its token-cost warning')
  const warnAt = effortStage.indexOf('EFFORT_SWITCH.warn')
  const restartAt = effortStage.indexOf('resumeNodeSession')
  assert.ok(warnAt !== -1 && restartAt > warnAt, 'the restart comes before the warning — the pick restarts silently')
})
