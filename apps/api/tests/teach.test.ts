import { describe, expect, test, beforeEach } from "bun:test";
import { app } from "../src/app";
import { clearPlaygrounds } from "../src/playgrounds";
import { clearChecks, runCheck } from "../src/checks";
import { clearTeach } from "../src/teach";

const T = { "content-type": "application/json", "x-test-user": "instructor_1" };
const S = (k: string) => ({ "content-type": "application/json", "x-session-key": k });

async function makePlayground(key: string): Promise<string> {
  const res = await app.request("/api/playgrounds", {
    method: "POST",
    headers: S(key),
    body: JSON.stringify({}),
  });
  return (await res.json()).id as string;
}

beforeEach(() => {
  clearPlaygrounds();
  clearChecks();
  clearTeach();
});

describe("teach console", () => {
  test("presence reflects activity; stuck after 2 failed checks", async () => {
    const id = await makePlayground("p1");
    let p = await (await app.request("/api/teach/presence", { headers: T })).json();
    expect(p.presence.find((x: { sessionId: string }) => x.sessionId === id).state).toBe("active");

    const { runCheck: rc } = await import("../src/checks");
    await rc(id, "demo-agent", "01-scaffold");
    await rc(id, "demo-agent", "01-scaffold");
    p = await (await app.request("/api/teach/presence", { headers: T })).json();
    expect(p.presence.find((x: { sessionId: string }) => x.sessionId === id).state).toBe("stuck");
  });

  test("reset → fresh FS + learner notice, progress kept; extend bumps expiry", async () => {
    const id = await makePlayground("p2");
    await app.request(`/api/playgrounds/${id}/files/content`, {
      method: "PUT",
      headers: S("p2"),
      body: JSON.stringify({ path: "notes.txt", content: "scratch" }),
    });
    const reset = await app.request("/api/teach/reset", {
      method: "POST",
      headers: T,
      body: JSON.stringify({ sessionId: id }),
    });
    expect(reset.status).toBe(200);
    const files = await (await app.request(`/api/playgrounds/${id}/files`)).json();
    expect(files.files.some((f: { path: string }) => f.path === "notes.txt")).toBe(false);

    const notices = await (await app.request(`/api/playgrounds/${id}/notices`)).json();
    expect(notices.notices.some((n: { kind: string }) => n.kind === "reset")).toBe(true);
    // Consumed on read
    const again = await (await app.request(`/api/playgrounds/${id}/notices`)).json();
    expect(again.notices.filter((n: { kind: string }) => n.kind === "reset").length).toBe(0);

    const before = (await (await app.request(`/api/playgrounds/${id}`)).json()).expiresAt;
    const ext = await app.request("/api/teach/extend", {
      method: "POST",
      headers: T,
      body: JSON.stringify({ sessionId: id, minutes: 30 }),
    });
    expect(ext.status).toBe(200);
    const after = await ext.json();
    expect(Date.parse(after.expiresAt) - Date.parse(before)).toBe(30 * 60_000);
  });

  test("announce reaches sessions; stats + audit render", async () => {
    const id = await makePlayground("p3");
    const ann = await app.request("/api/teach/announce", {
      method: "POST",
      headers: T,
      body: JSON.stringify({ message: "Lab extended to Friday" }),
    });
    expect(ann.status).toBe(200);
    const notices = await (await app.request(`/api/playgrounds/${id}/notices`)).json();
    expect(notices.notices.some((n: { message: string }) => n.message.includes("Friday"))).toBe(true);

    await runCheck(id, "demo-agent", "01-scaffold"); // fail
    const stats = await (await app.request("/api/teach/stats?track=demo-agent", { headers: T })).json();
    expect(stats.sessions).toBe(1);
    expect(stats.passRate).toBe(0);

    const audit = await (await app.request("/api/teach/audit", { headers: T })).json();
    expect(audit.audit.some((a: { action: string }) => a.action === "announce")).toBe(true);
  });

  test("teach endpoints require sign-in", async () => {
    const r = await app.request("/api/teach/presence");
    expect(r.status).toBe(401);
  });
});
