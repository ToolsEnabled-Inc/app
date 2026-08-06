import { createRequire } from 'node:module'
import path from 'node:path'

const harnessRoot = process.env.MC_HARNESS_ROOT
const previewAddress = process.env.MC_PREVIEW_ADDRESS

if (!harnessRoot || !previewAddress) {
  throw new Error('MC_HARNESS_ROOT and MC_PREVIEW_ADDRESS are required')
}

const requireFromHarness = createRequire(path.join(harnessRoot, 'package.json'))
const playwright = requireFromHarness('playwright')
const originalLaunch = playwright.chromium.launch.bind(playwright.chromium)
const liveViews = ['home', 'computers', 'agent', 'metrics', 'comms', 'ledger']

playwright.chromium.launch = async options => {
  const args = [...(options?.args || []), `--host-resolver-rules=MAP localhost ${previewAddress}`]
  const browser = await originalLaunch({ ...(options || {}), args })

  if (process.env.MC_FORCE_SIM === '1') {
    const originalNewPage = browser.newPage.bind(browser)
    browser.newPage = async pageOptions => {
      const page = await originalNewPage(pageOptions)
      await page.addInitScript(views => {
        for (const view of views) localStorage.setItem(`mc.live.${view}`, 'simulated')
      }, liveViews)
      return page
    }
  }

  return browser
}
