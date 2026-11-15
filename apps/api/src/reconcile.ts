import { driver } from "./drivers";
import { auditEvent } from "./teach";
import { getAllPlaygroundIds, getPlayground } from "./playgrounds";

export interface ReconcileResult {
  orphansDestroyed: string[];
  lost: string[];
}

/**
 * Make backend reality match the session store:
 *  - backend workspaces with no live record (crash, restart, failed create) are destroyed;
 *  - live records whose workspace vanished from the backend are marked gone with a reason.
 * Safe to run repeatedly and concurrently with normal traffic: records are created
 * before their workspaces, so an in-flight create is never mistaken for an orphan.
 */
export async function reconcile(): Promise<ReconcileResult> {
  const held = new Set(await driver.list());
  const orphansDestroyed: string[] = [];
  for (const id of held) {
    const rec = getPlayground(id);
    if (!rec || rec.status === "destroyed") {
      await driver.destroy(id).catch(() => {});
      orphansDestroyed.push(id);
      auditEvent("system", "reconcile-orphan", id, "workspace had no live session; destroyed");
    }
  }
  const lost: string[] = [];
  for (const id of getAllPlaygroundIds()) {
    const rec = getPlayground(id)!;
    if ((rec.status === "active" || rec.status === "sleeping") && !held.has(id)) {
      // A workspace is created lazily by some backends on first use; only flag it
      // once it has existed for a while without ever materializing.
      if (Date.now() - Date.parse(rec.createdAt) < 30_000) continue;
      rec.status = "destroyed";
      rec.lostReason = "workspace missing from backend";
      lost.push(id);
      auditEvent("system", "reconcile-lost", id, rec.lostReason);
    }
  }
  return { orphansDestroyed, lost };
}
