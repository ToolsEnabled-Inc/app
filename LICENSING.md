# Licensing

ToolsEnabled was founded and created by Joshua Pinckard. The original platform was
developed by directing autonomous AI-agent fleets through the system's own evolving
coordination architecture.

Copyright © 2026 Joshua Pinckard. Published by ToolsEnabled, Inc. (in formation).

## The short version

**ToolsEnabled is free software under the GNU Affero General Public License,
version 3 or later.** The full and controlling text is in [`LICENSE`](LICENSE),
which is the unmodified license as published by the Free Software Foundation. If
anything on this page disagrees with that file, that file wins.

**ToolsEnabled Anywhere** — the managed connectivity service — is a separate,
commercially licensed product. It is not covered by the AGPL grant above, and it
is not part of this repository.

## Why AGPL and not MIT

The AGPL differs from the ordinary GPL in one clause that matters here. Section 13
("Remote Network Interaction") says that if you modify this software and let other
people use it over a network, you must offer those users the source of your
modified version. An MIT or Apache license would not.

That clause is the whole reason for the choice. This product's natural commercial
threat is not someone selling copies of it — it is someone running a modified copy
as a hosted service and never publishing what they changed. The AGPL does not
prevent that; it requires that the changes come back to everyone who uses it.

The cost of that choice is real and worth stating plainly: some companies refuse
AGPL software by policy, so this decision narrows the set of organisations that
will adopt it. That was accepted deliberately rather than overlooked.

## Dual licensing

The AGPL binds people who receive the software. It does not bind the copyright
holder. Because copyright in this work vests in one person, ToolsEnabled can be
offered under separate commercial terms to anyone who wants to build on it without
AGPL obligations — and ToolsEnabled Anywhere is built on exactly that basis.

This is a normal and long-established arrangement, but it has one requirement that
is easy to lose: **it only works while the copyright is not fragmented.** If
outside contributions are merged without a contributor agreement assigning rights
or granting a license broad enough to relicense, those contributors hold copyright
in their parts, and no commercial license can be granted over the whole work
without asking every one of them.

So this is a decision that has to be made before the first outside pull request is
merged, not after. See [`CONTRIBUTORS.md`](CONTRIBUTORS.md).

## What this file is not

This is an explanation, not legal advice, and none of it has been reviewed by a
lawyer. Two things in particular are recorded here as decisions rather than as
settled facts:

- **ToolsEnabled, Inc. does not exist yet.** It is described as "in formation"
  everywhere it appears, and copyright is held by Joshua Pinckard personally. When
  the entity is formed, whether and how copyright is assigned to it is a separate
  decision with tax and liability consequences.
- **The trademark position is unresolved.** Do not treat the product name as
  cleared.

## Third-party components

Components bundled with this software carry their own licenses, which are
unaffected by the terms above. See [`NOTICE`](NOTICE).
