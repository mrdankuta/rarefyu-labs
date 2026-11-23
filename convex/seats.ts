/**
 * Class seats backend. Student-facing: `redeem` (needs only the class code).
 * Admin-facing: add/list/get/remove (need ADMIN_SECRET, set with
 * `npx convex env set ADMIN_SECRET <long random>`).
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// No 0/O/1/I/L: codes get read aloud and typed by hand.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const MAX_MISSES_PER_MIN = 30; // global: 60 students typo-ing is fine, brute force is not
const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

function requireAdmin(secret: string) {
  const expected = process.env.ADMIN_SECRET;
  if (!expected) throw new Error("ADMIN_SECRET is not set on this deployment");
  if (secret.length !== expected.length || secret !== expected) throw new Error("unauthorized");
}

const show = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export const add = mutation({
  args: { secret: v.string(), seats: v.array(v.object({ label: v.string(), key: v.string() })) },
  handler: async (ctx, { secret, seats }) => {
    requireAdmin(secret);
    if (seats.length < 1 || seats.length > 500) throw new Error("1-500 seats per call");
    const made = [];
    for (const s of seats) {
      let code = "";
      for (;;) {
        const b = crypto.getRandomValues(new Uint8Array(8));
        code = [...b].map((x) => ALPHABET[x % ALPHABET.length]).join("");
        const clash = await ctx.db.query("seats").withIndex("by_code", (q) => q.eq("code", code)).first();
        if (!clash) break;
      }
      const id = await ctx.db.insert("seats", { label: s.label, code, key: s.key });
      made.push({ id, code: show(code), label: s.label });
    }
    return made;
  },
});

export const redeem = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const now = Date.now();
    const recent = await ctx.db.query("misses").withIndex("by_at", (q) => q.gt("at", now - 60_000)).collect();
    if (recent.length >= MAX_MISSES_PER_MIN) return { ok: false as const, reason: "throttled" as const };
    const norm = normalize(code);
    const seat = norm.length === 8
      ? await ctx.db.query("seats").withIndex("by_code", (q) => q.eq("code", norm)).first()
      : null;
    if (!seat) {
      await ctx.db.insert("misses", { at: now });
      return { ok: false as const, reason: "unknown" as const };
    }
    return { ok: true as const, id: seat._id as string, label: seat.label, key: seat.key };
  },
});

export const get = query({
  args: { secret: v.string(), id: v.string() },
  handler: async (ctx, { secret, id }) => {
    requireAdmin(secret);
    const nid = ctx.db.normalizeId("seats", id);
    const s = nid ? await ctx.db.get(nid) : null;
    return s ? { id: s._id as string, code: show(s.code), label: s.label, key: s.key } : null;
  },
});

export const list = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    requireAdmin(secret);
    const all = await ctx.db.query("seats").collect();
    return all.map((s) => ({ id: s._id as string, code: show(s.code), label: s.label, createdAt: new Date(s._creationTime).toISOString() }));
  },
});

export const remove = mutation({
  args: { secret: v.string(), id: v.string() },
  handler: async (ctx, { secret, id }) => {
    requireAdmin(secret);
    const nid = ctx.db.normalizeId("seats", id);
    if (!nid || !(await ctx.db.get(nid))) return false;
    await ctx.db.delete(nid);
    return true;
  },
});

// Housekeeping: drop old throttle rows. Cheap; call from a cron or by hand.
export const sweepMisses = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    requireAdmin(secret);
    const old = await ctx.db.query("misses").withIndex("by_at", (q) => q.lt("at", Date.now() - 3_600_000)).collect();
    for (const m of old) await ctx.db.delete(m._id);
    return old.length;
  },
});
