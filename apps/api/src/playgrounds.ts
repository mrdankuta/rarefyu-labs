import { SessionSchema, type Layout, type Session } from "@rarefyu/lab-sdk";

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
  /** Set when an authenticated user created the workspace; ownership is then by user id. */
  userId?: string;
  /** Class seat this workspace belongs to (holds the model key); never sent to clients. */
  seatId?: string;
  createdAt: string;
  lastSeenAt: string;
  warned: boolean;
  snapshotAt?: string;
  /** Lesson (track slug) this workspace was launched for; undefined = free playground. */
  track?: string;
  /** Set when the backend lost this workspace (reconciler). */
  lostReason?: string;
  /** Persisted tab layout (spec #30); undefined = default layout. */
  layout?: Layout;
}

const playgrounds = new Map<string, PlaygroundRecord>();

let creationPaused = false;
export function setCreationPaused(v: boolean) {
  creationPaused = v;
}
export function isCreationPaused() {
  return creationPaused;
}

export function clearPlaygrounds() {
  playgrounds.clear();
  creationPaused = false;
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

export interface Limits {
  /** Concurrent (non-destroyed) workspaces per owner identity (IP + cookie). */
  perOwner: number;
  /** Concurrent (non-destroyed) workspaces per client IP. */
  perIp: number;
  /** Running (creating|active) workspaces across the host; hibernated ones don't count. */
  global: number;
}

/** Read limits at call time so ops can tune via env and tests can override. */
export function getLimits(): Limits {
  const n = (v: string | undefined, d: number) => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    perOwner: n(process.env.MAX_WORKSPACES_PER_OWNER, 1),
    perIp: n(process.env.MAX_WORKSPACES_PER_IP, 3),
    global: n(process.env.MAX_WORKSPACES_GLOBAL, 20),
  };
}

export const CAPACITY_RETRY_SEC = 30;

function capErr(message: string, status: number, code: string): Error {
  const err = new Error(message);
  Object.assign(err, { status, code });
  return err;
}

/** ownerKey = `${ip}::${cookie}` (or `user:<id>`); the ip may itself contain "::" (IPv6), the cookie never does. */
export const ipOf = (ownerKey: string) => {
  const i = ownerKey.lastIndexOf("::");
  return i < 0 ? ownerKey : ownerKey.slice(0, i);
};
export const cookieOfKey = (ownerKey: string) => {
  const i = ownerKey.lastIndexOf("::");
  return i < 0 ? "anon" : ownerKey.slice(i + 2) || "anon";
};

function assertCapacity(ownerKey: string) {
  if (creationPaused) throw capErr("new playgrounds are temporarily paused", 503, "paused");
  const lim = getLimits();
  let mine = 0, sameIp = 0, running = 0;
  for (const p of playgrounds.values()) {
    if (p.status === "destroyed") continue;
    if (p.ownerKey === ownerKey) mine++;
    if (ipOf(p.ownerKey) === ipOf(ownerKey)) sameIp++;
    if (p.status === "creating" || p.status === "active") running++;
  }
  if (mine >= lim.perOwner)
    throw capErr(`quota exceeded: ${lim.perOwner} concurrent playground session${lim.perOwner === 1 ? "" : "s"}`, 429, "quota_owner");
  if (sameIp >= lim.perIp)
    throw capErr(`quota exceeded: ${lim.perIp} concurrent playground sessions per network`, 429, "quota_ip");
  if (running >= lim.global)
    throw capErr("the platform is at capacity right now", 503, "at_capacity");
}

/** The seat's current workspace, if any (anything not destroyed or lost). */
export function liveSessionForSeat(seatId: string): PlaygroundRecord | undefined {
  for (const p of playgrounds.values())
    if (p.seatId === seatId && p.status !== "destroyed" && !p.lostReason) return p;
  return undefined;
}

export function createPlayground(opts: {
  ownerKey: string;
  userId?: string;
  seatId?: string;
  track?: string;
  mode?: "playground" | "guided";
  labId?: string;
  ttlMin?: number;
  /** Ceiling for ttlMin; class seats lift it to a full class day. Defaults to MAX_TTL_MIN. */
  maxTtlMin?: number;
  now?: number;
}): PlaygroundRecord {
  const now = opts.now ?? Date.now();
  assertCapacity(opts.ownerKey);
  const ttlMin = Math.min(Math.max(opts.ttlMin ?? DEFAULT_TTL_MIN, 1), opts.maxTtlMin ?? MAX_TTL_MIN);
  const rec: PlaygroundRecord = {
    id: crypto.randomUUID(),
    courseId: "playground",
    labId: opts.labId ?? "free-shell",
    backend: "gvisor",
    status: "active",
    terminalWs: "ws://localhost:3000/ws/terminal?stub=1",
    previewBase: "http://localhost:3000/preview/stub",
    mode: opts.mode ?? "playground",
    userId: opts.userId,
    seatId: opts.seatId,
    track: opts.track,
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

/** Ids woken by the last heartbeat; the caller wakes their workspaces. */
const wokeIds = new Set<string>();
export function takeWoke(id: string): boolean {
  return wokeIds.delete(id);
}

export function heartbeat(id: string, now?: number): PlaygroundRecord | undefined {
  const rec = playgrounds.get(id);
  if (!rec) return undefined;
  if (rec.status === "destroyed") return rec;
  const t = now ?? Date.now();
  rec.lastSeenAt = new Date(t).toISOString();
  if (rec.status === "sleeping") {
    rec.status = "active"; // wake on activity
    wokeIds.add(id);
  }
  return rec;
}

/** Time-driven transitions: warn flag, expiry snapshot+destroy, idle hibernate. */
export interface SweepResult {
  warned: number;
  hibernated: number;
  destroyed: number;
  warnedIds: string[];
  hibernatedIds: string[];
  destroyedIds: string[];
}

export function sweepPlaygrounds(now?: number): SweepResult {
  const t = now ?? Date.now();
  let warned = 0, hibernated = 0, destroyed = 0;
  const warnedIds: string[] = [], hibernatedIds: string[] = [], destroyedIds: string[] = [];
  for (const rec of playgrounds.values()) {
    if (rec.status === "destroyed") continue;
    const expires = Date.parse(rec.expiresAt!);
    const idleMs = t - Date.parse(rec.lastSeenAt);
    if (expires - t <= WARN_BEFORE_EXPIRY_MIN * 60_000 && !rec.warned && expires > t) {
      rec.warned = true;
      warned++;
      warnedIds.push(rec.id);
    }
    if (idleMs >= IDLE_HIBERNATE_MIN * 60_000 && rec.status === "active") {
      rec.status = "sleeping";
      hibernated++;
      hibernatedIds.push(rec.id);
    }
    if (expires <= t) {
      // warn → one snapshot → destroy
      if (!rec.snapshotAt) {
        rec.snapshotAt = new Date(t).toISOString();
        rec.snapshotUrl = `/api/playgrounds/${rec.id}/snapshot`;
      }
      rec.status = "destroyed";
      destroyed++;
      destroyedIds.push(rec.id);
    }
  }
  return { warned, hibernated, destroyed, warnedIds, hibernatedIds, destroyedIds };
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

/** Records worth keeping across an API restart (destroyed ones are history only). */
export function exportPlaygrounds(): PlaygroundRecord[] {
  return [...playgrounds.values()].filter((p) => p.status !== "destroyed");
}

/** Boot-time restore. A record caught mid-create has no trustworthy workspace: mark it destroyed so the reconciler cleans up. */
export function importPlaygrounds(recs: PlaygroundRecord[]): number {
  let n = 0;
  for (const r of recs) {
    if (playgrounds.has(r.id)) continue;
    if (r.status === "creating") r.status = "destroyed";
    playgrounds.set(r.id, r);
    n++;
  }
  return n;
}

export function getPlayground(id: string) {
  return playgrounds.get(id);
}

export function getAllPlaygroundIds(): string[] {
  return [...playgrounds.keys()];
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
