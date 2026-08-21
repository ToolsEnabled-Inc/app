'use strict'

/* WHERE THE GOOGLE SIGN-IN APPLICATION ID COMES FROM, AND WHAT HAPPENS WHEN
 * THERE ISN'T ONE.
 *
 * A Google OAuth client id identifies THIS APPLICATION to Google. It is public
 * by construction: it travels in a URL the browser opens, so every customer and
 * every proxy sees it. Shipping it inside the artifact is correct and is what
 * Google's Desktop-app client type expects.
 *
 * THE CLIENT SECRET. THIS FILE USED TO REFUSE ONE, AND THAT WAS MEASURED WRONG.
 *
 * The refusal rested on a factual claim -- that Google's Desktop-app client type
 * "issues no usable secret" and that PKCE replaces it. Google's own servers say
 * otherwise. Asked to exchange an authorization code for a Desktop-app client,
 * with a correct PKCE S256 verifier and no secret, Google answers:
 *
 *     HTTP 400  {"error":"invalid_request",
 *                "error_description":"client_secret is missing."}
 *
 * measured against this product's real client on 2026-08-11. Google documents
 * the same thing: the client_secret exemption in "OAuth 2.0 for iOS & Desktop
 * Apps" names Android, iOS and Chrome clients only, and Desktop is not among
 * them. PKCE is required and is not a substitute. A build that refuses to carry
 * a secret therefore cannot complete a single real sign-in -- the refusal did
 * not protect anybody, it just moved the failure to the last step of the flow,
 * where a customer meets it instead of a reviewer.
 *
 * SO WHAT IS THIS "SECRET", REALLY. Google's own answer, for installed apps:
 * "the client secret is obviously not treated as a secret". It is a second
 * public identifier for the application, and it is shipped inside every desktop
 * program that signs in with Google -- gcloud and rclone are the obvious ones.
 * It grants nothing on its own: it names the application, and PKCE proves the
 * exchange comes from the process that started the sign-in.
 *
 * WHAT THAT DOES NOT LICENCE. It is still per-application. A shipped product
 * must carry a client registered FOR IT and for identity scopes only -- never a
 * client that also holds a person's Drive, Gmail or Calendar grants, because
 * publishing that client's identifiers hands every customer the application
 * identity that those grants were issued to. See docs/GOOGLE-SIGN-IN-SETUP.md.
 *
 * It is never printed, never logged, never returned to a renderer, and never put
 * in a refusal message -- only the fact of its presence is reportable.
 *
 * THE ABSENCE CASE IS THE IMPORTANT ONE, and it is the state this machine is in
 * until the owner registers the client. NO CLIENT ID MUST NOT MEAN "sign in
 * anyway", must not mean a hidden button, and must not mean a button that fails
 * with a shrug. It means: the Google option is SHOWN, DISABLED, and says in a
 * sentence that this copy has not been given its Google application id yet --
 * and the local account, which works today, is offered instead. A person is
 * never left on a screen with nothing that works.
 *
 * ORDER, and why. Environment first (a developer or a test run), then the
 * per-installation file under userData (what the owner can write without
 * rebuilding anything), then the shipped default in the artifact. Later sources
 * do not override earlier ones; the first usable one wins, and which one it was
 * is reported, so a screen can say where the id came from.
 */

const fs = require('node:fs')
const path = require('node:path')

const CONFIG_FILENAME = 'google-signin.json'
const ENVIRONMENT_KEY = 'TOOLSENABLED_GOOGLE_CLIENT_ID'
const ENVIRONMENT_SECRET_KEY = 'TOOLSENABLED_GOOGLE_CLIENT_SECRET'
const MAX_CONFIG_BYTES = 16 * 1024

/* Google's own format for a client id: a project number, a dash, an opaque
   label, then the fixed host. Checked rather than accepted as any string,
   because the failure a loose check produces is a browser window opening on a
   Google error page with no explanation on our side. */
const CLIENT_ID_PATTERN = /^[0-9]{1,30}-[0-9a-z]{1,80}\.apps\.googleusercontent\.com$/

/* The spellings a Desktop-app client secret arrives under. Google's own
   downloaded client_secret.json calls it `client_secret`; this file's own
   settings call it `clientSecret`, to match `clientId`. Both are read; `secret`
   is accepted too because it is what a person types. Only the FIRST one present
   is used, in this order, so a file carrying two never silently picks one. */
const SECRET_KEYS = Object.freeze(['clientSecret', 'client_secret', 'secret'])

/* Long enough for every secret format Google has issued (the current ones are
   `GOCSPX-` plus 28 characters); short enough that a file cannot smuggle a
   payload through this field. Whitespace is refused because a secret pasted with
   a stray newline fails at Google with an error nobody can read backwards. */
const MAX_CLIENT_SECRET_LENGTH = 256

function readClientSecret(source) {
  for (const key of SECRET_KEYS) {
    const raw = source[key]
    if (raw === undefined || raw === null) continue
    if (typeof raw !== 'string') {
      return refusal('GOOGLE_SIGNIN_CLIENT_SECRET_INVALID', `The Google sign-in setting "${key}" is not text, so Google sign-in was not offered.`)
    }
    const value = raw.trim()
    if (!value) continue
    /* THE VALUE IS NEVER IN THE MESSAGE. Only the key name, which is not one. */
    if (value.length > MAX_CLIENT_SECRET_LENGTH || /\s/.test(value)) {
      return refusal('GOOGLE_SIGNIN_CLIENT_SECRET_INVALID', `The Google sign-in setting "${key}" is not in the form Google issues, so Google sign-in was not offered.`)
    }
    return { ok: true, clientSecret: value }
  }
  return { ok: true, clientSecret: '' }
}

function refusal(code, reason) {
  return Object.freeze({ ok: false, code, reason })
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * A test identity provider, declared out loud or not at all.
 *
 * WHY THIS EXISTS. The real flow cannot be exercised end to end on a machine
 * that has no client id yet, and "it passed the unit tests" is not evidence that
 * a packaged product signs anybody in. So the endpoints can be repointed at a
 * local provider -- and the moment they are, the product SAYS SO on the sign-in
 * screen and in every result, because a screenshot of a test run that looks
 * identical to a real one is worse than no screenshot.
 *
 * IT CANNOT BE ENTERED BY ACCIDENT. All four endpoints must be present, all must
 * be loopback, and the file must carry the explicit acknowledgement below. Any
 * partial declaration is refused outright rather than half-applied, because a
 * half-applied override is one that sends a real Google code to a local port.
 */
function readTestProvider(value) {
  if (value === undefined || value === null) return { ok: true, testProvider: null }
  if (!isPlainObject(value)) {
    return refusal('GOOGLE_SIGNIN_CONFIG_INVALID', 'The Google sign-in settings on this computer describe a test provider in a form this program cannot read, so Google sign-in was not started.')
  }
  if (value.iUnderstandThisIsNotGoogle !== true) {
    return refusal(
      'GOOGLE_SIGNIN_TEST_PROVIDER_UNACKNOWLEDGED',
      'The Google sign-in settings point somewhere other than Google without saying so, so Google sign-in was not started.',
    )
  }
  const fields = ['authorizationEndpoint', 'tokenEndpoint', 'jwksUri', 'issuer']
  const resolved = {}
  for (const field of fields) {
    const raw = value[field]
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 500) {
      return refusal('GOOGLE_SIGNIN_TEST_PROVIDER_INCOMPLETE', `The test identity provider does not name ${field}, so Google sign-in was not started.`)
    }
    let url
    try { url = new URL(raw) } catch {
      return refusal('GOOGLE_SIGNIN_TEST_PROVIDER_INCOMPLETE', `The test identity provider's ${field} is not an address, so Google sign-in was not started.`)
    }
    /* LOOPBACK ONLY. A test override that can name any host on the internet is
       not a test seam, it is a way to point a shipped product's sign-in at
       somebody else's server. */
    if (field !== 'issuer' && url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') {
      return refusal(
        'GOOGLE_SIGNIN_TEST_PROVIDER_NOT_LOOPBACK',
        'A test identity provider may only run on this computer, so Google sign-in was not started.',
      )
    }
    resolved[field] = raw
  }
  return { ok: true, testProvider: Object.freeze(resolved) }
}

function readConfigFile(filePath) {
  let raw
  try {
    raw = fs.readFileSync(filePath)
  } catch (error) {
    /* ABSENT IS ABSENT, and it is not an error: most installations will never
       have this file. Anything OTHER than absent -- a permissions refusal, a
       directory where a file should be -- is reported, because "we could not
       read the settings" and "there are no settings" are different facts and
       only one of them is the customer's normal state. */
    if (error && error.code === 'ENOENT') return { ok: true, absent: true }
    return refusal('GOOGLE_SIGNIN_CONFIG_UNREADABLE', 'The Google sign-in settings on this computer could not be read, so Google sign-in was not offered.')
  }
  if (raw.length > MAX_CONFIG_BYTES) {
    return refusal('GOOGLE_SIGNIN_CONFIG_UNREADABLE', 'The Google sign-in settings file is larger than this program will read, so Google sign-in was not offered.')
  }
  let parsed
  try {
    parsed = JSON.parse(raw.toString('utf8'))
  } catch {
    return refusal('GOOGLE_SIGNIN_CONFIG_INVALID', 'The Google sign-in settings on this computer are not readable, so Google sign-in was not offered.')
  }
  if (!isPlainObject(parsed)) {
    return refusal('GOOGLE_SIGNIN_CONFIG_INVALID', 'The Google sign-in settings on this computer are not in a form this program understands, so Google sign-in was not offered.')
  }
  const clientId = typeof parsed.clientId === 'string' ? parsed.clientId.trim() : ''
  if (!clientId) return { ok: true, absent: true }
  if (!CLIENT_ID_PATTERN.test(clientId)) {
    return refusal(
      'GOOGLE_SIGNIN_CLIENT_ID_INVALID',
      'The Google sign-in application id on this computer is not in the form Google issues, so Google sign-in was not offered. It should end in .apps.googleusercontent.com.',
    )
  }
  /* THE SECRET COMES FROM THE SAME FILE AS THE ID IT BELONGS TO, always. An id
     from one source paired with a secret from another is a pairing nobody chose,
     and Google answers it with `invalid_client` -- a failure whose cause is
     invisible from either file on its own. */
  const secret = readClientSecret(parsed)
  if (secret.ok !== true) return secret
  const provider = readTestProvider(parsed.testProvider)
  if (provider.ok !== true) return provider
  return {
    ok: true,
    absent: false,
    clientId,
    clientSecret: secret.clientSecret,
    testProvider: provider.testProvider,
  }
}

/**
 * Resolve the Google sign-in configuration for this installation.
 *
 * Never throws. Every failure is a stated refusal with a code and a sentence,
 * and every refusal means the SAME thing to the caller: Google sign-in is not
 * available, say why, and offer the account on this computer.
 */
function resolveGoogleSignInConfig({
  userDataDir = null,
  appRoot = null,
  env = process.env,
} = {}) {
  const fromEnvironment = typeof env?.[ENVIRONMENT_KEY] === 'string' ? env[ENVIRONMENT_KEY].trim() : ''
  if (fromEnvironment) {
    if (!CLIENT_ID_PATTERN.test(fromEnvironment)) {
      return refusal(
        'GOOGLE_SIGNIN_CLIENT_ID_INVALID',
        `The ${ENVIRONMENT_KEY} setting on this computer is not a Google application id, so Google sign-in was not offered.`,
      )
    }
    /* Same source, same pair: an id named on the environment takes its secret
       from the environment or from nowhere. */
    const environmentSecret = readClientSecret({ clientSecret: env?.[ENVIRONMENT_SECRET_KEY] })
    if (environmentSecret.ok !== true) {
      return refusal('GOOGLE_SIGNIN_CLIENT_SECRET_INVALID', `The ${ENVIRONMENT_SECRET_KEY} setting on this computer is not in the form Google issues, so Google sign-in was not offered.`)
    }
    return Object.freeze({
      ok: true,
      clientId: fromEnvironment,
      clientSecret: environmentSecret.clientSecret,
      source: 'environment',
      testProvider: null,
    })
  }

  const candidates = []
  if (typeof userDataDir === 'string' && userDataDir) candidates.push({ source: 'installation', file: path.join(userDataDir, CONFIG_FILENAME) })
  if (typeof appRoot === 'string' && appRoot) candidates.push({ source: 'shipped', file: path.join(appRoot, 'config', CONFIG_FILENAME) })

  for (const candidate of candidates) {
    const read = readConfigFile(candidate.file)
    /* A file that EXISTS and is wrong stops the search. Falling through to the
       next source would silently use a different application id than the one
       the person just edited, and they would have no way to tell. */
    if (read.ok !== true) return read
    if (read.absent) continue
    return Object.freeze({
      ok: true,
      clientId: read.clientId,
      clientSecret: read.clientSecret || '',
      source: candidate.source,
      testProvider: read.testProvider || null,
    })
  }

  /* THE ABSENCE. Stated as a fact with the next step in it, not as an error. */
  return refusal(
    'GOOGLE_SIGNIN_NOT_CONFIGURED',
    'This copy has not been given a Google sign-in application id yet, so signing in with Google is not available. Making an account on this computer works now and does the same job.',
  )
}

module.exports = {
  resolveGoogleSignInConfig,
  readConfigFile,
  readTestProvider,
  CONFIG_FILENAME,
  ENVIRONMENT_KEY,
  ENVIRONMENT_SECRET_KEY,
  CLIENT_ID_PATTERN,
  SECRET_KEYS,
  MAX_CLIENT_SECRET_LENGTH,
}
