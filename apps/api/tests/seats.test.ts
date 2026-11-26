import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../src/app";
import { clearPlaygrounds } from "../src/playgrounds";
import { addSeats, credentialFiles, findSeatByCode, listSeats, resetSeatsCache } from "../src/seats";
import { driver } from "../src/drivers";

const TOKEN = "test-admin-token";
const KEY = "sk-live-SECRET-KEY-123456";
let dir: string;

const admin = { "content-type": "application/json", authorization: `Bearer ${TOKEN}` };
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const cookieOf = (res: Response) => /rfy_sid=([\w-]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "seats-"));
  process.env.SEATS_FILE = join(dir, "seats.json");
  process.env.ADMIN_TOKEN = TOKEN;
  delete process.env.SEATS_REQUIRED;
  delete process.env.CLASS_NAME;
  delete process.env.SHOW_LESSONS;
  resetSeatsCache();
  clearPlaygrounds();
});
afterEach(() => {
  delete process.env.SEATS_FILE;
  delete process.env.ADMIN_TOKEN;
  rmSync(dir, { recursive: true, force: true });
});

describe("seat store", () => {
  test("codes are unique, typable and persisted with 0600 perms", async () => {
    const made = await addSeats(Array.from({ length: 60 }, (_, i) => ({ label: `s${i}`, key: `sk-key-number-${i}` })));
    expect(new Set(made.map((s) => s.code)).size).toBe(60);
    for (const s of made) expect(s.code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(statSync(process.env.SEATS_FILE!).mode & 0o777).toBe(0o600);
    resetSeatsCache(); // simulates an API restart
    expect(await listSeats()).toHaveLength(60);
    expect((await findSeatByCode(made[7].code.toLowerCase().replace("-", " ")))?.id).toBe(made[7].id);
  });

  test("credential files carry the key and a default model", async () => {
    const [seat] = await addSeats([{ label: "a", key: KEY }]);
    const files = credentialFiles(seat);
    expect(JSON.parse(files[0].content)["opencode-go"]).toEqual({ type: "api", key: KEY });
    expect(JSON.parse(files[1].content).model).toBe("opencode-go/muse-spark-1.3-contributor");
    // students must not be nagged to update off the pinned version, and only the class provider is usable
    expect(JSON.parse(files[1].content)).toMatchObject({ update: "disable", enabled_providers: ["opencode-go"] });
  });
});

describe("seat admin API", () => {
  test("refuses without a token, and when no ADMIN_TOKEN is configured", async () => {
    expect((await post("/api/admin/seats", { seats: [{ label: "a", key: KEY }] })).status).toBe(401);
    delete process.env.ADMIN_TOKEN;
    expect((await post("/api/admin/seats", { seats: [{ label: "a", key: KEY }] })).status).toBe(503);
  });

  test("create returns codes; listing never exposes keys", async () => {
    const res = await post("/api/admin/seats", { seats: [{ label: "Ada", key: KEY }] }, admin);
    expect(res.status).toBe(201);
    const { seats } = await res.json();
    expect(seats[0].code).toBeDefined();
    const list = await app.request("/api/admin/seats", { headers: admin });
    const text = await list.text();
    expect(text).toContain("Ada");
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("SECRET");
  });

  test("rejects malformed input", async () => {
    expect((await post("/api/admin/seats", { seats: [] }, admin)).status).toBe(400);
    expect((await post("/api/admin/seats", { seats: [{ label: "x", key: "short" }] }, admin)).status).toBe(400);
  });
});

describe("landing config and agent status", () => {
  test("config reflects class mode and never leaks secrets", async () => {
    let c = await (await app.request("/api/config")).json();
    expect(c).toEqual({ seatsRequired: false, className: null, showLessons: true });
    process.env.SEATS_REQUIRED = "1";
    process.env.CLASS_NAME = "AI Build class";
    c = await (await app.request("/api/config")).json();
    expect(c).toEqual({ seatsRequired: true, className: "AI Build class", showLessons: false });
    process.env.SHOW_LESSONS = "1";
    expect((await (await app.request("/api/config")).json()).showLessons).toBe(true);
    delete process.env.CLASS_NAME;
    delete process.env.SHOW_LESSONS;
  });

  test("agent-status: ready with model for a seat workspace, not ready without a key, never shows the key", async () => {
    const made = await (await post("/api/admin/seats", { seats: [{ label: "Ada", key: KEY }] }, admin)).json();
    const seatPg = await (await post("/api/playgrounds", { seatCode: made.seats[0].code })).json();
    const ready = await app.request(`/api/playgrounds/${seatPg.id}/agent-status`);
    const text = await ready.text();
    expect(JSON.parse(text)).toEqual({ ready: true, model: "opencode-go/muse-spark-1.3-contributor" });
    expect(text).not.toContain(KEY);
    // The local stand-in driver shares the host HOME unless creds were injected; use an empty one here.
    const realHome = process.env.HOME;
    process.env.HOME = dir;
    const anon = await (await post("/api/playgrounds", {})).json();
    const none = await (await app.request(`/api/playgrounds/${anon.id}/agent-status`)).json();
    process.env.HOME = realHome;
    expect(none.ready).toBe(false);
    expect((await app.request("/api/playgrounds/nope/agent-status")).status).toBe(404);
    await driver.destroy(seatPg.id);
    await driver.destroy(anon.id);
  });
});

describe("redeeming a class code", () => {
  async function seat() {
    const res = await post("/api/admin/seats", { seats: [{ label: "Ada", key: KEY }] }, admin);
    return (await res.json()).seats[0] as { id: string; code: string };
  }

  test("creates a workspace with the key injected, and never returns the key", async () => {
    const s = await seat();
    const res = await post("/api/playgrounds", { seatCode: s.code });
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("seatId");
    const pg = JSON.parse(text);
    const out = await driver.run(pg.id, 'cat "$HOME/.local/share/opencode/auth.json"');
    expect(JSON.parse(out.stdout)["opencode-go"].key).toBe(KEY);
    await driver.destroy(pg.id);
  });

  test("seat workspaces last a class day, not the 2h playground default", async () => {
    const s = await seat();
    const pg = await (await post("/api/playgrounds", { seatCode: s.code })).json();
    const mins = (new Date(pg.expiresAt).getTime() - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(470);
    expect(mins).toBeLessThanOrEqual(480);
    await driver.destroy(pg.id);
    const anon = await (await post("/api/playgrounds", {})).json();
    expect((new Date(anon.expiresAt).getTime() - Date.now()) / 60_000).toBeLessThanOrEqual(120);
    await driver.destroy(anon.id);
  });

  test("wrong code is rejected and throttled after repeated misses", async () => {
    const h = { "x-forwarded-for": "198.51.100.7" };
    for (let i = 0; i < 10; i++) expect((await post("/api/playgrounds", { seatCode: "AAAA-AAAA" }, h)).status).toBe(403);
    expect((await post("/api/playgrounds", { seatCode: "AAAA-AAAA" }, h)).status).toBe(429);
  });

  test("redeeming again resumes the same workspace (even from a new browser)", async () => {
    const s = await seat();
    const first = await post("/api/playgrounds", { seatCode: s.code });
    const pg = await first.json();
    const again = await post("/api/playgrounds", { seatCode: s.code });
    expect(again.status).toBe(200);
    const body = await again.json();
    expect(body.id).toBe(pg.id);
    expect(body.resumed).toBe(true);
    // the new browser got the workspace's cookie and can use it
    process.env.ENFORCE_OWNERSHIP = "1";
    try {
      const files = await app.request(`/api/playgrounds/${pg.id}/files`, { headers: { cookie: `rfy_sid=${cookieOf(again)}` } });
      expect(files.status).toBe(200);
    } finally {
      process.env.ENFORCE_OWNERSHIP = "0";
    }
    await driver.destroy(pg.id);
  });

  test("a different browser without the cookie cannot open a seat's workspace", async () => {
    const s = await seat();
    const pg = await (await post("/api/playgrounds", { seatCode: s.code })).json();
    process.env.ENFORCE_OWNERSHIP = "1"; // tests default to 0
    try {
      const res = await app.request(`/api/playgrounds/${pg.id}/files`, { headers: { cookie: "rfy_sid=someone-else" } });
      expect(res.status).toBe(403);
      const anon = await app.request(`/api/playgrounds/${pg.id}/files`);
      expect(anon.status).toBe(403);
    } finally {
      process.env.ENFORCE_OWNERSHIP = "0";
    }
    await driver.destroy(pg.id);
  });

  test("a whole class on one IP is not blocked by the per-IP cap", async () => {
    const made = await (await post("/api/admin/seats", { seats: Array.from({ length: 5 }, (_, i) => ({ label: `s${i}`, key: `sk-class-key-${i}` })) }, admin)).json();
    const ids: string[] = [];
    for (const s of made.seats) {
      const res = await post("/api/playgrounds", { seatCode: s.code }, { "x-forwarded-for": "203.0.113.5" });
      expect(res.status).toBe(201);
      ids.push((await res.json()).id);
    }
    await Promise.all(ids.map((id) => driver.destroy(id)));
  }, 30_000); // each redemption also installs the key into opencode's store (~1-2s when a real opencode is present)

  test("SEATS_REQUIRED blocks code-less anonymous starts", async () => {
    process.env.SEATS_REQUIRED = "1";
    expect((await post("/api/playgrounds", {})).status).toBe(403);
  });

  test("revoking a seat destroys its workspace and invalidates the code", async () => {
    const s = await seat();
    const pg = await (await post("/api/playgrounds", { seatCode: s.code })).json();
    const del = await app.request(`/api/admin/seats/${s.id}`, { method: "DELETE", headers: admin });
    expect(del.status).toBe(200);
    expect((await post("/api/playgrounds", { seatCode: s.code })).status).toBe(403);
    const rec = await app.request(`/api/playgrounds/${pg.id}`);
    expect(rec.status === 404 || (await rec.json()).status === "destroyed").toBe(true);
  });
});
