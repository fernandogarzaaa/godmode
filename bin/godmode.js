#!/usr/bin/env node
// godmode: terminal CLI that opens the browser console (CLI + observability).
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startConsole } from "../src/console.js";
import { dispatchCall } from "../src/server.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, ...rest] = process.argv.slice(2);
const USAGE = "usage: godmode [serve --no-open | run <tool> [jsonArgs] [--yes] | doctor | mods | trace]";

function usageError(msg) {
  if (msg) console.error("godmode: " + msg);
  console.error(USAGE);
  process.exit(2);
}

function openBrowser(url) {
  const p = process.platform;
  try {
    if (p === "win32") execSync(`start "" "${url}"`, { shell: true });
    else if (p === "darwin") execSync(`open "${url}"`);
    else execSync(`xdg-open "${url}"`);
  } catch { console.log("Open manually: " + url); }
}

if (!cmd) {
  const { port } = await startConsole({ port: 0 });
  const url = `http://127.0.0.1:${port}/`;
  console.log(`GodMode console: ${url}`);
  console.log(`MCP: stdio via 'godmode-mcp' | http via 'godmode-mcp --http 8787'`);
  openBrowser(url);
  setInterval(() => {}, 1 << 30);
} else if (cmd === "serve") {
  const noOpen = rest.includes("--no-open");
  const { port } = await startConsole({ port: 0 });
  const url = `http://127.0.0.1:${port}/`;
  console.log(url);
  if (!noOpen) openBrowser(url);
  setInterval(() => {}, 1 << 30);
} else if (cmd === "run") {
  const tool = rest[0] ?? "godmode_status";
  let args = {};
  // Accept JSON ('{...}') or robust key=value pairs (PowerShell-safe: no inner double quotes needed).
  // Accept JSON ('{...}', bash/cmd) or key=value tokens (PowerShell-safe).
  // Each argv token is parsed individually so quoted multi-word values survive intact.
  const toks = rest.slice(1).filter((t) => t !== "--yes");
  if (tool.startsWith("-")) usageError(`expected a tool name after 'run', got '${tool}'`);
  if (toks.length === 1 && toks[0].trim().startsWith("{")) {
    // Bad JSON used to be replaced by {} silently, running the tool with no args.
    try { args = JSON.parse(toks[0]); } catch (e) { usageError(`invalid JSON args: ${e.message}`); }
    if (args === null || typeof args !== "object" || Array.isArray(args)) usageError("JSON args must be an object");
  } else if (toks.length) {
    let cur = null;
    for (const t of toks) {
      if (t === "--yes") continue;
      const eq = t.indexOf("=");
      if (eq > 0 && /^[A-Za-z_]\w*$/.test(t.slice(0, eq))) {
        cur = t.slice(0, eq);
        args[cur] = t.slice(eq + 1);
      } else if (cur) {
        args[cur] += " " + t;
      } else {
        usageError(`unexpected argument '${t}' (pass a JSON object or key=value pairs)`);
      }
    }
    for (const k of Object.keys(args)) {
      const v = args[k];
      if (/^-?\d+$/.test(v)) args[k] = Number(v);
      else if (v === "true") args[k] = true;
      else if (v === "false") args[k] = false;
    }
  }
  const out = await dispatchCall(tool, args, { headlessBypass: rest.includes("--yes") });
  console.log(JSON.stringify(out, null, 2));
  const { adamShutdown } = await import("../src/adam-client.js");
  await adamShutdown();
  // Scripts/CI need a failing exit code for unknown tools, tool errors, and
  // calls that still need confirmation (input_required) — previously always 0.
  if (out?.resultType !== "complete" || out?.structuredContent?.ok === false) process.exitCode = 1;
} else if (cmd === "doctor") {
  const checks = [
    ["node>=22", Number(process.versions.node.split(".")[0]) >= 22],
    ["vendors/genesis", existsSync(join(root, "vendors/genesis/src/cli"))],
    ["vendors/eve", existsSync(join(root, "vendors/eve/src/cli"))],
    ["vendors/adam", existsSync(join(root, "vendors/adam/crates"))],
    ["vendors/skein", existsSync(join(root, "vendors/skein/src/skein/cli.py"))],
    ["vendors/eve-miro", existsSync(join(root, "vendors/eve-miro/src/eve_miro"))],
    ["mirofish[AGPL]", existsSync(join(root, "vendors/eve-miro/mirofish")) || existsSync(join(root, "vendors/eve-miro/mirofish.EXCLUDED"))],
    ["console.html", existsSync(join(root, "console/console.html"))],
  ];
  let fail = 0;
  for (const [n, ok] of checks) { console.log((ok ? "ok  " : "FAIL") + "  " + n); if (!ok) fail++; }
  // Optional engines: report, don't fail the install.
  const { adamBinaryStatus } = await import("../src/adam-client.js");
  const a = adamBinaryStatus();
  console.log((a.bin ? "ok  " : "warn") + "  adam-mcp for " + process.platform + "-" + process.arch + (a.bin ? "" : " — " + a.detail + " (memory/beliefs/genome tools unavailable)"));
  for (const dep of ["pngjs", "better-sqlite3"]) {
    let ok = true; try { await import(dep); } catch { ok = false; }
    console.log((ok ? "ok  " : "warn") + "  " + dep + (ok ? "" : dep === "pngjs" ? " — EVE runs will fail; npm install" : " — Genesis ledger disabled; npm install better-sqlite3"));
  }
  process.exit(fail ? 1 : 0);
} else if (cmd === "mods") {
  console.log("mods: mods/policy-gates (enabled) — see godmode.config.yaml; toggle via mods/<name>/mod.json {enabled}");
} else if (cmd === "trace") {
  const out = await dispatchCall("godmode_status", {});
  console.log(JSON.stringify(out.structuredContent.result.engines, null, 2));
  console.log("trace: .godmode/trace.ndjson (GET /api/trace?since=N in console)");
} else if (cmd === "help" || cmd === "--help" || cmd === "-h") {
  console.log(USAGE);
} else {
  usageError(`unknown command '${cmd}'`);
}
