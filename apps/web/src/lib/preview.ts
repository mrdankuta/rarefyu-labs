// Preview controller (Chat layout): asks the API to make sure the student's web project is being served
// (the API starts it through the driver when needed), and exposes a calm UI state while it boots. It never
// shows an error for a server that is merely still starting: network blips and 5xx answers keep the
// "starting" state until the API itself says the start failed (or a hard cap passes).
export type PreviewUi = "idle" | "starting" | "ready" | "failed" | "not-web";

export interface EnsureAnswer {
  state: "ready" | "starting" | "failed" | "not-web";
  port?: number;
  hint?: string;
}
export interface PreviewHooks {
  /** Server answers. `reload` is true for turn-end refreshes (the page then reloads the iframe in place). */
  onReady(port: number, reload: boolean): void;
  /** The server is not serving (any more): the page drops a stale iframe. */
  onNotReady(): void;
  onPort(port: number): void;
  /** Any change of ui/hint/port: the page copies it into its own $state. */
  onChange(s: { ui: PreviewUi; port: number | null; hint: string }): void;
}

export const POLL_MS = 1500;
/** Hard cap on how long we keep quietly retrying when the API cannot be reached at all. */
export const QUIET_CAP_MS = 90_000;

export class PreviewController {
  // Plain fields (unit-testable without the Svelte compiler); the page mirrors them through hooks.onChange.
  ui: PreviewUi = "idle";
  port: number | null = null;
  hint = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;
  private quietSince = 0;
  private wantReload = false;
  private disposed = false;

  constructor(
    private api: string,
    private workspaceId: string,
    private hooks: PreviewHooks,
    private fetcher: typeof fetch = (...a) => fetch(...a),
    private pollMs = POLL_MS,
  ) {}

  /** Idempotent: one request at a time; `reload` marks a turn-end refresh. */
  ensure(opts: { retry?: boolean; reload?: boolean } = {}): Promise<void> {
    if (opts.reload) this.wantReload = true;
    if (opts.retry) { this.ui = "starting"; this.hint = ""; this.emit(); }
    if (this.inflight) return this.inflight;
    return (this.inflight = this.once(opts.retry === true).finally(() => { this.inflight = null; this.emit(); }));
  }

  private async once(retry: boolean) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    let ans: EnsureAnswer | null = null;
    try {
      const r = await this.fetcher(`${this.api}/api/playgrounds/${this.workspaceId}/preview/ensure`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ retry }),
      });
      if (r.ok) ans = (await r.json()) as EnsureAnswer;
    } catch { /* quiet: treated like "not yet" below */ }
    if (this.disposed) return;

    if (!ans) {
      // Could not ask (API restarting, brief 5xx...). Stay quiet while we were already waiting; give up after the cap.
      if (this.ui === "starting") {
        this.quietSince ||= Date.now();
        if (Date.now() - this.quietSince > QUIET_CAP_MS) this.fail("We could not reach your site. Try Retry, or open a terminal and start it there.");
        else this.schedule();
      }
      return;
    }
    this.quietSince = 0;
    if (typeof ans.port === "number") { this.port = ans.port; this.hooks.onPort(ans.port); }
    const reload = this.wantReload; this.wantReload = false;
    switch (ans.state) {
      case "ready":
        this.ui = "ready"; this.hint = "";
        if (this.port) this.hooks.onReady(this.port, reload);
        return;
      case "starting":
        if (this.ui !== "starting") this.hooks.onNotReady();
        this.ui = "starting"; this.hint = ""; this.schedule(); return;
      case "failed":
        this.hooks.onNotReady();
        this.fail(ans.hint ?? "Your site did not start."); return;
      case "not-web":
        this.hooks.onNotReady();
        this.ui = "not-web"; this.hint = ""; return;
    }
  }

  private emit() { this.hooks.onChange({ ui: this.ui, port: this.port, hint: this.hint }); }
  private fail(hint: string) { this.ui = "failed"; this.hint = hint; }
  private schedule() {
    if (this.disposed) return;
    this.timer = setTimeout(() => { this.timer = null; void this.ensure(); }, this.pollMs);
  }
  dispose() { this.disposed = true; if (this.timer) clearTimeout(this.timer); }
}
