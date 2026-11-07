import { describe, expect, test, beforeEach } from "bun:test";
import { app } from "../src/app";
import { clearPlaygrounds } from "../src/playgrounds";
import { clearMetrics } from "../src/metrics";

const S = (k: string) => ({ "content-type": "application/json", "x-session-key": k });

beforeEach(() => {
  clearPlaygrounds();
  clearMetrics();
});

describe("hardening + observability", () => {
  test("kill-switch drill: 50 sessions die inside 60s", async () => {
    for (let i = 0; i < 50; i++) {
      const r = await app.request("/api/playgrounds", {
        method: "POST",
        headers: S(`drill-${i}`),
        body: JSON.stringify({}),
      });
      expect(r.status).toBe(201);
    }
    const t0 = Date.now();
    const nuke = await app.request("/api/playgrounds", { method: "DELETE" });
    const elapsed = Date.now() - t0;
    expect(nuke.status).toBe(200);
    expect((await nuke.json()).destroyed).toBe(50);
    expect(elapsed).toBeLessThan(60_000);

    const m = await (await app.request("/metrics")).text();
    expect(m).toContain('labs_provisions_total{outcome="ok"} 50');
    expect(m).toContain("labs_kills_total 50");
    expect(m).toContain("labs_sessions_live 0");
  });

  test("metrics reflect checks and boot latency", async () => {
    const created = await app.request("/api/playgrounds", {
      method: "POST",
      headers: S("m1"),
      body: JSON.stringify({}),
    });
    const { id } = await created.json();
    await app.request(`/api/playgrounds/${id}/heartbeat`, { method: "POST" });
    await app.request(`/api/playgrounds/${id}/check`, {
      method: "POST",
      headers: S("m1"),
      body: JSON.stringify({ track: "demo-agent", step: "01-scaffold" }),
    });
    const m = await (await app.request("/metrics")).text();
    expect(m).toContain('labs_checks_total{outcome="fail"} 1');
    expect(m).toMatch(/labs_boot_ms\{quantile="0\.5"\} \d+/);
  });
});
