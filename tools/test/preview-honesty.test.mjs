/* THE WEBSITE PREVIEW'S HONESTY CONTRACT, TESTED ABSENCE FIRST.
 *
 * Machine B's finding (PF4) is the thing being defended: a green "live"
 * indicator painted over seeded data, which makes fabricated activity look like
 * a real fleet. R1260 lane t5a re-measured it and reported honestly that it was
 * "materially improved, not cleared", and named the open half as their weakest
 * evidence: whether a live badge can still sit over fabricated numbers. This
 * file plus tools/preview-browser-drive.mjs close that half for the website
 * preview specifically, from two directions — the contracts here, the rendered
 * page there.
 *
 * WHY ABSENCE IS TESTED BEFORE PRESENCE, EVERY TIME. The recurring defect in
 * this codebase is absence read as consent: a missing field, an empty list, a
 * falsy check that turns NOTHING SPECIFIED into ALLOWED. So every required
 * field of a download declaration is tested twice — once MISSING and once
 * EMPTY — because those are two different ways to say nothing and a guard can
 * catch one and miss the other.
 *
 * The DOM-level property (a planted badge REFUSES THE RENDERED SURFACE) is not
 * asserted here, because asserting it against a DOM shim would prove something
 * about the shim. It is proven in a real browser by tools/preview-browser-drive.mjs
 * and the exit code is recorded in the lane verdict.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  DISCLOSURE,
  SIMULATED_STATES,
  PAID_GATED,
  LIVENESS_CLAIM,
  LIVENESS_MARKERS,
  assertUnpaid,
} from '../../public/preview/honesty.js'
import {
  DECLARED,
  checkDownloadDeclaration,
  probeTarget,
  resolveExits,
} from '../../public/preview/exits.js'
import {
  buildWorld,
  advance,
  seeded,
  PREVIEW_CAPABILITY_IDS,
  PREVIEW_CAPABILITIES,
} from '../../public/preview/sim-data.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = rel => readFileSync(path.join(REPO_ROOT, rel), 'utf8')

/* ------------------------------------------------------------------
   1. THERE IS NO LIVE VOCABULARY TO DRAW FROM
   ------------------------------------------------------------------ */

test('every state the preview can paint is prefixed simulated-', () => {
  const ids = Object.keys(SIMULATED_STATES)
  assert.ok(ids.length > 0, 'the state vocabulary must not be empty')
  for (const id of ids) {
    assert.match(id, /^simulated-/, `${id} is not marked as simulated`)
    assert.equal(SIMULATED_STATES[id].id, id)
    assert.match(SIMULATED_STATES[id].label, /^simulated · /, `${id}'s visible label must say simulated`)
  }
})

test('no state id or label can be mistaken for a real one', () => {
  for (const state of Object.values(SIMULATED_STATES)) {
    assert.equal(LIVENESS_CLAIM.test(state.label), false, `${state.id}'s label makes a liveness claim`)
  }
})

test('the liveness lexicon catches the claims and spares the innocents', () => {
  for (const claim of ['live', 'LIVE', 'Live now', 'real-time', 'realtime', 'real time', 'connected', 'online', 'actually running', 'right now']) {
    assert.equal(LIVENESS_CLAIM.test(claim), true, `"${claim}" must be caught`)
  }
  // Word boundaries matter: these must NOT trip it, or every honest sentence
  // in the preview becomes a violation and the guard gets switched off.
  for (const innocent of ['alive', 'delivered', 'Clive', 'olive', 'lively hood', 'connectedness of', 'onlineness']) {
    assert.equal(LIVENESS_CLAIM.test(innocent), false, `"${innocent}" must not be caught`)
  }
})

test('the marker list covers a badge with no words in it at all', () => {
  // Machine B's finding was an INDICATOR, not a sentence. A dot makes a claim.
  for (const needed of ['.live', '.live-dot', '.online', '[data-live]', '[data-status="live"]']) {
    assert.ok(LIVENESS_MARKERS.includes(needed), `${needed} must be a refused marker`)
  }
})

test('the disclosure carries all three required elements', () => {
  /* R-009 §2 (the legal clearance of this simulation) requires three
     elements, individually: simulated-in-browser, WHAT is simulated (the
     free local product — the sentence separating this from the hosted
     tier), and the timeline-compression note (measured: ~7.2 wall seconds
     per simulated minute). Dropping any one lapses the clearance. */
  assert.match(DISCLOSURE, /Nothing on this page is live/)
  assert.match(DISCLOSURE, /fixed seed/)
  assert.match(DISCLOSURE, /free local product/, 'element (b) gone: nothing separates the simulation from the hosted tier')
  assert.match(DISCLOSURE, /timeline compressed/, 'element (c) gone: the compressed clock goes unsaid')
})

/* ------------------------------------------------------------------
   2. NO PAID CAPABILITY IN THE PREVIEW — absence fails closed
   ------------------------------------------------------------------ */

test('the gated set is not empty, so the rule has something to refuse', () => {
  assert.ok(PAID_GATED.length > 0)
  assert.ok(PAID_GATED.includes('hosted-relay'), 'the engine\'s one gated capability must be mirrored here')
})

test('ABSENCE: a capability nobody declared is withheld and named', () => {
  const verdict = assertUnpaid('some-future-thing', PREVIEW_CAPABILITY_IDS)
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /not a declared preview capability/)
  assert.match(verdict.reason, /absence/i)
})

test('ABSENCE: an empty known-list withholds everything rather than allowing it', () => {
  for (const known of [[], null, undefined]) {
    const verdict = assertUnpaid('fleet-view', known)
    assert.equal(verdict.ok, false, `known=${JSON.stringify(known)} must withhold`)
  }
})

test('a paid capability is refused even if somebody adds it to the preview list', () => {
  const verdict = assertUnpaid('hosted-relay', [...PREVIEW_CAPABILITY_IDS, 'hosted-relay'])
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /paid capability/)
})

test('every capability the preview actually ships passes its own gate', () => {
  assert.ok(PREVIEW_CAPABILITIES.length >= 4, 'a preview of four things is not a preview of a product')
  for (const capability of PREVIEW_CAPABILITIES) {
    const verdict = assertUnpaid(capability.id, PREVIEW_CAPABILITY_IDS)
    assert.equal(verdict.ok, true, `${capability.id} is shipped but not allowed`)
    assert.equal(LIVENESS_CLAIM.test(capability.title), false, `${capability.id} title makes a liveness claim`)
    assert.equal(LIVENESS_CLAIM.test(capability.body), false, `${capability.id} body makes a liveness claim`)
  }
})

/* ------------------------------------------------------------------
   3. THE EXITS — declaration first, then verification
   ------------------------------------------------------------------ */

const COMPLETE_DECLARATION = Object.freeze({
  productName: 'ToolsEnabled',
  version: '1.0.6',
  buildRef: 'a'.repeat(40),
  sha256: 'b'.repeat(64),
  sizeBytes: 123456789,
  immutableLocation: 'https://example.invalid/artifacts/sha256-bbbb/ToolsEnabled-Setup.exe',
})

test('ABSENCE: no declaration means no download offer, with the reason in words', () => {
  const verdict = checkDownloadDeclaration(null)
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /No build has been declared/)
})

test('ABSENCE: undefined and a non-object are treated as absent, not as empty-but-fine', () => {
  assert.equal(checkDownloadDeclaration(undefined).ok, false)
  assert.equal(checkDownloadDeclaration('ToolsEnabled 1.0.6').ok, false)
  assert.equal(checkDownloadDeclaration([]).ok, false)
})

for (const field of ['productName', 'version', 'buildRef', 'sha256', 'sizeBytes', 'immutableLocation']) {
  test(`ABSENCE: REFUSES when required field "${field}" is MISSING`, () => {
    const declaration = { ...COMPLETE_DECLARATION }
    delete declaration[field]
    const verdict = checkDownloadDeclaration(declaration)
    assert.equal(verdict.ok, false)
    assert.match(verdict.reason, new RegExp(field))
  })

  test(`ABSENCE: REFUSES when required field "${field}" is EMPTY`, () => {
    // missing and empty are two different ways to say nothing, and a guard can
    // catch one and miss the other
    const declaration = { ...COMPLETE_DECLARATION, [field]: field === 'sizeBytes' ? 0 : '' }
    const verdict = checkDownloadDeclaration(declaration)
    assert.equal(verdict.ok, false)
  })

  test(`ABSENCE: REFUSES when required field "${field}" is NULL`, () => {
    const declaration = { ...COMPLETE_DECLARATION, [field]: null }
    assert.equal(checkDownloadDeclaration(declaration).ok, false)
  })
}

test('REFUSES an abbreviated commit id — it cannot identify a build', () => {
  const verdict = checkDownloadDeclaration({ ...COMPLETE_DECLARATION, buildRef: 'a1b2c3d' })
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /full 40-character/)
})

test('REFUSES a truncated checksum', () => {
  const verdict = checkDownloadDeclaration({ ...COMPLETE_DECLARATION, sha256: 'b'.repeat(40) })
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /full sha256/)
})

test('REFUSES a location inside a build directory', () => {
  // a build directory reuses one filename per build, so a hash quoted against
  // it expires on the next rebuild with no change to the name
  // The drive-rooted fixture deliberately does NOT spell the product name anywhere
  // after a drive letter. That shape is what tools/check-no-owner-data.mjs
  // recognises as a BUILDER'S CHECKOUT PATH, and an earlier version of this
  // fixture tripped it — a test fixture that fails the privacy guard is a file
  // somebody eventually excuses the guard for. The fixture still exercises the
  // rule it is here for: a location inside a build directory.
  for (const location of ['/dist/setup.exe', 'D:/somewhere/release/win-unpacked/setup.exe', './build/out.exe']) {
    const verdict = checkDownloadDeclaration({ ...COMPLETE_DECLARATION, immutableLocation: location })
    assert.equal(verdict.ok, false, `${location} must be refused`)
    assert.match(verdict.reason, /build directory/)
  }
})

test('REFUSES a size that is not a positive whole number of bytes', () => {
  for (const size of [-1, 1.5, Number.NaN, '9']) {
    assert.equal(checkDownloadDeclaration({ ...COMPLETE_DECLARATION, sizeBytes: size }).ok, false, `${String(size)} must be refused`)
  }
})

test('ACCEPTS a complete declaration — the guard is not merely always-no', () => {
  const verdict = checkDownloadDeclaration(COMPLETE_DECLARATION)
  assert.equal(verdict.ok, true)
  assert.equal(verdict.reason, null)
})

test('the shipped declaration is deliberately absent, because no candidate is declared', () => {
  // R1260 t5a measured this and Machine A's candidate folder says it in writing.
  // If a future lane declares one, this test is the place that notices.
  assert.equal(DECLARED.download, null)
})

test('ABSENCE: a subscription page that is not in the build is withheld, not linked', () => {
  const missing = async () => ({ ok: false, status: 404 })
  return resolveExits(DECLARED, { fetchImpl: missing }).then(exits => {
    assert.equal(exits.subscribe.ok, false)
    assert.match(exits.subscribe.reason, /not part of this build/)
    assert.equal(exits.download.ok, false)
  })
})

test('PRESENCE: a subscription surface that resolves is offered, at the declared route', async () => {
  const present = async () => ({ ok: true, status: 200 })
  const exits = await resolveExits(DECLARED, { fetchImpl: present })
  assert.equal(exits.subscribe.ok, true)
  assert.equal(exits.subscribe.href, DECLARED.subscribe.href)
})

test('THE PROBE IS THE STATIC ARTIFACT, NEVER THE HASH ROUTE', async () => {
  // R1268 W3 builds the subscription page as a route inside the app shell.
  // fetch() drops the fragment, so probing "/#/subscribe" requests "/", which
  // answers 200 on every deployment there has ever been -- the control would
  // light up whether or not the page shipped. A check that cannot fail is not a
  // check; this asserts the probe goes somewhere that CAN 404.
  const seen = []
  const record = async href => { seen.push(href); return { ok: false, status: 404 } }
  await resolveExits(DECLARED, { fetchImpl: record })
  assert.deepEqual(seen, [DECLARED.subscribe.probe])
  assert.equal(seen[0].includes('#'), false, 'the probe must not contain a fragment')
  assert.notEqual(seen[0], DECLARED.subscribe.href)
})

test('ABSENCE: a route declared with nothing static to check is withheld', async () => {
  // the degenerate declaration -- a hash route and no probe -- must fail closed
  const routeOnly = { download: null, subscribe: { href: '/#/subscribe', label: 'See the plans' } }
  const exits = await resolveExits(routeOnly, { fetchImpl: async () => ({ ok: true, status: 200 }) })
  assert.equal(exits.subscribe.ok, false)
  assert.match(exits.subscribe.reason, /nothing static to check/)
})

test('a static page declared without a probe is probed at its own path', async () => {
  const staticPage = { download: null, subscribe: { href: '/plans/', label: 'Plans' } }
  const seen = []
  await resolveExits(staticPage, { fetchImpl: async href => { seen.push(href); return { ok: true, status: 200 } } })
  assert.deepEqual(seen, ['/plans/'])
})

test('a network error probing the page is a refusal, never an assumption', async () => {
  const broken = async () => { throw new Error('boom') }
  const verdict = await probeTarget('/subscribe/', { fetchImpl: broken })
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /could not be reached/)
})

test('an empty href is absent, not a link to the site root', async () => {
  for (const href of ['', '   ', null, undefined, 42]) {
    const verdict = await probeTarget(href, { fetchImpl: async () => ({ ok: true }) })
    assert.equal(verdict.ok, false, `${JSON.stringify(href)} must be refused`)
  }
})

/* ------------------------------------------------------------------
   4. THE SIMULATION ITSELF
   ------------------------------------------------------------------ */

test('the world is deterministic — the same seed builds the same preview', () => {
  assert.deepEqual(buildWorld(20260811), buildWorld(20260811))
  // the SHAPE of the fleet is structural and does not move with the seed; the
  // contents do, so that is what a different seed must change
  assert.notDeepEqual(buildWorld(1).agents.map(a => a.task), buildWorld(999).agents.map(a => a.task))
})

test('the seeded generator stays inside [0,1) and does not repeat immediately', () => {
  const next = seeded(7)
  const values = Array.from({ length: 500 }, () => next())
  for (const value of values) assert.ok(value >= 0 && value < 1)
  assert.ok(new Set(values).size > 400, 'the generator must not be degenerate')
})

test('every agent state in the world is a simulated state', () => {
  let world = buildWorld()
  for (let tick = 0; tick < 40; tick += 1) {
    world = advance(world, tick)
    for (const agent of world.agents) {
      assert.ok(Object.hasOwn(SIMULATED_STATES, agent.state), `tick ${tick}: "${agent.state}" is not a simulated state`)
    }
  }
})

test('nothing the simulation produces makes a liveness claim', () => {
  let world = buildWorld()
  for (let tick = 0; tick < 30; tick += 1) world = advance(world, tick)
  const strings = []
  const collect = value => {
    if (typeof value === 'string') strings.push(value)
    else if (Array.isArray(value)) value.forEach(collect)
    else if (value && typeof value === 'object') Object.values(value).forEach(collect)
  }
  collect(world)
  assert.ok(strings.length > 50, 'the sweep must actually see the world')
  for (const value of strings) {
    assert.equal(LIVENESS_CLAIM.test(value), false, `simulated string "${value}" makes a liveness claim`)
  }
})

test('the simulated world contains no address, no path and no owner-shaped identifier', () => {
  const text = JSON.stringify(buildWorld())
  assert.equal(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(text), false, 'an IP address is in the preview world')
  assert.equal(/[A-Za-z]:\\\\/.test(text), false, 'a Windows path is in the preview world')
  assert.equal(/@[a-z0-9.-]+\.[a-z]{2,}/i.test(text), false, 'an email address is in the preview world')
})

/* ------------------------------------------------------------------
   5. THE PREVIEW MUST STILL LOOK LIKE THE PRODUCT
   ------------------------------------------------------------------ */

test('the copied role palette still matches the product\'s own', () => {
  // preview.css cannot import src/styles.css (public/ ships verbatim), so the
  // tokens are copied. A copy that is allowed to drift is a second product.
  const product = read('src/styles.css')
  const preview = read('public/preview/preview.css')
  for (const role of ['coordinator', 'helper', 'shadow', 'manager', 'default']) {
    const match = new RegExp(`--c-${role}:\\s*(#[0-9a-f]{6})`, 'i').exec(product)
    assert.ok(match, `src/styles.css no longer defines --c-${role}`)
    assert.ok(
      new RegExp(`--c-${role}:\\s*${match[1]}`, 'i').test(preview),
      `preview.css --c-${role} drifted from the product's ${match[1]}`,
    )
  }
})

test('the preview names the product by the name the product ships under', () => {
  const html = read('public/preview/index.html')
  assert.match(html, /ToolsEnabled/)
  assert.equal(/Mission Control/i.test(html), false, 'the pre-rename product name is in the preview')
})

/* ------------------------------------------------------------------
   6. THE STATIC GUARD MUST BE ABLE TO FAIL — mutation proof
   ------------------------------------------------------------------ */

function runGuard(root) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'check-preview-honesty.mjs'), root], { encoding: 'utf8' })
    return { code: 0, stdout }
  } catch (error) {
    return { code: error.status, stdout: String(error.stdout || '') }
  }
}

test('the static guard passes the real preview directory', () => {
  const result = runGuard(path.join(REPO_ROOT, 'public', 'preview'))
  assert.equal(result.code, 0, result.stdout)
})

test('the static guard REFUSES a planted liveness claim', async t => {
  const { mkdtempSync, cpSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(path.join(tmpdir(), 'preview-guard-'))
  try {
    cpSync(path.join(REPO_ROOT, 'public', 'preview'), dir, { recursive: true })
    const target = path.join(dir, 'surfaces.js')
    writeFileSync(target, `${readFileSync(target, 'utf8')}\nexport const BADGE = 'live'\n`)
    const result = runGuard(dir)
    assert.equal(result.code, 1, 'a planted liveness claim must fail the guard')
    assert.match(result.stdout, /asserts the simulated data is real/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the static guard REFUSES an empty scan rather than reporting it clean', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(path.join(tmpdir(), 'preview-empty-'))
  try {
    const result = runGuard(dir)
    assert.equal(result.code, 2, 'an empty directory is a setup problem, not a pass')
    assert.match(result.stdout, /not a clean scan/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the static guard REFUSES the preview if the runtime guard stops enforcing', async () => {
  const { mkdtempSync, cpSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(path.join(tmpdir(), 'preview-gutted-'))
  try {
    cpSync(path.join(REPO_ROOT, 'public', 'preview'), dir, { recursive: true })
    const target = path.join(dir, 'honesty.js')
    // the classic way a control dies: the file is still there, still imported,
    // and no longer defines what it was for
    writeFileSync(target, readFileSync(target, 'utf8').replaceAll('LIVENESS_MARKERS', 'UNUSED_MARKERS'))
    const result = runGuard(dir)
    assert.equal(result.code, 1)
    assert.match(result.stdout, /no longer defines/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the static guard REFUSES an egress the preview must not have', async () => {
  const { mkdtempSync, cpSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(path.join(tmpdir(), 'preview-egress-'))
  try {
    cpSync(path.join(REPO_ROOT, 'public', 'preview'), dir, { recursive: true })
    const target = path.join(dir, 'main.js')
    writeFileSync(target, `${readFileSync(target, 'utf8')}\nfetch('http://example.com/telemetry')\n`)
    const result = runGuard(dir)
    assert.equal(result.code, 1)
    assert.match(result.stdout, /absolute URL/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
