// Shell: hash router with smooth view morphs (native View Transitions where
// the browser has them), settings drawer, central clock.

/* Bundled fonts — every face the font setting can apply ships in the build
   (no network font loading; the app works offline). Inter left with R1523:
   the owner declined it as the default, no remaining choice uses it, and an
   unimported font is dead bytes in the payload. JetBrains Mono serves both
   the data accents (--font-mono) and the all-mono interface choice. */
import '@fontsource-variable/ibm-plex-sans'
import { pageCanDraw } from './page-frames.js'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/jetbrains-mono'
import './glow.css'
import './styles.css'
/* The capabilities-and-risks disclosure (owner, R1529). Global rather than
   view-scoped because the quick-settings drawer draws it on every page, so the
   rules must exist before any view has been visited; and because the module
   that emits the markup is reached from a module `node --test` imports, which a
   stylesheet import inside it would break. */
import './guided-step.css'

import { fmtRuntime } from './sim.js'
import { tickRuntimes, takeViewMorph } from './components.js'
import { homeView } from './views/home.js'
import { computersView } from './views/computers.js'
import { agentView } from './views/agent.js'
import { metricsView } from './views/metrics.js'
import { researchView } from './views/research.js'
import { commsView } from './views/comms.js'
import { ledgerView } from './views/ledger.js'
import { approvalsView } from './views/approvals.js'
import { checkoutView } from './views/checkout.js'
import { settingsView, applyStoredSimPace } from './views/settings.js'
import { renderQuickSettings } from './quick-settings.js'
import { setupView } from './views/setup.js'
import { accountView } from './views/account.js'
import { guideView } from './views/guide.js'
import { subscribeView } from './views/subscribe.js'
import { LIVE_FLAGS_EVENT } from './live-flags.js'
import { WRITE_FLAGS_EVENT } from './write-flags.js'
import { SETUP_RESOLUTION, firstRunPending, shouldOpenSetup } from './setup-state.js'
import { mountSettingsRecoveryNotice } from './settings-recovery-notice.js'
import {
  CHECKOUT_SURFACE_EVENT,
  checkoutSurfaceAvailable,
  checkoutSurfaceSettled,
  probeCheckoutSurface,
} from './checkout-visibility.js'

// loaded last so the shared-element morph rules win over the base sheets
import './morphs.css'

const stage = document.getElementById('stage')
const crumb = document.getElementById('crumb')   // removed from the markup; kept null-safe
const navEl = document.getElementById('tb-nav')   // ditto — the strip is arrows + settings only

let current = null           // { el(wrapper), view, route }
// The arrows are the only navigation, so this ring IS the site map. Approvals
// sits next to the ledger because it is the same kind of thing — a register of
// owner requests — and because putting it last keeps home's neighbours stable
// for anyone who navigates by muscle memory.
// Checkout sits directly after approvals: both are surfaces where the owner
// decides about money, and the pair reads as one stretch of the ring rather
// than a shop dropped between the register and home.
// Settings is the last stop before the ring closes (owner, R1520: "a second
// way to access it by just going through the pages to the settings page") —
// so the page is one Back press from home, and walking forward reaches it
// after the money stretch. Before this it was reachable ONLY through the
// drawer's "all settings" link: a screen with exactly one door, and that door
// inside a popover.
const RING = ['home', 'computers', 'metrics', 'research', 'comms', 'ledger', 'approvals', 'checkout', 'settings']

/* STOPS THAT ONLY EXIST ON SOME COPIES.
 *
 * Checkout shows a purchase list the person running this copy supplied; there
 * is no such thing as a stock one. It shipped as an unconditional ring stop
 * carrying the builder's own internal list, on every install, one click back
 * from home -- see src/checkout-visibility.js for the measurement and for why
 * the bytes, not just the door, had to go.
 *
 * A predicate is the mechanism rather than an `if (checkout)` here because the
 * next conditional surface must not have to re-derive the fail-closed rule: a
 * stop is on the ring only when its predicate says TRUE. Anything else --
 * false, undefined, an exception, not measured yet -- leaves it off. */
const CONDITIONAL_STOPS = Object.freeze({
  checkout: checkoutSurfaceAvailable,
})

function stopIsOffered(name) {
  const predicate = CONDITIONAL_STOPS[name]
  if (!predicate) return true
  try { return predicate() === true } catch { return false }
}

/** The ring as it exists on THIS copy, in ring order. */
function ringOrder() {
  return RING.filter(stopIsOffered)
}

function parse() {
  const h = location.hash || '#/'
  /* A hash can carry a query. Splitting the path off before the segments are
     read is not a new behaviour for the existing routes -- none of them has
     ever been reachable WITH a query, and `#/ledger?x=1` used to parse as a
     stop literally named "ledger?x=1" and silently resolve to home. The
     subscribe surface needs one (the payment provider returns the visitor to
     `#/subscribe?signup=<id>`), so the router learns to read one, once, here. */
  const [hashPath, hashQuery = ''] = h.replace(/^#\//, '').split('?')
  const parts = hashPath.split('/').filter(Boolean)
  const query = new URLSearchParams(hashQuery)
  if (parts[0] === 'computers') return { name: 'computers', comp: parts[1] || null }
  /* `/example` is a fourth segment rather than a stored preference on purpose.
     The empty computers page offers a way to SEE this surface on a machine that
     has no fleet yet, and the obvious implementation — flip `mc.live.agent` to
     `simulated` and navigate — pins that preference permanently: the day the
     customer finally has real agents, their own drill-in would still be showing
     demonstration data because a button they pressed once, months earlier, is
     still in force. Encoding the intent in the route instead means it lasts
     exactly as long as the visit, survives back/forward, and cannot outlive it. */
  if (parts[0] === 'agent' && parts.length >= 3) {
    return { name: 'agent', comp: parts[1], agent: parts[2], example: parts[3] === 'example' }
  }
  if (parts[0] === 'metrics') return { name: 'metrics' }
  if (parts[0] === 'research') return { name: 'research' }
  if (parts[0] === 'comms') return { name: 'comms' }
  if (parts[0] === 'ledger') return { name: 'ledger' }
  if (parts[0] === 'approvals') return { name: 'approvals' }
  if (parts[0] === 'checkout') return { name: 'checkout' }
  /* THE QUERY TRAVELS FOR SETTINGS TOO, and it is the difference between a link
     that names a switch and a link that drops a person at the top of a page
     with 219 controls on it. `?setting=<id>` is read by src/views/settings.js,
     which opens the section that holds it and scrolls to it. Same mechanism the
     subscribe route already uses; nothing else about this stop changes, and a
     plain `#/settings` still lands where it always did. */
  if (parts[0] === 'settings') return { name: 'settings', query }
  if (parts[0] === 'setup') return { name: 'setup' }
  if (parts[0] === 'account') return { name: 'account' }
  /* The one address every empty screen's door points at. It is a real stop in
     the router rather than an anchor on an existing page because six screens
     link to it: an unrouted `#/guide` resolves to home, which turns every one
     of those doors into a control that silently throws the reader back where
     they started -- the dead end the guide exists to close, wearing a link. */
  if (parts[0] === 'guide') return { name: 'guide' }
  /* `pricing` is what a stranger types; `subscribe` is what the product calls
     the surface. Both reach it rather than one of them reaching home, because a
     404 on the page that takes payment is a lost customer, not a typo. */
  if (parts[0] === 'subscribe' || parts[0] === 'pricing') return { name: 'subscribe', query }
  return { name: 'home' }
}

/* Screens that are not stops on the ring, and where each arrow goes from them.
   `agent` is a drill-in; `setup` is the first-run question; `account` is the
   sign-in surface, reached from the walkthrough and from Settings rather than
   by walking the ring. All three were single `route.name === 'agent'` ternaries
   below -- this is the same rule with more entries, not a new behaviour. */
const RING_EXIT = {
  agent: { back: 'computers', next: 'metrics' },
  setup: { back: 'home', next: 'home' },
  account: { back: 'home', next: 'home' },
  /* Off the ring for the same reason `account` is: the chevrons walk the
     product, and the page where you buy a subscription is not a stop on that
     tour. Both arrows return home so a visitor who arrives on it from a link
     can always get out. */
  subscribe: { back: 'home', next: 'home' },
  /* Off the ring, and src/views/guide.js says why in full: the chevrons walk the
     product, and a page about the product's PREREQUISITES is not a stop on that
     tour. Both arrows return home so a reader who arrived from any of the six
     doors can always get out. */
  guide: { back: 'home', next: 'home' },
}

/* A hash naming a stop this copy does not offer is not an error and must not be
 * a screen. It resolves to home, and the address bar is only rewritten once the
 * probe has SETTLED -- before that, "not offered" only means "not measured yet",
 * and rewriting on it would throw away the address of a surface this copy is
 * about to turn out to have. */
function resolve(route) {
  return stopIsOffered(route.name) ? route : { name: 'home', redirectedFrom: route.name }
}

function makeView(route) {
  const navigate = (hash) => { location.hash = hash }
  switch (route.name) {
    case 'computers': return computersView({ initialComputer: route.comp, navigate })
    case 'agent': return agentView({ compId: route.comp, agentId: route.agent, example: route.example, navigate })
    case 'metrics': return metricsView()
    case 'research': return researchView()
    case 'comms': return commsView()
    case 'ledger': return ledgerView()
    case 'approvals': return approvalsView()
    case 'checkout': return checkoutView({ navigate })
    case 'settings': return settingsView({ query: route.query })
    case 'setup': return setupView({ navigate })
    case 'account': return accountView({ navigate })
    case 'guide': return guideView()
    case 'subscribe': return subscribeView({ query: route.query })
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
    case 'approvals': return `${base} / approvals`
    case 'checkout': return `${base} / checkout`
    case 'settings': return `${base} / settings`
    case 'setup': return `${base} / setup`
    case 'account': return `${base} / account`
    case 'guide': return `${base} / guide`
    case 'subscribe': return `${base} / subscribe`
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

/* THE FIRST-RUN GATE.
 *
 * The permission level is the one thing docs/design/INSTALLER-EXPERIENCE.md 2.1
 * says has to be decided before anything else, and this app had no screen that
 * asked it -- so an installed copy ran with no level recorded and nothing ever
 * said so. When the shell can record one and none exists, the first launch
 * opens on the question.
 *
 * It fails OPEN, deliberately. `firstRunPending` is false whenever the app
 * cannot write a level at all (a browser, a build with no capability payload,
 * a machine record that exists but cannot be parsed). Gating on a screen whose
 * only button is guaranteed to fail would turn a missing payload into an app
 * nobody can get past, which is a worse product than one that carries on and
 * says so in Settings.
 *
 * The body class is what hides the navigation chrome, and it is recomputed on
 * every render rather than set once: the moment a level is recorded the arrows
 * come back, and revisiting this screen later to CHANGE a level is not a trap.
 */
function syncFirstRunChrome() {
  document.body.classList.toggle('first-run', firstRunPending(SETUP_RESOLUTION))
}

function render() {
  const route = resolve(parse())
  if (route.redirectedFrom && checkoutSurfaceSettled()) {
    // the hashchange this fires re-enters render() with the home route
    location.hash = '#/'
    return
  }

  syncFirstRunChrome()
  if (shouldOpenSetup(SETUP_RESOLUTION, route.name)) {
    // the hashchange this fires re-enters render() with the setup route
    location.hash = '#/setup'
    return
  }

  // a view can hand us a shared element to morph through (e.g. the agent
  // bubble behind "Open full view"); it only ever affects motion, never a route
  const morph = takeViewMorph()
  const zoom = !!(morph && current && morph.kind === 'zoom' && performance.now() - morph.at < 900) && pageCanAnimate()

  // The zoom morph needs both views genuinely on screen (the outgoing one
  // scales into the node the incoming one fades up through), so it keeps the
  // class path; so does the first paint, which has nothing to fade from.
  if (supportsViewTransition && current && !zoom && !motionReduced() && pageCanAnimate()) {
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
 * CAN THIS PAGE ACTUALLY DRAW A FRAME RIGHT NOW?
 *
 * A window whose page reports visibilityState 'hidden' gets NO rendering
 * frames from Chromium. Measured on this machine, 2026-08-18, and the honest
 * summary is that it VARIES: two windows of the same build, spawned by the
 * same command minutes apart, reported 'visible' and 'hidden' respectively.
 * The variable is occlusion -- copies of this product open at the same default
 * bounds and cover each other, and a covered page is a page without frames --
 * not any spawn flag, which an earlier version of this comment wrongly named
 * as the cause. (Minimising is what the retention harness ASKS for and then
 * verifies through the page; it was not isolated as an independent cause.)
 * Every piece of motion this router
 * schedules is then a promise the browser can never keep, and worse than
 * useless: work parked on "the next frame" is parked forever, and what it
 * references is retained forever. Heap snapshots of the packaged build
 * (tools/performance-budget-qa.mjs --snapshot, read by
 * tools/heap-snapshot-retainers.mjs) caught both forms of that debt, one
 * whole dead view per navigation, +15,607 DOM nodes and +145 listeners per
 * lap of the ring:
 *
 *   - the `exit` class starts a CSS transition, and a removed element's
 *     transition is only cancelled by a rendering lifecycle update; with no
 *     frames the chain DocumentTimeline -> HeapHashTable<Member<Animation>>
 *     -> CSSTransition -> dead wrapper -> entire dead view persists. Trying
 *     to undo it later was measured and does not work: explicit
 *     Animation.cancel() at retirement freed lap 1 and neither lap after it,
 *     so the transition must not be STARTED rather than cancelled;
 *   - the double-rAF that lifts `enter` is the same shape as seven view-level
 *     sites the pending-frame census DID name and measure
 *     (src/page-frames.js): a queued callback holds its closure, the closure
 *     holds the view. This particular callback was gated with the rest of the
 *     motion before that census existed, so it is guarded for a proven
 *     pattern rather than as a separately measured holder.
 *
 * So the rule is decided ONCE, here, at the moment of navigation: a page that
 * cannot draw does not animate. No transition classes, no rAF choreography,
 * no view-transition — the swap happens at its resting state immediately, and
 * the 420ms retirement grace (which Setup's async handlers genuinely need —
 * see the inert comment below) is kept identical in both worlds, because it
 * is a LIFETIME contract, not a motion.
 *
 * Read per navigation rather than cached: the same window is covered and
 * uncovered all day, and each swap answers for the state it actually runs in.
 */
/* THE RULE ITSELF LIVES IN src/page-frames.js, so the router and the view
   code that schedules frames cannot drift apart about what "this page can
   draw" means. The local name is kept because this file reads better with it. */
const pageCanAnimate = pageCanDraw

/* THE SAME RULE FOR EVERY SHEET-DECLARED TRANSITION, not only the router's.
 *
 * Gating the router's own motion (above) removed its wrappers from the leak
 * and the next heap snapshot promptly named a different holder: the settings
 * page's .seg-ind indicator, whose width/transform transition is created
 * while the view is BUILT — the page sets inline styles, product code forces
 * a style flush, and a hidden page then owns one more CSSTransition it can
 * never run, finish, or cancel. Both were tried with explicit
 * Animation.cancel() at retirement, and both times the cancelled transition
 * stayed registered on the DocumentTimeline anyway: unregistering is itself
 * frame work. There are ~50 transition declarations across the sheets, and
 * every one of them is this bug on a page that cannot draw.
 *
 * So while the page is frameless, stylesheet transitions are switched off at
 * the root (body.frameless, styles.css) and nothing is created — there is
 * nothing to see them with anyway. The moment the window is uncovered the
 * class lifts and every FUTURE change animates exactly as designed: this is
 * a guard on when motion may start, never a removal of it. */
const syncFramelessMotion = () => document.body.classList.toggle('frameless', !pageCanAnimate())
document.addEventListener('visibilitychange', syncFramelessMotion)
/* From the first line, not the first change of state: a window spawned hidden
   (a real spawn mode — measured) builds its every view frameless. */
syncFramelessMotion()

/**
 * Take a retired view out of the page completely — including the browser's
 * own account of it. destroy() honours the view's contract; cancelling the
 * subtree's animations lets the DocumentTimeline drop anything a VISIBLE
 * window was still transitioning when the element left mid-motion (hidden
 * windows never start one — see pageCanAnimate); the forced layout read lets
 * the layout tree release the retired wrapper (an attached ancestor's
 * InlineItems kept referencing the removed wrapper's layout objects in the
 * same snapshots) without waiting for a frame that may never come. It runs
 * in the exit timer, off the interaction path.
 */
function retireView(el, view) {
  view.destroy?.()
  if (typeof el.getAnimations === 'function') {
    for (const animation of el.getAnimations({ subtree: true })) animation.cancel()
  }
  el.remove()
  void stage.offsetWidth
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

  if (snapshotted || !pageCanAnimate()) {
    // the pseudo-elements carry the motion; the real DOM must already be at
    // its resting state when the browser captures the "new" frame. A hidden
    // page takes the same branch for the opposite reason: there will BE no
    // frame, so a double-rAF parked here would hold this wrapper (and the
    // whole view under it) in the callback registry until the window is next
    // uncovered — measured as part of the retention this file's retireView
    // comment documents.
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
    /* The outgoing view stays on screen for the exit transition, so until it is
       removed it is still clickable. A person who presses a control on a view
       that is 420ms from being destroyed drives an instance whose async
       handlers come back to `destroyed === true` — which is how Finish in
       src/views/setup.js came to silently do nothing at all. It is leaving, so
       it takes no more input. */
    old.el.inert = true
    if (snapshotted) {
      retireView(old.el, old.view)
    } else if (zoom) {
      const r = old.el.getBoundingClientRect()
      const ox = Math.max(0, Math.min(r.width, morph.x - r.left))
      const oy = Math.max(0, Math.min(r.height, morph.y - r.top))
      old.el.style.transformOrigin = `${ox}px ${oy}px`   // the node's own position
      old.el.classList.add('mc-zoom-exit')
      setTimeout(() => retireView(old.el, old.view), VIEW_MORPH_MS + 40)
    } else {
      /* The class is the animation, so only a page that can draw gets it: on
         a hidden page it would start a CSS transition no frame will ever run
         or cancel, and the DocumentTimeline would hold this wrapper — view
         and all — until the window is next uncovered. The retirement TIMER is
         identical either way; only the motion is conditional. */
      if (pageCanAnimate()) old.el.classList.add('exit')
      setTimeout(() => retireView(old.el, old.view), 420)
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

  const order = ringOrder()
  const idx = order.indexOf(activeName)
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
  const ringAt = (i) => order[(i + order.length) % order.length]
  back.dataset.dest = RING_EXIT[route.name] ? RING_EXIT[route.name].back : label(ringAt(idx - 1))
  next.dataset.dest = RING_EXIT[route.name] ? RING_EXIT[route.name].next : label(ringAt(idx + 1))

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
  document.title = `${routeName} · ToolsEnabled`
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
/* The arrows walk the ring THIS COPY HAS. Reading the destination off the same
   ringOrder() the labels are written from is what stops the two disagreeing --
   a chevron captioned "home" that lands on a stop the copy does not offer is
   how a hidden surface comes back through the only navigation the app has. */
const stepRing = (from, delta) => {
  const order = ringOrder()
  const idx = order.indexOf(from)
  if (idx === -1) return order[delta > 0 ? 0 : order.length - 1]
  return order[(idx + delta + order.length) % order.length]
}
document.getElementById('nav-back').addEventListener('click', () => {
  const route = resolve(parse())
  // the agent view is a drill-in, not a ring stop: back surfaces to its graph
  if (RING_EXIT[route.name]) { location.hash = hashFor(RING_EXIT[route.name].back); return }
  location.hash = hashFor(stepRing(route.name, -1))
})
document.getElementById('nav-next').addEventListener('click', () => {
  const route = resolve(parse())
  // ...and forward from the drill-in resumes the ring after its graph
  if (RING_EXIT[route.name]) { location.hash = hashFor(RING_EXIT[route.name].next); return }
  location.hash = hashFor(stepRing(route.name, 1))
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
  // built fresh at every open, for the page that is on screen (owner R1520:
  // per-page settings, not the same simulation-flavoured list everywhere)
  renderQuickSettings(drawer.querySelector('.drawer-body'), resolve(parse()).name)
  setDrawer(true)
  // focus follows the surface that just covered the page — the close button
  // is the drawer's first stop, so Tab continues through the page group and
  // Theme/Glow/Reduce motion from there instead of the top of the page
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

/* ---------- stored appearance, re-applied before the first render ----------
   The controls themselves live in src/quick-settings.js now (built per page,
   at every drawer open) and on the settings page; what remains here is the
   boot half of each sticky setting.

   Theme is already on the page — the inline classic script in index.html
   applies it before first paint (same key, same guard), and the drawer reads
   document.documentElement.dataset.theme whenever it renders, so there is no
   second copy to sync here any more.

   Text size (the owner's user-facing scale control) is zoom on the body: the
   app is sized in px throughout (13px reading floor, 12.5 data tier), so
   zoom rescales layout coherently, fixed chrome included, and every chart
   re-fits itself because its host resizes and the existing ResizeObservers
   fire. Default is exactly 1 — an untouched user is byte-identical, and the
   QA suites (which assert px) run at default. */
try {
  const v = parseFloat(localStorage.getItem('mc.text'))
  if (v === 0.9 || v === 1.12) document.body.style.zoom = String(v)
} catch {}
/* Simulation pace moved out of the drawer (owner R1520 — the upper-right
   control kept showing simulation settings on every page) and into the
   settings page's Data & Sim section, where it persists; this re-applies the
   stored choice to the sim clock at launch. */
applyStoredSimPace()

/* ---------- central clock for every runtime readout ---------- */
setInterval(() => tickRuntimes(fmtRuntime), 500)

/* WHICH CONDITIONAL STOPS THIS COPY HAS, ASKED ONCE, AT THE START.
 *
 * The first paint does not wait for the answer -- a loopback read is instant in
 * the ordinary case and blocking the window on it would trade a real defect for
 * a worse one -- so the ring simply starts without its conditional stops and
 * gains them when the probe lands. That order is the safe one: the ring can only
 * GROW when the answer arrives, so a slow or failed probe hides a surface rather
 * than briefly showing one. */
window.addEventListener(CHECKOUT_SURFACE_EVENT, () => render())
void probeCheckoutSurface()

render()
/* The drawer rebuilds at every open; this first build only means its body is
   never empty — a harness (or a stylesheet measure) that reaches for
   #theme-seg before ever pressing the gear still finds it. */
renderQuickSettings(drawer.querySelector('.drawer-body'), resolve(parse()).name)

/* IF THE SETTINGS FILE COULD NOT BE READ, SAY SO. Mounted after the first
   render and outside it, because it is a fact about this WINDOW rather than
   about the current route: it must not be torn down and rebuilt by every
   navigation, and it must not disappear when a view does. See
   src/settings-recovery-notice.js for why silence here is the defect. */
mountSettingsRecoveryNotice()
