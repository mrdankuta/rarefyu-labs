import { describe, expect, test } from "bun:test";
import { addPendingUser, adoptUserId, applyEvent, newChatState, stateFromMessages, toolLabel, type AgentEvent, type ChatState } from "./events";
import { ERR } from "./errors";

const ev = (type: string, data: Record<string, unknown> = {}): AgentEvent => ({ type, data: { sessionID: "ses_1", ...data } });
const run = (st: ChatState, evs: AgentEvent[]) => { for (const e of evs) applyEvent(st, e); return st; };
const A = "msg_a1";

describe("applyEvent (shapes captured from opencode 2.4.1)", () => {
  test("streams text into one assistant message and ends the turn", () => {
    const st = run(newChatState(), [
      ev("session.execution.started"),
      ev("session.step.started", { assistantMessageID: A, agent: "build" }),
      ev("session.text.started", { assistantMessageID: A, ordinal: 0 }),
      ev("session.text.delta", { assistantMessageID: A, ordinal: 0, delta: "Hello " }),
      ev("session.text.delta", { assistantMessageID: A, ordinal: 0, delta: "world" }),
    ]);
    expect(st.running).toBe(true);
    expect(st.messages).toHaveLength(1);
    expect((st.messages[0] as any).parts[0].text).toBe("Hello world");
    run(st, [ev("session.text.ended", { assistantMessageID: A, ordinal: 0, text: "Hello world!" }), ev("session.execution.succeeded")]);
    expect((st.messages[0] as any).parts[0].text).toBe("Hello world!"); // final text is authoritative
    expect(st.running).toBe(false);
  });

  test("tool call: running line with a human label, then done", () => {
    const st = run(newChatState(), [
      ev("session.step.started", { assistantMessageID: A }),
      ev("session.tool.input.started", { assistantMessageID: A, id: "call_1", name: "write" }),
      ev("session.tool.called", { assistantMessageID: A, id: "call_1", input: { path: "hello.txt", content: "x" } }),
    ]);
    const tool = (st.messages[0] as any).parts[0];
    expect(tool).toMatchObject({ type: "tool", name: "write", status: "running", label: "Writing hello.txt" });
    run(st, [ev("session.tool.success", { assistantMessageID: A, id: "call_1", content: [{ type: "text", text: "Created" }] })]);
    expect(tool.status).toBe("done");
    expect(JSON.stringify(st)).not.toContain("Created"); // tool output is not shown in the compact line
  });

  test("failed tool is marked error", () => {
    const st = run(newChatState(), [ev("session.tool.input.started", { assistantMessageID: A, id: "c", name: "bash" }), ev("session.tool.failed", { assistantMessageID: A, id: "c", error: { type: "tool.execution", message: "x" } })]);
    expect((st.messages[0] as any).parts[0].status).toBe("error");
  });

  test("user stop: interrupted event ends the turn with a stopped note, no error", () => {
    const st = run(newChatState(), [ev("session.execution.started"), ev("session.step.failed", { assistantMessageID: A, error: { type: "aborted", message: "Step interrupted" } }), ev("session.execution.interrupted", { reason: "user" })]);
    expect(st.running).toBe(false);
    expect(st.messages.map((m) => m.kind)).toEqual(["stopped"]); // step.failed (aborted) adds nothing
  });

  test("429/500 retry.scheduled shows a retry notice that clears on the next token", () => {
    const st = run(newChatState(), [
      ev("session.execution.started"),
      ev("session.retry.scheduled", { assistantMessageID: A, attempt: 2, at: 1, error: { type: "provider.rate-limit", message: "m", status: 429 } }),
    ]);
    expect(st.retry).toEqual({ error: ERR.rate_limit, attempt: 2 });
    expect(st.running).toBe(true);
    run(st, [ev("session.step.first-token", { assistantMessageID: A })]);
    expect(st.retry).toBeNull();
  });

  test("execution.failed pushes a plain-language error and stops running", () => {
    const st = run(newChatState(), [ev("session.execution.started"), ev("session.execution.failed", { error: { type: "provider.auth", message: "stub 401", status: 401 } })]);
    expect(st.running).toBe(false);
    expect(st.messages.at(-1)).toMatchObject({ kind: "error", error: ERR.auth });
  });

  test("provider 500 final failure", () => {
    const st = run(newChatState(), [ev("session.execution.failed", { error: { type: "provider.internal", message: "m", status: 500 } })]);
    expect(st.messages.at(-1)).toMatchObject({ kind: "error", error: ERR.model });
  });

  test("user echo from SSE does not duplicate the optimistic bubble", () => {
    const st = newChatState();
    const local = addPendingUser(st, "hi");
    applyEvent(st, ev("session.inbox.enqueued", { inboxID: "msg_u1", item: { type: "user", payload: { text: "hi" } } }));
    expect(st.messages).toHaveLength(1);
    expect(st.messages[0]).toMatchObject({ id: "msg_u1", pending: false });
    adoptUserId(st, local, "msg_u1"); // POST response arrives after: no-op
    expect(st.messages).toHaveLength(1);
  });

  test("prompt from elsewhere (other surface) is added; unknown events ignored", () => {
    const st = run(newChatState(), [ev("session.inbox.enqueued", { inboxID: "msg_u2", item: { type: "user", payload: { text: "from terminal" } } }), ev("session.usage.updated"), ev("session.renamed", { title: "t" })]);
    expect(st.messages).toEqual([{ kind: "user", id: "msg_u2", text: "from terminal" }]);
  });
});

describe("toolLabel", () => {
  test.each([
    ["read", { path: "src/a.ts" }, "Reading src/a.ts"],
    ["edit", { filePath: "index.html" }, "Editing index.html"],
    ["bash", { command: "npm   install" }, "Running npm install"],
    ["grep", { pattern: "TODO" }, "Searching for TODO"],
    ["glob", { pattern: "**/*.css" }, "Looking through **/*.css"],
    ["mystery", {}, "Using mystery"],
  ])("%s", (n, input, want) => expect(toolLabel(n as string, input as any)).toBe(want));
  test("long commands are clipped", () => expect(toolLabel("bash", { command: "x".repeat(300) }).length).toBeLessThan(90));
});

describe("stateFromMessages (history, order=asc)", () => {
  const hist = [
    { id: "u1", type: "user", text: "make a file", time: {} },
    { id: "a1", type: "assistant", content: [{ type: "tool", id: "c1", name: "write", state: { status: "completed", input: { path: "hello.txt" }, content: [] } }] },
    { id: "a2", type: "assistant", content: [{ type: "text", text: "Done." }] },
    { id: "i1", type: "idle", outcome: "succeeded" },
    { id: "u2", type: "user", text: "again [[401]]" },
    { id: "a3", type: "assistant", content: [], finish: "error", error: { type: "provider.auth", message: "x", status: 401 } },
    { id: "i2", type: "idle", outcome: "failed", error: { type: "provider.auth", message: "x", status: 401 } },
    { id: "u3", type: "user", text: "slow" },
    { id: "i3", type: "idle", outcome: "interrupted" },
  ];
  test("rebuilds transcript: user, tool line, reply, error, stopped", () => {
    const st = stateFromMessages(hist);
    expect(st.messages.map((m) => m.kind)).toEqual(["user", "assistant", "assistant", "user", "error", "user", "stopped"]);
    expect((st.messages[1] as any).parts[0]).toMatchObject({ type: "tool", status: "done", label: "Writing hello.txt" });
    expect((st.messages[4] as any).error).toBe(ERR.auth);
    expect(st.running).toBe(false);
  });
  test("a turn still running on the server restores the working state and retry notice", () => {
    const st = stateFromMessages([{ id: "u", type: "user", text: "x" }, { id: "a", type: "assistant", content: [], retry: { attempt: 3, at: 1, error: { type: "provider.rate-limit", message: "m", status: 429 } } }], true);
    expect(st.running).toBe(true);
    expect(st.retry).toEqual({ error: ERR.rate_limit, attempt: 3 });
  });
  test("an unfinished tool in a finished turn does not spin forever", () => {
    const st = stateFromMessages([{ id: "a", type: "assistant", content: [{ type: "tool", id: "c", name: "bash", state: { status: "running", input: {} } }] }], false);
    expect((st.messages[0] as any).parts[0].status).toBe("error");
  });
});
