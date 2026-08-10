# Rebuilding the shipped Mission Control installer

**If you read one line:** the command that rebuilds a shipped installer is

```
node tools/release-packager/cut-release-candidate.mjs
```

Run it from a checkout of this repo (`wt-installer`, branch `installer/nsis`).
It exits 0 and leaves a staged, hashed, declared `.exe`. It is **not**
`npm run dist`, and `npm run dist` on its own is not enough — see §3.

Everything below was measured on Machine A on 2026-08-10, not inferred.

---

## 1. The one command

```
cd C:\Users\joshp\Desktop\wt-installer
node tools/release-packager/cut-release-candidate.mjs --test          # rehearsal
node tools/release-packager/cut-release-candidate.mjs                 # real candidate
```

| flag | effect |
| --- | --- |
| *(none)* | patch-bumps the version, stages to `C:\Users\joshp\Desktop\MACHINE-A-INSTALLER-CANDIDATE\<version>\` |
| `--test` | stages to a scratch dir under `%TEMP%`, forces branch-advance off, marks the declaration TEST / NOT FOR TRANSFER |
| `--source-ref <sha>` | build a specific commit instead of the branch tip |
| `--version X.Y.Z` | explicit version instead of `--bump patch` |
| `--keep-worktree` | leave the isolated build worktree on disk for inspection |
| `--advance-branch` | fast-forward `installer/nsis` to the build commit (opt-in, never automatic) |

What it does, in order: pick the version → `git worktree add --detach` an
**isolated** checkout → copy the untracked per-builder private input (§2) →
commit the version bump there → provision `node_modules` (§3) → `npm run dist`
→ re-read `dist/build-info.json` as an independent clean-tree confirmation →
copy the artifact out → re-hash the staged copy → remove the worktree → write
`DECLARATION.md` + `declaration-facts.json` next to the exe.

It never builds in a day-to-day worktree, so another lane's uncommitted work
cannot be baked into a release. On any failure it leaves the worktree in
place for postmortem.

### Verified

`--test --source-ref 678187d --version 1.0.2`, exit code **0**, full pipeline:
263 tests / 262 pass / 1 known-baseline fail (ratchet OK), owner-data scan 77
files / 366,091,606 bytes / 0 matches, `[smoke-packaged] PASS port=4601
http_status=200 marker_found=true window_title_error=false`.

---

## 2. The one prerequisite on a clean checkout

`npm run dist` runs `tools/check-no-owner-data.mjs`, which **hard-fails** if
`private/owner-data-patterns.owner.json` is absent. That file is deliberately
untracked (`/private/` in `.gitignore`) because it is the builder's own
identity profile — a guard that passes because it was given nothing to look
for is worse than no guard. So a genuinely fresh clone needs, once:

```
copy config\owner-data-patterns.example.json private\owner-data-patterns.owner.json
# then fill in your own names / usernames / account aliases
```

Two other `private/` files — `fleet-profile.owner.json` and
`research-queue.authored.json` — are **tracked** (committed before the ignore
rule) and therefore already present in any checkout. `cut-release-candidate.mjs`
copies only genuinely untracked private files into the build worktree and
leaves those two as their committed content.

---

## 3. Why `npm run dist` alone does not work here

Measured on Machine A, 2026-08-10:

- `C:\Users\joshp\Desktop\mission-control\node_modules` — the shared junction
  target that `wt-installer/node_modules` symlinks to — has **no `.bin`
  directory at all** (`test -e` exit 1), and is missing packages its own
  lockfile declares, including `@electron/asar`, `@electron/get`,
  `@electron/universal`, `@carbon/colors` (233 top-level entries present).
- Consequence: `npm run build` and `npm run dist` fail with
  `'vite' is not recognized`. `vite` and `electron-builder` are reachable only
  as `node node_modules/vite/bin/vite.js` / `node node_modules/electron-builder/cli.js`.

`cut-release-candidate.mjs` is immune to this, and that is not luck —
`tools/release-packager/lib/node-modules-reuse.mjs` explicitly checks for the
`vite.cmd` / `electron-builder.cmd` shims before it will junction a
`node_modules`, and falls back to a real `npm ci` **inside the isolated
worktree** when the check fails. That is what happened for 1.0.2 and again
for the 2026-08-10 verification run:

```
[node-modules] ...\wt-installer\node_modules is missing required node_modules/.bin
shims (vite.cmd, electron-builder.cmd) -- not trustworthy to junction. Falling back to npm ci.
```

So: **the release path is not blocked by the broken shared tree.** Only
day-to-day `npm run dev` / `npm run build` in a tree that shares that junction
are.

### Repairing the shared tree (ready to run; NOT done automatically)

An `npm install` there writes through the junction and affects **every**
worktree sharing it, possibly mid-build. Announce a window in `agent-coord`
and check the presence roster first, then:

```
cd C:\Users\joshp\Desktop\mission-control
npm install                                   # NOT from wt-installer: that writes through the symlink
node node_modules\electron\install.js         # electron's postinstall does not always fire
```

Verify by exit code, not by reading output:

```
test -e node_modules/.bin/vite.cmd; echo $?              # want 0
test -e node_modules/.bin/electron-builder.cmd; echo $?  # want 0
test -e node_modules/@electron/asar; echo $?             # want 0
```

Note that one lane previously added `node_modules/@noble/hashes` additively
(a declared electron-builder dependency that was entirely absent), with
`package.json` and `package-lock.json` untouched. A full `npm install` will
supersede that.

---

## 4. Which tree built `Mission Control Setup 1.0.2.exe`

**`C:\Users\joshp\Desktop\wt-installer`, branch `installer/nsis`.** Not
`C:\Users\joshp\Desktop\mission-control`. Confirmed four independent ways, not
by reading the declaration:

1. **The binary's own VersionInfo.** The shipped exe reports
   `CompanyName = "ToolsEnabled, Inc."` and
   `LegalCopyright = "Copyright © 2026 Mission Control"`. Those come from
   `author` and `build.copyright` in `package.json`.
   `Desktop\mission-control`'s `package.json` has **neither field** (and
   `appId com.joshp.missioncontrol`, version `1.0.0`); this branch has both,
   plus `appId com.toolsenabled.missioncontrol`.
2. **Reachability.** The 1.0.2 source ref `678187d` and build ref `d9ba79b`
   are contained in `installer/nsis` and `packaging/capability-layer` only.
   `git merge-base --is-ancestor` says they are **not** ancestors of
   `main`, nor of `r1198/page2-functional` — the branch `Desktop\mission-control`
   actually has checked out. That tree does not even contain the commit.
3. **The `files` glob.** At the build ref, `build.files` is
   `["dist/**","shell/**",...]` and `git ls-tree -r shell/` returns **16**
   entries — matching all 16 `shell/` entries in the shipped archive.
   `Desktop\mission-control` lists three explicit shell files instead.
4. **Rebuild.** Re-cutting from `678187d` produced a version-bump commit whose
   **git tree hash is `28e07f6fd8ab885c5d6578066824fa2d33d99bad` — identical**
   to the shipped 1.0.2 build ref's tree.

The build itself did not happen *in* `wt-installer` either: it ran in a
throwaway detached worktree, `C:\Users\joshp\Desktop\wt-release-build-1.0.2`,
since removed. `wt-installer` is the source of record; the build directory is
disposable by design.

---

## 5. What "reproducible" means here — and what it does not

| | shipped 1.0.2 | rebuild from `678187d`, 2026-08-10 |
| --- | --- | --- |
| source tree hash | `28e07f6f…` | `28e07f6f…` — **identical** |
| VersionInfo | ToolsEnabled, Inc. / Mission Control / 1.0.2 | **identical** |
| bytes | 100,286,418 | 100,286,372 |
| SHA-256 | `0138924CEB26…` | `E6B83B3F3B1F…` |

**The source input is provably identical. The installer is not bit-for-bit
identical** — a 46-byte delta and a different hash. Expect this: NSIS and the
PE format embed build timestamps, so `electron-builder` output is not
byte-reproducible. That cause is stated from format behaviour, *not* verified
byte-by-byte here.

The practical consequence, which is the point of this whole exercise: you can
take any shipped installer, read its `declaration-facts.json` for `sourceRef`,
re-cut from that exact ref, and get an artifact whose **source content is
provably the same**. That is enough to patch, audit, and diff a release. It is
**not** enough to prove two `.exe` files are the same file — for that, compare
the SHA-256 recorded in the declaration against the artifact you were sent.

If you ever need to prove the *payload* (not the installer wrapper) is
identical, pass `--keep-worktree` and compare `release/win-unpacked` /
`resources/app.asar` between the two builds.

---

## 6. Environment gotcha that has cost this team an afternoon

Agent harnesses export `ELECTRON_RUN_AS_NODE=1`, which turns the Electron
binary into plain Node: it reads stdin, hits EOF, and exits **0** silently
with no window. That reads exactly like a phantom crash. Both entry points
already strip it from the child environment — `shell/launch.cjs:9` and
`tools/smoke-packaged.mjs:200`, each with a regression test. If you add a new
path that spawns Electron, strip it there too.

---

*Written 2026-08-10 by lane `reproducible-build`. Every number above came from
a command's exit code or its captured output on Machine A; nothing is
inferred.*
