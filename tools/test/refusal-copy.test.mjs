// B6 — NO BARE IDENTIFIER IN FRONT OF A PERSON, AND EVERY REFUSAL SAYS WHAT TO DO.
//
// WHAT THIS SUITE IS FOR, AND WHAT IT IS NOT FOR. It holds the RULE. It cannot
// hold the product: a module can be perfect and a view can still print
// `result.code` next to it, which is exactly how the nine sites this repairs
// came to exist while src/agent-availability-copy.js was already correct. The
// product half is measured by driving real refusals in the packaged window --
// tools/refusal-copy-qa.mjs -- and neither suite substitutes for the other.
//
// Two properties are asserted here and they are not the same property:
//   1. nothing this module returns is a bare identifier, for ANY input,
//      including inputs nobody wrote a table entry for; and
//   2. everything it returns ends with something to do.
// (1) alone is satisfied by returning "Refused." forever, which is why (2) is
// separate and why the length floor exists.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  GENERIC_REMEDY,
  IDENTIFIER_RE,
  REFUSAL_REMEDY,
  isBareIdentifier,
  markRefusalCode,
  refusalCodeOf,
  refusalRemedy,
  refusalSentence,
} from '../../src/refusal-copy.js'
import { UNAVAILABLE_TEXT, unavailableReason } from '../../src/agent-availability-copy.js'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = relative => readFileSync(path.join(REPO, relative), 'utf8')

/* A sentence is not a sentence if a person cannot act on it. 40 characters is
   not a style rule -- it is the length below which none of the remedies in this
   product fit, so anything shorter is a placeholder somebody meant to replace. */
const MIN_SENTENCE = 40

function assertActionable(text, what) {
  assert.equal(typeof text, 'string', `${what} did not return a string`)
  assert.ok(text.trim().length >= MIN_SENTENCE, `${what} is too short to act on: ${JSON.stringify(text)}`)
  assert.ok(!isBareIdentifier(text), `${what} is a bare identifier: ${text}`)
  /* No identifier anywhere in it, not merely at the start. The first repair of
     this defect moved the code to the END of the line, which is the same line. */
  const embedded = text.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)
  assert.equal(embedded, null, `${what} carries the identifier ${embedded?.join(', ')} in visible text: ${text}`)
  assert.match(text, /[.!?…]$/, `${what} does not end as a sentence: ${text}`)
}

test('the identifier test recognises this product’s codes and not English', () => {
  for (const code of ['BRIDGE_UNREACHABLE', 'AGENT_TURN_NONE', 'MC_ACCOUNT_SIGNED_OUT', 'A_B_C1']) {
    assert.ok(IDENTIFIER_RE.test(code), `${code} should read as an identifier`)
  }
  for (const prose of [
    'Nothing was sent.',
    'BRIDGE unreachable',            // a space: prose, not a code
    'Bridge_Unreachable',            // mixed case: not this product's shape
    'ALLCAPS',                       // no underscore: a word, not a code
    '',
  ]) {
    assert.ok(!isBareIdentifier(prose), `${JSON.stringify(prose)} should not read as an identifier`)
  }
})

test('every curated remedy is a whole sentence with no identifier in it', () => {
  const entries = Object.entries(REFUSAL_REMEDY)
  assert.ok(entries.length >= 30, `the table has shrunk to ${entries.length} entries; this suite is measuring less than it thinks`)
  for (const [code, remedy] of entries) {
    assert.ok(IDENTIFIER_RE.test(code), `${code} is not shaped like a code, so nothing will ever look it up`)
    assertActionable(remedy, `REFUSAL_REMEDY.${code}`)
    /* The whole point of the table is that it says what to DO. A remedy with no
       verb a person can follow is a diagnosis wearing a remedy's clothes. */
    assert.match(
      remedy,
      /\b(try|press|open|close|choose|pick|refresh|reload|check|look|correct|shorten|stop|start|wait|turn|reinstall|ask|sign|read|change)\b/i,
      `REFUSAL_REMEDY.${code} names no action a person can take: ${remedy}`,
    )
  }
})

test('a code nobody wrote an entry for still leaves with a sentence', () => {
  /* THE PROPERTY THAT MAKES THE RULE HOLD OVER TIME. The engine's code
     vocabulary grows; a table alone fails open on the next addition. Each of
     these is deliberately absent from REFUSAL_REMEDY. */
  const unseen = [
    'BRIDGE_SOMETHING_INVENTED_NEXT_MONTH',
    'BRIDGE_TERMINATE_SOMETHING_NEW',
    'BRIDGE_CLOUD_SOMETHING_NEW',
    'ORG_SOMETHING_NEW',
    'MC_ACCOUNT_SOMETHING_NEW',
    'LOOP_SOMETHING_NEW',
    'TOTALLY_UNRELATED_THING',
  ]
  for (const code of unseen) {
    assert.ok(!Object.hasOwn(REFUSAL_REMEDY, code), `${code} was added to the table; pick another unseen code for this test`)
    assertActionable(refusalRemedy(code), `refusalRemedy(${code})`)
    assertActionable(refusalSentence({ ok: false, code }), `refusalSentence(${code})`)
  }
  /* Family membership is real, not incidental: a terminate code must not be
     answered with the generic remedy when a terminate remedy exists. */
  assert.notEqual(refusalRemedy('BRIDGE_TERMINATE_SOMETHING_NEW'), GENERIC_REMEDY)
  assert.match(refusalRemedy('BRIDGE_TERMINATE_SOMETHING_NEW'), /stop/i)
  assert.match(refusalRemedy('BRIDGE_CLOUD_SOMETHING_NEW'), /spent|launch/i)
  assert.equal(refusalRemedy('TOTALLY_UNRELATED_THING'), GENERIC_REMEDY)
})

/* EVERY REFUSAL THE LAUNCH RECORD CAN RAISE, READ OFF THE ENGINE ITSELF.
 *
 * A HAND-WRITTEN LIST WOULD MEASURE THIS SUITE'S MEMORY, NOT THE PRODUCT. The
 * codes are scanned out of the shipped payload, so an engine that adds one next
 * month is covered here the day it lands rather than the day somebody remembers.
 *
 * WHAT WAS TRUE BEFORE THIS EXISTED: exactly one of them was curated, and every
 * other one — over twenty codes, including "that agent is switched off" and
 * "that agent may not take this work" — fell through every family to the generic
 * remedy, which tells the reader to close the application and open it again.
 * They were unreachable while a fresh install declared no agents to launch; the
 * shipped organisation now declares eight, so they are live.
 */
test('no refusal from the launch record reaches a person as "close and reopen the app"', () => {
  const source = read(path.join('capability', 'src', 'lib', 'controller-launch-record.js'))
  const codes = new Set([...source.matchAll(/fail\('(LAUNCH_[A-Z0-9_]+)'/g)].map(match => match[1]))
  assert.ok(codes.size >= 15, `the scan found only ${codes.size} launch codes, so its pattern has stopped matching`)

  for (const code of codes) {
    const remedy = refusalRemedy(code)
    assertActionable(remedy, `refusalRemedy(${code})`)
    assert.notEqual(remedy, GENERIC_REMEDY, `${code} still falls to the generic remedy`)
    /* The specific wrong advice this repairs. None of these is cured by
       restarting, and a person who follows that instruction loses their window
       and comes back to the same refusal. */
    assert.ok(!/reopen|open it a second time|reinstall/i.test(remedy),
      `${code} tells a person to restart the application, which cannot clear it: ${remedy}`)
  }

  /* The five the brief named are curated rather than left on the family floor,
     because each has a DIFFERENT next move and the floor can only offer one. */
  for (const code of ['LAUNCH_DISABLED_AGENT', 'LAUNCH_UNKNOWN_AGENT', 'LAUNCH_PHASE_REJECTED', 'LAUNCH_SCOPE_ACTIVATION_REQUIRED', 'LAUNCH_FANOUT_EXCEEDED']) {
    assert.ok(Object.hasOwn(REFUSAL_REMEDY, code), `${code} has no curated sentence of its own`)
    assert.ok(codes.has(code), `${code} is curated but the engine no longer raises it; check the entry is still wanted`)
  }
})

/* THE ENGINE'S OWN ARCHIVE CODES reach this table unchanged (typedError keeps
   a well-formed code), and every one of them means the request was left where
   it was. The floor must say so, and must say the one thing a person can do
   about a row that will not archive -- hide it on the Ledger page. Without it
   these fell to GENERIC_REMEDY and "close ToolsEnabled and open it again". */
test('a request the archive will not take is answered with where it is and what to do instead, not with a restart', () => {
  for (const code of ['LEDGER_ARCHIVE_TARGET_INELIGIBLE', 'LEDGER_ARCHIVE_EXPOSURE_INSUFFICIENT', 'LEDGER_ARCHIVE_PROTECTED_REQUEST', 'LEDGER_ARCHIVE_VETOED']) {
    assert.ok(!Object.hasOwn(REFUSAL_REMEDY, code), `${code} was curated; this test measures the family floor`)
    const remedy = refusalRemedy(code)
    assert.notEqual(remedy, GENERIC_REMEDY, `${code} fell to the generic remedy`)
    assert.match(remedy, /^Nothing was moved\./)
    assert.match(remedy, /hide it from the Ledger page instead/)
    assertActionable(refusalSentence({ ok: false, code }), `refusalSentence(${code})`)
  }
})

test('a full pool is answered as capacity, not as something the person set up wrong', () => {
  /* BRIDGE_ALL_SEATS_BUSY is raised when every agent in the level's pool is
     already carrying a lane. Telling that reader to change what they chose sends
     them to edit their fleet over a queue that clears on its own, so this
     assertion is about what the sentence must NOT do as much as what it says. */
  const remedy = refusalRemedy('BRIDGE_ALL_SEATS_BUSY')
  assertActionable(remedy, 'refusalRemedy(BRIDGE_ALL_SEATS_BUSY)')
  assert.notEqual(remedy, GENERIC_REMEDY)
  assert.match(remedy, /\bwait\b/i, 'a capacity refusal has to offer waiting as an answer')
  assert.match(remedy, /\bstop\b/i, 'a capacity refusal has to offer stopping one as the other answer')
  assert.ok(!/reopen|reinstall|correct what you|not one this copy/i.test(remedy),
    `a full pool was reported as a fault to be fixed: ${remedy}`)
})

test('ABSENCE — every shape of "we were told nothing" still produces a whole sentence', () => {
  /* THE SIGNATURE DEFECT OF THIS CODEBASE, in its refusal-copy costume. Each of
     these really arrives: a call that threw before the layer said anything, a
     receipt-shaped object with no fields, `reason: error?.message` where the
     message is empty, and -- the one that would have put the identifier back on
     the glass through the one door left open -- a reason that IS a code. */
  const absences = [
    undefined,
    null,
    {},
    { ok: false },
    { ok: false, code: '' },
    { ok: false, code: null },
    { ok: false, reason: '' },
    { ok: false, reason: '   ' },
    { ok: false, code: 'BRIDGE_UNREACHABLE', reason: '' },
    { ok: false, code: 'BRIDGE_UNREACHABLE', reason: 'BRIDGE_UNREACHABLE' },
    { ok: false, reason: 'ERR_IPC_CHANNEL_CLOSED' },
    { ok: false, code: 42, reason: 7 },
    { ok: false, code: 'not a code at all', reason: null },
    'a string where an object was expected',
    0,
  ]
  for (const absence of absences) {
    assertActionable(refusalSentence(absence), `refusalSentence(${JSON.stringify(absence)})`)
  }
})

test('a reason that is itself an identifier is never shown as prose', () => {
  const shown = refusalSentence({ ok: false, code: 'BRIDGE_TIMEOUT', reason: 'BRIDGE_TIMEOUT' })
  assert.ok(!shown.includes('BRIDGE_TIMEOUT'), `the identifier reached visible text through the reason field: ${shown}`)
  assert.equal(shown, refusalSentence({ ok: false, code: 'BRIDGE_TIMEOUT' }),
    'a reason that is only a restatement of the code should read the same as no reason at all')
})

test('the engine’s English survives verbatim, with the remedy after it', () => {
  const engine = 'The initiating actor is not the enabled declared controller.'
  const shown = refusalSentence({ ok: false, code: 'BRIDGE_ACTOR_REFUSED', reason: engine })
  assert.ok(shown.startsWith(engine), `the engine's own sentence was dropped or reworded: ${shown}`)
  assert.ok(shown.length > engine.length, 'the diagnosis was shown with no remedy after it')
  assert.ok(shown.endsWith(REFUSAL_REMEDY.BRIDGE_ACTOR_REFUSED), `the remedy is not the one the table names: ${shown}`)
})

test('a diagnosis with no full stop still reads as a sentence, and one with a full stop gets no second one', () => {
  const bare = refusalSentence({ ok: false, code: 'BRIDGE_TIMEOUT', reason: 'the request never came back' })
  assert.match(bare, /came back\. /, `punctuation was not repaired: ${bare}`)
  const stopped = refusalSentence({ ok: false, code: 'BRIDGE_TIMEOUT', reason: 'The request never came back.' })
  assert.ok(!stopped.includes('..'), `a second full stop was added: ${stopped}`)
})

test('a caller’s fallback fills the diagnosis slot, and a caller’s remedy overrides the table', () => {
  const withFallback = refusalSentence({ ok: false, code: 'BRIDGE_REQUEST_FAILED' }, { fallback: 'The dispatch was refused with no receipt.' })
  assert.match(withFallback, /^The dispatch was refused with no receipt\./)
  const overridden = refusalSentence({ ok: false, code: 'BRIDGE_REQUEST_FAILED' }, { remedy: 'Refresh the task list before pressing Launch again.' })
  assert.ok(overridden.endsWith('Refresh the task list before pressing Launch again.'), overridden)
  assert.ok(!overridden.includes(REFUSAL_REMEDY.BRIDGE_REQUEST_FAILED), 'the override did not replace the table entry')
  /* An empty override is an ABSENCE, not an instruction to say nothing. */
  const emptyOverride = refusalSentence({ ok: false, code: 'BRIDGE_REQUEST_FAILED' }, { remedy: '   ' })
  assert.equal(emptyOverride, refusalSentence({ ok: false, code: 'BRIDGE_REQUEST_FAILED' }))
})

test('refusalCodeOf reports the code only when there is one', () => {
  assert.equal(refusalCodeOf({ code: 'BRIDGE_TIMEOUT' }), 'BRIDGE_TIMEOUT')
  assert.equal(refusalCodeOf({ code: '  BRIDGE_TIMEOUT  ' }), 'BRIDGE_TIMEOUT')
  for (const nothing of [undefined, null, {}, { code: '' }, { code: '   ' }, { code: 12 }, { code: 'a sentence, not a code' }, 'string']) {
    assert.equal(refusalCodeOf(nothing), null, `refusalCodeOf(${JSON.stringify(nothing)}) invented a code`)
  }
})

test('markRefusalCode writes the identifier to the DOM and never writes an empty one', () => {
  /* A hand-rolled stand-in rather than jsdom: this repo's suites run under plain
     node, and the contract being checked is three method calls wide. */
  const node = {
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value) },
    removeAttribute(name) { this.attributes.delete(name) },
  }
  markRefusalCode(node, { code: 'BRIDGE_TIMEOUT' })
  assert.equal(node.attributes.get('data-refusal-code'), 'BRIDGE_TIMEOUT')
  /* The absence case: a later success must REMOVE it, not blank it. A blank
     attribute reads as "there is a code and it is empty" to every probe that
     tests for presence, which is this codebase's signature defect exactly. */
  markRefusalCode(node, null)
  assert.equal(node.attributes.has('data-refusal-code'), false, 'an absent code left a blank attribute behind')
  assert.doesNotThrow(() => markRefusalCode(null, { code: 'BRIDGE_TIMEOUT' }))
  assert.doesNotThrow(() => markRefusalCode({}, { code: 'BRIDGE_TIMEOUT' }))
})

test('the agent-start table’s unknown-code door is closed too', () => {
  /* unavailableReason() used to return `String(code)` for anything it had no
     entry for, which is the same defect inside the module that fixed it
     everywhere else. src/agent-session.js reaches it with `error?.code` from a
     rejected IPC call, and a platform rejection carries codes like this one. */
  for (const code of ['ERR_IPC_CHANNEL_CLOSED', 'AGENT_SOMETHING_NEW', 'MADE_UP_CODE']) {
    const shown = unavailableReason(code)
    assert.ok(!shown.includes(code), `unavailableReason still prints the bare code for ${code}: ${shown}`)
    assert.ok(shown.trim().length >= MIN_SENTENCE, `unavailableReason(${code}) is too short to act on: ${shown}`)
  }
  for (const nothing of [undefined, null, '', 0]) {
    const shown = unavailableReason(nothing)
    assert.ok(shown.trim().length >= MIN_SENTENCE, `unavailableReason(${JSON.stringify(nothing)}) says nothing useful: ${shown}`)
  }
  /* A code it DOES know must still get its own sentence, unchanged. */
  assert.equal(unavailableReason('AGENT_TURN_NONE'), UNAVAILABLE_TEXT.AGENT_TURN_NONE)
})

test('the three session-steering codes the agent page renders all have sentences', () => {
  /* src/views/agent.js prints `${id} did not happen · ${result?.code}` for the
     Pause / Respawn / Terminate controls. These are the codes those three can
     answer with, read off src/agent-session.js's control object. */
  const source = read('src/agent-session.js')
  const control = source.slice(source.indexOf('control = Object.freeze({'))
  const raised = new Set([...control.matchAll(/code:\s*'([A-Z][A-Z0-9_]+)'/g)].map(match => match[1]))
  assert.ok(raised.size >= 4, `the scan found only ${raised.size} steering codes, so its pattern has stopped matching`)
  for (const code of raised) {
    assert.ok(Object.hasOwn(UNAVAILABLE_TEXT, code), `the steering controls can answer ${code} and no surface has a sentence for it`)
  }
})

/* COMMENTS ARE NOT CODE, and a scan that forgets it measures the wrong thing.
 *
 * Every note in this lane's diff quotes the line it replaced -- that is how the
 * repair explains itself -- so a naive text scan for `${...code...}` finds
 * sixteen hits and every one of them is prose. Team 2's B2 hit the same trap
 * from the other side and reported a count that was two too high. So the scan
 * blanks comments before it looks, character by character rather than by
 * regex: a `//` inside a string, and a `/*` inside a template literal, are both
 * real in this repo and neither starts a comment.
 *
 * REGULAR-EXPRESSION LITERALS ARE THE THIRD STATE, and leaving them out is what
 * broke the first version of this. src/org-controls.js opens with
 * `.replace(/[&<>"']/g, ...)`; a scanner that does not know that is a regex
 * sees the `"` inside it, believes a string has opened, and every comment for
 * the rest of the file looks like string content. A `/` starts a regex only
 * where a value cannot already have ended, which is what the operator test
 * below is: after `(`, `,`, `=`, `:`, `[`, `!`, `&`, `|`, `?`, `{`, `}`, `;`
 * or a return/typeof-style keyword, a `/` is a regex; after an identifier, a
 * `)` or a `]`, it is division.
 *
 * Line structure is preserved (comment characters become spaces) so the line
 * numbers it reports are the line numbers in the file.
 */
function withoutComments(source) {
  let out = ''
  let index = 0
  let quote = null          // ' " or ` while inside a string
  let comment = null        // 'line' or 'block'
  let regex = false         // inside a /regex/ literal
  const regexMayStart = () => {
    const before = out.replace(/\s+$/, '')
    if (before.length === 0) return true
    if (/[([{,;:=!&|?+\-*%~^<>]$/.test(before)) return true
    return /\b(return|typeof|case|in|of|do|else|instanceof|new|delete|void|throw)$/.test(before)
  }
  while (index < source.length) {
    const character = source[index]
    const next = source[index + 1]
    if (regex) {
      out += character
      if (character === '\\') { out += source[index + 1] ?? ''; index += 2; continue }
      if (character === '[') {
        // a character class: a `/` inside it is literal, so run to its close
        while (index + 1 < source.length && source[index + 1] !== ']') {
          index += 1
          out += source[index]
          if (source[index] === '\\') { index += 1; out += source[index] ?? '' }
        }
        index += 1
        out += source[index] ?? ''
        index += 1
        continue
      }
      if (character === '/' || character === '\n') regex = false
      index += 1
      continue
    }
    if (comment === 'line') {
      if (character === '\n') { comment = null; out += character } else out += ' '
      index += 1
      continue
    }
    if (comment === 'block') {
      if (character === '*' && next === '/') { comment = null; out += '  '; index += 2; continue }
      out += character === '\n' ? '\n' : ' '
      index += 1
      continue
    }
    if (quote) {
      out += character
      if (character === '\\') { out += source[index + 1] ?? ''; index += 2; continue }
      if (character === quote) quote = null
      index += 1
      continue
    }
    if (character === '/' && next === '/') { comment = 'line'; out += '  '; index += 2; continue }
    if (character === '/' && next === '*') { comment = 'block'; out += '  '; index += 2; continue }
    if (character === '/' && regexMayStart()) { regex = true; out += character; index += 1; continue }
    if (character === '\'' || character === '"' || character === '`') { quote = character; out += character; index += 1; continue }
    out += character
    index += 1
  }
  return out
}

test('the comment stripper does not blind the scan it feeds', () => {
  /* Without this, a stripper that returned '' would make the scan below pass
     forever while measuring nothing -- the shape of failure this whole lane is
     about. */
  const stripped = withoutComments([
    'const a = 1 // ${result.code}',
    '/* ${result.code} */',
    'const b = `kept ${result.code}`',
    'const c = "// not a comment"',
    'const d = value.replace(/[&<>"\']/g, x => x)',
    '/* after a regex containing quotes, this comment must still be blanked: ${result.code} */',
    'const e = total / count / 2',
    'const f = `still kept ${result.code}`',
  ].join('\n')).split('\n')
  assert.match(stripped[0], /const a = 1/)
  assert.ok(!stripped[0].includes('result.code'), 'a line comment survived')
  assert.ok(!stripped[1].includes('result.code'), 'a block comment survived')
  assert.match(stripped[2], /kept \$\{result\.code\}/, 'a template literal was blanked')
  assert.match(stripped[3], /\/\/ not a comment/, 'a string containing // was treated as a comment')
  assert.match(stripped[4], /\[&<>"'\]/, 'a regex literal was mangled')
  assert.ok(!stripped[5].includes('result.code'), 'a regex literal containing quotes blinded the scanner to later comments')
  assert.match(stripped[6], /total \/ count \/ 2/, 'division was mistaken for a regex')
  assert.match(stripped[7], /still kept \$\{result\.code\}/, 'code after a division was blanked')
  assert.equal(stripped.length, 8, 'line numbering was not preserved')
})

/* THE SOURCE SCAN, which is the one check that would have caught this whole
   defect class before a customer did.
 *
 * It is a text scan, and text scans are the weaker instrument -- everything
 * above asserts behaviour instead. But the defect being prevented IS textual:
 * somebody reaching for `${result.code}` in a new view, which no behavioural
 * test of an existing module can see. The scan is narrow on purpose: it looks
 * only for a code interpolated into a template literal, and it lists the files
 * it could not clear rather than counting them. */
test('no view or copy module interpolates a code into a string a person reads', () => {
  const roots = ['src', path.join('src', 'views')]
  const files = []
  for (const root of roots) {
    for (const entry of readdirSync(path.join(REPO, root), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.js')) files.push(path.join(root, entry.name))
    }
  }
  assert.ok(files.length >= 40, `the scan found only ${files.length} modules, so its walk has stopped matching`)

  /* THE FENCE IS EMPTY, AND THAT IS THE POINT IT WAS LEFT HERE TO REACH.
   *
   * It used to hold src/views/agent.js, whose steering controls printed
   * `${id} did not happen · ${result?.code}` -- the last bare identifier in the
   * product -- with the note that the entry should be deleted when the edit
   * landed. The edit has landed: that line now composes the control's own words
   * with unavailableReason(), and the code stays on `result.code` where a
   * support conversation can still reach it.
   *
   * The set stays, and so does the assertion below that a fenced file is really
   * still offending, so that fencing the NEXT one is a two-line act somebody has
   * to write down rather than a quiet skip. */
  const fenced = new Set([])

  const offences = []
  for (const file of files) {
    const lines = withoutComments(read(file)).split('\n')
    lines.forEach((line, index) => {
      if (!/\$\{[^}]*\bcode\b[^}]*\}/.test(line)) return
      // a data-* attribute is the machine channel and is where a code belongs
      if (/data-[a-z-]*code/.test(line)) return
      // a lookup that turns the code into a sentence is the fix, not the defect
      if (/unavailableReason\(|refusalRemedy\(|refusalSentence\(/.test(line)) return
      offences.push(`${file}:${index + 1}: ${line.trim()}`)
    })
  }
  const unexpected = offences.filter(offence => ![...fenced].some(name => offence.startsWith(`${name}:`)))
  assert.deepEqual(unexpected, [], `these lines put a code into a string a person reads:\n${unexpected.join('\n')}`)

  /* A fence that no longer covers a real offence is a permanent exemption
     wearing a temporary one's clothes, so an empty fence is fine and a stale
     entry is not. */
  for (const name of fenced) {
    assert.ok(
      offences.some(offence => offence.startsWith(`${name}:`)),
      `${name} no longer interpolates a code, so remove it from the fenced list above rather than leaving a permanent exemption`,
    )
  }
})
