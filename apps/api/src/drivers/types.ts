/**
 * ExecDriver interface — workspace-spec §6 step 1.
 * v1 backends: gvisor (runsc SandboxClaim) → LocalDriver here as the
 * dev/bench stand-in with identical semantics (workspace dir, tmux-persistent
 * shells, snapshot tarball). KubeVirt driver arrives in slice 6 (#7).
 */

export interface TerminalHandle {
  termId: string;
  /** Write user input (keystrokes) to the shell. */
  write(data: string): void;
  /** Subscribe to output chunks. Returns unsubscribe. */
  onData(cb: (data: string) => void): () => void;
  /** Current scrollback (replay on reattach, 50KB ring). */
  scrollback(): string;
  kill(): void;
}

export interface ExecDriver {
  readonly backend: "gvisor" | "kubevirt" | "kata-fc" | "local";
  /** Provision workspace + first shell for a playground id. */
  create(sessionId: string): Promise<{ workspaceDir: string }>;
  /** Open (or reattach to) a named terminal in the session. */
  openTerminal(sessionId: string, termId: string): Promise<TerminalHandle>;
  /** Run a one-shot command, capture output (check/solve scripts). */
  run(sessionId: string, cmd: string, opts?: { timeoutMs?: number }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
  /** Stream a workspace tarball (snapshot download). */
  snapshotTar(sessionId: string): Promise<ReadableStream<Uint8Array>>;
  /** Destroy workspace + shells. */
  destroy(sessionId: string): Promise<void>;
}
