import { describe, expect, test } from "bun:test";
import { agentRoutes } from "../src/agent-proxy";
import { AGENT_SERVER_CONFIG, agentServerConfigJson } from "../src/agent-policy";
import type { AgentServers } from "../src/agent-server";

// Upstream stand-in: sends one SSE frame, then its connection dies (the agent server was killed).
function dyingSse() {
  return Bun.serve({
    port: 0,
    fetch() {
      let sent = false;
      const body = new ReadableStream({
        pull(c) {
          if (!sent) { sent = true; c.enqueue(new TextEncoder().encode('data: {"type":"server.connected"}\n\n')); return; }
          return new Promise((_r, rej) => setTimeout(() => rej(new Error("socket closed")), 50));
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    },
  });
}
const routes = (port: number, testHooks?: boolean) => {
  const crashed: string[] = [];
  const servers = {
    target: async () => ({ origin: `http://127.0.0.1:${port}`, host: "127.0.0.1", port, authorization: "Basic x" }),
    crash: async (id: string) => { crashed.push(id); },
    status: async () => ({ state: "healthy" }),
  } as unknown as AgentServers;
  return { app: agentRoutes({ servers, access: async () => "ok", testHooks }), crashed };
};

describe("agent proxy: upstream dies mid-stream", () => {
  test("the event stream ends cleanly (so the browser reconnects), it is not aborted", async () => {
    const up = dyingSse();
    try {
      const { app } = routes(up.port);
      const res = await app.request("/api/playgrounds/p1/agent/api/event");
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const reader = res.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain("server.connected");
      const end = await reader.read(); // would throw if the upstream error leaked through
      expect(end.done).toBe(true);
    } finally { up.stop(true); }
  });
});

describe("test hook", () => {
  test("the crash endpoint exists only when test hooks are on", async () => {
    const off = routes(1);
    expect((await off.app.request("/api/playgrounds/p1/agent/_test/kill", { method: "POST" })).status).toBe(404); // falls into the proxy: not an /api/ path
    expect(off.crashed).toEqual([]);
    const on = routes(1, true);
    const r = await on.app.request("/api/playgrounds/p1/agent/_test/kill", { method: "POST" });
    expect(r.status).toBe(200);
    expect(on.crashed).toEqual(["p1"]);
  });
});

describe("workspace policy for the agent server", () => {
  test("refuses paths outside the workspace, single-line JSON safe inside single quotes", () => {
    expect(AGENT_SERVER_CONFIG.permission.external_directory).toBe("deny");
    const j = agentServerConfigJson();
    expect(JSON.parse(j).permission.external_directory).toBe("deny");
    expect(j).not.toContain("'");
    expect(j).not.toContain("\n");
  });
});
