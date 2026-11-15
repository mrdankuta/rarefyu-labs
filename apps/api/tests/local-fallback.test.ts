import { afterAll, describe, expect, test } from "bun:test";

const ROOT = new URL("../../..", import.meta.url).pathname;
const docker = Bun.spawnSync(["docker", "info"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
const VOL = `rfy-local-test-${crypto.randomUUID().slice(0, 8)}`;
const t = docker ? test : test.skip;

function local(cmd: string, env: Record<string, string> = {}) {
  const r = Bun.spawnSync(["bash", `${ROOT}scripts/labs-local.sh`, "demo-agent"], {
    env: { ...process.env, LABS_CMD: cmd, LABS_VOLUME: VOL, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { out: r.stdout.toString(), err: r.stderr.toString(), code: r.exitCode };
}

afterAll(() => { if (docker) Bun.spawnSync(["docker", "volume", "rm", "-f", VOL]); });

describe("local fallback (one command, same checks as hosted)", () => {
  t("builds/uses the base image and runs a command in a locked-down container", () => {
    const r = local("id -u; touch /etc/x 2>&1 || echo ro-root; grep CapEff /proc/self/status", { LABS_BUILD: "1" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("1001");
    expect(r.out).toContain("ro-root");
    expect(r.out).toMatch(/CapEff:\s+0+\s/);
  });

  t("lab-check lists steps and gives the same FAIL/PASS verdicts as the hosted check", () => {
    const list = local("lab-check");
    expect(list.out).toContain("01-scaffold");
    const fail = local("lab-check 01-scaffold");
    expect(fail.code).not.toBe(0);
    expect(fail.out).toContain("FAIL");
    expect(fail.out).toContain("src/app.ts is missing");
    const pass = local(`mkdir -p src && printf 'export const healthz = () => ({ ok: true });\\n' > src/app.ts && lab-check 01-scaffold`);
    expect(pass.code).toBe(0);
    expect(pass.out).toContain("PASS");
  });

  t("files persist across runs in the volume", () => {
    local("echo persisted > keep.txt");
    expect(local("cat keep.txt").out.trim()).toBe("persisted");
  });

  t("a host folder can be used as the workspace and files stay owned by you", async () => {
    const dir = `/tmp/rfy-local-host-${crypto.randomUUID().slice(0, 6)}`;
    const r = local("echo hi > from-container.txt", { LABS_HOST_DIR: dir });
    expect(r.code).toBe(0);
    expect(await Bun.file(`${dir}/from-container.txt`).text()).toBe("hi\n");
    Bun.spawnSync(["rm", "-rf", dir]);
  });

  t("unknown track and missing docker give clear errors", () => {
    const bad = Bun.spawnSync(["bash", `${ROOT}scripts/labs-local.sh`, "nope"], { stdout: "pipe", stderr: "pipe" });
    expect(bad.exitCode).not.toBe(0);
    expect(bad.stderr.toString()).toContain("unknown track");
    const nodocker = Bun.spawnSync(["/usr/bin/env", "-i", "PATH=/nonexistent", "/usr/bin/bash", `${ROOT}scripts/labs-local.sh`], { stdout: "pipe", stderr: "pipe" });
    expect(nodocker.stderr.toString()).toContain("Docker is required");
  });
});
