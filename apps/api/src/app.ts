import { Hono } from "hono";
import { SessionSchema } from "@rarefyu/lab-sdk";
import {
  createPlayground,
  destroyPlayground,
  getPlayground,
  heartbeat,
  identityKey,
  nukePlaygrounds,
  snapshotRetentionUntil,
} from "./playgrounds";

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
app.post("/api/playgrounds", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    const rec = createPlayground({
      ownerKey: ownerFrom(c),
      labId: body.labId ? String(body.labId) : undefined,
      ttlMin: body.ttlMin ? Number(body.ttlMin) : undefined,
    });
    return c.json(rec, 201);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return c.json({ error: (err as Error).message }, status as 429);
  }
});

app.get("/api/playgrounds/:id", (c) => {
  const rec = getPlayground(c.req.param("id"));
  if (!rec) return c.json({ error: "playground not found" }, 404);
  return c.json({ ...rec, warned: rec.warned });
});

app.post("/api/playgrounds/:id/heartbeat", (c) => {
  const rec = heartbeat(c.req.param("id"));
  if (!rec) return c.json({ error: "playground not found" }, 404);
  return c.json(rec);
});

app.get("/api/playgrounds/:id/snapshot", (c) => {
  const rec = getPlayground(c.req.param("id"));
  if (!rec) return c.json({ error: "playground not found" }, 404);
  if (!rec.snapshotAt)
    return c.json({ error: "no snapshot yet — taken on expiry" }, 404);
  // v1: metadata + download hook; tarball stream arrives with ExecDriver.
  return c.json({
    id: rec.id,
    snapshotAt: rec.snapshotAt,
    retainedUntil: snapshotRetentionUntil(rec),
    download: `/api/playgrounds/${rec.id}/snapshot.tar`,
  });
});

app.delete("/api/playgrounds/:id", (c) => {
  const ok = destroyPlayground(c.req.param("id"));
  if (!ok) return c.json({ error: "playground not found" }, 404);
  return c.json({ ok: true });
});

// Kill switch: one-button playground nuke.
app.delete("/api/playgrounds", (c) => {
  return c.json({ ok: true, ...nukePlaygrounds() });
});
