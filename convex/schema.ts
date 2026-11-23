import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // One row per student: code → model key. Keys never leave except through `redeem`
  // (student's code) or `get` (server secret).
  seats: defineTable({
    label: v.string(),
    code: v.string(), // normalised: uppercase A-Z0-9, no dash
    key: v.string(),
  }).index("by_code", ["code"]),
  // Failed redeem attempts, for a global guess throttle (Convex can't see client IPs).
  misses: defineTable({ at: v.number() }).index("by_at", ["at"]),
});
