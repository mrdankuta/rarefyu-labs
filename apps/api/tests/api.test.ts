import { describe, expect, test } from "bun:test";
import { app } from "../src/app";

describe("api", () => {
  test("GET /healthz", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("session lifecycle stub", async () => {
    const created = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ courseId: "demo", labId: "basics" }),
    });
    expect(created.status).toBe(201);
    const session = await created.json();
    expect(session.status).toBe("creating");

    const fetched = await app.request(`/api/sessions/${session.id}`);
    expect(fetched.status).toBe(200);

    const deleted = await app.request(`/api/sessions/${session.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);

    const gone = await app.request(`/api/sessions/${session.id}`);
    expect(gone.status).toBe(404);
  });
});
