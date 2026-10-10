#!/usr/bin/env node
// godmode-mcp: stdio JSON-RPC 2.0 (MCP 2026-07-28 compatible surface) + --http Streamable-ish endpoint.
// Stateless protocol: state travels in handles (organism_id, node, task_id).
import { createServer } from "node:http";
import { dispatchCall, toolsList, discover } from "../src/server.js";
import { taskGet } from "../src/tasks.js";
import { protectedResourceDoc, checkBearer, unauthorized } from "../src/auth.js";

const args = process.argv.slice(2);
if (args.includes("--http")) {
  const port = Number(process.env.GODMODE_PORT || args[args.indexOf("--http") + 1] || 8787);
  const server = createServer(async (req, res) => {
    const host = req.headers.host || `127.0.0.1:${port}`;
    if (req.method === "GET" && req.url === "/.well-known/oauth-protected-resource") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(protectedResourceDoc(host)));
    }
    if (req.method === "GET" && req.url === "/discover") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(discover()));
    }
    if (req.method === "GET" && req.url === "/tools") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(toolsList()));
    }
    if (req.method === "POST" && (req.url === "/call" || req.url === "/tasks/get")) {
      if (!checkBearer(req).ok) return unauthorized(res, host);
      let body = "";
      for await (const c of req) body += c;
      try {
        if (req.url === "/tasks/get") {
          const { task_id } = JSON.parse(body || "{}");
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ resultType: "complete", task: taskGet(task_id) }));
        }
        const { name, arguments: a } = JSON.parse(body || "{}");
        if ((req.headers["mcp-method"] && req.headers["mcp-method"] !== "tools/call")) {
          res.writeHead(400); return res.end(JSON.stringify({ error: { code: -32020, message: "HeaderMismatch" } }));
        }
        const out = await dispatchCall(name, a ?? {});
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(out));
      } catch (e) { res.writeHead(400); return res.end(JSON.stringify({ error: String(e).slice(0, 200) })); }
    }
    res.writeHead(404); res.end("{}");
  });
  server.listen(port, "127.0.0.1", () => console.log(`godmode-mcp http on http://127.0.0.1:${port}`));
} else {
  // stdio: newline-delimited JSON-RPC 2.0 per the MCP stdio transport.
  // Implements the lifecycle real MCP clients require (initialize ->
  // notifications/initialized), never answers notifications, and reports
  // unknown methods as JSON-RPC errors instead of fake results.
  const SERVER_INFO = { name: "godmode", version: "1.0.0" };
  const FALLBACK_PROTOCOL = "2025-06-18";
  const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  const replyError = (id, code, message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
  async function handle(msg) {
    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;
    if (typeof method !== "string") return; // a response to us, or junk: ignore
    if (isNotification) return; // notifications/initialized, notifications/cancelled, ...
    try {
      let result;
      switch (method) {
        case "initialize": {
          const d = discover();
          result = {
            protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : FALLBACK_PROTOCOL,
            capabilities: { tools: { listChanged: false }, experimental: d.capabilities.extensions },
            serverInfo: SERVER_INFO,
            instructions: "GodMode: call godmode_status first; long tools can run via godmode_task_start + godmode_task_get.",
          };
          break;
        }
        case "ping": result = {}; break;
        case "server/discover": result = discover(); break;
        case "tools/list": result = toolsList(); break;
        case "resources/list": result = { resources: [] }; break;
        case "prompts/list": result = { prompts: [] }; break;
        case "tasks/get": result = { resultType: "complete", task: taskGet(params?.task_id) }; break;
        case "tools/call": {
          const out = await dispatchCall(params?.name, params?.arguments ?? {});
          result = { ...out, isError: out?.structuredContent?.ok === false };
          break;
        }
        default: return replyError(id, -32601, `Method not found: ${method}`);
      }
      reply(id, result);
    } catch (e) {
      replyError(id, -32603, String(e).slice(0, 200));
    }
  }
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { replyError(null, -32700, "Parse error"); continue; }
      handle(msg);
    }
  });
}
