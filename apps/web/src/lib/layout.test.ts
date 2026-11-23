import { describe, expect, test } from "bun:test";
import { LAYOUT_KEY, forcedClassic, readStoredLayout, resolveLayout, storeLayout } from "./layout";

const mem = (init: Record<string, string> = {}) => {
  const m = { ...init };
  return { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => { m[k] = v; }, m };
};

describe("resolveLayout", () => {
  test("first visit defaults to chat", () => expect(resolveLayout(null)).toBe("chat"));
  test("stored value wins", () => {
    expect(resolveLayout("classic")).toBe("classic");
    expect(resolveLayout("chat")).toBe("chat");
  });
  test("corrupt storage falls back to chat", () => {
    expect(resolveLayout("banana")).toBe("chat");
    expect(resolveLayout("")).toBe("chat");
  });
  test("flag forces classic over stored chat and default", () => {
    expect(resolveLayout("chat", "classic")).toBe("classic");
    expect(resolveLayout(null, " Classic ")).toBe("classic");
  });
  test("other flag values are ignored", () => {
    expect(resolveLayout(null, "chat")).toBe("chat");
    expect(resolveLayout("classic", "")).toBe("classic");
    expect(forcedClassic(undefined)).toBe(false);
  });
});

describe("storage", () => {
  test("round-trips", () => {
    const s = mem();
    storeLayout("classic", s);
    expect(s.m[LAYOUT_KEY]).toBe("classic");
    expect(readStoredLayout(s)).toBe("classic");
  });
  test("throwing storage is swallowed", () => {
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readStoredLayout(bad)).toBeNull();
    expect(() => storeLayout("chat", bad)).not.toThrow();
  });
});
