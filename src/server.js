import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch, eveEntry, runNode, failEve } from "./dispatch.js";
import { emitTrace, newTraceId, shaShort, dataDir, tracePath } from "./trace.js";
import { loadMods } from "./mods.js";
import { taskCreate, taskGet, taskList, taskFinish } from "./tasks.js";
import { adamCall } from "./adam-client.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROTOCOL = "2026-07-28";

const S = (description) => ({ type: "string", description });
const N = (description) => ({ type: "number", description });
const B = (description) => ({ type: "boolean", description });
const O = (description) => ({ type: "object", description });
export const TOOL_DEFS = [
  { name: "godmode_status", description: "GodMode status: versions, vendored engines, mods", inputSchema: { type: "object", properties: { organism_id: S("Organism id (default: default)") } }, annotations: { readOnly: true, idempotent: true } },
  { name: "godmode_remember", description: "Store durable memory in ADAM organism (real stdio call to vendored adam-mcp)", inputSchema: { type: "object", properties: { kind: S("Memory kind: episodic, semantic, procedural, self_knowledge"), content: S("The memory content to store"), origin: S("Where this memory came from, e.g. observation"), confidence: N("Confidence 0-1"), organism_id: S("Organism id (default: default)") }, required: ["content"] }, annotations: { readOnly: false, idempotent: false } },
  { name: "godmode_recall", description: "Query ADAM memory + prior decisions (real stdio call to vendored adam-mcp)", inputSchema: { type: "object", properties: { query: S("Natural-language query against stored memories"), kind: S("Restrict to a memory kind"), top_k: N("Max results (default 5)"), organism_id: S("Organism id (default: default)") }, required: ["query"] }, annotations: { readOnly: true, idempotent: true } },
  { name: "godmode_beliefs", description: "List ADAM beliefs or form one from evidence (real stdio call; statement form creates a new belief)", inputSchema: { type: "object", properties: { statement: S("Claim to record as a belief (omit to list beliefs)"), origin: S("Evidence origin for a new belief"), organism_id: S("Organism id (default: default)") } }, annotations: { readOnly: false, idempotent: false } },
  { name: "godmode_genome", description: "Current ADAM genome payload (values, goals, capabilities, policies)", inputSchema: { type: "object", properties: { organism_id: S("Organism id (default: default)") } }, annotations: { readOnly: true, idempotent: true } },
  { name: "godmode_mcp_eval", description: "EVE mcp-eval: schema, conformance + fuzz oracles against an MCP server target", inputSchema: { type: "object", properties: { target: S("Command that starts the MCP server over stdio, e.g. \"node server.js\""), fuzz: B("Run robustness fuzzing (default true; it calls every tool with junk args and can be slow)") }, required: ["target"] }, annotations: { readOnly: true, idempotent: true } },
  { name: "godmode_validate_experience", description: "Run EVE human-loop simulation (personas, seeded, evidence-backed)", inputSchema: { type: "object", properties: { url: S("Target URL, or mock: for the built-in fixture site"), persona: S("Persona name, e.g. curious-explorer"), goal: S("Optional task goal for the persona"), seed: N("Random seed for reproducibility") } }, annotations: { readOnly: true, idempotent: true } },
  { name: "godmode_audit_claim", description: "Genesis: evaluate claim + adversarially audit verifier (SOUND/EXPLOITABLE). Without a verifier the claim is UNTESTED.", inputSchema: { type: "object", properties: { suite: S("Probe suite: code, json, math, behavioral"), verifier: S("Verifier command with {task_file} and {completion_file} placeholders"), spec: S("Optional spec file for audit-evaluator mode") } }, annotations: { readOnly: true, idempotent: true } },
  { name: "godmode_compare", description: "Genesis compare/regression between two run bundles (verdict.json + treatment/metrics.json dirs)", inputSchema: { type: "object", properties: { run_a: S("Path to run-bundle dir A"), run_b: S("Path to run-bundle dir B") } }, annotations: { readOnly: true, idempotent: true } },
  { name: "godmode_orchestrate", description: "Skein task-graph: graph/claim/release/status/log with evidence gate", inputSchema: { type: "object", properties: { op: S("Operation: status, graph, claim, release, log"), node: S("Node id for claim/release/log"), agent_id: S("Claiming agent id (default: godmode)") } }, annotations: { readOnly: false, idempotent: true } },
  { name: "godmode_world_simulate", description: "EVE-MIRO closed loop: WorldState->sim->EVE->ledger (provenance-labeled). Requires the eve-miro Python environment; fails closed otherwise.", inputSchema: { type: "object", properties: { scenario: S("Scenario YAML path, e.g. experiments/typhoon/typhoon_manila_closed_loop.yaml") } }, annotations: { readOnly: true, idempotent: true } },
  { name: "godmode_evolve", description: "ADAM self-mutation via the real adam-mcp: propose (needs kind) -> governed accept/reject (accept is destructive: confirm). status derives signals.", inputSchema: { type: "object", properties: { proposal_id: S("Proposal id for accept/reject"), action: S("propose, accept, reject, or status (default: propose)"), kind: S("Proposal kind for propose: retire_skill, reconcile_belief, investigate_conflict, amend_genome"), field: S("Genome field for amend_genome, e.g. preferences.theme"), suggested_value: S("Proposed new value"), current_value: S("Current value of the field (default: (unset))"), rationale: S("Why this mutation"), evidence: { type: "array", items: { type: "string" }, description: "Supporting evidence strings" }, organism_id: S("Organism id (default: default)") } }, annotations: { readOnly: false, destructive: true, idempotent: false } },
  { name: "godmode_report", description: "Fetch the latest real artifacts: EVE report (html path + markdown), genesis ledger summary, trace ledger counts", inputSchema: { type: "object", properties: { ref: S("Report ref (default: latest)") } }, annotations: { readOnly: true, idempotent: true } },
  { name: "godmode_task_start", description: "Start any GodMode tool as a background task (Tasks extension); poll with godmode_task_get", inputSchema: { type: "object", properties: { tool: S("Tool name to run in the background"), arguments: O("Arguments for the tool") }, required: ["tool"] }, annotations: { readOnly: false, idempotent: false } },
  { name: "godmode_task_get", description: "Poll a background task (running/done/failed + result)", inputSchema: { type: "object", properties: { task_id: S("Task id from godmode_task_start") }, required: ["task_id"] }, annotations: { readOnly: true, idempotent: true } },
];


export async function dispatchCall(name, args = {}, ctx = {}) {
  const t0 = Date.now();
  const traceId = ctx.traceId || newTraceId();
  const mods = loadMods(root);
  let a = { ...args };
  for (const m of mods) { try { if (m.hooks?.preCall) a = (await m.hooks.preCall(name, a, ctx)) ?? a; } catch (e) { emitTrace({ traceId, tool: name, modApplied: m.name + ":preCall-error" }); } }
  // MRTR-style confirm for destructive evolve without explicit confirm
  if (name === "godmode_evolve" && (a.action === "accept" || a.action === "apply") && a.confirm !== true && !ctx.headlessBypass) {
    const dur = Date.now() - t0;
    emitTrace({ traceId, tool: name, argsHash: shaShort(JSON.stringify(a)), durationMs: dur, resultSummary: "input_required:confirm" });
    const msg = "Accepting a genome mutation is destructive. Re-call godmode_evolve with confirm: true to proceed.";
    return { resultType: "input_required", traceId, content: [{ type: "text", text: msg }], structuredContent: { tool: name, ok: false, result: { input_required: "confirm" } }, inputRequests: [{ id: "confirm-evolve", type: "elicitation", message: "Accepting a genome mutation is destructive. Confirm?", schema: { confirm: "boolean" } }], requestState: shaShort(traceId + name) };
  }
  let result;
  try {
    switch (name) {
      case "godmode_status": result = dispatch.status(a); break;
      case "godmode_remember": result = await adamCall("adam_memory_store", { kind: a.kind || "episodic", content: a.content, origin: a.origin || "observation", confidence: a.confidence ?? 0.9 }, a.organism_id); break;
      case "godmode_recall": result = await adamCall("adam_memory_query", { query: a.query, kind: a.kind, top_k: a.top_k ?? 5 }, a.organism_id); break;
      case "godmode_beliefs": result = await adamCall("adam_beliefs", a.statement ? { statement: a.statement, origin: a.origin || "observation" } : {}, a.organism_id); break;
      case "godmode_genome": result = await adamCall("adam_genome", {}, a.organism_id); break;
      case "godmode_mcp_eval": {
        const e = eveEntry();
        result = e ? runNode(e, ["mcp-eval", a.target, ...(a.fuzz === false ? ["--no-fuzz"] : [])]) : failEve();
        break;
      }
      case "godmode_validate_experience": result = dispatch.validate_experience(a); break;
      case "godmode_audit_claim": result = dispatch.audit_claim(a); break;
      case "godmode_compare": result = dispatch.compare(a); break;
      case "godmode_orchestrate": result = dispatch.orchestrate(a); break;
      case "godmode_world_simulate": result = dispatch.world(a); break;
      case "godmode_evolve": result = await dispatch.evolve(a); break;
      case "godmode_report": result = await dispatch.report(a); break;
      case "godmode_task_start": {
        const inner = a.tool;
        if (!TOOL_DEFS.find((t) => t.name === inner) || inner === "godmode_task_start") { result = { error: "unknown_tool", name: inner }; break; }
        const id = taskCreate(inner, a.arguments ?? {});
        setImmediate(async () => {
          try {
            const r = await dispatchCall(inner, a.arguments ?? {}, { ...ctx, viaTask: id });
            taskFinish(id, r);
          } catch (e) { taskFinish(id, null, String(e).slice(0, 300)); }
        });
        result = { task_id: id, status: "running", poll: "godmode_task_get" };
        break;
      }
      case "godmode_task_get": result = taskGet(a.task_id); break;
      default: result = { error: "unknown_tool", name };
    }
  } catch (e) {
    result = { error: "handler_failed", message: String(e).slice(0, 300) };
  }
  for (const m of mods) { try { if (m.hooks?.postCall) result = (await m.hooks.postCall(name, a, result, ctx)) ?? result; } catch { /* mods never break core */ } }
  const out = {
    resultType: "complete", traceId,
    content: [{ type: "text", text: JSON.stringify(result).slice(0, 4000) }],
    structuredContent: { tool: name, ok: !result?.error && result?.ok !== false && (result?._adam === undefined || result._adam === "ok"), result },
  };
  emitTrace({ traceId, tool: name, argsHash: shaShort(JSON.stringify(args)), handles: a.organism_id ?? a.node ?? "", durationMs: Date.now() - t0, resultSummary: JSON.stringify(result).slice(0, 200), modApplied: mods.map((m) => m.name).join(",") });
  return out;
}

export function resourcesList() {
  return {
    resources: [
      { uri: "ledger://genesis", name: "Genesis ledger", description: "Hash-chained audit ledger summary (latest entries)", mimeType: "application/json" },
      { uri: "report://eve/latest", name: "Latest EVE report", description: "Markdown of the most recent EVE experience validation run", mimeType: "text/markdown" },
      { uri: "genome://current", name: "ADAM genome", description: "Current organism genome payload (values, goals, capabilities, policies)", mimeType: "application/json" },
      { uri: "graph://skein/current", name: "Skein task graph", description: "Current task-graph status", mimeType: "application/json" },
    ],
  };
}

export async function resourcesRead(uri) {
  const dd = process.env.GODMODE_DATA_DIR || join(process.cwd(), ".godmode");
  const wrap = (u, mimeType, body) => ({ contents: [{ uri: u, mimeType, text: body }] });
  if (uri === "ledger://genesis") {
    const jl = join(dd, "ledger.jsonl");
    let entries = [];
    if (existsSync(jl)) {
      entries = readFileSync(jl, "utf8").trim().split("\n").filter(Boolean).slice(-20)
        .map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
    }
    return wrap(uri, "application/json", JSON.stringify({ entries, count: entries.length }, null, 2));
  }
  if (uri === "report://eve/latest") {
    const md = join(process.cwd(), ".eve-output", "report.md");
    if (!existsSync(md)) throw new Error("no EVE report yet; run godmode_validate_experience first");
    return wrap(uri, "text/markdown", readFileSync(md, "utf8"));
  }
  if (uri === "genome://current") {
    const r = await adamCall("adam_genome", {}, "default");
    if (r._adam !== "ok") throw new Error(`adam unavailable: ${r.error ?? r.detail ?? r._adam}`);
    return wrap(uri, "application/json", JSON.stringify(r.result, null, 2).slice(0, 20000));
  }
  if (uri === "graph://skein/current") {
    const r = dispatch.orchestrate({ op: "graph" });
    if (r.error) throw new Error(`${r.engine ?? "skein"}: ${r.detail ?? r.error}`);
    return wrap(uri, "application/json", JSON.stringify(r, null, 2).slice(0, 20000));
  }
  throw new Error(`unknown resource: ${uri}`);
}

export function toolsList() {
  return { protocol: PROTOCOL, tools: [...TOOL_DEFS].sort((a, b) => a.name.localeCompare(b.name)), ttlMs: 60000, cacheScope: "public" };
}
export function discover() {
  return { protocol: PROTOCOL, server: { name: "godmode", version: "1.0.0" }, capabilities: { tools: {}, resources: {}, prompts: {}, extensions: { "io.modelcontextprotocol/tasks": {} } } };
}
