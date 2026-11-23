import { driver as defaultDriver } from "./drivers";
import type { ExecDriver } from "./drivers/types";

/**
 * Preview auto-start (issue #54). The lab, not the agent, makes sure a web project is being served on the
 * workspace's preview port, through the driver's terminal facility (a hidden "preview" terminal).
 *
 *   probe the port -> serving?                        ready
 *   else classify the project (index.html / package.json dev|start script)
 *     not a web project                               not-web (nothing is started)
 *     started recently                                starting
 *     started long ago, still not serving             failed (a retry starts it again)
 *     otherwise start it                              starting
 */
export type PreviewKind = "static" | "npm-dev" | "npm-start" | "none";
export type PreviewState =
  | { state: "ready"; port: number }
  | { state: "starting"; port: number; kind: PreviewKind; sinceMs: number }
  | { state: "failed"; port: number; kind: PreviewKind; hint: string }
  | { state: "not-web"; port: number };

export const PREVIEW_TERM = "preview";
const GRACE_MS: Record<PreviewKind, number> = { static: 20_000, "npm-dev": 120_000, "npm-start": 120_000, none: 0 };

/** Runs in the workspace (bash): prints one word. Reads only; never starts anything. */
export const CLASSIFY_CMD = `if [ -f package.json ]; then
  if node -e 'const s=(JSON.parse(require("fs").readFileSync("package.json","utf8")).scripts)||{};process.exit(s.dev?0:1)' 2>/dev/null; then echo npm-dev; exit; fi
  if node -e 'const s=(JSON.parse(require("fs").readFileSync("package.json","utf8")).scripts)||{};process.exit(s.start?0:1)' 2>/dev/null; then echo npm-start; exit; fi
fi
if [ -f index.html ]; then echo static; else echo none; fi`;

/** The shell line typed into the preview terminal. Pure, so it is unit-tested. */
export function startCommand(kind: PreviewKind, port: number, bind: string, scriptHint = ""): string {
  if (kind === "static") return `python3 -m http.server ${port} --bind ${bind}`;
  const script = kind === "npm-dev" ? "dev" : "start";
  // Vite and Next ignore $PORT/$HOST, so they get explicit flags; everything else (CRA, Express...) reads the env.
  const flags = /\bvite\b/.test(scriptHint) ? ` -- --host ${bind} --port ${port} --strictPort`
    : /\bnext\b/.test(scriptHint) ? ` -- -p ${port} -H ${bind}`
    : "";
  return `{ [ -d node_modules ] || npm install; } && PORT=${port} HOST=${bind} npm run ${script}${flags}`;
}

interface Started { at: number; kind: PreviewKind }
const started = new Map<string, Started>();
export function forgetPreview(id: string) { started.delete(id); }

async function serving(d: ExecDriver, id: string, port: number): Promise<boolean> {
  try {
    const a = await d.address(id, port);
    const r = await fetch(`http://${a.host}:${a.port}/`, { signal: AbortSignal.timeout(2000) });
    return r.status < 500;
  } catch { return false; }
}

export async function ensurePreview(id: string, opts: { retry?: boolean; driver?: ExecDriver; now?: number } = {}): Promise<PreviewState> {
  const d = opts.driver ?? defaultDriver;
  const now = opts.now ?? Date.now();
  const port = await d.previewPort(id);
  if (await serving(d, id, port)) { started.delete(id); return { state: "ready", port }; } // a later crash restarts cleanly

  const prev = started.get(id);
  if (prev && !opts.retry) {
    const sinceMs = now - prev.at;
    if (sinceMs < GRACE_MS[prev.kind]) return { state: "starting", port, kind: prev.kind, sinceMs };
    return { state: "failed", port, kind: prev.kind, hint: failHint(prev.kind, port) };
  }

  const c = await d.run(id, CLASSIFY_CMD, { timeoutMs: 10_000 });
  const kind = (c.stdout.trim().split(/\s+/).pop() ?? "none") as PreviewKind;
  if (c.exitCode !== 0 || !(kind in GRACE_MS) || kind === "none") { started.delete(id); return { state: "not-web", port }; }

  let hint = "";
  if (kind !== "static") {
    const s = await d.run(id, `node -e 'const s=JSON.parse(require("fs").readFileSync("package.json","utf8")).scripts||{};process.stdout.write(s.${kind === "npm-dev" ? "dev" : "start"}||"")'`, { timeoutMs: 10_000 });
    hint = s.stdout;
  }
  // Local workspaces share the host: keep their preview on loopback. Containers need the interface the API reaches.
  const bind = d.backend === "local" ? "127.0.0.1" : "0.0.0.0";
  const term = await d.openTerminal(id, PREVIEW_TERM);
  term.write(`${startCommand(kind, port, bind, hint)}\n`);
  started.set(id, { at: now, kind });
  return { state: "starting", port, kind, sinceMs: 0 };
}

function failHint(kind: PreviewKind, port: number): string {
  return kind === "static"
    ? `Your site did not start on port ${port}. Open a terminal and run: python3 -m http.server ${port}`
    : `Your app did not start on port ${port}. Open a terminal and run: npm run ${kind === "npm-dev" ? "dev" : "start"}`;
}
