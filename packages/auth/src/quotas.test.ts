import { describe, expect, test } from "bun:test";
import { LEARNER_POLICY, checkQuota, requireGuidedAuth } from "./quotas";

describe("guided entitlement decisions", () => {
  test("within quota passes", () => {
    expect(checkQuota({ live: 1, createdLast24h: 2 }, LEARNER_POLICY)).toEqual({ ok: true });
  });

  test("live cap names the remedy", () => {
    const d = checkQuota({ live: 2, createdLast24h: 2 }, LEARNER_POLICY);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.error).toContain("2/2 live");
      expect(d.remedy).toContain("stop an idle session");
    }
  });

  test("daily cap carries retryAfter", () => {
    const d = checkQuota({ live: 0, createdLast24h: 4 }, LEARNER_POLICY);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.retryAfterSec).toBe(24 * 3600);
  });

  test("anonymous guided creation rejected with sign-in prompt", () => {
    const d = requireGuidedAuth(null);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.error).toContain("sign-in required");
      expect(d.remedy).toContain("anonymous playgrounds");
    }
  });

  test("signed-in user passes the gate", () => {
    expect(requireGuidedAuth("u_1")).toEqual({ ok: true, userId: "u_1" });
  });
});
