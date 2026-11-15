/**
 * ExecDriver interface (spec #30). v1 backends: Docker + gVisor on a single
 * VPS ("docker-gvisor"); LocalDriver ("local") is the dev stand-in with
 * identical semantics, enforced by the shared contract suite. KubeVirt/k3s
 * are deferred (see spec #30).
 */

/** How strongly the backend isolates a workspace from the host. */
export type Isolation = "none" | "container" | "gvisor";

export interface DriverCapabilities {
  isolation: Isolation;
  /** Can the driver hibernate (stop) and wake a workspace keeping its files? */
  hibernate: boolean;
}

export interface WorkspaceAddress {
  host: string;
  port: number;
}

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
  readonly backend: "docker-gvisor" | "docker" | "local";
  /** What this backend guarantees; callers refuse weak isolation in production. */
  capabilities(): DriverCapabilities;
  /** Provision workspace + first shell for a playground id. */
  create(sessionId: string): Promise<{ workspaceDir: string }>;
  /** Open (or reattach to) a named terminal in the session. */
  openTerminal(sessionId: string, termId: string): Promise<TerminalHandle>;
  /** Kill a named terminal's shell if it exists. Idempotent; never creates one. */
  closeTerminal(sessionId: string, termId: string): Promise<void>;
  /** Run a one-shot command, capture output (check/solve scripts). */
  run(sessionId: string, cmd: string, opts?: { timeoutMs?: number }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
  /** Stream a workspace tarball (snapshot download). */
  snapshotTar(sessionId: string): Promise<ReadableStream<Uint8Array>>;
  /** File tree under workspace (relative paths, traversal-guarded). */
  listFiles(sessionId: string, sub?: string): Promise<{ path: string; type: "file" | "dir"; size?: number }[]>;
  readFile(sessionId: string, path: string): Promise<{ content: string; truncated: boolean }>;
  writeFile(sessionId: string, path: string, content: string): Promise<{ bytes: number }>;
  /** Unified diff of current vs starter snapshot; empty string = identical. */
  diffFile(sessionId: string, path: string): Promise<string>;
  resetFile(sessionId: string, path: string): Promise<void>;
  resetProject(sessionId: string): Promise<void>;
  /** Stop running processes/terminals but keep the workspace files. Idempotent. */
  hibernate(sessionId: string): Promise<void>;
  /** Bring a hibernated workspace back (files intact). Idempotent; no-op if running. */
  wake(sessionId: string): Promise<void>;
  /** Where a TCP port inside the workspace can be reached from the API (preview proxy). */
  address(sessionId: string, port: number): Promise<WorkspaceAddress>;
  /** Destroy workspace + shells. */
  destroy(sessionId: string): Promise<void>;
}
