<script lang="ts">
  import "../../app.css";
  // Minimal teach console (issue #8): presence, reset/extend, announce, stats.
  // Bench auth: pass x-test-user as instructor. Production: owner-of-org gate.
  let instructor = $state("instructor_1");
  let presence = $state<{ sessionId: string; state: string; status: string; failedChecks: number }[]>([]);
  let stats = $state<{ sessions: number; passRate: number; medianCompletionMs: number | null } | null>(null);
  let audit = $state<{ at: string; actor: string; action: string; sessionId?: string; detail?: string }[]>([]);
  let msg = $state("");
  let announceText = $state("");

  function H() { return { "content-type": "application/json", "x-test-user": instructor }; }
  async function refresh() {
    const [p, s, a] = await Promise.all([
      fetch("/api/teach/presence", { headers: { "x-test-user": instructor } }),
      fetch("/api/teach/stats?track=demo-agent", { headers: { "x-test-user": instructor } }),
      fetch("/api/teach/audit", { headers: { "x-test-user": instructor } }),
    ]);
    if (p.ok) presence = (await p.json()).presence;
    if (s.ok) stats = await s.json();
    if (a.ok) audit = (await a.json()).audit.slice(-20).reverse();
  }
  async function reset(sessionId: string) {
    if (!confirm("Reset session FS? Learner gets a toast; progress kept.")) return;
    const r = await fetch("/api/teach/reset", { method: "POST", headers: H(), body: JSON.stringify({ sessionId }) });
    msg = r.ok ? "reset ✓" : (await r.json()).error;
    refresh();
  }
  async function extend(sessionId: string) {
    const r = await fetch("/api/teach/extend", { method: "POST", headers: H(), body: JSON.stringify({ sessionId, minutes: 30 }) });
    msg = r.ok ? `extended +30m ✓` : (await r.json()).error;
    refresh();
  }
  async function announce() {
    if (!announceText.trim()) return;
    const r = await fetch("/api/teach/announce", { method: "POST", headers: H(), body: JSON.stringify({ message: announceText }) });
    msg = r.ok ? "announced ✓" : (await r.json()).error;
    announceText = "";
    refresh();
  }
  $effect(() => { void instructor; refresh(); });
  setInterval(refresh, 30000);
</script>

<main style="font-family:Inter,system-ui,sans-serif;max-width:900px;margin:0 auto;padding:24px">
  <h1>Teach · live cohort</h1>
  <label>Instructor id <input bind:value={instructor} style="border:1px solid #ccc;border-radius:6px;padding:4px 8px" /></label>
  {#if msg}<p>{msg}</p>{/if}

  <h2>Presence ({presence.length})</h2>
  <table style="width:100%;border-collapse:collapse">
    <thead><tr><th align="left">Session</th><th align="left">State</th><th align="left">Status</th><th align="left">Failed</th><th></th></tr></thead>
    <tbody>
      {#each presence as p}
        <tr style="border-top:1px solid #eee">
          <td><a href={`/lab/${p.sessionId}`}><code>{p.sessionId.slice(0, 8)}</code></a></td>
          <td><strong>{p.state}</strong></td>
          <td>{p.status}</td>
          <td>{p.failedChecks}</td>
          <td><button onclick={() => reset(p.sessionId)}>reset</button> <button onclick={() => extend(p.sessionId)}>+30m</button></td>
        </tr>
      {/each}
      {#if !presence.length}<tr><td colspan="5">no sessions yet</td></tr>{/if}
    </tbody>
  </table>

  <h2>Announce</h2>
  <input bind:value={announceText} placeholder="Schedule change…" style="border:1px solid #ccc;border-radius:6px;padding:6px 10px;width:60%" />
  <button onclick={announce}>broadcast</button>

  <h2>Lab stats · demo-agent</h2>
  {#if stats}<p>{stats.sessions} attempted · pass rate {(stats.passRate * 100).toFixed(0)}%{stats.medianCompletionMs !== null ? ` · median ${(stats.medianCompletionMs / 1000).toFixed(0)}s to pass` : ""}</p>{/if}

  <h2>Audit (latest)</h2>
  <ul>{#each audit as a}<li><code>{a.at}</code> {a.actor} → {a.action}{a.sessionId ? ` ${a.sessionId.slice(0, 8)}` : ""}{a.detail ? ` (${a.detail})` : ""}</li>{/each}</ul>
</main>
