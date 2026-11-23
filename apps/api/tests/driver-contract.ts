import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AgentServers } from "../src/agent-server";
import { agentRoutes } from "../src/agent-proxy";
import { canAccess } from "../src/app";
import { credentialFiles, installSeatKey } from "../src/seats";
import { cookieOfKey, identityKey } from "../src/playgrounds";
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

    t("create seeds starter files once, never overwrites, and they are part of the starter baseline", async () => {
      const id = sid("seed");
      await d.create(id, { seedFiles: [{ path: "AGENTS.md", content: "# rules\nline two\n" }, { path: "docs/note.txt", content: "n" }] });
      expect((await d.readFile(id, "AGENTS.md")).content).toBe("# rules\nline two\n");
      expect((await d.readFile(id, "docs/note.txt")).content).toBe("n");
      expect(await d.diffFile(id, "AGENTS.md")).toBe(""); // seeded before the snapshot: not a student change
      // a later create (wake, reattach) with different seeds changes nothing
      await d.writeFile(id, "AGENTS.md", "student edit\n");
      await d.create(id, { seedFiles: [{ path: "AGENTS.md", content: "other" }] });
      expect((await d.readFile(id, "AGENTS.md")).content).toBe("student edit\n");
      await d.resetProject(id);
      expect((await d.readFile(id, "AGENTS.md")).content).toBe("# rules\nline two\n"); // reset keeps the file
    });

    t("create does not overwrite a seed target that already exists", async () => {
      const id = sid("seedkeep");
      await d.create(id);
      await d.writeFile(id, "AGENTS.md", "mine\n");
      const id2 = sid("seedkeep2");
      await d.create(id2, { seedFiles: [{ path: "AGENTS.md", content: "ours" }] });
      expect((await d.readFile(id, "AGENTS.md")).content).toBe("mine\n");
      await expect(d.create(sid("seedbad"), { seedFiles: [{ path: "../escape", content: "x" }] })).rejects.toThrow();
    });

    t("previewPort is stable per workspace", async () => {
      const id = sid("pp");
      await d.create(id);
      const p = await d.previewPort(id);
      expect(Number.isInteger(p) && p > 0 && p < 65536).toBe(true);
      expect(await d.previewPort(id)).toBe(p);
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

    describe("walkFiles", () => {
      t("lists nested files with sizes and mtimes, hides dotfiles, does not enter node_modules", async () => {
        const id = sid("walk");
        await d.create(id);
        await d.writeFile(id, "a/b/c.txt", "hello");
        await d.writeFile(id, ".hidden/x.txt", "no");
        await d.writeFile(id, "node_modules/p/i.js", "no");
        const { entries, truncated } = await d.walkFiles(id);
        const by = new Map(entries.map((e) => [e.path, e]));
        expect(truncated).toBe(false);
        expect(by.get("a")?.type).toBe("dir");
        expect(by.get("a/b/c.txt")).toMatchObject({ type: "file", size: 5 });
        expect(by.get("a/b/c.txt")!.mtime).toBeGreaterThan(1_600_000_000);
        expect(by.get("node_modules")?.collapsed).toBe(true);
        expect([...by.keys()].some((k) => k.startsWith(".hidden") || k.startsWith("node_modules/"))).toBe(false);
        await d.destroy(id);
      });
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


/** opencode CLI in the workspace; stdout/stderr to a file because its background service would hold a pipe open. */
const CLI = 'unset XDG_DATA_HOME XDG_CONFIG_HOME XDG_STATE_HOME XDG_CACHE_HOME; bin="${OPENCODE_BIN:-opencode}"; [ -z "$OPENCODE_SERVICE_PORT" ] || "$bin" service set port "$OPENCODE_SERVICE_PORT" >/dev/null 2>&1 </dev/null; oc() { "$bin" "$@" >"$HOME/.oc.out" 2>&1 </dev/null; cat "$HOME/.oc.out"; }; oc';

export interface AgentContractOpts {
  skip?: boolean | string;
  /** Running the real pinned opencode binary (else the tiny stub, which also exposes /api/_stub/*). */
  real?: boolean;
  /** Pinned version the real binary must report. */
  version?: string;
  /** Docker backends: also assert the port is not published on the host. */
  docker?: boolean;
}

/**
 * Agent server contract (spec #50): every ExecDriver must manage a per-workspace
 * `opencode serve` the API can start, health-check, proxy to (owner only), and recover.
 */
export function agentServerContract(name: string, make: () => ExecDriver, opts: AgentContractOpts = {}) {
  const skipped = !!opts.skip;
  const t = skipped ? test.skip : test;
  const stubOnly = skipped || opts.real ? test.skip : test;
  const d = skipped ? (undefined as unknown as ExecDriver) : make();
  const servers = skipped ? (undefined as unknown as AgentServers) : new AgentServers(d);
  const ids: string[] = [];
  const recs = new Map<string, { ownerKey: string }>();
  const ownerCookie = "owner-cookie";
  const owner = { cookie: `rfy_sid=${ownerCookie}` };
  const stranger = { cookie: "rfy_sid=someone-else" };
  const routes = agentRoutes({
    servers,
    access: async (headers, id) => {
      const rec = recs.get(id);
      if (!rec) return "missing";
      return (await canAccess(headers, rec)) ? "ok" : "denied";
    },
  });
  const call = (id: string, path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
    routes.request(`/api/playgrounds/${id}/agent${path}`, init);
  const workspace = async (tag: string) => {
    const id = `agent-${tag}-${crypto.randomUUID().slice(0, 8)}`;
    ids.push(id);
    recs.set(id, { ownerKey: identityKey("203.0.113.9", ownerCookie) });
    await d.create(id);
    return id;
  };
  const prevEnforce = process.env.ENFORCE_OWNERSHIP;

  describe(`Agent server contract: ${name}${typeof opts.skip === "string" ? ` (SKIPPED: ${opts.skip})` : ""}`, () => {
    beforeAll(() => { process.env.ENFORCE_OWNERSHIP = "1"; });
    afterAll(async () => {
      process.env.ENFORCE_OWNERSHIP = prevEnforce;
      if (skipped) return;
      await Promise.all(ids.map((id) => d.destroy(id).catch(() => {})));
    }, 60_000);

    t("owner cookie identifies the workspace owner (sanity of the fixture)", () => {
      expect(cookieOfKey(identityKey("203.0.113.9", ownerCookie))).toBe(ownerCookie);
    });

    t("starts on demand and reports healthy", async () => {
      const id = await workspace("start");
      expect((await servers.status(id)).state).toBe("stopped"); // nothing runs until asked
      const r = await call(id, "", { method: "POST", headers: owner });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.state).toBe("healthy");
      if (opts.real && opts.version) expect(body.version).toBe(opts.version);
      expect((await servers.status(id)).state).toBe("healthy");
      const g = await call(id, "", { headers: owner });
      expect((await g.json()).state).toBe("healthy");
    }, 90_000);

    t("starting again, even concurrently, is idempotent (one server)", async () => {
      const id = await workspace("idem");
      const [a, b] = await Promise.all([servers.start(id), servers.start(id)]);
      expect([a.state, b.state]).toEqual(["healthy", "healthy"]);
      const addr1 = await d.agentServerAddress(id);
      await servers.start(id);
      await d.startAgentServer(id, "ignored-when-already-running"); // driver level too
      const addr2 = await d.agentServerAddress(id);
      expect(addr2).toEqual(addr1);
      expect((await servers.status(id)).state).toBe("healthy"); // password was not replaced
      const n = await d.run(id, `pgrep -fc -- '[-]-port ${addr1!.port}( |$)'`);
      expect(n.stdout.trim()).toBe("1");
    }, 90_000);

    t("is reachable through the proxy for the owner, rejected for a stranger and for no credentials", async () => {
      const id = await workspace("authz");
      await servers.start(id);
      const ok = await call(id, "/api/info", { headers: owner });
      expect(ok.status).toBe(200);
      expect(typeof (await ok.json()).version).toBe("string");
      expect((await call(id, "/api/session", { headers: owner })).status).toBe(200);
      expect((await call(id, "/api/info", { headers: stranger })).status).toBe(403);
      expect((await call(id, "/api/info")).status).toBe(403);
      expect((await call(id, "/api/info", { method: "POST", headers: stranger })).status).toBe(403);
      expect((await call(id, "", { method: "POST", headers: stranger })).status).toBe(403); // cannot start someone else's
      expect((await routes.request("/api/playgrounds/nope/agent/api/info", { headers: owner })).status).toBe(404);
    }, 90_000);

    t("client-supplied Authorization is overridden and never reaches, or comes back from, the agent server", async () => {
      const id = await workspace("override");
      await servers.start(id);
      const bogus = `Basic ${btoa("opencode:attacker-guess")}`;
      const r = await call(id, "/api/info", { headers: { ...owner, authorization: bogus } });
      expect(r.status).toBe(200); // the server saw the real credentials, not the attacker's
      // Without an owner cookie the bogus header is no way in either.
      expect((await call(id, "/api/info", { headers: { authorization: bogus } })).status).toBe(403);
      const pw = (servers as unknown as { passwords: Map<string, string> }).passwords.get(id)!;
      expect(JSON.stringify([...r.headers])).not.toContain(pw);
      expect(await r.text()).not.toContain(pw);
    }, 90_000);

    stubOnly("the agent server sees injected server-side credentials, no client cookie, and the terminal's HOME and directory", async () => {
      const id = await workspace("echo");
      await d.injectCredentials(id, [{ path: ".local/share/opencode/auth.json", content: '{"opencode-go":{"type":"api","key":"sk-contract"}}' }]);
      await servers.start(id);
      const echo = await (await call(id, "/api/_stub/echo?x=1", { headers: { ...owner, authorization: "Basic Zm9vOmJhcg==" } })).json();
      const pw = (servers as unknown as { passwords: Map<string, string> }).passwords.get(id)!;
      expect(echo.authorization).toBe(`Basic ${btoa(`opencode:${pw}`)}`);
      expect(echo.cookie).toBeNull();
      expect(echo.path).toBe("/api/_stub/echo?x=1");
      const term = await d.run(id, 'echo "$HOME"; pwd -P');
      const [home, cwd] = term.stdout.trim().split("\n");
      expect(echo.home).toBe(home!);
      expect(echo.cwd).toBe(cwd!);
    }, 60_000);

    t("uses the workspace's seat key: the injected key reaches the server's credential store, config model is shared", async () => {
      const id = await workspace("seatkey");
      await d.injectCredentials(id, [
        { path: ".local/share/opencode/auth.json", content: JSON.stringify({ "opencode-go": { type: "api", key: "sk-contract-seat" } }) },
        { path: ".config/opencode/opencode.json", content: JSON.stringify({ model: "opencode-go/kimi-k3" }) },
      ]);
      await servers.start(id);
      if (opts.real) {
        const creds = await (await call(id, "/api/credential", { headers: owner })).json();
        expect(creds.data.map((c: { integrationID: string }) => c.integrationID)).toContain("opencode-go");
        // Restarting (new password, same HOME) must not duplicate it.
        await d.stopAgentServer(id);
        await servers.start(id);
        const again = await (await call(id, "/api/credential", { headers: owner })).json();
        expect(again.data.filter((c: { integrationID: string }) => c.integrationID === "opencode-go").length).toBe(1);
      } else {
        // The stub records connect/key calls; the terminal and the server read the very same files.
        const log = await (await call(id, "/api/_stub/connected", { headers: owner })).json();
        expect(log).toEqual(["opencode-go"]);
      }
      const term = await d.run(id, 'grep -c kimi-k3 "$HOME/.config/opencode/opencode.json"');
      expect(term.stdout.trim()).toBe("1");
    }, 120_000);

    const real = opts.real ? t : test.skip;
    real("seat key lands in opencode's own store at injection time: the terminal CLI sees it with no agent server running", async () => {
      const id = await workspace("termkey");
      const seat = { key: "sk-contract-terminal" };
      await d.injectCredentials(id, credentialFiles(seat as never));
      expect(await installSeatKey(d, id, seat)).toBe(true);
      const cli = CLI;
      expect((await servers.status(id)).state).toBe("stopped"); // the API's agent server never ran
      const listed = await d.run(id, `${cli} auth list`);
      expect(listed.stdout).toContain("OpenCode Go");
      expect(listed.stdout).toContain("stored");
      expect(listed.stdout).not.toContain(seat.key);
      // Nothing is left running by the import, and running it again does not duplicate.
      expect(await installSeatKey(d, id, seat)).toBe(true);
      const exp = await d.run(id, `${cli} auth export | grep -c '"id": "cred_'`);
      expect(exp.stdout.trim()).toBe("1");
      // Survives hibernate/wake (HOME persists with the workspace).
      await d.hibernate(id);
      await d.wake(id);
      expect((await d.run(id, `${cli} auth list`)).stdout).toContain("OpenCode Go");
      await d.run(id, `${cli} service stop >/dev/null 2>&1; true`);
    }, 120_000);

    real("seat key is installed through the import route when there is no legacy auth.json to migrate", async () => {
      const id = await workspace("termkey2");
      const cli = CLI;
      await d.run(id, `${cli} auth list >/dev/null; ${cli} service stop >/dev/null 2>&1; true`); // creates the database first
      const seat = { key: "sk-contract-late" };
      await d.injectCredentials(id, credentialFiles(seat as never).filter((f) => !f.path.endsWith("auth.json")));
      expect((await d.run(id, `${cli} auth list`)).stdout).not.toContain("OpenCode Go");
      expect(await installSeatKey(d, id, seat)).toBe(true);
      expect((await d.run(id, `${cli} auth list`)).stdout).toContain("OpenCode Go");
      expect((await d.run(id, `${cli} auth export | grep -c '"id": "cred_'`)).stdout.trim()).toBe("1");
      await d.run(id, `${cli} service stop >/dev/null 2>&1; true`);
    }, 120_000);

    t("only sees the workspace directory and only /api/* is forwarded; traversal is refused", async () => {
      const id = await workspace("paths");
      await servers.start(id);
      const loc = await (await call(id, "/api/location", { headers: owner })).text();
      const cwd = (await d.run(id, "pwd -P")).stdout.trim();
      expect(loc).toContain(cwd);
      for (const p of ["/", "/index.html", "/openapi.json", "/_assets/x.js", "/api/../openapi.json", "/api/%2e%2e/openapi.json", "/api/%2E%2E%2fx", "/api/a%5c..%5cb", "/api//info", "/run", "/api"]) {
        const r = await call(id, p, { headers: owner });
        expect([p, r.status === 404 || r.status === 405 ? 404 : r.status]).toEqual([p, 404]);
      }
    }, 90_000);

    stubOnly("request bodies are streamed to the server", async () => {
      const id = await workspace("body");
      await servers.start(id);
      const r = await call(id, "/api/_stub/body", { method: "POST", headers: owner, body: "hello agent" });
      expect(await r.text()).toBe("got:hello agent");
    }, 60_000);

    t("server-sent events arrive live (first frame well before the stream ends)", async () => {
      const id = await workspace("sse");
      await servers.start(id);
      const t0 = Date.now();
      const r = await call(id, "/api/event", { headers: owner });
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("text/event-stream");
      expect(r.headers.get("x-accel-buffering")).toBe("no");
      expect(r.headers.get("cache-control")).toContain("no-transform");
      const reader = r.body!.getReader();
      const first = await Promise.race([reader.read(), Bun.sleep(2000).then(() => "timeout" as const)]);
      expect(first).not.toBe("timeout");
      expect(Date.now() - t0).toBeLessThan(2000);
      const text = new TextDecoder().decode((first as ReadableStreamReadResult<Uint8Array>).value);
      expect(text).toContain("server.connected");
      await reader.cancel(); // closing the stream must not wedge the server
      expect((await call(id, "/api/info", { headers: owner })).status).toBe(200);
    }, 90_000);

    t("the port is not published on the host", async () => {
      const id = await workspace("port");
      await servers.start(id);
      const addr = (await d.agentServerAddress(id))!;
      if (opts.docker) {
        const insp = Bun.spawnSync(["docker", "inspect", "--format", "{{json .NetworkSettings.Ports}}|{{json .HostConfig.PortBindings}}", `rfy-${id}`]);
        const [ports, bindings] = insp.stdout.toString().trim().split("|");
        expect(JSON.stringify(JSON.parse(ports!))).not.toContain("HostPort");
        expect(["{}", "null"]).toContain(bindings!);
        // Nothing on the host answers at the internal port (skip if an unrelated host service owns it).
        const hostConn = await fetch(`http://127.0.0.1:${addr.port}/api/info`, { signal: AbortSignal.timeout(1500) }).then(() => "answered", () => "refused");
        if (!process.env.HOST_PORT_BUSY) expect(hostConn).toBe("refused");
      } else {
        expect(addr.host).toBe("127.0.0.1"); // loopback only; never a routable interface
      }
    }, 90_000);

    t("a killed server comes back on start (and the proxy works again)", async () => {
      const id = await workspace("kill");
      await servers.start(id);
      const addr = (await d.agentServerAddress(id))!;
      const k = await d.run(id, `pkill -9 -f -- '[-]-port ${addr.port}( |$)'; echo done`);
      expect(k.stdout).toContain("done");
      let state = (await servers.status(id)).state;
      for (let i = 0; i < 50 && state !== "stopped"; i++) { await Bun.sleep(100); state = (await servers.status(id)).state; }
      expect(state).toBe("stopped");
      expect((await call(id, "/api/info", { headers: owner })).status).toBe(503); // honest, no hang
      const r = await call(id, "", { method: "POST", headers: owner });
      expect((await r.json()).state).toBe("healthy");
      expect((await servers.status(id)).state).toBe("healthy");
      expect((await call(id, "/api/info", { headers: owner })).status).toBe(200);
    }, 120_000);

    t("after an API restart (password lost) start replaces the orphaned server", async () => {
      const id = await workspace("restart");
      await servers.start(id);
      const fresh = new AgentServers(d); // new process memory: knows no passwords
      expect((await fresh.status(id)).state).toBe("unhealthy");
      expect((await fresh.start(id)).state).toBe("healthy");
      expect((await fresh.status(id)).state).toBe("healthy");
      const n = await d.run(id, `pgrep -fc -- '[-]-port ${(await d.agentServerAddress(id))!.port}( |$)'`);
      expect(n.stdout.trim()).toBe("1");
    }, 120_000);

    t("hibernate stops the server; start after wake brings it back", async () => {
      const id = await workspace("hib");
      await servers.start(id);
      await d.hibernate(id);
      expect((await servers.status(id)).state).toBe("stopped");
      await d.wake(id);
      expect((await servers.start(id)).state).toBe("healthy");
    }, 120_000);
  });
}
