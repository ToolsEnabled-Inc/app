// Sandboxed Electron preloads cannot require a sibling preload. This file is
// therefore the shell's composed boundary: it preserves the existing chrome
// behavior and adds only the fleet-profile bridge below. Turning sandboxing
// off to reuse one file would make configuration convenience a security
// regression, which is a worse version of the productionization gap.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mcShell', {
  titlebarHeight: 36,
  getBridgeProof: () => ipcRenderer.invoke('mc-bridge-proof'),
  // The shell names the exact bridge it supervises so the renderer pins to it
  // instead of scanning localhost and trusting the first responder -- which is
  // how a squatter is handed this boot's proof. See mc-bridge-endpoint in
  // main.cjs and configuredBaseUrl() in src/mission-bridge.js.
  getBridgeEndpoint: () => ipcRenderer.invoke('mc-bridge-endpoint'),
})

/* The agent bridge. BLOCKER 2 (R1162 non-author review) removed an earlier
   version of this exposure, and removing it was right at the time: the engine
   behind it was resolved from a hardcoded path into a private sibling checkout
   that shipped nowhere, so the control could only ever fail, and its failure
   path rendered that internal repo name into the DOM.

   It is re-established deliberately here, and it is not the old one:
   1. The engine path is configuration (MISSION_CONTROL_ENGINE), never a
      filesystem guess -- unconfigured fails closed instead of pretending.
   2. `availability()` lets the renderer ASK before it offers a control, so a
      build with no engine shows a stated-unavailable surface rather than a
      button guaranteed to fail.
   3. Nothing here can carry a path to the DOM: availability() replies
      {ok, code}, and the resolver's path-bearing message stays in main.

   It lives in THIS file, not shell/preload.cjs, for the reason stated at the
   top: this is the preload main.cjs actually loads. shell/preload.cjs is
   reachable from no window. */
contextBridge.exposeInMainWorld('mcAgent', Object.freeze({
  availability: () => ipcRenderer.invoke('mc-agent:availability', {}),
  start: request => ipcRenderer.invoke('mc-agent:start', request),
  send: request => ipcRenderer.invoke('mc-agent:send', request),
  interrupt: request => ipcRenderer.invoke('mc-agent:interrupt', request),
  close: request => ipcRenderer.invoke('mc-agent:close', request),
  /* Returns its own unsubscribe. A surface that mounts per navigation must be
     able to detach exactly its own listener, or every visit to an agent page
     leaves another one attached to the channel. */
  onEvent: listener => {
    if (typeof listener !== 'function') throw new TypeError('onEvent requires a listener function')
    const forward = (_event, packet) => { listener(packet) }
    ipcRenderer.on('mc-agent:event', forward)
    return () => { ipcRenderer.removeListener('mc-agent:event', forward) }
  },
}))

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

/* The permission level. Read synchronously for the same reason the fleet
   profile is: src/main.js decides whether this launch shows the setup question
   or the fleet, and it decides that before the first paint. Setting the level
   stays an explicit invoke.

   `bootstrap` is present and `available: false` in a build with no capability
   payload, so the renderer can state that plainly instead of offering a button
   that is guaranteed to fail -- the same rule mcAgent.availability() follows.
   In a plain browser (vite dev, preview) window.mcSetup is absent entirely,
   which the renderer reads as "there is no machine here to configure". */
const setup = ipcRenderer.sendSync('mc-setup:bootstrap')
contextBridge.exposeInMainWorld('mcSetup', Object.freeze({
  bootstrap: setup,
  chooseTier: tier => ipcRenderer.invoke('mc-setup:choose-tier', tier),
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
