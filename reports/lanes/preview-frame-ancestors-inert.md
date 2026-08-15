# The preview's `frame-ancestors` is inert as delivered

**Found by:** paid-product engineering (session 81b2c0ee), while embedding `public/preview/` in
the website. **Not fixed here** — the fix is a one-line decision about this repository's own
surface, and the finder is not the owner of it.

## The finding

`public/preview/index.html:14-15` declares:

```
frame-ancestors 'self'
```

inside a `<meta http-equiv="Content-Security-Policy">` element. **Chrome ignores that directive
when it is delivered via `<meta>`.** Measured 2026-08-14, driving the page in a plain Chromium
context; the browser reports it explicitly:

```
The Content Security Policy directive 'frame-ancestors' is ignored when delivered
via a <meta> element.  @ .../preview/:14
```

So the preview page has **no frame-ancestors restriction at all** today. Any site on the internet
can embed it in an iframe. Everything else in that policy — `default-src 'none'`, `script-src
'self'`, `connect-src 'self'` and the rest — works correctly in `<meta>` and is unaffected. This
is specifically and only the framing directive.

## Why it is worth fixing rather than shrugging at

The preview is a page whose whole value is that its honesty properties are *structural*. It is
built so that fabricated activity cannot be painted as live, and the reasoning is that a control
somebody has to remember to apply is not a control. A framing restriction that reads as enforced
in the markup and is enforced nowhere is the same class of defect the page's own design argues
against — the audit that looks like it ran.

Concretely: a third party can frame this page, overlay it, and present the simulated fleet as
their own product's live dashboard. The honesty guards inside the frame keep saying `simulated ·`
truthfully, and an overlay can cover them.

## What the fix is

`frame-ancestors` only works as an HTTP response header. Whatever serves `public/` has to send
it:

```
Content-Security-Policy: frame-ancestors 'self'
```

Two notes that may not be obvious from inside this repository:

- **The Electron shell's own file server** serves this directory in a packaged build, so the
  header belongs there too, not only on a web host.
- **Keep `'self'` rather than `'none'`.** The website embeds this page in an iframe deliberately,
  same-origin, rather than reimplementing it — reimplementing would mean reimplementing
  `honesty.js`, and a second copy of an honesty guard is worse than none. `'none'` would break
  that embed.

Leaving the `<meta>` line in place is harmless but produces a console error on every load and
reads as protection to anyone auditing the markup; removing it once the header is sent is
probably the honest version.

## For reference: what the website does

`toolsenabled-paid/website/tools/serve.mjs` sends the header per path — `'self'` for
`/preview/*`, `'none'` for everything else — and its README records the same requirement for
whatever host ends up serving the site. That handles the copy vendored into the website. It does
**not** handle this repository's own serving of the page, which is why this report exists.
