<script lang="ts">
  import "../../../app.css";
  import { page } from "$app/stores";
  import { onMount, onDestroy } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView, keymap } from "@codemirror/view";
  import { javascript } from "@codemirror/lang-javascript";
  import { python } from "@codemirror/lang-python";
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
  // Tab model (spec #30): terminals are data-driven; Preview/Agent are built-in panes for now.
  interface Tab { id: string; type: "terminal" | "browser" | "editor"; title: string; params: Record<string, string | number | boolean> }
  let tabs = $state<Tab[]>([{ id: "term-1", type: "terminal", title: "Term 1", params: {} }]);
  let runTab = $state("term-1");
  const termTabs = $derived(tabs.filter((t) => t.type === "terminal"));
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
  interface Playground { id: string; status: string; expiresAt: string; warned?: boolean; track?: string }
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
      if (r.status === 403) throw new Error("this workspace belongs to another browser or account");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      pg = await r.json();
      TRACK = pg?.track ?? "";
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
  // Editor tabs (spec #30): each open file is a tab; one CodeMirror view swaps per-tab EditorState.
  const edTabs = $derived(tabs.filter((t) => t.type === "editor"));
  let activeEd = $state<string | null>(null);
  let dirtyIds = $state<Set<string>>(new Set());
  const activeTab = $derived(edTabs.find((t) => t.id === activeEd) ?? null);
  const openPath = $derived((activeTab?.params.path as string | undefined) ?? null);
  const dirty = $derived(activeEd ? dirtyIds.has(activeEd) : false);
  let diffText = $state<string | null>(null);
  let showDiff = $state(false);
  let fileNotice = $state("");
  let editorEl: HTMLDivElement | null = null;
  let view: EditorView | null = null;
  const edStates = new Map<string, EditorState>();
  const savedContent = new Map<string, string>(); // last content known on the server, per tab
  let suppressDirty = false;

  function langFor(path: string) {
    return path.endsWith(".py") ? python() : javascript({ typescript: /\.(ts|tsx)$/.test(path), jsx: /\.(jsx|tsx|svelte)$/.test(path) });
  }
  function mkState(doc: string, path: string) {
    return EditorState.create({
      doc,
      extensions: [
        keymap.of([{ key: "Mod-s", run: () => { saveFile(); return true; } }]),
        langFor(path),
        oneDark,
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !suppressDirty && activeEd) dirtyIds = new Set([...dirtyIds, activeEd]);
        }),
      ],
    });
  }
  function setDirty(tabId: string, v: boolean) {
    const n = new Set(dirtyIds);
    if (v) n.add(tabId); else n.delete(tabId);
    dirtyIds = n;
  }
  const PLACEHOLDER = "// open a file from the explorer →\n";
  function showState(st: EditorState) {
    suppressDirty = true;
    view?.setState(st);
    suppressDirty = false;
  }
  async function fetchFile(path: string): Promise<{ content: string; truncated: boolean } | null> {
    const r = await fetch(`${API}/api/playgrounds/${id}/files/content?path=${encodeURIComponent(path)}`);
    return r.ok ? await r.json() : null;
  }

  async function listFiles() {
    const r = await fetch(`${API}/api/playgrounds/${id}/files?path=${encodeURIComponent(cwd)}`);
    if (r.ok) files = (await r.json()).files;
  }
  async function activateEditor(tabId: string | null) {
    if (view && activeEd) edStates.set(activeEd, view.state);
    activeEd = tabId;
    showDiff = false;
    fileNotice = "";
    if (!tabId) { showState(EditorState.create({ doc: PLACEHOLDER, extensions: [oneDark] })); persistLayout(); return; }
    const tab = tabs.find((t) => t.id === tabId);
    let st = edStates.get(tabId);
    if (!st && tab) {
      const path = tab.params.path as string;
      const body = await fetchFile(path);
      if (!body) { fileNotice = `cannot open ${path}`; closeEditor(tabId, true); return; }
      st = mkState(body.content, path);
      edStates.set(tabId, st);
      savedContent.set(tabId, body.content);
      if (body.truncated) fileNotice = "large file — showing first 256KB";
    }
    if (st) showState(st);
    persistLayout();
  }
  async function openFile(path: string) {
    const existing = edTabs.find((t) => t.params.path === path);
    if (existing) { await activateEditor(existing.id); return; }
    const body = await fetchFile(path);
    if (!body) { fileNotice = `cannot open ${path}`; return; }
    if (tabs.length >= 30) { showToast("tab limit reached — close some tabs first"); return; }
    const tab: Tab = { id: `ed-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, type: "editor", title: path.split("/").pop() ?? path, params: { path } };
    tabs = [...tabs, tab];
    edStates.set(tab.id, mkState(body.content, path));
    savedContent.set(tab.id, body.content);
    await activateEditor(tab.id);
    if (body.truncated) fileNotice = "large file — showing first 256KB";
  }
  let pendingClose = $state<string | null>(null);
  function closeEditor(tabId: string, force = false) {
    if (!force && dirtyIds.has(tabId)) { pendingClose = tabId; return; }
    const idx = edTabs.findIndex((t) => t.id === tabId);
    const wasActive = activeEd === tabId;
    edStates.delete(tabId); savedContent.delete(tabId); setDirty(tabId, false);
    tabs = tabs.filter((t) => t.id !== tabId);
    if (wasActive) {
      const next = edTabs[Math.min(idx, edTabs.length - 1)];
      activeEd = null; // state of the closed tab must not be stashed
      void activateEditor(next?.id ?? null);
    } else persistLayout();
  }
  async function saveFile(tabId: string | null = activeEd) {
    if (!tabId || !view) return;
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const st = tabId === activeEd ? view.state : edStates.get(tabId);
    if (!st) return;
    const content = st.doc.toString();
    const r = await fetch(`${API}/api/playgrounds/${id}/files/content`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: tab.params.path, content }),
    });
    fileNotice = r.ok ? "saved ✓" : `save failed: ${(await r.json()).error}`;
    if (r.ok) { savedContent.set(tabId, content); setDirty(tabId, false); listFiles(); }
  }
  /** Pull in changes made outside the editor (terminal, agent) for clean tabs. */
  async function syncActiveEditor() {
    if (!activeEd || !view || dirtyIds.has(activeEd) || !openPath) return;
    const tabId = activeEd;
    const body = await fetchFile(openPath);
    if (!body || tabId !== activeEd || dirtyIds.has(tabId)) return;
    if (body.content !== savedContent.get(tabId) && body.content !== view.state.doc.toString()) {
      suppressDirty = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: body.content } });
      suppressDirty = false;
      fileNotice = "updated from disk";
    }
    savedContent.set(tabId, body.content);
  }
  async function reloadEditors() {
    // After a project reset / solution: re-read every open file; drop tabs whose file is gone.
    const current = activeEd;
    for (const t of [...edTabs]) {
      const body = await fetchFile(t.params.path as string);
      if (!body) { closeEditor(t.id, true); continue; }
      edStates.set(t.id, mkState(body.content, t.params.path as string));
      savedContent.set(t.id, body.content);
      setDirty(t.id, false);
    }
    activeEd = null;
    await activateEditor(edTabs.find((t) => t.id === current)?.id ?? edTabs[0]?.id ?? null);
  }
  async function loadDiff() {
    if (!openPath) return;
    const r = await fetch(`${API}/api/playgrounds/${id}/files/diff?path=${encodeURIComponent(openPath)}`);
    if (!r.ok) return;
    const body = await r.json();
    diffText = body.changed ? body.diff : "(identical to starter)";
    showDiff = true;
  }
  // --- explorer: new / rename / delete ---
  let newFileName = $state<string | null>(null);
  let renamingPath = $state<string | null>(null);
  let renameTo = $state("");
  let deletingPath = $state<string | null>(null);
  async function createFile() {
    const name = (newFileName ?? "").trim().replace(/^\/+/, "");
    newFileName = null;
    if (!name) return;
    const path = cwd ? `${cwd}/${name}` : name;
    const r = await fetch(`${API}/api/playgrounds/${id}/files/content`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, content: "" }),
    });
    if (!r.ok) { fileNotice = `cannot create: ${(await r.json()).error}`; return; }
    await listFiles();
    await openFile(path);
  }
  async function renameEntry() {
    const from = renamingPath; const to = renameTo.trim().replace(/^\/+/, "");
    renamingPath = null;
    if (!from || !to || to === from) return;
    const r = await fetch(`${API}/api/playgrounds/${id}/files/rename`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from, to }),
    });
    if (!r.ok) { fileNotice = `rename failed: ${(await r.json()).error}`; return; }
    for (const t of tabs) {
      const p = t.params.path as string | undefined;
      if (t.type !== "editor" || !p) continue;
      if (p === from || p.startsWith(`${from}/`)) {
        const np = to + p.slice(from.length);
        t.params.path = np; t.title = np.split("/").pop() ?? np;
      }
    }
    persistLayout();
    listFiles();
  }
  async function deleteEntry() {
    const path = deletingPath;
    deletingPath = null;
    if (!path) return;
    const r = await fetch(`${API}/api/playgrounds/${id}/files?path=${encodeURIComponent(path)}`, { method: "DELETE" });
    if (!r.ok) { fileNotice = `delete failed: ${(await r.json()).error}`; return; }
    for (const t of [...edTabs]) {
      const p = t.params.path as string;
      if (p === path || p.startsWith(`${path}/`)) closeEditor(t.id, true);
    }
    listFiles();
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
    if (r.ok) { await reloadEditors(); fileNotice = "file reset to starter ✓"; }
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
    if (r.ok) { showDiff = false; listFiles(); await reloadEditors(); fileNotice = "project reset ✓"; }
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
    // Lab-declared startup (cd workdir / run cmd) fires once, after the server confirms the shell is attached.
    const runStartup = () => {
      const tab = tabs.find((t) => t.id === name);
      if (tab && !tab.params.started && (tab.params.cmd || tab.params.workdir)) {
        const sh = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
        const line = [tab.params.workdir ? `cd ${sh(String(tab.params.workdir))}` : "", tab.params.cmd ? String(tab.params.cmd) : ""].filter(Boolean).join(" && ");
        ws.send(JSON.stringify({ data: `${line}\r` }));
        tab.params.started = true;
        persistLayout();
      }
    };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === "ready") runStartup();
        else if (m.type === "data") term.write(m.data);
        else if (m.type === "error") term.writeln(`\r\n[relay: ${m.error}]`);
      } catch { term.write(e.data); }
    };
    ws.onclose = () => { termState[name] = "disconnected"; term.writeln("\r\n[disconnected — hit ⟳ reconnect]"); };
    // Drop xterm's automatic device-attributes replies (ESC [ ? / > ... c): tmux queries them on
    // attach, and when the reply races the prompt it would be echoed as junk like "0;276;0c".
    term.onData((d: string) => { if (/^\x1b\[[?>][\d;]*c$/.test(d)) return; if (ws.readyState === 1) ws.send(JSON.stringify({ data: d })); });
    termObjs[name] = { term, ws, fit };
  }
  function showRunTab(name: string) {
    runTab = name;
    persistLayout();
    // xterm needs a visible element to measure: refit after paint.
    requestAnimationFrame(() => requestAnimationFrame(refitTerms));
  }

  // --- tab layout: persisted server-side, restored after refresh ---
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let layoutLoaded = false;
  let restoreEditorId: string | null = null;
  function persistLayout() {
    if (!layoutLoaded) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      fetch(`${API}/api/playgrounds/${id}/layout`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tabs: $state.snapshot(tabs), activeId: runTab, activeEditorId: activeEd }),
      }).catch(() => {});
    }, 250);
  }
  async function loadLayout() {
    try {
      const r = await fetch(`${API}/api/playgrounds/${id}/layout`);
      if (r.ok) {
        const l = await r.json();
        tabs = l.tabs;
        const terms = (l.tabs as Tab[]).filter((t) => t.type === "terminal");
        runTab = l.activeId ?? (l.tabs as Tab[]).find((t) => t.type !== "editor")?.id ?? "Agent";
        restoreEditorId = l.activeEditorId ?? null;
      }
    } catch { /* keep default layout */ }
    layoutLoaded = true;
  }
  let chooser = $state<{ x: number; y: number } | null>(null);
  let tabMenu = $state<{ id: string; x: number; y: number } | null>(null);
  let confirmCloseTab = $state(false);
  let renaming = $state<string | null>(null);
  let renameVal = $state("");
  let dragId: string | null = null;
  function openChooser(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    tabMenu = null;
    chooser = chooser ? null : { x: r.left, y: r.bottom + 4 };
  }
  function openTabMenu(e: MouseEvent, tabId: string) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    chooser = null;
    confirmCloseTab = false;
    tabMenu = tabMenu?.id === tabId ? null : { id: tabId, x: r.left, y: r.bottom + 4 };
  }
  function addTab(type: Tab["type"]) {
    chooser = null;
    if (type === "editor") { newFileName = ""; return; } // editors open files: start by naming one
    if (tabs.length >= 30) { showToast("tab limit reached — close some tabs first"); return; }
    const label = type === "browser" ? "Browser" : "Term";
    let n = 1;
    while (tabs.some((t) => t.title === `${label} ${n}`)) n++;
    const tab: Tab = { id: `${type === "browser" ? "br" : "term"}-${Date.now().toString(36)}`, type, title: `${label} ${n}`, params: type === "browser" ? { port: 3000, path: "/" } : {} };
    tabs = [...tabs, tab];
    showRunTab(tab.id);
    if (type === "terminal") setTimeout(() => attachTerm(tab.id), 0);
    else checkBrowser(tab.id, true);
  }
  function closeTab(tabId: string) {
    const idx = tabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return;
    const o = termObjs[tabId];
    if (o) { try { o.ws.close(); } catch {} o.term.dispose(); delete termObjs[tabId]; }
    delete termEls[tabId]; delete termState[tabId];
    tabs = tabs.filter((t) => t.id !== tabId);
    tabMenu = null; confirmCloseTab = false;
    if (runTab === tabId) {
      const next = tabs[Math.min(idx, tabs.length - 1)];
      runTab = next ? next.id : "Agent";
      if (next) setTimeout(() => attachTerm(next.id), 0);
    }
    persistLayout();
  }
  function moveTab(tabId: string, delta: number) {
    const i = tabs.findIndex((t) => t.id === tabId), j = i + delta;
    if (i < 0 || j < 0 || j >= tabs.length) return;
    const next = [...tabs];
    [next[i], next[j]] = [next[j], next[i]];
    tabs = next; persistLayout();
  }
  function dropOn(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const from = tabs.findIndex((t) => t.id === dragId), to = tabs.findIndex((t) => t.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...tabs];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    tabs = next; dragId = null; persistLayout();
  }
  function startRename(t: Tab) { tabMenu = null; renaming = t.id; renameVal = t.title; }
  function commitRename() {
    if (renaming === null) return;
    const t = tabs.find((x) => x.id === renaming);
    const v = renameVal.trim().slice(0, 40);
    if (t && v && v !== t.title) { t.title = v; persistLayout(); }
    renaming = null;
  }
  function focusEl(el: HTMLInputElement) { el.focus(); el.select(); }
  function heartbeat() {
    fetch(`${API}/api/playgrounds/${id}/heartbeat`, { method: "POST" }).catch(() => {});
  }
  setInterval(heartbeat, 5 * 60_000);

  // --- demo track + in-session checks + preview (issue #6) ---
  // Lesson this workspace was launched for; empty = free playground (no instructions panel).
  let TRACK = $state("");
  const hasLesson = $derived(TRACK !== "");
  interface Step { slug: string; title: string; assignment: string }
  let steps = $state<Step[]>([]);
  let curStep = $state(0);
  let checkHint = $state("");
  let checkOk = $state<boolean | null>(null);
  // Browser tabs: one live/waiting state per tab (spec #30). The iframe URL is signed once and kept
  // stable (re-signing would reload the page); it is refreshed on reload, port change, or before expiry.
  interface BState { ready: boolean; url?: string; hint?: string; signedAt?: number }
  let bstate = $state<Record<string, BState>>({});
  const PREVIEW_REFRESH_MS = 25 * 60_000; // tokens live 30 min
  async function loadTrack() {
    try {
      if (!TRACK) return;
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
    if (r.ok) { listFiles(); reloadEditors(); }
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
  const runTabs = $derived(tabs.filter((t) => t.type !== "editor"));
  const browserTabs = $derived(tabs.filter((t) => t.type === "browser"));
  async function checkBrowser(tabId: string, force = false) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab || tab.type !== "browser") return;
    const port = Number(tab.params.port) || 3000;
    const cur = bstate[tabId];
    const stale = !cur?.signedAt || Date.now() - cur.signedAt > PREVIEW_REFRESH_MS;
    try {
      const r = await fetch(`${API}/api/playgrounds/${id}/preview?port=${port}`);
      if (!r.ok) { bstate[tabId] = { ready: false, hint: `cannot reach :${port} (${r.status})` }; return; }
      const b = await r.json();
      if (!b.ready) { bstate[tabId] = { ready: false, hint: b.hint }; return; }
      // Already live and fresh: keep the existing URL so the page isn't reloaded under the learner.
      if (cur?.ready && !force && !stale) return;
      bstate[tabId] = { ready: true, url: b.url, signedAt: Date.now() };
    } catch { /* retry next tick */ }
  }
  function setBrowserPort(tab: Tab, v: string) {
    const n = Math.round(Number(v));
    if (!Number.isInteger(n) || n < 1 || n > 65535) return;
    tab.params.port = n;
    bstate[tab.id] = { ready: false, hint: `waiting for :${n} — start your app, this pane goes live` };
    persistLayout();
    checkBrowser(tab.id, true);
  }
  function setBrowserPath(tab: Tab, v: string) {
    tab.params.path = v.startsWith("/") ? v : `/${v}`;
    persistLayout();
  }
  setInterval(() => { const t = tabs.find((x) => x.id === runTab); if (t?.type === "browser") checkBrowser(t.id); }, 3000);

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
        if (n.kind === "reset") { listFiles(); reloadEditors(); }
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
    loadSession().then(async () => { listFiles(); loadTrack(); await loadLayout(); if (termTabs.some((t) => t.id === runTab)) setTimeout(() => attachTerm(runTab), 0); const first = edTabs.find((t) => t.id === restoreEditorId) ?? edTabs[0]; if (first) await activateEditor(first.id); });
    if (typeof window !== "undefined") window.addEventListener("resize", refitTerms);
    view = new EditorView({
      state: EditorState.create({ doc: PLACEHOLDER, extensions: [oneDark] }),
      parent: editorEl!,
    });
    const poll = setInterval(() => { syncActiveEditor(); listFiles(); }, 3000);
    pollTimer = poll;
    heartbeat();
    return () => {};
  });
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
    if (typeof window !== "undefined") window.removeEventListener("resize", refitTerms);
    view?.destroy();
    for (const t of Object.values(termObjs)) { try { t.ws.close(); } catch {} t.term.dispose(); }
  });
</script>

<div class="win">
  <header class="hdr">
    <div class="l"><span class="logo">R</span><span class="title">{hasLesson ? "lesson" : "playground"} › {id.slice(0, 8)}</span></div>
    <div class="r">
      <span class="dot" style:background={pg?.status === "active" ? "#22c55e" : "#f59e0b"}></span>
      <span class="timer" class:urgent={ttlUrgent} title={ttlUrgent ? "less than 15 minutes left — save your work" : "time remaining"}>{ttlText}</span>
      <a class="ibtn" href="{API}/api/playgrounds/{id}/snapshot.tar" download title="download a tarball of your workspace">⛁ snapshot</a>
      {#if confirmStop}
        <span class="confirm-inline">stop this playground? <button class="ibtn danger" onclick={() => fetch(`${API}/api/playgrounds/${id}`, { method: "DELETE" }).then(() => location.assign("/"))}>yes, stop</button> <button class="ibtn" onclick={() => (confirmStop = false)}>keep</button></span>
      {:else}
        <button class="ibtn danger" onclick={() => (confirmStop = true)}>⏻ stop</button>
      {/if}
      <span class="avatar"></span>
    </div>
  </header>
  <div class="tabs">
    {#if hasLesson}<div class="grp L"><span class="lbl">Learn</span><span class="tab static">Instructions</span><span class="tab static">IDE</span></div>{/if}
    <div class="grp R"><span class="lbl">Run</span>{#each runTabs as t (t.id)}<span class="tabwrap" role="presentation" draggable="true" ondragstart={() => (dragId = t.id)} ondragover={(e) => e.preventDefault()} ondrop={() => dropOn(t.id)}>{#if renaming === t.id}<input class="tabedit" aria-label="rename tab" bind:value={renameVal} use:focusEl onblur={commitRename} onkeydown={(e) => { if (e.key === "Enter") commitRename(); else if (e.key === "Escape") renaming = null; }} />{:else}<button class="tab" class:active={runTab === t.id} data-tab={t.id} ondblclick={() => startRename(t)} onclick={() => { showRunTab(t.id); if (t.type === "terminal") setTimeout(() => attachTerm(t.id), 0); else checkBrowser(t.id); }}>{t.type === "browser" ? "◫ " : ""}{t.title}</button>{/if}{#if runTab === t.id && renaming !== t.id}<button class="tabmenu" aria-label="tab menu" onclick={(e) => openTabMenu(e, t.id)}>⋯</button>{/if}</span>{/each}<button class="tab" class:active={runTab === "Agent"} onclick={() => showRunTab("Agent")}>Agent</button><button class="add" aria-label="new tab" onclick={openChooser}>+</button></div>
  </div>
  <div class="dock" class:noL={hideLearn || !hasLesson} class:noR={hideRun}>
    <section class="steps">
      <div class="colbar">Learn <button onclick={() => (hideLearn = true)}>⟨ hide</button></div>
      <div class="body">
        {#if loading}
          <div class="skel"></div><div class="skel" style="width:70%"></div><div class="skel" style="width:85%"></div>
        {:else if loadError}
          <p style="color:#b91c1c">{loadError}</p>
          <p><button class="retry" onclick={loadSession}>↻ retry</button> <a href="/">← start a fresh playground</a></p>
        {/if}
        <div class="meta">{TRACK} · {steps.length ? `step ${curStep + 1} of ${steps.length}` : "free playground"}</div>
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
        <div class="fh">Explorer <button class="xbtn" aria-label="new file" title="new file" onclick={() => (newFileName = "")}>＋</button></div>
        {#if newFileName !== null}
          <input class="xin" aria-label="new file name" placeholder="name.ext" bind:value={newFileName} use:focusEl onkeydown={(e) => { if (e.key === "Enter") createFile(); else if (e.key === "Escape") newFileName = null; }} onblur={() => (newFileName = null)} />
        {/if}
        {#if cwd}<div class="crumb" onclick={() => (cwd = "", listFiles())}>‹ {cwd || "root"}</div>{/if}
        {#each files as f (f.path)}
          {#if renamingPath === f.path}
            <input class="xin" aria-label="rename" bind:value={renameTo} use:focusEl onkeydown={(e) => { if (e.key === "Enter") renameEntry(); else if (e.key === "Escape") renamingPath = null; }} onblur={() => (renamingPath = null)} />
          {:else if deletingPath === f.path}
            <div class="file warn">delete {f.path.split("/").pop()}? <a href="#" onmousedown={(e) => (e.preventDefault(), deleteEntry())}>yes</a> · <a href="#" onmousedown={(e) => (e.preventDefault(), deletingPath = null)}>no</a></div>
          {:else}
            <div class="file" class:sel={openPath === f.path} title={f.path} data-path={f.path} onclick={() => f.type === "dir" ? (cwd = f.path, listFiles()) : openFile(f.path)}><span class="fic">{fileIcon(f.path.split("/").pop() ?? "", f.type)}</span><span class="fname">{f.path.split("/").pop()}</span><span class="facts"><button aria-label="rename {f.path}" onclick={(e) => { e.stopPropagation(); renamingPath = f.path; renameTo = f.path; }}>✎</button><button aria-label="delete {f.path}" onclick={(e) => { e.stopPropagation(); deletingPath = f.path; }}>🗑</button></span></div>
          {/if}
        {/each}
        <div class="fh" style="margin-top:10px">Project</div>
        {#if confirmResetProject}
          <div class="file warn">reset all? <a href="#" onclick={(e) => (e.preventDefault(), resetProject())}>yes</a> · <a href="#" onclick={(e) => (e.preventDefault(), confirmResetProject = false)}>no</a></div>
        {:else}
          <div class="file" onclick={() => (confirmResetProject = true)}>⟲ reset project</div>
        {/if}
      </div>
      <div class="ed">
        <div class="edtabs" role="tablist">{#each edTabs as t (t.id)}<span class="edt" class:active={activeEd === t.id}><button class="edname" role="tab" data-edtab={t.id} title={t.params.path as string} onclick={() => activateEditor(t.id)}>{dirtyIds.has(t.id) ? "● " : ""}{t.title}</button><button class="edx" aria-label="close {t.title}" onclick={() => closeEditor(t.id)}>×</button></span>{/each}</div>
        <div class="edtab"><span>{dirty ? "● " : ""}{openPath ?? "no file open"}</span>{#if openPath}<button class="savebtn" onclick={() => saveFile()} disabled={!dirty}>save ⌘S</button><a href="#" onclick={(e) => (e.preventDefault(), loadDiff())}>diff</a>{#if confirmResetFile}<span>reset? <a href="#" onclick={(e) => (e.preventDefault(), resetFile())}>yes</a> · <a href="#" onclick={(e) => (e.preventDefault(), confirmResetFile = false)}>no</a></span>{:else}<a href="#" onclick={(e) => (e.preventDefault(), confirmResetFile = true)}>reset file</a>{/if}{/if}<span style="margin-left:auto;color:#858585">{fileNotice}</span></div>
        {#if showDiff}<pre class="diff">{diffText}</pre>{/if}
        <div class="code" bind:this={editorEl}></div>
      </div>
    </section>
    <section class="right">
      <div class="colbar" style="border-bottom:1px solid #222">Run <button onclick={() => (hideRun = true)}>hide ⟩</button></div>
      {#each termTabs as t (t.id)}
        <div class="rpane term" class:on={runTab === t.id}><div class="termbar"><span class="tstate {termState[t.id] ?? 'connecting'}">● {termState[t.id] ?? "connecting"}</span><button class:alert={termState[t.id] === "disconnected"} onclick={() => reconnectTerm(t.id)} title="reconnect shell">⟳ reconnect</button></div><div class="termwrap" bind:this={termEls[t.id]}></div></div>
      {/each}
      {#each browserTabs as t (t.id)}
        <div class="rpane" class:on={runTab === t.id}>
          <div class="urlbar">
            <button aria-label="reload preview" title="reload" onclick={() => checkBrowser(t.id, true)}>⟳</button>
            <span class="host">localhost:</span><input class="port" aria-label="preview port" inputmode="numeric" value={String(t.params.port ?? 3000)} onchange={(e) => setBrowserPort(t, e.currentTarget.value)} />
            <input class="path" aria-label="preview path" value={String(t.params.path ?? "/")} onchange={(e) => setBrowserPath(t, e.currentTarget.value)} />
          </div>
          {#if bstate[t.id]?.ready}
            <iframe title="{t.title} preview" src={`${bstate[t.id].url}${String(t.params.path ?? "/").replace(/^\//, "")}`} style="flex:1;border:0;background:#fff" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
          {:else}
            <div class="prev">◷ {bstate[t.id]?.hint ?? `waiting for :${t.params.port ?? 3000} — start your app, this pane goes live`}<br /><span style="font-size:12px">checks every 3s</span></div>
          {/if}
        </div>
      {/each}
      <div class="rpane" class:on={runTab === "Agent"}>
        <div class="agent"><b>Lab agent</b>
          <div class="apolicy">file ✓ allowed · shell ⚠ approval · network/creds ⛔ forbidden</div>
          {#if hasLesson}<button class="abtn" onclick={() => { showRunTab("Agent"); agentFix(); }}>✨ fix step 1 with the agent</button>{/if}
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
{#if pendingClose}
  {@const pt = tabs.find((t) => t.id === pendingClose)}
  <div class="modal-veil" onclick={() => (pendingClose = null)}></div>
  <div class="modal" role="dialog" aria-label="unsaved changes">
    <b>Unsaved changes</b>
    <p>{pt?.title ?? "This file"} has unsaved edits. Save first, or discard them?</p>
    <button class="mini" onclick={async () => { const t = pendingClose!; pendingClose = null; await saveFile(t); closeEditor(t, true); }}>save</button>
    <button class="mini ghost" onclick={() => { const t = pendingClose!; pendingClose = null; closeEditor(t, true); }}>discard</button>
    <button class="mini ghost" onclick={() => (pendingClose = null)}>cancel</button>
  </div>
{/if}
{#if chooser || tabMenu}<div class="menu-veil" role="presentation" onclick={() => { chooser = null; tabMenu = null; }}></div>{/if}
{#if chooser}
  <div class="menu" role="menu" aria-label="new tab type" style:left="{chooser.x}px" style:top="{chooser.y}px">
    <button role="menuitem" onclick={() => addTab("terminal")}>▣ Terminal</button>
    <button role="menuitem" onclick={() => addTab("browser")}>◫ Browser</button>
    <button role="menuitem" onclick={() => addTab("editor")}>✎ Editor (new file)</button>
  </div>
{/if}
{#if tabMenu}
  {@const mt = tabs.find((x) => x.id === tabMenu!.id)}
  {#if mt}
  <div class="menu" role="menu" aria-label="tab actions" style:left="{tabMenu.x}px" style:top="{tabMenu.y}px">
    <button role="menuitem" onclick={() => startRename(mt)}>Rename</button>
    <button role="menuitem" onclick={() => moveTab(mt.id, -1)} disabled={tabs[0]?.id === mt.id}>Move left</button>
    <button role="menuitem" onclick={() => moveTab(mt.id, 1)} disabled={tabs[tabs.length - 1]?.id === mt.id}>Move right</button>
    {#if confirmCloseTab}
      <div class="confirm">end this shell? <button onclick={() => closeTab(mt.id)}>yes, close</button> <button onclick={() => (confirmCloseTab = false)}>keep</button></div>
    {:else}
      <button role="menuitem" class="danger" onclick={() => (confirmCloseTab = true)}>Close tab</button>
    {/if}
  </div>
  {/if}
{/if}
{#if toast}<div class="toast show">{toast}</div>{/if}
<button class="fab" id="fabL" style:display={hasLesson && hideLearn ? "block" : "none"} onclick={() => (hideLearn = false)}>⟩</button>
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
  .edtabs{display:flex;overflow-x:auto;background:#181818;border-bottom:1px solid #2a2a2a;flex:none;min-height:0}
  .edt{display:inline-flex;align-items:center;border-right:1px solid #2a2a2a;background:#222;color:#aaa;flex:none}
  .edt.active{background:#1f1f1f;color:#fff;box-shadow:inset 0 -2px 0 #2f81f7}
  .edname{background:none;border:0;color:inherit;font-family:var(--mono);font-size:12.5px;padding:7px 4px 7px 12px;cursor:pointer}
  .edx{background:none;border:0;color:#858585;font-size:15px;padding:0 8px;cursor:pointer}
  .edx:hover{color:#fff}
  .xbtn{background:none;border:1px solid #333;color:#aaa;border-radius:4px;font-size:12px;cursor:pointer;padding:0 5px;float:right}
  .xin{width:100%;box-sizing:border-box;background:#0f0f0f;color:#fff;border:1px solid #2f81f7;border-radius:4px;font-family:var(--mono);font-size:12px;padding:3px 6px;margin:2px 0}
  .file{display:flex;align-items:center}
  .fname{flex:1;overflow:hidden;text-overflow:ellipsis}
  .facts{display:none;gap:2px}
  .file:hover .facts{display:inline-flex}
  .facts button{background:none;border:0;color:#aaa;font-size:11px;cursor:pointer;padding:0 2px}
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
  .tabwrap{display:inline-flex;align-items:center;gap:2px;flex:none}
  .tabmenu{border:0;background:transparent;color:#334155;font-size:16px;cursor:pointer;padding:0 4px}
  .tabedit{height:34px;border:1px solid var(--ink);border-radius:99px;padding:0 12px;font-size:14px;width:120px;font-family:var(--font)}
  .menu-veil{position:fixed;inset:0;z-index:40}
  .menu{position:fixed;z-index:41;background:#fff;color:var(--ink);border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:4px;min-width:170px;display:flex;flex-direction:column}
  .menu button{text-align:left;background:none;border:0;padding:8px 12px;border-radius:6px;font-size:13px;cursor:pointer;color:var(--ink)}
  .menu button:hover:not(:disabled){background:#eef2f7}
  .menu button:disabled{color:#94a3b8;cursor:not-allowed}
  .menu button.danger{color:#b91c1c}
  .menu i{font-size:11px;color:#94a3b8;margin-left:6px}
  .menu .confirm{padding:8px 12px;font-size:12.5px}
  .menu .confirm button{display:inline;padding:3px 8px;background:#eef2f7;margin-top:6px}
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
  .urlbar{display:flex;align-items:center;gap:6px;padding:6px 10px;background:#111;border-bottom:1px solid #222;flex:none;font-family:var(--mono);font-size:12px;color:#94a3b8}
  .urlbar button{background:none;border:1px solid #333;color:#ccc;border-radius:6px;cursor:pointer;padding:1px 8px}
  .urlbar input{background:#0b0b0b;border:1px solid #2a2a2a;color:#e6e6e6;border-radius:6px;font-family:var(--mono);font-size:12px;padding:3px 6px}
  .urlbar .port{width:64px}.urlbar .path{flex:1;min-width:0}
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
