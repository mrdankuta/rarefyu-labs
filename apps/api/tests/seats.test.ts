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
  resetSeatsCache();
  clearPlaygrounds();
});
afterEach(() => {
  delete process.env.SEATS_FILE;
  delete process.env.ADMIN_TOKEN;
  rmSync(dir, { recursive: true, force: true });
});

describe("seat store", () => {
  test("codes are unique, typable and persisted with 0600 perms", () => {
    const made = addSeats(Array.from({ length: 60 }, (_, i) => ({ label: `s${i}`, key: `sk-key-number-${i}` })));
    expect(new Set(made.map((s) => s.code)).size).toBe(60);
    for (const s of made) expect(s.code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(statSync(process.env.SEATS_FILE!).mode & 0o777).toBe(0o600);
    resetSeatsCache(); // simulates an API restart
    expect(listSeats()).toHaveLength(60);
    expect(findSeatByCode(made[7].code.toLowerCase().replace("-", " "))?.id).toBe(made[7].id);
  });

  test("credential files carry the key and a default model", () => {
    const [seat] = addSeats([{ label: "a", key: KEY }]);
    const files = credentialFiles(seat);
    expect(JSON.parse(files[0].content)["opencode-go"]).toEqual({ type: "api", key: KEY });
    expect(JSON.parse(files[1].content).model).toBe("opencode-go/kimi-k3");
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
  });

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
