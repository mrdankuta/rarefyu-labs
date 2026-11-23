import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { app } from "../src/app";
import { upstreamHeaders, upstreamPath } from "../src/agent-proxy";
import { driver } from "../src/drivers";
import { startServer } from "../src/server";

// Wiring of the agent routes into the real app (ownership middleware, cookies) and the
// websocket relay. The local driver runs the stub opencode via OPENCODE_BIN.
const STUB = new URL("./fixtures/fake-opencode.ts", import.meta.url).pathname;
let api: ReturnType<typeof startServer>;
let id = "";
let cookie = "";
// Playground records count against shared quotas, so tests release theirs.
async function release() {
  if (!id) return;
  await app.request(`/api/playgrounds/${id}`, { method: "DELETE", headers: { cookie } });
  await driver.destroy(id).catch(() => {});
  id = "";
}
// Other suites call clearPlaygrounds() in global hooks, so each test provisions its own workspace.
async function fresh() {
  await release();
  // Own client IP each time: per-IP quotas are shared with every other suite in the process.
  const ip = `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
  const res = await app.request("/api/playgrounds", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: "{}" });
  expect(res.status).toBe(201);
  id = (await res.json()).id;
  cookie = `rfy_sid=${/rfy_sid=([\w-]+)/.exec(res.headers.get("set-cookie") ?? "")![1]}`;
}
const base = () => `http://127.0.0.1:${api.port}`;

beforeAll(async () => {
  if (driver.backend !== "local") return;
  process.env.ENFORCE_OWNERSHIP = "1";
  (driver as unknown as { opencode: string[] }).opencode = [STUB];
  api = startServer(0);
});
afterAll(async () => {
  process.env.ENFORCE_OWNERSHIP = "0";
  await release();
  api?.stop(true);
});

describe("agent proxy in the real app", () => {
  test("POST starts, GET reports, proxy forwards, ownership enforced", async () => {
    await fresh();
    expect((await app.request(`/api/playgrounds/${id}/agent`, { headers: { cookie } })).status).toBe(200);
    const s = await app.request(`/api/playgrounds/${id}/agent`, { method: "POST", headers: { cookie } });
    const started = await s.json();
    expect(started.state).toBe("healthy");
    expect(started.keyed).toBe(false); // an anonymous playground has no class seat
    expect((await app.request(`/api/playgrounds/${id}/agent/api/credential`, { headers: { cookie } })).status).toBe(404);
    const info = await app.request(`/api/playgrounds/${id}/agent/api/info`, { headers: { cookie } });
    expect(info.status).toBe(200);
    for (const h of [{}, { cookie: "rfy_sid=other" }]) {
      expect((await app.request(`/api/playgrounds/${id}/agent`, { headers: h })).status).toBe(403);
      expect((await app.request(`/api/playgrounds/${id}/agent`, { method: "POST", headers: h })).status).toBe(403);
      expect((await app.request(`/api/playgrounds/${id}/agent/api/info`, { headers: h })).status).toBe(403);
    }
  });

  test("the existing agent broker routes are untouched", async () => {
    await fresh();
    const r = await app.request(`/api/playgrounds/${id}/agent/pending`, { headers: { cookie } });
    expect(r.status).toBe(200);
    expect(await r.json()).toHaveProperty("pending");
  });

  test("websocket upgrades relay through the proxy for the owner only", async () => {
    await fresh();
    await app.request(`/api/playgrounds/${id}/agent`, { method: "POST", headers: { cookie } });
    const url = `ws://127.0.0.1:${api.port}/api/playgrounds/${id}/agent/api/pty/p1/connect`;
    const open = (headers: Record<string, string>) =>
      new Promise<WebSocket>((res, rej) => {
        const ws = new WebSocket(url, { headers } as any);
        ws.onopen = () => res(ws);
        ws.onerror = () => rej(new Error("refused"));
      });
    const ws = await open({ cookie });
    const reply = await new Promise<string>((res) => { ws.onmessage = (e) => res(String(e.data)); ws.send("hi"); });
    expect(reply).toBe("echo:hi");
    ws.close();
    await expect(open({ cookie: "rfy_sid=other" })).rejects.toThrow();
    await expect(open({})).rejects.toThrow();
  });
});

describe("path mapping", () => {
  test("only /api/ paths map, traversal and encoded separators do not", () => {
    expect(upstreamPath("w", "/api/playgrounds/w/agent/api/session/1/message")).toBe("/api/session/1/message");
    for (const p of ["/api/playgrounds/w/agent/", "/api/playgrounds/w/agent/openapi.json", "/api/playgrounds/w/agent/api/../x", "/api/playgrounds/w/agent/api/%2e%2e/x", "/api/playgrounds/w/agent/api/a%2fb", "/api/playgrounds/w/agent/api/a\\b", "/api/playgrounds/w/agent/api//x"])
      expect([p, upstreamPath("w", p)]).toEqual([p, null]);
  });
  test("key-bearing upstream surfaces are not reachable (credential store, config, providers, models, integrations)", () => {
    const pre = "/api/playgrounds/w/agent";
    for (const p of ["/api/credential", "/api/credential/cred_1", "/api/integration", "/api/integration/opencode-go/connect/key", "/api/config", "/api/experimental/config", "/api/provider", "/api/provider/x", "/api/model", "/api/model/default", "/api/CREDENTIAL", "/api/%63redential"])
      expect([p, upstreamPath("w", pre + p)]).toEqual([p, null]);
    // what the chat panel needs still maps (note: "/api/modelling" style prefixes are not swept up by accident)
    for (const p of ["/api/session", "/api/session/x/prompt", "/api/session/x/interrupt", "/api/session/active", "/api/event", "/api/info"])
      expect(upstreamPath("w", pre + p)).toBe(p);
  });
  test("client credentials are dropped and server credentials injected", () => {
    const h = upstreamHeaders(new Headers({ authorization: "Basic x", cookie: "a=b", host: "evil", "x-keep": "1" }), { origin: "", host: "", port: 0, authorization: "Basic server" });
    expect(h.get("authorization")).toBe("Basic server");
    expect(h.get("cookie")).toBeNull();
    expect(h.get("host")).toBeNull();
    expect(h.get("x-keep")).toBe("1");
  });
});
