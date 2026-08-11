# ToolsEnabled with Mission Control

## Attribution

**ToolsEnabled was founded and created by Joshua Pinckard. The original platform was
developed by directing autonomous AI-agent fleets through the system's own evolving
coordination architecture.**

| | |
| --- | --- |
| Company / copyright holder | ToolsEnabled, Inc. *(in formation — see [Legal status](#legal-status))* |
| Sole founder and creator | Joshua Pinckard |
| Official product | ToolsEnabled with Mission Control |
| Official publisher | ToolsEnabled, Inc. *(in formation)* |

Outside developers are listed in [`CONTRIBUTORS.md`](CONTRIBUTORS.md) as contributors and
maintainers. Contributors are never founders; the founder credit above is not shared.

---

## What this is

**ToolsEnabled** is a capability layer that gives an AI agent a governed set of real
tools — a policy kernel that decides what is allowed, a tamper-evident audit ledger that
records what happened, and a provider surface that performs the work.

**Mission Control** is the reference interface for it: the fleet, the agents, the
approvals, the spend ledger and the audit trail in one place.

They ship together as one free, open-source product. You can run it three ways:

- **Locally**, on one machine.
- **Over your own LAN**, from one machine to another you already control.
- **Self-hosted**, on infrastructure you operate.

None of those require an account with us, and none of them are time-limited or
feature-gated. The free product is the whole product for anyone who can reach their own
machines.

## The paid product

**ToolsEnabled Anywhere** is a separate, optional, paid service for the one problem the
free product deliberately does not solve: reaching your machines when you are *not* on the
same network. It provides managed non-LAN connectivity, device enrollment, the relay,
monitoring, recovery and support. Planned pricing is approximately $19.99/month.

Anywhere is a hosted service, not a feature unlock. Nothing in this repository is disabled
to sell it. The free product launches first; Anywhere follows as an invite-only beta.

## Governance

The official project lives under the ToolsEnabled GitHub organization. ToolsEnabled, Inc.
controls the official repository, the releases, the project's names and marks, and the
signed installers.

Anyone may fork this project and propose changes. Only approved code enters the official
build. A fork is your own; it is not the official product and must not present itself as
the official build or as published by ToolsEnabled, Inc.

Cloud infrastructure, billing, provisioning, security operations and internal development
tooling are developed separately and are not intended to be part of this repository.

What the official build actually redistributes is not left to that sentence to enforce.
It is declared in `config/payload-boundary.json` and checked by a gate on every release
build, which fails rather than warns. That file is the current, self-updating answer;
prose in a README is not.

## Legal status

Stated plainly, because a public repository is a dated, permanent record:

- **ToolsEnabled, Inc. does not exist yet.** Incorporation has not been filed. The company
  is named here as the intended publisher, marked *(in formation)*, and copyright is held
  personally by Joshua Pinckard until the entity exists and the rights are assigned to it.
  At that point the copyright holder line changes and the *(in formation)* qualifier is
  removed.
- **No trademark application has been filed** for "ToolsEnabled" or "Mission Control", and
  neither is claimed here as a registered mark. "Mission Control" is a common phrase and
  there are unrelated businesses using it.
- **Licensing is not yet final.** No open-source license has been selected, so no license
  grant is made by this file and all rights are reserved for now. The license will be
  chosen and added before this repository is made public.

## Status

Pre-release. This repository is not yet public.

---

*ToolsEnabled with Mission Control — created by Joshua Pinckard, sole founder.
Published by ToolsEnabled, Inc. (in formation). Copyright © 2026 Joshua Pinckard.*
