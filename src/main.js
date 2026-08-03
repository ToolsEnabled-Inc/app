// Shell: hash router with smooth view morphs, settings drawer, central clock.

import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'

import { sim, fmtRuntime } from './sim.js'
import { tickRuntimes } from './components.js'
import { homeView } from './views/home.js'
import { computersView } from './views/computers.js'
import { agentView } from './views/agent.js'
import { metricsView } from './views/metrics.js'
import { rangeFill } from './views/computers.js'

const stage = document.getElementById('stage')
const crumb = document.getElementById('crumb')
const navEl = document.getElementById('tb-nav')

let current = null           // { el(wrapper), view, route }
const ORDER = ['home', 'computers', 'metrics']

function parse() {
  const h = location.hash || '#/'
  const parts = h.replace(/^#\//, '').split('/').filter(Boolean)
  if (parts[0] === 'computers') return { name: 'computers', comp: parts[1] || null }
  if (parts[0] === 'agent' && parts.length >= 3) return { name: 'agent', comp: parts[1], agent: parts[2] }
  if (parts[0] === 'metrics') return { name: 'metrics' }
  return { name: 'home' }
}

function makeView(route) {
  const navigate = (hash) => { location.hash = hash }
  switch (route.name) {
    case 'computers': return computersView({ initialComputer: route.comp, navigate })
    case 'agent': return agentView({ compId: route.comp, agentId: route.agent, navigate })
    case 'metrics': return metricsView()
    default: return homeView()
  }
}

function crumbFor(route) {
  const base = `<b>fleet</b> · local`
  switch (route.name) {
    case 'computers': return `${base} / computers`
    case 'agent': return `${base} / agent / <b>${route.agent}</b>`
    case 'metrics': return `${base} / metrics`
    default: return `${base} / home`
  }
}

function render() {
  const route = parse()
  const old = current

  const view = makeView(route)
  const wrap = document.createElement('div')
  wrap.className = 'view enter'
  wrap.appendChild(view.el)
  stage.appendChild(wrap)

  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.remove('enter')))

  if (old) {
    old.el.classList.add('exit')
    setTimeout(() => { old.view.destroy?.(); old.el.remove() }, 420)
  }
  current = { el: wrap, view, route }

  crumb.innerHTML = crumbFor(route)
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
document.getElementById('open-settings').addEventListener('click', () => {
  drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false')
})
document.getElementById('close-settings').addEventListener('click', () => {
  drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true')
})

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
