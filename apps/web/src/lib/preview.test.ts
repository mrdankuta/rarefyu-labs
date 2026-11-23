import { describe, expect, test } from "bun:test";
import { PreviewController, type EnsureAnswer } from "./preview";

function setup(answers: (EnsureAnswer | "boom")[]) {
  const calls: string[] = [];
  const hooks = { ready: [] as [number, boolean][], notReady: 0, ports: [] as number[] };
  let i = 0;
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push(`${url} ${init?.body}`);
    const a = answers[Math.min(i++, answers.length - 1)]!;
    if (a === "boom") throw new Error("net");
    return new Response(JSON.stringify(a), { status: 200 });
  }) as unknown as typeof fetch;
  const c = new PreviewController("", "ws1", {
    onReady: (p, r) => hooks.ready.push([p, r]),
    onNotReady: () => { hooks.notReady++; },
    onPort: (p) => hooks.ports.push(p),
    onChange: () => {},
  }, fetcher, 5);
  return { c, calls, hooks };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("PreviewController", () => {
  test("starts idle (no flash), shows starting while booting, then ready; quiet polling in between", async () => {
    const { c, hooks } = setup([{ state: "starting", port: 3000 }, { state: "starting", port: 3000 }, { state: "ready", port: 3000 }]);
    expect(c.ui).toBe("idle");
    await c.ensure();
    expect(c.ui).toBe("starting");
    await wait(60);
    expect(c.ui).toBe("ready");
    expect(hooks.ready).toEqual([[3000, false]]);
    c.dispose();
  });
  test("network errors while starting stay 'starting' (no error page)", async () => {
    const { c } = setup([{ state: "starting", port: 3000 }, "boom", "boom", { state: "ready", port: 3000 }]);
    await c.ensure();
    await wait(80);
    expect(c.ui).toBe("ready");
    c.dispose();
  });
  test("turn-end refresh asks the page to reload in place", async () => {
    const { c, hooks } = setup([{ state: "ready", port: 3000 }]);
    await c.ensure({ reload: true });
    expect(hooks.ready).toEqual([[3000, true]]);
    c.dispose();
  });
  test("failed shows the hint; retry goes back to starting and sends retry:true", async () => {
    const { c, calls } = setup([{ state: "failed", port: 3000, hint: "run: python3 -m http.server 3000" }, { state: "starting", port: 3000 }]);
    await c.ensure();
    expect(c.ui).toBe("failed");
    expect(c.hint).toContain("python3");
    await c.ensure({ retry: true });
    expect(c.ui).toBe("starting");
    expect(calls.at(-1)).toContain('"retry":true');
    c.dispose();
  });
  test("not-web: nothing to wait for, no polling", async () => {
    const { c, calls } = setup([{ state: "not-web", port: 3000 }]);
    await c.ensure();
    await wait(40);
    expect(c.ui).toBe("not-web");
    expect(calls.length).toBe(1);
  });
  test("concurrent ensure calls share one request", async () => {
    const { c, calls } = setup([{ state: "not-web", port: 3000 }]);
    await Promise.all([c.ensure(), c.ensure(), c.ensure({ reload: true })]);
    expect(calls.length).toBe(1);
  });
});
