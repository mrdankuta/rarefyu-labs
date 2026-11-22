<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";

  interface Lesson { slug: string; title: string; steps: number; minutes: number; difficulties: string[] }
  let starting = $state<string | null>(null); // "playground" or a lesson slug while launching
  let error = $state("");
  let existingId = $state<string | null>(null);
  let current = $state<{ id: string; track?: string } | null>(null);
  let lessons = $state<Lesson[]>([]);
  let lessonsError = $state("");
  let classCode = $state("");
  const CODE_KEY = "rfy_class_code";

  onMount(async () => {
    try { classCode = localStorage.getItem(CODE_KEY) ?? ""; } catch { /* storage blocked */ }
    // Reattach: if this browser already owns a live workspace, offer to resume it.
    try {
      const r = await fetch("/api/workspaces/current");
      if (r.ok) current = await r.json();
    } catch { /* offline: landing still works */ }
    try {
      const r = await fetch("/api/tracks");
      if (r.ok) lessons = (await r.json()).tracks;
      else lessonsError = "Couldn't load lessons.";
    } catch { lessonsError = "Couldn't load lessons. Is the API up?"; }
  });

  /** Launch a free playground (no track) or a lesson (track slug). */
  async function start(track?: string) {
    starting = track ?? "playground";
    error = "";
    existingId = null;
    try {
      const r = await fetch("/api/playgrounds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(track ? { track } : {}), ...(classCode.trim() ? { seatCode: classCode.trim() } : {}) }),
      });
      if (r.status === 503) {
        const b = await r.json().catch(() => ({}));
        if (b.code === "paused") { error = "New workspaces are paused right now. Please check back soon."; return; }
        const msg = (b.error ?? "we're at capacity right now") as string;
        error = `Sorry, ${msg}. Please try again in about ${b.retryAfterSec ?? 30} seconds.`;
        return;
      }
      if (r.status === 403 && classCode.trim()) {
        error = ((await r.json().catch(() => ({}))).error as string) ?? "That class code wasn't recognised.";
        return;
      }
      if (r.status === 429) {
        const b = await r.json().catch(() => ({}));
        existingId = b.existingId ?? null;
        error = b.code === "quota_ip" ? "Too many workspaces are running from your network. Close one and try again." : "You already have a live workspace.";
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const pg = await r.json();
      try { if (classCode.trim()) localStorage.setItem(CODE_KEY, classCode.trim()); } catch { /* storage blocked */ }
      location.assign(`/lab/${pg.id}`);
    } catch (e) {
      error = `Couldn't start (${(e as Error).message}). Is the API up?`;
    } finally {
      starting = null;
    }
  }
</script>

<div class="page">
  <header class="hdr"><span class="logo">R</span><span class="title">RarefyU Labs</span></header>
  <main>
    <h1>A shell, an editor and an agent — one URL, nothing to install.</h1>
    <p class="lead">Every visit gets its own sandboxed workspace in seconds. No account needed.</p>

    {#if current}
      <div class="resume-bar">
        <span>You have a live {current.track ? "lesson" : "playground"}.</span>
        <a class="cta" href="/lab/{current.id}">↻ Resume</a>
      </div>
    {/if}
    {#if error}<p class="err" role="alert">{error}
      {#if existingId}<a href="/lab/{existingId}">Resume it →</a>{/if}</p>{/if}

    <section aria-labelledby="pg-h">
      <h2 id="pg-h">Playground</h2>
      <div class="card">
        <p>A blank workspace: terminal, editor and live preview, with your coding agents installed. No instructions, no checks — just build.</p>
        <label class="code">Class code <span>(optional — gives your agent its model access)</span>
          <input bind:value={classCode} placeholder="ABCD-EFGH" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" />
        </label>
        <button class="cta" onclick={() => start()} disabled={starting !== null}>{starting === "playground" ? "starting…" : "▶ Open a playground"}</button>
      </div>
    </section>

    <section aria-labelledby="ls-h">
      <h2 id="ls-h">Lessons</h2>
      <p class="sub">Guided, pre-made lessons: step-by-step instructions beside the same workspace, with checks and hints.</p>
      {#if lessonsError}<p class="err">{lessonsError}</p>{/if}
      <div class="lessons">
        {#each lessons as l (l.slug)}
          <div class="card lesson" data-lesson={l.slug}>
            <h3>{l.title}</h3>
            <p class="meta">{l.steps} steps{l.minutes ? ` · ~${l.minutes} min` : ""}{l.difficulties.length ? ` · ${l.difficulties.join(", ")}` : ""}</p>
            <button class="cta" onclick={() => start(l.slug)} disabled={starting !== null}>{starting === l.slug ? "starting…" : "Start lesson"}</button>
          </div>
        {:else}
          {#if !lessonsError}<p class="sub">No lessons yet.</p>{/if}
        {/each}
      </div>
    </section>

    <ul class="facts">
      <li><strong>2 hours</strong> per session, with a live countdown</li>
      <li><strong>Isolated</strong> sandbox — your files and shell are yours alone</li>
      <li><strong>One</strong> live workspace at a time — you can always resume it</li>
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
  main{max-width:760px;margin:0 auto;padding:48px 24px}
  h1{font-size:30px;line-height:1.2;margin:0 0 12px}
  h2{font-size:20px;margin:36px 0 10px}
  h3{font-size:16px;margin:0 0 4px}
  .lead{font-size:17px;color:#475569;margin:0 0 24px}
  .sub{color:#475569;margin:0 0 12px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px}
  .card p{margin:0 0 14px;color:#334155}
  .lessons{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
  .lesson .meta{font-size:13px;color:#64748b;margin:0 0 14px}
  .resume-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#ecfdf5;border:1px solid #86efac;border-radius:10px;padding:10px 16px;margin-bottom:12px}
  .cta{display:inline-block;background:#18252f;color:#fff;font-weight:700;padding:10px 20px;border-radius:8px;border:0;cursor:pointer;font-size:15px;text-decoration:none}
  .cta:disabled{opacity:.6;cursor:default}
  .err{color:#b91c1c}.err a{color:#b91c1c;text-decoration:underline;font-weight:600}
  .facts{list-style:none;padding:0;margin:32px 0 0;display:grid;gap:10px;color:#334155}
  .facts li{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px}
  .foot{margin-top:32px;font-size:13px}.foot a{color:#475569}
  .code{display:grid;gap:4px;font-size:13px;font-weight:600;margin:0 0 12px}
  .code span{font-weight:400;color:#64748b}
  .code input{max-width:200px;border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;font:inherit;font-family:ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase}
</style>
