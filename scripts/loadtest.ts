#!/usr/bin/env bun
/**
 * Cohort load test (spec #30). Ramps simulated students against a running deployment and
 * recommends a global workspace cap. Each student: create workspace -> open terminal and run a
 * command -> start a web server -> see it through the signed preview -> hold (optionally burning CPU).
 *
 *   bun scripts/loadtest.ts --base https://labs.example.com --stages 5,10,20,30 [--hold 30] [--cpu] [--cpus 8]
 *
 * Run it on (or next to) the target VPS with the API started with high caps, e.g.
 *   MAX_WORKSPACES_GLOBAL=200 MAX_WORKSPACES_PER_IP=200 docker compose ... up -d
 * and set the real caps from the recommendation afterwards. Exit code 1 if even the first stage fails.
 */
import { cpus } from "node:os";

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1]?.startsWith("--") || process.argv[i + 1] === undefined ? "1" : process.argv[i + 1]) : def;
};
const BASE = (arg("base", "http://localhost:3000") as string).replace(/\/$/, "");
const STAGES = (arg("stages", "5,10,20") as string).split(",").map(Number).filter((n) => n > 0);
const HOLD_SEC = Number(arg("hold", "20"));
const BURN_CPU = arg("cpu") !== undefined;
const HOST_CPUS = Number(arg("cpus", String(cpus().length)));
const TRACK = arg("track", "demo-agent") as string;
const ADMIN = process.env.ADMIN_TOKEN;

// Pass/fail thresholds for a stage (tune with env if your SLO differs).
const LIMITS = {
  createP95Ms: Number(process.env.LT_CREATE_P95_MS ?? 20_000),
  terminalP95Ms: Number(process.env.LT_TERMINAL_P95_MS ?? 3_000),
  previewP95Ms: Number(process.env.LT_PREVIEW_P95_MS ?? 20_000),
  minMemAvailableFrac: Number(process.env.LT_MIN_MEM_FRAC ?? 0.15),
  maxLoadPerCpu: Number(process.env.LT_MAX_LOAD_PER_CPU ?? 1.5),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : 0);

interface Student { id: string; cookie: string }
interface Result { ok: boolean; error?: string; createMs?: number; terminalMs?: number; previewMs?: number; student?: Student }

async function host() {
  const m = await (await fetch(`${BASE}/metrics`)).text();
  const g = (n: string) => Number(new RegExp(`^${n.replace(/[{}"=]/g, (c) => `\\${c}`)} (\\S+)$`, "m").exec(m)?.[1] ?? NaN);
  return { load1: g("labs_host_load1"), memAvail: g("labs_host_mem_available_bytes"), memTotal: g("labs_host_mem_total_bytes"), active: g('labs_workspaces{state="active"}') };
}

async function runStudent(n: number): Promise<Result> {
  let student: Student | undefined;
  try {
    const t0 = performance.now();
    const res = await fetch(`${BASE}/api/playgrounds`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ track: TRACK }) });
    if (!res.ok) return { ok: false, error: `create ${res.status} ${(await res.text()).slice(0, 80)}` };
    const cookie = /rfy_sid=([\w-]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
    if (!cookie) return { ok: false, error: "no identity cookie" };
    const rec = (await res.json()) as { id: string };
    student = { id: rec.id, cookie: `rfy_sid=${cookie}` };
    const createMs = performance.now() - t0;
    const H = { cookie: student.cookie, "content-type": "application/json" };

    // Terminal: marker round trip.
    const t1 = performance.now();
    const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/ws/terminal?session=${rec.id}&term=lt`, { headers: { cookie: student.cookie } } as never);
    let buf = "";
    let ready = false;
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.type === "ready") ready = true;
      if (m.type === "data") buf += m.data;
    };
    const send = (s: string) => ws.send(JSON.stringify({ data: s }));
    const until = async (cond: () => boolean, ms: number, what: string) => {
      const end = Date.now() + ms;
      while (!cond()) { if (Date.now() > end) throw new Error(`timeout: ${what}`); await sleep(50); }
    };
    await until(() => ready, 15_000, "terminal ready");
    send(`echo marker-${n}-$((6*7))\r`);
    await until(() => buf.includes(`marker-${n}-42`), 15_000, "terminal echo");
    const terminalMs = performance.now() - t1;

    // Preview: start a server in the workspace, wait for it to go live, fetch through the proxy.
    const t2 = performance.now();
    send(`echo '<h1>student ${n}</h1>' > index.html; python3 -m http.server 3000 >/dev/null 2>&1 &\r`);
    let url = "";
    await until(() => !!url || false, 0, "").catch(() => {});
    const endP = Date.now() + 30_000;
    while (!url) {
      const p = (await (await fetch(`${BASE}/api/playgrounds/${rec.id}/preview?port=3000`, { headers: H })).json()) as { ready?: boolean; url?: string };
      if (p.ready && p.url) url = p.url;
      else if (Date.now() > endP) throw new Error("timeout: preview live");
      else await sleep(500);
    }
    const page = await fetch(`${BASE}${url}`);
    if (!(await page.text()).includes(`student ${n}`)) throw new Error("preview served wrong content");
    const previewMs = performance.now() - t2;

    if (BURN_CPU) send(`timeout ${HOLD_SEC} sh -c 'while :; do :; done' &\r`);
    await fetch(`${BASE}/api/playgrounds/${rec.id}/heartbeat`, { method: "POST", headers: H });
    return { ok: true, createMs, terminalMs, previewMs, student: { ...student, id: rec.id } };
  } catch (e) {
    return { ok: false, error: (e as Error).message, student };
  }
}

async function cleanup(students: Student[]) {
  await Promise.all(students.map((s) => fetch(`${BASE}/api/playgrounds/${s.id}`, { method: "DELETE", headers: { cookie: s.cookie } }).catch(() => {})));
}

async function stage(n: number) {
  const before = await host();
  const results = await Promise.all(Array.from({ length: n }, async (_, i) => { await sleep(i * 150); return runStudent(i + 1); }));
  await sleep(HOLD_SEC * 1000); // steady state while students "work"
  const during = await host();
  const students = results.map((r) => r.student).filter(Boolean) as Student[];
  await cleanup(students);
  const okRes = results.filter((r) => r.ok);
  const errors = results.filter((r) => !r.ok).map((r) => r.error);
  const create = okRes.map((r) => r.createMs!), term = okRes.map((r) => r.terminalMs!), prev = okRes.map((r) => r.previewMs!);
  const memFrac = during.memTotal ? during.memAvail / during.memTotal : NaN;
  const loadPerCpu = during.load1 / HOST_CPUS;
  const perWorkspaceMemMb = n ? Math.max(0, (before.memAvail - during.memAvail) / n / 1048576) : 0;
  const checks = {
    noFailures: errors.length === 0,
    createP95: pct(create, 95) <= LIMITS.createP95Ms,
    terminalP95: pct(term, 95) <= LIMITS.terminalP95Ms,
    previewP95: pct(prev, 95) <= LIMITS.previewP95Ms,
    memory: Number.isNaN(memFrac) || memFrac >= LIMITS.minMemAvailableFrac,
    load: Number.isNaN(loadPerCpu) || loadPerCpu <= LIMITS.maxLoadPerCpu,
  };
  return {
    students: n, ok: okRes.length, failed: errors.length, errors: [...new Set(errors)].slice(0, 5),
    createMs: { p50: Math.round(pct(create, 50)), p95: Math.round(pct(create, 95)) },
    terminalMs: { p50: Math.round(pct(term, 50)), p95: Math.round(pct(term, 95)) },
    previewMs: { p50: Math.round(pct(prev, 50)), p95: Math.round(pct(prev, 95)) },
    host: { load1: during.load1, loadPerCpu: Number(loadPerCpu.toFixed(2)), memAvailFrac: Number(memFrac.toFixed(2)), perWorkspaceMemMb: Math.round(perWorkspaceMemMb) },
    checks, pass: Object.values(checks).every(Boolean),
  };
}

console.log(`load test against ${BASE}  stages=${STAGES.join(",")} hold=${HOLD_SEC}s cpu-burn=${BURN_CPU} host-cpus=${HOST_CPUS}`);
if (ADMIN) await fetch(`${BASE}/api/admin/reconcile`, { method: "POST", headers: { authorization: `Bearer ${ADMIN}` } }).catch(() => {});
const report: Awaited<ReturnType<typeof stage>>[] = [];
let lastGood = 0;
for (const n of STAGES) {
  console.log(`\n== stage: ${n} students ==`);
  const r = await stage(n);
  report.push(r);
  console.log(JSON.stringify(r, null, 2));
  if (!r.pass) { console.log(`stage ${n} FAILED checks: ${Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k).join(", ")}`); break; }
  lastGood = n;
}
const perMem = report.filter((r) => r.pass).at(-1)?.host.perWorkspaceMemMb ?? 0;
const recommended = Math.floor(lastGood * 0.8);
console.log("\n== summary ==");
console.log(JSON.stringify({ lastPassingStage: lastGood, recommendedGlobalCap: recommended, observedMemPerWorkspaceMb: perMem, note: "cap = 80% of the last passing stage (headroom for bursts); set MAX_WORKSPACES_GLOBAL accordingly" }, null, 2));
process.exit(lastGood > 0 ? 0 : 1);
