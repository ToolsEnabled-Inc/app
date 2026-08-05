// Fetches the read-only snapshot written by tools/gen-status.mjs
// (public/data/status.json → served at /data/status.json). This module
// NEVER invents a number: a network failure, a missing file, or a
// malformed payload all resolve to an explicit `{ ok: false, reason }`
// rather than a default/zero/mock value. Callers must branch on `ok`.

const STATUS_URL = '/data/status.json'

/** Fetch + validate the snapshot once. Read-only; no retries, no mutation. */
export async function fetchStatus() {
  let res
  try {
    res = await fetch(STATUS_URL, { cache: 'no-store' })
  } catch (err) {
    return { ok: false, reason: `network error reaching ${STATUS_URL}: ${err.message || err}` }
  }
  if (!res.ok) {
    return { ok: false, reason: `${STATUS_URL} responded ${res.status} ${res.statusText}` }
  }
  let data
  try {
    data = await res.json()
  } catch (err) {
    return { ok: false, reason: `${STATUS_URL} did not parse as JSON: ${err.message || err}` }
  }
  if (!data || typeof data !== 'object' || data.schemaVersion !== 1) {
    return { ok: false, reason: `${STATUS_URL} has an unrecognized shape (missing/wrong schemaVersion)` }
  }
  // fetchedAtMs is OUR clock at the moment of a successful pull — distinct
  // from data.generatedAt (the generator's clock) and from each section's
  // own observedAt/authenticatedAt/at (the underlying reading's clock).
  // All three can legitimately disagree; the UI must be able to show any of
  // them rather than collapsing to one "as of" number.
  return { ok: true, data, fetchedAtMs: Date.now() }
}

/** age in ms, or null if the input timestamp is missing/unparseable. */
export function ageMs(iso, nowMs = Date.now()) {
  if (!iso) return null
  const t = typeof iso === 'number' ? iso : Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.max(0, nowMs - t)
}

/** Human "3h 12m ago" / "42s ago" style relative age. null input -> null output. */
export function fmtAge(ms) {
  if (ms == null || !Number.isFinite(ms)) return null
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  const remM = m % 60
  if (h < 24) return remM ? `${h}h ${remM}m ago` : `${h}h ago`
  const d = Math.floor(h / 24)
  const remH = h % 24
  return remH ? `${d}d ${remH}h ago` : `${d}d ago`
}
