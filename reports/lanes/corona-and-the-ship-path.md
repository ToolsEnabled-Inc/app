# The home corona, and how an ungated build hid it

Lane note, 2026-08-16. Four findings. Two are rendering bugs in the home hero
that are now fixed; two are traps in the build tooling that are **not** fixed and
will catch the next person.

---

## 1. TOOLING TRAP — `dist:test` runs no gates at all

Measured, by diffing the two scripts in `package.json`:

```
dist:test gates: NONE
gates in `dist` that `dist:test` skips: 21
```

including `check-no-owner-data` (which `dist` runs twice), `check-payload-boundary`,
`check-license-notices`, `check-renderer-payload`, `check-asar-manifest`,
`check-product-naming`, `require-clean-tree`, and both `seal-artifact` steps.

The archive it produces is, downstream, **indistinguishable from a gated one**.
`check-asar-manifest` already knows this and says so in its own failure text:

> the archive contains no `dist/build-info.json`, so it cannot state which commit
> it was built from … an archive without it was packaged off the ship path —
> `electron-builder` invoked directly. Nothing downstream can tell such a build
> apart from a gated one, **which is how a shipped installer came to be missing a
> fix that was present in the checkout.**

That is exactly what happened in this lane. A build cut at 18:26 was installed and
used for review; it silently lacked fixes that were sitting in the checkout, and
nothing about the installed app could reveal that. Roughly two hours of review
went into a build nobody could identify.

The gate exists and is correct. The hole is that `dist:test` never reaches it.

**Suggested fix:** either have `dist:test` write a `build-info.json` marked
`channel: test`, or make it run the content gates. An installer that cannot say
what it is should not be producible by a one-word npm script.

## 2. TOOLING TRAP — a test-channel install overwrote the release install

`installer-identity` prints, on a non-release channel:

> non-release channel: installs to its own directory and uninstall entry, leaving
> the release install untouched

Observed, after running `ToolsEnabled Test Setup 1.0.20.exe`:

```
%LOCALAPPDATA%\Programs\toolsenabled\
  ToolsEnabled.exe             19:22   <- release build, untouched
  ToolsEnabled Test.exe        21:50   <- test build
  resources\                   21:50   <- SHARED, and replaced
```

Separate executables and separate uninstall entries, yes — but **one `resources\`
directory**, so the test build replaced the release build's `app.asar`. Launching
the release executable now runs the test bundle. The claim in the log is true
about executables and false about what actually determines which code runs.

**Suggested fix:** either give the test channel its own install directory, or
change the message, which currently reads as a safety guarantee it does not
provide.

## 3. BUG (fixed) — linear-light values written into an sRGB canvas

`src/corona-gl.js` passed colours through a linear-light conversion and wrote them
into an RGBA8 WebGL canvas. An RGBA8 buffer stores **sRGB-encoded** values, so
those numbers were read back as if already encoded and every hue painted a much
darker, duller version of itself:

| palette | painted |
|---|---|
| `#427b58` tan clear | `#0e3319` |
| `#96600f` tan blockers | `#4e1e01` |
| `#9d0006` tan failure | `#560000` |

This was the whole reason the glow read as a muddy smudge on the paper sheets, and
several rounds of geometry and design theory were spent on it before the cause was
found. The near-black sheet hid it almost completely, because bright hues barely
move through the transform (`#fb4934` → `#f61109`) — so the theme that looked
right was the one least able to reveal the fault.

**Generalisable:** a WebGL canvas composited by CSS is an sRGB surface. Linear
light belongs inside the shader, not at its output.

## 4. BUG (fixed) — a CSS custom property cannot repaint a canvas

The glow slider in Settings and in the quick-settings drawer both apply their
value by writing an inline `--glow` onto `document.documentElement`
(`quick-settings.js:342`, `views/settings.js:668`). Every previous consumer was
CSS, so this worked.

The corona is a canvas that repaints on demand. A custom property changing fires
no event and invalidates no canvas, so **the slider moved and nothing happened**.
It is the "temperature slider" defect exactly: a real control, wired to a real
value, driving nothing.

Now a `MutationObserver` on the root's `style` and `data-theme` drives a bounded
repaint (`src/crescent-mount.js`). Deliberately an observer rather than a call
from either settings module: there are already two writers and a third would not
know to announce itself.

**Generalisable:** any canvas or WebGL surface that consumes a CSS custom
property needs an explicit invalidation path. The cascade will not provide one.

---

## What the corona now is

A limb-anchored eclipse corona rendered by a WebGL2 fragment shader
(`src/corona-gl.js`), mounted by `src/crescent-mount.js`, with the CPU field
renderer (`src/crescent-field.js`) as the no-GPU fallback. Colour stays in CSS:
the per-theme hue table, `--glow`, `--cres-halo-o`, `--cres-gain`,
`--cres-state-gain` and `--cres-chroma` are all read from computed style, so the
measured contrast ratios stay where a reader can find them.

Contrast re-measured on the running app, against the 3:1 floor this mark is held
to as the page's only status signal:

| sheet | clear | blockers | failure |
|---|---|---|---|
| white | 3.27 | 3.26 | 3.44 |
| tan | 3.12 | 3.31 | 3.90 |
| black | 8.94 | 9.68 | 5.71 |

`unknown` is exempt and deliberately quiet (0.28 gain): it is neutral `--ink-4`,
and with no hue to carry it the corona read as a plain grey drop shadow. Driving
the packaged build is what surfaced that, because `unknown` is the state the app
boots into — the previews never showed it.

## Method note

Three separate wrong answers were reached by reasoning about light and rejected by
rendering it: a peak on the limb (merged with the rim into a drop shadow), a wide
haze (a murky cloud), and a Cornsweet dipole borrowed from published work on
perceived self-luminosity (which is sound, and which was not the problem here).
The measurement harness — `tools/ring-fidelity-qa.mjs`, `tools/ring-fixture.html`,
`tools/corona-preview.html` and the offscreen Electron capture in
`tools/ring-capture-main.cjs` — is what made each of those cheap to discard.

`tools/test/fixtures/crescent-reference-metrics.json` holds the measurement of the
original `feGaussianBlur` render and **cannot be regenerated**; the QA tool refuses
to overwrite it.
