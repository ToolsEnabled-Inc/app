# Commercial licensing

ToolsEnabled was founded and created by Joshua Pinckard. The original platform was
developed by directing autonomous AI-agent fleets through the system's own evolving
coordination architecture.

Copyright © 2026 Joshua Pinckard. Published by ToolsEnabled, Inc. (in formation).

---

## What this document is

ToolsEnabled is released under two arrangements at once:

1. **The free product** — everything in this repository — is free software under the GNU
   Affero General Public License, version 3 or later. The grant is made by
   [`LICENSE`](LICENSE), which holds the unmodified text as published by the Free Software
   Foundation.
2. **The commercial arrangements** — a separate license for people who cannot accept the
   AGPL's terms, and **ToolsEnabled Anywhere**, a paid hosted service — are described here.

This document describes the commercial side. **It is a description of the terms on offer,
not the contract itself.** No commercial license comes into existence by reading this file,
by downloading the software, or by paying for anything; it exists only when a signed
agreement says it does. Where this description and an executed agreement differ, the
executed agreement governs.

**Nothing in this document takes anything away from the AGPL grant.** If any sentence here
appears to narrow, condition or add a requirement to the rights `LICENSE` gives you, that
file wins and this one is wrong. That is stated first, and deliberately, because a
commercial-licensing page sitting next to a copyleft license is exactly where an accidental
extra restriction would hide.

## Why a commercial license can be offered at all

The AGPL binds people who *receive* the software. It does not bind the copyright holder.
Copyright in ToolsEnabled vests in one person, Joshua Pinckard, so he remains free to
license the same work on other terms to anyone who asks.

This depends on a condition that is easy to lose and impossible to quietly recover: **it
works only while copyright stays unfragmented.** If an outside contribution is merged
without a contributor agreement that assigns rights or grants a license broad enough to
relicense, that contributor holds copyright in their part, and from then on no commercial
license can be granted over the whole work without asking every one of them individually.

That has to be settled before the first outside pull request is merged, not after. See
[`LICENSING.md`](LICENSING.md) and [`CONTRIBUTORS.md`](CONTRIBUTORS.md).

## Who needs a commercial license

Most people do not. If you run ToolsEnabled for yourself, inside your company, on your own
machines, or you modify it and keep the modifications to yourself, **the AGPL already
allows that and you owe nothing.** Running the software is not what triggers the AGPL's
obligations.

A commercial license is for the cases where the AGPL's conditions are genuinely
unacceptable to you:

- You want to **offer a modified ToolsEnabled to others over a network** without publishing
  your modified source, which AGPL section 13 would otherwise require.
- You want to **embed ToolsEnabled in a proprietary product** you distribute without that
  product inheriting the AGPL's terms.
- Your organisation **refuses AGPL software by policy** and you need different terms to
  adopt it at all.

If none of those describe you, use the free product; that is what it is for.

To ask about commercial terms, open an issue in the official repository, or use the contact
route published there. Pricing and terms are negotiated per agreement and are not listed
here.

## ToolsEnabled Anywhere

**ToolsEnabled Anywhere** is a separate, optional, paid service. It solves the one problem
the free product deliberately does not: reaching your machines when you are not on the same
network. It provides managed non-LAN connectivity, device enrollment, the relay, monitoring,
recovery and support.

Three things about it are worth stating plainly, because paid tiers built alongside
open-source projects are routinely suspected of the opposite:

- **Anywhere is a hosted service, not a feature unlock.** Nothing in this repository is
  disabled, crippled or time-limited in order to sell it.
- **The free product is complete for anyone who can reach their own machines.** Local
  operation, your own LAN, and self-hosting are all fully supported by the free product and
  require no account with us.
- **Anywhere's server-side implementation is not part of this repository** and is not
  covered by the AGPL grant. It is separate work under separate terms.

Anywhere is licensed to subscribers under its own service terms, which accompany the
service and are not reproduced in this file. It is not licensed under the AGPL.

## Governance of the official build

The official project lives under the ToolsEnabled GitHub organization. ToolsEnabled, Inc.
controls:

- the **official repository** and what is merged into it;
- the **official releases** and the **signed installers** published under its name;
- the **project's names and marks**, including "ToolsEnabled" and "ToolsEnabled Anywhere".

Anyone may fork this project and propose changes. **Only company-approved code enters the
official build.** Proposals are accepted or refused at the company's discretion, and no
contribution carries a right to be merged.

### What that does and does not restrict

This distinction matters, so it is drawn explicitly rather than left to be inferred:

- **Your rights in the code are the AGPL's, in full.** You may fork, modify, run,
  distribute and offer over a network, subject only to the AGPL's own conditions. The
  company's control over the official build is not a restriction on your copy and cannot
  be used as one.
- **What is reserved is identity, not code.** A fork is yours; it is not the official
  product. It must not present itself as the official build, as published or endorsed by
  ToolsEnabled, Inc., or under the project's names and marks in a way that would mislead
  someone about where it came from. That is a trademark limit, which is a separate body of
  law from the copyright license and is expressly preserved by AGPL section 7(e).
- **Renaming a fork is always sufficient.** The AGPL requires modified versions to carry
  notice of modification, and distributing your fork under its own name satisfies
  everything asked of you here.

Cloud infrastructure, billing, provisioning, security operations and internal development
tooling are developed separately and are not intended to be part of this repository. What
the official build actually redistributes is not left to that sentence to enforce: it is
declared in `config/payload-boundary.json` and checked by a gate on every release build.

## Third-party components

ToolsEnabled bundles third-party open-source components, each under its own license. Those
licenses are unaffected by anything in this document, and a commercial license granted over
ToolsEnabled does not and cannot relicense them. Their notices and full texts are in
[`THIRD-PARTY-LICENSES.md`](THIRD-PARTY-LICENSES.md).

## Legal status

Stated plainly, because a public repository is a dated, permanent record:

- **ToolsEnabled, Inc. does not exist yet.** Incorporation has not been filed. It is named
  as the intended publisher and marked *(in formation)*. Copyright is held personally by
  Joshua Pinckard until the entity exists and the rights are assigned to it. Until then, a
  commercial license can only be granted by him personally, and any agreement should name
  him rather than the company.
- **No trademark application has been filed** for "ToolsEnabled". The name is not claimed
  here as a registered mark. The trademark limit described above rests on unregistered
  rights, which are narrower than registered ones.
- **None of this has been reviewed by a lawyer.** It is a statement of intent written to be
  honest about what has and has not been decided, and it should be reviewed before it is
  relied on in an actual negotiation.

---

*ToolsEnabled — created by Joshua Pinckard, sole founder.
Published by ToolsEnabled, Inc. (in formation). Copyright © 2026 Joshua Pinckard.*
