# GodMode deep audit & reality check — 2026-09-18

Method: every claim below was re-verified live on `main@bb67979` (tests, smoke,
doctor, license gate, HTTP/stdio MCP, console, EVE oracle run against our own
server, fresh `git ls-remote` drift check, blob-size audit, secret scan).
Nothing in this doc is asserted from memory.

## 1. What the project is (verified)

- **One standalone repo** (`fernandogarzaaa/godmode`) vendoring all 5 engines at
  pinned SHAs (`vendors/manifest.yaml` + `vendor-report.json`): genesis, EVE,
  ADAM (Rust), Skein (Python), EVE-MIRO (Python, incl. AGPL `mirofish/`).
- **15 MCP tools** (`server ↔ schemas/godmode-map.yaml` parity verified 15/15
  both directions): status, remember/recall (real ADAM stdio), beliefs, genome,
  validate_experience, mcp_eval, audit_claim (ledger-backed), compare,
  orchestrate, world_simulate, evolve (MRTR confirm), report, task_start/get.
- **Transports**: stdio JSON-RPC + Streamable-ish HTTP (`/discover`, `/tools`,
  `/call`, `/tasks/get`, `/initialize`, `/ping`, `/.well-known/...`), plus a
  **console** (`godmode` → auto-port page: Live Trace, Tasks, Ledger, CLI pane).
- **Protocol**: declares MCP `2026-07-28`, stateless + handles, Tasks-extension
  shape for long runs, MRTR confirm on destructive evolve, honest annotations.
- **CI/CD that runs itself**: `ci` (Node 20+22 matrix, doctor/smoke/tests/license/
  adam-handshake), `adam-binaries` (win/linux/mac + Release), `auto-update`
  (cron + dispatch + manual → re-vendor → rebuild → verify → **one batched PR,
  human merge**). The bot already opened real sync PRs (#2 merged, #6 open).

## 2. PR #6 review verdict: merge with one deletion

Reviewed the full diff (22 files, +1667/−26, CI green, `mergeable_state: clean`).
Content is faithful upstream churn (notify files, bin-mode flips, lockfile
metadata, eve-miro star-history automation). Two flags:

1. **`vendors/adam/target/release/adam-mcp` (40 MB linux binary) appeared with no
   clear provenance.** Nothing in `ci`/`auto-update` builds *release* on ubuntu
   (CI builds debug; `adam-binaries` uploads artifacts without committing).
   Design says win-x64 ships in-repo, other platforms via Release/fetch/CI-build.
   **Recommendation: delete that file from the PR branch before merge** (one
   `git rm`), keep the win `.exe`. Otherwise the repo gains ~40 MB per platform
   per sync with no provenance trail.
2. **Star-history bloat**: `mirofish/.github/star-history/` (+874-line JSON,
   500-line workflow) is upstream vanity data, faithfully vendored. Harmless but
   it grows every upstream sync. Consider excluding `mirofish/.github` +
   `static/image` from `VENDOR_JOBS.keep` (saves ~5 MB + churn).

## 3. Claim-by-claim reality check

| Claim | Verdict |
|---|---|
| "Standalone, no 5-repo clone" | **Mostly true, one hole**: `install.sh/ps1` run only root `npm install`. `audit_claim` *always* passes `--ledger`, and `dist/ledger/ledger.js:18` top-level-imports `better-sqlite3`; eve mock path needs `pngjs`. Neither ships in `node_modules` (gitignored) nor gets installed → **fresh-clone audit/validate crash**. Fix: install step must run `npm ci` in `vendors/genesis` + `vendors/eve` (or lazy-load the ledger import). |
| "CI green = works" | **Presence, not execution, for the Node engines.** `doctor`/`smoke` check file existence; no CI step *runs* genesis or eve (the updater rebuilds dists but also never executes them). A bot PR could ship a broken dist green. Fix: add `eve run mock:` + `genesis suites` execution to `ci`/`auto-update` verify (seconds each, proven locally). |
| Tool map ↔ server | **Fixed today**: map had unparseable YAML (`memory://{kind}/{id}` unquoted) and has now been repaired; parity re-verified 15/15. Lesson: map needs a CI parse+parity check (one-liner in `ci`). |
| Console tabs | Trace/Tasks/Ledger/CLI are live. **Graph/Experience/Mods are static copy** ("Use CLI below"). Honest but incomplete vs docs. |
| `godmode_compare`, `world_simulate` | **Stubs returning notes**, not executions. Labeled in map; acceptable if documented as P2, misleading otherwise. |
| Long outputs | **Silently truncated at 4000 chars** (`server.js:86`). Audit verdicts survive (key fields first), but full reports don't. Return a resource handle or raise the cap with pagination. |
| `npm pack` publishing | **`npm pack --dry-run` crashes npm itself** on this tree (hangs, "Exit handler never called"). npm distribution is currently not viable; git-clone + `install.sh` is the only proven path. |
| Secrets | Clean scan of godmode-owned code. Risk is **secret sprawl, not leakage**: one PAT lives in 6 repos (`GODMODE_SYNC_TOKEN` ×5 sources + godmode). Rotation = 6 edits. Fine-grained PAT scoped per-repo would contain blast radius. |
| Licenses | Gate green: AGPL confined to `mirofish/`. New edge: upstream added MIT `THIRD_PARTY_NOTICES.md` + star-history files inside mirofish — still compatible, but the gate only watches AGPL text; a future license *loosening* (AGPL→proprietary file) wouldn't trip it. |
| Protocol compat | **New gap found today by our own oracle**: stdio had no `initialize`/`ping` and success-enveloped unknown tools → fixed (serverInfo+capabilities, `ping`, `-32602`/`-32601`). Remaining: vendored EVE's client hard-rejects our `2026-07-28` version string (`Server's protocol version is not supported`). Keeping the honest version is correct; the fix belongs to upgrading the vendored EVE SDK, not forking it. 2025-era strict third-party clients will hit the same wall — document it. |

## 4. Risks, ranked

1. **Repo-size creep.** 12 MB exe + ~5 MB mirofish images today; +40 MB unexplained linux binary pending in #6; dist/ + star-history JSON grow per sync. Without exclusions this becomes a 500 MB repo in a year. Fix now: drop the linux binary, exclude image/test-data globs from keep-lists, consider Git LFS or Release-attached binaries for non-win platforms.
2. **Silent downgrades.** The updater faithfully vendored genesis `0.3.0 → 0.2.0` plus deleted benchmarks/examples with no flag. Add a semver/change guard: bot PR body should call out version direction and deleted paths (data is in the diff; surface it).
3. **Bot-PR review burden.** Every upstream notify-file/star-data churn opens a human-blocking PR. Add `[skip bot]` paths (e.g. `**/star-history/**`, lockfile-only `hasInstallScript` noise) or batch window.
4. **Windows-dev / Linux-CI skew.** CRLF regex, PS quoting, `better-sqlite3` prebuild luck, Playwright browser absence — all found the Windows way. CI is the equalizer; keep the execution-step fix from §3.
5. **Bus factor 1 + PAT sprawl.** Documented above; low urgency, real impact.
6. **Upstream API drift.** `eve` bin paths just changed (`bin/eve.js` → `./bin/eve.js`); our dispatch uses file-existence checks, which survived — keep that pattern (existence > hardcoded paths).

## 5. Future roadmap (ordered slices)

1. **Install correctness** (P0): vendor-deps install step + `doctor` asserting `better-sqlite3`/`pngjs` load; CI executes eve-mock + genesis-suites.
2. **Bot PR hygiene** (P0): drop linux binary from #6; exclusion globs; semver/downgrade callouts in PR body.
3. **Console completion** (P1): live Graph (skein canvas Subscribe), Experience embed (report://), Mods toggle.
4. **`compare` + `world_simulate` execution** (P1); output pagination (P2).
5. **Vendored EVE SDK upgrade** for 2026-07-28 interop (upstream-dependent; track, don't fork).
6. **Release flow**: tag → `adam-binaries` publishes → `fetch-adam` installs; npm path only after `npm pack` is fixed.
7. **Multi-client dogfood**: drive GodMode from Claude/Codex/Cursor via the universal manifests and log the friction — the next audit after this one.

## 6. Bottom line

The project is what it claims to be, with two honest holes (fresh-install vendor deps; CI executes too little) and one process win already working (the bot). Nothing here requires re-architecture — it requires the six small fixes above, in order. After slices 1–2, I'd call this production-credible; after 3–4, production-complete.
