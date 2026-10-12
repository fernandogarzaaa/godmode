# GodMode

Standalone universal plugin + MCP product engine: **Genesis** (evaluation & assurance) + **EVE** (experience validation) + **ADAM** (cognitive substrate) + **Skein** (task-graph orchestration) + **EVE-MIRO** (reality-grounded simulation). Users install **only godmode** — the 5 repos ship vendored inside (`vendors/`, pinned in `vendors/manifest.yaml`).

## Install

```bash
git clone https://github.com/fernandogarzaaa/godmode.git
cd godmode
npm install
npm install --no-save better-sqlite3   # optional, but required for the hash-chained audit ledger
node bin/godmode.js doctor             # all vendored engines present?
node bin/godmode.js serve --no-open    # browser console (CLI + Live Trace) on 127.0.0.1 auto-port
```

One-liner: `curl -fsSL https://raw.githubusercontent.com/fernandogarzaaa/godmode/main/install.sh | bash`
(Windows: `install.ps1`). The npm package `@fernandogarzaaa/godmode` is not published yet, so
`npm i -g @fernandogarzaaa/godmode` does not work; install from the clone and put `bin/` on your
PATH if you want bare `godmode` / `godmode-mcp` commands.

`doctor` also reports optional engines:
the committed `adam-mcp` prebuilts are linux-x64 and win-x64 only, so on other CPUs (e.g. linux-arm64,
Apple Silicon) the memory/beliefs/genome tools return `adam_unavailable` until you build ADAM:
`cd vendors/adam && CARGO_TARGET_DIR=/tmp/adam-target cargo build --release -p adam-mcp` and set
`GODMODE_ADAM_BIN=/tmp/adam-target/release/adam-mcp`.

**Prebuilt ADAM binaries.** `vendors/adam/target/release/adam-mcp` (linux-x64) and `adam-mcp.exe`
(win-x64), about 70 MB together, are committed to git today. They are not yet published as GitHub
release assets, so `node scripts/fetch-adam.mjs` (which downloads from a godmode release) has nothing
to fetch until a release with those assets exists. Moving them out of git (release assets with
sha256 verification, or Git LFS) is planned; until then they are marked binary in `.gitattributes`.

MCP clients (Claude/Codex/OpenCode/Cursor/VSCode): point at `bin/godmode-mcp.js` (stdio) or
`node bin/godmode-mcp.js --http 8787`. Manifests: `.claude-plugin/`, `.codex/skills/godmode/`,
`.opencode/plugin.json`, `mcpServers.json`.

## Use

From the clone, prefix with `node bin/godmode.js` (bare `godmode` works once `bin/` is on your PATH):

```bash
node bin/godmode.js run godmode_status '{}'
node bin/godmode.js run godmode_validate_experience '{"url":"mock:","persona":"curious-explorer","seed":7}'
node bin/godmode.js run godmode_audit_claim suite=code verifier="node ./verifier.mjs {task_file} {completion_file}"
node bin/godmode.js run godmode_orchestrate '{"op":"status"}'
node bin/godmode.js run godmode_compare run_a=./runs/a run_b=./runs/b
node bin/godmode.js run godmode_report '{}'
```

`godmode_audit_claim` needs a verifier command (with `{task_file}` and `{completion_file}`
placeholders) to actually audit; without one it returns `UNTESTED` and lists the suites.
The verifier must print JSON with a numeric `reward` field; genesis adversarially probes it and
returns `SOUND` / `EXPLOITABLE` with false-accept / false-reject rates.

`godmode_compare` diffs two genesis run bundles (directories with `verdict.json` plus
`treatment/metrics.json`).

`godmode_orchestrate` auto-detects python (`GODMODE_PYTHON`, else `python3`, else `python`).

`godmode_evolve` drives the real `adam-mcp`: `action=propose` needs `kind`
(`retire_skill` | `reconcile_belief` | `investigate_conflict` | `amend_genome`);
`action=accept` is destructive and requires `confirm=true` (MRTR elicitation);
`action=reject` drops a proposal; `action=status` derives evolution signals.

`godmode_world_simulate` needs the eve-miro Python environment (3.11 + providers); without it
the tool fails closed with `engine_not_configured` instead of a fake result.

Browser console: Live Trace · Tasks · Task Graph · Experience · Ledger · Mods · CLI pane (same dispatch as `tools/call`).

## Background tasks

Long tools run async via the Tasks shape: `godmode_task_start {tool, arguments}` → `{task_id}`,
poll `godmode_task_get` / `tasks/get` / console Tasks tab. Statuses: running → done|failed,
persisted in `.godmode/tasks.json`.

## Evidence

`godmode_audit_claim` with a verifier writes to the hash-chained ledger at `.godmode/genesis-ledger.db`
(`Ledger: entry <hash>` in the result). No `--ledger` flag needed. The ledger needs the optional
`better-sqlite3` dependency (`npm install --no-save better-sqlite3`); without it the audit fails
with an explicit error instead of silently skipping the ledger. Every tool call is also appended
to `.godmode/ledger.jsonl`. `godmode_report`, `godmode-mcp` resources (`ledger://genesis`,
`report://eve/latest`, `genome://current`, `graph://skein/current`), and the console Ledger tab
all read these real artifacts.

## ADAM first run

The first memory/beliefs call downloads the `all-MiniLM-L6-v2` ONNX embedding model (~23 MB) from
Hugging Face into `./.fastembed_cache` (override with `ADAM_EMBEDDING_CACHE_DIR`). Without network
access those tools fail closed with an explicit error; `godmode_genome` works offline.

## Auth

v1 local-only: HTTP surface open on loopback. Opt-in bearer enforcement:
`GODMODE_REQUIRE_AUTH=1 GODMODE_TOKENS=<csv>`. Discovery per RFC9728:
`GET /.well-known/oauth-protected-resource`. Future IdP: `GODMODE_AUTH_SERVERS='["https://idp.example.com"]'`.

## Mods

`godmode.config.yaml` + `mods/<name>/{mod.json,hooks.js}` (`preCall/postCall`, throw-safe). `mods/policy-gates` confirms destructive evolve/force-release (MRTR elicitation).

## Licenses

MIT except `vendors/eve-miro/mirofish/` (AGPL-3.0) — see `NOTICE.md`. MIT-only: `GODMODE_NO_AGPL=1 node scripts/vendor.mjs`.
