/**
 * ExecDriver interface (spec #30). v1 backends: Docker + gVisor on a single
 * VPS ("docker-gvisor"); LocalDriver ("local") is the dev stand-in with
 * identical semantics, enforced by the shared contract suite. KubeVirt/k3s
 * are deferred (see spec #30).
 */

import type { ImportInput, TransferResult } from "../transfer";

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

export interface CreateOpts {
  seedFiles?: { path: string; content: string }[];
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
  /**
   * Provision workspace + first shell for a playground id. `seedFiles` (workspace-relative) are written
   * only when absent and BEFORE the starter snapshot, so they are part of the baseline (diff/reset treat
   * them as untouched). Ignored when the workspace already exists.
   */
  create(sessionId: string, opts?: CreateOpts): Promise<{ workspaceDir: string }>;
  /** The port the Preview panel expects the student's web app on (Docker: always 3000; local: a free port per workspace, since local workspaces share the host network). */
  previewPort(sessionId: string): Promise<number>;
  /** Open (or reattach to) a named terminal in the session. */
  openTerminal(sessionId: string, termId: string): Promise<TerminalHandle>;
  /** Kill a named terminal's shell if it exists. Idempotent; never creates one. */
  closeTerminal(sessionId: string, termId: string): Promise<void>;
  /** Run a one-shot command, capture output (check/solve scripts). */
  run(sessionId: string, cmd: string, opts?: { timeoutMs?: number; stdin?: string }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
  /**
   * Write private files under the learner's home (paths relative to it, e.g.
   * ".local/share/opencode/auth.json"). Contents never appear in argv; files are
   * mode 0600 and persist with the workspace (survive hibernate/wake).
   */
  injectCredentials(sessionId: string, files: { path: string; content: string }[]): Promise<void>;
  /** Zip of a workspace folder (default: all) as a byte stream; skips node_modules/.git etc. unless heavy. */
  archiveZip(sessionId: string, sub?: string, opts?: { heavy?: boolean }): Promise<ReadableStream<Uint8Array>>;
  /** Raw bytes of one workspace file (binary-safe download). */
  readBytes(sessionId: string, path: string): Promise<ReadableStream<Uint8Array>>;
  /** Write uploaded files (or extract a zip) under `dest`. Enforces count/size caps and path safety; throws with a human message. */
  importUpload(sessionId: string, dest: string, input: ImportInput): Promise<TransferResult>;
  /** Stream a workspace tarball (snapshot download). */
  snapshotTar(sessionId: string): Promise<ReadableStream<Uint8Array>>;
  /** File tree under workspace (relative paths, traversal-guarded). */
  /** Recursive listing (dotfiles hidden, heavy dirs not entered), for tree/search/change tracking. */
  walkFiles(sessionId: string): Promise<{ entries: import("./walk").WalkEntry[]; truncated: boolean }>;
  listFiles(sessionId: string, sub?: string): Promise<{ path: string; type: "file" | "dir"; size?: number }[]>;
  readFile(sessionId: string, path: string): Promise<{ content: string; truncated: boolean }>;
  writeFile(sessionId: string, path: string, content: string): Promise<{ bytes: number }>;
  /** Delete a file or directory inside the workspace (never the workspace root). */
  deletePath(sessionId: string, path: string): Promise<void>;
  /** Move/rename inside the workspace. Fails if the target exists or either path escapes. */
  renamePath(sessionId: string, from: string, to: string): Promise<void>;
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
  /**
   * Start the headless OpenCode server (`opencode serve`) for a workspace: same
   * user and working directory as the terminal agent, same HOME (so the same
   * injected seat key and config). Idempotent: if one is already running it is
   * left alone (the password argument is then ignored) and its address returned.
   * `password` becomes OPENCODE_SERVER_PASSWORD; it must never reach argv or logs.
   * The port is never published on the host; the address is only meaningful to the API.
   */
  startAgentServer(sessionId: string, password: string): Promise<WorkspaceAddress>;
  /** Address of the agent server's process if it is alive, else null. Does not start anything. */
  agentServerAddress(sessionId: string): Promise<WorkspaceAddress | null>;
  /** Kill the agent server if running. Idempotent. */
  stopAgentServer(sessionId: string): Promise<void>;
  /** Ids of every workspace the backend currently holds (running or hibernated). */
  list(): Promise<string[]>;
  /** Destroy workspace + shells. */
  destroy(sessionId: string): Promise<void>;
}
