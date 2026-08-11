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

  var storage = {
    getItem: function getItem(key) {
      var name = String(key)
      return cache.has(name) ? cache.get(name) : null
    },
    setItem: function setItem(key, value) {
      var name = String(key)
      var text = String(value)
      demand(bridge.write(name, text), 'save', name)
      cache.set(name, text)
    },
    removeItem: function removeItem(key) {
      var name = String(key)
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
})()
