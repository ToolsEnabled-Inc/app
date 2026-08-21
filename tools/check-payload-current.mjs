/* Refuse a staged payload whose bytes are older than the source they came from.
 *
 * THE GAP THIS CLOSES. Everything that inspects the capability payload checks
 * that files are PRESENT, never that they are CURRENT. check-asar-manifest.mjs
 * verifies every declared entrypoint and hostModule exists in the built package;
 * check-payload-boundary.mjs verifies every staged file is classified;
 * check-no-owner-data.mjs scans the staged bytes. All three pass on a payload
 * staged an hour ago from code that has since changed.
 *
 * And the tests do not cover it either, because tests import from the SOURCE
 * tree while the installer ships the STAGED tree. When those two disagree, every
 * suite is green and the shipped bytes are something nobody tested.
 *
 * MEASURED WHEN THIS WAS WRITTEN: 215 of 218 staged files matched source, and
 * the three that did not were src/lib/providers/cli-provider-gateway.js,
 * src/lib/providers/subscription-launch-env.js and src/lib/tool-registry.js --
 * the authoritative credential scrub, the module that delegates into it, and the
 * permission-tier dispatch chokepoint. The three most security-critical files in
 * the payload were the stale ones, every gate reported clean, and the staged
 * copy of the scrub was the pre-fix version with a known Windows bypass.
 *
 * That is not a coincidence, it is the mechanism: the files that get fixed are
 * the files that go stale, so staleness selects for exactly the code someone
 * just decided was worth changing.
 *
 * WHY THIS IS NOT ALREADY SAFE. `npm run dist` runs pack:capability before
 * electron-builder, so the ordinary ship path restages and self-heals -- a lane
 * initially reported this as "anything cut now ships the bypass" and corrected
 * itself, rightly. The danger is narrower and worse: a check run BY HAND against
 * an existing staged directory returns green over the wrong bytes, and a green
 * from a gate is what people quote. This guard makes that impossible to do
 * quietly.
 *
 * NEUTRAL DEFAULTS ARE VERIFIED, NOT SKIPPED. Two files are deliberately not
 * their source versions: the packer substitutes capability-defaults/<path> for
 * config/service-registry.json and config/agent-org.json, because the real ones
 * describe the BUILDER's machines and would be both a privacy leak and factually
 * wrong on a customer's computer. Skipping them would leave the two files most
 * likely to carry owner data unchecked by this guard, so they are compared
 * against capability-defaults/ instead. A guard with a hole where the sensitive
 * files are is worse than no guard, because it reports on them.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const GENERATED = new Set(['PAYLOAD.json', 'UNSHIPPABLE-OWNER-DATA.txt'])

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

// Mirrors pack-capability-layer.mjs's resolveSource() precedence. Duplicated
// rather than imported because that module runs main() at import time, so
// importing it would run the packer. The --source flag is omitted for the same
// reason it is omitted in require-clean-tree.mjs: it belongs to that script, and
// the dist chain invokes pack:capability with no flags.
function resolveSource(repoRoot) {
  const configured = () => {
    const file = path.join(repoRoot, 'private', 'capability-source.owner.json')
    if (!existsSync(file)) return null
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      return typeof parsed?.path === 'string' && parsed.path.trim() ? parsed.path.trim() : null
    } catch { return null }
  }
  for (const candidate of [process.env.TOOLSENABLED_SOURCE, configured()].filter(Boolean)) {
    const resolved = path.resolve(candidate)
    if (existsSync(path.join(resolved, 'tools', 'mission-bridge.js'))) return resolved
  }
  return null
}

function walk(root, base = root, out = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) walk(full, base, out)
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out
}

function main() {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
  const stagedDirectory = path.resolve(process.argv[2] || path.join(repoRoot, 'capability'))

  if (!existsSync(stagedDirectory) || !statSync(stagedDirectory).isDirectory()) {
    console.error(`[check-payload-current] no staged payload at ${stagedDirectory}`)
    process.exitCode = 1
    return
  }

  const payloadFile = path.join(stagedDirectory, 'PAYLOAD.json')
  if (!existsSync(payloadFile)) {
    console.error('[check-payload-current] the staged directory has no PAYLOAD.json, so it cannot state what it is.')
    process.exitCode = 1
    return
  }
  const payload = JSON.parse(readFileSync(payloadFile, 'utf8'))
  const neutral = new Set(payload.neutralDefaults ?? [])

  const source = resolveSource(repoRoot)
  if (!source) {
    // Unknown is not current. This mirrors require-clean-tree.mjs: a provenance
    // gate that cannot reach what it compares against must refuse, not pass.
    console.error('[check-payload-current] the capability-layer source tree is not configured, so the staged')
    console.error('payload cannot be compared against anything. Set TOOLSENABLED_SOURCE or')
    console.error('private/capability-source.owner.json. Refusing rather than reporting clean.')
    process.exitCode = 1
    return
  }

  const defaultsDirectory = path.join(repoRoot, 'capability-defaults')
  const stale = []
  const orphaned = []
  let compared = 0

  for (const relative of walk(stagedDirectory)) {
    if (GENERATED.has(relative)) continue
    const staged = path.join(stagedDirectory, relative)
    const counterpart = neutral.has(relative)
      ? path.join(defaultsDirectory, relative)
      : path.join(source, relative)

    if (!existsSync(counterpart)) { orphaned.push(relative); continue }
    compared += 1
    if (sha256(staged) !== sha256(counterpart)) {
      stale.push({ relative, from: neutral.has(relative) ? 'capability-defaults' : 'source' })
    }
  }

  if (!stale.length && !orphaned.length) {
    console.log(`[check-payload-current] staged payload is current: ${compared} files match their source bytes exactly.`)
    return
  }

  console.error('[check-payload-current] REFUSING: the staged payload does not match the code it came from.')
  if (stale.length) {
    console.error('')
    console.error('These staged files differ from their current counterpart. Tests read the')
    console.error('source tree; the installer ships these bytes. Every other gate passes on them:')
    for (const entry of stale) console.error(`  ${entry.relative}   (vs ${entry.from})`)
  }
  if (orphaned.length) {
    console.error('')
    console.error('These staged files have no counterpart at all, so nothing can vouch for them:')
    for (const relative of orphaned) console.error(`  ${relative}`)
  }
  console.error('')
  console.error('Re-stage before trusting any result taken from this directory:')
  console.error('  npm run pack:capability')
  process.exitCode = 1
}

main()
