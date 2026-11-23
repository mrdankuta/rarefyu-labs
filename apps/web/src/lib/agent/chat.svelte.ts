// Chat controller (Svelte 5 runes). One per lab page; started lazily the first time the Chat layout is shown and
// kept alive across layout switches (the page owns it, the panel only renders it).
import { createAgentClient, type AgentClient, type ConnState } from "./api";
import { addPendingUser, adoptUserId, applyEvent, failPendingUser, newChatState, pushError, stateFromMessages, type AgentEvent } from "./events";
import { mapRequestError, type UiError } from "./errors";
import { readSessionId, writeSessionId } from "./storage";

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

  /** Called once when a live turn ends (succeeded, failed or interrupted), never per streamed token. The page refreshes the preview here. */
  onTurnEnd: (() => void) | null = null;

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

  private onEvent(ev: AgentEvent) {
    if (!this.sessionId || ev.data?.sessionID !== this.sessionId) return;
    const was = this.chat.running;
    applyEvent(this.chat, ev);
    if (was && !this.chat.running) this.onTurnEnd?.();
  }

  async send(raw: string) {
    const text = raw.trim();
    if (!text || this.chat.running || this.phase !== "ready") return;
    this.chat.retry = null;
    let local: string | null = null;
    try {
      if (!this.sessionId) {
        const s = await this.client.createSession();
        this.sessionId = s.id;
        writeSessionId(this.workspaceId, s.id);
      }
      local = addPendingUser(this.chat, text);
      this.chat.running = true; // optimistic: the "working" indicator shows at once
      const serverId = await this.client.sendPrompt(this.sessionId, text);
      adoptUserId(this.chat, local, serverId);
    } catch (e) {
      if (local) failPendingUser(this.chat, local);
      this.chat.running = false;
      pushError(this.chat, mapRequestError(e));
    }
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
    writeSessionId(this.workspaceId, null);
    if (old) { try { await this.client.interrupt(old); } catch { /* idle already */ } }
  }

  dispose() { this.unsub?.(); this.unsub = null; }
}

