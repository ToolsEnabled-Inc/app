# Attribution: the canonical strings

This is the single source for how ToolsEnabled with Mission Control is attributed. Every
other surface copies from here. If a string has to change, change it here first, then
follow the placement table.

## The four facts

| Field | Value |
| --- | --- |
| Company / copyright holder | ToolsEnabled, Inc. *(in formation)* — see [Current legal status](#current-legal-status) |
| Sole founder and creator | Joshua Pinckard |
| Official product | ToolsEnabled with Mission Control |
| Official publisher | ToolsEnabled, Inc. *(in formation)* |

## The founding line

Used verbatim, as the first section of the README, on the organization profile, in the
website About section and in investor materials:

> ToolsEnabled was founded and created by Joshua Pinckard. The original platform was
> developed by directing autonomous AI-agent fleets through the system's own evolving
> coordination architecture.

## The academic form

Used in papers, citations and any research write-up:

> Joshua Pinckard conceived the project, defined its objectives and requirements, directed
> the autonomous agent workflows, selected and evaluated outputs, and assumes
> responsibility for the research methodology and conclusions. AI agents generated
> substantial portions of the implementation and written drafts.

## The documentation footer

Appended to product documentation:

```
---

*ToolsEnabled with Mission Control — created by Joshua Pinckard, sole founder.
Published by ToolsEnabled, Inc. (in formation). Copyright © 2026 Joshua Pinckard.*
```

## Surface-specific wording

Two surfaces say different things on purpose, and the difference is the owner's:

- **Binaries** say *Published by ToolsEnabled, Inc.* — the publisher is what matters on a
  file a stranger downloads. Carried in the executable's VersionInfo `CompanyName`.
- **The website** says *Created by Joshua Pinckard, sole founder.* — the person is what
  matters on a page someone reads about the project.

## Placement

| Surface | What goes there | Where it lives |
| --- | --- | --- |
| GitHub organization profile | Founding line + the four facts | `ToolsEnabled/.github` → `profile/README.md` (draft: [`github-org/profile-README.md`](github-org/profile-README.md)) |
| README, first section | Founding line + the four facts | [`../README.md`](../README.md) |
| NOTICE file | Full attribution, legal status, academic form | [`../NOTICE`](../NOTICE) |
| Contributors | The contributors-are-not-founders rule | [`../CONTRIBUTORS.md`](../CONTRIBUTORS.md) |
| Documentation footer | The footer block above | product docs under `docs/` |
| Release notes | Publisher and copyright block | [`RELEASE-NOTES-TEMPLATE.md`](RELEASE-NOTES-TEMPLATE.md) |
| Binary VersionInfo | `CompanyName`, `LegalCopyright` | `package.json` → `author`, `build.copyright` |
| Website About | Founding line + *Created by Joshua Pinckard, sole founder.* | website repository |
| Investor materials | Founding line + the four facts | not in this repository |

## Current legal status

**ToolsEnabled, Inc. does not exist yet.** Incorporation has not been filed.

Copyright therefore vests in **Joshua Pinckard** personally, and that is what the copyright
line says. The company is named as the intended publisher and marked *(in formation)*,
which is the ordinary way to refer to an entity that is intended but not yet formed.

The reason this matters more here than it usually would: a public repository is a dated,
permanent, append-only record. Writing "Copyright © 2026 ToolsEnabled, Inc." today would
put a false statement about a legal entity into git history on a date when that entity
provably did not exist, and it would be attached to every release built in the meantime.
The correction after incorporation is one commit; the false history is not removable.

### Never put parentheses in `package.json` → `author`

The binary's `CompanyName` comes from `author.name`, and electron-builder normalizes that
field with npm's people-string rules first: **a trailing `(…)` is parsed as the author's
URL and silently discarded.** So `"ToolsEnabled, Inc. (in formation)"` ships as
`ToolsEnabled, Inc.` — the qualifier disappears and the binary asserts a company that does
not exist. The object form `{"name": "…(in formation)"}` is stripped identically; the
normalizer runs either way.

That is why the manifest reads `"ToolsEnabled, Inc. in formation"` with no brackets of any
kind, and why it must keep reading that way. Prose files are unaffected — use the normal
*(in formation)* in Markdown. This was verified by reading the value back out of the built
`.exe`, not out of the config, which is the only way the stripping is visible at all.

### What changes at incorporation

Once ToolsEnabled, Inc. exists and the copyright is assigned to it:

1. `package.json` → `build.copyright` becomes `Copyright © <year> ToolsEnabled, Inc.`
2. `package.json` → `author` becomes `ToolsEnabled, Inc.` (drop `in formation`)
3. This file, `../NOTICE`, `../README.md` and `../CONTRIBUTORS.md` drop *(in formation)*
   and name the company as copyright holder
4. The documentation footer and release-note template update to the same
5. Rebuild and re-verify the binary VersionInfo (see
   [`RELEASE-NOTES-TEMPLATE.md`](RELEASE-NOTES-TEMPLATE.md))

Nothing about the founder credit changes at incorporation, or ever.

## Two things not to write

- **Do not claim a trademark.** No application has been filed for "ToolsEnabled" or
  "Mission Control". Neither may be described as a registered mark, and neither may carry
  ® anywhere. "Mission Control" in particular is a common phrase with unrelated businesses
  using it.
- **Do not describe the company as existing.** Until incorporation, every use of
  "ToolsEnabled, Inc." carries *(in formation)*.

---

*ToolsEnabled with Mission Control — created by Joshua Pinckard, sole founder.
Published by ToolsEnabled, Inc. (in formation). Copyright © 2026 Joshua Pinckard.*
