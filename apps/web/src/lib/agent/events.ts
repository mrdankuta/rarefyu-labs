// Map OpenCode 2.4.1 events and stored messages to chat UI state. Pure and mutation-based (the Svelte
// controller holds the state in $state; tests hold a plain object). Shapes verified against a live 2.4.1
// server (see docs in the PR): events are `{id, type, data:{sessionID, ...}}`.
import { mapAgentError, isAbort, type StructuredError, type UiError } from "./errors";

export type ToolStatus = "running" | "done" | "error";
export type UiPart =
  | { type: "text"; key: string; text: string }
  | { type: "tool"; id: string; name: string; status: ToolStatus; label: string };
export type UiMessage =
  | { kind: "user"; id: string; text: string; pending?: boolean }
  | { kind: "assistant"; id: string; parts: UiPart[] }
  | { kind: "stopped"; id: string }
  | { kind: "error"; id: string; error: UiError };

export interface ChatState {
  messages: UiMessage[];
  /** A turn is in progress (between session.execution.started and succeeded/failed/interrupted). */
  running: boolean;
  /** The server is retrying after a model error (429 / 5xx); cleared when a step makes progress. */
  retry: { error: UiError; attempt: number } | null;
}
export const newChatState = (): ChatState => ({ messages: [], running: false, retry: null });

export interface AgentEvent { id?: string; type: string; data?: Record<string, any> }

// --- tool call -> one compact line ----------------------------------------------------------------------------
const clip = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Human label for a tool call, e.g. "Editing index.html". Input keys differ per tool; look at the common ones. */
export function toolLabel(name: string, input?: Record<string, unknown>): string {
  const i = input ?? {};
  const path = str(i.path) || str(i.filePath) || str(i.file_path) || str(i.file) || str(i.filename);
  const n = name.toLowerCase();
  if (n === "read") return path ? `Reading ${clip(path)}` : "Reading a file";
  if (n === "write") return path ? `Writing ${clip(path)}` : "Writing a file";
  if (n === "edit" || n === "patch" || n === "multiedit" || n === "apply_patch") return path ? `Editing ${clip(path)}` : "Editing files";
  if (n === "bash" || n === "shell") { const c = str(i.command) || str(i.cmd); return c ? `Running ${clip(c.replace(/\s+/g, " "))}` : "Running a command"; }
  if (n === "glob" || n === "list" || n === "ls") return `Looking through ${clip(str(i.pattern) || path || "the project")}`;
  if (n === "grep" || n === "search" || n === "codesearch") return `Searching for ${clip(str(i.pattern) || str(i.query) || "text")}`;
  if (n === "webfetch" || n === "fetch") return `Fetching ${clip(str(i.url) || "a page")}`;
  if (n === "todowrite" || n === "todoread") return "Updating its to-do list";
  if (n === "task") return "Working with a helper agent";
  return `Using ${name}`;
}

// --- helpers --------------------------------------------------------------------------------------------------
function assistant(st: ChatState, id: string) {
  let m = st.messages.find((x) => x.kind === "assistant" && x.id === id) as Extract<UiMessage, { kind: "assistant" }> | undefined;
  if (!m) { m = { kind: "assistant", id, parts: [] }; st.messages.push(m); }
  return m;
}
function textPart(m: Extract<UiMessage, { kind: "assistant" }>, ordinal: number) {
  const key = `text-${ordinal}`;
  let p = m.parts.find((x) => x.type === "text" && x.key === key) as Extract<UiPart, { type: "text" }> | undefined;
  if (!p) { p = { type: "text", key, text: "" }; m.parts.push(p); }
  return p;
}
function toolPart(m: Extract<UiMessage, { kind: "assistant" }>, id: string, name?: string) {
  let p = m.parts.find((x) => x.type === "tool" && x.id === id) as Extract<UiPart, { type: "tool" }> | undefined;
  if (!p) { p = { type: "tool", id, name: name ?? "tool", status: "running", label: toolLabel(name ?? "tool") }; m.parts.push(p); }
  return p;
}
let seq = 0;
const localId = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`;

/** Optimistic user bubble; `adoptUserId` swaps in the server id once the prompt is accepted. */
export function addPendingUser(st: ChatState, text: string): string {
  const id = localId("local");
  st.messages.push({ kind: "user", id, text, pending: true });
  return id;
}
export function adoptUserId(st: ChatState, localIdv: string, serverId: string) {
  const m = st.messages.find((x) => x.kind === "user" && x.id === localIdv);
  if (!m) return;
  // the SSE echo may already have added the server's copy: drop ours then
  if (st.messages.some((x) => x.kind === "user" && x.id === serverId)) { st.messages.splice(st.messages.indexOf(m), 1); return; }
  m.id = serverId; (m as any).pending = false;
}
export function failPendingUser(st: ChatState, localIdv: string) {
  const i = st.messages.findIndex((x) => x.kind === "user" && x.id === localIdv);
  if (i >= 0) st.messages.splice(i, 1);
}
export function pushError(st: ChatState, error: UiError) {
  st.messages.push({ kind: "error", id: localId("err"), error });
}

// --- live events ----------------------------------------------------------------------------------------------
/** Apply one live event for the CURRENT session (caller filters by data.sessionID). Unknown events are ignored. */
export function applyEvent(st: ChatState, ev: AgentEvent): void {
  const d = ev.data ?? {};
  switch (ev.type) {
    case "session.inbox.enqueued": {
      // a user prompt (from this panel or another surface). Ours is already shown optimistically.
      const item = d.item;
      if (item?.type !== "user") return;
      const text = str(item.payload?.text);
      const id = str(d.inboxID);
      if (!id || st.messages.some((x) => x.kind === "user" && x.id === id)) return;
      const pending = st.messages.find((x) => x.kind === "user" && x.pending && x.text === text);
      if (pending) { pending.id = id; (pending as any).pending = false; return; }
      st.messages.push({ kind: "user", id, text });
      return;
    }
    case "session.execution.started":
      st.running = true; st.retry = null; return;
    case "session.execution.succeeded":
      st.running = false; st.retry = null; return;
    case "session.execution.interrupted":
      st.running = false; st.retry = null;
      st.messages.push({ kind: "stopped", id: localId("stop") });
      return;
    case "session.execution.failed": {
      st.running = false; st.retry = null;
      if (isAbort(d.error)) { st.messages.push({ kind: "stopped", id: localId("stop") }); return; }
      const e = mapAgentError(d.error);
      if (e) pushError(st, e);
      return;
    }
    case "session.step.started":
      st.running = true; assistant(st, str(d.assistantMessageID)); return;
    case "session.step.first-token":
      st.retry = null; return;
    case "session.retry.scheduled": {
      const e = mapAgentError(d.error);
      if (e) st.retry = { error: e, attempt: Number(d.attempt) || 0 };
      return;
    }
    case "session.text.started":
      textPart(assistant(st, str(d.assistantMessageID)), Number(d.ordinal) || 0); return;
    case "session.text.delta":
      textPart(assistant(st, str(d.assistantMessageID)), Number(d.ordinal) || 0).text += str(d.delta); return;
    case "session.text.ended": {
      const p = textPart(assistant(st, str(d.assistantMessageID)), Number(d.ordinal) || 0);
      if (typeof d.text === "string") p.text = d.text; // authoritative final text
      return;
    }
    case "session.tool.input.started": {
      const p = toolPart(assistant(st, str(d.assistantMessageID)), str(d.id), str(d.name));
      p.name = str(d.name) || p.name; p.label = toolLabel(p.name); return;
    }
    case "session.tool.called": {
      const p = toolPart(assistant(st, str(d.assistantMessageID)), str(d.id));
      p.label = toolLabel(p.name, d.input); return;
    }
    case "session.tool.success":
      toolPart(assistant(st, str(d.assistantMessageID)), str(d.id)).status = "done"; return;
    case "session.tool.failed":
      toolPart(assistant(st, str(d.assistantMessageID)), str(d.id)).status = "error"; return;
    default:
      return;
  }
}

// --- history --------------------------------------------------------------------------------------------------
/** Rebuild UI state from `GET /api/session/:id/message?order=desc` (oldest first). */
export function stateFromMessages(msgs: any[], running = false): ChatState {
  const st = newChatState();
  st.running = running;
  for (const m of msgs) {
    if (m.type === "user") {
      st.messages.push({ kind: "user", id: m.id, text: str(m.text) });
    } else if (m.type === "assistant") {
      const parts: UiPart[] = [];
      let ord = 0;
      for (const c of m.content ?? []) {
        if (c.type === "text" && c.text) parts.push({ type: "text", key: `text-${ord++}`, text: c.text });
        else if (c.type === "tool") {
          const s = c.state?.status;
          parts.push({ type: "tool", id: c.id, name: c.name, status: s === "completed" ? "done" : s === "error" ? "error" : "running", label: toolLabel(c.name, c.state?.input) });
        }
      }
      // a tool that never finished in a stored turn is not running any more
      if (!running) for (const p of parts) if (p.type === "tool" && p.status === "running") p.status = "error";
      if (parts.length) st.messages.push({ kind: "assistant", id: m.id, parts });
      if (m.retry && running) { const e = mapAgentError(m.retry.error); if (e) st.retry = { error: e, attempt: Number(m.retry.attempt) || 0 }; }
    } else if (m.type === "idle") {
      if (m.outcome === "interrupted") st.messages.push({ kind: "stopped", id: m.id });
      else if (m.outcome === "failed") {
        if (isAbort(m.error as StructuredError)) st.messages.push({ kind: "stopped", id: m.id });
        else { const e = mapAgentError(m.error); if (e) st.messages.push({ kind: "error", id: m.id, error: e }); }
      }
    }
  }
  return st;
}
