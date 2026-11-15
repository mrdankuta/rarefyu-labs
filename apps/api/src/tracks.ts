import YAML from "yaml";
import { MAX_TABS, type Layout, type Tab } from "@rarefyu/lab-sdk";

/**
 * v2 authoring loader (workspace-spec §3, issue #6).
 * Track layout: track.yml, config.yml, NN-slug/{assignment.md, check, solve}.
 * Assignment frontmatter: title, difficulty, timelimit, tabs.
 */

/** Tab as declared in track.yml / assignment frontmatter (Instruqt-style types). */
export interface TrackTab {
  title: string;
  type: string; // terminal | editor | service | website | browser
  port?: number;
  path?: string; // website/service: start path; editor: file to open
  workdir?: string; // terminal
  cmd?: string; // terminal: run once on first open
}

export interface TrackStep {
  slug: string;
  title: string;
  difficulty?: string;
  timelimit?: number;
  tabs?: TrackTab[];
  assignment: string;
  hasCheck: boolean;
  hasSolve: boolean;
}

export interface Track {
  slug: string;
  title: string;
  mode: string;
  ttl: number;
  tabs: TrackTab[];
  config: Record<string, unknown>;
  steps: TrackStep[];
}

// Default: <repo>/tracks (this file lives at <repo>/apps/api/src/).
// Override with TRACKS_ROOT when tracks are mounted elsewhere (container). 
const HERE = new URL(".", import.meta.url).pathname;
const ROOT = process.env.TRACKS_ROOT ?? `${HERE}../../../tracks`;

async function readIf(path: string): Promise<string | null> {
  const f = Bun.file(path);
  return (await f.exists()) ? f.text() : null;
}

function parseAssignment(md: string): {
  meta: Record<string, unknown>;
  body: string;
} {
  if (!md.startsWith("---")) return { meta: {}, body: md };
  const end = md.indexOf("\n---", 3);
  if (end < 0) return { meta: {}, body: md };
  const meta = (YAML.parse(md.slice(3, end)) ?? {}) as Record<string, unknown>;
  return { meta, body: md.slice(end + 4).trimStart() };
}

export async function loadTrack(slug: string): Promise<Track> {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("invalid track slug");
  const base = `${ROOT}/${slug}`;
  const raw = await readIf(`${base}/track.yml`);
  if (!raw) throw new Error(`track not found: ${slug}`);
  const t = YAML.parse(raw) as Record<string, unknown>;
  const cfgRaw = await readIf(`${base}/config.yml`);
  const glob = new Bun.Glob("*/assignment.md");
  const steps: TrackStep[] = [];
  for await (const rel of glob.scan({ cwd: base })) {
    const dir = rel.split("/")[0];
    const md = (await readIf(`${base}/${rel}`))!;
    const { meta, body } = parseAssignment(md);
    steps.push({
      slug: dir,
      title: String(meta.title ?? dir),
      difficulty: meta.difficulty as string | undefined,
      timelimit: meta.timelimit as number | undefined,
      tabs: meta.tabs as TrackStep["tabs"],
      assignment: body,
      hasCheck: await Bun.file(`${base}/${dir}/check`).exists(),
      hasSolve: await Bun.file(`${base}/${dir}/solve`).exists(),
    });
  }
  steps.sort((a, b) => a.slug.localeCompare(b.slug));
  return {
    slug,
    title: String(t.title ?? slug),
    mode: String(t.mode ?? "guided"),
    ttl: Number(t.ttl ?? 120),
    tabs: (t.tabs ?? []) as Track["tabs"],
    config: cfgRaw ? (YAML.parse(cfgRaw) as Record<string, unknown>) : {},
    steps,
  };
}

/** Step check/solve script source (served to the runner, never the raw solution to hints). */
export async function stepScript(slug: string, step: string, kind: "check" | "solve"): Promise<string> {
  if (!/^[a-z0-9-]+$/.test(slug) || !/^[a-z0-9-]+$/.test(step))
    throw new Error("invalid slug/step");
  const src = await readIf(`${ROOT}/${slug}/${step}/${kind}`);
  if (!src) throw new Error(`no ${kind} script for ${slug}/${step}`);
  return src;
}

/**
 * Initial shell layout declared by a track. Unknown tab types are skipped;
 * a track with no usable tabs yields undefined so the platform default applies.
 */
export function trackLayout(track: Pick<Track, "tabs">): Layout | undefined {
  const tabs: Tab[] = [];
  track.tabs.slice(0, MAX_TABS).forEach((t, i) => {
    const title = String(t.title ?? "").trim().slice(0, 40) || `Tab ${i + 1}`;
    const base = { id: `t${i + 1}`, title };
    if (t.type === "terminal") {
      const params: Tab["params"] = {};
      if (t.workdir) params.workdir = String(t.workdir).slice(0, 200);
      if (t.cmd) params.cmd = String(t.cmd).slice(0, 400);
      tabs.push({ ...base, type: "terminal", params });
    } else if (t.type === "website" || t.type === "service" || t.type === "browser") {
      tabs.push({ ...base, type: "browser", params: { port: Number(t.port) || 3000, path: t.path ? String(t.path) : "/" } });
    } else if (t.type === "editor" && t.path) {
      tabs.push({ ...base, type: "editor", params: { path: String(t.path) } });
    }
  });
  if (!tabs.length) return undefined;
  const firstTerm = tabs.find((t) => t.type === "terminal");
  const firstEditor = tabs.find((t) => t.type === "editor");
  return { tabs, activeId: (firstTerm ?? tabs.find((t) => t.type !== "editor"))?.id ?? null, activeEditorId: firstEditor?.id ?? null };
}
