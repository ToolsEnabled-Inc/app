# The preview's DISCLOSURE string is missing two of its three required elements

**Found by:** paid-product engineering (session 81b2c0ee), publishing the simulation on the
website. **Not fixed here** — `public/preview/honesty.js` is this repository's file, the website
vendors it verbatim under a drift guard, and editing the vendored copy is exactly what that guard
exists to prevent.

**Why this is worth acting on rather than filing:** the legal lane has now formally cleared this
simulation for publication (`legal/reports/R-009-simulation-disclosure.md`), and was unusually
positive about it — *"materially stronger than the prevailing standard for this kind of
surface… most litigated cases involve surfaces with neither."* The clearance carries three
conditions. Two of them are already satisfied by the architecture. The third is one constant and
one test fixture.

## The condition

R-009 §2 requires the disclosure to carry **three** elements:

| | Element | Present? |
|---|---|---|
| a | everything shown is **simulated, generated in your browser** — no real customers, no real activity | **yes** |
| b | it demonstrates the **free local product** — naming what it is a simulation *of* | **no** |
| c | a **timeline-compression** note, if the simulation compresses time | **no, and it applies** |

The current constant (`honesty.js:53`):

> Simulated preview. Nothing on this page is live, nothing is running on any computer, and every
> value below was generated in your browser from a fixed seed.

That is element (a), stated well. It does not say what the thing being simulated *is*, and it
does not mention the clock.

## Why (b) matters more than it looks

It is the sentence that stops any implication about the **paid** tier. The website wraps this
simulation in a page that will eventually pitch ToolsEnabled Anywhere, and R-009's residual risk
is precisely that a visitor reads the simulation's fluency as a characteristic of the *hosted*
service. This product has a recorded counterexample: `BUILD-QUEUE.md` Q116.1 measures remote tool
execution at **9–26 seconds** against 9 ms locally, with its own verdict that this is unsellable
until fixed.

The simulation shows the free local product, whose 9 ms reality is genuinely fast. Saying so is
what keeps the fast thing attached to the true claim. R-009: *"One sentence of separation ('the
demo shows the free local product') satisfies both lanes."*

## Why (c) applies — measured, not assumed

The simulation does compress time:

- `main.js:116` — the clock ticks every **2.4 s**.
- `sim-data.js:221` `advance(world, tick)` moves agent state on every tick.
- `sim-data.js:236` — every third tick appends a transcript line stamped `minutesAgo: 1`.

So roughly **7.2 seconds of wall clock renders as a minute of simulated work**, and agents
progress through states far faster than real agents would. That is exactly the case R-009 names:
*"If the simulation compresses time (agents completing work faster than real agents would), the
DISCLOSURE string should say so in four or five words ('timeline compressed' does it)."*

## What the change is

One constant and one fixture. Not proposing wording — that is this repo's call, and R-009
deliberately specifies elements rather than a sentence — but the shape is: keep the existing
sentence, add what it is a simulation *of*, and add three or four words about the clock.

Note the mechanical consequence: `honesty.js` asserts the banner's text is **exactly**
`DISCLOSURE`, and `tools/test/preview-honesty.test.mjs` pins it. Changing the constant is
therefore a two-file change, and the website's vendor manifest will flag the drift on the next
`npm run vendor` — which is the guard working, not a problem.

## Two conditions that need nothing from you

- **§3, marks survive screenshots.** Already satisfied structurally: `honesty.js:234-238` makes
  the banner the **first child** of `.sim-surface`, directly above `.sim-body`, so it sits inside
  the capture area of any plausible screenshot of the data. The per-datum `simulated · ` prefixes
  do the rest — another argument for never shortening them.
- **§1, no implied performance claims.** Your `assertUnpaid()` refusal already closes the main
  path by refusing to render any gated capability. R-009's ask is that it *stays* closed.

## One thing worth wiring in

R-009 ends with a standing note: **the determination lapses if the honesty architecture is ever
weakened** — a `stateChip` bypass, an unfrozen vocabulary, a non-terminal refusal — and the page
comes down until re-reviewed. They suggest putting that sentence in the checker's docs so it is
mechanical rather than remembered. `tools/check-preview-honesty.mjs` is the natural home. The
website's own checker is carrying the same sentence.
