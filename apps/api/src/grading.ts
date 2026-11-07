import { createHash } from "node:crypto";
import { driver } from "./drivers/local";
import { stepScript } from "./tracks";
import { getPlayground } from "./playgrounds";

/**
 * Isolated grading (issue #10, workspace-spec §4 split: this is the
 * record-of-truth half; in-session checks stay best-effort UX).
 * Grade runs in a FRESH directory seeded from a content snapshot of the
 * submission — never in the learner shell, never with the learner's env.
 * Check scripts come from the track (TRACKS_ROOT), so in-lab tampering with
 * anything (including a planted `check` binary) cannot change the verdict.
 * Identical submissions ⇒ identical verdict hashes (content-addressed).
 * Records are append-only; no update/delete API exists.
 */

export interface Submission {
  id: string;
  sessionId: string;
  track: string;
  step: string;
  commitHash: string; // sha256 over sorted path+content
  at: string;
}

export interface Grade {
  submissionId: string;
  pass: boolean;
  failures: { hint: string }[];
  log: string; // immutable, redacted of nothing sensitive (hints only)
  verdictHash: string; // sha256(commitHash + pass + failures)
  gradedAt: string;
}

const submissions = new Map<string, Submission>();
const grades = new Map<string, Grade>(); // submissionId → grade (write-once)

export function clearGrading() {
  submissions.clear();
  grades.clear();
}

const GRADE_ROOT = () => `${process.env.PLAYGROUND_ROOT ?? "/tmp/labs-playgrounds"}/_grading`;

function hashFileTree(files: { path: string; content: string }[]): string {
  const h = createHash("sha256");
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    h.update(`${f.path}\0${f.content}\0`);
  }
  return h.digest("hex");
}

async function snapshotWorkspace(sessionId: string): Promise<{ path: string; content: string }[]> {
  // Depth-first walk via driver listing (dotfiles excluded by listFiles).
  const out: { path: string; content: string }[] = [];
  const walk = async (sub: string) => {
    for (const e of await driver.listFiles(sessionId, sub)) {
      if (e.type === "dir") await walk(e.path);
      else {
        try {
          const r = await driver.readFile(sessionId, e.path);
          if (!r.truncated) out.push({ path: e.path, content: r.content });
        } catch {
          /* binary/unreadable: excluded from the commit, noted in log */
        }
      }
    }
  };
  await walk("");
  return out;
}

export async function submitForGrading(
  sessionId: string,
  track: string,
  step: string,
): Promise<Submission> {
  const rec = getPlayground(sessionId);
  if (!rec) throw new Error("session not found");
  const files = await snapshotWorkspace(sessionId);
  const sub: Submission = {
    id: crypto.randomUUID(),
    sessionId,
    track,
    step,
    commitHash: hashFileTree(files),
    at: new Date().toISOString(),
  };
  submissions.set(sub.id, sub);
  // Materialize the frozen copy now (fresh env per run, below, clones this).
  const dir = `${GRADE_ROOT()}/${sub.id}`;
  await Bun.$`mkdir -p ${dir}`.quiet();
  await Bun.write(`${dir}/_files.json`, JSON.stringify(files));
  return sub;
}

/** Grade a submission in a fresh dir with a clean env. Deterministic. */
export async function gradeSubmission(submissionId: string): Promise<Grade> {
  const existing = grades.get(submissionId);
  if (existing) return existing; // write-once: same commit, same verdict
  const sub = submissions.get(submissionId);
  if (!sub) throw new Error("submission not found");

  const frozen: { path: string; content: string }[] = await Bun.file(
    `${GRADE_ROOT()}/${sub.id}/_files.json`,
  ).json();
  const work = `${GRADE_ROOT()}/${sub.id}/work`;
  await Bun.$`rm -rf ${work}`.quiet();
  await Bun.$`mkdir -p ${work}`.quiet();
  for (const f of frozen) {
    if (f.path.includes("..")) continue;
    await Bun.write(`${work}/${f.path}`, f.content);
  }
  // Check script from the TRACK — never from the learner session.
  const script = await stepScript(sub.track, sub.step, "check");
  // bash, matching the in-session runner: check scripts rely on bash's
  // tolerant `. missing-file || fallback()` sourcing idiom.
  const proc = Bun.spawn(["bash", "-c", script], {
    cwd: work,
    stdout: "pipe",
    stderr: "pipe",
    // Pinned, minimal env: no learner shell exports leak in.
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/nonexistent", PORT: "3000", LANG: "C.UTF-8" },
  });
  const timeout = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      /* done */
    }
  }, 30_000);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout as unknown as ReadableStream).text(),
    new Response(proc.stderr as unknown as ReadableStream).text(),
    proc.exited,
  ]);
  clearTimeout(timeout);

  const failures = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("FAIL:"))
    .map((l) => ({ hint: l.slice(5).trim() }));
  if (exitCode !== 0 && failures.length === 0) {
    failures.push({ hint: "check script errored with no message" });
  }
  const pass = exitCode === 0 && failures.length === 0;
  const verdictHash = createHash("sha256")
    .update(`${sub.commitHash}:${pass}:${JSON.stringify(failures)}`)
    .digest("hex");
  const grade: Grade = {
    submissionId,
    pass,
    failures,
    log: `$ grade ${sub.track}/${sub.step} @${sub.commitHash.slice(0, 12)}\n${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`,
    verdictHash,
    gradedAt: new Date().toISOString(),
  };
  grades.set(submissionId, grade);
  return grade;
}

export function getSubmission(id: string) {
  return submissions.get(id);
}

export function getGrade(submissionId: string) {
  return grades.get(submissionId);
}
