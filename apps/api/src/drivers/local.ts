import { walkArgs, parseWalk } from "./walk";
import { frameFiles, parseTransferResult, type ImportInput, type TransferResult } from "../transfer";
import { assertHomeRel, resolveInside } from "./paths";
import { agentServerConfigJson } from "../agent-policy";
import type { CreateOpts, DriverCapabilities, ExecDriver, TerminalHandle, WorkspaceAddress } from "./types";

const ROOT =
  process.env.PLAYGROUND_ROOT ?? "/tmp/labs-playgrounds";
/** The same helper the lab image ships; found in the repo checkout when not on PATH. */
const TRANSFER =
  process.env.LAB_TRANSFER ?? new URL("../../../../images/base-lab/lab-transfer", import.meta.url).pathname;
const RING_MAX = 50 * 1024; // 50KB WS replay ring (plan.md T4.2)

/** One persistent shell: long-lived bash + output ring + subscribers. */
class Shell {
  proc: ReturnType<typeof Bun.spawn>;
  ring = "";
  subs = new Set<(d: string) => void>();
  decoder = new TextDecoder();

  constructor(public workspaceDir: string, home?: string) {
    // Real PTY (Bun terminal): job control, Ctrl-C/Z, full-screen tools.
    // stdout/stderr are merged on the pty. The gVisor driver does the same
    // via sandboxd exec with a tty.
    this.proc = Bun.spawn(["bash", "--noprofile", "--norc", "-i"], {
      cwd: workspaceDir,
      env: { ...process.env, ...(home ? { HOME: home } : {}), TERM: "xterm-256color", PS1: "\\u@playground:\\w$ " },
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

  resize(cols: number, rows: number) {
    try {
      this.proc.terminal?.resize(cols, rows);
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
  private servicePorts = new Map<string, number>();
  private previewPorts = new Map<string, number>();
  private agents = new Map<string, { proc: ReturnType<typeof Bun.spawn>; port: number }>();
  /** argv prefix for the OpenCode binary (OPENCODE_BIN overrides; tests point it at a stub). */
  private opencode: string[];

  constructor(opts: { opencodeBin?: string[] } = {}) {
    this.opencode = opts.opencodeBin ?? [process.env.OPENCODE_BIN ?? "opencode"];
  }

  private dir(sessionId: string) {
    return `${ROOT}/${sessionId}/workspace`;
  }

  /** Per-session HOME, used only once credentials were injected (dev stand-in: no isolation). */
  private home(sessionId: string) {
    return `${ROOT}/${sessionId}/home`;
  }
  private async homeIfInjected(sessionId: string) {
    const h = this.home(sessionId);
    return (await Bun.file(`${h}/.injected`).exists()) ? h : undefined;
  }

  async injectCredentials(sessionId: string, files: { path: string; content: string }[]) {
    await this.create(sessionId);
    const home = this.home(sessionId);
    for (const f of files) {
      assertHomeRel(f.path);
      const full = `${home}/${f.path}`;
      await Bun.$`mkdir -p ${full.slice(0, full.lastIndexOf("/"))}`.quiet();
      await Bun.write(full, f.content);
      await Bun.$`chmod 600 ${full}`.quiet();
    }
    // Same layout as the Docker driver: the workspace is ~/workspace.
    await Bun.$`ln -sfn ../workspace ${home}/workspace`.quiet();
    await Bun.write(`${home}/.injected`, "1");
  }

  async previewPort(sessionId: string): Promise<number> {
    const known = this.previewPorts.get(sessionId);
    if (known) return known;
    const file = `${ROOT}/${sessionId}/preview-port`;
    const saved = Number((await Bun.file(file).exists()) ? await Bun.file(file).text() : 0);
    if (Number.isInteger(saved) && saved > 0) { this.previewPorts.set(sessionId, saved); return saved; }
    const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const p: number = probe.port;
    probe.stop(true);
    await Bun.$`mkdir -p ${ROOT}/${sessionId}`.quiet();
    await Bun.write(file, String(p));
    this.previewPorts.set(sessionId, p);
    return p;
  }

  async create(sessionId: string, opts: CreateOpts = {}) {
    const dir = this.dir(sessionId);
    await Bun.$`mkdir -p ${dir}`.quiet();
    if (!(await Bun.file(`${dir}/README.md`).exists())) {
      await Bun.write(`${dir}/README.md`, "# playground workspace\n");
    }
    // Starter snapshot at creation — before any learner edit (diff/reset baseline).
    const starter = this.starterDir(sessionId);
    if (!(await Bun.file(`${starter}/.starter-ok`).exists())) {
      for (const f of opts.seedFiles ?? []) {
        assertHomeRel(f.path); // same guard: relative, no "..", no empty parts
        const full = `${dir}/${f.path}`;
        if (await Bun.file(full).exists()) continue; // never overwrite what the student or lesson already has
        await Bun.$`mkdir -p ${full.slice(0, full.lastIndexOf("/"))}`.quiet();
        await Bun.write(full, f.content);
      }
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
      shell = new Shell(this.dir(sessionId), await this.homeIfInjected(sessionId));
      this.shells.set(key, shell);
    }
    const s = shell;
    return {
      termId,
      write: (d) => s.write(d),
      resize: (c, r) => s.resize(c, r),
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

  async closeTerminal(sessionId: string, termId: string): Promise<void> {
    const key = `${sessionId}/${termId}`;
    this.shells.get(key)?.kill();
    this.shells.delete(key);
  }

  async run(sessionId: string, cmd: string, opts?: { timeoutMs?: number; stdin?: string }) {
    const dir = this.dir(sessionId);
    await this.create(sessionId);
    const timeout = opts?.timeoutMs ?? 30_000;
    const home = await this.homeIfInjected(sessionId);
    const servicePort = await this.servicePort(sessionId);
    const proc = Bun.spawn(["bash", "-c", cmd], {
      cwd: dir,
      // live copy of the environment; OPENCODE_BIN lets commands find the binary this driver was built with
      env: { ...process.env, ...(home ? { HOME: home } : {}), OPENCODE_BIN: this.opencode[0]!, OPENCODE_SERVICE_PORT: String(servicePort) },
      stdin: opts?.stdin !== undefined ? new Blob([opts.stdin]) : "ignore",
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

  async archiveZip(sessionId: string, sub = "", opts?: { heavy?: boolean }): Promise<ReadableStream<Uint8Array>> {
    await this.create(sessionId);
    const proc = Bun.spawn(["python3", TRANSFER, this.dir(sessionId), "zip-out", sub || ".", ...(opts?.heavy ? ["--heavy"] : [])], {
      stdout: "pipe", stderr: "ignore", stdin: "ignore",
    });
    return proc.stdout as unknown as ReadableStream<Uint8Array>;
  }

  async readBytes(sessionId: string, path: string): Promise<ReadableStream<Uint8Array>> {
    await this.create(sessionId);
    const proc = Bun.spawn(["python3", TRANSFER, this.dir(sessionId), "cat", path], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    return proc.stdout as unknown as ReadableStream<Uint8Array>;
  }

  async importUpload(sessionId: string, dest: string, input: ImportInput): Promise<TransferResult> {
    await this.create(sessionId);
    const body = input.kind === "zip" ? input.data : frameFiles(input.files);
    const proc = Bun.spawn(["python3", TRANSFER, this.dir(sessionId), input.kind === "zip" ? "unzip" : "put", dest || "."], {
      stdin: new Blob([body as BlobPart]), stdout: "pipe", stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) throw new Error(err.trim() || "upload failed");
    return parseTransferResult(out);
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

  capabilities(): DriverCapabilities {
    return { isolation: "none", hibernate: true };
  }

  /**
   * OpenCode 2.x's CLI starts a "managed service" on ONE fixed host port (49374). Local workspaces
   * share the host network (containers do not), so each gets its own port, which commands that
   * touch the service apply with `opencode service set port "$OPENCODE_SERVICE_PORT"`.
   */
  private async servicePort(sessionId: string): Promise<number> {
    const known = this.servicePorts.get(sessionId);
    if (known) return known;
    const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const p: number = probe.port;
    probe.stop(true);
    this.servicePorts.set(sessionId, p);
    return p;
  }

  async startAgentServer(sessionId: string, password: string): Promise<WorkspaceAddress> {
    const cur = await this.agentServerAddress(sessionId);
    if (cur) return cur;
    await this.create(sessionId);
    // All local workspaces share the host's loopback, so each gets its own free port
    // (the Docker driver uses one fixed port per container).
    const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = probe.port;
    probe.stop(true);
    // Same HOME as the terminal when credentials were injected; otherwise an empty
    // per-session HOME so a dev machine's own OpenCode config/key is never picked up.
    const home = (await this.homeIfInjected(sessionId)) ?? this.home(sessionId);
    await Bun.$`mkdir -p ${home}`.quiet();
    const env: Record<string, string | undefined> = { ...process.env, HOME: home, OPENCODE_SERVER_PASSWORD: password };
    for (const k of Object.keys(env)) if (k.startsWith("XDG_") || (k.startsWith("OPENCODE_") && k !== "OPENCODE_SERVER_PASSWORD" && k !== "OPENCODE_CONFIG_CONTENT")) delete env[k];
    env.OPENCODE_CONFIG_CONTENT = agentServerConfigJson(); // workspace policy: see agent-policy.ts
    const proc = Bun.spawn([...this.opencode, "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: this.dir(sessionId),
      env,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    this.agents.set(sessionId, { proc, port });
    return { host: "127.0.0.1", port };
  }

  async agentServerAddress(sessionId: string): Promise<WorkspaceAddress | null> {
    const a = this.agents.get(sessionId);
    if (!a || a.proc.exitCode !== null || a.proc.killed) return null;
    return { host: "127.0.0.1", port: a.port };
  }

  async stopAgentServer(sessionId: string): Promise<void> {
    const a = this.agents.get(sessionId);
    this.agents.delete(sessionId);
    if (!a) return;
    try { a.proc.kill(); } catch { /* gone */ }
    await a.proc.exited;
  }

  async hibernate(sessionId: string): Promise<void> {
    await this.stopAgentServer(sessionId);
    for (const [key, shell] of this.shells) {
      if (key.startsWith(`${sessionId}/`)) {
        shell.kill();
        this.shells.delete(key);
      }
    }
  }

  async wake(sessionId: string): Promise<void> {
    // Shells are opened lazily by openTerminal; just make sure files exist.
    await this.create(sessionId);
  }

  async address(_sessionId: string, port: number): Promise<WorkspaceAddress> {
    return { host: "127.0.0.1", port };
  }

  async list(): Promise<string[]> {
    const r = await Bun.$`ls -1 ${ROOT}`.quiet().nothrow();
    return r.exitCode === 0 ? r.stdout.toString().split("\n").map((l: string) => l.trim()).filter(Boolean) : [];
  }

  async destroy(sessionId: string): Promise<void> {
    await this.stopAgentServer(sessionId);
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
    return resolveInside(this.dir(sessionId), rel);
  }

  private async ensureStarter(sessionId: string) {
    await this.create(sessionId); // create() owns the starter snapshot
  }

  async walkFiles(sessionId: string) {
    await this.create(sessionId);
    const root = this.resolve(sessionId, "");
    const proc = Bun.spawn(walkArgs("."), { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [text] = await Promise.all([new Response(proc.stdout as unknown as ReadableStream).text(), proc.exited]);
    return parseWalk(text);
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

  async deletePath(sessionId: string, path: string): Promise<void> {
    if (!path.replace(/\/+/g, "")) throw new Error("cannot delete the workspace root");
    const full = this.resolve(sessionId, path);
    if (full === this.dir(sessionId)) throw new Error("cannot delete the workspace root");
    const exists = (await Bun.$`test -e ${full}`.quiet().nothrow()).exitCode === 0;
    if (!exists) throw new Error("file not found");
    await Bun.$`rm -rf ${full}`.quiet();
  }

  async renamePath(sessionId: string, from: string, to: string): Promise<void> {
    const src = this.resolve(sessionId, from);
    const dst = this.resolve(sessionId, to);
    if (src === this.dir(sessionId) || dst === this.dir(sessionId)) throw new Error("cannot move the workspace root");
    if ((await Bun.$`test -e ${src}`.quiet().nothrow()).exitCode !== 0) throw new Error("file not found");
    if ((await Bun.$`test -e ${dst}`.quiet().nothrow()).exitCode === 0) throw new Error("target already exists");
    if (dst.startsWith(`${src}/`)) throw new Error("cannot move a folder into itself");
    await Bun.$`mkdir -p ${dst.slice(0, dst.lastIndexOf("/"))} && mv ${src} ${dst}`.quiet();
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
