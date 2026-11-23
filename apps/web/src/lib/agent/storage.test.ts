import { describe, expect, test } from "bun:test";
import { readSessionId, sessionKey, writeSessionId } from "./storage";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };

describe("session storage", () => {
  test("per-workspace key, round trip, clear", () => {
    const s = mem();
    writeSessionId("w1", "ses_abc", s);
    expect(s.m.get("rfy_chat_session:w1")).toBe("ses_abc");
    expect(sessionKey("w1")).toBe("rfy_chat_session:w1");
    expect(readSessionId("w1", s)).toBe("ses_abc");
    expect(readSessionId("w2", s)).toBeNull();
    writeSessionId("w1", null, s);
    expect(readSessionId("w1", s)).toBeNull();
  });
  test("blocked storage and junk values never throw", () => {
    const bad = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
    expect(readSessionId("w", bad)).toBeNull();
    expect(() => writeSessionId("w", "ses_x", bad)).not.toThrow();
    const s = mem(); s.setItem(sessionKey("w"), "<script>");
    expect(readSessionId("w", s)).toBeNull();
  });
});
