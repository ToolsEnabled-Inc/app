# Creating the ToolsEnabled GitHub organization

Status: **not created.** Blocked, with the blocking step named below. Everything the
organization needs on day one is already written and committed; this is the click path.

## Why this is not automated

There is no REST endpoint that creates an organization on github.com. The organizations
API exposes list, get, update and delete only — creation is web-only for github.com
accounts. (`POST /admin/organizations` exists, but only on GitHub Enterprise Server.)
So this is a browser task by GitHub's design, not by ours.

## What blocked it

Not permissions, not credentials, not GitHub. The local audit ledger.

Every ToolsEnabled MCP tool whose effect is `external-write` — which includes
`browser.start` — calls `requireRecord()` in `src/lib/audit.js`, which refuses when the
durable audit intent cannot be written:

```
Durable audit intent could not be recorded; the external mutation was not started.
```

Underneath that is `SQLITE_BUSY` on the audit database, after the 5000 ms
`BEGIN IMMEDIATE` retry budget is exhausted. External writes always force an anchor
write, and the anchor write runs a synchronous `powershell.exe` vault call *inside* the
held SQLite transaction, so each one holds the global audit write lock for ~8 seconds —
longer than the retry budget other callers are given. Under ~120 concurrent agent
processes it fails effectively every time.

The ledger itself is healthy: chain contiguous, anchor matching, signatures valid, spool
drained. This is contention, not corruption.

**Check whether it has cleared:**

```
node tools/audit-durability-check.js
```

`audit durability: OK` means retry the browser step. `CRITICAL` means it will fail again.

**What clears it:** fewer concurrent agent processes, or restarting the MCP server with
`TOOLSENABLED_AUDIT_TRANSACTION_RETRY_MS=30000`.

Do **not** work around this by driving the browser outside the audited path. Creating an
organization is an identity-bearing action taken under the owner's name, which is
precisely what the audit control exists to record.

## The click path

Signed in as the owner's GitHub account.

1. Go to **https://github.com/account/organizations/new?plan=free**
   (Or: profile menu → *Your organizations* → *New organization* → *Create a free
   organization*.)
2. **Organization name:** `ToolsEnabled`
   Verified available — `github.com/ToolsEnabled` and `github.com/toolsenabled` both
   return 404. GitHub names are case-insensitive for uniqueness, so this claims both.
3. **Contact email:** the owner's primary GitHub account email.
4. **This organization belongs to:** *My personal account.*
   Not "A business or institution" — that option is about billing and support
   attribution, and ToolsEnabled, Inc. does not exist yet. It can be changed after
   incorporation.
5. Complete the human-verification step if shown, then **Next**.
6. **Invite members:** skip. No outside developers yet.
7. Finish the optional survey or skip it.

## Immediately after creation

1. **Verify the name landed:** `https://github.com/ToolsEnabled` resolves.
2. **Create the profile repository.** In the organization: *New repository*, named
   exactly `.github`, **Public**, initialised with a README.
   This repository is public by design and contains only the profile page. It does not
   publish the product.
3. **Add the profile page.** Create `profile/README.md` in that repository and paste the
   content of [`profile-README.md`](profile-README.md) — everything below the HTML
   comment. GitHub renders it at `https://github.com/ToolsEnabled`.
4. **Organization settings → Member privileges:** set base permissions to *Read*, and
   turn off members' ability to create public repositories. Only approved code enters the
   official build, and this is the mechanical half of that.
5. **Enable two-factor requirement** for the organization.

## What must NOT happen yet

**Do not create, transfer or make public any product repository.**

Publication is gated on the `payload-decoupling` lane finishing the removal of another
product's automation from the capability payload. As of this writing the passport-MRZ
module and the cloud-account-pinned provider routes are out, and that third item is still
in progress. The gate is mechanical, not a memory:

```
node tools/check-payload-boundary.mjs release/win-unpacked/resources/capability
```

Exit 1 means the payload still carries files classified `excluded`. Publishing anything
while that is true publishes them, because the installer *is* a source distribution.

Note also that untracking a file does not remove it from git history. When the product
repository is eventually published, it needs a fresh repository or a history rewrite —
the existing private remote has history that predates any of this.

---

*ToolsEnabled with Mission Control — created by Joshua Pinckard, sole founder.
Published by ToolsEnabled, Inc. (in formation). Copyright © 2026 Joshua Pinckard.*
