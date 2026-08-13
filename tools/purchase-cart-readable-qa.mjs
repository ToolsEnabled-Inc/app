#!/usr/bin/env node

/* IS THE PURCHASE LIST ACTUALLY READABLE, IN A REAL BROWSER, WITH HIS REAL CART?
 *
 * WHY A TEST SUITE WAS NOT ENOUGH. tools/test/purchase-cart-view.test.mjs calls
 * the drawing code and reads the strings it returns. That proves the words are
 * correct and proves nothing about whether they are ON THE SCREEN. A rule in a
 * stylesheet can give an element no height, push it out of the viewport, or
 * paint it in the background colour, and every assertion over returned text
 * stays green while a person sees nothing. The deadline this adds is the single
 * fact his money depends on, so "the function returned the sentence" is not the
 * bar. The bar is a measured box, on a screen, with his own cart in it.
 *
 * WHAT IT DOES
 *   1. Reads the owner's REAL queue from the engine's own store, through the
 *      engine's own reader, in exactly the shape GET /v1/owner-prompts serves.
 *   2. Serves this repository over loopback on an ephemeral port and loads a
 *      page that imports the REAL renderer and the REAL stylesheets. Nothing is
 *      transcribed, stubbed or re-implemented for the measurement.
 *   3. Measures every card in Chromium: the deadline element exists, has a real
 *      box, sits inside the viewport, is not hidden, and is not painted in the
 *      background colour.
 *   4. Hunts our own record numbers in the rendered text, and reports them in
 *      TWO SEPARATE CLASSES, because they have two different owners:
 *
 *        drawn    a number this window put on the screen -- inside a line item,
 *                 where the engine stamps provenance onto the front of a
 *                 description. This window is what draws those, so any hit here
 *                 is a defect in this repository and there must be none.
 *        written  a number inside the TITLE or the MESSAGE, which are sentences
 *                 the engine's cart producers wrote and this window prints
 *                 verbatim. Editing them here would mean rewriting the owner's
 *                 own quoted words in the middle of his money screen, and
 *                 rebuilding them at the source would mean replacing the carts
 *                 he is currently deciding, which resets their deadlines. So
 *                 these are reported, named, and routed -- never edited, and
 *                 never quietly counted as clean.
 *
 *      Both classes fail the run. A finding somebody else has to fix is still a
 *      finding, and a gate that passed on it would be hiding it.
 *   5. Writes a screenshot, so the verdict can be looked at rather than trusted.
 *
 * WHAT IT NEVER DOES. It presses nothing. It decides nothing. It approves,
 * denies, acknowledges and enqueues nothing, and it never reaches the audited
 * connection at all -- it draws a snapshot it read from disk. There is no code
 * path in this file that can spend, and the renderer it loads has none either.
 *
 * NOTHING LEAVES THIS MACHINE. The server binds 127.0.0.1, Chromium is launched
 * with no proxy and visits only that address, and the screenshot is written
 * beside this repository's other build artifacts.
 *
 * IT NEEDS TWO THINGS AND SAYS WHICH IS MISSING, rather than passing quietly:
 * the engine checkout named in private/capability-source.owner.json, and the
 * Playwright browser the engine's own dependencies carry. Exit 2 is a setup
 * problem, exit 1 is a real finding, exit 0 is measured and clean -- the same
 * three codes tools/check-plain-language.mjs uses.
 */

import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const OUT_DIR = path.join(REPO_ROOT, 'artifacts', 'purchase-cart-readable')

/* A record number of ours, of the shape the engine stamps onto a description.
   None of these may appear in anything a person reads. */
const OUR_RECORD_NUMBER = /\bR\d{3,4}(?:\.\d{1,3})?\b/
const STAMP = /From your words|AGENT-PROPOSED/

function fail(code, message) {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}

function engineRoot() {
  const setting = path.join(REPO_ROOT, 'private', 'capability-source.owner.json')
  if (!existsSync(setting)) return null
  try {
    const configured = JSON.parse(readFileSync(setting, 'utf8'))?.path
    return typeof configured === 'string' && existsSync(configured) ? configured : null
  } catch { return null }
}

const root = engineRoot()
if (root === null) {
  fail(2, 'SETUP: private/capability-source.owner.json does not name an engine checkout on this machine,\n'
    + 'so the owner\'s real queue was NOT read and nothing was measured.')
}

const requireEngine = createRequire(import.meta.url)
let snapshot
try {
  snapshot = requireEngine(path.join(root, 'src', 'lib', 'mission-bridge', 'owner-prompts.js')).snapshot()
} catch (error) {
  fail(2, `SETUP: the engine's queue reader could not be loaded from ${root}. Nothing was measured.\n${error.message}`)
}
if (!snapshot || snapshot.ok !== true || !Array.isArray(snapshot.prompts)) {
  fail(2, 'SETUP: the engine did not return a queue in the shape the screens read. Nothing was measured.')
}
if (snapshot.prompts.length === 0) {
  fail(2, 'SETUP: the owner\'s queue is empty right now, so there is no cart to look at.\n'
    + 'This is not a pass. Re-run it when something is waiting.')
}

let chromium
try {
  ({ chromium } = requireEngine(path.join(root, 'node_modules', 'playwright')))
} catch (error) {
  fail(2, `SETUP: Playwright is not installed in ${root}. Nothing was measured.\n${error.message}`)
}

/* ---- the page, built from the real modules ---- */

const PAGE = `<!doctype html>
<html data-theme="black"><head><meta charset="utf-8">
<link rel="stylesheet" href="/src/styles.css">
<link rel="stylesheet" href="/src/ledger.css">
<link rel="stylesheet" href="/src/owner-popup.css">
<link rel="stylesheet" href="/src/settings.css">
<style>body{margin:0;padding:24px;background:var(--bg,#111)}</style>
</head><body>
<main class="view-pad approvals-page"><div class="ledger-shell">
  <section class="ledger-register approvals-list owner-popup-root" id="queue"></section>
  <div class="settings-shell"><section class="settings-section" id="accountRow"></section></div>
</div></main>
<script type="module">
import { renderOwnerPrompt, normalizeOwnerPromptSnapshot, applyOwnerPopupTheme } from '/src/owner-popup.js'
import { cartSummary } from '/src/purchase-cart-view.js'
import { cartMarkup } from '/src/account-markup.js'
const raw = await (await fetch('/queue.json')).json()
const snapshot = normalizeOwnerPromptSnapshot(raw)
const list = document.getElementById('queue')
applyOwnerPopupTheme(list, snapshot.theme, 'black')
for (const prompt of snapshot.prompts) {
  const wrap = document.createElement('div')
  wrap.className = 'approvals-card'
  wrap.dataset.promptKind = prompt.kind
  wrap.append(renderOwnerPrompt(document, prompt, { dismiss() {}, submit() {} }, { surface: 'screen' }).dialog)
  list.append(wrap)
}
document.getElementById('accountRow').innerHTML = cartMarkup({ cart: cartSummary(snapshot.prompts, Date.now()) })
document.body.dataset.ready = 'true'
</script></body></html>`

const TYPES = new Map([['.js', 'text/javascript'], ['.mjs', 'text/javascript'], ['.css', 'text/css'], ['.json', 'application/json']])

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(PAGE)
    return
  }
  if (url.pathname === '/queue.json') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(snapshot))
    return
  }
  /* Served straight out of the working tree, so what is measured is the source
     on disk rather than a copy taken at some earlier moment. Confined to the
     repository root: a request that resolves outside it is refused. */
  const wanted = path.resolve(REPO_ROOT, `.${url.pathname}`)
  if (!wanted.startsWith(REPO_ROOT) || !existsSync(wanted)) {
    response.writeHead(404).end('not here')
    return
  }
  response.writeHead(200, { 'content-type': TYPES.get(path.extname(wanted)) || 'application/octet-stream' })
  response.end(readFileSync(wanted))
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const consoleErrors = []
page.on('pageerror', error => consoleErrors.push(error.message))

/* Kept apart on purpose. `drawn` is this repository's to fix; `written` is the
   engine's, and both are printed. See the header. */
const findings = []
const routed = []
let measured = 0
try {
  await page.goto(origin, { waitUntil: 'load' })
  await page.waitForSelector('body[data-ready="true"]', { timeout: 15_000 })

  /* EVERY CARD, MEASURED. Not a sample: the two lists and the eight questions
     are all on the same clock, and the two that run out first are questions. */
  const cards = await page.$$('.approvals-card')
  if (cards.length !== snapshot.prompts.length) {
    findings.push(`only ${cards.length} of ${snapshot.prompts.length} waiting requests were drawn at all`)
  }
  for (const card of cards) {
    measured += 1
    const seen = await card.evaluate(node => {
      const deadline = node.querySelector('.owner-popup-deadline')
      if (!deadline) return { drawn: false }
      const box = deadline.getBoundingClientRect()
      const style = getComputedStyle(deadline)
      const when = deadline.querySelector('.owner-popup-deadline-when')
      const consequence = deadline.querySelector('.owner-popup-deadline-consequence')
      return {
        drawn: true,
        title: node.querySelector('h2')?.textContent || '',
        when: when?.textContent || '',
        consequence: consequence?.textContent || '',
        width: Math.round(box.width),
        height: Math.round(box.height),
        top: Math.round(box.top),
        left: Math.round(box.left),
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        colour: getComputedStyle(when || deadline).color,
        background: style.backgroundColor,
        /* SPLIT BY WHICH FIELD IT CAME FROM, not by where it lands on the card
           -- a distinction this measurement got wrong the first time, and the
           owner's own cart is what caught it. Both classes sit inside a line
           item. `description` arrives with a provenance stamp on the front and
           this window is what takes that stamp apart, so the item NAME and the
           badge beside it are this repository's to keep clean. `merchant` and
           `purpose` are whole sentences the engine's producers wrote and this
           window prints unedited; one of them says "not traceable to R1234" as
           part of explaining, in the owner's own interest, that a line is
           nobody's idea. */
        drawnText: [
          ...node.querySelectorAll('.owner-popup-item-name'),
          ...node.querySelectorAll('.owner-popup-item-origin'),
        ].map(part => part.textContent || '').join(' '),
        writtenText: [
          node.querySelector('h2'),
          node.querySelector('.owner-popup-heading-message'),
          ...node.querySelectorAll('.owner-popup-item-meta:not(.owner-popup-item-origin)'),
        ].map(part => part?.textContent || '').join(' '),
      }
    })
    if (!seen.drawn) { findings.push('a waiting request was drawn with no deadline on it at all'); continue }
    if (seen.width < 40 || seen.height < 10) findings.push(`the deadline on "${seen.title}" has no readable box: ${seen.width} by ${seen.height}`)
    if (seen.display === 'none' || seen.visibility === 'hidden' || seen.opacity === '0') {
      findings.push(`the deadline on "${seen.title}" is in the page and hidden from the person reading it`)
    }
    if (seen.left < 0 || seen.left > 1280) findings.push(`the deadline on "${seen.title}" is outside the window at x=${seen.left}`)
    if (seen.colour === seen.background) findings.push(`the deadline on "${seen.title}" is painted in its own background colour`)
    if (!/Expires|no longer waiting/.test(seen.when)) findings.push(`the deadline on "${seen.title}" says nothing about when: "${seen.when}"`)
    if (!/denied|marked as read/.test(seen.consequence)) findings.push(`the card "${seen.title}" does not say what doing nothing does`)
    if (OUR_RECORD_NUMBER.test(seen.drawnText)) {
      findings.push(`a record number of ours is on a LINE of "${seen.title}", which this window draws`)
    }
    if (STAMP.test(seen.drawnText)) {
      findings.push(`a raw stamp is on a LINE of "${seen.title}", which this window draws`)
    }
    if (OUR_RECORD_NUMBER.test(seen.writtenText) || STAMP.test(seen.writtenText)) {
      const found = seen.writtenText.match(OUR_RECORD_NUMBER)?.[0] || seen.writtenText.match(STAMP)?.[0]
      routed.push(`"${seen.title.slice(0, 70)}" — its own title or message contains ${found}`)
    }
  }

  /* THE ROW ON HIS ACCOUNT SCREEN, measured the same way. */
  const row = await page.evaluate(() => {
    const node = document.querySelector('[data-account-cart]')
    if (!node) return { drawn: false }
    const box = node.getBoundingClientRect()
    return {
      drawn: true,
      state: node.dataset.cartState,
      text: node.textContent || '',
      link: node.querySelector('a')?.getAttribute('href') || '',
      width: Math.round(box.width),
      height: Math.round(box.height),
    }
  })
  if (!row.drawn) findings.push('the signed-in account screen drew no purchase list row')
  else {
    if (row.state !== 'waiting') findings.push(`the account row is in the "${row.state}" state while ${snapshot.prompts.length} requests are waiting`)
    if (row.width < 100 || row.height < 20) findings.push(`the account row has no readable box: ${row.width} by ${row.height}`)
    if (row.link !== '#/approvals') findings.push('the account row does not lead to the full list')
    if (OUR_RECORD_NUMBER.test(row.text)) findings.push('one of our record numbers is on the account row')
    if (!/Expires|no longer waiting/.test(row.text)) findings.push('the account row does not say when anything runs out')
  }

  mkdirSync(OUT_DIR, { recursive: true })
  await page.screenshot({ path: path.join(OUT_DIR, 'purchase-list.png'), fullPage: true })
  /* THE SHOPPING LIST ITSELF, AND THE ROW ON HIS ACCOUNT SCREEN, each on their
     own, because the whole-page shot is dominated by whatever happens to be
     first in the queue and the two things this task added are further down. */
  const firstCart = await page.$('.approvals-card[data-prompt-kind="purchase_batch"]')
  if (firstCart) await firstCart.screenshot({ path: path.join(OUT_DIR, 'a-cart.png') })
  const accountRow = await page.$('[data-account-cart]')
  if (accountRow) await accountRow.screenshot({ path: path.join(OUT_DIR, 'account-row.png') })
  writeFileSync(path.join(OUT_DIR, 'measured.json'), `${JSON.stringify({
    at: new Date().toISOString(), origin, waiting: snapshot.prompts.length, cardsMeasured: measured, findings, routed, pageErrors: consoleErrors,
  }, null, 2)}\n`)
} finally {
  await browser.close()
  server.close()
}

if (consoleErrors.length > 0) findings.push(...consoleErrors.map(message => `the page itself threw while drawing: ${message}`))

process.stdout.write(`Purchase list, measured in Chromium: ${measured} card(s) drawn from ${snapshot.prompts.length} waiting request(s).\n`)
process.stdout.write(`Screenshot and measurements: ${OUT_DIR}\n`)
if (findings.length > 0) {
  process.stdout.write(`\n${findings.length} finding(s) in what this window draws:\n${findings.map(entry => `  - ${entry}`).join('\n')}\n`)
}
if (routed.length > 0) {
  process.stdout.write(`\n${routed.length} finding(s) in the words the engine wrote — routed, not edited here:\n`
    + `${routed.map(entry => `  - ${entry}`).join('\n')}\n`
    + '\nThese titles and messages are written by the engine\'s cart producers and printed here unedited.\n'
    + 'Rewriting them in this window would edit the owner\'s own quoted words on his money screen.\n'
    + 'Rebuilding them at the source would replace the carts he is deciding right now and reset their\n'
    + 'deadlines, which are five days away. So they are named here and left for whoever owns that copy.\n')
}
if (findings.length > 0 || routed.length > 0) process.exit(1)
process.stdout.write('Every waiting request draws its deadline, says what doing nothing does, and carries no record number of ours.\n')
