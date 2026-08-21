/* WHAT A REFUSAL ON THIS MODULE'S TWO CONTROLS SAYS. The identifier is kept as
   a machine field on the state object and never put in front of a person — see
   ./refusal-copy.js for why, and for the family floor that stops a code the
   engine adds next month reaching a customer bare. */
import { refusalCodeOf, refusalSentence } from './refusal-copy.js'
/* AND WHERE THE ANSWER GOES WHEN THE SCREEN IS ALREADY GONE. The archive
   control moves requests between two DURABLE ledgers; that is a real write, and
   `if (destroyed) return` above the line that reads the receipt threw its answer
   away whenever the person walked off the page mid-call. Filed here before the
   destroyed check and restated on the next mount — the pattern
   ./approval-outcomes.js set on #/approvals and ./agent-loops.js follows. */
import {
  WRITE_OUTCOME_KEYS,
  clearUndeliveredWrite,
  recordUndeliveredWrite,
  restatedMessage,
  undeliveredWrite,
} from './write-outcomes.js'

const ACTION_ROUTES = Object.freeze({
  dispatch: '/v1/actions/dispatch',
  'report-read': '/v1/actions/report-read',
  /* Read-only: what became of a launch this app already handed over. Behind no
     write flag of its own — it is the second half of the dispatch the person
     already made, and gating it separately would leave anyone with dispatch on
     and this off staring at "starting on it now" for ever, which is the exact
     defect it exists to end. */
  'launch-status': '/v1/actions/launch-status',
  queue: '/v1/actions/queue',
  'thread-reply': '/v1/actions/thread-reply',
  decision: '/v1/actions/decision',
  terminate: '/v1/actions/terminate',
  'ledger-archive': '/v1/actions/ledger-archive',
  'owner-prompt-presented': '/v1/actions/owner-prompt-presented',
  'owner-prompt-decision': '/v1/actions/owner-prompt-decision',
  // Codex Cloud. The launch is the only write; the other three read.
  'cloud-accounts': '/v1/actions/cloud-accounts',
  'cloud-tasks': '/v1/actions/cloud-tasks',
  'cloud-task-status': '/v1/actions/cloud-task-status',
  'cloud-launch': '/v1/actions/cloud-launch',
  /* The research bench family — same registered tools the MCP surface serves,
     reachable from the workbench without a session. */
  'task-submit': '/v1/actions/task-submit',
  'task-claim': '/v1/actions/task-claim',
  'task-get': '/v1/actions/task-get',
  'task-list': '/v1/actions/task-list',
  'role-complete': '/v1/actions/role-complete',
  /* The research project family: durable projects, experiments, runs, results,
     findings and session assignment. Four reads, six writes; the server keeps
     the read/write distinction at the provider behind each action. */
  'research-snapshot': '/v1/actions/research-snapshot',
  'research-runs': '/v1/actions/research-runs',
  'research-results': '/v1/actions/research-results',
  'research-findings': '/v1/actions/research-findings',
  'research-project-save': '/v1/actions/research-project-save',
  'research-experiment-save': '/v1/actions/research-experiment-save',
  'research-run-submit': '/v1/actions/research-run-submit',
  'research-session-assign': '/v1/actions/research-session-assign',
  'research-finding-save': '/v1/actions/research-finding-save',
  'research-lifecycle': '/v1/actions/research-lifecycle',
})

let bootstrapPromise = null
// Measured against the live bridge 2026-08-06, not guessed: every audited
// action pays for durable audit-chain writes, and the old 5s budget was below
// the floor for all of them — report-read 5.38s, thread-reply 7.79s, status
// 12.34s, dispatch longer still because it spawns a process. A budget under
// the measured cost does not make anything faster; it just turns completed
// work into a false "timed out". The real fix is server-side audit latency;
// see the shadow report to the coordinator.
const REQUEST_TIMEOUT_MS = 30_000
export const WELL_KNOWN_BRIDGE_PORTS = Object.freeze(
  Array.from({ length: 10 }, (_value, index) => 4610 + index),
)
const WELL_KNOWN_BRIDGES = Object.freeze(
  WELL_KNOWN_BRIDGE_PORTS.map(port => `http://127.0.0.1:${port}`),
)
const BRIDGE_PROOF_RE = /^[A-Za-z0-9_-]{43}$/

// `/v1/status` is deliberately expensive on the bridge side: it parses every
// root's BUILD-QUEUE.md and writes durable audit receipts per root, measured at
// ~12s. It is a snapshot call, NOT a heartbeat, so it gets its own budget while
// ordinary actions keep the tight one. Availability is probed separately via
// the cheap unauthenticated /v1/runtime — see bridgeReachable().
const STATUS_TIMEOUT_MS = 30_000

function timeoutSignal(ms = REQUEST_TIMEOUT_MS) {
  return AbortSignal.timeout(ms)
}

function unavailable(error) {
  const timedOut = error?.name === 'TimeoutError'
  return { ok: false, reason: timedOut ? 'action bridge timed out' : (error?.message || 'action bridge unreachable'), code: timedOut ? 'BRIDGE_TIMEOUT' : 'BRIDGE_UNREACHABLE' }
}

export function normalizedBaseUrl(candidate) {
  let url
  try { url = new URL(candidate) } catch { return { ok: false, reason: 'action bridge address is malformed' } }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    return { ok: false, reason: 'action bridge address must be a bare loopback HTTP origin' }
  }
  return { ok: true, baseUrl: url.origin }
}

function validRuntimeDiscovery(discoveryOrigin, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.getPrototypeOf(body) !== Object.prototype
      || Reflect.ownKeys(body).some(key => !['ok', 'baseUrl', 'port', 'startedAt', 'pid'].includes(key))
      || ['ok', 'baseUrl', 'port', 'startedAt', 'pid'].some(key => !Object.hasOwn(body, key))
      || body.ok !== true) return null
  const configured = normalizedBaseUrl(body.baseUrl)
  const startedAtMs = typeof body.startedAt === 'string' ? Date.parse(body.startedAt) : NaN
  if (!configured.ok || configured.baseUrl !== discoveryOrigin
      || !Number.isSafeInteger(body.port) || body.port < 1 || body.port > 65535
      || new URL(configured.baseUrl).port !== String(body.port)
      || !Number.isSafeInteger(body.pid) || body.pid < 1
      || !Number.isFinite(startedAtMs) || new Date(startedAtMs).toISOString() !== body.startedAt) return null
  return configured
}

// The shell is the only party that knows which local listener is legitimately
// this app's own bridge. Ask it. A shell that cannot answer (a plain browser,
// or a build with no such bridge) leaves the developer scan in place, where a
// human has already opted in by other means.
async function shellBridgeEndpoint() {
  const ask = window.mcShell?.getBridgeEndpoint
  if (typeof ask !== 'function') return { ok: false, source: 'none' }
  try {
    const endpoint = await ask()
    return endpoint && typeof endpoint === 'object' ? endpoint : { ok: false, source: 'none' }
  } catch {
    return { ok: false, source: 'none' }
  }
}

// Pin to the exact origin the shell says it started, and confirm the process
// answering there is the one it started before trusting it. NO fallback to the
// range scan on failure: falling back is precisely how the renderer would hand
// this boot's proof to a squatter that raced onto a lower discovery port. The
// shell's own layer holds its port exclusively, so a squatter cannot occupy it;
// the pid check additionally fails closed if the shell's layer died and some
// other process grabbed the port in between. Either way we refuse rather than
// discover.
async function pinnedOwnLayer(endpoint) {
  const normalized = normalizedBaseUrl(endpoint.baseUrl)
  if (!normalized.ok) {
    return { ok: false, reason: 'the ToolsEnabled shell reported a malformed own-layer origin', code: 'BRIDGE_OWN_LAYER_INVALID' }
  }
  try {
    const response = await fetch(`${normalized.baseUrl}/v1/runtime`, {
      method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store',
      signal: timeoutSignal(),
    })
    const body = await response.json().catch(() => null)
    const configured = response.ok ? validRuntimeDiscovery(normalized.baseUrl, body) : null
    if (configured && (!Number.isSafeInteger(endpoint.pid) || body.pid === endpoint.pid)) {
      return configured
    }
  } catch {
    // fall through to the fail-closed result; never scan
  }
  return {
    ok: false,
    reason: 'the ToolsEnabled shell started a capability layer this renderer could not confirm; refusing to hand its bootstrap proof to any other local listener',
    code: 'BRIDGE_OWN_LAYER_UNCONFIRMED',
  }
}

async function scanWellKnownBridges() {
  for (const discoveryOrigin of WELL_KNOWN_BRIDGES) {
    try {
      const response = await fetch(`${discoveryOrigin}/v1/runtime`, {
        method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store',
        signal: timeoutSignal(),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) continue
      const configured = validRuntimeDiscovery(discoveryOrigin, body)
      if (configured) return configured
    } catch {
      // A refused, malformed, or timed-out candidate is not discovery. Continue
      // through the bounded declared range without trusting its response.
    }
  }
  return {
    ok: false,
    reason: 'action bridge unavailable on the declared 127.0.0.1:4610-4619 range',
    code: 'BRIDGE_DISCOVERY_UNAVAILABLE',
  }
}

/* MAY THIS PAGE REACH THE COMPUTER IT IS RUNNING ON?
 *
 * Structural, from the page's own origin, and nothing else. The desktop shell
 * serves dist/ from http://127.0.0.1:<port> (shell/port-scan.cjs), and a dev
 * `vite preview` is loopback too -- so a loopback origin means the machine in
 * front of the person is the machine hosting this page, and scanning it is
 * reaching the HOST, which is fine. A page served from any public origin is the
 * website: the computer in front of the person is a visitor's own machine --
 * possibly a friend's -- and this application must never reach into it. That is
 * the owner's rule stated as architecture: "when a user is on the web we can't
 * be trying to hook into their computer, even when logged in."
 *
 * Until now that rule was held by a CONVENTION: the site's host-bridge.js
 * answered getBridgeEndpoint with source:'supervised' and a deliberately
 * invalid baseUrl, so pinnedOwnLayer() refused before fetching. Remove that
 * file, or fail to load it, and the scan below ran against a visitor's
 * loopback -- and `?bridge=http://127.0.0.1:4610` pasted into the site's URL
 * was honoured outright. A rule that depends on a helper file loading is off
 * exactly when something is wrong, so it is enforced here, where the fetch is.
 */
export function pageMayReachLoopback() {
  try {
    const host = String(globalThis.window?.location?.hostname || '')
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
  } catch {
    return false
  }
}

export async function configuredBaseUrl() {
  // The structural gate, ahead of EVERY path that could touch loopback --
  // including the supervised pin: pinnedOwnLayer only ever accepts loopback
  // URLs, and on a public origin a loopback URL is a visitor's own machine no
  // matter which host answered it. A signed-in page reaches a machine through
  // the host-supplied transport (setBridgeTransport), which request() consults
  // before ever calling this function, so nothing legitimate is lost here.
  if (!pageMayReachLoopback()) {
    return {
      ok: false,
      reason: 'this page is served from a public origin, so it will not look for a bridge on the computer it is running on; a signed-in page reaches your own machine through its relay transport instead',
      code: 'BRIDGE_FORBIDDEN_ON_PUBLIC_ORIGIN',
    }
  }

  const endpoint = await shellBridgeEndpoint()

  // Supervised (customer) path: the shell started the layer and knows its exact
  // origin. Pin to it, never scan, never honor ?bridge=. This is the path a
  // double-clicked install takes, and the one a local squatter targets.
  if (endpoint.ok && endpoint.source === 'supervised') {
    return pinnedOwnLayer(endpoint)
  }

  // Developer path (MC_BRIDGE_PROOF_FILE) or non-shell context: the bridge was
  // started outside this app by a human who opted in, so the ?bridge= override
  // and the bounded range scan remain available to them.
  const params = new URLSearchParams(window.location.search)
  if (params.has('bridge')) return normalizedBaseUrl(params.get('bridge'))
  return scanWellKnownBridges()
}

async function bootstrap() {
  const configured = await configuredBaseUrl()
  if (!configured.ok) return configured
  const getBridgeProof = window.mcShell?.getBridgeProof
  if (typeof getBridgeProof !== 'function') {
    return {
      ok: false,
      reason: 'action bridge bootstrap proof is unavailable outside the ToolsEnabled desktop shell',
      code: 'BRIDGE_BOOTSTRAP_PROOF_UNAVAILABLE',
    }
  }

  let proofResult
  try {
    proofResult = await getBridgeProof()
  } catch {
    return {
      ok: false,
      reason: 'the ToolsEnabled desktop shell could not provide the action bridge bootstrap proof',
      code: 'BRIDGE_BOOTSTRAP_PROOF_UNAVAILABLE',
    }
  }
  if (proofResult?.ok !== true || typeof proofResult.proof !== 'string'
      || !BRIDGE_PROOF_RE.test(proofResult.proof)) {
    return {
      ok: false,
      reason: typeof proofResult?.reason === 'string'
        ? proofResult.reason
        : 'the ToolsEnabled desktop shell has no valid action bridge bootstrap proof',
      code: 'BRIDGE_BOOTSTRAP_PROOF_UNAVAILABLE',
    }
  }

  try {
    const bootstrapUrl = new URL('/v1/bootstrap', configured.baseUrl)
    bootstrapUrl.searchParams.set('proof', proofResult.proof)
    const response = await fetch(bootstrapUrl, {
      method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store',
      signal: timeoutSignal(),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || body?.ok !== true || typeof body.token !== 'string') {
      return { ok: false, reason: body?.error?.message || `action bridge refused bootstrap (${response.status})`, code: body?.error?.code || 'BRIDGE_BOOTSTRAP_REFUSED' }
    }
    return { ok: true, baseUrl: configured.baseUrl, token: body.token }
  } catch (error) {
    return unavailable(error)
  }
}

async function session() {
  if (!bootstrapPromise) bootstrapPromise = bootstrap()
  const result = await bootstrapPromise
  if (!result.ok) bootstrapPromise = null
  return result
}

/* THE ONE SEAM THE BROWSER BUILD NEEDS.
 *
 * Every exported call in this module funnels through request(). On a desktop
 * machine that means a loopback fetch to this machine's own action bridge, and
 * normalizedBaseUrl() above refuses anything that is not bare loopback -- which
 * stays exactly as strict as it has always been.
 *
 * In a browser, the bridge is not reachable at all: it is on the person's
 * MACHINE, behind their router, and it must stay that way. So the browser does
 * not get a remote bridge address -- there is no such thing and this module
 * will not accept one. It supplies a TRANSPORT instead, which carries the same
 * request to that machine over the sealed relay tunnel, where the machine
 * performs it against its own loopback bridge exactly as it would locally.
 *
 * That distinction is the whole point. Widening the origin rule would have
 * made the bridge reachable from somewhere that is not this machine. Swapping
 * the transport does not: the bridge is still only ever spoken to over
 * loopback, by a process on its own machine.
 *
 * A transport is: (pathname, { method, body, timeoutMs }) -> the same
 * { ok: true, ... } / { ok: false, reason, code } shape request() returns.
 */
let transport = null

export function setBridgeTransport(next) {
  if (next !== null && typeof next !== 'function') throw new TypeError('a bridge transport must be a function or null')
  transport = next
  /* An explicit INSTALL is the final word -- a later lazy host lookup must not
   * replace a transport somebody chose. An explicit REMOVAL is not: it means
   * "go back to asking", so that signing out and signing in again can install
   * one through the host seam. Marking a removal as answered would leave a
   * person who signed back in permanently on the local path, which in a
   * browser is no path at all. */
  hostTransportAsked = next !== null
  bootstrapPromise = null
  return transport
}

export function bridgeTransportInstalled() {
  return transport !== null
}

/* IS THERE A MACHINE ON THE OTHER END? Asked by the data-source resolver to
 * decide relay-versus-mock on a public origin. `reask` exists because the lazy
 * host lookup settles its answer the first time it runs: a page whose first
 * request happened signed-out would otherwise be marked "asked, none" and a
 * later sign-in could never install the tunnel without a reload. Re-asking is
 * only meaningful while no transport is installed -- an installed one is an
 * explicit choice and stays the final word, exactly as setBridgeTransport
 * documents. */
export async function bridgeTransportAvailable({ reask = false } = {}) {
  if (transport) return true
  if (reask) hostTransportAsked = false
  await hostTransport()
  return transport !== null
}

/* A HOST MAY SUPPLY THE TRANSPORT, the same way it already supplies the
 * bridge endpoint. `window.mcShell.getBridgeTransport()` is asked once, on the
 * first request, and its answer is installed. The website uses this to hand
 * over a relay tunnel to the person's own machine when they are signed in and
 * have one connected; the desktop shell does not implement it and gets the
 * local path, unchanged.
 *
 * Asked LAZILY rather than at import: on the website the transport cannot
 * exist until a session and a machine pair do, and a check at import would
 * settle the answer as "none" before either was true. */
let hostTransportAsked = false

async function hostTransport() {
  if (hostTransportAsked || transport) return
  hostTransportAsked = true
  const ask = globalThis.window?.mcShell?.getBridgeTransport
  if (typeof ask !== 'function') return
  try {
    const offered = await ask()
    if (typeof offered === 'function') transport = offered
  } catch { /* a host that cannot answer gets the local path, as before */ }
}

async function request(pathname, { method = 'GET', body = null, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  await hostTransport()
  if (transport) {
    try {
      const value = await transport(pathname, { method, body, timeoutMs })
      if (!value || typeof value !== 'object') return { ok: false, reason: 'the remote machine returned nothing usable', code: 'BRIDGE_REQUEST_REFUSED' }
      return value
    } catch (error) {
      return unavailable(error)
    }
  }
  const active = await session()
  if (!active.ok) return active
  try {
    const response = await fetch(`${active.baseUrl}${pathname}`, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${active.token}`,
        ...(body === null ? {} : { 'content-type': 'application/json' }),
      },
      cache: 'no-store',
      signal: timeoutSignal(timeoutMs),
      ...(body === null ? {} : { body: JSON.stringify(body) }),
    })
    const value = await response.json().catch(() => null)
    if (!response.ok || value?.ok !== true) {
      if (response.status === 401) bootstrapPromise = null
      return { ok: false, reason: value?.error?.message || `action bridge refused request (${response.status})`, code: value?.error?.code || 'BRIDGE_REQUEST_REFUSED' }
    }
    return value
  } catch (error) {
    bootstrapPromise = null
    return unavailable(error)
  }
}

export function bridgeStatus() {
  return request('/v1/status', { timeoutMs: STATUS_TIMEOUT_MS })
}

/**
 * What the two fixed local advisory tiers can do on this machine right now,
 * with machine-readable reasons. A read like bridgeStatus(): starts no
 * inference, mutates nothing.
 */
export function localTiersStatus() {
  return request('/v1/research/local-tiers-status', { timeoutMs: STATUS_TIMEOUT_MS })
}

/**
 * Read-only, public owner prompts. Secret-entry prompts are deliberately not
 * part of this renderer contract; those remain in the isolated native host.
 */
export function ownerPromptSnapshot() {
  return request('/v1/owner-prompts')
}

/** Mark a prompt presented only after the renderer has measured all evidence. */
export function markOwnerPromptPresented(promptId, evidence) {
  return postBridgeAction('owner-prompt-presented', { promptId, evidence })
}

/** Send an explicit public decision. Missing purchase lines remain omitted. */
export function decideOwnerPrompt(body) {
  return postBridgeAction('owner-prompt-decision', body)
}

/**
 * Cheap availability probe. Uses the unauthenticated, side-effect-free
 * /v1/runtime discovery endpoint (measured ~3ms) rather than /v1/status, so the
 * write surfaces can enable as soon as the bridge is genuinely reachable
 * instead of blocking on a snapshot call that parses queues and writes audit
 * receipts. Returns the same {ok,reason,code} shape as every other call here.
 */
export async function bridgeReachable() {
  // With a transport installed there is no local bridge to probe: reachability
  // is the tunnel's, and asking the machine is the only honest way to know.
  if (transport) {
    const probed = await request('/v1/runtime', { method: 'GET', timeoutMs: REQUEST_TIMEOUT_MS })
    return probed?.ok === true ? { ok: true } : { ok: false, reason: probed?.reason || 'that machine is not reachable', code: probed?.code || 'BRIDGE_UNREACHABLE' }
  }
  const active = await session()
  if (!active.ok) return active
  return { ok: true, baseUrl: active.baseUrl }
}

// Per-action budgets. These are not arbitrary: `dispatch` spawns a real agent
// process (launch record, task lease, child spawn) and was measured taking
// longer than the 5s action budget, which made the UI report BRIDGE_TIMEOUT for
// a dispatch that had ALREADY SUCCEEDED server-side — a lane appeared in the
// registry, ran, and exited 0 while the operator was told it was refused.
// Misreporting a completed spawn as a failure invites a retry, and dispatch
// carries no idempotency key, so the retry would spawn a second agent.
// The cloud budgets are measured, not guessed. Each cloud call spawns the codex
// CLI once per account it has to ask about, and `cloud-accounts` asks EVERY
// configured account for its real allowance -- three accounts on the machine
// this was built on, ~4-6s each. `cloud-launch` additionally waits on a human:
// the approval prompt it raises has its own 60s policy timeout, and a budget
// shorter than that would report a timeout to the person while they were still
// reading the dialog, then invite a retry that could create a SECOND real cloud
// task. This is the same failure the dispatch budget note below records, with a
// worse blast radius, because a cloud task cannot be cancelled.
const ACTION_TIMEOUT_MS = Object.freeze({
  dispatch: 120_000, queue: 30_000, terminate: 120_000, 'ledger-archive': 120_000,
  'cloud-accounts': 120_000, 'cloud-tasks': 90_000, 'cloud-task-status': 90_000, 'cloud-launch': 240_000,
  /* Task actions pay a durable write each; role-complete runs local inference
     and is slow rather than stuck — the judge gets minutes, not seconds. */
  'task-submit': 30_000, 'task-claim': 30_000, 'task-get': 30_000, 'task-list': 30_000,
  'role-complete': 300_000,
  /* The research lifecycle spawns or exactly stops a worker process under a
     cross-process lock; every other research action is a bounded durable
     read/write on the default budget. */
  'research-lifecycle': 60_000,
})

export function postBridgeAction(action, body) {
  const pathname = ACTION_ROUTES[action]
  if (!pathname) return Promise.resolve({ ok: false, reason: 'unknown bridge action', code: 'BRIDGE_ACTION_UNKNOWN' })
  return request(pathname, { method: 'POST', body, timeoutMs: ACTION_TIMEOUT_MS[action] ?? REQUEST_TIMEOUT_MS })
}

function validAuditReceipt(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Number.isSafeInteger(value.sequence) && value.sequence > 0
    && /^[a-f0-9]{64}$/.test(String(value.eventHash || ''))
}

const ARCHIVE_REQUEST_ID_RE = /^R[0-9]{1,4}(?:\.[0-9]{1,4})?$/

function validArchiveCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Reflect.ownKeys(value).some(key => !['id', 'reasonCode', 'reason', 'supersedingRequestIds'].includes(key))
      || !['id', 'reasonCode', 'reason'].every(key => Object.hasOwn(value, key))
      || !ARCHIVE_REQUEST_ID_RE.test(String(value.id || ''))
      || !['completed', 'fully-superseded'].includes(value.reasonCode)
      || typeof value.reason !== 'string' || value.reason.length === 0 || value.reason.length > 300
      || /[\r\n]/.test(value.reason)) return false
  const superseding = value.supersedingRequestIds === undefined ? [] : value.supersedingRequestIds
  return Array.isArray(superseding)
    && new Set(superseding).size === superseding.length
    && superseding.every(id => ARCHIVE_REQUEST_ID_RE.test(id))
    && (value.reasonCode === 'fully-superseded' ? superseding.length > 0 : superseding.length === 0)
}

/** Validate the bounded canonical archive receipt before the UI reports a move. */
export function verifiedLedgerArchiveReceipt(result, dryRun) {
  const receipt = result?.receipt
  if (result?.ok !== true
      || !receipt || typeof receipt !== 'object' || Array.isArray(receipt)
      || receipt.action !== 'ledger-archive'
      || receipt.dryRun !== dryRun
      || !canonicalIso(receipt.at)
      || !/^[a-f0-9]{64}$/.test(String(receipt.planSha256 || ''))
      || !Array.isArray(receipt.candidates) || !receipt.candidates.every(validArchiveCandidate)
      || new Set(receipt.candidates.map(candidate => candidate.id)).size !== receipt.candidates.length
      || !Array.isArray(receipt.inconsistencies)
      || !receipt.inconsistencies.every(issue => issue && typeof issue === 'object' && !Array.isArray(issue)
        && Reflect.ownKeys(issue).length === 3
        && ['id', 'code', 'reason'].every(key => Object.hasOwn(issue, key))
        && ARCHIVE_REQUEST_ID_RE.test(String(issue.id || ''))
        && issue.code === 'DONE_WITH_UNMET_GATE'
        && typeof issue.reason === 'string' && issue.reason.length > 0 && issue.reason.length <= 300)
      || !Number.isSafeInteger(receipt.activeCount) || receipt.activeCount < 0
      || !Number.isSafeInteger(receipt.archiveCount) || receipt.archiveCount < 0
      || !Array.isArray(receipt.movedIds)
      || !Number.isSafeInteger(receipt.movedCount) || receipt.movedCount !== receipt.movedIds.length
      || !validAuditReceipt(receipt.audit)) return false
  const candidateIds = receipt.candidates.map(candidate => candidate.id)
  if (dryRun) return receipt.movedCount === 0
  return receipt.movedCount === candidateIds.length
    && JSON.stringify(receipt.movedIds) === JSON.stringify(candidateIds)
    && validAuditReceipt(receipt.intentAudit)
}

/* `code` is the MACHINE channel and is the reason the identifier can leave the
   sentence without leaving the product: a support conversation, a driver and
   `markRefusalCode()` all still name the exact refusal. It is absent rather than
   empty on the paths that did not refuse — `code: ''` reads as "there is a code
   and it is blank", which is the absence-as-value mistake this codebase keeps
   making and which a probe asserting on presence would pass on. */
function archiveControlState(phase, enabled, label, note, message, code = null) {
  return Object.freeze(code ? { phase, enabled, label, note, message, code } : { phase, enabled, label, note, message })
}

function archivePreviewMessage(receipt) {
  const candidates = receipt.candidates.map(candidate => `${candidate.id} - ${candidate.reason}`).join('; ')
  const issues = receipt.inconsistencies.map(issue => `${issue.id} - ${issue.reason}`).join('; ')
  return [
    candidates ? `Preview: ${candidates}.` : 'Preview: no requests currently qualify.',
    issues ? ` Retained inconsistencies: ${issues}.` : '',
  ].join('')
}

/**
 * Two-step owner control: the first click performs a real dry-run and renders
 * every candidate; only the second click submits {dryRun:false}. Any uncertain
 * response returns to preview instead of silently retrying a move.
 */
export function createLedgerArchiveController({
  postAction = postBridgeAction,
  onState = () => {},
} = {}) {
  let destroyed = false
  let preview = null
  /* A MOVE THIS CONTROL ALREADY MADE AND NEVER GOT TO REPORT. Read at
     construction, not at render, so the first state this controller ever
     publishes already carries it — a surface that painted the ordinary idle
     sentence first and corrected itself afterwards would show "nothing has
     happened" about a move that did. */
  const missedArchive = undeliveredWrite(WRITE_OUTCOME_KEYS.LEDGER_ARCHIVE)
  let state = missedArchive
    ? archiveControlState(
      'idle',
      true,
      'Preview cleanup',
      'Result you did not see',
      restatedMessage(missedArchive),
    )
    : archiveControlState(
      'idle',
      true,
      'Preview cleanup',
      'Owner-gated',
      'Preview completed or fully superseded R requests. Nothing moves on the first click.',
    )
  const publish = next => {
    state = next
    if (!destroyed) onState(state)
  }
  publish(state)

  /* EVERY SETTLED BRANCH OF A REAL MOVE GOES THROUGH HERE, and the order of the
     two lines below is the whole repair: the outcome is filed BEFORE this asks
     whether its own screen survived. Both branches matter — "archived" and "not
     confirmed" vanished together before, and vanishing reads as the reassuring
     one. The dry run does not come through here: a preview moved nothing, so
     there is nothing to carry. */
  const settleMove = (next, tone) => {
    publish(next)
    if (destroyed) recordUndeliveredWrite(WRITE_OUTCOME_KEYS.LEDGER_ARCHIVE, { tone, message: next.message })
    else clearUndeliveredWrite(WRITE_OUTCOME_KEYS.LEDGER_ARCHIVE)
    return state
  }

  const runPreview = async () => {
    preview = null
    publish(archiveControlState(
      'pending-preview', false, 'Previewing', 'Dry run',
      'Computing the exact archive set. Nothing has moved.',
    ))
    let result
    try { result = await postAction('ledger-archive', { dryRun: true }) }
    catch (error) {
      result = { ok: false, code: 'BRIDGE_REQUEST_FAILED', reason: error?.message || 'preview failed' }
    }
    if (destroyed) return state
    if (!verifiedLedgerArchiveReceipt(result, true)) {
      /* A reply this control could not verify carries no code of its own, so the
         code is RESOLVED before the sentence is composed rather than after: an
         unresolved code falls to the generic remedy ("try once more"), which is
         the wrong advice about a two-step owner-gated move. */
      const code = refusalCodeOf(result) || 'BRIDGE_LEDGER_ARCHIVE_PREVIEW_INVALID'
      publish(archiveControlState(
        'idle', true, 'Preview again', 'No move confirmed',
        `Nothing moved. ${refusalSentence({ code, reason: result?.reason }, { fallback: 'The preview receipt was incomplete.' })}`,
        code,
      ))
      return state
    }
    preview = result.receipt
    const message = archivePreviewMessage(preview)
    if (preview.candidates.length === 0) {
      publish(archiveControlState('idle', true, 'Preview again', 'Nothing eligible', `${message} Nothing moved.`))
      return state
    }
    publish(archiveControlState(
      'confirm', true,
      `Archive ${preview.candidates.length} request${preview.candidates.length === 1 ? '' : 's'}`,
      'Select again to confirm',
      `${message} Select again to move exactly this preview.`,
    ))
    return state
  }

  const execute = async () => {
    const submittedPreview = preview
    publish(archiveControlState(
      'pending-move', false, 'Archiving', 'Pending',
      'Archive request pending. No move has been confirmed.',
    ))
    let result
    try { result = await postAction('ledger-archive', { dryRun: false }) }
    catch (error) {
      result = { ok: false, code: 'BRIDGE_REQUEST_FAILED', reason: error?.message || 'archive request failed' }
    }
    /* THERE IS NO `if (destroyed) return` HERE, and its absence is the fix. This
       is the real move: by the time this line runs, requests have either changed
       durable ledgers or they have not, and which of the two it was is the only
       thing the person needs. Returning early here made those two outcomes
       byte-for-byte identical on screen. */
    const exactPreview = verifiedLedgerArchiveReceipt(result, false)
      && result.receipt.planSha256 === submittedPreview?.planSha256
      && JSON.stringify(result.receipt.candidates) === JSON.stringify(submittedPreview?.candidates)
    preview = null
    if (!exactPreview) {
      const code = refusalCodeOf(result) || 'BRIDGE_LEDGER_ARCHIVE_RECEIPT_INVALID'
      /* The remedy is written here rather than taken from the table because this
         control knows something the table cannot: a mismatched receipt means
         what moved is NOT KNOWN from this screen, so the next act is to look,
         not to retry. */
      return settleMove(archiveControlState(
        'idle', true, 'Preview current state', 'No move confirmed',
        refusalSentence({ code, reason: result?.reason }, {
          fallback: 'The archive result did not match the confirmed preview.',
          remedy: 'Nothing is confirmed moved and what did move is not known from this screen. Preview again before any retry, and read that preview before confirming it.',
        }),
        code,
      ), 'refused')
    }
    const ids = result.receipt.movedIds.join(', ')
    return settleMove(archiveControlState(
      'success', true, 'Preview cleanup', 'Archived',
      `Archive verified for ${ids || 'no requests'}. The durable active and archive ledgers match the confirmed preview.`,
    ), 'confirmed')
  }

  return Object.freeze({
    click() {
      if (destroyed || state.phase.startsWith('pending')) return Promise.resolve(state)
      if (state.phase === 'confirm' && preview) return execute()
      return runPreview()
    },
    destroy() { destroyed = true },
    getState() { return state },
  })
}

const TERMINAL_AGENT_STATUSES = new Set(['finished', 'failed'])
const SAME_INTENT_RETRY_CODES = new Set([
  'BRIDGE_BOOTSTRAP_REFUSED',
  'BRIDGE_DISCOVERY_UNAVAILABLE',
  'BRIDGE_REQUEST_FAILED',
  'BRIDGE_REQUEST_REFUSED',
  'BRIDGE_TERMINATE_AUDIT_UNAVAILABLE',
  'BRIDGE_TERMINATE_IN_PROGRESS',
  'BRIDGE_TIMEOUT',
  'BRIDGE_UNREACHABLE',
])

function exactNonEmptyId(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

function canonicalIso(value) {
  if (typeof value !== 'string') return false
  const epoch = Date.parse(value)
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value
}

/**
 * Decide whether the selected declared agent has a real, exact process target.
 * This deliberately consumes only the projection's controlTarget; it never
 * manufactures one from a declared enabled flag, a route id, or an observed
 * session.
 */
export function terminateTargetAvailability({ live, selectedAgentId, controlTarget }) {
  if (!live) {
    return Object.freeze({
      enabled: false,
      reason: 'Terminate unavailable in simulated mode; no live bridge request will be sent.',
    })
  }
  if (!controlTarget || typeof controlTarget !== 'object' || Array.isArray(controlTarget)) {
    return Object.freeze({
      enabled: false,
      reason: 'Terminate unavailable: no observed control target is mapped to this declared agent.',
    })
  }
  if (!exactNonEmptyId(controlTarget.agentId) || !exactNonEmptyId(controlTarget.runId)) {
    return Object.freeze({
      enabled: false,
      reason: 'Terminate unavailable: the observed control target has no exact agent and run ids.',
    })
  }
  if (controlTarget.agentId !== selectedAgentId) {
    return Object.freeze({
      enabled: false,
      reason: 'Terminate unavailable: the observed control target does not match this declared agent.',
    })
  }
  if (controlTarget.status !== 'running') {
    return Object.freeze({
      enabled: false,
      reason: `Terminate unavailable: observed control target status is ${String(controlTarget.status || 'unknown')}, not running.`,
    })
  }
  if (!Number.isSafeInteger(controlTarget.pid) || controlTarget.pid <= 0) {
    return Object.freeze({
      enabled: false,
      reason: 'Terminate unavailable: the observed control target has no positive integer PID.',
    })
  }
  return Object.freeze({
    enabled: true,
    reason: `Terminate available for observed run ${controlTarget.runId} (PID ${controlTarget.pid}). Select once to review.`,
  })
}

/** Validate the full durable bridge receipt before the UI may claim success. */
export function verifiedTerminateReceipt(result, requestBody) {
  const receipt = result?.receipt
  return result?.ok === true
    && receipt && typeof receipt === 'object' && !Array.isArray(receipt)
    && receipt.action === 'terminate'
    && receipt.idempotencyKey === requestBody?.idempotencyKey
    && receipt.agentId === requestBody?.agentId
    && receipt.runId === requestBody?.expectedRunId
    && receipt.pid === requestBody?.expectedPid
    && receipt.verifiedGone === true
    && TERMINAL_AGENT_STATUSES.has(receipt.terminalStatus)
    && Number.isSafeInteger(receipt.exitCode)
    && canonicalIso(receipt.verifiedGoneAt)
    && Number.isSafeInteger(receipt.terminalAt) && receipt.terminalAt > 0
    && Number.isSafeInteger(receipt.auditSequence) && receipt.auditSequence > 0
    && /^[a-f0-9]{64}$/.test(String(receipt.auditEventHash || ''))
}

function freshTerminateIdempotencyKey() {
  const key = globalThis.crypto?.randomUUID?.()
  if (!exactNonEmptyId(key)) throw new Error('secure idempotency key generation is unavailable')
  return key
}

/* `code` is the machine channel — see archiveControlState above for why it is
   absent rather than blank on the paths that did not refuse. A refusal that
   loses its code is a real defect: it is what a support conversation and
   tools/test/terminate-ui.test.mjs name the exact refusal by. */
function frozenControlState(phase, enabled, label, note, message, code = null) {
  return Object.freeze(code ? { phase, enabled, label, note, message, code } : { phase, enabled, label, note, message })
}

/**
 * DOM-independent two-step controller used by the agent view and its focused
 * deterministic probe. An uncertain response retries the exact same request
 * body and idempotency key; a typed target refusal disables the stale control.
 */
export function createTerminateController({
  live,
  selectedAgentId,
  controlTarget,
  postAction = postBridgeAction,
  createIdempotencyKey = freshTerminateIdempotencyKey,
  onState = () => {},
} = {}) {
  const availability = terminateTargetAvailability({ live, selectedAgentId, controlTarget })
  let destroyed = false
  let requestBody = null
  let state = frozenControlState(
    availability.enabled ? 'idle' : 'unavailable',
    availability.enabled,
    'Terminate',
    availability.enabled ? 'Available' : 'Unavailable',
    availability.reason,
  )

  const publish = (next) => {
    state = next
    if (!destroyed) onState(state)
  }
  publish(state)

  const submit = async () => {
    const submittedBody = requestBody
    publish(frozenControlState(
      'pending',
      false,
      'Terminating',
      'Pending',
      'Terminate request pending. No stop has been confirmed.',
    ))

    let result
    try {
      result = await postAction('terminate', submittedBody)
    } catch (error) {
      result = {
        ok: false,
        code: 'BRIDGE_REQUEST_FAILED',
        reason: error?.message || 'terminate request failed',
      }
    }
    if (destroyed || requestBody !== submittedBody) return state

    if (verifiedTerminateReceipt(result, submittedBody)) {
      const receipt = result.receipt
      publish(frozenControlState(
        'success',
        false,
        'Terminated',
        'Verified',
        `Termination verified: run ${receipt.runId} is ${receipt.terminalStatus} with exit ${receipt.exitCode}, and PID ${receipt.pid} is gone.`,
      ))
      return state
    }

    const responseWasShapedSuccess = result?.ok === true
    const code = responseWasShapedSuccess
      ? 'BRIDGE_TERMINATE_RECEIPT_INVALID'
      : (typeof result?.code === 'string' ? result.code : 'BRIDGE_REQUEST_FAILED')
    const reason = responseWasShapedSuccess
      ? 'The terminate response was incomplete or did not match the requested agent, run, and PID.'
      : (result?.reason || 'The terminate request failed without a verified receipt.')
    const retrySameIntent = responseWasShapedSuccess || SAME_INTENT_RETRY_CODES.has(code)
    /* The engine's own sentence survives verbatim as the diagnosis; the remedy
       is this control's, because only this control knows whether the retry it is
       about to offer reuses the same request. "No stop has been confirmed" leads
       both, and it is the half a person acts on: a stop that half-worked and a
       stop that did nothing look the same from here. */
    publish(frozenControlState(
      retrySameIntent ? 'retry' : 'refused',
      retrySameIntent,
      retrySameIntent ? 'Retry terminate' : 'Terminate',
      retrySameIntent ? 'Same intent' : 'Unavailable',
      refusalSentence({ code, reason }, {
        remedy: retrySameIntent
          ? 'No stop has been confirmed. Retry sends exactly the same request rather than a second one, so pressing it cannot stop anything twice.'
          : 'No stop has been confirmed. Refresh this page and look at whether it is still running before pressing stop again.',
      }),
      code,
    ))
    return state
  }

  return Object.freeze({
    click() {
      if (destroyed || !state.enabled || state.phase === 'pending' || state.phase === 'success') {
        return Promise.resolve(state)
      }
      if (state.phase === 'idle') {
        publish(frozenControlState(
          'confirm',
          true,
          'Confirm terminate?',
          'Select again',
          `Terminate agent ${controlTarget.agentId}, run ${controlTarget.runId}, PID ${controlTarget.pid}? Select again to confirm.`,
        ))
        return Promise.resolve(state)
      }
      if (state.phase === 'confirm') {
        let idempotencyKey
        try { idempotencyKey = createIdempotencyKey() }
        catch (error) {
          /* Written as a LITERAL identifier rather than interpolated, which is
             why the `${...code...}` scan in tools/test/refusal-copy.test.mjs
             never saw it. It is the same defect: an identifier in front of a
             person. The code stays, on the state, where a driver can read it. */
          publish(frozenControlState(
            'idle',
            true,
            'Terminate',
            'Available',
            refusalSentence(
              { code: 'BRIDGE_IDEMPOTENCY_UNAVAILABLE', reason: error?.message },
              {
                fallback: 'A fresh one-time request key could not be created.',
                remedy: 'No request was sent and nothing has been stopped. Close ToolsEnabled and open it again before pressing stop a second time.',
              },
            ),
            'BRIDGE_IDEMPOTENCY_UNAVAILABLE',
          ))
          return Promise.resolve(state)
        }
        requestBody = Object.freeze({
          idempotencyKey,
          agentId: controlTarget.agentId,
          expectedRunId: controlTarget.runId,
          expectedPid: controlTarget.pid,
        })
      }
      return submit()
    },
    destroy() { destroyed = true },
    getState() { return state },
  })
}

/**
 * The research page-open read: projects with their experiments, session
 * assignments, the settings-gate decisions and worker lifecycle in one call.
 * Same {ok,reason,code} refusal shape as every action here.
 */
export function researchSnapshot() {
  return postBridgeAction('research-snapshot', {})
}

export function resetBridgeSession() {
  // The transport is deliberately NOT cleared here: a session reset means "get
  // a fresh bearer for the local bridge", and in a browser there is no bearer
  // to refresh. Clearing it would silently drop the tunnel and send every
  // subsequent call at a loopback address that does not exist in a browser.
  bootstrapPromise = null
}
