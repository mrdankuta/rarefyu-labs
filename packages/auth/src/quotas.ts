/**
 * Guided-session entitlement decisions (issue #3).
 * Pure functions — no DB, fully unit-tested. The API feeds them counts
 * from Postgres (production) or the in-memory store (bench/dev).
 */

export interface QuotaPolicy {
  maxLive: number; // concurrent guided sessions
  maxDaily: number; // guided sessions created per rolling 24h
  plan: string;
}

export const LEARNER_POLICY: QuotaPolicy = { maxLive: 2, maxDaily: 4, plan: "free" };
export const INSTRUCTOR_POLICY: QuotaPolicy = {
  maxLive: 10,
  maxDaily: 50,
  plan: "instructor",
};

export interface QuotaUsage {
  live: number;
  createdLast24h: number;
}

export type QuotaDecision =
  | { ok: true }
  | { ok: false; error: string; remedy: string; retryAfterSec?: number };

export function checkQuota(usage: QuotaUsage, policy: QuotaPolicy): QuotaDecision {
  if (usage.live >= policy.maxLive) {
    return {
      ok: false,
      error: `guided limit reached (${usage.live}/${policy.maxLive} live on the ${policy.plan} plan)`,
      remedy: "stop an idle session or wait for one to expire",
    };
  }
  if (usage.createdLast24h >= policy.maxDaily) {
    const retryAfterSec = 24 * 3600;
    return {
      ok: false,
      error: `daily guided allowance used (${usage.createdLast24h}/${policy.maxDaily} on the ${policy.plan} plan)`,
      remedy: "come back tomorrow, or ask your instructor for a higher seat",
      retryAfterSec,
    };
  }
  return { ok: true };
}

/** Anonymous callers may use playgrounds but never guided sessions. */
export function requireGuidedAuth(
  userId: string | null,
): { ok: true; userId: string } | { ok: false; error: string; remedy: string } {
  if (!userId) {
    return {
      ok: false,
      error: "sign-in required for guided labs",
      remedy: "sign in (or keep using anonymous playgrounds — no account needed)",
    };
  }
  return { ok: true, userId };
}
