import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Minimal Better-Auth tables. Slice 2 adds organization/member/invitation
 * plus emailOTP/passkey plugin tables via `drizzle-kit generate`.
 */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id),
  expiresAt: timestamp("expires_at").notNull(),
});
