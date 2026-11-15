import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { app } from "../src/app";
import { driver } from "../src/drivers";
import { clearPlaygrounds, getPlayground } from "../src/playgrounds";
import { reconcile } from "../src/reconcile";

beforeEach(() => clearPlaygrounds());
afterEach(() => { delete process.env.ADMIN_TOKEN; });

const create = (key: string, ip = "192.0.2.50") =>
  app.request("/api/playgrounds", {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-key": key, "x-forwarded-for": ip },
    body: "{}",
  });

describe("reconciler", () => {
  test("destroys workspaces the session store doesn't know about", async () => {
    const ghost = `ghost-${crypto.randomUUID().slice(0, 8)}`;
    await driver.create(ghost); // e.g. left behind by a crash/restart
    expect(await driver.list()).toContain(ghost);
    const r = await reconcile();
    expect(r.orphansDestroyed).toContain(ghost);
    expect(await driver.list()).not.toContain(ghost);
  });

  test("leaves live workspaces alone", async () => {
    const res = await create("keep");
    const id = (await res.json()).id;
    const r = await reconcile();
    expect(r.orphansDestroyed).not.toContain(id);
    expect(await driver.list()).toContain(id);
    await driver.destroy(id);
  });

  test("marks a record whose workspace vanished as gone, with a reason", async () => {
    const res = await create("lost");
    const id = (await res.json()).id;
    await driver.destroy(id); // workspace disappears behind our back
    getPlayground(id)!.createdAt = new Date(Date.now() - 120_000).toISOString(); // past the grace window
    const r = await reconcile();
    expect(r.lost).toContain(id);
    const rec = await (await app.request(`/api/playgrounds/${id}`)).json();
    expect(rec.status).toBe("destroyed");
    expect(rec.lostReason).toMatch(/missing/);
  });

  test("admin endpoint runs a pass", async () => {
    const ghost = `ghost-${crypto.randomUUID().slice(0, 8)}`;
    await driver.create(ghost);
    const r = await app.request("/api/admin/reconcile", { method: "POST" });
    expect((await r.json()).orphansDestroyed).toContain(ghost);
  });
});

describe("kill switch", () => {
  test("destroys every workspace, including ones with no record, and can pause creation", async () => {
    const a = (await (await create("a", "192.0.2.1")).json()).id;
    const ghost = `ghost-${crypto.randomUUID().slice(0, 8)}`;
    await driver.create(ghost);
    const t0 = Date.now();
    const res = await app.request("/api/playgrounds?pause=1", { method: "DELETE" });
    expect(Date.now() - t0).toBeLessThan(60_000);
    const body = await res.json();
    expect(body.paused).toBe(true);
    const held = await driver.list();
    expect(held).not.toContain(a);
    expect(held).not.toContain(ghost);
    const blocked = await create("late", "192.0.2.9");
    expect(blocked.status).toBe(503);
    expect((await blocked.json()).code).toBe("paused");
  });

  test("creation can be resumed", async () => {
    await app.request("/api/admin/creation", { method: "POST", headers: { "content-type": "application/json" }, body: '{"paused":true}' });
    expect((await create("x")).status).toBe(503);
    await app.request("/api/admin/creation", { method: "POST", headers: { "content-type": "application/json" }, body: '{"paused":false}' });
    const ok = await create("x");
    expect(ok.status).toBe(201);
    await driver.destroy((await ok.json()).id);
  });

  test("with ADMIN_TOKEN set, operator endpoints need the bearer token", async () => {
    process.env.ADMIN_TOKEN = "s3cret";
    expect((await app.request("/api/playgrounds", { method: "DELETE" })).status).toBe(401);
    expect((await app.request("/api/admin/reconcile", { method: "POST" })).status).toBe(401);
    const ok = await app.request("/api/playgrounds", { method: "DELETE", headers: { authorization: "Bearer s3cret" } });
    expect(ok.status).toBe(200);
  });
});
