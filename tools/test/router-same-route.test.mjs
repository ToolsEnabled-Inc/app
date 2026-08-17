/* render() IS NOT ONLY CALLED FOR NAVIGATION.
 *
 * A background probe answering calls it too -- src/main.js listens for
 * CHECKOUT_SURFACE_EVENT and calls render() whatever the answer -- and swapView
 * always constructs a new view and destroys the old one. So before the split,
 * a probe landing while somebody was half way through setup, or had the
 * settings drawer open, rebuilt what they were using.
 *
 * The codebase already knew this: the LIVE_FLAGS_EVENT and WRITE_FLAGS_EVENT
 * listeners skip render() when the route is settings, for exactly this reason.
 * That is the same fix applied twice by hand, to two events, leaving every
 * other caller uncovered.
 *
 * main.js is the browser entry point and this repo runs its suites on plain
 * node with no DOM, so the behavioural half is tested through the pure
 * predicate and the structural half by reading the source -- the same shape
 * tools/test/agent-route-self-audit.test.mjs already uses for this file.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

/* From its own module, not from main.js: main.js imports CSS and is only
   loadable through vite, which is why every other test of it reads the source
   as text. Pure route logic lives where it can be run. */
import { sameRoute } from '../../src/route-identity.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const mainSource = readFileSync(path.join(REPO_ROOT, 'src', 'main.js'), 'utf8')

test('1. the same stop is the same route, and a different stop is not', () => {
  assert.equal(sameRoute({ name: 'settings' }, { name: 'settings' }), true)
  assert.equal(sameRoute({ name: 'settings' }, { name: 'home' }), false)
  assert.equal(sameRoute(null, { name: 'home' }), false, 'nothing is the same as no route at all')
  assert.equal(sameRoute({ name: 'home' }, null), false)
})

test('2. the same stop with different arguments is a DIFFERENT route', () => {
  /* makeView reads comp, agent, example and query off the route. If any of them
     were ignored here, pressing through to a second agent would keep showing
     the first one -- a far worse bug than the one this fixes. */
  assert.equal(sameRoute({ name: 'agent', comp: 'a', agent: '1' }, { name: 'agent', comp: 'a', agent: '2' }), false,
    'two agents are two views')
  assert.equal(sameRoute({ name: 'computers', comp: 'a' }, { name: 'computers', comp: 'b' }), false)
  assert.equal(sameRoute({ name: 'agent', comp: 'a', agent: '1', example: true }, { name: 'agent', comp: 'a', agent: '1' }), false)
  assert.equal(sameRoute({ name: 'subscribe', query: 'plan=pro' }, { name: 'subscribe', query: 'plan=free' }), false)
  assert.equal(sameRoute({ name: 'agent', comp: 'a', agent: '1' }, { name: 'agent', comp: 'a', agent: '1' }), true)

  /* Every field makeView consumes must be compared, or a new route argument
     added later silently starts reusing the wrong view. */
  const makeViewBody = mainSource.slice(mainSource.indexOf('function makeView'))
    .slice(0, mainSource.slice(mainSource.indexOf('function makeView')).indexOf('\n}\n'))
  const identitySource = readFileSync(path.join(REPO_ROOT, 'src', 'route-identity.js'), 'utf8')
  for (const field of ['comp', 'agent', 'example', 'query']) {
    if (!makeViewBody.includes(`route.${field}`)) continue
    assert.match(identitySource, new RegExp(`a\\.${field} === b\\.${field}`),
      `makeView reads route.${field}, so sameRoute must compare it`)
  }
})

test('3. an unchanged route updates the chrome and leaves the view standing', () => {
  const renderBody = mainSource.slice(mainSource.indexOf('function render()'))
  const guard = renderBody.slice(0, renderBody.indexOf('function swapView'))
  assert.match(guard, /if \(current && sameRoute\(current\.route, route\)\) \{\s*\n\s*syncChrome\(route\)\s*\n\s*return/,
    'render must take the chrome-only path when the route has not changed')
  assert.ok(guard.indexOf('sameRoute(current.route, route)') < guard.indexOf('swapView('),
    'the guard has to come BEFORE the swap, or it guards nothing')
})

test('4. the swap still ends by syncing the chrome, so navigation is unchanged', () => {
  const swapBody = mainSource.slice(mainSource.indexOf('function swapView'))
  assert.match(swapBody.slice(0, swapBody.indexOf('function syncChrome')), /syncChrome\(route\)/,
    'a real navigation must still update breadcrumb, ring arrows and title')
  assert.match(mainSource, /function syncChrome\(route\) \{[\s\S]*?ringOrder\(\)/,
    'the ring is written inside syncChrome, which is why the chrome-only path can still grow a stop')
})

test('5. the WRONG fix is not present: the probe listener stays unguarded', () => {
  /* Guarding the listener on the probe's ANSWER would hide a surface whenever
     the answer went the other way -- removing a capability to silence a
     symptom, which is forbidden here. The listener must keep calling render()
     unconditionally; it is render() that decides how much to redo. */
  assert.match(mainSource, /addEventListener\(CHECKOUT_SURFACE_EVENT, \(\) => render\(\)\)/,
    'the checkout probe must still trigger a render so the ring can gain its stop')
})
