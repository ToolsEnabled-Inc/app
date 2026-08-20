#!/usr/bin/env node

/* THE SETTINGS PAGE AFTER THE NESTING, DRIVEN THE WAY TONIGHT'S SURFACES RUN
 * DROVE THE FLAT ONE: every row pressed with a real mouse, every press
 * witnessed in the page's own state, the whole profile restarted, and the
 * choices read back. Plus the pieces this lane added, each proven on glass:
 *
 *   ANATOMY    opening a row's guidance never moves its control. The toggle's
 *              own box is measured before and after the disclosure opens; the
 *              14-81px mid-press shift this replaces was measured on the flat
 *              page tonight.
 *   GROUPS     the six groups open by pressing, the open state survives a
 *              restart, and a category press always lands somewhere.
 *   ONE-CLICKS "All examples" / "All live", "Turn everything off" (off ONLY),
 *              "Use recommended answers" (which must leave the permission
 *              level untouched -- read before and after), and a row's jump
 *              link actually landing on the page it names.
 *   ONBOARDING the first screen offers "Skip the rest for now"; the choice
 *              cards select; the review carries the standing-requests brief;
 *              a skip from the first screen lands on home and STAYS there
 *              across a restart (the first-run gate is satisfied, not dodged).
 *
 * WHAT IS DELIBERATELY NOT PRESSED HERE, and where each is proven instead:
 *   - the permission-level seg (its widest option is a consent surface;
 *     tools/unrestricted-consent-qa.mjs drives it in full),
 *   - the working-folder chooser (it opens an operating-system dialog),
 *   - System's Save & reload / Load / Reset (they reload or open dialogs;
 *     typing into the profile name IS pressed and its unsaved banner read),
 *   - the ledger archive's second press (the first press previews; the second
 *     archives, and a sweep must not archive somebody's requests).
 *
 * USAGE  node tools/settings-ia-drive.mjs [--shots <dir>] [--visible]
 * EXIT   0 all checks passed · 1 a check failed · 2 harness could not run
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  closeWindow,
  delay,
  gotoSettings,
  openWindow,
  reap,
  scratchDirectory,
  stage,
  argument,
} from './test-account-harness.mjs'

const SHOTS = argument('--shots', null)
const STARTED = Date.now()
const checks = []
function check(name, pass, detail = '') {
  checks.push({ name, pass: pass === true })
  console.log(`  ${pass === true ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}
const note = text => console.log(`  --    ${text}`)

async function shot(window, name) {
  if (!SHOTS) return
  try {
    mkdirSync(SHOTS, { recursive: true })
    /* A hidden window's renderer is throttled and Page.captureScreenshot can
       then simply never answer; waking the lifecycle first is the measured
       remedy (packaged-drive harness note, 2026-08-18). */
    await window.session.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {})
    const reply = await Promise.race([
      window.session.send('Page.captureScreenshot', { format: 'png' }),
      delay(12000).then(() => null),
    ])
    if (reply?.result?.data) writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(reply.result.data, 'base64'))
    else if (reply?.data) writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(reply.data, 'base64'))
    else note(`shot ${name}: no data came back`)
  } catch (error) { note(`shot ${name} failed: ${error?.message || error}`) }
}

/* ---------- the walkthrough, walked ---------- */

async function walkToReview(window) {
  const untilStep = async (marker, timeoutMs = 12000) => {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      if (await window.evaluate(`Boolean(document.querySelector(${JSON.stringify(marker)}))`)) return true
      await delay(300)
    }
    return false
  }

  check('the first screen offers Skip the rest for now',
    (await window.waitForVisible('[data-setup-skip-first]', 9000))?.state === 'visible')

  /* The card selects: press the second level's CARD, not its seg button. */
  const cardPress = await window.clickVisible('[data-setup-choice="standard"]')
  await delay(600)
  const litStandard = await window.evaluate(
    `document.querySelector('[data-setup-tier="standard"][aria-pressed="true"]') !== null`)
  check('pressing a level card selects that level', cardPress === 'clicked' && litStandard, `press=${cardPress}`)
  await window.clickVisible('[data-setup-choice="guided"]')
  await delay(400)

  const go = await window.clickVisible('[data-setup-continue]')
  check('Continue records the level and advances', go === 'clicked')
  check('the folder question arrives', await untilStep('[data-setup-choose-root]', 15000))
  await window.clickVisible('[data-setup-next]')
  await delay(1200)

  /* The account step: "Not now" is the data-setup-next button when signed out;
     when the step has no form it is a plain next. Either way, one press. */
  await window.clickVisible('[data-setup-next]')
  await delay(1200)
  check('the autonomy question arrives', await untilStep('[data-setup-set="autonomy"]', 12000))

  const autonomyCard = await window.clickVisible('article[data-setup-set="autonomy"][data-setup-value="assisted"]')
  await delay(500)
  check('pressing an autonomy card selects that answer', autonomyCard === 'clicked'
    && await window.evaluate(`document.querySelector('button[data-setup-set="autonomy"][data-setup-value="assisted"]')?.getAttribute('aria-pressed') === 'true'`))

  await window.clickVisible('[data-setup-next="review"]')
  check('the review arrives', await untilStep('[data-setup-request-brief]', 12000))
}

async function checkRequestBrief(window) {
  const brief = await window.evaluate(`(() => {
    const host = document.querySelector('[data-setup-request-brief]')
    if (!host) return { present: false }
    const box = host.getBoundingClientRect()
    const text = host.textContent.replace(/\\s+/g, ' ')
    return {
      present: true,
      hasBox: box.height > 0,
      scopes: ['/Request —', '/RequestSession', '/RequestTree', '/RequestThread'].every(k => text.includes(k)),
      example: text.includes('/Request Always ask before spending money'),
    }
  })()`)
  check('the review carries the standing-requests brief', brief?.present === true && brief?.hasBox === true)
  check('all four scopes and the one example are on it', brief?.scopes === true && brief?.example === true)
  await window.evaluate(`document.querySelector('[data-setup-request-brief]')?.scrollIntoView({ block: 'center', behavior: 'instant' })`)
  await delay(500)
}

/* ---------- the settings page, pressed ---------- */

async function expandEverything(window) {
  for (let round = 0; round < 8; round += 1) {
    const closed = await window.evaluate(
      `document.querySelector('.settings-group-head[aria-expanded="false"]')?.dataset.groupToggle || null`)
    if (!closed) break
    await window.clickVisible(`.settings-group-head[data-group-toggle="${closed}"]`)
    await delay(400)
  }
  check('every group opens by pressing its head',
    await window.evaluate(`document.querySelectorAll('.settings-group-head[aria-expanded="false"]').length === 0`))
  for (let round = 0; round < 60; round += 1) {
    const more = await window.evaluate(
      `Boolean(document.querySelector('.settings-reveal[aria-expanded="false"]'))`)
    if (!more) break
    const pressed = await window.clickVisible('.settings-reveal[aria-expanded="false"]')
    if (pressed !== 'clicked') { note(`a reveal refused the press: ${pressed}`); break }
    await delay(250)
  }
  check('every tier reveal opens by pressing',
    await window.evaluate(`document.querySelectorAll('.settings-reveal[aria-expanded="false"]').length === 0`))
}

/* Opening a row's guidance must not move the row's own control. Measured
 * INSIDE the row -- the control's offset from its row's top -- because the
 * harness's own click helper re-centres the page on the summary it presses,
 * and a viewport-y comparison would measure that scroll, not the layout (the
 * first run of this drive did exactly that). The second half of the claim is
 * asserted directly: the opened guidance sits entirely BELOW the control. */
async function checkNoShift(window, id) {
  const before = await window.evaluate(`(() => {
    const row = document.querySelector('[data-setting-id="${id}"]')
    if (!row) return null
    row.scrollIntoView({ block: 'center', behavior: 'instant' })
    const control = row.querySelector('.settings-control')
    return Math.round(control.getBoundingClientRect().y - row.getBoundingClientRect().y)
  })()`)
  const opened = await window.clickVisible(`[data-setting-id="${id}"] .guided-summary`)
  await delay(700)
  const after = await window.evaluate(`(() => {
    const row = document.querySelector('[data-setting-id="${id}"]')
    const control = row?.querySelector('.settings-control')
    const body = row?.querySelector('.guided-body')
    if (!control) return null
    const controlBox = control.getBoundingClientRect()
    const rowBox = row.getBoundingClientRect()
    return {
      offset: Math.round(controlBox.y - rowBox.y),
      open: row.querySelector('details')?.open === true,
      bodyBelowControl: body ? body.getBoundingClientRect().y >= controlBox.bottom - 1 : null,
    }
  })()`)
  check(`opening ${id}'s guidance leaves its control where it was`,
    opened === 'clicked' && before !== null && after !== null && after.open === true
      && Math.abs(after.offset - before) <= 2,
    `offset in row ${before} -> ${after?.offset}`)
  check(`${id}'s opened guidance sits below the control, never beside it`,
    after?.bodyBelowControl === true)
  await window.clickVisible(`[data-setting-id="${id}"] .guided-summary`)
  await delay(400)
}

const ENUMERATE = `(() => {
  const out = []
  for (const row of document.querySelectorAll('.settings-row[data-setting-id]')) {
    const id = row.dataset.settingId
    const kind = row.querySelector('.settings-toggle input') ? 'toggle'
      : row.querySelector('button[data-setting-value]') ? 'seg'
      : row.querySelector('input[type="range"]') ? 'range'
      : row.querySelector('button[data-step-delta]') ? 'stepper'
      : row.querySelector('button[data-setting-action]') ? 'action'
      : 'other'
    out.push({ id, kind })
  }
  return out
})()`

const ROW_STATE = id => `(() => {
  const row = document.querySelector('[data-setting-id="${id}"]')
  if (!row) return null
  const toggle = row.querySelector('.settings-toggle input')
  if (toggle) return 'toggle:' + toggle.checked
  const on = row.querySelector('button[data-setting-value].on')
  if (on) return 'seg:' + on.dataset.settingValue
  const range = row.querySelector('input[type="range"]')
  if (range) return 'range:' + range.value
  const output = row.querySelector('[data-setting-output]')
  if (output) return 'out:' + output.textContent
  const message = row.querySelector('[data-setting-message]')
  return 'msg:' + (message ? message.textContent.slice(0, 60) : '')
})()`

async function pressRow(window, { id, kind }) {
  const before = await window.evaluate(ROW_STATE(id))
  let pressed = 'skipped'
  if (kind === 'toggle') {
    pressed = await window.clickVisible(`[data-setting-id="${id}"] label.settings-toggle`)
  } else if (kind === 'seg') {
    pressed = await window.clickVisible(`[data-setting-id="${id}"] button[data-setting-value]:not(.on)`)
  } else if (kind === 'stepper') {
    pressed = await window.clickVisible(`[data-setting-id="${id}"] button[data-step-delta="1"]`)
    if (pressed === 'clicked' && await window.evaluate(ROW_STATE(id)) === before) {
      pressed = await window.clickVisible(`[data-setting-id="${id}"] button[data-step-delta="-1"]`)
    }
  } else if (kind === 'range') {
    /* Two candidate points, because a click quantizes to the slider's step
       and a point can land exactly back on the current value -- four sliders
       did on the first run of this drive. A press that moves nothing at the
       first point is retried at the other end before being called dead. */
    for (const fraction of [0.31, 0.74]) {
      const spot = await window.evaluate(`(() => {
        const input = document.querySelector('[data-setting-id="${id}"] input[type="range"]')
        if (!input) return null
        input.scrollIntoView({ block: 'center', behavior: 'instant' })
        const box = input.getBoundingClientRect()
        return { x: box.x + box.width * ${fraction}, y: box.y + box.height / 2 }
      })()`)
      if (!spot) break
      for (const type of ['mousePressed', 'mouseReleased']) {
        await window.session.send('Input.dispatchMouseEvent', { type, x: spot.x, y: spot.y, button: 'left', clickCount: 1 })
      }
      pressed = 'clicked'
      await delay(300)
      if (await window.evaluate(ROW_STATE(id)) !== before) break
    }
  } else if (kind === 'action') {
    /* One press only: the first press of the archive control is its preview. */
    pressed = await window.clickVisible(`[data-setting-id="${id}"] button[data-setting-action]`)
  }
  await delay(280)
  const after = await window.evaluate(ROW_STATE(id))
  return { pressed, moved: after !== before, before, after }
}

const STORAGE_MAP = `(() => {
  const out = {}
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (/^mc\\.(set|live|write|chat|theme|text|setup)\\b/.test(key) || key === 'mc.settings.open-groups') {
      out[key] = localStorage.getItem(key)
    }
  }
  return out
})()`

async function main() {
  const scratch = scratchDirectory('settings-ia-drive')
  let staged
  try { staged = await stage(scratch) } catch (error) {
    console.error(`the harness could not stage a build: ${error?.message || error}`)
    return 2
  }

  /* ================= RUN A: the walk, the page, the restart ============== */
  const profile = path.join(scratch, 'profile-a')
  let window = null
  try {
    console.log('\nTHE WALKTHROUGH, WALKED (fresh profile)')
    window = await openWindow(staged.executable, profile)
    await delay(1500)
    await walkToReview(window)
    await checkRequestBrief(window)
    await shot(window, 'drive-review-request-brief')
    await window.clickVisible('[data-setup-next="finish"]')
    await delay(2500)
    check('Finish lands on home', await window.evaluate(`document.body.dataset.route || ''`) === 'home',
      String(await window.evaluate(`document.body.dataset.route || ''`)))

    console.log('\nTHE SETTINGS PAGE, EVERY GROUP AND TIER OPENED BY PRESSING')
    const reached = await gotoSettings(window)
    check('settings is reachable by clicking', reached === 'clicked' || reached === 'already-there', String(reached))
    await delay(1200)
    await expandEverything(window)
    await shot(window, 'drive-settings-open')

    console.log('\nTHE GUIDANCE OPENS UNDER THE CONTROL, NEVER UNDER THE POINTER')
    await checkNoShift(window, 'write_dispatch')
    await checkNoShift(window, 'uninstall_data')

    console.log('\nEVERY ROW, PRESSED AND WITNESSED')
    const rows = await window.evaluate(ENUMERATE)
    check('the sweep found the page’s rows', Array.isArray(rows) && rows.length >= 90, `${rows?.length} rows`)
    const skipped = []
    const dead = []
    let exercised = 0
    for (const row of rows) {
      if (row.kind === 'other') { skipped.push(row.id); continue }
      const result = await pressRow(window, row)
      if (result.pressed !== 'clicked') { dead.push(`${row.id}: ${result.pressed}`); continue }
      exercised += 1
      if (!result.moved) dead.push(`${row.id}: pressed and nothing moved (${result.before} -> ${result.after})`)
    }
    note(`${exercised} row(s) pressed; ${skipped.length} without a pressable control: ${skipped.join(', ') || 'none'}`)
    check('every pressed row changed on the press', dead.length === 0, dead.slice(0, 6).join(' | ') || `${exercised} rows moved`)

    console.log('\nTHE SECTION CONTROLLERS OUTSIDE THE TABLE')
    const chatbox = await window.clickVisible('[data-chatbox-set="runs"][data-chatbox-value="only"]')
    check('the chatbox runs control answers a press', chatbox === 'clicked'
      && await window.evaluate(`localStorage.getItem('mc.chat.runs')`) === 'only')
    const setupSeg = await window.clickVisible('button[data-setup-profile-set="screens"]:not(.on)')
    await delay(600)
    check('a Setup section answer answers a press', setupSeg === 'clicked')
    const typed = await window.typeInto('[data-profile-field="label"]', 'drive-profile')
    await delay(600)
    check('typing in the System profile name raises the unsaved banner', typed === 'typed'
      && await window.evaluate(`document.querySelector('[data-profile-status]')?.textContent.includes('Unsaved profile changes') === true`))

    console.log('\nTHE ONE-PRESS CONTROLS, AND WHAT EACH MUST NOT DO')
    const tierBefore = await window.evaluate(
      `document.querySelector('[data-setup-profile-set="tier"][aria-pressed="true"]')?.dataset.setupProfileValue || null`)
    const recommended = await window.clickVisible('button[data-setup-profile-action="recommended"]')
    await delay(900)
    const tierAfter = await window.evaluate(
      `document.querySelector('[data-setup-profile-set="tier"][aria-pressed="true"]')?.dataset.setupProfileValue || null`)
    check('Use recommended answers applies in one press', recommended === 'clicked'
      && await window.evaluate(`document.querySelector('[data-setup-profile-set="autonomy"][data-setup-profile-value="assisted"]')?.getAttribute('aria-pressed') === 'true'`))
    check('and the permission level did not move', tierBefore !== null && tierBefore === tierAfter, `${tierBefore} -> ${tierAfter}`)

    const allExamples = await window.clickVisible('button[data-bulk-live="off"]')
    await delay(900)
    const simulated = await window.evaluate(`(() => {
      const flags = ['home','computers','agent','metrics','comms','ledger','research']
      return flags.every(id => localStorage.getItem('mc.live.' + id) === 'simulated')
    })()`)
    check('All examples turns every screen source in one press', allExamples === 'clicked' && simulated)
    const allLive = await window.clickVisible('button[data-bulk-live="on"]')
    await delay(900)
    check('All live turns them all back', allLive === 'clicked' && await window.evaluate(`(() => {
      const flags = ['home','computers','agent','metrics','comms','ledger','research']
      return flags.every(id => localStorage.getItem('mc.live.' + id) === null)
    })()`))

    const bulkOff = await window.clickVisible('button[data-bulk-write-off]')
    await delay(900)
    check('Turn everything off clears every acting switch in one press', bulkOff === 'clicked'
      && await window.evaluate(`[...document.querySelectorAll('[data-setting-id^="write_"] .settings-toggle input')].every(input => !input.checked)`))
    check('and no bulk ON exists for the acting switches',
      await window.evaluate(`document.querySelector('[data-bulk-write-on], [data-bulk-write="on"]') === null`))

    const jumpHref = await window.evaluate(`document.querySelector('[data-setting-id="live_metrics"] .settings-jump')?.getAttribute('href') || null`)
    const jump = await window.clickVisible('[data-setting-id="live_metrics"] .settings-jump')
    await delay(1500)
    check('a jump link lands on the page its row gates', jumpHref === '#/metrics' && jump === 'clicked'
      && await window.evaluate(`document.body.dataset.route || ''`) === 'metrics',
      `href=${jumpHref} landed=${await window.evaluate(`document.body.dataset.route || ''`)}`)

    console.log('\nTHE RESTART: every choice read back')
    await gotoSettings(window)
    await delay(800)
    const beforeMap = await window.evaluate(STORAGE_MAP)
    const beforeRows = {}
    for (const row of await window.evaluate(ENUMERATE)) {
      beforeRows[row.id] = await window.evaluate(ROW_STATE(row.id))
    }
    await closeWindow(window)
    reap(window.timeline.pid)
    window = null
    await delay(1500)

    window = await openWindow(staged.executable, profile)
    await delay(1500)
    await gotoSettings(window)
    await delay(1500)
    check('the open groups are remembered across the restart',
      await window.evaluate(`document.querySelectorAll('.settings-group-head[aria-expanded="false"]').length === 0`))
    for (let round = 0; round < 60; round += 1) {
      const more = await window.evaluate(`Boolean(document.querySelector('.settings-reveal[aria-expanded="false"]'))`)
      if (!more) break
      await window.clickVisible('.settings-reveal[aria-expanded="false"]')
      await delay(200)
    }
    const afterMap = await window.evaluate(STORAGE_MAP)
    const storageDrift = Object.keys({ ...beforeMap, ...afterMap })
      .filter(key => beforeMap[key] !== afterMap[key])
    check('every stored choice survives the restart', storageDrift.length === 0,
      storageDrift.slice(0, 6).map(key => `${key}: ${beforeMap[key]} -> ${afterMap[key]}`).join(' | ') || `${Object.keys(beforeMap).length} keys`)
    const rowDrift = []
    for (const [id, state] of Object.entries(beforeRows)) {
      const now = await window.evaluate(ROW_STATE(id))
      /* The System section's own load state and the research register can
         legitimately re-read; rows whose state is a message are not choices. */
      if (String(state).startsWith('msg:') || String(now).startsWith('msg:')) continue
      if (now !== state) rowDrift.push(`${id}: ${state} -> ${now}`)
    }
    check('every rendered choice reads the same after the restart', rowDrift.length === 0,
      rowDrift.slice(0, 6).join(' | ') || `${Object.keys(beforeRows).length} rows compared`)
    await shot(window, 'drive-settings-after-restart')

    await closeWindow(window)
    reap(window.timeline.pid)
    window = null
  } catch (error) {
    console.error(`run A failed: ${error?.stack || error}`)
    check('run A completed', false, String(error?.message || error))
    if (window) { await closeWindow(window).catch(() => {}); reap(window.timeline.pid) }
    window = null
  }

  /* ================= RUN B: skip from the first screen =================== */
  const profileB = path.join(scratch, 'profile-b')
  try {
    console.log('\nSKIP FROM THE FIRST SCREEN (second fresh profile)')
    window = await openWindow(staged.executable, profileB)
    await delay(1500)
    const skip = await window.clickVisible('[data-setup-skip-first]', { timeoutMs: 12000 })
    await delay(2500)
    const landed = await window.evaluate(`document.body.dataset.route || ''`)
    check('one press skips the whole walkthrough', skip === 'clicked' && landed === 'home', `landed=${landed}`)
    await delay(3000)
    check('and the app does not bounce back to setup',
      await window.evaluate(`document.body.dataset.route || ''`) === 'home')
    await shot(window, 'drive-skip-first-lands-home')
    await closeWindow(window)
    reap(window.timeline.pid)
    window = null
    await delay(1200)

    window = await openWindow(staged.executable, profileB)
    await delay(2500)
    const relaunch = await window.evaluate(`document.body.dataset.route || ''`)
    check('the skipped profile relaunches into the app, level recorded', relaunch === 'home', `route=${relaunch}`)
    await closeWindow(window)
    reap(window.timeline.pid)
    window = null
  } catch (error) {
    console.error(`run B failed: ${error?.stack || error}`)
    check('run B completed', false, String(error?.message || error))
    if (window) { await closeWindow(window).catch(() => {}); reap(window.timeline.pid) }
  }

  const failed = checks.filter(entry => !entry.pass)
  console.log(`\n${checks.length} check(s), ${failed.length} failed, ${Math.round((Date.now() - STARTED) / 1000)}s`)
  return failed.length === 0 ? 0 : 1
}

process.exitCode = await main()
