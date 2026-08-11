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

The three items publication was originally gated on are **done**, verified in the staged
payload: the passport-MRZ module, the cloud-account-pinned provider routes, and the other
product's release automation are all gone. The boundary gate now exits 0.

**Exit 0 does not mean "safe to publish", and this is the trap.** Read what the gate
actually asserts:

```
node tools/check-payload-boundary.mjs capability
  Classified: open=<n> pending=6 paid=0 excluded=0 unclassified=0
  Payload boundary: clean. Nothing paid, excluded or unclassified is present.
```

**The publication condition is `pending = 0`, read from the `Classified:` line — not exit
0, and not the last line of the output.** A `pending` file is one whose fate has been
decided but which *still ships today*; the guard deliberately does not fail on those.

**`pending = 0` is necessary and not sufficient. The stage must also be current.** The
boundary gate judges the *staged* payload, so it can pass on bytes that no longer match
the source those bytes came from — and then the thing reviewed and the thing shipped are
two different programs. That is a third gate, and it is red right now:

```
node tools/check-payload-current.mjs capability
  REFUSING: the staged payload does not match the code it came from.
    src/lib/providers/license.js   (vs source)          exit 1
```

Measured 2026-08-11: the staged copy of that file is missing roughly 47 lines the source
has, including the block that pins which key is allowed to vouch for a licence. So the
staged bytes are not merely older — they are missing a hardening the source has. Re-stage
with `npm run pack:capability` and re-run **all three** gates before publishing anything
cut from this directory.

Worth noting how this was found, because it is the same lesson twice: a lane closed out
reporting "all three payload gates exit 0", and that was true when measured. It was false
within the hour. Do not inherit a gate result from a report, including this one.

**And a green reading expires.** Re-run the gate against the payload you are actually
about to ship. The full reasoning for both — why the guard does not fail on `pending`, and
why any lane's commit can turn a green reading red without anyone touching the boundary
file — is stated at the source, in the header of `config/payload-boundary.json`. **Read it
there, not here.** That is deliberate: this page used to restate the condition, the
restatement went stale the moment the underlying work moved, and a second copy that drifts
is how "exit 1 means excluded files" became a hazard in the first place. One statement, in
the file the gate reads.

What this page adds, and what is not in that file, is what the remaining `pending` files
actually cost you and in which order to touch them.

### Provenance for the publication record

An exit code names a moment; a hash names the bytes. The staged payload is
byte-reproducible — two consecutive stages produced an identical digest — so record
`payloadSha256` from `capability/PAYLOAD.json` alongside the gate result.

One gotcha before someone reports a drift that is not there: **`PAYLOAD.json`'s
`fileCount` is one lower than the number of files on disk, and that is correct.** The
packer computes the count and digest over the staged set and *then* writes `PAYLOAD.json`
into the same directory, so the record does not count itself. Verified in
`tools/pack-capability-layer.mjs` — `fileCount: all.length` is evaluated before the
`writeFileSync`. Comparing that number against `ls` or against the gate's `Files seen`
will always look off by one. This repository has already had one near-miss from reading
meaning into a file-count coincidence; do not spend a launch night on this one.

### The six files still shipping

These are not one problem. They are two, and they are not equally urgent. This list is a
snapshot — the gate's own `pending` output is authoritative.

**Group A — the commercial model, in source form.** Publishing these discloses more of the
business than intended. Nothing operational breaks by publishing them; nothing is at risk
of abuse.

| Still shipping | What it discloses |
| --- | --- |
| `src/lib/entitlement.js` | The actual commercial tier table and prices — the business plan in source form |
| `src/lib/providers/license.js` | Licence-key issuance and verification |
| `src/lib/license-store.js` | The revocation store behind it |

**Group B — identifiers for the owner's *other* product.** These are **not a third
party's**. Both name a separate commercial product of the owner's own
(`src/lib/aicalendar-root.js` says so in its header). The harm is not third-party
disclosure — it is **cross-linkage**: an open-source release published under his name that
quietly points at his separate revenue product.

| Still shipping | What it discloses | Priority |
| --- | --- | --- |
| `src/lib/providers/firebase.js` | A GCP project id **with live payment infrastructure behind it** — 6 active Stripe-extension Functions, a live webhook endpoint and a Firestore checkout flow, last active 2026-07-23 | **Highest.** A project id with live billing attached is an abuse target |
| `src/lib/providers/chrome-web-store.js` | A Store listing id | Lower. A published extension's item id **is public by construction** — it is in its own store URL |
| `src/lib/aicalendar-root.js` | Resolves a checkout path for that separate product | Lower — and **not independently retirable**, see below |

### Do not "clean up" the Store item id to make the gate green

The remedy for those two is **not symmetric**, and getting this wrong removes a security
control:

- **`firebase.js` is the easy one and the urgent one.** The project id is reachable from a
  single tool that belongs with the rest of that product's release automation. Nothing
  generic depends on it.
- **`chrome-web-store.js` is not a deletion.** Its literal is load-bearing. At line 154 it
  backs a second, independent fence — the fixed Store item is unreachable through the
  generic upload path unless a broker attestation is supplied, *even if the bytes are
  copied out of the tree*. It is also used to redact the audit target. **Deleting the
  literal to shrink the payload would silently delete that fence.** It needs the id turned
  into configuration with the check preserved — real work, and not work for whoever is in
  a hurry to make this gate green.

**And `aicalendar-root.js` is not the cheap one to start with**, though it looks like it.
It is in the payload because `chrome-web-store.js` requires it for a *package-path* fence
(`isWithinAicalendarRoot`), and `chrome-web-store.js` is in the payload because
`providers/launch.js` uses the generic client for its publish step. So it is held up by
the same file as everything else here, and there is a second fence under it. It falls out
for free once the `chrome-web-store.js` fences become configuration, and cannot be removed
before that without deleting one. Do not start with it because it looks smallest.

Neither has been done. The measured analysis is in `agent-coord` under
`payload-firebase-cws-identifiers`; start from it rather than from this summary.

**The condition for making a product repository public is `pending=0`,** not `exit 0`.
Publishing while any of those six are staged publishes them, because the installer *is* a
source distribution — 200-plus plain `.js` files next to a trivially extractable
`app.asar`. Whoever publishes must re-run the gate and read the `pending` count, not the
last line.

Note also that untracking a file does not remove it from git history. When the product
repository is eventually published, it needs a fresh repository or a history rewrite —
the existing private remote has history that predates any of this.

---

*ToolsEnabled — created by Joshua Pinckard, sole founder.
Published by ToolsEnabled, Inc. (in formation). Copyright © 2026 Joshua Pinckard.*
