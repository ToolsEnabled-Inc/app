import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const graphCss = readFileSync(join(root, 'src', 'graph.css'), 'utf8')
const graphJs = readFileSync(join(root, 'src', 'graph.js'), 'utf8')

test('role sublabels share the tier pitch budget without losing accessible identity', () => {
  const roleRule = graphCss.match(/\.graph-canvas \.node \.node-role\s*\{[^}]+\}/)?.[0]
  assert.ok(roleRule, 'graph role-label override must remain present')
  assert.match(
    roleRule,
    /max-width:\s*min\(calc\(var\(--d\) \+ 96px\), var\(--nn-max, 9999px\)\)/,
    'role rows must consume the same per-node pitch budget as packed name rows',
  )
  assert.match(graphJs, /style\.setProperty\('--nn-max', budget \+ 'px'\)/)
  assert.match(graphJs, /<span class="node-role">\$\{role\.label\}<\/span>/)
  assert.match(graphJs, /setAttribute\('aria-label', `\$\{agent\.name\} — \$\{role\.label\}`\)/)
})
