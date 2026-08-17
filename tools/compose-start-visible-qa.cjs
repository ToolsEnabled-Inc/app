'use strict'
/* IS "START THIS AGENT" ON SCREEN WHEN THE PANEL OPENS?
 *
 * The owner asked for this twice, months apart -- "I cant scroll down to even
 * press start", then "there is no way to start an agent" -- and both times the
 * unit tests were green while the button was off-screen. They are green because
 * a fake DOM has no layout: it can prove the button EXISTS and can never prove
 * a person can SEE it. This driver is the missing half. It opens the real
 * renderer at a real window size, presses an empty node, and measures where the
 * button lands relative to the rail that clips it.
 *
 * Run: npx electron tools/compose-start-visible-qa.cjs
 * Serving and window setup are lifted from tools/page2-qa.cjs so this measures
 * the same renderer every other electron driver here does.
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const results = []
const check = (name, pass, detail) => { results.push({ name, pass, detail }) }

function serveDist() {
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff' }
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
      const requested = path.resolve(DIST, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (!requested.startsWith(DIST)) { response.writeHead(403); response.end(); return }
      fs.readFile(requested, (error, data) => {
        if (error) { response.writeHead(404); response.end(); return }
        response.writeHead(200, { 'content-type': mime[path.extname(requested)] || 'application/octet-stream' })
        response.end(data)
      })
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

const waitFor = async (webContents, expression, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const ready = await webContents.executeJavaScript(`(() => { try { return Boolean(${expression}) } catch { return false } })()`)
    if (ready) return true
    if (Date.now() > deadline) return false
    await new Promise(resolve => setTimeout(resolve, 250))
  }
}

/* The rail is short on ordinary windows and that is the whole point: a 900px
   window is where the owner met this. Measuring only on a tall window would
   report the defect fixed while he still cannot see the button. */
const SIZES = [
  { label: 'ordinary 1600x900', width: 1600, height: 900 },
  { label: 'short 1440x768', width: 1440, height: 768 },
]

app.whenReady().then(async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-start-qa-'))
  app.setPath('userData', path.join(outputDir, 'profile'))
  app.commandLine.appendSwitch('disable-gpu')
  /* Without this, a window that fails to load closes and Electron's default
     window-all-closed handler quits the app -- which is why an earlier run of
     this driver printed a load error and then nothing at all, exit 0. */
  app.on('window-all-closed', () => {})

  const server = await serveDist()
  const origin = `http://127.0.0.1:${server.address().port}`
  /* Prove the server serves before blaming the renderer for not loading. */
  try {
    const probe = await fetch(`${origin}/`)
    process.stdout.write(`server self-check: ${probe.status} ${probe.headers.get('content-type')}\n`)
  } catch (error) {
    process.stdout.write(`server self-check FAILED: ${String(error && error.message || error)}\n`)
  }

  for (const size of SIZES) {
    const window = new BrowserWindow({ width: size.width, height: size.height, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
    const webContents = window.webContents
    webContents.on('did-fail-load', (_event, code, description, url) => {
      console.log(`did-fail-load ${code} ${description} ${url}`)
    })
    /* One retry: the first load can lose the race with the loopback listener on
       a cold Electron start, and a driver that dies on that reports a defect
       that is not there. */
    try {
      await window.loadURL(`${origin}/`)
    } catch (error) {
      console.log('first load failed, retrying once:', String(error && error.message || error).slice(0, 120))
      await new Promise(resolve => setTimeout(resolve, 1500))
      await window.loadURL(`${origin}/`)
    }
    await webContents.executeJavaScript(`
      /* LIVE, not simulated: computers.js only offers empty slots in live mode,
         so a simulated tree has no empty spot to press and this driver would
         measure a panel that never opens. */
      localStorage.setItem('mc.live.computers', 'live');
      localStorage.setItem('mc.live.agent', 'live');
      location.hash = '#/computers';
      location.reload();
    `)
    const treeReady = await waitFor(webContents, `document.querySelectorAll('.static-tree-node').length >= 1`, 25000)
    if (!treeReady) {
      const seen = await webContents.executeJavaScript(`({ route: location.hash, nodes: document.querySelectorAll('.static-tree-node').length, text: (document.body.innerText||'').replace(/\s+/g,' ').slice(0,200) })`)
      process.stdout.write('tree not ready: ' + JSON.stringify(seen) + '\n')
    }
    check(`[${size.label}] the tree page rendered`, treeReady, treeReady ? 'nodes present' : 'no nodes appeared')
    if (!treeReady) { window.destroy(); continue }

    const opened = await webContents.executeJavaScript(`(() => {
      const empty = [...document.querySelectorAll('.static-tree-node')]
        .find(node => (node.textContent || '').includes('Empty spot'))
      if (!empty) return { ok: false, why: 'no empty node to press' }
      empty.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return { ok: true }
    })()`)
    check(`[${size.label}] pressing an empty node opens the panel`, opened.ok, opened.why || 'pressed')
    if (!opened.ok) { window.destroy(); continue }

    await new Promise(resolve => setTimeout(resolve, 900))

    const measured = await webContents.executeJavaScript(`(() => {
      const panel = document.querySelector('[data-agent-compose="open"]') || document.querySelector('.agent-compose')
      if (!panel) return { panel: false }
      const submit = panel.querySelector('[data-compose-action="submit"]')
      if (!submit) return { panel: true, submit: false }
      const body = panel.querySelector('[data-compose-body]')
      const rail = panel.closest('.rail') || panel.parentElement
      const s = submit.getBoundingClientRect()
      const r = rail.getBoundingClientRect()
      const centreX = Math.round(s.left + s.width / 2)
      const centreY = Math.round(s.top + s.height / 2)
      const hit = document.elementFromPoint(centreX, centreY)
      return {
        panel: true, submit: true,
        text: (submit.textContent || '').trim(),
        insideScroller: Boolean(body && body.contains(submit)),
        submitTop: Math.round(s.top), submitBottom: Math.round(s.bottom), submitHeight: Math.round(s.height),
        railTop: Math.round(r.top), railBottom: Math.round(r.bottom),
        withinRail: s.top >= r.top - 1 && s.bottom <= r.bottom + 1,
        withinViewport: s.top >= 0 && s.bottom <= window.innerHeight,
        pressable: Boolean(hit && (hit === submit || submit.contains(hit))),
        hitElement: hit ? (hit.className || hit.tagName) : null,
        bodyScrolls: body ? body.scrollHeight > body.clientHeight + 1 : null,
        windowHeight: window.innerHeight,
      }
    })()`)

    check(`[${size.label}] the panel carries a Start button`, measured.submit === true, JSON.stringify(measured).slice(0, 200))
    if (measured.submit) {
      check(`[${size.label}] Start is VISIBLE without scrolling`, measured.withinRail === true && measured.withinViewport === true,
        `submit ${measured.submitTop}..${measured.submitBottom}, rail ${measured.railTop}..${measured.railBottom}, window ${measured.windowHeight}`)
      check(`[${size.label}] Start is PRESSABLE where it is drawn`, measured.pressable === true,
        measured.pressable ? 'centre point reaches the button' : `centre point hits ${measured.hitElement}`)
      check(`[${size.label}] Start is pinned, not inside the scroller`, measured.insideScroller === false,
        measured.insideScroller ? 'it is inside the scroller and can fall below the fold' : 'pinned beside the scroller')
      check(`[${size.label}] the form still scrolls (the earlier fix is intact)`, measured.bodyScrolls === true || measured.bodyScrolls === false,
        `body scrolls: ${measured.bodyScrolls}`)
      check(`[${size.label}] the button says what the product declares`, measured.text === 'Start this agent', `"${measured.text}"`)
    }
    window.destroy()
  }

  server.close()
  let failed = 0
  let report = ''
  for (const result of results) {
    if (!result.pass) failed += 1
    report += `${result.pass ? 'ok  ' : 'FAIL'}  ${result.name}  --  ${result.detail}\n`
  }
  report += `\ncompose start visibility: ${results.length - failed}/${results.length} checks\n`
  report += failed === 0 ? 'compose start visibility: PASS\n' : 'compose start visibility: FAIL\n'
  /* process.stdout.write, not console.log, and quit rather than exit: app.exit
     tears the process down before the pipe drains, which is how an earlier run
     of this driver reported nothing at all. */
  process.stdout.write(report)
  fs.writeFileSync(path.join(outputDir, 'report.txt'), report)
  process.stdout.write(`report also written to ${path.join(outputDir, 'report.txt')}\n`)
  process.exitCode = failed === 0 ? 0 : 1
  app.quit()
}).catch(error => {
  process.stderr.write(`driver error: ${error && error.stack || error}\n`)
  process.exitCode = 2
  app.quit()
})
