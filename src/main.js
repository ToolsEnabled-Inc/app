// Shell: hash router with smooth view morphs (native View Transitions where
// the browser has them), settings drawer, central clock.

import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './glow.css'
import './styles.css'

import { sim, fmtRuntime } from './sim.js'
import { tickRuntimes, takeViewMorph } from './components.js'
import { homeView } from './views/home.js'
import { computersView } from './views/computers.js'
import { agentView } from './views/agent.js'
import { metricsView } from './views/metrics.js'
import { commsView } from './views/comms.js'
import { rangeFill } from './views/computers.js'

// loaded last so the shared-element morph rules win over the base sheets
import './morphs.css'

const stage = document.getElementById('stage')
const crumb = document.getElementById('crumb')
const navEl = document.getElementById('tb-nav')

let current = null           // { el(wrapper), view, route }
const ORDER = ['home', 'computers', 'metrics', 'comms']

function parse() {
  const h = location.hash || '#/'
  const parts = h.replace(/^#\//, '').split('/').filter(Boolean)
  if (parts[0] === 'computers') return { name: 'computers', comp: parts[1] || null }
  if (parts[0] === 'agent' && parts.length >= 3) return { name: 'agent', comp: parts[1], agent: parts[2] }
  if (parts[0] === 'metrics') return { name: 'metrics' }
  if (parts[0] === 'comms') return { name: 'comms' }
  return { name: 'home' }
}

function makeView(route) {
  const navigate = (hash) => { location.hash = hash }
  switch (route.name) {
    case 'computers': return computersView({ initialComputer: route.comp, navigate })
    case 'agent': return agentView({ compId: route.comp, agentId: route.agent, navigate })
    case 'metrics': return metricsView()
    case 'comms': return commsView()
    default: return homeView()
  }
}

function crumbFor(route) {
  const base = `<b>fleet</b> · local`
  switch (route.name) {
    case 'computers': return `${base} / computers`
    case 'agent': return `${base} / agent / <b>${route.agent}</b>`
    case 'metrics': return `${base} / metrics`
    case 'comms': return `${base} / comms`
    default: return `${base} / home`
  }
}

const VIEW_MORPH_MS = 500

/* The plain route change is a crossfade, which is exactly what the native
   View Transitions API does better than we can: the browser snapshots the
   outgoing stage, so nothing has to keep two live views (two graph canvases,
   two rAF loops) on screen at once. It is a progressive enhancement —
   feature-detected, with the existing class-driven .enter/.exit crossfade
   as the fallback on browsers without it. */
const supportsViewTransition = typeof document.startViewTransition === 'function'
const motionQuery = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null
/* The ::view-transition pseudo-elements live on the document root, outside
   any selector body.reduce-motion can reach, so the runtime toggle has to be
   honoured here in JS rather than in the sheet. */
const motionReduced = () =>
  document.body.classList.contains('reduce-motion') || !!motionQuery?.matches

function render() {
  const route = parse()

  // a view can hand us a shared element to morph through (e.g. the agent
  // bubble behind "Open full view"); it only ever affects motion, never a route
  const morph = takeViewMorph()
  const zoom = !!(morph && current && morph.kind === 'zoom' && performance.now() - morph.at < 900)

  // The zoom morph needs both views genuinely on screen (the outgoing one
  // scales into the node the incoming one fades up through), so it keeps the
  // class path; so does the first paint, which has nothing to fade from.
  if (supportsViewTransition && current && !zoom && !motionReduced()) {
    const vt = document.startViewTransition(() => swapView(route, morph, zoom, true))
    // Navigating again mid-transition SKIPS the running one, which rejects
    // all three promises. Verified in headless Chromium: leaving `ready`
    // unhandled threw "AbortError: Transition was skipped" at the page on
    // every fast double navigation. The route swap itself still completes.
    vt.ready?.catch(() => {})
    vt.finished?.catch(() => {})
    vt.updateCallbackDone?.catch(() => {})
    return
  }
  swapView(route, morph, zoom, false)
}

/**
 * Mount the view for `route` and retire the previous one.
 * `snapshotted` = the browser is already crossfading a captured frame for us,
 * so the swap itself must be instant and unanimated.
 */
function swapView(route, morph, zoom, snapshotted) {
  const old = current
  const view = makeView(route)
  const wrap = document.createElement('div')
  wrap.className = 'view enter'
  wrap.appendChild(view.el)
  stage.appendChild(wrap)

  if (snapshotted) {
    // the pseudo-elements carry the motion; the real DOM must already be at
    // its resting state when the browser captures the "new" frame
    wrap.classList.remove('enter')
  } else if (zoom) {
    // incoming view fades up through the outgoing one — both are present for
    // the whole move, so the page never blanks to the backdrop
    wrap.classList.remove('enter')
    wrap.classList.add('mc-zoom-enter')
    setTimeout(() => wrap.classList.remove('mc-zoom-enter'), VIEW_MORPH_MS + 80)
  } else {
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.remove('enter')))
  }

  if (old) {
    if (snapshotted) {
      old.view.destroy?.()
      old.el.remove()
    } else if (zoom) {
      const r = old.el.getBoundingClientRect()
      const ox = Math.max(0, Math.min(r.width, morph.x - r.left))
      const oy = Math.max(0, Math.min(r.height, morph.y - r.top))
      old.el.style.transformOrigin = `${ox}px ${oy}px`   // the node's own position
      old.el.classList.add('mc-zoom-exit')
      setTimeout(() => { old.view.destroy?.(); old.el.remove() }, VIEW_MORPH_MS + 40)
    } else {
      old.el.classList.add('exit')
      setTimeout(() => { old.view.destroy?.(); old.el.remove() }, 420)
    }
  }
  current = { el: wrap, view, route }

  crumb.innerHTML = crumbFor(route)
  // Route stamp on <body>. It was added to gate the aurora drift to Home;
  // the aurora is gone and no sheet reads it today, but it stays as the
  // one hook a per-route rule can hang off without touching the router.
  document.body.dataset.route = route.name
  const activeName = route.name === 'agent' ? 'computers' : route.name
  navEl.querySelectorAll('a').forEach(a => a.classList.toggle('active', a.dataset.route === activeName))

  const idx = ORDER.indexOf(activeName)
  document.getElementById('nav-back').toggleAttribute('disabled', route.name === 'home')
  document.getElementById('nav-next').toggleAttribute('disabled', idx === ORDER.length - 1 && route.name !== 'agent')
}

window.addEventListener('hashchange', render)

document.getElementById('nav-back').addEventListener('click', () => {
  const route = parse()
  if (route.name === 'agent') { location.hash = '#/computers'; return }
  const idx = ORDER.indexOf(route.name)
  location.hash = idx > 0 ? (ORDER[idx - 1] === 'home' ? '#/' : `#/${ORDER[idx - 1]}`) : '#/'
})
document.getElementById('nav-next').addEventListener('click', () => {
  const route = parse()
  const name = route.name === 'agent' ? 'computers' : route.name
  const idx = ORDER.indexOf(name)
  if (idx < ORDER.length - 1) location.hash = `#/${ORDER[idx + 1]}`
})

/* ---------- settings drawer ---------- */
const drawer = document.getElementById('drawer')
const openSettingsBtn = document.getElementById('open-settings')

/* `inert` (not just aria-hidden) keeps the CLOSED drawer out of the tab
   order — without it Tab walked through four off-screen controls, one of
   them a 0x0 checkbox where Space silently toggled Reduce Motion.

   The guard is derived from the drawer's own state and applied to the
   drawer ROOT, and a MutationObserver re-applies it whenever the drawer's
   markup or its `inert` attribute changes — so adding, reordering or
   replacing controls inside the drawer (another lane's edit, a future
   setting) cannot quietly re-open that hole. Where `inert` is unsupported,
   the same state is enforced by parking every focusable descendant at
   tabindex="-1" and restoring whatever it had on the way back out. */
const supportsInert = typeof HTMLElement !== 'undefined' && 'inert' in HTMLElement.prototype
const FOCUSABLE = 'a[href], area[href], button, input, select, textarea, iframe, summary, [tabindex], [contenteditable]'
let drawerOpen = false

function enforceDrawerFocusGuard() {
  const closed = !drawerOpen
  if (supportsInert) {
    // compare first: an unconditional write would re-trigger the observer
    if (drawer.hasAttribute('inert') !== closed) drawer.toggleAttribute('inert', closed)
    return
  }
  for (const node of drawer.querySelectorAll(FOCUSABLE)) {
    if (closed) {
      if (node.dataset.mcTabindex === undefined) {
        node.dataset.mcTabindex = node.getAttribute('tabindex') ?? ''
        node.setAttribute('tabindex', '-1')
      }
    } else if (node.dataset.mcTabindex !== undefined) {
      const prev = node.dataset.mcTabindex
      if (prev === '') node.removeAttribute('tabindex')
      else node.setAttribute('tabindex', prev)
      delete node.dataset.mcTabindex
    }
  }
}

const setDrawer = (open) => {
  drawerOpen = open
  drawer.classList.toggle('open', open)
  drawer.setAttribute('aria-hidden', open ? 'false' : 'true')
  enforceDrawerFocusGuard()
}
// childList/subtree + the inert attribute only: the fallback path writes
// tabindex, which is deliberately outside the filter so it cannot loop.
new MutationObserver(enforceDrawerFocusGuard).observe(drawer, {
  childList: true, subtree: true, attributes: true, attributeFilter: ['inert'],
})

const closeDrawer = () => {
  // an inert drawer cannot hold focus; hand it back to the control that
  // opened it instead of dropping the user at the top of the document
  const hadFocus = drawer.contains(document.activeElement)
  setDrawer(false)
  if (hadFocus) openSettingsBtn.focus()
}
openSettingsBtn.addEventListener('click', () => setDrawer(true))
document.getElementById('close-settings').addEventListener('click', closeDrawer)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drawerOpen) closeDrawer()
})
setDrawer(false)

/* ---------- theme: white | tan (Gruvbox Light Soft) | black ----------
   Sticky across sessions. This module is deferred, so the *first paint* copy
   of this read lives inline in index.html (same key, same guard) — without it
   a tan/black user got a white flash on every load. Here it re-reads the same
   value to sync the segmented control.
   localStorage can throw (private mode, quota), so every access is guarded
   and a failure simply means "use the default". */
const THEME_KEY = 'mc.theme'
const themeSeg = document.getElementById('theme-seg')
const readTheme = () => {
  try {
    const t = localStorage.getItem(THEME_KEY)
    return t === 'tan' || t === 'black' ? t : 'white'
  } catch { return 'white' }
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t
  for (const b of themeSeg.querySelectorAll('button')) {
    const on = b.dataset.theme === t
    b.classList.toggle('on', on)
    b.setAttribute('aria-pressed', on ? 'true' : 'false')
  }
}
themeSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-theme]')
  if (!b) return
  const t = b.dataset.theme
  try { localStorage.setItem(THEME_KEY, t) } catch {}
  applyTheme(t)
})
applyTheme(readTheme())

const glowInput = document.getElementById('set-glow')
glowInput.addEventListener('input', () => {
  document.documentElement.style.setProperty('--glow', String(glowInput.value / 100))
})
const paceInput = document.getElementById('set-pace')
paceInput.addEventListener('input', () => sim.setPace(paceInput.value / 100))
document.getElementById('set-motion').addEventListener('change', (e) => {
  document.body.classList.toggle('reduce-motion', e.target.checked)
})
document.querySelectorAll('.drawer input[type="range"]').forEach(rangeFill)

/* ---------- central clock for every runtime readout ---------- */
setInterval(() => tickRuntimes(fmtRuntime), 500)

render()
