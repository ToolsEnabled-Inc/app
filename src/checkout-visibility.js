// Does this copy of the product have a checkout at all?
//
// WHAT WENT WRONG, MEASURED ON THE PACKAGED BUILD.
//
// The purchase list was authored at public/data/purchase-catalog.json, which
// vite copies into dist/ and electron-builder packs into app.asar under the
// blanket "dist/**". Nobody ever decided that it should ship -- nothing in the
// renderer half of this product asks whether a file is the builder's own or the
// product's, so the question was never put and the file travelled. #/checkout
// was an unconditional stop on the navigation ring, so on a stranger's fresh
// install the builder's internal purchase list sat one click back from home:
// internal repo paths, internal request ids, his own second-person
// deliberations, and a written admission that the installer is unsigned.
//
// THE ABSENCE THAT WAS READ AS CONSENT was in the packaging: an unclassified
// file ships. The engine half of this product already refuses that shape --
// config/payload-boundary.json plus tools/check-payload-boundary.mjs fail the
// build on a payload file classified nowhere at all. The renderer half had no
// equivalent, so "nobody said" meant "send it". tools/check-renderer-payload.mjs
// is that missing half; this module is the runtime consequence of it.
//
// SO THE SURFACE IS NOT A CONSTANT ANY MORE. The list is now the operator's own
// file, read from the install's own data directory (shell/main.cjs), and the
// checkout exists only when one was really served. Default is UNAVAILABLE and
// every failure resolves to unavailable: no answer, an error, a redirect, a
// non-200, an HTML body from some future SPA fallback. A surface that appears
// because a probe was inconclusive is the same defect wearing a different hat.
//
// WHAT THIS IS NOT. It is not a permission check and it must never be sold as
// one. Hiding a door does not protect anything on its own; the protection is
// that the bytes are not in the payload. This decides whether the product
// OFFERS the screen, so that a copy with no list has no empty shop on its ring.
//
// THE SECOND MEASUREMENT: THE SAME PAGE SERVED FROM A PUBLIC ORIGIN. This
// renderer is vendored onto toolsenabled.ai as /app/, where there is no shell
// and no install data directory, so the probe above asked the website for
// data/purchase-catalog.json on every load and got a 404 back -- a request the
// site had no reason to see and a log line naming a file the site does not
// hold. The answer was always "unavailable", so the ring was right, but it was
// right by accident of a 404 rather than by decision. The decision is made
// here now: only a copy hosted by the desktop shell is asked at all, and the
// discriminator is the one the rest of the renderer already trusts,
// onDesktop() in src/data-source.js (the preload's getBridgeProof, which the
// site's host bridge deliberately withholds). A skipped probe resolves exactly
// like a failed one -- unavailable, settled, event dispatched -- so nothing
// downstream can tell the two apart, which is the point: "not hosted" and
// "hosted with no list" are both "there is no checkout on this copy".

import { onDesktop } from './data-source.js'

export const CHECKOUT_SURFACE_EVENT = 'mc:checkout-surface'

export const CHECKOUT_CATALOG_URL = 'data/purchase-catalog.json'

// Fails closed, before anything has been measured and after anything has gone
// wrong. `settled` is separate on purpose: "not available yet" and "measured,
// and there is none" are different facts, and the router needs to tell them
// apart before it rewrites somebody's address bar.
let available = false
let settled = false

/** Is a checkout surface offered on this copy right now? */
export function checkoutSurfaceAvailable() {
  return available === true
}

/** Has the probe finished? False means "no answer yet", not "no". */
export function checkoutSurfaceSettled() {
  return settled === true
}

/**
 * Ask the shell whether this install has a purchase list, once.
 *
 * Resolves to a boolean and never rejects: the caller is a router, and a
 * throwing probe would have to be given a default by whoever caught it, which
 * is exactly where a fail-open creeps back in. The default lives here instead.
 */
export async function probeCheckoutSurface({
  fetchImpl = typeof fetch === 'function' ? fetch : null,
  url = CHECKOUT_CATALOG_URL,
  timeoutMs = 4000,
  dispatch = typeof window === 'undefined' ? null : window,
  hosted = onDesktop,
} = {}) {
  let answer = false
  try {
    // `hosted` is asked first and the fetch is never started unless it said
    // TRUE -- not truthy, and not "did not throw". A discriminator that threw
    // or returned something odd is a copy whose hosting is unknown, and a copy
    // whose hosting is unknown is not sent looking for a list on somebody
    // else's origin.
    answer = safe(hosted) === true && await measure(fetchImpl, url, timeoutMs)
  } catch {
    answer = false
  }
  available = answer === true
  settled = true
  try {
    dispatch?.dispatchEvent?.(new CustomEvent(CHECKOUT_SURFACE_EVENT, { detail: { available } }))
  } catch { /* a window without CustomEvent is a test harness; the value is still set */ }
  return available
}

/** Call a predicate and let it be wrong: anything but a clean boolean is `false`. */
function safe(predicate) {
  try {
    return typeof predicate === 'function' ? predicate() === true : false
  } catch {
    return false
  }
}

async function measure(fetchImpl, url, timeoutMs) {
  if (typeof fetchImpl !== 'function') return false

  // A hung loopback read must not leave the ring in its "not measured yet"
  // state forever, and it must not decide the answer either -- a timeout is a
  // failure to measure, and a failure to measure is not a checkout.
  const timeout = new Promise(resolve => {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return
    setTimeout(() => resolve(null), timeoutMs)
  })
  const response = await Promise.race([
    fetchImpl(url, { cache: 'no-store' }).catch(() => null),
    timeout,
  ])
  if (!response || response.ok !== true) return false
  // The shell answers a missing /data/*.json with 404 and a JSON body, so this
  // is belt and braces rather than the load-bearing check -- but an HTML body
  // arriving with a 200 is precisely how the old SPA fallback made "the file is
  // not there" look like success, and it costs one line to refuse it here too.
  const type = String(response.headers?.get?.('content-type') || '')
  return type.toLowerCase().includes('application/json')
}

/** Test seam. Nothing in the app calls this; the probe is the only writer. */
export function __setCheckoutSurfaceForTest(nextAvailable, nextSettled = true) {
  available = nextAvailable === true
  settled = nextSettled === true
}
