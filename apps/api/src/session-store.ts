/**
 * Session persistence. The session store is in memory; without this an API restart or
 * crash makes the reconciler delete every learner's workspace as an "orphan". We flush
 * the live records to ${DATA_DIR}/sessions.json (0600: it holds owner keys) every few
 * seconds and on shutdown, and reload them on boot before the reconciler runs.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { exportPlaygrounds, importPlaygrounds, type PlaygroundRecord } from "./playgrounds";

const file = () => process.env.SESSIONS_FILE ?? `${process.env.DATA_DIR ?? "/tmp/labs-data"}/sessions.json`;

export function saveSessions(): number {
  const f = file();
  const recs = exportPlaygrounds();
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp`;
  writeFileSync(tmp, JSON.stringify({ v: 1, savedAt: new Date().toISOString(), sessions: recs }), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, f);
  return recs.length;
}

export function loadSessions(): number {
  const f = file();
  if (!existsSync(f)) return 0;
  try {
    const data = JSON.parse(readFileSync(f, "utf8")) as { v: number; sessions: PlaygroundRecord[] };
    if (data.v !== 1 || !Array.isArray(data.sessions)) return 0;
    return importPlaygrounds(data.sessions);
  } catch (e) {
    console.error("could not load sessions file; starting empty:", (e as Error).message);
    return 0;
  }
}

/** Flush periodically and on SIGTERM/SIGINT. Returns a stop function (tests). */
export function startSessionPersistence(everyMs = 5000): () => void {
  const flush = () => {
    try {
      saveSessions();
    } catch (e) {
      console.error("session flush failed:", (e as Error).message);
    }
  };
  const t = setInterval(flush, everyMs);
  const onSignal = () => {
    flush();
    process.exit(0);
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  return () => {
    clearInterval(t);
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
  };
}
