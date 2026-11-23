import { describe, expect, test } from "bun:test";
import { applyEvent, mergeSnapshot, newChatState, stateFromMessages, toolOutput, type AgentEvent } from "./events";
import { describePermission, permissionFromPayload } from "./permissions";
import { chatStatus } from "./status";
import { collapseText } from "./collapse";
import { createAgentClient } from "./api";

const ev = (type: string, data: Record<string, unknown> = {}): AgentEvent => ({ type, data: { sessionID: "ses_1", ...data } });
const A = "msg_a1";

describe("permission.asked / replied (shapes captured from opencode 2.4.1)", () => {
  const asked = { id: "per_1", action: "shell", resources: ["echo hi"], save: ["echo *"], source: { type: "tool", messageID: A, id: "call_1" } };
  test("asked adds a card once; replied removes it", () => {
    const st = newChatState();
    applyEvent(st, ev("permission.asked", asked));
    applyEvent(st, ev("permission.asked", asked)); // duplicate delivery (e.g. after reconnect)
    expect(st.permissions).toHaveLength(1);
    expect(st.permissions[0]).toMatchObject({ id: "per_1", action: "shell", title: "The agent wants to run a command", detail: "echo hi", status: "pending" });
    applyEvent(st, ev("permission.replied", { requestID: "per_1", reply: "once" }));
    expect(st.permissions).toHaveLength(0);
  });
  test("a finished or interrupted turn clears stale cards", () => {
    for (const end of ["session.execution.succeeded", "session.execution.interrupted", "session.execution.failed"]) {
      const st = newChatState();
      applyEvent(st, ev("permission.asked", asked));
      applyEvent(st, ev(end, end.endsWith("failed") ? { error: { type: "aborted" } } : {}));
      expect(st.permissions).toEqual([]);
    }
  });
  test("plain-language wording per action; never leaves an unknown action blank", () => {
    expect(describePermission("edit", ["a.html", "b.css"])).toEqual({ title: "The agent wants to change files", detail: "a.html, b.css" });
    expect(describePermission("external_directory", ["/etc"]).title).toContain("outside your workspace");
    expect(describePermission("doom_loop").title).toContain("repeating");
    expect(describePermission("mystery", ["x"]).title).toBe("The agent is asking for permission");
    expect(permissionFromPayload({ action: "edit" })).toBeNull(); // no id: cannot be answered
  });
});

describe("tool output and errors (collapsed in the UI)", () => {
  test("toolOutput strips the internal tool-repair note and joins text parts", () => {
    expect(toolOutput([{ type: "text", text: '<tool-repair>\nThere is no "bash" tool\n</tool-repair>' }, { type: "text", text: "line1\nline2\n" }])).toBe("line1\nline2");
    expect(toolOutput(undefined)).toBe("");
  });
  test("shell output and failure reasons are kept; routine file tools stay quiet", () => {
    const st = newChatState();
    applyEvent(st, ev("session.tool.input.started", { assistantMessageID: A, id: "s", name: "shell" }));
    applyEvent(st, ev("session.tool.success", { assistantMessageID: A, id: "s", content: [{ type: "text", text: "a\nb" }] }));
    applyEvent(st, ev("session.tool.input.started", { assistantMessageID: A, id: "w", name: "write" }));
    applyEvent(st, ev("session.tool.success", { assistantMessageID: A, id: "w", content: [{ type: "text", text: "Created file successfully" }] }));
    applyEvent(st, ev("session.tool.input.started", { assistantMessageID: A, id: "x", name: "write" }));
    applyEvent(st, ev("session.tool.failed", { assistantMessageID: A, id: "x", error: { type: "permission.rejected", message: "Permission denied: external_directory" } }));
    const parts = (st.messages[0] as any).parts;
    expect(parts[0].output).toBe("a\nb");
    expect(parts[1].output).toBeUndefined();
    expect(parts[2]).toMatchObject({ status: "error", output: "Permission denied: external_directory" });
  });
  test("history carries the same output", () => {
    const st = stateFromMessages([{ id: "m", type: "assistant", content: [{ type: "tool", id: "t", name: "shell", state: { status: "completed", input: { command: "ls" }, content: [{ type: "text", text: "x\ny" }] } }] }], false);
    expect((st.messages[0] as any).parts[0].output).toBe("x\ny");
  });
  test("collapseText: short stays whole, long shows the first lines and counts the rest", () => {
    expect(collapseText("a\nb")).toEqual({ head: "a\nb", hiddenLines: 0, long: false });
    const long = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`).join("\n");
    const c = collapseText(long);
    expect(c).toMatchObject({ long: true, hiddenLines: 116 });
    expect(c.head.split("\n")).toHaveLength(4);
    expect(collapseText("x".repeat(5000)).head.length).toBeLessThan(700); // one huge line is clamped too
  });
});

describe("chatStatus (the plain-language status line)", () => {
  const base = { phase: "ready" as const, conn: "live" as const, agent: "up" as const, running: false, pendingPermissions: 0 };
  test("each state maps to one phrase, raw errors never appear", () => {
    expect(chatStatus(base)).toEqual({ kind: "idle", text: "" });
    expect(chatStatus({ ...base, running: true })).toMatchObject({ kind: "working", text: "Working" });
    expect(chatStatus({ ...base, running: true, conn: "reconnecting" })).toMatchObject({ kind: "reconnecting", text: "Reconnecting…" });
    expect(chatStatus({ ...base, agent: "restarting" })).toMatchObject({ kind: "restarting", text: "Agent stopped, restarting…" });
    expect(chatStatus({ ...base, agent: "unavailable" })).toEqual({ kind: "unavailable", text: "Agent unavailable", restart: true });
    expect(chatStatus({ ...base, phase: "failed" })).toMatchObject({ kind: "unavailable", restart: true });
    expect(chatStatus({ ...base, phase: "starting" })).toMatchObject({ kind: "starting" });
    expect(chatStatus({ ...base, running: true, pendingPermissions: 1 })).toMatchObject({ kind: "waiting" });
  });
  test("a dead agent outranks a dead stream, which outranks working", () => {
    expect(chatStatus({ ...base, agent: "restarting", conn: "reconnecting", running: true }).kind).toBe("restarting");
    expect(chatStatus({ ...base, conn: "reconnecting", running: true }).kind).toBe("reconnecting");
  });
});

describe("mergeSnapshot (re-sync after reconnect: no duplicates, no losses)", () => {
  const hist = [
    { id: "u1", type: "user", text: "hi" },
    { id: "a1", type: "assistant", content: [{ type: "text", text: "Hello" }] },
  ];
  test("snapshot replaces, so replaying history never duplicates messages", () => {
    let st = stateFromMessages(hist, false);
    for (let i = 0; i < 3; i++) st = mergeSnapshot(stateFromMessages(hist, false), st);
    expect(st.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
  });
  test("local-only notices survive; a prompt still being sent is kept and keeps 'working'", () => {
    const old = stateFromMessages(hist, false);
    old.messages.push({ kind: "notice", id: "note-1", text: "restarted" });
    old.messages.push({ kind: "user", id: "local-1", text: "second", pending: true });
    const st = mergeSnapshot(stateFromMessages(hist, false), old);
    expect(st.messages.map((m) => m.id)).toEqual(["u1", "a1", "note-1", "local-1"]);
    expect(st.running).toBe(true);
  });
  test("a pending prompt the server already has is not shown twice", () => {
    const old = stateFromMessages(hist, false);
    old.messages.push({ kind: "user", id: "local-1", text: "second", pending: true });
    const snap = stateFromMessages([...hist, { id: "u2", type: "user", text: "second" }], true);
    const st = mergeSnapshot(snap, old);
    expect(st.messages.filter((m) => m.kind === "user" && m.text === "second")).toHaveLength(1);
  });
  test("a turn that finished while we were away shows its final text after the snapshot", () => {
    const live = newChatState();
    applyEvent(live, ev("session.text.delta", { assistantMessageID: "a1", ordinal: 0, delta: "Hel" })); // missed the rest
    const done = mergeSnapshot(stateFromMessages(hist, false), live);
    expect((done.messages.find((m) => m.id === "a1") as any).parts[0].text).toBe("Hello");
    expect(done.running).toBe(false);
  });
});

describe("subscribe: reconnect with backoff, re-sync hook, nudge", () => {
  const sse = (frames: string[], endWith: "close" | "hang" = "close") => {
    const enc = new TextEncoder();
    return new Response(new ReadableStream({ start(c) { for (const f of frames) c.enqueue(enc.encode(f)); if (endWith === "close") c.close(); } }), { headers: { "content-type": "text/event-stream" } });
  };
  test("a dropped stream reconnects, reports onReconnect once, and delivers events from both connections", async () => {
    let n = 0;
    const f = (async () => {
      n++;
      if (n === 1) return sse(['data: {"type":"a"}\n\n']); // closes: drop
      if (n === 2) return Response.json({ state: "stopped" }, { status: 503 }); // agent restarting
      return sse(['data: {"type":"b"}\n\n'], "hang");
    }) as unknown as typeof fetch;
    const c = createAgentClient({ base: "/x", fetch: f });
    const got: string[] = []; const states: string[] = []; const fails: number[] = []; let reconnects = 0;
    const stop = c.subscribe({ onEvent: (e) => got.push(e.type), onState: (s) => states.push(s), onReconnect: () => reconnects++, onFail: (s) => fails.push(s) });
    const t0 = Date.now();
    while (got.length < 2 && Date.now() - t0 < 6000) { await Bun.sleep(25); stop.nudge(); }
    stop();
    expect(got).toEqual(["a", "b"]);
    expect(reconnects).toBe(1);
    expect(fails).toContain(503);
    expect(states).toContain("reconnecting");
    expect(states.at(-1)).toBe("live");
  });
  test("permission endpoints", async () => {
    const calls: string[] = [];
    const f = (async (u: string, init?: RequestInit) => { calls.push(`${init?.method ?? "GET"} ${u} ${init?.body ?? ""}`); return Response.json({ data: [{ id: "per_1" }] }); }) as unknown as typeof fetch;
    const c = createAgentClient({ base: "/x", fetch: f });
    expect(await c.listPermissions("ses_1")).toEqual([{ id: "per_1" }]);
    await c.replyPermission("ses_1", "per_1", "reject");
    expect(calls).toEqual(["GET /x/api/session/ses_1/permission ", 'POST /x/api/session/ses_1/permission/per_1/reply {"decision":"reject"}']);
  });
});
