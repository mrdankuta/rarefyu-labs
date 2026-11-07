import { getAllPlaygroundIds, getPlayground } from "./playgrounds";
import { getAttempts } from "./checks";
import { driver } from "./drivers/local";

/**
 * Teach console (issue #8). Instructor views derived from session + check
 * activity. Bench: any signed-in caller acts as instructor; production
 * enforces member.role=owner of the session's org (schema ready).
 * Every action appends to an audit list; learner-visible effects surface
 * through per-session notices (polled by the shell).
 */

export interface Notice {
  id: string;
  kind: "reset" | "announce" | "extend";
  message: string;
  at: string;
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  sessionId?: string;
  detail?: string;
  at: string;
}

const notices = new Map<string, Notice[]>(); // sessionId → pending
const announcements: Notice[] = []; // cohort-wide (bench: global)
const audit: AuditEntry[] = [];

export function clearTeach() {
  notices.clear();
  announcements.length = 0;
  audit.length = 0;
}

function log(actor: string, action: string, sessionId?: string, detail?: string) {
  audit.push({ id: crypto.randomUUID(), actor, action, sessionId, detail, at: new Date().toISOString() });
}

export function getAudit(): AuditEntry[] {
  return [...audit];
}

function pushNotice(sessionId: string, kind: Notice["kind"], message: string) {
  if (!notices.has(sessionId)) notices.set(sessionId, []);
  notices.get(sessionId)!.push({ id: crypto.randomUUID(), kind, message, at: new Date().toISOString() });
}

/** Learner polls this; reading consumes (toast-once semantics). */
export function takeNotices(sessionId: string): Notice[] {
  const mine = notices.get(sessionId) ?? [];
  const all = [...announcements, ...mine];
  notices.set(sessionId, []);
  return all;
}

export type PresenceState = "active" | "idle" | "sleeping" | "stuck" | "destroyed";

export interface Presence {
  sessionId: string;
  status: string;
  lastSeenAt?: string;
  state: PresenceState;
  failedChecks: number;
}

/** Stuck = ≥2 failed checks with no pass on the session (needs a nudge). */
export function getPresence(now = Date.now()): Presence[] {
  const out: Presence[] = [];
  for (const id of getAllPlaygroundIds()) {
    const rec = getPlayground(id);
    if (!rec) continue;
    const atts = getAttempts(id);
    const failed = atts.filter((a) => !a.pass && a.failures[0]?.hint !== "solution unlocked by learner").length;
    const passed = atts.some((a) => a.pass);
    let state: PresenceState;
    if (rec.status === "destroyed") state = "destroyed";
    else if (failed >= 2 && !passed) state = "stuck";
    else if (rec.status === "sleeping") state = "sleeping";
    else if (now - Date.parse(rec.lastSeenAt) > 2 * 60_000) state = "idle";
    else state = "active";
    out.push({ sessionId: id, status: rec.status, lastSeenAt: rec.lastSeenAt, state, failedChecks: failed });
  }
  return out;
}

export async function resetSession(actor: string, sessionId: string): Promise<boolean> {
  const rec = getPlayground(sessionId);
  if (!rec || rec.status === "destroyed") return false;
  await driver.resetProject(sessionId);
  pushNotice(sessionId, "reset", "Your instructor reset this session — fresh filesystem, progress history kept.");
  log(actor, "reset", sessionId);
  return true;
}

export async function extendSession(
  actor: string,
  sessionId: string,
  minutes: number,
): Promise<string | null> {
  const rec = getPlayground(sessionId);
  if (!rec || rec.status === "destroyed") return null;
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) return null;
  const next = new Date(Date.parse(rec.expiresAt!) + minutes * 60_000).toISOString();
  rec.expiresAt = next;
  pushNotice(sessionId, "extend", `Your session was extended by ${minutes} minutes.`);
  log(actor, "extend", sessionId, `+${minutes}m`);
  return next;
}

export function announce(actor: string, message: string): Notice {
  const n: Notice = { id: crypto.randomUUID(), kind: "announce", message, at: new Date().toISOString() };
  announcements.push(n);
  log(actor, "announce", undefined, message.slice(0, 120));
  return n;
}

/** Per-lab stats: boot success, pass rate, median first→pass time. */
export function labStats(track: string): {
  sessions: number;
  passRate: number;
  medianCompletionMs: number | null;
} {
  const ids = getAllPlaygroundIds();
  const relevant = attemptsFor(track, ids);
  const passers = new Set(relevant.filter((a) => a.pass).map((a) => a.sessionId));
  const withAttempts = new Set(relevant.map((a) => a.sessionId));
  // Median first-attempt → first-pass delta per session.
  const deltas: number[] = [];
  for (const sid of withAttempts) {
    const mine = relevant.filter((a) => a.sessionId === sid).sort((x, y) => x.at.localeCompare(y.at));
    const firstPass = mine.find((a) => a.pass);
    if (firstPass) deltas.push(Date.parse(firstPass.at) - Date.parse(mine[0].at));
  }
  deltas.sort((a, b) => a - b);
  return {
    sessions: withAttempts.size,
    passRate: withAttempts.size ? passers.size / withAttempts.size : 0,
    medianCompletionMs: deltas.length ? deltas[Math.floor(deltas.length / 2)] : null,
  };
}

import type { Attempt } from "./checks";
function attemptsFor(track: string, ids: string[]): Attempt[] {
  const out: Attempt[] = [];
  for (const id of ids) out.push(...getAttempts(id).filter((a) => a.track === track));
  return out;
}
