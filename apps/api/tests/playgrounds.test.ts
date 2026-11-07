import { describe, expect, test, beforeEach } from "bun:test";
import { app } from "../src/app";
import { clearPlaygrounds, sweepPlaygrounds } from "../src/playgrounds";

const H = { "content-type": "application/json", "x-session-key": "k1" };

beforeEach(() => clearPlaygrounds());

describe("anonymous playground loop", () => {
  test("create → heartbeat → destroy", async () => {
    const created = await app.request("/api/playgrounds", {
      method: "POST",
      headers: H,
      body: JSON.stringify({}),
    });
    expect(created.status).toBe(201);
    const pg = await created.json();
    expect(pg.mode).toBe("playground");
    expect(pg.backend).toBe("gvisor");
    expect(pg.expiresAt).toBeDefined();

    const hb = await app.request(`/api/playgrounds/${pg.id}/heartbeat`, { method: "POST" });
    expect(hb.status).toBe(200);

    const del = await app.request(`/api/playgrounds/${pg.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);

    const snap = await app.request(`/api/playgrounds/${pg.id}/snapshot`);
    expect(snap.status).toBe(200);
    const sbody = await snap.json();
    expect(sbody.retainedUntil).toBeDefined();
  });

  test("quota: 1 concurrent per IP+cookie → 429", async () => {
    const first = await app.request("/api/playgrounds", {
      method: "POST",
      headers: H,
      body: JSON.stringify({}),
    });
    expect(first.status).toBe(201);
    const second = await app.request("/api/playgrounds", {
      method: "POST",
      headers: H,
      body: JSON.stringify({}),
    });
    expect(second.status).toBe(429);
  });

  test("expiry warns, snapshots, destroys; idle hibernates", async () => {
    const created = await app.request("/api/playgrounds", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ ttlMin: 60 }),
    });
    const pg = await created.json();
    // 46 min in: within 15-min warning window, past 20-min idle
    const r = sweepPlaygrounds(Date.now() + 46 * 60_000);
    expect(r.warned).toBe(1);
    expect(r.hibernated).toBe(1);
    const fetched = await (await app.request(`/api/playgrounds/${pg.id}`)).json();
    expect(fetched.status).toBe("sleeping");
    // past expiry
    const r2 = sweepPlaygrounds(Date.now() + 61 * 60_000);
    expect(r2.destroyed).toBe(1);
    const gone = await (await app.request(`/api/playgrounds/${pg.id}`)).json();
    expect(gone.status).toBe("destroyed");
  });

  test("kill switch nukes all", async () => {
    await app.request("/api/playgrounds", {
      method: "POST",
      headers: H,
      body: JSON.stringify({}),
    });
    await app.request("/api/playgrounds", {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-key": "k2" },
      body: JSON.stringify({}),
    });
    const nuke = await app.request("/api/playgrounds", { method: "DELETE" });
    expect(nuke.status).toBe(200);
    const body = await nuke.json();
    expect(body.destroyed).toBe(2);
  });
});
