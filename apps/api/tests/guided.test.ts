import { describe, expect, test, beforeEach } from "bun:test";
import { app } from "../src/app";
import { clearGuided } from "../src/guided";

const U1 = { "content-type": "application/json", "x-test-user": "u_learner_1" };
const U2 = { "content-type": "application/json", "x-test-user": "u_learner_2" };
const ANON = { "content-type": "application/json" };

beforeEach(() => clearGuided());

describe("guided cohort gate", () => {
  test("anonymous guided creation rejected; anonymous playground still works", async () => {
    const denied = await app.request("/api/guided-sessions", {
      method: "POST",
      headers: ANON,
      body: JSON.stringify({ track: "demo-agent" }),
    });
    expect(denied.status).toBe(401);
    const body = await denied.json();
    expect(body.error).toContain("sign-in required");
    expect(body.remedy).toContain("playground");

    const pg = await app.request("/api/playgrounds", {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-key": "still-open" },
      body: JSON.stringify({}),
    });
    expect(pg.status).toBe(201);
  });

  test("learner creates within quota; 3rd concurrent → 429 with remedy", async () => {
    for (let i = 0; i < 2; i++) {
      const r = await app.request("/api/guided-sessions", {
        method: "POST",
        headers: U1,
        body: JSON.stringify({ track: "demo-agent" }),
      });
      expect(r.status).toBe(201);
    }
    const over = await app.request("/api/guided-sessions", {
      method: "POST",
      headers: U1,
      body: JSON.stringify({ track: "demo-agent" }),
    });
    expect(over.status).toBe(429);
    const body = await over.json();
    expect(body.error).toContain("2/2 live");
    expect(body.remedy).toBeDefined();

    // Another user unaffected; owner can list and destroy their own
    const other = await app.request("/api/guided-sessions", {
      method: "POST",
      headers: U2,
      body: JSON.stringify({ track: "demo-agent" }),
    });
    expect(other.status).toBe(201);
    const mine = await (await app.request("/api/guided-sessions", { headers: U1 })).json();
    expect(mine.sessions.length).toBe(2);
    const del = await app.request(`/api/guided-sessions/${mine.sessions[0].id}`, {
      method: "DELETE",
      headers: U1,
    });
    expect(del.status).toBe(200);
    // Slot freed → create works again
    const retry = await app.request("/api/guided-sessions", {
      method: "POST",
      headers: U1,
      body: JSON.stringify({ track: "demo-agent" }),
    });
    expect(retry.status).toBe(201);
  });

  test("cannot destroy another user's session", async () => {
    const created = await app.request("/api/guided-sessions", {
      method: "POST",
      headers: U1,
      body: JSON.stringify({ track: "demo-agent" }),
    });
    const { id } = await created.json();
    const del = await app.request(`/api/guided-sessions/${id}`, { method: "DELETE", headers: U2 });
    expect(del.status).toBe(404);
  });
});
