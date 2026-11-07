import { driver } from "./drivers/local";
import { stepScript } from "./tracks";

/**
 * In-session checker v0 (issue #6, workspace-spec §4 split: this is the
 * instant-hint in-session half; isolated grading arrives in slice #10).
 * Runs the step's `check` script in the learner session, parses FAIL: lines
 * into hints, records attempts. `solve` only runs on explicit unlock and is
 * never included in hint payloads.
 */

export interface Attempt {
  id: string;
  sessionId: string;
  track: string;
  step: string;
  pass: boolean;
  failures: { hint: string }[];
  at: string;
}

const attempts: Attempt[] = [];
const progress = new Map<string, Set<string>>(); // `${sessionId}:${track}` → passed steps

export function clearChecks() {
  attempts.length = 0;
  progress.clear();
}

export function getAttempts(sessionId: string): Attempt[] {
  return attempts.filter((a) => a.sessionId === sessionId);
}

export function getProgress(sessionId: string, track: string): string[] {
  return [...(progress.get(`${sessionId}:${track}`) ?? [])].sort();
}

export async function runCheck(
  sessionId: string,
  track: string,
  step: string,
): Promise<{ pass: boolean; failures: { hint: string }[]; durationMs: number }> {
  const started = Date.now();
  const script = await stepScript(track, step, "check");
  const { stdout, exitCode } = await driver.run(sessionId, script, { timeoutMs: 30_000 });
  const failures = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("FAIL:"))
    .map((l) => ({ hint: l.slice(5).trim() }));
  // Nonzero exit without FAIL: lines → generic hint (script bug, still actionable).
  if (exitCode !== 0 && failures.length === 0) {
    failures.push({ hint: "check script errored with no message — re-run the step commands manually" });
  }
  const pass = exitCode === 0 && failures.length === 0;
  attempts.push({
    id: crypto.randomUUID(),
    sessionId,
    track,
    step,
    pass,
    failures,
    at: new Date().toISOString(),
  });
  if (pass) {
    const key = `${sessionId}:${track}`;
    if (!progress.get(key)) progress.set(key, new Set());
    progress.get(key)!.add(step);
  }
  return { pass, failures, durationMs: Date.now() - started };
}

/** Solution unlock: explicit only, audited as an attempt with unlocked:true. */
export async function runSolve(sessionId: string, track: string, step: string): Promise<{ output: string }> {
  const script = await stepScript(track, step, "solve");
  const { stdout, stderr } = await driver.run(sessionId, script, { timeoutMs: 30_000 });
  attempts.push({
    id: crypto.randomUUID(),
    sessionId,
    track,
    step,
    pass: false,
    failures: [{ hint: "solution unlocked by learner" }],
    at: new Date().toISOString(),
  });
  return { output: (stdout + stderr).slice(-2000) };
}
