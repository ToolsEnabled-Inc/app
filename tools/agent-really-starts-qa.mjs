#!/usr/bin/env node
/* DOES PRESSING START INSIDE THE PROGRAM ACTUALLY START AN AGENT?
 *
 * Owner, 2026-08-17: "ACTUALLY FOCUS on making AGENTS work WHEN LAUNCHED from
 * INSIDE THE PROGRAM."
 *
 * NOTHING IN THIS TREE ANSWERED THAT QUESTION. tools/agent-start-flow-qa.mjs
 * covers the surface around the control and then reports the two checks that
 * matter -- "when the start path answers with a session id, the node becomes
 * THAT session" and "a node that started now looks like it is running" -- as
 * NOT EXERCISED, because it substitutes the start reply from the page and
 * window.mcAgent is a non-configurable contextBridge property. So every gate
 * here is green on a product where pressing Start may do nothing at all, and
 * that is exactly what was reported from the running app.
 *
 * This presses the real control, lets the real IPC run, and writes down what
 * came back: the node's status, the words on the status line, the refusal code
 * if there was one, and whether a child process actually appeared. It does not
 * assume the answer should be success -- on a machine with no assistant program
 * the correct outcome is a NAMED REFUSAL, and a refusal that reaches the screen
 * is a pass. The failure this exists to catch is SILENCE: a press that produces
 * no session, no refusal, and no change on screen.
 *
 *   node tools/agent-really-starts-qa.mjs --release <win-unpacked>
 */
import path from 'node:path'
import { closeWindow, createLedger, delay, openWindow, releaseDirectory, scratchDirectory, seedMachineRecord, stage } from './test-account-harness.mjs'

const READ = `(() => {
  const vis = n => { if (!n) return false; const b = n.getBoundingClientRect(); const s = getComputedStyle(n)
    return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
  const txt = n => (n ? n.textContent.replace(/\\s+/g, ' ').trim() : '')
  const nodes = [...document.querySelectorAll('.computers .static-tree-node')]
  const slots = [...document.querySelectorAll('.computers .tree-empty-node')]
  const status = document.querySelector('[data-org-status], .org-status, [role="status"]')
  return {
    agentNodes: nodes.length,
    slots: slots.length,
    slotVisible: slots.filter(vis).length,
    nodeStatuses: nodes.map(n => n.getAttribute('data-status') || n.className).slice(0, 6),
    statusLine: txt(status).slice(0, 400),
    stageText: (document.querySelector('.stage') || document.body).innerText.replace(/\\s+/g, ' ').trim().slice(0, 700),
  }
})()`

async function main() {
  const scratch = scratchDirectory('agent-really-starts')
  /* `--installed` USED TO EXIST HERE. IT IS REFUSED, AND THIS IS WHY.
   *
   * It launched `%LOCALAPPDATA%\\Programs\\ToolsEnabled` directly, so the run
   * would exercise the exact bytes on the owner's desktop rather than a
   * restaged copy. The reasoning was sound and the mechanism was not: the
   * window was isolated with `--user-data-dir`, but the ENVIRONMENT was
   * isolated with APPDATA/LOCALAPPDATA/USERPROFILE -- and Electron resolves
   * appData through the Win32 shell API, NOT the environment. So the
   * capability layer the app spawned wrote into the owner's REAL
   * %APPDATA%\\ToolsEnabled\\capability.
   *
   * Measured cost, 2026-08-17: mission-bridge-{bootstrap-proof,runtime,token}
   * .json rewritten at 12:38 and audit.sqlite3 at 13:36 in his live state, and
   * his canonical audit ledger ended the day desynced from its protected head,
   * with the product correctly refusing every external write until it was
   * repaired. audit.js:270-299 already documented this exact incident class
   * from 2026-08-10 -- a probe redirecting the ledger but not the vault -- and
   * closes with "prevention is the only real fix". This is that prevention.
   *
   * If a future lane needs to know why the INSTALLED build misbehaves, stage it
   * (`stage()` copies the packaged build and overlays dist/ + shell/) or point
   * `--release` at the installed directory. Both exercise the same bytes
   * without the app ever resolving to the owner's state root. */
  if (process.argv.includes('--installed')) {
    console.error([
      'REFUSED: --installed was removed on 2026-08-17.',
      '',
      'It launched the real installation, and Electron resolves appData through the',
      'Win32 shell API rather than the environment -- so the capability layer wrote',
      "into the owner's live state and desynced his audit ledger.",
      '',
      'Use --release <win-unpacked> instead, or stage() for a build carrying your changes.',
    ].join('\n'))
    process.exitCode = 2
    return
  }
  const staged = await stage(scratch, releaseDirectory())
  /* THE PERMISSION RECORD IS SEEDED RATHER THAN CLICKED. The first draft tried
     to press a "Skip" that is not on the permission question, so the run never
     left setup and reported five failures that were entirely this harness's
     fault -- the exact false finding this file exists to avoid producing. The
     record is what a machine that HAS been set up looks like, which is the
     starting state the question "does Start work" is actually about. */
  seedMachineRecord(scratch, staged.appRoot, 'standard')
  const window = await openWindow(staged.executable, scratch)
  const ledger = createLedger()
  try {
    await window.evaluate(`location.hash = '#/computers'`)
    await delay(3000)
    const stuckInSetup = await window.evaluate(`location.hash.includes('setup')`)
    ledger.check('a computer that is already set up opens the fleet page rather than the walkthrough',
      stuckInSetup === false, `hash=${await window.evaluate('location.hash')}`)
    if (stuckInSetup) {
      ledger.note('setup was not seeded, so nothing below would be about the product -- stopping rather than reporting harness failures as defects')
      return ledger.finish('agent really starts')
    }

    const before = await window.evaluate(READ)
    ledger.check('the fleet page offers somewhere to start an agent',
      before.agentNodes > 0 || before.slotVisible > 0,
      `agent nodes=${before.agentNodes} visible slots=${before.slotVisible}`)

    /* Press the way in. The empty slot is the designed door on a fresh profile. */
    const pressed = await window.clickVisible('.computers .tree-empty-node')
    ledger.check('the way in can be pressed', pressed === 'clicked', String(pressed))
    await delay(2200)

    const composeOpen = await window.evaluate(`Boolean(document.querySelector('[data-compose], .compose-panel, [data-agent-compose]'))`)
    ledger.check('pressing it opens something to start an agent from', composeOpen === true, `compose panel present=${composeOpen}`)

    /* THE SWITCH THE PANEL CARRIES, PRESSED BEFORE START IS ASKED FOR.
     *
     * Starting an assistant ships switched off (`mc.write.agent-session`), so on
     * a fresh profile the panel opens with Start DISABLED and a sentence saying
     * why. Until 0e43eb3 the remedy was a trip to Settings; that commit put the
     * switch in the panel, where the person already is, and reopens the panel
     * over the same slot after the write.
     *
     * This driver pressed Start on that first frame, found it disabled, watched
     * nothing happen and reported SILENCE -- which is this file's own definition
     * of the defect it exists to catch. The panel was not silent: it had painted
     * "Starting an assistant is switched off for this computer" and offered the
     * button that undoes it. Pressing that button is what a person does, so it
     * is what this driver does, and the silence check below now measures the
     * state a person actually reaches.
     *
     * Absent is reported, never assumed: on a profile where starting is already
     * on there is no switch and this is a no-op, but a build that LOST the
     * switch reads here rather than passing quietly. */
    const turnOn = await window.evaluate(`(() => {
      const node = document.querySelector('[data-compose-unavailable-action="panel"]')
      if (!node) return { pressed: false, why: 'no switch in the panel (starting may already be on)' }
      const box = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      if (box.width < 1 || box.height < 1 || style.visibility === 'hidden' || style.display === 'none') {
        return { pressed: false, why: 'the switch is in the panel but not on the glass' }
      }
      if (node.disabled === true) return { pressed: false, why: 'the switch is on the glass but disabled' }
      const x = box.left + box.width / 2
      const y = box.top + box.height / 2
      const hit = document.elementFromPoint(x, y)
      if (!hit || !(hit === node || node.contains(hit))) {
        return { pressed: false, why: 'nothing reaches the switch; ' + (hit ? hit.tagName + ' is on top of it' : 'elementFromPoint found nothing') }
      }
      node.click()
      return { pressed: true, label: node.textContent.trim().slice(0, 60) }
    })()`)
    ledger.check('a panel that says starting is switched off carries the switch that turns it on',
      turnOn.pressed === true || /already be on/.test(turnOn.why || ''),
      turnOn.pressed ? `pressed ${JSON.stringify(turnOn.label)}` : String(turnOn.why))
    if (turnOn.pressed) await delay(2600)

    /* ANSWER THE FORM BEFORE PRESSING ITS BUTTON.
     *
     * THE FALSE FINDING THIS RETIRES, and it is one this repository has already
     * paid for once (see tools/claude-tree-start-proof.mjs, same mistake, same
     * write-up). Start on this panel refuses an INCOMPLETE form: with no role
     * chosen, attemptSubmit() paints "Pick a role first, then press Start" and
     * returns before any IPC. This driver pressed Start on an empty form, saw no
     * session and no status line, and reported SILENCE -- the exact defect it
     * exists to catch, manufactured by itself. The panel was answering; it was
     * answering the question the driver had actually asked.
     *
     * REAL INPUT, INCLUDING THE MENU. A native <select> takes arrow keys only
     * after the press-opened operating-system popup is dismissed, so the order
     * is press, Escape, then arrows -- the one keystroke whose absence cost
     * another lane a false claim about real input. */
    const dispatchKey = async (name, keyCode) => {
      for (const type of ['rawKeyDown', 'keyUp']) {
        await window.session.send('Input.dispatchKeyEvent', {
          type, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, code: name, key: name,
        })
      }
    }
    const roleWanted = await window.evaluate(`(() => {
      const node = document.querySelector('[data-compose-field="role"]')
      if (!node) return null
      return [...node.options].map(option => option.value).find(value => value && value.length > 0) || null
    })()`)
    let roleChosen = { ok: false, why: 'the panel offers no role menu' }
    if (roleWanted) {
      const focused = await window.clickVisible('[data-compose-field="role"]')
      if (focused !== 'clicked') roleChosen = { ok: false, why: `could not focus the role menu: ${focused}` }
      else {
        await dispatchKey('Escape', 27)
        await delay(140)
        roleChosen = { ok: false, why: `never reached ${roleWanted}` }
        for (let attempt = 0; attempt < 24; attempt += 1) {
          const current = await window.evaluate(`document.querySelector('[data-compose-field="role"]')?.value`)
          if (current === roleWanted) { roleChosen = { ok: true, value: current }; break }
          await dispatchKey('ArrowDown', 40)
          await delay(130)
        }
      }
    }
    ledger.check('a role can be chosen on the panel with the keyboard',
      roleChosen.ok === true, roleChosen.ok ? `chose ${JSON.stringify(roleChosen.value)}` : roleChosen.why)

    /* The brief is typed, not assigned: a field that validates as you type would
       never see an assignment, and this panel does exactly that. */
    const BRIEF = 'Say only the word ready.'
    const typed = await window.typeInto('[data-compose-field="message"]', BRIEF)
    const landed = await window.evaluate(`document.querySelector('[data-compose-field="message"]')?.value || ''`)
    ledger.check('the brief can be typed into the panel',
      typed === 'typed' && String(landed).includes(BRIEF),
      typed === 'typed' ? JSON.stringify(String(landed).slice(0, 60)) : String(typed))

    /* Find and press the actual Start. */
    const startPress = await window.evaluate(`(() => {
      const vis = n => { const b = n.getBoundingClientRect(); const s = getComputedStyle(n)
        return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
      /* "Start this agent" is the real label. The first draft matched /^start$/
         and reported "no Start control" on a panel that had one, which would
         have been a fabricated defect. Match anything that starts with Start. */
      const btn = [...document.querySelectorAll('button')].filter(vis)
        .find(n => /^start/i.test(n.textContent.trim()))
      if (!btn) return { found: false, labels: [...document.querySelectorAll('button')].filter(vis).map(n => n.textContent.trim().slice(0, 30)).slice(0, 20) }
      if (btn.disabled) return { found: true, disabled: true, label: btn.textContent.trim().slice(0, 40) }
      btn.click()
      return { found: true, disabled: false, label: btn.textContent.trim().slice(0, 40) }
    })()`)
    ledger.check('there is a Start control to press',
      startPress.found === true,
      startPress.found ? `label=${JSON.stringify(startPress.label)} disabled=${startPress.disabled}` : `no Start among: ${JSON.stringify(startPress.labels)}`)

    /* The real IPC runs here. Generous, because a cold engine start is slow. */
    await delay(9000)
    const after = await window.evaluate(READ)

    /* THE POINT OF THE WHOLE FILE. Success is fine and a NAMED refusal is fine.
       Silence is the defect: pressed, and the screen says nothing at all. */
    const changed = after.statusLine !== before.statusLine
      || after.agentNodes !== before.agentNodes
      || JSON.stringify(after.nodeStatuses) !== JSON.stringify(before.nodeStatuses)
    ledger.check('PRESSING START PRODUCES AN ANSWER -- a session, or words saying why not',
      changed === true,
      `before: nodes=${before.agentNodes} status=${JSON.stringify(before.statusLine.slice(0, 120))} | after: nodes=${after.agentNodes} status=${JSON.stringify(after.statusLine.slice(0, 160))}`)

    if (changed) {
      const refused = /cannot|could not|no launcher|not available|needs|install|sign in|refus/i.test(after.statusLine)
      ledger.note(refused
        ? `the answer was a REFUSAL, which is a legitimate outcome on a machine without an assistant program: ${JSON.stringify(after.statusLine.slice(0, 220))}`
        : `the answer looked like a START: ${JSON.stringify(after.statusLine.slice(0, 220))} nodes=${after.agentNodes}`)
      ledger.check('and whatever it says is in words, not an identifier',
        !/^[A-Z_]{6,}$/.test(after.statusLine.trim()) && after.statusLine.trim().length > 0,
        JSON.stringify(after.statusLine.slice(0, 160)))
    }
    ledger.note(`stage text after the press: ${JSON.stringify(after.stageText.slice(0, 400))}`)
  } finally {
    try { await closeWindow(window) } catch { /* gone */ }
  }
  ledger.finish('agent really starts')
}

main().catch(error => { console.error(error?.stack || String(error)); process.exitCode = 1 })
