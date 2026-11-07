import { getAllPlaygroundIds, getPlayground } from "./playgrounds";
import { getAttempts } from "./checks";

/**
 * Minimal Prometheus observability (issue #11).
 * Counters + gauges the bench actually produces: session provision outcomes,
 * boot latency (create → first heartbeat), check pass rates, kill-switch
 * drills. A Grafana dashboard + alert rules land with the production OTEL
 * pipe; the metric NAMES here are the contract dashboards will use.
 */

export const bootMs: number[] = []; // create → first heartbeat per session
const createdAt = new Map<string, number>();
let provisionsOk = 0;
let provisionsErr = 0;
let kills = 0;

export function clearMetrics() {
  bootMs.length = 0;
  createdAt.clear();
  provisionsOk = 0;
  provisionsErr = 0;
  kills = 0;
}

export function noteProvisionStart(id: string) {
  createdAt.set(id, Date.now());
}

export function noteProvisionOk() {
  provisionsOk++;
}

export function noteProvisionErr() {
  provisionsErr++;
}

export function noteHeartbeat(id: string) {
  const t0 = createdAt.get(id);
  if (t0 === undefined) return;
  createdAt.delete(id);
  bootMs.push(Date.now() - t0);
}

export function noteKill(n: number) {
  kills += n;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export function renderMetrics(): string {
  const ids = getAllPlaygroundIds();
  let live = 0;
  for (const id of ids) {
    const r = getPlayground(id);
    if (r && (r.status === "active" || r.status === "creating")) live++;
  }
  let checks = 0;
  let passes = 0;
  for (const id of ids) {
    for (const a of getAttempts(id)) {
      checks++;
      if (a.pass) passes++;
    }
  }
  const boots = [...bootMs].sort((a, b) => a - b);
  const lines = [
    `# HELP labs_provisions_total Playground provisions by outcome.`,
    `# TYPE labs_provisions_total counter`,
    `labs_provisions_total{outcome="ok"} ${provisionsOk}`,
    `labs_provisions_total{outcome="error"} ${provisionsErr}`,
    `# HELP labs_sessions_live Live (active/creating) playground sessions.`,
    `# TYPE labs_sessions_live gauge`,
    `labs_sessions_live ${live}`,
    `# HELP labs_boot_ms Session boot latency (create→first heartbeat).`,
    `# TYPE labs_boot_ms summary`,
    `labs_boot_ms{quantile="0.5"} ${percentile(boots, 50)}`,
    `labs_boot_ms{quantile="0.95"} ${percentile(boots, 95)}`,
    `# HELP labs_checks_total In-session check executions and passes.`,
    `# TYPE labs_checks_total counter`,
    `labs_checks_total{outcome="pass"} ${passes}`,
    `labs_checks_total{outcome="fail"} ${checks - passes}`,
    `# HELP labs_kills_total Sessions destroyed via kill switch.`,
    `# TYPE labs_kills_total counter`,
    `labs_kills_total ${kills}`,
  ];
  return lines.join("\n") + "\n";
}
