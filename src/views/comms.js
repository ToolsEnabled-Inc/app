// /comms — an agent fleet's message board, rendered as a calm two-pane channel
// view. The discord.send integration is dormant — bot-token auth, no token in
// the vault, zero sends — and is shown honestly as a footer row, never as live.
//
// CHANNELS, THE BOARD HISTORY, THE CONVERSATIONS AND THE TRANSPORTS ARE
// PROFILE DATA (src/fleet-profile.js), not constants of this view. They used
// to be literals here, and this comment used to call them "the real stable
// keys" — because they were: the durable-memory addresses of one working
// fleet, its two named machines, its two transport ports, and fifty-six hours
// of its curated traffic. A stranger's first run showed all of it. The byte
// gate could not object; none of it is a name or a path.
//
// Any address rendered from a profile, including the ones in the channel-rail
// footer below, is RFC 5737 documentation-reserved (192.0.2.0/24) ON PURPOSE —
// it can never be a real host. Do NOT "improve" them into a realistic-looking
// private range like 192.168.x: that ships something reading as a real machine
// roster while still passing a grep for the owner's own address, which is the
// bug this replaced. The footer is user-visible chrome, not a fixture.
//
// C7 adds the WATCH BOARD as the page default: a board of live conversation
// context boxes built from the shared chip component (.chip / .chip-preview /
// .as-chat + buildChat from components.js) — the graph's boxes, laid out as a
// scrollable stack that drag-splits into nested tiles.
//
// Everything here is a self-contained simulation: no credentials, no personal
// data, values-as-JSON conventions only ever described, never transported.

import { sim } from '../sim.js'
import { el, countUp, buildChat, attachSeg } from '../components.js'
import { onNextFrame } from '../page-frames.js'
import { pick, ROLES } from '../vocab.js'
import { FLEET } from '../fleet-profile.js'
import { isLiveView } from '../live-flags.js'
import { fetchOps } from '../live-status.js'
/* The shared empty-state notice — see projectionUnavailableEl below for why this
   board does not write its own. src/guide.css carries the two placements this
   page needs (`.comms .chip-preview .host-absent`, `.comms .chat-log .host-absent`). */
import { hostAbsentMarkup } from '../first-run-needs.js'
import '../comms.css'

const H = 3600e3
const DAY = 86400e3
const pad2 = (n) => String(n).padStart(2, '0')
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtTime = (at) => { const d = new Date(at); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` }
const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }
const dayKeyOf = (at) => { const d = new Date(at); d.setHours(0, 0, 0, 0); return d.getTime() }
const dayLabel = (dk) => {
  const diff = Math.round((midnight() - dk) / DAY)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return new Date(dk).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/* ---------- sender convention: [agent/role], role hues = the graph's ----------
   `mach` is which host a sender speaks from, and it is READ FROM THE PROFILE
   rather than written here. The literals it replaced were "A" and "B" — one
   fleet's own two-machine naming, restated on every message in the log. A
   profile with one host collapses every sender onto it; a profile with more
   than two spreads them round-robin, which is honest for a simulation and
   never invents a host that the profile does not declare. */
const HOSTS = FLEET.machines.map((m, i) => m.short || m.name || String(i + 1))
const host = (i) => HOSTS[i % HOSTS.length] || '—'

const SENDERS = {
  controller: { tag: 'claude/controller', role: 'coordinator', mach: host(0) },
  codexb:     { tag: 'codex/coordinator', role: 'coordinator', mach: host(1) },
  helperb:    { tag: 'claude-b/helper',   role: 'helper',      mach: host(1) },
  terra:      { tag: 'terra/reviewer',    role: 'shadow',      mach: host(0) },
  luna:       { tag: 'luna/builder',      role: 'manager',     mach: host(1) },
  gem2:       { tag: 'gem-lane-2/builder', role: 'default',    mach: host(1) },
  gem4:       { tag: 'gem-lane-4/builder', role: 'default',    mach: host(0) },
  sandbox:    { tag: 'sandbox-w1/builder', role: 'default',    mach: host(1) },
  assistant:  { tag: 'assistant',          role: 'spawned',    mach: host(0) },
  declared:   { tag: 'on record',          role: 'default',    mach: '—' },
  service:    { tag: 'service',            role: 'default',    mach: '—' },
  observed:   { tag: 'seen running',       role: 'helper',     mach: '—' },
  channel:    { tag: 'channel',            role: 'helper',     mach: '—' },
  projection: { tag: 'status',             role: 'shadow',     mach: '—' },
}

/* "role hues = the graph's" was a promise the literals above quietly broke:
   claude is a helper on the graph and metrics table but wore coordinator cyan
   here, terra likewise. One agent, two colours, three pages — the exact tell
   that these views don't share a world. So the sim roster is the authority:
   each sender adopts the role of its sim twin (exact name first, then the
   numbered-lane prefix, e.g. terra → terra-01), and the literal survives only
   as the fallback for senders with no twin (the [assistant] system voice). */
{
  const roster = sim.computers.flatMap(c => c.agents)
  for (const s of Object.values(SENDERS)) {
    const name = s.tag.split('/')[0]
    const twin = roster.find(a => a.name === name)
      || roster.find(a => a.name.startsWith(name + '-'))
    if (twin) s.role = twin.role
  }
}
const BUILDERS = ['luna', 'gem2', 'gem4', 'sandbox']

/* ---------- channels, history and live traffic all come from the profile ---------- */
const CHANNELS = FLEET.channels

/* Hours-ago offsets keep every stamp in the past, so a log opens with real
   scrollback and day dividers however long after the build it is first run. */
const seededAt = (agoH) => Date.now() - (Number(agoH) || 0) * H - ri(0, 50) * 1000

function seedHistory() {
  const out = {}
  for (const def of CHANNELS) {
    const seeded = Array.isArray(FLEET.board?.[def.id]) ? FLEET.board[def.id] : []
    out[def.id] = seeded
      .map(({ agoH, ...m }) => ({ ...m, at: seededAt(agoH) }))
      .sort((a, b) => a.at - b.at)
  }
  return out
}

/* ---------- live arrivals: packet composer, no channel goes stale ----------
   The generators are keyed by CHANNEL ID, and a profile is free to declare
   channels these do not cover — a channel with no generator simply stays at
   its seeded history rather than receiving another channel's traffic. */
function makeComposer() {
  let reviewN = 5
  let questionOpen = false
  const evid = () => `sample/evidence/${pick(['gate-check', 'territory-sweep', 'repro', 'frame-budget', 'board-morph'])}-${ri(11, 61)}.md`

  return {
    assignments: () => ({
      s: pick(['controller', 'controller', 'codexb']),
      t: `sample assignment: ${pick([
        'route review evidence through the artifacts tree, not through chat.',
        'hold new lanes until the open fix round lands.',
        'the consistency pass stays blocking — any two pages must read as one product.',
        'name your files in the claim; an unnamed territory is how two lanes collide.',
      ])}`,
    }),
    status: () => {
      const kind = Math.random()
      if (kind < 0.45) {
        const n = ri(9, 47)
        return { s: pick(BUILDERS), t: `phase ${ri(2, 5)} complete — ${n} of ${n} checks pass in ${ri(0, 3)}m${pad2(ri(4, 59))}s. Evidence: ${evid()}` }
      }
      if (kind < 0.65) return { s: pick(BUILDERS), t: `claim: ${pick(['the checks lane', 'the layout pass', 'the board polish', 'the pointer-math check'])} — no colliding claim, territory named file by file.` }
      if (kind < 0.85) return { s: pick(BUILDERS), t: `checkpoint at phase ${ri(2, 4)} of ${ri(4, 6)}; resume state written and the plan re-read before continuing.` }
      return { s: pick(BUILDERS), t: `lease heartbeat fresh; phase ${ri(1, 3)} of ${ri(3, 5)} underway.` }
    },
    blockers: () => ({
      s: pick(['luna', 'gem4', 'assistant']),
      t: pick([
        'BLOCKER: a stale lease is holding the queue — it reads as live and the heartbeat is 40 minutes old. Sweeping it before the claim.',
        'BLOCKER: one lane probe timed out at the ceiling; the other stayed clean. Retrying with backoff before calling it an outage.',
        `collision warning: two lanes named ${pick(['the same view file', 'the same config file', 'the same shared stylesheet'])}. The later claim yields and re-claims after the first checkpoint.`,
        'cleared — lease swept, queue clean, lock released. Nothing else shows a stale heartbeat.',
      ]),
    }),
    reviews: () => {
      const accept = Math.random() < 0.78
      const n = ri(9, 21)
      return {
        s: 'terra',
        t: accept
          ? `sample/reviews/${reviewN++}: ACCEPT — ${n} of ${n} criteria pass, ${ri(28, 190)}s. Every path in the evidence tree resolves.`
          : `sample/reviews/${reviewN++}: REJECT — criterion ${ri(2, 6)} fails (${pick(['clipped legend at the smaller size', 'focus ring missing', 'frame budget over', 'layout jump on rollover'])}). One fix round, that criterion only.`,
      }
    },
    questions: () => {
      if (questionOpen) {
        questionOpen = false
        return {
          s: pick(['controller', 'helperb']),
          t: `answered at the reply key: ${pick([
            'take host identity from the checks, not from a note — the note is last week\'s.',
            'that file belongs to another lane this round; request the change from its owner.',
            'yes, under the size ceiling and with no credentials in any shape.',
          ])}`,
        }
      }
      questionOpen = true
      return {
        s: pick(BUILDERS),
        t: `question: ${pick([
          'which host owns the write path while both are up?',
          'is the shared reports directory safe for checkpoint writes this round?',
          'who owns the shared stylesheet? I need one token added.',
          'does the audit want counts per key or per write?',
        ])}`,
      }
    },
  }
}

/* Weights name channel ids, so a profile that renames its channels loses live
   traffic on the ones it dropped rather than pushing another channel's packets
   into them. A profile whose channels are all unweighted simply has no live
   arrivals, and the board stays at its seeded history. */
const LIVE_WEIGHT_TABLE = [
  ['status', 34], ['reviews', 16], ['assignments', 14],
  ['questions', 14], ['blockers', 11],
]
const LIVE_WEIGHTS = LIVE_WEIGHT_TABLE.filter(([id]) => CHANNELS.some(c => c.id === id))
function pickChannelWeighted() {
  const total = LIVE_WEIGHTS.reduce((n, [, w]) => n + w, 0)
  if (!total) return null
  let r = Math.random() * total
  for (const [id, w] of LIVE_WEIGHTS) { r -= w; if (r < 0) return id }
  return LIVE_WEIGHTS[0][0]
}

/* ============================================================
   C7 — WATCH BOARD data. Conversation pairs reuse the sender
   convention above; parent/child links give the branch chains
   (coord-sync → ctl-build → lane-brief is two levels deep).
   ============================================================ */

const RANK = { coordinator: 4, helper: 3, shadow: 3, manager: 2, default: 1, spawned: 0 }
const shortName = (k) => SENDERS[k].tag.split('/')[0]
const domOf = (d) => RANK[SENDERS[d.a].role] >= RANK[SENDERS[d.b].role] ? d.a : d.b
const impOf = (d) => Math.max(RANK[SENDERS[d.a].role], RANK[SENDERS[d.b].role])

/* Conversations are profile data for the same reason the channels are: the set
   that was here was one fleet's own cross-machine traffic, down to the test it
   used to decide which of its two checkouts was canonical. A conversation
   names two SENDERS keys and, optionally, a child conversation it can branch
   into; anything naming a sender this view does not know is dropped rather
   than rendered against an undefined role. */
const CONV_DEFS = (FLEET.conversations || []).filter(d =>
  d && SENDERS[d.a] && SENDERS[d.b] && Array.isArray(d.lines?.a) && Array.isArray(d.lines?.b)
    && d.lines.a.length > 0 && d.lines.b.length > 0)

/* Draw a conversation's next line WITHOUT replacement.

   Each side of a conversation has about six lines and the board shows eleven
   at a time, so drawing independently did not merely risk a repeat — it
   guaranteed several. One measured pane carried one line three times and three
   more twice each, out of eleven. Nothing reads as broken faster than a
   participant saying the same sentence verbatim two lines apart. (The measured
   examples that used to be quoted here were four of that fleet's own board
   messages, so the finding is kept and the transcript is not.)

   A shuffled bag per side spends the whole vocabulary before any line can come
   round again, and refilling re-shuffles while refusing to open with the line
   that just closed the previous bag — otherwise the one repeat this is meant
   to prevent reappears exactly at the seam. */
function bagDraw(bags, side, lines) {
  let bag = bags[side]
  if (!bag || !bag.length) {
    /* Refill as a PARTITION, not a shuffle-and-patch: everything said
       recently goes to the draw-last end wholesale, so a recent line cannot
       come round again until the whole non-recent half has been spoken —
       spacing of (pool − recent) side-draws by construction. The previous
       repair swept the shuffled tail and swapped offenders toward the front,
       which was best-effort: with small pools the sweep ran out of clean
       lines to swap with and quietly degenerated (measured: repeats-within-4
       jumped 0 -> 30 at depth 6). A partition cannot degenerate — its worst
       case IS its guarantee. Recent depth stays 4: deep enough that the two
       halves stay real halves on the smallest (10-line) pools. */
    const recent = bags.recent[side]
    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
      }
      return arr
    }
    const hot = shuffle(lines.filter(l => recent.includes(l)))
    const cold = shuffle(lines.filter(l => !recent.includes(l)))
    bag = hot.concat(cold)          // pop() draws from the end: cold first
    bags[side] = bag
  }
  const t = bag.pop()
  const rec = bags.recent[side]
  rec.push(t)
  if (rec.length > 4) rec.shift()
  return t
}

function seedConv(d, bags) {
  const n = 15 + ri(0, 7)
  const hist = []
  let ago = 20 + Math.random() * 16
  let side = Math.random() < 0.5 ? 'a' : 'b'
  for (let i = 0; i < n; i++) {
    hist.push({ at: Date.now() - ago * H, s: side === 'a' ? d.a : d.b, t: bagDraw(bags, side, d.lines[side]) })
    ago = Math.max(0.03, ago - (0.1 + Math.random() * (2 * ago / (n - i))))
    if (Math.random() < 0.8) side = side === 'a' ? 'b' : 'a'
  }
  return hist
}

/* Board layout tree: { t:'leaf', c:convId } | { t:'split', dir, branch?, ch:[a,b] }.
   Module-level so the whole board — histories, tiling, sizes, open chats —
   persists across in-session navigation (C7 layout model). */
const wbLeaf = (c) => ({ t: 'leaf', c })
let WATCH = null
function watchInit() {
  if (WATCH) return WATCH
  WATCH = {
    convs: new Map(CONV_DEFS.map(d => {
      // one bag pair per conversation, carried from the seed into the live
      // stream — a fresh bag at hand-over would let the newest line repeat
      // one the seeded history had only just used
      const bags = { a: null, b: null, recent: { a: [], b: [] } }
      return [d.id, { ...d, hist: seedConv(d, bags), side: 'a', bags }]
    })),
    /* The base stack is every conversation nothing else branches into. It was
       a hand-written list of five ids, which silently dropped a conversation
       whenever the set changed and could name one that no longer existed;
       derived, it is correct for any profile. */
    stack: CONV_DEFS
      .filter(d => !CONV_DEFS.some(other => other.child === d.id))
      .map(d => wbLeaf(d.id)),
    size: 'm',
    mode: 'watch',
    open: new Set(),
  }
  return WATCH
}

/* Live cards deliberately keep declared services and observed channels as
   separate records. A matching port, name, or transport is not evidence that
   the two are the same thing, so this view never pairs them as a relationship. */
let LIVE_WATCH = null
const liveCard = (id, kind, key, desc, unavailable = null) => ({
  id,
  a: kind === 'declared' ? 'declared' : kind === 'observed' ? 'observed' : 'projection',
  b: kind === 'declared' ? 'service' : kind === 'observed' ? 'channel' : 'projection',
  key,
  desc,
  hist: [],
  side: 'a',
  bags: { a: null, b: null, recent: { a: [], b: [] } },
  unavailable,
  child: null,
})

function liveWatchInit() {
  if (LIVE_WATCH) return LIVE_WATCH
  const pending = liveCard('ops-projection', 'projection', 'live comms', 'Reading this computer’s live comms data.', 'still reading the live comms data')
  LIVE_WATCH = {
    convs: new Map([[pending.id, pending]]),
    stack: [wbLeaf(pending.id)],
    size: 'm',
    mode: 'watch',
    open: new Set(),
  }
  return LIVE_WATCH
}

/* ---------- DOM builders ---------- */
function msgEl(m, fresh = false) {
  const sender = SENDERS[m.s]
  return el(`
    <div class="cmsg${fresh ? ' fresh' : ''}">
      <i class="cmsg-bar role-${sender.role}"></i>
      <div class="cmsg-main">
        <div class="cmsg-top">
          <span class="cmsg-au"><span class="br">[</span>${esc(sender.tag)}<span class="br">]</span></span>
          <span class="cmsg-mach">${sender.mach}</span>
          ${m.pinned ? '<span class="cmsg-pin">pinned</span>' : ''}
          <span class="cmsg-time">${fmtTime(m.at)}</span>
        </div>
        <div class="cmsg-text">${esc(m.t)}</div>
      </div>
    </div>
  `)
}

const dividerEl = (dk) => el(`<div class="day-div"><span>${dayLabel(dk)}</span></div>`)

/* The sentence this board shows while the read is still IN FLIGHT. It is named
   because two places set it and one place below has to recognise it: a read
   that has not answered yet is not a machine with no agent host, and the two
   states must not print the same notice. */
const LIVE_COMMS_LOADING = 'still reading the live comms data'

/* WHAT AN EMPTY BOARD SAYS, and why the words are not this file's.
 *
 * This branch is the shipping state — `dist/data/*.json` are build-time outputs
 * and no process on a customer machine writes them — and the whole of what it
 * used to say was "unavailable — No local agent fleet host detected on this
 * machine." True, and not an explanation: it names a mechanism the reader has
 * never heard of and offers no door. src/first-run-needs.js owns that
 * explanation now, and home, the fleet graph and Settings read the same module,
 * so one condition is described once rather than four ways.
 *
 * THE LOADING CASE KEEPS THE TERSE LINE ON PURPOSE. "Nothing is reporting to
 * this copy yet" is a claim about the person's machine; while the read is still
 * going nobody knows that yet, and printing it early would be a wrong answer
 * that silently corrects itself — which reads as the product changing its mind.
 * An unanswered read is not an absent host.
 *
 * A MISSING reason falls to the full notice, not to the terse line: "we could
 * not read it and cannot say why" is exactly when a person is most lost, so
 * absence removes only the quoted sentence, never the explanation or the door. */
const projectionUnavailableEl = (reason) => {
  if (reason === LIVE_COMMS_LOADING) {
    return el(`<div class="projection-unavailable" data-projection-unavailable="true">unavailable — ${esc(reason)}</div>`)
  }
  const node = el(hostAbsentMarkup(reason, { compact: true }))
  node.dataset.projectionUnavailable = 'true'
  return node
}
const projectionNoticeEl = (note) => el(`<div class="projection-state" data-projection-state="true">${esc(note)}</div>`)

function liveMsgEl(m) {
  return el(`
    <div class="cmsg" data-live-mode="live">
      <i class="cmsg-bar role-default"></i>
      <div class="cmsg-main">
        <div class="cmsg-top">
          <span class="cmsg-au"><span class="br">[</span>${esc(m.sender)}<span class="br">]</span></span>
          <span class="cmsg-mach">observed</span>
          <span class="cmsg-time">${fmtTime(m.at)}</span>
        </div>
        <div class="cmsg-text">${esc(m.t)}</div>
      </div>
    </div>
  `)
}

const PIN_SVG = `<svg viewBox="0 0 24 24"><path d="M15 3.5 20.5 9 14 12l-1.5 5.5-4-4L4 18l4.5-4.5-4-4L10 8l5-4.5Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>`

/* The rail footer names the fleet's transports and hosts, and both belong to
   the operator rather than to the product. It used to be four literals: two
   named ports each carrying a green dot and the word "up", and a two-host
   roster with one host labelled canonical. On a fresh install that is a health
   claim about infrastructure the app has never contacted, and a roster of
   machines the reader does not own. A transport with no port says it is not
   configured, and the dot marks "configured", never "reachable". */
function railFootMarkup() {
  const txt = (value) => esc(String(value ?? ''))
  const lines = []
  for (const transport of FLEET.transports || []) {
    const portNumber = Number(transport.port)
    const port = Number.isFinite(portNumber) && transport.port !== null ? ` :${txt(portNumber)}` : ''
    lines.push(`<span class="foot-line">${port ? '<i class="ok"></i>' : ''}<span class="ft"><b>${txt(transport.label || transport.id || 'transport')}</b>${port} · ${txt(transport.note || 'not configured')}</span></span>`)
  }
  for (const machine of FLEET.machines || []) {
    const tag = machine.note ? `<span class="foot-can">${txt(machine.note)}</span>` : ''
    lines.push(`<span class="foot-line"><span class="ft">${txt(machine.name)} ${txt(machine.ip)}</span>${tag}</span>`)
  }
  if (!lines.length) lines.push('<span class="foot-line"><span class="ft">no transports or hosts declared</span></span>')
  return lines.join('')
}

export function commsView() {
  const liveMode = isLiveView('comms')
  const W = liveMode ? liveWatchInit() : watchInit()
  const root = el(`
    <div class="comms" data-mode="${W.mode}" data-live-mode="${liveMode ? 'live' : 'simulated'}" data-projection-state="${liveMode ? 'loading' : 'simulated'}">
      <header class="comms-head">
        <span class="head-hash">#</span><span class="head-name"></span>
        <span class="head-meta">message board · cross-machine</span>
        <span class="head-wt">watch board</span>
        <span class="head-wt-meta">message board · live conversations</span>
        <span class="spacer"></span>
        <div class="seg wb-seg size-seg" role="group" aria-label="Box size">
          <button type="button" data-size="s" title="Small boxes">S</button>
          <button type="button" data-size="m" title="Medium boxes">M</button>
          <button type="button" data-size="l" title="Large boxes">L</button>
        </div>
        <div class="seg wb-seg mode-seg" role="group" aria-label="Comms mode">
          <button type="button" data-wmode="watch">Watch</button>
          <button type="button" data-wmode="channels">Channels</button>
        </div>
        <span class="head-live"><i></i>live</span>
        <span class="head-count"><b>0</b> agents</span>
      </header>
      <div class="comms-card glass">
        <div class="comms-body">
          <div class="watch-pane" data-size="${W.size}">
            <div class="watch-stack"></div>
          </div>
          <section class="comms-sheet">
            <aside class="ch-rail">
              <div class="ch-rail-label">${liveMode ? 'Ops projection' : 'Channels'}</div>
              <div class="ch-list"></div>
              <div class="ch-rail-foot" data-projection-foot="true">${railFootMarkup()}</div>
            </aside>
            <section class="ch-main">
              <div class="ch-view">
                <div class="ch-topic"></div>
                <div class="ch-log"></div>
              </div>
              <button class="jump-chip hidden">
                <span class="jl">jump to latest</span>
                <svg viewBox="0 0 24 24"><path d="M12 5v13m0 0 5.5-5.5M12 18l-5.5-5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <footer class="integ-row">
                <i class="integ-dot"></i>
                <span class="integ-main"><b>discord.send</b> · configured, no token · 0 messages sent</span>
                <span class="integ-tag">dormant integration</span>
                <span class="spacer"></span>
                <span class="integ-note">writes via durable memory</span>
              </footer>
            </section>
          </section>
        </div>
      </div>
    </div>
  `)

  /* ---- state ---- */
  const history = liveMode ? {} : seedHistory()
  const compose = liveMode ? null : makeComposer()
  let channelDefs = liveMode
    ? [{ id: 'ops-projection', name: 'live comms', key: 'ops', mach: 'live', topic: 'Reading this computer’s live comms data.', unavailable: LIVE_COMMS_LOADING }]
    : CHANNELS
  let liveMessagesReason = liveMode ? LIVE_COMMS_LOADING : null
  let destroyed = false
  /* The opening channel used to be the id 'directive', which only existed
     because the channel list was a literal in this file. A profile names its
     own channels, so the board opens on the pinned one — the pinned channel is
     the one a board points a first-time reader at — and falls back to the
     first declared channel when nothing is pinned. */
  const openingChannel = channelDefs.find(def => def.pinned) || channelDefs[0]
  const state = {
    active: openingChannel?.id ?? null,
    unread: new Set(),
    pinnedToBottom: true,
    newCount: 0,
    lastDayKey: null,
  }
  const timers = []

  const listEl = root.querySelector('.ch-list')
  const railFoot = root.querySelector('[data-projection-foot]')
  const headMeta = root.querySelector('.head-meta')
  const headCount = root.querySelector('.head-count')
  const headName = root.querySelector('.head-name')
  const countEl = root.querySelector('.head-count b')
  const viewEl = root.querySelector('.ch-view')
  const topicEl = root.querySelector('.ch-topic')
  const logEl = root.querySelector('.ch-log')
  const chip = root.querySelector('.jump-chip')
  const chipLabel = chip.querySelector('.jl')
  const reduced = () => document.body.classList.contains('reduce-motion')

  /* ---- one-shot event animations ----
     Nothing on this page animates at rest. Anything that moves is reporting
     that something just happened, so every animation is a class added at the
     moment of the event and cleared when it ends — restartable if the event
     repeats mid-flight, and leaving no state behind that could keep moving. */
  function oneShot(node, cls) {
    if (!node) return
    node.classList.remove(cls)
    void node.offsetWidth              // force restart when it fires again
    node.classList.add(cls)
  }
  const liveDot = root.querySelector('.head-live i')
  liveDot.addEventListener('animationend', () => liveDot.classList.remove('beat'))
  let lastBeat = 0
  function beatLive(forMode) {
    if (W.mode !== forMode) return      // the indicator reports the feed being read
    const now = performance.now()
    if (now - lastBeat < 1600) return   // a burst coalesces into one beat, never a strobe
    lastBeat = now
    oneShot(liveDot, 'beat')
  }

  /* ---- channel rail (pinned entry on top, then the working channels) ---- */
  const railItems = new Map()
  function renderRail() {
    listEl.textContent = ''
    railItems.clear()
    channelDefs.forEach((def, i) => {
      /* The separator marks the end of the pinned block. It used to fire at
         index 1 unconditionally, which was right only while the first channel
         was always the pinned one; a profile decides that now. */
      const afterPinned = !liveMode && i > 0 && Boolean(channelDefs[i - 1].pinned) && !def.pinned
      if (def.dividerBefore || afterPinned) listEl.appendChild(el(`<div class="ch-rail-sep"></div>`))
      const item = el(`
        <button class="ch${def.pinned ? ' pin' : ''}" data-id="${esc(def.id)}" title="${esc(def.key)}">
          <span class="ch-hash">${def.pinned ? PIN_SVG : '#'}</span>
          <span class="ch-name">${esc(def.name)}</span>
          <span class="ch-mach">${esc(def.mach)}</span>
          <i class="ch-dot"></i>
        </button>
      `)
      item.addEventListener('click', () => switchChannel(def.id))
      const dot = item.querySelector('.ch-dot')
      dot.addEventListener('animationend', () => dot.classList.remove('ping'))
      listEl.appendChild(item)
      railItems.set(def.id, item)
    })
  }
  renderRail()

  const defOf = (id) => channelDefs.find(c => c.id === id)

  /* ---- timeline rendering ---- */
  function renderLog(id) {
    const def = defOf(id)
    if (!def) return
    if (liveMode) {
      topicEl.innerHTML = `key <b>${esc(def.key)}</b> — ${esc(def.topic)}`
      logEl.innerHTML = ''
      if (def.unavailable || liveMessagesReason) logEl.appendChild(projectionUnavailableEl(def.unavailable || liveMessagesReason))
      else if (!history[id]?.length) logEl.appendChild(projectionNoticeEl('No messages have been seen for this exact channel.'))
      else for (const m of history[id]) logEl.appendChild(liveMsgEl(m))
      state.pinnedToBottom = true
      state.newCount = 0
      updateChip()
      /* PIN AFTER LAYOUT, NOT AFTER A FRAME THAT MAY NEVER COME. A covered
         window gets no frames, so this callback -- and the log it closed
         over -- stayed in the browser's queue for ever (measured: +2 per lap
         of the ring at this site). onNextFrame flushes layout and pins now on
         such a page, and is the ordinary requestAnimationFrame otherwise. */
      onNextFrame(() => { logEl.scrollTop = logEl.scrollHeight })
      return
    }
    topicEl.innerHTML = `key <b>${esc(def.key)}</b> — ${esc(def.topic)}`
    logEl.innerHTML = ''
    state.lastDayKey = null
    const seeded = history[id] || []
    /* A declared channel with no seeded history is a real state now that the
       channel list is profile data — say what the empty log is, because an
       empty pane under a topic bar reads as a failed load, not as a quiet
       channel. */
    if (!seeded.length) logEl.appendChild(projectionNoticeEl('No messages on this channel yet.'))
    for (const m of seeded) {
      const dk = dayKeyOf(m.at)
      if (dk !== state.lastDayKey) { logEl.appendChild(dividerEl(dk)); state.lastDayKey = dk }
      logEl.appendChild(msgEl(m))
    }
    state.pinnedToBottom = true
    state.newCount = 0
    updateChip()
    onNextFrame(() => { logEl.scrollTop = logEl.scrollHeight })
  }

  function updateChip() {
    chip.classList.toggle('hidden', state.pinnedToBottom)
    /* .hidden only fades it out; a faded-out control is still a tab stop whose
       focus ring paints at opacity 0. Take it out of the tab order and the a11y
       tree while it is hidden — the fade transition is unaffected. */
    chip.inert = state.pinnedToBottom
    chip.tabIndex = state.pinnedToBottom ? -1 : 0
    chipLabel.textContent = state.newCount > 0
      ? `${state.newCount} new — jump to latest`
      : 'jump to latest'
  }

  let switching = 0
  function switchChannel(id) {
    if (id === state.active) return
    state.active = id
    state.unread.delete(id)
    railItems.forEach((item, cid) => {
      item.classList.toggle('active', cid === id)
      item.classList.toggle('has-unread', state.unread.has(cid))
    })
    headName.textContent = defOf(id)?.name || ''
    // crossfade: settle out, swap content, settle back in — in place
    clearTimeout(switching)
    viewEl.classList.add('swap')
    switching = setTimeout(() => {
      renderLog(id)
      requestAnimationFrame(() => viewEl.classList.remove('swap'))
    }, reduced() ? 0 : 160)
    timers.push(switching)
  }

  /* ---- live arrivals ---- */
  function arrive() {
    /* Both guards exist because the channel set is profile data: a profile can
       declare channels no generator covers, and one can declare none that any
       generator covers. Either used to be an unhandled undefined call. */
    const id = pickChannelWeighted()
    const packet = id && compose[id] ? compose[id]() : null
    if (!packet || !history[id]) return
    const m = { at: Date.now(), s: packet.s, t: packet.t }
    history[id].push(m)
    if (history[id].length > 80) history[id].splice(0, history[id].length - 80)

    beatLive('channels')

    if (id === state.active) {
      const dk = dayKeyOf(m.at)
      if (dk !== state.lastDayKey) { logEl.appendChild(dividerEl(dk)); state.lastDayKey = dk }
      logEl.appendChild(msgEl(m, true))
      if (state.pinnedToBottom) {
        onNextFrame(() => { logEl.scrollTop = logEl.scrollHeight })
      } else {
        state.newCount += 1
        updateChip()
      }
    } else {
      state.unread.add(id)
      const item = railItems.get(id)
      item.classList.add('has-unread')
      // the arrival gets the light; the unread dot itself rests flat
      oneShot(item.querySelector('.ch-dot'), 'ping')
    }
  }

  let liveT = 0
  const schedule = () => {
    liveT = setTimeout(() => { arrive(); schedule() }, 5200 + Math.random() * 8800)
    timers.push(liveT)
  }
  if (!liveMode) schedule()

  /* ---- pinned auto-scroll + jump chip ---- */
  logEl.addEventListener('scroll', () => {
    const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 48
    if (nearBottom !== state.pinnedToBottom) {
      state.pinnedToBottom = nearBottom
      if (nearBottom) state.newCount = 0
      updateChip()
    }
  })
  chip.addEventListener('click', () => {
    logEl.scrollTo({ top: logEl.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' })
  })

  /* ---- live agent count from the fleet sim ---- */
  let shownCount = 0
  const agentTotal = () => sim.computers.reduce((n, c) => n + c.agents.length, 0)
  const renderCount = () => {
    const next = agentTotal()
    if (next !== shownCount) { countUp(countEl, shownCount, next, 500); shownCount = next }
  }
  if (!liveMode) countEl.textContent = String(shownCount = agentTotal())
  const unsubs = liveMode ? [] : [
    sim.on('spawn', renderCount),
    sim.on('reap', renderCount),
    sim.on('computers', renderCount),
  ]

  /* ==========================================================
     C7 — WATCH BOARD. Every box is the shared context-box chip
     (.chip / .chip-preview / .as-chat + buildChat) laid out as
     a fixed vertical stack that drag-splits into nested tiles.
     ========================================================== */
  const pane = root.querySelector('.watch-pane')
  const stackEl = root.querySelector('.watch-stack')
  const stackDrop = el(`<div class="wb-stackdrop"></div>`)
  const wtMeta = root.querySelector('.head-wt-meta')
  /* `${n} conversations` read "1 conversations" on a fresh install, which is
     the first line of the first page a person reaches from home's forward
     arrow. Singular/plural is spelled the way the rest of this codebase
     spells it (src/local-activity.js, src/account-markup.js and 18 others). */
  const conversationsMeta = count => `message board · ${count} conversation${count === 1 ? '' : 's'}`
  wtMeta.textContent = conversationsMeta(W.convs.size)
  const EASE = 'cubic-bezier(0.22, 0.9, 0.26, 1)'
  const boxEls = new Map()            // convId -> chip element (this mount)
  let dragTeardown = null
  { const esc = (ev) => { if (ev.key === 'Escape' && drag) dragTeardown?.() }; window.addEventListener('keydown', esc); unsubs.push(() => window.removeEventListener('keydown', esc)) } // audit #27: Escape aborts an in-flight box drag through the SAME teardown destroy() uses (abortDrag + listener cleanup); guarded on `drag` so a stray Escape outside a drag is a no-op

  /* ----- tree helpers ----- */
  function locate(target, list = W.stack, parentSplit = null) {
    for (let i = 0; i < list.length; i++) {
      const n = list[i]
      if (n === target) return { list, index: i, parentSplit }
      if (n.t === 'split') { const r = locate(target, n.ch, n); if (r) return r }
    }
    return null
  }
  function findLeafByConv(cid, list = W.stack) {
    for (const n of list) {
      if (n.t === 'leaf' && n.c === cid) return n
      if (n.t === 'split') { const r = findLeafByConv(cid, n.ch); if (r) return r }
    }
    return null
  }
  function eachSplit(fn, list = W.stack) {
    for (const n of list) if (n.t === 'split') { fn(n); eachSplit(fn, n.ch) }
  }
  const primaryConv = (n) => n.t === 'leaf' ? n.c : primaryConv(n.ch[0])
  function subtreeHas(rootN, target) {
    if (rootN === target) return true
    return rootN.t === 'split' && (subtreeHas(rootN.ch[0], target) || subtreeHas(rootN.ch[1], target))
  }
  function replaceNode(oldN, newN) {
    const loc = locate(oldN)
    if (loc) loc.list[loc.index] = newN
  }
  function detach(node) {
    const loc = locate(node)
    if (!loc) return
    if (!loc.parentSplit) { loc.list.splice(loc.index, 1); return }
    const P = loc.parentSplit
    const sibling = P.ch[loc.index === 0 ? 1 : 0]
    replaceNode(P, sibling)
  }
  /* the draggable unit for a box: a branch parent carries its whole pairing;
     a branch child stays pinned to its parent */
  function findDragNode(cid) {
    let node = findLeafByConv(cid)
    if (!node) return null
    for (;;) {
      const loc = locate(node)
      if (!loc || !loc.parentSplit) return node
      if (loc.parentSplit.branch) {
        if (loc.parentSplit.ch[0] === node) { node = loc.parentSplit; continue }
        return null
      }
      return node
    }
  }
  const dropTargetNode = findDragNode      // same climb: split around branch pairs

  const findBranchByParent = (cid) => {
    let found = null
    eachSplit(s => { if (!found && s.branch && s.ch[0].t === 'leaf' && s.ch[0].c === cid) found = s })
    return found
  }
  const findBranchByChild = (cid) => {
    let found = null
    eachSplit(s => { if (!found && s.branch && primaryConv(s.ch[1]) === cid) found = s })
    return found
  }

  /* ----- box construction (the reused chip component) ----- */
  /* Name and text are separate grid cells (see comms.css): with full 2-3
     sentence messages the old inline "name · text" form buried the speaker
     mid-paragraph on every wrapped line. A shared name column turns the
     senders into a scannable rail — who is talking reads down the pane
     without reading a single message. side-a/side-b lets CSS tint each
     speaker with the same role hue their header dot already wears. */
  function previewLineEl(d, m) {
    const side = m.s === d.a ? 'a' : 'b'
    return el(`<div class="cl side-${side}"><b>${esc(m.sender || shortName(m.s))}</b><span>${esc(m.t)}</span></div>`)
  }
  function chatMsgEl(d, m) {
    const side = m.s === d.a ? 'them' : 'me'
    return el(`<div class="msg ${side}"><span class="who">${esc(m.sender || shortName(m.s))}</span>${esc(m.t)}</div>`)
  }

  function boxOf(cid) {
    let box = boxEls.get(cid)
    if (box) return box
    const d = W.convs.get(cid)
    const dom = domOf(d)
    const ra = ROLES[SENDERS[d.a].role]
    const rb = ROLES[SENDERS[d.b].role]
    box = el(`
      <div class="chip wb-box role-${SENDERS[dom].role}" data-conv="${cid}"
           data-agent="${esc(SENDERS[dom].tag)}" data-importance="${impOf(d)}"
           style="--au-a:${ra.hex};--au-b:${rb.hex}">
        <div class="wb-head">
          <span class="wb-pair">
            <i class="wb-dot" style="background:${ra.hex}"></i><span class="wb-name">${esc(shortName(d.a))}</span>
            <span class="wb-x">↔</span>
            <i class="wb-dot" style="background:${rb.hex}"></i><span class="wb-name">${esc(shortName(d.b))}</span>
          </span>
          <span class="wb-key">${esc(d.key)}</span>
          <span class="spacer"></span>
          <button type="button" class="wb-btn wb-branch" title="Open sub-conversation" aria-pressed="false" ${d.child ? '' : 'hidden'}>
            <svg viewBox="0 0 24 24"><circle cx="7" cy="5" r="1.7" fill="currentColor"/><path d="M7 7v6a4 4 0 0 0 4 4h5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="m13.5 14 3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" class="wb-btn wb-restack" title="Return to stack">
            <svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h8M5 17h8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M17.5 17.5v-6m0 0L15 14m2.5-2.5L20 14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" class="wb-btn wb-dismiss" title="Close sub-conversation">
            <svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="wb-desc">${esc(d.desc)}</div>
        <div class="chip-preview"></div>
        <div class="wb-drop"><i></i></div>
      </div>
    `)
    const pv = box.querySelector('.chip-preview')
    if (d.unavailable) pv.appendChild(projectionUnavailableEl(d.unavailable))
    else if (d.hist.length) for (const m of d.hist.slice(-14)) pv.appendChild(previewLineEl(d, m))
    else if (liveMode) pv.appendChild(projectionNoticeEl('No messages have been seen for this exact channel.'))
    onNextFrame(() => { pv.scrollTop = pv.scrollHeight })

    box._pvFollow = true
    box._chatFollow = true
    pv.addEventListener('scroll', () => {
      box._pvFollow = pv.scrollHeight - pv.scrollTop - pv.clientHeight < 36
    })
    // pause-on-hover: text never moves under the cursor
    box.addEventListener('mouseenter', () => { box._hover = true })
    box.addEventListener('mouseleave', () => {
      box._hover = false
      if (box._pvFollow) pv.scrollTop = pv.scrollHeight
      const log = box.querySelector('.chat-log')
      if (log && box._chatFollow) log.scrollTop = log.scrollHeight
    })
    box.addEventListener('animationend', (e) => {
      if (e.animationName === 'wbPulse') box.classList.remove('pulse')
    })

    box.querySelector('.wb-branch').addEventListener('click', (e) => {
      e.stopPropagation()
      toggleBranch(cid)
    })
    box.querySelector('.wb-restack').addEventListener('click', (e) => {
      e.stopPropagation()
      const node = findDragNode(cid)
      if (!node) return
      const loc = locate(node)
      if (!loc || !loc.parentSplit) return
      flipBoard(() => { detach(node); W.stack.push(node) })
    })
    box.querySelector('.wb-dismiss').addEventListener('click', (e) => {
      e.stopPropagation()
      const s = findBranchByChild(cid)
      if (s) flipBoard(() => replaceNode(s, s.ch[0]))
    })
    box.addEventListener('pointerdown', (e) => onBoxPointerDown(e, box))

    boxEls.set(cid, box)
    if (W.open.has(cid)) openChatBox(cid, true)
    return box
  }

  /* ----- expand ↔ collapse: the graph chips' FLIP morph, verbatim ----- */
  const stackChatPx = () => Math.min(Math.round(window.innerHeight * 0.48), 460)
  function openChatBox(cid, instant = false) {
    const box = boxEls.get(cid)
    const d = W.convs.get(cid)
    if (!box || box.classList.contains('as-chat')) return
    W.open.add(cid)
    clearTimeout(box._t)
    box.querySelector('.chat')?.remove()
    const inStack = box.classList.contains('stack-leaf')
    if (inStack && !instant && !reduced()) {
      box.style.height = box.offsetHeight + 'px'
      void box.offsetWidth
    }
    box.classList.add('as-chat')
    const chat = buildChat({
      title: `${shortName(d.a)} ↔ ${shortName(d.b)}`,
      subtitle: d.key,
      roleKey: SENDERS[domOf(d)].role,
      seed: 2,
      onClose: () => closeChatBox(cid),
    })
    box.appendChild(chat)
    const log = chat.querySelector('.chat-log')
    if (d.unavailable) log.appendChild(projectionUnavailableEl(d.unavailable))
    else if (d.hist.length) for (const m of d.hist.slice(-6)) log.appendChild(chatMsgEl(d, m))
    else if (liveMode) log.appendChild(projectionNoticeEl('No messages have been seen for this exact channel.'))
    log.scrollTop = log.scrollHeight
    box._chatFollow = true
    log.addEventListener('scroll', () => {
      box._chatFollow = log.scrollHeight - log.scrollTop - log.clientHeight < 36
    })
    if (inStack && !instant && !reduced()) {
      box.style.height = stackChatPx() + 'px'
      box._t = setTimeout(() => { box.style.height = '' }, 520)
      timers.push(box._t)
    }
  }
  function closeChatBox(cid) {
    const box = boxEls.get(cid)
    if (!box || !box.classList.contains('as-chat')) return
    W.open.delete(cid)
    clearTimeout(box._t)
    const inStack = box.classList.contains('stack-leaf')
    if (inStack && !reduced()) {
      box.style.height = box.offsetHeight + 'px'
      void box.offsetWidth
    }
    box.classList.remove('as-chat')
    if (inStack && !reduced()) requestAnimationFrame(() => { box.style.height = '' })
    box._t = setTimeout(() => {
      box.querySelector('.chat')?.remove()
      const pv = box.querySelector('.chip-preview')
      if (box._pvFollow) pv.scrollTop = pv.scrollHeight
    }, 520)
    timers.push(box._t)
  }

  /* ----- board rendering ----- */
  function renderNode(node, top) {
    if (node.t === 'leaf') {
      const box = boxOf(node.c)
      if (top) {
        box.classList.add('stack-leaf')
        box.classList.remove('in-split')
        node._el = box
        return box
      }
      const cell = el(`<div class="wb-cell"></div>`)
      box.classList.add('in-split')
      box.classList.remove('stack-leaf', 'dominant')
      box.style.height = ''
      cell.appendChild(box)
      node._el = cell
      return cell
    }
    const s = el(`<div class="wb-split ${node.dir}${node.branch ? ' branch' : ''}${top ? ' top-split' : ''}"></div>`)
    if (node.branch) {
      const pd = W.convs.get(primaryConv(node))
      s.style.setProperty('--pair', ROLES[SENDERS[domOf(pd)].role].hex)
    }
    const c0 = renderNode(node.ch[0], false)
    const c1 = renderNode(node.ch[1], false)
    if (node.branch) c1.classList.add('pair-b')
    s.append(c0, c1)
    node._el = s
    return s
  }

  function applyMarks() {
    for (const box of boxEls.values()) {
      box.classList.remove('branch-child', 'can-restack', 'dominant')
      const btn = box.querySelector('.wb-branch')
      btn.classList.remove('on')
      btn.setAttribute('aria-pressed', 'false')
    }
    eachSplit((s) => {
      if (!s.branch) return
      const child = boxEls.get(primaryConv(s.ch[1]))
      child?.classList.add('branch-child')
      const parent = boxEls.get(s.ch[0].c)
      const btn = parent?.querySelector('.wb-branch')
      if (btn) { btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true') }
    })
    for (const cid of boxEls.keys()) {
      const box = boxEls.get(cid)
      if (!box.isConnected) continue
      const node = findDragNode(cid)
      if (node) {
        const loc = locate(node)
        if (loc && loc.parentSplit) box.classList.add('can-restack')
      }
    }
    // base-stack dominance: the most important agent's box reads biggest
    let best = null, bestImp = -1
    for (const entry of W.stack) {
      if (entry.t !== 'leaf') continue
      const imp = impOf(W.convs.get(entry.c))
      if (imp > bestImp) { bestImp = imp; best = entry }
    }
    if (best) boxEls.get(best.c)?.classList.add('dominant')
  }

  function applyWeights() {
    // per split: the side holding the most important agent takes the larger
    // share (~1.7×); a branch pairing always favours the parent conversation
    const childEl = (n) => n._el
    // .lead is this function's own mark — cleared wholesale before re-weighing
    // so a box that left its split, or a side whose weight flipped, never
    // keeps yesterday's emphasis
    for (const box of boxEls.values()) box.classList.remove('lead')
    function weigh(node) {
      if (node.t === 'leaf') return impOf(W.convs.get(node.c))
      const ia = weigh(node.ch[0])
      const ib = weigh(node.ch[1])
      let wa = 1, wb = 1
      if (node.branch) wa = 1.65
      else if (ia > ib) wa = 1.7
      else if (ib > ia) wb = 1.7
      childEl(node.ch[0])?.style.setProperty('--w', wa)
      childEl(node.ch[1])?.style.setProperty('--w', wb)
      // the winner also wears the emphasis (.lead): extra width alone reads
      // as layout, not importance — the box must LOOK like the lead too.
      // Only a leaf can wear it; when a whole sub-split wins, its own weigh()
      // pass has already crowned the best box inside it. A tie crowns nobody.
      const win = wa > wb ? node.ch[0] : wb > wa ? node.ch[1] : null
      if (win?.t === 'leaf') boxEls.get(win.c)?.classList.add('lead')
      return Math.max(ia, ib)
    }
    for (const entry of W.stack) if (entry.t === 'split') weigh(entry)
  }

  function saveScrolls() {
    const out = []
    for (const [cid, box] of boxEls) {
      if (!box.isConnected) continue
      const pv = box.querySelector('.chip-preview')
      const log = box.querySelector('.chat-log')
      out.push([cid, pv?.scrollTop ?? 0, log?.scrollTop ?? null])
    }
    return out
  }
  function restoreScrolls(saved) {
    for (const [cid, pvTop, logTop] of saved) {
      const box = boxEls.get(cid)
      if (!box?.isConnected) continue
      const pv = box.querySelector('.chip-preview')
      const log = box.querySelector('.chat-log')
      if (pv) pv.scrollTop = box._pvFollow ? pv.scrollHeight : pvTop
      if (log && logTop != null) log.scrollTop = box._chatFollow ? log.scrollHeight : logTop
    }
  }

  function renderBoard() {
    const saved = saveScrolls()
    stackEl.textContent = ''
    /* An empty board is reachable now that conversations are profile data, and
       the drop target alone is invisible — the pane would read as a rendering
       failure rather than as a profile that declares no conversations. */
    if (!W.stack.length) stackEl.appendChild(projectionNoticeEl('No conversations in this profile.'))
    for (const entry of W.stack) stackEl.appendChild(renderNode(entry, true))
    stackEl.appendChild(stackDrop)
    applyMarks()
    applyWeights()
    restoreScrolls(saved)
  }

  function setProjectionFoot(lines) {
    railFoot.innerHTML = lines.map(line => `
      <span class="foot-line"><span class="ft">${esc(line)}</span></span>
    `).join('')
  }

  function projectionDetailCard(parent, kind, unavailable) {
    const detail = liveCard(`${parent.id}:source`, 'projection', `${kind} status`, `${kind} is kept as its own record; the app never guesses that a service on record and a channel seen running are the same thing.`, unavailable)
    parent.child = detail.id
    return detail
  }

  function applyLiveProjection(result) {
    if (destroyed) return
    const envelope = result.ok ? result.data : null
    if (!envelope?.data) {
      const reason = result.reason || 'the live comms data could not be read'
      const unavailable = liveCard('ops-projection', 'projection', 'live comms', 'This computer’s live comms data could not be read.', reason)
      W.convs = new Map([[unavailable.id, unavailable]])
      W.stack = [wbLeaf(unavailable.id)]
      W.open.clear()
      channelDefs = [{ id: unavailable.id, name: 'live comms', key: 'ops', mach: 'unavailable', topic: 'The live comms data could not be read.', unavailable: reason }]
      liveMessagesReason = reason
      root.dataset.projectionState = 'unavailable'
      root.dataset.projectionUnavailable = 'true'
      root.querySelector('.head-live').lastChild.textContent = 'unavailable'
      headMeta.textContent = 'live comms · could not be read'
      /* The watch-board line was left at its mount-time value, so a page whose
         every other readout says "could not be read" still claimed
         "message board · 1 conversations" -- counting the synthetic
         could-not-be-read card as a conversation. Same sentence as headMeta
         above, for the same reason. */
      wtMeta.textContent = 'message board · could not be read'
      countEl.textContent = '—'
      headCount.childNodes[1].textContent = ' record'
      setProjectionFoot([`the live comms data could not be read — ${reason}`])
      state.active = unavailable.id
      state.unread.clear()
      boxEls.clear()
      renderRail()
      railItems.get(state.active)?.classList.add('active')
      headName.textContent = unavailable.name
      renderLog(state.active)
      renderBoard()
      return
    }

    const { data } = envelope
    const services = data.declaredServices
    const observed = data.channels.ok ? data.channels.value : null
    const messages = data.messages
    liveMessagesReason = messages.ok ? null : messages.reason || 'the messages could not be read'
    const rawMessages = messages.ok ? messages.value : []
    const cards = []
    const defs = []
    const messageRows = (sourceId) => rawMessages
      .filter(message => message.channelId === sourceId)
      .map(message => ({ at: new Date(message.at).getTime(), s: 'observed', sender: message.sender, t: message.text }))

    for (const service of services) {
      const id = `declared:${service.id}`
      const card = liveCard(id, 'declared', service.displayName, `Service on record · ${service.transport} · :${service.port} · ${service.resolution}`, liveMessagesReason)
      card.hist = messageRows(service.id)
      cards.push(card, projectionDetailCard(card, 'This service on record', liveMessagesReason))
      defs.push({ id, sourceId: service.id, name: service.displayName, key: `declared/${service.id}`, mach: 'declared', topic: `Service on record · ${service.transport} · port ${service.port} · ${service.resolution}`, unavailable: liveMessagesReason })
      history[id] = card.hist
    }
    if (!services.length) {
      const id = 'declared:empty'
      const card = liveCard(id, 'projection', 'services on record', 'No services are on record for this computer.', liveMessagesReason)
      cards.push(card, projectionDetailCard(card, 'Services on record', liveMessagesReason))
      defs.push({ id, name: 'services on record', key: 'declared', mach: 'empty', topic: 'No services are on record for this computer.', unavailable: liveMessagesReason })
      history[id] = []
    }

    if (observed) {
      for (const item of observed) {
        const id = `observed:${item.id}`
        const detail = item.detail ? ` · ${item.detail}` : ''
        const card = liveCard(id, 'observed', item.name, `Channel seen running · ${item.state}${detail}`, liveMessagesReason)
        card.hist = messageRows(item.id)
        cards.push(card, projectionDetailCard(card, 'This channel seen running', liveMessagesReason))
        defs.push({ id, sourceId: item.id, name: item.name, key: `observed/${item.id}`, mach: item.state, topic: `Channel seen running · ${item.state}${detail}`, unavailable: liveMessagesReason, dividerBefore: defs.length > 0 && !defs.some(def => def.dividerBefore) })
        history[id] = card.hist
      }
    } else {
      const id = 'observed:unavailable'
      const reason = data.channels.reason || 'the channels seen running could not be read'
      const card = liveCard(id, 'projection', 'channels seen running', 'The channels seen running could not be read.', reason)
      cards.push(card, projectionDetailCard(card, 'Channels seen running', reason))
      defs.push({ id, name: 'channels seen running', key: 'observed', mach: 'unavailable', topic: 'The channels seen running could not be read.', unavailable: reason, dividerBefore: defs.length > 0 })
      history[id] = []
    }

    W.convs = new Map(cards.map(card => [card.id, card]))
    W.stack = cards.filter(card => !card.id.endsWith(':source')).map(card => wbLeaf(card.id))
    W.open.clear()
    channelDefs = defs
    state.active = channelDefs[0].id
    state.unread.clear()
    root.dataset.projectionState = liveMessagesReason ? 'partial-unavailable' : 'ready'
    if (liveMessagesReason) root.dataset.projectionUnavailable = 'messages'
    else delete root.dataset.projectionUnavailable
    root.querySelector('.head-live').lastChild.textContent = liveMessagesReason ? 'partial' : 'live'
    headMeta.textContent = `live comms · ${services.length} on record · ${observed ? observed.length : 'unreadable'} seen running`
    countEl.textContent = String(services.length)
    headCount.childNodes[1].textContent = ' declared'
    wtMeta.textContent = `live comms · ${services.length + (observed?.length || 0)} separate records`
    const mcpLine = data.mcp.ok
      ? `Tool links (MCP) · ${data.mcp.value.live.length} live · ${data.mcp.value.dead.length} dead`
      : `Tool links (MCP) could not be read — ${data.mcp.reason || 'no reason given'}`
    setProjectionFoot([
      `${services.length} services on record`,
      observed ? `${observed.length} channels seen running` : `channels seen running could not be read — ${data.channels.reason}`,
      mcpLine,
      liveMessagesReason ? `messages could not be read — ${liveMessagesReason}` : 'messages are being read',
    ])
    boxEls.clear()
    renderRail()
    railItems.get(state.active)?.classList.add('active')
    headName.textContent = channelDefs[0]?.name || ''
    renderLog(state.active)
    renderBoard()
  }

  /* FLIP the whole board through a structural change: measure every box,
     mutate the tree, re-render, then glide each box from where it was. */
  function flipBoard(mutate) {
    if (reduced()) { mutate(); renderBoard(); return }
    const first = new Map()
    for (const [cid, b] of boxEls) if (b.isConnected) first.set(cid, b.getBoundingClientRect())
    pane.classList.add('no-trans')
    mutate()
    renderBoard()
    for (const [cid, b] of boxEls) {
      if (!b.isConnected) continue
      const l = b.getBoundingClientRect()
      const f = first.get(cid)
      if (!f) {
        b.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: 340, easing: EASE })
        continue
      }
      const dx = f.left - l.left, dy = f.top - l.top
      const sx = f.width / Math.max(1, l.width), sy = f.height / Math.max(1, l.height)
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.02 && Math.abs(sy - 1) < 0.02) continue
      b.animate(
        [{ transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
         { transformOrigin: '0 0', transform: 'none' }],
        { duration: 460, easing: EASE },
      )
    }
    requestAnimationFrame(() => pane.classList.remove('no-trans'))
  }

  /* ----- branches: child conversation slides in beside its parent ----- */
  function toggleBranch(cid) {
    const d = W.convs.get(cid)
    if (!d.child) return
    const open = findBranchByParent(cid)
    if (open) {
      flipBoard(() => replaceNode(open, open.ch[0]))
      return
    }
    const L = findLeafByConv(cid)
    if (!L) return
    flipBoard(() => replaceNode(L, { t: 'split', dir: 'row', branch: true, ch: [L, wbLeaf(d.child)] }))
  }

  /* ----- drag-to-split tiling ----- */
  let drag = null
  function onBoxPointerDown(e, box) {
    if (e.button !== 0 || drag) return
    if (e.target.closest('.wb-btn, .chat-close, .chat-log, .chat-input, input, .wb-seg')) return
    const cid = box.dataset.conv
    const sx = e.clientX, sy = e.clientY
    let started = false
    let denied = false
    const move = (ev) => {
      if (started) { dragMove(ev); return }
      if (denied || Math.hypot(ev.clientX - sx, ev.clientY - sy) < 7) return
      const node = findDragNode(cid)
      if (!node) { denied = true; return }
      beginDrag(cid, node, box, ev)
      started = true
    }
    const up = (ev) => {
      if (started) endDrag(ev)
      else if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 7 &&
               !box.classList.contains('as-chat')) openChatBox(cid)
      cleanup()
    }
    const cancel = () => { if (started) abortDrag(); cleanup() }
    function cleanup() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      dragTeardown = null
    }
    dragTeardown = () => { if (started) abortDrag(); cleanup() }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }

  function beginDrag(cid, node, box, ev) {
    const ghost = box.cloneNode(true)
    ghost.querySelector('.chat')?.remove()
    ghost.classList.remove('as-chat', 'pulse', 'dominant', 'lead', 'stack-leaf', 'in-split', 'branch-child', 'can-restack')
    ghost.classList.add('wb-ghost')
    const r = box.getBoundingClientRect()
    ghost.style.width = Math.min(r.width, 320) + 'px'
    ghost.style.height = Math.min(r.height, 180) + 'px'
    document.body.appendChild(ghost)
    const srcEl = node.t === 'leaf' ? box : node._el
    srcEl?.classList.add('drag-src')
    document.body.classList.add('wb-dragging')
    drag = { cid, node, box, srcEl, ghost, pending: null, lastDrop: null }
    dragMove(ev)
  }

  function dragMove(ev) {
    ev.preventDefault()
    const g = drag.ghost
    g.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 12}px)`
    if (drag.lastDrop) { drag.lastDrop.classList.remove('show'); drag.lastDrop = null }
    stackDrop.classList.remove('show')
    drag.pending = null

    const under = document.elementFromPoint(ev.clientX, ev.clientY)
    const tbox = under?.closest('.wb-box')
    if (tbox && tbox !== drag.box && tbox.closest('.watch-pane')) {
      const tnode = dropTargetNode(tbox.dataset.conv)
      if (tnode && tnode !== drag.node &&
          !subtreeHas(drag.node, tnode) && !subtreeHas(tnode, drag.node)) {
        const r = tbox.getBoundingClientRect()
        const dx = (ev.clientX - (r.left + r.width / 2)) / r.width
        const dy = (ev.clientY - (r.top + r.height / 2)) / r.height
        const half = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom')
        const overlay = tbox.querySelector('.wb-drop')
        overlay.dataset.half = half
        overlay.classList.add('show')
        drag.lastDrop = overlay
        drag.pending = { type: 'split', tnode, half }
        return
      }
    }
    if (under?.closest('.watch-pane')) {
      stackDrop.classList.add('show')
      drag.pending = { type: 'stack' }
    }
  }

  function endDrag() {
    const p = drag.pending
    settleGhost()
    if (p) {
      const node = drag.node
      flipBoard(() => {
        detach(node)
        if (p.type === 'split') {
          const dir = (p.half === 'left' || p.half === 'right') ? 'row' : 'col'
          const s = {
            t: 'split', dir,
            ch: (p.half === 'left' || p.half === 'top') ? [node, p.tnode] : [p.tnode, node],
          }
          replaceNode(p.tnode, s)
        } else {
          W.stack.push(node)
        }
      })
    }
    drag = null
  }
  function abortDrag() { settleGhost(); drag = null }
  function settleGhost() {
    const { ghost, srcEl, lastDrop } = drag
    lastDrop?.classList.remove('show')
    stackDrop.classList.remove('show')
    srcEl?.classList.remove('drag-src')
    document.body.classList.remove('wb-dragging')
    if (reduced()) { ghost.remove(); return }
    ghost.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 150, easing: 'ease-out' })
      .finished.then(() => ghost.remove()).catch(() => ghost.remove())
  }

  /* ----- live conversation stream: pulse + auto-follow ----- */
  function genLine(d) {
    if (Math.random() < 0.8) d.side = d.side === 'a' ? 'b' : 'a'
    const s = d.side === 'a' ? d.a : d.b
    return { at: Date.now(), s, t: bagDraw(d.bags, d.side, d.lines[d.side]) }
  }
  function pickConv() {
    const pool = []
    for (const d of W.convs.values()) {
      const visible = boxEls.get(d.id)?.isConnected
      pool.push([d, visible ? 3 + impOf(d) : 1])
    }
    const total = pool.reduce((n, [, w]) => n + w, 0)
    let r = Math.random() * total
    for (const [d, w] of pool) { r -= w; if (r < 0) return d }
    return pool[0][0]
  }
  function watchArrive() {
    const d = pickConv()
    const line = genLine(d)
    d.hist.push(line)
    if (d.hist.length > 80) d.hist.splice(0, d.hist.length - 80)
    const box = boxEls.get(d.id)
    if (!box?.isConnected) return
    const pv = box.querySelector('.chip-preview')
    pv.appendChild(previewLineEl(d, line))
    while (pv.children.length > 34) pv.firstElementChild.remove()
    if (!box._hover && box._pvFollow) pv.scrollTop = pv.scrollHeight
    if (box.classList.contains('as-chat')) {
      const log = box.querySelector('.chat-log')
      if (log) {
        log.appendChild(chatMsgEl(d, line))
        while (log.children.length > 40) log.firstElementChild.remove()
        if (!box._hover && box._chatFollow) log.scrollTop = log.scrollHeight
      }
    }
    oneShot(box, 'pulse')
    beatLive('watch')
  }
  let watchT = 0
  const watchSchedule = () => {
    watchT = setTimeout(() => { watchArrive(); watchSchedule() }, 3600 + Math.random() * 5200)
    timers.push(watchT)
  }
  if (!liveMode) watchSchedule()

  /* ----- mode + size controls ----- */
  const modeBtns = [...root.querySelectorAll('.mode-seg button')]
  const sizeBtns = [...root.querySelectorAll('.size-seg button')]
  /* shared seg indicators (styles.css .seg / attachSeg). The size-seg is
     display:none in channels mode; the helper's ResizeObserver re-places its
     indicator on the frame it gets a box back. */
  root.querySelectorAll('.wb-seg').forEach(g => unsubs.push(attachSeg(g)))
  function setMode(m) {
    W.mode = m
    root.dataset.mode = m
    modeBtns.forEach(b => {
      const on = b.dataset.wmode === m
      b.classList.toggle('on', on)
      b.setAttribute('aria-pressed', String(on))   // which one is chosen is state, not paint
    })
    /* The sheet is display:none in watch mode, so the log has no height and
       renderLog's anchor scroll is a no-op — the view would open at the OLDEST
       message with the chip suppressed, then yank to the bottom on the next
       packet. Re-anchor on the frame the sheet actually has a box. */
    if (m === 'channels') {
      requestAnimationFrame(() => {
        if (state.pinnedToBottom) logEl.scrollTop = logEl.scrollHeight
        else updateChip()
      })
    }
  }
  function setSize(s) {
    W.size = s
    pane.dataset.size = s
    sizeBtns.forEach(b => {
      const on = b.dataset.size === s
      b.classList.toggle('on', on)
      b.setAttribute('aria-pressed', String(on))
    })
    /* A size step changes every pane's height, and a followed pane that was
       pinned to its newest line ended up showing a hard mid-line cut at its
       BOTTOM until the next arrival happened to re-pin it (final-wave
       finding). Re-pin followed panes the frame after the new heights land —
       the same _pvFollow/_chatFollow contract arrivals honour, invoked from
       the one mutation that was skipping it. A reader-scrolled pane
       (follow=false) is left exactly where they put it. */
    const repin = () => {
      pane.querySelectorAll('.wb-box').forEach((box) => {
        const pv = box.querySelector('.chip-preview')
        if (box._pvFollow && pv) pv.scrollTop = pv.scrollHeight
        const log = box.querySelector('.chat-log')
        if (box._chatFollow && log) log.scrollTop = log.scrollHeight
      })
    }
    /* twice, deliberately: the pane heights TRANSITION (0.45s), so the
       frame-after pin measures a mid-animation height — fine when growing
       (the gap only closes), wrong when shrinking (the gap keeps opening
       after the pin; measured 72-124px adrift on the S step). The second
       pass lands after the transition settles. */
    onNextFrame(repin)
    clearTimeout(setSize._repinTimer)
    setSize._repinTimer = setTimeout(repin, 520)
  }
  modeBtns.forEach(b => b.addEventListener('click', () => setMode(b.dataset.wmode)))
  sizeBtns.forEach(b => b.addEventListener('click', () => setSize(b.dataset.size)))
  setMode(W.mode)      // initial paint goes through the same path, aria included
  setSize(W.size)

  renderBoard()

  /* ---- initial channel ---- */
  railItems.get(state.active)?.classList.add('active')
  headName.textContent = defOf(state.active)?.name || ''
  renderLog(state.active)
  if (liveMode) {
    fetchOps().then(applyLiveProjection).catch((err) => {
      applyLiveProjection({ ok: false, reason: `ops projection request failed: ${err?.message || err}` })
    })
  }

  return {
    el: root,
    destroy() {
      destroyed = true
      dragTeardown?.()
      timers.forEach(clearTimeout)
      clearTimeout(setSize._repinTimer)
      unsubs.forEach(fn => fn())
    },
  }
}
