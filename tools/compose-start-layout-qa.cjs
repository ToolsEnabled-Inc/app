'use strict'
/* DOES START STAY ON SCREEN WHEN THE FORM IS TALLER THAN THE RAIL?
 *
 * The unit tests cannot answer this: a fake DOM has no layout, so it can prove
 * the button EXISTS and never that a person can SEE it. That gap is why the
 * owner's complaint survived a commit called "Start is reachable" -- the button
 * was in the scroller, ~100px below the fold, present and invisible.
 *
 * This measures the real stylesheet against the real panel structure inside a
 * rail-sized box, at window heights the owner actually uses. It deliberately
 * does NOT drive the app: the tree's empty slots only exist in live mode, which
 * needs the action bridge on the fenced 127.0.0.1:4610-4619 range. The layout
 * question is answerable without it, and the end-to-end proof belongs to
 * tools/agent-start-flow-qa.mjs against a packaged build.
 *
 * Run: npx electron tools/compose-start-layout-qa.cjs
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const results = []
const check = (name, pass, detail) => { results.push({ name, pass: Boolean(pass), detail }) }

/* The panel's real shape, in the order src/agent-compose-panel.js builds it:
   nav row, then the scrolling form, then the pinned action row and status. The
   form is loaded with the real number of fields so its height is honest. */
const PANEL_HTML = `
<div class="rail">
  <div class="rail-page compose-page is-active">
    <section class="agent-compose" data-agent-compose="open">
      <div class="rail-nav"><button class="ctl-btn" data-compose-action="cancel">Not now</button></div>
      <div class="rail-scroll agent-compose-body" data-compose-body="form">
        <p class="agent-compose-intro">Two answers and it runs.</p>
        <p class="agent-compose-under" data-compose-under="parent">Under Default 2</p>
        <div class="agent-compose-field"><label>What should it be?</label><p class="agent-compose-hint">Pick the role.</p><select class="agent-compose-select"><option>helper</option></select><p class="agent-compose-summary">A helper does one job.</p><p class="agent-compose-problem"></p></div>
        <div class="agent-compose-field"><label>Which assistant?</label><p class="agent-compose-hint">Luna is a good default. Claude cannot start from a tree yet; to use Claude, hand the work over on the agent page instead.</p><select class="agent-compose-select"><option>Luna</option></select></div>
        <div class="agent-compose-field"><label>How hard should it think?</label><p class="agent-compose-hint">Harder thinking is slower and costs more. The tier picks a sensible default; change it here for this agent.</p><select class="agent-compose-select"><option>Default</option></select></div>
        <div class="agent-compose-field"><label>What do you want it to do?</label><p class="agent-compose-hint">Write it the way you would ask a person. One clear job is enough to start.</p><textarea class="agent-compose-text" rows="4"></textarea><p class="agent-compose-problem"></p></div>
        <p class="agent-compose-notice" hidden></p>
      </div>
      <div class="agent-compose-actions"><button class="ctl-btn agent-compose-submit" data-compose-action="submit">Start this agent</button></div>
      <p class="agent-compose-status" data-compose-status="panel" hidden></p>
    </section>
  </div>
</div>`

const SIZES = [
  { label: '1600x900', width: 1600, height: 900 },
  { label: '1440x768', width: 1440, height: 768 },
  { label: '1280x720 (shortest)', width: 1280, height: 720 },
]

app.whenReady().then(async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-layout-qa-'))
  app.setPath('userData', path.join(outputDir, 'profile'))
  app.commandLine.appendSwitch('disable-gpu')
  app.on('window-all-closed', () => {})

  const cssFile = fs.readdirSync(path.join(DIST, 'assets')).find(name => name.endsWith('.css'))
  if (!cssFile) throw new Error('no built stylesheet in dist/assets; run npm run build first')
  const css = fs.readFileSync(path.join(DIST, 'assets', cssFile), 'utf8')
  const page = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
    <style>html,body{margin:0;height:100%} .rail{position:relative;height:100%;width:380px;overflow:hidden}</style>
    </head><body>${PANEL_HTML}</body></html>`
  const pageFile = path.join(outputDir, 'panel.html')
  fs.writeFileSync(pageFile, page)

  for (const size of SIZES) {
    const window = new BrowserWindow({ width: size.width, height: size.height, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } })
    await window.loadFile(pageFile)
    await new Promise(resolve => setTimeout(resolve, 400))
    const measured = await window.webContents.executeJavaScript(`(() => {
      const rail = document.querySelector('.rail')
      const body = document.querySelector('[data-compose-body]')
      const submit = document.querySelector('[data-compose-action="submit"]')
      const r = rail.getBoundingClientRect()
      const s = submit.getBoundingClientRect()
      const hit = document.elementFromPoint(Math.round(s.left + s.width / 2), Math.round(s.top + s.height / 2))
      return {
        railTop: Math.round(r.top), railBottom: Math.round(r.bottom), railHeight: Math.round(r.height),
        submitTop: Math.round(s.top), submitBottom: Math.round(s.bottom), submitHeight: Math.round(s.height),
        insideScroller: body.contains(submit),
        formOverflows: body.scrollHeight > body.clientHeight + 1,
        formScrollHeight: body.scrollHeight, formClientHeight: body.clientHeight,
        visibleWithoutScrolling: s.top >= r.top - 1 && s.bottom <= r.bottom + 1 && s.height > 0,
        pressable: Boolean(hit && (hit === submit || submit.contains(hit))),
        hitElement: hit ? (hit.className || hit.tagName) : null,
      }
    })()`)
    /* Not a pass/fail: whether the form overflows depends on the window, and a
       size where it fits is not a defect -- it just does not exercise the bug.
       Printed so a green run cannot be mistaken for coverage it did not have. */
    process.stdout.write(`note  [${size.label}] form ${measured.formScrollHeight}px in ${measured.formClientHeight}px `
      + `-- ${measured.formOverflows ? 'OVERFLOWS: this size exercises the defect' : 'fits: this size does not exercise it'}\n`)
    check(`[${size.label}] Start is VISIBLE without scrolling`,
      measured.visibleWithoutScrolling === true,
      `submit ${measured.submitTop}..${measured.submitBottom} within rail ${measured.railTop}..${measured.railBottom}`)
    check(`[${size.label}] Start is PRESSABLE where it is drawn`,
      measured.pressable === true, measured.pressable ? 'the centre point reaches it' : `centre hits ${measured.hitElement}`)
    check(`[${size.label}] Start is pinned beside the scroller, not inside it`,
      measured.insideScroller === false, measured.insideScroller ? 'inside: it can fall below the fold again' : 'pinned')
    window.destroy()
  }

  let failed = 0
  let report = ''
  for (const result of results) {
    if (!result.pass) failed += 1
    report += `${result.pass ? 'ok  ' : 'FAIL'}  ${result.name}  --  ${result.detail}\n`
  }
  report += `\ncompose start layout: ${results.length - failed}/${results.length} checks\n`
  report += failed === 0 ? 'compose start layout: PASS\n' : 'compose start layout: FAIL\n'
  process.stdout.write(report)
  process.exitCode = failed === 0 ? 0 : 1
  app.quit()
}).catch(error => {
  process.stderr.write(`driver error: ${error && error.stack || error}\n`)
  process.exitCode = 2
  app.quit()
})
