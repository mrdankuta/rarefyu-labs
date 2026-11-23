#!/usr/bin/env bun
// Tiny stand-in for `opencode serve` (the real binary is 275 MB): same flags, same
// Basic-auth rule (username "opencode", password from OPENCODE_SERVER_PASSWORD),
// same /api/info, /api/event (SSE), /api/session, /api/pty websocket shapes.
// Extra /api/_stub/* endpoints let tests observe what the proxy actually forwarded.
const argv = process.argv.slice(2);
const flag = (n: string) => argv[argv.indexOf(`--${n}`) + 1];
const password = process.env.OPENCODE_SERVER_PASSWORD ?? "";
const connected: string[] = [];
const expected = `Basic ${btoa(`opencode:${password}`)}`;

Bun.serve({
  hostname: flag("hostname") ?? "127.0.0.1",
  port: Number(flag("port") ?? 4096),
  idleTimeout: 0,
  fetch(req, server) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return new Response("<html>stock UI</html>", { headers: { "content-type": "text/html" } });
    if (!password || req.headers.get("authorization") !== expected) return new Response("unauthorized", { status: 401 });
    if (url.pathname === "/api/info") return Response.json({ version: "0.0.0-stub", name: "fake-opencode" });
    if (url.pathname === "/api/location") return Response.json(process.cwd());
    if (url.pathname === "/api/session") return Response.json([]);
    if (url.pathname === "/api/_stub/echo")
      return Response.json({
        authorization: req.headers.get("authorization"), cookie: req.headers.get("cookie"), host: req.headers.get("host"),
        method: req.method, path: url.pathname + url.search, home: process.env.HOME, cwd: process.cwd(),
        user: process.env.USER ?? null, body: req.method === "GET" ? null : undefined,
      });
    if (url.pathname === "/api/credential") return Response.json({ data: [] });
    if (url.pathname.endsWith("/connect/key") && req.method === "POST") { connected.push(url.pathname.split("/")[3]!); return Response.json({}); }
    if (url.pathname === "/api/_stub/connected") return Response.json(connected);
    if (url.pathname === "/api/_stub/body") return req.text().then((t) => new Response(`got:${t}`));
    if (url.pathname === "/api/event") {
      const enc = new TextEncoder();
      let n = 0;
      let timer: ReturnType<typeof setInterval>;
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(enc.encode(`data: ${JSON.stringify({ type: "server.connected" })}\n\n`));
            timer = setInterval(() => c.enqueue(enc.encode(`data: ${JSON.stringify({ type: "tick", n: ++n })}\n\n`)), 300);
          },
          cancel() { clearInterval(timer); },
        }),
        { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } },
      );
    }
    if (url.pathname.startsWith("/api/pty/") && req.headers.get("upgrade") === "websocket")
      return server.upgrade(req) ? undefined : new Response("no", { status: 500 });
    return new Response("not found", { status: 404 });
  },
  websocket: { message(ws, m) { ws.send(`echo:${m}`); } },
});
