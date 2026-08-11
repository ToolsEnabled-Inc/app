# The open-source split: what the installer actually redistributes

**Status: inventory is measured fact. The classification is a PROPOSAL. The owner decides where the line goes.**

Lane: `opensource-split-prep`. Measured 2026-08-10 against
`C:\Users\joshp\Desktop\wt-capability` (app) and
`C:\Users\joshp\Desktop\toolsenabled-current` (capability-layer source).

---

## 0. The one thing to read if you read nothing else

**Publishing the installer *is* publishing the source.** `resources/capability/` is
**224 plain `.js` and `.json` files** — not compiled, not minified, not obfuscated —
sitting next to a trivially extractable `app.asar`. There is no repository decision to
make first: the payload is already a source distribution, and one build of it already
went to Machine B.

Two things follow, and they point in different directions:

1. **A boundary decision is now urgent**, because the artifact that leaks is the
   installer, not a repo.
2. **The boundary cannot currently be enforced by configuration.** `src/lib/tool-registry.js`
   loads all 69 providers through unconditional top-level `require()`. The packer derives
   the payload by walking that require graph. So *every provider in the tree is in the
   payload by construction*, and removing one is a code change, not a manifest edit.
   Section 4 measures exactly what that costs.

What has been built here is the mechanism that makes the owner's decision — whenever he
makes it — mechanically impossible to get wrong by accident: a single declarative manifest
plus a build-failing gate. Section 3.

---

## 1. Inventory: everything the installer redistributes today

### 1.1 How this was measured, and how to reproduce it

The payload is derived, not hand-listed. `tools/pack-capability-layer.mjs` walks the
`require()` graph from the entrypoints declared in `tools/capability-manifest.json` and
stages exactly the reachable files:

| Root | Declared in | Kind |
| --- | --- | --- |
| `tools/mission-bridge.js` | `entrypoints[0]` | loopback HTTP action bridge |
| `src/mcp-server.js` | `entrypoints[1]` | stdio MCP server |
| `src/lib/setup/machine-record.js` | `hostModules` | required by the Electron main process |
| `src/lib/setup/workspace.js` | `hostModules` | required by the Electron main process |
| `src/lib/agent-engine/codex-process.js` | `hostModules` | required by the Electron main process |

Recorded in `capability/PAYLOAD.json`:

```
fileCount     224
byteCount     4,953,684
payloadSha256 3f6515208002c2f90837cbf2768592378d0e1c9b428019b89ca710b4e8aea763
```

Independently recomputed during this work over a byte-copy of the payload: the digest
matched exactly, so every count and path below describes the artifact that ships and not
a reconstruction of it.

### 1.2 What is there, by subsystem

Grouped by `config/packages.json` package id (the tree's existing taxonomy — no new one
was invented). "In payload" counts only files actually staged.

| Package id | In payload | What it is | What publishing it means |
| --- | ---: | --- | --- |
| `surface.registry` | 9 | `tool-registry.js` (2,915 lines, the MCP tool catalog), `mcp-tool-surface.js`, `capability-manifests.js`, `approvals.js`, `scoped-approvals.js`, `settings.js`, `settings-registry.js`, `system-status.js` | The complete map of every capability the product exposes and how each is authorised. This is the product's architecture. |
| `entry` | 2 | `src/mcp-server.js`, `src/playwright-gateway.js` | The MCP protocol server and the credential-redacting Playwright gateway. |
| `mission-bridge` | 9 | `tools/mission-bridge.js` + `src/lib/mission-bridge/*` (server, actions, agent-lane-dispatch, codex-native-pair, owner-prompts, purchase-recording, termination, errors) | The loopback action bridge: origin allowlist, per-boot bootstrap proof, agent dispatch. |
| `kernel.policy` | 4 | `policy.js`, `policy-evaluator.js`, `policy-authorizations.js`, `kill-switch.js` | The deterministic policy kernel and global kill switch. |
| `kernel.audit` | 3 | `audit.js` (~2,200 lines), `audit-store.js`, `audit-checkpoint.js` | The tamper-evident Ed25519-signed audit ledger. |
| `kernel.runtime` | 7 | `runtime.js`, `http.js`, `schema-validator.js`, `service-registry.js`, `machine-profile.js`, `error-taxonomy.js` | Vault access (DPAPI), atomic IO, HTTP, schema validation. |
| `kernel.state` | 1 | `state-store.js` | SQLite durable state. |
| `surface.policy` | 7 | `action-guards.js`, `egress-preflight.js`, `lane-scope.js`, `request-context.js`, `ssrf-guard.js`, `permission-tier-policy.js`, `canonical-path.js` | Point-of-action refusals, SSRF/DNS-pinning, provenance-leak preflight. |
| `providers.*` | 74 | The whole provider surface — see 1.3 | Every third-party integration, credential flow and automation the product performs. |
| `agent-comms` | 12 + 1 provider | `src/lib/agent-comms/*` | The durable inter-agent message fabric. |
| `fleet` | 11 | `agent-lane.js`, `agent-onboarding.js`, `agent-presence.js`, `agent-wake*`, `fleet-supervisor/{queue,state}.js`, `build-queue-*`, `tree-identity.js` | The multi-agent lane orchestration and `BUILD-QUEUE.md` machinery. |
| `jarvis.workflow` + `jarvis.core` | 7 + 5 | `jarvis-workflow/*`, `jarvis-audit-events.js`, `providers/{jarvis-control,jarvis-worker-runtime,overnight-advisory*,memory}.js` | The JARVIS mission/verification harness. |
| `owner.telegram` / `owner.inbox` / `owner.ledger` | 17 | `telegram-*`, `discord-owner-commands.js`, `owner-chat.js`, `owner-directive-*`, `owner-steps.js`, `screenshot-relay.js`, `tools/owner-capture.js`, `tools/ledger-archive.js` | The pinned-owner-chat relay: Telegram/Discord command surface, screenshot relay, directive inbox. |
| `fra` | 6 | `fra-root-access.js`, `fra-capability-manifest.js`, `fra-transport-binding.js`, `fra-workspace-policy.js`, `providers/{fra-workspace-handles,remote-playwright}.js` | The peer-to-peer full-remote-access design, including its capability fencing. |
| `delegation` | 1 | `uac-delegation.js` | The Windows standing-elevation channel (see 2.4). |
| `entry.setup` | 2 | `setup/machine-record.js`, `setup/workspace.js` | First-run installer: node resolution, port ranges, permission tier, workspace selection. |
| `agent-engine` | 3 | `codex-adapter.js`, `codex-process.js`, `engine-contract.js` | Codex CLI app-server protocol client. |
| `sched` | 7 | `scheduler-adapter.js`, `scheduled-actions.js`, `managed-processes.js`, `providers/{scheduler,tasks,reminders}.js` | Windows Task Scheduler saga. |
| `secrets` | 1 | `credential-metadata.js` | The closed catalogue of credential field names the product can prompt for. |
| `auth.google` | 2 | `google-accounts.js`, `google-oauth.js` | Multi-account Google OAuth refresh machinery. |
| `grepsaver` | 3 | `tools/grepsaver-{lib,orient,reindex}.js` | Internal doc-orientation tooling. |
| `code.intel` / `search` | 3 | `lsp-client.js`, `providers/code-intel.js`, `search.js` | LSP client and local semantic search. |
| `models` | 5 | `model-floor.js`, `model-picker.js`, `license-store.js`, `providers/model-role.js` | Model tiering, local model selection, licence revocation store. |
| `controller` | 8 | `controller-{launch-record,meter-ledger,metering,tool-meter,output-feed}.js`, `coordinator-status-observation.js`, `ide-session-consent*.js`, `owner-request-scope*.js` | Launch records, usage metering, coordinator observation. |
| `providers.billing` | 6 | `providers/{billing,paddle,pay,stripe,license}.js`, `entitlement.js` | Payments, licensing and the tier model — see 2.2. |
| `providers.aicalendar` | 21 | The AICalendar Chrome Web Store pipeline — see 2.1 | **A different commercial product's release automation.** |
| — (data) | 9 | `config/{agent-org,service-registry,model-floor,toolsenabled.policy}.json`, `schemas/platform/*`, `schemas/generated/*`, `package.json`, `PAYLOAD.json` | Runtime policy and generated platform contracts. |
| — (spill) | 4 | `state/*.json` | **Not part of the staged payload.** See 2.5. |

### 1.3 The 74 provider files, named

```
agent-comms  agent-sandbox  billing  capability-manifests  chrome-web-store
chrome-web-store-oauth  cli-provider-gateway  code-intel  customer-model  deployment
digitalocean  digitalocean-app-spec  digitalocean-google-auth  digitalocean-inventory
digitalocean-token-portal  drive  duo-desktop  extension  firebase  fra-workspace-handles
gcloud-account-login  github  google  host-control  http-request  infrastructure
instagram  iphone-handoff  jarvis-control  jarvis-worker-runtime  launch  license
memory  messaging  model  model-role  overnight-advisory  overnight-advisory-runtime
owner-identity-profile  owner-prompt-queue  paddle  pay  reminders  remote-playwright
repo-files  research-hermes  research-strong  scheduler  sensitive-local-input  stripe
tasks  vertex-gemini  vertex-gemini-seat  vertex-gemini-strong  web  workstation

aicalendar-cws-auth  aicalendar-cws-capture  aicalendar-cws-focus  aicalendar-cws-identity
aicalendar-cws-named-draft  aicalendar-cws-navigation  aicalendar-cws-publisher-verification
aicalendar-cws-readiness  aicalendar-cws-routes  aicalendar-oauth-capture
aicalendar-provider-safety  aicalendar-publisher-identity-evidence
aicalendar-publisher-verification-email  aicalendar-publisher-verification-email-browser
aicalendar-release  aicalendar-revenue-extension-id  aicalendar-revenue-release
aicalendar-revenue-service-base                                          (18 AICalendar)
```

### 1.4 What is verified NOT in the payload

Trusting the packer's neutral-defaults substitution would have been the easy mistake, so
it was checked by hash rather than assumed:

| File | Source tree contains | Payload contains | Verified |
| --- | --- | --- | --- |
| `config/agent-org.json` | 29,624 B — live seat roster, verbatim owner directives R1131–R1187, funding account aliases `jpinckard21` / `jpinckard95` / `jpinc005` | 1,288 B — the neutral default | payload sha256 == `capability-defaults/` sha256, != source |
| `config/service-registry.json` | real LAN addresses `192.168.214.1` / `.2`, three absolute `C:\Users\joshp\...` roots | the neutral default | payload sha256 == `capability-defaults/` sha256, != source |

A direct scan of the whole payload for `192.168.214`, `joshp`, `jpinckard`, `jpinc005`,
`@gmail.com`, `@ucr.edu` returns **zero matches**. `check-no-owner-data.mjs` reports clean,
and that verdict now has an independent second measurement behind it.

`src/lib/fleet-supervisor/lane-runner.js`, which hardcodes a real personal Gmail address at
line 72, is **not** in the payload — only `fleet-supervisor/queue.js` and `state.js` are.
That is luck of the require graph, not a rule. If anything ever requires `lane-runner.js`,
that address ships. The gate in section 3 turns that from luck into a caught failure.

---

## 2. Classification PROPOSAL

> **This section is a proposal.** It is the lane's reading of measured evidence. Every item
> is written as `PROPOSE …` and none of it is a decision. The corresponding machine-readable
> form is `config/payload-boundary.json`, whose `status` field currently reads `"proposed"`.

### 2.1 Not an open-vs-paid question at all: a different product's code

**PROPOSE: `must-not-ship-at-all`, independent of any licence decision.**

18 provider files plus `src/lib/aicalendar-root.js` are the complete Chrome Web Store
release pipeline for **AICalendar — a separate commercial product**. Not ToolsEnabled
automating a third party on a user's behalf: release/ops tooling for the owner's *other*
product, hardwired to that product's specific Store listing, Firebase project and revenue
backend. It is currently redistributed inside ToolsEnabled's installer.

**These are NOT a third party's identifiers, and calling them that gets the harm
backwards.** AICalendar is the owner's *own* separate product — `src/lib/aicalendar-root.js`
says so in its own header. Nothing here is somebody else's property being disclosed. The
harm is (a) cross-linkage between two of the owner's products in a repository published
under his name, and (b) for the Firebase/GCP project specifically, pointing the public at
infrastructure with live payment handling behind it, which makes it an abuse target. An
earlier revision of this section called them "third-party identifiers" and very nearly put
that error into a gating document; the two framings imply different remedies and different
severities, so the distinction is worth the paragraph.

**They are also not the same severity as each other.** A Chrome Web Store item id is public
by construction — it is in the store URL of any published extension. A live project id with
billing behind it is not. Do not put them on one line.

**Neither value appears in this document.** Writing an identifier down in order to explain
why it must not be published would publish it; the table below names the constants and the
places they used to sit.

**STATUS 2026-08-11 — both are out of the payload** (lane `opus5-ultracode-provider-trio`),
verified by scanning the staged bytes rather than by reasoning about require() edges:

| Constant | Where it used to sit | How it was resolved |
| --- | --- | --- |
| `AICALENDAR_STORE_ITEM_ID` | `src/lib/providers/chrome-web-store.js` (~15), `aicalendar-release.js` (31) | Became configuration, single-sourced from `aicalendar-root` with no default. **Not deleted:** an upload fence, an audit-target redaction and an audit-details gate all compare against it, and deleting the constant would have removed a security control and de-redacted an audit target. All three are mutation-tested. |
| `AICALENDAR_REVENUE_FIREBASE_PROJECT_ID` | `src/lib/providers/firebase.js` (~12) | Constant and the one tool reaching it moved to `providers/aicalendar-revenue-firebase.js`, required only from `src/lib/tool-packs/`, which no installer entrypoint loads. |
| same | `config/toolsenabled.policy.json` (55) | Handled earlier and separately, by sanitizing through `capability-defaults/`. |

Neither was caught by `check-no-owner-data.mjs`, because neither is owner *identity* data —
which is precisely why a second, differently-shaped gate was needed.

**The sharpest item in this group:**
`src/lib/providers/aicalendar-publisher-identity-evidence.js` stages and OCRs the **owner's
passport MRZ** for Chrome Web Store publisher verification. It is in the payload. No
stranger's ToolsEnabled installation has any use for passport-document handling.

**Two files in this cluster must NOT simply be deleted:**

- `aicalendar-provider-safety.js` — despite the name, a **general** provider-boundary
  library (input validation, vault-key secret reads, redaction, a durable `mutate()`
  wrapper). **26 importers, 11 of them non-AICalendar** (`digitalocean*`, `paddle`,
  `duo-desktop`, `iphone-handoff`, `owner-prompt-queue`, `owner-identity-profile`).
  **PROPOSE: rename out of the AICalendar namespace and keep it open.** Deleting it breaks
  half the provider surface.
- `aicalendar-cws-readiness.js` — two modules in one file: a general CDP/owned-browser
  toolkit (`safeDebuggerUrl`, `validSession`, `revalidateSession`, `targetsFor`, `evaluate`)
  that `digitalocean-token-portal.js` and `digitalocean-google-auth.js` genuinely depend on,
  plus AICalendar-specific CWS probes. **PROPOSE: split the toolkit out; exclude only the
  CWS half.**

`chrome-web-store.js`, `chrome-web-store-oauth.js` and `firebase.js` are similarly mixed:
genuinely generic clients carrying a hardcoded AICalendar branch. **PROPOSE: split — the
generic half is publishable once the hardcoded identifier is removed.**

### 2.2 The business model

**PROPOSE: `paid`.**

| File | Why |
| --- | --- |
| `src/lib/entitlement.js` | Contains the **actual commercial tier table**: community $0, Operator Cloud **$19/mo ($190/yr)**, Team **$299/mo, 3-seat minimum**, with `productId`s and the `hosted-relay` grant. This is the business plan in source form, shipping in the installer today. |
| `src/lib/providers/license.js` | Ed25519 licence issuance / verification / revocation — the mechanism a paid tier is enforced with. |
| `src/lib/license-store.js` | The revocation store behind it. |

**An important architectural finding in the owner's favour:** there is **no local
enforcement to decouple.** `entitlement.js:79` declares `UNLICENSED_INSTALL = 'full-function'`;
the throwing gate `requireCapability()` has **zero callers**; and the module's own comment
names the real refusal point as
`src/lib/providers/hosted-relay-entitlement.js` — *"on the machine WE run"*. That file is
**not in the payload**. The paid enforcement point is already server-side, which is the
right place for it. What ships is the *description* of the commercial model, not the
mechanism that charges for it.

`entitlement.js` is reachable only through `system-status.js`, whose `require()` is already
wrapped in a `try/catch` that returns a community-tier fallback. **Removing `entitlement.js`
from the payload breaks nothing.** It is the single cheapest item on this whole list.

**PROPOSE: open** for `providers/{billing,paddle,pay,stripe}.js` and the
`controller-meter*.js` trio. These are outbound *capabilities* (create a Stripe checkout,
issue a virtual card, cap the agent's own spending) and value-free usage telemetry — not a
paywall. Flagged for the owner because "billing" reads like monetization and is not.
**No live secrets, price IDs, product IDs, webhook secrets or merchant account identifiers
are hardcoded in any of them** — all are read from the vault at runtime.

### 2.3 Bound to the owner's own accounts

**PROPOSE: `must-not-ship` (useless to a stranger, and an identity fingerprint).**

`providers/vertex-gemini.js`, `-strong.js`, `-seat.js` are pinned by SHA-256 *commitment*
to the owner's own GCP accounts and projects (e.g. `vertex-gemini.js:34`). The plaintext is
deliberately kept out — good design — but a hash is still confirmable against guessed
candidate project ids, and these routes cannot function for anyone else.

### 2.4 Ships today, publishing is a judgement call — flagged, not proposed

Three items are deliberately *not* proposed for exclusion, because each is a real,
owner-authorised product capability. They are surfaced because publishing them publicly is
a decision worth making consciously rather than by default:

- **`src/lib/providers/host-control.js`** — genuine arbitrary shell execution
  (`powershell`/`cmd`) at the user's own non-elevated privilege, plus read/write anywhere
  under the profile. Kill-switch gated, audited before execution, cwd-contained, and
  explicitly owner-authorised — but audit is not prevention. Publishing the source
  publicises exactly what an agent-directed shell channel in this product can do.
- **`src/lib/uac-delegation.js`** — a standing (no-prompt-per-call) Windows elevation
  channel, restricted to a fixed four-executable allowlist (`schtasks`, `netsh`,
  `powershell`, `sc`) with `shell: false` and fixed argv. The local allowlist file does not
  ship. Publishing discloses the *design* of the elevation channel.
- **`config/toolsenabled.policy.json` and `config/model-floor.json`** — both are required at
  runtime and both carry non-public material: the live GCP project id (the value named by
  `AICALENDAR_REVENUE_FIREBASE_PROJECT_ID`; see §2.1 — it is not written out here), the
  owner's daily spend cap, paid-plan API quota pools, and — in `model-floor.json` — verbatim
  owner directives and a dated internal incident narrative.
  **PROPOSE: sanitize in place before public release** rather than exclude; the runtime
  needs the files, not their prose.

### 2.5 Runtime credential spill — a live defect found while measuring

`capability/state/` and `release/win-unpacked/resources/capability/state/` each contain four
JSON files that are **not part of the staged payload**, including:

```
state/mission-bridge-token.json            {"version":1,"bootId":…,"token":"hW0vwT3Bn…"}
state/mission-bridge-bootstrap-proof.json  {"version":1,"bootId":…,"token":"f0LufHeq…"}
```

These are loopback bearer tokens written by the mission bridge when it is started out of
the payload directory. **Timeline, from file mtimes:** the packer re-staged at 20:59:06 (it
`rm -rf`s the directory first), the installer was built at 20:59, and the state files were
created at 21:14 and 21:21 — *after* the `.exe`. **So `Mission Control Setup 1.0.3.exe` does
not contain them.** (A raw byte scan of the `.exe` finds neither identifier, but the NSIS
payload is LZMA-compressed so that alone is inconclusive; the timestamps are the load-bearing
evidence.)

The exposure is real but narrower than it first looks: any hand-copy of
`release/win-unpacked` made after a local run carries live tokens. `check-no-owner-data.mjs`
does not catch them — its credential rule matches `sk-`-prefixed provider keys, not these.
The boundary gate does, via `excluded.prefixes: ["state/"]`, and **it caught them on its
very first run against the live payload.**

---

## 3. THE MECHANICAL GATE

### 3.1 Why a gate and not a rule

This project is a catalogue of remembering failing. A standing order was retired in the
canonical tree and changed nothing, because the live hook ran from a different tree; three
separate lanes have independently found that the live scheduled tasks execute the *retired*
tree. "Don't publish the paid part" as prose depends on someone recalling, at the moment it
matters, which tree they are in. It will leak. As a gate it cannot.

### 3.2 The pieces

| Path | Role |
| --- | --- |
| `config/payload-boundary.json` | **The decision, in one place.** The only file that has to change when the owner rules. |
| `tools/check-payload-boundary.mjs` | The gate. Modelled directly on `tools/check-no-owner-data.mjs` — same exit-code contract, same fail-closed posture. |
| `tools/test/payload-boundary.test.mjs` | 29 tests driving the real guard as a subprocess and asserting real exit codes. |
| `package.json` → `dist` | Wiring, asserted by a test rather than trusted. |

Exit codes, matching the existing owner-data guard so both are read the same way:
`0` clean · `1` **violation, build stops** · `2` manifest/setup error.

### 3.3 How the owner expresses a decision

Move a path from `pending` into `open`, `paid` or `excluded`. That is the whole edit —
one line.

```jsonc
"pending": {
  "src/lib/entitlement.js": "PROPOSE PAID. Contains the actual commercial tier table…"
}
```
becomes
```jsonc
"paid": { "paths": ["src/lib/entitlement.js"] }
```

The build then goes **red** until the file genuinely stops being staged. That redness is
the feature: it is the difference between a decision recorded and a decision in effect.

### 3.4 The four properties that make it hold

1. **It fails, it does not warn.** A `paid` or `excluded` file present in the payload exits
   1 and `npm run dist` stops. There is no downgrade flag, because a guard that can be
   downgraded gets downgraded on the day it finally catches something real.

2. **Unclassified is a failure, not a default.** Every payload file must be named in the
   manifest. A module added next month that matches nothing stops the build. Defaulting the
   unknown to `open` would mean the next provider anyone writes ships publicly *by silence*
   — the absence-as-emptiness defect this project keeps rediscovering, in its worst form.

   This is also what makes a **typo** safe. A misspelled `paid` entry matches nothing — but
   the real file then matches nothing either, lands in `unclassified`, and still fails.
   *Proven in step 10 below.*

3. **Restrictive classes may use prefixes; `open` may not.** Over-matching a `paid` prefix
   fails a build and is fixed in minutes. An over-broad `open` prefix classifies files that
   *do not exist yet*, so a paid module dropped into that directory later would ship
   unnoticed. `open` is exact paths only — every publicly released file is named by a human,
   once. The guard rejects `open.prefixes` outright.

4. **Assert by named path. Never by count.** There is no expected-file-count anywhere in the
   guard. On this project a "216 → 221 files" coincidence once nearly produced a false "it
   shipped" conclusion. Counts are printed as information and compared against nothing. A
   test pins this: two payloads with **identical file counts** get opposite verdicts.

**One extra invariant.** Setting `status` to `"owner-ratified"` is **refused** while
anything is still `pending`. "The owner has decided" and "these items are undecided" cannot
both be true, so ratifying forces a decision on every open question instead of letting one
be ratified by being overlooked.

### 3.5 Proof that it can actually fail

Run against a byte-verified copy of the real payload. Every exit code below was echoed from
`$?` directly.

| Step | Action | Result |
| --- | --- | --- |
| 1–2 | Copy the staged payload; recompute the packer's own `payloadSha256` over the copy | `3f6515208002…aea763` — **matches `PAYLOAD.json` exactly.** The thing under test *is* the shipped payload. |
| 3 | Gate on the clean payload | `Payload boundary: clean` — **exit 0** |
| 4 | Plant a paid-classified file (`src/lib/providers/hosted-relay-entitlement.js`) | copied from the real source tree |
| 5 | **Verify by hash that the plant landed** | source `a5e6525b…fee64` == planted `a5e6525b…fee64` — **plant verified present with identical bytes** |
| 6 | Gate on the planted payload | `PAYLOAD BOUNDARY VIOLATION — 1 file(s)`, naming `src/lib/providers/hosted-relay-entitlement.js` — **exit 1** |
| 7–8 | Remove the plant; gate again | `clean` — **exit 0** |
| 9 | Plant an unclassified file (`src/lib/brand-new-thing.js`) | `UNCLASSIFIED` — **exit 1** |
| 10 | Misspell the `paid` rule *and* plant the real paid file | still **exit 1**, caught as unclassified — **a typo cannot silently ship it** |

And on the live payload directory, on its very first run, the gate found a true positive
nobody was looking for: the four `state/` files of section 2.5 — **exit 1**.

### 3.6 What this gate does NOT cover

Stated plainly rather than left to be assumed:

- It classifies the **capability payload only**. The viewer half (`dist/**` inside
  `app.asar`) is a separate surface and is not in this manifest.
- It checks **file presence, not file content**. A paid *function* pasted into an
  open-classified file passes. Nothing mechanical here prevents that.
- It cannot make the boundary decision, and does not claim the current classification is
  the owner's.

---

## 4. What a split actually costs — measured, not guessed

### 4.1 The blocking fact

`src/lib/tool-registry.js` requires **69 providers through unconditional top-level
`require()`**. No `if`, no feature flag, no lazy require, no try/catch:

```js
const aicalendarRelease = require('./providers/aicalendar-release');   // line 38
const hostControl       = require('./providers/host-control');         // line 101
```

The packer derives the payload from that graph. So a provider is in the payload **because
`tool-registry.js` names it**, and removing it from the payload without editing
`tool-registry.js` produces `MODULE_NOT_FOUND` on a customer's machine at startup.

There is an existing selection mechanism — `TOOLSENABLED_TOOL_ALLOWLIST` — but it filters
which tools are **advertised** at runtime. It does not stop the module being `require()`d,
and it does not remove one byte from the payload. **It cannot be used for this.**

### 4.2 So: can the paid/foreign part be excluded at all?

**Measured cut of the whole `providers.aicalendar` package (22 files):**

```
cutRequested                22
blockedFiles                21      <- still referenced by reachable code
droppedAsCollateral          0      <- nothing else becomes orphaned
payloadAfter               200
```

**The honest answer: yes, but it is real decoupling work, not a config change.** The good
news is that the work is bounded and the shape is known — nothing else in the payload
collapses when this cluster leaves.

**Blockers, exactly:**

| Blocked file | Blocked by | Cost |
| --- | --- | --- |
| 18 of the 22 | `tool-registry.js` only | Mechanical. Make those `require()`s conditional, or split the registry into open/paid halves. |
| `aicalendar-cws-readiness.js` | `tool-registry.js`, **`digitalocean-token-portal.js`**, **`digitalocean-google-auth.js`** | Extract the CDP/browser-session toolkit into its own module first. |
| `chrome-web-store.js`, `extension.js` | `tool-registry.js`, **`providers/launch.js`** | `launch.js` genuinely uses the extension packaging path. Real coupling. |
| **`aicalendar-provider-safety.js`** | **10 non-AICalendar providers** (`owner-prompt-queue`, `duo-desktop`, `iphone-handoff`, `paddle`, all five `digitalocean*`, `owner-identity-profile`) | **Do not cut. Rename and keep.** This is a general library wearing the wrong name. |
| `aicalendar-cws-routes.js` | *nothing reachable* | Free — it leaves with the cluster. |

**A second, independent obstacle:** `pack-capability-layer.mjs` deliberately **refuses**
computed `require()` expressions (*"the capability layer contains computed require()
expressions that a pack-time walk cannot follow"*). So the obvious fix — making provider
loading dynamic — would fail the packer unless each new dynamic require is declared in
`capability-manifest.json`'s `dynamicRequires`. That refusal is correct and should not be
weakened; it just means the split must be **static**: two registry modules, each with its
own literal require list, not one registry with a runtime condition.

### 4.3 Cost, per proposed group

| Group | Files | Cost | Notes |
| --- | ---: | --- | --- |
| `src/lib/entitlement.js` (the price table) | 1 | **Near zero** | Only importer is `system-status.js`, already inside a `try/catch` with a working fallback. Delete from payload; nothing breaks. |
| `license.js` + `license-store.js` | 2 | **Low** | One `tool-registry.js` require each. |
| `vertex-gemini{,-strong,-seat}.js` | 3 | **Low** | `tool-registry.js` only. |
| AICalendar CWS cluster | 18 | **Medium** | Registry split, plus the two extractions above. |
| `chrome-web-store*.js`, `firebase.js` | 3 | **Medium** | Mixed files: remove the hardcoded identifier and the special-cased branch; keep the generic client. |
| `aicalendar-provider-safety.js` | 1 | **Rename only** | 26 importers to update. Do not exclude. |
| `state/` spill | 4 | **Already handled** | The gate catches it; a clean `npm run dist` never carries it. |

### 4.4 The recommended shape

The architecture is *not* incapable of separating these — but it cannot do it today, and no
amount of manifest editing will change that. What it needs is one focused change:

> **Split `src/lib/tool-registry.js` into a core registry plus one or more optional
> registry modules, each with its own static require list, composed at load time by which
> modules are present.**

That single refactor turns every remaining item on this list from "impossible without
breaking startup" into "remove the file". Until it happens, the gate's honest behaviour is
what it does now: name the files, report them as pending, and refuse to let anything
classified `paid` or `excluded` reach the payload unnoticed.

---

## 5. Open questions for the owner

1. **AICalendar** — is excluding its release pipeline from ToolsEnabled's installer the
   right call, or is that pipeline meant to be a ToolsEnabled feature? (The two live
   identifiers should be removed from a public build either way.)
2. **The tier table** — `entitlement.js` names $19 / $299 and a 3-seat minimum. Publish as
   part of an open product's documentation of its own commercial model, or hold back?
3. **`host-control.js`'s shell execution and `uac-delegation.js`'s elevation channel** —
   open, or held back?
4. **`config/model-floor.json`'s verbatim owner directives and incident narrative** — sanitize,
   or publish as-is?
5. **The registry split in 4.4** — worth scheduling now, or after the boundary is ratified?

No repo was created, nothing was published, no release was changed, and no licence file or
header was added. Those are all still the owner's calls.
