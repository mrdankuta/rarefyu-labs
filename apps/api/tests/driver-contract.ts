import { afterAll, describe, expect, test } from "bun:test";
import type { ExecDriver } from "../src/drivers/types";

/** Read terminal output until `needle` appears or timeout. */
async function waitFor(get: () => string, needle: string, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (get().includes(needle)) return true;
    await Bun.sleep(50);
  }
  return get().includes(needle);
}

/**
 * Shared behavior suite every ExecDriver backend must pass (spec #30).
 * Tests external behavior only: what a caller of the driver can observe.
 */
export function driverContract(name: string, make: () => ExecDriver, opts?: { skip?: boolean }) {
  const d = opts?.skip ? (undefined as unknown as ExecDriver) : make();
  const ids: string[] = [];
  const sid = (tag: string) => {
    const id = `contract-${tag}-${crypto.randomUUID().slice(0, 8)}`;
    ids.push(id);
    return id;
  };
  const t = opts?.skip ? test.skip : test;

  describe(`ExecDriver contract: ${name}`, () => {
    afterAll(async () => {
      if (opts?.skip) return;
      await Promise.all(ids.map((id) => d.destroy(id).catch(() => {})));
    }, 60_000);

    t("reports capabilities", () => {
      const caps = d.capabilities();
      expect(["none", "container", "gvisor"]).toContain(caps.isolation);
      expect(typeof caps.hibernate).toBe("boolean");
    });

    t("create is idempotent and seeds a workspace", async () => {
      const id = sid("create");
      await d.create(id);
      await d.create(id);
      const files = await d.listFiles(id);
      expect(files.some((f) => f.path === "README.md")).toBe(true);
    });

    t("run captures stdout, stderr and exit code", async () => {
      const id = sid("run");
      await d.create(id);
      const ok = await d.run(id, "echo hi; echo err >&2");
      expect(ok.stdout.trim()).toBe("hi");
      expect(ok.stderr.trim()).toBe("err");
      expect(ok.exitCode).toBe(0);
      const bad = await d.run(id, "exit 3");
      expect(bad.exitCode).toBe(3);
    });

    t("run times out long commands", async () => {
      const id = sid("timeout");
      await d.create(id);
      const start = Date.now();
      const r = await d.run(id, "sleep 30", { timeoutMs: 500 });
      expect(Date.now() - start).toBeLessThan(10_000);
      expect(r.exitCode).not.toBe(0);
    });

    t("terminal executes input and replays scrollback on reattach", async () => {
      const id = sid("term");
      const term = await d.openTerminal(id, "t1");
      let out = "";
      term.onData((x) => (out += x));
      term.write("echo contract-marker-$((6*7))\n");
      expect(await waitFor(() => out, "contract-marker-42")).toBe(true);
      const again = await d.openTerminal(id, "t1");
      expect(again.scrollback()).toContain("contract-marker-42");
    });

    t("terminals are independent per termId", async () => {
      const id = sid("multi");
      const a = await d.openTerminal(id, "a");
      const b = await d.openTerminal(id, "b");
      a.write("echo only-in-a\n");
      expect(await waitFor(() => a.scrollback(), "only-in-a")).toBe(true);
      await Bun.sleep(200);
      expect(b.scrollback()).not.toContain("only-in-a");
    });

    t("closeTerminal kills that shell only; reopening gives a fresh shell", async () => {
      const id = sid("close");
      const a = await d.openTerminal(id, "a");
      const b = await d.openTerminal(id, "b");
      a.write("echo marker-a\n");
      b.write("echo marker-b\n");
      expect(await waitFor(() => a.scrollback(), "marker-a")).toBe(true);
      expect(await waitFor(() => b.scrollback(), "marker-b")).toBe(true);
      await d.closeTerminal(id, "a");
      await d.closeTerminal(id, "a"); // idempotent
      await d.closeTerminal(id, "never-opened"); // never throws
      const b2 = await d.openTerminal(id, "b");
      expect(b2.scrollback()).toContain("marker-b");
      const a2 = await d.openTerminal(id, "a");
      expect(a2.scrollback()).not.toContain("marker-a");
    });

    t("terminal and run see the same workspace", async () => {
      const id = sid("shared");
      await d.writeFile(id, "from-api.txt", "api-wrote-this");
      const term = await d.openTerminal(id, "t1");
      term.write("cat from-api.txt\n");
      expect(await waitFor(() => term.scrollback(), "api-wrote-this")).toBe(true);
      term.write("echo from-shell > from-shell.txt\n");
      await Bun.sleep(300);
      const f = await d.readFile(id, "from-shell.txt");
      expect(f.content.trim()).toBe("from-shell");
    });

    t("files: write, read, list, nested dirs", async () => {
      const id = sid("files");
      await d.writeFile(id, "src/app.txt", "hello");
      const r = await d.readFile(id, "src/app.txt");
      expect(r).toEqual({ content: "hello", truncated: false });
      const top = await d.listFiles(id);
      expect(top.find((f) => f.path === "src")?.type).toBe("dir");
      const sub = await d.listFiles(id, "src");
      expect(sub.map((f) => f.path)).toContain("src/app.txt");
    });

    t("files: path traversal is rejected", async () => {
      const id = sid("trav");
      await d.create(id);
      await expect(d.readFile(id, "../../etc/passwd")).rejects.toThrow();
      await expect(d.writeFile(id, "../escape.txt", "x")).rejects.toThrow();
      await expect(d.listFiles(id, "../..")).rejects.toThrow();
    });

    t("files: diff against starter, reset file and project", async () => {
      const id = sid("reset");
      await d.create(id);
      expect(await d.diffFile(id, "README.md")).toBe("");
      await d.writeFile(id, "README.md", "changed\n");
      expect(await d.diffFile(id, "README.md")).toContain("+changed");
      await d.resetFile(id, "README.md");
      expect(await d.diffFile(id, "README.md")).toBe("");
      await d.writeFile(id, "extra.txt", "x");
      await d.resetProject(id);
      const names = (await d.listFiles(id)).map((f) => f.path);
      expect(names).toContain("README.md");
      expect(names).not.toContain("extra.txt");
    });

    t("snapshot streams a tarball containing workspace files", async () => {
      const id = sid("snap");
      await d.writeFile(id, "keep.txt", "snapshot-me");
      const bytes = new Uint8Array(await new Response(await d.snapshotTar(id)).arrayBuffer());
      expect(bytes.length).toBeGreaterThan(20);
      expect(bytes[0]).toBe(0x1f); // gzip magic
      expect(bytes[1]).toBe(0x8b);
    });

    t("hibernate stops terminals but keeps files; wake restores access", async () => {
      const id = sid("hib");
      await d.writeFile(id, "persist.txt", "still-here");
      const term = await d.openTerminal(id, "t1");
      term.write("echo before-hibernate\n");
      expect(await waitFor(() => term.scrollback(), "before-hibernate")).toBe(true);
      await d.hibernate(id);
      await d.hibernate(id); // idempotent
      await d.wake(id);
      await d.wake(id); // idempotent
      expect((await d.readFile(id, "persist.txt")).content).toBe("still-here");
      const fresh = await d.openTerminal(id, "t1");
      let out = "";
      fresh.onData((x) => (out += x));
      fresh.write("cat persist.txt\n");
      expect(await waitFor(() => out, "still-here")).toBe(true);
    });

    t("address resolves a reachable host and port", async () => {
      const id = sid("addr");
      await d.create(id);
      const a = await d.address(id, 3000);
      expect(a.host.length).toBeGreaterThan(0);
      expect(a.port).toBeGreaterThan(0);
    });

    t("destroy removes the workspace", async () => {
      const id = sid("destroy");
      await d.writeFile(id, "gone.txt", "bye");
      await d.openTerminal(id, "t1");
      await d.destroy(id);
      await d.destroy(id); // idempotent
      // A recreated workspace under the same id starts clean.
      await d.create(id);
      const names = (await d.listFiles(id)).map((f) => f.path);
      expect(names).not.toContain("gone.txt");
    });
  });
}
