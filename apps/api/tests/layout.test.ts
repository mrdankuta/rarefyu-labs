import { beforeEach, describe, expect, test } from "bun:test";
import { app } from "../src/app";
import { driver } from "../src/drivers";
import { clearPlaygrounds } from "../src/playgrounds";

const H = { "content-type": "application/json", "x-session-key": "layout" };
beforeEach(() => clearPlaygrounds());

async function newPg() {
  const r = await app.request("/api/playgrounds", { method: "POST", headers: H, body: "{}" });
  const pg = await r.json();
  return pg.id as string;
}
const put = (id: string, body: unknown) =>
  app.request(`/api/playgrounds/${id}/layout`, { method: "PUT", headers: H, body: JSON.stringify(body) });
const tab = (id: string, title = id) => ({ id, type: "terminal", title, params: {} });

describe("tab layout", () => {
  test("new workspace starts with a terminal and a preview browser tab", async () => {
    const id = await newPg();
    const r = await app.request(`/api/playgrounds/${id}/layout`);
    expect(r.status).toBe(200);
    const l = await r.json();
    expect(l.tabs.map((t: { type: string }) => t.type)).toEqual(["terminal", "browser"]);
    expect(l.tabs[1].params.port).toBe(3000);
    expect(l.activeId).toBe(l.tabs[0].id);
    await driver.destroy(id);
  });

  test("saved layout round-trips: order, titles, active tab", async () => {
    const id = await newPg();
    const body = { tabs: [tab("b", "Server"), tab("a", "Shell")], activeId: "a" };
    expect((await put(id, body)).status).toBe(200);
    const l = await (await app.request(`/api/playgrounds/${id}/layout`)).json();
    expect(l.tabs.map((t: { id: string }) => t.id)).toEqual(["b", "a"]);
    expect(l.tabs[0].title).toBe("Server");
    expect(l.activeId).toBe("a");
    await driver.destroy(id);
  });

  test("rejects duplicate ids, bad ids, empty titles and too many tabs", async () => {
    const id = await newPg();
    expect((await put(id, { tabs: [tab("a"), tab("a")], activeId: "a" })).status).toBe(400);
    expect((await put(id, { tabs: [tab("../x")], activeId: null })).status).toBe(400);
    expect((await put(id, { tabs: [tab("a", "  ")], activeId: null })).status).toBe(400);
    const many = Array.from({ length: 31 }, (_, i) => tab(`t${i}`));
    expect((await put(id, { tabs: many, activeId: null })).status).toBe(400);
    await driver.destroy(id);
  });

  test("removing a terminal tab ends only that shell", async () => {
    const id = await newPg();
    await put(id, { tabs: [tab("a"), tab("b")], activeId: "a" });
    const a = await driver.openTerminal(id, "a");
    const b = await driver.openTerminal(id, "b");
    a.write("echo keep-a\n");
    b.write("echo keep-b\n");
    await Bun.sleep(400);
    await put(id, { tabs: [tab("b")], activeId: "b" });
    expect((await driver.openTerminal(id, "b")).scrollback()).toContain("keep-b");
    expect((await driver.openTerminal(id, "a")).scrollback()).not.toContain("keep-a");
    await driver.destroy(id);
  });

  test("unknown or destroyed workspace → 404", async () => {
    expect((await app.request("/api/playgrounds/nope/layout")).status).toBe(404);
    expect((await put("nope", { tabs: [], activeId: null })).status).toBe(404);
  });
});
