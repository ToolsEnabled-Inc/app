// Bridge between the page and the window chrome. Two jobs:
// 1. Announce the shell to the renderer (src/main.js adds the titlebar strip
//    and body.in-shell only when this marker exists — the same build keeps
//    serving unchanged in a plain browser).
// 2. Watch the theme attribute and report the REAL composited surface
//    colours to the main process, so the native caption buttons and window
//    background always match the page. Reading getComputedStyle here (after
//    a frame, so the token flip has painted) beats hardcoding theme hexes —
//    the shell can never drift from styles.css.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mcShell', { titlebarHeight: 36 })

function rgbToHex(rgb) {
  const m = rgb.match(/(\d+)[, ]+(\d+)[, ]+(\d+)/)
  if (!m) return '#fdfdfd'
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')
}

function report() {
  requestAnimationFrame(() => {
    const cs = getComputedStyle(document.body)
    ipcRenderer.send('mc-theme', {
      theme: document.documentElement.dataset.theme || 'white',
      bg: rgbToHex(cs.backgroundColor),
      ink: rgbToHex(cs.color),
    })
  })
}

/* The titlebar strip is injected from here, not built into the app source:
   the same dist/ keeps serving byte-identical in a plain browser, and the
   chrome lives with the shell that needs it. The strip's background is
   transparent — the themed body shows through, so it can never mismatch.
   Native caption buttons (min/max/close) are OS-drawn over the right edge;
   the whole strip is a drag region. Offsets below mirror the app's only
   viewport-sized rules: #stage 100vh, .topbar/.drawer top 14px. */
const TB = 36
function injectTitlebar() {
  document.documentElement.classList.add('in-shell')
  document.body.classList.add('in-shell')
  const style = document.createElement('style')
  style.textContent = `
    #shell-titlebar {
      position: fixed; top: 0; left: 0; right: 0; height: ${TB}px;
      z-index: 200; -webkit-app-region: drag;
      display: flex; align-items: center; justify-content: center;
      border-bottom: 1px solid var(--line, rgba(128,128,128,0.18));
      font-size: 11px; font-weight: 600; letter-spacing: 0.14em;
      color: var(--ink-3, #888); user-select: none;
    }
    html.in-shell #stage { height: calc(100vh - ${TB}px); margin-top: ${TB}px; }
    html.in-shell .topbar { top: calc(14px + ${TB}px); }
    html.in-shell .drawer { top: calc(14px + ${TB}px); }
  `
  document.head.appendChild(style)
  const bar = document.createElement('div')
  bar.id = 'shell-titlebar'
  bar.textContent = 'MISSION CONTROL'
  document.body.prepend(bar)
}

window.addEventListener('DOMContentLoaded', () => {
  injectTitlebar()
  report()
  new MutationObserver(report).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme'],
  })
})
