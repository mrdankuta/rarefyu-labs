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

/** The class model: what a seat's OpenCode starts on unless SEAT_DEFAULT_MODEL says otherwise. */
export const DEFAULT_SEAT_MODEL = "opencode-go/muse-spark-1.3-contributor";

/**
 * Seat OpenCode config (global file, read by the terminal TUI and the chat's agent server):
 * - `update: "disable"`: no "/update to install vX" nag; students must not move off the pinned version.
 * - `enabled_providers: ["opencode-go"]`: only the class provider is usable, even if a student connects another
 *   integration from the TUI. (OpenCode 2.4.1 has no supported per-model allowlist: its provider `whitelist` is
 *   ignored, so the picker still lists every model the plan allows; spend is capped per key by the plan.)
 */
export function seatConfig(model: string) {
  return {
    $schema: "https://opencode.ai/config.json",
    model,
    update: "disable",
    enabled_providers: ["opencode-go"],
  };
}

/** Files that make the agents work out of the box for this seat. */
export function credentialFiles(seat: Seat, model = process.env.SEAT_DEFAULT_MODEL ?? DEFAULT_SEAT_MODEL) {
  return [
    {
      path: ".local/share/opencode/auth.json",
      content: JSON.stringify({ "opencode-go": { type: "api", key: seat.key } }),
    },
    {
      path: ".config/opencode/opencode.json",
      content: JSON.stringify(seatConfig(model)),
    },
  ];
}

/**
 * OpenCode 2.x keeps credentials in its own database under $HOME/.local/share/opencode.
 * It migrates the legacy auth.json above only when it first creates that database, so we
 * make that happen right after injection: `opencode auth list` starts its background
 * service once (migrating the file), and if the key is still not connected (database
 * already existed) we fall back to the official `opencode auth import`, which reads the
 * credential JSON on stdin (never argv) and is idempotent by credential id. The service is
 * stopped again so nothing keeps running. The database lives in the workspace's HOME, so it
 * survives hibernate/wake and container recreation (Docker: the per-workspace home volume;
 * local: the session home) and goes away only with the workspace.
 * Run right after injectCredentials so the terminal `opencode` works first time, without Chat.
 */
export const SEAT_CREDENTIAL_ID = "cred_seat";
// Output goes to a temp file, not a pipe: `opencode` leaves its background service holding
// inherited stdout open, so a captured pipe would never reach EOF and the exec would hang.
const IMPORT_CMD =
  'unset XDG_DATA_HOME XDG_CONFIG_HOME XDG_STATE_HOME XDG_CACHE_HOME; ' +
  'bin="${OPENCODE_BIN:-opencode}"; f=$(mktemp) || exit 1; ' +
  // Local driver only (shared host network): give this workspace's service its own port.
  '[ -z "$OPENCODE_SERVICE_PORT" ] || "$bin" service set port "$OPENCODE_SERVICE_PORT" >/dev/null 2>&1 </dev/null; ' +
  'list() { "$bin" auth list >"$f" 2>/dev/null </dev/null; grep -q "OpenCode Go" "$f"; }; ' +
  'list || { "$bin" auth import >/dev/null 2>&1 && list; }; ok=$?; ' +
  // Fill the model-catalog cache while the service is up (the student's first `opencode` otherwise pays for it),
  // then stop the service: a warm one holds ~650 MB per workspace.
  '"$bin" models >/dev/null 2>&1 </dev/null; ' +
  '"$bin" service stop >/dev/null 2>&1 </dev/null; rm -f "$f"; exit $ok';
export async function installSeatKey(
  d: { run(id: string, cmd: string, o?: { timeoutMs?: number; stdin?: string }): Promise<{ exitCode: number; stderr: string }> },
  sessionId: string,
  seat: Pick<Seat, "key">,
): Promise<boolean> {
  const cred = [{ id: SEAT_CREDENTIAL_ID, integrationID: "opencode-go", label: "OpenCode Go", active: true, value: { type: "key", key: seat.key } }];
  try {
    const r = await d.run(sessionId, IMPORT_CMD, { stdin: JSON.stringify(cred), timeoutMs: 30_000 });
    if (r.exitCode === 0) return true;
    console.warn(`seat key import failed for ${sessionId} (exit ${r.exitCode})`); // never log stdout/stderr: could echo input
  } catch (err) {
    console.warn(`seat key import failed for ${sessionId}: ${(err as Error).name}`);
  }
  return false;
}

/** Failed-code throttle: 10 misses per IP per minute. Returns true when blocked. */
const misses = new Map<string, number[]>();
export function seatGuessBlocked(ip: string, failed: boolean, now = Date.now()): boolean {
  const recent = (misses.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (failed) recent.push(now);
  misses.set(ip, recent);
  return recent.length >= 10;
}
