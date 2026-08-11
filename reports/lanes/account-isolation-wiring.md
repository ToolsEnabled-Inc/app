# Lane: account-isolation-wiring (session 6e870ec4)

Task: the per-account partition E1 built is real and `mcAccount.getSetting/putSetting`
is live, but nothing in the renderer called it -- theme (`mc.theme`), settings
(`mc.set.*`) and the checkout selection (`mc.checkout.v1`) all wrote the device-level
`renderer-prefs.json`, last-writer-wins, so a second signed-in person on one Windows
login inherited the first person's theme, settings and ticked purchase lines. Wire the
three renderer write paths through the account partition when signed in, device-level
when signed out, fail closed to signed-out. Verify BY USE.

## Baseline (measured before any change, packaged build)
`node tools/account-isolation-leak-qa.mjs` = 25/35. The 10 failures: both-direction
theme/setting/selection inheritance (6), the two device-file mechanism checks (theme +
selection stored once per account), the accounts/ partition dir never created, and one
NON-isolation UI overlap (the drawer's "all settings" link covered by the floating
fleet-profile notice on the settings route).

## What I changed (working tree only; no git writes)
- `public/durable-storage.js` -- the single boundary all three write paths funnel
  through (localStorage is this shim). Made it account-aware:
  - account-scoped keys are `mc.theme`, `mc.checkout.v1`, `mc.set.*`; everything else
    stays per device, unchanged.
  - signed in: reads consult an in-memory `accountOverlay` ONLY (a value the account
    never set reads as ABSENT, never the device value or the previous account's -- the
    no-leak property); writes go to the authoritative partition via
    `mcAccount.putSetting` (creates `<userData>/accounts/<id>.json`) AND are mirrored
    synchronously into the device file under a per-account key `acct:<id>:<name>` (so a
    settings click is durable the instant it returns, and the settings FILE itself is
    partitioned rather than one shared record).
  - the overlay is hydrated from the partition on sign-in (this is what carries a first
    account's ADOPTED settings, which live only there), with the device mirror winning
    where it also holds a key (covers a putSetting that never landed).
  - FAIL CLOSED: anything other than a well-formed "signed in as <32-hex id>" resolves
    to signed out / device level. Async account read wrapped so an unreadable state
    cannot route a write into another name.
  - the theme is painted once at load, so a change of account re-applies it
    (`document.documentElement.dataset.theme`) and fires `mc:account-storage-rehydrated`;
    the settings page and checkout re-read localStorage on mount so they need no help.
  - exposes `window.mcDurableStorage.onAccountChanged()`; inert in a plain browser
    (no `window.mcAccount`), so vite dev/preview and the unit tests are unchanged.
- `src/views/account.js` -- pokes `mcDurableStorage.onAccountChanged()` after every
  account state read (sign-in / sign-out / create / password change), so the overlay
  and theme follow who is signed in without a reload.
- `src/settings.css` -- `body:has(#drawer.open) .fleet-profile-notice { display:none }`.
  The floating notice is z-index 190, above the drawer's 80, pinned to the same
  bottom-right corner as the drawer's "all settings" link; the modal drawer takes focus
  while open, so the notice is hidden for exactly that span. (This is the one
  NON-isolation failure; see the deviation note below.)

NOT touched: `src/checkout-selection.js`, `src/views/checkout.js`, `src/main.js`,
`src/views/settings.js` -- all three write paths were fixed at the shim boundary, so no
edit to checkout (cart-rebuild / price-* territory) or the theme/settings callers.

## Verified BY USE (this tree, freshly built dist, 2026-08-11)
- `node tools/account-isolation-leak-qa.mjs` = 35/35. Two real accounts driven through
  the packaged window: second person sees white/timeline/no-selection (not the first's
  black/channels/qa-line-one); first person returns to their own black/channels/
  qa-line-one and inherits none of the second's; `<userData>/accounts/` holds 2 files;
  the device file holds 2 namespaced theme bindings and 2 selection bindings.
- `node --test product-account renderer-prefs userdata-adoption durable-storage` =
  127/127.
- `node tools/prefs-origin-proof.mjs release/win-unpacked` exit 0 (device-level
  persistence across a port change + unreadable file, signed out -> account layer inert,
  no regression).
- `node tools/userdata-adoption-packaged-proof.mjs` exit 0 (rename adoption + stranded
  install both still pass).
- `node tools/account-isolation-session-qa.mjs` = 28/28 (account boundary intact:
  sign-out, epoch revocation, password change, corrupt session/account files all still
  resolve fail-closed). My changes are read-only on that path, no regression.

## Deviation flagged (owner's terms)
The owner asked for the three write paths routed through the partition. Reaching the
stated bar of 35/35 also required fixing ONE thing that is not an isolation leak: the
fleet-profile notice covering the drawer's "all settings" link on the settings route
(the leak QA checks it, and its own comment calls it "recorded rather than treated as a
stopper"). I applied the minimal CSS fix above and flag it here rather than fold it
silently into the isolation work. No other live lane owns that surface.
