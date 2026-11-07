import { createHash } from "node:crypto";
import { driver } from "./drivers/local";
import { runCheck } from "./checks";
import { signPreview } from "./preview";
import { getPlayground } from "./playgrounds";

/**
 * Agent tool broker (issue #9, workspace-spec §2 agent tab).
 * Per-lab policy tiers: allowed runs now, approval-gated pauses for an
 * explicit learner decision, forbidden is blocked + logged. No LLM in the
 * loop on the bench: the learner (or tests) submits a plan of tool calls and
 * the broker enforces, executes, and audits. Every record redacts secrets
 * and hashes args so audit replay never leaks values.
 */

export type ToolName = "fs.read" | "fs.write" | "exec" | "preview.open" | "checks.run";

export interface LabPolicy {
  allowed: string[];
  approvalRequired: string[];
  forbidden: string[];
}

/** Demo-lab default: files+checks free, installs/network gated, creds+mounts banned. */
export const DEFAULT_POLICY: LabPolicy = {
  allowed: ["fs.read", "fs.write", "checks.run", "preview.open"],
  approvalRequired: ["exec"],
  forbidden: ["exec:exfil", "exec:mount", "fs.read:secret"],
};

const SECRET_PATTERNS = [
  /sk-(live|test)-[A-Za-z0-9]+/g,
  /gh[pousr]_[A-Za-z0-9_]+/g,
  /xox[bpas]-[A-Za-z0-9-]+/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /"password"\s*:\s*"[^"]*"/g,
  /token["']?\s*[:=]\s*["'][^"']+["']/gi,
];

export function redact(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}

function argsHash(tool: string, args: unknown): string {
  return createHash("sha256").update(`${tool}:${JSON.stringify(args)}`).digest("hex").slice(0, 16);
}

/** Forbidden-class detection beyond the tier list (defense in depth). */
export function classifyCall(tool: ToolName, args: Record<string, unknown>): "forbidden" | null {
  const blob = JSON.stringify(args);
  if (/(^|\W)(\.ssh\/|id_rsa|\.aws\/credentials|~\/\.npmrc)(\W|$)/.test(blob)) return "forbidden";
  if (/\/etc\/(passwd|shadow|sudoers)/.test(blob)) return "forbidden";
  if (/\/proc\/|\/sys\/|mount\s/.test(blob)) return "forbidden";
  if (tool === "exec" && typeof args.cmd === "string") {
    if (/\b(curl|wget)\b.*(169\.254\.169\.254|metadata\.google)/.test(args.cmd)) return "forbidden";
    if (/\b(env\s*\|\s*)?(export\s+)?(BETTER_AUTH_SECRET|PREVIEW_SECRET|DATABASE_URL|POSTGRES)/.test(args.cmd))
      return "forbidden";
    if (/\b(nc|ncat|netcat)\b.*-e\b/.test(args.cmd)) return "forbidden";
  }
  if (tool === "fs.read" && typeof args.path === "string") {
    if (/token|secret|credential|\.ssh|id_rsa/i.test(args.path)) return "forbidden";
  }
  return null;
}

export interface AuditRecord {
  seq: number;
  runId: string;
  tool: ToolName;
  argsHash: string;
  argsPreview: string; // redacted, truncated
  decision: "allowed" | "approved" | "denied" | "blocked";
  ms: number;
  outputPreview?: string; // redacted, truncated
}

export interface PendingCall {
  callId: string;
  runId: string;
  tool: ToolName;
  args: Record<string, unknown>;
  reason: string;
  at: string;
}

export interface AgentRun {
  runId: string;
  sessionId: string;
  status: "running" | "waiting_approval" | "done" | "denied";
  results: { tool: ToolName; ok: boolean; output: string }[];
}

const runs = new Map<string, AgentRun>();
const pending = new Map<string, PendingCall>(); // callId → call
const audits = new Map<string, AuditRecord[]>(); // sessionId → records
let seq = 0;

export function clearAgent() {
  runs.clear();
  pending.clear();
  audits.clear();
  seq = 0;
}

export function getPending(sessionId: string): PendingCall[] {
  return [...pending.values()].filter((p) => {
    const r = runs.get(p.runId);
    return r?.sessionId === sessionId;
  });
}

export function getAudit(sessionId: string): AuditRecord[] {
  return audits.get(sessionId) ?? [];
}

function log(
  sessionId: string,
  runId: string,
  tool: ToolName,
  args: unknown,
  decision: AuditRecord["decision"],
  ms: number,
  output?: string,
) {
  const rec: AuditRecord = {
    seq: ++seq,
    runId,
    tool,
    argsHash: argsHash(tool, args),
    argsPreview: redact(JSON.stringify(args)).slice(0, 500),
    decision,
    ms,
    outputPreview: output === undefined ? undefined : redact(output).slice(0, 1000),
  };
  if (!audits.has(sessionId)) audits.set(sessionId, []);
  audits.get(sessionId)!.push(rec);
}

async function execTool(
  sessionId: string,
  tool: ToolName,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  switch (tool) {
    case "fs.read": {
      const r = await driver.readFile(sessionId, String(args.path));
      return { ok: true, output: r.truncated ? r.content + "\n…[truncated]" : r.content };
    }
    case "fs.write": {
      const r = await driver.writeFile(sessionId, String(args.path), String(args.content ?? ""));
      return { ok: true, output: `wrote ${r.bytes} bytes` };
    }
    case "exec": {
      const r = await driver.run(sessionId, String(args.cmd ?? ""), { timeoutMs: 30_000 });
      return { ok: r.exitCode === 0, output: (r.stdout + r.stderr).slice(-2000) };
    }
    case "preview.open": {
      const token = signPreview(sessionId, Number(args.port ?? 3000));
      return { ok: true, output: `/preview/${token}/` };
    }
    case "checks.run": {
      const r = await runCheck(sessionId, String(args.track), String(args.step));
      return { ok: r.pass, output: r.pass ? "PASS" : r.failures.map((f) => f.hint).join(" · ") };
    }
  }
}

/** Submit a plan. Executes until an approval gate, denial, or completion. */
export async function submitRun(
  sessionId: string,
  plan: { tool: ToolName; args: Record<string, unknown> }[],
  policy: LabPolicy = DEFAULT_POLICY,
): Promise<AgentRun> {
  if (!getPlayground(sessionId)) throw new Error("session not found");
  const run: AgentRun = { runId: crypto.randomUUID(), sessionId, status: "running", results: [] };
  runs.set(run.runId, run);
  await advance(run, plan, 0, policy);
  return run;
}

async function advance(
  run: AgentRun,
  plan: { tool: ToolName; args: Record<string, unknown> }[],
  from: number,
  policy: LabPolicy,
): Promise<void> {
  (run as { _plan?: unknown })._plan = plan;
  for (let i = from; i < plan.length; i++) {
    const { tool, args } = plan[i];
    if (!["fs.read", "fs.write", "exec", "preview.open", "checks.run"].includes(tool)) {
      log(run.sessionId, run.runId, tool, args, "blocked", 0, `unknown tool ${tool}`);
      run.results.push({ tool, ok: false, output: `unknown tool ${tool} — blocked` });
      run.status = "denied";
      return;
    }
    // classifyCall covers the sub-case rules (exec:exfil, fs.read:secret…);
    // the tier list covers whole-tool bans.
    if (classifyCall(tool, args)) {
      log(run.sessionId, run.runId, tool, args, "blocked", 0, "forbidden by lab policy");
      run.results.push({ tool, ok: false, output: "blocked by lab policy (logged)" });
      run.status = "denied";
      return;
    }
    const tier = policy.forbidden.includes(tool)
      ? "forbidden"
      : policy.approvalRequired.includes(tool)
        ? "approval"
        : "allowed";
    if (tier === "forbidden") {
      log(run.sessionId, run.runId, tool, args, "blocked", 0, "forbidden by lab policy");
      run.results.push({ tool, ok: false, output: "blocked by lab policy (logged)" });
      run.status = "denied";
      return;
    }
    if (tier === "approval") {
      const callId = crypto.randomUUID();
      pending.set(callId, {
        callId,
        runId: run.runId,
        tool,
        args,
        reason: `${tool} needs learner approval under this lab's policy`,
        at: new Date().toISOString(),
      });
      run.status = "waiting_approval";
      (run as { _idx?: number })._idx = i;
      return;
    }
    const t0 = Date.now();
    try {
      const r = await execTool(run.sessionId, tool, args);
      log(run.sessionId, run.runId, tool, args, "allowed", Date.now() - t0, r.output);
      run.results.push({ tool, ok: r.ok, output: redact(r.output) });
    } catch (err) {
      log(run.sessionId, run.runId, tool, args, "allowed", Date.now() - t0, (err as Error).message);
      run.results.push({ tool, ok: false, output: (err as Error).message });
    }
  }
  run.status = "done";
}

/** Learner decides a pending call. Approve → executes and resumes; deny → run halts, session untouched. */
export async function decideCall(
  callId: string,
  approve: boolean,
  policy: LabPolicy = DEFAULT_POLICY,
): Promise<AgentRun | null> {
  const call = pending.get(callId);
  if (!call) return null;
  const run = runs.get(call.runId);
  if (!run) {
    pending.delete(callId);
    return null;
  }
  pending.delete(callId);
  if (!approve) {
    log(run.sessionId, run.runId, call.tool, call.args, "denied", 0, "learner denied — session untouched");
    run.results.push({ tool: call.tool, ok: false, output: "denied by learner — session untouched" });
    run.status = "denied";
    return run;
  }
  const t0 = Date.now();
  try {
    const r = await execTool(run.sessionId, call.tool, call.args);
    log(run.sessionId, run.runId, call.tool, call.args, "approved", Date.now() - t0, r.output);
    run.results.push({ tool: call.tool, ok: r.ok, output: redact(r.output) });
  } catch (err) {
    run.results.push({ tool: call.tool, ok: false, output: (err as Error).message });
  }
  const plan = (run as { _plan?: { tool: ToolName; args: Record<string, unknown> }[] })._plan ?? [];
  const idx = (run as { _idx?: number })._idx ?? 0;
  run.status = "running";
  await advance(run, plan, idx + 1, policy);
  return run;
}
