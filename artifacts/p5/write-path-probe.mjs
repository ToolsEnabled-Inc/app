import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import crypto from 'node:crypto'

const harnessRoot = process.env.MC_HARNESS_ROOT
const previewAddress = process.env.MC_PREVIEW_ADDRESS
const previewPort = Number.parseInt(process.env.MC_PREVIEW_PORT || '4600', 10)
if (!harnessRoot || !path.isAbsolute(harnessRoot)) throw new Error('MC_HARNESS_ROOT must be an absolute path')
if (!previewAddress || !/^127\.0\.0\.\d+$/.test(previewAddress)) throw new Error('MC_PREVIEW_ADDRESS must be a numeric loopback address')
if (!Number.isSafeInteger(previewPort) || previewPort < 1 || previewPort > 65535) throw new Error('MC_PREVIEW_PORT is invalid')

const require = createRequire(path.join(harnessRoot, 'package.json'))
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, args: [`--host-resolver-rules=MAP localhost ${previewAddress}`] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const origin = `http://localhost:${previewPort}`
const writeActions = ['dispatch', 'decision', 'queue', 'thread-reply', 'report-read']
const writeKeys = writeActions.map(id => `mc.write.${id}`)
await page.addInitScript(keys => {
  if (sessionStorage.getItem('p5-write-seeded') !== 'true') {
    for (const key of keys) localStorage.setItem(key, 'disabled')
    sessionStorage.setItem('p5-write-seeded', 'true')
  }
}, writeKeys)
const errors = []
let navigationId = 0
page.on('pageerror', error => errors.push(String(error?.message || error)))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
let refusedDiscoveryRequests = 0
await context.route('http://127.0.0.1:4610/**', async routeRequest => {
  refusedDiscoveryRequests += 1
  await routeRequest.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: { code: 'BRIDGE_TEST_UNAVAILABLE', message: 'bridge unavailable in worktree probe' } }),
  })
})

const sha = value => crypto.createHash('sha256').update(value).digest('hex')
async function route(hash, selector) {
  navigationId += 1
  await page.goto(`${origin}/?p5=${navigationId}${hash}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(selector, { state: 'visible', timeout: 15_000 })
}
async function setWrites(enabled) {
  await page.evaluate(({ actions, keys, enabled }) => {
    for (const key of keys) {
      if (enabled) localStorage.removeItem(key)
      else localStorage.setItem(key, 'disabled')
    }
    for (const action of actions) {
      window.dispatchEvent(new CustomEvent('mc:write-flags-changed', { detail: { action, enabled } }))
    }
  }, { actions: writeActions, keys: writeKeys, enabled })
}

const results = { checks: {}, screenshots: [], errors }
await route('#/', '.home')
await setWrites(false)
await page.waitForTimeout(700)
const homeBefore = await page.locator('.home-feed').evaluate(node => node.outerHTML)
results.checks.flagOffWriteDomCount = await page.locator('.write-surface,.session-write-state').count()
results.checks.flagOffUsesExplicitDisabled = await page.evaluate(keys => keys.every(key => localStorage.getItem(key) === 'disabled'), writeKeys)
await page.waitForSelector('.home-feed')
await page.waitForTimeout(700)
const homeAfter = await page.locator('.home-feed').evaluate(node => node.outerHTML)
results.checks.flagOffProtectedHomeByteStable = homeBefore === homeAfter
results.checks.flagOffProtectedHomeBeforeSha256 = sha(homeBefore)
results.checks.flagOffProtectedHomeAfterSha256 = sha(homeAfter)

await setWrites(true)
results.checks.defaultOnUsesMissingStorage = await page.evaluate(keys => keys.every(key => localStorage.getItem(key) === null), writeKeys)
await route('#/', '.session-write-state')
await page.waitForSelector('.session-write-state[data-state="unavailable"]')
results.checks.homeBridgeDownHonest = (await page.locator('.session-write-state').textContent()).includes('bridge unavailable')
await route('#/agent/machine-a/luna', '.agent-write-surface')
await page.waitForSelector('.agent-write-surface[data-bridge-state="unavailable"]')
results.checks.agentForms = await page.locator('.agent-write-surface form').count()
results.checks.agentBridgeDownHonest = (await page.locator('.agent-write-surface [data-write-status]').textContent()).includes('bridge unavailable')
await route('#/ledger', '.ledger-write-surface')
await page.waitForSelector('.ledger-write-surface[data-bridge-state="unavailable"]')
results.checks.ledgerForms = await page.locator('.ledger-write-surface form').count()
results.checks.ledgerBridgeDownHonest = (await page.locator('.ledger-write-surface [data-write-status]').textContent()).includes('bridge unavailable')
await route('#/settings', '.settings-page')
results.checks.settingsWriteToggleCount = await page.locator('[data-settings-section="Write"] input[type="checkbox"]').count()

const screenshotRoot = path.resolve('artifacts', 'p5', 'screenshots')
fs.mkdirSync(screenshotRoot, { recursive: true })
for (const theme of ['white', 'tan', 'black']) {
  await page.evaluate(themeName => {
    localStorage.setItem('mc.theme', themeName)
    document.documentElement.dataset.theme = themeName
  }, theme)
  const captures = [
    ['home', '#/', '.session-write-state[data-state="unavailable"]'],
    ['agent', '#/agent/machine-a/luna', '.agent-write-surface[data-bridge-state="unavailable"]'],
    ['ledger', '#/ledger', '.ledger-write-surface[data-bridge-state="unavailable"]'],
  ]
  for (const [name, hash, ready] of captures) {
    await route(hash, ready)
    const file = path.join(screenshotRoot, `${theme}-${name}.png`)
    await page.screenshot({ path: file, fullPage: false })
    results.screenshots.push(path.relative(process.cwd(), file).replace(/\\/g, '/'))
  }
  await route('#/settings', '.settings-page')
  await page.locator('button[data-category="Write"]').click()
  await page.waitForTimeout(250)
  const file = path.join(screenshotRoot, `${theme}-settings-write.png`)
  await page.screenshot({ path: file, fullPage: false })
  results.screenshots.push(path.relative(process.cwd(), file).replace(/\\/g, '/'))
}

const readyPage = await context.newPage()
await readyPage.addInitScript(({ keys }) => {
  for (const key of keys) localStorage.removeItem(key)
}, { keys: writeKeys })
await readyPage.route('http://127.0.0.1:49999/**', async routeRequest => {
  const url = new URL(routeRequest.request().url())
  if (url.pathname === '/v1/bootstrap') {
    await routeRequest.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, token: 'a'.repeat(43) }) })
  } else if (url.pathname === '/v1/status') {
    await routeRequest.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, roots: ['primary'], queues: { primary: { ok: true, hash: 'b'.repeat(64), indexed: true } },
      channels: { discord: { ok: false, reason: 'channel-unavailable' } },
    }) })
  } else if (url.pathname === '/v1/actions/thread-reply') {
    await new Promise(resolve => setTimeout(resolve, 180))
    await routeRequest.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, receipt: { action: 'thread-reply', actor: 'claude', revision: 7 },
    }) })
  } else {
    await routeRequest.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'FIXTURE_ROUTE_MISSING', message: 'missing fixture route' } }) })
  }
})
const refusedBeforeExplicit = refusedDiscoveryRequests
const explicitBridge = encodeURIComponent('http://127.0.0.1:49999')
await readyPage.goto(`${origin}/?bridge=${explicitBridge}&p5=ready#/ledger`, { waitUntil: 'domcontentloaded' })
await readyPage.waitForSelector('.ledger-write-surface[data-bridge-state="ready"]')
results.checks.explicitBridgeSkipsWellKnownDiscovery = refusedDiscoveryRequests === refusedBeforeExplicit
results.checks.queueHashPrefilledFromStrictStatus = await readyPage.locator('[data-queue-form] input[name="expectedHash"]').inputValue() === 'b'.repeat(64)
results.checks.queueButtonsEnabledAfterSnapshot = await readyPage.locator('[data-queue-form] button[data-queue-operation]:enabled').count() === 2
await readyPage.goto(`${origin}/?bridge=${explicitBridge}&p5=reply#/`, { waitUntil: 'domcontentloaded' })
await readyPage.waitForSelector('.session-write-state[data-state="ready"]')
const turnsBeforeReply = await readyPage.locator('.session-log .turn').count()
await readyPage.locator('.session-input input').fill('Confirmed coordinator reply.')
await readyPage.locator('.chat-send').click()
await readyPage.waitForTimeout(40)
results.checks.threadReplyNotOptimistic = await readyPage.locator('.session-log .turn').count() === turnsBeforeReply
await readyPage.waitForSelector('.session-write-state[data-state="confirmed"]')
results.checks.threadReplyUsesReceiptActor = (await readyPage.locator('.session-log .turn').nth(turnsBeforeReply).textContent()).includes('claude')
await readyPage.close()

const discoveryContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const discoveryPage = await discoveryContext.newPage()
const discoveryRoutes = []
await discoveryPage.route('http://127.0.0.1:4610/**', async routeRequest => {
  const url = new URL(routeRequest.request().url())
  discoveryRoutes.push(url.pathname)
  if (url.pathname === '/v1/runtime') {
    await routeRequest.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, baseUrl: 'http://127.0.0.1:4610', port: 4610,
      startedAt: '2026-08-06T08:00:00.000Z', pid: 4610,
    }) })
  } else if (url.pathname === '/v1/bootstrap') {
    await routeRequest.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, token: 'c'.repeat(43) }) })
  } else if (url.pathname === '/v1/status') {
    await routeRequest.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, roots: ['primary'], queues: { primary: { ok: true, hash: 'd'.repeat(64), indexed: true } },
      channels: { discord: { ok: false, reason: 'channel-unavailable' } },
    }) })
  } else {
    await routeRequest.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
  }
})
await discoveryPage.goto(`${origin}/?p5=well-known#/ledger`, { waitUntil: 'domcontentloaded' })
await discoveryPage.waitForSelector('.ledger-write-surface[data-bridge-state="ready"]')
results.checks.wellKnownRuntimeDiscoveryReady = ['/v1/runtime', '/v1/bootstrap', '/v1/status']
  .every(pathname => discoveryRoutes.includes(pathname))
await discoveryContext.close()

await browser.close()
const required = {
  flagOffWriteDomCount: 0,
  flagOffUsesExplicitDisabled: true,
  flagOffProtectedHomeByteStable: true,
  defaultOnUsesMissingStorage: true,
  homeBridgeDownHonest: true,
  agentForms: 2,
  agentBridgeDownHonest: true,
  ledgerForms: 2,
  ledgerBridgeDownHonest: true,
  settingsWriteToggleCount: 5,
  queueHashPrefilledFromStrictStatus: true,
  queueButtonsEnabledAfterSnapshot: true,
  threadReplyNotOptimistic: true,
  threadReplyUsesReceiptActor: true,
  explicitBridgeSkipsWellKnownDiscovery: true,
  wellKnownRuntimeDiscoveryReady: true,
}
const failed = Object.entries(required).filter(([key, value]) => results.checks[key] !== value)
results.ok = failed.length === 0 && errors.length === 0 && results.screenshots.length === 12
results.failed = failed
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
if (!results.ok) process.exitCode = 1
