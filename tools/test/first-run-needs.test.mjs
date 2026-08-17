/* The copy that four screens now share, and the two ways it could quietly stop
 * being true.
 *
 * WHAT THIS FILE IS FOR, stated as the defect rather than the feature. The
 * unavailable-host state (LEGACY-ONB-001) was four screens each printing its own
 * bare refusal. The repair gives them one set of words and one door. That repair
 * has exactly two failure modes worth a test:
 *
 *   1. THE WORDS DRIFT BACK. A screen stops using the module and writes its own
 *      sentence again, or the module starts promising a remedy that does not
 *      exist. The first is caught by the packaged driver
 *      (tools/first-run-recovery-qa.mjs), which reads these values and looks for
 *      them on the glass. The second is caught here.
 *   2. THE ABSENCE CASE. `hostAbsentNotice()` is called with whatever the
 *      projection said, and a projection that failed without saying why hands it
 *      undefined, null or ''. This codebase's signature defect is a missing field
 *      read as a decision -- so an absent reason must remove the quoted line and
 *      NOTHING ELSE. A person whose read failed silently is the person who most
 *      needs the explanation and the door.
 *
 * Run: node --test tools/test/first-run-needs.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FIRST_RUN_NEEDS,
  GUIDE_ACTION,
  GUIDE_HREF,
  PROVIDER_SETUP,
  presenceSentence,
  SETTINGS_HREF,
  WORKS_HERE,
  hostAbsentMarkup,
  hostAbsentNotice,
} from '../../src/first-run-needs.js'

/* ------------------------------------------------------------------
   The absence case, first, because it is the one that has bitten nine times.
   ------------------------------------------------------------------ */

const NO_REASON = [
  ['undefined', undefined],
  ['null', null],
  ['an empty string', ''],
  ['whitespace only', '   '],
  ['a number', 42],
  ['an object', { reason: 'nope' }],
]

test('a missing reason removes the quoted line and nothing else', () => {
  const full = hostAbsentNotice('No local agent fleet host detected on this machine.')
  assert.equal(full.reason, 'No local agent fleet host detected on this machine.')

  for (const [label, value] of NO_REASON) {
    const notice = hostAbsentNotice(value)
    assert.equal(notice.reason, null, `${label} should produce no quoted line`)
    /* The three things that must survive it. */
    assert.equal(notice.title, full.title, `${label} lost the title`)
    assert.equal(notice.body, full.body, `${label} lost the explanation`)
    assert.deepEqual(notice.action, full.action, `${label} lost the door`)
  }
})

test('a reason is carried verbatim, trimmed but never softened', () => {
  const said = 'No local agent fleet host detected on this machine.'
  assert.equal(hostAbsentNotice(`  ${said}  `).reason, said)
  /* Not paraphrased, not shortened, not turned into an apology: this is the
     product's honest report of what it looked for. */
  assert.equal(hostAbsentNotice(said).reason, said)
})

test('the notice is frozen, so one screen cannot edit the words another screen shows', () => {
  const notice = hostAbsentNotice('anything')
  assert.ok(Object.isFrozen(notice))
  assert.throws(() => { notice.body = 'something else' }, TypeError)
})

/* ------------------------------------------------------------------
   The promise the guide may not make.
   ------------------------------------------------------------------ */

test('nothing in this copy promises a remedy for the host that does not exist', () => {
  const host = FIRST_RUN_NEEDS.find(need => need.id === 'host')
  assert.ok(host, 'the host section is the reason this module exists')
  /* MEASURED, not assumed: dist/data/*.json are build-time outputs packed into
     the read-only asar and no process on a customer machine writes them. So this
     section must be marked as one nobody can clear, and must not tell a person
     to connect, install or wait for anything. */
  assert.equal(host.fix, 'none')
  for (const forbidden of [
    /once (a|another) computer/i,
    /fills in on its own/i,
    /connect (a|another|your) computer/i,
    /install (an? )?agent host/i,
  ]) {
    assert.doesNotMatch(host.body, forbidden, `the host section promises a remedy: ${forbidden}`)
  }
  /* And it must say the flat thing, or a reader will keep looking. */
  assert.match(host.body, /no setting that connects one and no command that installs one/i)
})

test('a section anybody can clear says exactly how, and a section nobody can does not pretend', () => {
  for (const need of FIRST_RUN_NEEDS) {
    assert.ok(['self', 'none'].includes(need.fix), `${need.id} has an unrecognised fix kind`)
    assert.ok(need.steps.length > 0, `${need.id} offers no step at all`)
    for (const step of need.steps) {
      assert.ok(['command', 'switch'].includes(step.kind), `${need.id} has an unrecognised step kind`)
      assert.ok(step.text.length > 0, `${need.id} has an empty step`)
      assert.ok(step.note.length > 0, `${need.id} has a step with no context`)
      /* A step that sends a person to a screen must carry the way there. A
         switch step with no href is "in Settings" with no Settings, which is
         half an instruction and the exact shape of the dead end being repaired. */
      if (step.kind === 'switch') {
        assert.equal(step.href, SETTINGS_HREF, `${need.id} names a switch with no way to it`)
      }
    }
  }
})

test('the commands are the real ones, in the only order they can be followed', () => {
  const codex = FIRST_RUN_NEEDS.find(need => need.id === 'codex')
  const commands = codex.steps.filter(step => step.kind === 'command').map(step => step.text)
  /* `codex login` is a subcommand of the program the first line installs, so an
     order that put it first would be an instruction that cannot be carried out.
     shell/agent-host.cjs reports them in this order for the same reason. */
  assert.deepEqual(commands, ['winget install OpenAI.Codex', 'codex login'])
})

/* ------------------------------------------------------------------
   Shape, so a renderer cannot be handed something it will draw as blank.
   ------------------------------------------------------------------ */

test('every sentence a person will read is a non-empty string', () => {
  assert.ok(FIRST_RUN_NEEDS.length >= 3, 'the three things a bare machine is missing')
  assert.ok(WORKS_HERE.length > 0, 'a page of absences with nothing that works reads as a broken product')
  const strings = [
    ...FIRST_RUN_NEEDS.flatMap(need => [need.id, need.title, need.body]),
    ...WORKS_HERE,
    GUIDE_ACTION.label,
    hostAbsentNotice(null).title,
    hostAbsentNotice(null).body,
  ]
  for (const value of strings) {
    assert.equal(typeof value, 'string')
    assert.ok(value.trim().length > 0, `empty: ${JSON.stringify(value)}`)
  }
  assert.equal(new Set(FIRST_RUN_NEEDS.map(need => need.id)).size, FIRST_RUN_NEEDS.length)
})

test('every screen offers one door, at one address', () => {
  assert.equal(GUIDE_ACTION.href, GUIDE_HREF)
  assert.equal(hostAbsentNotice('x').action.href, GUIDE_HREF)
  assert.equal(hostAbsentNotice('x').action.label, GUIDE_ACTION.label)
  /* A hash route, because that is the only kind this router has and an http
     link here would open a browser instead of a screen. */
  assert.match(GUIDE_HREF, /^#\//)
  assert.match(SETTINGS_HREF, /^#\//)
})

/* ------------------------------------------------------------------
   The wiring. A copy module only helps if something asserts the screens use it.
   ------------------------------------------------------------------ */

test('the four screens read the shared copy rather than writing their own', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const path = await import('node:path')
  const here = path.dirname(fileURLToPath(import.meta.url))
  const root = path.resolve(here, '..', '..')
  const wired = [
    ['src/local-activity.js', /from '\.\/first-run-needs\.js'/],
    ['src/views/computers.js', /from '\.\.\/first-run-needs\.js'/],
    ['src/views/comms.js', /from '\.\.\/first-run-needs\.js'/],
    ['src/views/settings.js', /from '\.\.\/first-run-needs\.js'/],
    ['src/views/research.js', /from '\.\.\/first-run-needs\.js'/],
    ['src/views/ledger.js', /from '\.\.\/first-run-needs\.js'/],
    ['src/views/metrics.js', /from '\.\.\/first-run-needs\.js'/],
    ['src/views/guide.js', /from '\.\.\/first-run-needs\.js'/],
    /* And the route exists, or every link above is a link to nowhere. */
    ['src/main.js', /case 'guide': return guideView\(\)/],
  ]
  for (const [file, pattern] of wired) {
    const source = readFileSync(path.join(root, file), 'utf8')
    assert.match(source, pattern, `${file} does not use the shared copy`)
  }
})

/* ------------------------------------------------------------------
   The markup six screens draw, because a shared string is only shared if the
   thing that builds it is too.
   ------------------------------------------------------------------ */

test('the markup carries the whole notice and escapes what the projection said', () => {
  const html = hostAbsentMarkup('No local agent fleet host detected on this machine.')
  const notice = hostAbsentNotice('x')
  assert.ok(html.includes(notice.title))
  assert.ok(html.includes(notice.body))
  assert.ok(html.includes(`href="${GUIDE_HREF}"`))
  assert.ok(html.includes(notice.action.label))
  assert.ok(html.includes('No local agent fleet host detected on this machine.'))

  /* The reason is the ONLY untrusted string on this path -- it comes from a
     projection envelope, i.e. from a file on disk. A build that ever emitted a
     reason containing markup would otherwise put it into six screens. */
  const hostile = hostAbsentMarkup('<img src=x onerror="alert(1)">')
  assert.ok(!hostile.includes('<img'), hostile)
  assert.ok(hostile.includes('&lt;img'), hostile)
})

test('the markup survives a projection that failed without saying why', () => {
  for (const value of [undefined, null, '', '   ']) {
    const html = hostAbsentMarkup(value)
    assert.ok(html.includes(hostAbsentNotice('x').body), `explanation lost for ${JSON.stringify(value)}`)
    assert.ok(html.includes(GUIDE_HREF), `door lost for ${JSON.stringify(value)}`)
    assert.ok(!html.includes('host-absent-reason'), `an empty quoted line for ${JSON.stringify(value)}`)
  }
})

test('the alongside clause lands inside the refusal paragraph, not after it', () => {
  /* tools/agent-route-reachability.mjs asserts both are in the SAME visible
     element: separated, a person can read "no host reported" without reading
     "these are declared, not observed" and take a configured agent for a running
     one. Splitting them turned that suite red once already. */
  const html = hostAbsentMarkup('reason here.', { alongside: 'And this too.' })
  const paragraph = html.match(/<p class="host-absent-reason[^"]*">([^<]*)<\/p>/)
  assert.ok(paragraph, `no refusal paragraph in ${html}`)
  assert.equal(paragraph[1], 'reason here. And this too.')
})

test('a host page can keep a class an existing probe reads', () => {
  const html = hostAbsentMarkup('r', { reasonClass: 'graph-empty-reason' })
  assert.match(html, /class="host-absent-reason projection-unavailable graph-empty-reason"/)
  /* And omitting it adds no stray whitespace class. */
  assert.match(hostAbsentMarkup('r'), /class="host-absent-reason projection-unavailable"/)
})

/* ------------------------------------------------------------------
   The three assistant programs, and the two ways this list turns into a lie.

   1. IT PROMISES SOMETHING THAT CANNOT START. The rule the owner set is that a
      menu entry which cannot run is worse than no entry. Gemini is on this page
      on purpose -- a person comparing the three deserves an answer about the
      third -- and the entire safety of that decision is the word "none" and the
      sentence beside it. If a later lane flips `reach` without wiring anything,
      this page starts telling people to install a program it will not use.
   2. IT REPEATS THE HALF-TRUTH THE TIER MENU ALREADY TOLD. "Claude cannot start
      from a tree" was on the menu for a release with nowhere in the product
      saying where Claude DOES work, so a person read it as "Claude is not
      supported" and never found the agent page. Claude's entry must carry both
      halves or it reproduces that defect on the one screen meant to fix it.
   ------------------------------------------------------------------ */

const PROVIDERS = Object.fromEntries(PROVIDER_SETUP.map(provider => [provider.id, provider]))

test('all three assistant programs are named, and none is invented', () => {
  assert.deepEqual(PROVIDER_SETUP.map(provider => provider.id), ['codex', 'claude', 'gemini'])
  for (const provider of PROVIDER_SETUP) {
    assert.ok(provider.name.length > 0, `${provider.id} has no name a person could read`)
    assert.ok(provider.doesHere.length > 0, `${provider.id} does not say what it does here`)
    assert.ok(provider.steps.length > 0, `${provider.id} gives a person nothing to type`)
  }
})

test('reach is one of the three known values, and Gemini is not offered', () => {
  for (const provider of PROVIDER_SETUP) {
    assert.ok(
      ['tree', 'handover', 'none'].includes(provider.reach),
      `${provider.id} claims a reach this product has no rendering for`,
    )
  }
  assert.equal(PROVIDERS.codex.reach, 'tree')
  assert.equal(PROVIDERS.claude.reach, 'handover')

  /* THE ONE THAT GUARDS THE OWNER'S RULE. Nothing in this product starts Gemini
     -- there is no adapter at the engine seam and no lane row for it -- so this
     page may not imply otherwise. The day something can start it, this assertion
     is the thing that has to be changed deliberately, by somebody who has driven
     it. */
  assert.equal(
    PROVIDERS.gemini.reach,
    'none',
    'Gemini was marked as reachable: nothing in this copy starts it, so this page would be telling people to set up something it will not use',
  )
  assert.match(PROVIDERS.gemini.doesHere, /nothing in this copy starts gemini/i)
})

test('the Claude entry carries both halves, not only the refusal', () => {
  const said = PROVIDERS.claude.doesHere.toLowerCase()
  /* Where it DOES work. Measured on the installed build: handing work over on
     the agent page spawns the official claude program on the person's own
     sign-in. A page that omitted this would send somebody away from the one
     screen where the thing they want already happens. */
  assert.match(said, /agent page/)
  assert.match(said, /sign-in/)
  /* And where it does not, so the tier menu's refusal is explained rather than
     contradicted. */
  assert.match(said, /tree/)
})

test('every command is one that exists, and no sign-in command is invented', () => {
  const commands = PROVIDER_SETUP.flatMap(provider => provider.steps
    .filter(step => step.kind === 'command')
    .map(step => step.text))

  for (const command of commands) {
    assert.equal(command, command.trim(), `"${command}" carries stray spacing`)
    assert.ok(command.length > 0)
  }

  /* Read off each program's own help before it was written down, not
     remembered. The negative is the load-bearing one: gemini 0.53.0 has no
     sign-in subcommand at all, so a `gemini auth login` here would be a command
     a person cannot run, printed by the screen that exists to stop that. */
  assert.ok(commands.includes('claude auth login'))
  assert.ok(commands.includes('claude auth status'))
  assert.ok(commands.includes('codex login status'))
  for (const invented of ['gemini auth login', 'gemini auth status', 'gemini login']) {
    assert.ok(!commands.includes(invented), `"${invented}" is not a command gemini has`)
  }
})

test('the page never asks a person for a credential', () => {
  /* The product's promise is that it starts these programs and never handles
     their sign-ins. A step that asked for a key or a token would break it on the
     one screen where a person is most primed to hand one over. */
  const prose = PROVIDER_SETUP
    .flatMap(provider => [provider.doesHere, ...provider.steps.map(step => `${step.text} ${step.note || ''}`)])
    .join(' ')
    .toLowerCase()
  for (const ask of ['paste your', 'enter your key', 'api key here', 'copy your token']) {
    assert.ok(!prose.includes(ask), `the guide asks for a credential: "${ask}"`)
  }
})

/* ------------------------------------------------------------------
   The sentence beside each program's name, and the one way it turns cruel.

   The failure worth a test is not a wrong word, it is a CONFIDENT wrong word.
   Claude and Gemini can both authenticate in ways a file check cannot see, so
   "no sign-in file here" is not "you are signed out". A page that says the
   second sends somebody to re-run a command that already worked, and they
   conclude the product is broken. Every uncertain state must therefore read as
   uncertain, and must still point at the command that settles it.
   ------------------------------------------------------------------ */

test('a machine that is ready says so, and only when it really is', () => {
  assert.equal(presenceSentence({ installed: 'yes', signedIn: 'yes' }), 'Installed here, and signed in.')
  /* Every other combination must NOT claim a sign-in. */
  for (const signedIn of ['no', 'unknown']) {
    const said = presenceSentence({ installed: 'yes', signedIn })
    assert.ok(!/and signed in/.test(said), `"${said}" claims a sign-in it has not got`)
  }
})

test('uncertainty never reads as a verdict', () => {
  const unknownSignIn = presenceSentence({ installed: 'yes', signedIn: 'unknown' })
  /* It must not tell the person they are signed out... */
  assert.ok(!/nobody is signed in/.test(unknownSignIn), unknownSignIn)
  /* ...and it must still give them the way to find out. */
  assert.match(unknownSignIn, /command below/)

  const unknownInstall = presenceSentence({ installed: 'unknown', signedIn: 'unknown' })
  assert.match(unknownInstall, /could not tell/)
  assert.ok(!/not on this computer/i.test(unknownInstall), unknownInstall)
})

test('a missing program is stated plainly, because that one IS known', () => {
  assert.equal(presenceSentence({ installed: 'no', signedIn: 'no' }), 'Not on this computer yet.')
  /* The install answer does not depend on the sign-in answer: a machine with no
     program cannot have a meaningful sign-in state, and reporting one would be
     two claims where there is one fact. */
  for (const signedIn of ['yes', 'no', 'unknown']) {
    assert.equal(presenceSentence({ installed: 'no', signedIn }), 'Not on this computer yet.')
  }
})

test('an unreadable answer produces no sentence at all', () => {
  /* The page hides the slot on null. Saying nothing is correct here: a status
     line that appeared with an apology in it would be the product reporting its
     own plumbing to somebody who wanted to install Codex. */
  for (const value of [null, undefined, '', 42, 'yes', []]) {
    assert.equal(presenceSentence(value), null, `${JSON.stringify(value)} produced a sentence`)
  }
})
