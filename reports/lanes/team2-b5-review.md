# team2-B5 — adversarial review (LEGACY-ONB-001 recovery paths)

Reviewer re-ran the load-bearing evidence against the working tree and drove the
packaged app on sterile profiles. Nothing was edited in product code.

## Reproduced independently

| what | result |
| --- | --- |
| `node tools/first-run-recovery-qa.mjs` (twice, once with `--shoot`) | 41/41, exit 0, 22.6 s |
| `node --test tools/test/first-run-needs.test.mjs tools/test/home-screen.test.mjs` | 38/38, exit 0, 1.34 s |
| `node tools/agent-route-reachability.mjs` | ALL CHECKS PASSED, exit 0 |
| `npm test` | 1271 tests, 1268 pass, **2 fail**, 134.7 s — exactly the two named (`shell/main.cjs` ELECTRON_RUN_AS_NODE guard; `shell-port-scan-contract #7`). `git status --porcelain shell/` = 0 lines, so neither is B5's. |
| naming / suite-discovery / renderer-payload guards | exit 0; 97/97 suites reached, dist carries 0 operator files |
| `asar.listPackage(release/win-unpacked/resources/app.asar)` | `\dist\data\{fleet,agents,ops,ledger,metrics,coordinator,research}.json` are inside the read-only archive — the guide's central claim is grounded |
| fences | `shell/`, `src/views/agent.js`, `tools/packaged-qa-suite.mjs`, `shell/renderer-prefs.cjs`, `build/`, `src/views/setup.js` all unmodified; no shared-file edits |

## Absence cases driven by use (my own probes, staged copies, sterile profiles)

Scratch probes rebuilt the packaged app with the projection layer broken and
walked the ring by clicking:

* **every `dist/data/*.json` deleted (404)** — home 2 doors; fleet graph, comms,
  research, ledger each render the full explanation + `What this copy needs`;
  metrics the door. 14.4 s.
* **`reason: null` on every refusing projection** (the schema permits null) — the
  in-browser validator rejects it and substitutes a non-empty diagnostic string,
  so every screen still explains and still offers the door. 18.6 s.

Both fail **closed**. No absence path found where a screen loses its door.

## Defects found in the new work

1. **The guide is state-blind and asserts state anyway.** Drove the app, turned
   ON `Coordinator replies` in Settings → Write (checkbox `before=false`,
   `after=true`), then pressed the `What this copy needs` door that same page
   offers. The guide still says *"sending replies is switched off"* and still
   instructs *Turn on "Coordinator replies"*, tagged **You can do this now**.
   `src/views/guide.js` reads nothing and subscribes to nothing; the Settings
   section note renders unconditionally, so a configured reader is routed to a
   page that misdescribes their machine. Same mechanism applies to the Codex
   section on a machine that has Codex.
2. **`hostAbsentMarkup`'s `alongside` clause is coupled to the reason.** With
   `reason` `''`, `'   '`, `null`, `undefined` or a number, the safety clause
   *"These are the agents this copy declares, not agents observed running."* is
   dropped with the quoted line while body and door survive — the exact
   confusion `tools/agent-route-reachability.mjs` exists to prevent. The module
   header promises absence "removes only the quoted line"; that is false for
   `alongside`. `tools/test/first-run-needs.test.mjs` misses it: the absence loop
   passes no `alongside`, and the alongside test passes a present reason.
   Low reachability today (the one caller passes a validated non-empty string).

## Not reproduced / untested

* The `7/18` before-baseline: cannot be re-measured without reverting the change.
* `showProjectionUnavailable()`'s empty central panel (the branch carrying
  `panelHostAbsent`) is never reached on a sterile profile — the baseline
  declared org puts the notice in the rail instead. Neither driver exercises it.
* One-in-six setup flake reported by the builder: 5/5 setup walks completed here.
