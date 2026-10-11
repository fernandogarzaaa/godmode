// Real ADAM client: spawns the vendored adam-mcp binary (win-x64 prebuilt, cargo
// fallback via verify-adam) and drives it over line-delimited JSON-RPC stdio.
// Fallback: returns {_adam: "unavailable", ...} instead of crashing — never a silent stub.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readSync, closeSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
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
  const d = resolve(process.env.GODMODE_DATA_DIR || join(process.cwd(), ".godmode"));
  mkdirSync(d, { recursive: true });
  return d;
}

// Persistent adam-mcp sessions: one child per binary, shared across calls in
// this process. Spawning per call made propose -> accept impossible (ADAM
// keeps proposals in process memory, so accept always answered "not found").
const sessions = new Map();

function pump(s) {
  let idx;
  while ((idx = s.buf.indexOf("\n")) >= 0) {
    const line = s.buf.slice(0, idx).trim();
    s.buf = s.buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const w = s.waiters.get(msg.id);
    if (w) { s.waiters.delete(msg.id); w(msg); }
  }
}

function getSession(bin) {
  const d = dataDir();
  const key = `${bin}${d}`;
  let s = sessions.get(key);
  if (s && !s.dead) return s;
  const child = spawn(bin, [], {
    stdio: ["pipe", "pipe", "inherit"],
    env: {
      ...process.env,
      ADAM_MEMORY_PATH: join(d, "adam_memory.db"),
      ADAM_GENOME_PATH: join(d, "adam_genome.json"),
      ADAM_DATA_DIR: d,
    },
  });
  s = { child, bin, key, dead: false, nextId: 1, buf: "", waiters: new Map(), lock: Promise.resolve(), initPromise: null };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (c) => { s.buf += c; pump(s); });
  const die = () => {
    s.dead = true;
    if (sessions.get(key) === s) sessions.delete(key);
    for (const w of s.waiters.values()) { try { w({ _writeError: true }); } catch { /* ignore */ } }
    s.waiters.clear();
  };
  child.on("exit", die);
  child.on("error", die);
  child.stdin.on("error", die);
  sessions.set(key, s);
  return s;
}

function rpc(s, method, params, timeoutMs) {
  return new Promise((resolve) => {
    const id = s.nextId++;
    const timer = setTimeout(() => { s.waiters.delete(id); resolve({ _timeout: true }); }, timeoutMs);
    s.waiters.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    try {
      s.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    } catch {
      clearTimeout(timer);
      s.waiters.delete(id);
      resolve({ _writeError: true });
    }
  });
}

async function ensureInit(s) {
  if (!s.initPromise) {
    s.initPromise = (async () => {
      const msg = await rpc(s, "initialize", {
        protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "godmode", version: "1.0.0" },
      }, 30000);
      if (!msg || msg._timeout || msg._writeError || msg.error) {
        s.dead = true;
        if (sessions.get(s.key) === s) sessions.delete(s.key);
        throw new Error("adam initialize failed");
      }
    })();
  }
  await s.initPromise;
}

function call(bin, tool, args, timeoutMs = 60000) {
  const s = getSession(bin);
  // Serialize calls per session: adam-mcp is single-threaded stdio, and
  // proposals live in process memory, so one shared child is what makes
  // propose -> accept work across tool calls in this process.
  const run = s.lock.then(async () => {
    try { await ensureInit(s); }
    catch { return { _adam: "spawn-error", tool }; }
    const msg = await rpc(s, "tools/call", { name: tool, arguments: args }, timeoutMs);
    if (msg._timeout) return { _adam: "timeout", tool };
    if (msg._writeError || s.dead) return { _adam: "spawn-error", tool };
    // MCP reports tool failures as result.isError, not as a JSON-RPC error:
    // surfacing them as {_adam:"ok"} would be a fake success.
    const isErr = msg.result?.isError === true;
    const text = Array.isArray(msg.result?.content)
      ? msg.result.content.map((c) => c?.text ?? "").join("\n")
      : "";
    return (msg.error || isErr)
      ? { _adam: "rpc-error", tool, error: msg.error ? String(msg.error.message ?? JSON.stringify(msg.error)).slice(0, 300) : text.slice(0, 300) || "adam tool reported isError" }
      : { _adam: "ok", tool, result: msg.result?.content ?? msg.result?.result ?? msg };
  });
  s.lock = run.catch(() => {}); // keep the chain alive for the next caller
  return run;
}

export async function adamShutdown() {
  for (const s of sessions.values()) {
    s.dead = true;
    try { s.child.kill(); } catch { /* ignore */ }
  }
  sessions.clear();
}

export async function adamCall(tool, args = {}, organismId = "default") {
  const st = adamBinaryStatus();
  const bin = st.bin;
  if (!bin) return { _adam: "unavailable", tool, error: "adam_unavailable", detail: st.detail, hint: "build for this CPU: cd vendors/adam && CARGO_TARGET_DIR=/tmp/adam-target cargo build --release -p adam-mcp, then set GODMODE_ADAM_BIN=/tmp/adam-target/release/adam-mcp (or run `node scripts/fetch-adam.mjs` where a release asset exists)" };
  return await call(bin, tool, { ...args, organism_id: organismId }, 60000);
}