import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Better-Auth tables. Additive-only: never rename columns or drop tables
 * mid-cohort (migrations append; see issue #3 acceptance). Organization =
 * cohort (owner = instructor, member = learner). Guided-session records
 * carry the claiming user + cohort for quota and progress joins.
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

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const member = pgTable("member", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id),
  userId: text("user_id").notNull().references(() => user.id),
  role: text("role").notNull().default("member"), // owner = instructor
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id),
  email: text("email").notNull(),
  role: text("role").default("member"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  inviterId: text("inviter_id").references(() => user.id),
});

// Guided labs: claiming user + cohort, progress + attempts join here.
export const guidedSession = pgTable("guided_session", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id),
  organizationId: text("organization_id").references(() => organization.id),
  track: text("track").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const attempt = pgTable("attempt", {
  id: text("id").primaryKey(),
  guidedSessionId: text("guided_session_id").references(() => guidedSession.id),
  userId: text("user_id").notNull().references(() => user.id),
  track: text("track").notNull(),
  step: text("step").notNull(),
  pass: integer("pass").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const progress = pgTable("progress", {
  userId: text("user_id").notNull().references(() => user.id),
  track: text("track").notNull(),
  step: text("step").notNull(),
  passedAt: timestamp("passed_at").defaultNow().notNull(),
});
