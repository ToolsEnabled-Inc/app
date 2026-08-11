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

  var cache = new Map()
  var initial = bridge.values || {}
  for (var name in initial) {
    if (Object.prototype.hasOwnProperty.call(initial, name)) cache.set(name, String(initial[name]))
  }

  /* A failed write THROWS, exactly as the platform does when storage is full.
     Silently dropping it would put the app back in the world this fix exists to
     leave: a person changes a setting, nothing complains, and the choice is not
     there next time. Every call site in src/ already wraps storage in
     try/catch, so a throw is contained where the platform's would have been. */
  function demand(result, action, key) {
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
})()
