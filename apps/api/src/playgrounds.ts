import { SessionSchema, type Session } from "@rarefyu/lab-sdk";

/**
 * Anonymous playground loop (workspace-spec §5–§6, step 1).
 * No auth in path. Identity = IP + cookie key. Quota: 1 live session.
 * TTL default 2h (configurable), idle-hibernate at 20 min, 15-min warning,
 * warn → one snapshot → destroy. Real pod creation arrives with the
 * gVisor ExecDriver; here sessions are active records with lifecycle.
 */

export const DEFAULT_TTL_MIN = 120;
export const MAX_TTL_MIN = 240;
export const IDLE_HIBERNATE_MIN = 20;
export const WARN_BEFORE_EXPIRY_MIN = 15;
export const SNAPSHOT_RETENTION_DAYS = 7;

export interface PlaygroundRecord extends Session {
  ownerKey: string;
  createdAt: string;
  lastSeenAt: string;
  warned: boolean;
  snapshotAt?: string;
}

const playgrounds = new Map<string, PlaygroundRecord>();

export function clearPlaygrounds() {
  playgrounds.clear();
}

export function identityKey(ip: string, cookieKey: string): string {
  return `${ip}::${cookieKey || "anon"}`;
}

export function liveSessionFor(ownerKey: string): PlaygroundRecord | undefined {
  for (const p of playgrounds.values()) {
    if (p.ownerKey === ownerKey && (p.status === "creating" || p.status === "active")) return p;
  }
  return undefined;
}

export function createPlayground(opts: {
  ownerKey: string;
  labId?: string;
  ttlMin?: number;
  now?: number;
}): PlaygroundRecord {
  const now = opts.now ?? Date.now();
  const live = liveSessionFor(opts.ownerKey);
  if (live) {
    const err = new Error("quota exceeded: 1 concurrent playground session");
    (err as { status?: number }).status = 429;
    throw err;
  }
  const ttlMin = Math.min(Math.max(opts.ttlMin ?? DEFAULT_TTL_MIN, 1), MAX_TTL_MIN);
  const rec: PlaygroundRecord = {
    id: crypto.randomUUID(),
    courseId: "playground",
    labId: opts.labId ?? "free-shell",
    backend: "gvisor",
    status: "active",
    terminalWs: "ws://localhost:3000/ws/terminal?stub=1",
    previewBase: "http://localhost:3000/preview/stub",
    mode: "playground",
    expiresAt: new Date(now + ttlMin * 60_000).toISOString(),
    ownerKey: opts.ownerKey,
    createdAt: new Date(now).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    warned: false,
  };
  SessionSchema.parse(rec);
  playgrounds.set(rec.id, rec);
  return rec;
}

export function heartbeat(id: string, now?: number): PlaygroundRecord | undefined {
  const rec = playgrounds.get(id);
  if (!rec) return undefined;
  if (rec.status === "destroyed") return rec;
  const t = now ?? Date.now();
  rec.lastSeenAt = new Date(t).toISOString();
  if (rec.status === "sleeping") rec.status = "active"; // wake on activity
  return rec;
}

/** Time-driven transitions: warn flag, expiry snapshot+destroy, idle hibernate. */
export function sweepPlaygrounds(now?: number): { warned: number; hibernated: number; destroyed: number } {
  const t = now ?? Date.now();
  let warned = 0, hibernated = 0, destroyed = 0;
  for (const rec of playgrounds.values()) {
    if (rec.status === "destroyed") continue;
    const expires = Date.parse(rec.expiresAt!);
    const idleMs = t - Date.parse(rec.lastSeenAt);
    if (expires - t <= WARN_BEFORE_EXPIRY_MIN * 60_000 && !rec.warned && expires > t) {
      rec.warned = true;
      warned++;
    }
    if (idleMs >= IDLE_HIBERNATE_MIN * 60_000 && rec.status === "active") {
      rec.status = "sleeping";
      hibernated++;
    }
    if (expires <= t) {
      // warn → one snapshot → destroy
      if (!rec.snapshotAt) {
        rec.snapshotAt = new Date(t).toISOString();
        rec.snapshotUrl = `/api/playgrounds/${rec.id}/snapshot`;
      }
      rec.status = "destroyed";
      destroyed++;
    }
  }
  return { warned, hibernated, destroyed };
}

/** Kill switch: nuke all playgrounds in <60s (in-memory: instant). */
export function nukePlaygrounds(now?: number): { destroyed: number } {
  const t = now ?? Date.now();
  let destroyed = 0;
  for (const rec of playgrounds.values()) {
    if (rec.status === "destroyed") continue;
    if (!rec.snapshotAt) {
      rec.snapshotAt = new Date(t).toISOString();
      rec.snapshotUrl = `/api/playgrounds/${rec.id}/snapshot`;
    }
    rec.status = "destroyed";
    destroyed++;
  }
  return { destroyed };
}

export function getPlayground(id: string) {
  return playgrounds.get(id);
}

export function destroyPlayground(id: string, now?: number): boolean {
  const rec = playgrounds.get(id);
  if (!rec) return false;
  if (rec.status === "destroyed") return true;
  const t = now ?? Date.now();
  if (!rec.snapshotAt) {
    rec.snapshotAt = new Date(t).toISOString();
    rec.snapshotUrl = `/api/playgrounds/${rec.id}/snapshot`;
  }
  rec.status = "destroyed";
  return true;
}

export function snapshotRetentionUntil(rec: PlaygroundRecord): string {
  const base = Date.parse(rec.snapshotAt ?? rec.createdAt);
  return new Date(base + SNAPSHOT_RETENTION_DAYS * 86_400_000).toISOString();
}
