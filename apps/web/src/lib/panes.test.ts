import { describe, expect, test } from "bun:test";
import { CENTER_MIN, MINS, RAIL, clampWidth, emptyPanes, isCustom, maxWidth, nextWidth, paneVars, parsePanes, readPanes, resetPane, serializePanes, setWidth, storePanes, toggleCollapsed } from "./panes";

describe("panes", () => {
  test("clamp keeps a pane between its minimum and the maximum", () => {
    expect(clampWidth("chat", 100, 900)).toBe(MINS.chat);
    expect(clampWidth("chat", 5000, 900)).toBe(900);
    expect(clampWidth("chat", 512.4, 900)).toBe(512);
    expect(clampWidth("chat", 400, 100)).toBe(MINS.chat); // a max below the minimum never shrinks it past the minimum
  });
  test("right-edge handles grow with the pointer, left-edge handles against it", () => {
    expect(nextWidth("chat", 400, 50, "right", 900)).toBe(450);
    expect(nextWidth("right", 500, 50, "left", 900)).toBe(450);
    expect(nextWidth("right", 500, -80, "left", 900)).toBe(580);
  });
  test("the centre keeps its minimum width; drawers may use the whole dock", () => {
    expect(maxWidth("chat", 400, 700, 1500)).toBe(400 + 700 - CENTER_MIN);
    expect(maxWidth("chat", 400, 300, 1500)).toBe(400); // centre already tight: the pane may not grow, and is not forced to shrink
    expect(maxWidth("term", 640, 900, 1500)).toBe(1476);
  });
  test("collapse, resize and reset are independent per pane", () => {
    let s = setWidth(emptyPanes(), "chat", 420);
    s = toggleCollapsed(s, "files");
    expect(s.w.chat).toBe(420);
    expect(s.collapsed.files).toBe(true);
    s = resetPane(s, "files");
    expect(s.collapsed.files).toBeUndefined();
    expect(isCustom(s)).toBe(true);
    expect(isCustom(resetPane(s, "chat"))).toBe(false);
    expect(setWidth(toggleCollapsed(emptyPanes(), "chat"), "chat", 300).collapsed.chat).toBe(false); // dragging re-expands
  });
  test("CSS vars: nothing for defaults, capped px for sizes, a rail for collapsed panes", () => {
    expect(paneVars(emptyPanes())).toBe("");
    expect(paneVars(setWidth(emptyPanes(), "chat", 420))).toBe("--w-chat:min(420px,60%)");
    expect(paneVars(setWidth(emptyPanes(), "term", 700))).toBe("--w-term:700px");
    expect(paneVars(toggleCollapsed(setWidth(emptyPanes(), "files", 300), "files"))).toBe(`--w-files:${RAIL}px`);
  });
  test("parse survives garbage and clamps stored values", () => {
    for (const bad of [null, undefined, "", "{", "[]", "7", '{"w":5}', '{"w":{"chat":"wide"}}']) expect(isCustom(parsePanes(bad as string))).toBe(false);
    const s = parsePanes('{"w":{"chat":10,"right":99999,"nope":1},"collapsed":{"chat":true,"term":true}}');
    expect(s.w.chat).toBe(MINS.chat);
    expect(s.w.right).toBe(4000);
    expect(s.collapsed.chat).toBe(true);
    expect(s.collapsed.term).toBeUndefined(); // drawers close, they do not collapse
    expect(parsePanes(serializePanes(s))).toEqual(s);
  });
  test("storage round trip; defaults clear the key; blocked storage is harmless", () => {
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    storePanes(setWidth(emptyPanes(), "steps", 260), st);
    expect(readPanes(st).w.steps).toBe(260);
    storePanes(emptyPanes(), st);
    expect(mem.size).toBe(0);
    const boom = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(isCustom(readPanes(boom))).toBe(false);
    expect(() => storePanes(setWidth(emptyPanes(), "steps", 260), boom)).not.toThrow();
  });
});
