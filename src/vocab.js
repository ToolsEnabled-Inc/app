// Vocabulary for the simulated fleet. The operational language is SITE data,
// not product data — the set that used to sit here was lifted from the working
// system this product was built on and named that system's own internals, so
// it now comes from the fleet profile (src/fleet-profile.js) and is replaced
// wholesale when a different profile is loaded.
//
// The SUBSYSTEMS list that used to live here was deleted rather than
// rewritten: nothing imported it, and its only content was the component
// inventory of that one fleet.

import { FLEET } from './fleet-profile.js'

export const TASKS = FLEET.tasks
export const FEED = FLEET.feed
export const CHAT = FLEET.chat
export const CHAT_REPLIES = FLEET.chatReplies
export const CHAT_CONTEXT_REPLIES = FLEET.chatContextReplies

/* ROLE IDENTITY — the JS half of the palette. `hex` MUST equal the matching
   --c-* token in src/styles.css, which is where the palette is derived and
   documented (Carbon-style luminance row at oklch L 0.595, on the site's own
   hue angles; every figure and every dE2000 is written out there).
   `color` is for CSS contexts that can take a var(); `hex` is for the ones
   that cannot — SVG stroke attributes, ECharts option literals, and the
   inline styles the views write when a view is BUILT.
   That last case is why there is exactly one hex per role and no per-theme
   variant: only the metrics view re-renders on a theme flip, so a
   theme-dependent hex would leave the computers legend, the comms name rail
   and the graph's links holding a stale colour. Themes adapt in the CSS
   recipes instead.
   `glow` is the light sibling — glow layers and the light stop of the
   uptime ring's gradient only, never text. */
export const ROLES = {
  coordinator: { label: 'Coordinator', color: 'var(--c-coordinator)', hex: '#008dab', glow: '#45d6ff' },
  helper: { label: "Coordinator's Helper", color: 'var(--c-helper)', hex: '#c85900', glow: '#ffab4d' },
  shadow: { label: 'Shadow Manager', color: 'var(--c-shadow)', hex: '#00956c', glow: '#35eab7' },
  manager: { label: 'Manager', color: 'var(--c-manager)', hex: '#3e63f0', glow: '#7d9bff' },
  default: { label: 'Default', color: 'var(--c-default)', hex: '#9d7900', glow: '#ffd84d' },
  spawned: { label: 'Agent spawned', color: 'var(--c-spawned)', hex: '#697077', glow: '#a2a9b0' },
}

/* Account pools are the operator's own accounts, so the set comes from the
   profile too. POOLS.color / .glow are the ROLE hexes verbatim, and
   src/views/metrics.js deliberately reads NEITHER — pools take one neutral
   and providers take their own --prov-* categorical set, because a pool card
   and a role dot share a scroll and colour has to follow one entity. They are
   kept in step with ROLES above only so that stated invariant stays literally
   true for whoever checks it next.

   The pool IDS are join keys read as literal strings by src/views/metrics.js;
   see the comment on SAMPLE_POOLS in src/fleet-profile.js for why they cannot
   be renamed from the profile alone. */
export const POOLS = FLEET.pools

export const PROVIDERS = [
  { id: 'codex', label: 'Codex', color: '#008dab' },
  { id: 'claude', label: 'Claude', color: '#c85900' },
  { id: 'gemini', label: 'Gemini', color: '#3e63f0' },
  { id: 'local', label: 'Local', color: '#00956c' },
]

export function pick(arr, rng = Math.random) {
  return arr[Math.floor(rng() * arr.length)]
}
