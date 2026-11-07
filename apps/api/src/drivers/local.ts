import type { ExecDriver, TerminalHandle } from "./types";

const ROOT =
  process.env.PLAYGROUND_ROOT ?? "/tmp/labs-playgrounds";
const RING_MAX = 50 * 1024; // 50KB WS replay ring (plan.md T4.2)

/** One persistent shell: long-lived bash + output ring + subscribers. */
class Shell {
  proc: ReturnType<typeof Bun.spawn>;
  ring = "";
  subs = new Set<(d: string) => void>();
  decoder = new TextDecoder();
  encoder = new TextEncoder();

  constructor(public workspaceDir: string) {
    // Login-less bash with workspace as cwd. stdio piped; stderr merged
    // so full-screen tools degrade to line output (documented limit of
    // the local stand-in; gVisor driver gives a real PTY).
    this.proc = Bun.spawn(["bash", "--noprofile", "--norc", "-i"], {
      cwd: workspaceDir,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, TERM: "xterm-256color", PS1: "\\u@playground:\\w$ " },
    });
    this.pump();
  }

  private emit(text: string) {
    this.ring = (this.ring + text).slice(-RING_MAX);
    for (const cb of this.subs) cb(text);
  }

  private watch(stream: unknown) {
    if (!stream || typeof stream === "number") return;
    const reader = (stream as ReadableStream<Uint8Array>).getReader();
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          this.emit(this.decoder.decode(value, { stream: true }));
        }
      } catch {
        /* process exited */
      }
    })();
  }

  private pump() {
    this.watch(this.proc.stdout);
    this.watch(this.proc.stderr);
  }

  write(data: string) {
    const stdin = this.proc.stdin as unknown as
      | { write: (c: Uint8Array) => void }
      | null
      | number;
    if (!stdin || typeof stdin === "number") return;
    try {
      stdin.write(this.encoder.encode(data));
    } catch {
      /* shell gone */
    }
  }

  kill() {
    try {
      this.proc.kill();
    } catch {
      /* already gone */
    }
  }
}

/**
 * Local stand-in for the gVisor driver: same interface, real processes.
 * Drop-in note: GvisorDriver will claim a SandboxClaim(runsc) per session
 * and exec via sandboxd; everything above (routes, WS relay, quotas)
 * stays unchanged.
 */
export class LocalDriver implements ExecDriver {
  readonly backend = "local" as const;
  private shells = new Map<string, Shell>(); // `${sessionId}/${termId}`

  private dir(sessionId: string) {
    return `${ROOT}/${sessionId}/workspace`;
  }

  async create(sessionId: string) {
    const dir = this.dir(sessionId);
    await Bun.$`mkdir -p ${dir}`.quiet();
    await Bun.$`sh -c ${`printf '# playground workspace\n' > '${dir}/README.md'`}`.quiet();
    return { workspaceDir: dir };
  }

  async openTerminal(sessionId: string, termId: string): Promise<TerminalHandle> {
    const key = `${sessionId}/${termId}`;
    let shell = this.shells.get(key);
    if (!shell) {
      await this.create(sessionId); // idempotent
      shell = new Shell(this.dir(sessionId));
      this.shells.set(key, shell);
    }
    const s = shell;
    return {
      termId,
      write: (d) => s.write(d),
      onData: (cb) => {
        s.subs.add(cb);
        // Replay scrollback so refresh/reconnect restores view.
        if (s.ring) cb(s.ring);
        return () => {
          s.subs.delete(cb);
        };
      },
      scrollback: () => s.ring,
      kill: () => {
        s.kill();
        this.shells.delete(key);
      },
    };
  }

  async run(sessionId: string, cmd: string, opts?: { timeoutMs?: number }) {
    const dir = this.dir(sessionId);
    await this.create(sessionId);
    const timeout = opts?.timeoutMs ?? 30_000;
    const proc = Bun.spawn(["bash", "-c", cmd], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* done */
      }
    }, timeout);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    return { stdout, stderr, exitCode };
  }

  async snapshotTar(sessionId: string): Promise<ReadableStream<Uint8Array>> {
    const dir = this.dir(sessionId);
    await this.create(sessionId);
    // GNU tar to stdout; stream bytes straight to the response.
    const proc = Bun.spawn(["tar", "-czf", "-", "-C", dir, "."], {
      stdout: "pipe",
      stderr: "ignore",
    });
    return proc.stdout as unknown as ReadableStream<Uint8Array>;
  }

  async destroy(sessionId: string): Promise<void> {
    for (const [key, shell] of this.shells) {
      if (key.startsWith(`${sessionId}/`)) {
        shell.kill();
        this.shells.delete(key);
      }
    }
    await Bun.$`rm -rf ${ROOT}/${sessionId}`.quiet();
  }
}

/** Singleton: one driver per API process (matches SandboxWarmPool shape). */
export const driver: ExecDriver = new LocalDriver();
