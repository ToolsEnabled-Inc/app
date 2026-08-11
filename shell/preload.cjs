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

contextBridge.exposeInMainWorld('mcShell', {
  titlebarHeight: 36,
  getBridgeProof: () => ipcRenderer.invoke('mc-bridge-proof'),
})

/* BLOCKER 2 (R1162 non-author review) removed an earlier version of this
   exposure. That bridge was dead on every installation: the engine behind it
   was resolved from a hardcoded path into a private sibling checkout that
   shipped nowhere, so the control could only ever fail, and its failure path
   rendered that internal repo name into the DOM.

   This exposure is re-established deliberately, and it is NOT the old one.
   Three things are different, and each maps to one clause of that defect:

   1. The engine path is configuration (MISSION_CONTROL_ENGINE), never a
      filesystem guess. No engine configured means no engine -- it fails
      closed instead of pretending.
   2. `availability()` lets the renderer ASK before it offers a control, so a
      build with no engine shows a stated-unavailable surface rather than a
      button that is guaranteed to fail.
   3. Nothing here can carry a path to the DOM. availability() replies
      {ok, code}; the resolver's path-bearing message stays in the main
      process.

   The surface stays bounded on purpose: five named calls and a listener, each
   forwarding a plain object to a channel main.cjs already validates. The
   renderer never receives ipcRenderer itself.

   See tools/test/chat-agent-bridge-gated.test.mjs, which now gates these
   invariants instead of gating the exposure's absence. */
const AGENT_EVENT_CHANNEL = 'mc-agent:event'

contextBridge.exposeInMainWorld('mcAgent', {
  availability: () => ipcRenderer.invoke('mc-agent:availability', {}),
  start: (request) => ipcRenderer.invoke('mc-agent:start', request),
  send: (request) => ipcRenderer.invoke('mc-agent:send', request),
  interrupt: (request) => ipcRenderer.invoke('mc-agent:interrupt', request),
  close: (request) => ipcRenderer.invoke('mc-agent:close', request),
  /* Returns its own unsubscribe. A surface that mounts per navigation must be
     able to detach exactly its own listener, or every visit to an agent page
     leaves another one attached to the channel. */
  onEvent: (listener) => {
    if (typeof listener !== 'function') throw new TypeError('onEvent requires a listener function')
    const forward = (_event, packet) => { listener(packet) }
    ipcRenderer.on(AGENT_EVENT_CHANNEL, forward)
    return () => { ipcRenderer.removeListener(AGENT_EVENT_CHANNEL, forward) }
  },
})

function rgbToHex(rgb) {
  const m = rgb.match(/(\d+)[, ]+(\d+)[, ]+(\d+)/)
  if (!m) return '#fdfdfd'
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')
}

let settleTimer = null
function report() {
  const send = () => {
    const cs = getComputedStyle(document.body)
    ipcRenderer.send('mc-theme', {
      theme: document.documentElement.dataset.theme || 'white',
      bg: rgbToHex(cs.backgroundColor),
      ink: rgbToHex(cs.color),
    })
  }
  /* Two passes: the page's surface eases between themes, so a single
     next-frame read sampled the OLD colour whenever the transition won the
     race — the owner saw the caption buttons stuck on the previous theme.
     The settle pass re-reads after the ease and always wins. */
  requestAnimationFrame(send)
  clearTimeout(settleTimer)
  settleTimer = setTimeout(send, 600)
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
  // a missed update (backgrounded window, throttled frames) heals on return
  window.addEventListener('focus', report)
})
