<script lang="ts">
  import "../../../app.css";
  import { page } from "$app/stores";
  import { onMount, onDestroy } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView, keymap } from "@codemirror/view";
  import { javascript } from "@codemirror/lang-javascript";
  import { oneDark } from "@codemirror/theme-one-dark";
  // xterm is client-only (CommonJS, needs DOM): dynamic-import inside onMount.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let XTerm: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let FitAddonCls: any = null;

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
  let loading = $state(true);
  let loadError = $state("");
  let ttlText = $state("--");
  let ttlUrgent = $state(false);
  async function loadSession() {
    loading = true;
    loadError = "";
    try {
      const r = await fetch(`${API}/api/playgrounds/${id}`);
      if (r.status === 404) throw new Error("gone — it expired or was stopped");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      pg = await r.json();
      tickTtl();
    } catch (e) {
      loadError = `couldn't load this playground (${(e as Error).message})`;
    } finally {
      loading = false;
    }
  }
  function tickTtl() {
    if (!pg?.expiresAt) return;
    const ms = Date.parse(pg.expiresAt) - Date.now();
    if (ms <= 0) { ttlText = "expired"; ttlUrgent = true; return; }
    ttlUrgent = ms < 15 * 60_000;
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
  let pendingPath = $state<string | null>(null);
  async function openFile(path: string) {
    if (dirty && openPath !== path) { pendingPath = path; return; }
    const r = await fetch(`${API}/api/playgrounds/${id}/files/content?path=${encodeURIComponent(path)}`);
    if (!r.ok) { fileNotice = `cannot open ${path}`; return; }
    const body = await r.json();
    openPath = path;
    showDiff = false;
    fileNotice = body.truncated ? "large file — showing first 256KB" : "";
    view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: body.content } });
    // the dispatch above fires the updateListener synchronously; clear afterwards
    dirty = false;
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
  let confirmResetFile = $state(false);
  let confirmResetProject = $state(false);
  let confirmStop = $state(false);
  async function resetFile() {
    if (!openPath || !confirmResetFile) return;
    confirmResetFile = false;
    const r = await fetch(`${API}/api/playgrounds/${id}/files/reset`, {
      method: "PUT" in {} ? "POST" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: openPath }),
    });
    if (r.ok) { openFile(openPath); fileNotice = "file reset to starter ✓"; }
    else fileNotice = `reset failed: ${(await r.json()).error}`;
  }
  async function resetProject() {
    if (!confirmResetProject) return;
    confirmResetProject = false;
    const r = await fetch(`${API}/api/playgrounds/${id}/files/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (r.ok) { openPath = null; showDiff = false; listFiles(); fileNotice = "project reset ✓"; }
  }

  // --- terminals (one xterm per term tab, shared session) ---
  let termEls = $state<Record<string, HTMLDivElement | null>>({});
  let termState = $state<Record<string, "connecting" | "connected" | "disconnected">>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let termObjs: Record<string, { term: any; ws: WebSocket; fit: any }> = {};
  function wsUrl(term: string) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws/terminal?session=${id}&term=${encodeURIComponent(term)}`;
  }
  function refitTerms() {
    for (const t of Object.values(termObjs)) {
      try { t.fit.fit(); } catch { /* hidden tab: refit on show */ }
    }
  }
  function reconnectTerm(name: string) {
    const old = termObjs[name];
    if (old) { try { old.ws.close(); } catch {} delete termObjs[name]; }
    setTimeout(() => attachTerm(name, true), 0);
  }
  async function attachTerm(name: string, force = false) {
    const el = termEls[name];
    if (!el || (termObjs[name] && !force)) return;
    if (termObjs[name] && force) delete termObjs[name];
    if (!XTerm) {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      XTerm = Terminal; FitAddonCls = FitAddon;
      await import("@xterm/xterm/css/xterm.css");
    }
    const term = new XTerm({ fontFamily: '"Source Code Pro",ui-monospace,Menlo,monospace', fontSize: 13, theme: { background: "#080808" } });
    const fit = new FitAddonCls();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    const ws = new WebSocket(wsUrl(name));
    termState[name] = "connecting";
    ws.onopen = () => { termState[name] = "connected"; };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === "data") term.write(m.data);
        else if (m.type === "error") term.writeln(`\r\n[relay: ${m.error}]`);
      } catch { term.write(e.data); }
    };
    ws.onclose = () => { termState[name] = "disconnected"; term.writeln("\r\n[disconnected — hit ⟳ reconnect]"); };
    term.onData((d: string) => { if (ws.readyState === 1) ws.send(JSON.stringify({ data: d })); });
    termObjs[name] = { term, ws, fit };
  }
  function showRunTab(name: string) {
    runTab = name;
    // xterm needs a visible element to measure: refit after paint.
    requestAnimationFrame(() => requestAnimationFrame(refitTerms));
  }
  function addTerm() {
    const n = `Term ${terms.length + 1}`;
    terms = [...terms.slice(0, 1), n, ...terms.slice(1)];
    showRunTab(n);
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
  let checking = $state(false);
  let passedSteps = $state<Set<string>>(new Set());
  async function runCheck() {
    if (!steps[curStep] || checking) return;
    checking = true;
    checkHint = "running…";
    checkOk = null;
    const r = await fetch(`${API}/api/playgrounds/${id}/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ track: TRACK, step: steps[curStep].slug }),
    });
    try {
      const body = await r.json();
      if (!r.ok) { checkHint = body.error; return; }
      if (body.pass) {
        checkOk = true;
        passedSteps = new Set([...passedSteps, steps[curStep].slug]);
        checkHint = `PASS ✓ — step ${curStep + 1} of ${steps.length}`;
        if (curStep < steps.length - 1) curStep++;
      }
      else { checkOk = false; checkHint = "FAIL: " + body.failures.map((f: { hint: string }) => f.hint).join(" · "); }
    } finally {
      checking = false;
    }
  }
  // --- isolated grading (issue #10): submit → official verdict ---
  let gradeInfo = $state("");
  let grading = $state(false);
  let confirmGrade = $state(false);
  async function submitGrade() {
    if (!steps[curStep] || grading) return;
    if (!confirmGrade) { confirmGrade = true; return; }
    confirmGrade = false;
    grading = true;
    gradeInfo = "grading…";
    const r = await fetch(`${API}/api/playgrounds/${id}/grade`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ track: TRACK, step: steps[curStep].slug }),
    });
    try {
      const body = await r.json();
      gradeInfo = !r.ok ? body.error
        : body.grade.pass ? `official: PASS ✓ · verdict ${body.grade.verdictHash.slice(0, 12)}`
        : `official: FAIL — ${body.grade.failures.map((f: { hint: string }) => f.hint).join(" · ")} · ${body.grade.verdictHash.slice(0, 12)}`;
    } finally {
      grading = false;
    }
  }
  let confirmSolve = $state(false);
  async function unlockSolution() {
    if (!steps[curStep]) return;
    if (!confirmSolve) { confirmSolve = true; return; }
    confirmSolve = false;
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
  /** Audit UI never shows file bodies: replace `content` with its size, truncate the rest. */
  function auditArgs(raw: string): string {
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      if (typeof o.content === "string") o.content = `‹${o.content.length} chars›`;
      raw = JSON.stringify(o);
    } catch {
      // preview may be truncated JSON: blank out whatever follows "content":
      raw = raw.replace(/("content":\s*")[^"]*"?/, "$1‹hidden›\"");
    }
    return raw.length > 80 ? raw.slice(0, 80) + "…" : raw;
  }
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

  function fileIcon(name: string, type: string): string {
    if (type === "dir") return "▸";
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (["ts", "js", "svelte"].includes(ext)) return "◈";
    if (["py"].includes(ext)) return "⬣";
    if (["md", "txt"].includes(ext)) return "☰";
    if (["json", "yaml", "yml", "toml"].includes(ext)) return "⚙";
    if (["css", "html"].includes(ext)) return "◫";
    return "◦";
  }
  onMount(() => {
    loadSession().then(() => { listFiles(); attachTerm("Term 1"); loadTrack(); });
    if (typeof window !== "undefined") window.addEventListener("resize", refitTerms);
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
    if (typeof window !== "undefined") window.removeEventListener("resize", refitTerms);
    view?.destroy();
    for (const t of Object.values(termObjs)) { try { t.ws.close(); } catch {} t.term.dispose(); }
  });
</script>

<div class="win">
  <header class="hdr">
    <div class="l"><span class="logo">R</span><span class="title">playground › {id.slice(0, 8)}</span></div>
    <div class="r">
      <span class="dot" style:background={pg?.status === "active" ? "#22c55e" : "#f59e0b"}></span>
      <span class="timer" class:urgent={ttlUrgent} title={ttlUrgent ? "less than 15 minutes left — save your work" : "time remaining"}>{ttlText}</span>
      <button class="ibtn" onclick={() => showRunTab("Preview")}>⛁ snapshot</button>
      {#if confirmStop}
        <span class="confirm-inline">stop this playground? <button class="ibtn danger" onclick={() => fetch(`${API}/api/playgrounds/${id}`, { method: "DELETE" }).then(() => location.assign("/"))}>yes, stop</button> <button class="ibtn" onclick={() => (confirmStop = false)}>keep</button></span>
      {:else}
        <button class="ibtn danger" onclick={() => (confirmStop = true)}>⏻ stop</button>
      {/if}
      <span class="avatar"></span>
    </div>
  </header>
  <div class="tabs">
    <div class="grp L"><span class="lbl">Learn</span><span class="tab static">Instructions</span><span class="tab static">IDE</span></div>
    <div class="grp R"><span class="lbl">Run</span>{#each terms as t}<button class="tab" class:active={runTab === t} onclick={() => { showRunTab(t); setTimeout(() => attachTerm(t), 0); }}>{t}</button>{/each}<button class="tab" class:active={runTab === "Preview"} onclick={() => showRunTab("Preview")}>Preview</button><button class="tab" class:active={runTab === "Agent"} onclick={() => showRunTab("Agent")}>Agent</button><button class="add" onclick={addTerm}>+</button></div>
  </div>
  <div class="dock" class:noL={hideLearn} class:noR={hideRun}>
    <section class="steps">
      <div class="colbar">Learn <button onclick={() => (hideLearn = true)}>⟨ hide</button></div>
      <div class="body">
        {#if loading}
          <div class="skel"></div><div class="skel" style="width:70%"></div><div class="skel" style="width:85%"></div>
        {:else if loadError}
          <p style="color:#b91c1c">{loadError}</p>
          <p><button class="retry" onclick={loadSession}>↻ retry</button> <a href="/">← start a fresh playground</a></p>
        {/if}
        <div class="meta">demo-agent · {steps.length ? `step ${curStep + 1} of ${steps.length}` : "free playground"}</div>
        {#each steps as s, i}
          <div class="step" class:cur={i === curStep} onclick={() => (curStep = i, checkHint = "", checkOk = null)}><span class="tick">{passedSteps.has(s.slug) ? "✓ " : ""}</span>{s.title}</div>
        {/each}
        {#if steps[curStep]}<div class="assign">{@html renderMd(steps[curStep].assignment)}</div>
        {/if}
      </div>
      <div class="checkbar">
        <button onclick={runCheck} disabled={checking}>{checking ? "checking…" : "Check ✓"}</button>
        {#if checkHint}<div class="hint" style:display="block" style:background={checkOk ? "#dcfce7" : "#fef9c3"} style:border-color={checkOk ? "#86efac" : "#fde047"}>{checkHint}</div>{/if}
        <div style="margin-top:8px;text-align:center">
          {#if confirmSolve}
            <span style="font-size:12px">show solution? it's recorded. <a href="#" onclick={(e) => (e.preventDefault(), unlockSolution())}>yes</a> · <a href="#" onclick={(e) => (e.preventDefault(), confirmSolve = false)}>no</a></span>
          {:else}
            <a href="#" style="font-size:12px;color:#64748b" onclick={(e) => (e.preventDefault(), unlockSolution())}>stuck? unlock the solution</a>
          {/if}
        </div>
        {#if confirmGrade}
          <p style="font-size:12px;text-align:center">frozen snapshot, immutable record. <button class="mini" onclick={submitGrade}>submit</button> <button class="mini ghost" onclick={() => (confirmGrade = false)}>cancel</button></p>
        {:else}
          <button style="margin-top:8px;background:#fff;color:var(--ink);border:1px solid var(--ink)" onclick={submitGrade} disabled={grading}>{grading ? "grading…" : "Submit for grade"}</button>
        {/if}
        {#if gradeInfo}<div class="hint" style:display="block">{gradeInfo}</div>{/if}
      </div>
    </section>
    <section class="ide">
      <div class="actbar"><button class="act active">🗀</button></div>
      <div class="side">
        <div class="fh">Explorer</div>
        {#if cwd}<div class="crumb" onclick={() => (cwd = "", listFiles())}>‹ {cwd || "root"}</div>{/if}
        {#each files as f}
          <div class="file" class:sel={openPath === f.path} title={f.path} onclick={() => f.type === "dir" ? (cwd = f.path, listFiles()) : openFile(f.path)}><span class="fic">{fileIcon(f.path.split("/").pop() ?? "", f.type)}</span>{f.path.split("/").pop()}</div>
        {/each}
        <div class="fh" style="margin-top:10px">Project</div>
        {#if confirmResetProject}
          <div class="file warn">reset all? <a href="#" onclick={(e) => (e.preventDefault(), resetProject())}>yes</a> · <a href="#" onclick={(e) => (e.preventDefault(), confirmResetProject = false)}>no</a></div>
        {:else}
          <div class="file" onclick={() => (confirmResetProject = true)}>⟲ reset project</div>
        {/if}
      </div>
      <div class="ed">
        <div class="edtab"><span>{dirty ? "● " : ""}{openPath ?? "no file open"}</span>{#if openPath}<button class="savebtn" onclick={saveFile} disabled={!dirty}>save ⌘S</button><a href="#" onclick={(e) => (e.preventDefault(), loadDiff())}>diff</a>{#if confirmResetFile}<span>reset? <a href="#" onclick={(e) => (e.preventDefault(), resetFile())}>yes</a> · <a href="#" onclick={(e) => (e.preventDefault(), confirmResetFile = false)}>no</a></span>{:else}<a href="#" onclick={(e) => (e.preventDefault(), confirmResetFile = true)}>reset file</a>{/if}{/if}<span style="margin-left:auto;color:#858585">{fileNotice}</span></div>
        {#if showDiff}<pre class="diff">{diffText}</pre>{/if}
        <div class="code" bind:this={editorEl}></div>
      </div>
    </section>
    <section class="right">
      <div class="colbar" style="border-bottom:1px solid #222">Run <button onclick={() => (hideRun = true)}>hide ⟩</button></div>
      {#each terms as t}
        <div class="rpane term" class:on={runTab === t}><div class="termbar"><span class="tstate {termState[t] ?? 'connecting'}">● {termState[t] ?? "connecting"}</span><button class:alert={termState[t] === "disconnected"} onclick={() => reconnectTerm(t)} title="reconnect shell">⟳ reconnect</button></div><div class="termwrap" bind:this={termEls[t]}></div></div>
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
          <button class="abtn" onclick={() => { showRunTab("Agent"); agentFix(); }}>✨ fix step 1 with the agent</button>
          {#if agentStatus}<p style="color:#94a3b8">run: {agentStatus}</p>{/if}
          {#each agentPending as p}
            <div class="approve">{p.tool} needs approval — {p.reason}<br /><code>{JSON.stringify(p.args).slice(0, 160)}</code><br />
              <button class="abtn ok" onclick={() => decide(p.callId, true)}>allow</button>
              <button class="abtn no" onclick={() => decide(p.callId, false)}>deny</button>
            </div>
          {/each}
          {#each agentTrace as t}<div class="trace {t.ok ? '' : 'bad'}"><b>{t.tool}</b> {t.ok ? "✓" : "✗"} — {t.output.slice(0, 200)}</div>{/each}
          {#if agentAudit.length}<div class="fh" style="margin-top:10px;color:#888;font-size:11px">AUDIT (redacted)</div>{#each agentAudit.slice(-8) as a}<div class="trace">#{a.seq} {a.tool} [{a.decision}] {auditArgs(a.argsPreview)}</div>{/each}{/if}
        </div>
      </div>
    </section>
  </div>
</div>
{#if pendingPath}
  <div class="modal-veil" onclick={() => (pendingPath = null)}></div>
  <div class="modal" role="dialog" aria-label="unsaved changes">
    <b>Unsaved changes</b>
    <p>{openPath} has unsaved edits. Save first, or discard them?</p>
    <button class="mini" onclick={() => { saveFile(); pendingPath = null; }}>save</button>
    <button class="mini ghost" onclick={() => { dirty = false; const p = pendingPath; pendingPath = null; if (p) openFile(p); }}>discard</button>
    <button class="mini ghost" onclick={() => (pendingPath = null)}>cancel</button>
  </div>
{/if}
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
  .timer.urgent{color:#b91c1c;font-weight:800}
  .confirm-inline{font-size:13px}
  .retry{background:var(--ink);color:#fff;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:700}
  .skel{height:12px;border-radius:6px;background:linear-gradient(90deg,#e2e8f0,#f1f5f9,#e2e8f0);margin-bottom:8px}
  .tick{color:#16a34a;font-weight:800}
  .step.cur .tick{color:#bbf7d0}
  .crumb{font-family:var(--mono);font-size:12px;color:#93c5fd;cursor:pointer;padding:3px 8px}
  .fic{display:inline-block;width:18px;color:#858585}
  .file.warn{color:#fca5a5}
  .savebtn{background:#2f81f7;color:#fff;border:0;border-radius:6px;font-size:12px;font-weight:700;padding:3px 10px;cursor:pointer}
  .savebtn:disabled{opacity:.4;cursor:default}
  .mini{background:var(--ink);color:#fff;border:0;border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer}
  .mini.ghost{background:transparent;color:#64748b;border:1px solid #cbd5e1}
  .termbar{display:flex;align-items:center;justify-content:space-between;padding:4px 10px;font-size:11px;color:#858585;text-transform:uppercase;letter-spacing:.06em;flex:none}
  .termbar button{background:none;border:1px solid #333;color:#aaa;border-radius:6px;cursor:pointer;font-size:12px;padding:1px 8px}
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
  .dock{flex:1;display:grid;grid-template-columns:minmax(240px,26%) minmax(0,1fr) minmax(0,1.5fr);min-height:0}
  .dock.noL{grid-template-columns:0 minmax(0,1fr) minmax(0,1.5fr)}.dock.noR{grid-template-columns:minmax(240px,26%) minmax(0,1fr) 0}
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
  .modal-veil{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:30}
  .modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;color:var(--ink);border-radius:12px;padding:20px 24px;z-index:31;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,.35)}
  .modal p{font-size:13px;color:#475569}
  .modal button{margin-right:8px}
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
  .edtab{flex-wrap:wrap;row-gap:4px;white-space:nowrap;padding:8px 12px;font-size:13px;font-family:var(--mono);border-bottom:1px solid #2a2a2a;display:flex;gap:10px;align-items:center}
  .edtab a{color:#93c5fd}
  .code{flex:1;overflow:auto}
  .code :global(.cm-editor){height:100%}
  .diff{margin:0;padding:10px 12px;font-family:var(--mono);font-size:12px;background:#0f172a;color:#e2e8f0;max-height:180px;overflow:auto;white-space:pre-wrap}
  .right{background:#080808;display:flex;flex-direction:column;min-height:0;min-width:0}
  .rpane{flex:1;min-height:0;overflow:auto;display:none}
  .rpane.on{display:flex;flex-direction:column}
  .tstate{text-transform:none;letter-spacing:0}.tstate.connected{color:#22c55e}.tstate.disconnected{color:#ef4444}.tstate.connecting{color:#eab308}
  .termbar button.alert{border-color:#ef4444;color:#fca5a5}
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
