/* THE APPROVALS SCREEN'S DEMONSTRATION: which face it wears, and the words.
 *
 * Every landing view in this product labels its own example data -- home's
 * "Example, not your data" badge, metrics' demonstration face and "made-up
 * numbers" note, research's source line -- and the approvals view carried no
 * marking of any kind (found by the paid lane's walk of the vendored
 * simulation build, their commit 36010d5; reassigned to this repository by
 * legal's launch delivery, 2026-08-18). On that build the screen showed "the
 * approvals service is unavailable" instead, which on a page whose whole job
 * is showing a stranger the product reads as a broken product -- and an
 * unmarked queue anywhere is something a visitor is free to read as somebody's
 * real decisions.
 *
 * WHICH FACE, AND WHY IT IS DERIVED RATHER THAN A NEW FLAG. Approvals has no
 * entry in src/live-flags.js because its data is the audited queue: there is
 * no per-view source to switch, and inventing a flag would put a switch in
 * Settings that pretends the queue has a simulated twin. The one state in
 * which this screen is part of a demonstration is when the WHOLE product's
 * screens are -- which is what setup's "screens" answer records (every live
 * flag off together) and what the simulation build's demo-mode.js writes
 * (every flag simulated). So: every declared view simulated means
 * demonstration; any single view live means this screen polls the live queue
 * exactly as it always has. A person who flipped one page to the demonstration
 * in Settings kept their own approvals on purpose.
 *
 * THIS MODULE IS PURE. It reads no DOM and opens no connection, so the suite
 * (tools/test/approvals-example-marking.test.mjs) exercises the face decision
 * and the example queue's shape for real. The view does the painting.
 */

import { LIVE_VIEW_FLAGS, isLiveView } from './live-flags.js'

export const APPROVALS_FACES = Object.freeze(['demonstration', 'this-computer'])

/**
 * Which face the approvals screen wears right now.
 *
 * Asks about EVERY declared view, so a view added to the product later is part
 * of this decision automatically rather than silently ignored.
 */
export function approvalsFace({ isLive = isLiveView } = {}) {
  const allSimulated = LIVE_VIEW_FLAGS.every(flag => !isLive(flag.id))
  return allSimulated ? 'demonstration' : 'this-computer'
}

/* THE WORDS, shared with the screens that already say them. The badge is
 * home's exact badge text and the source line is the research page's shape,
 * because a product that labels the same state two ways teaches people to
 * read neither. */
export const APPROVALS_EXAMPLE_MARKING = Object.freeze({
  badge: 'Example, not your data',
  source: 'example data — turn on Live data in settings to see your own approvals',
  queueNote: 'An example queue, so you can see how requests read. Nothing here is waiting on anyone.',
  cardStatus: 'An example request, not yours. Its controls stay off, and nothing can be approved from it.',
  deadlineNote: '· an example deadline, from the example requests above',
  purchaseNote: '· example amounts; approving would record a decision, not spend',
})

/* THE EXAMPLE QUEUE. Two requests, the two kinds the live queue actually
 * carries: a purchase list whose total is bound to its lines (the invariant
 * the live screen refuses to render without) and a confirmation. Every date
 * hangs off the clock passed in, so the queue reads as current whenever it is
 * shown and a test can pin it; for one clock the value is always the same,
 * because a demonstration that invents different data on every paint reads as
 * live activity -- the exact defect the marking exists to prevent. */
const DAY_MS = 86_400_000

const iso = ms => new Date(ms).toISOString()

export function exampleOwnerPrompts(nowMs = Date.now()) {
  return Object.freeze([
    Object.freeze({
      id: 'example-purchases',
      kind: 'purchase_batch',
      title: 'An example purchase list',
      message: 'Two made-up lines, so you can see how a purchase request reads. Each line names what, where, and exactly how much.',
      createdAt: iso(nowMs - 2 * DAY_MS),
      expiresAt: iso(nowMs + 5 * DAY_MS),
      state: 'pending',
      defaultDecision: 'deny',
      currency: 'USD',
      totalCents: 11_140,
      items: Object.freeze([
        Object.freeze({
          id: 'example-line-domain',
          description: 'Example domain name, renewed for one year',
          amountCents: 1_240,
          currency: 'USD',
          merchant: 'An example registrar',
          purpose: 'Keeps the example project’s address working for another year.',
        }),
        Object.freeze({
          id: 'example-line-certificate',
          description: 'Example signing certificate, one month',
          amountCents: 9_900,
          currency: 'USD',
          merchant: 'An example certificate authority',
          purpose: 'Lets the example project sign what it ships.',
        }),
      ]),
    }),
    Object.freeze({
      id: 'example-confirmation',
      kind: 'confirmation',
      title: 'An example confirmation',
      message: 'An agent asks here before doing something it may not do on its own. This one is an example, so it asks for nothing.',
      createdAt: iso(nowMs - 1 * DAY_MS),
      expiresAt: iso(nowMs + 3 * DAY_MS),
      state: 'pending',
      defaultDecision: 'deny',
    }),
  ])
}
