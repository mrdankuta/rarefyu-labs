<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { currentTheme, toggleTheme, type Theme } from "$lib/theme";
  let theme = $state<Theme>("dark");

  interface Lesson { slug: string; title: string; steps: number; minutes: number; difficulties: string[] }
  let starting = $state<string | null>(null); // "playground" or a lesson slug while launching
  let error = $state("");
  let existingId = $state<string | null>(null);
  let current = $state<{ id: string; track?: string } | null>(null);
  let lessons = $state<Lesson[]>([]);
  let lessonsError = $state("");
  let classCode = $state("");
  let cfg = $state<{ seatsRequired: boolean; className: string | null; showLessons: boolean }>({ seatsRequired: false, className: null, showLessons: true });
  const CODE_KEY = "rfy_class_code";

  onMount(async () => {
    theme = currentTheme();
    try { classCode = localStorage.getItem(CODE_KEY) ?? ""; } catch { /* storage blocked */ }
    // Reattach: if this browser already owns a live workspace, offer to resume it.
    try {
      const r = await fetch("/api/workspaces/current");
      if (r.ok) current = await r.json();
    } catch { /* offline: landing still works */ }
    try {
      const r = await fetch("/api/config");
      if (r.ok) cfg = await r.json();
    } catch { /* keep defaults */ }
    try {
      const r = await fetch("/api/tracks");
      if (r.ok) lessons = (await r.json()).tracks;
      else lessonsError = "Couldn't load lessons.";
    } catch { lessonsError = "Couldn't load lessons. Is the API up?"; }
  });

  /** Launch a free playground (no track) or a lesson (track slug). */
  async function start(track?: string) {
    error = "";
    if (cfg.seatsRequired && !classCode.trim()) { error = "Enter your class code first."; return; }
    starting = track ?? "playground";
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
  <header class="hdr">
    <span class="brand"><span class="logo" role="img" aria-label="Rarefy Technologies"><img class="mk mk-dark" src="/brand/rtech-icon-secondary.svg" alt="" /><img class="mk mk-light" src="/brand/rtech-icon-primary.svg" alt="" /></span><span class="title">AI Build Lab</span><span class="by">by Rarefy Technologies</span></span>
    <button class="theme" type="button" aria-label="switch to {theme === 'dark' ? 'light' : 'dark'} mode" onclick={() => (theme = toggleTheme())}>{theme === "dark" ? "☀ Light" : "☾ Dark"}</button>
  </header>
  <main>
    <div class="left">
      {#if cfg.seatsRequired}
        <h1>Open your workspace.</h1>
        <p class="lead">Type the code from your organizer. Your editor, terminal and coding agents open in this tab, already set up.</p>
        {#if current}
          <div class="resume-bar">
            <span>Your workspace is still running.</span>
            <a class="btn" href="/lab/{current.id}">↻ Resume</a>
          </div>
        {/if}
        <form class="classform" onsubmit={(e) => { e.preventDefault(); start(); }}>
          <label for="class-code" class="lbl">Class code</label>
          <div class="row">
            <input id="class-code" class:bad={!!error && !existingId} bind:value={classCode} placeholder="ABCD-EFGH" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" />
            <button class="btn big" type="submit" disabled={starting !== null}>{starting ? "Opening…" : "Open workspace"}</button>
          </div>
          {#if error}<p class="err" role="alert">{error}{#if existingId} <a href="/lab/{existingId}">Resume it →</a>{/if}</p>
          {:else}<p class="hint">Back from a break? Enter the same code and you land exactly where you left off.</p>{/if}
        </form>
        <ul class="points">
          <li>Your workspace stays for the whole class day.</li>
          <li>Download everything as a .zip at any time.</li>
          <li>No code? Ask your instructor. Codes are one per student.</li>
        </ul>
      {:else}
        <h1>A shell, an editor and an agent. One URL.</h1>
        <p class="lead">Every visit gets its own sandboxed workspace in seconds. Nothing to install.</p>
        {#if current}
          <div class="resume-bar"><span>You have a live {current.track ? "lesson" : "playground"}.</span><a class="btn" href="/lab/{current.id}">↻ Resume</a></div>
        {/if}
        {#if error}<p class="err" role="alert">{error}{#if existingId} <a href="/lab/{existingId}">Resume it →</a>{/if}</p>{/if}
        <section aria-labelledby="pg-h">
          <h2 id="pg-h">Playground</h2>
          <div class="card">
            <p>A blank workspace with terminal, editor and live preview, and your coding agents installed.</p>
            <label class="lbl" for="optcode">Class code <span>(optional, gives your agent its model access)</span></label>
            <input id="optcode" class="small" bind:value={classCode} placeholder="ABCD-EFGH" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" />
            <button class="btn" onclick={() => start()} disabled={starting !== null}>{starting === "playground" ? "Starting…" : "▶ Open a playground"}</button>
          </div>
        </section>
        {#if cfg.showLessons}
        <section aria-labelledby="ls-h">
          <h2 id="ls-h">Lessons</h2>
          {#if lessonsError}<p class="err">{lessonsError}</p>{/if}
          <div class="lessons">
            {#each lessons as l (l.slug)}
              <div class="card lesson" data-lesson={l.slug}>
                <h3>{l.title}</h3>
                <p class="meta">{l.steps} steps{l.minutes ? ` · ~${l.minutes} min` : ""}{l.difficulties.length ? ` · ${l.difficulties.join(", ")}` : ""}</p>
                <button class="btn" onclick={() => start(l.slug)} disabled={starting !== null}>{starting === l.slug ? "Starting…" : "Start lesson"}</button>
              </div>
            {:else}
              {#if !lessonsError}<p class="hint">No lessons yet.</p>{/if}
            {/each}
          </div>
        </section>
        {/if}
        <p class="foot"><a href="/teach">Teach console →</a></p>
      {/if}
    </div>

    <div class="right" aria-hidden="true">
      <div class="win">
        <div class="wbar"><i></i><i></i><i></i><span class="path">my-site / index.html</span><span class="chip">Agent ready</span></div>
        <div class="wbody">
          <div class="wside"><b>EXPLORER</b><div>▾ my-site</div><div class="sel">index.html</div><div>css/</div><div>photo.png</div><div>README.md</div></div>
          <div class="wmain">
            <pre class="wcode"><span class="c">&lt;!-- built with opencode --&gt;</span>
<span class="k">&lt;h1&gt;</span>Uploaded!<span class="k">&lt;/h1&gt;</span>
<span class="k">&lt;link</span> <span class="f">rel</span>=<span class="s">"stylesheet"</span> <span class="f">href</span>=<span class="s">"css/app.css"</span><span class="k">&gt;</span>
<span class="k">&lt;img</span> <span class="f">src</span>=<span class="s">"photo.png"</span><span class="k">&gt;</span></pre>
            <pre class="wterm"><span class="ok">student@lab</span> ~/workspace$ opencode
&gt; make the heading teal and add a footer
  ✓ edited css/app.css  +6 −1
  ✓ edited index.html   +3</pre>
          </div>
        </div>
      </div>
    </div>
  </main>
</div>

<style>
  .page{min-height:100vh;background:var(--bg);color:var(--text);font-family:var(--sans)}
  .hdr{display:flex;align-items:center;justify-content:space-between;padding:24px clamp(20px,5vw,64px)}
  .brand{display:flex;align-items:center;gap:12px}
  .logo{display:block;height:30px}.by{font-size:13px;color:var(--muted);margin-left:2px}
  .title{font-family:var(--display);font-weight:600;font-size:17px}
  .theme{height:34px;padding:0 14px;border-radius:99px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:500 13px var(--sans);cursor:pointer}
  main{display:flex;align-items:center;gap:72px;padding:12px clamp(20px,5vw,64px) 56px;max-width:1280px;margin:0 auto;flex-wrap:wrap}
  .left{flex:1 1 440px;max-width:520px;display:flex;flex-direction:column;gap:20px}
  .right{flex:1 1 420px;display:flex;justify-content:center;min-width:0}
  h1{font-family:var(--display);font-weight:700;font-size:clamp(36px,5vw,54px);line-height:1.05;letter-spacing:-.02em;margin:0;text-wrap:balance}
  h2{font-size:18px;margin:12px 0 0}h3{margin:0 0 4px;font-size:16px}
  .lead{margin:0;font-size:18px;line-height:1.55;color:var(--muted);max-width:440px}
  .lbl{font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
  .lbl span{text-transform:none;letter-spacing:0;font-weight:400}
  .classform{display:flex;flex-direction:column;gap:12px}
  .row{display:flex;gap:12px;flex-wrap:wrap}
  .row input{flex:1 1 200px;min-width:0;height:64px;box-sizing:border-box;padding:0 20px;border-radius:12px;border:2px solid var(--accent);background:var(--surface);color:var(--text);font:500 28px var(--mono);letter-spacing:.12em;text-transform:uppercase;outline:none;box-shadow:0 0 0 4px var(--accent-soft)}
  .row input.bad{border-color:var(--danger);box-shadow:0 0 0 4px var(--danger-soft)}
  .small{height:42px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:15px var(--mono);letter-spacing:.08em;text-transform:uppercase;padding:0 12px;margin:6px 0 14px;display:block;max-width:220px}
  .btn{display:inline-flex;align-items:center;justify-content:center;background:var(--accent);color:var(--accent-ink);font:600 15px var(--sans);padding:10px 20px;border-radius:10px;border:0;cursor:pointer;text-decoration:none}
  .btn.big{height:64px;padding:0 28px;font-size:17px;border-radius:12px}
  .btn:disabled{opacity:.6;cursor:default}
  .hint{margin:0;font-size:14px;line-height:1.5;color:var(--muted)}
  .err{margin:0;padding:12px 14px;border-radius:10px;background:var(--danger-soft);color:var(--danger);font-size:15px;line-height:1.5}
  .err a{color:inherit;font-weight:600;text-decoration:underline}
  .points{list-style:none;margin:0;padding:20px 0 0;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:10px;font-size:14px;color:var(--muted)}
  .points li{display:flex;align-items:center;gap:10px}
  .points li::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--ok);flex:none}
  .resume-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--ok-soft);border-radius:10px;padding:10px 16px}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px}
  .card p{margin:0 0 14px;color:var(--muted)}.meta{font-size:13px}
  .lessons{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
  .foot{font-size:13px}.foot a{color:var(--muted)}
  .win{width:100%;max-width:560px;height:440px;border-radius:16px;background:#051a22;box-shadow:var(--shadow),0 0 0 1px var(--border);overflow:hidden;display:flex;flex-direction:column;color:#c9d1e0}
  .wbar{height:38px;background:#0c2531;display:flex;align-items:center;padding:0 14px;gap:8px;flex:none}
  .wbar i{width:10px;height:10px;border-radius:50%;background:#2b4a58}
  .wbar .path{margin-left:14px;font:12px var(--mono);color:#8a93a3}
  .wbar .chip{margin-left:auto;font-size:11px;color:#6ee7b7;background:rgba(18,160,110,.16);padding:3px 9px;border-radius:99px}
  .wbody{display:flex;flex:1;min-height:0}
  .wside{width:128px;background:#08202b;padding:12px 10px;font:12px var(--mono);color:#9aa4b5;display:flex;flex-direction:column;gap:7px;flex:none}
  .wside b{font-size:10px;letter-spacing:.08em;color:#5d6778}.wside .sel{padding-left:12px;color:#fff;background:#12303d;border-radius:4px}
  .wmain{flex:1;min-width:0;display:flex;flex-direction:column}
  .wcode,.wterm{margin:0;font:12.5px/1.75 var(--mono);overflow:hidden}
  .wcode{flex:1;padding:14px 16px}.wterm{height:140px;background:#04141b;border-top:1px solid #12303d;padding:10px 16px;font-size:12px;color:#9aa4b5}
  .wcode .c{color:#8a93a3}.wcode .k{color:#c792ea}.wcode .s{color:#c3e88d}.wcode .f{color:#82aaff}.wterm .ok{color:#6ee7b7}
  @media (max-width:900px){.right{display:none}main{gap:32px}}
</style>
