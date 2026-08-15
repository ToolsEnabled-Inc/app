# The preview claims the product's design language and renders the system font

**Found by:** paid-product engineering (session 81b2c0ee), while bringing the website into the
product's real typefaces. **Not fixed here** — `public/preview/preview.css` is this repository's
file; the website's vendored copy is fixed on the website's side by a declared transformation.

## The finding

`preview.css` opens by declaring itself *"the product's own design language, standalone"* and
copies the token layer faithfully — the drift test against `src/styles.css`'s role palette is
real and good. But line 86 sets the body to the **system stack**
(`-apple-system, BlinkMacSystemFont, …`), and line 265's ledger chain names generic monospace.

The product renders IBM Plex Sans and JetBrains Mono (`--font-ui`/`--font-mono`,
`DEFAULT_FONT = 'plex'`, bundled via `@fontsource-variable`). So the page whose entire purpose is
to show a stranger what the product looks like shows it in a different voice than the product
speaks. The colours drift-tested; the typography was never covered.

**Why it happened is structural, not an oversight:** files under `public/` ship verbatim and
cannot reference the app's bundled font assets, which is the same constraint that made the tokens
a copy rather than an import. The copy stopped at colour because colour had a guard and type
didn't.

## Where it bites this repository

The app's own build serves `/preview/` too (the exits probe and the download wire plan both treat
it as a shipped page), so anyone reaching the preview through the app's site gets the
system-stack rendering.

## What the website did, offered as a shape

The site self-hosts the two latin variable woff2 from the same `@fontsource-variable` packages
this repo already depends on, and its vendor step appends one declared block to its copy of
`preview.css`: the two `@font-face` declarations plus re-pointed `body` and `.pv-ledger-chain`
font stacks — with the stacks read from the app's own token values rather than typed. The vendor
manifest records source **and** emitted hashes, so the declared transformation is permitted while
every undeclared difference stays a finding.

The equivalent here is smaller: ship the two woff2 beside the preview (they are already in
`node_modules`), declare the faces in `preview.css`, and point line 86 / line 265 at the same
stacks `src/font-choice.js` already owns. ~84 KB, self-hosted, satisfying the preview's own
no-egress rule and the app's "no font that would need a network to arrive."

One caution from the website's first attempt at shipping these fonts: if any blanket
`text eol=lf` gitattribute covers the font path, git will normalise CRLF byte pairs inside the
woff2 stream and corrupt it silently — mark `*.woff2 binary`.
