/* NO RENDERER MODULE MAY REFERENCE A NAME IT NEVER BOUND.
 *
 * This is the gate for the defect in tools/check-unbound-identifiers.mjs's own
 * header: `isWriteEnabled` used and not imported in
 * src/setup-profile-settings.js, shipped unminified in the renderer bundle of
 * every build that carried the permission-level row, throwing on every press
 * AFTER it had written the person's new permission level to disk.
 *
 * THE CHECKER IS CHECKED FIRST, and that order is the point. A guard that
 * reports nothing passes a clean tree and a broken one identically, and this
 * repo has already been bitten by a gate that went green because it measured
 * nothing (see tools/check-suites-discovered.mjs). So the first two tests plant
 * the defect and require it to be found; only then does the third one trust a
 * quiet answer about src/.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { scanRendererSource, unboundIdentifiers } from '../check-unbound-identifiers.mjs'

test('the checker finds the exact defect that shipped', () => {
  /* src/setup-profile-settings.js, reduced to the shape that shipped: the
     module imports its neighbour and uses one more name from it than it asked
     for. */
  const shipped = `
    import { WRITE_ACTION_FLAGS, setWriteEnabled } from './write-flags.js'
    export function chooseTier() {
      const wasOn = new Map(WRITE_ACTION_FLAGS.map(flag => [flag.id, isWriteEnabled(flag.id)]))
      setWriteEnabled('dispatch', false)
      return wasOn
    }
  `
  assert.deepEqual(unboundIdentifiers(shipped), ['isWriteEnabled'])
})

test('the checker accepts every way this codebase legitimately binds a name', () => {
  const clean = `
    import defaultThing, { named as renamed } from './x.js'
    import * as everything from './y.js'
    const { a, b: [c], ...rest } = defaultThing
    let d
    var e = 1
    function f(g, { h } = {}, ...i) { return g + h + i + d + e }
    class K extends everything.Base {
      static field = 1
      method(arg) { return arg + renamed }
    }
    const arrow = (m = c) => m + a + rest
    try { arrow() } catch (problem) { console.log(problem, f, K) }
    for (const item of [a]) { console.log(item) }
    label: for (let index = 0; index < 1; index += 1) { break label }
    const key = 'z'
    const read = defaultThing[key] + defaultThing.key
    export { read }
  `
  assert.deepEqual(unboundIdentifiers(clean), [],
    'a legal binding form is being reported as undefined, which would make this gate unusable')
})

test('a property, a label and a meta property are not references to anything', () => {
  const shapes = `
    const target = { notAGlobalName: 1, nested: { alsoNot: 2 } }
    const url = import.meta.url
    const reached = target.notAGlobalName + target.nested.alsoNot
    outer: while (reached) { break outer }
    export { url, reached }
  `
  assert.deepEqual(unboundIdentifiers(shapes), [])
})

test('no renderer module references a name it never bound', () => {
  const { scanned, findings } = scanRendererSource()
  assert.ok(scanned > 50, `only ${scanned} renderer modules were scanned; the scan is not reaching src/`)
  assert.deepEqual(
    findings.map(finding => `${finding.file}: ${finding.name}`),
    [],
    'each of these throws the moment its line runs, in the shipped product',
  )
})
