/* The graph layout preference, in one place.

   It used to live as a private const inside computers.js, which meant the
   agent view — the other page with a FleetGraph on it — could not see it and
   never called setLayout() at all. So it sat on graph.js's 'force' default:
   the same fleet drawn as a tangle of crossing links on one page and as a
   tidy org tree on the page you reached it from, with the sticky Tree/Physics
   toggle appearing to have no effect once you drilled in.

   Tree is the default because it reads as an org diagram rather than a
   mobile, which is what this graph is actually communicating. localStorage
   can throw (private mode, quota), so every access is guarded — a failure
   just means "use the default". */

const LAYOUT_KEY = 'mc.graph.layout'

export function readLayout() {
  try { return localStorage.getItem(LAYOUT_KEY) === 'force' ? 'force' : 'tree' }
  catch { return 'tree' }
}

export function writeLayout(v) {
  try { localStorage.setItem(LAYOUT_KEY, v === 'force' ? 'force' : 'tree') } catch {}
}
