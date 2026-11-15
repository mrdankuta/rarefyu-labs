import { beforeEach, describe, expect, test } from "bun:test";
import { app } from "../src/app";
import { driver } from "../src/drivers";
import { clearPlaygrounds } from "../src/playgrounds";
import { trackLayout } from "../src/tracks";

beforeEach(() => clearPlaygrounds());
const H = { "content-type": "application/json", "x-session-key": "tt" };
const create = (body: unknown) => app.request("/api/playgrounds", { method: "POST", headers: H, body: JSON.stringify(body) });

describe("lab-declared default tabs", () => {
  test("a track's declared tabs become the starting layout", async () => {
    const res = await create({ track: "demo-agent" });
    expect(res.status).toBe(201);
    const id = (await res.json()).id;
    const l = await (await app.request(`/api/playgrounds/${id}/layout`)).json();
    expect(l.tabs.map((t: { type: string; title: string }) => `${t.type}:${t.title}`)).toEqual(["terminal:Terminal", "browser:Preview"]);
    expect(l.tabs[1].params.port).toBe(3000);
    expect(l.activeId).toBe(l.tabs[0].id);
    await driver.destroy(id);
  });

  test("the student's own layout changes win over the defaults afterwards", async () => {
    const id = (await (await create({ track: "demo-agent" })).json()).id;
    const l = await (await app.request(`/api/playgrounds/${id}/layout`)).json();
    l.tabs.push({ id: "mine", type: "terminal", title: "Mine", params: {} });
    expect((await app.request(`/api/playgrounds/${id}/layout`, { method: "PUT", headers: H, body: JSON.stringify(l) })).status).toBe(200);
    const again = await (await app.request(`/api/playgrounds/${id}/layout`)).json();
    expect(again.tabs.map((t: { id: string }) => t.id)).toContain("mine");
    await driver.destroy(id);
  });

  test("unknown track is rejected before anything is created", async () => {
    const res = await create({ track: "no-such-track" });
    expect(res.status).toBe(404);
    expect((await app.request("/api/workspaces/current", { headers: H })).status).toBe(404);
  });

  test("workspaces without a track get the platform default", async () => {
    const id = (await (await create({})).json()).id;
    const l = await (await app.request(`/api/playgrounds/${id}/layout`)).json();
    expect(l.tabs.map((t: { type: string }) => t.type)).toEqual(["terminal", "browser"]);
    await driver.destroy(id);
  });

  test("tab mapping: types, params, limits, and junk is skipped", () => {
    const l = trackLayout({
      tabs: [
        { title: "Shell", type: "terminal", workdir: "src", cmd: "npm test" },
        { title: "App", type: "service", port: 8080, path: "/health" },
        { title: "Docs", type: "website" },
        { title: "main", type: "editor", path: "src/app.ts" },
        { title: "noop", type: "editor" }, // editor without a file: skipped
        { title: "vm", type: "virtual-browser" }, // not supported: skipped
      ],
    })!;
    expect(l.tabs.map((t) => t.type)).toEqual(["terminal", "browser", "browser", "editor"]);
    expect(l.tabs[0].params).toEqual({ workdir: "src", cmd: "npm test" });
    expect(l.tabs[1].params).toEqual({ port: 8080, path: "/health" });
    expect(l.tabs[2].params.port).toBe(3000);
    expect(l.tabs[3].params.path).toBe("src/app.ts");
    expect(l.activeEditorId).toBe(l.tabs[3].id);
    expect(trackLayout({ tabs: [] })).toBeUndefined();
  });
});
