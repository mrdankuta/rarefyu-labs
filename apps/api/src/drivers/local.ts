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

  constructor(public workspaceDir: string) {
    // Real PTY (Bun terminal): job control, Ctrl-C/Z, full-screen tools.
    // stdout/stderr are merged on the pty. The gVisor driver does the same
    // via sandboxd exec with a tty.
    this.proc = Bun.spawn(["bash", "--noprofile", "--norc", "-i"], {
      cwd: workspaceDir,
      env: { ...process.env, TERM: "xterm-256color", PS1: "\\u@playground:\\w$ " },
      terminal: {
        cols: 80,
        rows: 24,
        data: (_t: unknown, d: Uint8Array) => this.emit(this.decoder.decode(d, { stream: true })),
      },
    });
  }

  private emit(text: string) {
    this.ring = (this.ring + text).slice(-RING_MAX);
    for (const cb of this.subs) cb(text);
  }

  write(data: string) {
    try {
      this.proc.terminal?.write(data);
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
    if (!(await Bun.file(`${dir}/README.md`).exists())) {
      await Bun.write(`${dir}/README.md`, "# playground workspace\n");
    }
    // Starter snapshot at creation — before any learner edit (diff/reset baseline).
    const starter = this.starterDir(sessionId);
    if (!(await Bun.file(`${starter}/.starter-ok`).exists())) {
      await Bun.$`rm -rf ${starter}`.quiet();
      await Bun.$`cp -a ${dir} ${starter}`.quiet();
      await Bun.write(`${starter}/.starter-ok`, "1");
    }
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

  // --- Files (issue #5) ---
  private starterDir(sessionId: string) {
    return `${ROOT}/${sessionId}/starter`;
  }

  /** Guard: resolve sub-path strictly inside the workspace. */
  private resolve(sessionId: string, rel: string): string {
    if (rel.includes("\0")) throw new Error("invalid path");
    const base = this.dir(sessionId);
    const abs = rel ? `${base}/${rel}` : base;
    const norm = abs.split("/").reduce<string[]>((acc, seg) => {
      if (seg === "" || seg === ".") return acc;
      if (seg === "..") acc.pop();
      else acc.push(seg);
      return acc;
    }, []).join("/");
    const full = `/${norm}`;
    if (full !== base && !full.startsWith(`${base}/`))
      throw new Error("path escapes workspace");
    return full;
  }

  private async ensureStarter(sessionId: string) {
    await this.create(sessionId); // create() owns the starter snapshot
  }

  async listFiles(sessionId: string, sub = "") {
    await this.create(sessionId);
    const dir = this.resolve(sessionId, sub);
    // `ls -p` marks dirs with trailing `/`; dotfiles (incl. starter state) hidden.
    const proc = Bun.spawn(["ls", "-p", dir], { stdout: "pipe", stderr: "pipe" });
    const [text, errText, code] = await Promise.all([
      new Response(proc.stdout as unknown as ReadableStream).text(),
      new Response(proc.stderr as unknown as ReadableStream).text(),
      proc.exited,
    ]);
    if (code !== 0) throw new Error(errText.trim() || "cannot list directory");
    const out: { path: string; type: "file" | "dir"; size?: number }[] = [];
    for (const line of text.split("\n")) {
      const name = line.trim();
      if (!name || name.startsWith(".")) continue;
      const isDir = name.endsWith("/");
      const clean = isDir ? name.slice(0, -1) : name;
      const f = Bun.file(`${dir}/${clean}`);
      out.push({
        path: sub ? `${sub}/${clean}` : clean,
        type: isDir ? "dir" : "file",
        size: isDir ? undefined : f.size,
      });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async readFile(sessionId: string, path: string) {
    const full = this.resolve(sessionId, path);
    const f = Bun.file(full);
    if (!(await f.exists())) throw new Error("file not found");
    const MAX = 256 * 1024;
    if (f.size > MAX) {
      return { content: await f.slice(0, MAX).text(), truncated: true };
    }
    const buf = await f.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.includes(0)) throw new Error("binary file — preview not supported");
    return { content: new TextDecoder().decode(bytes), truncated: false };
  }

  async writeFile(sessionId: string, path: string, content: string) {
    if (content.length > 1024 * 1024) throw new Error("file too large (1MB cap)");
    const full = this.resolve(sessionId, path);
    await this.create(sessionId);
    await Bun.write(full, content);
    return { bytes: new TextEncoder().encode(content).length };
  }

  async diffFile(sessionId: string, path: string): Promise<string> {
    await this.ensureStarter(sessionId);
    const cur = this.resolve(sessionId, path);
    const old = `${this.starterDir(sessionId)}/${path}`;
    if (!(await Bun.file(old).exists()) && !(await Bun.file(cur).exists()))
      throw new Error("file not found");
    const oldExists = await Bun.file(old).exists();
    const proc = Bun.spawn(["diff", "-u", "--label", `a/${path}`, "--label", `b/${path}`, oldExists ? old : "/dev/null", cur], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const text = await new Response(proc.stdout as unknown as ReadableStream).text();
    await proc.exited;
    return text; // empty = identical
  }

  async resetFile(sessionId: string, path: string): Promise<void> {
    await this.ensureStarter(sessionId);
    const old = `${this.starterDir(sessionId)}/${path}`;
    if (!(await Bun.file(old).exists())) throw new Error("no starter version — cannot reset");
    const cur = this.resolve(sessionId, path);
    await Bun.$`cp ${old} ${cur}`.quiet();
  }

  async resetProject(sessionId: string): Promise<void> {
    await this.ensureStarter(sessionId);
    const dir = this.dir(sessionId);
    const starter = this.starterDir(sessionId);
    // Restore every starter entry; remove workspace files not in starter.
    await Bun.$`sh -c ${`cd '${dir}' && find . -mindepth 1 -maxdepth 1 -exec rm -rf {} + && cp -a '${starter}/.' '${dir}/' && rm -f '${dir}/.starter-ok'`}`.quiet();
  }
}

/** Singleton: one driver per API process (matches SandboxWarmPool shape). */
export const driver: ExecDriver = new LocalDriver();
