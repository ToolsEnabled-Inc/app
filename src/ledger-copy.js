/* THE WORDS THE LEDGER PAGE USES, IN THE ONE FILE THAT HAS NO BROWSER IN IT.
 *
 * WHY THESE STRINGS LEFT THE VIEW. src/views/ledger.js imports a stylesheet, so
 * a plain `node` run cannot load it, and every sentence this page shows when it
 * has no rows was composed inside a closure in there -- unreachable to anything
 * without a browser. That matters because the defect on this page is not any
 * one sentence. It is the composition, and a check has to be able to build the
 * whole panel for a state to see it.
 *
 * THIS FILE IS THE EXTRACTION ONLY. Every string below is exactly what the page
 * shows today, moved and not rewritten, so the composed-output check that lands
 * with it measures the product as it is.
 */

export const LEDGER_LOADING = Object.freeze({
  state: 'loading',
  tone: 'refused',
  label: 'The ledger could not be read',
  className: 'projection-unavailable',
  body: 'the ledger could not be read yet · still reading the ledger',
  count: 'reading…',
  door: false,
})

export const LEDGER_UNAVAILABLE = Object.freeze({
  state: 'unavailable',
  tone: 'refused',
  label: 'The ledger could not be read',
  className: 'projection-unavailable',
  body: 'This register lists requests recorded while ToolsEnabled itself is being built. This copy does not keep one, so there is nothing here to show.',
  count: 'could not be read',
  door: true,
})

/* THE STATES THE REGISTER CAN BE IN WITH NOTHING TO DRAW, declared rather than
   discovered, so tools/check-composed-output.mjs measures every one of them and
   a state added later cannot arrive unmeasured. */
export const REGISTER_NOTICE_STATES = Object.freeze(['loading', 'unavailable'])

/** What the register shows when it has no rows, or null when it has rows. */
export function registerNotice(source) {
  if (!source) return null
  if (source.kind === 'loading') return LEDGER_LOADING
  if (source.kind === 'unavailable') return LEDGER_UNAVAILABLE
  return null
}

/* ---------------------------------------------------------------- forms -- */

export const DECISION_FORM = Object.freeze({
  title: 'Approve or decline a request',
  targetLabel: 'Which request',
  targetPlaceholder: 'its number, as shown in the list',
  reasonLabel: 'Why',
  approve: 'Approve',
  decline: 'Decline',
})

export const QUEUE_FORM = Object.freeze({
  title: 'Take or finish queued work',
  rootLabel: 'Folder',
  itemLabel: 'Which item',
  itemPlaceholder: 'its number, as shown in the list',
  proofLabel: 'Proof you are looking at the current list',
  reasonLabel: 'Why you are closing it',
  reasonPlaceholder: 'needed only when you close one',
  claim: 'Claim',
  close: 'Close',
})

/** The one line under the queue buttons. */
export function queueSnapshotLine(snapshot) {
  const ready = snapshot?.ok === true && /^[a-f0-9]{64}$/.test(snapshot?.hash || '')
  return Object.freeze(ready
    ? { ready: true, tone: 'ready', text: 'This folder’s work list was read just now, so Claim and Close are ready.' }
    : {
      ready: false,
      tone: 'unavailable',
      text: `This folder’s work list could not be read, so Claim and Close are off. ${snapshot?.reason || 'Pick another folder, or press Retry above.'}`,
    })
}
