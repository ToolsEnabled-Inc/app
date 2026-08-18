#!/usr/bin/env node

/* WHAT DOES "ACTIVITY ON THIS COMPUTER" ACTUALLY TELL A PERSON?
 *
 * THE REPORT THIS ANSWERS. The owner, on the installed build: the list shows
 * only "Agent run 37 · started" / "did not start" and a relative time. He named
 * the repository whose agent feeds get this right, and what those carry is
 * always the same three things -- which agent, what it was asked, what
 * happened.
 *
 * WHAT IS SEEDED AND WHAT IS NOT. Two records this computer really keeps:
 *
 *   the signed run ledger    agent-spawn-records.jsonl, written by
 *                            shell/spawn-record.cjs. This driver builds it with
 *                            THE RECORDER ITSELF, in the profile the app will
 *                            read -- so the hash chain, the signature and the
 *                            key are the product's own, not a fixture. A
 *                            hand-written file would fail verification and the
 *                            screen would correctly report a broken record,
 *                            which is a different measurement.
 *   the saved conversations  the trees a person builds on the computers page,
 *                            in localStorage. Seeded the same way
 *                            tools/tree-chatbox-open-qa.mjs seeds them.
 *
 * Nothing about the READ path is simulated: the page asks the shell over the
 * real channel, joins on the real key, and renders what it is given.
 *
 * The rows are read after a REAL press on the way to the home screen, and the
 * text asserted is the text the element carries.
 *
 *   node tools/home-activity-substance-qa.mjs
 *   node tools/home-activity-substance-qa.mjs --visible
 */

import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  closeWindow,
  delay,
  openWindow,
  reap,
  REPO_ROOT,
  seedMachineRecord,
  stage,
  userDataFor,
} from './test-account-harness.mjs'

const require_ = createRequire(import.meta.url)
const findings = []
const note = (level, text) => { findings.push({ level, text }); console.log(`  ${level.padEnd(5)} ${text}`) }

/* The two runs this measures, and why each one. One refusal with the code the
   tree really raises when a build carries no launcher for the picked type --
   that is the state the owner was in, and the row for it used to say only "did
   not start". One start that worked, for the row that must NOT acquire a
   refusal line. */
const RUNS = [
  {
    sessionId: 'chat-aaaaaaaa-1111-2222-3333-444444444444',
    result: 'refused',
    reason: 'AGENT_TIER_NO_LAUNCHER',
    role: 'coordinator',
    asked: 'Read the build log and tell me exactly what broke.',
  },
  {
    sessionId: 'chat-bbbbbbbb-5555-6666-7777-888888888888',
    result: 'started',
    reason: null,
    role: 'worker',
    asked: 'Summarise the release notes in three lines.',
  },
]

/* A read that THREW is not a read that found nothing. Anything carrying
   __evaluateThrew is a driver fault and is raised, never printed as a finding. */
function readOrThrow(value, what) {
  if (value && typeof value === 'object' && value.__evaluateThrew) {
    throw new Error(`the page expression for ${what} threw: ${value.__evaluateThrew}`)
  }
  if (!value || typeof value !== 'object') throw new Error(`the page expression for ${what} answered ${JSON.stringify(value)}`)
  return value
}

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
  await delay(500)
  return { pressed: true, at: { x: Math.round(spot.x), y: Math.round(spot.y) } }
}

/* THE LEDGER, WRITTEN BY THE PRODUCT'S OWN RECORDER.
 *
 * A keystore double is supplied because Electron's safeStorage lives in a
 * running app and this runs in plain Node -- it is the same double the
 * recorder's own suite uses (tools/test/agent-history-read.test.mjs). The
 * SIGNING, the HASH CHAIN and the record shape are all the product's; only the
 * at-rest encryption of the key is stood in for, and the app re-reads that key
 * through its own keystore, which is why the profile gets a fresh one below
 * rather than a copied file. */
function seedRunLedger(profile) {
  const directory = userDataFor(profile)
  mkdirSync(directory, { recursive: true })
  /* Required from this tree's shell/, not from inside the staged archive: plain
     Node cannot read an asar, and stage() copies THIS shell/ into the archive
     the app is about to run -- so these are the same bytes. */
  const { createSpawnRecorder } = require_(path.join(REPO_ROOT, 'shell', 'spawn-record.cjs'))
  const store = new Map()
  const recorder = createSpawnRecorder({
    directory,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: text => Buffer.from(`enc:${Buffer.from(text, 'utf8').toString('base64')}`, 'utf8'),
      decryptString: (buffer) => {
        const stored = buffer.toString('utf8')
        if (!stored.startsWith('enc:')) throw new Error('not encrypted by this keystore')
        return Buffer.from(stored.slice(4), 'base64').toString('utf8')
      },
    },
  })
  void store
  for (const run of RUNS) {
    const receipt = recorder.record({ action: 'agent_session_start', sessionId: run.sessionId, details: {} })
    recorder.record({
      action: 'agent_session_outcome',
      sessionId: run.sessionId,
      details: {},
      outcome: { resolves: receipt.sequence, result: run.result, reason: run.reason },
    })
  }
  return recorder.history({ limit: 20 })
}

async function main() {
  const scratch = mkdtempSync(path.join(tmpdir(), 'home-activity-qa-'))
  let window = null
  try {
    console.log('staging the packaged build...')
    const staged = await stage(scratch)
    seedMachineRecord(scratch, staged.appRoot, 'standard')

    const seeded = seedRunLedger(scratch)
    if (!seeded || seeded.ok !== true) {
      note('FAIL', `HARNESS STATE: the recorder would not write a ledger (${seeded && seeded.code}); nothing below is a measurement.`)
      return
    }
    note('ok', `wrote ${seeded.entries.length} record(s) with the product's own recorder; the chain verifies: ${seeded.verified}`)
    /* THE FIELD THIS WHOLE FEATURE HANGS ON, checked at the source before the
       page is asked. If history() stopped carrying the join key, the rows below
       would degrade silently to what they showed before -- which is a pass this
       driver must never award. */
    const key = seeded.entries.find(entry => entry.sessionId === RUNS[0].sessionId)
    note(key ? 'ok' : 'FAIL', `the record hands the page a session to join on: ${JSON.stringify(key?.sessionId || null)}`)
    if (!key) return

    window = await openWindow(staged.executable, scratch)
    await window.evaluate(`localStorage.setItem('mc.write.agent-session', 'enabled')`)
    await window.evaluate(`location.hash = '#/computers'`)
    await delay(1200)
    await window.evaluate(`location.reload()`)
    await delay(3600)
    const computerId = await window.evaluate(`window.__mcGraph?.computer?.id || null`)
    if (!computerId) {
      note('FAIL', 'HARNESS STATE: no computer on the page, so there is no tree record to save conversations into.')
      return
    }

    const stamp = new Date().toISOString()
    const record = {
      version: 1,
      computerId,
      trees: [{ id: 'tree-activity-qa', name: 'Activity', createdAt: stamp, updatedAt: stamp, profileId: null }],
      nodes: RUNS.map((run, index) => ({
        id: `node-activity-${index}`,
        treeId: 'tree-activity-qa',
        parentId: index === 0 ? null : 'node-activity-0',
        role: run.role,
        message: run.asked,
        status: run.result === 'refused' ? 'failed' : 'finished',
        statusNote: '',
        reply: '',
        tier: 'claude-sonnet',
        sessionId: run.sessionId,
        createdAt: stamp,
        updatedAt: stamp,
      })),
    }
    const wrote = readOrThrow(await window.evaluate(`(function write() {
      localStorage.setItem(${JSON.stringify(`mc.fleet.trees.v1:${computerId}`)}, ${JSON.stringify(JSON.stringify(record))})
      const listed = []
      for (let i = 0; i < localStorage.length; i += 1) listed.push(localStorage.key(i))
      return { enumerated: Object.keys(localStorage), listed, length: localStorage.length }
    })()`), 'the write')
    /* THE FACT THAT COST THIS FEATURE ITS FIRST RUN, kept as an assertion so
       nobody has to rediscover it. In this application `localStorage` is not
       Storage: public/durable-storage.js replaces the global with a durable
       shim over the settings file. Object.keys() on it answers the METHOD
       names, so any code that enumerates a shape like that finds no saved key
       and degrades in silence -- which is exactly what happened, invisibly, on
       the first run of this driver. */
    note(wrote.enumerated.includes('getItem') ? 'ok' : 'info',
      `the packaged app's localStorage is a shim, and Object.keys answers ${JSON.stringify(wrote.enumerated)} -- only length/key(i) finds a saved key`)
    note(wrote.listed.some(key => String(key).startsWith('mc.fleet.trees.v1:')) ? 'ok' : 'FAIL',
      `the saved conversation is in the store the page will read: ${JSON.stringify(wrote.listed)}`)

    /* TO THE HOME SCREEN BY A REAL PRESS, not by setting the hash. The nav is
       the way a person gets there and it is the thing that would be broken. */
    /* The page strip is arrows, not links (src/main.js #nav-back / #nav-next),
       so the way back is the arrow a person presses. Bounded, and it reports
       the route it actually reached rather than assuming one press did it. */
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const at = await window.evaluate(`location.hash`)
      if (at === '#/' || at === '' || at === '#') break
      const back = await press(window, '#nav-back', 6000)
      if (!back.pressed) {
        note('FAIL', `HARNESS STATE: the back arrow was not pressable (${back.why}), so this run never reached the home screen`)
        return
      }
      await delay(1400)
    }
    const landed = await window.evaluate(`location.hash`)
    note(landed === '#/' || landed === '' || landed === '#' ? 'ok' : 'FAIL',
      `walked back to the home screen with the page arrow; the route is ${JSON.stringify(landed)}`)
    await delay(3200)

    const rows = await window.evaluate(`(function readRuns() {
      return [...document.querySelectorAll('.home-run')].map(row => ({
        what: (row.querySelector('.run-what')?.textContent || '').trim(),
        result: (row.querySelector('.run-result')?.textContent || '').trim(),
        when: (row.querySelector('.run-when')?.textContent || '').trim(),
        exact: row.querySelector('.run-when')?.title || '',
        agent: (row.querySelector('.run-agent')?.textContent || '').trim(),
        asked: (row.querySelector('.run-asked')?.textContent || '').trim(),
        why: (row.querySelector('.run-why')?.textContent || '').trim(),
      }))
    })()`)
    if (!Array.isArray(rows) || rows.length === 0) {
      const seen = await window.evaluate(`(document.querySelector('.home') || document.body).innerText.slice(0, 600)`)
      note('FAIL', `no run rows on the home screen at all. What is there: ${JSON.stringify(seen)}`)
      return
    }
    note('ok', `${rows.length} run row(s) on the glass`)
    for (const row of rows) console.log(`        ${JSON.stringify(row)}`)

    const refused = rows.find(row => row.result === 'did not start')
    note(refused ? 'ok' : 'FAIL', `a refused run is on the list: ${JSON.stringify(refused?.what || null)}`)
    if (refused) {
      note(refused.agent === RUNS[0].role ? 'ok' : 'FAIL',
        `it says WHICH agent: ${JSON.stringify(refused.agent)}`)
      note(refused.asked.includes(RUNS[0].asked) ? 'ok' : 'FAIL',
        `it says WHAT it was asked: ${JSON.stringify(refused.asked)}`)
      note(refused.why.length > 0 ? 'ok' : 'FAIL',
        `it says WHY it did not start: ${JSON.stringify(refused.why)}`)
      note(refused.exact.length > 0 ? 'ok' : 'FAIL', `and the exact instant is on the row: ${JSON.stringify(refused.exact)}`)
      /* THE ONE THING THAT WOULD MAKE THIS WORSE THAN BEFORE: a code where a
         sentence belongs. The record carries bare upper-case identifiers and
         the copy module is the only thing allowed to turn one into words. */
      note(/\b[A-Z][A-Z0-9_]{4,}\b/.test(refused.why) ? 'FAIL' : 'ok',
        'the reason is a sentence, not the identifier the record stored')
    }

    const started = rows.find(row => row.result === 'started')
    note(started ? 'ok' : 'FAIL', `a started run is on the list: ${JSON.stringify(started?.what || null)}`)
    if (started) {
      note(started.why === '' ? 'ok' : 'FAIL',
        `a run that STARTED carries no refusal line: ${JSON.stringify(started.why)}`)
      note(started.agent === RUNS[1].role ? 'ok' : 'FAIL', `it says which agent: ${JSON.stringify(started.agent)}`)
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
