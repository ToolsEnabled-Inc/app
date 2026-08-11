'use strict'

/* End-to-end proof that a person can start an agent FROM THE INTERFACE.
 *
 * This boots the REAL shell/main.cjs -- the actual application, its actual
 * window, its actual preload -- and then drives the real renderer the way a
 * person would reach it: through window.mcAgent, the contextBridge surface.
 * Nothing here re-implements or re-registers any part of the app.
 *
 * Verified by exit code. Any failed step exits non-zero.
 */

const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const APP_ROOT = process.env.MC_APP_ROOT || path.resolve(__dirname, '..')
const TIMEOUT_MS = 180_000

const steps = []
function step(name, ok, detail) {
  steps.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`)
}

function fatal(message) {
  console.error('E2E FATAL: ' + message)
  app.exit(20)
}

// Boot the real application.
require(path.join(APP_ROOT, 'shell', 'main.cjs'))

async function windowReady() {
  const deadline = Date.now() + 60_000
  for (;;) {
    const windows = BrowserWindow.getAllWindows()
    const win = windows.find(w => !w.isDestroyed())
    if (win) {
      if (win.webContents.isLoading()) {
        await new Promise(resolve => win.webContents.once('did-finish-load', resolve))
      }
      return win
    }
    if (Date.now() > deadline) throw new Error('no BrowserWindow appeared within 60s')
    await new Promise(resolve => setTimeout(resolve, 250))
  }
}

async function run() {
  const win = await windowReady()
  const js = (code) => win.webContents.executeJavaScript(code, true)

  step('the real app window loaded', true, await js('document.title'))

  // 1. The bridge exists in the renderer at all.
  const surface = await js('JSON.stringify(Object.keys(window.mcAgent || {}).sort())')
  const keys = JSON.parse(surface)
  const expected = ['availability', 'close', 'interrupt', 'onEvent', 'send', 'start']
  step('window.mcAgent exposes the bounded surface', JSON.stringify(keys) === JSON.stringify(expected), surface)

  // 2. Availability answers, and answers without a path.
  const availability = await js('window.mcAgent.availability().then(JSON.stringify)')
  const parsed = JSON.parse(availability)
  step('availability round-trips renderer -> main', typeof parsed === 'object' && parsed !== null, availability)
  step('availability leaks no path', !/[\\/]/.test(JSON.stringify(Object.values(parsed))), availability)
  if (parsed.ok !== true) {
    step('an engine is configured for this run', false, 'code=' + parsed.code)
    return
  }
  step('an engine is configured for this run', true, parsed.code)

  // 3. Start a real session, send a turn, and collect streamed output --
  //    entirely from inside the page.
  const result = await js(`(async () => {
    const id = crypto.randomUUID()
    let text = ''
    let done = null
    const finished = new Promise(resolve => { done = resolve })
    const off = window.mcAgent.onEvent(packet => {
      if (!packet || packet.sessionId !== id || !packet.event) return
      const e = packet.event
      if (e.type === 'assistant_text_delta' && typeof e.text === 'string') text += e.text
      if (e.type === 'turn_completed') done(e.status || 'completed')
    })
    const timer = setTimeout(() => done('timeout'), 150000)
    try {
      const started = await window.mcAgent.start({ sessionId: id })
      await window.mcAgent.send({ sessionId: id, text: 'Reply with exactly the word: PONG' })
      const status = await finished
      const stopped = await window.mcAgent.close({ sessionId: id })
      return JSON.stringify({
        threadId: typeof started.threadId === 'string' && started.threadId.length > 0,
        status,
        reply: text.trim(),
        closed: stopped.closed === true,
      })
    } finally { clearTimeout(timer); off() }
  })()`)

  const session = JSON.parse(result)
  step('start() opened a real session from the page', session.threadId === true, 'threadId present')
  step('the turn completed', session.status === 'completed', 'status=' + session.status)
  step('output streamed back into the page', session.reply === 'PONG', 'reply=' + JSON.stringify(session.reply))
  step('close() stopped the session from the page', session.closed === true, 'closed=' + session.closed)
}

app.whenReady().then(async () => {
  const guard = setTimeout(() => fatal('exceeded ' + TIMEOUT_MS + 'ms'), TIMEOUT_MS)
  try {
    await run()
    clearTimeout(guard)
    const failed = steps.filter(s => !s.ok)
    console.log(`\n${steps.length - failed.length}/${steps.length} steps passed`)
    app.exit(failed.length === 0 ? 0 : 1)
  } catch (error) {
    clearTimeout(guard)
    console.error('E2E ERROR:', error && error.stack ? error.stack : error)
    app.exit(21)
  }
})
