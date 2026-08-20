#!/usr/bin/env node
/* WHY IS "Open sign-in" ZERO-SIZE, AND IS IT ZERO-SIZE FOR A PERSON TOO?
 *
 * tools/uninstall-reset-packaged-qa.mjs dies at its first step with
 * `sign-in-link:zero-size`. The element is in the DOM
 * (src/fleet-profile-settings.js: `<a class="ctl-btn" href="#/account">`), its
 * own computed style is not display:none / visibility:hidden / opacity:0 --
 * test-account-harness.mjs checks those FIRST and would have said `hidden` --
 * and yet getBoundingClientRect() comes back 0x0.
 *
 * THIS FILE DOES NOT FIX ANYTHING. It measures, because there are four
 * different causes that all produce that one word, and they need four
 * different answers:
 *
 *   1. an ANCESTOR is display:none (a collapsed section), so the child's own
 *      style is innocent and its box is still 0x0;
 *   2. something is painted OVER it (that would read `covered`, not
 *      `zero-size`, but the two get confused in reports so both are measured);
 *   3. the anchor itself collapses -- an inline <a> with no layout;
 *   4. it is an artifact of the harness and a person can click it fine.
 *
 * So: the full ancestor chain is walked and each link reports its own tag,
 * class, `hidden` attribute, `inert`, computed display and box. Whichever
 * ancestor is the FIRST one with a zero box is the one that collapsed the
 * control, and it is named. Belief is not accepted.
 *
 * It also measures the FIRST-RUN QUESTION, which is the one the owner cares
 * about: on a profile that has never been used, how many presses does it take
 * a person who has just installed this to reach sign-in?
 *
 *   node tools/signin-reach-probe.mjs [--visible] [--release <dir>]
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  assertIsolated, closeWindow, createLedger, delay, describeTimeline, openWindow,
  releaseDirectory, route, scratchDirectory, seedMachineRecord, stage,
} from './test-account-harness.mjs'

const SIGN_IN = 'a.ctl-btn[href="#/account"]'

/* The ancestor walk. Runs in the page; returns plain data only. */
const CHAIN_FN = `(selector) => {
  const node = document.querySelector(selector)
  if (!node) return { found: false }
  const describe = el => {
    const style = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    return {
      tag: el.tagName,
      cls: String(el.className || '').slice(0, 80),
      id: el.id || null,
      hiddenAttr: el.hasAttribute('hidden'),
      inert: el.hasAttribute('inert'),
      ariaHidden: el.getAttribute('aria-hidden'),
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      contentVisibility: style.contentVisibility || null,
      w: Math.round(box.width * 100) / 100,
      h: Math.round(box.height * 100) / 100,
    }
  }
  const chain = []
  let cursor = node
  while (cursor && cursor !== document.documentElement) {
    chain.push(describe(cursor))
    cursor = cursor.parentElement
  }
  return { found: true, chain }
}`

/* What a person sees on the settings page before touching anything. */
const SURFACE_FN = `() => {
  const visible = el => {
    const box = el.getBoundingClientRect()
    return box.width >= 1 && box.height >= 1
  }
  const groups = [...document.querySelectorAll('.settings-group')].map(group => ({
    id: group.dataset.settingsGroup,
    open: group.classList.contains('is-open'),
    headText: (group.querySelector('.settings-group-head')?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
    bodyHidden: group.querySelector('.settings-group-body')?.hasAttribute('hidden') ?? null,
  }))
  const controls = [...document.querySelectorAll('.settings-sections button, .settings-sections input, .settings-sections select, .settings-sections a')]
  return {
    route: document.body.dataset.route,
    groups,
    controlsInDom: controls.length,
    controlsWithABox: controls.filter(visible).length,
    openGroupsStored: (() => { try { return localStorage.getItem('mc.settings.open-groups') } catch { return 'THREW' } })(),
    footer: (document.querySelector('.settings-footer')?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
    bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 900),
  }
}`

async function shoot(window, scratch, name) {
  /* Page.captureScreenshot never returns under MC_SMOKE_HEADLESS=1 unless the
     page is driven back to `active` first. Learned the expensive way. */
  try { await window.session.send('Page.setWebLifecycleState', { state: 'active' }) } catch { /* older build */ }
  await delay(300)
  const shot = await window.session.send('Page.captureScreenshot', { format: 'png' })
  const data = shot?.result?.data
  if (!data) return null
  const file = path.join(scratch, 'shots', `${name}.png`)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, Buffer.from(data, 'base64'))
  return file
}

async function resize(window, width, height = 900) {
  await window.session.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  })
  await delay(700)
}

async function main() {
  const ledger = createLedger()
  const scratch = scratchDirectory('signin-reach-probe')
  const profile = path.join(scratch, 'one-windows-user')
  const evidence = { scratch, measurements: {} }

  const staged = await stage(scratch, releaseDirectory())
  seedMachineRecord(profile, staged.appRoot, 'standard')

  let window = await openWindow(staged.executable, profile)
  try {
    assertIsolated(profile)
    ledger.check('the packaged app launched on a sterile profile', true, describeTimeline(window.timeline))

    /* Reach settings the way the failing driver does: home, gear, all settings.
       Reproduced here rather than imported so a failure inside gotoSettings is
       visible as its own step. */
    const { gotoSettings } = await import('./test-account-harness.mjs')
    const reached = await gotoSettings(window)
    ledger.check('the settings page is reachable', reached === 'clicked' || reached === 'already-there', reached)
    if (reached !== 'clicked' && reached !== 'already-there') {
      ledger.note(`route is ${await route(window)}; the rest of this probe needs the settings page`)
      return ledger.finish('signin-reach-probe')
    }

    // ---- 1. reproduce the reported state, with its own words ----
    const asHarnessSeesIt = await window.visibility(SIGN_IN)
    evidence.measurements.harnessState = asHarnessSeesIt
    ledger.note(`the harness's own visibility verdict on ${SIGN_IN}: ${JSON.stringify(asHarnessSeesIt)}`)

    // ---- 2. WHY. the ancestor chain, first zero-box link named ----
    const chain = await window.evaluate(`(${CHAIN_FN})(${JSON.stringify(SIGN_IN)})`)
    evidence.measurements.chain = chain
    ledger.check('the sign-in anchor exists in the DOM', chain?.found === true, JSON.stringify(chain?.chain?.[0] || null))
    if (chain?.found) {
      const collapsed = chain.chain.filter(link => link.w < 1 || link.h < 1)
      const culprit = chain.chain.find(link => link.display === 'none' || link.hiddenAttr === true)
      ledger.note(`${collapsed.length} of ${chain.chain.length} links in the chain have a zero box`)
      ledger.note(`first link that is display:none or [hidden]: ${culprit ? JSON.stringify(culprit) : 'NONE — the cause is not a collapsed ancestor'}`)
      for (const link of chain.chain) {
        ledger.note(`  ${link.tag}.${link.cls || '-'}${link.id ? '#' + link.id : ''} display=${link.display} hidden=${link.hiddenAttr} inert=${link.inert} box=${link.w}x${link.h}`)
      }
    }

    // ---- 3. what a first-time person is actually looking at ----
    const surface = await window.evaluate(`(${SURFACE_FN})()`)
    evidence.measurements.surface = surface
    ledger.note(`settings page: ${surface?.controlsWithABox}/${surface?.controlsInDom} controls have a box`)
    ledger.note(`remembered open groups in storage: ${surface?.openGroupsStored === null ? 'NOTHING STORED (a first visit)' : surface?.openGroupsStored}`)
    for (const group of surface?.groups || []) {
      ledger.note(`  group ${group.id}: open=${group.open} bodyHidden=${group.bodyHidden} — ${group.headText}`)
    }
    ledger.check('a first-time person can see at least one control on the settings page',
      (surface?.controlsWithABox || 0) > 0,
      `${surface?.controlsWithABox} with a box`)

    const first = await shoot(window, scratch, 'settings-first-visit-default-width')
    ledger.note(`screenshot: ${first}`)

    // ---- 4. the reach test: how many presses to sign-in, by hand ----
    /* Expand the group that holds System with a REAL press, then re-measure.
       If the anchor becomes visible, the cause is proven to be the collapse
       and not occlusion or a broken anchor. */
    const openedGroup = await window.clickVisible('[data-group-toggle="start"]')
    await delay(900)
    const afterExpand = await window.visibility(SIGN_IN)
    evidence.measurements.afterExpand = afterExpand
    ledger.check('pressing the group header makes the sign-in control measurable',
      openedGroup === 'clicked' && afterExpand?.state === 'visible',
      `press=${openedGroup}; then ${JSON.stringify(afterExpand)}`)

    const expanded = await shoot(window, scratch, 'settings-after-expanding-start-group')
    ledger.note(`screenshot: ${expanded}`)

    // ---- 5. the same question at the widths the owner named ----
    for (const width of [1024, 1440, 1920]) {
      await resize(window, width)
      const at = await window.visibility(SIGN_IN)
      evidence.measurements[`at${width}`] = at
      ledger.note(`at ${width}px the sign-in control is ${at?.state}${at?.state === 'covered' ? ' by ' + at.by : ''}`)
      const file = await shoot(window, scratch, `expanded-${width}`)
      ledger.note(`  screenshot: ${file}`)
    }
    await window.session.send('Emulation.clearDeviceMetricsOverride')

    // ---- 6. is search a second route to it? ----
    const typed = await window.typeInto('.settings-search input[type="search"]', 'sign in')
    await delay(900)
    const viaSearch = await window.visibility(SIGN_IN)
    evidence.measurements.viaSearch = { typed, state: viaSearch }
    ledger.note(`typing "sign in" into the settings search: ${typed}; the control is then ${viaSearch?.state}`)
  } finally {
    const timeline = await closeWindow(window)
    evidence.timeline = describeTimeline(timeline)
    mkdirSync(scratch, { recursive: true })
    writeFileSync(path.join(scratch, 'measurements.json'), JSON.stringify(evidence, null, 2), 'utf8')
    console.log(`\nevidence: ${scratch}`)
  }
  return ledger.finish('signin-reach-probe')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
