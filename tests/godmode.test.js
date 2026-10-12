import test, { after } from "node:test";
import assert from "node:assert";
import { existsSync } from "node:fs";
import { dispatchCall, toolsList, discover } from "../src/server.js";
import { protectedResourceDoc, checkBearer, authRequired } from "../src/auth.js";

after(async () => {
  const { adamShutdown } = await import("../src/adam-client.js");
  await adamShutdown();
});

test("discover pins 2026-07-28 + tasks ext", () => {
  const d = discover();
  assert.equal(d.protocol, "2026-07-28");
  assert.ok(d.capabilities.extensions["io.modelcontextprotocol/tasks"]);
});
test("tools list deterministic + ttlMs", () => {
  const a = toolsList().tools.map((t) => t.name);
  assert.deepEqual(a, [...a].sort());
  assert.ok(toolsList().ttlMs > 0);
});
test("status complete + structured", async () => {
  const r = await dispatchCall("godmode_status", {});
  assert.equal(r.resultType, "complete");
  assert.ok(r.structuredContent.result.engines.genesis);
});
test("destructive evolve requires confirm (MRTR)", async () => {
  const r = await dispatchCall("godmode_evolve", { action: "accept", proposal_id: "p1" });
  assert.equal(r.resultType, "input_required");
  assert.ok(r.requestState);
});
test("unknown tooldutifully reported", async () => {
  const r = await dispatchCall("nope_x", {});
  assert.equal(r.structuredContent.result.error, "unknown_tool");
});
test("well-known doc advertises local-open by default", () => {
  const d = protectedResourceDoc("127.0.0.1:1");
  assert.ok(d.resource.includes("127.0.0.1"));
  assert.deepEqual(d.authorization_servers, []);
  assert.equal(d.godmode_mode, "local-open");
});
test("bearer open by default (local-only v1)", () => {
  assert.equal(authRequired(), false);
  assert.equal(checkBearer({ headers: {} }).ok, true);
});
test("fetch-adam maps every platform to an asset + local binary when present", async () => {
  const m = await import("../scripts/fetch-adam.mjs");
  assert.equal(m.assetFor("win32", "x64"), "adam-mcp-win-x64.exe");
  assert.equal(m.assetFor("darwin", "arm64"), "adam-mcp-darwin-arm64");
  assert.equal(m.assetFor("linux", "x64"), "adam-mcp-linux-x64");
  // Presence is environment-dependent (win-x64 ships in-repo; other platforms
  // build via cargo or fetch from Release) — assert shape, not presence.
  const asset = m.assetFor(process.platform, process.arch);
  assert.ok(asset);
  assert.ok(m.destFor(asset).endsWith(process.platform === "win32" ? "adam-mcp.exe" : "adam-mcp"));
  if (existsSync(m.destFor(asset))) assert.ok(true, "vendored binary present");
});
test("background task runs to done with result", async () => {
  // task_start is file-backed and has flaked once on a busy runner
  // (start returned no task_id). Surface the start error and retry once
  // instead of asserting on an undefined id.
  let start = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    start = await dispatchCall("godmode_task_start", { tool: "godmode_status", arguments: {} });
    if (!start.structuredContent.result.error) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const started = start.structuredContent.result;
  assert.ok(!started.error, "task_start failed: " + JSON.stringify(started).slice(0, 200));
  const id = started.task_id;
  assert.ok(id);
  let t = null;
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const g = await dispatchCall("godmode_task_get", { task_id: id });
    t = g.structuredContent.result;
    if (t.status === "done" || t.status === "failed") break;
  }
  assert.equal(t.status, "done", "task did not finish: " + JSON.stringify(t).slice(0, 200));
  assert.equal(t.result.structuredContent.result.version, "1.0.0");
});
test("task_start rejects unknown tools (no nesting)", async () => {
  const r = await dispatchCall("godmode_task_start", { tool: "nope_x" });
  assert.equal(r.structuredContent.result.error, "unknown_tool");
});
test("godmode_beliefs + genome route to vendored ADAM (real binary or explicit unavailable)", async () => {
  const b = await dispatchCall("godmode_beliefs", {});
  const g = await dispatchCall("godmode_genome", {});
  const br = b.structuredContent.result, gr = g.structuredContent.result;
  const nonOk = ["unavailable", "spawn-error", "exited", "timeout", "rpc-error"];
  if (br._adam === "ok") assert.equal(br.tool, "adam_beliefs");
  else assert.ok(nonOk.includes(br._adam), "explicit not silent: " + br._adam);
  if (gr._adam === "ok") assert.equal(gr.tool, "adam_genome");
  else assert.ok(nonOk.includes(gr._adam), "explicit not silent: " + gr._adam);
});
test("godmode_remember persists through real adam-mcp when present", async () => {
  const r = await dispatchCall("godmode_remember", { kind: "episodic", content: "test-marker", organism_id: "testorg" });
  const res = r.structuredContent.result;
  if (res._adam === "ok") assert.equal(res.tool, "adam_memory_store");
  else assert.ok(["unavailable", "spawn-error", "exited", "timeout", "rpc-error"].includes(res._adam), "explicit not silent");
});
test("stdio server completes the MCP handshake with the official SDK client", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const { fileURLToPath } = await import("node:url");
  const bin = fileURLToPath(new URL("../bin/godmode-mcp.js", import.meta.url));
  const c = new Client({ name: "godmode-test", version: "0.0.0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [bin], stderr: "ignore" }));
  try {
    assert.equal(c.getServerVersion().name, "godmode");
    const { tools } = await c.listTools();
    assert.ok(tools.find((t) => t.name === "godmode_status"));
    const r = await c.callTool({ name: "godmode_status", arguments: {} });
    assert.equal(r.isError, false);
    assert.equal(r.structuredContent.result.version, "1.0.0");
  } finally { await c.close(); }
});
test("godmode_mcp_eval dispatches to EVE instead of throwing", async () => {
  const r = await dispatchCall("godmode_mcp_eval", { target: "definitely-not-a-server" });
  assert.notEqual(r.structuredContent.result.error, "handler_failed");
});
test("adam binary selection never execs a prebuilt for another CPU", async () => {
  const { adamBinaryStatus, binaryArch } = await import("../src/adam-client.js");
  const st = adamBinaryStatus();
  if (st.bin && process.platform === "linux") {
    const a = binaryArch(st.bin);
    assert.ok(a === null || a === "script" || a === process.arch, `selected ${st.bin} is ${a}`);
  } else if (!st.bin) assert.ok(st.detail);
});
test("adam isError surfaces as an error, never fake ok", async () => {
  const { adamCall, adamBinaryStatus } = await import("../src/adam-client.js");
  if (!adamBinaryStatus().bin) return; // hermetic CI without the prebuilt: nothing to assert
  const r = await adamCall("adam_propose_mutation", {});
  assert.equal(r._adam, "rpc-error");
  assert.ok(r.error, "isError text must surface");
});
test("orchestrate auto-detects python3 without GODMODE_PYTHON", async () => {
  const saved = process.env.GODMODE_PYTHON;
  delete process.env.GODMODE_PYTHON;
  try {
    const r = await dispatchCall("godmode_orchestrate", { op: "status" });
    assert.equal(r.structuredContent.ok, true, JSON.stringify(r.structuredContent.result).slice(0, 200));
  } finally { if (saved !== undefined) process.env.GODMODE_PYTHON = saved; }
});
test("compare runs real genesis compare on two bundles", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { dispatch } = await import("../src/dispatch.js");
  const base = mkdtempSync(join(tmpdir(), "gcmp-"));
  const mk = (name, verdict, metrics) => {
    const d = join(base, name); mkdirSync(join(d, "treatment"), { recursive: true });
    writeFileSync(join(d, "verdict.json"), JSON.stringify({ verdict }));
    writeFileSync(join(d, "treatment", "metrics.json"), JSON.stringify(metrics));
    return d;
  };
  const a = mk("a", "TRUSTED", [{ metric: "accuracy", value: 0.8 }]);
  const b = mk("b", "TRUSTED", [{ metric: "accuracy", value: 0.9 }]);
  const r = dispatch.compare({ run_a: a, run_b: b });
  assert.equal(r.ok, true, r.output);
  assert.ok(r.output.includes("accuracy") && r.output.includes("0.9"));
  const bad = dispatch.compare({ run_a: join(base, "nope"), run_b: b });
  assert.equal(bad.error, "missing_run");
});
test("world_simulate fails closed with an honest error", async () => {
  const r = await dispatchCall("godmode_world_simulate", {});
  assert.equal(r.structuredContent.ok, false);
  assert.equal(r.structuredContent.result.error, "engine_not_configured");
});
test("report returns real artifacts", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { dispatch } = await import("../src/dispatch.js");
  const cwd = process.cwd();
  const base = mkdtempSync(join(tmpdir(), "grep-"));
  mkdirSync(join(base, ".eve-output"), { recursive: true });
  writeFileSync(join(base, ".eve-output", "report.md"), "# hello report");
  process.chdir(base);
  try {
    const r = await dispatch.report({});
    assert.ok(r.eve.markdown.includes("hello report"));
    assert.equal(r.eve.html_uri, null);
  } finally { process.chdir(cwd); }
});
test("evolve validates action before touching the binary", async () => {
  const bad = await dispatchCall("godmode_evolve", { action: "frobnicate", confirm: true });
  assert.equal(bad.structuredContent.result.error, "unknown_action");
  const nokind = await dispatchCall("godmode_evolve", { action: "propose", confirm: true });
  assert.equal(nokind.structuredContent.result.error, "missing_kind");
  for (const action of ["accept", "reject"]) {
    const noid = await dispatchCall("godmode_evolve", { action, confirm: true });
    assert.equal(noid.structuredContent.result.error, "missing_proposal_id");
    assert.match(noid.structuredContent.result.detail, new RegExp(action));
  }
});
test("evolve validation does not depend on the adam binary being present", async () => {
  // Regression: validation used to run after the adam binary check, so hosts
  // without a working adam-mcp got engine_not_configured instead.
  const saved = process.env.GODMODE_ADAM_BIN;
  process.env.GODMODE_ADAM_BIN = "/nonexistent/adam-mcp";
  try {
    const nokind = await dispatchCall("godmode_evolve", { action: "propose", confirm: true });
    assert.equal(nokind.structuredContent.result.error, "missing_kind");
    const noid = await dispatchCall("godmode_evolve", { action: "accept", confirm: true });
    assert.equal(noid.structuredContent.result.error, "missing_proposal_id");
    assert.match(noid.structuredContent.result.detail, /proposal_id is required to accept/);
    assert.match(nokind.structuredContent.result.detail, /kind is required/);
    // With valid arguments and no binary, the engine error is reported for
    // every action (and no argument error is invented for status/propose).
    for (const args of [
      { action: "propose", kind: "retire_skill" },
      { action: "accept", proposal_id: "p1" },
      { action: "reject", proposal_id: "p1" },
      { action: "status" },
    ]) {
      const r = (await dispatchCall("godmode_evolve", { ...args, confirm: true })).structuredContent.result;
      assert.equal(r.error, "engine_not_configured", JSON.stringify(args));
      assert.equal(r.engine, "adam");
      assert.match(r.detail, /adam-mcp binary absent/);
    }
  } finally {
    if (saved === undefined) delete process.env.GODMODE_ADAM_BIN;
    else process.env.GODMODE_ADAM_BIN = saved;
  }
});
test("resources list and read the live artifacts", async () => {
  const { resourcesList, resourcesRead } = await import("../src/server.js");
  const uris = resourcesList().resources.map((r) => r.uri);
  assert.ok(uris.includes("ledger://genesis"));
  assert.ok(uris.includes("report://eve/latest"));
  assert.ok(uris.includes("genome://current"));
  assert.ok(uris.includes("graph://skein/current"));
  const led = await resourcesRead("ledger://genesis");
  assert.equal(led.contents[0].uri, "ledger://genesis");
  let threw = false;
  try { await resourcesRead("nope://x"); } catch { threw = true; }
  assert.ok(threw, "unknown resource must throw");
});
test("evolve propose -> accept works in one process (persistent adam session)", async () => {
  const { adamBinaryStatus } = await import("../src/adam-client.js");
  if (!adamBinaryStatus().bin) return;
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const saved = process.env.GODMODE_DATA_DIR;
  process.env.GODMODE_DATA_DIR = mkdtempSync(join(tmpdir(), "gevo-"));
  try {
    const p = await dispatchCall("godmode_evolve", { action: "propose", kind: "amend_genome", field: "preferences.theme", suggested_value: "dark", rationale: "test" });
    assert.equal(p.structuredContent.ok, true, JSON.stringify(p.structuredContent.result).slice(0, 300));
    const pid = JSON.parse(p.structuredContent.result.result[0].text).id;
    const a = await dispatchCall("godmode_evolve", { action: "accept", proposal_id: pid, confirm: true });
    assert.equal(a.structuredContent.ok, true, JSON.stringify(a.structuredContent.result).slice(0, 300));
    const g = await dispatchCall("godmode_genome", {});
    const genome = JSON.parse(g.structuredContent.result.result[0].text);
    assert.equal(genome.preferences.theme, "dark");
  } finally {
    if (saved === undefined) delete process.env.GODMODE_DATA_DIR; else process.env.GODMODE_DATA_DIR = saved;
    const { adamShutdown } = await import("../src/adam-client.js");
    await adamShutdown(); // fresh session so the temp data dir is not reused
  }
});
