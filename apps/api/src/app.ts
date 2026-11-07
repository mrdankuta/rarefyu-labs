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
    await driver.create(rec.id);
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
  return c.json(publicRec(rec as unknown as Record<string, unknown>));
});

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

// Kill switch: one-button playground nuke (<60s: synchronous here).
app.delete("/api/playgrounds", async (c) => {
  const result = nukePlaygrounds();
  // Destroy exec workspaces best-effort; records already marked destroyed.
  await Promise.all(getAllPlaygroundIds().map((id) => driver.destroy(id)));
  return c.json({ ok: true, ...result });
});
