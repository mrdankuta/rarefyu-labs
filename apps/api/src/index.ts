import { app } from "./app";
import { driver } from "./drivers/local";
import { sweepPlaygrounds } from "./playgrounds";

const port = Number(process.env.API_PORT ?? 3000);

// Opportunistic expiry sweep every 60s (a worker owns this in production).
setInterval(() => {
  sweepPlaygrounds();
}, 60_000);

/**
 * WS terminal relay: /ws/terminal?session=<playgroundId>&term=<termId>
 * Streams bytes between the socket and the session shell. Refresh-safe:
 * reattaching with the same ids resumes the same shell with scrollback replay.
 */
const server = Bun.serve({
  port,
  fetch(req: any, server: any) {
    const url = new URL(req.url);
    if (url.pathname === "/ws/terminal") {
      const session = url.searchParams.get("session") ?? "";
      const term = url.searchParams.get("term") ?? "main";
      if (server.upgrade(req, { data: { session, term } })) return undefined as unknown as Response;
      return new Response("websocket upgrade failed", { status: 426 });
    }
    return app.fetch(req);
  },
  websocket: {
    async open(ws: any) {
      const { session, term } = ws.data as { session: string; term: string };
      if (!session) {
        ws.send(JSON.stringify({ type: "error", error: "missing ?session=" }));
        ws.close(4400, "missing session");
        return;
      }
      try {
        const handle = await driver.openTerminal(session, term);
        (ws as { __off?: () => void }).__off = handle.onData((data) =>
          ws.send(JSON.stringify({ type: "data", data })),
        );
        (ws as { __h?: unknown }).__h = handle;
        ws.send(JSON.stringify({ type: "ready", session, term }));
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", error: (err as Error).message }));
        ws.close(4404, "no such session");
      }
    },
    message(ws: any, message: any) {
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
      // Shell survives: only detach the subscriber (tmux-persistent).
      (ws as { __off?: () => void }).__off?.();
    },
  },
});

console.log(`api listening on :${server.port}`);
