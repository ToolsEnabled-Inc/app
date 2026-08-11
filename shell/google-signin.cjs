'use strict'

/* SIGN IN WITH GOOGLE, DONE THE WAY A DESKTOP APPLICATION HAS TO DO IT.
 *
 * WHAT THIS IS FOR. It answers the same question the local account answers --
 * "who is using this copy" -- with an identity a person did not have to invent
 * and cannot mistype: the email address on their Google account, as verified by
 * Google. The local account remains, deliberately, for people with no network
 * and for people who will not sign in with Google. This is the first option, not
 * the only one.
 *
 * WHAT IT IS NOT. It is not a login to Google's SERVICES. The scopes are
 * `openid email profile` and nothing else: they grant this product no access to
 * Drive, Gmail, Calendar, Contacts, or anything a person has stored -- only the
 * assertion of who they are. That boundary is the reason this stays out of
 * Google's sensitive-scope verification entirely, and it is also the reason
 * SHIPMENT-PLAN B14 does not bar it: B14 is about taking a PROVIDER SUBSCRIPTION
 * login (a Claude or ChatGPT account, to use somebody's paid plan from inside a
 * third-party product). This is the identity flow Google publishes for exactly
 * this purpose, and no password ever reaches this program -- see below.
 *
 * THE PASSWORD IS TYPED INTO THE SYSTEM BROWSER, NOT INTO US, and that is the
 * whole security argument for doing it this way. An embedded webview showing
 * Google's sign-in page would put a Google password inside a window this
 * application controls, where it could be read; Google refuses those, and it is
 * right to. `openExternal` hands the URL to the operating system's default
 * browser, which has the person's existing session, their password manager, and
 * their second factor, and which this process cannot see into.
 *
 * A SHIPPED DESKTOP BINARY CANNOT HOLD A SECRET, so there is no client secret
 * anywhere in this file or in the artifact. Anything shipped inside an
 * application a customer can download is public, whatever it is called. Google's
 * "Desktop app" client type is designed for this and issues no usable secret;
 * the proof of possession is PKCE instead:
 *
 *   - a random `code_verifier` is generated here, per sign-in, and never leaves
 *     this process;
 *   - its SHA-256 (`code_challenge`) goes to Google in the URL the browser opens;
 *   - the verifier itself goes to Google only in the final exchange, over TLS.
 *
 * So an authorization code intercepted on its way back -- by another program
 * listening on this machine, or by a malicious handler for the redirect -- is
 * useless: the exchange fails without the verifier, which the interceptor never
 * saw. The plain `code_challenge_method` is never used and is not offered.
 *
 * THE REDIRECT IS LOOPBACK, ON A PORT THE OPERATING SYSTEM CHOOSES. `http://
 * 127.0.0.1:<ephemeral>/...`, which is what Google's desktop guidance names, and
 * which is preferred over a custom URI scheme because a custom scheme can be
 * registered by any other program on the computer. The literal `127.0.0.1` is
 * used rather than `localhost`: `localhost` can resolve to something else
 * through the hosts file, and it can resolve to `::1` first, which would send
 * the code somewhere this program is not listening.
 *
 * NO REFRESH TOKEN IS ASKED FOR AND NO TOKEN IS KEPT. `access_type=offline` is
 * deliberately absent, so Google issues none. Once the id_token has been
 * verified, this product knows who the person is and mints its OWN session --
 * the existing DPAPI-sealed one in shell/product-account.cjs, with its own
 * expiry and its own revocation. Holding a Google refresh token would put a
 * durable credential to somebody's Google account on this disk in exchange for
 * nothing: this product never calls a Google API on their behalf. The access
 * token that does come back is used for nothing and is dropped in the same
 * function that receives it.
 *
 * EVERY FAILURE IS SIGNED OUT, WITH A SENTENCE. No network, Google refusing,
 * a token that does not verify, the port being taken, the browser not opening,
 * the person closing the tab: each returns `{ok: false, code, reason}` and
 * nobody is signed in. There is no branch here that produces a half-signed-in
 * state and none that quietly falls back to another way of signing in.
 */

const crypto = require('node:crypto')
const http = require('node:http')

const { verifyIdToken } = require('./google-oidc.cjs')

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

/* IDENTITY ONLY. Changing this list is a decision about what this product may
   read from somebody's Google account, and it is exported so a test can refuse
   the change rather than let it arrive as a diff nobody reads. `openid` is what
   makes Google return an id_token at all; `email` and `profile` add the address
   and the display name to it, which is why no API call is needed afterwards. */
const SIGNIN_SCOPES = Object.freeze(['openid', 'email', 'profile'])

/* Scopes that would drag this product into Google's sensitive/restricted
   verification process, listed so the guard below names what it refused. */
const REFUSED_SCOPE_MARKERS = Object.freeze([
  'drive', 'gmail', 'mail.google', 'calendar', 'contacts', 'photos',
  'spreadsheets', 'documents', 'cloud-platform', 'youtube',
])

const REDIRECT_PATH = '/toolsenabled/google-signin/callback'
const LOOPBACK_HOST = '127.0.0.1'

/* Long enough for a person to find the browser window, pick an account and pass
   a second factor without being rushed; short enough that a listener left open
   by a forgotten sign-in does not stay open all day. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
/* A callback request body/URL beyond this is not Google's. */
const MAX_CALLBACK_URL_LENGTH = 8 * 1024
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024

function refusal(code, reason) {
  return Object.freeze({ ok: false, code, reason })
}

function base64url(buffer) {
  return buffer.toString('base64url')
}

/* The page the person's browser lands on. NO SCRIPT, NO NETWORK, NO ECHO.
 *
 * It does not print the query string, and it must not: the authorization code
 * is in that URL, and a page that renders it puts a credential on screen and
 * into the browser's rendering history. It also carries a Content-Security-Policy
 * that forbids everything, so a browser extension injecting into this origin has
 * nothing to work with. */
function completionPage(title, message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
 body{font:16px/1.55 system-ui,Segoe UI,sans-serif;margin:0;min-height:100vh;display:flex;
      align-items:center;justify-content:center;background:#faf9f7;color:#1c1b19}
 main{max-width:34rem;padding:2.5rem}
 h1{font-size:1.35rem;margin:0 0 .6rem}
 p{margin:0;color:#4a4844}
</style></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`
}

/**
 * One sign-in attempt.
 *
 * `run()` resolves exactly once, to a verified identity or to a refusal.
 * `cancel()` makes it resolve to a refusal now -- it is what the Cancel button
 * on the sign-in screen calls, and it is the only honest answer to "the person
 * closed the browser", which nothing on this side can observe.
 */
function createGoogleSignIn({
  clientId,
  openExternal,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  /* Overridden ONLY by the test identity provider, which announces itself on
     the screen. See shell/google-signin-config.cjs: a config that repoints these
     must say so out loud, and the sign-in surface prints it, so a run against a
     test provider can never be mistaken for a run against Google. */
  authorizationEndpoint = AUTHORIZATION_ENDPOINT,
  tokenEndpoint = TOKEN_ENDPOINT,
  jwksUri,
  issuers,
  verify = verifyIdToken,
  createServer = handler => http.createServer(handler),
} = {}) {
  let settled = false
  /* Distinct from `settled` on purpose. `settled` cannot flip until the token
     exchange resolves, because that is what carries the result; this one flips
     the instant a usable callback arrives, which is the moment the one-time
     code stops being reusable. Collapsing the two leaves a replay window
     exactly as long as a network call. */
  let callbackConsumed = false
  let server = null
  let timer = null
  let resolveOnce = null
  /* Set once the URL exists, cleared the moment the attempt settles -- a stale
     address on a finished attempt would offer somebody a link that cannot work. */
  let authorizationAddress = null

  function shutdown() {
    if (timer) { clearTimeout(timer); timer = null }
    if (server) {
      const closing = server
      server = null
      try { closing.close() } catch { /* already closing */ }
      /* Any browser keeping the connection alive would hold the port. */
      try { closing.closeAllConnections?.() } catch { /* older runtimes */ }
    }
  }

  function settle(value) {
    if (settled) return
    settled = true
    authorizationAddress = null
    shutdown()
    if (resolveOnce) resolveOnce(value)
  }

  async function run() {
    if (settled) return refusal('GOOGLE_SIGNIN_ALREADY_USED', 'That sign-in attempt is already finished. Start another one.')

    if (typeof clientId !== 'string' || clientId.length === 0) {
      settled = true
      return refusal(
        'GOOGLE_SIGNIN_NOT_CONFIGURED',
        'This copy has not been given a Google sign-in application id, so signing in with Google is not available. You can still make an account on this computer.',
      )
    }
    if (typeof openExternal !== 'function') {
      settled = true
      return refusal('GOOGLE_SIGNIN_NO_BROWSER', 'This copy cannot open a browser window, so Google sign-in cannot be started.')
    }
    if (typeof fetchImpl !== 'function') {
      settled = true
      return refusal('GOOGLE_SIGNIN_NO_NETWORK_STACK', 'This copy has no way to make a network request, so Google sign-in cannot be completed.')
    }
    /* A guard against the change nobody would notice in review. If a later edit
       widens the scopes, this refuses to start rather than quietly asking a
       customer for access to their mail. */
    const scopeText = SIGNIN_SCOPES.join(' ').toLowerCase()
    const overreach = REFUSED_SCOPE_MARKERS.find(marker => scopeText.includes(marker))
    if (overreach) {
      settled = true
      return refusal('GOOGLE_SIGNIN_SCOPE_REFUSED', `Signing in must not ask for access to ${overreach}, so this sign-in was not started.`)
    }

    /* PER SIGN-IN, ALL THREE FROM THE SYSTEM RANDOM SOURCE.
       - verifier: proves the exchange comes from the process that started it.
       - state:    proves the callback belongs to THIS attempt (CSRF).
       - nonce:    proves the id_token was minted for THIS attempt (replay). */
    const codeVerifier = base64url(crypto.randomBytes(32))
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest())
    const state = base64url(crypto.randomBytes(32))
    const nonce = base64url(crypto.randomBytes(32))

    const settlement = new Promise(resolve => { resolveOnce = resolve })

    /* ---- the loopback listener, started BEFORE the browser is opened ----
       Opening the browser first would race: Google can redirect back before
       this process is listening, and the person then sees a connection error
       for a sign-in that actually worked. */
    let boundPort = 0
    let port
    try {
      port = await new Promise((resolve, reject) => {
        /* `boundPort` is read at REQUEST time, not at construction time: the
           handler has to exist before `listen` can tell us which port it got. */
        const listener = createServer((request, response) => onCallback(request, response, { state, port: boundPort }))
        listener.on('error', reject)
        listener.listen(0, LOOPBACK_HOST, () => {
          const address = listener.address()
          if (!address || typeof address.port !== 'number') { reject(new Error('no port')); return }
          server = listener
          resolve(address.port)
        })
      })
    } catch (error) {
      settled = true
      /* THE PORT CASE, NAMED. An ephemeral port is chosen by the operating
         system, so this is rare -- but a locked-down machine can refuse a
         listening socket outright, and that must read as "sign-in could not
         start" rather than as a hang. */
      const code = error && error.code === 'EACCES' ? 'GOOGLE_SIGNIN_PORT_REFUSED' : 'GOOGLE_SIGNIN_PORT_UNAVAILABLE'
      return refusal(
        code,
        'This computer would not let the program listen for Google’s reply, so sign-in could not start and nobody was signed in. Security software blocking local connections is the usual cause.',
      )
    }
    boundPort = port
    const redirectUri = `http://${LOOPBACK_HOST}:${port}${REDIRECT_PATH}`

    timer = setTimeout(() => {
      /* THE PERSON CLOSED THE BROWSER, OR WALKED AWAY. Nothing on this side can
         tell those apart, and neither can be detected -- so this says what is
         actually true: it did not finish. */
      settle(refusal(
        'GOOGLE_SIGNIN_TIMED_OUT',
        'The Google sign-in was not completed, so nobody was signed in. If the browser window was closed or left open, start again.',
      ))
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()

    const authorizationUrl = new URL(authorizationEndpoint)
    const parameters = {
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SIGNIN_SCOPES.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
      /* Ask which account, every time. A person with two Google accounts must
         not be silently signed in as whichever one their browser happened to
         have open -- this product's identity IS that account. */
      prompt: 'select_account',
    }
    for (const [key, value] of Object.entries(parameters)) authorizationUrl.searchParams.set(key, value)

    /* THE ADDRESS THE BROWSER WAS SENT TO, KEPT WHILE THIS ATTEMPT IS RUNNING.
     *
     * It exists because "the browser did not open" is a real state with no
     * recovery otherwise: a computer with no default browser association, or
     * one where the association is broken, ends the sign-in at
     * GOOGLE_SIGNIN_BROWSER_FAILED and leaves the person with nothing to do
     * about it. The screen shows this address so they can open it themselves,
     * which is what every command-line OAuth flow has always done.
     *
     * WHAT IS IN IT: the public client id, the loopback redirect, a SHA-256
     * hash (not the PKCE verifier -- that never leaves this process), and this
     * attempt's single-use state and nonce. There is no credential in it, and
     * it is useless after this attempt settles. */
    authorizationAddress = authorizationUrl.toString()

    try {
      await openExternal(authorizationAddress)
    } catch {
      settle(refusal(
        'GOOGLE_SIGNIN_BROWSER_FAILED',
        'This computer would not open a browser window for Google, so the sign-in could not start and nobody was signed in.',
      ))
      return settlement
    }

    return settlement

    /* ---- the callback ---- */

    function onCallback(request, response, expected) {
      let url
      try {
        if (typeof request.url !== 'string' || request.url.length > MAX_CALLBACK_URL_LENGTH) throw new Error('bad url')
        url = new URL(request.url, `http://${LOOPBACK_HOST}:${expected.port}`)
      } catch {
        respond(response, 400, 'Not this program', 'That request was not understood.')
        return
      }
      /* A browser can be pointed at a loopback port by any page. The request is
         only interesting on the exact path, with the exact state; everything
         else gets a 404 and does not settle the attempt -- a stray request must
         not be able to CANCEL somebody's sign-in either. */
      if (request.method !== 'GET' || url.pathname !== REDIRECT_PATH) {
        respond(response, 404, 'Nothing here', 'This address is only used while signing in.')
        return
      }
      /* DNS rebinding: a hostile page can resolve its own name to 127.0.0.1 and
         reach this listener. It cannot guess the state, so this is belt and
         braces -- but the check is one line. */
      const host = typeof request.headers?.host === 'string' ? request.headers.host : ''
      if (host !== `${LOOPBACK_HOST}:${expected.port}`) {
        respond(response, 400, 'Not this program', 'That request did not come from the sign-in this program started.')
        return
      }

      const presentedState = url.searchParams.get('state') || ''
      const expectedBytes = Buffer.from(expected.state, 'utf8')
      const presentedBytes = Buffer.from(presentedState, 'utf8')
      if (presentedBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(presentedBytes, expectedBytes)) {
        respond(response, 400, 'That reply was not for this sign-in', 'You can close this window and try again in the program.')
        return
      }

      /* GOOGLE SAID NO. `access_denied` is the person pressing Cancel on
         Google's own screen, which is a choice and is reported as one. */
      const googleError = url.searchParams.get('error')
      if (googleError) {
        const declined = googleError === 'access_denied'
        respond(response, 200,
          declined ? 'Sign-in cancelled' : 'Google could not complete the sign-in',
          'You can close this window and go back to ToolsEnabled.')
        settle(refusal(
          declined ? 'GOOGLE_SIGNIN_DECLINED' : 'GOOGLE_SIGNIN_REFUSED_BY_GOOGLE',
          declined
            ? 'You cancelled the Google sign-in, so nobody was signed in.'
            : `Google refused the sign-in (${sanitizeCode(googleError)}), so nobody was signed in.`,
        ))
        return
      }

      const code = url.searchParams.get('code') || ''
      if (!code || code.length > 2048) {
        respond(response, 400, 'That reply was incomplete', 'You can close this window and try again in the program.')
        settle(refusal('GOOGLE_SIGNIN_NO_CODE', 'Google’s reply did not contain what is needed to finish the sign-in, so nobody was signed in.'))
        return
      }

      /* CONSUME ONCE, and shut the listener before the exchange rather than
         after it. An earlier version of this comment claimed the listener was
         "closed here"; it was not, and the gap was observable: `settled` only
         flips when the exchange RESOLVES, so for the whole duration of a
         network call the port stayed open and a second callback carrying the
         same state was accepted, answered 200, and started a second
         authorization exchange on the same one-time code. State is not a
         nonce — it survives its first use — so a replayed callback must be
         refused by having nothing left to talk to, not by being asked politely.
         Flipping the flag and calling shutdown() here makes the code path match
         what the comment always claimed. */
      if (callbackConsumed) {
        respond(response, 409, 'Already handled', 'That sign-in reply was already used. You can close this window.')
        return
      }
      callbackConsumed = true
      respond(response, 200, 'Signed in to ToolsEnabled', 'You can close this window and go back to the program.')
      shutdown()
      exchange(code, redirectUri, codeVerifier, nonce).then(settle, () => settle(refusal(
        'GOOGLE_SIGNIN_FAILED',
        'The Google sign-in did not complete on this computer, so nobody was signed in.',
      )))
    }

    function respond(response, status, title, message) {
      try {
        response.writeHead(status, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
          'x-content-type-options': 'nosniff',
        })
        response.end(completionPage(title, message))
      } catch { /* the person's browser has gone; the attempt still settles */ }
    }
  }

  /* Google's own error identifiers are short machine words. Shown to a person
     so the failure is nameable, bounded and stripped so a hostile redirect
     cannot use it to write a sentence of its own on our screen. */
  function sanitizeCode(value) {
    return String(value || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'no reason given'
  }

  /**
   * The exchange. The ONLY place the code_verifier leaves this process, and it
   * goes to Google over TLS in a POST body -- never in a URL, which would put it
   * in logs and in a Referer header.
   */
  async function exchange(code, redirectUri, codeVerifier, nonce) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
      /* NO client_secret. There is none to send: a Desktop-app client is a
         public client, and anything shipped in the artifact is public too. PKCE
         above is what replaces it. */
    })
    let response
    try {
      response = await fetchImpl(tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: body.toString(),
      })
    } catch {
      /* NO NETWORK. Named separately from "Google refused", because they are
         different facts and the person can act on the first one. */
      return refusal(
        'GOOGLE_SIGNIN_UNREACHABLE',
        'This computer could not reach Google to finish the sign-in, so nobody was signed in. Check the connection, or make an account on this computer instead.',
      )
    }
    let text
    try {
      text = await response.text()
    } catch {
      return refusal('GOOGLE_SIGNIN_FAILED', 'Google’s reply could not be read, so nobody was signed in.')
    }
    if (typeof text !== 'string' || text.length > MAX_TOKEN_RESPONSE_BYTES) {
      return refusal('GOOGLE_SIGNIN_FAILED', 'Google’s reply was not in a form this program will read, so nobody was signed in.')
    }
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      return refusal('GOOGLE_SIGNIN_FAILED', 'Google’s reply was not readable, so nobody was signed in.')
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return refusal('GOOGLE_SIGNIN_FAILED', 'Google’s reply was not readable, so nobody was signed in.')
    }
    if (response.ok !== true || typeof payload.id_token !== 'string') {
      /* `payload.error` is Google's own short identifier -- `invalid_grant`,
         `invalid_client` and so on. It is not a credential; the token fields in
         the same object ARE, and none of them is read here or anywhere else on
         this path. */
      return refusal(
        'GOOGLE_SIGNIN_REFUSED_BY_GOOGLE',
        `Google did not complete the sign-in (${sanitizeCode(payload.error)}), so nobody was signed in.`,
      )
    }

    const verified = await verify(payload.id_token, {
      clientId,
      nonce,
      now,
      fetchImpl,
      ...(jwksUri ? { jwksUri } : {}),
      ...(issuers ? { issuers } : {}),
    })
    /* THE VERIFIER'S REFUSAL IS THE ANSWER. It is not downgraded to a warning,
       not retried, and there is no path from here that signs somebody in
       anyway. `payload.access_token` and everything else in that object go out
       of scope on this line and are never written down. */
    if (!verified || verified.ok !== true) {
      return verified || refusal('GOOGLE_SIGNIN_FAILED', 'The sign-in reply could not be checked, so nobody was signed in.')
    }
    return Object.freeze({ ok: true, identity: verified.identity })
  }

  return Object.freeze({
    run,
    /** Where the browser was sent, while this attempt is still running.
     *
     * `null` once it has settled, so nothing can offer a link to a sign-in that
     * is already over. */
    get authorizationAddress() { return authorizationAddress },
    /** The Cancel button, and the only honest answer to a closed browser. */
    cancel() {
      settle(refusal('GOOGLE_SIGNIN_CANCELLED', 'The Google sign-in was cancelled, so nobody was signed in.'))
      return { ok: true }
    },
    get settled() { return settled },
  })
}

module.exports = {
  createGoogleSignIn,
  SIGNIN_SCOPES,
  REFUSED_SCOPE_MARKERS,
  REDIRECT_PATH,
  LOOPBACK_HOST,
  AUTHORIZATION_ENDPOINT,
  TOKEN_ENDPOINT,
  DEFAULT_TIMEOUT_MS,
}
