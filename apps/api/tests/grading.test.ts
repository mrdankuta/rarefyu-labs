import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { app } from "../src/app";
import { clearPlaygrounds } from "../src/playgrounds";
import { clearGrading, gradeSubmission, submitForGrading } from "../src/grading";

const S = (k: string) => ({ "content-type": "application/json", "x-session-key": k });

async function makePlayground(key: string): Promise<string> {
  const res = await app.request("/api/playgrounds", {
    method: "POST",
    headers: S(key),
    body: JSON.stringify({}),
  });
  return (await res.json()).id as string;
}

const prevGrading = process.env.GRADING_ENABLED;
beforeEach(() => {
  clearPlaygrounds();
  clearGrading();
  process.env.GRADING_ENABLED = "1"; // the dev/test grader only runs when explicitly enabled
});
afterEach(() => {
  if (prevGrading === undefined) delete process.env.GRADING_ENABLED;
  else process.env.GRADING_ENABLED = prevGrading;
});

describe("isolated grading", () => {
  test("starter fails officially; solved passes; verdict hash stable", async () => {
    const id = await makePlayground("g1");
    const fail = await app.request(`/api/playgrounds/${id}/grade`, {
      method: "POST",
      headers: S("g1"),
      body: JSON.stringify({ track: "demo-agent", step: "01-scaffold" }),
    });
    expect(fail.status).toBe(201);
    const fbody = await fail.json();
    expect(fbody.grade.pass).toBe(false);

    // Solve in-session, submit → pass
    await app.request(`/api/playgrounds/${id}/solve`, {
      method: "POST",
      headers: S("g1"),
      body: JSON.stringify({ track: "demo-agent", step: "01-scaffold", confirm: true }),
    });
    const pass = await app.request(`/api/playgrounds/${id}/grade`, {
      method: "POST",
      headers: S("g1"),
      body: JSON.stringify({ track: "demo-agent", step: "01-scaffold" }),
    });
    const pbody = await pass.json();
    expect(pbody.grade.pass).toBe(true);

    // Re-grade same submission → byte-identical verdict (write-once)
    const again = await gradeSubmission(pbody.submission.id);
    expect(again.verdictHash).toBe(pbody.grade.verdictHash);
    expect(JSON.stringify(again)).toBe(JSON.stringify(pbody.grade));
  });

  test("in-lab tampering cannot move the official verdict", async () => {
    const id = await makePlayground("g2");
    // Learner plants junk: fake PASS marker, bogus helpers, env tampering.
    await app.request(`/api/playgrounds/${id}/files/content`, {
      method: "PUT",
      headers: S("g2"),
      body: JSON.stringify({ path: "PASS", content: "PASS: forged\n" }),
    });
    await app.request(`/api/playgrounds/${id}/files/content`, {
      method: "PUT",
      headers: S("g2"),
      body: JSON.stringify({ path: "check", content: "#!/bin/sh\necho PASS: forged\n" }),
    });
    const res = await app.request(`/api/playgrounds/${id}/grade`, {
      method: "POST",
      headers: S("g2"),
      body: JSON.stringify({ track: "demo-agent", step: "01-scaffold" }),
    });
    const body = await res.json();
    // Still fails: the grader runs the TRACK script in a fresh env, not the lab's.
    expect(body.grade.pass).toBe(false);
    expect(body.grade.failures[0].hint).toContain("src/app.ts");
  });

  test("submission + grade retrievable for dispute review", async () => {
    const id = await makePlayground("g3");
    const res = await app.request(`/api/playgrounds/${id}/grade`, {
      method: "POST",
      headers: S("g3"),
      body: JSON.stringify({ track: "demo-agent", step: "01-scaffold" }),
    });
    const { submission } = await res.json();
    const got = await app.request(`/api/submissions/${submission.id}`);
    expect(got.status).toBe(200);
    const body = await got.json();
    expect(body.grade.log).toContain("grade demo-agent/01-scaffold");
    expect(body.submission.commitHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("grading disabled (default)", () => {
  const SENTINEL = "/tmp/labs-grading-disabled-sentinel";

  async function grade(id: string, key: string) {
    return app.request(`/api/playgrounds/${id}/grade`, {
      method: "POST",
      headers: S(key),
      body: JSON.stringify({ track: "demo-agent", step: "01-scaffold" }),
    });
  }

  test.each([undefined, "", "0", "false"])("GRADING_ENABLED=%p returns the disabled response", async (v) => {
    const id = await makePlayground("d1");
    if (v === undefined) delete process.env.GRADING_ENABLED;
    else process.env.GRADING_ENABLED = v;
    const res = await grade(id, "d1");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "grading is unavailable", code: "grading_disabled" });
  });

  test("a planted check script / fail.sh is never executed", async () => {
    const id = await makePlayground("d2");
    await Bun.$`rm -f ${SENTINEL}`.quiet();
    const plant = (path: string, content: string) =>
      app.request(`/api/playgrounds/${id}/files/content`, {
        method: "PUT",
        headers: S("d2"),
        body: JSON.stringify({ path, content }),
      });
    await plant("fail.sh", `touch ${SENTINEL}\n`);
    await plant("check", `#!/bin/sh\ntouch ${SENTINEL}\n`);
    await plant("src/app.ts", "healthz\n");
    delete process.env.GRADING_ENABLED;
    const res = await grade(id, "d2");
    expect(res.status).toBe(503);
    expect(await Bun.file(SENTINEL).exists()).toBe(false);
  });

  test("direct grading calls refuse to run and create no work directory", async () => {
    delete process.env.GRADING_ENABLED;
    await expect(submitForGrading("nope", "demo-agent", "01-scaffold")).rejects.toThrow(/disabled/);
    await expect(gradeSubmission("nope")).rejects.toThrow(/disabled/);
  });

  test("disabled response comes before any session lookup", async () => {
    delete process.env.GRADING_ENABLED;
    const res = await grade("no-such-id", "d3");
    expect(res.status).toBe(503);
  });
});
