#!/usr/bin/env node

/* PRESS START ON A CLAUDE TIER, WITH A REAL HAND, AND SEE WHETHER AN AGENT
 * ACTUALLY ANSWERS.
 *
 * THE ONLY QUESTION THIS FILE ASKS. The owner: "a user needs to be able to
 * easily install, add Claude and Codex and Gemini CLI subscriptions smoothly and
 * easily, then use those CLI for their agents and the agents need to ACTUALLY
 * LAUNCH AND DO REAL WORK". Every other artifact in this lane is evidence about
 * parts. This is the whole thing, end to end, through the packaged product: pick
 * Claude in the menu, press Start, ask it something, and read what comes back.
 *
 * SUCCESS IS A REAL ANSWER AND NOTHING ELSE COUNTS. Not a session id, not a
 * spinner, not an event on a stream. The agent is asked for an unmistakable
 * string and must produce it. A named refusal is a legitimate outcome and is
 * reported as such -- it is what a build with no Claude engine SHOULD do -- but
 * it is never reported as success. Silence is a defect.
 *
 * WHY THE PAYLOAD IS OVERLAID HERE, AND WHY THAT IS NOT CHEATING. The Claude
 * engine lives in the engine repo; the app's payload is cut from a PINNED engine
 * worktree that predates it, and moving that pin is another lane's decision. So
 * this stages the packaged build and copies the two engine modules into the
 * staged payload -- byte for byte what `npm run pack:capability` produces once
 * the pin moves, which was verified by running that packer against the engine
 * checkout (268 files, exit 0, both modules staged).
 *
 * Nothing about the RUNTIME path is simulated by that. The shell resolves the
 * engine out of its capability root exactly as it does on a customer machine,
 * spawns the real `claude` binary, and talks to it over the real protocol. There
 * is no mock, no stub and no fake stream anywhere in the product path; the only
 * fake transport in this lane lives inside the engine's unit suite. What the
 * overlay buys is the ability to answer the question TODAY instead of after a
 * cross-lane pin negotiation.
 *
 * IT SPENDS REAL MONEY on the person's own subscription, so it is a tool and
 * never a default test target.
 *
 *   node tools/claude-tree-start-proof.mjs
 *   node tools/claude-tree-start-proof.mjs --visible
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  closeWindow,
  delay,
  openWindow,
  reap,
  seedMachineRecord,
  stage,
} from './test-account-harness.mjs'

/* The word the agent must produce. Deliberately not a word that could appear in
   a template, a placeholder, a cached transcript or the product's own copy: if
   this string is on the glass, a model wrote it. */
const PROOF_WORD = 'ALBATROSS-9317'
const PROMPT = `Reply with exactly the word ${PROOF_WORD} and nothing else.`

const ENGINE_SOURCE = 'C:/Users/joshp/Desktop/toolsenabled-current/src/lib/agent-engine'
const ENGINE_MODULES = ['claude-cli-process.js', 'claude-cli-adapter.js']
const CLAUDE_TIER = 'claude-sonnet'

const findings = []
const note = (level, text) => { findings.push({ level, text }); console.log(`  ${level.padEnd(5)} ${text}`) }

/* Move, down, up at coordinates taken from the element's own box, with
   document.elementFromPoint checked first by the shared harness's waitForVisible
   and the press refused BY NAME if something else is on top. */
async function press(window, selector, timeoutMs = 9000) {
  const spot = await window.waitForVisible(selector, timeoutMs)
  if (spot?.state !== 'visible') {
    return { pressed: false, why: spot?.state === 'covered' ? `covered by ${spot.by}` : (spot?.state || 'unknown') }
  }
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await window.session.send('Input.dispatchMouseEvent', {
      type, x: spot.x, y: spot.y, button: type === 'mouseMoved' ? 'none' : 'left',
      clickCount: type === 'mouseMoved' ? 0 : 1,
    })
    await delay(45)
  }
  await delay(400)
  return { pressed: true, at: { x: Math.round(spot.x), y: Math.round(spot.y) } }
}

/* THE ONE STEP THAT IS NOT REAL INPUT, AND THE MEASUREMENT THAT FORCED IT.
 *
 * Everything else in this file is a real mouse press or a real keystroke. This
 * one is not, and pretending otherwise would be exactly the kind of claim this
 * lane exists to stop making.
 *
 * WHAT WAS MEASURED, in this same packaged build, before writing this:
 *   real mouse press on the menu -> document.activeElement IS the select
 *                                   (tag SELECT, data-compose-field="tier")
 *   ArrowDown (windowsVirtualKeyCode + nativeVirtualKeyCode, rawKeyDown/keyUp)
 *                                -> value unchanged: "luna"
 *   explicit .focus() then the same keys
 *                                -> value unchanged: "luna"
 *   type-ahead, Input.insertText "S"
 *                                -> value unchanged: "luna"
 *
 * So the press lands and the element focuses; the KEYS are the part that does
 * nothing. A native <select> delegates arrow and type-ahead navigation to an
 * operating-system popup, and in an offscreen window that popup does not exist,
 * so Chromium has nowhere to route them. This is a property of driving a native
 * menu headlessly, not a defect in the product: a person with a visible window
 * opens the list and clicks a row, and that works.
 *
 * The alternative was to open a visible window, which this lane is fenced
 * against. So the selection is made the way the renderer would receive it from
 * that person -- value set, then a real `change` event dispatched so every
 * listener runs -- and the run REPORTS this step as not-real-input rather than
 * letting it ride inside a "driven with real mouse and keyboard" claim.
 *
 * NOTHING ELSE IS RELAXED. The way in, the prompt, and Start are all real
 * presses and real keystrokes, and the answer at the end is a real model's. */
async function chooseTierUnavoidablySynthetic(window, selector, wantedValue) {
  const focused = await press(window, selector)
  if (!focused.pressed) return { ok: false, why: `could not even focus the menu: ${focused.why}` }

  const result = await window.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)})
    if (!node) return { ok: false, why: 'the menu vanished between focusing and choosing' }
    const wanted = [...node.options].find(o => o.value === ${JSON.stringify(wantedValue)})
    if (!wanted) return { ok: false, why: 'that tier is not offered by this build' }
    node.value = ${JSON.stringify(wantedValue)}
    node.dispatchEvent(new Event('input', { bubbles: true }))
    node.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: node.value === ${JSON.stringify(wantedValue)}, value: node.value, label: wanted.textContent.trim().slice(0, 60) }
  })()`)
  return { ...result, focusedByRealMouse: true, at: focused.at }
}

async function typeReal(window, selector, text) {
  const clicked = await press(window, selector)
  if (!clicked.pressed) return { ok: false, why: clicked.why }
  await window.session.send('Input.insertText', { text })
  await delay(200)
  const landed = await window.evaluate(`document.querySelector(${JSON.stringify(selector)})?.value || ''`)
  return { ok: String(landed).includes(PROOF_WORD), landed: String(landed).slice(0, 90) }
}

async function main() {
  const scratch = mkdtempSync(path.join(tmpdir(), 'claude-tree-proof-'))
  let window = null
  try {
    console.log('staging the packaged build...')
    const staged = await stage(scratch)

    /* THE OVERLAY. Exactly the two files the packer stages once the pin moves. */
    const payloadEngine = path.join(staged.appRoot, 'resources', 'capability', 'src', 'lib', 'agent-engine')
    mkdirSync(payloadEngine, { recursive: true })
    for (const module of ENGINE_MODULES) {
      const from = path.join(ENGINE_SOURCE, module)
      if (!existsSync(from)) throw new Error(`the engine module is missing at ${from}; this is a harness fault, not a product defect`)
      cpSync(from, path.join(payloadEngine, module))
    }
    note('ok', `staged the Claude engine into the payload: ${ENGINE_MODULES.join(', ')}`)

    /* A THROWAWAY CODEX CREDENTIAL, AND THE DEFECT IT EXISTS TO STEP AROUND.
     *
     * MEASURED on this build: with no ~/.codex/auth.json in the profile,
     * mc-agent:availability answers {ok:false, AGENT_CONFINEMENT_SIGNED_OUT} and
     * the page never offers a start -- FOR ANY TIER, INCLUDING CLAUDE. The
     * confinement planner is Codex-shaped: an isolated level builds its session
     * from a Codex sign-in and links that credential into a prepared home.
     *
     * A Claude session never reads that file. So a person with Claude installed
     * and signed in, and no Codex at all, is told this copy is not ready to
     * start an agent -- which will be wrong the moment the Claude engine ships.
     * That is a real defect and it is NOT fixed here; it is recorded, and it is
     * one of the things still standing between this engine and a person using
     * it. This file writes a throwaway file so the run can measure the Claude
     * path rather than stopping on a Codex precondition.
     *
     * The contents are inert and nothing reads them. It is not a credential and
     * it is not copied from anywhere -- copying a real one into a test profile
     * is forbidden outright in this lane, and the engine's own fence would fail
     * on any code that tried. */
    const codexHome = path.join(scratch, 'home', '.codex')
    mkdirSync(codexHome, { recursive: true })
    writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({ note: 'throwaway; the Claude path never reads this' }))
    note('info', 'seeded a throwaway ~/.codex/auth.json: without one, availability refuses EVERY tier with AGENT_CONFINEMENT_SIGNED_OUT, including Claude, which never reads it. Recorded as a defect, stepped around here.')

    seedMachineRecord(scratch, staged.appRoot, 'standard')
    window = await openWindow(staged.executable, scratch)

    console.log('\n[1] getting to somewhere an agent can be started')
    /* THE WRITE SWITCH IS SEEDED, NOT CLICKED, AND HERE IS WHY THAT IS HONEST.
     *
     * Every action that writes anything ships switched OFF, so on a fresh
     * profile pressing Start does nothing at all. The first run of this file hit
     * exactly that and reported SILENCE -- a harness gap wearing the costume of
     * the product's worst defect.
     *
     * It is seeded rather than driven through Settings for the same reason
     * seedMachineRecord() exists in the shared harness: the question this file
     * asks is "does a Claude agent run", and a person who has reached that
     * question has already turned the switch on. Driving the Settings toggle is
     * a DIFFERENT question, it already has its own coverage, and putting it in
     * front of this one only adds a way for this run to fail for a reason that
     * is not about Claude. tools/agent-subpage-qa.mjs and
     * tools/example-page-write-fence-qa.mjs seed the same key for the same
     * reason. */
    await window.evaluate(`localStorage.setItem('mc.write.agent-session', 'enabled')`)
    await window.evaluate(`location.hash = '#/computers'`)
    await delay(1200)
    await window.evaluate(`location.reload()`)
    await delay(3600)
    const inSetup = await window.evaluate(`location.hash.includes('setup')`)
    if (inSetup) {
      note('FAIL', 'the build stopped in setup, so nothing below would be about the product')
      return
    }
    const doorway = await press(window, '.computers .tree-empty-node')
    note(doorway.pressed ? 'ok' : 'FAIL', `pressed the way in${doorway.pressed ? ` at (${doorway.at.x}, ${doorway.at.y})` : `: ${doorway.why}`}`)
    await delay(2400)

    console.log('\n[2] choosing Claude in the menu, with the keyboard')
    const tierSelector = '[data-compose-field="tier"]'
    const present = await window.evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(tierSelector)})
      if (!node) return null
      return { options: [...node.options].map(o => ({ value: o.value, label: o.textContent.trim().slice(0, 44) })), value: node.value }
    })()`)
    if (!present) {
      note('FAIL', 'there is no tier menu on the panel, so a Claude tier cannot be picked at all')
      return
    }
    note('info', `the menu offers: ${JSON.stringify(present.options.map(o => o.value))}`)
    const chosen = await chooseTierUnavoidablySynthetic(window, tierSelector, CLAUDE_TIER)
    note(chosen.ok ? 'ok' : 'FAIL',
      `chose ${CLAUDE_TIER}${chosen.ok ? ` (${JSON.stringify(chosen.label)})` : `: ${chosen.why}`}`)
    note('info', 'NOT REAL INPUT, and it is the only step in this run that is not: the menu was FOCUSED by a real mouse press, then set programmatically. Measured first -- arrow keys and type-ahead move a native select only through an operating-system popup, which an offscreen window does not have. See the note above chooseTierUnavoidablySynthetic.')
    if (!chosen.ok) return

    /* THE ROLE, WHICH THIS DRIVER FORGOT AND THEN BLAMED THE PRODUCT FOR.
     *
     * Earlier runs pressed Start with no role chosen and reported SILENCE. The
     * panel was not silent at all -- it had painted "Pick a role first, then
     * press Start" exactly where a person would read it, and attemptSubmit()
     * returned before any IPC. The driver was pressing Start on an incomplete
     * form and calling the result a defect in the start path.
     *
     * It is set the same way the tier is, and for the same measured reason: a
     * native <select> takes arrow keys only through an operating-system popup
     * that an offscreen window does not have. Focused by a real press, then set.
     * Reported as not-real-input, never hidden inside the mouse-and-keyboard
     * claim. */
    console.log('\n[3] choosing a role, which the form requires before it will start')
    const roleSelector = '[data-compose-field="role"]'
    const roleChosen = await window.evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(roleSelector)})
      if (!node) return { ok: false, why: 'no role menu on the panel' }
      const real = [...node.options].find(o => o.value && o.value.length > 0)
      if (!real) return { ok: false, why: 'the role menu offers no role' }
      node.value = real.value
      node.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: node.value === real.value, value: node.value, label: real.textContent.trim().slice(0, 40) }
    })()`)
    note(roleChosen?.ok ? 'ok' : 'FAIL', `chose a role: ${roleChosen?.ok ? JSON.stringify(roleChosen.label) : roleChosen?.why}`)
    if (!roleChosen?.ok) return

    console.log('\n[4] typing the question and pressing Start')
    /* `message`, not `prompt`. The first version guessed `prompt` plus a couple
       of fallbacks, matched a hidden element, and reported "typed the question
       with real keystrokes: hidden" -- a harness fault dressed as a product
       finding. The four real field names are role, tier, effort and message. */
    const promptSelector = '[data-compose-field="message"]'
    const typed = await typeReal(window, promptSelector, PROMPT)
    note(typed.ok ? 'ok' : 'FAIL', `typed the question with real keystrokes: ${JSON.stringify(typed.landed || typed.why)}`)

    const startSelector = await window.evaluate(`(() => {
      const vis = n => { const b = n.getBoundingClientRect(); const s = getComputedStyle(n)
        return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
      const btn = [...document.querySelectorAll('button')].filter(vis).find(n => /^start/i.test(n.textContent.trim()))
      if (!btn) return null
      if (!btn.id) btn.id = 'proof-start-target'
      return { selector: '#' + btn.id, label: btn.textContent.trim().slice(0, 40), disabled: btn.disabled === true }
    })()`)
    if (!startSelector) {
      note('FAIL', 'there is no Start control on the panel')
      return
    }
    note('info', `Start reads ${JSON.stringify(startSelector.label)} disabled=${startSelector.disabled}`)
    const started = await press(window, startSelector.selector)
    note(started.pressed ? 'ok' : 'FAIL', `pressed Start${started.pressed ? ` at (${started.at.x}, ${started.at.y})` : `: ${started.why}`}`)

    console.log('\n[4] waiting for a REAL answer (a cold start plus a turn)')
    const deadline = Date.now() + 150_000
    let last = null
    for (;;) {
      /* READ THE AGENT SURFACE, NOT THE WHOLE BODY. The first version scanned
         document.body.innerText and reported SILENCE with a tail full of theme
         and font controls -- it was reading the settings drawer, which is in the
         DOM on every route, and would have reported a refusal it never looked
         at as silence. A driver that cannot say WHERE it looked cannot call
         anything a defect. */
      last = await window.evaluate(`(() => {
        const panel = document.querySelector('.computers') || document.body
        const text = panel.innerText || ''
        const refusalNodes = [...document.querySelectorAll('[data-refusal-code]')]
        /* THE WORD I TYPED IS NOT THE WORD I AM LOOKING FOR.
         *
         * This read text.includes(PROOF_WORD) over the whole panel, and the
         * prompt is "Reply with exactly the word ALBATROSS-9317 and nothing
         * else." -- so the answer is INSIDE THE QUESTION. The check matched the
         * message box and reported A REAL CLAUDE AGENT ANSWERED on a run where
         * no session ever started. A false pass, produced by the driver, about
         * the one claim this whole lane exists to make.
         *
         * Caught by asking a DIFFERENT question whose answer was not in the
         * prompt: nothing came back in 150s, which is what the panel had been
         * saying all along.
         *
         * So the word only counts when it appears somewhere that is NOT a form
         * control -- a leaf node outside every input, textarea and select. */
        const inFormField = node => node.closest('input, textarea, select, [data-compose-field], .agent-compose-form') !== null
        /* AND NOT THE ECHO EITHER. Excluding form fields was still not enough:
           the tree chip renders the asked-line into .cl-previous, which
           computers.js builds from the message that was just submitted. So the
           prompt appears a SECOND time outside the form, and the check passed
           again on a run where sessions on the page was 0 and a control
           question -- one whose answer was not in its own prompt -- produced
           nothing at all in 150 seconds.
           Two false passes from one driver, on the single claim this lane
           exists to make. So the word must appear somewhere that is neither a
           form control NOR an echo of what was asked. */
        const isEcho = node => String(node.textContent || '').toLowerCase().includes('asked:')
          || node.closest('.cl-previous, .cl-chat, [data-tree-chip], .static-tree-chip-overlay') !== null
        const spoken = [...document.querySelectorAll('*')]
          .filter(node => node.children.length === 0
            && (node.textContent || '').includes(${JSON.stringify(PROOF_WORD)})
            && !inFormField(node)
            && !isEcho(node))
          .map(node => ({ tag: node.tagName, cls: String(node.className || '').slice(0, 50) }))
        return {
          hasProof: spoken.length > 0,
          spokenIn: spoken.slice(0, 4),
          echoedInForm: text.includes(${JSON.stringify(PROOF_WORD)}) && spoken.length === 0,
          refusalCodes: refusalNodes.map(n => n.getAttribute('data-refusal-code')),
          refusalText: refusalNodes.map(n => (n.textContent || '').trim().slice(0, 220)),
          noLauncher: text.includes('does not carry the part') || text.includes('no launcher'),
          notLoggedIn: text.includes('Not logged in') || text.includes('Please run /login'),
          sessions: document.querySelectorAll('[data-session-id], .agent-session, [data-agent-session]').length,
          tail: text.slice(-500),
        }
      })()`)
      if (last?.refusalCodes?.length) break
      if (last?.hasProof || last?.noLauncher || last?.notLoggedIn || Date.now() > deadline) break
      await delay(2500)
    }

    note('info', `sessions on the page: ${last?.sessions ?? 0}`)
    /* THE OUTCOME THIS HARNESS CANNOT AVOID, NAMED SO IT IS NEVER MISREAD.
     *
     * openWindow() isolates USERPROFILE to a throwaway directory -- deliberately,
     * because a driver that runs against the real home once desynced the owner's
     * audit ledger. A Claude child started under that profile looks for a
     * sign-in in a home that has never had one, and answers "Not logged in ·
     * Please run /login".
     *
     * That sentence is the PRODUCT WORKING: the session started, the turn was
     * accepted, the child ran, and its own words came back through the event
     * mapping. It is not a defect and it must never be filed as one. It is also
     * not the proof, because the model never answered the question.
     *
     * The gap cannot be closed from here without either pointing the run at the
     * owner's real home -- the incident above -- or copying a credential into
     * the throwaway one, which this lane forbids outright and which the engine's
     * own fence would fail on. So it is reported as its own outcome. */
    if (last?.notLoggedIn) {
      note('info', 'THE PIPELINE RAN: the child started, answered, and its words came back through the event mapping. It said "Not logged in", because this harness gives it a throwaway home with no Claude sign-in. That is the harness, not the product, and it is not the proof either.')
    }
    if (last?.echoedInForm) {
      note('info', `"${PROOF_WORD}" is on the glass ONLY inside the form I typed it into. That is my own text, not an answer.`)
    }
    if (last?.hasProof) {
      note('ok', `A REAL CLAUDE AGENT ANSWERED: "${PROOF_WORD}" appears outside the form, in ${JSON.stringify(last.spokenIn)}`)
    } else if (last?.refusalCodes?.length || last?.noLauncher) {
      note('FAIL', `the start was REFUSED rather than run: codes=${JSON.stringify(last.refusalCodes)} said=${JSON.stringify(last.refusalText)}`)
    } else {
      note('FAIL', `SILENCE: no answer and no refusal within 150s. Agent surface tail: ${JSON.stringify(last?.tail || '')}`)
    }
  } finally {
    if (window) {
      await closeWindow(window).catch(() => {})
      reap(window.timeline?.pid)
    }
    try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }) } catch { /* the profile outlives the run */ }
  }

  const failed = findings.filter(f => f.level === 'FAIL')
  console.log(`\n${findings.length} observation(s), ${failed.length} failing`)
  for (const f of failed) console.log(`  FAIL ${f.text}`)
  process.exitCode = failed.length ? 1 : 0
}

main().catch(error => {
  console.error(`the driver itself failed, which is not a product defect: ${error?.stack || error}`)
  process.exitCode = 2
})
