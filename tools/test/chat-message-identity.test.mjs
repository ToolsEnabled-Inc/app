/* ONE CONVERSATION, PAINTED THREE DIFFERENT WAYS.
 *
 * Owner, items 2 and 4: the messages "pile" and "combine into each other".
 * MEASURED on a staged packaged build: nothing geometrically overlapped
 * (overlaps [], textSpill [], clipped [], the log scrolled correctly) -- so
 * this was never a layout collision. It was identity.
 *
 * buildChat renders a reply arriving through its OWN handlers with the ROLE KEY
 * as the bubble class -- `reply: text => addMsg(roleKey, ...)` -- and no
 * `.msg.<role>` rule exists in any stylesheet. Only `.msg.them` and `.msg.me`
 * are styled. So a reply got `class="msg helper"` and was measured at:
 *
 *     backgroundColor rgba(0,0,0,0)   border-width 0px   box-shadow none
 *     align-self auto (full log width, neither side)     hasWho false
 *
 * directly beneath a proper `msg them` bubble carrying all of it. Restored
 * history in the SAME log painted as a bubble; the live reply painted as bare
 * text across the whole log. Also measured: the person's own LIVE message had
 * no sender label while their restored history did.
 *
 * The rule pinned here: a message paints by WHO SAID IT, never by which code
 * path delivered it, and the log has exactly three kinds -- the agent, the
 * person, and the product's own notes -- every one of them styled.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const SRC = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'src')
const components = readFileSync(join(SRC, 'components.js'), 'utf8')
const chat = components.slice(components.indexOf('export function buildChat'))
const styles = readFileSync(join(SRC, 'styles.css'), 'utf8')

test('no message is painted with a role key, so none can land unstyled', () => {
  assert.ok(
    !/addMsg\(roleKey/.test(chat),
    'a bubble is still classed by the role key; there is no .msg.<role> rule anywhere, so it renders as bare full-width text',
  )
  assert.ok(!/makeMsg\(roleKey/.test(chat), 'the same defect through makeMsg')
})

test('a live reply paints exactly like a restored one: the agent bubble', () => {
  const send = chat.slice(chat.indexOf('if (typeof onSend === \'function\')'), chat.indexOf('replyQueue.push'))
  assert.match(send, /reply: text => \{ if \(!disposed\) addMsg\('them'/, 'the live reply no longer paints as the agent')
  /* And the restored path is the same call, so the two cannot drift. */
  const history = chat.slice(chat.indexOf('if (Array.isArray(history) && history.length)'), chat.indexOf('const titleHash'))
  assert.match(history, /addMsg\(\s*[\s\S]{0,80}'them'/, 'restored history no longer paints as the agent')
})

test('the product own notes are a kind of their own, and it is styled', () => {
  /* A refusal is not the agent speaking, and dressing it as the agent would be
     the product putting words in its mouth. So it gets its own row -- which is
     only allowed to exist because there is a rule for it. */
  assert.match(chat, /addMsg\('note'/, 'the refusal path lost its own kind, so it is either unstyled or attributed to the agent')
  assert.match(styles, /\.msg\.note\b/, 'the note row has no rule in styles.css; it will paint as bare full-width text')
})

test('every kind the log can produce has a rule', () => {
  /* The three kinds, enumerated in one place so this test can be exhaustive
     rather than a spot check. */
  const kinds = [...new Set([...chat.matchAll(/(?:addMsg|makeMsg)\('(\w+)'/g)].map(match => match[1]))].sort()
  assert.deepEqual(kinds, ['me', 'note', 'them'], `the log gained a message kind: ${kinds.join(', ')}`)
  for (const kind of kinds) {
    assert.ok(new RegExp(`\\.msg\\.${kind}\\b`).test(styles), `.msg.${kind} has no rule; that kind paints as bare text`)
  }
})

test('sender labels follow the speaker, not the delivery path', () => {
  /* Live messages passed no label at all while restored history passed one for
     every entry, so the same conversation showed names on its past and none on
     its present. One rule now decides, inside addMsg: a label when the speaker
     changes, whoever appended the row. */
  const add = chat.slice(chat.indexOf('const addMsg = (from, text, who'), chat.indexOf('/* REAL HISTORY'))
  assert.match(add, /lastLabelled/, 'nothing tracks who spoke last, so labels cannot follow the speaker')
  assert.match(add, /who === undefined/, 'a caller that leaves the label to the chat has no way to say so')
  /* The person's own live message goes through the same door. */
  assert.match(chat, /const message = addMsg\('me', v\)/, "the person's live message no longer takes the shared label rule")
})

test('a streamed turn is the same bubble as a finished one', () => {
  const stream = chat.slice(chat.indexOf("Object.defineProperty(root, 'openStream'"))
  assert.match(stream.slice(0, 700), /makeMsg\('them', ''/, 'the live stream bubble is not an agent bubble')
  assert.ok(
    !/makeMsg\('them', '', null/.test(stream.slice(0, 700)),
    'the live stream bubble refuses a sender label while every other agent bubble takes one',
  )
})
