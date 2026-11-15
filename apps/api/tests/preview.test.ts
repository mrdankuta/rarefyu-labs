import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { app } from "../src/app";
import { driver } from "../src/drivers";
import { clearPlaygrounds } from "../src/playgrounds";
import { signPreview } from "../src/preview";
import { startServer } from "../src/server";

const OWNER = { "x-session-key": "pv-owner", "x-forwarded-for": "192.0.2.77" };
const OTHER = { "x-session-key": "pv-other", "x-forwarded-for": "192.0.2.78" };
beforeEach(() => clearPlaygrounds());

async function newPg() {
  const r = await app.request("/api/playgrounds", { method: "POST", headers: { "content-type": "application/json", ...OWNER }, body: "{}" });
  return (await r.json()).id as string;
}
const preview = (id: string, port: number, who = OWNER) => app.request(`/api/playgrounds/${id}/preview?port=${port}`, { headers: who });

// A stand-in for the learner's dev server (a real listening socket the driver can reach).
const appServer = Bun.serve({
  port: 0,
  fetch(req, srv) {
    const u = new URL(req.url);
    if (u.pathname === "/ws" && srv.upgrade(req)) return undefined as unknown as Response;
    if (u.pathname === "/echo" && req.method === "POST") return req.text().then((t) => new Response(`got:${t}`));
    if (u.pathname === "/cookie") return new Response(req.headers.get("cookie") ?? "no-cookie");
    return new Response(`hello from app ${u.pathname}${u.search}`, { headers: { "content-type": "text/plain" } });
  },
  websocket: { message(ws, m) { ws.send(`echo:${m}`); } },
});
const PORT = appServer.port as number;
const api = startServer(0);
afterAll(() => { appServer.stop(true); api.stop(true); });

describe("preview proxy", () => {
  test("waiting until the app is up, then live with a signed URL", async () => {
    const id = await newPg();
    const waiting = await (await preview(id, 39998)).json();
    expect(waiting.ready).toBe(false);
    expect(waiting.hint).toContain("39998");
    const live = await (await preview(id, PORT)).json();
    expect(live.ready).toBe(true);
    expect(live.url).toMatch(/^\/preview\/.+\.[\w-]+\/$/);
    const page = await app.request(`${live.url}index.html?x=1`);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("hello from app /index.html?x=1");
    await driver.destroy(id);
  });

  test("any port the learner picks works; invalid ports are rejected", async () => {
    const id = await newPg();
    expect((await preview(id, 0)).status).toBe(400);
    expect((await preview(id, 70000)).status).toBe(400);
    await driver.destroy(id);
  });

  test("POST bodies pass through and the platform cookie is not leaked to the app", async () => {
    const id = await newPg();
    const { url } = await (await preview(id, PORT)).json();
    const post = await app.request(`${url}echo`, { method: "POST", body: "ping" });
    expect(await post.text()).toBe("got:ping");
    const ck = await app.request(`${url}cookie`, { headers: { cookie: "session=secret" } });
    expect(await ck.text()).toBe("no-cookie");
    await driver.destroy(id);
  });

  test("tampered, expired or malformed tokens are rejected", async () => {
    const id = await newPg();
    const good = signPreview(id, PORT);
    expect((await app.request(`/preview/${good}x/`)).status).toBe(403);
    expect((await app.request(`/preview/garbage/`)).status).toBe(403);
    expect((await app.request(`/preview/${signPreview(id, PORT, -5)}/`)).status).toBe(403);
    // a token for port A cannot be edited into port B
    const [payload, sig] = good.split(".");
    const forged = Buffer.from(Buffer.from(payload, "base64url").toString().replace(`:${PORT}:`, ":22:")).toString("base64url");
    expect((await app.request(`/preview/${forged}.${sig}/`)).status).toBe(403);
    await driver.destroy(id);
  });

  test("another user cannot mint a preview for my workspace", async () => {
    process.env.ENFORCE_OWNERSHIP = "1";
    const id = await newPg();
    expect((await preview(id, PORT, OTHER)).status).toBe(403);
    expect((await preview(id, PORT, OWNER)).status).toBe(200);
    process.env.ENFORCE_OWNERSHIP = "0";
    await driver.destroy(id);
  });

  test("links die with the workspace", async () => {
    const id = await newPg();
    const { url } = await (await preview(id, PORT)).json();
    await app.request(`/api/playgrounds/${id}`, { method: "DELETE" });
    expect((await app.request(url)).status).toBe(404);
  });

  test("websocket upgrade is relayed (hot reload works)", async () => {
    const id = await newPg();
    const { url } = await (await preview(id, PORT)).json();
    const ws = new WebSocket(`ws://localhost:${api.port}${url}ws`);
    const got = await new Promise<string>((resolve, reject) => {
      ws.onopen = () => ws.send("hi");
      ws.onmessage = (e) => resolve(String(e.data));
      ws.onerror = () => reject(new Error("ws error"));
      setTimeout(() => reject(new Error("timeout")), 4000);
    });
    expect(got).toBe("echo:hi");
    ws.close();
    // bad token cannot upgrade
    const bad = new WebSocket(`ws://localhost:${api.port}/preview/nope/ws`);
    const failed = await new Promise<boolean>((r) => { bad.onerror = () => r(true); bad.onopen = () => r(false); });
    expect(failed).toBe(true);
    await driver.destroy(id);
  });
});
