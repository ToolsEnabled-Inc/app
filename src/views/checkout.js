// /checkout — the purchase list as a shop he walks through on his own time.
//
// The owner asked for "a complete checkout I can pick and choose", inside
// Mission Control, actually working, following the site's theme.
//
// WHERE "WORKING" ENDS, AND WHY THE SCREEN SAYS SO.
//
// Everything up to and including a durable, dated record of his decision is
// real: the catalogue is read from the shipped data file, selection and both
// totals are computed in exact minor units, the choices persist across a
// relaunch, and confirming writes a record he can come back to. What this
// screen cannot do is move money. There is no card on file, no merchant
// integration, and no order anywhere to place. So it never uses the words
// receipt, order or purchased about anything it has done, the confirm step
// spells out what it does and does not do BEFORE he presses it, and the
// button is captioned with its real effect.
//
// A shop UI that renders a cart and quietly does nothing would satisfy a
// screenshot and fail him the first time he believed it. The two lists on the
// review step exist so that he cannot form the wrong belief in the first
// place.
//
// THE SPEND CAP IS SURFACED AT THE POINT OF CHOICE, NOT AT THE END.
//
// The engine's pay provider checks one amount at a time against a daily limit,
// so a batch with a line above the cap does not fail as a batch -- that line is
// refused and the cheaper ones go through. Partial success is the failure mode
// a person reads as success, so any line over the cap says so on the line, and
// the cart says it again if the selection as a whole crosses it.
//
// WHAT IS REUSED. The stat strip is the ledger's, the band recipe is the
// ledger's gate chip at panel scale, the ink ramp, spacing steps, radii and
// severity hues are the product's tokens, and `el` is the shared builder. Every
// authored string reaches the page through textContent; none of it is HTML.

import { el } from '../components.js'
import { formatExactAmount } from '../owner-popup.js'
import { normalizeOwnerPromptSnapshot } from '../owner-popup.js'
import { ownerPromptSnapshot } from '../mission-bridge.js'
import {
  CatalogError,
  itemsInCategory,
  loadCatalog,
} from '../checkout-catalog.js'
import {
  SELECTION_STORAGE_KEY,
  createSelectionStore,
  safeStorage,
} from '../checkout-selection.js'
import { readApprovalIdentity } from '../checkout-principal.js'
import '../checkout.css'

const CADENCE_LABEL = Object.freeze({
  'one-off': 'One-off',
  annual: 'Per year',
  monthly: 'Per month',
})

function node(tag, className, text) {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

/**
 * A notice band. `body` is a list of plain strings; each becomes its own
 * paragraph through textContent, so nothing authored can carry markup.
 */
function band(kind, label, paragraphs) {
  const wrapper = node('div', 'checkout-band')
  wrapper.dataset.kind = kind
  wrapper.setAttribute('role', kind === 'blocked' ? 'alert' : 'note')
  wrapper.append(node('span', 'checkout-band-label', label))
  const body = node('div', 'checkout-band-body')
  for (const paragraph of paragraphs) body.append(node('p', '', paragraph))
  wrapper.append(body)
  return wrapper
}

function money(cents, currency) {
  return formatExactAmount(cents, currency)
}

export function checkoutView({ navigate = (hash) => { location.hash = hash } } = {}) {
  const root = el(`
    <main class="view-pad checkout-page">
      <div class="checkout-shell">
        <header class="checkout-head">
          <h1 class="checkout-title">Checkout</h1>
          <p class="checkout-lede"></p>
          <p class="checkout-provenance" data-provenance></p>
        </header>
        <div data-stage></div>
      </div>
    </main>`)

  const lede = root.querySelector('.checkout-lede')
  lede.append(
    document.createTextNode('Pick what you want and watch the two totals. '),
    node('strong', '', 'Nothing on this screen charges a card or places an order.'),
    document.createTextNode(' It records what you decided, and says so before you decide it.'),
  )
  const provenanceLine = root.querySelector('[data-provenance]')
  const stage = root.querySelector('[data-stage]')

  let destroyed = false
  let catalog = null
  let store = null
  let step = 'shop'
  // per-item live handles, so a toggle repaints three nodes instead of
  // rebuilding the list under the owner's cursor and losing his scroll
  const itemViews = new Map()
  let shopSection = null
  let summaryNodes = null
  let noticesHost = null
  let barNodes = null

  function setUnavailable(title, reason) {
    stage.replaceChildren()
    const state = node('div', 'checkout-state')
    state.setAttribute('role', 'status')
    state.append(node('strong', '', title), node('span', '', reason))
    stage.append(state)
  }

  /* ---------- the money column for one item ---------- */

  function priceColumn(item) {
    const column = node('div', 'checkout-price')
    const figure = node('div', 'checkout-price-figure')
    if (item.firstYearCents === null) {
      figure.dataset.unpriced = 'true'
      figure.textContent = 'No quote yet'
    } else {
      figure.textContent = money(item.firstYearCents, item.currency)
    }
    column.append(figure)

    if (item.firstYearCents !== null) {
      column.append(node('div', 'checkout-price-cadence', CADENCE_LABEL[item.cadence]))
    }

    if (item.estimate) {
      const estimate = node('div', 'checkout-price-estimate')
      estimate.append(
        node('div', '', `Estimated ${money(item.estimate.lowCents, item.currency)} to ${money(item.estimate.highCents, item.currency)} — not a quote.`),
        node('div', '', item.estimate.basis),
      )
      column.append(estimate)
    }

    // The callout the owner asked for by name: vendors advertise a cheap first
    // year and renew at several times it, so wherever the two differ the
    // difference is stated in figures rather than implied.
    if (item.renewalDiffers) {
      const renewal = node('div', 'checkout-price-renewal')
      const first = node('b', '', money(item.firstYearCents, item.currency))
      const later = node('b', '', money(item.renewalCents, item.currency))
      renewal.append(
        document.createTextNode('First year '),
        first,
        document.createTextNode(', then '),
        later,
        document.createTextNode(' every year after.'),
      )
      column.append(renewal)
    } else if (item.cadence === 'monthly' && item.firstYearCents !== null) {
      const yearly = node('div', 'checkout-price-renewal')
      yearly.append(
        document.createTextNode('Billed monthly — '),
        node('b', '', money(item.firstYearCents * 12, item.currency)),
        document.createTextNode(' across a year.'),
      )
      column.append(yearly)
    }

    if (item.firstYearCents !== null) {
      const verify = node('div', 'checkout-price-verify')
      verify.dataset.verified = String(item.priceVerified)
      verify.textContent = item.priceVerified
        ? `Price checked ${item.priceVerifiedDate}`
        : 'Price not checked against the vendor yet'
      column.append(verify)
    }

    return column
  }

  /* ---------- one item row ---------- */

  function itemRow(item) {
    const row = node('li', 'checkout-item')
    row.dataset.itemId = item.id
    row.dataset.selected = 'false'
    row.dataset.choosable = String(item.selectable)
    row.dataset.blocked = String(item.blocked)

    const pick = node('button', 'checkout-pick')
    pick.type = 'button'
    pick.setAttribute('role', 'checkbox')
    pick.setAttribute('aria-checked', 'false')
    pick.textContent = '✓'
    // The accessible name carries the price, because "checkbox, checked" tells
    // a screen-reader user nothing about what they just added to a total.
    const priceWords = item.firstYearCents === null
      ? 'no price yet'
      : `${money(item.firstYearCents, item.currency)} ${CADENCE_LABEL[item.cadence].toLowerCase()}`
    pick.setAttribute('aria-label', `Choose ${item.name}, ${priceWords}`)
    if (!item.selectable) {
      pick.disabled = true
      pick.setAttribute('aria-disabled', 'true')
      pick.title = item.unselectableReason
    } else {
      pick.addEventListener('click', () => {
        store.setSelected(item.id, !store.isSelected(item.id))
      })
    }
    row.append(pick)

    const main = node('div', 'checkout-item-main')
    const title = node('div', 'checkout-item-title')
    title.append(node('span', 'checkout-item-name', item.name))
    title.append(node('span', 'checkout-item-vendor', item.vendor))
    if (item.recommended) {
      const tag = node('span', 'checkout-tag', 'Recommended')
      tag.dataset.tone = 'recommended'
      title.append(tag)
    }
    main.append(title)
    main.append(node('p', 'checkout-item-what', item.whatItIs))

    const reasons = node('dl', 'checkout-reasons')
    const addReason = (kind, term, description) => {
      const pair = node('div', 'checkout-reason')
      pair.dataset.kind = kind
      pair.append(node('dt', '', term), node('dd', '', description))
      reasons.append(pair)
    }
    addReason('breaks', 'Without it', item.whatBreaksWithout)
    addReason('wanted', 'Why you wanted it', item.whyHeWantedIt)
    main.append(reasons)

    const bands = node('div', 'checkout-item-bands')
    for (const blocker of item.blocking) {
      bands.append(band('blocked', 'Cannot buy yet', [blocker.summary]))
    }
    for (const caution of item.cautions) {
      bands.append(band('warn', 'Check first', [caution.summary]))
    }
    if (item.warning) {
      // A hazard that survives the purchase. It does not gate the buy, which is
      // exactly why it has to be impossible to miss at the moment of choosing.
      bands.append(band('warn', 'Watch out', [item.warning]))
    }
    // The spend cap, on the line it applies to. Shown on a blocked line too:
    // the cap is a fact about the AMOUNT, and "this will also be refused for
    // being over the cap" is exactly what he needs to know before the blocker
    // clears and he tries to buy it. Only the do-not-buy group is exempt,
    // because arguing about the spend cap on something he should not buy at
    // all is noise on top of a settled answer.
    if (item.category !== 'do-not-buy' && catalog.spendPolicy.dailyLimitCents !== null
        && item.firstYearCents !== null
        && item.firstYearCents > catalog.spendPolicy.dailyLimitCents) {
      bands.append(band('warn', 'Over the spend cap', [
        `This one line is ${money(item.firstYearCents, item.currency)}, above the ${money(catalog.spendPolicy.dailyLimitCents, item.currency)} daily spend cap this installation is configured with.`,
        'If it were put through the spend ledger today it would be refused on its own while the cheaper lines in the same batch were recorded — so it would look like a partial success rather than a failure. You can still choose it here; this is a warning about what would happen next, not a block.',
        `Cap read from ${catalog.spendPolicy.source}.`,
      ]))
    }
    if (bands.childElementCount > 0) main.append(bands)

    if (item.notes) main.append(node('p', 'checkout-item-note', item.notes))
    if (item.sourceUrl) {
      // Printed, never linked: this screen has no business opening a browser,
      // and a clickable vendor link on a checkout is precisely the affordance
      // that makes people think the page can buy something.
      main.append(node('p', 'checkout-item-source', `Source: ${item.sourceUrl}`))
    }
    row.append(main)

    const column = priceColumn(item)
    let quantityOutput = null
    if (item.selectable && item.quantityMax > 1) {
      const stepper = node('div', 'checkout-qty')
      stepper.setAttribute('role', 'group')
      stepper.setAttribute('aria-label', `How many of ${item.name}`)
      const less = node('button', '', '−')
      less.type = 'button'
      less.setAttribute('aria-label', `One fewer ${item.name}`)
      const more = node('button', '', '+')
      more.type = 'button'
      more.setAttribute('aria-label', `One more ${item.name}`)
      quantityOutput = node('output', '', '0')
      less.addEventListener('click', () => store.setQuantity(item.id, store.quantityOf(item.id) - 1))
      more.addEventListener('click', () => store.setQuantity(item.id, store.quantityOf(item.id) + 1))
      stepper.append(less, quantityOutput, more)
      column.append(stepper)
      itemViews.set(item.id, { row, pick, quantityOutput, less, more, item })
    } else {
      itemViews.set(item.id, { row, pick, quantityOutput: null, less: null, more: null, item })
    }
    row.append(column)

    if (!item.selectable) {
      row.setAttribute('aria-disabled', 'true')
    }
    return row
  }

  /* ---------- the shop step ---------- */

  function buildShop() {
    const section = node('section', 'checkout-shop')

    const summary = node('section', 'checkout-summary')
    summary.setAttribute('aria-label', 'What your selection costs')
    const stat = (label, note) => {
      const cell = node('div', 'checkout-stat')
      const value = node('span', 'checkout-stat-value', '—')
      cell.append(value, node('span', 'checkout-stat-label', label), node('span', 'checkout-stat-note', note))
      return { cell, value, note: cell.querySelector('.checkout-stat-note') }
    }
    const cash = stat('Cash today', 'what leaves your account if you buy the selection now')
    const annual = stat('Every year after', 'the recurring commitment, once the first year is behind you')
    const chosen = stat('Items chosen', '')
    summary.append(cash.cell, annual.cell, chosen.cell)
    summaryNodes = { cash, annual, chosen }
    section.append(summary)

    noticesHost = node('div', 'checkout-notices')
    noticesHost.setAttribute('aria-live', 'polite')
    section.append(noticesHost)

    for (const category of catalog.categories) {
      const items = itemsInCategory(catalog, category.id)
      if (items.length === 0) continue
      const group = node('section', 'checkout-group')
      group.dataset.category = category.id

      const head = node('header', 'checkout-group-head')
      const heading = node('div', '')
      heading.append(node('h2', 'checkout-group-title', category.label))
      heading.append(node('p', 'checkout-group-blurb', category.blurb))
      head.append(heading)

      const recommended = items.filter(entry => entry.recommended && entry.selectable)
      const side = node('div', 'checkout-group-side')
      // How much of this shelf he can actually act on. Without it, a group
      // where most lines are unpriced reads as a broken screen rather than as
      // an honest "nobody has quoted these yet".
      const choosable = items.filter(entry => entry.selectable).length
      side.append(node('span', 'checkout-group-count',
        choosable === items.length
          ? `${items.length} item${items.length === 1 ? '' : 's'}`
          : `${choosable} of ${items.length} can be chosen`))
      if (recommended.length > 0) {
        const action = node('button', 'checkout-btn', `Select recommended (${recommended.length})`)
        action.type = 'button'
        action.addEventListener('click', () => store.selectRecommendedIn(category.id))
        side.append(action)
      }
      head.append(side)
      group.append(head)

      const list = node('ul', 'checkout-items')
      for (const item of items) list.append(itemRow(item))
      group.append(list)
      section.append(group)
    }

    /* the running total, following him down the list */
    const bar = node('div', 'checkout-bar')
    const figures = node('div', 'checkout-bar-figures')
    const barFigure = (label) => {
      const wrap = node('div', 'checkout-bar-figure')
      const value = node('b', '', '—')
      wrap.append(value, node('span', '', label))
      figures.append(wrap)
      return value
    }
    const barCash = barFigure('cash today')
    const barAnnual = barFigure('every year after')
    bar.append(figures)

    const actions = node('div', 'checkout-bar-actions')
    const clear = node('button', 'checkout-btn', 'Clear')
    clear.type = 'button'
    clear.dataset.quiet = 'true'
    clear.addEventListener('click', () => store.clearAll())
    const review = node('button', 'checkout-btn', 'Review my choices')
    review.type = 'button'
    review.dataset.primary = 'true'
    review.addEventListener('click', () => { step = 'review'; paintStage() })
    actions.append(clear, review)
    bar.append(actions)
    const barTruth = node('p', 'checkout-bar-truth', 'Reviewing shows you exactly what will and will not happen before anything is recorded.')
    bar.append(barTruth)
    barNodes = { bar, barCash, barAnnual, clear, review, barTruth }

    section.append(bar)
    return section
  }

  /** Repaint only what a selection change actually changes. */
  function paintShop(state) {
    if (!summaryNodes) return
    const currency = catalog.currency
    summaryNodes.cash.value.textContent = money(state.cashTodayCents, currency)
    summaryNodes.cash.cell.toggleAttribute('data-empty', state.cashTodayCents === 0)
    summaryNodes.annual.value.textContent = money(state.recurringAnnualCents, currency)
    summaryNodes.annual.cell.toggleAttribute('data-empty', state.recurringAnnualCents === 0)
    summaryNodes.chosen.value.textContent = String(state.count)
    summaryNodes.chosen.cell.toggleAttribute('data-empty', state.count === 0)
    summaryNodes.chosen.note.textContent = `of ${catalog.items.length} on the list`

    for (const [id, view] of itemViews) {
      const selected = state.lines.some(line => line.id === id)
      view.row.dataset.selected = String(selected)
      view.pick.setAttribute('aria-checked', String(selected))
      if (view.quantityOutput) {
        const quantity = state.lines.find(line => line.id === id)?.quantity || 0
        view.quantityOutput.textContent = String(quantity)
        view.less.disabled = quantity <= 1
        view.more.disabled = quantity >= view.item.quantityMax
      }
    }

    barNodes.barCash.textContent = money(state.cashTodayCents, currency)
    barNodes.barAnnual.textContent = money(state.recurringAnnualCents, currency)
    barNodes.review.disabled = state.count === 0
    barNodes.clear.disabled = state.count === 0
    // A blocked line is choosable here because choosing buys nothing. The
    // compensating duty is that it can never travel quietly: the count rides
    // on the running total the whole way down the page.
    const blocked = state.blockedLines.length
    barNodes.bar.dataset.blocked = String(blocked > 0)
    barNodes.barTruth.textContent = blocked > 0
      ? `${blocked} of your ${state.count} choice${state.count === 1 ? '' : 's'} cannot safely be bought yet. Reviewing lists which, and why, before anything is recorded.`
      : 'Reviewing shows you exactly what will and will not happen before anything is recorded.'

    paintNotices(state)
  }

  function paintNotices(state) {
    noticesHost.replaceChildren()
    if (state.persistenceFailed) {
      noticesHost.append(band('blocked', 'Not saved', [
        'This computer refused to store your choices, so they will be gone when Mission Control is closed. Everything on screen is still correct for right now.',
      ]))
    }
    for (const change of state.priceChanges) {
      noticesHost.append(band('warn', 'Price changed', [
        `${change.name} was ${money(change.wasCents, catalog.currency)} when you chose it and is ${change.nowCents === null ? 'now unpriced' : money(change.nowCents, catalog.currency)} on the current list.`,
        'Your choice has been kept and the totals use the current price. Nothing was re-decided for you.',
      ]))
    }
    if (state.dropped.length > 0) {
      noticesHost.append(band('warn', 'Removed from your list', state.dropped.map(entry => (
        `${entry.name || entry.id}: ${entry.reason}`
      ))))
    }
    if ((state.priceChanges.length > 0 || state.dropped.length > 0) && !state.persistenceFailed) {
      const dismiss = node('button', 'checkout-btn', 'Got it')
      dismiss.type = 'button'
      dismiss.addEventListener('click', () => store.acknowledgeNotices())
      const holder = node('div', 'checkout-step-actions')
      holder.append(dismiss)
      noticesHost.append(holder)
    }
    // The cart-level cap statement. Distinct from the per-line one: a basket
    // can cross the cap without any single line doing so.
    if (state.count > 0 && state.cap.known && state.cap.totalOverCap) {
      const lines = state.cap.overCapLineIds.length
      noticesHost.append(band('warn', 'Over the daily spend cap', [
        `Your selection comes to ${money(state.cap.cashTodayCents, catalog.currency)} today, above the ${money(state.cap.limitCents, catalog.currency)} daily cap this installation is configured with.`,
        lines > 0
          ? `${lines} line${lines === 1 ? ' is' : 's are'} over the cap on their own and would be refused individually, while roughly ${money(state.cap.recordableCents, catalog.currency)} of smaller lines would be recorded. That is a partial result, not a failure, and it is easy to read as everything having worked.`
          : 'No single line is over the cap, so each would be checked on its own; the cap applies per amount, and a day\'s spending accumulates against it.',
        `Cap read from ${catalog.spendPolicy.source}.`,
      ]))
    }
  }

  /* ---------- the review step ---------- */

  function buildReview(state) {
    const section = node('section', 'checkout-step')
    section.append(node('h2', 'checkout-step-title', 'Review your choices'))
    section.append(node('p', 'checkout-step-lede',
      'These are the lines you picked, at the prices currently on the list. Read what confirming does before you press it.'))

    // BLOCKED LINES GET THE TOP OF THE PAGE, above the money. He can choose
    // them, so this is the one place before the record is written where the
    // reasons are read together rather than one card at a time.
    if (state.blockedLines.length > 0) {
      section.append(band('blocked',
        `${state.blockedLines.length} cannot be bought yet`,
        [
          'These are in your list and they are saved, but each one has something unresolved in front of it. Nothing here buys anything, so choosing them is safe — acting on them is what is not.',
          ...state.blockedLines.map(line => `${line.item.name}: ${line.item.blockedReason}`),
        ]))
    }

    const head = node('div', 'checkout-lines-head')
    head.append(node('span', '', 'Item'), node('span', '', 'Today'), node('span', '', 'Each year'))
    section.append(head)

    const list = node('ul', 'checkout-lines')
    for (const line of state.lines) {
      const entry = node('li', 'checkout-line')
      entry.dataset.blocked = String(line.item.blocked)
      const left = node('div', '')
      left.append(node('div', 'checkout-line-name',
        line.quantity > 1 ? `${line.item.name} × ${line.quantity}` : line.item.name))
      left.append(node('div', 'checkout-line-sub',
        `${line.item.vendor} · ${CADENCE_LABEL[line.item.cadence].toLowerCase()}`
        + (line.item.blocked ? ' · cannot be bought yet' : '')))
      entry.append(left)
      entry.append(node('div', 'checkout-line-amount', money(line.cashTodayCents, catalog.currency)))
      entry.append(node('div', 'checkout-line-annual',
        line.recurringAnnualCents === 0 ? '—' : money(line.recurringAnnualCents, catalog.currency)))
      list.append(entry)
    }
    section.append(list)

    const totals = node('div', 'checkout-totals')
    totals.append(node('div', 'checkout-totals-label', 'Total'))
    totals.append(node('div', 'checkout-line-amount', money(state.cashTodayCents, catalog.currency)))
    totals.append(node('div', 'checkout-line-annual', money(state.recurringAnnualCents, catalog.currency)))
    section.append(totals)

    if (state.cap.known && (state.cap.totalOverCap || state.cap.overCapLineIds.length > 0)) {
      section.append(band('warn', 'Spend cap', [
        `The daily spend cap on this installation is ${money(state.cap.limitCents, catalog.currency)} and this selection is ${money(state.cap.cashTodayCents, catalog.currency)} today.`,
        state.cap.overCapLineIds.length > 0
          ? `${state.cap.overCapLineIds.length} line${state.cap.overCapLineIds.length === 1 ? '' : 's'} exceed the cap alone and would be refused individually if put through the spend ledger, while the rest would be recorded.`
          : 'No single line exceeds it, but the day\'s total does.',
        'Confirming here does not touch the spend ledger, so nothing is refused and nothing is recorded against the cap. This is what you would run into next.',
      ]))
    }

    const truth = node('div', 'checkout-truth')
    const panel = (tone, title, mark, entries) => {
      const box = node('div', 'checkout-truth-panel')
      box.dataset.tone = tone
      box.append(node('div', 'checkout-truth-title', title))
      const list2 = node('ul', 'checkout-truth-list')
      for (const entry of entries) {
        const row = node('li', '')
        row.append(node('span', 'checkout-truth-mark', mark), node('span', '', entry))
        list2.append(row)
      }
      box.append(list2)
      return box
    }
    truth.append(panel('does', 'What confirming does', '✓', [
      'Saves this exact list of choices on this computer, so it is still here next time you open Mission Control.',
      'Writes a dated note of what you chose and what it would cost, at today\'s prices, against the account you are signed in as.',
      'Keeps both totals with it, so a price that changes later cannot quietly rewrite what you agreed to.',
    ]))
    truth.append(panel('does-not', 'What confirming does NOT do', '✕', [
      'It does not charge a card. There is no card on file and no payment integration behind this screen.',
      'It does not place an order, reserve anything, or contact any vendor.',
      'It does not create an account, file anything with a state, or buy a domain.',
      'It is not a receipt and it is not proof of purchase. Nothing has been bought.',
      'It is not an audit record. This page writes it and stores it locally, so treat it as your own note rather than as evidence.',
      ...(state.blockedLines.length > 0
        ? [`It does not unblock anything. ${state.blockedLines.length} of these still cannot safely be bought, and confirming does not change that.`]
        : []),
    ]))
    section.append(truth)

    const queueHost = node('div', '')
    section.append(queueHost)
    void paintApprovalsQueue(queueHost)

    // WHO IS CONFIRMING. The button starts disabled and stays disabled unless a
    // real signed-in account answers, because the owner's condition is that a
    // decision must never be recorded against nobody. The label is honest at
    // every stage rather than going from enabled to a failure message.
    const identityHost = node('div', '')
    section.append(identityHost)

    const actions = node('div', 'checkout-step-actions')
    const back = node('button', 'checkout-btn', 'Keep choosing')
    back.type = 'button'
    back.addEventListener('click', () => { step = 'shop'; paintStage() })
    const confirm = node('button', 'checkout-btn', 'Checking who is signed in…')
    confirm.type = 'button'
    confirm.dataset.primary = 'true'
    confirm.disabled = true
    const actionNote = node('p', '', 'The button says what it does. It saves a decision; it does not pay anyone.')
    actions.append(back, confirm, actionNote)
    section.append(actions)

    void (async () => {
      const identity = await readApprovalIdentity()
      if (destroyed || !confirm.isConnected) return
      if (identity.ok !== true) {
        confirm.disabled = true
        confirm.textContent = identity.canSignIn ? 'Sign in to confirm' : 'Confirming is unavailable'
        identityHost.replaceChildren(band('blocked', 'Not signed in', [identity.reason, identity.detail]))
        actionNote.textContent = 'Nothing has been recorded, and nothing has been lost — your choices are saved and will be here when you come back.'
        return
      }
      confirm.disabled = false
      confirm.textContent = 'Confirm and save my decision'
      // Signing in is attribution, not an attestation, and the vault half of
      // his condition is genuinely unverified in this build. Both are said
      // here rather than implied away by a green badge.
      identityHost.replaceChildren(band('note', 'Signed in', [
        `Confirming records this decision against ${identity.principal.displayName}.`,
        identity.principal.vault.summary,
        identity.principal.vault.detail,
      ]))
      confirm.addEventListener('click', () => {
        store.confirm({ principal: identity.principal })
        if (!store.summary().confirmed) {
          // The store refused. It must not look like it worked.
          identityHost.replaceChildren(band('blocked', 'Not recorded', [
            'The decision could not be recorded, so nothing was saved. Your choices are unchanged.',
          ]))
          return
        }
        step = 'done'
        paintStage()
      }, { once: true })
    })()
    return section
  }

  /**
   * What the audited approvals queue actually has in it, right now.
   *
   * This screen deliberately does NOT submit a decision into that queue. The
   * queue's line items are the engine's, with the engine's own ids, and
   * matching them to catalogue entries by name in order to auto-approve them
   * would mean guessing which amounts the owner meant to approve. Approving
   * the wrong line is the one mistake here that cannot be taken back, so the
   * screen reports the queue truthfully and sends him to the surface that
   * genuinely decides it.
   */
  async function paintApprovalsQueue(host) {
    let raw
    try { raw = await ownerPromptSnapshot() }
    catch { raw = null }
    if (destroyed || !host.isConnected) return

    if (raw?.ok !== true) {
      host.replaceChildren(band('note', 'Approvals queue', [
        'The approvals service is not reachable from this build, so nothing here was sent anywhere and nothing could have been.',
        'That does not affect what confirming below does: your decision is recorded on this computer either way.',
      ]))
      return
    }
    let snapshot
    try { snapshot = normalizeOwnerPromptSnapshot(raw) }
    catch {
      host.replaceChildren(band('note', 'Approvals queue', [
        'The approvals queue answered with something this build could not read, so it is not being summarised rather than summarised wrongly.',
      ]))
      return
    }
    const carts = snapshot.prompts.filter(prompt => prompt.kind === 'purchase_batch')
    if (carts.length === 0) {
      host.replaceChildren(band('good', 'Approvals queue', [
        'The approvals queue is reachable and has no purchase request waiting in it. Nothing is pending your approval anywhere else.',
      ]))
      return
    }
    const sameCurrency = carts.every(cart => cart.currency === carts[0].currency)
    const total = sameCurrency
      ? money(carts.reduce((sum, cart) => sum + cart.totalCents, 0), carts[0].currency)
      : `${carts.length} requests`
    const notice = band('warn', 'Waiting in Approvals', [
      `There ${carts.length === 1 ? 'is' : 'are'} ${carts.length} purchase request${carts.length === 1 ? '' : 's'} waiting for your decision in Approvals, totalling ${total}.`,
      'That is a separate, audited queue and this screen does not decide it. Confirming here records your shopping decision; it does not approve or deny those lines.',
    ])
    const go = node('button', 'checkout-btn', 'Open Approvals')
    go.type = 'button'
    go.addEventListener('click', () => navigate('#/approvals'))
    const holder = node('div', 'checkout-step-actions')
    holder.append(go)
    host.replaceChildren(notice, holder)
  }

  /* ---------- the confirmed step ---------- */

  function buildDone(state) {
    const record = state.confirmed
    const section = node('section', 'checkout-step')
    section.append(node('h2', 'checkout-step-title', 'Your decision is saved'))
    section.append(node('p', 'checkout-step-lede',
      'This is a record of what you decided, not a receipt. Nothing has been bought and no money has moved.'))

    const box = node('div', 'checkout-record')
    const stamped = new Date(record.at)
    box.append(node('div', 'checkout-record-stamp',
      `Decided ${Number.isFinite(stamped.getTime()) ? stamped.toLocaleString() : record.at}`
      + (record.approvedBy ? ` by ${record.approvedBy.displayName}` : '')))

    const list = node('ul', 'checkout-lines')
    for (const line of record.lines) {
      const entry = node('li', 'checkout-line')
      const left = node('div', '')
      entry.dataset.blocked = String(line.blocked === true)
      left.append(node('div', 'checkout-line-name', line.quantity > 1 ? `${line.name} × ${line.quantity}` : line.name))
      left.append(node('div', 'checkout-line-sub',
        `${line.vendor} · ${CADENCE_LABEL[line.cadence].toLowerCase()}`
        + (line.blocked ? ' · cannot be bought yet' : '')))
      entry.append(left)
      entry.append(node('div', 'checkout-line-amount', money(line.cashTodayCents, record.currency)))
      entry.append(node('div', 'checkout-line-annual',
        line.recurringAnnualCents === 0 ? '—' : money(line.recurringAnnualCents, record.currency)))
      list.append(entry)
    }
    box.append(list)

    const totals = node('div', 'checkout-totals')
    totals.append(node('div', 'checkout-totals-label', 'Total'))
    totals.append(node('div', 'checkout-line-amount', money(record.cashTodayCents, record.currency)))
    totals.append(node('div', 'checkout-line-annual', money(record.recurringAnnualCents, record.currency)))
    box.append(totals)
    section.append(box)

    section.append(band('note', 'What happens next', [
      'Nothing happens automatically. Each of these still has to be bought by a person, on the vendor\'s own site, with a real payment method.',
      'No approval was recorded in the audited approvals queue, because this screen does not submit to it.',
    ]))

    // WHAT THIS RECORD IS WORTH, said on the record itself. It is composed and
    // stored by this page, so it is a durable note for him and not evidence.
    // Claiming otherwise is the failure that cannot be walked back, and the
    // vault half of his sign-in condition is stated rather than left implied.
    section.append(band('warn', 'What this record is', [
      'This is a note of your decision, kept on this computer. It is not an audit record and it is not proof of anything: this page wrote it, so anyone with developer tools on this machine could alter it.',
      record.vaultVerified === false && record.vaultNote
        ? `${record.vaultNote} That half of "signed in with my vault attached" was never verified by this build, so this record does not claim it was.`
        : 'The audited record of what your assistant actually does lives in the ledger and the approvals queue, not here.',
    ]))

    const actions = node('div', 'checkout-step-actions')
    const again = node('button', 'checkout-btn', 'Change my choices')
    again.type = 'button'
    again.dataset.primary = 'true'
    again.addEventListener('click', () => { step = 'shop'; paintStage() })
    actions.append(again)
    actions.append(node('p', '', 'Changing anything clears this record, because a saved decision must always match what is selected.'))
    section.append(actions)
    return section
  }

  /* ---------- step switching ---------- */

  function paintStage() {
    const state = store.summary()
    if (step === 'done' && !state.confirmed) step = 'shop'
    if (step === 'review' && state.count === 0) step = 'shop'

    if (step === 'shop') {
      if (!shopSection) {
        itemViews.clear()
        shopSection = buildShop()
      }
      stage.replaceChildren(shopSection)
      paintShop(state)
      return
    }
    stage.replaceChildren(step === 'review' ? buildReview(state) : buildDone(state))
  }

  function onStoreChange(state) {
    if (destroyed) return
    // Only the shop step repaints live; the review and confirmed steps are
    // snapshots of a decision and must not shift under him.
    if (step === 'shop' && shopSection?.isConnected) paintShop(state)
  }

  async function start() {
    let loaded
    try {
      loaded = await loadCatalog()
    } catch (error) {
      if (destroyed) return
      setUnavailable(
        'The purchase list could not be read',
        error instanceof CatalogError
          ? `${error.message} Nothing is being shown rather than a partial list you might choose from.`
          : 'The purchase list could not be loaded, so nothing is being shown rather than a partial list you might choose from.',
      )
      return
    }
    if (destroyed) return
    catalog = loaded
    const generated = new Date(catalog.generatedAt)
    provenanceLine.textContent =
      `${catalog.items.length} items · list prepared ${Number.isFinite(generated.getTime()) ? generated.toLocaleDateString() : catalog.generatedAt}`
      + ` · spend cap ${catalog.spendPolicy.dailyLimitCents === null ? 'not readable' : money(catalog.spendPolicy.dailyLimitCents, catalog.currency)} per day from ${catalog.spendPolicy.source}`
    store = createSelectionStore({
      catalog,
      storage: safeStorage(typeof localStorage === 'undefined' ? null : localStorage),
      onChange: onStoreChange,
    })
    if (store.summary().confirmed) step = 'done'
    paintStage()
  }

  void start()

  return {
    el: root,
    destroy() {
      destroyed = true
      itemViews.clear()
    },
  }
}

export { SELECTION_STORAGE_KEY }
