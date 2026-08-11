# Lane: setup-deadend

Tree: `C:\Users\joshp\Desktop\wt-capability` (branch `packaging/capability-layer`).
No git write commands were run. Working-tree edits only.

## What the lane was sent to fix, and what was actually there

**Sent to fix:** a user who accepts both answers marked "Recommended" ends with no
Start control.

**Found:** that defect was already repaired in this tree by commit `27f5922`
("Recommend the answer that leaves a working product..."). `RECOMMENDED_ANSWERS`
is now `assisted`/`live`, separate from `SAFE_ANSWERS` (which a *skip* applies),
and `tools/test/setup-profile.test.mjs` asserts `profileCanStartAnAgent` for the
recommended answers at every tier. What was missing was **verification by use**:
no packaged run had ever walked the recommended path from a genuinely fresh
machine. `tools/recommended-path-packaged-qa.mjs` *seeds* the permission level
and says so; `tools/setup-walkthrough-qa.mjs` clicks it and then **failed**,
reporting only `timed out waiting for the app`.

## The real, still-live defect: Finish silently did nothing

Reproduced on the packaged window, from a sterile profile, twice before any
change:

- `machine.json` on disk **had** `tier: "guided"` -- the level was recorded.
- the stored profile was still `status: "in-progress"` -- `finish()` never
  completed.
- the route never left `#/setup`, and the walkthrough restarted at question 1.

Cause: **the setup view can be mounted twice.** Measured directly --
`sections=2 continues=2 stages=1` at `#/setup`. `swapView()` in `src/main.js`
leaves the outgoing view in the DOM, fully clickable, for 420ms (or
`VIEW_MORPH_MS + 40`) before it calls `destroy()` and `remove()`. A person whose
eye reaches the first copy drives an instance that is about to be torn down.

`finish()` then hit `if (destroyed) return` **after** the folder had already been
written -- so nothing was applied, nothing was recorded, nothing navigated. The
most important button in the product did precisely nothing and said nothing.

## The fix

`src/views/setup.js` `finish()`: the destroyed-guard now covers **only the
paint**, which is the one thing a torn-down section genuinely cannot do. Applying
the profile, recording it and navigating are writes to localStorage and to the
route -- global, and correct from a torn-down instance too. The person pressed
Finish; the folder was already written. A failed folder write still stops and
still refuses (absence case: `!result?.ok` covers `undefined`/`null`, so a
missing reply is never read as success).

The double mount itself is the deeper defect and belongs to the router, which
this lane may not edit. Handed over as a shared-file edit: in `swapView()`, make
the outgoing view non-interactive (`old.el.inert = true`) as the exit begins.

## Evidence (all re-run against the current tree immediately before reporting)

| command | before | after |
|---|---|---|
| `node tools/setup-walkthrough-qa.mjs` | exit 1, `timed out waiting for the app` | **finish 27/27, skip 18/18, exit 0** (21.6s) |
| `node tools/setup-deadend-recommended-qa.mjs` | n/a (new) | **13/13, exit 0**, 5 clicks (25.5s) |
| `node tools/recommended-path-packaged-qa.mjs` | 6/6 (recommended only, tier seeded) | **21/21 all three scenarios, exit 0** (34.5s) |
| `node --test tools/test/setup-profile.test.mjs tools/test/first-run-tier-screen.test.mjs` | 65/65 | **65/65, exit 0** (0.3s) |

**Click count, fresh machine, accepting every Recommended answer: 5 clicks** from
the first-run permission question to a visible, enabled Start control
(Continue x3, "See what that sets", "Finish setup"). Start is present and shown;
the remaining `unavailable` status is the honest "nobody is signed in to Codex"
notice, not an absent control.

## New file

`tools/setup-deadend-recommended-qa.mjs` -- walks the whole walkthrough from a
sterile profile touching nothing but the forward button, counts the clicks, and
asserts the person **stays** in the app afterwards. That last assertion matters:
an earlier version of this suite reported a green by reading the route once
immediately after Finish, when `navigate('#/')` had set the hash but the gate was
about to throw the person back to question 1. A single read cannot tell "arrived"
from "passing through".
