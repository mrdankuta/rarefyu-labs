/**
 * Authenticated reverse proxy to a workspace's agent server (spec #50).
 *
 *   POST /api/playgrounds/:id/agent        start on demand (idempotent), returns status
 *   GET  /api/playgrounds/:id/agent        status (read-only)
 *   ANY  /api/playgrounds/:id/agent/api/*  proxied to the workspace's own  /api/*
 *
 * Deliberate surface choice: the WHOLE upstream /api/* surface is forwarded for
 * now (sessions, prompt, message, diff, revert, event, fs, vcs, pty, ...), since
 * the chat panel (#51) needs most of it and the experimental API is churning.
 * Narrow it to an allow-list once the panel's needs settle. What bounds it:
 *  - ownership: same rule as every /api/playgrounds/:id/* route (injected `access`);
 *  - the upstream origin comes from the driver, never from the client, and only
 *    paths under /api/ are forwarded (no other host, no static UI, no /openapi.json);
 *  - the server runs in the workspace dir as the learner, so it can see exactly
 *    what the learner's own terminal can see inside their container, nothing more;
 *  - client Authorization/Cookie never reach it and the server password never reaches the client.
 */
import { Hono } from "hono";
import type { AgentServers, AgentTarget } from "./agent-server";

export type Access = "ok" | "denied" | "missing";

export interface AgentRouteDeps {
  servers: AgentServers;
  /** Ownership check, the same rule as the other workspace routes. */
  access(headers: Headers, id: string): Promise<Access>;
  /** Does this workspace have a class seat (model key)? Reported in the status so the chat can warn when not. */
  keyed?(id: string): boolean;
  /** Test-only (E2E_TEST_HOOKS=1): lets a browser test crash the workspace's agent server. Never set in production. */
  testHooks?: boolean;
}

const HOP = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length"];

/**
 * Map a request path under `/api/playgrounds/:id/agent` to the upstream path, or null if it
 * is not allowed (outside /api/, traversal, encoded separators, control chars).
 */
/**
 * Upstream surfaces a browser must never reach: they hand back or change the model key
 * (GET /api/credential returns the key in plaintext, verified on 2.4.1; /api/config and /api/model*
 * echo provider settings; /api/integration/* connects keys). The chat panel needs none of them
 * and the API itself talks to the server directly when it installs the seat key.
 */
const BLOCKED = /^\/api\/(credential|integration|config|provider|model|experimental\/config)(\/|$)/i;

export function upstreamPath(id: string, pathname: string): string | null {
  const prefix = `/api/playgrounds/${id}/agent`;
  if (!pathname.startsWith(`${prefix}/api/`)) return null;
  const rest = pathname.slice(prefix.length); // "/api/..."
  if (/%(2f|5c|00)/i.test(rest) || /[\\\u0000-\u001f]/.test(rest)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(rest); } catch { return null; }
  if (decoded.includes("\\") || decoded.split("/").some((s) => s === ".." || s === ".")) return null;
  if (rest.includes("//")) return null;
  if (BLOCKED.test(decoded)) return null;
  return rest;
}

/** Headers for the upstream request: client credentials dropped, server credentials injected. */
export function upstreamHeaders(incoming: Headers, t: AgentTarget): Headers {
  const h = new Headers(incoming);
  for (const k of HOP) h.delete(k);
  h.delete("authorization");
  h.delete("cookie");
  h.set("authorization", t.authorization);
  h.set("accept-encoding", "identity"); // relay bytes untouched (SSE frames must not be re-chunked by a decompressor)
  return h;
}

function stream(res: Response): Response {
  const h = new Headers(res.headers);
  h.delete("set-cookie"); // upstream must never set cookies on our origin
  h.delete("content-encoding");
  if ((h.get("content-type") ?? "").includes("text/event-stream")) {
    h.set("cache-control", "no-cache, no-transform");
    h.set("x-accel-buffering", "no");
  }
  let body: BodyInit | null = res.body;
  if (res.body && (h.get("content-type") ?? "").includes("text/event-stream")) {
    // When the agent server dies mid-stream the upstream body errors. End OUR response cleanly instead of aborting
    // it: an abrupt close can be swallowed by an intermediate proxy (the dev proxy keeps the socket open), leaving the
    // browser's stream silently dead. A clean end makes the client reconnect, learn the server is gone and recover.
    const reader = res.body.getReader();
    body = new ReadableStream({
      async pull(c) {
        try { const { done, value } = await reader.read(); if (done) c.close(); else c.enqueue(value); }
        catch { try { c.close(); } catch { /* already closed */ } }
      },
      cancel(reason) { return reader.cancel(reason).catch(() => {}); },
    });
  }
  return new Response(body, { status: res.status, statusText: res.statusText, headers: h });
}

export function agentRoutes(deps: AgentRouteDeps) {
  const r = new Hono();
  const gate = async (c: any) => {
    const a = await deps.access(c.req.raw.headers, c.req.param("id"));
    if (a === "missing") return c.json({ error: "playground not found" }, 404);
    if (a === "denied") return c.json({ error: "not your workspace" }, 403);
    return null;
  };

  r.get("/api/playgrounds/:id/agent", async (c) => {
    const denied = await gate(c);
    if (denied) return denied;
    const id = c.req.param("id");
    return c.json({ ...(await deps.servers.status(id)), keyed: deps.keyed?.(id) ?? false });
  });

  r.post("/api/playgrounds/:id/agent", async (c) => {
    const denied = await gate(c);
    if (denied) return denied;
    try {
      const id = c.req.param("id");
      return c.json({ ...(await deps.servers.start(id)), keyed: deps.keyed?.(id) ?? false });
    } catch (err) {
      return c.json({ error: (err as Error).message, state: "unhealthy" }, 503);
    }
  });

  if (deps.testHooks) {
    // Simulates a crash / hibernate for the resilience e2e: the server process is killed, nothing else changes.
    r.post("/api/playgrounds/:id/agent/_test/kill", async (c) => {
      const denied = await gate(c);
      if (denied) return denied;
      await deps.servers.crash(c.req.param("id"));
      return c.json({ ok: true });
    });
  }

  r.all("/api/playgrounds/:id/agent/*", async (c) => {
    const denied = await gate(c);
    if (denied) return denied;
    const id = c.req.param("id");
    const url = new URL(c.req.url);
    const path = upstreamPath(id, url.pathname);
    if (path === null) return c.json({ error: "not found" }, 404);
    const t = await deps.servers.target(id);
    if (!t) return c.json({ error: "agent server is not running", state: "stopped" }, 503);
    const method = c.req.method;
    const init: RequestInit & { duplex?: string } = {
      method,
      headers: upstreamHeaders(c.req.raw.headers, t),
      redirect: "manual",
      signal: c.req.raw.signal, // client gone (e.g. SSE tab closed) => upstream request is cancelled
    };
    if (method !== "GET" && method !== "HEAD") {
      init.body = c.req.raw.body;
      init.duplex = "half";
    }
    try {
      return stream(await fetch(`${t.origin}${path}${url.search}`, init));
    } catch {
      return c.json({ error: "agent server stopped responding", state: "unhealthy" }, 502);
    }
  });
  return r;
}
