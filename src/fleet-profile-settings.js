import {
  FLEET_PROFILE_RESOLUTION,
  parseFleetProfile,
  persistFleetProfile,
  resetFleetProfile,
  serializeFleetProfile,
  validateFleetProfile,
} from './fleet-profile.js'

export const FLEET_PROFILE_SETTING_COUNT = 6

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const clone = value => JSON.parse(JSON.stringify(value))

function localId(prefix) {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${suffix}`
}

function emptyDraft() {
  return {
    schemaVersion: 1,
    id: localId('local'),
    label: '',
    machines: [],
    transports: [
      { id: 'relay', label: 'relay', port: null, note: 'not configured' },
      { id: 'tools', label: 'tool lane', port: null, note: 'not configured' },
    ],
  }
}

function startingDraft() {
  return FLEET_PROFILE_RESOLUTION.rawProfile
    ? clone(FLEET_PROFILE_RESOLUTION.rawProfile)
    : emptyDraft()
}

function initialFeedback() {
  const state = FLEET_PROFILE_RESOLUTION
  if (state.kind === 'invalid') {
    const error = state.errors[0]
    return {
      tone: 'serious',
      title: 'Fleet profile could not be loaded',
      detail: `${error?.source || 'profile'} · ${error?.path || '$'} ${error?.message || 'is invalid'}. The saved value was not changed; the labelled sample demonstration is active.`,
    }
  }
  if (!state.configured) {
    return {
      tone: 'quiet',
      title: 'No fleet profile saved — showing sample data',
      detail: 'Everything on screen right now is the labelled sample demonstration, not your machines. ToolsEnabled already works fully on this one computer with nothing configured here; add a machine below only if you also want to connect another.',
    }
  }
  if (state.rawProfile?.dataSource && !globalThis.mcFleetProfile) {
    return {
      tone: 'serious',
      title: `${state.rawProfile.label} needs the installed desktop app`,
      detail: 'This browser cannot read the configured projection directory. It is not substituting that directory with a successful connection state.',
    }
  }
  if (state.kind === 'recovered') {
    return {
      tone: 'serious',
      title: `${state.rawProfile.label} loaded with a storage warning`,
      detail: state.errors.map(error => `${error.source} · ${error.message}`).join(' '),
    }
  }
  if (state.warnings.length) {
    return {
      tone: 'warn',
      title: `${state.rawProfile.label} loaded with a browser-storage warning`,
      detail: state.warnings.map(warning => `${warning.source} · ${warning.message}`).join(' '),
    }
  }
  if (state.inheritedSampleSections.length) {
    return {
      tone: 'warn',
      title: `${state.rawProfile.label} is configured`,
      detail: `${state.inheritedSampleSections.length} content sections are still the labelled demonstration because this profile does not define them. Machine and connection settings are yours; those sample sections are not.`,
    }
  }
  return {
    tone: 'good',
    title: `${state.rawProfile.label} is configured`,
    detail: `Loaded from ${state.source}. Reachability is checked separately below; configured never means up.`,
  }
}

function profileErrors(errors) {
  return (errors || []).slice(0, 5).map(error => `${error.path || '$'} ${error.message}`).join(' · ')
}

function explicitPort(endpoint) {
  const text = String(endpoint || '').trim()
  if (!text) return null
  const legacy = /^:(\d+)$/.exec(text)
  if (legacy) {
    const port = Number(legacy[1])
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
  }
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `tcp://${text}`)
    if (parsed.port) return Number(parsed.port)
    if (parsed.protocol === 'http:') return 80
    if (parsed.protocol === 'https:') return 443
  } catch {}
  return null
}

function browserProbe(profile) {
  const reason = 'reachability checks require the installed desktop app'
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    machines: profile.machines.map(machine => ({
      id: machine.id,
      label: machine.name,
      target: machine.ip || machine.address || '',
      state: 'unverified',
      message: reason,
    })),
    transports: profile.transports.map(transport => ({
      id: transport.id,
      label: transport.label || transport.id,
      target: transport.endpoint || (transport.port ? `:${transport.port}` : ''),
      state: transport.endpoint || transport.port ? 'unverified' : 'not-configured',
      message: transport.endpoint || transport.port ? reason : 'not configured',
    })),
    dataSource: profile.dataSource
      ? { state: 'unavailable', message: reason, files: [] }
      : { state: 'not-configured', message: 'no local projection directory is configured', files: [] },
  }
}

function probeLine(item, prefix) {
  const target = item.target ? ` · ${item.target}` : ''
  return `<li class="fleet-probe-line is-${esc(item.state)}"><span>${esc(prefix)} · ${esc(item.label || item.id)}${esc(target)}</span><b>${esc(item.state)}</b><small>${esc(item.message)}</small></li>`
}

function probeMarkup(probe, busy) {
  if (busy === 'probe') {
    return '<div class="fleet-profile-probe is-loading" data-profile-probe role="status"><strong>Checking configured connections…</strong><span>No lane is called reachable until it answers.</span></div>'
  }
  if (!probe) {
    return '<div class="fleet-profile-probe" data-profile-probe role="status"><strong>Reachability not checked yet</strong><span>Connection state is separate from saved configuration.</span></div>'
  }
  if (!probe.ok) {
    return `<div class="fleet-profile-probe is-serious" data-profile-probe role="alert"><strong>Connection check failed</strong><span>${esc(probe.error?.message || 'The desktop shell did not return a result.')}</span></div>`
  }
  const source = probe.dataSource || { state: 'not-configured', message: 'not configured', files: [] }
  const missingFiles = (source.files || []).filter(file => !file.ok)
    .map(file => `${file.name}: ${file.message}`).join(' · ')
  return `<div class="fleet-profile-probe" data-profile-probe role="status">
    <strong>Connection check · ${esc(probe.checkedAt ? new Date(probe.checkedAt).toLocaleTimeString() : 'complete')}</strong>
    <ul>
      ${(probe.machines || []).map(item => probeLine(item, 'machine')).join('')}
      ${(probe.transports || []).map(item => probeLine(item, 'transport')).join('')}
      <li class="fleet-probe-line is-${esc(source.state)}"><span>projection directory</span><b>${esc(source.state)}</b><small>${esc(source.message)}${missingFiles ? ` · ${esc(missingFiles)}` : ''}</small></li>
    </ul>
  </div>`
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'application/json' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(href), 0)
}

export function createFleetProfileSettings() {
  let draft = startingDraft()
  let feedback = initialFeedback()
  let probe = null
  let hostRoot = null
  let busy = null
  let dirty = false
  let autoProbeStarted = false
  let resetArmed = false
  let resetTimer = 0
  let draftRevision = 0
  let probeRequestId = 0
  const editedTransports = new Set()

  function normalizedDraft() {
    const profile = clone(draft)
    profile.label = String(profile.label || '').trim()
    profile.machines = (profile.machines || []).map(machine => ({
      ...machine,
      name: String(machine.name || '').trim(),
      ip: String(machine.ip || machine.address || '').trim(),
    }))
    profile.transports = (profile.transports || []).map(transport => {
      if (!editedTransports.has(transport.id)) return transport
      const endpoint = String(transport.endpoint || '').trim()
      const legacyPort = /^:\d+$/.test(endpoint)
      const normalized = {
        ...transport,
        port: explicitPort(endpoint),
        note: endpoint
          ? legacyPort ? 'legacy port-only endpoint; host is not configured' : 'configured endpoint; reachability is reported in Settings'
          : 'not configured',
      }
      if (legacyPort) delete normalized.endpoint
      else normalized.endpoint = endpoint
      return normalized
    })
    if (profile.dataSource?.kind === 'directory') {
      const sourcePath = String(profile.dataSource.path || '').trim()
      if (sourcePath) profile.dataSource = { ...profile.dataSource, path: sourcePath }
      else delete profile.dataSource
    }
    return profile
  }

  function statusMarkup() {
    return `<div class="fleet-profile-status is-${esc(feedback.tone)}" data-profile-status role="${feedback.tone === 'serious' ? 'alert' : 'status'}">
      <strong>${esc(feedback.title)}</strong>
      <span>${esc(feedback.detail)}</span>
    </div>`
  }

  function machineMarkup(machine, index) {
    const locked = busy && busy !== 'probe' ? 'disabled' : ''
    return `<div class="fleet-machine" data-machine-index="${index}">
      <label><span>Name</span><input class="fleet-profile-input" data-profile-field="machine-name" data-profile-index="${index}" value="${esc(machine.name)}" placeholder="this machine's name" autocomplete="off" ${locked}/></label>
      <label><span>Address</span><input class="fleet-profile-input" data-profile-field="machine-address" data-profile-index="${index}" value="${esc(machine.ip || machine.address || '')}" placeholder="host:port, URL, IP, or hostname" autocomplete="off" spellcheck="false" ${locked}/></label>
      <button type="button" class="ctl-btn danger" data-profile-action="remove-machine" data-profile-index="${index}" aria-label="Remove ${esc(machine.name || `machine ${index + 1}`)}" ${busy ? 'disabled' : ''}>Remove</button>
    </div>`
  }

  function transportMarkup(transport, index) {
    const endpoint = transport.endpoint || (transport.port ? `:${transport.port}` : '')
    const legacy = !transport.endpoint && transport.port
      ? `Legacy port-only profile · host is not declared, so :${transport.port} cannot be reachability-tested.`
      : 'Use a URL or host:port. Credentials do not belong in this field.'
    const locked = busy && busy !== 'probe' ? 'disabled' : ''
    return `<div class="fleet-transport">
      <label><span>${esc(transport.label || transport.id || `transport ${index + 1}`)}</span><input class="fleet-profile-input" data-profile-field="transport-endpoint" data-profile-index="${index}" value="${esc(endpoint)}" placeholder="not configured" autocomplete="off" spellcheck="false" ${locked}/></label>
      <small>${esc(legacy)}</small>
    </div>`
  }

  function markup({ searchResult = false } = {}) {
    const sourcePath = draft.dataSource?.kind === 'directory' ? draft.dataSource.path : ''
    const shellAvailable = Boolean(globalThis.mcFleetProfile)
    const locked = busy && busy !== 'probe' ? 'disabled' : ''
    return `<section class="settings-section fleet-profile-section" data-settings-section="System" data-profile-system>
      ${searchResult ? '<div class="settings-prefix">System · setup and connections</div>' : ''}
      <h2 class="settings-section-title">System</h2>
      ${statusMarkup()}
      <div class="settings-section-rows">
        <article class="settings-row">
          <div class="settings-copy">
            <div class="settings-name" id="fleet-profile-name-label">Profile name</div>
            <div class="settings-desc">A local label for this system. It is exported with the profile; it is not who you are signed in as. Sign-in is the row below, and this name is not it.</div>
          </div>
          <div class="settings-control fleet-inline-control"><input class="fleet-profile-input" data-profile-field="label" value="${esc(draft.label)}" aria-labelledby="fleet-profile-name-label" placeholder="required" autocomplete="off" ${locked}/></div>
        </article>

        <article class="settings-row">
          <div class="settings-copy">
            <div class="settings-name">Your account</div>
            <div class="settings-desc">Sign in with Google, or with an account you make here — then sign out or change your password. Your account lives on this computer and nowhere else; signing in with Google means Google checks who you are, and no Google password or token is kept here. It is not a login to Claude or ChatGPT, it carries no subscription, and there is no licence check — those programs keep their own sign-ins and this one never asks for them.</div>
          </div>
          <div class="settings-control fleet-inline-control">
            <a class="ctl-btn" href="#/account">Open sign-in</a>
          </div>
        </article>

        <article class="settings-row fleet-profile-block">
          <div class="settings-copy">
            <div class="settings-name">Machine roster</div>
            <div class="settings-desc">ToolsEnabled already runs on this one computer with nothing added here. Add a machine only if you want to connect another — it stays optional. An address without a port can be resolved, but it cannot honestly be called reachable.</div>
          </div>
          <div class="fleet-profile-fields">
            ${(draft.machines || []).length ? draft.machines.map(machineMarkup).join('') : '<p class="fleet-profile-empty">No machines added. Saving is blocked until the roster contains at least one named address.</p>'}
            <button type="button" class="ctl-btn" data-profile-action="add-machine" ${busy ? 'disabled' : ''}>Add machine</button>
          </div>
        </article>

        <article class="settings-row fleet-profile-block">
          <div class="settings-copy">
            <div class="settings-name">Transport endpoints</div>
            <div class="settings-desc">Relay and tool-lane endpoints stay “not configured” until you provide them. Saved and reachable are separate states.</div>
          </div>
          <div class="fleet-profile-fields">${(draft.transports || []).map(transportMarkup).join('')}</div>
        </article>

        <article class="settings-row fleet-profile-block">
          <div class="settings-copy">
            <div class="settings-name">Local projection directory</div>
            <div class="settings-desc">The desktop shell serves status.json and each domain projection from this folder. Missing or malformed files fail visibly; they never fall through to bundled data.</div>
          </div>
          <div class="fleet-source-control">
            <input class="fleet-profile-input" data-profile-field="data-source" value="${esc(sourcePath)}" placeholder="not configured" autocomplete="off" spellcheck="false" ${!shellAvailable || locked ? 'disabled' : ''}/>
            <div class="fleet-profile-actions">
              <button type="button" class="ctl-btn" data-profile-action="choose-directory" ${shellAvailable && !busy ? '' : 'disabled'}>Choose folder</button>
              <button type="button" class="ctl-btn" data-profile-action="clear-directory" ${sourcePath && !busy ? '' : 'disabled'}>Clear</button>
            </div>
            <small>${shellAvailable ? 'Installed desktop source · bundled schemas remain the validation authority.' : 'Directory selection and serving require the installed desktop app; this browser keeps using its own /data route.'}</small>
          </div>
        </article>

        <article class="settings-row fleet-profile-block">
          <div class="settings-copy">
            <div class="settings-name">Profile file</div>
            <div class="settings-desc">Load validates before replacing anything. Export preserves the profile's unknown and owner-specific fields. Reset is confirmed twice and returns to the explicit sample demonstration.</div>
          </div>
          <div class="fleet-profile-actions">
            <button type="button" class="ctl-btn" data-profile-action="load" ${busy ? 'disabled' : ''}>Load profile</button>
            <button type="button" class="ctl-btn" data-profile-action="export" ${busy ? 'disabled' : ''}>Export profile</button>
            <button type="button" class="ctl-btn danger ${resetArmed ? 'armed' : ''}" data-profile-action="reset" ${busy ? 'disabled' : ''}>${resetArmed ? 'Confirm reset' : 'Reset'}</button>
          </div>
        </article>

        <article class="settings-row fleet-profile-block fleet-profile-commit">
          <div class="settings-copy">
            <div class="settings-name">Apply configuration</div>
            <div class="settings-desc">The fleet is constructed once during startup. Saving reloads the app so every view changes together instead of mixing old and new data.</div>
          </div>
          <div class="fleet-profile-actions">
            <button type="button" class="ctl-btn" data-profile-action="probe" ${busy ? 'disabled' : ''}>Check connections</button>
            <button type="button" class="ctl-btn armed" data-profile-action="save" ${busy ? 'disabled' : ''}>${busy === 'save' ? 'Saving…' : 'Save & reload'}</button>
          </div>
        </article>
      </div>
      ${probeMarkup(probe, busy)}
    </section>`
  }

  function refresh() {
    if (!hostRoot) return
    const current = hostRoot.querySelector('[data-profile-system]')
    if (!current) return
    const searchResult = current.querySelector('.settings-prefix') !== null
    current.outerHTML = markup({ searchResult })
  }

  function syncActionAvailability() {
    if (!hostRoot) return
    const shellAvailable = Boolean(globalThis.mcFleetProfile)
    const hasSource = Boolean(draft.dataSource?.path)
    for (const button of hostRoot.querySelectorAll('[data-profile-action]')) {
      const action = button.dataset.profileAction
      button.disabled = Boolean(busy)
        || (action === 'choose-directory' && !shellAvailable)
        || (action === 'clear-directory' && !hasSource)
    }
  }

  function markDirty() {
    draftRevision += 1
    probeRequestId += 1
    if (busy === 'probe') {
      busy = null
      syncActionAvailability()
    }
    dirty = true
    probe = null
    feedback = {
      tone: 'warn',
      title: 'Unsaved profile changes',
      detail: 'Save & reload applies this draft to every view. Connection results are stale until checked again.',
    }
    const status = hostRoot?.querySelector('[data-profile-status]')
    if (status) status.outerHTML = statusMarkup()
    const probeNode = hostRoot?.querySelector('[data-profile-probe]')
    if (probeNode) probeNode.outerHTML = probeMarkup(null, null)
  }

  async function runProbe(profile = normalizedDraft(), automatic = false) {
    const verdict = validateFleetProfile(profile)
    if (!verdict.ok) {
      if (!automatic) {
        feedback = { tone: 'serious', title: 'Connection check blocked', detail: profileErrors(verdict.errors) }
        refresh()
      }
      return
    }
    const revision = draftRevision
    const requestId = ++probeRequestId
    busy = 'probe'
    refresh()
    let result
    if (globalThis.mcFleetProfile?.probe) {
      try { result = await globalThis.mcFleetProfile.probe(profile) } catch (error) {
        result = { ok: false, error: { message: error?.message || String(error) } }
      }
    } else {
      result = browserProbe(profile)
    }
    if (requestId !== probeRequestId || revision !== draftRevision) return
    busy = null
    probe = result
    if (!result?.ok) {
      feedback = { tone: 'serious', title: 'Connection check failed', detail: result?.error?.message || 'The connection checker returned no result.' }
    } else {
      const records = [...(result.machines || []), ...(result.transports || []), result.dataSource].filter(Boolean)
      const unavailable = records.filter(record => record.state === 'unreachable' || record.state === 'unavailable')
      const unverified = records.filter(record => record.state === 'unverified' || record.state === 'not-configured')
      feedback = unavailable.length
        ? { tone: 'serious', title: `${unavailable.length} configured connection${unavailable.length === 1 ? '' : 's'} unavailable`, detail: 'The exact failures are listed below. No sample or bundled projection replaced a failed configured source.' }
        : unverified.length
          ? { tone: 'warn', title: 'Configuration checked with unverified lanes', detail: 'Unconfigured lanes and addresses without a port are listed explicitly below; none is being called up.' }
          : { tone: 'good', title: 'Configured connections answered', detail: 'Every probeable lane answered and all required projection files parsed as JSON.' }
    }
    refresh()
  }

  async function saveAndReload(profile) {
    const verdict = validateFleetProfile(profile)
    if (!verdict.ok) {
      feedback = { tone: 'serious', title: 'Profile was not saved', detail: profileErrors(verdict.errors) }
      refresh()
      return
    }
    busy = 'save'
    feedback = { tone: 'quiet', title: 'Saving fleet profile', detail: 'The current profile remains active until the durable write succeeds.' }
    refresh()
    const result = await persistFleetProfile(profile)
    if (!result.ok) {
      busy = null
      feedback = { tone: 'serious', title: 'Profile was not saved', detail: profileErrors(result.errors) }
      refresh()
      return
    }
    feedback = { tone: 'good', title: 'Profile saved', detail: 'Reloading so every view resolves the same fleet.' }
    refresh()
    globalThis.location.reload()
  }

  async function importProfile() {
    busy = 'load'
    refresh()
    let parsed
    if (globalThis.mcFleetProfile?.importFile) {
      let result
      try { result = await globalThis.mcFleetProfile.importFile() } catch (error) {
        result = { ok: false, error: { message: error?.message || String(error) } }
      }
      if (!result?.ok) {
        busy = null
        feedback = { tone: 'serious', title: 'Profile was not loaded', detail: result?.error?.message || 'The selected file could not be read.' }
        refresh()
        return
      }
      if (result.canceled) { busy = null; refresh(); return }
      const verdict = validateFleetProfile(result.profile)
      parsed = verdict.ok ? { ok: true, profile: result.profile } : verdict
    } else {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'application/json,.json'
      const file = await new Promise(resolve => {
        input.addEventListener('change', () => resolve(input.files?.[0] || null), { once: true })
        input.addEventListener('cancel', () => resolve(null), { once: true })
        input.click()
      })
      if (!file) { busy = null; refresh(); return }
      try {
        if (file.size > 2 * 1024 * 1024) parsed = { ok: false, errors: [{ path: '$', message: 'profile exceeds the 2 MiB limit' }] }
        else parsed = parseFleetProfile(await file.text())
      } catch (error) {
        parsed = { ok: false, errors: [{ path: '$', message: `profile could not be read: ${error?.message || error}` }] }
      }
    }
    if (!parsed.ok) {
      busy = null
      feedback = { tone: 'serious', title: 'Profile was not loaded', detail: profileErrors(parsed.errors) }
      refresh()
      return
    }
    busy = null
    await saveAndReload(parsed.profile)
  }

  async function exportProfile() {
    const profile = normalizedDraft()
    const serialized = serializeFleetProfile(profile)
    if (!serialized.ok) {
      feedback = { tone: 'serious', title: 'Profile was not exported', detail: profileErrors(serialized.errors) }
      refresh()
      return
    }
    busy = 'export'
    refresh()
    if (globalThis.mcFleetProfile?.exportFile) {
      let result
      try { result = await globalThis.mcFleetProfile.exportFile(profile) } catch (error) {
        result = { ok: false, error: { message: error?.message || String(error) } }
      }
      if (!result?.ok) {
        busy = null
        feedback = { tone: 'serious', title: 'Profile was not exported', detail: result?.error?.message || 'The destination could not be written.' }
        refresh()
        return
      }
      if (result.canceled) { busy = null; refresh(); return }
    } else {
      const name = `${String(profile.label || 'fleet-profile').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'fleet-profile'}.json`
      try { downloadText(serialized.text, name) } catch (error) {
        busy = null
        feedback = { tone: 'serious', title: 'Profile was not exported', detail: error?.message || String(error) }
        refresh()
        return
      }
    }
    busy = null
    feedback = { tone: 'good', title: 'Profile exported', detail: 'The exported JSON preserves this draft, including fields this settings view does not edit.' }
    refresh()
  }

  async function chooseDirectory() {
    if (!globalThis.mcFleetProfile?.chooseDirectory) {
      feedback = { tone: 'serious', title: 'Folder selection unavailable', detail: 'Run the installed desktop app to connect a local projection directory.' }
      refresh()
      return
    }
    busy = 'choose-directory'
    refresh()
    let result
    try { result = await globalThis.mcFleetProfile.chooseDirectory() } catch (error) {
      result = { ok: false, error: { message: error?.message || String(error) } }
    }
    if (!result?.ok) {
      busy = null
      feedback = { tone: 'serious', title: 'Projection folder was not selected', detail: result?.error?.message || 'The desktop shell returned no folder.' }
      refresh()
      return
    }
    if (result.canceled) { busy = null; refresh(); return }
    busy = null
    draft.dataSource = { kind: 'directory', path: result.path }
    markDirty()
    refresh()
  }

  async function handleClick(event) {
    const button = event.target.closest('[data-profile-action]')
    if (!button || !hostRoot?.contains(button)) return
    if (busy) return
    const action = button.dataset.profileAction
    if (action === 'add-machine') {
      draft.machines.push({ id: localId('machine'), name: '', short: String(draft.machines.length + 1), ip: '' })
      markDirty()
      refresh()
      requestAnimationFrame(() => hostRoot.querySelector(`[data-profile-index="${draft.machines.length - 1}"][data-profile-field="machine-name"]`)?.focus())
      return
    }
    if (action === 'remove-machine') {
      draft.machines.splice(Number(button.dataset.profileIndex), 1)
      markDirty()
      refresh()
      return
    }
    if (action === 'choose-directory') { await chooseDirectory(); return }
    if (action === 'clear-directory') {
      delete draft.dataSource
      markDirty()
      refresh()
      return
    }
    if (action === 'probe') { await runProbe(); return }
    if (action === 'save') { await saveAndReload(normalizedDraft()); return }
    if (action === 'load') { await importProfile(); return }
    if (action === 'export') { await exportProfile(); return }
    if (action === 'reset') {
      if (!resetArmed) {
        resetArmed = true
        clearTimeout(resetTimer)
        resetTimer = setTimeout(() => { resetArmed = false; refresh() }, 8000)
        feedback = { tone: 'serious', title: 'Reset needs one more click', detail: 'Confirm reset removes only the saved fleet profile. Appearance settings and exported files are untouched.' }
        refresh()
        return
      }
      busy = 'reset'
      refresh()
      const result = await resetFleetProfile()
      if (!result.ok) {
        busy = null
        resetArmed = false
        feedback = { tone: 'serious', title: 'Fleet profile was not reset', detail: profileErrors(result.errors) }
        refresh()
        return
      }
      globalThis.location.reload()
    }
  }

  function handleInput(event) {
    const input = event.target.closest('[data-profile-field]')
    if (!input || !hostRoot?.contains(input)) return
    const index = Number(input.dataset.profileIndex)
    if (input.dataset.profileField === 'label') draft.label = input.value
    if (input.dataset.profileField === 'machine-name') draft.machines[index].name = input.value
    if (input.dataset.profileField === 'machine-address') draft.machines[index].ip = input.value
    if (input.dataset.profileField === 'transport-endpoint') {
      draft.transports[index].endpoint = input.value
      editedTransports.add(draft.transports[index].id)
    }
    if (input.dataset.profileField === 'data-source') {
      draft.dataSource = input.value ? { kind: 'directory', path: input.value } : undefined
    }
    markDirty()
  }

  function matches(query) {
    const normalized = String(query || '').trim().toLowerCase()
    if (!normalized) return true
    const haystack = [
      /* The synonyms are what route someone typing "login" to the row that
         answers them. They mattered when the answer was "there is nothing to
         log into"; they matter more now that there IS, so `password`,
         `sign out` and `user` are added rather than the list being left to go
         stale against a row whose meaning changed. */
      'system profile fleet setup machine roster host address relay tool lane endpoint transport data source projection directory load import export reset connection account sign in signin sign out signout login log in log out password user username identity who licence license sample demonstration one machine single computer',
      draft.label,
      ...(draft.machines || []).flatMap(machine => [machine.name, machine.ip || machine.address]),
      ...(draft.transports || []).flatMap(transport => [transport.label, transport.endpoint]),
      draft.dataSource?.path,
    ].join(' ').toLowerCase()
    return haystack.includes(normalized)
  }

  function bind(root) {
    hostRoot = root
    root.addEventListener('click', handleClick)
    root.addEventListener('input', handleInput)
  }

  function afterRender(root = hostRoot) {
    hostRoot = root
    if (!autoProbeStarted && FLEET_PROFILE_RESOLUTION.configured) {
      autoProbeStarted = true
      queueMicrotask(() => runProbe(FLEET_PROFILE_RESOLUTION.rawProfile, true))
    }
  }

  function destroy() {
    clearTimeout(resetTimer)
    if (hostRoot) {
      hostRoot.removeEventListener('click', handleClick)
      hostRoot.removeEventListener('input', handleInput)
    }
    hostRoot = null
  }

  return Object.freeze({ markup, matches, bind, afterRender, destroy, get dirty() { return dirty } })
}
