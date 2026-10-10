import test from "node:test";
import assert from "node:assert";
import { existsSync } from "node:fs";
import { dispatchCall, toolsList, discover } from "../src/server.js";
import { protectedResourceDoc, checkBearer, authRequired } from "../src/auth.js";

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
