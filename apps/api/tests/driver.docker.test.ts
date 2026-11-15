import { afterAll, describe, expect, test } from "bun:test";
import { DockerDriver } from "../src/drivers/docker";
import { driverContract } from "./driver-contract";

const IMAGE = process.env.LAB_IMAGE ?? "rarefyu/base-lab:dev";

function sh(args: string[]) {
  const r = Bun.spawnSync(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  return { ok: r.exitCode === 0, out: r.stdout.toString() };
}
const haveDocker = sh(["info"]).ok && sh(["image", "inspect", IMAGE]).ok;
const haveRunsc = haveDocker && sh(["info", "--format", "{{json .Runtimes}}"]).out.includes('"runsc"');
// Real gVisor when the host has it; hardened runc otherwise (dev laptop).
const backend = haveRunsc ? "docker-gvisor" : "docker";
const mk = () => new DockerDriver({ backend, image: IMAGE, memory: "512m" });

driverContract(`docker (${backend})`, mk, { skip: !haveDocker });

const t = haveDocker ? test : test.skip;
const created: string[] = [];
const sid = (tag: string) => {
  const id = `iso-${tag}-${crypto.randomUUID().slice(0, 8)}`;
  created.push(id);
  return id;
};

describe("docker driver: isolation and hardening", () => {
  const d = haveDocker ? mk() : (undefined as unknown as DockerDriver);
  afterAll(async () => {
    if (haveDocker) await Promise.all(created.map((id) => d.destroy(id).catch(() => {})));
  }, 60_000);

  t("reports isolation level for its backend", () => {
    expect(d.capabilities().isolation).toBe(haveRunsc ? "gvisor" : "container");
  });

  t("workspace runs as non-root with no capabilities and no privilege escalation", async () => {
    const id = sid("hard");
    await d.create(id);
    const r = await d.run(id, "id -u; grep CapEff /proc/self/status; grep NoNewPrivs /proc/self/status");
    expect(r.stdout).toContain("1001");
    expect(r.stdout).toMatch(/CapEff:\s+0+\s/);
    expect(r.stdout).toMatch(/NoNewPrivs:\s+1/);
  });

  t("root filesystem is read-only; home is writable", async () => {
    const id = sid("ro");
    await d.create(id);
    expect((await d.run(id, "touch /etc/x")).exitCode).not.toBe(0);
    expect((await d.run(id, "touch ~/ok && touch /tmp/ok")).exitCode).toBe(0);
  });

  t("memory and pid limits are enforced", async () => {
    const id = sid("lim");
    await d.create(id);
    const r = await d.run(id, "cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes");
    // gVisor may not expose cgroup files; only assert when it does.
    if (r.exitCode === 0 && /^\d+$/.test(r.stdout.trim())) {
      expect(Number(r.stdout.trim())).toBeLessThanOrEqual(512 * 1024 * 1024);
    }
    const inspect = sh(["inspect", "--format", "{{.HostConfig.Memory}} {{.HostConfig.PidsLimit}}", `rfy-${id}`]);
    expect(inspect.out.trim()).toBe(`${512 * 1024 * 1024} 512`);
  });

  t("workspaces cannot reach each other's network or files", async () => {
    const a = sid("a"), b = sid("b");
    await d.create(a);
    await d.create(b);
    await d.writeFile(b, "secret.txt", "b-secret");
    const addrB = await d.address(b, 3000);
    const addrA = await d.address(a, 3000);
    expect(addrA.host).not.toBe(addrB.host);
    // a → b: no route across separate bridge networks
    const ping = await d.run(a, `timeout 3 bash -c 'exec 3<>/dev/tcp/${addrB.host}/3000' 2>&1; echo rc=$?`, { timeoutMs: 8000 });
    expect(ping.stdout).not.toContain("rc=0");
    // a cannot see b's volume
    expect((await d.run(a, "cat ~/workspace/secret.txt")).exitCode).not.toBe(0);
  });

  t("hibernate really stops the container; wake restores it with files", async () => {
    const id = sid("hib");
    await d.writeFile(id, "keep.txt", "kept");
    await d.hibernate(id);
    expect(sh(["inspect", "--format", "{{.State.Running}}", `rfy-${id}`]).out.trim()).toBe("false");
    await d.wake(id);
    expect(sh(["inspect", "--format", "{{.State.Running}}", `rfy-${id}`]).out.trim()).toBe("true");
    expect((await d.readFile(id, "keep.txt")).content).toBe("kept");
  });

  t("destroy leaves no container, volume or network behind", async () => {
    const id = sid("gone");
    await d.create(id);
    await d.destroy(id);
    for (const kind of [["ps", "-a"], ["volume", "ls"], ["network", "ls"]]) {
      expect(sh([...kind, "--filter", `label=rfy.workspace=${id}`, "-q"]).out.trim()).toBe("");
    }
  });

  t("gvisor backend refuses to create a workspace when the runtime is missing", async () => {
    const strict = new DockerDriver({ backend: "docker-gvisor", image: IMAGE, runtime: "no-such-runtime" });
    const id = sid("strict");
    await expect(strict.create(id)).rejects.toThrow(/refusing to create a workspace with weaker isolation/);
    expect(sh(["ps", "-a", "--filter", `label=rfy.workspace=${id}`, "-q"]).out.trim()).toBe("");
  });
});
