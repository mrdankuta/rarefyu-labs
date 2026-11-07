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

// Kill switch: one-button playground nuke (<60s: synchronous here).
app.delete("/api/playgrounds", async (c) => {
  const result = nukePlaygrounds();
  // Destroy exec workspaces best-effort; records already marked destroyed.
  await Promise.all(getAllPlaygroundIds().map((id) => driver.destroy(id)));
  return c.json({ ok: true, ...result });
});
