// ECharts theme bridge — a SNAPSHOT of the page's computed design tokens.
//
// WHY a snapshot instead of `var(--…)` strings: the SVG renderer resolves
// every colour into inline attributes and <linearGradient> stop definitions,
// where CSS custom properties are never evaluated — a var() string would
// paint black. So the tokens are read via getComputedStyle once per theme and
// handed to the option builders as literals. On a theme flip the metrics view
// rebuilds this snapshot and re-issues full options: one code path for boot,
// filter, sim drift AND theme, always animated. (v6 does ship setTheme(), but
// re-optioning is the same merge without leaning on the younger API — and we
// would still need this snapshot to build the theme object anyway.)
//
// GOTCHA (verified in this repo): --prov-* and --area-a* are scoped to
// `.metrics` in metrics.css, NOT :root — read off the mounted .metrics
// element or they come back empty strings.

const PROV_IDS = ['codex', 'claude', 'gemini', 'local']

const read = (cs, name, fallback) => {
  const v = cs.getPropertyValue(name).trim()
  return v || fallback
}

export function buildTheme(metricsEl) {
  const rootCS = getComputedStyle(document.documentElement)
  const scopeCS = getComputedStyle(metricsEl)

  const heat = []
  for (let i = 0; i < 6; i++) heat.push(read(rootCS, `--heat-${i}`, '#888888'))

  const prov = {}
  for (const id of PROV_IDS) {
    prov[id] = read(scopeCS, `--prov-${id}`, read(rootCS, '--ink-3', '#64727f'))
  }

  // stacked-area top alphas, band 0 (baseline) → band 3; the per-theme
  // re-steps in metrics.css keep working because they are read, not assumed
  const areaAlpha = []
  for (let i = 0; i < 4; i++) {
    areaAlpha.push(parseFloat(read(scopeCS, `--area-a${i}`, '0.11')) || 0.11)
  }

  return {
    ink: read(rootCS, '--ink', '#0e1726'),
    ink2: read(rootCS, '--ink-2', '#4f5f70'),
    ink25: read(rootCS, '--ink-25', '#5a6876'),
    ink3: read(rootCS, '--ink-3', '#64727f'),
    grid: read(rootCS, '--chart-grid', 'rgba(14,23,38,0.07)'),
    cross: read(rootCS, '--chart-cross', 'rgba(14,23,38,0.24)'),
    track: read(rootCS, '--chart-track', 'rgba(14,23,38,0.05)'),
    good: read(rootCS, '--s-good', '#0a6d3c'),
    warn: read(rootCS, '--s-warn', '#8f5902'),
    serious: read(rootCS, '--s-serious', '#b23811'),
    bg: read(rootCS, '--bg', '#f7f8fa'),
    sheet: read(rootCS, '--sheet', '#ffffff'),
    heat,
    prov,
    areaAlpha,
    // the resolved stack, so chart text measures with the face it renders in
    font: getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif',
  }
}

/** Hex → rgba() at the given alpha. Non-hex tokens pass through untouched
 *  (they are only ever fully-opaque fills where alpha 1 is meant). */
export function withAlpha(color, a) {
  if (!color.startsWith('#')) return color
  let h = color.slice(1)
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}
