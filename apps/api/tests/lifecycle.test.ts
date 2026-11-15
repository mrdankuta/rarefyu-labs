import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { app } from "../src/app";
import { driver } from "../src/drivers";
import { lookupSnapshot, runLifecycle } from "../src/lifecycle";
import { clearPlaygrounds } from "../src/playgrounds";
import { takeNotices } from "../src/teach";

process.env.SNAPSHOT_DIR = `/tmp/labs-snap-test-${crypto.randomUUID().slice(0, 6)}`;
const H = { "content-type": "application/json", "x-session-key": "life" };
beforeEach(() => clearPlaygrounds());
afterAll(() => { rmSync(process.env.SNAPSHOT_DIR!, { recursive: true, force: true }); });

const MIN = 60_000;
async function newPg(ttlMin = 60) {
  const r = await app.request("/api/playgrounds", { method: "POST", headers: H, body: JSON.stringify({ ttlMin }) });
  return (await r.json()).id as string;
}
const status = async (id: string) => (await (await app.request(`/api/playgrounds/${id}`)).json()).status;
const put = (id: string, path: string, content: string) =>
  app.request(`/api/playgrounds/${id}/files/content`, { method: "PUT", headers: H, body: JSON.stringify({ path, content }) });

async function waitFor(get: () => string, needle: string) {
  for (let i = 0; i < 100; i++) { if (get().includes(needle)) return true; await Bun.sleep(50); }
  return false;
}

describe("workspace lifecycle", () => {
  test("idle workspace hibernates (processes stop, files stay); heartbeat wakes it", async () => {
    const id = await newPg();
    await put(id, "keep.txt", "survives");
    const term = await driver.openTerminal(id, "t1");
    term.write("echo before-sleep\n");
    expect(await waitFor(() => term.scrollback(), "before-sleep")).toBe(true);

    await runLifecycle(Date.now() + 21 * MIN);
    expect(await status(id)).toBe("sleeping");
    // shells ended: reopening gives a fresh terminal without the old output
    expect((await driver.openTerminal(id, "t1")).scrollback()).not.toContain("before-sleep");

    const hb = await app.request(`/api/playgrounds/${id}/heartbeat`, { method: "POST" });
    expect(hb.status).toBe(200);
    expect(await status(id)).toBe("active");
    const file = await (await app.request(`/api/playgrounds/${id}/files/content?path=keep.txt`)).json();
    expect(file.content).toBe("survives");
    await driver.destroy(id);
  });

  test("learner gets a warning notice before expiry", async () => {
    const id = await newPg(60);
    await runLifecycle(Date.now() + 50 * MIN);
    const notices = takeNotices(id);
    expect(notices.some((n) => /expires in/i.test(n.message))).toBe(true);
    // not repeated on the next pass
    await runLifecycle(Date.now() + 51 * MIN);
    expect(takeNotices(id).filter((n) => /expires in/i.test(n.message))).toHaveLength(0);
    await driver.destroy(id);
  });

  test("expiry takes one snapshot, destroys the workspace, and the download works", async () => {
    const id = await newPg(60);
    await put(id, "work.txt", "my-precious-work");
    await runLifecycle(Date.now() + 61 * MIN);
    expect(await status(id)).toBe("destroyed");

    const meta = await app.request(`/api/playgrounds/${id}/snapshot`);
    expect(meta.status).toBe(200);
    const dl = await app.request(`/api/playgrounds/${id}/snapshot.tar`);
    expect(dl.status).toBe(200);
    const bytes = new Uint8Array(await dl.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    const tmp = `${process.env.SNAPSHOT_DIR}/check-${id}.tar.gz`;
    await Bun.write(tmp, bytes);
    const listing = await Bun.$`tar -tzf ${tmp}`.text();
    expect(listing).toContain("work.txt");
    // workspace itself is gone: a fresh driver view starts clean
    await driver.create(id);
    expect((await driver.listFiles(id)).map((f) => f.path)).not.toContain("work.txt");
    await driver.destroy(id);
  });

  test("snapshot is kept for the retention period, then expires", async () => {
    const id = await newPg(60);
    await put(id, "a.txt", "x");
    await runLifecycle(Date.now() + 61 * MIN);
    expect((await app.request(`/api/playgrounds/${id}/snapshot.tar`)).status).toBe(200);
    expect((await lookupSnapshot(id, Date.now() + 6 * 86_400_000)).kind).toBe("file");
    expect((await lookupSnapshot(id, Date.now() + 8 * 86_400_000)).kind).toBe("expired");
    await runLifecycle(Date.now() + 8 * 86_400_000); // purge pass removes the file
    expect((await lookupSnapshot(id, Date.now() + 8 * 86_400_000)).kind).toBe("expired");
  });

  test("explicit stop also snapshots before destroying", async () => {
    const id = await newPg();
    await put(id, "stop.txt", "bye");
    const del = await app.request(`/api/playgrounds/${id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const dl = await app.request(`/api/playgrounds/${id}/snapshot.tar`);
    expect(dl.status).toBe(200);
  });
});
