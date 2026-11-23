/**
 * Agent server lifecycle (spec #47 / #50): the headless OpenCode server
 * (`opencode serve`) as a managed capability of every workspace.
 *
 * The API owns a random per-workspace password (in memory only; never sent to
 * a browser, never logged). The ExecDriver starts the process in the
 * workspace's project dir as the learner's user, so the terminal agent and the
 * chat panel share the same files and the same seat key/config under $HOME.
 */
import { randomBytes } from "node:crypto";
import type { ExecDriver } from "./drivers/types";

/** Basic-auth username the OpenCode server requires (anything else is a 401). */
export const AGENT_USER = "opencode";

export type AgentState = "stopped" | "starting" | "healthy" | "unhealthy";
export interface AgentStatus {
  state: AgentState;
  /** OpenCode version reported by GET /api/info when healthy. */
  version?: string;
}
export interface AgentTarget {
  /** http origin of the server inside the workspace, never client-influenced. */
  origin: string;
  host: string;
  port: number;
  /** Full Authorization header value to inject server-side. */
  authorization: string;
}

type Probe = "ok" | "unauthorized" | "down";

export class AgentServers {
  private passwords = new Map<string, string>();
  private inflight = new Map<string, Promise<AgentStatus>>();

  constructor(
    private d: ExecDriver,
    private opts: { startTimeoutMs?: number } = {},
  ) {}

  private auth(id: string) {
    const pw = this.passwords.get(id);
    return pw ? `Basic ${btoa(`${AGENT_USER}:${pw}`)}` : undefined;
  }

  private async probe(origin: string, authorization: string | undefined): Promise<{ r: Probe; version?: string }> {
    try {
      const res = await fetch(`${origin}/api/info`, {
        headers: authorization ? { authorization } : {},
        signal: AbortSignal.timeout(2000),
      });
      if (res.status === 401) return { r: "unauthorized" };
      if (!res.ok) return { r: "down" };
      const j = (await res.json().catch(() => ({}))) as { version?: string };
      return { r: "ok", version: typeof j.version === "string" ? j.version : undefined };
    } catch {
      return { r: "down" };
    }
  }

  /** Read-only: what is the server doing right now? Never starts or restarts anything. */
  async status(id: string): Promise<AgentStatus> {
    if (this.inflight.has(id)) return { state: "starting" };
    const addr = await this.d.agentServerAddress(id);
    if (!addr) return { state: "stopped" };
    const p = await this.probe(`http://${addr.host}:${addr.port}`, this.auth(id));
    return p.r === "ok" ? { state: "healthy", version: p.version } : { state: "unhealthy" };
  }

  /**
   * Start on demand. Idempotent and single-flight: concurrent/repeated calls
   * never create a second server. Also the recovery path: a killed server is
   * started again, and a live one whose password this API no longer knows
   * (API restarted) is replaced.
   */
  start(id: string): Promise<AgentStatus> {
    let p = this.inflight.get(id);
    if (!p) {
      p = this.startOnce(id).finally(() => this.inflight.delete(id));
      this.inflight.set(id, p);
    }
    return p;
  }

  private async startOnce(id: string): Promise<AgentStatus> {
    const timeout = this.opts.startTimeoutMs ?? 45_000;
    let addr = await this.d.agentServerAddress(id);
    if (addr) {
      const p = await this.probe(`http://${addr.host}:${addr.port}`, this.auth(id));
      if (p.r === "ok") return { state: "healthy", version: p.version };
      if (p.r === "unauthorized" || !this.passwords.has(id)) {
        // Alive but we cannot talk to it (credentials lost): replace it.
        await this.d.stopAgentServer(id);
        addr = null;
      }
      // "down" with a known password: still booting; wait below.
    }
    let fresh = false;
    if (!addr) {
      const password = randomBytes(24).toString("base64url");
      this.passwords.set(id, password);
      addr = await this.d.startAgentServer(id, password);
      fresh = true;
    }
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const p = await this.probe(`http://${addr.host}:${addr.port}`, this.auth(id));
      if (p.r === "ok") {
        if (fresh) await this.bridgeSeatKey(id, `http://${addr.host}:${addr.port}`);
        return { state: "healthy", version: p.version };
      }
      if (!(await this.d.agentServerAddress(id))) throw new Error("agent server exited during startup");
      await Bun.sleep(150);
    }
    throw new Error("agent server did not become healthy in time");
  }

  /**
   * OpenCode 2.x keeps credentials in its own database and ignores the legacy
   * ~/.local/share/opencode/auth.json that seat injection writes (see seats.ts
   * credentialFiles). Hand the injected key to the server through its own API so
   * the chat panel uses the SAME seat key (and model, from ~/.config/opencode/opencode.json)
   * as the terminal agent. The key stays in this process's memory: never logged, never sent to a browser.
   * Best effort: a failure leaves the server healthy, just without a key.
   */
  private async bridgeSeatKey(id: string, origin: string) {
    try {
      const r = await this.d.run(id, 'cat "$HOME/.local/share/opencode/auth.json" 2>/dev/null', { timeoutMs: 8_000 });
      if (r.exitCode !== 0 || !r.stdout.trim()) return;
      const legacy = JSON.parse(r.stdout) as Record<string, { type?: string; key?: string }>;
      const headers = { authorization: this.auth(id)!, "content-type": "application/json" };
      const have = (await (await fetch(`${origin}/api/credential`, { headers, signal: AbortSignal.timeout(5000) })).json()) as {
        data?: { integrationID: string }[];
      };
      const connected = new Set((have.data ?? []).map((c) => c.integrationID));
      for (const [integration, v] of Object.entries(legacy)) {
        if (v?.type !== "api" || !v.key || connected.has(integration)) continue;
        const res = await fetch(`${origin}/api/integration/${encodeURIComponent(integration)}/connect/key`, {
          method: "POST",
          headers,
          body: JSON.stringify({ key: v.key }),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) console.warn(`agent server ${id}: could not connect "${integration}" (HTTP ${res.status})`);
      }
    } catch (err) {
      console.warn(`agent server ${id}: seat key bridge failed: ${(err as Error).name}`);
    }
  }

  /** Where the proxy should send a request, or null if no server is running or the password is unknown. */
  async target(id: string): Promise<AgentTarget | null> {
    const authorization = this.auth(id);
    if (!authorization) return null;
    const addr = await this.d.agentServerAddress(id);
    if (!addr) return null;
    return { origin: `http://${addr.host}:${addr.port}`, host: addr.host, port: addr.port, authorization };
  }

  /** Kill the server process (a crash, as far as the chat can tell). Test hook only; the password is kept like after a real crash. */
  async crash(id: string) {
    await this.d.stopAgentServer(id);
  }

  /** Forget a workspace's credentials (call when it is destroyed). */
  forget(id: string) {
    this.passwords.delete(id);
  }
}
