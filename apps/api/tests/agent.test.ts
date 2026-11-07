import { describe, expect, test, beforeEach } from "bun:test";
import { app } from "../src/app";
import { clearPlaygrounds } from "../src/playgrounds";
import { clearAgent, redact } from "../src/agent";

const S = (k: string) => ({ "content-type": "application/json", "x-session-key": k });

async function makePlayground(key: string): Promise<string> {
  const res = await app.request("/api/playgrounds", {
    method: "POST",
    headers: S(key),
    body: JSON.stringify({}),
  });
  return (await res.json()).id as string;
}

const run = (id: string, plan: unknown[]) =>
  app.request(`/api/playgrounds/${id}/agent/run`, {
    method: "POST",
    headers: S("x"),
    body: JSON.stringify({ plan }),
  });

beforeEach(() => {
  clearPlaygrounds();
  clearAgent();
});

describe("agent broker", () => {
  test("allowed tools run end to end; fix flow passes a check", async () => {
    const id = await makePlayground("a1");
    const res = await run(id, [
      { tool: "fs.write", args: { path: "src/app.ts", content: "export const healthz = () => ({ ok: true });\n" } },
      { tool: "checks.run", args: { track: "demo-agent", step: "01-scaffold" } },
    ]);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("done");
    expect(body.results.every((r: { ok: boolean }) => r.ok)).toBe(true);
  });

  test("exec pauses for approval; deny leaves session untouched", async () => {
    const id = await makePlayground("a2");
    const res = await run(id, [{ tool: "exec", args: { cmd: "touch GOTCHA.txt" } }]);
    const body = await res.json();
    expect(body.status).toBe("waiting_approval");

    const pend = await (await app.request(`/api/playgrounds/${id}/agent/pending`)).json();
    expect(pend.pending.length).toBe(1);
    const deny = await app.request(`/api/playgrounds/${id}/agent/decide`, {
      method: "POST",
      headers: S("x"),
      body: JSON.stringify({ callId: pend.pending[0].callId, approve: false }),
    });
    const denied = await deny.json();
    expect(denied.status).toBe("denied");
    const files = await (await app.request(`/api/playgrounds/${id}/files`)).json();
    expect(files.files.some((f: { path: string }) => f.path === "GOTCHA.txt")).toBe(false);
  });

  test("approve resumes and executes", async () => {
    const id = await makePlayground("a3");
    const res = await run(id, [{ tool: "exec", args: { cmd: "echo approved-ok" } }]);
    expect((await res.json()).status).toBe("waiting_approval");
    const pend = await (await app.request(`/api/playgrounds/${id}/agent/pending`)).json();
    const done = await app.request(`/api/playgrounds/${id}/agent/decide`, {
      method: "POST",
      headers: S("x"),
      body: JSON.stringify({ callId: pend.pending[0].callId, approve: true }),
    });
    const body = await done.json();
    expect(body.status).toBe("done");
    expect(body.results[0].output).toContain("approved-ok");
  });

  test("credential access blocked and logged; audit has no secrets", async () => {
    const id = await makePlayground("a4");
    const res = await run(id, [
      { tool: "fs.read", args: { path: "~/.ssh/id_rsa" } },
    ]);
    const body = await res.json();
    expect(body.status).toBe("denied");
    expect(body.results[0].output).toContain("blocked");

    // Secrets in args never survive into the audit
    const evil = await run(id, [
      { tool: "fs.write", args: { path: "leak.txt", content: "token: 'ghp_ABCDEF1234567890'" } },
    ]);
    expect((await evil.json()).status).toBe("done");
    const audit = await (await app.request(`/api/playgrounds/${id}/agent/audit`)).json();
    const blob = JSON.stringify(audit);
    expect(blob).not.toContain("ghp_ABCDEF1234567890");
    expect(blob).toContain("[REDACTED]");
    expect(audit.audit.some((a: { decision: string }) => a.decision === "blocked")).toBe(true);
  });

  test("redact() covers key shapes", () => {
    expect(redact("key sk-live-abc123 here")).toContain("[REDACTED]");
    expect(redact("-----BEGIN RSA PRIVATE KEY-----")).toContain("[REDACTED]");
    expect(redact('{"password": "hunter2"}')).not.toContain("hunter2");
  });
});
