/*
 * preview-browser-drive.mjs — R1268 lane W1
 *
 * Drives the BUILT website preview (dist/preview) in a real Chromium browser,
 * as a prospective buyer gets it: no Electron preload, no shell bridge, no node
 * integration, a fresh profile every run, and a plain static HTTP server in
 * front of the built files rather than a dev server.
 *
 * IT PROVES FOUR THINGS, AND EACH OF THEM IS A FAILURE IF IT CANNOT:
 *
 *   1. THE PREVIEW WORKS. All six surfaces render, at 1024 and at 1920. Every
 *      control is HIT-TESTED — document.elementFromPoint at the centre of its
 *      box must return the control itself or a descendant, because a non-zero
 *      bounding box is not a clickable target. The two flows that matter
 *      (choose an agent; answer a request and watch it reach the record) are
 *      driven with real mouse input, not by calling handlers.
 *
 *   2. IT IS NEVER LABELLED LIVE — MUTATION-PROVEN. A liveness badge is planted
 *      the way a careless future edit would plant one, from outside the page.
 *      The whole simulation must be replaced by a named refusal. Then the
 *      disclosure banner is deleted, and the same must happen. Then a clean
 *      reload must come back green, because a control that cannot recover is
 *      just a broken page.
 *
 *   3. THE EXITS ARE HONEST IN BOTH DIRECTIONS. With no declared build and no
 *      subscription page in the deployment, both controls must be DISABLED and
 *      carry a reason. With a subscription page served, the control must become
 *      a real anchor that hit-tests and navigates. With a complete build
 *      declaration served, the download control must become a real anchor.
 *
 *   4. IT LOADS FAST ENOUGH FOR A WEAK MACHINE. Total bytes over the wire,
 *      request count, and time from navigation to the first painted surface are
 *      measured and reported. Budgets are asserted, not admired.
 *
 * CONFIGURATION COMES FROM THE ENVIRONMENT, NOT ARGV. Passing a bare URL as an
 * Electron argv makes the binary exit -1 before main runs, with no stdout and no
 * stderr (measured by R1260 lane t5a). A harness that took the URL positionally
 * would read as a silent pass to any caller watching stdout.
 *
 *   PREVIEW_DIST      directory to serve            default: <repo>/dist
 *   PREVIEW_OUT_DIR   where screenshots/report go   default: <repo>/artifacts/preview-drive
 *
 * Exit: 0 every assertion held. 1 an assertion failed, or the drive measured
 * nothing (vacuity is a failure, never a pass).
 */
import { app, BrowserWindow } from 'electron'
import { createServer } from 'node:http'
import { createReadStream, mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = process.env.PREVIEW_DIST || join(REPO_ROOT, 'dist')
const OUT = process.env.PREVIEW_OUT_DIR || join(REPO_ROOT, 'artifacts', 'preview-drive')

const LOG = []
const say = line => { LOG.push(String(line)); console.log(String(line)) }
const results = []
let assertions = 0

function check(name, ok, detail = '') {
  assertions += 1
  results.push({ name, ok: Boolean(ok), detail })
  say(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function flush(code) {
  try {
    mkdirSync(OUT, { recursive: true })
    writeFileSync(join(OUT, 'drive.log'), `${LOG.join('\n')}\n`)
    writeFileSync(join(OUT, 'drive.json'), `${JSON.stringify({ assertions, results }, null, 2)}\n`)
  } catch { /* last resort */ }
  // process.exit, not app.exit: MEASURED — app.exit(1) after the app had already
  // begun quitting on its own produced exit code 0 while four assertions were
  // failing. A harness that reports success while failing is worse than none.
  process.exit(code)
}

// Destroying a window drops the window count to zero, which quits the app by
// default; the NEXT viewport's navigation then failed with ERR_FAILED against a
// tearing-down browser process. The drive owns its own lifetime.
app.on('window-all-closed', () => {})

process.on('uncaughtException', error => {
  say(`UNCAUGHT: ${error && error.stack || error}`)
  flush(1)
})

/* A HANG MUST NEVER READ AS A PASS. A run of this harness wedged inside
 * loadURL() after the theme pass and sat there until the caller's timeout --
 * at which point there was no exit code at all, only silence and a green log
 * of everything before it. A timeout is a continuation, never success, so the
 * watchdog exits 1 and the breadcrumb says where it stopped. */
let phase = 'startup'
const breadcrumb = label => { phase = label; say(`--- ${label}`) }
const WATCHDOG_MS = Number(process.env.PREVIEW_WATCHDOG_MS || 240000)
setTimeout(() => {
  say(`WATCHDOG: the drive made no progress for ${WATCHDOG_MS}ms and was stopped during "${phase}". A hang is a failure.`)
  flush(1)
}, WATCHDOG_MS)

/** Any await that touches the browser gets a bound, so a wedge is reported
 *  rather than waited on forever. */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${label}`)), ms)),
  ])
}

/* ------------------------------------------------------------------ *
 * a plain static server — no dev server, no framework, and bound to the
 * loopback interface by NAME so it answers on the family the browser dials
 * (vite preview binds IPv6-only here; R1260 t5a recorded it as W7)
 * ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png',
}

const serverState = {
  /** when set, /preview/exits.js is served with this declaration patched in */
  downloadDeclaration: null,
  /** when true, the subscription catalogue W3 ships resolves */
  subscribePresent: false,
  bytes: 0,
  requests: 0,
}

function makeServer() {
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    let pathname = decodeURIComponent(url.pathname)
    if (pathname.endsWith('/')) pathname += 'index.html'

    /* The artifact the preview probes to decide whether the subscription surface
     * shipped. It is R1268 W3's, it is not in this tree, and that is the point:
     * ABSENT is the state on a build without their work, PRESENT is the state on
     * a build with it, and both are driven below. */
    if (pathname === '/data/subscription-catalog.json') {
      if (!serverState.subscribePresent) { res.writeHead(404); res.end('not here'); return }
      const body = '{"schemaVersion":1,"plans":[]}'
      serverState.requests += 1; serverState.bytes += Buffer.byteLength(body)
      res.writeHead(200, { 'content-type': MIME['.json'] }); res.end(body); return
    }

    const target = normalize(join(DIST, pathname))
    if (!target.startsWith(DIST + sep) && target !== DIST) { res.writeHead(403); res.end('no'); return }
    if (!existsSync(target) || !statSync(target).isFile()) { res.writeHead(404); res.end('not found'); return }

    if (pathname === '/preview/exits.js' && serverState.downloadDeclaration) {
      // MUTATION, deliberately: swap the null declaration for a complete one so
      // the offered branch can be driven in a real browser rather than asserted.
      const source = readFileSync(target, 'utf8')
        .replace('download: null,', `download: ${JSON.stringify(serverState.downloadDeclaration)},`)
      serverState.requests += 1; serverState.bytes += Buffer.byteLength(source)
      res.writeHead(200, { 'content-type': MIME['.js'] }); res.end(source); return
    }

    const size = statSync(target).size
    serverState.requests += 1; serverState.bytes += size
    res.writeHead(200, { 'content-type': MIME[extname(target)] || 'application/octet-stream' })
    createReadStream(target).pipe(res)
  })
}

/* ------------------------------------------------------------------ *
 * page helpers
 * ------------------------------------------------------------------ */

const js = (win, code) => win.webContents.executeJavaScript(code, true)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

/* "Wait for the page to be there" is POLLED FOR THE THING THAT MATTERS, not
 * awaited on requestAnimationFrame. rAF stops firing whenever the compositor
 * decides the window is not worth painting -- occluded behind another window, a
 * desktop switch, a lock screen -- and a run of this harness died exactly there:
 * `timed out after 15000ms: first paint` on a page that had in fact loaded
 * perfectly. Polling for the mounted surface (or its refusal) asks the question
 * the drive actually cares about and does not depend on the compositor at all.
 * The timeout still FAILS rather than continuing, because a page that never
 * mounts is a defect, not a slow frame. */
async function load(win, url) {
  const started = Date.now()
  await withTimeout(win.loadURL(url), 20000, `loadURL ${url}`)
  const deadline = Date.now() + 15000
  for (;;) {
    const ready = await js(win, `(() => document.readyState === 'complete'
      && Boolean(document.querySelector('.sim-surface, .sim-refusal')))()`)
    if (ready) break
    if (Date.now() > deadline) throw new Error(`the preview never mounted at ${url} within 15000ms`)
    await wait(50)
  }
  return Date.now() - started
}

/** Real mouse input at a point, not a synthesised DOM event. */
async function clickAt(win, x, y) {
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  await wait(140)
}

/** Capture, and read one pixel back out of the captured image. A screenshot
 *  that does not match the page it claims to show is worthless as evidence, so
 *  the caller asserts the pixel rather than trusting the file. */
async function capture(win, file) {
  /* capturePage() goes through Chromium's viz compositor, which on this machine
   * has twice thrown UnknownVizError mid-run and taken the whole drive down with
   * it -- losing 140 good assertions to one flaky screenshot. It is retried, and
   * a capture that still will not happen is reported as a FAILED assertion by
   * the caller rather than as an exception, because a missing screenshot is
   * evidence missing, not evidence of a broken product. */
  let image = null
  let lastError = null
  for (let attempt = 0; attempt < 3 && !image; attempt += 1) {
    try { image = await withTimeout(win.webContents.capturePage(), 10000, 'capturePage') } catch (error) {
      lastError = error
      await wait(350)
    }
  }
  if (!image) {
    check(`capture of ${file.split(/[\\/]/).pop()}`, false, `capturePage failed three times: ${lastError && lastError.message}`)
    return { size: { width: 0, height: 0 }, pixel: null }
  }
  writeFileSync(file, image.toPNG())
  const size = image.getSize()
  const bitmap = typeof image.toBitmap === 'function' ? image.toBitmap() : image.getBitmap() // BGRA
  const at = (x, y) => {
    const i = ((y * size.width) + x) * 4
    return [bitmap[i + 2], bitmap[i + 1], bitmap[i]]
  }
  return { size, pixel: at(8, 8) }
}

const near = (rgb, target, tolerance = 6) =>
  Array.isArray(rgb) && rgb.every((v, i) => Math.abs(v - target[i]) <= tolerance)

/** Centre of a selector's box, plus what elementFromPoint actually returns there.
 *  The element is scrolled into view first: a control below the fold is still a
 *  real target, and elementFromPoint reads VIEWPORT coordinates, so not scrolling
 *  would report every below-the-fold control as unreachable. */
const HIT_TEST = selector => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return { found: false }
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return { found: true, box: [r.width, r.height], hit: false, why: 'zero box' }
  const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2)
  if (y < 0 || y > innerHeight || x < 0 || x > innerWidth) return { found: true, box: [r.width, r.height], hit: false, why: 'offscreen' }
  const at = document.elementFromPoint(x, y)
  const hit = Boolean(at && (at === el || el.contains(at)))
  return { found: true, box: [Math.round(r.width), Math.round(r.height)], x, y, hit,
           why: hit ? '' : 'covered by ' + (at ? (at.tagName + '.' + at.className) : 'nothing') }
})()`

async function hitTest(win, selector) {
  const result = await js(win, HIT_TEST(selector))
  await wait(60) // let the scroll settle before any click uses these coordinates
  return result
}

const SURFACE_STATE = `(() => {
  const surface = document.querySelector('.sim-surface')
  const refusal = document.querySelector('.sim-refusal')
  const banner = document.querySelector('[data-sim-disclosure="1"]')
  return {
    surface: Boolean(surface),
    refusal: Boolean(refusal),
    refusalText: refusal ? refusal.textContent.slice(0, 260) : null,
    banner: banner ? banner.textContent : null,
    marked: surface ? surface.getAttribute('data-simulated') : null,
    simValues: document.querySelectorAll('[data-sim="1"]').length,
    stateChips: document.querySelectorAll('.sim-state').length,
    livenessMarkers: document.querySelectorAll('.live, .is-live, .live-dot, .online, [data-live], [data-status="live"]').length,
    tabs: Array.from(document.querySelectorAll('.pv-tab')).map(t => t.dataset.tab),
    audit: window.__preview ? window.__preview.audit() : null,
    preview: window.__preview ? window.__preview.state() : null,
  }
})()`

const DISCLOSURE_TEXT =
  'Simulated preview. Nothing on this page is live, nothing is running on any computer, '
  + 'and every value below was generated in your browser from a fixed seed.'

/* ------------------------------------------------------------------ *
 * the drive
 * ------------------------------------------------------------------ */

const VIEWPORTS = [
  { label: '1024', width: 1024, height: 768 },
  { label: '1920', width: 1920, height: 1080 },
]

async function drive() {
  mkdirSync(OUT, { recursive: true })
  if (!existsSync(join(DIST, 'preview', 'index.html'))) {
    say(`SETUP: ${join(DIST, 'preview', 'index.html')} is missing — run the build first.`)
    flush(1); return
  }

  const server = makeServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`
  say(`serving ${DIST} at ${base}`)

  for (const viewport of VIEWPORTS) {
    /* THE WINDOW IS SHOWN, AND THAT IS A CORRECTION, NOT A PREFERENCE.
     * With show:false, capturePage() returned the LAST PAINTED FRAME rather
     * than the current one: a hidden window does not repaint. The first pass of
     * this harness therefore wrote a file called preview-1024-theme-tan.png that
     * showed the WHITE theme, while the assertion beside it correctly read
     * rgb(242,229,188) off the DOM. Green assertions, lying evidence -- the same
     * defect class as a live badge over seeded data, in the proof instead of in
     * the product. Every capture is now pixel-checked against the DOM below. */
    const win = new BrowserWindow({
      width: viewport.width, height: viewport.height, show: true,
      webPreferences: {
        preload: undefined, nodeIntegration: false, contextIsolation: true,
        sandbox: true, backgroundThrottling: false,
        partition: `preview-drive-${viewport.label}-${Date.now()}`,
      },
    })
    win.setContentSize(viewport.width, viewport.height)
    await new Promise(resolve => (win.isVisible() ? resolve() : win.once('show', resolve)))

    serverState.bytes = 0; serverState.requests = 0
    serverState.subscribePresent = false; serverState.downloadDeclaration = null

    breadcrumb(`${viewport.label}: first load`)
    const ms = await load(win, `${base}/preview/`)
    const state = await js(win, SURFACE_STATE)

    check(`${viewport.label}: the simulated surface mounts`, state.surface === true)
    check(`${viewport.label}: the surface carries data-simulated="true"`, state.marked === 'true', `marked=${state.marked}`)
    check(`${viewport.label}: the disclosure is present and unaltered`,
      state.banner && state.banner.replace(/\s+/g, ' ').trim() === DISCLOSURE_TEXT.replace(/\s+/g, ' ').trim(),
      state.banner ? `${state.banner.slice(0, 60)}…` : 'absent')
    check(`${viewport.label}: the page's own audit passes`, state.audit && state.audit.ok === true,
      JSON.stringify(state.audit && state.audit.violations || []))
    check(`${viewport.label}: no liveness marker anywhere in the page`, state.livenessMarkers === 0, `found ${state.livenessMarkers}`)
    // The landing tab is Overview, which is AUTHORED product copy and carries no
    // simulated data at all -- 0 marked values there is correct, and asserting
    // otherwise would push invented numbers onto a page that has no business
    // having them. The five data-bearing surfaces are asserted below, per tab.
    check(`${viewport.label}: the overview carries no simulated data at all`, state.simValues === 0, `${state.simValues} marked values`)
    check(`${viewport.label}: six surfaces are offered`, state.tabs.length === 6, state.tabs.join(','))

    // performance — the owner's weak-PC directive, measured not assumed
    const timing = await js(win, `(() => { const n = performance.getEntriesByType('navigation')[0] || {};
      return { dcl: Math.round(n.domContentLoadedEventEnd || 0), load: Math.round(n.loadEventEnd || 0),
               resources: performance.getEntriesByType('resource').length } })()`)
    say(`${viewport.label}: navigation ${ms}ms · DOMContentLoaded ${timing.dcl}ms · ${serverState.requests} requests · ${serverState.bytes} bytes`)
    check(`${viewport.label}: the whole preview is under 200 KB over the wire`, serverState.bytes < 200 * 1024, `${serverState.bytes} bytes`)
    check(`${viewport.label}: the preview needs fewer than 15 requests`, serverState.requests < 15, `${serverState.requests} requests`)
    check(`${viewport.label}: navigation to painted surface under 2000ms`, ms < 2000, `${ms}ms`)

    // every tab, clicked with real mouse input, hit-tested first
    for (const tab of state.tabs) {
      const hit = await hitTest(win, `.pv-tab[data-tab="${tab}"]`)
      check(`${viewport.label}: tab "${tab}" is a real hit target`, hit.hit === true, `${JSON.stringify(hit)}`)
      if (hit.hit) await clickAt(win, hit.x, hit.y)
      const after = await js(win, SURFACE_STATE)
      check(`${viewport.label}: tab "${tab}" renders without a refusal`, after.surface && !after.refusal)
      check(`${viewport.label}: tab "${tab}" still passes its own audit`, after.audit && after.audit.ok === true,
        JSON.stringify(after.audit && after.audit.violations || []))
      if (tab === 'overview') {
        check(`${viewport.label}: tab "overview" is authored copy, not simulated data`, after.simValues === 0, `${after.simValues}`)
      } else {
        check(`${viewport.label}: tab "${tab}" shows marked simulated data`, after.simValues > 3, `${after.simValues}`)
        check(`${viewport.label}: tab "${tab}" leaves no unmarked text in a data region`,
          after.audit && after.audit.ok === true)
      }
      await capture(win, join(OUT, `preview-${viewport.label}-${tab}.png`))
    }

    breadcrumb(`${viewport.label}: flow 1`)
    // FLOW 1 — choose an agent from the tree and land on its page
    await js(win, `window.__preview.goTo('fleet')`)
    await wait(120)
    const node = await hitTest(win, '.pv-node[data-agent]')
    check(`${viewport.label}: an agent node is a real hit target`, node.hit === true, JSON.stringify(node))
    if (node.hit) await clickAt(win, node.x, node.y)
    const afterSelect = await js(win, `(() => ({ tab: window.__preview.state().tab,
      name: (document.querySelector('.pv-agent-name [data-sim="1"], .pv-agent-name') || {}).textContent || null }))()`)
    check(`${viewport.label}: choosing an agent opens the agent surface`, afterSelect.tab === 'agent', JSON.stringify(afterSelect))
    check(`${viewport.label}: the opened agent has a name`, Boolean(afterSelect.name && afterSelect.name.trim()), String(afterSelect.name))

    breadcrumb(`${viewport.label}: flow 2`)
    // FLOW 2 — answer a request and watch it reach the record
    await js(win, `window.__preview.goTo('approvals')`)
    await wait(120)
    const approve = await hitTest(win, '.pv-request .pv-ctl-yes')
    check(`${viewport.label}: Approve is a real hit target`, approve.hit === true, JSON.stringify(approve))
    if (approve.hit) await clickAt(win, approve.x, approve.y)
    const outcome = await js(win, `(() => ({
      outcomes: document.querySelectorAll('.pv-request-outcome').length,
      text: (document.querySelector('.pv-request-outcome') || {}).textContent || null }))()`)
    check(`${viewport.label}: answering a request records an outcome`, outcome.outcomes >= 1, JSON.stringify(outcome))
    await js(win, `window.__preview.goTo('record')`)
    await wait(120)
    const record = await js(win, `(() => { const items = Array.from(document.querySelectorAll('.pv-ledger-item'))
      return { count: items.length, first: items[0] ? items[0].textContent : null } })()`)
    check(`${viewport.label}: the answer appears in the record`, record.count >= 4 && /Approved/.test(String(record.first)),
      JSON.stringify(record))
    const auditAfterFlows = await js(win, `window.__preview.audit()`)
    check(`${viewport.label}: the surface still passes its audit after both flows`, auditAfterFlows.ok === true,
      JSON.stringify(auditAfterFlows.violations || []))

    breadcrumb(`${viewport.label}: themes`)
    // themes, so the screenshots cover what a visitor can actually pick
    for (const theme of ['tan', 'black']) {
      const hit = await hitTest(win, `.pv-theme button[data-theme="${theme}"]`)
      check(`${viewport.label}: the "${theme}" theme control is a real hit target`, hit.hit === true, JSON.stringify(hit))
      if (hit.hit) await clickAt(win, hit.x, hit.y)
      await wait(160)
      // A screenshot named "theme-tan" that shows the white theme is a lie in the
      // evidence, which is the same failure this whole lane is about. Assert the
      // paint actually changed rather than trusting the click.
      const applied = await js(win, `({ attr: document.documentElement.dataset.theme,
        bg: getComputedStyle(document.body).backgroundColor })`)
      check(`${viewport.label}: the "${theme}" theme is actually applied`, applied.attr === theme, JSON.stringify(applied))
      const shot = await capture(win, join(OUT, `preview-${viewport.label}-theme-${theme}.png`))
      const expected = theme === 'tan' ? [242, 229, 188] : [13, 15, 18]
      check(`${viewport.label}: the "${theme}" SCREENSHOT shows the "${theme}" theme`,
        near(shot.pixel, expected), `captured pixel ${JSON.stringify(shot.pixel)} expected ~${JSON.stringify(expected)}`)
    }
    const backToWhite = await hitTest(win, '.pv-theme button[data-theme="white"]')
    if (backToWhite.hit) await clickAt(win, backToWhite.x, backToWhite.y)

    /* -------------------------------------------------------------- *
     * MUTATION PROOF 1 — plant a liveness badge from outside the page
     * -------------------------------------------------------------- */
    breadcrumb(`${viewport.label}: mutation 1 (liveness badge)`)
    await load(win, `${base}/preview/`)
    const planted = await js(win, `(() => {
      const region = document.querySelector('.sim-body')
      if (!region) return false
      const badge = document.createElement('span')
      badge.className = 'live-dot'
      badge.textContent = 'LIVE'
      region.appendChild(badge)
      return true })()`)
    check(`${viewport.label}: the liveness badge was actually planted`, planted === true)
    await wait(220)
    const refusedByBadge = await js(win, SURFACE_STATE)
    check(`${viewport.label}: MUTATION — a planted liveness badge REFUSES the whole surface`,
      refusedByBadge.refusal === true && refusedByBadge.surface === false,
      `surface=${refusedByBadge.surface} refusal=${refusedByBadge.refusal}`)
    check(`${viewport.label}: MUTATION — the refusal names the defect`,
      /liveness/i.test(String(refusedByBadge.refusalText)), String(refusedByBadge.refusalText).slice(0, 120))
    check(`${viewport.label}: MUTATION — the refusal is terminal, the clock stopped`,
      refusedByBadge.preview && refusedByBadge.preview.refused === true, JSON.stringify(refusedByBadge.preview))
    await capture(win, join(OUT, `preview-${viewport.label}-refusal-badge.png`))
    await wait(2600) // longer than one clock tick: the refusal must not be repainted away
    const stillRefused = await js(win, SURFACE_STATE)
    check(`${viewport.label}: MUTATION — the refusal survives a clock tick`,
      stillRefused.refusal === true && stillRefused.surface === false)

    /* -------------------------------------------------------------- *
     * MUTATION PROOF 2 — delete the disclosure
     * -------------------------------------------------------------- */
    breadcrumb(`${viewport.label}: mutation 2 (disclosure removal)`)
    await load(win, `${base}/preview/`)
    const removed = await js(win, `(() => { const b = document.querySelector('[data-sim-disclosure="1"]'); if (!b) return false; b.remove(); return true })()`)
    check(`${viewport.label}: the disclosure was actually removed`, removed === true)
    await wait(220)
    const refusedByRemoval = await js(win, SURFACE_STATE)
    check(`${viewport.label}: MUTATION — deleting the disclosure REFUSES the surface`,
      refusedByRemoval.refusal === true && refusedByRemoval.surface === false,
      `surface=${refusedByRemoval.surface} refusal=${refusedByRemoval.refusal}`)
    check(`${viewport.label}: MUTATION — that refusal names the missing disclosure`,
      /disclosure/i.test(String(refusedByRemoval.refusalText)), String(refusedByRemoval.refusalText).slice(0, 120))

    breadcrumb(`${viewport.label}: restore + exits`)
    /* RESTORE — a control that cannot recover is just a broken page */
    await load(win, `${base}/preview/`)
    const restored = await js(win, SURFACE_STATE)
    check(`${viewport.label}: a clean reload renders green again`,
      restored.surface === true && restored.refusal === false && restored.audit.ok === true)

    /* -------------------------------------------------------------- *
     * THE EXITS — absence first, then presence
     * -------------------------------------------------------------- */
    await wait(300)
    const exitsAbsent = await js(win, `(() => {
      const read = kind => { const el = document.querySelector('.exit[data-exit="' + kind + '"]'); if (!el) return null
        const btn = el.querySelector('.exit-btn')
        const style = getComputedStyle(btn)
        return { state: el.dataset.exitState, tag: btn.tagName,
                 disabled: el.querySelector('button') ? el.querySelector('button').disabled : null,
                 paint: style.backgroundColor + '|' + style.color + '|' + style.cursor,
                 why: (el.querySelector('.exit-why') || {}).textContent || null } }
      return { download: read('download'), subscribe: read('subscribe') } })()`)
    check(`${viewport.label}: ABSENCE — no declared build means the download is withheld`,
      exitsAbsent.download && exitsAbsent.download.state === 'withheld' && exitsAbsent.download.disabled === true,
      JSON.stringify(exitsAbsent.download))
    check(`${viewport.label}: ABSENCE — the withheld download names its reason`,
      /No build has been declared/.test(String(exitsAbsent.download && exitsAbsent.download.why)),
      String(exitsAbsent.download && exitsAbsent.download.why))
    check(`${viewport.label}: ABSENCE — a subscription page not in the build is withheld, not linked`,
      exitsAbsent.subscribe && exitsAbsent.subscribe.state === 'withheld' && exitsAbsent.subscribe.disabled === true,
      JSON.stringify(exitsAbsent.subscribe))
    check(`${viewport.label}: ABSENCE — the withheld subscription names its reason`,
      /not part of this build/.test(String(exitsAbsent.subscribe && exitsAbsent.subscribe.why)),
      String(exitsAbsent.subscribe && exitsAbsent.subscribe.why))
    await capture(win, join(OUT, `preview-${viewport.label}-exits-absent.png`))

    // presence: serve the subscription page and a complete build declaration
    serverState.subscribePresent = true
    serverState.downloadDeclaration = {
      productName: 'ToolsEnabled', version: '1.0.6',
      buildRef: '0'.repeat(40), sha256: 'f'.repeat(64), sizeBytes: 104857600,
      immutableLocation: '/artifacts/sha256-ffff/ToolsEnabled-Setup-1.0.6.exe',
    }
    await load(win, `${base}/preview/`)
    await wait(300)
    const exitsPresent = await js(win, `(() => {
      const read = kind => { const el = document.querySelector('.exit[data-exit="' + kind + '"]'); if (!el) return null
        const a = el.querySelector('a.exit-btn')
        const style = a ? getComputedStyle(a) : null
        return { state: el.dataset.exitState, isAnchor: Boolean(a), href: a ? a.getAttribute('href') : null,
                 label: a ? a.textContent : null,
                 paint: style ? style.backgroundColor + '|' + style.color + '|' + style.cursor : null } }
      return { download: read('download'), subscribe: read('subscribe') } })()`)
    check(`${viewport.label}: PRESENCE — a served subscription page becomes a real link`,
      exitsPresent.subscribe && exitsPresent.subscribe.state === 'offered'
        && exitsPresent.subscribe.isAnchor === true && exitsPresent.subscribe.href === '/#/subscribe',
      JSON.stringify(exitsPresent.subscribe))
    check(`${viewport.label}: PRESENCE — a complete build declaration becomes a real download link`,
      exitsPresent.download && exitsPresent.download.state === 'offered' && exitsPresent.download.isAnchor === true
        && exitsPresent.download.href === '/artifacts/sha256-ffff/ToolsEnabled-Setup-1.0.6.exe',
      JSON.stringify(exitsPresent.download))
    // A control that LOOKS offered and is not is the same defect class as data
    // that looks live and is not, so the two states must be visibly different
    // paint, not merely different markup. This assertion exists because the
    // first build failed it: a CSS variant bound to .exit-btn out-specified
    // :disabled and painted the withheld subscription in the offered colours.
    for (const kind of ['download', 'subscribe']) {
      check(`${viewport.label}: withheld and offered "${kind}" are painted differently`,
        exitsAbsent[kind] && exitsPresent[kind] && exitsAbsent[kind].paint !== exitsPresent[kind].paint,
        `withheld=${exitsAbsent[kind] && exitsAbsent[kind].paint} offered=${exitsPresent[kind] && exitsPresent[kind].paint}`)
      check(`${viewport.label}: the withheld "${kind}" control refuses the pointer`,
        String(exitsAbsent[kind] && exitsAbsent[kind].paint).endsWith('|not-allowed'),
        String(exitsAbsent[kind] && exitsAbsent[kind].paint))
    }

    const subHit = await hitTest(win, '.exit[data-exit="subscribe"] a.exit-btn')
    check(`${viewport.label}: PRESENCE — the subscription link is a real hit target`, subHit.hit === true, JSON.stringify(subHit))
    const dlHit = await hitTest(win, '.exit[data-exit="download"] a.exit-btn')
    check(`${viewport.label}: PRESENCE — the download link is a real hit target`, dlHit.hit === true, JSON.stringify(dlHit))
    await capture(win, join(OUT, `preview-${viewport.label}-exits-offered.png`))

    if (subHit.hit) {
      await clickAt(win, subHit.x, subHit.y)
      await wait(900)
      const landed = await js(win, `({ path: location.pathname, hash: location.hash })`)
      check(`${viewport.label}: PRESENCE — clicking it actually leaves the preview for the declared route`,
        landed.path === '/' && landed.hash === '#/subscribe', JSON.stringify(landed))
    }

    breadcrumb(`${viewport.label}: done`)
    win.destroy()
  }

  server.close()

  if (assertions === 0) {
    say('VACUOUS: the drive made no assertions at all. That is a failure, not a pass.')
    flush(1); return
  }
  const failed = results.filter(r => !r.ok)
  say('')
  say(`${assertions} assertions · ${assertions - failed.length} passed · ${failed.length} failed`)
  say(`screenshots and report in ${OUT}`)
  flush(failed.length === 0 ? 0 : 1)
}

app.whenReady().then(drive).catch(error => {
  say(`DRIVE FAILED: ${error && error.stack || error}`)
  flush(1)
})
