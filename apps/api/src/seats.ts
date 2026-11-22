/**
 * Class seats: one code per student, mapped server-side to that student's model key
 * (e.g. an OpenCode Go key). The key never leaves the server except into the
 * student's own workspace home; admin listings show codes, never keys.
 *
 * Persisted as JSON (mode 0600) under DATA_DIR so seats survive API restarts.
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

export function addSeats(input: { label: string; key: string }[]): Seat[] {
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

export function findSeatByCode(code: string): Seat | undefined {
  load();
  const id = byCode.get(normalizeCode(code));
  return id ? seats.get(id) : undefined;
}

export function getSeat(id: string): Seat | undefined {
  load();
  return seats.get(id);
}

export function listSeats(): Seat[] {
  load();
  return [...seats.values()];
}

export function removeSeat(id: string): boolean {
  load();
  const s = seats.get(id);
  if (!s) return false;
  seats.delete(id);
  byCode.delete(normalizeCode(s.code));
  save();
  return true;
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
