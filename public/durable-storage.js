/* THE STORE THE REST OF THIS APPLICATION TALKS TO.
 *
 * Every settings module in src/ calls localStorage, and localStorage is keyed
 * to the origin. The origin here is http://127.0.0.1:<port> with <port> chosen
 * by a scan of 4601-4609 at launch, so relaunching while the old port is held
 * moved the whole application to an empty storage partition and looked exactly
 * like a factory reset. This file makes `localStorage` mean "the durable
 * settings file in userData" instead, so no port can partition it.
 *
 * WHY THE STORE MOVED INSTEAD OF FIFTEEN CALL SITES. Rewriting each module to
 * call a new API would have left the two states this codebase keeps getting
 * bitten by: some keys durable, some still origin-scoped, and no way to see
 * which from a call site. It would also miss every key added after the rewrite
 * -- the defect would simply regrow. Replacing the store fixes the whole class
 * at the boundary, and a module that has never heard of any of this is correct
 * by construction.
 *
 * WHY IT IS A CLASSIC SCRIPT IN THE HEAD. index.html reads the stored theme in
 * an inline script before first paint, deliberately, so that a black-theme user
 * does not get a white flash. That read happens before any module evaluates, so
 * a module-based install would be too late for the one read most visible to a
 * person. A classic script blocks and runs in document order, so this is
 * installed before the theme is read and before anything else exists.
 *
 * IN A PLAIN BROWSER THIS DOES NOTHING. `window.mcPrefs` is exposed only by the
 * desktop shell's preload. Under `vite dev` or `vite preview` there is no host
 * to be durable against, so the real localStorage is left exactly as it was --
 * the same rule window.mcSetup and window.mcAgent already follow.
 *
 * NAMED PROPERTY ACCESS IS NOT PROVIDED. Real Storage lets you write
 * `localStorage.foo`. Nothing in this application does -- every access goes
 * through getItem/setItem/removeItem -- and tools/test/durable-storage.test.mjs
 * fails if that ever stops being true, so this is an enforced invariant rather
 * than an assumption. Supporting it would mean a Proxy whose invariants are
 * subtle, to serve a legacy quirk with no caller.
 */
;(function installDurableStorage() {
  var bridge = window.mcPrefs
  if (!bridge || bridge.available !== true) return

  /* MIGRATION HAPPENS HERE, BEFORE THE GLOBAL IS REPLACED, AND IN THIS
     DOCUMENT.
     An install that predates this file has its settings in the browser
     partition for this origin, and this is the last moment they are reachable:
     `window.localStorage` is still the real one on the line below.

     It is done here rather than in the preload because the preload runs
     against the initial empty document, whose storage is NOT this origin's.
     Measured on the packaged upgrade path before this moved: a legacy install
     holding two real settings on 4601 was read as zero entries, and the origin
     was then marked as migrated -- stranding them for good. So the entries are
     read first, and the host is told to mark the origin ONLY once that read
     has actually succeeded. A read that throws leaves the origin unmarked, and
     a later launch tries again. */
  /* WHAT THE PERSON IS OWED IF THEIR SETTINGS DID NOT LOAD.
   *
   * The store beneath this preserves a settings file it cannot read instead of
   * replacing it. That stops the data loss and, on its own, nothing else: the
   * app still opens wearing none of the choices they made, which from where
   * they sit is exactly the silent factory reset it replaced. So the facts are
   * carried here and published, and src/settings-recovery-notice.js turns them
   * into a sentence on the screen.
   *
   * `preservedAt` ARRIVES LATE, ON PURPOSE. The unreadable file is only moved
   * when a write actually happens -- deliberately, because a file that was only
   * transiently unreadable is recovered intact by the next launch's retrying
   * read, and moving it eagerly would displace a record that was never damaged.
   * So at boot this is usually null and the notice says the file is still in
   * place; the first write returns the dated path and the notice updates.
   */
  var notice = {
    damaged: typeof bridge.damaged === 'string' ? bridge.damaged : null,
    file: typeof bridge.file === 'string' ? bridge.file : null,
    preservedAt: typeof bridge.preservedAt === 'string' ? bridge.preservedAt : null,
  }
  var listeners = []
  function readNotice() {
    return { damaged: notice.damaged, file: notice.file, preservedAt: notice.preservedAt }
  }
  /* A listener that throws must not take the write down with it. The notice is
     an explanation; a broken explanation is not worth failing a save over. */
  function announce() {
    var snapshot = readNotice()
    for (var index = 0; index < listeners.length; index += 1) {
      try { listeners[index](snapshot) } catch (error) { /* a notice is not worth a throw */ }
    }
  }
  function learnFrom(result) {
    if (!result || typeof result.preservedAt !== 'string') return
    if (result.preservedAt === notice.preservedAt) return
    notice.preservedAt = result.preservedAt
    announce()
  }

  var initial = bridge.values || {}
  if (bridge.drainRequired === true) {
    var entries = null
    try {
      var native = window.localStorage
      entries = []
      for (var index = 0; index < native.length; index += 1) {
        var storedKey = native.key(index)
        if (typeof storedKey !== 'string') continue
        var storedValue = native.getItem(storedKey)
        if (typeof storedValue === 'string') entries.push([storedKey, storedValue])
      }
    } catch (error) { entries = null }
    if (entries) {
      var drained = bridge.drain(entries)
      learnFrom(drained)
      if (drained && drained.ok && drained.values) initial = drained.values
    }
  }

  var cache = new Map()
  for (var name in initial) {
    if (Object.prototype.hasOwnProperty.call(initial, name)) cache.set(name, String(initial[name]))
  }

  /* A failed write THROWS, exactly as the platform does when storage is full.
     Silently dropping it would put the app back in the world this fix exists to
     leave: a person changes a setting, nothing complains, and the choice is not
     there next time. Every call site in src/ already wraps storage in
     try/catch, so a throw is contained where the platform's would have been. */
  function demand(result, action, key) {
    /* The news travels on the result of the write that caused it, so it is
       collected before the success check -- a refusal to overwrite an
       unreadable record is exactly the case a person most needs explained, and
       reading the notice only on the happy path would drop it there. */
    learnFrom(result)
    if (result && result.ok === true) return
    var reason = result && result.error && result.error.message
      ? result.error.message
      : 'the settings file could not be written'
    throw new Error('Could not ' + action + ' setting ' + JSON.stringify(key) + ': ' + reason)
  }

  /* ---- WHICH SETTINGS FOLLOW THE PERSON, NOT THE COMPUTER ----
   *
   * Everything above this line is per DEVICE, keyed by the raw setting name, and
   * that is correct for a window position or a text size. Three things are not:
   * the appearance choice (`mc.theme`), the settings on the settings page
   * (`mc.set.*`), and the purchase selection (`mc.checkout.v1`) belong to WHOEVER
   * IS SIGNED IN. Before this, all three were written to the one device record,
   * last-writer-wins, so a second person on the same Windows login opened the app
   * wearing the first person's theme, settings and ticked purchase lines. His
   * name and card were already safe; these were not.
   *
   * WHEN SIGNED IN, an account-scoped key is:
   *   - held in `accountOverlay`, the only thing `getItem` consults for it, so a
   *     value the account never set reads as ABSENT rather than as the device
   *     value or the previous account's -- which is the whole no-leak property;
   *   - written to shell/product-account.cjs's per-account partition through
   *     `mcAccount.putSetting`, the authoritative store re-read on the next
   *     sign-in and the file that makes <userData>/accounts/<id>.json exist;
   *   - mirrored SYNCHRONOUSLY into this device record under a per-account key
   *     (`acct:<id>:<name>`), so a settings click is durable the instant it
   *     returns exactly as localStorage.setItem was, and the settings FILE itself
   *     is partitioned instead of holding one shared record.
   *
   * WHEN SIGNED OUT (or when the shell cannot say who is signed in) it falls
   * through to the device record, unchanged. FAIL CLOSED: anything other than a
   * well-formed "signed in as <32-hex id>" resolves to signed out, so an
   * unreadable account state can never route a write into another person's name.
   *
   * The account is asked ASYNCHRONOUSLY, so this store starts signed out and is
   * told who is signed in by `refreshAccount()` -- at launch (a relaunch can come
   * up already signed in) and whenever src/views/account.js pokes the hook below.
   */
  var ACCOUNT = window.mcAccount && typeof window.mcAccount.current === 'function' ? window.mcAccount : null
  var accountId = null
  var accountOverlay = new Map()
  var hydrateToken = 0

  function isAccountScoped(name) {
    return name === 'mc.theme' || name === 'mc.checkout.v1' || name.indexOf('mc.set.') === 0
  }
  function namespaced(id, name) { return 'acct:' + id + ':' + name }

  /* The authoritative per-account write. Asynchronous and best-effort: the
     synchronous device mirror above already made the value durable for this run,
     and a rejected invoke must not throw into a settings click. A `null` value
     removes the key, which is how a setting returned to its default clears. */
  function putToPartition(name, value) {
    if (!ACCOUNT || typeof ACCOUNT.putSetting !== 'function') return
    try { Promise.resolve(ACCOUNT.putSetting(name, value)).catch(function () {}) }
    catch (error) { /* the bridge went away; the device mirror already holds it */ }
  }

  /* The theme is painted once at load and only re-read on a click, so a change
     of account has to re-apply it or a person keeps the previous account's
     appearance until they touch the control. The settings page and the checkout
     re-read localStorage every time they mount, so they need no help here; the
     event lets a currently-mounted view refresh itself if it wants to. */
  function reapplyAfterAccountChange() {
    var raw = accountId !== null
      ? (accountOverlay.has('mc.theme') ? accountOverlay.get('mc.theme') : null)
      : (cache.has('mc.theme') ? cache.get('mc.theme') : null)
    var theme = raw === 'tan' || raw === 'black' ? raw : 'white'
    try { window.document.documentElement.dataset.theme = theme } catch (error) { /* no DOM under test */ }
    try {
      if (typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
        window.dispatchEvent(new window.CustomEvent('mc:account-storage-rehydrated', { detail: { theme: theme } }))
      }
    } catch (error) { /* nobody is listening */ }
  }

  async function refreshAccount() {
    if (!ACCOUNT) return
    var token = ++hydrateToken
    var id = null
    try {
      var current = await ACCOUNT.current()
      if (current && current.signedIn === true && current.account
          && typeof current.account.id === 'string' && /^[0-9a-f]{32}$/.test(current.account.id)) {
        id = current.account.id
      }
    } catch (error) { id = null } // fail closed: any unreadable state is signed out
    if (token !== hydrateToken) return // a newer change is already in flight
    if (id === null) {
      accountId = null
      accountOverlay = new Map()
      reapplyAfterAccountChange()
      return
    }
    /* Built from the authoritative partition first -- this is what carries a
       first account's adopted settings, which live only there -- then the device
       mirror wins for any key it also holds, so a putSetting that never landed is
       still covered by the synchronous write. */
    var overlay = new Map()
    try {
      var data = typeof ACCOUNT.data === 'function' ? await ACCOUNT.data() : null
      if (data && data.ok === true && Array.isArray(data.settingKeys) && typeof ACCOUNT.getSetting === 'function') {
        for (var i = 0; i < data.settingKeys.length; i += 1) {
          var key = data.settingKeys[i]
          if (typeof key !== 'string' || !isAccountScoped(key)) continue
          try {
            var got = await ACCOUNT.getSetting(key)
            if (got && got.ok === true && typeof got.value === 'string') overlay.set(key, got.value)
          } catch (error) { /* one unreadable key does not empty the account */ }
        }
      }
    } catch (error) { /* an unreadable partition falls through to the device mirror */ }
    if (token !== hydrateToken) return
    var prefix = 'acct:' + id + ':'
    cache.forEach(function (value, storedKey) {
      if (storedKey.indexOf(prefix) !== 0) return
      var bare = storedKey.slice(prefix.length)
      if (isAccountScoped(bare)) overlay.set(bare, value)
    })
    accountId = id
    accountOverlay = overlay
    reapplyAfterAccountChange()
  }

  var storage = {
    getItem: function getItem(key) {
      var name = String(key)
      if (accountId !== null && isAccountScoped(name)) {
        return accountOverlay.has(name) ? accountOverlay.get(name) : null
      }
      return cache.has(name) ? cache.get(name) : null
    },
    setItem: function setItem(key, value) {
      var name = String(key)
      var text = String(value)
      if (accountId !== null && isAccountScoped(name)) {
        var mirror = namespaced(accountId, name)
        demand(bridge.write(mirror, text), 'save', name)
        cache.set(mirror, text)
        accountOverlay.set(name, text)
        putToPartition(name, text)
        return
      }
      demand(bridge.write(name, text), 'save', name)
      cache.set(name, text)
    },
    removeItem: function removeItem(key) {
      var name = String(key)
      if (accountId !== null && isAccountScoped(name)) {
        var mirror = namespaced(accountId, name)
        demand(bridge.remove(mirror), 'remove', name)
        cache.delete(mirror)
        accountOverlay.delete(name)
        putToPartition(name, null)
        return
      }
      demand(bridge.remove(name), 'remove', name)
      cache.delete(name)
    },
    clear: function clear() {
      demand(bridge.clear(), 'clear', '(all settings)')
      cache.clear()
    },
    key: function key(index) {
      var position = Number(index)
      if (!Number.isInteger(position) || position < 0) return null
      var keys = Array.from(cache.keys())
      return position < keys.length ? keys[position] : null
    },
  }
  Object.defineProperty(storage, 'length', {
    get: function () { return cache.size },
    enumerable: true,
  })

  /* `configurable: true` so that a future owner of this file can replace the
     store again without a reload being the only way out. It is not writable:
     an accidental assignment to window.localStorage elsewhere should fail
     loudly rather than quietly restore the origin-scoped store and resurrect
     the defect. */
  Object.defineProperty(window, 'localStorage', {
    value: storage,
    configurable: true,
    writable: false,
  })

  /* EXPOSED SEPARATELY FROM localStorage, because it is not storage. A module
     that wants to explain the state of the settings file asks here;
     src/settings-recovery-notice.js is the only caller, and in a plain browser
     this global is absent along with the rest of the shell -- so that module
     renders nothing rather than guessing. */
  Object.defineProperty(window, 'mcPrefsNotice', {
    value: Object.freeze({
      read: readNotice,
      subscribe: function subscribe(listener) {
        if (typeof listener !== 'function') return function () {}
        listeners.push(listener)
        return function unsubscribe() {
          var at = listeners.indexOf(listener)
          if (at >= 0) listeners.splice(at, 1)
        }
      },
    }),
    configurable: true,
    writable: false,
  })

  /* THE HOOK THE SIGN-IN SCREEN POKES. src/views/account.js calls this after a
     sign-in, sign-out, create, or password change, so the account overlay and
     the theme follow who is signed in without a reload. In a plain browser
     mcAccount is absent, this stays inert, and localStorage is per device as it
     always was. */
  Object.defineProperty(window, 'mcDurableStorage', {
    value: Object.freeze({
      onAccountChanged: function () { try { refreshAccount() } catch (error) { /* inert without a shell */ } },
    }),
    configurable: true,
    writable: false,
  })

  /* A relaunch can come up already signed in -- the session persists -- so the
     overlay is hydrated once at start rather than only on the next sign-in. */
  if (ACCOUNT) { try { refreshAccount() } catch (error) { /* inert without a shell */ } }
})()
