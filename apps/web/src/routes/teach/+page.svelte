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

<div class="page">
  <header class="hdr">
    <div class="l"><a class="logo" href="/">R</a><span class="title">Teach · live cohort</span></div>
    <label class="who">Instructor id <input bind:value={instructor} /></label>
  </header>
  <main>
    {#if msg}<p class="msg" role="status">{msg}</p>{/if}

    <section class="card">
      <h2>Presence <span class="count">{presence.length}</span></h2>
      <table>
        <thead><tr><th>Session</th><th>State</th><th>Status</th><th>Failed</th><th></th></tr></thead>
        <tbody>
          {#each presence as p}
            <tr>
              <td><a href={`/lab/${p.sessionId}`}><code>{p.sessionId.slice(0, 8)}</code></a></td>
              <td><span class="pill">{p.state}</span></td>
              <td>{p.status}</td>
              <td>{p.failedChecks}</td>
              <td class="act"><button class="mini ghost" onclick={() => reset(p.sessionId)}>reset</button> <button class="mini" onclick={() => extend(p.sessionId)}>+30m</button></td>
            </tr>
          {/each}
          {#if !presence.length}<tr><td colspan="5" class="empty">no sessions yet</td></tr>{/if}
        </tbody>
      </table>
    </section>

    <section class="card">
      <h2>Announce</h2>
      <div class="row">
        <input class="grow" bind:value={announceText} placeholder="Schedule change…" onkeydown={(e) => e.key === "Enter" && announce()} />
        <button class="mini" onclick={announce}>broadcast</button>
      </div>
    </section>

    <section class="card">
      <h2>Lab stats · demo-agent</h2>
      {#if stats}<p>{stats.sessions} attempted · pass rate {(stats.passRate * 100).toFixed(0)}%{stats.medianCompletionMs !== null ? ` · median ${(stats.medianCompletionMs / 1000).toFixed(0)}s to pass` : ""}</p>{:else}<p class="empty">no data</p>{/if}
    </section>

    <section class="card">
      <h2>Audit (latest)</h2>
      <ul class="audit">{#each audit as a}<li><code>{a.at}</code> {a.actor} → {a.action}{a.sessionId ? ` ${a.sessionId.slice(0, 8)}` : ""}{a.detail ? ` (${a.detail})` : ""}</li>{/each}</ul>
      {#if !audit.length}<p class="empty">nothing yet</p>{/if}
    </section>
  </main>
</div>

<style>
  :global(body){margin:0}
  .page{min-height:100vh;background:#f5f7fa;color:#18252f;font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-size:14px}
  .hdr{display:flex;align-items:center;justify-content:space-between;height:56px;padding:0 20px;background:#edeff4}
  .hdr .l{display:flex;align-items:center;gap:12px}
  .logo{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:4px;background:#1a1a1a;color:#fff;font-weight:800;text-decoration:none}
  .title{font-size:19px;font-weight:700}
  .who{display:flex;align-items:center;gap:8px;font-size:13px}
  input{border:1px solid #cbd5e1;border-radius:6px;padding:6px 10px;background:#fff;font:inherit}
  main{max-width:900px;margin:0 auto;padding:24px 16px;display:grid;gap:16px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px}
  h2{margin:0 0 12px;font-size:15px;font-weight:700}
  .count{background:#e2e8f0;border-radius:99px;padding:1px 8px;font-size:12px;margin-left:6px}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;padding:4px 8px}
  td{padding:8px;border-top:1px solid #eef2f6}
  .act{text-align:right;white-space:nowrap}
  .pill{background:#dbeafe;color:#1e40af;border-radius:99px;padding:2px 8px;font-size:12px;font-weight:600}
  .empty{color:#94a3b8}
  td.empty{text-align:center;padding:16px}
  .row{display:flex;gap:8px}.grow{flex:1}
  .mini{background:#18252f;color:#fff;border:0;border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer}
  .mini.ghost{background:transparent;color:#475569;border:1px solid #cbd5e1}
  .msg{margin:0;background:#dcfce7;border:1px solid #bbf7d0;border-radius:8px;padding:8px 12px}
  .audit{margin:0;padding-left:18px;font-size:13px;line-height:1.7}
  code{font-family:"Source Code Pro",ui-monospace,Menlo,monospace;font-size:12px}
</style>
