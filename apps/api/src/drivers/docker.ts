import { walkArgs, parseWalk } from "./walk";
import { frameFiles, parseTransferResult, type ImportInput, type TransferResult } from "../transfer";
import { assertHomeRel, resolveInside } from "./paths";
import type { DriverCapabilities, ExecDriver, Isolation, TerminalHandle, WorkspaceAddress } from "./types";

const HOME = "/home/student";
const WORKSPACE = `${HOME}/workspace`;
const STARTER = `${HOME}/.starter`;
const RING_MAX = 50 * 1024;
const LABEL = "rfy.workspace";

export interface DockerDriverOptions {
  /** "docker-gvisor" requires the runsc runtime; "docker" is hardened runc (dev only). */
  backend?: "docker-gvisor" | "docker";
  image?: string;
  runtime?: string; // default "runsc" for docker-gvisor
  cpus?: string;
  memory?: string;
  pids?: number;
  /** Docker CLI binary. */
  bin?: string;
}

interface Out { stdout: string; stderr: string; exitCode: number }

/** One attached tmux client per terminal: bun pty running `docker exec -it ... tmux attach`. */
class Attach {
  proc: ReturnType<typeof Bun.spawn>;
  ring = "";
  subs = new Set<(d: string) => void>();
  decoder = new TextDecoder();
  constructor(argv: string[]) {
    this.proc = Bun.spawn(argv, {
      env: { ...process.env, TERM: "xterm-256color" },
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
    try { this.proc.terminal?.write(data); } catch { /* gone */ }
  }
  kill() {
    try { this.proc.kill(); } catch { /* gone */ }
  }
}

/**
 * Docker execution driver (spec #30): one hardened container per workspace,
 * its own network and home volume, tmux-persistent terminals. Talks to Docker
 * via the CLI; nothing above this module knows about containers.
 */
export class DockerDriver implements ExecDriver {
  readonly backend: "docker-gvisor" | "docker";
  private image: string;
  private runtime: string;
  private cpus: string;
  private memory: string;
  private pids: number;
  private bin: string;
  private attaches = new Map<string, Attach>(); // `${sessionId}/${termId}`
  private runtimeChecked: Promise<void> | null = null;

  constructor(opts: DockerDriverOptions = {}) {
    this.backend = opts.backend ?? "docker-gvisor";
    this.image = opts.image ?? process.env.LAB_IMAGE ?? "rarefyu/base-lab:dev";
    this.runtime = opts.runtime ?? process.env.DOCKER_RUNTIME ?? "runsc";
    this.cpus = opts.cpus ?? process.env.WORKSPACE_CPUS ?? "1";
    this.memory = opts.memory ?? process.env.WORKSPACE_MEMORY ?? "2g";
    this.pids = opts.pids ?? Number(process.env.WORKSPACE_PIDS ?? 512);
    this.bin = opts.bin ?? "docker";
  }

  capabilities(): DriverCapabilities {
    const isolation: Isolation = this.backend === "docker-gvisor" ? "gvisor" : "container";
    return { isolation, hibernate: true };
  }

  // --- docker CLI helpers ---
  private async docker(args: string[], opts?: { stdin?: Blob | string; timeoutMs?: number }): Promise<Out> {
    const proc = Bun.spawn([this.bin, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: opts?.stdin !== undefined ? new Blob([opts.stdin]) : "ignore",
    });
    const timer = opts?.timeoutMs
      ? setTimeout(() => { try { proc.kill(); } catch { /* done */ } }, opts.timeoutMs)
      : null;
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    if (timer) clearTimeout(timer);
    return { stdout, stderr, exitCode };
  }

  private async dockerBytes(args: string[]): Promise<{ bytes: Uint8Array; exitCode: number }> {
    const proc = Bun.spawn([this.bin, ...args], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const buf = await new Response(proc.stdout as ReadableStream).arrayBuffer();
    return { bytes: new Uint8Array(buf), exitCode: await proc.exited };
  }

  private cname(id: string) { return `rfy-${id}`; }
  private nname(id: string) { return `rfy-${id}`; }
  private vname(id: string) { return `rfy-${id}-home`; }

  /** Refuse weak isolation: gvisor backend needs the runsc runtime registered. */
  private async assertRuntime() {
    if (this.backend !== "docker-gvisor") return;
    this.runtimeChecked ??= (async () => {
      const r = await this.docker(["info", "--format", "{{json .Runtimes}}"]);
      if (r.exitCode !== 0 || !r.stdout.includes(`"${this.runtime}"`)) {
        this.runtimeChecked = null;
        throw new Error(
          `gVisor runtime "${this.runtime}" is not registered with Docker; refusing to create a workspace with weaker isolation`,
        );
      }
    })();
    await this.runtimeChecked;
  }

  private async state(id: string): Promise<"running" | "stopped" | "missing"> {
    const r = await this.docker(["inspect", "--format", "{{.State.Running}}", this.cname(id)]);
    if (r.exitCode !== 0) return "missing";
    return r.stdout.trim() === "true" ? "running" : "stopped";
  }

  /** Exec a command (argv, no shell) inside the workspace container. */
  private exec(id: string, argv: string[], opts?: { stdin?: Blob | string; timeoutMs?: number; cwd?: string }) {
    return this.docker(["exec", ...(opts?.stdin !== undefined ? ["-i"] : []), "-w", opts?.cwd ?? WORKSPACE, this.cname(id), ...argv], opts);
  }

  private async ensureRunning(id: string) {
    const st = await this.state(id);
    if (st === "running") return;
    if (st === "stopped") {
      const r = await this.docker(["start", this.cname(id)]);
      if (r.exitCode !== 0) throw new Error(`cannot start workspace: ${r.stderr.trim()}`);
      return;
    }
    await this.create(id);
  }

  async create(sessionId: string) {
    const st = await this.state(sessionId);
    if (st === "running") return { workspaceDir: WORKSPACE };
    if (st === "stopped") { await this.ensureRunning(sessionId); return { workspaceDir: WORKSPACE }; }
    await this.assertRuntime();
    const labels = ["--label", `${LABEL}=${sessionId}`];
    const net = await this.docker(["network", "create", ...labels, this.nname(sessionId)]);
    if (net.exitCode !== 0 && !net.stderr.includes("already exists")) throw new Error(`network: ${net.stderr.trim()}`);
    const vol = await this.docker(["volume", "create", ...labels, this.vname(sessionId)]);
    if (vol.exitCode !== 0) throw new Error(`volume: ${vol.stderr.trim()}`);
    const run = await this.docker([
      "run", "-d", "--name", this.cname(sessionId), "--hostname", "playground", ...labels,
      "--network", this.nname(sessionId),
      ...(this.backend === "docker-gvisor" ? ["--runtime", this.runtime] : []),
      "--user", "1001:1001",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--pids-limit", String(this.pids), "--memory", this.memory, "--cpus", this.cpus,
      "--read-only", "--tmpfs", "/tmp:exec,size=512m",
      "-v", `${this.vname(sessionId)}:${HOME}`,
      "-e", "TERM=xterm-256color", "-e", `PS1=\\u@playground:\\w$ `,
      this.image, "sleep", "infinity",
    ]);
    if (run.exitCode !== 0) {
      await this.destroy(sessionId);
      throw new Error(`cannot start workspace: ${run.stderr.trim()}`);
    }
    // Seed workspace + starter snapshot (diff/reset baseline) before any learner edit.
    const seed = await this.exec(sessionId, ["sh", "-c",
      `mkdir -p ${WORKSPACE} && cd ${WORKSPACE} && { [ -f README.md ] || echo "# playground workspace" > README.md; } &&
       if [ ! -f ${STARTER}/.starter-ok ]; then rm -rf ${STARTER} && cp -a ${WORKSPACE} ${STARTER} && touch ${STARTER}/.starter-ok; fi`,
    ], { cwd: HOME });
    if (seed.exitCode !== 0) {
      await this.destroy(sessionId);
      throw new Error(`cannot seed workspace: ${seed.stderr.trim()}`);
    }
    return { workspaceDir: WORKSPACE };
  }

  // --- terminals: tmux session per termId, attached through a host-side pty ---
  private tmuxName(termId: string) { return `t-${termId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40)}`; }

  async openTerminal(sessionId: string, termId: string): Promise<TerminalHandle> {
    const key = `${sessionId}/${termId}`;
    let a = this.attaches.get(key);
    if (!a) {
      await this.ensureRunning(sessionId);
      a = new Attach([
        this.bin, "exec", "-it", "-w", WORKSPACE, this.cname(sessionId),
        "tmux", "new-session", "-A", "-s", this.tmuxName(termId), ";", "set-option", "status", "off", ";", "set-option", "-s", "escape-time", "0",
      ]);
      this.attaches.set(key, a);
    }
    const s = a;
    return {
      termId,
      write: (d) => s.write(d),
      onData: (cb) => {
        s.subs.add(cb);
        if (s.ring) cb(s.ring);
        return () => { s.subs.delete(cb); };
      },
      scrollback: () => s.ring,
      kill: () => { void this.closeTerminal(sessionId, termId); },
    };
  }

  async closeTerminal(sessionId: string, termId: string): Promise<void> {
    const key = `${sessionId}/${termId}`;
    this.attaches.get(key)?.kill();
    this.attaches.delete(key);
    if ((await this.state(sessionId)) === "running") {
      await this.exec(sessionId, ["tmux", "kill-session", "-t", this.tmuxName(termId)]);
    }
  }

  private dropAttaches(sessionId: string) {
    for (const [key, a] of this.attaches) {
      if (key.startsWith(`${sessionId}/`)) { a.kill(); this.attaches.delete(key); }
    }
  }

  async run(sessionId: string, cmd: string, opts?: { timeoutMs?: number }) {
    await this.ensureRunning(sessionId);
    const secs = Math.max(1, Math.ceil((opts?.timeoutMs ?? 30_000) / 1000));
    const r = await this.exec(sessionId, ["timeout", "-k", "1", String(secs), "bash", "-c", cmd], {
      timeoutMs: (opts?.timeoutMs ?? 30_000) + 5000,
    });
    return r;
  }

  async archiveZip(sessionId: string, sub = "", opts?: { heavy?: boolean }): Promise<ReadableStream<Uint8Array>> {
    await this.ensureRunning(sessionId);
    const proc = Bun.spawn(
      [this.bin, "exec", this.cname(sessionId), "lab-transfer", WORKSPACE, "zip-out", sub || ".", ...(opts?.heavy ? ["--heavy"] : [])],
      { stdout: "pipe", stderr: "ignore", stdin: "ignore" },
    );
    return proc.stdout as unknown as ReadableStream<Uint8Array>;
  }

  async readBytes(sessionId: string, path: string): Promise<ReadableStream<Uint8Array>> {
    await this.ensureRunning(sessionId);
    const proc = Bun.spawn([this.bin, "exec", this.cname(sessionId), "lab-transfer", WORKSPACE, "cat", path], {
      stdout: "pipe", stderr: "ignore", stdin: "ignore",
    });
    return proc.stdout as unknown as ReadableStream<Uint8Array>;
  }

  async importUpload(sessionId: string, dest: string, input: ImportInput): Promise<TransferResult> {
    await this.ensureRunning(sessionId);
    const body = input.kind === "zip" ? input.data : frameFiles(input.files);
    const r = await this.exec(sessionId, ["lab-transfer", WORKSPACE, input.kind === "zip" ? "unzip" : "put", dest || "."], {
      stdin: new Blob([body as BlobPart]),
      timeoutMs: 120_000,
    });
    if (r.exitCode !== 0) throw new Error(r.stderr.trim() || "upload failed");
    return parseTransferResult(r.stdout);
  }

  async snapshotTar(sessionId: string): Promise<ReadableStream<Uint8Array>> {
    await this.ensureRunning(sessionId);
    const proc = Bun.spawn(
      [this.bin, "exec", this.cname(sessionId), "tar", "-czf", "-", "-C", WORKSPACE, "."],
      { stdout: "pipe", stderr: "ignore", stdin: "ignore" },
    );
    return proc.stdout as unknown as ReadableStream<Uint8Array>;
  }

  // --- lifecycle ---
  async hibernate(sessionId: string): Promise<void> {
    this.dropAttaches(sessionId);
    if ((await this.state(sessionId)) === "running") await this.docker(["stop", "-t", "2", this.cname(sessionId)]);
  }

  async wake(sessionId: string): Promise<void> {
    await this.ensureRunning(sessionId);
  }

  async address(sessionId: string, port: number): Promise<WorkspaceAddress> {
    await this.ensureRunning(sessionId);
    const r = await this.docker([
      "inspect", "--format", `{{(index .NetworkSettings.Networks "${this.nname(sessionId)}").IPAddress}}`, this.cname(sessionId),
    ]);
    const host = r.stdout.trim();
    if (r.exitCode !== 0 || !host) throw new Error("workspace has no network address");
    return { host, port };
  }

  async list(): Promise<string[]> {
    // Any resource carrying our label counts: a half-created workspace (network/volume only) is still ours.
    const ids = new Set<string>();
    for (const [kind, fmt] of [
      [["ps", "-a"], '{{.Label "rfy.workspace"}}'],
      [["volume", "ls"], '{{.Label "rfy.workspace"}}'],
      [["network", "ls"], '{{.Label "rfy.workspace"}}'],
    ] as const) {
      const r = await this.docker([...kind, "--filter", `label=${LABEL}`, "--format", fmt]);
      for (const l of r.stdout.split("\n")) if (l.trim()) ids.add(l.trim());
    }
    return [...ids];
  }

  async destroy(sessionId: string): Promise<void> {
    this.dropAttaches(sessionId);
    await this.docker(["rm", "-f", this.cname(sessionId)]);
    await this.docker(["network", "rm", this.nname(sessionId)]);
    await this.docker(["volume", "rm", "-f", this.vname(sessionId)]);
  }

  // --- files ---
  private resolve(rel: string) { return resolveInside(WORKSPACE, rel); }

  async walkFiles(sessionId: string) {
    await this.ensureRunning(sessionId);
    const r = await this.exec(sessionId, walkArgs(this.resolve("")));
    if (r.exitCode !== 0 && !r.stdout) throw new Error(r.stderr.trim() || "cannot list workspace");
    return parseWalk(r.stdout);
  }

  async listFiles(sessionId: string, sub = "") {
    await this.ensureRunning(sessionId);
    const dir = this.resolve(sub);
    const r = await this.exec(sessionId, ["ls", "-pA", "--", dir]);
    if (r.exitCode !== 0) throw new Error(r.stderr.trim() || "cannot list directory");
    const out: { path: string; type: "file" | "dir"; size?: number }[] = [];
    const names = r.stdout.split("\n").map((l) => l.trim()).filter((n) => n && !n.startsWith("."));
    const files = names.filter((n) => !n.endsWith("/"));
    const sizes = new Map<string, number>();
    if (files.length) {
      const st = await this.exec(sessionId, ["stat", "-c", "%s\t%n", "--", ...files.map((f) => `${dir}/${f}`)]);
      for (const line of st.stdout.split("\n")) {
        const [size, ...p] = line.split("\t");
        if (p.length) sizes.set(p.join("\t").split("/").pop()!, Number(size));
      }
    }
    for (const name of names) {
      const isDir = name.endsWith("/");
      const clean = isDir ? name.slice(0, -1) : name;
      out.push({ path: sub ? `${sub}/${clean}` : clean, type: isDir ? "dir" : "file", size: isDir ? undefined : sizes.get(clean) });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async readFile(sessionId: string, path: string) {
    await this.ensureRunning(sessionId);
    const full = this.resolve(path);
    const MAX = 256 * 1024;
    const exists = await this.exec(sessionId, ["test", "-f", full]);
    if (exists.exitCode !== 0) throw new Error("file not found");
    const sz = await this.exec(sessionId, ["wc", "-c", full]);
    const size = Number(sz.stdout.trim().split(/\s+/)[0]);
    const { bytes } = await this.dockerBytes(["exec", this.cname(sessionId), "head", "-c", String(MAX), full]);
    if (size > MAX) return { content: new TextDecoder().decode(bytes), truncated: true };
    if (bytes.includes(0)) throw new Error("binary file — preview not supported");
    return { content: new TextDecoder().decode(bytes), truncated: false };
  }

  async injectCredentials(sessionId: string, files: { path: string; content: string }[]) {
    await this.ensureRunning(sessionId);
    for (const f of files) {
      assertHomeRel(f.path);
      const r = await this.exec(sessionId, ["sh", "-c",
        'umask 077 && mkdir -p "$(dirname "$HOME/$1")" && cat > "$HOME/$1"', "_", f.path,
      ], { stdin: f.content, cwd: HOME });
      if (r.exitCode !== 0) throw new Error(`cannot write credentials: ${r.stderr.trim() || "write failed"}`);
    }
  }

  async writeFile(sessionId: string, path: string, content: string) {
    if (content.length > 1024 * 1024) throw new Error("file too large (1MB cap)");
    const full = this.resolve(path);
    await this.ensureRunning(sessionId);
    const r = await this.exec(sessionId, ["sh", "-c", 'mkdir -p "$(dirname "$1")" && cat > "$1"', "_", full], { stdin: content });
    if (r.exitCode !== 0) throw new Error(r.stderr.trim() || "write failed");
    return { bytes: new TextEncoder().encode(content).length };
  }

  async deletePath(sessionId: string, path: string): Promise<void> {
    const full = this.resolve(path);
    if (full === WORKSPACE) throw new Error("cannot delete the workspace root");
    await this.ensureRunning(sessionId);
    if ((await this.exec(sessionId, ["test", "-e", full])).exitCode !== 0) throw new Error("file not found");
    const r = await this.exec(sessionId, ["rm", "-rf", "--", full]);
    if (r.exitCode !== 0) throw new Error(r.stderr.trim() || "delete failed");
  }

  async renamePath(sessionId: string, from: string, to: string): Promise<void> {
    const src = this.resolve(from);
    const dst = this.resolve(to);
    if (src === WORKSPACE || dst === WORKSPACE) throw new Error("cannot move the workspace root");
    await this.ensureRunning(sessionId);
    if ((await this.exec(sessionId, ["test", "-e", src])).exitCode !== 0) throw new Error("file not found");
    if ((await this.exec(sessionId, ["test", "-e", dst])).exitCode === 0) throw new Error("target already exists");
    if (dst.startsWith(`${src}/`)) throw new Error("cannot move a folder into itself");
    const r = await this.exec(sessionId, ["sh", "-c", 'mkdir -p "$(dirname "$2")" && mv -- "$1" "$2"', "_", src, dst]);
    if (r.exitCode !== 0) throw new Error(r.stderr.trim() || "rename failed");
  }

  async diffFile(sessionId: string, path: string): Promise<string> {
    await this.ensureRunning(sessionId);
    const cur = this.resolve(path);
    const old = `${STARTER}/${cur.slice(WORKSPACE.length + 1)}`;
    const has = async (p: string) => (await this.exec(sessionId, ["test", "-f", p])).exitCode === 0;
    const [oldOk, curOk] = [await has(old), await has(cur)];
    if (!oldOk && !curOk) throw new Error("file not found");
    const r = await this.exec(sessionId, ["diff", "-u", "--label", `a/${path}`, "--label", `b/${path}`, oldOk ? old : "/dev/null", curOk ? cur : "/dev/null"]);
    return r.stdout; // exit 1 = differences; empty = identical
  }

  async resetFile(sessionId: string, path: string): Promise<void> {
    await this.ensureRunning(sessionId);
    const cur = this.resolve(path);
    const old = `${STARTER}/${cur.slice(WORKSPACE.length + 1)}`;
    if ((await this.exec(sessionId, ["test", "-f", old])).exitCode !== 0) throw new Error("no starter version — cannot reset");
    await this.exec(sessionId, ["cp", old, cur]);
  }

  async resetProject(sessionId: string): Promise<void> {
    await this.ensureRunning(sessionId);
    await this.exec(sessionId, ["sh", "-c",
      `find ${WORKSPACE} -mindepth 1 -maxdepth 1 -exec rm -rf {} + && cp -a ${STARTER}/. ${WORKSPACE}/ && rm -f ${WORKSPACE}/.starter-ok`,
    ]);
  }
}
