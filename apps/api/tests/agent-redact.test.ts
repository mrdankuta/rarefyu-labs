import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { agentRoutes } from "../src/agent-proxy";
import { createSseRedactor, redactJsonText, redactValue, scrubString } from "../src/agent-redact";

const RAW = '{"error":{"message":"Insufficient balance. Manage your billing here: https://opencode.ai/workspace/wrk_01ABCxyz/billing"}}';
const err = (over: object = {}) => ({ type: "provider.go-limit", message: "Free usage exceeded, see https://opencode.ai/workspace/wrk_01ABCxyz/go", status: 429, response: { status: 429, url: "https://opencode.ai/zen/v1/chat/completions", headers: { "x-wrk": "wrk_01ABCxyz" }, body: RAW }, ...over });

describe("redaction (pure)", () => {
  test("response.body is replaced, keeping only the quota keyword the panel classifies on", () => {
    const out: any = redactValue({ error: err() });
    expect(out.error.response.body).toBe("[redacted: Insufficient]");
    expect(JSON.stringify(out)).not.toMatch(/wrk_01ABCxyz|opencode\.ai\/workspace|billing here/);
  });
  test("type, status and the message words survive, so 401/402/429/500 and go-limit still classify", () => {
    const out: any = redactValue({ error: err() });
    expect(out.error.type).toBe("provider.go-limit");
    expect(out.error.status).toBe(429);
    expect(out.error.message).toBe("Free usage exceeded, see [link removed]");
    for (const status of [401, 402, 429, 500]) expect((redactValue({ status, response: { body: "nope" } }) as any).status).toBe(status);
    expect((redactValue({ response: { body: "plain" } }) as any).response.body).toBe("[redacted]");
  });
  test("responseBody / responseHeaders, ids anywhere, harmless JSON untouched", () => {
    const o: any = redactValue({ data: [{ responseBody: "out of credit", responseHeaders: { a: "b" }, note: "ws wrk_ABC123 here" }] });
    expect(o.data[0].responseBody).toBe("[redacted: credit]");
    expect(o.data[0].responseHeaders).toEqual({});
    expect(o.data[0].note).toBe("ws wrk_… here");
    expect(redactJsonText('{"a":[1,2,{"b":"c"}]}')).toBe('{"a":[1,2,{"b":"c"}]}');
    expect(redactJsonText("not json wrk_zzz")).toBe("not json wrk_…");
    expect(scrubString("fine")).toBe("fine");
  });
  test("SSE: complete frames pass immediately, partial frames wait, JSON in data lines is scrubbed", () => {
    const r = createSseRedactor();
    const enc = new TextEncoder(), dec = new TextDecoder();
    const frame = `data: ${JSON.stringify({ type: "session.execution.failed", data: { error: err() } })}\n\n`;
    expect(r.push(enc.encode(": heartbeat\n\n"))).not.toBeNull();
    expect(r.push(enc.encode(frame.slice(0, 40)))).toBeNull();
    const out = dec.decode(r.push(enc.encode(frame.slice(40) + "data: {\"x\":1}\n\ndata: {\"par"))!);
    expect(out).not.toMatch(/wrk_01ABCxyz|opencode\.ai\/workspace/);
    expect(out).toContain('"type":"provider.go-limit"');
    expect(out).toContain('data: {"x":1}\n\n');
    expect(out.endsWith("\n\n")).toBe(true);
    expect(dec.decode(r.push(enc.encode('tial":1}\n\n'))!)).toBe('data: {"partial":1}\n\n');
  });
});

// --- through the real proxy route, against a fake upstream -------------------------------------------------------
let upstream: ReturnType<typeof Bun.serve>;
let proxy: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  upstream = Bun.serve({
    port: 0,
    async fetch(req) {
      const p = new URL(req.url).pathname;
      if (p === "/api/session/s1/message") return Response.json({ data: [{ type: "idle", outcome: "failed", error: err() }] });
      if (p === "/api/event") {
        const enc = new TextEncoder();
        let n = 0;
        return new Response(new ReadableStream({
          async pull(c) {
            n++;
            if (n === 1) c.enqueue(enc.encode(`data: ${JSON.stringify({ type: "session.execution.failed", data: { sessionID: "s1", error: err() } })}\n\n`));
            else if (n === 2) { await new Promise((r) => setTimeout(r, 400)); c.enqueue(enc.encode('data: {"type":"late"}\n\n')); }
            else { await new Promise((r) => setTimeout(r, 2000)); c.close(); }
          },
        }), { headers: { "content-type": "text/event-stream" } });
      }
      return new Response("nope", { status: 404 });
    },
  });
  const app = new Hono();
  app.route("/", agentRoutes({
    servers: { target: async () => ({ origin: `http://127.0.0.1:${upstream.port}`, authorization: "Basic x" }), status: async () => ({ state: "healthy" }), start: async () => ({ state: "healthy" }), crash: async () => {} } as any,
    access: async () => "ok",
  }));
  proxy = Bun.serve({ port: 0, fetch: app.fetch });
});
afterAll(() => { upstream?.stop(true); proxy?.stop(true); });

describe("agent proxy redaction", () => {
  test("JSON message list: raw provider body and workspace id never reach the browser", async () => {
    const res = await fetch(`http://127.0.0.1:${proxy.port}/api/playgrounds/p1/agent/api/session/s1/message`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toMatch(/wrk_01ABCxyz|opencode\.ai|billing here/);
    const e = JSON.parse(text).data[0].error;
    expect(e).toMatchObject({ type: "provider.go-limit", status: 429 });
    expect(e.response.body).toBe("[redacted: Insufficient]");
    expect(res.headers.get("content-length")).toBe(String(new TextEncoder().encode(text).length));
  });
  test("SSE: error frame is scrubbed and arrives at once (not held until the stream ends)", async () => {
    const res = await fetch(`http://127.0.0.1:${proxy.port}/api/playgrounds/p1/agent/api/event`);
    const reader = res.body!.getReader();
    const t0 = Date.now();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(Date.now() - t0).toBeLessThan(300); // the upstream's second frame comes after 400ms
    expect(first).not.toMatch(/wrk_01ABCxyz|opencode\.ai\/workspace/);
    expect(first).toContain('"status":429');
    await reader.cancel();
  });
});
