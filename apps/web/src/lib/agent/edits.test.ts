import { describe, expect, test } from "bun:test";
import { buildCards, changedSince, editPathsOf, isOutside, lastAssistantIds, normPath, totals, turnsOf, type ChangeInfo, type Resolution } from "./edits";
import { applyEvent, newChatState, stateFromMessages, type UiMessage } from "./events";

const tool = (id: string, paths: string[], status: "done" | "error" | "running" = "done"): any => ({ type: "tool", id, name: "edit", status, label: "x", paths });
const user = (id: string): UiMessage => ({ kind: "user", id, text: id });
const asst = (id: string, ...parts: any[]): UiMessage => ({ kind: "assistant", id, parts });

describe("editPathsOf", () => {
  test("file-writing tools, any of the usual path keys", () => {
    expect(editPathsOf("write", { path: "a.txt" })).toEqual(["a.txt"]);
    expect(editPathsOf("edit", { filePath: "./src/b.js" })).toEqual(["src/b.js"]);
    expect(editPathsOf("multiedit", { file_path: "c.css" })).toEqual(["c.css"]);
  });
  test("read-only and shell tools write nothing we can name", () => {
    expect(editPathsOf("read", { path: "a.txt" })).toEqual([]);
    expect(editPathsOf("bash", { command: "rm a.txt" })).toEqual([]);
    expect(editPathsOf("write", {})).toEqual([]);
  });
  test("apply_patch lists every file in the patch once", () => {
    const patch = "*** Begin Patch\n*** Add File: new.txt\n+x\n*** Update File: old.txt\n@@\n-a\n+b\n*** Update File: old.txt\n*** Delete File: gone.txt\n*** End Patch";
    expect(editPathsOf("apply_patch", { patchText: patch })).toEqual(["new.txt", "old.txt", "gone.txt"]);
  });
  test("normPath strips ./, leading slashes and a known root", () => {
    expect(normPath("./a/b")).toBe("a/b");
    expect(normPath("/work/a/b", "/work")).toBe("a/b");
  });
  test("absolute tool paths become workspace-relative when the root is known", () => {
    const root = "/tmp/labs-playgrounds/abc/workspace";
    expect(editPathsOf("write", { filePath: `${root}/index.html` }, root)).toEqual(["index.html"]);
    expect(editPathsOf("edit", { path: `${root}/src/./a.js` }, [root])).toEqual(["src/a.js"]);
    expect(editPathsOf("apply_patch", { patchText: `*** Add File: ${root}/n.txt
+x
*** Delete File: ${root}/g.txt` }, root)).toEqual(["n.txt", "g.txt"]);
  });
  test("paths outside the workspace make no card once the root is known", () => {
    expect(editPathsOf("write", { path: "/tmp/rfy-outside-stub.txt" }, "/work")).toEqual([]);
    expect(editPathsOf("write", { path: "../x.txt" }, "/work")).toEqual([]);
    expect(editPathsOf("write", { path: "../x.txt" })).toEqual([]);
    expect(editPathsOf("write", { path: "/workspace-other/x" }, "/work")).toEqual([]); // prefix is not a path boundary
  });
});

describe("normPath with a root", () => {
  const root = "/home/u/ws";
  test("trailing slashes on the root and doubled slashes in the path", () => {
    expect(normPath("/home/u/ws/a/b.txt", "/home/u/ws/")).toBe("a/b.txt");
    expect(normPath("/home/u/ws//a///b.txt", "/home/u/ws//")).toBe("a/b.txt");
  });
  test("already relative and ./x stay relative", () => {
    expect(normPath("a/b.txt", root)).toBe("a/b.txt");
    expect(normPath("./a/b.txt", root)).toBe("a/b.txt");
    expect(normPath(".\\a\\b.txt", root)).toBe("a/b.txt");
  });
  test("outside the workspace is left alone (absolute) and flagged", () => {
    expect(normPath("/etc/passwd", root)).toBe("/etc/passwd");
    expect(isOutside(normPath("/etc/passwd", root))).toBe(true);
    expect(isOutside(normPath("../up.txt", root))).toBe(true);
    expect(isOutside(normPath("a/b.txt", root))).toBe(false);
    expect(normPath("/home/u/ws-other/a", root)).toBe("/home/u/ws-other/a");
  });
  test("the root itself is the empty path", () => { expect(normPath("/home/u/ws", root)).toBe(""); });
  test("realpath twin: /tmp vs /private/tmp, and a list of candidate roots", () => {
    expect(normPath("/private/tmp/ws/a.txt", "/tmp/ws")).toBe("a.txt");
    expect(normPath("/tmp/ws/a.txt", "/private/tmp/ws")).toBe("a.txt");
    expect(normPath("/real/ws/a.txt", ["/link/ws", "/real/ws"])).toBe("a.txt");
  });
  test("docker: container workspace dir under $HOME", () => {
    expect(normPath("/home/learner/workspace/site/app.css", "/home/learner/workspace")).toBe("site/app.css");
  });
  test("no root: old behaviour (leading slash stripped)", () => {
    expect(normPath("/tmp/x/index.html")).toBe("tmp/x/index.html");
    expect(normPath("/tmp/x/index.html", null)).toBe("tmp/x/index.html");
  });
});

describe("tool paths flow through events", () => {
  test("with a root, label and paths are relative (live and stored)", () => {
    const root = "/tmp/labs-playgrounds/abc/workspace";
    const st = newChatState([root]);
    applyEvent(st, { type: "session.tool.input.started", data: { assistantMessageID: "a1", id: "t1", name: "write" } });
    applyEvent(st, { type: "session.tool.called", data: { assistantMessageID: "a1", id: "t1", input: { filePath: `${root}/index.html`, content: "x" } } });
    const p = (st.messages[0] as any).parts[0];
    expect(p.label).toBe("Writing index.html");
    expect(p.paths).toEqual(["index.html"]);
    const hist = stateFromMessages([{ type: "user", id: "u", text: "hi" }, { type: "assistant", id: "a", content: [{ type: "tool", id: "t", name: "read", state: { status: "completed", input: { filePath: `${root}/a/b.txt` } } }] }], false, [root]);
    expect((hist.messages[1] as any).parts[0].label).toBe("Reading a/b.txt");
  });
  test("outside paths keep their label as given and make no card path", () => {
    const st = newChatState(["/work"]);
    applyEvent(st, { type: "session.tool.called", data: { assistantMessageID: "a1", id: "t1", input: { filePath: "/etc/hosts" } } });
    expect((st.messages[0] as any).parts[0].paths).toEqual([]);
  });
  test("live tool.called and stored history both carry paths", () => {
    const st = newChatState();
    applyEvent(st, { type: "session.tool.input.started", data: { assistantMessageID: "a1", id: "t1", name: "edit" } });
    applyEvent(st, { type: "session.tool.called", data: { assistantMessageID: "a1", id: "t1", input: { filePath: "x.txt" } } });
    expect((st.messages[0] as any).parts[0].paths).toEqual(["x.txt"]);
    const hist = stateFromMessages([{ type: "user", id: "u", text: "hi" }, { type: "assistant", id: "a", content: [{ type: "tool", id: "t", name: "write", state: { status: "completed", input: { path: "y.txt" } } }] }]);
    expect((hist.messages[1] as any).parts[0].paths).toEqual(["y.txt"]);
  });
});

describe("turns", () => {
  const msgs: UiMessage[] = [
    user("u1"), asst("a1", tool("t1", ["a.txt"]), tool("t2", ["a.txt", "b.txt"])), asst("a2", tool("t3", ["a.txt"])),
    user("u2"), asst("a3", tool("t4", ["c.txt"], "error"), tool("t5", ["a.txt"])),
  ];
  test("several edits to one file in a turn are ONE path", () => {
    expect(turnsOf(msgs)[0]).toEqual({ index: 0, paths: ["a.txt", "b.txt"] });
  });
  test("failed tool calls do not count", () => { expect(turnsOf(msgs)[1]!.paths).toEqual(["a.txt"]); });
  test("cards go under the last assistant message of each turn", () => {
    expect(lastAssistantIds(msgs)).toEqual(new Map([[0, "a2"], [1, "a3"]]));
  });
  test("changedSince finds new and bumped versions only", () => {
    expect(changedSince(new Map([["a", 1], ["b", 2]]), new Map([["a", 1], ["b", 3], ["c", 1]]))).toEqual(["b", "c"]);
  });
});

describe("buildCards", () => {
  const mk = (changes: Record<string, ChangeInfo>, res: Record<string, Resolution> = {}, base: string[] = []) => ({
    change: (p: string) => changes[p],
    resolution: (p: string) => res[p],
    hasBaseline: (p: string) => base.includes(p),
    versions: () => new Map(Object.keys(changes).map((k) => [k, 1] as [string, number])),
  });
  const turns = [{ index: 0, paths: ["a.txt", "b.txt"] }, { index: 1, paths: ["a.txt"] }];
  test("counts come from the lab's change list (combined, not per tool call)", () => {
    const m = buildCards([turns[0]!], new Map(), mk({ "a.txt": { status: "modified", add: 5, del: 2 }, "b.txt": { status: "added", add: 3, del: 0 } }));
    expect(m.get(0)!.map((c) => [c.path, c.state, c.change!.add, c.change!.del])).toEqual([["a.txt", "pending", 5, 2], ["b.txt", "pending", 3, 0]]);
    expect(totals(m.get(0)!)).toEqual({ add: 8, del: 2 });
  });
  test("a file edited in two turns: only the later card is actionable", () => {
    const m = buildCards(turns, new Map(), mk({ "a.txt": { status: "modified", add: 1, del: 1 }, "b.txt": { status: "added", add: 1, del: 0 } }));
    expect(m.get(0)!.find((c) => c.path === "a.txt")!.superseded).toBe(true);
    expect(m.get(0)!.find((c) => c.path === "b.txt")!.superseded).toBe(false);
    expect(m.get(1)![0]!.superseded).toBe(false);
  });
  test("kept / undone cards stay visible; unchanged-with-baseline files drop out", () => {
    const m = buildCards([turns[0]!], new Map(), mk({}, { "a.txt": "kept", "b.txt": "undone" }));
    expect(m.get(0)!.map((c) => c.state)).toEqual(["kept", "undone"]);
    const none = buildCards([turns[0]!], new Map(), mk({}, {}, ["a.txt", "b.txt"]));
    expect(none.size).toBe(0);
  });
  test("a pending change wins over an old resolution", () => {
    const m = buildCards([turns[0]!], new Map(), mk({ "a.txt": { status: "modified", add: 1, del: 0 } }, { "a.txt": "kept" }, ["a.txt"]));
    expect(m.get(0)![0]!.state).toBe("pending");
  });
  test("files only seen by the lab (shell edit, delete) get a card; big/binary files without an old copy say so", () => {
    const m = buildCards([{ index: 0, paths: [] }], new Map([[0, ["gone.txt", "pic.png"]]]), mk({ "gone.txt": { status: "deleted", add: 0, del: 4 } }));
    expect(m.get(0)!.map((c) => [c.path, c.state])).toEqual([["gone.txt", "pending"], ["pic.png", "unknown"]]);
  });
  test("opaque changes carry no counts into totals", () => {
    const m = buildCards([{ index: 0, paths: ["big.bin"] }], new Map(), mk({ "big.bin": { status: "added", add: 0, del: 0, opaque: true } }));
    expect(m.get(0)![0]!.change!.opaque).toBe(true);
    expect(totals(m.get(0)!)).toEqual({ add: 0, del: 0 });
  });
});

describe("buildCards without a known root (last-resort de-duplication)", () => {
  const host = (changes: Record<string, ChangeInfo>) => ({ change: (p: string) => changes[p], resolution: () => undefined, hasBaseline: () => false, versions: () => new Map(Object.keys(changes).map((k) => [k, 1] as [string, number])) });
  const abs = "tmp/labs-playgrounds/abc/workspace/index.html"; // what the old normPath leaves of an absolute path
  test("the host-prefixed path folds into the lab's own path: ONE card", () => {
    const m = buildCards([{ index: 0, paths: [abs] }], new Map([[0, ["index.html"]]]), host({ "index.html": { status: "added", add: 47, del: 0 } }));
    expect(m.get(0)!.map((c) => c.path)).toEqual(["index.html"]);
  });
  test("a nested lab path matches by trailing segments, longest wins", () => {
    const m = buildCards([{ index: 0, paths: ["tmp/ws/src/a.js"] }], new Map(), host({ "a.js": { status: "added", add: 1, del: 0 }, "src/a.js": { status: "added", add: 2, del: 0 } }));
    expect(m.get(0)!.map((c) => c.path)).toEqual(["src/a.js"]);
  });
  test("with the root known nothing is folded", () => {
    const m = buildCards([{ index: 0, paths: ["x/index.html"] }], new Map(), host({ "index.html": { status: "added", add: 1, del: 0 } }), { rootKnown: true });
    expect(m.get(0)!.map((c) => c.path)).toEqual(["x/index.html"]);
  });
});
