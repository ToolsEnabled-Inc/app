// Sandboxed Electron preloads cannot require a sibling preload. This file is
// therefore the shell's composed boundary: it preserves the existing chrome
// behavior and adds only the fleet-profile bridge below. Turning sandboxing
// off to reuse one file would make configuration convenience a security
// regression, which is a worse version of the productionization gap.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mcShell', {
  titlebarHeight: 36,
  getBridgeProof: () => ipcRenderer.invoke('mc-bridge-proof'),
  // The shell names the exact bridge it supervises so the renderer pins to it
  // instead of scanning localhost and trusting the first responder -- which is
  // how a squatter is handed this boot's proof. See mc-bridge-endpoint in
  // main.cjs and configuredBaseUrl() in src/mission-bridge.js.
  getBridgeEndpoint: () => ipcRenderer.invoke('mc-bridge-endpoint'),
  /* CONNECTING THIS COMPUTER TO AN ACCOUNT.
   *
   * The four verbs behind the "Connect this computer" screen. The bridge that
   * answers them is shell/device-claim.cjs, which spawns the payload's claim
   * CLI; the ceremony itself is the account service's, and the credential it
   * returns lands in the same vault the relay shell reads, which is what makes
   * a machine reachable from a signed-in browser at all.
   *
   * NO POLL TOKEN CROSSES THIS BOUNDARY. begin() keeps it in the main process
   * and poll() takes no argument, so a page cannot name a claim that is not
   * its own -- the same reason the bridge proof above is invoked rather than
   * handed over.
   *
   * DUPLICATED FROM shell/preload.cjs ON PURPOSE, and the duplication is the
   * whole point of this file: a sandboxed preload cannot require a sibling, so
   * THIS is the composed boundary main.cjs actually loads and the other file is
   * loaded by no window. The agent bridge below carries the same note, and
   * commit 1d44d35 ("Put the agent bridge in the preload the app actually
   * loads") is what happens when only the other file is edited: a green test
   * over a feature that does not exist on a real installation. It happened
   * again with this namespace. tools/test/preload-namespace-parity.test.mjs
   * now fails when the two disagree, so the third time is caught by a test
   * rather than by a person wondering why a button does nothing. */
  deviceClaim: Object.freeze({
    status: () => ipcRenderer.invoke('mc-device-claim:status'),
    begin: (request) => ipcRenderer.invoke('mc-device-claim:begin', request),
    poll: () => ipcRenderer.invoke('mc-device-claim:poll'),
    cancel: () => ipcRenderer.invoke('mc-device-claim:cancel'),
  }),
})

/* The agent bridge. BLOCKER 2 (R1162 non-author review) removed an earlier
   version of this exposure, and removing it was right at the time: the engine
   behind it was resolved from a hardcoded path into a private sibling checkout
   that shipped nowhere, so the control could only ever fail, and its failure
   path rendered that internal repo name into the DOM.

   It is re-established deliberately here, and it is not the old one:
   1. The engine path is configuration (MISSION_CONTROL_ENGINE), never a
      filesystem guess -- unconfigured fails closed instead of pretending.
   2. `availability()` lets the renderer ASK before it offers a control, so a
      build with no engine shows a stated-unavailable surface rather than a
      button guaranteed to fail.
   3. Nothing here can carry a path to the DOM: availability() replies
      {ok, code}, and the resolver's path-bearing message stays in main.

   It lives in THIS file, not shell/preload.cjs, for the reason stated at the
   top: this is the preload main.cjs actually loads. shell/preload.cjs is
   reachable from no window. */
contextBridge.exposeInMainWorld('mcAgent', Object.freeze({
  availability: () => ipcRenderer.invoke('mc-agent:availability', {}),
  /* What a session started here would be CONFINED to. Read-only, starts
     nothing, and the reason the Start control can finally describe the session
     it is about to start instead of reciting a sentence written before the
     permission level reached a running agent. Returns {ok:false, code} rather
     than a path on every failure, exactly like availability(). */
  confinement: () => ipcRenderer.invoke('mc-agent:confinement'),
  /* The tool surface by NAME, for the research page's tool checkboxes. Same
     posture as confinement(): read-only, registry identifiers only, and
     {ok:false, code} on every failure. */
  tools: () => ipcRenderer.invoke('mc-agent:tools'),
  /* Which tiers this installation can really start, from the shell rather than
     from a list the renderer keeps. The caller must fall back to codex-only on
     any failure; see the note on the handler in shell/main.cjs. */
  startableTiers: () => ipcRenderer.invoke('mc-agent:startable-tiers'),
  /* The messages this computer has already written down, for the comms page.
     Read-only, starts nothing, and carries no path: a message is
     {id, sender, at, text} with `at` RFC3339 and `sender` the circle name. A
     build whose payload cannot read them answers {ok:false, reason} -- a
     sentence to show, not a rejection to catch. */
  localMessages: request => ipcRenderer.invoke('mc-agent:local-messages', request || {}),
  /* Read-only, and the reason the home screen has something true to show on a
     computer with nothing else connected. Returns bounded records of what has
     run here: sequence, time, action. No path, no hash, no signature -- see
     history() in shell/spawn-record.cjs for why each is absent. */
  history: request => ipcRenderer.invoke('mc-agent:history', request || {}),
  /* What the turns on this computer COST, from the same kind of signed record
     and under the same rules: read-only, bounded figures, no path, no hash, no
     signature. Its own channel rather than a field on history() because it is
     its own chain in its own file -- a turn is not a run, and a busy session's
     turns must not push the runs out of the window history() can read. See
     shell/usage-record.cjs. */
  usage: request => ipcRenderer.invoke('mc-agent:usage', request || {}),
  start: request => ipcRenderer.invoke('mc-agent:start', request),
  send: request => ipcRenderer.invoke('mc-agent:send', request),
  /* File one standing request (the /Request family). Ids and words only, in
     both directions: the reply is {ok, id, scope, key} for the confirmation
     sentence, and no path crosses this bridge. */
  request: request => ipcRenderer.invoke('mc-agent:request', request),
  /* Read one scope's standing requests back. The same vocabulary and the same
     silence about paths: {scope, key} in, {ok, exists, entries:[{id, words}]}
     out. A READ ONLY -- removing a rule is a hand edit of the person's own
     ledger file, which is the design recorded in the file's own header. */
  requests: request => ipcRenderer.invoke('mc-agent:requests', request),
  /* Native dialogs, driven by the person. pickAttachment issues the chosen
     path to that session's image allowlist in main; pickMention returns a
     path the renderer inserts as TEXT. Both answer {ok, path|null}. */
  pickAttachment: request => ipcRenderer.invoke('mc-agent:pick-attachment', request),
  pickMention: request => ipcRenderer.invoke('mc-agent:pick-mention', request),
  /* Session profiles: named working folders the person picked through the OS
     dialog. The renderer only ever handles ids; paths stay main-side. */
  profiles: () => ipcRenderer.invoke('mc-agent:profiles'),
  profileCreate: request => ipcRenderer.invoke('mc-agent:profile-create', request),
  profileRemove: request => ipcRenderer.invoke('mc-agent:profile-remove', request),
  interrupt: request => ipcRenderer.invoke('mc-agent:interrupt', request),
  /* Fork this session's thread at one of your own turns and continue from
     there — proven by tools/agent-rewind-probe.mjs before it shipped. */
  rewind: request => ipcRenderer.invoke('mc-agent:rewind', request),
  /* Change a running agent's thinking depth, and ask the engine what depths
     it really offers. Both are the provider's answers, not ours. */
  setEffort: request => ipcRenderer.invoke('mc-agent:effort', request),
  models: request => ipcRenderer.invoke('mc-agent:models', request || {}),
  /* Answer a pending approval with one of the decisions the request itself
     named. Nothing fires approvals today (policy is 'never' at every tier);
     the reply path exists first, by design. */
  answerApproval: request => ipcRenderer.invoke('mc-agent:approval-answer', request),
  close: request => ipcRenderer.invoke('mc-agent:close', request),
  /* Returns its own unsubscribe. A surface that mounts per navigation must be
     able to detach exactly its own listener, or every visit to an agent page
     leaves another one attached to the channel. */
  onEvent: listener => {
    if (typeof listener !== 'function') throw new TypeError('onEvent requires a listener function')
    const forward = (_event, packet) => { listener(packet) }
    ipcRenderer.on('mc-agent:event', forward)
    return () => { ipcRenderer.removeListener('mc-agent:event', forward) }
  },
}))

/* THE THREE ASSISTANT PROGRAMS, AS THIS COMPUTER ACTUALLY HAS THEM.
 *
 * Its own name rather than a fourth method on mcAgent, because it is not about
 * an agent session: it answers a question about the MACHINE that is true before
 * any session exists and stays true after one ends. A person reads it on the
 * guide page while deciding whether to install anything at all.
 *
 * Read-only, and there is deliberately no setter beside it. This product never
 * asks for a provider sign-in and never keeps one; the only thing it may know is
 * whether one is there. A `signIn()` on this bridge would be the first step
 * toward handling a credential, and the absence of it is the design. */
/* The person's OWN accounts for those programs live on the same bridge, for the
   same reason: they are facts about the machine rather than about a session, and
   the guide page reads them beside the presence line. Three thin arrows and
   nothing else -- there is still no signIn(), and its absence is still the
   design. accountAdd() records a name and a folder; the SIGNING IN happens in
   the provider's own program, from a command the person runs themselves. */
/* The sign-in arrows are the deliberate exception to "no signIn() here", and
   the exception is narrower than the name suggests: loginStart() asks the main
   process to run the PROVIDER'S OWN login program, hidden, with stdin closed.
   No credential, code or key can cross this bridge in either direction -- what
   comes back is bounded prose, an https link, and an exit number, and nothing
   the renderer sends can reach the child's input, because the child has none.
   The defect this closes: 1.0.20 told its first external user to run
   "codex login" in the window the install had just finished in, and that
   window answered "'codex' is not recognized". */
contextBridge.exposeInMainWorld('mcProviders', Object.freeze({
  presence: () => ipcRenderer.invoke('mc-providers:presence'),
  accounts: () => ipcRenderer.invoke('mc-accounts:list'),
  accountAdd: request => ipcRenderer.invoke('mc-accounts:add', request),
  accountRemove: request => ipcRenderer.invoke('mc-accounts:remove', request),
  loginStart: request => ipcRenderer.invoke('mc-provider-login:start', request),
  loginStop: request => ipcRenderer.invoke('mc-provider-login:stop', request),
  loginOpenUrl: request => ipcRenderer.invoke('mc-provider-login:open-url', request),
  installStart: request => ipcRenderer.invoke('mc-provider-login:install', request),
  /* Returns its own unsubscribe, the same shape mcAgent.onEvent gives and for
     the same reason: the guide mounts per navigation, and each visit must be
     able to detach exactly its own listener. */
  onLoginEvent: listener => {
    if (typeof listener !== 'function') throw new TypeError('onLoginEvent requires a listener function')
    const forward = (_event, packet) => { listener(packet) }
    ipcRenderer.on('mc-provider-login:event', forward)
    return () => { ipcRenderer.removeListener('mc-provider-login:event', forward) }
  },
}))

/* Fleet data is resolved while the renderer's module graph is evaluating. An
   async-only bridge paints the sample first and leaves sim.js, vocab.js and
   the ledger frozen on it even after userData answers. The one synchronous
   operation is a bounded read; every mutation remains an explicit invoke. */
const bootstrap = ipcRenderer.sendSync('mc-fleet-profile:bootstrap')
contextBridge.exposeInMainWorld('mcFleetProfile', Object.freeze({
  bootstrap,
  migrateLegacy: profile => ipcRenderer.sendSync('mc-fleet-profile:migrate-legacy', profile),
  save: profile => ipcRenderer.invoke('mc-fleet-profile:save', profile),
  reset: () => ipcRenderer.invoke('mc-fleet-profile:reset'),
  importFile: () => ipcRenderer.invoke('mc-fleet-profile:import-file'),
  exportFile: profile => ipcRenderer.invoke('mc-fleet-profile:export-file', profile),
  chooseDirectory: () => ipcRenderer.invoke('mc-fleet-profile:choose-directory'),
  probe: profile => ipcRenderer.invoke('mc-fleet-profile:probe', profile),
}))

/* THE DECLARED ORGANISATION.
 *
 * Every one of these is an explicit invoke, including the read. There is no
 * synchronous bootstrap here on purpose: the fleet profile has one because the
 * renderer's module graph needs it before first paint, and the org does not --
 * the agent page asks for it when it mounts, and a page that has not been
 * opened should not be paying for a disk read at launch.
 *
 * Nothing here decides anything. Each call is forwarded to a main-process
 * handler that checks the sender is this application's own main frame, and the
 * rules about what a legal organisation is live in the payload. This file is a
 * list of channel names. */
contextBridge.exposeInMainWorld('mcOrg', Object.freeze({
  read: () => ipcRenderer.invoke('mc-org:read'),
  reparent: request => ipcRenderer.invoke('mc-org:reparent', request),
  assignRole: request => ipcRenderer.invoke('mc-org:assign-role', request),
  createRole: request => ipcRenderer.invoke('mc-org:create-role', request),
  editRole: request => ipcRenderer.invoke('mc-org:edit-role', request),
  resetRole: request => ipcRenderer.invoke('mc-org:reset-role', request),
  reset: () => ipcRenderer.invoke('mc-org:reset'),
  exportOrg: () => ipcRenderer.invoke('mc-org:export'),
}))

/* THE SETTINGS STORE, AND THE ONE-TIME RESCUE OF THE OLD BROWSER COPY.
 *
 * Read SYNCHRONOUSLY, and this one is not a preference among equals: the theme
 * is read by an inline script in index.html before first paint, so an async
 * bridge would paint the wrong theme at every launch and correct itself
 * visibly. Writes are synchronous too, which is a deliberate match for the API
 * being replaced -- localStorage.setItem is synchronous and durable when it
 * returns, and the packaged proof for this fix force-kills the process between
 * launches specifically so a store that only flushed at exit could not pass.
 *
 * THE DRAIN IS NOT PERFORMED HERE. It was, and that was a real defect with
 * measured consequences -- see the note on `drain` below. This bridge only
 * reports whether one is needed and forwards the entries the page reads. */
const prefs = ipcRenderer.sendSync('mc-prefs:bootstrap')

contextBridge.exposeInMainWorld('mcPrefs', Object.freeze({
  /* `available` is what public/durable-storage.js checks before replacing the
     global. A shell that could not open its settings file reports false and
     the app keeps the browser store, which is the pre-fix behaviour rather
     than an app with no working storage at all. */
  available: Boolean(prefs && prefs.ok),
  values: Object.freeze(prefs && prefs.ok ? { ...prefs.values } : {}),
  drainRequired: Boolean(prefs && prefs.ok && prefs.drainRequired),
  /* WHY THE PAGE IS SHOWING DEFAULTS, AND WHERE THE OLD FILE WENT.
     A settings file that cannot be read is preserved rather than replaced, and
     that half of the fix is invisible: the person still opens an app wearing
     none of their choices. Without these three the only conclusion available to
     them is the one this whole store exists to stop -- that the software threw
     their settings away. `preservedAt` is null here on nearly every launch,
     because the file is only set aside when a write actually happens; the live
     value travels back on the write result and public/durable-storage.js
     carries it forward. */
  damaged: prefs && prefs.ok && typeof prefs.damaged === 'string' ? prefs.damaged : null,
  preservedAt: prefs && prefs.ok && typeof prefs.preservedAt === 'string' ? prefs.preservedAt : null,
  file: prefs && prefs.ok && typeof prefs.file === 'string' ? prefs.file : null,
  /* THE DRAIN IS PERFORMED BY THE PAGE, NOT HERE, AND THAT IS THE WHOLE POINT.
     This preload first ran the migration itself, reading window.localStorage
     from its own isolated world. Measured on the packaged upgrade path: a
     legacy install with two real settings on http://127.0.0.1:4601 was read as
     ZERO entries, because a preload executes against the initial empty
     document, whose storage is not the app origin's. The record written was
     {"values":{},"drainedOrigins":["http://127.0.0.1:4601"]} -- the origin
     marked as rescued while nothing had been rescued, which STRANDED those
     settings permanently instead of losing them recoverably. A fix that
     destroys settings is the defect wearing a different hat.

     public/durable-storage.js runs as a classic script inside the real
     document, where localStorage is the app origin's, and it calls this only
     after it has successfully read that store. Nothing marks an origin
     drained on a read that did not happen. */
  drain: entries => ipcRenderer.sendSync('mc-prefs:drain', { entries }),
  write: (key, value) => ipcRenderer.sendSync('mc-prefs:write', { key, value }),
  remove: key => ipcRenderer.sendSync('mc-prefs:remove', { key }),
  clear: () => ipcRenderer.sendSync('mc-prefs:clear'),
}))

/* The permission level. Read synchronously for the same reason the fleet
   profile is: src/main.js decides whether this launch shows the setup question
   or the fleet, and it decides that before the first paint. Setting the level
   stays an explicit invoke.

   `bootstrap` is present and `available: false` in a build with no capability
   payload, so the renderer can state that plainly instead of offering a button
   that is guaranteed to fail -- the same rule mcAgent.availability() follows.
   In a plain browser (vite dev, preview) window.mcSetup is absent entirely,
   which the renderer reads as "there is no machine here to configure". */
const setup = ipcRenderer.sendSync('mc-setup:bootstrap')
contextBridge.exposeInMainWorld('mcSetup', Object.freeze({
  bootstrap: setup,
  /* The consent rides with the level (owner, X4): for the widest level it says
     the risk was shown, in which words, and confirmed; the shell refuses that
     level without it. Null for every other level. */
  chooseTier: (tier, consent) => ipcRenderer.invoke('mc-setup:choose-tier', tier, consent),
  /* What the signed ledger holds about the widest level on this computer, so
     the Settings row can state a confirmation only when one is on record. */
  tierConsent: () => ipcRenderer.invoke('mc-setup:tier-consent'),
  /* The workspace question. Async, unlike `bootstrap`, and deliberately: the
     first-run gate has to know the permission level before the first paint, but
     nothing has to know the folder before the person has been asked about the
     level. A second synchronous read on startup would slow every launch to buy
     nothing. */
  workspaceState: () => ipcRenderer.invoke('mc-setup:workspace-state'),
  checkWorkspace: candidate => ipcRenderer.invoke('mc-setup:check-workspace', candidate),
  chooseWorkspace: () => ipcRenderer.invoke('mc-setup:choose-workspace'),
  recordWorkspaces: roots => ipcRenderer.invoke('mc-setup:record-workspaces', roots),
}))

/* The product account.
 *
 * ASYNC ONLY, unlike `mcSetup.bootstrap` and the fleet profile, and that is a
 * decision rather than an oversight. Both of those are read synchronously
 * because the router must know them before the first paint. Signed-in state is
 * not in that class: the app opens on the fleet either way, and the sign-in
 * surface is a screen a person navigates to. Making it a fourth `sendSync`
 * would put a keystore read and a file read on every launch to buy nothing.
 *
 * NOTHING THIS BRIDGE RETURNS IS A SECRET. There is no token to hold: the
 * session lives in the main process and `current()` answers with `signedIn`, a
 * display name and an expiry. A password travels INWARD from the form and never
 * comes back out, in a reply or in an error message.
 *
 * There is deliberately no method that SETS who is signed in. The audit
 * principal is read in the main process from the store; a page that could name
 * the principal would make the record worthless. */
contextBridge.exposeInMainWorld('mcAccount', Object.freeze({
  availability: () => ipcRenderer.invoke('mc-account:availability'),
  current: () => ipcRenderer.invoke('mc-account:current'),
  create: request => ipcRenderer.invoke('mc-account:create', request),
  signIn: request => ipcRenderer.invoke('mc-account:sign-in', request),
  /* SIGN IN WITH GOOGLE. Note that NONE of these takes an argument, and that is
     the whole design: the page asks for the flow to start, the main process
     runs it against the system browser, and the identity arrives from Google
     already verified. A page that could pass an email address in here would be
     a page that could sign in as anybody. */
  googleAvailability: () => ipcRenderer.invoke('mc-account:google-availability'),
  googleSignIn: () => ipcRenderer.invoke('mc-account:google-sign-in'),
  /* The address the browser was sent to, so a person whose browser did not open
     can open it themselves. Carries no credential; answers nothing once the
     attempt has settled. */
  googleUrl: () => ipcRenderer.invoke('mc-account:google-url'),
  googleCancel: () => ipcRenderer.invoke('mc-account:google-cancel'),
  signOut: () => ipcRenderer.invoke('mc-account:sign-out'),
  signOutEverywhere: () => ipcRenderer.invoke('mc-account:sign-out-everywhere'),
  changePassword: request => ipcRenderer.invoke('mc-account:change-password', request),
  /* The shown name, changeable for the life of the account. It carries no
     credential in either direction and it cannot move an account: which account
     is renamed is decided in the main process from the session, exactly like
     the audit principal, so a page cannot rename somebody else. */
  changeDisplayName: request => ipcRenderer.invoke('mc-account:change-display-name', request),
  /* WHAT BELONGS TO WHOEVER IS SIGNED IN. Note what is NOT here: no method
     takes an account id. Which account these read and write is decided in the
     main process from the session, for the same reason the audit principal is
     -- a page that could name the account could read anybody's settings. */
  data: () => ipcRenderer.invoke('mc-account:data'),
  getSetting: key => ipcRenderer.invoke('mc-account:setting-get', { key }),
  putSetting: (key, value) => ipcRenderer.invoke('mc-account:setting-put', { key, value }),
  /* Attachment names a vault KEY and never a value. There is no method here
     that reads a vault record, and adding one would be a different review. */
  attachPaymentMethod: request => ipcRenderer.invoke('mc-account:payment-attach', request),
  detachPaymentMethod: () => ipcRenderer.invoke('mc-account:payment-detach'),
  paymentPresence: () => ipcRenderer.invoke('mc-account:payment-presence'),
}))

/* REMOVING THIS COMPUTER'S DATA.
 *
 * TWO METHODS, AND NEITHER TAKES A PATH. Which directories are swept is decided
 * in the main process from `app.getPath('userData')` and the payload's own
 * installation root; a page that could name the directory would be a page that
 * could delete any folder on the computer, which is a remote-code-execution
 * primitive dressed as a settings control.
 *
 * `plan` is a READ. It measures and names what is there and destroys nothing, so
 * the screen can show a person what they are about to lose before they can lose
 * it. `erase` is the act. They are separate channels for that reason and must
 * stay separate: one call that measured and deleted would make the first press
 * the destructive one.
 *
 * NOTHING HERE RETURNS A SECRET. The replies are counts, directory paths, entry
 * names and outcomes. No file content is read, and the vault is named by its
 * path and never opened. */
contextBridge.exposeInMainWorld('mcLocalData', Object.freeze({
  plan: () => ipcRenderer.invoke('mc-reset:plan'),
  erase: () => ipcRenderer.invoke('mc-reset:erase'),
}))

/* THE INSTALLATION'S OWN SETTINGS -- the ones the capability layer enforces,
 * which live beside the machine record in this installation's directory and are
 * therefore outside a page's reach by design.
 *
 * This is NOT the settings page's other rows. Those are this window's own
 * preferences (theme, density, which screens read live data) and they belong in
 * the renderer's store. These four decide whether unattended work may run on
 * this computer, they are read by a different process, and until this channel
 * existed the product had no way to change them at all -- the research page
 * named a switch in Settings that Settings did not have.
 *
 * `read` is a read. `set` names one row and one value and can name nothing
 * else: shell/product-settings.cjs holds the list of rows this window may
 * write, and an id outside it is refused rather than written. */
contextBridge.exposeInMainWorld('mcSettings', Object.freeze({
  read: () => ipcRenderer.invoke('mc-settings:read'),
  set: (id, value) => ipcRenderer.invoke('mc-settings:set', { id, value }),
}))

function rgbToHex(rgb) {
  const match = rgb.match(/(\d+)[, ]+(\d+)[, ]+(\d+)/)
  if (!match) return '#fdfdfd'
  return `#${[match[1], match[2], match[3]].map(number => Number(number).toString(16).padStart(2, '0')).join('')}`
}

let settleTimer = null
function reportTheme() {
  const send = () => {
    const style = getComputedStyle(document.body)
    ipcRenderer.send('mc-theme', {
      theme: document.documentElement.dataset.theme || 'white',
      bg: rgbToHex(style.backgroundColor),
      ink: rgbToHex(style.color),
    })
  }
  /* Two passes matter because the page surface eases between themes. A lone
     next-frame read sampled the old colour and left the caption buttons stuck
     on the previous theme until the owner focused the window again. */
  requestAnimationFrame(send)
  clearTimeout(settleTimer)
  settleTimer = setTimeout(send, 600)
}

/* Native caption buttons are OS-drawn over this strip. The strip stays
   transparent so it inherits the renderer surface instead of maintaining a
   second palette that can drift from styles.css. */
const TITLEBAR_HEIGHT = 36
function injectTitlebar() {
  document.documentElement.classList.add('in-shell')
  document.body.classList.add('in-shell')
  const style = document.createElement('style')
  style.textContent = `
    #shell-titlebar {
      position: fixed; top: 0; left: 0; right: 0; height: ${TITLEBAR_HEIGHT}px;
      z-index: 200; -webkit-app-region: drag;
      display: flex; align-items: center; justify-content: center;
      border-bottom: 1px solid var(--line, rgba(128,128,128,0.18));
      font-size: 11px; font-weight: 600; letter-spacing: 0.14em;
      color: var(--ink-3, #888); user-select: none;
    }
    html.in-shell #stage { height: calc(100vh - ${TITLEBAR_HEIGHT}px); margin-top: ${TITLEBAR_HEIGHT}px; }
    html.in-shell .topbar { top: calc(14px + ${TITLEBAR_HEIGHT}px); }
    html.in-shell .drawer { top: calc(14px + ${TITLEBAR_HEIGHT}px); }
  `
  document.head.appendChild(style)
  const bar = document.createElement('div')
  bar.id = 'shell-titlebar'
  bar.textContent = 'TOOLSENABLED'
  document.body.prepend(bar)
}

window.addEventListener('DOMContentLoaded', () => {
  injectTitlebar()
  reportTheme()
  new MutationObserver(reportTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  // A throttled background frame heals as soon as the window returns.
  window.addEventListener('focus', reportTheme)
})
