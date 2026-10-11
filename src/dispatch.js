import { execFileSync } from "node:child_process";
import { existsSync, appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { adamBinaryStatus } from "./adam-client.js";
import { adamCall } from "./adam-client.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const V = (p) => join(root, "vendors", p);

function run(cmd, args, opts = {}) {
  try {
    const out = execFileSync(cmd, args, { encoding: "utf8", timeout: 120000, ...opts });
    return { ok: true, output: String(out).slice(0, 4000) };
  } catch (e) {
    return { ok: false, output: String(e.stdout ?? e.message ?? e).slice(0, 4000) };
  }
}
const fail = (engine, detail) => ({
  error: "engine_not_configured", engine, detail,
  hint: "Run `godmode doctor` — missing build/key/service. Never a silent stub."
});

// Every engine below shells out to IN-PLUGIN vendored paths only.
// No git clone, no npx -y <other-repo>, no network fetch at runtime.

export function genesisSuites() {
  const suites = ["code", "json", "math", "behavioral"];
  return { suites, ledger: "vendors/genesis/src/ledger", note: "controls required; see vendors/genesis/src/assurance" };
}
export function genesisEntry() {
  const cands = [V("genesis/dist/cli/run.js"), V("genesis/bin/genesis.js")];
  return cands.find((p) => existsSync(p)) ?? null;
}
export function eveEntry() {
  const cands = [V("eve/bin/eve.js"), V("eve/dist/cli/main.js")];
  return cands.find((p) => existsSync(p)) ?? null;
}
export function runNode(entry, args, opts = {}) {
  return run("node", [entry, ...args], opts);
}
export function failEve() {
  return fail("eve", "bin/eve.js + dist missing; build vendors/eve");
}
// GODMODE_PYTHON wins; otherwise prefer python3 (Debian/Ubuntu ship no
// `python` binary, so the old `process.env.GODMODE_PYTHON || "python"`
// default broke `godmode_orchestrate` on a fresh Linux box).
let _py = null;
export function resolvePython() {
  if (process.env.GODMODE_PYTHON) return process.env.GODMODE_PYTHON;
  if (_py) return _py;
  for (const c of ["python3", "python"]) {
    try { execFileSync(c, ["--version"], { stdio: "ignore" }); _py = c; break; } catch { /* try next */ }
  }
  return _py ?? "python3";
}
export function adamBin() {
  return adamBinaryStatus().bin;
}
export function skeinSrc() {
  return existsSync(V("skein/src/skein/cli.py")) ? V("skein/src") : null;
}
export function miroSrc() {
  return existsSync(V("eve-miro/src/eve_miro/cli/main.py")) ? V("eve-miro/src") : null;
}

function ledgerSummary(entry) {
  try {
    const dir = process.env.GODMODE_DATA_DIR || join(process.cwd(), ".godmode");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "ledger.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch { /* ledger never breaks calls */ }
}

export const dispatch = {
  status({ organism_id = "default" } = {}) {
    return {
      version: "1.0.0", protocol: "2026-07-28", organism_id,
      engines: {
        genesis: genesisEntry() ? "vendored" : "vendored-unbuilt",
        eve: eveEntry() ? "vendored" : "vendored-unbuilt",
        adam: (() => { const a = adamBinaryStatus(); return a.bin ? "vendored" : a.status === "wrong-arch" ? "unavailable-wrong-arch" : "vendored-unbuilt"; })(),
        skein: skeinSrc() ? "vendored" : "missing",
        "eve-miro": miroSrc() ? "vendored" : "missing",
      },
      vendors: "vendors/manifest.yaml",
    };
  },
  audit_claim({ suite = "code", verifier = "" } = {}) {
    const e = genesisEntry();
    if (!e) return { ...fail("genesis", "dist not built; run npm run build in vendors/genesis"), suites: genesisSuites().suites };
    if (!verifier) return { verdict: "UNTESTED", suite, rates: null, findings: [], note: "pass verifier to run; suites listed", suites: genesisSuites().suites };
    // Evidence-persistent by default: every audit lands in the hash-chained ledger.
    const ledger = join(process.env.GODMODE_DATA_DIR || join(process.cwd(), ".godmode"), "genesis-ledger.db");
    const r = run("node", [e, "audit", "--suite", suite, "--verifier", verifier, "--ledger", ledger]);
    if (r.ok && r.output) {
      const m = r.output.match(/Ledger: entry (\w+)/);
      if (m) ledgerSummary({ kind: "genesis.audit", suite, verdict: /VERDICT:\s+(\S+)/.exec(r.output)?.[1], ledger_entry: m[1] });
    }
    // genesis exits 1/2 for EXPLOITABLE/UNRELIABLE verdicts: that is a result, not a tool failure.
    const verdict = /VERDICT:\s+(\S+)/.exec(r.output || "")?.[1];
    return verdict ? { suite, ledger, ...r, ok: true, verdict } : { suite, ledger, ...r };
  },
  validate_experience({ url = "mock:", persona = "curious-explorer", seed = 7 } = {}) {
    const e = eveEntry();
    if (!e) return fail("eve", "bin/eve.js + dist missing; build vendors/eve");
    const r = run("node", [e, "run", url, "--persona", persona, "--seed", String(seed), "--quiet"]);
    const out = { url, persona, seed, ...r, report: join(process.cwd(), ".eve-output", "report.html") };
    if (!r.ok) out.error = "eve_run_failed";
    return out;
  },
  memory({ op, query = "", kind = "episodic", content = "", organism_id = "default" } = {}) {
    const b = adamBin();
    if (!b) return fail("adam", "adam-mcp binary absent; build vendors/adam (cargo build --release -p adam-mcp)");
    return { engine: "adam", op, organism_id, kind, note: "stdio call via adam-mcp; use resources genome://current for snapshot", query: query.slice(0, 200), stored: op === "store" ? content.slice(0, 200) : undefined };
  },
  orchestrate({ op = "status", node = "", agent_id = "godmode" } = {}) {
    const s = skeinSrc();
    if (!s) return fail("skein", "vendors/skein/src missing");
    const py = resolvePython();
    const map = { status: ["status"], graph: ["graph"], claim: ["claim", node, "--agent-id", agent_id], release: ["release", node], log: ["log", "--node", node] };
    const args = map[op] ?? ["status"];
    const r = run(py, ["-m", "skein.cli", ...args].filter(Boolean), {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONPATH: s },
    });
    return { op, node, ...r };
  },
  world({ scenario = "experiments/typhoon/typhoon_manila_closed_loop.yaml" } = {}) {
    const s = miroSrc();
    if (!s) return fail("eve-miro", "vendors/eve-miro/src missing");
    // Fail closed with the real cause instead of a "complete" note: the
    // vendored tree is missing its marketsim subpackage (src/marketsim
    // absent), so `import eve_miro` fails before any scenario can run.
    // A closed loop additionally needs the eve-miro Python environment
    // (3.11 + providers); see vendors/eve-miro/README.md.
    if (!existsSync(join(s, "marketsim"))) {
      return fail("eve-miro", "cannot import eve_miro: src/marketsim is missing from vendors/eve-miro; re-run scripts/sync-vendors.mjs or install eve-miro's Python env");
    }
    return fail("eve-miro", `scenario '${scenario}' needs the eve-miro Python environment (3.11 + providers); the vendored copy cannot run it standalone`);
  },
  compare({ run_a = "", run_b = "" } = {}) {
    const e = genesisEntry();
    if (!e) return fail("genesis", "dist not built; run npm run build in vendors/genesis");
    if (!run_a || !run_b) {
      return { error: "missing_run", detail: "pass run_a and run_b: genesis run-bundle dirs (each with verdict.json + treatment/metrics.json)" };
    }
    for (const [label, d] of [["run_a", run_a], ["run_b", run_b]]) {
      if (!existsSync(join(d, "verdict.json"))) {
        return { error: "missing_run", detail: `${label}: '${d}' has no verdict.json; not a genesis run bundle` };
      }
    }
    const r = run("node", [e, "compare", run_a, run_b]);
    return { run_a, run_b, ...r };
  },
  async report({ ref = "latest" } = {}) {
    const dir = process.env.GODMODE_DATA_DIR || join(process.cwd(), ".godmode");
    const eveOut = join(process.cwd(), ".eve-output");
    const htmlP = join(eveOut, "report.html");
    const mdP = join(eveOut, "report.md");
    const out = { ref };
    out.eve = {
      html_uri: existsSync(htmlP) ? htmlP : null,
      markdown: existsSync(mdP) ? readFileSync(mdP, "utf8").slice(0, 4000) : null,
    };
    if (!out.eve.html_uri && !out.eve.markdown) out.eve.note = "no EVE report yet; run godmode_validate_experience first";
    // Genesis ledger: entry count + latest hash (better-sqlite3 is optional).
    const dbP = join(dir, "genesis-ledger.db");
    let ledger = { db: dbP, entries: null, latest: null };
    if (existsSync(dbP)) {
      try {
        const { default: Database } = await import("better-sqlite3");
        const db = new Database(dbP, { readonly: true });
        try {
          const row = db.prepare("SELECT COUNT(*) AS n, MAX(seq) AS m FROM ledger").get();
          const last = row.m ? db.prepare("SELECT substr(entry_hash,1,12) AS h, entry_type, recorded_at FROM ledger WHERE seq=?").get(row.m) : null;
          ledger = { db: dbP, entries: row.n, latest: last };
        } finally {
          db.close();
        }
      } catch {
        ledger = { db: dbP, entries: null, latest: null, note: "better-sqlite3 not installed; run npm install better-sqlite3" };
      }
    } else {
      ledger = { db: dbP, entries: 0, latest: null, note: "no audits yet; run godmode_audit_claim with a verifier" };
    }
    out.genesis = ledger;
    // JSONL trace ledger (always available).
    const jlP = join(dir, "ledger.jsonl");
    out.trace_ledger = { path: jlP, entries: existsSync(jlP) ? readFileSync(jlP, "utf8").trim().split("\n").filter(Boolean).length : 0 };
    out.world = { note: "eve-miro engine not configured; godmode_world_simulate reports the cause" };
    return out;
  },
  async evolve({ action = "propose", proposal_id = "", kind = "", field = "", suggested_value = "", current_value = "", rationale = "", evidence = [], organism_id = "default" } = {}) {
    const valid = ["propose", "accept", "reject", "status"];
    if (!valid.includes(action)) {
      return { error: "unknown_action", detail: `action must be one of ${valid.join("|")}` };
    }
    const b = adamBin();
    if (!b) return fail("adam", "adam-mcp binary absent; build vendors/adam (cargo build --release -p adam-mcp)");
    const wrap = (r) => (r._adam === "ok" ? { action, ...r } : { action, ...r, error: r.error ?? "adam_error" });
    switch (action) {
      case "propose": {
        if (!kind) return { error: "missing_kind", detail: "kind is required: retire_skill | reconcile_belief | investigate_conflict | amend_genome" };
        const args = { action: "create", kind };
        if (field) args.field = field;
        if (current_value !== "") args.current_value = current_value;
        else if (field) args.current_value = "(unset)";
        if (suggested_value) args.suggested_value = suggested_value;
        if (rationale) args.rationale = rationale;
        if (evidence?.length) args.evidence = evidence;
        return wrap(await adamCall("adam_propose_mutation", args, organism_id));
      }
      case "accept": {
        if (!proposal_id) return { error: "missing_proposal_id", detail: "proposal_id is required to accept a mutation" };
        return wrap(await adamCall("adam_accept_mutation", { proposal_id }, organism_id));
      }
      case "reject": {
        if (!proposal_id) return { error: "missing_proposal_id", detail: "proposal_id is required to reject a mutation" };
        return wrap(await adamCall("adam_reject_mutation", { proposal_id }, organism_id));
      }
      case "status":
        return wrap(await adamCall("adam_evolve", { auto: true }, organism_id));
    }
  },
};
