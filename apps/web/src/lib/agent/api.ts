/**
 * The ONE place in the web app that knows OpenCode's HTTP API (pinned 2.4.1, experimental `/api/*` surface).
 * Everything goes through our authenticated proxy:  /api/playgrounds/:id/agent/...  (apps/api/src/agent-proxy.ts).
 * The browser never sees the server password or the model key; cookies stay same-origin.
 * If OpenCode's API shifts, change this file (and events.ts for payload shapes), nothing else.
 */
import { AgentApiError } from "./errors";
import type { AgentEvent } from "./events";

export type AgentState = "stopped" | "starting" | "healthy" | "unhealthy";
export interface AgentStatus { state: AgentState; version?: string; /** Server-side: this workspace has a class seat (model key). Never the key itself. */ keyed?: boolean }
export interface SessionInfo { id: string; title?: string; time?: { created?: number; updated?: number } }

/** Endpoint paths relative to the per-workspace proxy base. */
export const PATHS = {
  agent: "", // POST ensure/start, GET status
  sessions: "/api/session",
  session: (id: string) => `/api/session/${encodeURIComponent(id)}`,
  prompt: (id: string) => `/api/session/${encodeURIComponent(id)}/prompt`,
  interrupt: (id: string) => `/api/session/${encodeURIComponent(id)}/interrupt`,
  messages: (id: string) => `/api/session/${encodeURIComponent(id)}/message`,
  active: "/api/session/active",
  permissions: (id: string) => `/api/session/${encodeURIComponent(id)}/permission`,
  permissionReply: (id: string, req: string) => `/api/session/${encodeURIComponent(id)}/permission/${encodeURIComponent(req)}/reply`,
  events: "/api/event",
  location: "/api/location",
} as const;

export type ConnState = "connecting" | "live" | "reconnecting";

export interface AgentClient {
  ensure(): Promise<AgentStatus>;
  status(): Promise<AgentStatus>;
  createSession(): Promise<SessionInfo>;
  listSessions(limit?: number): Promise<SessionInfo[]>;
  getSession(id: string): Promise<SessionInfo | null>;
  /** Returns the id OpenCode gave the user message. */
  sendPrompt(sessionId: string, text: string): Promise<string>;
  interrupt(sessionId: string): Promise<void>;
  /** The latest (up to 200) messages, oldest first. */
  listMessages(sessionId: string): Promise<any[]>;
  /** Session ids with a turn running right now. */
  activeSessionIds(): Promise<Set<string>>;
  /**
   * The agent server's working directory = the workspace root as the server spells it (host path for the local driver,
   * the container's workspace dir for Docker), plus its realpath if that differs. Fetched once per client and cached;
   * null if it could not be read (not cached, so a later call retries).
   */
  location(): Promise<string[] | null>;
  /** Permission requests the agent is waiting on for this session (empty when none). */
  listPermissions(sessionId: string): Promise<any[]>;
  /** Answer a permission request: once = allow this time, reject = deny. */
  replyPermission(sessionId: string, requestId: string, decision: "once" | "reject"): Promise<void>;
  /**
   * Subscribe to the server-wide event stream; reconnects with backoff. Returns an unsubscribe function
   * (with `.nudge()` to cut the current backoff wait, e.g. right after the agent was restarted).
   * `onFail` runs for every failed connection attempt, with the HTTP status (0 = network).
   */
  subscribe(h: { onEvent(e: AgentEvent): void; onState(s: ConnState): void; onReconnect(): void; onFail?(status: number): void }): (() => void) & { nudge(): void };
}

/** Incremental SSE parser: feed text chunks, get complete `data:` payloads (comments/heartbeats are skipped). */
export function createSseParser(onData: (json: string) => void) {
  let buf = "";
  return (chunk: string) => {
    buf += chunk.replace(/\r\n/g, "\n");
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
      if (data) onData(data);
    }
  };
}

/**
 * `GET /api/location` on 2.4.1 answers `{directory, project:{directory, canonical}}` (`canonical` is the realpath, which
 * can differ from `directory` through symlinks). Older/fake servers answer a bare JSON string. Returns every distinct
 * absolute spelling, or null if there is none.
 */
export function locationOf(body: unknown): string[] | null {
  const out = new Set<string>();
  const add = (v: unknown) => { if (typeof v === "string" && v.startsWith("/")) out.add(v.replace(/\/+$/, "") || "/"); };
  if (typeof body === "string") add(body);
  else if (body && typeof body === "object") {
    const b = body as any;
    for (const v of [b.directory, b.path, b.cwd, b.worktree, b.project?.directory, b.project?.canonical, b.project?.worktree]) add(v);
  }
  return out.size ? [...out] : null;
}

export function createAgentClient(opts: { base: string; fetch?: typeof fetch }): AgentClient {
  const f = (...a: Parameters<typeof fetch>) => (opts.fetch ?? fetch)(...a);
  const url = (p: string, q?: Record<string, string | number>) => {
    const qs = q ? `?${new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]))}` : "";
    return `${opts.base}${p}${qs}`;
  };

  async function call<T>(path: string, init?: RequestInit & { q?: Record<string, string | number> }): Promise<T> {
    let res: Response;
    try {
      res = await f(url(path, init?.q), init);
    } catch {
      throw new AgentApiError(0, undefined, "network"); // fetch rejected: offline / server unreachable
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new AgentApiError(res.status, typeof body?.state === "string" ? body.state : undefined);
    }
    return (await res.json().catch(() => ({}))) as T;
  }
  const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

  let loc: Promise<string[] | null> | null = null;
  return {
    async ensure() { const st = await call<AgentStatus>(PATHS.agent, { method: "POST" }); loc = null; return st; }, // a (re)started server: ask again
    location() {
      return (loc ??= (async () => {
        try { return locationOf(await call<unknown>(PATHS.location)); } catch { return null; }
      })().then((v) => { if (v === null) loc = null; return v; }));
    },
    status: () => call<AgentStatus>(PATHS.agent),
    async createSession() { return (await call<{ data: SessionInfo }>(PATHS.sessions, json("POST", {}))).data; },
    async listSessions(limit = 20) { return (await call<{ data: SessionInfo[] }>(PATHS.sessions, { q: { limit, order: "desc" } })).data ?? []; },
    async getSession(id) {
      try { return (await call<{ data: SessionInfo }>(PATHS.session(id))).data; }
      catch (e) { if (e instanceof AgentApiError && (e.status === 404 || e.status === 400)) return null; throw e; }
    },
    async sendPrompt(sessionId, text) {
      const r = await call<{ data: { id: string } }>(PATHS.prompt(sessionId), json("POST", { text }));
      return r.data.id;
    },
    async interrupt(sessionId) { await call(PATHS.interrupt(sessionId), json("POST", {})); },
    // The server caps `limit` at 200 (400 above that). Take the newest page and return it oldest-first.
    async listMessages(sessionId) { return ((await call<{ data: any[] }>(PATHS.messages(sessionId), { q: { order: "desc", limit: 200 } })).data ?? []).reverse(); },
    async activeSessionIds() {
      const r = await call<{ data: Record<string, { type: string }> }>(PATHS.active);
      return new Set(Object.entries(r.data ?? {}).filter(([, v]) => v?.type === "running").map(([k]) => k));
    },
    async listPermissions(sessionId) { return (await call<{ data: any[] }>(PATHS.permissions(sessionId))).data ?? []; },
    async replyPermission(sessionId, requestId, decision) { await call(PATHS.permissionReply(sessionId, requestId), json("POST", { decision })); },
    subscribe(h) {
      let stopped = false;
      let wake: (() => void) | null = null;
      let ctl: AbortController | null = null;
      let attempt = 0;
      let first = true;
      const SILENCE_MS = 60_000; // heartbeats arrive well inside this; silence means a dead socket
      async function run() {
        while (!stopped) {
          ctl = new AbortController();
          let watchdog: ReturnType<typeof setTimeout> | undefined;
          const arm = () => { clearTimeout(watchdog); watchdog = setTimeout(() => ctl?.abort(), SILENCE_MS); };
          try {
            h.onState(first ? "connecting" : "reconnecting");
            const res = await f(url(PATHS.events), { headers: { accept: "text/event-stream" }, signal: ctl.signal });
            if (!res.ok || !res.body) throw new AgentApiError(res.status);
            attempt = 0;
            h.onState("live");
            if (!first) h.onReconnect(); // events may have been missed while away: caller re-syncs history
            first = false;
            arm();
            const dec = new TextDecoder();
            const parse = createSseParser((data) => { try { h.onEvent(JSON.parse(data)); } catch { /* ignore a malformed frame */ } });
            const reader = res.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              arm();
              parse(dec.decode(value, { stream: true }));
            }
          } catch (e) {
            // dropped or aborted: reconnect below. A refused/aborted fetch has no status (0).
            h.onFail?.(e instanceof AgentApiError ? e.status : 0);
          }
          clearTimeout(watchdog);
          if (stopped) return;
          h.onState("reconnecting");
          first = false;
          // exponential backoff, capped; `nudge()` ends the wait early
          await new Promise<void>((r) => { const t = setTimeout(r, Math.min(8000, 400 * 2 ** attempt++)); wake = () => { clearTimeout(t); r(); }; });
          wake = null;
        }
      }
      void run();
      return Object.assign(() => { stopped = true; ctl?.abort(); wake?.(); }, { nudge: () => { attempt = 0; wake?.(); } });
    },
  };
}
