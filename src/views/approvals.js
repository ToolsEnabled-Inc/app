// /approvals — the owner's decision queue as a SCREEN he visits, not a popup
// that visits him.
//
// The owner replaced the modal with this: "instead of a popup maybe the
// purchase list is just a screen and the user navigates to that screen on
// their own time and approves whatevers in que." So nothing here interrupts:
// no modal, no toast, no sound, no focus steal. The only signal that anything
// is waiting is a count on the home view's existing readouts, because home is
// the screen he lands on every launch anyway.
//
// WHAT IS REUSED, AND WHY IT IS REUSE RATHER THAN RESTYLING
//
// The frame is the ledger's: .ledger-shell, .ledger-summary stat tiles, the
// .ledger-toolbar count line, and the .ledger-register list. The cards inside
// it are the owner-prompt cards, built by the SAME renderOwnerPrompt() the
// modal uses, with the same classes and the same stylesheet. A purchase batch
// carries a merchant, a purpose, an exact amount per line and a total bound to
// those lines; a ledger row cannot express that, and flattening it would drop
// information the owner needs in order to decide. So the rows arrive already
// designed, and this file adds no visual language of its own.
//
// PRESENTATION IS MEASURED, NOT ASSUMED
//
// The engine refuses a decision on a prompt it was never told was presented
// (OWNER_PROMPT_NOT_PRESENTED), and it only accepts evidence that says the
// card was mounted and visible. That is why controls start disabled and enable
// per card as each one actually comes into view: a card scrolled off the
// bottom of a long queue genuinely has not been presented, and claiming
// otherwise would be exactly the unbound-confirmation defect the engine's rule
// exists to prevent. Unlike the modal, this screen does NOT additionally
// require focus inside the card — the owner navigated here deliberately and
// the card is on his screen; making him click a card before its buttons work
// would be a gate the engine never asked for. Whatever focus actually is at
// the moment of measurement is reported honestly either way.
//
// AN ANSWER THIS SCREEN ASKED FOR IS NEVER THROWN AWAY
//
// submit() awaits an audited bridge call with a 30-second budget, and the
// router destroys this view the instant the owner presses an arrow (a view
// transition retires the outgoing view at the swap, not after it). So the
// answer regularly arrives at an instance that no longer has a screen. It used
// to be dropped there: `if (destroyed) return` sat above the branch that reads
// `result.ok`, so a REFUSAL — the message whose only job is to say nothing was
// recorded and nothing was approved — became byte-for-byte identical to a
// success. On the surface where consent is the product, silence must never be
// the shape of "it did not work".
//
// The outcome is therefore filed in src/approval-outcomes.js BEFORE this file
// asks whether its own view is still alive. The record outlives the instance,
// this screen restates it the next time it is mounted, and home counts it
// meanwhile — home being the one signal channel this design already nominated.

import { el } from '../components.js'
import {
  applyOwnerPopupTheme,
  formatExactAmount,
  measuredPresentationEvidence,
  normalizeOwnerPromptSnapshot,
  renderOwnerPrompt,
} from '../owner-popup.js'
import {
  decideOwnerPrompt,
  markOwnerPromptPresented,
  ownerPromptSnapshot,
} from '../mission-bridge.js'
import {
  clearUndeliveredDecision,
  recordUndeliveredDecision,
  reconcileUndeliveredDecisions,
  undeliveredDecision,
} from '../approval-outcomes.js'
import '../ledger.css'
import '../owner-popup.css'

// The modal polled at 750ms because it had to appear promptly over whatever
// the owner was doing. A screen he is already looking at does not, and this
// call crosses the audited bridge, so it asks less often.
const POLL_MS = 2_000
const THEME_NAMES = new Set(['white', 'tan', 'black'])

function selectedTheme(manifest) {
  const chosen = document.documentElement.dataset.theme
  return THEME_NAMES.has(chosen) ? chosen : manifest.defaultTheme
}

function pendingPurchaseTotal(prompts) {
  const carts = prompts.filter(prompt => prompt.kind === 'purchase_batch')
  if (carts.length === 0) return null
  const currency = carts[0].currency
  // Only sum what is genuinely comparable. Mixed currencies get no invented
  // conversion rate; the tile falls back to a count instead of a wrong total.
  if (carts.some(cart => cart.currency !== currency)) return null
  return { totalCents: carts.reduce((sum, cart) => sum + cart.totalCents, 0), currency }
}

export function approvalsView() {
  const root = el(`
    <main class="view-pad approvals-page">
      <div class="ledger-shell">
        <h1 class="ledger-sr-only">Approvals</h1>
        <section class="ledger-summary" aria-label="Approval queue totals">
          <div class="ledger-stat" data-state="open">
            <span class="ledger-stat-value" data-summary="waiting">—</span>
            <span class="ledger-stat-label">Waiting for you</span>
            <span class="ledger-stat-note">· nothing is approved unless you approve it</span>
          </div>
          <div class="ledger-stat" data-state="gated">
            <span class="ledger-stat-value" data-summary="purchases">—</span>
            <span class="ledger-stat-label">Purchases to review</span>
            <span class="ledger-stat-note" data-purchase-note>· approving records the decision, it does not spend</span>
          </div>
        </section>

        <div class="ledger-toolbar">
          <p class="ledger-register-note" aria-live="polite"><span data-visible-count>Checking the queue…</span></p>
        </div>

        <section class="ledger-register approvals-list owner-popup-root" aria-live="polite"></section>
      </div>
    </main>`)

  const list = root.querySelector('.approvals-list')
  const waitingValue = root.querySelector('[data-summary="waiting"]')
  const purchasesValue = root.querySelector('[data-summary="purchases"]')
  const purchaseNote = root.querySelector('[data-purchase-note]')
  const countNote = root.querySelector('[data-visible-count]')

  // promptId -> { wrapper, rendered, prompt, presented, submitting, failed }
  const cards = new Map()
  let destroyed = false
  let polling = false
  let timer = null
  let themeManifest = null

  function setUnavailable(title, reason) {
    list.replaceChildren(el(`<div class="projection-state projection-unavailable" role="status"></div>`))
    const state = list.firstElementChild
    const strong = document.createElement('strong')
    strong.textContent = title
    const span = document.createElement('span')
    span.textContent = reason
    state.append(strong, span)
    for (const card of cards.values()) card.wrapper.remove()
    cards.clear()
    waitingValue.textContent = '—'
    purchasesValue.textContent = '—'
    /* THE NOTE UNDER THE DASH HAS TO GO WITH IT. Both tiles fall back to "—"
       here, and the purchases tile kept its resting caption -- "· approving
       records the decision, it does not spend" -- which describes an action
       this screen cannot currently offer, printed under a value it could not
       read. Measured with the capability layer killed mid-session
       (tools/offline-routes-qa.mjs, state layer-killed). */
    purchaseNote.textContent = '· the queue could not be read, so nothing can be approved from here'
    countNote.textContent = 'The queue could not be read, so nothing here is a decision.'
  }

  function setCardStatus(card, text, kind = 'status') {
    card.rendered.status.textContent = text
    card.rendered.status.dataset.state = kind
    const failing = kind === 'unavailable'
    card.rendered.status.setAttribute('role', failing ? 'alert' : 'status')
    /* The element is rendered with aria-live="polite", and an explicit
       aria-live OUTRANKS the implicit assertive that role="alert" carries. So
       switching the role alone left "nothing was approved" queued behind
       whatever else the page had to say. Moved with the role, not left behind
       it. */
    card.rendered.status.setAttribute('aria-live', failing ? 'assertive' : 'polite')
  }

  function setCardEnabled(card, enabled) {
    for (const control of card.rendered.gatedControls) control.disabled = !enabled
  }

  function readyText(prompt) {
    return prompt.kind === 'purchase_batch'
      ? 'Ready for review. Undecided lines are denied when you submit.'
      : prompt.kind === 'confirmation' ? 'Ready for your decision.' : 'Ready to acknowledge.'
  }

  /** Said while the card that was submitted is still the card on screen. */
  function notRecordedText(reason) {
    return `${reason || 'The decision could not be recorded.'} Nothing was approved; you can try again.`
  }

  /**
   * Said when this screen is showing a request whose earlier decision was
   * refused while the screen was gone. It states three things, in the order a
   * person needs them: it did not go through, why, and that the request is
   * still here to decide.
   *
   * "Nothing was approved" is safe to assert without qualification here, and
   * only here, because this text is only ever attached to a card the engine is
   * still reporting as PENDING in the snapshot being rendered — a decision that
   * had landed would have taken the request out of the queue.
   */
  function earlierNotRecordedText(entry) {
    return `The decision you submitted was not recorded: ${entry.reason} This request is still waiting, so nothing was approved. You can decide it again below.`
  }

  function markUndelivered(card, entry) {
    card.failed = true
    card.wrapper.dataset.decisionUndelivered = 'true'
    setCardStatus(card, earlierNotRecordedText(entry), 'unavailable')
  }

  async function submit(card, body) {
    if (destroyed || card.submitting) return
    card.submitting = true
    setCardEnabled(card, false)
    setCardStatus(card, 'Recording your decision…')
    let result
    try { result = await decideOwnerPrompt(body) }
    catch { result = { ok: false } }
    card.submitting = false

    /* THE OUTCOME IS FILED BEFORE THIS FUNCTION ASKS WHETHER ITS SCREEN IS
       STILL THERE. `destroyed` says this view instance has no DOM left to write
       to; it says nothing whatever about whether the owner's decision landed,
       and reading it first is what made a refusal indistinguishable from a
       success. Filing first means the next mount of this screen — and home in
       the meantime — can still tell him. */
    if (result?.ok !== true) {
      card.failed = true
      recordUndeliveredDecision(card.prompt.id, result?.reason)
      if (destroyed) return
      card.wrapper.dataset.decisionUndelivered = 'true'
      // Nothing was recorded, so nothing was approved. Say that plainly and
      // let him try again rather than leaving a dead card behind.
      setCardStatus(card, notRecordedText(result?.reason), 'unavailable')
      setCardEnabled(card, true)
      return
    }
    clearUndeliveredDecision(card.prompt.id)
    if (destroyed) return
    delete card.wrapper.dataset.decisionUndelivered
    setCardStatus(card, 'Decision recorded.')
    setCardEnabled(card, false)
    void poll()
  }

  async function confirmPresented(card) {
    if (destroyed || card.presented || card.presenting || card.submitting) return
    const evidence = measuredPresentationEvidence(document, card.rendered)
    if (!evidence.mounted || !evidence.visible) return   // not on screen yet; try again next tick
    card.presenting = true
    let result
    try { result = await markOwnerPromptPresented(card.prompt.id, evidence) }
    catch { result = { ok: false } }
    card.presenting = false
    if (destroyed) return
    if (result?.ok !== true) {
      setCardStatus(card, `${result?.reason || 'This request could not be confirmed as shown.'} No decision can be recorded for it yet.`, 'unavailable')
      return
    }
    card.presented = true
    setCardEnabled(card, true)
    /* A restated refusal is not overwritten with "Ready for review". Both
       sentences are true; only one of them is news, and the ready-text would
       quietly bury the fact that a decision he already made did not land. */
    const earlier = undeliveredDecision(card.prompt.id)
    if (earlier) markUndelivered(card, earlier)
    else setCardStatus(card, readyText(card.prompt))
  }

  function addCard(prompt) {
    const wrapper = document.createElement('div')
    wrapper.className = 'approvals-card'
    wrapper.dataset.promptId = prompt.id
    const rendered = renderOwnerPrompt(document, prompt, {
      dismiss() {},   // no dismissal on a screen: leaving decides nothing
      submit(body) { void submit(cards.get(prompt.id), body) },
    }, { surface: 'screen' })
    wrapper.append(rendered.dialog)
    list.append(wrapper)
    // measuredPresentationEvidence checks that the container is connected and
    // contains the card, which is what the modal's overlay did for it.
    const card = {
      wrapper, prompt, rendered: { ...rendered, overlay: wrapper }, presented: false, presenting: false, submitting: false, failed: false,
    }
    cards.set(prompt.id, card)
    /* A refusal a previous instance of this screen received and never got to
       say, because the owner had already navigated away. This is the moment it
       reaches him. Stated at mount rather than after presentation is
       re-confirmed, so it is on the glass even if the presentation handshake
       is slow or fails. */
    const earlier = undeliveredDecision(prompt.id)
    if (earlier) markUndelivered(card, earlier)
  }

  function reconcile(prompts) {
    const live = new Set(prompts.map(prompt => prompt.id))
    /* Only reachable from poll(), and only after a snapshot that genuinely
       parsed — which is what makes this a real reading of the queue rather than
       an assumption that it is empty. Records for requests that are no longer
       pending are dropped: see src/approval-outcomes.js. */
    reconcileUndeliveredDecisions([...live])
    for (const [id, card] of [...cards]) {
      if (!live.has(id)) { card.wrapper.remove(); cards.delete(id) }
    }
    // Existing cards are never re-rendered: doing so on a poll tick would wipe
    // per-line Approve/Deny choices the owner had already made but not yet
    // submitted.
    for (const prompt of prompts) if (!cards.has(prompt.id)) addCard(prompt)
    if (prompts.length === 0) {
      list.replaceChildren(el(`<div class="projection-state" role="status"></div>`))
      const state = list.firstElementChild
      const strong = document.createElement('strong')
      strong.textContent = 'Nothing is waiting for you'
      const span = document.createElement('span')
      span.textContent = 'Requests that need your decision appear here. Nothing acts on your behalf while this is empty.'
      state.append(strong, span)
    }
  }

  function paintSummary(prompts) {
    waitingValue.textContent = String(prompts.length)
    const carts = prompts.filter(prompt => prompt.kind === 'purchase_batch')
    const total = pendingPurchaseTotal(prompts)
    if (carts.length === 0) {
      purchasesValue.textContent = '0'
      purchaseNote.textContent = '· no purchases are waiting'
    } else if (total) {
      purchasesValue.textContent = formatExactAmount(total.totalCents, total.currency)
      purchaseNote.textContent = '· approving records the decision, it does not spend'
    } else {
      purchasesValue.textContent = String(carts.length)
      purchaseNote.textContent = '· mixed currencies, shown as a count rather than a converted total'
    }
    const waiting = prompts.length === 0
      ? 'Queue empty.'
      : `${prompts.length} request${prompts.length === 1 ? '' : 's'} waiting for your decision.`
    /* Counted over the prompts actually being rendered, so this line can never
       report a failure against a request that is no longer in the queue. */
    const undelivered = prompts.filter(prompt => undeliveredDecision(prompt.id)).length
    countNote.textContent = undelivered === 0
      ? waiting
      : `${waiting} ${undelivered} decision${undelivered === 1 ? '' : 's'} you submitted ${undelivered === 1 ? 'was' : 'were'} not recorded, so ${undelivered === 1 ? 'it is' : 'they are'} still here.`
  }

  async function poll() {
    if (destroyed || polling) return
    polling = true
    let raw
    try { raw = await ownerPromptSnapshot() }
    catch { raw = null }
    polling = false
    if (destroyed) return
    if (raw?.ok !== true) {
      setUnavailable('The approvals service is unavailable',
        `${raw?.reason || 'The audited bridge did not answer.'} Nothing here is a decision, and nothing has been approved.`)
      return
    }
    let snapshot
    try { snapshot = normalizeOwnerPromptSnapshot(raw) }
    catch {
      setUnavailable('The approvals response could not be read',
        'The queue or its shared visual theme did not match the expected shape, so it is not being shown rather than shown wrongly.')
      return
    }
    themeManifest = snapshot.theme
    try { applyOwnerPopupTheme(list, themeManifest, selectedTheme(themeManifest)) }
    catch {
      setUnavailable('The shared visual theme could not be applied',
        'The queue is not being rendered rather than rendered in colours that are not the product\'s.')
      return
    }
    reconcile(snapshot.prompts)
    paintSummary(snapshot.prompts)
    for (const card of cards.values()) void confirmPresented(card)
  }

  // A card only becomes decidable once it is genuinely on screen, so scrolling
  // is what brings the rest of a long queue into play.
  let scrollScheduled = false
  const onScroll = () => {
    if (scrollScheduled || destroyed) return
    scrollScheduled = true
    requestAnimationFrame(() => {
      scrollScheduled = false
      for (const card of cards.values()) void confirmPresented(card)
    })
  }
  root.addEventListener('scroll', onScroll, { passive: true })

  const themeObserver = new MutationObserver(() => {
    if (!themeManifest) return
    try { applyOwnerPopupTheme(list, themeManifest, selectedTheme(themeManifest)) } catch { /* leave the last good paint */ }
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  void poll()
  timer = setInterval(() => { void poll() }, POLL_MS)

  return {
    el: root,
    destroy() {
      destroyed = true
      if (timer !== null) clearInterval(timer)
      timer = null
      themeObserver.disconnect()
      root.removeEventListener('scroll', onScroll)
      cards.clear()
    },
  }
}
