import YAML from "yaml";

/**
 * v2 authoring loader (workspace-spec §3, issue #6).
 * Track layout: track.yml, config.yml, NN-slug/{assignment.md, check, solve}.
 * Assignment frontmatter: title, difficulty, timelimit, tabs.
 */

export interface TrackStep {
  slug: string;
  title: string;
  difficulty?: string;
  timelimit?: number;
  tabs?: { title: string; type: string; port?: number }[];
  assignment: string;
  hasCheck: boolean;
  hasSolve: boolean;
}

export interface Track {
  slug: string;
  title: string;
  mode: string;
  ttl: number;
  tabs: { title: string; type: string; port?: number }[];
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
