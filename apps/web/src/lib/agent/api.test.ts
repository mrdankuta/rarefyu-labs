import { describe, expect, test } from "bun:test";
import { createAgentClient, createSseParser } from "./api";
import { AgentApiError } from "./errors";

describe("createSseParser", () => {
  test("splits frames across arbitrary chunks, skips heartbeats", () => {
    const got: string[] = [];
    const feed = createSseParser((d) => got.push(d));
    feed('data: {"a":1}\n\n: heart');
    feed('beat\n\ndata: {"b"');
    feed(":2}\r\n\r\n");
    expect(got.map((g) => JSON.parse(g))).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe("client paths and error handling", () => {
  const mk = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return handler(url, init); }) as unknown as typeof fetch;
    return { c: createAgentClient({ base: "/api/playgrounds/p1/agent", fetch: f }), calls };
  };
  test("ensure POSTs to the agent route; sendPrompt returns the message id", async () => {
    const { c, calls } = mk((u) => Response.json(u.endsWith("/prompt") ? { data: { id: "msg_1" } } : { state: "healthy" }));
    expect((await c.ensure()).state).toBe("healthy");
    expect(await c.sendPrompt("ses_1", "hi")).toBe("msg_1");
    expect(calls[0]).toMatchObject({ url: "/api/playgrounds/p1/agent", init: { method: "POST" } });
    expect(calls[1]!.url).toBe("/api/playgrounds/p1/agent/api/session/ses_1/prompt");
    expect(JSON.parse(calls[1]!.init!.body as string)).toEqual({ text: "hi" });
  });
  test("history asks for oldest first; active ids filter to running", async () => {
    const { c, calls } = mk((u) => Response.json(u.includes("/active") ? { data: { ses_a: { type: "running" }, ses_b: { type: "idle" } } } : { data: [{ id: "m" }] }));
    await c.listMessages("ses_1");
    expect(calls[0]!.url).toContain("order=asc");
    expect([...(await c.activeSessionIds())]).toEqual(["ses_a"]);
  });
  test("HTTP failures carry status + agent state; fetch rejection is status 0", async () => {
    const a = mk(() => Response.json({ error: "x", state: "stopped" }, { status: 503 }));
    await expect(a.c.ensure()).rejects.toMatchObject({ status: 503, serverState: "stopped" });
    const b = mk(() => { throw new TypeError("offline"); });
    const err = await b.c.createSession().catch((e) => e);
    expect(err).toBeInstanceOf(AgentApiError);
    expect(err.status).toBe(0);
  });
  test("getSession returns null for a missing session", async () => {
    const { c } = mk(() => Response.json({}, { status: 404 }));
    expect(await c.getSession("ses_gone")).toBeNull();
  });
  test("subscribe reconnects after a drop and asks for a resync", async () => {
    let n = 0;
    const states: string[] = [];
    let resync = 0;
    const enc = new TextEncoder();
    const f = (async () => {
      n++;
      if (n === 1) return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode('data: {"type":"x"}\n\n')); c.close(); } }));
      return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode('data: {"type":"y"}\n\n')); } }));
    }) as unknown as typeof fetch;
    const c = createAgentClient({ base: "/b", fetch: f });
    const seen: string[] = [];
    const off = c.subscribe({ onEvent: (e) => seen.push(e.type), onState: (s) => states.push(s), onReconnect: () => resync++ });
    await Bun.sleep(1200);
    off();
    expect(seen).toEqual(["x", "y"]);
    expect(resync).toBe(1);
    expect(states).toContain("reconnecting");
  });
});
