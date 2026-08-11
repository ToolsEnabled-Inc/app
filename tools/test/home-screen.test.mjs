/* The home screen cannot contradict itself, repeat itself, or talk like a
 * README. Those are the three defects the owner reported, and this file is what
 * stops each of them coming back.
 *
 * WHY THE INVARIANTS ARE WALKED EXHAUSTIVELY RATHER THAN SAMPLED.
 *
 * The measured defect was not a wrong branch. Every branch of the old screen
 * was individually correct: the ring correctly reported that it had no health
 * reading, the panel correctly reported that it could not reach a coordinator,
 * and the banner correctly reported that the app works locally. The product was
 * broken by the COMBINATION, which no per-branch test can see. So the test
 * builds every reachable input to describeHome() -- thousands of them -- and
 * asserts a property of the whole rendered sentence set each time.
 *
 * That is only possible because describeHome() returns sentences as values.
 * A version of this screen that assembled its copy inside a render function
 * could not be checked this way at all, which is the reason it is not one.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  HOME_MODES,
  describeHome,
  readAgentEngine,
  readLocalSessions,
  whenWords,
} from '../../src/local-activity.js'

const NOW = Date.parse('2026-08-11T12:00:00.000Z')
const minutes = (n) => n * 60_000

/* ------------------------------------------------------------------
   Every reachable input.
   ------------------------------------------------------------------ */

const historyReply = (count, verified = true) => ({
  ok: true,
  total: count,
  verified,
  entries: Array.from({ length: count }, (_value, index) => ({
    sequence: count - index,
    at: new Date(NOW - minutes(index + 1)).toISOString(),
    action: 'agent_session_start',
  })),
})

const SESSION_INPUTS = [
  ['no shell to ask', undefined],
  ['asked, unreadable', { ok: false, code: 'SPAWN_RECORD_LEDGER_UNREADABLE' }],
  ['asked, malformed', { ok: true }],
  ['no runs yet', { ok: true, total: 0, verified: true, entries: [] }],
  ['one run', historyReply(1)],
  ['many runs', historyReply(7)],
  ['runs, chain broken', historyReply(4, false)],
  ['runs, verification unknown', historyReply(4, null)],
]

const ENGINE_INPUTS = [
  ['no shell to ask', undefined],
  ['ready', { ok: true, code: 'SPAWN_RECORD_READY' }],
  ['no engine', { ok: false, code: 'AGENT_ENGINE_UNAVAILABLE' }],
  ['no keystore', { ok: false, code: 'SPAWN_RECORD_KEYSTORE_UNAVAILABLE' }],
  ['unknown code', { ok: false, code: 'SOMETHING_NEW' }],
]

const HEALTH_INPUTS = [
  ['none', null],
  ['all clear', { available: true, atMs: NOW - minutes(3), total: 14, ok: 14, down: 0, unknown: 0 }],
  ['some down', { available: true, atMs: NOW - minutes(3), total: 14, ok: 11, down: 3, unknown: 0 }],
  ['some unknown', { available: true, atMs: NOW - minutes(3), total: 14, ok: 12, down: 0, unknown: 2 }],
  ['a single service', { available: true, atMs: NOW - minutes(3), total: 1, ok: 1, down: 0, unknown: 0 }],
]

const PEER_INPUTS = [
  ['none', null],
  ['reachable', { reachable: true, name: 'the studio machine', atMs: NOW - minutes(9) }],
]

const APPROVAL_INPUTS = [
  ['not asked', null],
  ['unreadable', { readable: false, count: 0 }],
  ['none waiting', { readable: true, count: 0 }],
  ['one waiting', { readable: true, count: 1 }],
  ['several waiting', { readable: true, count: 5 }],
]

function everyReachableInput() {
  const out = []
  for (const sample of [false, true]) {
    for (const fleetConfigured of [false, true]) {
      for (const [healthLabel, fleetHealth] of HEALTH_INPUTS) {
        for (const [peerLabel, peer] of PEER_INPUTS) {
          for (const [sessionLabel, sessionRaw] of SESSION_INPUTS) {
            for (const [engineLabel, engineRaw] of ENGINE_INPUTS) {
              for (const [approvalLabel, approvals] of APPROVAL_INPUTS) {
                out.push({
                  label: `sample=${sample} fleet=${fleetConfigured} health=${healthLabel} `
                    + `peer=${peerLabel} sessions=${sessionLabel} engine=${engineLabel} approvals=${approvalLabel}`,
                  input: {
                    sample,
                    fleetConfigured,
                    fleetHealth,
                    peer,
                    sessions: readLocalSessions(sessionRaw),
                    engine: readAgentEngine(engineRaw),
                    approvals,
                    nowMs: NOW,
                  },
                })
              }
            }
          }
        }
      }
    }
  }
  return out
}

const ALL = everyReachableInput()

/* ------------------------------------------------------------------
   1. It never contradicts itself.
   ------------------------------------------------------------------ */

/* A contradiction is two statements taking OPPOSITE POLARITY on the SAME
   SUBJECT in one render. The two subjects below are not arbitrary: they are
   exactly the pair the owner was shown -- can this product do anything on this
   computer, and are there other computers -- and the measured failure was one
   positive and one negative claim about the first, printed together. */
const SUBJECTS = [
  {
    id: 'this computer can run agents',
    positive: [/agents can run on this computer/i, /already works on this/i],
    negative: [
      /no local agent fleet host/i,
      /cannot run agents/i,
      /not set up to run agents/i,
      /will not start an agent/i,
      /will not add to it/i,
      /shutting down/i,
    ],
  },
  {
    id: 'other computers',
    positive: [/^connected to /i],
    negative: [
      /only computer connected/i,
      /could not be reached/i,
      /nothing has been heard from them/i,
      /running in a browser/i,
    ],
  },
]

const hits = (patterns, statements) => statements.filter(s => patterns.some(p => p.test(s)))

test('no reachable home screen states both sides of the same fact', () => {
  for (const { label, input } of ALL) {
    const { statements } = describeHome(input)
    for (const subject of SUBJECTS) {
      const yes = hits(subject.positive, statements)
      const no = hits(subject.negative, statements)
      assert.ok(
        yes.length === 0 || no.length === 0,
        `contradiction about "${subject.id}" with ${label}\n  says: ${JSON.stringify(yes)}\n  and:  ${JSON.stringify(no)}`,
      )
    }
  }
})

/* NEAR-duplicates count, and this is not a refinement -- it is the defect
 * itself. What the owner was shown was "No local agent fleet host detected on
 * this machine" printed TWICE, and the first version of this rewrite put "No
 * agent has run here yet" in the hero next to "No agents have run here yet" in
 * the panel, which an exact-match check waves straight through and a person
 * reads as the screen stuttering.
 *
 * So statements are compared after normalising away the differences that carry
 * no meaning: case, punctuation, plural s, and the auxiliary verbs and articles
 * that shift when a sentence is rephrased rather than restated. Two statements
 * that survive that as the same string are the same statement. */
const FILLER = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'has', 'have', 'had', 'be', 'been',
  'to', 'of', 'on', 'in', 'it', 'this', 'that', 'your', 'you', 'and', 'so', 'here',
])

function normalize(statement) {
  return statement
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(word => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word))
    .filter(word => !FILLER.has(word))
    .join(' ')
}

function jaccard(left, right) {
  const a = new Set(left.split(' ').filter(Boolean))
  const b = new Set(right.split(' ').filter(Boolean))
  if (a.size === 0 || b.size === 0) return 0
  const shared = [...a].filter(word => b.has(word)).length
  return shared / (a.size + b.size - shared)
}

test('no reachable home screen says the same thing twice, in any words', () => {
  for (const { label, input } of ALL) {
    const { statements } = describeHome(input)
    const normalized = statements.map(normalize)
    for (let i = 0; i < statements.length; i += 1) {
      for (let j = i + 1; j < statements.length; j += 1) {
        assert.notEqual(
          normalized[i], normalized[j],
          `the same statement twice with ${label}:\n  ${JSON.stringify(statements[i])}\n  ${JSON.stringify(statements[j])}`,
        )
        const overlap = jaccard(normalized[i], normalized[j])
        assert.ok(
          overlap < 0.8,
          `two statements are ${Math.round(overlap * 100)}% the same with ${label}:`
          + `\n  ${JSON.stringify(statements[i])}\n  ${JSON.stringify(statements[j])}`,
        )
      }
    }
  }
})

test('no reachable home screen states more than three facts under the ring', () => {
  /* Five unavailability notices in one viewport is the thing that made this
     screen unreadable, so there is a cap. THREE, not five and not a comfortable
     four: the cap is set to the actual maximum the current copy produces, so
     adding a fourth row is a decision someone has to make on purpose by editing
     this line. A cap with slack in it is not a cap -- a first mutation round
     planted a fourth row and this assertion, then written as `<= 4`, waved it
     straight through. */
  for (const { label, input } of ALL) {
    const { facts } = describeHome(input)
    assert.ok(facts.length <= 3, `${facts.length} facts with ${label}`)
    assert.equal(new Set(facts.map(fact => fact.id)).size, facts.length, `duplicate fact ids with ${label}`)
  }
})

/* ------------------------------------------------------------------
   2. It is written for a person.
   ------------------------------------------------------------------ */

/* Verbatim from the screen the owner was shown, plus the rest of the register
   it came from. Each of these names a mechanism rather than a thing a person
   has. */
const INTERNAL_VOCABULARY = [
  /projection/i,
  /audited bridge/i,
  /coordinator thread/i,
  /health sweep/i,
  /source unavailable/i,
  /read-only/i,
  /envelope/i,
  /payload/i,
  /schema/i,
  /\bIPC\b/,
  /localhost|127\.0\.0\.1/,
  /subsystem/i,
  /durable/i,
  /idempotenc/i,
  /snapshot/i,
  /\bfleet host\b/i,
]

/* The punctuation of a technical document. The owner named this directly:
   "What is with all the symbols in the writing thats a readme". */
const README_PUNCTUATION = [
  ['·', 'interpunct used as a separator'],
  ['…', 'ellipsis'],
  ['—', 'em dash'],
  ['●', 'filled-circle bullet'],
  ['→', 'arrow'],
  ['|', 'pipe'],
]

test('no reachable home screen names a mechanism instead of a thing a person has', () => {
  for (const { label, input } of ALL) {
    for (const statement of describeHome(input).statements) {
      for (const pattern of INTERNAL_VOCABULARY) {
        assert.doesNotMatch(statement, pattern, `internal vocabulary with ${label}: ${JSON.stringify(statement)}`)
      }
    }
  }
})

test('no reachable home screen punctuates like a README', () => {
  for (const { label, input } of ALL) {
    for (const statement of describeHome(input).statements) {
      for (const [character, name] of README_PUNCTUATION) {
        assert.ok(
          !statement.includes(character),
          `${name} with ${label}: ${JSON.stringify(statement)}`,
        )
      }
      /* Shouted words. Two-letter initialisms are fine; a word is not. */
      const shouted = statement.match(/\b[A-Z]{3,}\b/g)
      assert.equal(shouted, null, `uppercase word with ${label}: ${JSON.stringify(shouted)}`)
    }
  }
})

/* ------------------------------------------------------------------
   3. The clock is never broken.
   ------------------------------------------------------------------ */

test('the clock is either a real instant or absent, never a row of placeholders', () => {
  for (const { label, input } of ALL) {
    const { clock } = describeHome(input)
    assert.ok(
      clock === null || (Number.isFinite(clock) && clock > 0),
      `clock is neither a real instant nor absent with ${label}: ${String(clock)}`,
    )
  }
})

test('a screen with nothing to count shows no clock at all', () => {
  const idle = describeHome({
    fleetConfigured: false,
    sessions: readLocalSessions({ ok: true, total: 0, verified: true, entries: [] }),
    engine: readAgentEngine({ ok: true }),
    nowMs: NOW,
  })
  assert.equal(idle.mode, HOME_MODES.LOCAL_IDLE)
  assert.equal(idle.clock, null)

  const running = describeHome({
    fleetConfigured: false,
    sessions: readLocalSessions(historyReply(2)),
    engine: readAgentEngine({ ok: true }),
    nowMs: NOW,
  })
  assert.equal(running.mode, HOME_MODES.LOCAL)
  assert.equal(running.clock, NOW - minutes(1), 'the clock counts from the newest run on this computer')
})

/* ------------------------------------------------------------------
   4. An input that accepts nothing is never rendered.
   ------------------------------------------------------------------ */

test('the composer exists only where a message actually goes somewhere', () => {
  for (const { label, input } of ALL) {
    const view = describeHome(input)
    const canGoSomewhere = view.mode === HOME_MODES.SAMPLE || view.mode === HOME_MODES.FLEET
    assert.equal(view.composer, canGoSomewhere, `composer offered pointlessly with ${label}`)
  }
})

/* ------------------------------------------------------------------
   5. A sample is unmistakable; real data is never badged as one.
   ------------------------------------------------------------------ */

test('only a demonstration carries a badge, and a demonstration always does', () => {
  for (const { label, input } of ALL) {
    const view = describeHome(input)
    if (view.mode === HOME_MODES.SAMPLE) {
      assert.ok(view.panel.badge, `an example went unlabelled with ${label}`)
      assert.match(view.panel.badge, /example/i)
      assert.match(view.headline, /example/i, 'the hero says so too, not just the panel')
    } else {
      assert.equal(view.panel.badge, null, `real data was badged as an example with ${label}`)
      assert.doesNotMatch(view.headline || '', /example/i)
    }
  }
})

test('the demonstration is reached only by asking for it', () => {
  /* The old screen showed a header reading "sample transcript" beside a badge
     reading "live source" on a live screen, because the header came from
     profile data and the badge came from the mode. Nothing but the explicit
     choice may produce a sample now. */
  for (const { input } of ALL.filter(entry => entry.input.sample === false)) {
    assert.notEqual(describeHome(input).mode, HOME_MODES.SAMPLE)
  }
  for (const { input } of ALL.filter(entry => entry.input.sample === true)) {
    assert.equal(describeHome(input).mode, HOME_MODES.SAMPLE)
  }
})

/* ------------------------------------------------------------------
   6. The individual readers.
   ------------------------------------------------------------------ */

test('three outcomes are told apart: nothing ran, nothing readable, nobody to ask', () => {
  const noHost = readLocalSessions(undefined)
  assert.equal(noHost.supported, false)
  assert.equal(noHost.readable, false)

  const unreadable = readLocalSessions({ ok: false, code: 'SPAWN_RECORD_LEDGER_UNREADABLE' })
  assert.equal(unreadable.supported, true)
  assert.equal(unreadable.readable, false)

  const empty = readLocalSessions({ ok: true, total: 0, verified: true, entries: [] })
  assert.equal(empty.supported, true)
  assert.equal(empty.readable, true)
  assert.equal(empty.runs.length, 0)

  assert.notEqual(
    describeHome({ sessions: noHost, engine: readAgentEngine(undefined), nowMs: NOW }).headline,
    describeHome({ sessions: unreadable, engine: readAgentEngine({ ok: true }), nowMs: NOW }).headline,
    'a browser and a broken record must not read as the same thing',
  )
})

test('a malformed record line is dropped, not rendered as a run', () => {
  const mixed = readLocalSessions({
    ok: true,
    total: 3,
    verified: true,
    entries: [
      { sequence: 3, at: new Date(NOW).toISOString(), action: 'agent_session_start' },
      { sequence: 2, at: 'not a date', action: 'agent_session_start' },
      { at: new Date(NOW).toISOString(), action: 'agent_session_start' },
    ],
  })
  assert.equal(mixed.runs.length, 1)
  assert.equal(mixed.total, 3, 'the count of what exists is not reduced by what could not be parsed')
})

test('elapsed time is words, never a symbol standing in for a number', () => {
  assert.equal(whenWords(0), 'just now')
  assert.equal(whenWords(minutes(1)), 'a minute ago')
  assert.equal(whenWords(minutes(9)), '9 minutes ago')
  assert.equal(whenWords(minutes(60)), 'an hour ago')
  assert.equal(whenWords(minutes(60 * 5)), '5 hours ago')
  assert.equal(whenWords(minutes(60 * 24)), 'yesterday')
  assert.equal(whenWords(minutes(60 * 24 * 4)), '4 days ago')
  assert.equal(whenWords(null), null)
  assert.equal(whenWords(Number.NaN), null)
  assert.equal(whenWords(-1), null)
})

test('what the local record proves is stated exactly, and its failure is not hidden', () => {
  const intact = describeHome({
    fleetConfigured: false,
    sessions: readLocalSessions(historyReply(3, true)),
    engine: readAgentEngine({ ok: true }),
    nowMs: NOW,
  })
  assert.match(intact.panel.footer, /check out/i)

  const broken = describeHome({
    fleetConfigured: false,
    sessions: readLocalSessions(historyReply(3, false)),
    engine: readAgentEngine({ ok: true }),
    nowMs: NOW,
  })
  assert.match(broken.panel.footer, /no longer checks out/i)
  assert.notEqual(broken.panel.footer, intact.panel.footer)

  /* The runs are still shown when the chain does not verify. Hiding them would
     destroy the only evidence a person has that something ran. */
  assert.equal(broken.panel.empty, null)
})

/* ------------------------------------------------------------------
   7. The renderer actually consumes the decision.

   Without this, everything above could be true of a module the screen ignores.
   ------------------------------------------------------------------ */

const HOME_JS = readFileSync(new URL('../../src/views/home.js', import.meta.url), 'utf8')
const HOME_CSS = readFileSync(new URL('../../src/home.css', import.meta.url), 'utf8')
const FLEET_PROFILE_JS = readFileSync(new URL('../../src/fleet-profile.js', import.meta.url), 'utf8')

/* Comments carry the reasoning, including quotations of the old wording, so
   they must be excluded before scanning the code for that wording. */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

/* STATE THE LIMIT OF THIS ONE PLAINLY, because a reader will otherwise take it
 * for more than it is. It reads source text. It can see that the view asks for
 * the decision and reads the right fields off it; it CANNOT see that the values
 * reaching the screen are the ones the decision returned. A first mutation round
 * proved that exactly: replacing `const view = describeHome(state)` with a
 * spread that blanked `facts` and hardcoded the panel left this test green,
 * because every pattern it looks for was still in the file.
 *
 * The assertion below is therefore tightened to the shape that plant broke --
 * the assignment must be the bare call, with nothing wrapped around it -- and
 * the real end-to-end coverage lives in tools/home-screen-qa.cjs, which reads
 * the rendered DOM of the installed application and is what actually catches a
 * renderer that has stopped rendering the decision. */
test('the home view renders the decision rather than composing its own copy', () => {
  assert.match(HOME_JS, /from '\.\.\/local-activity\.js'/, 'the view imports the decision')
  assert.match(
    code(HOME_JS), /\n\s*const view = describeHome\(state\)\r?\n/,
    'the decision is taken whole; anything wrapped around the call is a place to quietly replace it',
  )
  assert.equal(
    (code(HOME_JS).match(/describeHome\(/g) || []).length, 1,
    'and it is called in exactly one place, so there is one seam rather than several',
  )
  assert.match(code(HOME_JS), /view\.facts\.map/, 'the facts under the ring come from the decision')
  assert.match(code(HOME_JS), /view\.panel\.title/, 'so does the panel title')
  assert.match(code(HOME_JS), /view\.composer/, 'and whether the composer exists at all')
})

test('the wording the owner objected to is gone from the code, not merely unused', () => {
  const banned = [
    /Read-only projection/i,
    /audited bridge/i,
    /coordinator thread unavailable/i,
    /Last Health Sweep/i,
    /source unavailable/i,
    /approvals waiting/i,
    /recording durable reply/i,
    /reading live projection/i,
    /No local agent fleet host detected/i,
    /already works on this one computer/i,
  ]
  for (const source of [code(HOME_JS), code(HOME_CSS), code(FLEET_PROFILE_JS)]) {
    for (const pattern of banned) assert.doesNotMatch(source, pattern)
  }
})

test('no placeholder character stands in for a value the home view does not have', () => {
  const body = code(HOME_JS)
  /* The pipe is excluded here and only here: in prose it is a README separator,
     but in source it is `||` and a key delimiter, so scanning code for it tests
     JavaScript rather than copy. It is still forbidden in the statements
     themselves, which is where a reader would meet it. */
  for (const [character, name] of README_PUNCTUATION.filter(([c]) => c !== '|')) {
    assert.ok(!body.includes(character), `${name} survives in the home view`)
  }
  assert.doesNotMatch(body, /const DASH/, 'the em-dash placeholder constant is gone')
})

test('the clock is hidden rather than dashed when there is nothing to count', () => {
  assert.match(code(HOME_JS), /digitsEl\.hidden = true/, 'the view hides the digits')
  assert.match(
    HOME_CSS,
    /\.uring-digits\[hidden\]\s*\{[^}]*display:\s*none/,
    'and the stylesheet makes hidden win against the flex display, or the digits stay visible',
  )
})

test('home suppresses the floating notice that produced the contradictory pair', () => {
  assert.match(
    HOME_CSS,
    /body\[data-route="home"\][^{]*\.fleet-profile-notice:not\(\.is-serious\)[^{]*\{[^}]*display:\s*none/,
    'the non-serious banner is hidden on home',
  )
  assert.doesNotMatch(
    HOME_CSS,
    /body\[data-route="home"\][^{]*\.fleet-profile-notice\s*\{/,
    'but a serious one is never hidden, so the rule must carry :not(.is-serious)',
  )
})
