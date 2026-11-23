// Chat controller (Svelte 5 runes). One per lab page; started lazily the first time the Chat layout is shown and
// kept alive across layout switches (the page owns it, the panel only renders it).
//
// Resilience (#55): a dropped stream reconnects with backoff and re-syncs from history; a dead agent server is
// restarted once automatically and then on request; every state maps to one plain-language status line (status.ts).
import { createAgentClient, type AgentClient, type ConnState } from "./api";
import { addPendingUser, adoptUserId, applyEvent, failPendingUser, mergeSnapshot, newChatState, pushError, stateFromMessages, type AgentEvent } from "./events";
import { AgentApiError, mapRequestError, type UiError } from "./errors";
import { permissionFromPayload } from "./permissions";
import { chatStatus, type AgentHealth } from "./status";
import { readSessionId, writeSessionId } from "./storage";

export type Phase = "idle" | "starting" | "ready" | "failed";

/** The stream must be down this long before the panel says "Reconnecting…" (a blip should stay invisible). */
const RECONNECT_SHOW_MS = 1200;
/** One automatic restart per window; a second crash inside it asks the student instead of looping. */
const AUTO_RESTART_WINDOW_MS = 120_000;

let nid = 0;

export class ChatController {
  phase = $state<Phase>("idle");
  chat = $state(newChatState());
  conn = $state<ConnState>("connecting");
  /** `conn` debounced: true only once the stream has been down for a moment. */
  reconnecting = $state(false);
  /** Is the agent server itself alive? (A dead stream with a live server is just a network blip.) */
  agent = $state<AgentHealth>("up");
  /** Blocking problem at startup (agent cannot start). Transcript errors live in chat.messages. */
  fatal = $state<UiError | null>(null);
  /** Non-blocking: this workspace has no class seat, so the agent would fall back to a limited free model. */
  noKey = $state(false);
  sessionId = $state<string | null>(null);
  loading = $state(false);

  /** The one status line: Working / Reconnecting… / Agent stopped, restarting… / Agent unavailable [Restart]. */
  status = $derived(chatStatus({ phase: this.phase, conn: this.reconnecting ? "reconnecting" : "live", agent: this.agent, running: this.chat.running, pendingPermissions: this.chat.permissions.length }));

  private client: AgentClient;
  private unsub: (ReturnType<AgentClient["subscribe"]>) | null = null;
  private starting: Promise<void> | null = null;
  private syncing = false;
  private dirty = false;
  private needsFinalSync = false;
  private reconnTimer: ReturnType<typeof setTimeout> | undefined;
  private checking = false;
  private recovering: Promise<void> | null = null;
  private lastAutoRestart = 0;
  private onlineHandler = () => this.unsub?.nudge();

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
    this.agent = "up";
    this.unsub ??= this.client.subscribe({
      onEvent: (ev) => this.onEvent(ev),
      onState: (s) => this.onConnState(s),
      onReconnect: () => { this.needsFinalSync = this.chat.running; void this.resync(); },
      onFail: () => { void this.checkAgent(); },
    });
    if (typeof window !== "undefined") window.addEventListener("online", this.onlineHandler);
    await this.restore();
    this.phase = "ready";
  }

  private onConnState(s: ConnState) {
    this.conn = s;
    clearTimeout(this.reconnTimer);
    if (s === "reconnecting") {
      if (!this.reconnecting) this.reconnTimer = setTimeout(() => { if (this.conn === "reconnecting") this.reconnecting = true; }, RECONNECT_SHOW_MS);
    } else {
      this.reconnecting = false;
      if (s === "live" && this.agent === "unavailable") this.agent = "up"; // a live stream means the server is back
    }
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

  /**
   * Rebuild the transcript from the server (history + whether a turn is still running + pending approvals).
   * Idempotent: replaces, never appends, so no message is duplicated. Events that arrive while a fetch is in flight
   * may be missing from its snapshot, so the fetch repeats (a few times at most) until a round saw none.
   */
  async resync() {
    const id = this.sessionId;
    if (!id) return;
    if (this.syncing) { this.dirty = true; return; }
    this.syncing = true;
    try {
      for (let round = 0; round < 3; round++) {
        this.dirty = false;
        const [msgs, active, perms] = await Promise.all([
          this.client.listMessages(id),
          this.client.activeSessionIds(),
          this.client.listPermissions(id).catch(() => [] as any[]),
        ]);
        if (this.sessionId !== id) return;
        const next = mergeSnapshot(stateFromMessages(msgs, active.has(id)), this.chat);
        next.permissions = perms.map((p) => permissionFromPayload(p)).filter((p): p is NonNullable<typeof p> => !!p);
        this.chat = next;
        if (!this.dirty) break;
      }
    } catch { /* keep what we have; the stream will carry on */ }
    finally { this.syncing = false; }
  }

  private onEvent(ev: AgentEvent) {
    if (!this.sessionId || ev.data?.sessionID !== this.sessionId) return;
    if (this.syncing) this.dirty = true;
    applyEvent(this.chat, ev);
    // a turn that straddled a reconnect: settle the final text from history, which is authoritative
    if (this.needsFinalSync && /^session\.execution\.(succeeded|failed|interrupted)$/.test(ev.type)) {
      this.needsFinalSync = false;
      void this.resync();
    }
  }

  // --- agent crash / restart -----------------------------------------------------------------------------------
  /** Called when the stream or a request failed: is the agent server still there? If not, restart it once on our own. */
  private async checkAgent() {
    if (this.checking || this.agent !== "up" || this.phase === "idle") return;
    this.checking = true;
    try {
      const st = await this.client.status();
      if (st.state === "healthy") return; // server is fine: just a network blip, the stream will come back
      const recent = Date.now() - this.lastAutoRestart < AUTO_RESTART_WINDOW_MS;
      if (recent) { this.agent = "unavailable"; return; } // crashed again right after a restart: ask the student
      this.lastAutoRestart = Date.now();
      await this.recover();
    } catch { /* the lab itself is unreachable (offline): "Reconnecting…" covers it */ }
    finally { this.checking = false; }
  }

  /** Start the agent server again, then reattach the stream and the conversation. Single-flight. */
  private recover(): Promise<void> {
    return (this.recovering ??= (async () => {
      const wasRunning = this.chat.running;
      this.agent = "restarting";
      try {
        await this.client.ensure();
      } catch {
        this.agent = "unavailable";
        return;
      }
      this.agent = "up";
      this.unsub?.nudge();
      await this.resync();
      if (wasRunning) {
        this.chat.running = false;
        this.chat.messages.push({ kind: "notice", id: `note-${Date.now().toString(36)}-${nid++}`, text: "The agent restarted, so its last reply may be unfinished. Send your message again if you need to." });
      }
    })().finally(() => { this.recovering = null; }));
  }

  /** The "Restart" button. Also the way out of a failed first start. */
  async restart() {
    if (this.phase === "failed" || this.phase === "idle") {
      this.phase = "idle"; this.agent = "up";
      await this.start();
      return;
    }
    this.lastAutoRestart = Date.now();
    await this.recover();
  }

  // --- user actions ------------------------------------------------------------------------------------------
  async send(raw: string) {
    const text = raw.trim();
    if (!text || this.chat.running || this.phase !== "ready" || this.agent !== "up") return;
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
      if (e instanceof AgentApiError && (e.status === 502 || e.status === 503)) {
        // the agent went away under us: say so plainly and let the recovery path take over
        this.chat.messages.push({ kind: "notice", id: `note-${Date.now().toString(36)}-${nid++}`, text: "That message was not sent because the agent had stopped. Send it again once it is back." });
        void this.checkAgent();
      } else pushError(this.chat, mapRequestError(e));
    }
  }

  async stop() {
    if (!this.sessionId || !this.chat.running) return;
    try { await this.client.interrupt(this.sessionId); }
    catch (e) { pushError(this.chat, mapRequestError(e)); }
    // the `execution.interrupted` event ends the turn; if the stream is down, resync settles it
    if (this.conn !== "live") await this.resync();
  }

  /** Answer an approval card. */
  async answerPermission(requestId: string, decision: "once" | "reject") {
    const id = this.sessionId;
    const p = this.chat.permissions.find((x) => x.id === requestId);
    if (!id || !p || p.status === "sending") return;
    p.status = "sending";
    try {
      await this.client.replyPermission(id, requestId, decision);
      this.chat.permissions = this.chat.permissions.filter((x) => x.id !== requestId);
    } catch (e) {
      if (e instanceof AgentApiError && e.status >= 400 && e.status < 500) {
        // already answered elsewhere (or the turn ended): drop the card and show the truth
        this.chat.permissions = this.chat.permissions.filter((x) => x.id !== requestId);
        void this.resync();
      } else {
        p.status = "pending";
        pushError(this.chat, mapRequestError(e));
      }
    }
  }

  /** Fresh conversation: stop anything running, forget the stored session, empty transcript. */
  async newConversation() {
    const old = this.sessionId;
    this.sessionId = null;
    this.chat = newChatState();
    writeSessionId(this.workspaceId, null);
    if (old) { try { await this.client.interrupt(old); } catch { /* idle already */ } }
  }

  dispose() {
    this.unsub?.(); this.unsub = null;
    clearTimeout(this.reconnTimer);
    if (typeof window !== "undefined") window.removeEventListener("online", this.onlineHandler);
  }
}
