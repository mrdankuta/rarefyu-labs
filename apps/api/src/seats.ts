/**
 * Class seats: one code per student, mapped server-side to that student's model key
 * (e.g. an OpenCode Go key). The key never leaves the server except into the
 * student's own workspace home; admin listings show codes, never keys.
 *
 * Two backends, picked by env:
 *   CONVEX_URL set → Convex (the class backend; see /convex). Students' containers need
 *                    only the URL (redeem takes just a code); admin calls also need
 *                    CONVEX_ADMIN_SECRET.
 *   otherwise      → JSON file (mode 0600) under DATA_DIR (dev / single host)
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Seat {
  id: string;
  code: string;
  label: string;
  key: string;
  createdAt: string;
}

// No 0/O/1/I/L: codes get read aloud and typed by hand.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

const file = () => process.env.SEATS_FILE ?? `${process.env.DATA_DIR ?? "/tmp/labs-data"}/seats.json`;

const seats = new Map<string, Seat>(); // id -> seat
const byCode = new Map<string, string>(); // normalised code -> id
let loaded: string | null = null;

export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

function genCode(): string {
  for (;;) {
    const b = crypto.getRandomValues(new Uint8Array(8));
    const raw = [...b].map((x) => ALPHABET[x % ALPHABET.length]).join("");
    if (!byCode.has(raw)) return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  }
}

function load() {
  const f = file();
  if (loaded === f) return;
  seats.clear();
  byCode.clear();
  loaded = f;
  if (!existsSync(f)) return;
  for (const s of JSON.parse(readFileSync(f, "utf8")) as Seat[]) {
    seats.set(s.id, s);
    byCode.set(normalizeCode(s.code), s.id);
  }
}

function save() {
  const f = file();
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp`;
  writeFileSync(tmp, JSON.stringify([...seats.values()], null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, f);
}

function fileAdd(input: { label: string; key: string }[]): Seat[] {
  load();
  const made = input.map(({ label, key }) => {
    const seat: Seat = { id: crypto.randomUUID(), code: genCode(), label, key, createdAt: new Date().toISOString() };
    seats.set(seat.id, seat);
    byCode.set(normalizeCode(seat.code), seat.id);
    return seat;
  });
  save();
  return made;
}

function fileFind(code: string): Seat | undefined {
  load();
  const id = byCode.get(normalizeCode(code));
  return id ? seats.get(id) : undefined;
}

function fileGet(id: string): Seat | undefined {
  load();
  return seats.get(id);
}

function fileList(): Seat[] {
  load();
  return [...seats.values()];
}

function fileRemove(id: string): boolean {
  load();
  const s = seats.get(id);
  if (!s) return false;
  seats.delete(id);
  byCode.delete(normalizeCode(s.code));
  save();
  return true;
}


// --- Convex backend (plain HTTP API; no client dependency) ---

/** Too many wrong codes (backend throttle). */
export class SeatThrottled extends Error {}
/** Seat backend unreachable or misconfigured. */
export class SeatBackendError extends Error {}

const convexUrl = () => (process.env.CONVEX_URL ? process.env.CONVEX_URL.replace(/\/$/, "") : null);

async function convex<T>(kind: "query" | "mutation", path: string, args: Record<string, unknown>): Promise<T> {
  const base = convexUrl()!;
  let res: Response;
  try {
    res = await fetch(`${base}/api/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, args, format: "json" }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    throw new SeatBackendError(`seat backend unreachable: ${(e as Error).message}`);
  }
  const body: any = await res.json().catch(() => ({}));
  if (body.status !== "success") throw new SeatBackendError(`seat backend error: ${body.errorMessage ?? res.status}`);
  return body.value as T;
}
const secret = () => process.env.CONVEX_ADMIN_SECRET ?? "";

// --- Public API (async; backend chosen per call) ---

export async function addSeats(input: { label: string; key: string }[]): Promise<Seat[]> {
  if (!convexUrl()) return fileAdd(input);
  const made = await convex<{ id: string; code: string; label: string }[]>("mutation", "seats:add", { secret: secret(), seats: input });
  return made.map((m, i) => ({ ...m, key: input[i].key, createdAt: new Date().toISOString() }));
}

/** Resolve a class code to its seat, or undefined. Throws SeatThrottled / SeatBackendError on Convex. */
export async function findSeatByCode(code: string): Promise<Seat | undefined> {
  if (!convexUrl()) return fileFind(code);
  const r = await convex<{ ok: true; id: string; label: string; key: string } | { ok: false; reason: "throttled" | "unknown" }>("mutation", "seats:redeem", { code });
  if (r.ok) return { id: r.id, code: normalizeCode(code), label: r.label, key: r.key, createdAt: "" };
  if (r.reason === "throttled") throw new SeatThrottled("too many wrong codes");
  return undefined;
}

export async function getSeat(id: string): Promise<Seat | undefined> {
  if (!convexUrl()) return fileGet(id);
  const r = await convex<{ id: string; code: string; label: string; key: string } | null>("query", "seats:get", { secret: secret(), id });
  return r ? { ...r, createdAt: "" } : undefined;
}

export async function listSeats(): Promise<Omit<Seat, "key">[]> {
  if (!convexUrl()) return fileList().map(({ key: _k, ...rest }) => rest);
  return convex("query", "seats:list", { secret: secret() });
}

export async function removeSeat(id: string): Promise<boolean> {
  if (!convexUrl()) return fileRemove(id);
  return convex<boolean>("mutation", "seats:remove", { secret: secret(), id });
}

/** Test helper: forget in-memory state (does not touch the file). */
export function resetSeatsCache() {
  seats.clear();
  byCode.clear();
  loaded = null;
}

/** Files that make the agents work out of the box for this seat. */
export function credentialFiles(seat: Seat, model = process.env.SEAT_DEFAULT_MODEL ?? "opencode-go/kimi-k3") {
  return [
    {
      path: ".local/share/opencode/auth.json",
      content: JSON.stringify({ "opencode-go": { type: "api", key: seat.key } }),
    },
    {
      path: ".config/opencode/opencode.json",
      content: JSON.stringify({ $schema: "https://opencode.ai/config.json", model }),
    },
  ];
}

/** Failed-code throttle: 10 misses per IP per minute. Returns true when blocked. */
const misses = new Map<string, number[]>();
export function seatGuessBlocked(ip: string, failed: boolean, now = Date.now()): boolean {
  const recent = (misses.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (failed) recent.push(now);
  misses.set(ip, recent);
  return recent.length >= 10;
}
