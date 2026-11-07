import { describe, expect, test, beforeEach } from "bun:test";
import { app } from "../src/app";
import { clearPlaygrounds } from "../src/playgrounds";
import { clearChecks } from "../src/checks";

const H = { "content-type": "application/json", "x-session-key": "check1" };

async function makePlayground() {
  const res = await app.request("/api/playgrounds", {
    method: "POST",
    headers: H,
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
}

beforeEach(() => {
  clearPlaygrounds();
  clearChecks();
});

describe("tracks + in-session checks", () => {
  test("track loads with 5 steps in order", async () => {
    const res = await app.request("/api/tracks/demo-agent");
    expect(res.status).toBe(200);
    const track = await res.json();
    expect(track.steps.length).toBe(5);
    expect(track.steps[0].slug).toBe("01-scaffold");
    expect(track.config.backend).toBe("gvisor");
  });

  test("starter fails step 1 with hint; solve+pass records progress", async () => {
    const id = await makePlayground();
    // Starter workspace lacks src/app.ts → fail with hint
    const fail = await app.request(`/api/playgrounds/${id}/check`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ track: "demo-agent", step: "01-scaffold" }),
    });
    expect(fail.status).toBe(200);
    const fbody = await fail.json();
    expect(fbody.pass).toBe(false);
    expect(fbody.failures.length).toBeGreaterThan(0);
    expect(fbody.failures[0].hint).toContain("src/app.ts");

    // Unlock solution, re-check → pass, progress advances
    const solve = await app.request(`/api/playgrounds/${id}/solve`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ track: "demo-agent", step: "01-scaffold", confirm: true }),
    });
    expect(solve.status).toBe(200);
    const pass = await app.request(`/api/playgrounds/${id}/check`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ track: "demo-agent", step: "01-scaffold" }),
    });
    const pbody = await pass.json();
    expect(pbody.pass).toBe(true);
    expect(pbody.progress).toContain("01-scaffold");

    const atts = await (await app.request(`/api/playgrounds/${id}/attempts?track=demo-agent`)).json();
    expect(atts.attempts.length).toBe(3); // fail + unlock + pass
  });

  test("solve requires explicit confirm", async () => {
    const id = await makePlayground();
    const res = await app.request(`/api/playgrounds/${id}/solve`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ track: "demo-agent", step: "01-scaffold" }),
    });
    expect(res.status).toBe(400);
  });

  test("preview readiness: waiting when nothing listens", async () => {
    const id = await makePlayground();
    const res = await app.request(`/api/playgrounds/${id}/preview?port=39999`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ready).toBe(false);
    expect(body.hint).toContain("39999");
  });
});
