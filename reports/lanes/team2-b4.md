# Lane: team2-B4 — the drawer's "all settings →" link on the settings route

Task as given: "On the settings route, `a.fleet-profile-notice` is painted over the settings
drawer's 'all settings →' link, so clicking the link activates the notice instead. Fix the
stacking and prove the link is clickable by clicking it in the packaged window."

## CORRECTION TO THE TASK'S PREMISE, FIRST LINE

The link is **not** covered in this tree. The overlap was already fixed in the app tree by
another wave-2 lane before B4 started — commit `3f6205e` (*wave-2 account-isolation-wiring*,
2026-08-11 12:23), one rule at `src/settings.css:38`:

    body:has(#drawer.open) .fleet-profile-notice { display: none; }

So I changed no product code. What I did instead was prove the customer-facing claim by use in
the packaged window, and leave a driver behind that fails if the rule is ever removed — because
"we looked and it was fine" is not a thing a later session can re-check.

## What was measured, and why the obvious proof is not one

Both the notice and the link are `<a href="#/settings">`, and pressing anywhere outside the
drawer closes the drawer as well (`src/main.js` pointerdown handler). So "the drawer closed" and
"the address is #/settings" are true **whichever** of the two took the press: neither
distinguishes a fixed build from the broken one. The only thing that does is which element the
press landed on, so the driver records the click target from a capture listener on `document`
and dispatches a real `Input.dispatchMouseEvent` at the link's own centre.

New file: `tools/settings-drawer-link-qa.mjs` (no lane owns it; nothing else was edited). It
stages the current `dist/` + `shell/` into the packaged build's asar, the same way the account
and checkout drivers do, so it measures this tree rather than a build from an hour ago.

## Result — `node tools/settings-drawer-link-qa.mjs`, 15/15, 18s, 2026-08-11

- the packaged application opens (window in 724ms)
- **on `computers`, before the settings page has ever been opened in that window**: the press
  lands on `A.drawer-all` and the address becomes `#/settings`. This is the absence case for the
  fix itself — the rule lives in `src/settings.css`, which is imported by the settings/account/
  setup views; if the build ever split those into their own stylesheet the rule would arrive
  only *after* somebody had already visited one, i.e. never for a new customer.
- on the settings route, drawer closed: the notice really is showing (`display=block`, "Some
  screens show example data…")
- the two really do occupy the same corner: link box `x 1066.7 w 318.5, y 775.8 h 41.5` vs
  notice box `x 824 w 560, y 762.3 h 53.7` in a 1400×832 window; notice `z-index 190` over the
  drawer's `80`. The geometry of the reported defect is real; only the suppression removes it.
- with the drawer open: `elementFromPoint` at the link's centre → `A.drawer-all`; the notice is
  present in the DOM with computed `display: none`
- a serious notice (`.is-serious`) is suppressed by the open drawer too → `display: none`, hit
  still `A.drawer-all`. Three other rules in this product suppress this notice with
  `:not(.is-serious)`, correctly; had the drawer rule been written the same way by reflex, the
  customer whose profile is broken would have been the one who could not press the link.
- **a real mouse press at that point is received by the link itself**: `A.drawer-all`
  `href=#/settings` text `"all settings →"`; afterwards `hash=#/settings`, drawer closed
- CONTROL, in the same window: inject `.fleet-profile-notice{display:block !important}` and the
  identical press lands on `A.fleet-profile-notice` — the reported defect, reproduced on demand
- remove the control and the link takes the press again

The `release/win-unpacked/resources/app.asar` on disk (12:22) also already contains the rule, so
the packaged artifact sitting there is not stale either.

## Why hiding is the right fix and I did not re-do it

The drawer is `role="dialog" aria-modal="true"` and parks the header and stage behind it with
`inert`. Nothing may float above a modal, so the notice has nothing to add for the span the
drawer is open. Lowering its `z-index` below the drawer instead would paint it *behind* an
opaque panel — half-clipped, still there, worse. The committed rule is scoped to exactly that
span and is route-independent, which is why it also holds on `computers`.

## Left alone deliberately (not mine to edit mid-wave)

Two shared QA files still carry comments that assert the overlap as present tense, which will
mislead the next reader into believing the product is broken:

- `tools/test-account-harness.mjs:524-531` — `gotoSettings()` routes via home *"deliberately"*
  because "on the settings route the floating `a.fleet-profile-notice` is painted over … where
  the drawer's own 'all settings' link sits". The detour is now unnecessary; the comment is now
  false. Every account/checkout driver in the family depends on this function.
- `tools/account-isolation-leak-qa.mjs:290-294` — same claim, "recorded rather than treated as a
  stopper". Its check passes today.

Both are outside this lane's territory and are live under other lanes' runs, so they are
reported rather than edited.
