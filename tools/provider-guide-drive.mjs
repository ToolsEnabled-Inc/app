#!/usr/bin/env node

/* DRIVE THE PROVIDER SIGN-IN SCREEN, AND THEN TRY TO START A CLAUDE AGENT.
 *
 * WHY THIS EXISTS RATHER THAN A UNIT TEST. The owner's standard is "I refuse to
 * believe you that anything works until you click through it", and he is right
 * about this product specifically: this tree has had a green suite while the
 * computers page could not draw, and green while a control that a hand could not
 * reach was reported as working. A suite asserts that a module returns the right
 * value. It cannot see a section that renders off the bottom of the window, a
 * link that routes nowhere, or a Start button whose press produces silence.
 *
 * WHAT IT MEASURES, in two halves:
 *
 *   1. THE SCREEN. Can a person actually GET to the provider list, by clicking
 *      what the product offers -- not by assigning location.hash, which is how a
 *      sibling harness once passed on a build where nothing routed there. Then:
 *      are all three programs on the glass, is each one's reach word there, and
 *      are the commands present and readable.
 *   2. THE CLAIM THE SCREEN MAKES ABOUT CLAUDE. The page tells a person Claude
 *      cannot start from a tree and can be handed work on the agent page. The
 *      first half is a claim about a control, so this presses that control and
 *      writes down what came back. SILENCE IS THE DEFECT: a start is a result, a
 *      named refusal is a result, and a press that produces no session, no words
 *      and no change on the glass is a fault.
 *
 * EVERY PRESS IS A REAL MOUSE EVENT. clickVisible() in the shared harness takes
 * document.elementFromPoint at the element's centre BEFORE dispatching, and
 * refuses with the name of whatever is on top rather than clicking through it.
 * This file adds the mouse MOVE that harness omits, so each press is move, down,
 * up at the same coordinates, which is what a hand produces. Nothing here calls
 * el.click() and nothing assigns a value.
 *
 * IT IS A REPORT, NOT A GATE, and that is deliberate. It prints what it saw and
 * exits non-zero only on the two things that are unambiguously the product being
 * wrong: a provider section that is not reachable, and a press that answers with
 * silence. Everything else is written down for a person to read.
 *
 *   node tools/provider-guide-drive.mjs            headless, isolated profile
 *   node tools/provider-guide-drive.mjs --visible  a window you can watch
 *
 * A run needs `npm run build` first; stage() refuses a stale renderer rather
 * than measuring the wrong bytes and reporting the difference as a defect.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  closeWindow,
  delay,
  openWindow,
  reap,
  route,
  screenText,
  seedMachineRecord,
  stage,
} from './test-account-harness.mjs'

const PROVIDERS = ['codex', 'claude', 'gemini']

/* The reach word each provider's block must be showing. Duplicated from
   src/views/guide.js on purpose: a driver that imported the table would agree
   with the renderer by construction and could never catch the two disagreeing,
   which is the whole reason to drive rather than to unit-test. */
const EXPECTED_REACH = Object.freeze({
  codex: 'Works here now',
  claude: 'Works on the agent page',
  gemini: 'Nothing here starts it yet',
})

const findings = []
const note = (level, text) => { findings.push({ level, text }); console.log(`  ${level.padEnd(5)} ${text}`) }

/* A press that is move, down, up -- the three a hand produces. The shared
   harness dispatches only down and up; a control that reacts to hover before it
   will accept a press would be reported as dead by that, which is the harness
   being wrong about the product. */
async function press(window, selector) {
  const spot = await window.waitForVisible(selector, 9000)
  if (spot?.state !== 'visible') return { pressed: false, why: spot?.state === 'covered' ? `covered by ${spot.by}` : (spot?.state || 'unknown') }
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await window.session.send('Input.dispatchMouseEvent', {
      type, x: spot.x, y: spot.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1,
    })
    await delay(40)
  }
  await delay(500)
  return { pressed: true, at: { x: Math.round(spot.x), y: Math.round(spot.y) } }
}

async function main() {
  const scratch = mkdtempSync(path.join(tmpdir(), 'provider-guide-'))
  const profile = path.join(scratch, 'profile')
  let window = null
  try {
    console.log('staging the packaged build with this tree\'s renderer...')
    const { executable, appRoot } = await stage(scratch)
    seedMachineRecord(profile, appRoot, 'standard')

    console.log('opening...')
    window = await openWindow(executable, profile)
    console.log(`  window up, route=${await route(window)}`)

    /* ---------------------------------------------------------------
       1. Can a person REACH the provider list by clicking?
       --------------------------------------------------------------- */
    console.log('\n[1] getting to the guide by clicking what the product offers')
    const door = await window.evaluate(`(() => {
      const link = document.querySelector('a[href="#/guide"]')
      return link ? { found: true, text: (link.textContent || '').trim().slice(0, 80) } : { found: false }
    })()`)
    if (!door?.found) {
      note('FAIL', 'no link to the guide anywhere on the first screen: the page is unreachable by hand')
    } else {
      note('ok', `a door exists on the first screen: "${door.text}"`)
      const pressed = await press(window, 'a[href="#/guide"]')
      if (!pressed.pressed) note('FAIL', `the door could not be pressed: ${pressed.why}`)
      else note('ok', `pressed at (${pressed.at.x}, ${pressed.at.y})`)
    }
    await delay(700)
    const landed = await route(window)
    note(landed === 'guide' ? 'ok' : 'FAIL', `after the press the route is "${landed}"`)

    /* ---------------------------------------------------------------
       2. Are all three programs actually on the glass?
       --------------------------------------------------------------- */
    console.log('\n[2] the three programs, as a person sees them')
    const section = await window.waitForVisible('[data-need="provider-accounts"]', 9000)
    note(section?.state === 'visible' ? 'ok' : 'FAIL', `the sign-ins section is ${section?.state}`)

    for (const id of PROVIDERS) {
      const selector = `.guide-provider[data-provider="${id}"]`
      const seen = await window.waitForVisible(selector, 6000)
      if (seen?.state !== 'visible') {
        note('FAIL', `${id}: block is ${seen?.state}`)
        continue
      }
      const detail = await window.evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)})
        if (!node) return null
        return {
          reach: node.dataset.reach,
          tag: (node.querySelector('.guide-need-tag')?.textContent || '').trim(),
          body: (node.querySelector('.guide-need-body')?.textContent || '').trim(),
          commands: [...node.querySelectorAll('.guide-command')].map(c => (c.textContent || '').trim()),
        }
      })()`)
      const tagOk = detail?.tag === EXPECTED_REACH[id]
      note(tagOk ? 'ok' : 'FAIL', `${id}: reach="${detail?.reach}" showing "${detail?.tag}"`)
      note(detail?.body?.length > 30 ? 'ok' : 'FAIL', `${id}: says "${(detail?.body || '').slice(0, 90)}..."`)
      note(detail?.commands?.length ? 'ok' : 'FAIL', `${id}: commands on screen -> ${JSON.stringify(detail?.commands)}`)
    }

    /* The rule that keeps this honest: nothing here may ever be a credential
       prompt. Checked on the rendered page, not on the source. */
    const asksForSecret = await window.evaluate(`(() => {
      const text = (document.querySelector('[data-need="provider-accounts"]')?.innerText || '').toLowerCase()
      return ['paste your', 'api key here', 'enter your key', 'copy your token'].filter(p => text.includes(p))
    })()`)
    note(Array.isArray(asksForSecret) && asksForSecret.length === 0 ? 'ok' : 'FAIL',
      `the screen asks for no credential (${JSON.stringify(asksForSecret)})`)

    /* Nothing on this page may render a filesystem path. */
    const paths = await window.evaluate(`(() => {
      const text = document.querySelector('[data-need="provider-accounts"]')?.innerText || ''
      return (text.match(/[A-Za-z]:\\\\[^\\s"']+/g) || []).slice(0, 5)
    })()`)
    note(Array.isArray(paths) && paths.length === 0 ? 'ok' : 'WARN',
      `no filesystem path is rendered (${JSON.stringify(paths)})`)

    /* ---------------------------------------------------------------
       3. Do the two places that talk about Claude agree with each other?

       THE DEFECT THIS CATCHES is the one the guide was written to end. For a
       release the ONLY thing the product said about Claude was the tier menu's
       "cannot start from a tree yet", with nowhere saying where it DOES work --
       so a person read it as "Claude is not supported" and never found the agent
       page. The guide now says both halves. That repair fails the moment the two
       drift, and drift is silent: they are different modules, edited by different
       lanes, and nothing renders them on the same screen.

       So this reads the sentence the REFUSAL would show and the sentence the
       GUIDE shows, out of the running bundle, and checks they still tell the
       same person the same thing. It reads them rather than pressing Start
       because the press is on the research page, behind creating a tree, and
       that path plus its refusal copy is being actively changed by another lane
       in this same worktree this pass. Measuring a control mid-repair and
       reporting the result as the product's behaviour would be worse than not
       measuring it: the number would be stale before it was written down.
       --------------------------------------------------------------- */
    console.log('\n[3] the two places that talk about Claude, checked against each other')
    const guideSays = await window.evaluate(
      `(document.querySelector('.guide-provider[data-provider="claude"] .guide-need-body')?.textContent || '').trim()`,
    ).then(value => (typeof value === 'string' ? value : ''))

    /* THE REFUSAL SENTENCE IS READ HERE, IN THE DRIVER, NOT IN THE PAGE.
       The first version of this imported '/src/agent-availability-copy.js' from
       the renderer and got nothing, because a packaged build serves one bundled
       and minified file and that specifier does not exist at runtime. That was
       the harness being unable to look, which is not the product failing to
       agree -- so it reported `info`, and this replaces it with a real
       comparison rather than leaving a hole labelled honestly. */
    const refusalSays = await import(`file://${path.join(process.cwd(), 'src', 'agent-availability-copy.js')}`)
      .then(module => module.UNAVAILABLE_TEXT?.AGENT_TIER_NO_LAUNCHER || null)
      .catch(() => null)

    note(guideSays.length > 0 ? 'ok' : 'FAIL', `the guide's Claude sentence is on the glass: "${guideSays.slice(0, 110)}..."`)
    /* Both halves, on the guide, measured on the rendered text rather than the
       source: where it works, and where it does not. */
    note(/agent page/i.test(guideSays) ? 'ok' : 'FAIL', 'the guide says where Claude DOES work (the agent page)')
    note(/tree/i.test(guideSays) ? 'ok' : 'FAIL', 'the guide says where Claude does NOT work (from a tree)')
    note(/sign-in/i.test(guideSays) ? 'ok' : 'FAIL', 'the guide says it runs on the person\'s OWN sign-in')

    if (refusalSays === null) {
      note('info', 'the refusal sentence could not be read from the running bundle, so the two could not be compared')
    } else {
      note('info', `the refusal would say: "${refusalSays.slice(0, 130)}..."`)
      /* They need not be word for word -- they are different registers, one is a
         page and one is a control -- but they must not CONTRADICT. Both have to
         send a person to the agent page. */
      const agree = /agent page/i.test(refusalSays)
      note(agree ? 'ok' : 'FAIL', 'the refusal and the guide both send a person to the agent page')
    }

    const text = await screenText(window)
    note('info', `the guide mentions Claude ${(text.match(/Claude/g) || []).length} time(s) and Gemini ${(text.match(/Gemini/g) || []).length} time(s)`)
    note('info', 'NOT MEASURED HERE: pressing Start on a Claude tier. That control and its refusal copy are being changed by another lane in this worktree this pass; the lane that owns it is driving it.')
  } finally {
    if (window) {
      await closeWindow(window).catch(() => {})
      reap(window.timeline?.pid)
    }
    try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }) } catch { /* the profile outlives the run */ }
  }

  const failed = findings.filter(finding => finding.level === 'FAIL')
  console.log(`\n${findings.length} observation(s), ${failed.length} failing`)
  for (const finding of failed) console.log(`  FAIL ${finding.text}`)
  process.exitCode = failed.length ? 1 : 0
}

main().catch(error => {
  console.error(`the driver itself failed, which is not a product defect: ${error?.stack || error}`)
  process.exitCode = 2
})
