import { app } from "./app";

const port = Number(process.env.API_PORT ?? 3000);

/**
 * Bun serves the Hono app and upgrades /ws/terminal to WebSocket.
 * Slice 3 replaces the echo handler with the tmux-backed PTY relay.
 */
const server = Bun.serve({
  port,
  fetch(req: any, server: any) {
    const url = new URL(req.url);
    if (url.pathname === "/ws/terminal") {
      if (server.upgrade(req)) return undefined as unknown as Response;
      return new Response("websocket upgrade failed", { status: 426 });
    }
    return app.fetch(req);
  },
  websocket: {
    open(ws: any) {
      ws.send(JSON.stringify({ type: "ready", note: "stub relay (slice 3: pty)" }));
    },
    message(ws: any, message: any) {
      ws.send(
        typeof message === "string" ? `echo: ${message}` : message,
      );
    },
  },
});

console.log(`api listening on :${server.port}`);
