<script lang="ts">
  import "../../../app.css";
  import { page } from "$app/stores";
  import { onMount, onDestroy } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView, keymap } from "@codemirror/view";
  import { javascript } from "@codemirror/lang-javascript";
  import { oneDark } from "@codemirror/theme-one-dark";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "@xterm/xterm/css/xterm.css";

  const id = $derived($page.params.id ?? "");
  const API = ""; // same-origin; Caddy routes /api/* → api

  // --- layout state (persisted per user, post-MVP mechanism = localStorage) ---
  let hideLearn = $state(false);
  let hideRun = $state(false);
  let runTab = $state("Term 1");
  let terms = $state(["Term 1"]);
  if (typeof localStorage !== "undefined") {
    hideLearn = localStorage.getItem("labs.hideLearn") === "1";
    hideRun = localStorage.getItem("labs.hideRun") === "1";
  }
  $effect(() => {
    try {
      localStorage.setItem("labs.hideLearn", hideLearn ? "1" : "0");
      localStorage.setItem("labs.hideRun", hideRun ? "1" : "0");
    } catch { /* private mode */ }
  });

  // --- session + countdown ---
  interface Playground { id: string; status: string; expiresAt: string; warned?: boolean }
  let pg = $state<Playground | null>(null);
  let loadError = $state("");
  let ttlText = $state("--");
  async function loadSession() {
    try {
      const r = await fetch(`${API}/api/playgrounds/${id}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      pg = await r.json();
      tickTtl();
    } catch (e) {
      loadError = `session not found — open a playground first (${(e as Error).message})`;
    }
  }
  function tickTtl() {
    if (!pg?.expiresAt) return;
    const ms = Date.parse(pg.expiresAt) - Date.now();
    if (ms <= 0) { ttlText = "expired"; return; }
    ttlText = `${String(Math.floor(ms / 3600000)).padStart(2, "0")}h${String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0")}m`;
  }
  setInterval(tickTtl, 30000);

  // --- files ---
  interface Entry { path: string; type: "file" | "dir"; size?: number }
  let files = $state<Entry[]>([]);
  let cwd = $state("");
  let openPath = $state<string | null>(null);
  let dirty = $state(false);
  let diffText = $state<string | null>(null);
  let showDiff = $state(false);
  let fileNotice = $state("");
  let editorEl: HTMLDivElement | null = null;
  let view: EditorView | null = null;

  async function listFiles() {
    const r = await fetch(`${API}/api/playgrounds/${id}/files?path=${encodeURIComponent(cwd)}`);
    if (r.ok) files = (await r.json()).files;
  }
  async function openFile(path: string) {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    const r = await fetch(`${API}/api/playgrounds/${id}/files/content?path=${encodeURIComponent(path)}`);
    if (!r.ok) { fileNotice = `cannot open ${path}`; return; }
    const body = await r.json();
    openPath = path;
    dirty = false;
    showDiff = false;
    fileNotice = body.truncated ? "large file — showing first 256KB" : "";
    view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: body.content } });
  }
  async function saveFile() {
    if (!openPath || !view) return;
    const content = view.state.doc.toString();
    const r = await fetch(`${API}/api/playgrounds/${id}/files/content`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: openPath, content }),
    });
    fileNotice = r.ok ? "saved ✓" : `save failed: ${(await r.json()).error}`;
    if (r.ok) { dirty = false; listFiles(); }
  }
  async function loadDiff() {
    if (!openPath) return;
    const r = await fetch(`${API}/api/playgrounds/${id}/files/diff?path=${encodeURIComponent(openPath)}`);
    if (!r.ok) return;
    const body = await r.json();
    diffText = body.changed ? body.diff : "(identical to starter)";
    showDiff = true;
  }
  async function resetFile() {
    if (!openPath || !confirm(`Reset ${openPath} to starter?`)) return;
    const r = await fetch(`${API}/api/playgrounds/${id}/files/reset`, {
      method: "PUT" in {} ? "POST" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: openPath }),
    });
    if (r.ok) { openFile(openPath); fileNotice = "file reset to starter ✓"; }
    else fileNotice = `reset failed: ${(await r.json()).error}`;
  }
  async function resetProject() {
    if (!confirm("Reset the whole project to starter?")) return;
    const r = await fetch(`${API}/api/playgrounds/${id}/files/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (r.ok) { openPath = null; showDiff = false; listFiles(); fileNotice = "project reset ✓"; }
  }

  // --- terminals (one xterm per term tab, shared session) ---
  let termEls: Record<string, HTMLDivElement | null> = {};
  let termObjs: Record<string, { term: Terminal; ws: WebSocket; fit: FitAddon }> = {};
  function wsUrl(term: string) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws/terminal?session=${id}&term=${encodeURIComponent(term)}`;
  }
  function attachTerm(name: string) {
    const el = termEls[name];
    if (!el || termObjs[name]) return;
    const term = new Terminal({ fontFamily: '"Source Code Pro",ui-monospace,Menlo,monospace', fontSize: 13, theme: { background: "#080808" } });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    const ws = new WebSocket(wsUrl(name));
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === "data") term.write(m.data);
        else if (m.type === "error") term.writeln(`\r\n[relay: ${m.error}]`);
      } catch { term.write(e.data); }
    };
    term.onData((d) => { if (ws.readyState === 1) ws.send(JSON.stringify({ data: d })); });
    termObjs[name] = { term, ws, fit };
  }
  function addTerm() {
    const n = `Term ${terms.length + 1}`;
    terms = [...terms.slice(0, 1), n, ...terms.slice(1)];
    runTab = n;
    setTimeout(() => attachTerm(n), 0);
  }
  function heartbeat() {
    fetch(`${API}/api/playgrounds/${id}/heartbeat`, { method: "POST" }).catch(() => {});
  }
  setInterval(heartbeat, 5 * 60_000);

  // --- demo track + in-session checks + preview (issue #6) ---
  const TRACK = "demo-agent";
  interface Step { slug: string; title: string; assignment: string }
  let steps = $state<Step[]>([]);
  let curStep = $state(0);
  let checkHint = $state("");
  let checkOk = $state<boolean | null>(null);
  let previewState = $state<{ ready: boolean; url?: string; hint?: string }>({ ready: false });
  async function loadTrack() {
    try {
      const r = await fetch(`${API}/api/tracks/${TRACK}`);
      if (r.ok) steps = (await r.json()).steps;
    } catch { /* track panel stays empty */ }
  }
  async function runCheck() {
    if (!steps[curStep]) return;
    checkHint = "running…";
    checkOk = null;
    const r = await fetch(`${API}/api/playgrounds/${id}/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ track: TRACK, step: steps[curStep].slug }),
    });
    const body = await r.json();
    if (!r.ok) { checkHint = body.error; return; }
    if (body.pass) { checkOk = true; checkHint = `PASS ✓ — step ${curStep + 1} of ${steps.length}`; if (curStep < steps.length - 1) curStep++; }
    else { checkOk = false; checkHint = "FAIL: " + body.failures.map((f: { hint: string }) => f.hint).join(" · "); }
  }
  // --- isolated grading (issue #10): submit → official verdict ---
  let gradeInfo = $state("");
  async function submitGrade() {
    if (!steps[curStep] || !confirm("Submit for official grading? (frozen snapshot, immutable record)")) return;
    gradeInfo = "grading…";
    const r = await fetch(`${API}/api/playgrounds/${id}/grade`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ track: TRACK, step: steps[curStep].slug }),
    });
    const body = await r.json();
    gradeInfo = !r.ok ? body.error
      : body.grade.pass ? `official: PASS ✓ · verdict ${body.grade.verdictHash.slice(0, 12)}`
      : `official: FAIL — ${body.grade.failures.map((f: { hint: string }) => f.hint).join(" · ")} · ${body.grade.verdictHash.slice(0, 12)}`;
  }
  async function unlockSolution() {
    if (!steps[curStep] || !confirm("Show the solution? (recorded as an unlock)")) return;
    const r = await fetch(`${API}/api/playgrounds/${id}/solve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ track: TRACK, step: steps[curStep].slug, confirm: true }),
    });
    const body = await r.json();
    checkHint = r.ok ? "solution applied — review the files, then Check" : body.error;
    if (r.ok) { openPath = null; listFiles(); }
  }
  // Minimal assignment renderer: fenced blocks, # headings, `code`, **bold**.
  function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function renderMd(md: string): string {
    const parts = md.split(/```(\w*)\n?/);
    let html = "";
    for (let i = 0; i < parts.length; i++) {
      if (i % 3 === 2) { html += `<pre>${esc(parts[i])}</pre>`; continue; }
      if (i % 3 === 0) {
        html += esc(parts[i])
          .replace(/^### (.*)$/gm, "<b>$1</b>")
          .replace(/^## (.*)$/gm, "<b>$1</b>")
          .replace(/^# (.*)$/gm, "<b>$1</b>")
          .replace(/`([^`]+)`/g, "<code>$1</code>")
          .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
          .split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
      }
    }
    return html;
  }
  async function pollPreview() {
    if (runTab !== "Preview") return;
    try {
      const r = await fetch(`${API}/api/playgrounds/${id}/preview?port=3000`);
      if (r.ok) previewState = await r.json();
    } catch { /* retry next tick */ }
  }
  setInterval(pollPreview, 5000);

  // --- learner notices (issue #8): reset/extend/announce toasts ---
  let toast = $state("");
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  function showToast(msg: string) {
    toast = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ""), 6000);
  }
  // --- agent broker (issue #9): approvals + live trace + audit ---
  interface AgentResult { tool: string; ok: boolean; output: string }
  let agentTrace = $state<AgentResult[]>([]);
  let agentStatus = $state("");
  let agentPending = $state<{ callId: string; tool: string; args: unknown; reason: string }[]>([]);
  let agentAudit = $state<{ seq: number; tool: string; decision: string; argsPreview: string; outputPreview?: string }[]>([]);
  async function refreshAgent() {
    const [p, a] = await Promise.all([
      fetch(`${API}/api/playgrounds/${id}/agent/pending`),
      fetch(`${API}/api/playgrounds/${id}/agent/audit`),
    ]);
    if (p.ok) agentPending = (await p.json()).pending;
    if (a.ok) agentAudit = (await a.json()).audit;
  }
  async function agentFix() {
    agentStatus = "running…";
    const r = await fetch(`${API}/api/playgrounds/${id}/agent/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: [
        { tool: "fs.write", args: { path: "src/app.ts", content: "export const healthz = () => ({ ok: true });\n" } },
        { tool: "checks.run", args: { track: TRACK, step: "01-scaffold" } },
      ]}),
    });
    const body = await r.json();
    agentTrace = body.results ?? [];
    agentStatus = body.status ?? "";
    listFiles();
    refreshAgent();
  }
  async function decide(callId: string, approve: boolean) {
    const r = await fetch(`${API}/api/playgrounds/${id}/agent/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callId, approve }),
    });
    const body = await r.json();
    agentTrace = body.results ?? agentTrace;
    agentStatus = body.status ?? agentStatus;
    listFiles();
    refreshAgent();
  }
  async function pollNotices() {
    try {
      const r = await fetch(`${API}/api/playgrounds/${id}/notices`);
      if (!r.ok) return;
      const body = await r.json();
      for (const n of body.notices) {
        showToast(n.message);
        if (n.kind === "reset") { openPath = null; listFiles(); }
      }
    } catch { /* retry next tick */ }
  }
  setInterval(pollNotices, 15000);
  $effect(() => { if (runTab === "Agent") refreshAgent(); });

  onMount(() => {
    loadSession().then(() => { listFiles(); attachTerm("Term 1"); loadTrack(); });
    view = new EditorView({
      state: EditorState.create({
        doc: "// open a file from the explorer →\n",
        extensions: [
          keymap.of([{ key: "Mod-s", run: () => { saveFile(); return true; } }]),
          javascript(),
          oneDark,
          EditorView.updateListener.of((u) => { if (u.docChanged) dirty = true; }),
        ],
      }),
      parent: editorEl!,
    });
    heartbeat();
    return () => {};
  });
  onDestroy(() => {
    view?.destroy();
    for (const t of Object.values(termObjs)) { try { t.ws.close(); } catch {} t.term.dispose(); }
  });
</script>

<div class="win">
  <header class="hdr">
    <div class="l"><span class="logo">R</span><span class="title">playground › {id.slice(0, 8)}</span></div>
    <div class="r">
      <span class="dot" style:background={pg?.status === "active" ? "#22c55e" : "#f59e0b"}></span>
      <span class="timer">{ttlText}</span>
      <button class="ibtn" onclick={() => (runTab = "Preview")}>⛁ snapshot</button>
      <button class="ibtn danger" onclick={() => confirm("Destroy this playground?") && fetch(`${API}/api/playgrounds/${id}`, { method: "DELETE" }).then(() => location.assign("/"))}>⏻ stop</button>
      <span class="avatar"></span>
    </div>
  </header>
  <div class="tabs">
    <div class="grp L"><span class="lbl">Learn</span><span class="tab static">Instructions</span><span class="tab static">IDE</span></div>
    <div class="grp R"><span class="lbl">Run</span>{#each terms as t}<button class="tab" class:active={runTab === t} onclick={() => { runTab = t; setTimeout(() => attachTerm(t), 0); }}>{t}</button>{/each}<button class="tab" class:active={runTab === "Preview"} onclick={() => (runTab = "Preview")}>Preview</button><button class="tab" class:active={runTab === "Agent"} onclick={() => (runTab = "Agent")}>Agent</button><button class="add" onclick={addTerm}>+</button></div>
  </div>
  <div class="dock" class:noL={hideLearn} class:noR={hideRun}>
    <section class="steps">
      <div class="colbar">Learn <button onclick={() => (hideLearn = true)}>⟨ hide</button></div>
      <div class="body">
        {#if loadError}<p style="color:#b91c1c">{loadError}</p>{/if}
        <div class="meta">demo-agent · {steps.length ? `step ${curStep + 1} of ${steps.length}` : "free playground"}</div>
        {#each steps as s, i}
          <div class="step" class:cur={i === curStep} onclick={() => (curStep = i, checkHint = "", checkOk = null)}>{s.title}</div>
        {/each}
        {#if steps[curStep]}<div class="assign">{@html renderMd(steps[curStep].assignment)}</div>{/if}
      </div>
      <div class="checkbar">
        <button onclick={runCheck}>Check ✓</button>
        {#if checkHint}<div class="hint" style:display="block" style:background={checkOk ? "#dcfce7" : "#fef9c3"} style:border-color={checkOk ? "#86efac" : "#fde047"}>{checkHint}</div>{/if}
        <div style="margin-top:8px;text-align:center"><a href="#" style="font-size:12px;color:#64748b" onclick={(e) => (e.preventDefault(), unlockSolution())}>stuck? unlock the solution</a></div>
        <button style="margin-top:8px;background:#fff;color:var(--ink);border:1px solid var(--ink)" onclick={submitGrade}>Submit for grade</button>
        {#if gradeInfo}<div class="hint" style:display="block">{gradeInfo}</div>{/if}
      </div>
    </section>
    <section class="ide">
      <div class="actbar"><button class="act active">🗀</button></div>
      <div class="side">
        <div class="fh">Explorer</div>
        {#each files as f}
          <div class="file" class:sel={openPath === f.path} onclick={() => f.type === "dir" ? (cwd = f.path, listFiles()) : openFile(f.path)}>{f.type === "dir" ? "▸ " : ""}{f.path.split("/").pop()}</div>
        {/each}
        {#if cwd}<div class="file" onclick={() => (cwd = "", listFiles())}>‹ .. root</div>{/if}
        <div class="fh" style="margin-top:10px">Project</div>
        <div class="file" onclick={resetProject}>⟲ reset project</div>
      </div>
      <div class="ed">
        <div class="edtab"><span>{dirty ? "● " : ""}{openPath ?? "no file open"}</span>{#if openPath}<a href="#" onclick={(e) => (e.preventDefault(), loadDiff())}>diff</a><a href="#" onclick={(e) => (e.preventDefault(), resetFile())}>reset file</a>{/if}<span style="margin-left:auto;color:#858585">{fileNotice}</span></div>
        {#if showDiff}<pre class="diff">{diffText}</pre>{/if}
        <div class="code" bind:this={editorEl}></div>
      </div>
    </section>
    <section class="right">
      <div class="colbar" style="border-bottom:1px solid #222">Run <button onclick={() => (hideRun = true)}>hide ⟩</button></div>
      {#each terms as t}
        <div class="rpane term" class:on={runTab === t}><div class="termwrap" bind:this={termEls[t]}></div></div>
      {/each}
      <div class="rpane" class:on={runTab === "Preview"}>
        {#if previewState.ready}
          <iframe title="app preview" src={previewState.url} style="flex:1;border:0;background:#fff" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
        {:else}
          <div class="prev">◷ {previewState.hint ?? "waiting for :3000 — start your app, this pane goes live"}<br /><span style="font-size:12px">signed URL · 60s TTL · auto-retries every 5s</span></div>
        {/if}
      </div>
      <div class="rpane" class:on={runTab === "Agent"}>
        <div class="agent"><b>Lab agent</b>
          <div class="apolicy">file ✓ allowed · shell ⚠ approval · network/creds ⛔ forbidden</div>
          <button class="abtn" onclick={() => { runTab = "Agent"; agentFix(); }}>✨ fix step 1 with the agent</button>
          {#if agentStatus}<p style="color:#94a3b8">run: {agentStatus}</p>{/if}
          {#each agentPending as p}
            <div class="approve">{p.tool} needs approval — {p.reason}<br /><code>{JSON.stringify(p.args).slice(0, 160)}</code><br />
              <button class="abtn ok" onclick={() => decide(p.callId, true)}>allow</button>
              <button class="abtn no" onclick={() => decide(p.callId, false)}>deny</button>
            </div>
          {/each}
          {#each agentTrace as t}<div class="trace {t.ok ? '' : 'bad'}"><b>{t.tool}</b> {t.ok ? "✓" : "✗"} — {t.output.slice(0, 200)}</div>{/each}
          {#if agentAudit.length}<div class="fh" style="margin-top:10px;color:#888;font-size:11px">AUDIT (redacted)</div>{#each agentAudit.slice(-8) as a}<div class="trace">#{a.seq} {a.tool} [{a.decision}] {a.argsPreview.slice(0, 120)}</div>{/each}{/if}
        </div>
      </div>
    </section>
  </div>
</div>
{#if toast}<div class="toast show">{toast}</div>{/if}
<button class="fab" id="fabL" style:display={hideLearn ? "block" : "none"} onclick={() => (hideLearn = false)}>⟩</button>
<button class="fab" id="fabR" style:display={hideRun ? "block" : "none"} onclick={() => (hideRun = false)}>⟨</button>

<style>
  :root{--header-bg:#edeff4;--tabbar-bg:#b6dcf7;--ink:#18252f;--font:Inter,ui-sans-serif,system-ui,sans-serif;--mono:"Source Code Pro",ui-monospace,Menlo,Consolas,monospace}
  .win{display:flex;flex-direction:column;height:100vh;font-family:var(--font);font-size:14px;background:#000;color:#e6e6e6}
  .hdr{display:flex;align-items:center;justify-content:space-between;height:56px;padding:0 20px;background:var(--header-bg);color:var(--ink);flex:none}
  .hdr .l,.hdr .r{display:flex;align-items:center;gap:12px}
  .logo{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:4px;background:#1a1a1a;color:#fff;font-weight:800}
  .title{font-size:19px;font-weight:700}
  .dot{width:12px;height:12px;border-radius:99px;background:#22c55e}
  .timer{font-family:var(--mono);font-size:15px}
  .ibtn{border:0;background:transparent;color:var(--ink);border-radius:6px;padding:6px 8px;font-size:14px;cursor:pointer}
  .ibtn:hover{background:#dde3eb}.ibtn.danger{color:#ef4444}
  .avatar{width:32px;height:32px;border-radius:99px;background:radial-gradient(circle at 50% 35%,#c79a76 0 32%,#7b4a34 33% 60%,#2b2b2b 61%);border:1px solid #cbd5e1}
  .tabs{display:flex;align-items:center;gap:8px;height:52px;padding:0 16px;background:var(--tabbar-bg);flex:none}
  .grp{display:flex;align-items:center;gap:8px}.grp.L{width:32%}.grp.R{flex:1;overflow-x:auto}
  .lbl{font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.06em}
  .tab{display:inline-flex;align-items:center;height:34px;padding:0 12px;border:1px solid #cbd5e1;border-radius:99px;background:#fff;color:#334155;font-size:14px;cursor:pointer;white-space:nowrap}
  .tab.active{background:var(--ink);color:#fff;border-color:var(--ink)}
  .tab.static{font-weight:700}
  .add{border:1px dashed #64748b;background:transparent;color:#334155;border-radius:99px;width:34px;height:34px;font-size:18px;cursor:pointer;flex:none}
  .dock{flex:1;display:grid;grid-template-columns:minmax(260px,32%) 1fr 1.2fr;min-height:0}
  .dock.noL{grid-template-columns:0 1fr 1.2fr}.dock.noR{grid-template-columns:minmax(260px,32%) 1fr 0}
  .dock.noL .steps,.dock.noR .right{display:none}
  .colbar{display:flex;align-items:center;gap:6px;padding:6px 10px;font-size:11px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em}
  .colbar button{margin-left:auto;background:none;border:1px solid #475569;color:#cbd5e1;border-radius:6px;font-size:12px;cursor:pointer;padding:2px 8px}
  .steps .colbar{color:#64748b;border-bottom:1px solid #e2e8f0}
  .steps .colbar button{border-color:#cbd5e1;color:#475569}
  .fab{position:fixed;top:120px;z-index:6;background:var(--ink);color:#fff;border:0;padding:10px 6px;font-size:13px;cursor:pointer}
  .fab#fabL{left:0;border-radius:0 8px 8px 0}.fab#fabR{right:0;border-radius:8px 0 0 8px}
  .steps{background:#f8fafc;color:var(--ink);border-right:1px solid #cbd5e1;display:flex;flex-direction:column;min-height:0}
  .steps .body{padding:14px 16px;overflow:auto;flex:1}
  .steps .meta{font-size:12px;color:#64748b;margin-bottom:8px}
  .assign{font-size:13.5px;line-height:1.5}.assign code{background:#e2e8f0;padding:1px 5px;border-radius:4px}
  .assign pre{background:#0f172a;color:#e2e8f0;padding:10px;border-radius:8px;font-family:var(--mono);font-size:12px;overflow:auto}
  .step{padding:8px 10px;border-radius:8px;margin-bottom:4px;font-size:14px;cursor:pointer}
  .step.cur{background:var(--ink);color:#fff}
  .hint{margin-top:10px;font-size:13px;border:1px solid;border-radius:8px;padding:8px 10px}
  .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#18252f;color:#fff;padding:10px 18px;border-radius:8px;z-index:20}
  .checkbar{padding:12px 16px;border-top:1px solid #cbd5e1;background:#fff}
  .checkbar button{width:100%;padding:10px;border:0;border-radius:8px;background:var(--ink);color:#fff;font-size:15px;font-weight:700;cursor:pointer}
  .checkbar button:disabled{opacity:.45;cursor:not-allowed}
  .ide{background:#181818;display:flex;min-height:0;min-width:0}
  .actbar{width:46px;background:#111;display:flex;flex-direction:column;align-items:center;padding:8px 0;gap:6px;flex:none}
  .act{width:34px;height:34px;display:grid;place-items:center;border-radius:8px;color:#fff;background:#222;border:0;font-size:15px}
  .side{width:170px;background:#141414;border-right:1px solid #2a2a2a;flex:none;padding:10px;font-size:13px;overflow:auto}
  .fh{color:#888;font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin:4px 0}
  .file{font-family:var(--mono);padding:3px 8px;border-radius:6px;cursor:pointer;color:#ccc;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .file.sel{background:#2a2d2e;color:#fff}
  .ed{flex:1;background:#1f1f1f;display:flex;flex-direction:column;min-width:0}
  .edtab{padding:8px 12px;font-size:13px;font-family:var(--mono);border-bottom:1px solid #2a2a2a;display:flex;gap:10px;align-items:center}
  .edtab a{color:#93c5fd}
  .code{flex:1;overflow:auto}
  .code :global(.cm-editor){height:100%}
  .diff{margin:0;padding:10px 12px;font-family:var(--mono);font-size:12px;background:#0f172a;color:#e2e8f0;max-height:180px;overflow:auto;white-space:pre-wrap}
  .right{background:#080808;display:flex;flex-direction:column;min-height:0;min-width:0}
  .rpane{flex:1;min-height:0;overflow:auto;display:none}
  .rpane.on{display:flex;flex-direction:column}
  .termwrap{flex:1;min-height:0;padding:8px}
  .termwrap :global(.xterm){height:100%}
  .prev{margin:12px;border:1px dashed #475569;border-radius:8px;min-height:200px;display:grid;place-items:center;color:#94a3b8;text-align:center;padding:16px}
  .agent{padding:14px;font-size:13px;overflow:auto}
  .apolicy{background:#1e293b;border-radius:8px;padding:8px 10px;margin:8px 0;font-size:12.5px}
  .abtn{background:#334155;color:#fff;border:0;border-radius:6px;padding:6px 12px;font-weight:700;cursor:pointer;margin:4px 4px 4px 0}
  .abtn.ok{background:#16a34a}.abtn.no{background:#7f1d1d}
  .approve{border:1px solid #f59e0b;border-radius:8px;padding:8px 10px;margin-top:8px;font-size:12.5px}
  .approve code{font-size:11px;color:#94a3b8}
  .trace{font-family:var(--mono);font-size:11.5px;color:#a5b4fc;margin-top:6px;word-break:break-word}
  .trace.bad{color:#fca5a5}
</style>
