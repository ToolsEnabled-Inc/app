// Sandboxed Electron preloads cannot require a sibling preload. This file is
// therefore the shell's composed boundary: it preserves the existing chrome
// behavior and adds only the fleet-profile bridge below. Turning sandboxing
// off to reuse one file would make configuration convenience a security
// regression, which is a worse version of the productionization gap.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mcShell', {
  titlebarHeight: 36,
  getBridgeProof: () => ipcRenderer.invoke('mc-bridge-proof'),
})

/* Fleet data is resolved while the renderer's module graph is evaluating. An
   async-only bridge paints the sample first and leaves sim.js, vocab.js and
   the ledger frozen on it even after userData answers. The one synchronous
   operation is a bounded read; every mutation remains an explicit invoke. */
const bootstrap = ipcRenderer.sendSync('mc-fleet-profile:bootstrap')
contextBridge.exposeInMainWorld('mcFleetProfile', Object.freeze({
  bootstrap,
  migrateLegacy: profile => ipcRenderer.sendSync('mc-fleet-profile:migrate-legacy', profile),
  save: profile => ipcRenderer.invoke('mc-fleet-profile:save', profile),
  reset: () => ipcRenderer.invoke('mc-fleet-profile:reset'),
  importFile: () => ipcRenderer.invoke('mc-fleet-profile:import-file'),
  exportFile: profile => ipcRenderer.invoke('mc-fleet-profile:export-file', profile),
  chooseDirectory: () => ipcRenderer.invoke('mc-fleet-profile:choose-directory'),
  probe: profile => ipcRenderer.invoke('mc-fleet-profile:probe', profile),
}))

function rgbToHex(rgb) {
  const match = rgb.match(/(\d+)[, ]+(\d+)[, ]+(\d+)/)
  if (!match) return '#fdfdfd'
  return `#${[match[1], match[2], match[3]].map(number => Number(number).toString(16).padStart(2, '0')).join('')}`
}

let settleTimer = null
function reportTheme() {
  const send = () => {
    const style = getComputedStyle(document.body)
    ipcRenderer.send('mc-theme', {
      theme: document.documentElement.dataset.theme || 'white',
      bg: rgbToHex(style.backgroundColor),
      ink: rgbToHex(style.color),
    })
  }
  /* Two passes matter because the page surface eases between themes. A lone
     next-frame read sampled the old colour and left the caption buttons stuck
     on the previous theme until the owner focused the window again. */
  requestAnimationFrame(send)
  clearTimeout(settleTimer)
  settleTimer = setTimeout(send, 600)
}

/* Native caption buttons are OS-drawn over this strip. The strip stays
   transparent so it inherits the renderer surface instead of maintaining a
   second palette that can drift from styles.css. */
const TITLEBAR_HEIGHT = 36
function injectTitlebar() {
  document.documentElement.classList.add('in-shell')
  document.body.classList.add('in-shell')
  const style = document.createElement('style')
  style.textContent = `
    #shell-titlebar {
      position: fixed; top: 0; left: 0; right: 0; height: ${TITLEBAR_HEIGHT}px;
      z-index: 200; -webkit-app-region: drag;
      display: flex; align-items: center; justify-content: center;
      border-bottom: 1px solid var(--line, rgba(128,128,128,0.18));
      font-size: 11px; font-weight: 600; letter-spacing: 0.14em;
      color: var(--ink-3, #888); user-select: none;
    }
    html.in-shell #stage { height: calc(100vh - ${TITLEBAR_HEIGHT}px); margin-top: ${TITLEBAR_HEIGHT}px; }
    html.in-shell .topbar { top: calc(14px + ${TITLEBAR_HEIGHT}px); }
    html.in-shell .drawer { top: calc(14px + ${TITLEBAR_HEIGHT}px); }
  `
  document.head.appendChild(style)
  const bar = document.createElement('div')
  bar.id = 'shell-titlebar'
  bar.textContent = 'MISSION CONTROL'
  document.body.prepend(bar)
}

window.addEventListener('DOMContentLoaded', () => {
  injectTitlebar()
  reportTheme()
  new MutationObserver(reportTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  // A throttled background frame heals as soon as the window returns.
  window.addEventListener('focus', reportTheme)
})
