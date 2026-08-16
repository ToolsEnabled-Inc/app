/* Puts the eclipse corona on the page, and keeps CSS in charge of colour.
   =====================================================================

   The shader owns the SHAPE of the light. home.css still owns everything else —
   which hue each state is on each sheet, the `--glow` slider, the
   `--cres-halo-o` dose, the 1.4s transition between states, and reduced motion.
   That division is deliberate: those hues carry measured WCAG ratios in their
   comments and are an accessibility requirement, so they must not migrate into
   a shader constant where nobody will find them.

   The trick that keeps CSS authoritative over the transition is the probe: a
   hidden element carrying `background-color: var(--load-col)` with the real
   transition on it. During a state change the browser interpolates it, this
   file samples the interpolated value each frame and redraws. So the timing
   curve, the duration and the per-theme colours are still stated once, in CSS,
   and there is no second implementation of them here to drift.

   If WebGL2 is unavailable or the context is lost, this falls back to the CPU
   field renderer (crescent-field.js), which is deterministic and unit-tested.
   The fallback markup is the older three-masked-layer arrangement, which is why
   those rules are still in home.css.
*/

import { createCorona, cssColorToLinear } from './corona-gl.js'
import { crescentSpec } from './crescent-field.js'
import { crescentMasks } from './crescent-render.js'

const rad = (d) => (d * Math.PI) / 180

/* Shape of the corona, in units of the rim radius, arrived at by rendering and
   looking rather than by theory — the owner reviewed these. `h0` sets the clean
   sliver of sheet between the rim and the light, which is what stops the pair
   reading as one heavy shadowed edge; `h1` is the bright band; `h2` the outer
   haze. The angular limits come from measuring the owner's drawing: the glow's
   half-extent there is 53-56 degrees. */
export const SHAPE = {
  h0: 0.012, h1: 0.026, h2: 0.090,
  w1: 0.72, w2: 0.28,
  a1i: rad(25), a1x: rad(50),
  a2i: rad(30), a2x: rad(60),
}
export const BASE_GAIN = 2.4

const num = (styles, name, fallback) => {
  const v = parseFloat(styles.getPropertyValue(name))
  return Number.isFinite(v) ? v : fallback
}

/**
 * Mount the crescent into `root` (the .uring element) and return a controller.
 * Returns { el, redraw, destroy, mode } where mode is 'gl' or 'cpu'.
 */
export function mountCrescent(root, size) {
  const spec = crescentSpec(size)
  const rim = spec.r
  const centre = size / 2
  const boxHalf = Math.ceil(rim * 1.72)
  const box = boxHalf * 2
  const dpr = Math.max(1, window.devicePixelRatio || 1)

  const canvas = document.createElement('canvas')
  canvas.className = 'cres-gl'
  canvas.setAttribute('aria-hidden', 'true')
  canvas.width = Math.round(box * dpr)
  canvas.height = Math.round(box * dpr)
  canvas.style.width = `${box}px`
  canvas.style.height = `${box}px`
  canvas.style.left = `${centre - boxHalf}px`
  canvas.style.top = `${centre - boxHalf}px`

  /* The colour carrier. Hidden, but a real element so the CSS transition on
     --load-col actually runs and can be sampled mid-flight. */
  const probe = document.createElement('i')
  probe.className = 'cres-probe'
  probe.setAttribute('aria-hidden', 'true')

  root.insertBefore(canvas, root.firstChild)
  root.insertBefore(probe, root.firstChild)

  const corona = createCorona(canvas)

  if (!corona) {
    /* No GL. Drop the canvas, put the old masked layers back, and let the
       existing CSS drive them exactly as before. */
    canvas.remove()
    const layers = document.createElement('div')
    layers.className = 'cres-layers'
    layers.setAttribute('aria-hidden', 'true')
    layers.style.left = `${spec.box.left}px`
    layers.style.top = `${spec.box.top}px`
    layers.style.width = `${spec.box.width}px`
    layers.style.height = `${spec.box.height}px`
    layers.innerHTML = '<div class="cres-haze"></div><div class="cres-halo"></div><div class="cres-core"></div>'
    root.insertBefore(layers, root.firstChild)
    crescentMasks(size).then(({ urls }) => {
      for (const key of ['haze', 'halo', 'core']) {
        const node = layers.querySelector(`.cres-${key}`)
        if (node && urls[key]) {
          node.style.maskImage = `url(${urls[key]})`
          node.style.webkitMaskImage = `url(${urls[key]})`
        }
      }
      layers.dataset.ready = '1'
    }).catch(() => { /* leave it dark rather than paint three rectangles */ })
    return { el: layers, mode: 'cpu', redraw() {}, destroy() { layers.remove(); probe.remove() } }
  }

  let raf = 0
  let breathing = false
  const start = performance.now()

  function paint(now) {
    const cs = getComputedStyle(root)
    const colour = getComputedStyle(probe).backgroundColor
    const glow = num(cs, '--glow', 1)
    const dose = num(cs, '--cres-halo-o', 0.85)
    const sheetGain = num(cs, '--cres-gain', 1)
    const stateGain = num(cs, '--cres-state-gain', 1)
    const failure = root.dataset.load === 'peak' || root.dataset.load === 'failure'
    const quiet = document.body.classList.contains('reduce-motion')
    const breath = failure && !quiet ? 1 : 0

    corona.draw({
      scale: dpr,
      centre: [boxHalf, boxHalf],
      rim,
      unit: rim,
      color: cssColorToLinear(colour),
      gain: BASE_GAIN * glow * sheetGain * stateGain,
      hazeDose: dose,
      shape: SHAPE,
      time: ((now || performance.now()) - start) / 1000,
      breath,
    })
    return breath > 0
  }

  function loop(now) {
    const wants = paint(now)
    raf = wants ? requestAnimationFrame(loop) : 0
    breathing = !!raf
  }

  function redraw() {
    if (corona.lost) return
    /* An idle page must not burn CPU, so there is no standing animation frame.
       One paint on demand, and a loop only while the failure state is breathing
       and motion is allowed. */
    if (!breathing) { const wants = paint(); if (wants) { breathing = true; raf = requestAnimationFrame(loop) } }
  }

  /* A state change re-tints over 1.4s in CSS; sample it each frame until the
     transition finishes. */
  probe.addEventListener('transitionstart', () => {
    if (!breathing && !raf) {
      const tick = (now) => {
        paint(now)
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }
  })
  probe.addEventListener('transitionend', () => {
    if (raf && !breathing) { cancelAnimationFrame(raf); raf = 0 }
    redraw()
  })

  /* The stored colour is only readable once styles have resolved. */
  requestAnimationFrame(() => redraw())

  return {
    el: canvas,
    mode: 'gl',
    redraw,
    destroy() {
      if (raf) cancelAnimationFrame(raf)
      corona.destroy()
      canvas.remove()
      probe.remove()
    },
  }
}
