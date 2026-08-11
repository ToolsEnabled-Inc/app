/* THE HALF OF THE FIX A PERSON CAN ACTUALLY SEE.
 *
 * shell/renderer-prefs.cjs stopped a settings file it cannot read from being
 * replaced: the unreadable bytes are moved to a dated copy and nothing is
 * destroyed. That closed the data loss and, by itself, changed nothing the
 * person experiences. They still open an application wearing none of the
 * choices they made, with no error and no explanation, which is precisely the
 * silent factory reset the whole store exists to end. A recovery nobody is told
 * about is indistinguishable from the loss it replaced -- and worse, it is
 * indistinguishable to US too, because the person's next move is to redo every
 * setting on top of defaults instead of asking for the file back.
 *
 * SO THIS SAYS THREE THINGS, and it is deliberately all three:
 *   WHY the app is showing defaults -- the reason the file could not be read.
 *   THAT nothing was deleted -- the sentence that stops a person concluding
 *     their data is gone, which is the conclusion they will otherwise reach.
 *   WHERE the file is -- an exact path, because "we kept a backup" that does
 *     not say where is a promise a person cannot act on.
 *
 * WHY THE PATH CHANGES WHILE THE WINDOW IS OPEN. The unreadable file is only
 * moved aside when a write happens, which is deliberate: a file that was only
 * transiently unreadable gets recovered intact by the next launch's retrying
 * read, and moving it eagerly would displace a record that was never damaged.
 * So this opens saying the file is still in place, and updates itself to the
 * dated copy the moment a write moves it. Both sentences are true when they are
 * shown, which is the property that matters -- a notice that promises where a
 * file WILL go is making a claim about the future.
 *
 * IT IS DISMISSIBLE, AND THE DISMISSAL IS NOT SAVED. A banner that cannot be
 * closed is hostile, and this one cannot be honestly persisted anyway: the only
 * place to persist it is the settings file that could not be read. So it goes
 * away for this window and returns next launch while the condition holds, which
 * is the correct behaviour rather than a limitation -- an unresolved data-loss
 * event should keep asking.
 *
 * TEXT IS SET AS TEXT. Every string here can contain a filesystem path chosen
 * by no one on this team, so nothing is built by string-concatenating markup.
 */

/* The reason strings from the store are sentence fragments ("the settings file
   contains malformed JSON"). Presented alone they read as an accusation with no
   consequence attached, so each notice states the consequence first and the
   reason second. */
export function settingsRecoveryNotice(state) {
  const damaged = state && typeof state.damaged === 'string' && state.damaged ? state.damaged : null
  const preservedAt = state && typeof state.preservedAt === 'string' && state.preservedAt ? state.preservedAt : null
  const file = state && typeof state.file === 'string' && state.file ? state.file : null
  if (!damaged && !preservedAt) return null

  const reason = damaged || 'the settings file could not be read'

  if (preservedAt) {
    return {
      kind: 'preserved',
      heading: 'Your saved settings could not be read',
      /* Past tense throughout: by the time this renders, the move has happened
         and been confirmed by the write that caused it. */
      body: `This window started from the default settings because ${reason}. Nothing was deleted — the file that could not be read was kept, unchanged, as a dated copy.`,
      pathLabel: 'The unreadable file was kept at',
      path: preservedAt,
    }
  }

  return {
    kind: 'damaged',
    heading: 'Your saved settings could not be read',
    body: `This window is showing the default settings because ${reason}. Nothing has been deleted. Your settings file is still where it was, and the next setting you change will move it aside as a dated copy rather than write over it.`,
    pathLabel: file ? 'Your settings file is at' : null,
    path: file,
  }
}

/* Built element by element rather than from a markup string. See the header:
   `path` is a filesystem path, and a filesystem path is not this module's text
   to trust. */
function buildElement(doc, notice) {
  const root = doc.createElement('div')
  root.className = 'settings-recovery'
  root.setAttribute('data-settings-recovery', notice.kind)
  /* Polite rather than assertive. It is present at load and updates once; an
     assertive region would interrupt a screen-reader user mid-sentence for
     something that is not urgent in the seconds sense. */
  root.setAttribute('role', 'status')

  const heading = doc.createElement('b')
  heading.className = 'settings-recovery-heading'
  heading.textContent = notice.heading
  root.appendChild(heading)

  const body = doc.createElement('span')
  body.className = 'settings-recovery-body'
  body.textContent = notice.body
  root.appendChild(body)

  if (notice.path) {
    const where = doc.createElement('span')
    where.className = 'settings-recovery-path'
    const label = doc.createElement('span')
    label.textContent = `${notice.pathLabel}: `
    const code = doc.createElement('code')
    code.textContent = notice.path
    where.appendChild(label)
    where.appendChild(code)
    root.appendChild(where)
  }

  const dismiss = doc.createElement('button')
  dismiss.type = 'button'
  dismiss.className = 'settings-recovery-dismiss'
  dismiss.setAttribute('aria-label', 'Dismiss the settings notice for this window')
  dismiss.textContent = 'Dismiss'
  root.appendChild(dismiss)

  return { root, dismiss }
}

/**
 * Put the notice on the page and keep it current.
 *
 * `source` is window.mcPrefsNotice, which public/durable-storage.js exposes and
 * which does not exist in a plain browser -- under `vite dev` there is no shell,
 * no settings file and nothing to report, so this mounts nothing rather than
 * inventing a state. Returns a handle for tests; the application ignores it.
 */
export function mountSettingsRecoveryNotice({
  doc = typeof document === 'undefined' ? null : document,
  source = typeof window === 'undefined' ? null : window.mcPrefsNotice,
  container = null,
} = {}) {
  if (!doc || !source || typeof source.read !== 'function') return null

  let element = null
  let dismissed = false
  let unsubscribe = () => {}

  const host = () => container || doc.body
  const remove = () => {
    if (element && element.parentNode) element.parentNode.removeChild(element)
    element = null
  }

  function render(state) {
    if (dismissed) return
    const notice = settingsRecoveryNotice(state)
    remove()
    if (!notice) return
    const built = buildElement(doc, notice)
    built.dismiss.addEventListener('click', () => {
      dismissed = true
      remove()
    })
    element = built.root
    const target = host()
    if (target) target.appendChild(element)
  }

  let latest
  try { latest = source.read() } catch (error) { latest = null }
  render(latest)

  if (typeof source.subscribe === 'function') {
    /* A subscription that throws must not take the page down. This module is an
       explanation; failing loudly here would cost the person the app as well as
       their settings. */
    try { unsubscribe = source.subscribe(render) || (() => {}) } catch (error) { unsubscribe = () => {} }
  }

  return {
    element: () => element,
    refresh: () => { try { render(source.read()) } catch (error) { /* nothing to redraw against */ } },
    destroy: () => { try { unsubscribe() } catch (error) { /* already gone */ } remove() },
  }
}
