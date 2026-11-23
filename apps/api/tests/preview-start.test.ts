import { afterAll, describe, expect, test } from "bun:test";
import { agentRules, AGENT_RULES_FILE } from "../src/agent-rules";
import { LocalDriver } from "../src/drivers/local";
import { CLASSIFY_CMD, ensurePreview, startCommand } from "../src/preview-start";

describe("agent rules file", () => {
  test("short, names the preview port, only mentions commands that exist in the image", () => {
    const r = agentRules(3000);
    expect(AGENT_RULES_FILE).toBe("AGENTS.md");
    expect(r.split("\n").length).toBeLessThan(40);
    expect(r).toContain("port 3000");
    expect(r).toContain("python3 -m http.server 3000");
    expect(r).toContain("background");
    expect(r).toContain("plain HTML");
    expect(r).toContain("outside it");
    expect(agentRules(4123)).toContain("http.server 4123");
  });
});

describe("startCommand", () => {
  test("static site", () => expect(startCommand("static", 3000, "0.0.0.0")).toBe("python3 -m http.server 3000 --bind 0.0.0.0"));
  test("vite gets explicit flags, others rely on PORT/HOST", () => {
    expect(startCommand("npm-dev", 3000, "0.0.0.0", "vite")).toContain("-- --host 0.0.0.0 --port 3000 --strictPort");
    expect(startCommand("npm-dev", 3000, "0.0.0.0", "next dev")).toContain("-p 3000 -H 0.0.0.0");
    const c = startCommand("npm-start", 3000, "0.0.0.0", "node server.js");
    expect(c).toContain("PORT=3000 HOST=0.0.0.0 npm run start");
    expect(c).not.toContain(" -- ");
  });
});

describe("ensurePreview (local driver)", () => {
  const d = new LocalDriver();
  const ids: string[] = [];
  const mk = () => { const id = `prev-${crypto.randomUUID().slice(0, 8)}`; ids.push(id); return id; };
  afterAll(async () => { for (const id of ids) await d.destroy(id).catch(() => {}); });
  async function until(fn: () => Promise<boolean>, ms = 8000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await Bun.sleep(100); } return false; }

  test("classifies projects", async () => {
    const a = mk(); await d.create(a);
    expect((await d.run(a, CLASSIFY_CMD)).stdout.trim()).toBe("none"); // README only
    await d.writeFile(a, "index.html", "<h1>x</h1>");
    expect((await d.run(a, CLASSIFY_CMD)).stdout.trim()).toBe("static");
    await d.writeFile(a, "package.json", JSON.stringify({ scripts: { start: "node x.js" } }));
    expect((await d.run(a, CLASSIFY_CMD)).stdout.trim()).toBe("npm-start");
    await d.writeFile(a, "package.json", JSON.stringify({ scripts: { dev: "vite", start: "x" } }));
    expect((await d.run(a, CLASSIFY_CMD)).stdout.trim()).toBe("npm-dev");
    await d.writeFile(a, "package.json", "{not json");
    expect((await d.run(a, CLASSIFY_CMD)).stdout.trim()).toBe("static");
  });

  test("non-web workspace: nothing is started", async () => {
    const id = mk(); await d.create(id);
    const port = await d.previewPort(id);
    expect(await ensurePreview(id, { driver: d })).toEqual({ state: "not-web", port });
    await Bun.sleep(500);
    await expect(fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
  });

  test("static project: starts, reports starting then ready, and is idempotent", async () => {
    const id = mk(); await d.create(id);
    await d.writeFile(id, "index.html", "<h1>hello preview</h1>");
    const first = await ensurePreview(id, { driver: d });
    expect(first.state).toBe("starting");
    expect(await until(async () => (await ensurePreview(id, { driver: d })).state === "ready")).toBe(true);
    const port = await d.previewPort(id);
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toContain("hello preview");
    expect((await ensurePreview(id, { driver: d })).state).toBe("ready");
  });

  test("never comes up: starting, then failed with a terminal hint; retry starts again", async () => {
    const id = mk(); await d.create(id);
    await d.writeFile(id, "package.json", JSON.stringify({ scripts: { dev: "exit 1" } }));
    await d.writeFile(id, "node_modules/.keep", "");
    const t0 = Date.now();
    const s = await ensurePreview(id, { driver: d, now: t0 });
    expect(s.state).toBe("starting");
    expect((await ensurePreview(id, { driver: d, now: t0 + 1000 })).state).toBe("starting");
    const f = await ensurePreview(id, { driver: d, now: t0 + 10 * 60_000 });
    expect(f.state).toBe("failed");
    if (f.state === "failed") expect(f.hint).toContain("terminal");
    expect((await ensurePreview(id, { driver: d, retry: true, now: t0 + 10 * 60_000 })).state).toBe("starting");
  });
});
