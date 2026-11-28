/** Text shown under "Submit for grade" for a grade-route response. */
export function gradeMessage(status: number, body: any): string {
  if (body?.code === "grading_disabled") return "Grading is unavailable right now";
  if (status >= 200 && status < 300 && body?.grade) {
    const hash = String(body.grade.verdictHash).slice(0, 12);
    return body.grade.pass
      ? `official: PASS ✓ · verdict ${hash}`
      : `official: FAIL — ${body.grade.failures.map((f: { hint: string }) => f.hint).join(" · ")} · ${hash}`;
  }
  return body?.error ?? `Grading failed (HTTP ${status})`;
}
