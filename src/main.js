// Shell: hash router with smooth view morphs, settings drawer, central clock.

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

function render() {
  const route = parse()
  const old = current

  // a view can hand us a shared element to morph through (e.g. the agent
  // bubble behind "Open full view"); it only ever affects motion, never a route
  const morph = takeViewMorph()
  const zoom = !!(morph && old && morph.kind === 'zoom' && performance.now() - morph.at < 900)

  const view = makeView(route)
  const wrap = document.createElement('div')
  wrap.className = 'view enter'
  wrap.appendChild(view.el)
  stage.appendChild(wrap)

  if (zoom) {
    // incoming view fades up through the outgoing one — both are present for
    // the whole move, so the page never blanks to the backdrop
    wrap.classList.remove('enter')
    wrap.classList.add('mc-zoom-enter')
    setTimeout(() => wrap.classList.remove('mc-zoom-enter'), VIEW_MORPH_MS + 80)
  } else {
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.remove('enter')))
  }

  if (old) {
    if (zoom) {
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
  // aurora drift runs only where backdrop-filters are sparse (home); on the
  // graph/metrics pages a moving backdrop re-rasters every glass surface
  // every frame, which is what broke the 60fps gate
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
/* `inert` (not just aria-hidden) keeps the CLOSED drawer out of the tab
   order — without it Tab walked through four off-screen controls, one of
   them a 0x0 checkbox where Space silently toggled Reduce Motion. */
const setDrawer = (open) => {
  drawer.classList.toggle('open', open)
  drawer.setAttribute('aria-hidden', open ? 'false' : 'true')
  if (open) drawer.removeAttribute('inert')
  else drawer.setAttribute('inert', '')
}
document.getElementById('open-settings').addEventListener('click', () => setDrawer(true))
document.getElementById('close-settings').addEventListener('click', () => setDrawer(false))
setDrawer(false)

/* ---------- theme: white | tan (Gruvbox Light Soft) | black ----------
   Applied to <html> before first paint below, and sticky across sessions.
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
