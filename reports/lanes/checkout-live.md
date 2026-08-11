# Lane: checkout-live (app tree)

His ask, three times unmet: "I wanted the whole list ... give me a complette checkout
I can pick and choose. It should be in mission control and actually working ... I
should literally feel like im checking out at an estore ... follow the sites theme and
be nice and clean and easy" / "It muyst be throuygh mission control the purchase list".

**Nothing was bought, ordered, confirmed or reserved by this lane.** The confirm button
was never pressed; in every harness profile it stayed disabled ("Sign in to confirm").
The two live carts in the approvals queue were read, never written.

---

## Why the screen was dark, and what it took to light it

The checkout was fully built and completely unreachable on this machine for one reason:
`%APPDATA%\ToolsEnabled\purchase-catalog.json` did not exist. The list is the operator's
own document and is deliberately outside the payload (`private/purchase-catalog.owner.json`
-> `<userData>/purchase-catalog.json`), and `tools/install-operator-purchase-list.mjs`
is the supported way to put it there. Nobody had run it.

    node tools/install-operator-purchase-list.mjs
    Installed 37 item(s) to C:\Users\joshp\AppData\Roaming\ToolsEnabled\purchase-catalog.json.

Verified byte-identical to the source (68,940 bytes). His running copy needs one relaunch
to see it: the surface probe runs once at boot.

## Then I opened it and looked at it, and it was not a shop

Driven in the packaged product (`release/win-unpacked`, restaged with this tree's dist/),
reached by CLICKING the back chevron from home, never by assigning the hash, in a sterile
`--user-data-dir` profile with his real 37-item list installed.

**Measured before any change:**

| | before | after |
|---|---|---|
| shop step height | **16,106px** into a 782px viewport (20.6 screens) | **4,285px** (5.5 screens) |
| median item row | 401px | 104px |
| tallest item row | 676px | 140px |

One item filled the screen. Every word of his own reasoning was on it -- "WITHOUT IT",
"WHY YOU WANTED IT", the blockers, the notes, the source URL, all expanded for all 37
lines at once. As a document it was excellent. As a shop it was unusable: he cannot pick
and choose from a list he can only read one line of at a time.

## What changed

**The row folds.** It now shows what a shelf label shows -- name, vendor, a one-line
summary, status chips, and the money -- with his reasoning one button away
("Why, and 2 things to read first ›"). Nothing was deleted; the clamp is a renderer
clamp, so the whole string stays in the DOM for a screen reader and a text search.

**A blocked line opens its own reason the moment it is chosen.** Measured: picking
"Registered agent service" flips `data-expanded` false -> true and takes its visible
band count 0 -> 1, so the sentence explaining why it cannot be bought arrives at the
instant of choosing rather than sitting below a fold. It re-folds when deselected, and a
fold he closed by hand is not re-opened by a repaint.

**The do-not-buy shelf starts folded**, with the count on its own control
("0 of 10 can be chosen — Show the 10 ruled out"). Ten of thirty-seven lines exist to
argue against a purchase; they were taking a quarter of the floor space in front of the
eight lines that gate shipping. Folded is never the same as gone.

**Each shelf carries its own running tally** ("3 chosen · $25.87 today"), so the layout
answers "which shelf is this coming from" without arithmetic.

**The queued carts are on the shop step, whole.** They used to appear only on the review
step -- which he reaches by picking something first -- so the money already queued
against his name sat behind a choice he had not made. Every line of every pending cart
now renders with its exact amount, merchant and stated purpose, above the shelves,
under one "Show every word of this request" control. Approving and denying still happens
in Approvals: that queue is audited, its ids are the engine's, and matching them to
catalogue entries to auto-approve would mean guessing which amounts he meant.

**Two smaller cuts:** the estimate's basis paragraph and the reassuring "Price checked
<date>" line moved into the fold (an unchecked price is a warning and stays out); the
"Billed monthly — $0.00 across a year" box no longer renders on free lines; and the
developer path in the provenance line moved to its own quiet second line instead of
being the loudest thing under the title of a shop. It is still there verbatim -- a
paraphrased provenance is no provenance.

## The absence case, and the one it caught

`src/checkout-visibility.js` exists so that "a copy with no list has no checkout rather
than an empty shop". Tested with a catalogue that was served and **had zero items**:

    before: route=checkout, items=0, groups=0
            "$0.00 CASH TODAY ... $0.00 EVERY YEAR AFTER ... 0 ITEMS CHOSEN of 0 on the list"

The guarantee ended one layer short. The probe saw JSON, opened the door, and the screen
rendered exactly the empty shop the probe exists to prevent -- reached by serving a list
rather than by serving none. Now:

    after:  "This purchase list has nothing in it — The list installed on this computer
             is readable, and it contains no items. Nothing is being shown rather than an
             empty shop that looks like a screen which failed to load."

Fixed at the view, not at the probe: making the router parse and count a catalogue would
put schema knowledge into navigation and read the file twice at boot.

**Second absence fixed:** the approvals band used to say "Nothing is pending your
approval anywhere else" on an empty read. That is a fact about ONE queue promoted to an
all-clear covering every queue on the machine -- and on this machine it would have been
false (see the seam below). It now says what it measured: "The approvals queue this copy
of ToolsEnabled runs is reachable and has no purchase request waiting in it. That is what
this installation can see. It is not a statement about a queue somewhere else."

## Proven by use, not by reading

Clicked in the packaged window, tan/black/white, 1024 and 1440:

- one click back from home lands on `checkout`; 37 rows, 23 choosable, 4 shelves
- pick one line: `$0.00 / $0.00 / 0` -> `$9.99 / $119.88 / 1`, Review enables
- deny it again: back to `$0.00 / $0.00 / 0`, Review disables
- "Select recommended (3)": `$25.87 today / $188.56 every year after`, shelf tally
  "3 chosen · $25.87 today"
- review step: 3 lines at exact amounts, `Total $25.87 / $188.56`, confirm **disabled**
- with the real queue seeded into a sterile profile: "There are 2 purchase requests
  waiting for your decision, totalling $1,341.31", cart `fd5807ed` "ToolsEnabled launch -
  the whole list, from your words" at $816.31 across 16 lines ($165.40 .ai, $28.12 .io,
  $11.08 .com, $350.00 USPTO ...), cart `46a2d96f` at $525.00 across 4
- no horizontal overflow at 1024 or 1440; body background is the theme's in all three
- `node tools/checkout-privacy-packaged-qa.mjs` — **14/14**, 20.8s, including "the
  installer does not carry a purchase list at all", "typing the checkout address lands on
  home instead of opening it", and "asking the shell for the list directly is refused" (404)

## Seams reported, not crossed

1. **The product cannot see his real carts.** The shipped app runs its own capability
   layer rooted at `%APPDATA%\ToolsEnabled\capability`, whose
   `state/owner-public-prompts.json` does not exist. The two live carts (`fd5807ed`
   $816.31, `46a2d96f` $525.00) are in `C:\Users\joshp\Desktop\toolsenabled-current\state\
   owner-public-prompts.json`. So on his machine the checkout truthfully reports an empty
   queue while $1,341.31 waits in the engine tree's. The renderer is wired correctly and
   was proven against the real carts by seeding a sterile profile; binding the product to
   the right store is a state-root decision, and copying live money prompts between two
   stores that can each record a decision would create exactly one double-decision hazard.
2. **There is no explicit DENY on a catalogue line** -- only picked and not-picked, so
   "I said no" and "I never got to it" are the same state in the saved record. He asked
   to "approve and deny of each". That is a `src/checkout-selection.js` schema change and
   belongs to the wave-2 selection lane.
3. The route-level probe still opens the door for a zero-item list; the screen refuses it.

## Progress

- [x] Read the lane reports in both trees before starting
- [x] Installed the operator catalogue into the running install's data directory
- [x] Measured the shop in the packaged window before changing anything
- [x] Folded the row, the do-not-buy shelf, and the queued-cart prose
- [x] Put the real queued carts on the shop step, line by line, deciding none of them
- [x] Tested the zero-item absence case and closed it
- [x] Re-proved fail-closed on the packaged build (14/14)
