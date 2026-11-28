import { describe, expect, test } from "bun:test";
import { gradeMessage } from "./grade";

describe("gradeMessage", () => {
  test("disabled response shows the unavailable message", () => {
    expect(gradeMessage(503, { error: "grading is unavailable", code: "grading_disabled" })).toBe(
      "Grading is unavailable right now",
    );
  });
  test("pass and fail render the verdict", () => {
    expect(gradeMessage(201, { grade: { pass: true, failures: [], verdictHash: "abcdef1234567890" } })).toBe(
      "official: PASS ✓ · verdict abcdef123456",
    );
    expect(
      gradeMessage(201, { grade: { pass: false, failures: [{ hint: "a" }, { hint: "b" }], verdictHash: "abcdef1234567890" } }),
    ).toBe("official: FAIL — a · b · abcdef123456");
  });
  test("other errors surface the server error, and unreadable bodies don't crash", () => {
    expect(gradeMessage(400, { error: "need {track, step}" })).toBe("need {track, step}");
    expect(gradeMessage(502, null)).toBe("Grading failed (HTTP 502)");
  });
});
