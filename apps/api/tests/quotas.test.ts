import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { app } from "../src/app";
import { driver } from "../src/drivers";
import { clearPlaygrounds } from "../src/playgrounds";

beforeEach(() => clearPlaygrounds());
afterEach(() => {
  delete process.env.MAX_WORKSPACES_PER_OWNER;
  delete process.env.MAX_WORKSPACES_PER_IP;
  delete process.env.MAX_WORKSPACES_GLOBAL;
});

const create = (ip: string, key: string) =>
  app.request("/api/playgrounds", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, "x-session-key": key },
    body: "{}",
  });
const cleanup = async (res: Response[]) => {
  for (const r of res) if (r.status === 201) await driver.destroy((await r.clone().json()).id);
};

describe("quotas and capacity", () => {
  test("per-IP cap rejects extra workspaces from one network with a clear error", async () => {
    process.env.MAX_WORKSPACES_PER_IP = "2";
    const a = await create("198.51.100.1", "a");
    const b = await create("198.51.100.1", "b");
    const c = await create("198.51.100.1", "c");
    expect([a.status, b.status, c.status]).toEqual([201, 201, 429]);
    expect((await c.json()).code).toBe("quota_ip");
    const other = await create("198.51.100.2", "z");
    expect(other.status).toBe(201);
    await cleanup([a, b, other]);
  });

  test("global cap returns a retryable 503 with Retry-After", async () => {
    process.env.MAX_WORKSPACES_GLOBAL = "2";
    const a = await create("203.0.113.1", "a");
    const b = await create("203.0.113.2", "b");
    const c = await create("203.0.113.3", "c");
    expect([a.status, b.status, c.status]).toEqual([201, 201, 503]);
    expect(c.headers.get("retry-after")).toBe("30");
    const body = await c.json();
    expect(body.code).toBe("at_capacity");
    expect(body.retryAfterSec).toBe(30);
    expect(body.error).toMatch(/at capacity/i);
    await cleanup([a, b]);
  });

  test("hibernated workspaces free global capacity", async () => {
    process.env.MAX_WORKSPACES_GLOBAL = "1";
    const { runLifecycle } = await import("../src/lifecycle");
    const a = await create("203.0.113.1", "a");
    expect((await create("203.0.113.2", "b")).status).toBe(503);
    await runLifecycle(Date.now() + 21 * 60_000); // a goes idle → sleeping
    const c = await create("203.0.113.3", "c");
    expect(c.status).toBe(201);
    await cleanup([a, c]);
  });

  test("destroying a workspace frees its slot; failed provisioning does too", async () => {
    process.env.MAX_WORKSPACES_GLOBAL = "1";
    const a = await create("203.0.113.1", "a");
    const id = (await a.clone().json()).id;
    expect((await create("203.0.113.2", "b")).status).toBe(503);
    await app.request(`/api/playgrounds/${id}`, { method: "DELETE" });
    const b = await create("203.0.113.2", "b");
    expect(b.status).toBe(201);
    await cleanup([b]);
  });

  test("per-owner cap still offers the owner their existing session", async () => {
    const a = await create("192.0.2.1", "me");
    const again = await create("192.0.2.1", "me");
    expect(again.status).toBe(429);
    const body = await again.json();
    expect(body.code).toBe("quota_owner");
    expect(body.existingId).toBe((await a.clone().json()).id);
    await cleanup([a]);
  });
});
