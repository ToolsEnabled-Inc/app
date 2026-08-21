/**
 * One resolver for the canonical engine checkout, shared by the three suites
 * that read it as a fixture source and by the doctor.
 *
 * Why this exists: the 2026-08-14 Desktop reorganization moved this repo from
 * `Desktop\wt-capability` to `Desktop\toolsenabled\opensource\wt-capability`.
 * The engine did not move, so the sibling default each suite carried
 * (`<repo>/../toolsenabled-current`) stopped resolving, three suites went
 * 30 tests -> 15, and the two that still ran FAILED in a way indistinguishable
 * from a fresh regression -- while the ratchet's headline number stayed green,
 * because a skipped test still counts. The layout that must never survive is
 * "the engine exists but is not found".
 *
 * Why this does not violate the no-defaults doctrine in gen-projection-lib.mjs
 * ("a default that points at one developer's Desktop resolves, on every other
 * machine, to a path that does not exist, and the run then reports success
 * while emitting nothing"): every candidate here is PROBED for a real engine
 * marker file before it is returned. A candidate that does not hold the marker
 * is never selected; when nothing holds it, the caller gets `found: false` and
 * the suites keep their loud, stated skip. Discovery can therefore never turn
 * absence into empty success -- it can only turn a false skip into a run.
 * The generators themselves still require MC_CANONICAL_ROOT via requiredRoot();
 * this resolver is how the suites and the doctor decide what to hand them.
 *
 * MC_CANONICAL_ROOT still wins unconditionally when set, even if stale --
 * an explicit override is the operator's statement of intent, and validating
 * it away silently would make the env var lie. The doctor WARNS on a stale
 * override instead (see check-environment.mjs).
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(import.meta.url)
export const PROJECT_ROOT = dirname(dirname(here))

/** The file that makes a directory count as the engine checkout. The suites'
 * skip predicate has always tested exactly this path; discovery must agree
 * with the skip or the two drift. */
export const ENGINE_MARKER = join('src', 'lib', 'agent-org.js')

/** In probe order. Names, not paths, so the report can say which layout won. */
export function candidateRoots({ env = process.env } = {}) {
  const configured = env.MC_CANONICAL_ROOT?.trim()
  const list = []
  if (configured) list.push({ source: 'env:MC_CANONICAL_ROOT', root: resolve(configured) })
  list.push(
    // The pre-reorg layout: engine beside this repo.
    { source: 'sibling', root: resolve(PROJECT_ROOT, '..', 'toolsenabled-current') },
    // The post-reorg layout: repo under Desktop\toolsenabled\opensource\,
    // engine still at the Desktop root three levels up.
    { source: 'reorg-bucket', root: resolve(PROJECT_ROOT, '..', '..', '..', 'toolsenabled-current') },
    // Last resort by well-known location, still subject to the marker probe.
    { source: 'desktop', root: join(homedir(), 'Desktop', 'toolsenabled-current') },
  )
  return list
}

/**
 * Resolve the canonical engine root.
 *
 * Returns { root, source, found }:
 *  - env set: that path verbatim, source 'env:MC_CANONICAL_ROOT', found telling
 *    the truth about the marker (a stale override still wins; found lets the
 *    caller warn).
 *  - else: the first candidate holding the marker, found: true.
 *  - else: the sibling default with found: false, so existing skip predicates
 *    and their printed reasons behave exactly as they always have.
 *
 * `probe` is injectable for tests of the ordering logic.
 */
export function discoverCanonicalRoot({ env = process.env, probe = existsSync } = {}) {
  const candidates = candidateRoots({ env })
  if (candidates[0]?.source === 'env:MC_CANONICAL_ROOT') {
    const chosen = candidates[0]
    return { root: chosen.root, source: chosen.source, found: probe(join(chosen.root, ENGINE_MARKER)) }
  }
  for (const candidate of candidates) {
    if (probe(join(candidate.root, ENGINE_MARKER))) {
      return { root: candidate.root, source: candidate.source, found: true }
    }
  }
  return { root: candidates[0].root, source: 'sibling-default-unfound', found: false }
}

/** What the three suites call: a root to use, discovery included. */
export function canonicalRootForTests(options) {
  return discoverCanonicalRoot(options).root
}
