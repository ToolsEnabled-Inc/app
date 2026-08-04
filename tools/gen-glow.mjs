/**
 * Glow token generator — run with `node tools/gen-glow.mjs`, writes src/glow.css.
 *
 * Why this exists rather than hand-written rgba(): a convincing glow is a
 * physical falloff, not one blurred copy of a colour. Real light loses
 * intensity roughly with the square of distance while *gaining* apparent
 * lightness and losing saturation toward the source, so a premium glow is
 * several stacked layers whose radius grows geometrically, whose alpha
 * decays faster than linearly, and whose colour walks toward white as it
 * tightens. Doing that in sRGB muddies the hue (sRGB interpolation drifts
 * through grey); culori lets each step be placed in OKLCH, which is
 * perceptually uniform, so every role hue keeps its identity at every
 * intensity and the ramps are consistent with each other.
 *
 * Output is static CSS custom properties — culori stays a devDependency and
 * never ships to the browser.
 */
import { formatRgb, oklch, converter } from 'culori'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const toOklch = converter('oklch')
const here = dirname(fileURLToPath(import.meta.url))

// the site's role palette (validated earlier for CVD separation + contrast)
const ROLES = {
  coordinator: '#00a9d8',
  helper: '#f57b00',
  shadow: '#00bd8a',
  manager: '#3e63f0',
  default: '#dba400',
  accent: '#21b7e4',      // the shared interactive accent
}

/** One layer of the falloff. `t` is 0 (core) → 1 (outermost halo). */
function layer(baseHex, t, { spread, alpha }) {
  const c = toOklch(baseHex)
  // toward the core the light reads brighter and less saturated (it is
  // approaching the emitter); outward it settles back to the true hue
  const L = Math.min(0.98, c.l + (1 - t) * 0.22)
  const C = Math.max(0.02, c.c * (0.62 + t * 0.38))
  const col = oklch({ mode: 'oklch', l: L, c: C, h: c.h })
  return { blur: spread, alpha, color: formatRgb({ ...col, alpha: 1 }) }
}

/** A full glow: geometric radii, super-linear alpha decay. */
function glow(baseHex, { steps = 3, base = 6, growth = 2.6, peak = 0.5 } = {}) {
  const out = []
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1)
    const spread = Math.round(base * Math.pow(growth, i))
    // inverse-square-ish: each ring is markedly fainter than the last
    const alpha = +(peak / Math.pow(1.9, i)).toFixed(3)
    out.push(layer(baseHex, t, { spread, alpha }))
  }
  return out
}

const css = (layers, { inset = false } = {}) =>
  layers
    .map(l => `${inset ? 'inset ' : ''}0 0 ${l.blur}px ${l.color.replace('rgb(', 'rgba(').replace(')', `, ${l.alpha})`)}`)
    .join(',\n    ')

const blocks = []
for (const [name, hex] of Object.entries(ROLES)) {
  // three intensities, so a surface can pick how loud it is allowed to be
  const soft = glow(hex, { steps: 3, base: 5, growth: 2.4, peak: 0.30 })
  const mid = glow(hex, { steps: 3, base: 6, growth: 2.6, peak: 0.46 })
  const loud = glow(hex, { steps: 4, base: 6, growth: 2.5, peak: 0.62 })
  blocks.push(
    `  --glow-${name}-soft:\n    ${css(soft)};\n` +
    `  --glow-${name}:\n    ${css(mid)};\n` +
    `  --glow-${name}-loud:\n    ${css(loud)};`,
  )
}

const header = `/* ============================================================
   GENERATED — do not edit by hand.
   Source: tools/gen-glow.mjs   Regenerate: node tools/gen-glow.mjs

   Perceptual glow ramps (OKLCH, via culori). Each token is a stack of
   layers with geometrically growing radii and super-linear alpha decay —
   physical light falloff rather than one blurred copy of a colour — and
   each layer's colour is placed in OKLCH so the hue holds at every
   intensity instead of drifting toward grey through sRGB.

   Three intensities per hue: -soft (a whisper, safe at rest on a small
   accent), default (a deliberate highlight), -loud (a momentary event).
   Every use is still gated by --glow so the Settings slider governs it.
   ============================================================ */
:root {
`

writeFileSync(join(here, '..', 'src', 'glow.css'), header + blocks.join('\n') + '\n}\n')
console.log(`wrote src/glow.css — ${Object.keys(ROLES).length} hues x 3 intensities`)
