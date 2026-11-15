import { driver } from "./drivers";
import {
  SNAPSHOT_RETENTION_DAYS,
  getAllPlaygroundIds,
  getPlayground,
  snapshotRetentionUntil,
  sweepPlaygrounds,
  type SweepResult,
} from "./playgrounds";
import { noticeFor } from "./teach";

/**
 * Workspace lifecycle policy applied to real workspaces (spec #30):
 * idle → hibernate (files kept), activity → wake, warn → one snapshot → destroy,
 * snapshots retained for a bounded period.
 */

const SNAPSHOT_DIR = () => process.env.SNAPSHOT_DIR ?? "/tmp/labs-snapshots";
const snapPath = (id: string) => `${SNAPSHOT_DIR()}/${id}.tar.gz`;

/** Save the workspace tarball (best effort), then destroy the workspace. */
export async function retireWorkspace(id: string): Promise<void> {
  try {
    await Bun.$`mkdir -p ${SNAPSHOT_DIR()}`.quiet();
    const stream = await driver.snapshotTar(id);
    await Bun.write(snapPath(id), await new Response(stream).arrayBuffer());
  } catch {
    /* snapshot is best effort; never block destroy */
  }
  await driver.destroy(id).catch(() => {});
}

export type SnapshotLookup =
  | { kind: "file"; path: string }
  | { kind: "live" }
  | { kind: "expired" }
  | { kind: "none" };

/** Where to read a workspace's snapshot bytes from, honoring retention. */
export async function lookupSnapshot(id: string, now = Date.now()): Promise<SnapshotLookup> {
  const rec = getPlayground(id);
  if (!rec) return { kind: "none" };
  if (rec.status !== "destroyed") return { kind: "live" };
  if (now > Date.parse(snapshotRetentionUntil(rec))) {
    await Bun.$`rm -f ${snapPath(id)}`.quiet();
    return { kind: "expired" };
  }
  return (await Bun.file(snapPath(id)).exists()) ? { kind: "file", path: snapPath(id) } : { kind: "none" };
}

/** One lifecycle pass: apply policy transitions to the real workspaces. */
export async function runLifecycle(now?: number): Promise<SweepResult> {
  const r = sweepPlaygrounds(now);
  for (const id of r.warnedIds) {
    noticeFor(id, "Your workspace expires in about 15 minutes — download a snapshot or save your work.");
  }
  await Promise.all(r.hibernatedIds.map((id) => driver.hibernate(id).catch(() => {})));
  await Promise.all(r.destroyedIds.map((id) => retireWorkspace(id)));
  // Purge snapshots past retention.
  const t = now ?? Date.now();
  for (const id of getAllPlaygroundIds()) {
    const rec = getPlayground(id);
    if (rec?.status === "destroyed" && rec.snapshotAt && t > Date.parse(snapshotRetentionUntil(rec))) {
      await Bun.$`rm -f ${snapPath(id)}`.quiet();
    }
  }
  return r;
}

export { SNAPSHOT_RETENTION_DAYS };
