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
import { researchView } from './views/research.js'
import { commsView } from './views/comms.js'
import { ledgerView } from './views/ledger.js'
import { settingsView } from './views/settings.js'
import { chatView } from './views/chat.js'
import { rangeFill } from './views/computers.js'
import { LIVE_FLAGS_EVENT } from './live-flags.js'
import { WRITE_FLAGS_EVENT } from './write-flags.js'

// loaded last so the shared-element morph rules win over the base sheets
import './morphs.css'

const stage = document.getElementById('stage')
const crumb = document.getElementById('crumb')   // removed from the markup; kept null-safe
const navEl = document.getElementById('tb-nav')   // ditto — the strip is arrows + settings only

let current = null           // { el(wrapper), view, route }
const ORDER = ['home', 'computers', 'metrics', 'research', 'comms', 'ledger']

function parse() {
  const h = location.hash || '#/'
  const parts = h.replace(/^#\//, '').split('/').filter(Boolean)
  if (parts[0] === 'computers') return { name: 'computers', comp: parts[1] || null }
  if (parts[0] === 'agent' && parts.length >= 3) return { name: 'agent', comp: parts[1], agent: parts[2] }
  if (parts[0] === 'metrics') return { name: 'metrics' }
  if (parts[0] === 'research') return { name: 'research' }
  if (parts[0] === 'comms') return { name: 'comms' }
  if (parts[0] === 'ledger') return { name: 'ledger' }
  if (parts[0] === 'settings') return { name: 'settings' }
  if (parts[0] === 'chat') return { name: 'chat' }
  return { name: 'home' }
}

function makeView(route) {
  const navigate = (hash) => { location.hash = hash }
  switch (route.name) {
    case 'computers': return computersView({ initialComputer: route.comp, navigate })
    case 'agent': return agentView({ compId: route.comp, agentId: route.agent, navigate })
    case 'metrics': return metricsView()
    case 'research': return researchView()
    case 'comms': return commsView()
    case 'ledger': return ledgerView()
    case 'settings': return settingsView()
    case 'chat': return chatView()
    default: return homeView()
  }
}

function crumbFor(route) {
  const base = `<b>fleet</b> · local`
  switch (route.name) {
    case 'computers': return `${base} / computers`
    case 'agent': return `${base} / agent / <b>${route.agent}</b>`
    case 'metrics': return `${base} / metrics`
    case 'research': return `${base} / research`
    case 'comms': return `${base} / comms`
    case 'ledger': return `${base} / ledger`
    case 'settings': return `${base} / settings`
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

  if (crumb) crumb.innerHTML = crumbFor(route)
  // Route stamp on <body>. It was added to gate the aurora drift to Home;
  // the aurora is gone and no sheet reads it today, but it stays as the
  // one hook a per-route rule can hang off without touching the router.
  document.body.dataset.route = route.name
  const activeName = route.name === 'agent' ? 'computers' : route.name
  navEl?.querySelectorAll('a').forEach(a => a.classList.toggle('active', a.dataset.route === activeName))

  const idx = ORDER.indexOf(activeName)
  const back = document.getElementById('nav-back')
  const next = document.getElementById('nav-next')
  /* The ring is closed: home <- computers <- metrics <- research <- comms <- ledger <- home. The
     ends used to dead-end (back dark on home, forward dark on comms), which
     made the two arrows read as a linear pager with nothing past its covers.
     The owner asked for a loop — back and forth exist on every page — so
     neither arrow ever disables and the maths below is modular. */
  back.toggleAttribute('disabled', false)
  next.toggleAttribute('disabled', false)

  /* The arrows are now the ONLY navigation, so each one quietly names where
     it goes — but only once you reach for it. Nothing at rest; the label
     fades in on hover/focus. Fewer pieces, and the ones left do more. */
  const label = (n) => (n === 'home' ? 'home' : n)
  const ringAt = (i) => ORDER[(i + ORDER.length) % ORDER.length]
  back.dataset.dest = route.name === 'agent' ? 'computers' : label(ringAt(idx - 1))
  next.dataset.dest = route.name === 'agent' ? 'metrics' : label(ringAt(idx + 1))

  /* …and the same destination has to reach a screen reader, which the CSS
     ::after caption never could: it is generated content, and the static
     aria-label ("Back"/"Next") outranked it in the accessible name anyway.
     With the tab strip and the breadcrumb both gone, these two labels plus
     the document title are ALL the wayfinding the page has left, so both are
     written from the same data-dest the caption reads. */
  const backName = back.dataset.dest ? `Back to ${back.dataset.dest}` : 'Back'
  const nextName = next.dataset.dest ? `Forward to ${next.dataset.dest}` : 'Forward'
  // title and aria-label are written from the same string so the tooltip can
  // never disagree with the accessible name (WCAG 2.5.3); the visible ::after
  // caption is just the destination word, which both of them contain.
  back.setAttribute('aria-label', backName); back.setAttribute('title', backName)
  next.setAttribute('aria-label', nextName); next.setAttribute('title', nextName)
  const routeName = route.name === 'agent' ? `agent ${route.agent}` : route.name
  document.title = `${routeName} · Mission Control`
}

window.addEventListener('hashchange', render)
// A source flag can also be flipped from a diagnostic harness or another
// same-page control. Rebuild the active read surface so LIVE <-> SIMULATED is
// an immediate rollback, while the settings page keeps its inline controls in
// place and updates them locally.
window.addEventListener(LIVE_FLAGS_EVENT, () => {
  if (current?.route?.name !== 'settings') queueMicrotask(render)
})
window.addEventListener(WRITE_FLAGS_EVENT, () => {
  if (current?.route?.name !== 'settings') queueMicrotask(render)
})

const hashFor = (name) => (name === 'home' ? '#/' : `#/${name}`)
document.getElementById('nav-back').addEventListener('click', () => {
  const route = parse()
  // the agent view is a drill-in, not a ring stop: back surfaces to its graph
  if (route.name === 'agent') { location.hash = '#/computers'; return }
  const idx = ORDER.indexOf(route.name)
  location.hash = hashFor(ORDER[(idx - 1 + ORDER.length) % ORDER.length])
})
document.getElementById('nav-next').addEventListener('click', () => {
  const route = parse()
  // ...and forward from the drill-in resumes the ring after its graph
  if (route.name === 'agent') { location.hash = '#/metrics'; return }
  const idx = ORDER.indexOf(route.name)
  location.hash = hashFor(ORDER[(idx + 1) % ORDER.length])
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

/* The OPEN drawer is the mirror image of the closed one: it covers the page,
   so everything behind it has to leave the tab order too. Without this, Tab
   from the gear walked 16 stops through the page before reaching the drawer,
   and two of those stops (#nav-next, fully; the "Sort by Runtime" header,
   58%) were underneath the open drawer — focus you cannot see, which is
   WCAG 2.2 SC 2.4.11. Same `inert` mechanism as the closed-drawer guard,
   pointed the other way; where inert is unsupported the browser simply keeps
   its old behaviour rather than us re-implementing a trap by hand. */
const behindDrawer = [document.querySelector('header.topbar'), document.getElementById('stage')].filter(Boolean)
function enforcePageGuard() {
  if (!supportsInert) return
  for (const node of behindDrawer) {
    if (node.hasAttribute('inert') !== drawerOpen) node.toggleAttribute('inert', drawerOpen)
  }
}

const setDrawer = (open) => {
  drawerOpen = open
  drawer.classList.toggle('open', open)
  drawer.setAttribute('aria-hidden', open ? 'false' : 'true')
  openSettingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false')
  enforceDrawerFocusGuard()
  // order matters on the way OUT: the header has to stop being inert before
  // closeDrawer() can hand focus back to the gear inside it
  enforcePageGuard()
}
// childList/subtree + the inert attribute only: the fallback path writes
// tabindex, which is deliberately outside the filter so it cannot loop.
new MutationObserver(enforceDrawerFocusGuard).observe(drawer, {
  childList: true, subtree: true, attributes: true, attributeFilter: ['inert'],
})

const closeDrawer = () => {
  // an inert drawer cannot hold focus; hand it back to the control that
  // opened it instead of dropping the user at the top of the document. Focus
  // that has already fallen off the document (body/null — where Tab past the
  // drawer's last control leaves it) counts too, or the keyboard user is left
  // restarting the tab order from the top of the page.
  const a = document.activeElement
  const hadFocus = drawer.contains(a) || !a || a === document.body
  setDrawer(false)
  if (hadFocus) openSettingsBtn.focus()
}
const openDrawer = () => {
  setDrawer(true)
  // focus follows the surface that just covered the page — the close button
  // is the drawer's first stop, so Tab continues through Theme/Glow/Pace/
  // Reduce motion from there instead of starting back at the top of the page
  document.getElementById('close-settings').focus()
}
openSettingsBtn.addEventListener('click', openDrawer)
document.getElementById('close-settings').addEventListener('click', closeDrawer)
document.querySelector('.drawer-all').addEventListener('click', closeDrawer)
document.addEventListener('keydown', (e) => {
  if (!drawerOpen) return
  if (e.key === 'Escape') { closeDrawer(); return }
  /* aria-modal="true" is a promise that focus stays inside, and `inert`
     alone only keeps it out of the PAGE — Tab past the last drawer control
     still walked off into the browser chrome and came back at the top of an
     inert document, i.e. nowhere. Wrap it. */
  if (e.key !== 'Tab') return
  const stops = [...drawer.querySelectorAll(FOCUSABLE)]
    .filter(n => !n.hasAttribute('disabled') && n.tabIndex !== -1 && n.offsetParent !== null)
  if (!stops.length) return
  const first = stops[0], last = stops[stops.length - 1]
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
})
/* The drawer has no scrim, so with the page now inert behind it a click on
   the page would otherwise do nothing at all and read as a frozen app.
   Pointer-down outside dismisses instead. (The gear itself sits underneath
   the open drawer, so it is not a toggle — the drawer takes that hit.) */
document.addEventListener('pointerdown', (e) => {
  if (!drawerOpen || drawer.contains(e.target)) return
  /* closeDrawer() hands focus back to the gear, but the browser's DEFAULT
     action for this same pointerdown runs after us and moves focus to the
     clicked target (<body>, since the page is inert) — clobbering the
     restore and leaving keyboard users to re-Tab from the top. Cancelling
     the pointerdown suppresses that default focus pass; the page behind is
     inert, so the press had no other job this could break. */
  e.preventDefault()
  closeDrawer()
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

/* ---------- text size ----------
   The owner asked for a user-facing text-size setting. The app is sized in
   px throughout (13px reading floor, 12.5 data tier), so the honest scale
   control is zoom on the body: layout rescales coherently, fixed chrome
   included, and every chart re-fits itself because its host resizes and the
   existing ResizeObservers fire. Default is exactly 1 — an untouched user
   is byte-identical, and the QA suites (which assert px) run at default. */
const TEXT_KEY = 'mc.text'
const textSeg = document.getElementById('text-seg')
const readText = () => {
  try {
    const v = parseFloat(localStorage.getItem(TEXT_KEY))
    return v === 0.9 || v === 1.12 ? v : 1
  } catch { return 1 }
}
function applyText(v) {
  document.body.style.zoom = v === 1 ? '' : String(v)
  for (const b of textSeg.querySelectorAll('button')) {
    const on = parseFloat(b.dataset.text) === v
    b.classList.toggle('on', on)
    b.setAttribute('aria-pressed', on ? 'true' : 'false')
  }
}
textSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-text]')
  if (!b) return
  const v = parseFloat(b.dataset.text)
  try { localStorage.setItem(TEXT_KEY, String(v)) } catch {}
  applyText(v)
})
applyText(readText())

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
