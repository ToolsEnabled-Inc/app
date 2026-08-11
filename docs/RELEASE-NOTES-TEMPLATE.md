# Release notes template

Copy this file for each release. Replace every `<…>` placeholder. Do not remove the
**Publisher and copyright** section — it is required on every release, and its wording is
fixed by [`ATTRIBUTION.md`](ATTRIBUTION.md).

---

# ToolsEnabled with Mission Control `<version>`

*Released `<YYYY-MM-DD>`*

## Highlights

- `<the two or three things a user will notice>`

## Added

- `<new capability>`

## Changed

- `<behaviour change, and what a user should do about it>`

## Fixed

- `<defect, stated as the symptom the user saw>`

## Known issues

- `<what is still broken, named plainly>`

State known issues even when the list is long. A release note that omits them is a support
queue later.

## Install

`<download link>` — `<installer filename>`

| | |
| --- | --- |
| SHA-256 | `<installer sha256>` |
| Signed | `<yes, with the certificate subject / no, unsigned>` |

If the build is unsigned, say so here rather than letting the user discover it from a
SmartScreen warning.

## Publisher and copyright

> **ToolsEnabled with Mission Control**
> Published by ToolsEnabled, Inc. (in formation)
> Copyright © `<year>` Joshua Pinckard
>
> ToolsEnabled was founded and created by Joshua Pinckard. The original platform was
> developed by directing autonomous AI-agent fleets through the system's own evolving
> coordination architecture.

Contributors to this release are credited in [`CONTRIBUTORS.md`](../CONTRIBUTORS.md).
Contributors and maintainers are never founders.

*(Once ToolsEnabled, Inc. is incorporated, drop "(in formation)" and change the copyright
holder to ToolsEnabled, Inc. — see [`ATTRIBUTION.md`](ATTRIBUTION.md).)*

---

## Pre-publication checklist

Not part of the published note. Delete this section before release.

- [ ] `npm run dist` completed — it runs the payload-boundary and owner-data gates
- [ ] `node tools/check-no-owner-data.mjs release/win-unpacked` is clean
      (`Total matches: 0`; attribution excusals are printed and expected)
- [ ] `node tools/check-payload-boundary.mjs release/win-unpacked/resources/capability`
      is clean
- [ ] **Binary VersionInfo verified in the artifact, not the config:**
      ```powershell
      (Get-Item "release\win-unpacked\Mission Control.exe").VersionInfo |
        Select-Object CompanyName, LegalCopyright, ProductName, FileVersion
      ```
      `CompanyName` reads `ToolsEnabled, Inc. (in formation)` and `LegalCopyright` reads
      `Copyright © <year> Joshua Pinckard`. Check the installer `.exe` too — it carries
      its own VersionInfo.
- [ ] Installer SHA-256 recorded above matches the file being published
- [ ] No trademark symbol (®) anywhere in the notes, and no claim that ToolsEnabled, Inc.
      currently exists
- [ ] Version number matches `package.json`

---

*ToolsEnabled with Mission Control — created by Joshua Pinckard, sole founder.
Published by ToolsEnabled, Inc. (in formation). Copyright © 2026 Joshua Pinckard.*
