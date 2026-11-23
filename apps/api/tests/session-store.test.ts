import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearPlaygrounds, createPlayground, destroyPlayground, getPlayground, liveSessionFor } from "../src/playgrounds";
import { loadSessions, saveSessions } from "../src/session-store";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sess-"));
  process.env.SESSIONS_FILE = join(dir, "sessions.json");
  clearPlaygrounds();
});
afterEach(() => {
  delete process.env.SESSIONS_FILE;
  rmSync(dir, { recursive: true, force: true });
  clearPlaygrounds();
});

const mk = (owner: string, extra: object = {}) =>
  createPlayground({ ownerKey: owner, ...extra } as Parameters<typeof createPlayground>[0]);

describe("session persistence", () => {
  test("live sessions survive a restart; file is 0600", () => {
    const a = mk("1.1.1.1::a");
    const b = mk("1.1.1.2::b", { seatId: "seat-1" });
    expect(saveSessions()).toBe(2);
    expect(statSync(process.env.SESSIONS_FILE!).mode & 0o777).toBe(0o600);
    clearPlaygrounds(); // simulates the process restarting
    expect(loadSessions()).toBe(2);
    expect(getPlayground(a.id)?.ownerKey).toBe("1.1.1.1::a");
    expect(liveSessionFor("1.1.1.2::b")?.seatId).toBe("seat-1");
    expect(getPlayground(b.id)?.status).toBe("active");
  });

  test("destroyed sessions are not restored", () => {
    const a = mk("2.2.2.2::a");
    destroyPlayground(a.id);
    expect(saveSessions()).toBe(0);
  });

  test("a session caught mid-create comes back destroyed so the reconciler cleans it up", () => {
    const a = mk("3.3.3.3::a");
    getPlayground(a.id)!.status = "creating";
    saveSessions();
    clearPlaygrounds();
    loadSessions();
    expect(getPlayground(a.id)?.status).toBe("destroyed");
  });

  test("missing or corrupt file means an empty start, not a crash", async () => {
    expect(loadSessions()).toBe(0);
    await Bun.write(process.env.SESSIONS_FILE!, "{not json");
    expect(loadSessions()).toBe(0);
  });
});
