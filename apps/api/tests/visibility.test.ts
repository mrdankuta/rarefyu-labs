import { beforeEach, describe, expect, test } from "bun:test";
import { app } from "../src/app";
import { driver } from "../src/drivers";
import { runLifecycle } from "../src/lifecycle";
import { clearPlaygrounds } from "../src/playgrounds";
import { clearTeach, getAudit, getPresence } from "../src/teach";

beforeEach(() => { clearPlaygrounds(); clearTeach(); });
const H = { "content-type": "application/json", "x-session-key": "vis", "x-forwarded-for": "192.0.2.200" };
const create = () => app.request("/api/playgrounds", { method: "POST", headers: H, body: "{}" });
const metric = (text: string, name: string) => Number(new RegExp(`^${name.replace(/[{}"=]/g, (c) => `\\${c}`)} (\\S+)$`, "m").exec(text)?.[1] ?? NaN);

describe("ops visibility", () => {
  test("metrics report workspaces by state, limits and host resources", async () => {
    const id = (await (await create()).json()).id;
    let m = await (await app.request("/metrics")).text();
    expect(metric(m, 'labs_workspaces{state="active"}')).toBe(1);
    expect(metric(m, 'labs_workspaces{state="sleeping"}')).toBe(0);
    await runLifecycle(Date.now() + 21 * 60_000);
    m = await (await app.request("/metrics")).text();
    expect(metric(m, 'labs_workspaces{state="active"}')).toBe(0);
    expect(metric(m, 'labs_workspaces{state="sleeping"}')).toBe(1);
    await runLifecycle(Date.now() + 3 * 3600_000);
    m = await (await app.request("/metrics")).text();
    expect(metric(m, 'labs_workspaces{state="destroyed"}')).toBe(1);
    expect(metric(m, 'labs_workspace_limit{kind="global"}')).toBeGreaterThan(0);
    expect(m).toContain("labs_host_mem_total_bytes");
    expect(m).toContain("labs_host_load1");
    await driver.destroy(id);
  });

  test("audit trail records create, hibernate, wake, expire and stop with who/what/when", async () => {
    const id = (await (await create()).json()).id;
    await runLifecycle(Date.now() + 21 * 60_000);
    await app.request(`/api/playgrounds/${id}/heartbeat`, { method: "POST" });
    await runLifecycle(Date.now() + 3 * 3600_000);
    const actions = getAudit().filter((a) => a.sessionId === id).map((a) => `${a.actor}:${a.action}`);
    expect(actions).toEqual(["student:create", "system:hibernate", "student:wake", "system:hibernate", "system:expire"]);
    for (const a of getAudit()) expect(Date.parse(a.at)).not.toBeNaN();
    const stopId = (await (await app.request("/api/playgrounds", { method: "POST", headers: { ...H, "x-session-key": "vis2", "x-forwarded-for": "192.0.2.201" }, body: "{}" })).json()).id;
    await app.request(`/api/playgrounds/${stopId}`, { method: "DELETE" });
    expect(getAudit().some((a) => a.sessionId === stopId && a.action === "stop")).toBe(true);
    await driver.destroy(id);
  });

  test("operator actions are audited", async () => {
    await create();
    await app.request("/api/playgrounds?pause=1", { method: "DELETE" });
    await app.request("/api/admin/creation", { method: "POST", headers: { "content-type": "application/json" }, body: '{"paused":false}' });
    const ops = getAudit().filter((a) => a.actor === "operator").map((a) => a.action);
    expect(ops).toEqual(["kill-switch", "resume-creation"]);
  });

  test("instructor presence distinguishes hibernated from active students", async () => {
    const a = (await (await create()).json()).id;
    const b = (await (await app.request("/api/playgrounds", { method: "POST", headers: { ...H, "x-session-key": "vis3", "x-forwarded-for": "192.0.2.202" }, body: "{}" })).json()).id;
    await runLifecycle(Date.now() + 21 * 60_000);
    await app.request(`/api/playgrounds/${b}/heartbeat`, { method: "POST" }); // b comes back
    const p = Object.fromEntries(getPresence().map((x) => [x.sessionId, x.state]));
    expect(p[a]).toBe("sleeping");
    expect(p[b]).toBe("active");
    await driver.destroy(a);
    await driver.destroy(b);
  });
});
