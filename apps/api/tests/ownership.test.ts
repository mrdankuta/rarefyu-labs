import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { app } from "../src/app";
import { driver } from "../src/drivers";
import { clearPlaygrounds } from "../src/playgrounds";
import { startServer } from "../src/server";

beforeAll(() => { process.env.ENFORCE_OWNERSHIP = "1"; });
afterAll(() => { process.env.ENFORCE_OWNERSHIP = "0"; api.stop(true); });
beforeEach(() => clearPlaygrounds());
const api = startServer(0);

const json = { "content-type": "application/json" };
const create = (headers: Record<string, string> = {}, body: unknown = {}) =>
  app.request("/api/playgrounds", { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify(body) });
const cookieFrom = (res: Response) => /rfy_sid=([\w-]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];

describe("anonymous ownership (server-issued cookie)", () => {
  test("first visit gets an httpOnly identity cookie that owns the workspace", async () => {
    const res = await create({ "x-forwarded-for": "198.51.100.5" });
    expect(res.status).toBe(201);
    const sc = res.headers.get("set-cookie") ?? "";
    expect(sc).toMatch(/rfy_sid=/);
    expect(sc.toLowerCase()).toContain("httponly");
    const id = (await res.json()).id;
    const sid = cookieFrom(res)!;

    const mine = await app.request(`/api/playgrounds/${id}/files`, { headers: { cookie: `rfy_sid=${sid}` } });
    expect(mine.status).toBe(200);
    const stranger = await app.request(`/api/playgrounds/${id}/files`, { headers: { cookie: "rfy_sid=someone-else" } });
    expect(stranger.status).toBe(403);
    const nobody = await app.request(`/api/playgrounds/${id}/files`);
    expect(nobody.status).toBe(403);
    await driver.destroy(id);
  });

  test("two students behind the same IP each get their own workspace", async () => {
    const a = await create({ "x-forwarded-for": "203.0.113.50" });
    const b = await create({ "x-forwarded-for": "203.0.113.50" });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(cookieFrom(a)).not.toBe(cookieFrom(b));
    await driver.destroy((await a.json()).id);
    await driver.destroy((await b.json()).id);
  });

  test("every workspace route rejects other users, including destroy, layout, preview and agent", async () => {
    const res = await create();
    const id = (await res.json()).id;
    const other = { cookie: "rfy_sid=attacker" };
    for (const [method, path] of [
      ["GET", ""], ["DELETE", ""], ["GET", "/layout"], ["PUT", "/layout"], ["GET", "/files"],
      ["PUT", "/files/content"], ["GET", "/preview?port=3000"], ["GET", "/snapshot.tar"], ["POST", "/agent/run"], ["POST", "/check"],
    ]) {
      const r = await app.request(`/api/playgrounds/${id}${path}`, { method, headers: { ...json, ...other }, body: method === "GET" || method === "DELETE" ? undefined : "{}" });
      expect([method, path, r.status]).toEqual([method, path, 403]);
    }
    await driver.destroy(id);
  });

  test("terminal websocket rejects strangers and admits the owner", async () => {
    const res = await create();
    const id = (await res.json()).id;
    const sid = cookieFrom(res)!;
    const open = (cookie: string) =>
      new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`ws://localhost:${api.port}/ws/terminal?session=${id}&term=t1`, { headers: { cookie } } as never);
        ws.onopen = () => { ws.close(); resolve(true); };
        ws.onerror = () => resolve(false);
        setTimeout(() => resolve(false), 3000);
      });
    expect(await open("rfy_sid=attacker")).toBe(false);
    expect(await open(`rfy_sid=${sid}`)).toBe(true);
    await driver.destroy(id);
  });
});

describe("guided labs need login; user-owned workspaces", () => {
  test("guided mode requires sign-in", async () => {
    const r = await create({}, { mode: "guided" });
    expect(r.status).toBe(401);
    expect((await r.json()).error).toMatch(/sign in/i);
  });

  test("a signed-in user owns their workspace across devices; others are rejected", async () => {
    const res = await create({ "x-test-user": "alice" }, { mode: "guided" });
    expect(res.status).toBe(201);
    const rec = await res.json();
    expect(rec.mode).toBe("guided");
    expect(res.headers.get("set-cookie")).toBeNull();
    // alice from another device (no cookie, other IP) still has access
    const phone = await app.request(`/api/playgrounds/${rec.id}`, { headers: { "x-test-user": "alice", "x-forwarded-for": "10.1.1.1" } });
    expect(phone.status).toBe(200);
    const bob = await app.request(`/api/playgrounds/${rec.id}`, { headers: { "x-test-user": "bob" } });
    expect(bob.status).toBe(403);
    const anon = await app.request(`/api/playgrounds/${rec.id}`);
    expect(anon.status).toBe(403);
    await driver.destroy(rec.id);
  });

  test("ownerKey never leaks in responses", async () => {
    const res = await create({ "x-test-user": "carol" }, { mode: "guided" });
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("ownerKey");
    await driver.destroy(body.id);
  });
});

describe("reattach", () => {
  test("returning to the app finds my live workspace instead of making a new one", async () => {
    const res = await create();
    const id = (await res.json()).id;
    const sid = cookieFrom(res)!;
    const cur = await app.request("/api/workspaces/current", { headers: { cookie: `rfy_sid=${sid}` } });
    expect(cur.status).toBe(200);
    expect((await cur.json()).id).toBe(id);
    // creating again offers the existing one
    const again = await create({ cookie: `rfy_sid=${sid}` });
    expect(again.status).toBe(429);
    expect((await again.json()).existingId).toBe(id);
    // a different visitor has none
    expect((await app.request("/api/workspaces/current", { headers: { cookie: "rfy_sid=other" } })).status).toBe(404);
    await driver.destroy(id);
  });

  test("a signed-in user is found by user id on any device", async () => {
    const res = await create({ "x-test-user": "dana" }, { mode: "guided" });
    const id = (await res.json()).id;
    const cur = await app.request("/api/workspaces/current", { headers: { "x-test-user": "dana", "x-forwarded-for": "10.9.9.9" } });
    expect((await cur.json()).id).toBe(id);
    await driver.destroy(id);
  });
});

describe("IPv6 clients (e.g. a reverse proxy on ::1)", () => {
  test("ownership and per-IP counting work when the client address contains '::'", async () => {
    const res = await create({ "x-forwarded-for": "::1" });
    expect(res.status).toBe(201);
    const id = (await res.json()).id;
    const sid = cookieFrom(res)!;
    expect((await app.request(`/api/playgrounds/${id}/layout`, { headers: { cookie: `rfy_sid=${sid}` } })).status).toBe(200);
    expect((await app.request(`/api/playgrounds/${id}/layout`, { headers: { cookie: "rfy_sid=other" } })).status).toBe(403);
    const v6 = await create({ "x-forwarded-for": "2001:db8::7" });
    expect(v6.status).toBe(201);
    const id2 = (await v6.json()).id;
    expect((await app.request(`/api/playgrounds/${id2}/layout`, { headers: { cookie: `rfy_sid=${cookieFrom(v6)}` } })).status).toBe(200);
    await driver.destroy(id);
    await driver.destroy(id2);
  });
});
