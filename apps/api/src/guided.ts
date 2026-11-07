/**
 * Guided-session claims (issue #3). Auth resolution + quota accounting.
 * Production: Better-Auth session token → user; counts from Postgres.
 * Bench/dev without Postgres: LABS_TEST_USER stub, ONLY when NODE_ENV=test.
 */

export interface GuidedRecord {
  id: string;
  userId: string;
  organizationId?: string;
  track: string;
  status: "active" | "destroyed";
  createdAt: string;
}

const guided = new Map<string, GuidedRecord>();

export function clearGuided() {
  guided.clear();
}

export function listGuided(userId: string): GuidedRecord[] {
  return [...guided.values()].filter((g) => g.userId === userId && g.status === "active");
}

export function countGuidedToday(userId: string, now = Date.now()): number {
  const dayAgo = now - 24 * 3600_000;
  return [...guided.values()].filter(
    (g) => g.userId === userId && Date.parse(g.createdAt) >= dayAgo,
  ).length;
}

export function createGuidedRec(opts: {
  userId: string;
  organizationId?: string;
  track: string;
}): GuidedRecord {
  const rec: GuidedRecord = {
    id: crypto.randomUUID(),
    userId: opts.userId,
    organizationId: opts.organizationId,
    track: opts.track,
    status: "active",
    createdAt: new Date().toISOString(),
  };
  guided.set(rec.id, rec);
  return rec;
}

export function destroyGuided(id: string, userId: string): boolean {
  const rec = guided.get(id);
  if (!rec || rec.userId !== userId) return false;
  rec.status = "destroyed";
  return true;
}

export function getGuided(id: string) {
  return guided.get(id);
}

/**
 * Resolve the caller. Test stub (header x-test-user) is honored ONLY under
 * NODE_ENV=test so it can never slip into production. Otherwise a Bearer
 * Better-Auth session token is validated against the configured auth service.
 */
export async function resolveUser(
  c: { req: { header: (h: string) => string | undefined } },
): Promise<string | null> {
  if (process.env.NODE_ENV === "test") {
    const stub = c.req.header("x-test-user");
    if (stub) return stub;
  }
  const authz = c.req.header("authorization");
  if (!authz?.startsWith("Bearer ")) return null;
  if (!process.env.POSTGRES_URL) return null;
  try {
    const { auth } = await import("@rarefyu/auth");
    const s = await auth.api.getSession({ headers: { authorization: authz } });
    return s?.user?.id ?? null;
  } catch {
    return null;
  }
}
