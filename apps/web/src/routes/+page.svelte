<script lang="ts">
  import "../app.css";
  let starting = $state(false);
  let error = $state("");
  let existingId = $state<string | null>(null);
  let current = $state<{ id: string } | null>(null);
  import { onMount } from "svelte";
  onMount(async () => {
    // Reattach: if this browser already owns a live workspace, offer to resume it.
    try {
      const r = await fetch("/api/workspaces/current");
      if (r.ok) current = await r.json();
    } catch { /* offline: landing still works */ }
  });
  async function start() {
    starting = true;
    error = "";
    existingId = null;
    try {
      const r = await fetch("/api/playgrounds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "demo-agent" }),
      });
      if (r.status === 503) {
        const b = await r.json().catch(() => ({}));
        if (b.code === "paused") { error = "New playgrounds are paused right now. Please check back soon."; return; }
        const msg = (b.error ?? "we're at capacity right now") as string;
        error = `Sorry, ${msg}. Please try again in about ${b.retryAfterSec ?? 30} seconds.`;
        return;
      }
      if (r.status === 429) {
        const b = await r.json().catch(() => ({}));
        existingId = b.existingId ?? null;
        error = b.code === "quota_ip" ? "Too many playgrounds are running from your network. Close one and try again." : "You already have a live playground.";
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const pg = await r.json();
      location.assign(`/lab/${pg.id}`);
    } catch (e) {
      error = `Couldn't start a playground (${(e as Error).message}). Is the API up?`;
    } finally {
      starting = false;
    }
  }
</script>

<div class="page">
  <header class="hdr"><span class="logo">R</span><span class="title">RarefyU Labs</span></header>
  <main>
    <h1>A shell, an editor and an agent — one URL, nothing to install.</h1>
    <p class="lead">Start a playground and get a sandboxed workspace in seconds. No account needed.</p>
    {#if current}
      <a class="cta resume" href="/lab/{current.id}">↻ Resume your playground</a>
    {:else}
      <button class="cta" onclick={start} disabled={starting}>{starting ? "starting…" : "▶ Start a playground"}</button>
    {/if}
    {#if error}<p class="err" role="alert">{error}
      {#if existingId}<a href="/lab/{existingId}">Resume it →</a>{/if}</p>{/if}
    <ul class="facts">
      <li><strong>2 hours</strong> per session, with a live countdown</li>
      <li><strong>Isolated</strong> sandbox — your files and shell are yours alone</li>
      <li><strong>Guided</strong> demo track with checks, hints and a graded submit</li>
      <li><strong>One</strong> live playground at a time — you can always resume it</li>
    </ul>
    <p class="foot"><a href="/teach">Teach console →</a></p>
  </main>
</div>

<style>
  :global(body){margin:0}
  .page{min-height:100vh;background:#f5f7fa;color:#18252f;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
  .hdr{display:flex;align-items:center;gap:12px;height:56px;padding:0 20px;background:#edeff4}
  .logo{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:4px;background:#1a1a1a;color:#fff;font-weight:800}
  .title{font-size:19px;font-weight:700}
  main{max-width:640px;margin:0 auto;padding:56px 24px}
  h1{font-size:30px;line-height:1.2;margin:0 0 12px}
  .lead{font-size:17px;color:#475569;margin:0 0 24px}
  .cta{background:#18252f;color:#fff;font-weight:700;padding:12px 24px;border-radius:8px;border:0;cursor:pointer;font-size:16px}
  .cta:disabled{opacity:.6;cursor:default}
  .cta.resume{display:inline-block;text-decoration:none}
  .err{color:#b91c1c}.err a{color:#b91c1c;text-decoration:underline;font-weight:600}
  .facts{list-style:none;padding:0;margin:32px 0 0;display:grid;gap:10px;color:#334155}
  .facts li{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px}
  .foot{margin-top:32px;font-size:13px}.foot a{color:#475569}
</style>
