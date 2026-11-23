import { agentAccess, agentServers, app, canAccess } from "./app";
import { upstreamPath } from "./agent-proxy";
import { getPlayground } from "./playgrounds";
import { driver } from "./drivers";
import { resolvePreviewTarget } from "./preview-proxy";

type Relay = { target: string; authorization?: string; upstream?: WebSocket; queue: (string | ArrayBuffer | Uint8Array)[] };
type WsData = { kind: "terminal"; session: string; term: string } | ({ kind: "preview" } & Relay) | ({ kind: "agent" } & Relay);

/**
 * HTTP + WebSocket server.
 *  /ws/terminal?session=<id>&term=<termId>  terminal relay (refresh-safe: reattach resumes the shell)
 *  /preview/<token>/...  (Upgrade: websocket)  relay to the app inside the workspace (hot reload etc.)
 *  /api/playgrounds/<id>/agent/api/...  (Upgrade: websocket)  owner-checked relay to the workspace's agent
 *    server (PTY etc.); the server password is injected here and never leaves the API.
 */
export function startServer(port: number) {
  return Bun.serve({
    port,
    idleTimeout: 120, // SSE relays: bound idle sockets, well above the agent server's heartbeat interval
    async fetch(req: any, server: any) {
      const url = new URL(req.url);
      const am = /^\/api\/playgrounds\/([^/]+)\/agent\/api\//.exec(url.pathname);
      if (am && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const id = decodeURIComponent(am[1]!);
        const a = await agentAccess(req.headers, id);
        if (a !== "ok") return new Response(a === "missing" ? "playground not found" : "not your workspace", { status: a === "missing" ? 404 : 403 });
        const path = upstreamPath(id, url.pathname);
        const t = await agentServers.target(id);
        if (path === null) return new Response("not found", { status: 404 });
        if (!t) return new Response("agent server is not running", { status: 503 });
        const data: WsData = { kind: "agent", target: `ws://${t.host}:${t.port}${path}${url.search}`, authorization: t.authorization, queue: [] };
        if (server.upgrade(req, { data })) return undefined as unknown as Response;
        return new Response("websocket upgrade failed", { status: 426 });
      }
      if (url.pathname === "/ws/terminal") {
        const session = url.searchParams.get("session") ?? "";
        const term = url.searchParams.get("term") ?? "main";
        const rec = getPlayground(session);
        if (rec && !(await canAccess(req.headers, rec))) return new Response("not your workspace", { status: 403 });
        const data: WsData = { kind: "terminal", session, term };
        if (server.upgrade(req, { data })) return undefined as unknown as Response;
        return new Response("websocket upgrade failed", { status: 426 });
      }
      if (url.pathname.startsWith("/preview/") && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const [, , token, ...rest] = url.pathname.split("/");
        const t = await resolvePreviewTarget(token ?? "");
        if ("error" in t) return new Response(t.error, { status: t.status });
        const data: WsData = {
          kind: "preview",
          target: `ws://${t.host}:${t.port}/${rest.join("/")}${url.search}`,
          queue: [],
        };
        if (server.upgrade(req, { data })) return undefined as unknown as Response;
        return new Response("websocket upgrade failed", { status: 426 });
      }
      return app.fetch(req);
    },
    websocket: {
      async open(ws: any) {
        const data = ws.data as WsData;
        if (data.kind === "preview" || data.kind === "agent") {
          const up = data.authorization
            ? new WebSocket(data.target, { headers: { authorization: data.authorization } } as any)
            : new WebSocket(data.target);
          up.binaryType = "arraybuffer";
          data.upstream = up;
          up.onopen = () => {
            for (const m of data.queue) up.send(m as string);
            data.queue.length = 0;
          };
          up.onmessage = (e) => ws.send(e.data as string);
          up.onclose = () => { try { ws.close(); } catch { /* gone */ } };
          up.onerror = () => { try { ws.close(1011, "upstream error"); } catch { /* gone */ } };
          return;
        }
        const { session, term } = data;
        if (!session) {
          ws.send(JSON.stringify({ type: "error", error: "missing ?session=" }));
          ws.close(4400, "missing session");
          return;
        }
        try {
          const handle = await driver.openTerminal(session, term);
          (ws as { __off?: () => void }).__off = handle.onData((d) =>
            ws.send(JSON.stringify({ type: "data", data: d })),
          );
          (ws as { __h?: unknown }).__h = handle;
          ws.send(JSON.stringify({ type: "ready", session, term }));
        } catch (err) {
          ws.send(JSON.stringify({ type: "error", error: (err as Error).message }));
          ws.close(4404, "no such session");
        }
      },
      message(ws: any, message: any) {
        const data = ws.data as WsData;
        if (data.kind === "preview" || data.kind === "agent") {
          if (data.upstream?.readyState === WebSocket.OPEN) data.upstream.send(message);
          else data.queue.push(message);
          return;
        }
        const handle = (ws as { __h?: { write: (d: string) => void } }).__h;
        if (!handle) return;
        try {
          const parsed = JSON.parse(String(message));
          if (typeof parsed.data === "string") handle.write(parsed.data);
          else if (typeof parsed === "string") handle.write(parsed);
        } catch {
          handle.write(typeof message === "string" ? message : "");
        }
      },
      close(ws: any) {
        const data = ws.data as WsData;
        if (data.kind === "preview" || data.kind === "agent") {
          try { data.upstream?.close(); } catch { /* gone */ }
          return;
        }
        // Shell survives: only detach the subscriber (tmux-persistent).
        (ws as { __off?: () => void }).__off?.();
      },
    },
  });
}
