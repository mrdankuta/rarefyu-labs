// Chat controller (Svelte 5 runes). One per lab page; started lazily the first time the Chat layout is shown and
// kept alive across layout switches (the page owns it, the panel only renders it).
import { createAgentClient, type AgentClient, type ConnState } from "./api";
import { addPendingUser, adoptUserId, applyEvent, failPendingUser, newChatState, pushError, stateFromMessages, type AgentEvent } from "./events";
import { mapRequestError, type UiError } from "./errors";
import { readSessionId, writeSessionId } from "./storage";
import { changedSince, type EditHost } from "./edits";

export type Phase = "idle" | "starting" | "ready" | "failed";

export class ChatController {
  phase = $state<Phase>("idle");
  chat = $state(newChatState());
  conn = $state<ConnState>("connecting");
  /** Blocking problem (agent cannot start / lost). Transcript errors live in chat.messages. */
  fatal = $state<UiError | null>(null);
  /** Non-blocking: this workspace has no class seat, so the agent would fall back to a limited free model. */
  noKey = $state(false);
  sessionId = $state<string | null>(null);
  loading = $state(false);

  /** The lab page's change tracking + editor (set by the page). Edit cards, editor refresh and save-before-send use it. */
  host: EditHost | null = null;
  /** Per turn: files the lab saw change while the agent worked (covers shell edits and deletes). */
  turnChanged = $state<Record<number, string[]>>({});
  private snap: Map<string, number> | null = null;
  private turnIdx = -1;
  private sending = false;

  private client: AgentClient;
  private unsub: (() => void) | null = null;
  private starting: Promise<void> | null = null;

  constructor(private workspaceId: string, client?: AgentClient) {
    this.client = client ?? createAgentClient({ base: `/api/playgrounds/${workspaceId}/agent` });
  }

  /** Idempotent. Safe to call on every layout switch. */
  start(): Promise<void> {
    if (this.phase === "ready") return Promise.resolve();
    return (this.starting ??= this.boot().finally(() => { this.starting = null; }));
  }

  private async boot() {
    this.phase = "starting"; this.fatal = null;
    try {
      const st = await this.client.ensure();
      // OpenCode silently falls back to a limited free model when no key is installed, so "no key" is not an
      // error event: the API tells us whether this workspace has a class seat.
      this.noKey = st.keyed === false;
    } catch (e) {
      this.fatal = mapRequestError(e, "start");
      this.phase = "failed";
      return;
    }
    this.unsub ??= this.client.subscribe({
      onEvent: (ev) => this.onEvent(ev),
      onState: (s) => { this.conn = s; },
      onReconnect: () => { void this.resync(); },
    });
    await this.restore();
    this.phase = "ready";
  }

  /** Reload the stored conversation (if any) after a page load. */
  private async restore() {
    const id = readSessionId(this.workspaceId);
    if (!id) return;
    this.loading = true;
    try {
      const s = await this.client.getSession(id);
      if (!s) { writeSessionId(this.workspaceId, null); return; }
      this.sessionId = id;
      await this.resync();
    } catch (e) {
      this.fatal = mapRequestError(e);
    } finally { this.loading = false; }
  }

  /** Rebuild the transcript from the server (history + whether a turn is still running). */
  private async resync() {
    const id = this.sessionId;
    if (!id) return;
    try {
      const [msgs, active] = await Promise.all([this.client.listMessages(id), this.client.activeSessionIds()]);
      if (this.sessionId !== id) return;
      this.chat = stateFromMessages(msgs, active.has(id));
    } catch { /* keep what we have; the stream will carry on */ }
  }

  private userCount() { return this.chat.messages.filter((m) => m.kind === "user").length; }
  private beginTurn() {
    this.turnIdx = Math.max(0, this.userCount() - 1);
    this.snap = this.host?.versions() ?? null;
  }
  /** Turn over: re-read the workspace now (not at the next 5s poll) and remember which files moved. */
  private async finishTurn() {
    const idx = this.turnIdx, snap = this.snap, host = this.host;
    this.snap = null;
    if (!host || !snap) return;
    await host.syncNow();
    this.turnChanged = { ...this.turnChanged, [idx]: changedSince(snap, host.versions()) };
  }

  private onEvent(ev: AgentEvent) {
    if (!this.sessionId || ev.data?.sessionID !== this.sessionId) return;
    if (ev.type === "session.execution.started" && !this.snap) this.beginTurn();
    applyEvent(this.chat, ev);
    if (ev.type === "session.tool.success") void this.host?.syncNow(); // open editors follow the agent while it works
    if (ev.type === "session.execution.succeeded" || ev.type === "session.execution.failed" || ev.type === "session.execution.interrupted") void this.finishTurn();
  }

  async send(raw: string) {
    const text = raw.trim();
    if (!text || this.chat.running || this.sending || this.phase !== "ready") return;
    this.sending = true;
    this.chat.retry = null;
    let local: string | null = null;
    try {
      // the agent must see what the student typed: get unsaved editor edits onto disk first
      try { await this.host?.flushSaves(); } catch { /* the lab reports a failed save itself */ }
      if (!this.sessionId) {
        const s = await this.client.createSession();
        this.sessionId = s.id;
        writeSessionId(this.workspaceId, s.id);
      }
      local = addPendingUser(this.chat, text);
      this.beginTurn();
      this.chat.running = true; // optimistic: the "working" indicator shows at once
      const serverId = await this.client.sendPrompt(this.sessionId, text);
      adoptUserId(this.chat, local, serverId);
    } catch (e) {
      if (local) failPendingUser(this.chat, local);
      this.snap = null;
      this.chat.running = false;
      pushError(this.chat, mapRequestError(e));
    } finally { this.sending = false; }
  }

  async stop() {
    if (!this.sessionId || !this.chat.running) return;
    try { await this.client.interrupt(this.sessionId); }
    catch (e) { pushError(this.chat, mapRequestError(e)); }
    // the `execution.interrupted` event ends the turn; if the stream is down, resync settles it
    if (this.conn !== "live") await this.resync();
  }

  /** Fresh conversation: stop anything running, forget the stored session, empty transcript. */
  async newConversation() {
    const old = this.sessionId;
    this.sessionId = null;
    this.chat = newChatState();
    this.turnChanged = {}; this.snap = null;
    writeSessionId(this.workspaceId, null);
    if (old) { try { await this.client.interrupt(old); } catch { /* idle already */ } }
  }

  dispose() { this.unsub?.(); this.unsub = null; }
}

