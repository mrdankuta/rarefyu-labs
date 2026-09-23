import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Better-Auth server. Organizations model cohorts:
 * owner = instructor, member = learner.
 * Slice 2 adds emailOTP + OAuth (github/google) + passkey plugins.
 * Requires POSTGRES_URL and BETTER_AUTH_SECRET (see .env.example).
 */
const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
const db = drizzle(pool, { schema });

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  plugins: [organization()],
});

export type Auth = typeof auth;
