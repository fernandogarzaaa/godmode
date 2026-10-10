// Real ADAM client: spawns the vendored adam-mcp binary (win-x64 prebuilt, cargo
// fallback via verify-adam) and drives it over line-delimited JSON-RPC stdio.
// Fallback: returns {_adam: "unavailable", ...} instead of crashing — never a silent stub.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readSync, closeSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ELF e_machine -> node arch. A prebuilt for another CPU (e.g. the committed
// x86-64 adam-mcp on an arm64 Linux host) must be skipped, not exec'd: spawn()
// falls back to /bin/sh on ENOEXEC and the call dies with a shell syntax error.
const ELF_MACHINE = { 0x3e: "x64", 0xb7: "arm64", 0x03: "ia32", 0x28: "arm" };
export function binaryArch(p) {
  try {
    const fd = openSync(p, "r"); const b = Buffer.alloc(20);
    readSync(fd, b, 0, 20, 0); closeSync(fd);
    if (b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46) return ELF_MACHINE[b.readUInt16LE(18)] ?? "unknown";
    if (b[0] === 0x23 && b[1] === 0x21) return "script"; // #! wrapper
    return null; // PE / Mach-O / other: not checked
  } catch { return null; }
}
export function adamBinaryStatus() {
  if (process.env.GODMODE_ADAM_BIN) {
    const p = process.env.GODMODE_ADAM_BIN;
    return existsSync(p) ? { bin: p, status: "env" } : { bin: null, status: "missing", detail: `GODMODE_ADAM_BIN=${p} does not exist` };
  }
  const exe = process.platform === "win32" ? "adam-mcp.exe" : "adam-mcp";
  const cands = [
    join(root, "vendors", "adam", "target", "release", exe),
    join(root, "vendors", "adam", "target", "debug", exe),
  ];
  const skipped = [];
  for (const p of cands) {
    if (!existsSync(p)) continue;
    const a = binaryArch(p);
    if (process.platform === "linux" && a && a !== "script" && a !== process.arch) { skipped.push(`${p} (${a})`); continue; }
    return { bin: p, status: "ok" };
  }
  // The sh wrapper only helps when it can build: it execs target/release/adam-mcp,
  // which is the wrong-arch prebuilt when we skipped one above.
  if (!skipped.length && process.platform !== "win32") {
    const w = join(root, "vendors", "adam", "bin", "adam-mcp");
    if (existsSync(w)) return { bin: w, status: "wrapper" };
  }
  return {
    bin: null,
    status: skipped.length ? "wrong-arch" : "missing",
    detail: skipped.length ? `prebuilt adam-mcp is for another CPU (host ${process.platform}-${process.arch}): ${skipped.join(", ")}` : "no adam-mcp binary",
  };
}
export function adamBinary() { return adamBinaryStatus().bin; }

function dataDir() {
  const d = process.env.GODMODE_DATA_DIR || join(process.cwd(), ".godmode");
  mkdirSync(d, { recursive: true });
  return d;
}

function call(bin, tool, args, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const child = spawn(bin, [], {
      stdio: ["pipe", "pipe", "inherit"],
      env: {
        ...process.env,
        ADAM_MEMORY_PATH: join(dataDir(), "adam_memory.db"),
        ADAM_GENOME_PATH: join(dataDir(), "adam_genome.json"),
        ADAM_DATA_DIR: dataDir(),
      },
    });
    let buf = "";
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; child.kill(); resolve({ _adam: "timeout", tool }); } }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      buf += c;
      let idx;
      while (!done && (idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result?.capabilities) { send("tools/call", { name: tool, arguments: args }, 2); continue; }
          if (msg.id === 2) {
            done = true;
            clearTimeout(timer);
            child.kill();
            resolve(msg.error
              ? { _adam: "rpc-error", tool, error: msg.error }
              : { _adam: "ok", tool, result: msg.result?.content ?? msg.result?.result ?? msg });
            continue;
          }
        } catch { /* skip non-JSON */ }
      }
    });
    child.on("error", () => { if (!done) { done = true; clearTimeout(timer); resolve({ _adam: "spawn-error", tool }); } });
    child.on("exit", () => { if (!done) { done = true; clearTimeout(timer); resolve({ _adam: "exited", tool }); } });
    function send(method, params, id = 1) {
      try { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); } catch { /* ignore */ }
    }
    send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "godmode", version: "1.0.0" } });
  });
}

export async function adamCall(tool, args = {}, organismId = "default") {
  const st = adamBinaryStatus();
  const bin = st.bin;
  if (!bin) return { _adam: "unavailable", tool, error: "adam_unavailable", detail: st.detail, hint: "build for this CPU: cd vendors/adam && CARGO_TARGET_DIR=/tmp/adam-target cargo build --release -p adam-mcp, then set GODMODE_ADAM_BIN=/tmp/adam-target/release/adam-mcp (or run `node scripts/fetch-adam.mjs` where a release asset exists)" };
  return await call(bin, tool, { ...args, organism_id: organismId }, 60000);
}