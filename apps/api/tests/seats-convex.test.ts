/**
 * Seat store against a REAL Convex backend. Skipped unless CONVEX_URL_TEST and
 * CONVEX_ADMIN_SECRET_TEST are set, e.g. with a local backend:
 *   CONVEX_AGENT_MODE=anonymous bunx convex dev          # leave running
 *   bunx convex env set ADMIN_SECRET test-admin-secret
 *   CONVEX_URL_TEST=http://127.0.0.1:3210 CONVEX_ADMIN_SECRET_TEST=test-admin-secret bun test seats-convex
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SeatBackendError, SeatThrottled, addSeats, findSeatByCode, getSeat, listSeats, removeSeat } from "../src/seats";

const url = process.env.CONVEX_URL_TEST;
const secret = process.env.CONVEX_ADMIN_SECRET_TEST;
const d = url && secret ? describe : describe.skip;

d("convex seat store", () => {
  const made: string[] = [];
  beforeAll(() => {
    process.env.CONVEX_URL = url;
    process.env.CONVEX_ADMIN_SECRET = secret;
  });
  afterAll(async () => {
    for (const id of made) await removeSeat(id).catch(() => {});
    delete process.env.CONVEX_URL;
    delete process.env.CONVEX_ADMIN_SECRET;
  });

  test("add → redeem (any casing/spacing) → get → list hides the key → revoke", async () => {
    const [a, b] = await addSeats([{ label: "ana", key: "sk-ana-key-1234" }, { label: "ben", key: "sk-ben-key-5678" }]);
    made.push(a.id, b.id);
    expect(a.code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    const got = await findSeatByCode(a.code.toLowerCase().replace("-", " "));
    expect(got?.id).toBe(a.id);
    expect(got?.key).toBe("sk-ana-key-1234");
    expect((await getSeat(b.id))?.key).toBe("sk-ben-key-5678");
    const listed = await listSeats();
    expect(listed.find((s) => s.id === a.id)?.label).toBe("ana");
    expect(JSON.stringify(listed)).not.toContain("sk-ana-key");
    expect(await removeSeat(a.id)).toBe(true);
    expect(await findSeatByCode(a.code)).toBeUndefined();
    expect(await removeSeat(a.id)).toBe(false);
  });

  test("wrong admin secret is refused", async () => {
    process.env.CONVEX_ADMIN_SECRET = "nope";
    await expect(listSeats()).rejects.toBeInstanceOf(SeatBackendError);
    process.env.CONVEX_ADMIN_SECRET = secret;
  });

  test("unknown codes miss, and a burst of misses trips the throttle", async () => {
    expect(await findSeatByCode("ZZZZ-ZZZZ")).toBeUndefined();
    let throttled = false;
    for (let i = 0; i < 40 && !throttled; i++) {
      try {
        await findSeatByCode("YYYY-YYYY");
      } catch (e) {
        throttled = e instanceof SeatThrottled;
      }
    }
    expect(throttled).toBe(true);
  });

  test("unreachable backend raises SeatBackendError", async () => {
    process.env.CONVEX_URL = "http://127.0.0.1:1";
    await expect(findSeatByCode("AAAA-AAAA")).rejects.toBeInstanceOf(SeatBackendError);
    process.env.CONVEX_URL = url;
  });
});
