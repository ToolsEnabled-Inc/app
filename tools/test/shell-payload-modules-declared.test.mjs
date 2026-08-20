/* EVERY MODULE THE SHELL LOADS OUT OF THE PAYLOAD MUST BE NAMED IN THE MANIFEST.
 *
 * MEASURED 2026-08-19 against the staged payload and shell/agent-host.cjs.
 * The host names eight payload modules in PAYLOAD_*_MODULE constants. Four of
 * them appeared in no list in tools/capability-manifest.json:
 *
 *   src/lib/agent-tool-summary.js          ABSENT from capability/ entirely
 *   src/lib/r-ledger.js                    shipped only because agent-onboarding.js requires it
 *   src/lib/agent-comms/tree-node-directory.js
 *   src/lib/providers/agent-comms-local.js shipped only because tool-registry.js requires it
 *
 * So three of the four rode into the payload on somebody else's require graph,
 * and the fourth did not ride at all: the tool note -- the thing that tells an
 * agent what this product can do -- was dead in the shipped bytes while the
 * engine suite that proves its behaviour was green.
 *
 * WHY NOTHING CAUGHT IT, AND WHY THE ANSWER HAS TO BE A BUILD-TIME GATE.
 * The host loads these modules deliberately fail-soft; its own comment states
 * the rule: "A payload cut before the module existed injects nothing and starts
 * sessions exactly as it always has... A missing introduction must not become a
 * dead product." That is the right runtime behaviour and it is not what is being
 * changed here. But it means a missing module produces no throw, no log and no
 * degraded start -- the product simply, silently, does less. Runtime is designed
 * to stay quiet, so build time is the only place the absence can be seen.
 *
 * The closure walk cannot see these either. It follows require() from the
 * payload's own entrypoints, and these modules are required by the SHELL, which
 * lives in the app repo and is not walked. A module with no engine-side
 * requirer is therefore invisible to every existing guard: the walk does not
 * reach it, check-payload-current only compares files that are already staged,
 * and the boundary guard classifies what is present rather than asking what is
 * missing. This test asks the one question none of them ask.
 *
 * Run: node --test tools/test/shell-payload-modules-declared.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const shellDir = path.join(repoRoot, 'shell')
const manifestPath = path.join(repoRoot, 'tools', 'capability-manifest.json')

/* The lists that put a JavaScript module into the payload. hostModules is the
   intended home for anything the shell require()s, but a module reached as an
   entrypoint or as a dynamic-require root ships just as surely, so membership in
   any of them satisfies the guarantee this test exists to hold. The reported
   list name is kept so a mis-filed entry is still legible to a reader. */
const SHIPPING_LISTS = Object.freeze(['entrypoints', 'hostModules', 'dynamicRequires'])

const CONSTANT = /const\s+PAYLOAD_[A-Z0-9_]*MODULE\s*=\s*(['"])([^'"]+)\1/g

function shellPayloadModules(sources) {
  const found = new Map()
  for (const [file, text] of sources) {
    for (const match of text.matchAll(CONSTANT)) {
      const declared = match[2]
      if (!found.has(declared)) found.set(declared, file)
    }
  }
  return found
}

/* The whole judgement, as one pure function, so the positive control below can
   run it against a manifest that is not the one on disk. */
function undeclaredPayloadModules(sources, manifest) {
  const shipping = new Map()
  for (const list of SHIPPING_LISTS) {
    for (const entry of manifest[list] || []) if (!shipping.has(entry)) shipping.set(entry, list)
  }
  const undeclared = []
  for (const [declared, file] of shellPayloadModules(sources)) {
    if (!shipping.has(declared)) undeclared.push({ module: declared, declaredIn: file })
  }
  return undeclared
}

function readShellSources() {
  return fs.readdirSync(shellDir)
    .filter(name => name.endsWith('.cjs') || name.endsWith('.js'))
    .map(name => [path.join('shell', name), fs.readFileSync(path.join(shellDir, name), 'utf8')])
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const sources = readShellSources()

test('the shell names payload modules this test can actually find', () => {
  /* Guard the instrument before trusting it. If the constants are ever renamed
     or the host stops using a literal, this test would pass by finding nothing
     -- a green that means "I looked at zero modules". */
  const found = shellPayloadModules(sources)
  assert.ok(found.size >= 8,
    `only ${found.size} PAYLOAD_*_MODULE constants found; the pattern has stopped matching and this suite is no longer looking at anything`)
})

test('every payload module the shell loads is named in the manifest', () => {
  const undeclared = undeclaredPayloadModules(sources, manifest)
  assert.deepEqual(undeclared, [],
    `the shell require()s these out of the payload but no manifest list names them, so whether they ship depends on another module happening to require them:\n${
      undeclared.map(u => `  ${u.module}  (declared in ${u.declaredIn})`).join('\n')}`)
})

test('the guard reports the four modules that were undeclared before this fix', () => {
  /* POSITIVE CONTROL. A test that has never failed proves nothing, and the
     shared checkout must never be broken to demonstrate a red -- another lane
     nearly committed exactly that sabotage earlier this week. So the control
     runs the same judgement against the hostModules list as it stood before the
     fix, measured from the tree, with every other list left real. */
  const preFix = {
    ...manifest,
    hostModules: [
      'src/lib/audit.js',
      'src/lib/agent-org-store.js',
      'src/lib/custom-role-store.js',
      'src/lib/setup/machine-record.js',
      'src/lib/setup/workspace.js',
      'src/lib/agent-engine/codex-process.js',
      'src/lib/agent-engine/claude-cli-process.js',
      'src/lib/agent-engine/claude-cli-adapter.js',
      'src/lib/proc/hidden-spawn.js',
      'src/lib/agent-session-confinement.js',
      'src/lib/multi-account/rotation.js',
      'src/lib/providers/subscription-launch-env.js',
      'src/lib/settings.js',
      'src/lib/settings-registry.js',
    ],
  }
  const undeclared = undeclaredPayloadModules(sources, preFix).map(entry => entry.module).sort()
  assert.deepEqual(undeclared, [
    'src/lib/agent-comms/tree-node-directory.js',
    'src/lib/agent-tool-summary.js',
    'src/lib/providers/agent-comms-local.js',
    'src/lib/r-ledger.js',
  ], 'the guard no longer detects the absence it was written to detect')
})
