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

    t("injectCredentials writes private home files that survive in the workspace", async () => {
      const id = sid("creds");
      await d.create(id);
      await d.injectCredentials(id, [{ path: ".config/probe/secret.json", content: '{"key":"sk-contract"}' }]);
      const r = await d.run(id, 'cat "$HOME/.config/probe/secret.json"; stat -c %a "$HOME/.config/probe/secret.json"');
      expect(r.stdout).toContain('{"key":"sk-contract"}');
      expect(r.stdout.trim().endsWith("600")).toBe(true);
      // visible from a real terminal too (same HOME as the learner's shell)
      const term = await d.openTerminal(id, "t1");
      term.write('echo HAS_$(test -f "$HOME/.config/probe/secret.json" && echo KEY)\n');
      expect(await waitFor(() => term.scrollback(), "HAS_KEY")).toBe(true);
      term.kill();
    });

    t("after injectCredentials, ~/workspace is the workspace (lessons and agents rely on it)", async () => {
      const id = sid("home-ws");
      await d.create(id);
      await d.injectCredentials(id, [{ path: ".config/probe/x.json", content: "{}" }]);
      const r = await d.run(id, 'cd ~/workspace && echo from-home > probe.txt');
      expect(r.exitCode).toBe(0);
      expect((await d.readFile(id, "probe.txt")).content.trim()).toBe("from-home");
    });

    t("injectCredentials refuses paths that escape the home directory", async () => {
      const id = sid("creds-bad");
      await d.create(id);
      for (const bad of ["../x", "/etc/passwd", "a/../../x", ""])
        await expect(d.injectCredentials(id, [{ path: bad, content: "x" }])).rejects.toThrow();
    });

    describe("file transfer", () => {
      const bytesOf = async (st: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(st).arrayBuffer());
      const enc = (x: string) => new TextEncoder().encode(x);
      const bin = Uint8Array.from({ length: 256 }, (_, i) => i);

      t("uploaded files keep binary content and nested folders; node_modules is skipped", async () => {
        const id = sid("up");
        await d.create(id);
        const r = await d.importUpload(id, "proj", {
          kind: "files",
          files: [
            { path: "src/app.js", data: enc("console.log(1)") },
            { path: "img/logo.bin", data: bin },
            { path: "node_modules/x/index.js", data: enc("nope") },
            { path: ".DS_Store", data: enc("junk") },
          ],
        });
        expect(r).toEqual({ files: 2, bytes: 14 + 256, skipped: 2 });
        expect(await bytesOf(await d.readBytes(id, "proj/img/logo.bin"))).toEqual(bin);
        expect((await d.readFile(id, "proj/src/app.js")).content).toBe("console.log(1)");
        const tree = (await d.listFiles(id, "proj")).map((f) => f.path).join(",");
        expect(tree).not.toContain("node_modules");
      });

      t("uploads cannot escape the workspace", async () => {
        const id = sid("up-bad");
        await d.create(id);
        for (const path of ["../evil.txt", "/etc/evil.txt", "a/../../evil.txt"])
          await expect(d.importUpload(id, "", { kind: "files", files: [{ path, data: enc("x") }] })).rejects.toThrow(/bad path|escapes/);
        await expect(d.importUpload(id, "../up", { kind: "files", files: [{ path: "x", data: enc("x") }] })).rejects.toThrow();
      });

      t("too many files in one upload is refused with a clear message", async () => {
        const id = sid("up-many");
        await d.create(id);
        const files = Array.from({ length: 5001 }, (_, i) => ({ path: `f/${i}.txt`, data: enc("x") }));
        await expect(d.importUpload(id, "", { kind: "files", files })).rejects.toThrow(/too many files/);
      });

      t("zip download roundtrips through zip upload, leaving heavy folders out unless asked", async () => {
        const id = sid("zip");
        await d.create(id);
        await d.importUpload(id, "", { kind: "files", files: [{ path: "a/one.txt", data: enc("1") }, { path: "b.bin", data: bin }] });
        await d.writeFile(id, "node_modules/dep/i.js", "x");
        const zip = await bytesOf(await d.archiveZip(id));
        expect(zip.length).toBeGreaterThan(100);
        expect(String.fromCharCode(...zip.slice(0, 2))).toBe("PK");
        const r = await d.importUpload(id, "restored", { kind: "zip", data: zip });
        expect(r.files).toBeGreaterThanOrEqual(3); // README.md, a/one.txt, b.bin
        expect(await bytesOf(await d.readBytes(id, "restored/b.bin"))).toEqual(bin);
        expect((await d.listFiles(id, "restored")).map((f) => f.path).join(",")).not.toContain("node_modules");
        const sub = await bytesOf(await d.archiveZip(id, "a"));
        const r2 = await d.importUpload(id, "only-a", { kind: "zip", data: sub });
        expect(r2.files).toBe(1);
      });

      t("a non-zip upload is rejected", async () => {
        const id = sid("zip-bad");
        await d.create(id);
        await expect(d.importUpload(id, "", { kind: "zip", data: enc("this is not a zip") })).rejects.toThrow(/not a valid zip/);
      });
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

    t("files: rename and delete, guarded", async () => {
      const id = sid("mv");
      await d.writeFile(id, "a.txt", "A");
      await d.writeFile(id, "dir/b.txt", "B");
      await d.renamePath(id, "a.txt", "sub/renamed.txt");
      expect((await d.readFile(id, "sub/renamed.txt")).content).toBe("A");
      await expect(d.readFile(id, "a.txt")).rejects.toThrow();
      await expect(d.renamePath(id, "dir/b.txt", "sub/renamed.txt")).rejects.toThrow(/exists/);
      await expect(d.renamePath(id, "nope.txt", "x.txt")).rejects.toThrow(/not found/);
      await expect(d.renamePath(id, "dir", "dir/inner")).rejects.toThrow();
      await expect(d.renamePath(id, "dir/b.txt", "../out.txt")).rejects.toThrow();
      await d.deletePath(id, "dir");
      expect((await d.listFiles(id)).map((f) => f.path)).not.toContain("dir");
      await expect(d.deletePath(id, "dir")).rejects.toThrow(/not found/);
      await expect(d.deletePath(id, "")).rejects.toThrow(/root/);
      await expect(d.deletePath(id, "../x")).rejects.toThrow();
      await expect(d.deletePath(id, ".")).rejects.toThrow(/root/);
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

    t("list reports live workspaces and forgets destroyed ones", async () => {
      const id = sid("list");
      await d.create(id);
      expect(await d.list()).toContain(id);
      await d.hibernate(id);
      expect(await d.list()).toContain(id); // hibernated still held
      await d.destroy(id);
      expect(await d.list()).not.toContain(id);
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
