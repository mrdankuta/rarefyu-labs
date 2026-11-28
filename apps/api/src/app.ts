import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { DEFAULT_LAYOUT, LayoutSchema, SessionSchema } from "@rarefyu/lab-sdk";
import {
  cookieOfKey,
  createPlayground,
  destroyPlayground,
  getAllPlaygroundIds,
  getPlayground,
  heartbeat,
  identityKey,
  liveSessionForSeat,
  CAPACITY_RETRY_SEC,
  liveSessionFor,
  nukePlaygrounds,
  isCreationPaused,
  setCreationPaused,
  snapshotRetentionUntil,
  sweepPlaygrounds,
  takeWoke,
} from "./playgrounds";
import { SeatBackendError, SeatThrottled, addSeats, credentialFiles, findSeatByCode, installSeatKey, listSeats, removeSeat, seatGuessBlocked, type Seat } from "./seats";
import { driver } from "./drivers";
import { reconcile } from "./reconcile";
import { auditEvent } from "./teach";
import { lookupSnapshot, retireWorkspace, runLifecycle } from "./lifecycle";
import { PREVIEW_TTL_SEC, signPreview } from "./preview";
import { AGENT_RULES_FILE, agentRules } from "./agent-rules";
import { ensurePreview } from "./preview-start";
import { resolvePreviewTarget } from "./preview-proxy";
import { AgentServers } from "./agent-server";
import { agentRoutes } from "./agent-proxy";
import { listTracks, loadTrack, trackLayout } from "./tracks";
import { getAttempts, getProgress, runCheck, runSolve } from "./checks";
import {
  countGuidedToday,
  createGuidedRec,
  destroyGuided,
  getGuided,
  listGuided,
  resolveUser,
} from "./guided";
import { LEARNER_POLICY, checkQuota, requireGuidedAuth } from "@rarefyu/auth";
import {
  announce,
  extendSession,
  getAudit,
  getPresence,
  labStats,
  resetSession,
  takeNotices,
} from "./teach";
import { decideCall, getAudit as getAgentAudit, getPending, redact, submitRun } from "./agent";
import { GRADING_DISABLED_CODE, getGrade, gradingEnabled, getSubmission, gradeSubmission, submitForGrading } from "./grading";
import { noteHeartbeat, noteKill, noteProvisionErr, noteProvisionOk, noteProvisionStart, renderMetrics } from "./metrics";

/** Slice-1 stub store. Slice 2 replaces with Postgres + quota checks. */
const sessions = new Map<string, unknown>();

export const app = new Hono();

app.get("/healthz", (c) =>
  c.json({ ok: true, service: "api", version: "0.1.0" }),
);

app.post("/api/sessions", async (c) => {
  // Slice 2: require auth session, enforce quotas, create real sandbox.
  const body = await c.req.json().catch(() => ({}));
  const session = {
    id: crypto.randomUUID(),
    courseId: String(body.courseId ?? "demo"),
    labId: String(body.labId ?? "basics"),
    backend: "gvisor",
    status: "creating",
    terminalWs: "ws://localhost:3000/ws/terminal?stub=1",
    previewBase: "http://localhost:3000/preview/stub",
  };
  const parsed = SessionSchema.parse(session);
  sessions.set(parsed.id, parsed);
  return c.json(parsed, 201);
});

app.get("/api/sessions/:id", (c) => {
  const found = sessions.get(c.req.param("id"));
  if (!found) return c.json({ error: "session not found" }, 404);
  return c.json(found);
});

app.delete("/api/sessions/:id", (c) => {
  const deleted = sessions.delete(c.req.param("id"));
  if (!deleted) return c.json({ error: "session not found" }, 404);
  return c.json({ ok: true });
});

function clientIp(c: { req: { header: (h: string) => string | undefined } }) {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
}

/** Anonymous identity cookie: x-session-key header (tests/tools) or the rfy_sid cookie. */
function cookieOf(c: { req: { header: (h: string) => string | undefined } }): string {
  const h = c.req.header("x-session-key");
  if (h) return h;
  const m = /(?:^|;\s*)rfy_sid=([\w-]+)/.exec(c.req.header("cookie") ?? "");
  return m?.[1] ?? "";
}

/** Who is calling: signed-in users own by user id, everyone else by IP + server-issued cookie. */
async function callerOf(c: Parameters<typeof cookieOf>[0]) {
  const userId = await resolveUser(c);
  const cookie = cookieOf(c);
  const ownerKey = userId ? `user:${userId}` : identityKey(clientIp(c), cookie);
  return { userId, cookie, ownerKey };
}

/**
 * Workspace access rule. Set ENFORCE_OWNERSHIP=0 only in dev/tests.
 * User-owned workspaces need that user; anonymous ones need the cookie they were created with.
 */
async function canAccess(headers: Headers, rec: { userId?: string; ownerKey: string }): Promise<boolean> {
  if (process.env.ENFORCE_OWNERSHIP === "0") return true;
  const c = { req: { header: (n: string) => headers.get(n) ?? undefined } };
  if (rec.userId) return (await resolveUser(c)) === rec.userId;
  const recCookie = cookieOfKey(rec.ownerKey);
  return recCookie === "anon" || cookieOf(c) === recCookie;
}
export { canAccess };

/** Per-workspace OpenCode servers (spec #50), started on demand through the driver. */
export const agentServers = new AgentServers(driver);
/** Same ownership rule as every other workspace route; a destroyed workspace is "missing". */
export async function agentAccess(headers: Headers, id: string): Promise<"ok" | "denied" | "missing"> {
  const rec = getPlayground(id);
  if (!rec || rec.status === "destroyed") return "missing";
  return (await canAccess(headers, rec)) ? "ok" : "denied";
}

async function authz(c: any, next: () => Promise<void>) {
  const rec = getPlayground(c.req.param("id"));
  if (rec && !(await canAccess(c.req.raw.headers, rec))) return c.json({ error: "not your workspace" }, 403);
  await next();
}
app.use("/api/playgrounds/:id", authz);
app.use("/api/playgrounds/:id/*", authz);

// Anonymous playground loop — no auth (workspace-spec §5).
// ownerKey never leaves the server: public() strips it from responses.
function publicRec(rec: Record<string, unknown>) {
  const { ownerKey: _dropped, seatId: _seat, ...pub } = rec;
  return pub;
}
app.post("/api/playgrounds", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const who = await callerOf(c);
  const mode = body.mode === "guided" ? "guided" : "playground";
  if (mode === "guided" && !who.userId)
    return c.json({ error: "sign in to start a guided lab", remedy: "log in, then retry with your session token" }, 401);
  // A lab can declare its starting tabs; resolve before creating anything.
  let layout: ReturnType<typeof trackLayout>;
  if (body.track !== undefined) {
    try {
      layout = trackLayout(await loadTrack(String(body.track)));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  }
  // Class code: identifies a seat (and its model key). Redeeming again resumes the seat's workspace.
  let seat: Seat | undefined;
  if (body.seatCode !== undefined && body.seatCode !== "") {
    const ip = clientIp(c);
    if (seatGuessBlocked(ip, false)) return c.json({ error: "too many wrong codes — wait a minute and try again" }, 429);
    try {
      seat = await findSeatByCode(String(body.seatCode));
    } catch (e) {
      if (e instanceof SeatThrottled) return c.json({ error: "too many wrong codes — wait a minute and try again" }, 429);
      if (e instanceof SeatBackendError) return c.json({ error: "the class service is unreachable right now — try again in a moment" }, 503);
      throw e;
    }
    if (!seat) {
      seatGuessBlocked(ip, true);
      return c.json({ error: "unknown class code — check it and try again" }, 403);
    }
    const live = liveSessionForSeat(seat.id);
    if (live) {
      // Reclaim: bind this browser to the seat's existing workspace (works from a new device too).
      setCookie(c, "rfy_sid", cookieOfKey(live.ownerKey), { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 86_400, secure: c.req.header("x-forwarded-proto") === "https" });
      return c.json({ ...publicRec(live as unknown as Record<string, unknown>), resumed: true }, 200);
    }
  } else if (process.env.SEATS_REQUIRED === "1" && !who.userId) {
    return c.json({ error: "a class code is required to start a workspace" }, 403);
  }
  let { ownerKey } = who;
  if (seat) {
    const sid = crypto.randomUUID();
    setCookie(c, "rfy_sid", sid, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 86_400, secure: c.req.header("x-forwarded-proto") === "https" });
    ownerKey = `seat:${seat.id}::${sid}`;
  } else if (!who.userId && !who.cookie) {
    // First visit: issue the identity cookie that will own this anonymous workspace.
    const sid = crypto.randomUUID();
    setCookie(c, "rfy_sid", sid, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 86_400,
      secure: c.req.header("x-forwarded-proto") === "https",
    });
    ownerKey = identityKey(clientIp(c), sid);
  }
  let rec;
  try {
    rec = createPlayground({
      ownerKey,
      userId: who.userId ?? undefined,
      seatId: seat?.id,
      track: body.track !== undefined ? String(body.track) : undefined,
      mode,
      labId: body.labId ? String(body.labId) : undefined,
      // Class seats live for a class day (SEAT_TTL_MIN, default 8h) instead of the 2h playground default.
      ...(seat
        ? { ttlMin: seatTtlMin(), maxTtlMin: seatTtlMin() }
        : { ttlMin: body.ttlMin ? Number(body.ttlMin) : undefined }),
    });
    if (layout) rec.layout = layout;
  } catch (err) {
    const { status = 500, code } = err as { status?: number; code?: string };
    if (code === "quota_owner") {
      // Same owner only: expose their own live session id so the UI can offer "resume".
      const live = liveSessionFor(ownerKey);
      return c.json({ error: (err as Error).message, code, existingId: live?.id }, 429);
    }
    if (code === "quota_ip") return c.json({ error: (err as Error).message, code }, 429);
    if (code === "paused") return c.json({ error: (err as Error).message, code }, 503);
    if (code === "at_capacity") {
      c.header("Retry-After", String(CAPACITY_RETRY_SEC));
      return c.json({ error: (err as Error).message, code, retryAfterSec: CAPACITY_RETRY_SEC }, 503);
    }
    return c.json({ error: (err as Error).message }, 500);
  }
  try {
    // Provision exec workspace (warm-claim path lands here in the gVisor driver).
    noteProvisionStart(rec.id);
    try {
      // Every new workspace starts with the agent instruction file (never overwriting an existing one).
      await driver.create(rec.id, { seedFiles: [{ path: AGENT_RULES_FILE, content: agentRules(await driver.previewPort(rec.id)) }] });
    } catch (err) {
      noteProvisionErr();
      throw err;
    }
    if (seat) {
      await driver.injectCredentials(rec.id, credentialFiles(seat));
      await installSeatKey(driver, rec.id, seat); // OpenCode 2.x credential store (best effort)
    }
    noteProvisionOk();
    auditEvent(who.userId ? `user:${who.userId}` : "student", "create", rec.id, rec.mode);
  } catch (err) {
    // No orphan records: failed provisioning releases the quota slot.
    destroyPlayground(rec.id);
    return c.json({ error: `exec provisioning failed: ${(err as Error).message}` }, 500 as 500);
  }
  void runLifecycle(); // opportunistic lifecycle pass on each create
  return c.json(publicRec(rec as unknown as Record<string, unknown>), 201);
});

// Reattach: the caller's own live workspace, if any (landing page offers "resume").
app.get("/api/workspaces/current", async (c) => {
  const who = await callerOf(c);
  const rec = liveSessionFor(who.ownerKey);
  if (!rec) return c.json({ error: "no live workspace" }, 404);
  return c.json(publicRec(rec as unknown as Record<string, unknown>));
});

app.get("/api/playgrounds/:id", (c) => {
  const rec = getPlayground(c.req.param("id"));
  if (!rec) return c.json({ error: "playground not found" }, 404);
  return c.json(publicRec(rec as unknown as Record<string, unknown>));
});

// Is this workspace's coding agent ready to use? Reports only readiness and model name, never the key.
app.get("/api/playgrounds/:id/agent-status", async (c) => {
  const rec = getPlayground(c.req.param("id"));
  if (!rec) return c.json({ error: "playground not found" }, 404);
  try {
    const r = await driver.run(
      rec.id,
      `[ -s "$HOME/.local/share/opencode/auth.json" ] && echo READY && cat "$HOME/.config/opencode/opencode.json" 2>/dev/null`,
      { timeoutMs: 8_000 },
    );
    if (!r.stdout.startsWith("READY")) return c.json({ ready: false, reason: "no model key installed" });
    let model: string | null = null;
    try { model = JSON.parse(r.stdout.slice(5)).model ?? null; } catch { /* no config */ }
    return c.json({ ready: true, model });
  } catch {
    return c.json({ ready: false, reason: "workspace not reachable" });
  }
});

app.post("/api/playgrounds/:id/heartbeat", async (c) => {
  const rec = heartbeat(c.req.param("id"));
  if (!rec) return c.json({ error: "playground not found" }, 404);
  if (takeWoke(rec.id)) {
    await driver.wake(rec.id).catch(() => {});
    auditEvent("student", "wake", rec.id);
  }
  noteHeartbeat(c.req.param("id"));
  return c.json(publicRec(rec as unknown as Record<string, unknown>));
});

app.get("/metrics", (c) =>
  new Response(renderMetrics(), { headers: { "content-type": "text/plain; version=0.0.4" } }),
);

app.get("/api/playgrounds/:id/snapshot", (c) => {
  const rec = getPlayground(c.req.param("id"));
  if (!rec) return c.json({ error: "playground not found" }, 404);
  if (!rec.snapshotAt)
    return c.json({ error: "no snapshot yet — taken on expiry" }, 404);
  // Metadata; bytes stream from /snapshot.tar (workspace-t tarball).
  return c.json({
    id: rec.id,
    snapshotAt: rec.snapshotAt,
    retainedUntil: snapshotRetentionUntil(rec),
    download: `/api/playgrounds/${rec.id}/snapshot.tar`,
  });
});

app.delete("/api/playgrounds/:id", async (c) => {
  const ok = destroyPlayground(c.req.param("id"));
  if (!ok) return c.json({ error: "playground not found" }, 404);
  await retireWorkspace(c.req.param("id"));
  auditEvent("student", "stop", c.req.param("id"));
  return c.json({ ok: true });
});

// --- Tab layout (spec #30): persisted per workspace, terminals follow tabs ---
app.get("/api/playgrounds/:id/layout", (c) => {
  const rec = getPlayground(c.req.param("id"));
  if (!rec || rec.status === "destroyed") return c.json({ error: "playground not found" }, 404);
  return c.json(rec.layout ?? DEFAULT_LAYOUT);
});

app.put("/api/playgrounds/:id/layout", async (c) => {
  const rec = getPlayground(c.req.param("id"));
  if (!rec || rec.status === "destroyed") return c.json({ error: "playground not found" }, 404);
  const parsed = LayoutSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, 400);
  const next = parsed.data;
  // Closing a terminal tab ends its shell; the layout is the source of truth.
  const keep = new Set(next.tabs.filter((t) => t.type === "terminal").map((t) => t.id));
  for (const t of (rec.layout ?? DEFAULT_LAYOUT).tabs) {
    if (t.type === "terminal" && !keep.has(t.id)) await driver.closeTerminal(rec.id, t.id);
  }
  rec.layout = next;
  return c.json(next);
});

// Real tarball download (workspace-t). Metadata lives at /snapshot.
app.get("/api/playgrounds/:id/snapshot.tar", async (c) => {
  const rec = getPlayground(c.req.param("id"));
  if (!rec) return c.json({ error: "playground not found" }, 404);
  const snap = await lookupSnapshot(rec.id);
  if (snap.kind === "expired") return c.json({ error: "snapshot expired" }, 410);
  if (snap.kind === "none") return c.json({ error: "no snapshot available" }, 404);
  const stream = snap.kind === "file" ? Bun.file(snap.path).stream() : await driver.snapshotTar(rec.id);
  return new Response(stream, {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="workspace-${rec.id}.tar.gz"`,
    },
  });
});

// --- File transfer: laptop <-> workspace ---
const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "workspace";

// Download the whole project or one folder as a zip, or one file as-is (decided server-side).
// ?path=<workspace-relative> (default: whole workspace)  &heavy=1 to include node_modules etc.
async function entryType(id: string, path: string): Promise<"file" | "dir" | null> {
  if (!path) return "dir";
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const list = await driver.listFiles(id, parent).catch(() => []);
  return list.find((f) => f.path === path)?.type ?? null;
}
app.get("/api/playgrounds/:id/download", async (c) => {
  const rec = getPlayground(c.req.param("id"));
  if (!rec || rec.status === "destroyed") return c.json({ error: "playground not found" }, 404);
  const path = (c.req.query("path") ?? "").replace(/^\/+|\/+$/g, "");
  if (path.split("/").includes("..")) return c.json({ error: "bad path" }, 400);
  try {
    const kind = await entryType(rec.id, path);
    if (!kind) return c.json({ error: "no such file or folder" }, 404);
    if (kind === "file") {
      return new Response(await driver.readBytes(rec.id, path), {
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename="${safeName(path.split("/").pop() ?? "file")}"`,
        },
      });
    }
    const stream = await driver.archiveZip(rec.id, path, { heavy: c.req.query("heavy") === "1" });
    const base = path ? safeName(path.split("/").pop() ?? "folder") : `workspace-${rec.id.slice(0, 8)}`;
    return new Response(stream, {
      headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${base}.zip"` },
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// Upload files / a folder / a zip into the workspace.
// multipart: repeated `files` (File) with a parallel repeated `paths` (relative path per file); ?dest=<folder>; ?extract=1 unzips a single .zip.
app.post("/api/playgrounds/:id/upload", async (c) => {
  const rec = getPlayground(c.req.param("id"));
  if (!rec || rec.status === "destroyed") return c.json({ error: "playground not found" }, 404);
  const len = Number(c.req.header("content-length") ?? 0);
  if (len > UPLOAD_MAX_BYTES + 1024 * 1024)
    return c.json({ error: `upload is larger than ${UPLOAD_MAX_BYTES / (1024 * 1024)} MB — leave out node_modules and build folders` }, 413);
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "send multipart/form-data with `files`" }, 400);
  }
  const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
  const paths = form.getAll("paths").map(String);
  if (!files.length) return c.json({ error: "no files in upload" }, 400);
  const dest = (c.req.query("dest") ?? "").replace(/^\/+/, "");
  try {
    let result;
    if (c.req.query("extract") === "1") {
      if (files.length !== 1) return c.json({ error: "send exactly one zip to extract" }, 400);
      result = await driver.importUpload(rec.id, dest, { kind: "zip", data: new Uint8Array(await files[0].arrayBuffer()) });
    } else {
      const items = await Promise.all(
        files.map(async (f, i) => ({ path: paths[i] || f.name, data: new Uint8Array(await f.arrayBuffer()) })),
      );
      result = await driver.importUpload(rec.id, dest, { kind: "files", files: items });
    }
    void runLifecycle();
    return c.json(result, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// --- Session filesystem (issue #5): explorer, read, save, diff, reset ---
// All paths are workspace-relative; driver rejects traversal outside the root.
app.get("/api/playgrounds/:id/files", async (c) => {
  if (!getPlayground(c.req.param("id"))) return c.json({ error: "playground not found" }, 404);
  try {
    return c.json({ files: await driver.listFiles(c.req.param("id"), c.req.query("path") ?? "") });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get("/api/playgrounds/:id/tree", async (c) => {
  if (!getPlayground(c.req.param("id"))) return c.json({ error: "playground not found" }, 404);
  try {
    return c.json(await driver.walkFiles(c.req.param("id")));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get("/api/playgrounds/:id/files/content", async (c) => {
  if (!getPlayground(c.req.param("id"))) return c.json({ error: "playground not found" }, 404);
  const path = c.req.query("path");
  if (!path) return c.json({ error: "missing ?path=" }, 400);
  try {
    return c.json({ path, ...(await driver.readFile(c.req.param("id"), path)) });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg.includes("not found") ? 404 : 400;
    return c.json({ error: msg }, status as 404 | 400);
  }
});

app.put("/api/playgrounds/:id/files/content", async (c) => {
  if (!getPlayground(c.req.param("id"))) return c.json({ error: "playground not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  if (!body.path || typeof body.content !== "string")
    return c.json({ error: "need {path, content}" }, 400);
  try {
    const r = await driver.writeFile(c.req.param("id"), String(body.path), body.content);
    void runLifecycle();
    return c.json({ path: String(body.path), ...r });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.delete("/api/playgrounds/:id/files", async (c) => {
  if (!getPlayground(c.req.param("id"))) return c.json({ error: "playground not found" }, 404);
  const path = c.req.query("path") ?? "";
  try {
    await driver.deletePath(c.req.param("id"), path);
    return c.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return c.json({ error: msg }, msg.includes("not found") ? 404 : 400);
  }
});

app.post("/api/playgrounds/:id/files/rename", async (c) => {
  if (!getPlayground(c.req.param("id"))) return c.json({ error: "playground not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.from !== "string" || typeof body.to !== "string" || !body.from || !body.to)
    return c.json({ error: "need {from, to}" }, 400);
  try {
    await driver.renamePath(c.req.param("id"), body.from, body.to);
    return c.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return c.json({ error: msg }, msg.includes("not found") ? 404 : msg.includes("exists") ? 409 : 400);
  }
});

app.get("/api/playgrounds/:id/files/diff", async (c) => {
  if (!getPlayground(c.req.param("id"))) return c.json({ error: "playground not found" }, 404);
  const path = c.req.query("path");
  if (!path) return c.json({ error: "missing ?path=" }, 400);
  try {
    const diff = await driver.diffFile(c.req.param("id"), path);
    return c.json({ path, changed: diff.length > 0, diff });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.post("/api/playgrounds/:id/files/reset", async (c) => {
  if (!getPlayground(c.req.param("id"))) return c.json({ error: "playground not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  try {
    if (body.path) {
      await driver.resetFile(c.req.param("id"), String(body.path));
      return c.json({ ok: true, path: String(body.path) });
    }
    await driver.resetProject(c.req.param("id"));
    return c.json({ ok: true, project: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// --- Signed preview (issue #6): readiness probe + short-TTL signed URL + proxy ---
app.get("/api/playgrounds/:id/preview", async (c) => {
  const rec = getPlayground(c.req.param("id"));
  if (!rec || rec.status === "destroyed") return c.json({ error: "playground not found" }, 404);
  const port = Number(c.req.query("port") ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return c.json({ error: "invalid port" }, 400);
  // Readiness: does anything accept connections on that port inside the workspace?
  let ready = false;
  try {
    const a = await driver.address(rec.id, port);
    const probe = await fetch(`http://${a.host}:${a.port}/`, { signal: AbortSignal.timeout(2000) });
    ready = probe.status < 500;
  } catch {
    ready = false;
  }
  if (!ready) return c.json({ ready: false, port, hint: `waiting for :${port} — start your app, this pane goes live` });
  const token = signPreview(rec.id, port);
  return c.json({ ready: true, port, url: `/preview/${token}/`, expiresInSec: PREVIEW_TTL_SEC });
});

// Chat layout: make sure a web project is being served (starts it through the driver's terminal when it is
// not and the project is a web project). Non-web workspaces get {state:"not-web"} and nothing is started.
app.post("/api/playgrounds/:id/preview/ensure", async (c) => {
  const rec = getPlayground(c.req.param("id"));
  if (!rec || rec.status === "destroyed") return c.json({ error: "playground not found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { retry?: unknown };
  try {
    const st = await ensurePreview(rec.id, { retry: body.retry === true });
    if (st.state !== "ready") return c.json(st);
    const token = signPreview(rec.id, st.port);
    return c.json({ ...st, url: `/preview/${token}/`, expiresInSec: PREVIEW_TTL_SEC });
  } catch (err) {
    return c.json({ error: `could not check the preview: ${(err as Error).message}` }, 502);
  }
});

// Proxied app bytes. Token in path so iframes need no headers. (WebSocket upgrades: see server.ts.)
app.all("/preview/:token/*", async (c) => {
  const reqUrl = new URL(c.req.url);
  // Everything after /preview/<token>/ (Hono's wildcard param is not reliable across versions).
  const tail = reqUrl.pathname.split("/").slice(3).join("/");
  const qs = reqUrl.search;
  const t = await resolvePreviewTarget(c.req.param("token"));
  if ("error" in t) return c.json({ error: t.error }, t.status);
  const target = `http://${t.host}:${t.port}/${tail}${qs}`;
  const headers = new Headers(c.req.raw.headers);
  headers.delete("cookie"); // never leak the platform session into learner apps
  headers.delete("authorization");
  const init: RequestInit = { method: c.req.method, headers };
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    init.body = await c.req.raw.arrayBuffer();
    (init as Record<string, unknown>).duplex = "half";
  }
  try {
    const upstream = await fetch(target, { ...init, signal: AbortSignal.timeout(30_000), redirect: "manual" });
    return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
  } catch {
    return c.json({ error: `app on :${t.port} stopped responding — restart it and refresh` }, 502);
  }
});

// --- Tracks + in-session checks (issue #6) ---
// Public, non-secret deployment settings the landing page adapts to.
app.get("/api/config", (c) => {
  const seatsRequired = process.env.SEATS_REQUIRED === "1";
  return c.json({
    seatsRequired,
    className: process.env.CLASS_NAME || null,
    // A live class has no prepared lessons by default; SHOW_LESSONS=1 brings them back.
    showLessons: process.env.SHOW_LESSONS === "1" || !seatsRequired,
  });
});

app.get("/api/tracks", async (c) => c.json({ tracks: await listTracks() }));

app.get("/api/tracks/:slug", async (c) => {
  try {
    return c.json(await loadTrack(c.req.param("slug")));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404);
  }
});

app.post("/api/playgrounds/:id/check", async (c) => {
  if (!getPlayground(c.req.param("id"))) return c.json({ error: "playground not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  if (!body.track || !body.step) return c.json({ error: "need {track, step}" }, 400);
  try {
    const r = await runCheck(c.req.param("id"), String(body.track), String(body.step));
    return c.json({ ...r, progress: getProgress(c.req.param("id"), String(body.track)) });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// Solution unlock: explicit POST only; the solve source never ships in hints.
app.post("/api/playgrounds/:id/solve", async (c) => {
  if (!getPlayground(c.req.param("id"))) return c.json({ error: "playground not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  if (!body.track || !body.step || body.confirm !== true)
    return c.json({ error: "need {track, step, confirm:true}" }, 400);
  try {
    const r = await runSolve(c.req.param("id"), String(body.track), String(body.step));
    return c.json({ ...r, progress: getProgress(c.req.param("id"), String(body.track)) });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get("/api/playgrounds/:id/attempts", (c) => {
  if (!getPlayground(c.req.param("id"))) return c.json({ error: "playground not found" }, 404);
  const track = c.req.query("track");
  const atts = getAttempts(c.req.param("id")).filter((a) => !track || a.track === track);
  return c.json({
    attempts: atts,
    progress: track ? getProgress(c.req.param("id"), track) : undefined,
  });
});

// --- Guided cohort gate (issue #3): auth required, quotas enforced ---
// Anonymous playgrounds stay open (above). Guided sessions need a user.
app.post("/api/guided-sessions", async (c) => {
  const userId = await resolveUser(c);
  const gate = requireGuidedAuth(userId);
  if (!gate.ok) return c.json({ error: gate.error, remedy: gate.remedy }, 401);
  const body = await c.req.json().catch(() => ({}));
  if (!body.track) return c.json({ error: "need {track}" }, 400);
  const q = checkQuota(
    { live: listGuided(gate.userId).length, createdLast24h: countGuidedToday(gate.userId) },
    LEARNER_POLICY,
  );
  if (!q.ok)
    return c.json(
      { error: q.error, remedy: q.remedy, retryAfterSec: q.retryAfterSec },
      429,
    );
  const rec = createGuidedRec({
    userId: gate.userId,
    organizationId: body.orgId ? String(body.orgId) : undefined,
    track: String(body.track),
  });
  await driver.create(rec.id);
  return c.json({ ...rec, mode: "guided", backend: "gvisor" }, 201);
});

app.get("/api/guided-sessions", async (c) => {
  const userId = await resolveUser(c);
  const gate = requireGuidedAuth(userId);
  if (!gate.ok) return c.json({ error: gate.error, remedy: gate.remedy }, 401);
  return c.json({ sessions: listGuided(gate.userId) });
});

app.delete("/api/guided-sessions/:id", async (c) => {
  const userId = await resolveUser(c);
  const gate = requireGuidedAuth(userId);
  if (!gate.ok) return c.json({ error: gate.error, remedy: gate.remedy }, 401);
  if (!destroyGuided(c.req.param("id"), gate.userId))
    return c.json({ error: "guided session not found" }, 404);
  await driver.destroy(c.req.param("id"));
  return c.json({ ok: true });
});

// --- Teach console (issue #8): presence, assist, stats, notices ---
// Bench rule: any signed-in caller may instruct (production: org owner only).
async function requireInstructor(c: {
  req: { header: (h: string) => string | undefined };
}) {
  const userId = await resolveUser(c);
  if (!userId) return null;
  return userId;
}

app.get("/api/teach/presence", async (c) => {
  if (!(await requireInstructor(c))) return c.json({ error: "sign-in required" }, 401);
  return c.json({ presence: getPresence() });
});

app.post("/api/teach/reset", async (c) => {
  const actor = await requireInstructor(c);
  if (!actor) return c.json({ error: "sign-in required" }, 401);
  const body = await c.req.json().catch(() => ({}));
  if (!body.sessionId) return c.json({ error: "need {sessionId}" }, 400);
  const ok = await resetSession(actor, String(body.sessionId));
  if (!ok) return c.json({ error: "session not found or destroyed" }, 404);
  return c.json({ ok: true });
});

app.post("/api/teach/extend", async (c) => {
  const actor = await requireInstructor(c);
  if (!actor) return c.json({ error: "sign-in required" }, 401);
  const body = await c.req.json().catch(() => ({}));
  if (!body.sessionId || body.minutes === undefined)
    return c.json({ error: "need {sessionId, minutes}" }, 400);
  const next = await extendSession(actor, String(body.sessionId), Number(body.minutes));
  if (!next) return c.json({ error: "bad session or minutes (1–240)" }, 400);
  return c.json({ ok: true, expiresAt: next });
});

app.post("/api/teach/announce", async (c) => {
  const actor = await requireInstructor(c);
  if (!actor) return c.json({ error: "sign-in required" }, 401);
  const body = await c.req.json().catch(() => ({}));
  if (!body.message) return c.json({ error: "need {message}" }, 400);
  return c.json({ ok: true, notice: announce(actor, String(body.message)) });
});

app.get("/api/teach/stats", async (c) => {
  if (!(await requireInstructor(c))) return c.json({ error: "sign-in required" }, 401);
  const track = c.req.query("track") ?? "demo-agent";
  return c.json({ track, ...labStats(track) });
});

app.get("/api/teach/audit", async (c) => {
  if (!(await requireInstructor(c))) return c.json({ error: "sign-in required" }, 401);
  return c.json({ audit: getAudit() });
});

// --- Agent broker (issue #9): policy tiers, approvals, redacted audit ---
app.post("/api/playgrounds/:id/agent/run", async (c) => {
  if (!getPlayground(c.req.param("id"))) return c.json({ error: "playground not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  if (!Array.isArray(body.plan)) return c.json({ error: "need {plan:[{tool,args}]}" }, 400);
  try {
    const run = await submitRun(c.req.param("id"), body.plan);
    return c.json(run, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get("/api/playgrounds/:id/agent/pending", (c) => {
  if (!getPlayground(c.req.param("id"))) return c.json({ error: "playground not found" }, 404);
  return c.json({ pending: getPending(c.req.param("id")) });
});

app.post("/api/playgrounds/:id/agent/decide", async (c) => {
  if (!getPlayground(c.req.param("id"))) return c.json({ error: "playground not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  if (!body.callId || typeof body.approve !== "boolean")
    return c.json({ error: "need {callId, approve:boolean}" }, 400);
  const run = await decideCall(String(body.callId), body.approve);
  if (!run) return c.json({ error: "no such pending call" }, 404);
  return c.json(run);
});

// Audit export: full replay, secrets redacted, args hashed.
app.get("/api/playgrounds/:id/agent/audit", (c) => {
  if (!getPlayground(c.req.param("id"))) return c.json({ error: "playground not found" }, 404);
  return c.json({ audit: getAgentAudit(c.req.param("id")) });
});

// --- Agent server (issue #50): start/status + authenticated reverse proxy (see agent-proxy.ts) ---
app.route("/", agentRoutes({ servers: agentServers, access: agentAccess, keyed: (id) => !!getPlayground(id)?.seatId, testHooks: process.env.E2E_TEST_HOOKS === "1" }));

// --- Isolated grading (issue #10): submit → grade in fresh env, immutable ---
app.post("/api/playgrounds/:id/grade", async (c) => {
  // Checked first: when disabled nothing is read, written or executed.
  if (!gradingEnabled())
    return c.json({ error: "grading is unavailable", code: GRADING_DISABLED_CODE }, 503);
  if (!getPlayground(c.req.param("id"))) return c.json({ error: "playground not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  if (!body.track || !body.step) return c.json({ error: "need {track, step}" }, 400);
  try {
    const sub = await submitForGrading(c.req.param("id"), String(body.track), String(body.step));
    const grade = await gradeSubmission(sub.id);
    return c.json({ submission: sub, grade }, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get("/api/submissions/:sid", (c) => {
  const sub = getSubmission(c.req.param("sid"));
  if (!sub) return c.json({ error: "submission not found" }, 404);
  return c.json({ submission: sub, grade: getGrade(sub.id) ?? null });
});

// Learner polls this for reset/extend/announce toasts (consumed on read).
app.get("/api/playgrounds/:id/notices", (c) => {
  if (!getPlayground(c.req.param("id"))) return c.json({ error: "playground not found" }, 404);
  return c.json({ notices: takeNotices(c.req.param("id")) });
});

// --- Operator controls (kill switch, pause, reconcile). If ADMIN_TOKEN is set, a bearer token is required. ---
function adminOk(c: { req: { header: (h: string) => string | undefined } }) {
  const t = process.env.ADMIN_TOKEN;
  return !t || c.req.header("authorization") === `Bearer ${t}`;
}

function seatTtlMin() {
  const n = Number(process.env.SEAT_TTL_MIN ?? 480);
  return Number.isFinite(n) && n >= 1 ? n : 480;
}

// --- Class seats (admin only; ADMIN_TOKEN is mandatory because these hold model keys) ---
function seatAdmin(c: { req: { header: (h: string) => string | undefined } }): { status: 401 | 503; error: string } | null {
  if (!process.env.ADMIN_TOKEN) return { status: 503, error: "set ADMIN_TOKEN to manage class seats" };
  return adminOk(c) ? null : { status: 401, error: "operator token required" };
}
app.post("/api/admin/seats", async (c) => {
  const deny = seatAdmin(c);
  if (deny) return c.json({ error: deny.error }, deny.status);
  const body = await c.req.json().catch(() => ({}));
  const items = Array.isArray(body.seats) ? body.seats : [];
  if (!items.length || items.length > 500) return c.json({ error: "send {seats:[{label,key}]} with 1-500 entries" }, 400);
  if (items.some((s: any) => typeof s?.key !== "string" || s.key.length < 8 || typeof s?.label !== "string" || !s.label.trim()))
    return c.json({ error: "every seat needs a label and a key" }, 400);
  const made = await addSeats(items.map((s: any) => ({ label: s.label.trim(), key: s.key.trim() })));
  auditEvent("operator", "seats-add", "-", String(made.length));
  return c.json({ seats: made.map(({ id, code, label }) => ({ id, code, label })) }, 201);
});
app.get("/api/admin/seats", async (c) => {
  const deny = seatAdmin(c);
  if (deny) return c.json({ error: deny.error }, deny.status);
  return c.json({
    seats: (await listSeats()).map(({ id, code, label, createdAt }) => ({ id, code, label, createdAt, workspaceId: liveSessionForSeat(id)?.id ?? null })),
  });
});
app.delete("/api/admin/seats/:id", async (c) => {
  const deny = seatAdmin(c);
  if (deny) return c.json({ error: deny.error }, deny.status);
  const id = c.req.param("id");
  if (!(await removeSeat(id))) return c.json({ error: "no such seat" }, 404);
  // Revoking a seat also removes its workspace: the key lives in that workspace's home.
  const live = liveSessionForSeat(id);
  if (live) {
    destroyPlayground(live.id);
    await driver.destroy(live.id).catch(() => {});
  }
  auditEvent("operator", "seat-revoke", live?.id ?? "-");
  return c.json({ ok: true });
});

// Kill switch: one-button nuke of every workspace; ?pause=1 also stops new creation.
app.delete("/api/playgrounds", async (c) => {
  if (!adminOk(c)) return c.json({ error: "operator token required" }, 401);
  if (c.req.query("pause") === "1") setCreationPaused(true);
  const result = nukePlaygrounds();
  // Destroy everything the backend holds (not just known records), in parallel.
  const held = new Set([...getAllPlaygroundIds(), ...(await driver.list().catch(() => []))]);
  await Promise.all([...held].map((id) => driver.destroy(id).catch(() => {})));
  noteKill(result.destroyed);
  auditEvent("operator", "kill-switch", undefined, `${result.destroyed} destroyed${isCreationPaused() ? ", creation paused" : ""}`);
  return c.json({ ok: true, ...result, paused: isCreationPaused() });
});

app.post("/api/admin/creation", async (c) => {
  if (!adminOk(c)) return c.json({ error: "operator token required" }, 401);
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.paused !== "boolean") return c.json({ error: "need {paused: boolean}" }, 400);
  setCreationPaused(body.paused);
  auditEvent("operator", body.paused ? "pause-creation" : "resume-creation");
  return c.json({ paused: isCreationPaused() });
});

app.post("/api/admin/reconcile", async (c) => {
  if (!adminOk(c)) return c.json({ error: "operator token required" }, 401);
  return c.json(await reconcile());
});
