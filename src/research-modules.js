// The research workbench's module registry — the layer the layout engine
// does not have. src/metrics-layout.js arranges components; it has no idea of
// a component that is switched OFF. Research modules are researcher utilities
// a person turns on and off per workbench, so this registry owns that state
// and hands the engine only what is enabled.
//
// STORAGE — mc.research.modules, { v: 1, disabled: [id...] }. ABSENCE is the
// default face (every default-on module enabled), exactly the
// mc.metrics.layout idiom: an untouched user can never be pinned to a stale
// copy of the default. Unknown ids in the stored list are dropped on read, so
// a module that leaves the registry cannot haunt the store.
//
// WIRING FAILURES THROW — the createFleetTreeStore doctrine: a duplicate id,
// a missing title or a module without an element is a defect in the code that
// registered it, not a runtime condition to soothe. The one runtime-shaped
// input (the stored disabled list) degrades instead.

export const RESEARCH_MODULE_STORE_KEY = 'mc.research.modules'

function safeStorage(storage) {
  return {
    get() {
      try { return storage?.getItem(RESEARCH_MODULE_STORE_KEY) ?? null }
      catch { return null }
    },
    set(value) {
      try {
        if (value === null) storage?.removeItem(RESEARCH_MODULE_STORE_KEY)
        else storage?.setItem(RESEARCH_MODULE_STORE_KEY, value)
      } catch {}
    },
  }
}

export function createResearchRegistry({ modules, storage = null, onChange = () => {} }) {
  if (!Array.isArray(modules) || modules.length === 0) {
    throw new TypeError('createResearchRegistry needs a non-empty modules array')
  }
  const byId = new Map()
  for (const module of modules) {
    if (!module || typeof module.id !== 'string' || module.id.length === 0) {
      throw new TypeError('a research module needs a non-empty string id')
    }
    if (byId.has(module.id)) throw new TypeError(`duplicate research module id: ${module.id}`)
    if (typeof module.title !== 'string' || module.title.length === 0) {
      throw new TypeError(`research module ${module.id} needs a title`)
    }
    if (module.size !== 'full' && module.size !== 'slot') {
      throw new TypeError(`research module ${module.id} needs size 'full' or 'slot'`)
    }
    if (!module.el || typeof module.el.querySelector !== 'function') {
      throw new TypeError(`research module ${module.id} needs a built element`)
    }
    byId.set(module.id, module)
  }

  const store = safeStorage(storage)

  function readDisabled() {
    const raw = store.get()
    if (!raw) return new Set()
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.disabled)) return new Set()
      return new Set(parsed.disabled.filter(id => byId.has(id)))
    } catch { return new Set() }
  }

  let disabled = readDisabled()

  function persist() {
    if (disabled.size === 0) store.set(null)
    else store.set(JSON.stringify({ v: 1, disabled: [...disabled] }))
  }

  return {
    all: () => [...byId.values()],
    enabled: () => [...byId.values()].filter(module => !disabled.has(module.id)),
    isEnabled: id => byId.has(id) && !disabled.has(id),
    setEnabled(id, on) {
      if (!byId.has(id)) throw new TypeError(`unknown research module: ${id}`)
      const next = Boolean(on)
      const currently = !disabled.has(id)
      if (next === currently) return currently
      if (next) disabled.delete(id)
      else disabled.add(id)
      persist()
      onChange(id, next)
      return next
    },
    setAll(on) {
      const next = Boolean(on)
      const before = disabled.size
      disabled = next ? new Set() : new Set(byId.keys())
      if (disabled.size !== before) {
        persist()
        onChange(null, next)
      }
    },
  }
}
