// Metrics — the Swiss instrument panel, and there is ONE of it now.
//
// This page used to be two pages wearing one route: a demonstration whose
// eight instruments tweened a simulated dataset, and a measured face that
// reads this computer's own signed records. The owner's ruling collapsed the
// split — "all simulated pages ARE the UI pages, just mock data" — so the
// demonstration engine, its dataset generator, its tween loop, its pools,
// verdicts, heartbeat and agent roster are gone from this file. What remains
// is the measured render, fed through one axis (src/data-source.js):
//
//   'local' / 'relay'  the real records, over the bridge this page has
//                      always read — readLocalRuns() / readLocalUsage().
//   'mock'             the product's own example records
//                      (src/sample-activity.js, src/sample-usage.js), fed
//                      through THE SAME parsers, describeLocalMetrics and
//                      projection path. The render cannot tell — which is the
//                      point — so the badge is keyed to the SOURCE and never
//                      to the look of the data: the face word, the data-face
//                      attribute and the made-up-numbers sentence under the
//                      filter row all come from the resolved source alone.
//
// Bands top to bottom: filter row · bare stat strip · the token-routing
// sankey · the token-flow band with its recorded-turn strip · runs by hour ·
// what became of each run · why a run did not start · tokens by sign-in ·
// the run table. Every chart on the page is drawn by
// src/metrics-live-charts.js, whose import graph is fenced (its suite walks
// it on every run) and whose draw() refuses any option it did not mint.

import '../metrics.css'
import { el, sparkline, attachSeg } from '../components.js'
import { buildTheme } from '../echarts-theme.js'
/* THE ONLY CHART ENGINE THIS PAGE BUILDS, and it lives in its own file on
   purpose. ../metrics-live-charts.js can see this computer's readings and the
   design tokens and NOTHING ELSE -- no import of an import of it reaches the
   simulation or the old demonstration option builders, and a test walks that
   graph on every run. Its option builders stamp a private mark that its own
   draw() checks, so an option minted anywhere else raises an exception
   instead of drawing a plausible picture. That fence is what makes it safe
   for one render to serve both real and example data. */
import {
  activityMatrix, activityOption, burnOption, createLiveCharts, liveWindow,
  outcomeOption, refusalOption, routingFlows, routingOption,
  tokenBandOption, tokenBands, turnCounts, turnStripOption, turnsInWindow,
} from '../metrics-live-charts.js'
import { createMetricsLayout } from '../metrics-layout.js'
/* WHERE THE NUMBERS ON THIS PAGE COME FROM. ../local-metrics.js reads the
   record this computer actually keeps: the signed, hash-chained ledger of
   every agent session this app has started, and the second chain of what each
   turn used. This module is the one place that decides what can honestly be
   said about either record; this view renders, it does not decide. */
import {
  LOCAL_METRICS_COPY,
  LOCAL_USAGE_COPY,
  UNMEASURED,
  describeLocalMetrics,
  readLocalRuns,
  readLocalUsage,
} from '../local-metrics.js'
/* The join that turns a session id into the agent a person named. See
   src/session-roles.js for why it is not inside local-metrics.js. */
import { readSessionRoles } from '../session-roles.js'
/* Metrics is one of the four screens src/first-run-needs.js names as
   permanently empty on a copy with no agent host. The label and the address of
   the page that explains why are imported, never retyped: six screens offer
   this door and six hand-written labels is six things to get wrong. */
import { GUIDE_ACTION } from '../first-run-needs.js'
/* The source axis. Resolution is async (a public page has to ask the host for
   a transport), so the load path resolves it in the same breath as the record
   read, and DATA_SOURCE_EVENT re-runs that load when the host says the world
   changed -- sign-in, sign-out, the example toggle. */
import { DATA_SOURCE_EVENT, resolveDataSource, sourceIsBadged } from '../data-source.js'
/* The example records. Raw ledger replies, deliberately: they go through
   readLocalRuns/readLocalUsage exactly as a real bridge reply would, so the
   example is exercised by the same parsers as a real machine and cannot drift
   into a shape the real screen no longer produces. */
import { sampleSessionsRaw } from '../sample-activity.js'
import { sampleUsageRaw } from '../sample-usage.js'

/* ---------------- provider series colour ----------------
   The legend chips over the token bands resolve their colour through the
   cascade (--prov-* on .metrics in src/metrics.css) so the black theme can
   re-step them. The fallback keeps an assistant this table does not know
   visible rather than transparent. */
const provInk = (id) => `var(--prov-${id}, var(--ink-3))`

/* ---------------- filter vocabulary ---------------- */

const RANGES = [['24h', '24h'], ['7d', '7d'], ['30d', '30d']]
/* ONE COMPUTER, ONE PILL. Three machine pills over a record kept by the
   computer a person is sitting at is a control that cannot mean anything: two
   of the three would name machines that do not exist, and pressing them would
   move a highlight and change nothing. One pill, already chosen, states the
   truth instead of miming a choice. The example record is one computer's too,
   so the pill is right on every source. */
const LIVE_MACHINES = [['all', 'This computer']]

/* Clock band axes step by 6 (00/06/12/18): d3-style continuous ticks would
   answer 0,5,10,15,20 for a 24-hour day, which are not clock stops. Fed to
   the activity option as data, so the axis language stays this view's. */
const HOUR_TICKS = [0, 6, 12, 18]

/* ---------------- tile definitions ----------------
   The six slot ids are the strip's protected DOM identities: the layout
   registry, the stylesheet and the packaged probes all know them. What each
   slot MEANS comes from ../local-metrics.js statTiles() the moment the record
   answers -- labels are deliberately not restated here, because a second copy
   of six labels is how a strip comes to disagree with the module that decides
   what may be said. Until the record answers, a slot is a quiet dash under an
   empty label, which is the honest face of "still reading". */
const TILE_MARK = 'var(--tile-mark, currentColor)'
const TILE_DEFS = [
  { id: 'agents' },
  { id: 'tasks' },
  { id: 'fail' },
  { id: 'tokens' },
  { id: 'ckpt' },
  { id: 'gates' },
]

/* The OS preference counts, not just the Settings toggle. Every JS motion
   gate on the site reads body.reduce-motion, and the only writer of that
   class is the Settings checkbox — the media query never sets it. Read the
   query directly here so this view is honest on its own; the layout engine
   and every chart entrance below take this answer. */
const motionQuery = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null
const reduced = () => document.body.classList.contains('reduce-motion') || !!motionQuery?.matches

export function metricsView() {
  const unsubs = []
  let destroyed = false
  /* The reading this page is built on. null until the record answers; every
     renderer below treats null as "still reading" rather than as "nothing
     here", because those are different sentences and part of the repair this
     page carries is that they stopped being the same one. */
  let local = null
  /* THE RAW RECORDS, KEPT rather than dropped after the first reading. The
     Range control re-derives every time-shaped series from these, so pressing
     7d genuinely re-projects what the record holds instead of sliding a
     highlight across a picture that never changes. */
  let records = null
  let liveSeries = null
  /* Where the records came from: 'local' | 'relay' | 'mock', or null before
     the first resolution lands. Null is treated as "not yet known" and never
     defaulted -- defaulting to 'mock' would badge real data and defaulting to
     anything else would unbadge the example (the rule src/data-source.js
     states over currentDataSource()). */
  let source = null
  /* A monotonic ticket for the async load: the source can change while a read
     is in flight (sign-out mid-load), and the stale read must not paint over
     the fresh one. */
  let loadSeq = 0

  const state = { range: '24h', machine: 'all' }

  /* .seg is the shared skin + indicator (styles.css / attachSeg); .pill-group
     and .pill stay in the markup as this view's click-delegation hooks. */
  const pillGroup = (name, items, label) => `
    <div class="seg pill-group" data-group="${name}" role="group" aria-label="${label}">
      ${items.map(([id, txt], i) => `<button type="button" class="pill${i === 0 ? ' on' : ''}" data-v="${id}" aria-pressed="${i === 0}">${txt}</button>`).join('')}
    </div>`

  /* One head per section. A helper rather than eleven copies, and each title
     and caption rides in as its own short string -- which also keeps the
     template's visible text in caption-sized pieces the way a reader meets
     them, instead of one unbroken column of words. The captions here are only
     the first frame's: every one is rewritten by the render pass that runs in
     the same mount tick. */
  const secHead = (title, subId, sub, extra = '') =>
    `<div class="m-head"><span class="mt">${title}</span><span class="ms" id="${subId}">${sub}</span>${extra}</div>`

  const root = el(`
    <div class="view-pad">
      <div class="metrics">
        <div class="m-filter" id="m-filter">
          <span class="mf-face" id="mf-face"></span>
          <span class="mf-label">Range</span>
          ${pillGroup('range', RANGES, 'Time range')}
          <span class="mf-sep"></span>
          <span class="mf-label">Computer</span>
          ${pillGroup('machine', LIVE_MACHINES, 'Computer')}
          <span class="spacer"></span>
          <span class="mf-note" id="mf-note"></span>
          <button type="button" class="m-edit-btn" id="m-edit" aria-pressed="false">Edit layout</button>
        </div>
        <div class="m-strip" id="tiles" data-mc="stats"></div>
        <section class="m-sec m-sankey" data-mc="sankey">
          ${secHead('Token routing', 'sankey-sub', 'sign-ins → assistants → agents')}
          <div class="echart" id="sankey-chart" role="img" aria-label="Token routing from sign-ins through assistants to agents"></div>
        </section>
        <section class="m-sec m-band" data-mc="tokenflow">
          ${secHead('Token flow', 'tokens-sub', 'tokens used',
            '<span class="spacer"></span><span class="chart-legend token-legend"><span class="ck-cap">recorded here</span></span>')}
          <div class="echart" id="hero-chart" role="img" aria-label="Tokens used on this computer, stacked by assistant"></div>
          <div class="band-cap"><span>recorded turns</span><span class="bc-note">same window</span></div>
          <div class="echart" id="strip-chart" role="img" aria-label="Recorded turns over the same time axis"></div>
        </section>
        <section class="m-sec" data-mc="heatmap">
          ${secHead('Fleet activity', 'heat-sub', 'runs by hour',
            '<span class="spacer"></span><span class="heat-key" id="heat-key"></span>')}
          <div class="echart" id="heat-chart" role="img" aria-label="Runs started on this computer, by hour"></div>
        </section>
        <section class="m-sec" data-mc="verdicts">
          ${secHead('Review verdicts', 'verdict-sub', 'what became of each run')}
          <div id="verdict-chart"></div>
        </section>
        <section class="m-sec" data-mc="lanes">
          ${secHead('Failure by lane', 'fail-sub', 'why a run did not start')}
          <div class="echart" id="fail-chart" role="img" aria-label="Why runs did not start on this computer"></div>
        </section>
        <section class="m-sec m-heartbeat" data-mc="heartbeat">
          ${secHead('Machine heartbeat', 'heartbeat-sub', '')}
          <div class="heartbeat-stage">
            <div class="echart" id="heartbeat-chart"></div>
          </div>
        </section>
        <section class="m-sec m-burn" data-mc="burn">
          ${secHead('Pool burn', 'burn-sub', 'tokens used')}
          <div class="burn-stage">
            <div class="echart" id="burn-chart" role="img" aria-label="Tokens used per bucket of the selected range"></div>
          </div>
        </section>
        <section class="m-sec m-gates" data-mc="gates">
          ${secHead('Gates &amp; checkpoints', 'gates-sub', '')}
          <div class="gate-stage">
            <div class="gate-track" role="list" aria-label="Checkpoint and gate events"></div>
            <div class="gate-axis-labels"><span></span><span></span><span></span></div>
            <div class="gate-legend" aria-hidden="true"></div>
          </div>
        </section>
        <div class="m-row m-pools" id="pools" data-mc="pools"></div>
        <section class="m-sec m-agents" data-mc="agents">
          ${secHead('Agents', 'table-sub', 'every run recorded on this computer')}
          <div style="overflow-x:auto"><table class="mtable" id="agent-table"></table></div>
        </section>
      </div>
    </div>
  `)
  const metricsSurface = root.querySelector('.metrics')
  const faceEl = root.querySelector('#mf-face')
  /* There is one render, and it is the measured one; the packaged drives that
     read this attribute get the same answer on every source. Which WORLD the
     numbers are from is the face attribute's job, stamped once the source
     axis has answered (applyLiveProjection). */
  root.dataset.liveMode = metricsSurface.dataset.liveMode = 'live'

  /* ================= layout customization =================
     The registry: each band is a movable module. `full` must span the
     column; `slot` can share a row up to 3-up. tokenflow is ONE component
     (hero + recorded-turn strip) — they share an axis, so they move as a
     unit. pools clamps to 2-up: measured at 1280, a 3-up pools column cannot
     hold its own caption without clipping. The engine only moves DOM nodes —
     every chart instance rides its element, and onArrange resizes them in
     place (element identity never changes). */
  const layout = createMetricsLayout({
    container: metricsSurface,
    filterRow: root.querySelector('#m-filter'),
    editBtn: root.querySelector('#m-edit'),
    components: [
      { id: 'stats', title: 'Stats', el: root.querySelector('[data-mc="stats"]'), size: 'full' },
      { id: 'sankey', title: 'Token routing', el: root.querySelector('[data-mc="sankey"]'), size: 'full' },
      { id: 'tokenflow', title: 'Token flow', el: root.querySelector('[data-mc="tokenflow"]'), size: 'full' },
      { id: 'heatmap', title: 'Fleet activity', el: root.querySelector('[data-mc="heatmap"]'), size: 'slot', weight: 1.25 },
      { id: 'verdicts', title: 'Review verdicts', el: root.querySelector('[data-mc="verdicts"]'), size: 'slot' },
      { id: 'lanes', title: 'Failure by lane', el: root.querySelector('[data-mc="lanes"]'), size: 'slot' },
      { id: 'pools', title: 'Account pools', el: root.querySelector('[data-mc="pools"]'), size: 'slot', maxShare: 2, slimClass: 'm-pools--slim' },
      { id: 'agents', title: 'Agents', el: root.querySelector('[data-mc="agents"]'), size: 'full' },
      { id: 'heartbeat', title: 'Machine heartbeat', el: root.querySelector('[data-mc="heartbeat"]'), size: 'slot', optional: true },
      { id: 'burn', title: 'Pool burn', el: root.querySelector('[data-mc="burn"]'), size: 'slot', optional: true },
      { id: 'gates', title: 'Gates & checkpoints', el: root.querySelector('[data-mc="gates"]'), size: 'slot', optional: true },
    ],
    standard: [['stats'], ['sankey'], ['tokenflow'], ['heatmap', 'verdicts', 'lanes'], ['pools'], ['agents']],
    reduced,
    onArrange: () => {
      /* Moving a component reparents its host; the engine is resized in
         place. And a tray-first instrument that has just been PLACED has no
         chart yet, because this face does not build one in the stash --
         repainting is what gives it one the instant it is on the page. */
      liveCharts?.resize()
      applyLiveProjection()
    },
  })
  unsubs.push(() => layout.destroy())

  /* This is intentionally shape-free. It lets the shared mount plumbing keep
     its element identities without inventing a chart or a zero while the local
     record is still being read. */
  function buildLiveData() {
    const tiles = local?.tiles || []
    return {
      live: true,
      tiles: Object.fromEntries(tiles.map(tile => [tile.id, tile.value])),
      spark: Object.fromEntries(tiles.map(tile => [tile.id, []])),
    }
  }

  let current = buildLiveData()
  let target = current
  /* KNOWN GAP, deliberately not closed in this pass: prevPeriod reuses the
     current dataset, so no tile can print a period-over-period delta -- the
     delta row carries a source sentence instead. A real comparison would be
     derived from `records` one window back (the raw turns and runs are kept
     for exactly that kind of re-projection); until someone does that work,
     nothing here may fake one. */
  let prevPeriod = current

  /* ================= tiles ================= */

  const tilesEl = root.querySelector('#tiles')
  const tileRefs = []

  function buildTiles() {
    tilesEl.innerHTML = ''
    for (const t of TILE_DEFS) {
      /* a bare figure, not a card: 11px caps label above, big tabular value,
         the source line, the sparkline glyph under — no box, no fill */
      const tile = el(`
        <div class="stat" data-tile="${t.id}">
          <div class="tl"></div>
          <div class="tv"><span class="tvn">—</span><span class="unit"></span></div>
          <div class="td flat"></div>
        </div>
      `)
      const ref = { def: t, el: tile, label: tile.querySelector('.tl'), num: tile.querySelector('.tvn'), unit: tile.querySelector('.unit'), tv: tile.querySelector('.tv'), delta: tile.querySelector('.td') }
      const svg = sparkline({ points: [1, 2, 3], color: TILE_MARK })
      const tip = svg.querySelector('circle')
      tip.setAttribute('class', 'spark-tip')
      const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      halo.setAttribute('class', 'spark-halo')
      halo.setAttribute('r', '5.5')
      halo.setAttribute('fill', TILE_MARK)
      svg.insertBefore(halo, tip)
      tile.appendChild(svg)
      ref.path = svg.querySelector('path')
      ref.tip = tip
      ref.halo = halo
      tilesEl.appendChild(tile)
      tileRefs.push(ref)
    }
  }

  /* WHAT A TILE SAYS WHEN THERE IS NOTHING IN IT, and why it is never the word
     "unavailable" on its own. The strip is six figures wide and the line
     under each one is where the old page printed the same refusal six times; a
     person reading six identical "unavailable · No local agent fleet host
     detected on this machine" lines concluded, correctly, that the page was
     broken and, incorrectly, that it was their account. The absence is now said
     ONCE, under the filter row, in a full sentence with a door -- and the tiles
     themselves fall silent rather than each repeating it. */
  function applyLiveTiles() {
    const tiles = local?.tiles || []
    for (const ref of tileRefs) {
      const tile = tiles.find(item => item.id === ref.def.id)
      /* No reading at all yet: the record is still being asked. Leave the
         protected DOM alone rather than writing a state that is about to be
         replaced with the real one a frame later. */
      if (!tile) continue
      const absent = tile.value == null
      ref.label.textContent = tile.label
      ref.el.classList.toggle('projection-unavailable', absent)
      ref.num.textContent = absent ? '—' : Math.round(tile.value).toLocaleString('en-US')
      ref.unit.textContent = absent ? '' : tile.unit
      /* The line under the figure names where the figure came from -- and on
         the example it must NOT claim this computer's record, because these
         are the product's own made-up numbers wearing the real parsers. The
         badge follows the source, here as everywhere on the page. */
      ref.delta.textContent = absent ? '' : (sourceIsBadged(source)
        ? 'made-up example numbers'
        : 'counted from this computer’s own record')
      ref.delta.className = `td flat${absent ? ' projection-unavailable' : ''}`
      /* A sparkline asserts a sequence, and the ledger is a list of instants
         rather than a series per tile. Preserve this protected stat-strip DOM
         while clearing its path; the activity grid below is where the shape of
         the week is drawn, from the same runs. */
      ref.path?.setAttribute('d', '')
      ref.tip?.setAttribute('opacity', '0')
      ref.halo?.setAttribute('opacity', '0')
    }
  }

  /* ================= panel plumbing ================= */

  const componentPlaced = (id) => !root.querySelector(`.m-stash > [data-mc="${id}"]`)

  let liveCharts = null
  let theme = null

  /* Where each measured chart lives. Resolved on every draw rather than
     captured once: the outcome bar's host is rebuilt with the counts around
     it. */
  const LIVE_HOSTS = {
    hero: '#hero-chart',
    strip: '#strip-chart',
    sankey: '#sankey-chart',
    fail: '#fail-chart',
    heat: '#heat-chart',
    verdict: '#verdict-live-chart',
    burn: '#burn-chart',
  }
  const liveHost = (key) => root.querySelector(LIVE_HOSTS[key]) || null

  /* WHAT A PANEL WITH NOTHING IN IT LOOKS LIKE. The panel keeps a HEADING
   * that says what it is about, and the body carries a sentence a person can
   * act on, or stop looking for a switch over. And the two reasons a panel can
   * be empty are told apart: `renderUnmeasured` is for a subject this copy
   * does not record at all (there is no remedy, and saying so IS the help),
   * `renderAbsent` is for a subject it does record and has nothing for yet
   * (which is either a first day or a real fault, and the sentence says
   * which).
   *
   * `projection-unavailable` stays on the element because the packaged probes
   * read that selector; dropping a class a probe watches does not fail the
   * probe, it makes the probe quietly record nothing. */
  function setPanelBody(componentId, subId, sub, sentence, hosts, kind) {
    const component = root.querySelector(`[data-mc="${componentId}"]`)
    component?.classList.add('projection-unavailable')
    component?.setAttribute('data-panel-state', kind)
    const subEl = root.querySelector(subId)
    if (subEl) subEl.textContent = sub
    for (const hostId of hosts) {
      const host = root.querySelector(hostId)
      if (!host) continue
      host.classList.add('projection-unavailable')
      host.setAttribute('aria-label', sentence)
      const note = document.createElement('p')
      note.className = 'm-panel-note'
      note.textContent = sentence
      host.replaceChildren(note)
    }
  }

  /* A subject this copy does not measure. No remedy is offered because none
     exists -- the rule src/first-run-needs.js sets out for exactly this case. */
  const renderUnmeasured = (componentId, subId, sub, sentence, hosts = []) =>
    setPanelBody(componentId, subId, sub, sentence, hosts, 'not-measured')

  /* A subject this copy does measure, with nothing in it yet or nothing
     readable. The sentence comes from ../local-metrics.js and distinguishes
     those two, which this page once could not. */
  const renderAbsent = (componentId, subId, sub, sentence, hosts = []) =>
    setPanelBody(componentId, subId, sub, sentence, hosts, 'nothing-yet')

  function panelReady(componentId, subId, sub) {
    const component = root.querySelector(`[data-mc="${componentId}"]`)
    component?.classList.remove('projection-unavailable')
    component?.setAttribute('data-panel-state', 'reading')
    const subEl = root.querySelector(subId)
    if (subEl) subEl.textContent = sub
  }

  function readyHost(hostId, label) {
    const host = root.querySelector(hostId)
    if (!host) return null
    host.classList.remove('projection-unavailable')
    host.setAttribute('aria-label', label)
    return host
  }

  /* ---------- the measured charts' hosts ----------
     A host that is about to carry a chart must not still be carrying the
     sentence that stood there when the panel had nothing -- and a host that
     ALREADY carries a chart must not be emptied, because that would throw away
     the engine's own DOM under it. One helper, so neither mistake is available
     at the call sites below. */
  function chartHost(key, hostId, label) {
    const host = readyHost(hostId, label)
    if (!host) return null
    if (!liveCharts?.drawn(key)) host.replaceChildren()
    return host
  }

  /* The other direction: give the host back before a sentence is written into
     it. Without this the note would be appended over a live chart, and the
     engine would keep running behind a paragraph nobody can see. */
  function releaseChart(...keys) {
    for (const key of keys) liveCharts?.release(key)
  }

  /* A sentence that belongs to a panel but not inside its chart host -- the
     money statement under pool burn, the derived-total note under routing. Kept
     as ONE node per panel so repeated renders cannot stack copies of it. */
  function panelAside(componentId, text) {
    const component = root.querySelector(`[data-mc="${componentId}"]`)
    if (!component) return
    let note = component.querySelector(':scope > .m-panel-aside')
    if (!text) { note?.remove(); return }
    if (!note) {
      note = document.createElement('p')
      note.className = 'm-panel-note m-panel-aside'
      component.appendChild(note)
    }
    note.textContent = text
  }

  /* WHAT A WINDOW WITH NOTHING IN IT SAYS, and it is deliberately not the
     record-level absence. "Nothing has been started on this computer yet" over a
     stat strip showing nineteen runs is the contradiction ../local-metrics.js
     writes emptyWindow to prevent; these two say the same thing for a window the
     Range control chose. */
  const rangeWord = () => (liveSeries?.window || liveWindow(state.range)).word
  const runsWindowAbsence = () => {
    const reading = local?.source
    if (!reading?.ok) return reading?.absence || LOCAL_METRICS_COPY.unreadable
    return `Nothing ran on this computer in the ${rangeWord()}. The counts above cover everything ever run here.`
  }
  const usageWindowAbsence = () => {
    const totals = local?.usage?.totals
    if (!totals?.ok) return totals?.absence || LOCAL_USAGE_COPY.unreadable
    return `No turn reported a token count in the ${rangeWord()}. Pick a longer range, or ask an agent something.`
  }

  /* ---------- runs by hour, over the window the Range control chose ----------
     The option comes from ../metrics-live-charts.js, which cannot import a
     simulation, and the engine here refuses any option that file did not
     mint. The cells are counts of runs the record holds, shaded against the
     busiest REAL hour -- a quiet week still draws as a quiet week. */
  function renderActivity() {
    const reading = liveSeries?.activity
    if (!reading || !reading.ok) {
      releaseChart('heat')
      renderAbsent('heatmap', '#heat-sub', `runs by hour · ${rangeWord()}`,
        local ? runsWindowAbsence() : LOCAL_METRICS_COPY.unreadable, ['#heat-chart'])
      root.querySelector('#heat-key')?.replaceChildren()
      return
    }
    panelReady('heatmap', '#heat-sub',
      `runs by hour · ${rangeWord()} · ${reading.total} ${reading.total === 1 ? 'run' : 'runs'}`)
    const host = chartHost('heat', '#heat-chart',
      `Runs started on this computer by hour over the ${rangeWord()}. ${reading.total} in total.`)
    if (!host || !theme) return
    liveCharts.draw('heat', activityOption({
      activity: reading, theme, hourTicks: HOUR_TICKS,
      dur: 420, entrance: !liveCharts.drawn('heat'), reduced: reduced(),
    }))
    const key = root.querySelector('#heat-key')
    if (key) {
      /* The ramp the cells are actually painted with, from the same theme
         snapshot the chart was given, and the busiest real cell beside it. */
      key.innerHTML = `<em>none</em>${theme.heat.map(colour => `<i style="background:${colour}"></i>`).join('')}<em>busiest</em>`
      const caption = document.createElement('span')
      caption.className = 'ck-cap'
      caption.textContent = reading.max === 1 ? 'one run per cell at most' : `up to ${reading.max} runs in an hour`
      key.appendChild(caption)
    }
  }

  /* ---------- what became of them ----------
     The only three outcomes this record keeps, and the third -- an outcome
     that was never written down -- is a segment of its own rather than folded
     into either of the others. Silence read as success is the exact defect
     readLocalSessions exists to prevent, and the bar below would put that
     defect back in a different shape if it hid the third segment.

     The split is a chart and the counts stay in the DOM beside it. Both, not
     one traded for the other: the bar is the shape, the legend is what a
     person quotes, and the legend numbers come from the same reading the
     bar's segments are built from. */
  function renderOutcomes() {
    const reading = local?.outcomes
    if (!reading || !reading.ok) {
      releaseChart('verdict')
      renderAbsent('verdicts', '#verdict-sub', 'what became of each run',
        reading?.absence || LOCAL_METRICS_COPY.unreadable, ['#verdict-chart'])
      return
    }
    panelReady('verdicts', '#verdict-sub', 'what became of every run recorded here')
    const host = readyHost('#verdict-chart', reading.sentence || 'What became of each run recorded on this computer.')
    if (!host) return
    const panel = document.createElement('div')
    panel.className = 'm-outcomes'

    const total = document.createElement('div')
    total.className = 'm-outcome-total'
    const totalNum = document.createElement('b')
    totalNum.textContent = reading.total.toLocaleString('en-US')
    const totalWord = document.createElement('span')
    totalWord.textContent = reading.total === 1 ? 'run recorded here' : 'runs recorded here'
    total.append(totalNum, totalWord)
    panel.appendChild(total)

    /* The bar itself: an engine host, empty in the DOM, filled by the measured
       option below. It keeps the .m-outcome-bar identity the stylesheet and the
       packaged probes already know. */
    const bar = document.createElement('div')
    bar.className = 'm-outcome-bar echart'
    bar.id = 'verdict-live-chart'
    panel.appendChild(bar)

    const legend = document.createElement('ul')
    legend.className = 'm-outcome-legend'
    for (const segment of reading.segments) {
      const row = document.createElement('li')
      const swatch = document.createElement('i')
      swatch.dataset.key = segment.key
      const name = document.createElement('span')
      name.textContent = segment.label
      const value = document.createElement('b')
      value.textContent = segment.count.toLocaleString('en-US')
      row.append(swatch, name, value)
      legend.appendChild(row)
    }
    panel.appendChild(legend)

    if (reading.sentence) {
      const note = document.createElement('p')
      note.className = 'm-outcome-note'
      note.textContent = reading.sentence
      panel.appendChild(note)
    }
    host.replaceChildren(panel)
    if (!theme) return
    const option = outcomeOption({ outcomes: reading, theme, dur: 420, entrance: true, reduced: reduced() })
    /* Nothing recorded means nothing to split, and a full-width bar of one
       colour over a total of zero would be a shape asserting a measurement. The
       counts above stay; the bar simply is not drawn. */
    if (option) liveCharts.draw('verdict', option)
    else releaseChart('verdict')
  }

  /* ---------- why the ones that did not start, did not start ----------
     The reason is the SENTENCE this product already gives for that code on the
     screen a person would go to about it, never the bare identifier the shell
     recorded. A page that printed an upper-case code at somebody would be the
     thing src/refusal-copy.js and tools/check-plain-language.mjs exist to stop.
     The bars are counts, not rates: over four refusals a percentage prints a
     decisive-looking 21% that is one event. */
  function renderRefusals() {
    const reading = local?.refusals
    if (!reading || !reading.ok) {
      releaseChart('fail')
      renderAbsent('lanes', '#fail-sub', 'why a run did not start',
        reading?.absence || LOCAL_METRICS_COPY.unreadable, ['#fail-chart'])
      return
    }
    panelReady('lanes', '#fail-sub', 'why a run did not start')
    /* Nothing was refused. That is a RESULT, not an absence, and it gets a
       sentence of its own rather than the empty-record one -- and never a chart,
       because an empty pair of axes is a shape a person reads as a measurement
       that came out at nothing. */
    if (reading.rows.length === 0) {
      releaseChart('fail')
      const host = readyHost('#fail-chart', reading.sentence)
      if (!host) return
      const note = document.createElement('p')
      note.className = 'm-panel-note is-good'
      note.textContent = reading.sentence
      host.replaceChildren(note)
      return
    }
    const host = chartHost('fail', '#fail-chart', reading.sentence || 'Why runs did not start on this computer.')
    if (!host || !theme) return
    liveCharts.draw('fail', refusalOption({
      refusals: reading, theme, dur: 420, entrance: !liveCharts.drawn('fail'), reduced: reduced(),
    }))
  }

  /* ---------- the runs themselves ----------
     What has actually run here, newest first, with the reason beside anything
     that did not start -- the same three facts the home screen gives for a
     run, in a table a person can read down. */
  const RUN_COLS = ['Run', 'When', 'What happened', 'Why']
  function renderRunTable() {
    const reading = local?.runs
    if (!reading || !reading.ok) {
      renderAbsent('agents', '#table-sub', 'every run recorded on this computer',
        reading?.absence || LOCAL_METRICS_COPY.unreadable, ['#agent-table'])
      return
    }
    panelReady('agents', '#table-sub',
      reading.total === 1 ? 'the one run recorded on this computer' : `${reading.total} runs recorded on this computer`)
    const host = readyHost('#agent-table', 'Every agent run recorded on this computer, newest first.')
    if (!host) return
    const head = document.createElement('thead')
    const headRow = document.createElement('tr')
    for (const column of RUN_COLS) {
      const cell = document.createElement('th')
      cell.textContent = column
      headRow.appendChild(cell)
    }
    head.appendChild(headRow)
    const body = document.createElement('tbody')
    for (const run of reading.rows) {
      const row = document.createElement('tr')
      const sequence = document.createElement('td')
      sequence.className = 'm-run-seq'
      sequence.textContent = String(run.sequence)
      const when = document.createElement('td')
      when.textContent = run.when
      if (run.at) when.title = run.at
      const outcome = document.createElement('td')
      /* An empty string for a run whose outcome was never recorded, and the cell
         is simply blank. A word there would be this page inventing the one fact
         the record does not hold. */
      outcome.textContent = run.resultWord
      if (run.result) outcome.dataset.result = run.result
      const why = document.createElement('td')
      why.className = 'm-run-why'
      why.textContent = run.why
      row.append(sequence, when, outcome, why)
      body.appendChild(row)
    }
    host.replaceChildren(head, body)
  }

  /* ================= WHAT THE TURNS USED =================
   *
   * Four panels on this page -- token routing, token flow, account pools and
   * pool burn -- once printed one sentence each saying a token count never
   * passes through this product. That was true of the RECORD and false of the
   * PRODUCT: both engines report usage on every turn and nothing wrote it
   * down. shell/usage-record.cjs does, so these panels draw it.
   *
   * MONEY IS STILL NOT MEASURED. This product holds no prices and no balances,
   * so none of these counts is a cost, and UNMEASURED.pools keeps saying so
   * beside the figures rather than being quietly retired now that the panels
   * have numbers in them. A token count wearing a currency symbol would be the
   * same class of claim the counts were introduced to replace.
   */
  const tokenWord = (value) => `${Number(value || 0).toLocaleString('en-US')}`

  /* One labelled bar row, shaded against the largest row rather than an invented
     ceiling -- the same rule renderActivity() follows for a quiet week. */
  function tokenRows(host, rows, { max, unit = 'tokens' } = {}) {
    const list = document.createElement('ul')
    list.className = 'm-token-rows'
    const ceiling = max || rows.reduce((high, row) => Math.max(high, row.tokens || 0), 0)
    for (const row of rows) {
      const item = document.createElement('li')
      const name = document.createElement('span')
      name.className = 'm-token-name'
      name.textContent = row.label
      const bar = document.createElement('i')
      bar.className = 'm-token-bar'
      bar.style.setProperty('--w', `${ceiling > 0 ? ((row.tokens || 0) / ceiling) * 100 : 0}%`)
      const value = document.createElement('b')
      value.className = 'm-token-value'
      value.textContent = tokenWord(row.tokens)
      const note = document.createElement('span')
      note.className = 'm-token-note'
      note.textContent = row.note || ''
      item.append(name, bar, value, note)
      item.title = `${row.label}: ${tokenWord(row.tokens)} ${unit}`
      list.appendChild(item)
    }
    host.replaceChildren(list)
  }

  /* Token routing: which sign-in, through which assistant, to which agent. The
     three columns the panel has always promised, drawn as the Sankey this page
     was built around -- from tuples the record actually holds. */
  function renderTokenRouting() {
    /* Before the record answers. A wait, not a fault -- see LOCAL_USAGE_COPY. */
    if (!local) {
      releaseChart('sankey')
      setSankeyStatePanel('reading the record', LOCAL_USAGE_COPY.waiting, 'sign-ins → assistants → agents')
      return
    }
    const totals = local?.usage?.totals
    if (!totals || !totals.ok) {
      releaseChart('sankey')
      setSankeyStatePanel('nothing recorded yet', totals?.absence || LOCAL_USAGE_COPY.unreadable,
        'sign-ins → assistants → agents')
      return
    }
    const flows = liveSeries?.flows
    if (!flows || !flows.ok) {
      /* The record has turns and this WINDOW has none. A different sentence from
         "nothing recorded yet", because a person who is told the wrong one goes
         looking for a fault instead of pressing 7d. */
      releaseChart('sankey')
      setSankeyStatePanel('nothing in this range', usageWindowAbsence(),
        `sign-ins → assistants → agents · ${rangeWord()}`)
      return
    }
    const component = root.querySelector('[data-mc="sankey"]')
    component?.classList.remove('projection-unavailable')
    component?.setAttribute('data-panel-state', 'reading')
    const label = `Token routing measured on this computer over the ${rangeWord()}: ${tokenWord(flows.total)} tokens across ${flows.sessions} recorded ${flows.sessions === 1 ? 'session' : 'sessions'}.`
    const host = chartHost('sankey', '#sankey-chart', label)
    if (!host || !theme) return
    host.classList.remove('m-sankey-empty-host')
    /* A person with one sign-in and one assistant has a two-hop flow, and a
       two-hop flow stretched over a fixed tall panel is a slab of colour
       rather than a diagram. The panel asks for the height its own reading
       needs. */
    host.style.height = `${flows.height}px`
    host.setAttribute('role', 'img')
    host.removeAttribute('aria-live')
    const sub = root.querySelector('#sankey-sub')
    if (sub) sub.textContent = `sign-ins → assistants → agents · ${rangeWord()} · ${tokenWord(flows.total)} tokens`
    liveCharts.draw('sankey', routingOption({
      flows, theme, dur: 420, entrance: !liveCharts.drawn('sankey'), reduced: reduced(),
    }))
    /* How many of the figures behind this diagram were added up from their own
       parts rather than reported whole. Beside the picture, never inside it. */
    panelAside('sankey', totals.derivedSentence || '')
  }

  /* Token flow: what each assistant used, bucket by bucket, over the window the
     Range control chose -- the solid stacked bands this page is known for, with
     the recorded-turn strip beneath them on the same axis. Only assistants the
     record actually holds get a band: a flat zero band for an account a person
     has never signed into would be a claim about an account. */
  function renderTokenFlow() {
    if (!local) {
      releaseChart('hero', 'strip')
      renderAbsent('tokenflow', '#tokens-sub', 'tokens used',
        LOCAL_USAGE_COPY.waiting, ['#hero-chart', '#strip-chart'])
      return
    }
    const bands = liveSeries?.bands
    const counts = liveSeries?.counts
    if (!bands?.ok) {
      releaseChart('hero', 'strip')
      renderAbsent('tokenflow', '#tokens-sub', `tokens used · ${rangeWord()}`,
        usageWindowAbsence(), ['#hero-chart', '#strip-chart'])
      return
    }
    panelReady('tokenflow', '#tokens-sub',
      `tokens used · ${rangeWord()} · ${tokenWord(bands.total)} tokens recorded here`)
    if (!theme) return
    const label = `Tokens used on this computer over the ${rangeWord()}: ${tokenWord(bands.total)} in total.`
    const heroHost = chartHost('hero', '#hero-chart', label)
    if (heroHost) {
      liveCharts.draw('hero', tokenBandOption({
        bands, window: liveSeries.window, theme,
        dur: 420, entrance: !liveCharts.drawn('hero'), reduced: reduced(),
      }))
    }
    const stripHost = chartHost('strip', '#strip-chart',
      `Recorded turns on this computer over the ${rangeWord()}: ${counts?.total || 0} in total.`)
    if (stripHost) {
      /* The strip is a companion reading, and a companion with nothing in it is
         not drawn -- the caption above it says what it would have shown. */
      const option = turnStripOption({
        counts, window: liveSeries.window, theme,
        dur: 420, entrance: !liveCharts.drawn('strip'), reduced: reduced(),
      })
      if (option) liveCharts.draw('strip', option)
      else releaseChart('strip')
    }
    const caption = root.querySelector('.m-band .band-cap')
    if (caption) {
      caption.replaceChildren()
      const what = document.createElement('span')
      what.textContent = 'recorded turns'
      const how = document.createElement('span')
      how.className = 'bc-note'
      how.textContent = `same window · ${counts?.total || 0} ${counts?.total === 1 ? 'turn' : 'turns'}`
      caption.append(what, how)
    }
    /* The window totals chip row above the chart names the assistants that
       answered here -- rebuilt from the measured bands, so a chip cannot
       advertise an assistant with no band under it. */
    syncMeasuredTokenLegend(bands)
  }

  function syncMeasuredTokenLegend(bands) {
    const legend = root.querySelector('.token-legend')
    if (!legend) return
    legend.replaceChildren()
    const caption = document.createElement('span')
    caption.className = 'ck-cap'
    caption.textContent = 'recorded here'
    legend.appendChild(caption)
    for (const band of bands.bands) {
      const chip = document.createElement('span')
      chip.className = 'ck'
      chip.dataset.tokenProvider = band.key
      chip.style.setProperty('--kc', provInk(band.key))
      const mark = document.createElement('i')
      const name = document.createElement('span')
      name.className = 'ck-name'
      name.textContent = band.label
      const value = document.createElement('span')
      value.className = 'ck-value'
      value.textContent = tokenWord(band.tokens)
      chip.append(mark, name, value)
      chip.setAttribute('aria-label', `${band.label}, ${tokenWord(band.tokens)} tokens recorded in this range`)
      legend.appendChild(chip)
    }
  }

  /* Account pools: what each of the person's own sign-ins used. The panel keeps
     its money sentence, because the product still holds no balances -- what
     changed is that it is no longer the ONLY thing the panel can say. */
  function renderPools() {
    const reading = local?.usage?.byAccount
    const host = root.querySelector('#pools')
    if (!host) return
    if (!local) {
      renderAbsent('pools', null, null, LOCAL_USAGE_COPY.waiting, ['#pools'])
      return
    }
    if (!reading || !reading.ok) {
      renderUnmeasured('pools', null, null, `${reading?.absence || LOCAL_USAGE_COPY.unreadable} ${UNMEASURED.pools}`, ['#pools'])
      return
    }
    const component = root.querySelector('[data-mc="pools"]')
    component?.classList.remove('projection-unavailable')
    component?.setAttribute('data-panel-state', 'reading')
    host.classList.remove('projection-unavailable')
    host.setAttribute('aria-label', `Tokens used per sign-in on this computer: ${tokenWord(reading.total)} in total.`)
    const panel = document.createElement('div')
    panel.className = 'm-pool-usage'
    const heading = document.createElement('h4')
    heading.textContent = 'Tokens by sign-in'
    panel.appendChild(heading)
    const body = document.createElement('div')
    tokenRows(body, reading.rows.map(row => ({
      label: row.label, tokens: row.tokens, note: `${row.runs} ${row.runs === 1 ? 'run' : 'runs'}`,
    })))
    panel.appendChild(body)
    /* THE MONEY SENTENCE STAYS, under real figures. */
    const note = document.createElement('p')
    note.className = 'm-panel-note'
    note.textContent = UNMEASURED.pools
    panel.appendChild(note)
    host.replaceChildren(panel)
  }

  /* Pool burn: the RATE, in tokens, and said in tokens. The panel once drew a
     spending rate against balances this product does not hold, and the sentence
     under it still says so -- what is drawn is the one rate the record can
     answer, which is how many tokens were used per bucket of the chosen range. */
  function renderBurn() {
    /* PAINT-COLD WHILE IT IS IN THE TRAY. Pool burn is a tray-first
       instrument: the standard layout leaves it in the off-screen stash, and
       building a full chart instance there is hidden SVG work and a live rAF
       for a panel nobody can see. Placing it runs onArrange, which repaints
       this page, so it draws the instant it is put on the page. */
    if (!componentPlaced('burn')) { releaseChart('burn'); return }
    if (!local) {
      releaseChart('burn')
      panelAside('burn', '')
      renderAbsent('burn', '#burn-sub', 'tokens used', LOCAL_USAGE_COPY.waiting, ['#burn-chart'])
      return
    }
    const bands = liveSeries?.bands
    if (!bands?.ok) {
      releaseChart('burn')
      panelAside('burn', '')
      renderAbsent('burn', '#burn-sub', `tokens used · ${rangeWord()}`,
        usageWindowAbsence(), ['#burn-chart'])
      return
    }
    const unit = liveSeries.window.unit === 'hour' ? 'hour' : 'day'
    const used = bands.stacked.filter(value => value > 0).length
    const perBucket = used > 0 ? Math.round(bands.total / used) : 0
    panelReady('burn', '#burn-sub',
      `tokens per ${unit} · ${tokenWord(perBucket)} on the ${used === 1 ? `one ${unit}` : `${used} ${unit}s`} you used it`)
    const host = chartHost('burn', '#burn-chart',
      `On this computer, ${tokenWord(perBucket)} tokens in an average ${unit} it was used.`)
    if (!host || !theme) return
    liveCharts.draw('burn', burnOption({
      bands, window: liveSeries.window, theme,
      dur: 420, entrance: !liveCharts.drawn('burn'), reduced: reduced(),
    }))
    /* NOT A COST, and never rendered as one. Beside the rate rather than instead
       of it, which is the whole change: the panel has a real figure now and the
       sentence that says the figure is not money stays exactly as it was. */
    panelAside('burn', UNMEASURED.pools)
  }

  function setSankeyUnavailable() {
    const component = root.querySelector('[data-mc="sankey"]')
    const host = root.querySelector('#sankey-chart')
    /* Hand the panel's own height back: renderTokenRouting sizes it to the
       reading, and a sentence must not inherit the last diagram's box. */
    if (host) host.style.removeProperty('height')
    component?.classList.add('projection-unavailable')
    if (!host) return

    /* THE DEFAULT WHEN NOBODY GIVES THIS PANEL A SENTENCE: the usage record's
       own absence, which distinguishes a browser, a shell too old to keep the
       record, a record that will not open, and a record with nothing in it
       yet. The panel carries the sentence and nothing else -- the button that
       used to offer a separate demonstration page is gone with that page, and
       the example toggle is where the example lives now. */
    const sentence = LOCAL_USAGE_COPY.empty
    const sub = root.querySelector('#sankey-sub')
    if (sub) sub.textContent = 'sign-ins → assistants → agents'

    const panel = el(`
      <div class="m-sankey-empty" data-sankey-empty="true">
        <div class="m-sankey-empty-copy">
          <span class="m-sankey-empty-mark" aria-hidden="true">—</span>
          <span class="m-sankey-empty-label">not counted here</span>
          <p></p>
        </div>
      </div>`)
    panel.querySelector('p').textContent = sentence

    host.classList.add('projection-unavailable', 'm-sankey-empty-host')
    host.setAttribute('role', 'group')
    host.setAttribute('aria-live', 'polite')
    host.setAttribute('aria-label', sentence)
    host.replaceChildren(panel)
  }

  function setSankeyStatePanel(label, sentence, sub) {
    setSankeyUnavailable()
    const panel = root.querySelector('[data-sankey-empty="true"]')
    if (panel) {
      panel.querySelector('.m-sankey-empty-label').textContent = label
      panel.querySelector('p').textContent = sentence
    }
    const subNode = root.querySelector('#sankey-sub')
    if (subNode) subNode.textContent = sub
    const host = root.querySelector('#sankey-chart')
    if (host) host.setAttribute('aria-label', sentence)
  }

  /* EVERY TIME-SHAPED SERIES ON THE PAGE, RE-DERIVED FROM THE RECORDS.
   *
   * This is what the Range control does. Called from applyLiveProjection
   * rather than from the click handler, so what is drawn can never be a
   * window other than the one state.range names. */
  function projectLiveSeries() {
    if (!records) { liveSeries = null; return }
    const window = liveWindow(state.range)
    const runs = records.sessions?.runs || []
    const turns = records.usage?.turns || []
    liveSeries = {
      window,
      bands: tokenBands(turns, window),
      counts: turnCounts(turns, window),
      activity: activityMatrix(runs, window),
      flows: routingFlows(turnsInWindow(turns, window), { conversations: records.conversations }),
    }
  }

  function applyLiveProjection() {
    projectLiveSeries()
    /* The page's own state is about the RECORD. The packaged probes read this
       attribute, so its two values keep meaning what they meant: there is a
       reading, or there is not. */
    const reading = local?.source
    root.dataset.projectionState = reading?.ok ? 'aggregate' : 'unavailable'
    metricsSurface.dataset.projectionState = root.dataset.projectionState
    /* WHICH WORLD THE NUMBERS ARE FROM, stamped from the source axis alone --
       never inferred from the data, which by construction looks identical
       either way. Stamped only once the axis has ANSWERED: before the first
       resolution the face stays blank, because defaulting it one way would
       badge real data and the other way would unbadge the example. */
    const badged = source === null ? null : sourceIsBadged(source)
    if (badged !== null) {
      root.dataset.face = metricsSurface.dataset.face = badged ? 'demonstration' : 'this-computer'
      faceEl.textContent = badged ? 'Demonstration' : 'This computer'
    }
    /* THE ONE PLACE THE SOURCE (or its absence) IS SAID IN FULL. Built with
       DOM calls rather than innerHTML: none of these sentences are untrusted,
       but the door beside them is an element and a textContent assignment
       cannot carry markup into the page either way. */
    const note = root.querySelector('#mf-note')
    note.classList.remove('is-unverified')
    if (!local) {
      /* Before the record answers. Not an absence -- a wait. */
      note.textContent = 'reading this computer’s record of what has run here'
    } else if (badged) {
      /* THE EXAMPLE'S OWN SENTENCE, and the words stay beside the dot: the
         dot is an indicator, and an indicator alone is a decoration where a
         disclosure is owed. Everything below it went through the real parsers,
         which is exactly why this line is not optional -- the readings LOOK
         measured, and only the source says they are not. */
      note.textContent = `${rangeWord()} · `
      const dot = document.createElement('i')
      dot.className = 'sim-dot'
      dot.setAttribute('aria-hidden', 'true')
      const words = document.createElement('b')
      words.textContent = 'made-up numbers'
      note.append(dot, words, document.createTextNode(', so the page can be shown with nothing on it'))
    } else if (reading?.ok) {
      /* The window is named first, because the instruments below follow the
         Range control and a person reading a chart is owed the window it covers
         before the sentence about where the numbers came from. */
      note.textContent = `${rangeWord()} · ${reading.sentence}`
      if (reading.note) {
        const extra = document.createElement('span')
        extra.className = 'mf-extra'
        extra.textContent = reading.note
        note.appendChild(extra)
      }
      /* A record that no longer verifies is still shown, beside the fact that it
         no longer verifies -- the same decision shell/spawn-record.cjs makes
         about its own return value, and for the same reason: the runs happened. */
      note.classList.toggle('is-unverified', reading.verified === false)
    } else {
      note.textContent = `${reading?.absence || LOCAL_METRICS_COPY.unreadable} `
      const door = document.createElement('a')
      door.className = 'host-absent-action'
      door.href = GUIDE_ACTION.href
      door.textContent = GUIDE_ACTION.label
      note.appendChild(door)
    }
    applyLiveTiles()

    /* The four panels the run record answers. */
    renderActivity()
    renderOutcomes()
    renderRefusals()
    renderRunTable()

    /* The four token panels, from the record of what each turn used. */
    renderTokenRouting()
    renderTokenFlow()
    renderPools()
    renderBurn()

    /* And the two that genuinely remain unmeasured, each said once from the
       shared table so two hand-written versions cannot drift apart. There is one
       computer here and nothing on it holds a run back for a decision; no record
       exists for either, and no setting turns one on. */
    renderUnmeasured('heartbeat', '#heartbeat-sub', 'one computer',
      UNMEASURED.heartbeat, ['#heartbeat-chart'])
    renderUnmeasured('gates', '#gates-sub', 'nothing is held here', UNMEASURED.gates)
  }

  /* THE READ THIS PAGE IS BUILT ON, and the source axis is resolved in the
     same breath -- the answer decides which agent the parsers are handed, and
     NOTHING else changes: 'mock' is the product's own example ledgers going
     through readLocalRuns/readLocalUsage exactly as a bridge reply would, so
     the render downstream cannot tell, and the badge above is what tells. */
  async function loadLocalMetrics({ reask = false } = {}) {
    const seq = ++loadSeq
    const resolved = await resolveDataSource({ reask })
    if (destroyed || seq !== loadSeq) return
    let sessions, usage, conversations
    if (sourceIsBadged(resolved)) {
      /* One clock for both example replies and the join, so the two halves of
         the example cannot disagree about when anything happened. The
         conversations join is built from the example reply's OWN start
         entries -- reading the real saved roles here would put a person's
         actual agent names on a badged page, which is the exact mixing the
         badge rule forbids. */
      const nowMs = Date.now()
      const sessionsRaw = sampleSessionsRaw(nowMs)
      const usageRaw = sampleUsageRaw(nowMs)
      const sample = { history: async () => sessionsRaw, usage: async () => usageRaw }
      ;[sessions, usage] = await Promise.all([
        readLocalRuns({ agent: sample }),
        readLocalUsage({ agent: sample }),
      ])
      conversations = new Map(sessionsRaw.entries
        .filter(entry => entry.action === 'agent_session_start')
        .map(entry => [entry.sessionId, { role: entry.agent, asked: entry.asked }]))
    } else {
      /* BOTH RECORDS, ASKED FOR TOGETHER. They are two chains in two files and
         either can be empty without the other being -- a computer that has
         started agents on a shell older than the usage channel has runs and no
         turn figures, and the page must be able to say exactly that rather
         than treating one absence as the other's. */
      ;[sessions, usage] = await Promise.all([readLocalRuns(), readLocalUsage()])
      /* The role a person gave each node, joined on the session id both sides
         hold. Read once per load rather than per row; a page that cannot reach
         storage gets null, which every reading below renders as "not named on
         this computer" instead of as a name. */
      conversations = readSessionRoles()
    }
    if (destroyed || seq !== loadSeq) return
    /* The verdict is committed WITH the data it describes, never ahead of it:
       a repaint landing mid-load (a theme flip, a rearrange) must find the old
       badge over the old records or the new badge over the new ones -- an
       example record wearing the measured sentence, even for a frame, is the
       exact mix the badge rule exists to prevent. */
    source = resolved
    /* KEPT, not consumed. describeLocalMetrics answers the whole-record
       readings the stat strip and the run list are about; the time-shaped
       charts re-derive from these raw records every time the Range changes. */
    records = { sessions, usage, conversations }
    local = describeLocalMetrics(sessions, { conversations, usage })
    current = target = buildLiveData()
    prevPeriod = current
    applyLiveProjection()
  }

  /* ================= filter row wiring ================= */

  const filterEl = root.querySelector('#m-filter')

  /* the shared helper owns indicator geometry — its MutationObserver follows
     the .on toggles below, and its ResizeObserver keeps the slide honest */
  filterEl.querySelectorAll('.seg').forEach(g => unsubs.push(attachSeg(g)))

  filterEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.pill')
    if (!btn) return
    const group = btn.closest('.pill-group')
    const key = group.dataset.group
    const v = btn.dataset.v
    if (state[key] === v) return
    state[key] = v
    group.querySelectorAll('.pill').forEach(p => {
      const on = p === btn
      p.classList.toggle('on', on)
      p.setAttribute('aria-pressed', String(on))
    })
    /* The whole page re-projects from the kept raw records: pressing 7d
       genuinely redraws the window, whichever source the records came from. */
    applyLiveProjection()
  })

  /* ================= boot ================= */

  /* TWO-STAGE MOUNT. Stage 1 paints the page as sentences -- every panel has
     an honest waiting or absent state before any record has answered -- and
     starts the read. Stage 2 builds the chart engine one post-paint frame
     later, which is also the earliest the theme snapshot is safe: buildTheme
     reads .metrics-scoped custom properties, and those only resolve once the
     view is in the document. */
  buildTiles()
  applyLiveProjection()
  loadLocalMetrics()

  let bootRaf = requestAnimationFrame(() => {
    bootRaf = 0
    theme = buildTheme(metricsSurface)
    liveCharts = createLiveCharts({ resolve: liveHost })
    /* One observer for every measured host that exists. Hosts are CSS-sized,
       so the engine only ever fills them. */
    const liveRo = new ResizeObserver(() => liveCharts?.resize())
    for (const selector of Object.values(LIVE_HOSTS)) {
      const host = root.querySelector(selector)
      if (host) liveRo.observe(host)
    }
    unsubs.push(() => liveRo.disconnect())
    /* The panels were already painted as sentences on the first frame; this is
       the pass that turns the ones with a reading into charts. */
    applyLiveProjection()
  })

  /* Theme switch: main.js writes documentElement.dataset.theme; rebuild the
     token snapshot from the NEW computed values and re-issue the whole face --
     the charts hold literal colours from the old snapshot, so repainting one
     panel would leave every other chart wearing the previous theme's inks. */
  if (typeof MutationObserver !== 'undefined') {
    const themeMO = new MutationObserver(() => {
      theme = buildTheme(metricsSurface)
      applyLiveProjection()
    })
    themeMO.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    unsubs.push(() => themeMO.disconnect())
  }

  /* The host says "the world changed" -- sign-in, sign-out, the example
     toggle -- and this page re-resolves rather than trusting a stale verdict.
     `reask: true` because the event's whole reason to fire is that the
     transport answer may have changed; harmless when nothing did. */
  if (typeof window !== 'undefined') {
    const onSourceChange = () => { loadLocalMetrics({ reask: true }) }
    window.addEventListener(DATA_SOURCE_EVENT, onSourceChange)
    unsubs.push(() => window.removeEventListener(DATA_SOURCE_EVENT, onSourceChange))
  }

  return {
    el: root,
    destroy() {
      destroyed = true
      if (bootRaf) cancelAnimationFrame(bootRaf)     // a route swap inside the mount gap
      unsubs.forEach(u => u())
      /* The chart instances hold their own rAF, DOM and body-appended
         tooltip — dispose is what releases them on route cycling. */
      liveCharts?.dispose()
      liveCharts = null
    },
  }
}
