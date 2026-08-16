/* The home hero's eclipse corona, rendered on the GPU.
   ====================================================

   The owner's drawing (Desktop\8.14\projects\webimages\IMG_7100.jpeg, labelled
   "Pg 1 /home") is a plain circle with the uptime clock inside it and a green
   marker glow hugging its left limb. His words for it: "essentially a circle,
   with an eclipse style glow ... and the timer in the center", green for clear,
   yellow for blockers, red for hard failure.

   ECLIPSE is the operative word and it is what this file is built around. A
   corona is brightest AT THE LIMB and falls away outward from it. That is the
   one structural difference from what shipped before: the old render built the
   glow from three arcs concentric with the rim and then translated the whole
   group 11px left, so the light floated beside the circle with a gap at nine
   o'clock and crossed back over the rim near its ends. Here the light is
   anchored to the limb everywhere along the lit arc, decays outward, and is cut
   off sharply inward so it never wanders under the clock.

   Two independent measurements of the drawing (IMG_7100 and IMG_7104, different
   exposure and about 2x different scale) put the glow's angular half-extent at
   53-56 degrees, which is where the lobe constants below come from. Those same
   measurements CANNOT settle whether the drawing has a lateral offset — the
   fitted centres differ by 2.8% and 4.6% of the radius, and the old code's
   offset was 4.7% of the radius, so the effect is the size of the error bar.
   Limb-anchoring is a design decision taken from the word "eclipse", not a
   measurement. It is recorded that way on purpose.

   Why WebGL2 and not a library: WebGPU is unavailable in this Electron (probed,
   navigator.gpu is undefined), and the bloom libraries — three.js
   UnrealBloomPass, pmndrs postprocessing, pixi-filters AdvancedBloom — all
   solve a different problem, blurring a rendered framebuffer, at 400-600kB in
   an app with seven runtime dependencies and licence-notice gates on an
   orphan-cut publication. A corona has a closed form; blurring a proxy of one
   is strictly worse and much larger.

   Probed on this machine: WebGL2 via ANGLE/D3D11 on real hardware,
   EXT_color_buffer_float and EXT_float_blend present, display-p3 available on
   the drawing buffer, and — the one that mattered, because the packaged QA
   captures offscreen — GL content composites correctly into
   webContents.capturePage() with webPreferences.offscreen.
*/

const VERT = `#version 300 es
/* One oversized triangle rather than a quad: no diagonal seam, three vertices
   instead of six, and no attribute buffers at all. */
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2  uRes;      // drawing buffer size, device px
uniform float uScale;    // device px per CSS px
uniform vec2  uCentre;   // ring centre, CSS px from the box origin
uniform float uRim;      // rim radius, CSS px
uniform vec3  uColor;    // hue, LINEAR light
uniform float uGain;     // overall intensity: --glow * --cres-halo-o * base
uniform float uTime;     // seconds
uniform float uBreath;   // 0..1, only non-zero at hard failure and with motion allowed
uniform float uUnit;     // CSS px per "unit" — scales the corona with the ring
uniform float uHazeDose; // --cres-halo-o, which the black sheet doses down

const float PI = 3.141592653589793;

/* Radial shape, measured from the limb, in units of the rim radius.

   The first attempt put the maximum ON the limb and it was wrong on paper: the
   light merged with the 2px rim stroke and the pair read as one heavy shadowed
   edge, a drop shadow rather than a glow. Two of the three sheets are near-white
   and every one of these hues is darker than its sheet, so on paper this mark is
   always going to be ink — and broad dark ink against the circle's own line
   reads as shadow.

   An eclipse does not look like that either. The limb is dark; the corona peaks
   just OUTSIDE it and streams away. So the profile now RISES from nothing at the
   rim (H0), peaks a few pixels clear of it, and then decays over two scales — a
   narrow bright band that reads as the luminous edge, over a much wider faint
   haze that carries the light outward. The rim stays a clean drawn line with a
   sliver of sheet either side of it, which is what lets the glow read as light
   beside the circle rather than as weight hanging off it. */
uniform float H0;   // rise off the limb
uniform float H1;   // bright band
uniform float H2;   // outer haze
uniform float W1;
uniform float W2;

/* Angular extent. The bright corona is the tighter lobe and the haze reaches
   further, which is what the old design's three separate apertures (41, 54 and
   62 degrees) were encoding discretely. */
uniform float A1_IN;
uniform float A1_MX;
uniform float A2_IN;
uniform float A2_MX;  // 72 deg

float smootherstep(float t) {
  t = clamp(t, 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float lobe(float th, float inner, float outer) {
  return 1.0 - smootherstep((th - inner) / (outer - inner));
}

void main() {
  vec2 p = (gl_FragCoord.xy / uScale) - uCentre;
  p.y = -p.y;                       // gl_FragCoord is y-up; the page is y-down
  float rho = length(p);
  float th  = atan(abs(p.y), -p.x); // 0 on the nine o'clock bisector

  float d = (rho - uRim) / uUnit;   // distance from the limb, scale-free

  /* Nothing inside the limb at all. The disc is transparent here and the clock
     lives in it, so any inward leak would sit behind the numerals. */
  if (d < 0.0) { outColor = vec4(0.0); return; }

  float rise  = 1.0 - exp(-d / H0);
  float band1 = rise * exp(-d / H1) * lobe(th, A1_IN, A1_MX);
  float band2 = rise * exp(-d / H2) * lobe(th, A2_IN, A2_MX) * uHazeDose;

  float breath = 1.0 + uBreath * 0.14 * sin(uTime * 2.4);
  float I = (W1 * band1 + W2 * band2) * uGain * breath;

  /* A soft knee rather than a hard clamp. Two of the three themes are near-white
     paper, where light does not "blow out" — it reads as ink — so the curve has
     to compress the top without lifting the whole field toward white. */
  I = I / (1.0 + 0.55 * I);

  /* Interleaved Gradient Noise (Jimenez), one 8-bit step, centred. A ramp this
     wide and this shallow bands visibly on an 8-bit surface otherwise, and it
     is the artefact stacked translucent layers could never be rid of. */
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  I = clamp(I + (n - 0.5) / 255.0, 0.0, 1.0);

  /* Premultiplied, which is what the compositor expects by default and what
     lets the black sheet use plus-lighter to read as emitted light while the
     paper sheets composite it as ink. */
  outColor = vec4(uColor * I, I);
}`

function compile(gl, type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`corona shader: ${log}`)
  }
  return sh
}

/** sRGB hex or rgb() string -> linear-light RGB. The per-theme hue table in
 *  home.css stays the single source of colour; this only decodes it. */
export function cssColorToLinear(str) {
  let r = 0, g = 0, b = 0
  const m = String(str).match(/rgba?\(([^)]+)\)/)
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    ;[r, g, b] = parts
  } else {
    const h = String(str).trim().replace('#', '')
    if (h.length === 6) {
      r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16)
    }
  }
  const lin = (c) => {
    c /= 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return [lin(r), lin(g), lin(b)]
}

/**
 * Attach a corona renderer to a canvas.
 *
 * Returns null — deliberately, rather than throwing — when WebGL2 is
 * unavailable. The caller falls back to the CPU field renderer, which already
 * exists, is unit-tested and is deterministic.
 */
export function createCorona(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
    /* The corona is redrawn only when something changes, so the buffer has to
       survive between frames rather than being cleared by the compositor. */
    preserveDrawingBuffer: true,
  })
  if (!gl) return null

  let program
  try {
    program = gl.createProgram()
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`corona link: ${gl.getProgramInfoLog(program)}`)
    }
  } catch (err) {
    console.warn(err)
    return null
  }

  const u = {}
  for (const name of ['uRes', 'uScale', 'uCentre', 'uRim', 'uColor', 'uGain', 'uTime', 'uBreath', 'uUnit', 'uHazeDose', 'H0','H1','H2','W1','W2','A1_IN','A1_MX','A2_IN','A2_MX']) {
    u[name] = gl.getUniformLocation(program, name)
  }
  gl.useProgram(program)
  gl.disable(gl.DEPTH_TEST)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

  let lost = false
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true })

  return {
    get lost() { return lost },

    /** state: { scale, centre:[x,y], rim, unit, color:[r,g,b] linear, gain, time, breath } */
    draw(s) {
      if (lost) return false
      const w = canvas.width, h = canvas.height
      gl.viewport(0, 0, w, h)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(program)
      gl.uniform2f(u.uRes, w, h)
      gl.uniform1f(u.uScale, s.scale)
      gl.uniform2f(u.uCentre, s.centre[0], s.centre[1])
      gl.uniform1f(u.uRim, s.rim)
      gl.uniform1f(u.uUnit, s.unit)
      gl.uniform3f(u.uColor, s.color[0], s.color[1], s.color[2])
      gl.uniform1f(u.uGain, s.gain)
      gl.uniform1f(u.uTime, s.time || 0)
      gl.uniform1f(u.uBreath, s.breath || 0)
      gl.uniform1f(u.uHazeDose, s.hazeDose == null ? 0.85 : s.hazeDose)
      const sh = s.shape
      gl.uniform1f(u.H0, sh.h0); gl.uniform1f(u.H1, sh.h1); gl.uniform1f(u.H2, sh.h2)
      gl.uniform1f(u.W1, sh.w1); gl.uniform1f(u.W2, sh.w2)
      gl.uniform1f(u.A1_IN, sh.a1i); gl.uniform1f(u.A1_MX, sh.a1x)
      gl.uniform1f(u.A2_IN, sh.a2i); gl.uniform1f(u.A2_MX, sh.a2x)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      return true
    },

    destroy() {
      const ext = gl.getExtension('WEBGL_lose_context')
      if (ext) ext.loseContext()
    },
  }
}
