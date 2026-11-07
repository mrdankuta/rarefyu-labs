import { Hono } from "hono";
import { SessionSchema } from "@rarefyu/lab-sdk";
import {
  createPlayground,
  destroyPlayground,
  getAllPlaygroundIds,
  getPlayground,
  heartbeat,
  identityKey,
  nukePlaygrounds,
  snapshotRetentionUntil,
  sweepPlaygrounds,
} from "./playgrounds";
import { driver } from "./drivers/local";
import { signPreview, verifyPreview } from "./preview";
import { loadTrack } from "./tracks";
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
import { getGrade, getSubmission, gradeSubmission, submitForGrading } from "./grading";
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

function ownerFrom(c: { req: { header: (h: string) => string | undefined } }): string {
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
  const cookie = c.req.header("x-session-key") || "";
  return identityKey(ip, cookie);
}

// Anonymous playground loop — no auth (workspace-spec §5).
// ownerKey never leaves the server: public() strips it from responses.
function publicRec(rec: Record<string, unknown>) {
  const { ownerKey: _dropped, ...pub } = rec;
  return pub;
}
app.post("/api/playgrounds", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  let rec;
  try {
    rec = createPlayground({
      ownerKey: ownerFrom(c),
      labId: body.labId ? String(body.labId) : undefined,
      ttlMin: body.ttlMin ? Number(body.ttlMin) : undefined,
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return c.json(
      { error: (err as Error).message },
      (status === 429 ? 429 : 500) as 429 | 500,
    );
  }
  try {
    // Provision exec workspace (warm-claim path lands here in the gVisor driver).
    noteProvisionStart(rec.id);
    try {
      await driver.create(rec.id);
    } catch (err) {
      noteProvisionErr();
      throw err;
    }
    noteProvisionOk();
  } catch (err) {
    // No orphan records: failed provisioning releases the quota slot.
    destroyPlayground(rec.id);
    return c.json({ error: `exec provisioning failed: ${(err as Error).message}` }, 500 as 500);
  }
  sweepPlaygrounds(); // opportunistic expiry on each create
  return c.json(publicRec(rec as unknown as Record<string, unknown>), 201);
});

app.get("/api/playgrounds/:id", (c) => {
  const rec = getPlayground(c.req.param("id"));
  if (!rec) return c.json({ error: "playground not found" }, 404);
  return c.json(publicRec(rec as unknown as Record<string, unknown>));
});

app.post("/api/playgrounds/:id/heartbeat", (c) => {
  const rec = heartbeat(c.req.param("id"));
  if (!rec) return c.json({ error: "playground not found" }, 404);
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
  await driver.destroy(c.req.param("id"));
  return c.json({ ok: true });
});

// Real tarball download (workspace-t). Metadata lives at /snapshot.
app.get("/api/playgrounds/:id/snapshot.tar", async (c) => {
  const rec = getPlayground(c.req.param("id"));
  if (!rec) return c.json({ error: "playground not found" }, 404);
  const stream = await driver.snapshotTar(c.req.param("id"));
  return new Response(stream, {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="workspace-${rec.id}.tar.gz"`,
    },
  });
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
    sweepPlaygrounds();
    return c.json({ path: String(body.path), ...r });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
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
  if (!rec) return c.json({ error: "playground not found" }, 404);
  const port = Number(c.req.query("port") ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return c.json({ error: "invalid port" }, 400);
  // Readiness: can we open the port in the session netns? (local stand-in: api host.)
  let ready = false;
  try {
    const probe = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
    ready = probe.status < 500;
  } catch {
    ready = false;
  }
  if (!ready) return c.json({ ready: false, port, hint: `waiting for :${port} — start your app, this pane goes live` });
  const token = signPreview(rec.id, port);
  return c.json({ ready: true, port, url: `/preview/${token}/`, expiresInSec: 60 });
});

// Proxied app bytes. Token in path so iframes need no headers.
app.all("/preview/:token/*", async (c) => {
  const tail = c.req.param("*") ?? "";
  const qs = new URL(c.req.url).search;
  const v = verifyPreview(c.req.param("token"));
  if ("error" in v) return c.json({ error: v.error }, 403);
  const rec = getPlayground(v.sessionId);
  if (!rec || rec.status === "destroyed")
    return c.json({ error: "session gone — reopen the playground" }, 404);
  const target = `http://127.0.0.1:${v.port}/${tail}${qs}`;
  const init: RequestInit = { method: c.req.method, headers: c.req.raw.headers };
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    init.body = await c.req.raw.arrayBuffer();
    (init as Record<string, unknown>).duplex = "half";
  }
  try {
    const upstream = await fetch(target, { ...init, signal: AbortSignal.timeout(30_000) });
    return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
  } catch {
    return c.json({ error: `app on :${v.port} stopped responding — restart it and refresh` }, 502);
  }
});

// --- Tracks + in-session checks (issue #6) ---
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

// --- Isolated grading (issue #10): submit → grade in fresh env, immutable ---
app.post("/api/playgrounds/:id/grade", async (c) => {
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

// Kill switch: one-button playground nuke (<60s: synchronous here).
app.delete("/api/playgrounds", async (c) => {
  const result = nukePlaygrounds();
  // Destroy exec workspaces best-effort; records already marked destroyed.
  await Promise.all(getAllPlaygroundIds().map((id) => driver.destroy(id)));
  noteKill(result.destroyed);
  return c.json({ ok: true, ...result });
});
