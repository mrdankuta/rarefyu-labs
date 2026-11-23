<script lang="ts">
  import "../../../app.css";
  import { page } from "$app/stores";
  import { onMount, onDestroy } from "svelte";
  import { collectDropped, collectInput, describe as describeUpload, downloadUrl, upload } from "$lib/transfer";
  import { currentTheme, toggleTheme, type Theme } from "$lib/theme";
  import { env } from "$env/dynamic/public";
  import { readStoredLayout, resolveLayout, storeLayout, forcedClassic, type ShellLayout } from "$lib/layout";
  import { diffLines, statOf, withContext, type DiffLine } from "$lib/diff";
  import { ChatController } from "$lib/agent/chat.svelte";
  import ChatPanel from "$lib/components/ChatPanel.svelte";
  import type { EditHost } from "$lib/agent/edits";
  import PreviewStatus from "$lib/components/PreviewStatus.svelte";
  import { PreviewController, type PreviewUi } from "$lib/preview";
  import { EditorState, Compartment } from "@codemirror/state";
  import { EditorView, keymap } from "@codemirror/view";
  import { basicSetup } from "codemirror";
  import { indentWithTab } from "@codemirror/commands";
  import { javascript } from "@codemirror/lang-javascript";
  import { python } from "@codemirror/lang-python";
  import { html } from "@codemirror/lang-html";
  import { css } from "@codemirror/lang-css";
  import { json } from "@codemirror/lang-json";
  import { markdown } from "@codemirror/lang-markdown";
  import { oneDark } from "@codemirror/theme-one-dark";
  // xterm is client-only (CommonJS, needs DOM): dynamic-import inside onMount.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let XTerm: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let FitAddonCls: any = null;

  const id = $derived($page.params.id ?? "");
  const API = ""; // same-origin; Caddy routes /api/* → api

  // --- layout state ---
  let hideLearn = $state(false);
  let theme = $state<Theme>("dark");
  // Shell layout (Classic | Chat): arrangement only. Every panel stays mounted in both, so terminals,
  // editor state and previews keep running across a switch. PUBLIC_DEFAULT_LAYOUT=classic forces Classic.
  const layoutForced = forcedClassic(env.PUBLIC_DEFAULT_LAYOUT);
  let shell = $state<ShellLayout>(resolveLayout(readStoredLayout(), env.PUBLIC_DEFAULT_LAYOUT));
  let drawer = $state<"files" | "terminal" | null>(null);
  // Agent chat: created and started the first time the Chat layout is shown (never in a Classic-only session),
  // then kept for the life of the page so switching layouts neither drops the conversation nor reconnects.
  let chatCtl = $state<ChatController | null>(null);
  $effect(() => {
    if (shell === "chat" && id && !chatCtl) {
      chatCtl = new ChatController(id);
      chatCtl.host = editHost;
      chatCtl.onTurnEnd = () => { void previewCtl?.ensure({ reload: true }); }; // once per turn, never per token
      void chatCtl.start();
    }
  });
  // Preview automation (issue #54): the lab makes sure a web project is served, and refreshes at turn end.
  let previewCtl: PreviewController | null = null;
  let pv = $state<{ ui: PreviewUi; port: number | null; hint: string }>({ ui: "idle", port: null, hint: "" });
  let previewFrame = $state<HTMLIFrameElement | null>(null);
  function startPreview() {
    if (!id || shell !== "chat" || !previewTab) return;
    previewCtl ??= new PreviewController(API, id, {
      onChange: (s) => { pv = s; },
      onPort: (port) => {
        // The API owns the port (local workspaces each get their own). Adopt it unless the student typed one.
        const t = previewTab;
        if (t && !t.params.userPort && t.params.port !== port) { t.params.port = port; bstate[t.id] = { ready: false }; persistLayout(); }
      },
      onNotReady: () => { if (previewTab) bstate[previewTab.id] = { ready: false }; },
      onReady: (_port, reload) => {
        const t = previewTab;
        if (!t) return;
        if (reload && bstate[t.id]?.ready) reloadPreviewFrame(); else void checkBrowser(t.id, true);
      },
    });
    void previewCtl.ensure();
  }
  /** Reload the page inside the preview in place (same origin): the browser keeps the scroll position where it can. */
  function reloadPreviewFrame() {
    try { previewFrame?.contentWindow?.location.reload(); } catch { if (previewTab) void checkBrowser(previewTab.id, true); }
  }
  function setShell(l: ShellLayout) {
    if (layoutForced || l === shell) return;
    shell = l;
    storeLayout(l);
    drawer = null;
    if (l === "chat") { centerView = "preview"; if (previewTab) checkBrowser(previewTab.id, true); startPreview(); }
    // xterm can't measure while rearranged/hidden: refit (no reconnect) once the new layout has painted.
    requestAnimationFrame(() => requestAnimationFrame(refitTerms));
  }
  function toggleDrawer(d: "files" | "terminal") {
    drawer = drawer === d ? null : d;
    if (drawer === "terminal") setTimeout(() => attachTerm(runTab), 0);
    requestAnimationFrame(() => requestAnimationFrame(refitTerms));
  }
  // Tab model (spec #30): terminals/browsers are data-driven; editors are file tabs.
  interface Tab { id: string; type: "terminal" | "browser" | "editor"; title: string; params: Record<string, string | number | boolean> }
  let tabs = $state<Tab[]>([{ id: "term-1", type: "terminal", title: "Terminal 1", params: {} }]);
  let runTab = $state("term-1");
  const termTabs = $derived(tabs.filter((t) => t.type === "terminal"));
  try { hideLearn = localStorage.getItem("labs.hideLearn") === "1"; } catch { /* storage blocked */ }
  $effect(() => { try { localStorage.setItem("labs.hideLearn", hideLearn ? "1" : "0"); } catch { /* private mode */ } });

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

  // --- files: one recursive tree feeds explorer, quick-open, search and change tracking ---
  interface Entry { path: string; type: "file" | "dir"; size: number; mtime: number; collapsed?: boolean }
  let tree = $state<Entry[]>([]);
  let treeTruncated = $state(false);
  let expanded = $state<Set<string>>(new Set());
  let selDir = $state(""); // where new files / uploads land
  let treeSeeded = false;
  const kidsOf = $derived.by(() => {
    const m = new Map<string, Entry[]>();
    for (const e of tree) {
      const i = e.path.lastIndexOf("/");
      const p = i < 0 ? "" : e.path.slice(0, i);
      const l = m.get(p);
      if (l) l.push(e); else m.set(p, [e]);
    }
    return m;
  });
  const rows = $derived.by(() => {
    const out: { e: Entry; depth: number }[] = [];
    const walk = (p: string, depth: number) => {
      const list = [...(kidsOf.get(p) ?? [])].sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === "dir" ? -1 : 1));
      for (const e of list) {
        out.push({ e, depth });
        if (e.type === "dir" && expanded.has(e.path) && !e.collapsed) walk(e.path, depth + 1);
      }
    };
    walk("", 0);
    return out;
  });
  function toggleDir(p: string) {
    const n = new Set(expanded);
    if (n.has(p)) n.delete(p); else n.add(p);
    expanded = n;
  }

  // Editor tabs: each open file is a tab; one CodeMirror view swaps per-tab EditorState.
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
  const savedContent = new Map<string, string>();
  let suppressDirty = false;
  let autosave = $state(true);
  try { autosave = localStorage.getItem("rfy_autosave") !== "0"; } catch { /* storage blocked */ }
  $effect(() => { try { localStorage.setItem("rfy_autosave", autosave ? "1" : "0"); } catch { /* storage blocked */ } });
  let autoTimer: ReturnType<typeof setTimeout> | null = null;
  const themeComp = new Compartment();
  const baseTheme = EditorView.theme({
    "&": { height: "100%", backgroundColor: "var(--surface)" },
    ".cm-gutters": { backgroundColor: "var(--surface)", border: "none" },
    ".cm-activeLine": { backgroundColor: "var(--accent-soft)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--accent-soft)" },
    ".cm-scroller": { fontFamily: "var(--mono)", fontVariantLigatures: "none" },
  });
  const themeExt = () => (currentTheme() === "dark" ? [oneDark, baseTheme] : [baseTheme]);

  function langFor(path: string) {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "py") return python();
    if (["html", "htm", "svelte", "vue"].includes(ext)) return html();
    if (["css", "scss"].includes(ext)) return css();
    if (["json", "jsonc", "webmanifest"].includes(ext)) return json();
    if (["md", "markdown", "mdx"].includes(ext)) return markdown();
    if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) return javascript({ typescript: /^tsx?$/.test(ext), jsx: /^(jsx|tsx)$/.test(ext) });
    return [];
  }
  function mkState(doc: string, path: string) {
    return EditorState.create({
      doc,
      extensions: [
        keymap.of([{ key: "Mod-s", run: () => { void saveFile(); return true; } }, indentWithTab]),
        basicSetup,
        langFor(path),
        themeComp.of(themeExt()),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged || suppressDirty || !activeEd) return;
          dirtyIds = new Set([...dirtyIds, activeEd]);
          if (autosave) {
            if (autoTimer) clearTimeout(autoTimer);
            const tid = activeEd;
            autoTimer = setTimeout(() => { if (dirtyIds.has(tid) && !conflicts.has(tid)) void saveFile(tid); }, 1200);
          }
        }),
      ],
    });
  }
  function onThemeEvent(e: Event) {
    theme = (e as CustomEvent<Theme>).detail;
    for (const [k, st] of edStates) edStates.set(k, st.update({ effects: themeComp.reconfigure(themeExt()) }).state);
    view?.dispatch({ effects: themeComp.reconfigure(themeExt()) });
  }
  function setDirty(tabId: string, v: boolean) {
    const n = new Set(dirtyIds);
    if (v) n.add(tabId); else { n.delete(tabId); if (conflicts.has(tabId)) { const c = new Set(conflicts); c.delete(tabId); conflicts = c; } }
    dirtyIds = n;
  }
  const PLACEHOLDER = "";
  function showState(st: EditorState) {
    suppressDirty = true;
    view?.setState(st);
    suppressDirty = false;
  }
  async function fetchFile(path: string): Promise<{ content: string; truncated: boolean } | null> {
    const r = await fetch(`${API}/api/playgrounds/${id}/files/content?path=${encodeURIComponent(path)}`);
    return r.ok ? await r.json() : null;
  }

  // --- change tracking: what moved on disk outside the editor (agent, terminal) ---
  interface Change { status: "added" | "modified" | "deleted"; add: number; del: number; /** too large or binary: no line diff, but Keep/Undo still work */ opaque?: boolean }
  // Edit cards in the chat read and drive THIS state (see editHost below), so the chat and the Changes tab never disagree.
  const changeVer = new Map<string, number>(); // bumped whenever a path's tracked state is re-recorded
  let verSeq = 0;
  const resolutions = new Map<string, "kept" | "undone">();
  const editedByStudent = new Set<string>(); // saved by the student while the agent's change was still pending
  const initialPaths = new Set<string>(); // every file present when tracking started (to spot new big/binary files)
  let conflicts = $state<Set<string>>(new Set()); // tab ids: unsaved edits AND the file changed on disk meanwhile
  let changes = $state<Record<string, Change>>({});
  const changeList = $derived(Object.entries(changes).sort((a, b) => a[0].localeCompare(b[0])));
  const baseline = new Map<string, string | null>(); // null = file did not exist when we started watching
  const sigs = new Map<string, string>();
  const curCache = new Map<string, string>();
  let baselineReady = false;
  let refreshing = false;
  const MAX_TRACK = 100 * 1024;
  const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|mp3|mp4|mov|woff2?|ttf|eot|bin|exe|so|wasm|sqlite|db)$/i;
  const trackable = (e: Entry) => e.type === "file" && e.size <= MAX_TRACK && !BINARY.test(e.path);
  async function inBatches<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
    for (let i = 0; i < items.length; i += n) await Promise.all(items.slice(i, i + n).map(fn));
  }
  function recordChange(path: string, base: string | null, cur: string | null) {
    const d = diffLines(base ?? "", cur ?? "");
    const { add, del } = statOf(d);
    const next = { ...changes };
    changeVer.set(path, ++verSeq);
    if (base === cur) { delete next[path]; editedByStudent.delete(path); } // (a newline-only edit shows as +0 −0)
    else { next[path] = { status: cur === null ? "deleted" : base === null ? "added" : "modified", add, del }; resolutions.delete(path); }
    changes = next;
  }
  async function trackChanges() {
    const all = new Set(tree.map((e) => e.path));
    const cand = tree.filter(trackable).slice(0, 150);
    const todo = baselineReady ? cand.filter((e) => sigs.get(e.path) !== `${e.size}:${e.mtime}`) : cand;
    await inBatches(todo, 6, async (e) => {
      const body = await fetchFile(e.path);
      if (!body) return;
      sigs.set(e.path, `${e.size}:${e.mtime}`);
      if (!baselineReady) { baseline.set(e.path, body.content); return; }
      if (!baseline.has(e.path)) baseline.set(e.path, null);
      curCache.set(e.path, body.content);
      recordChange(e.path, baseline.get(e.path) ?? null, body.content);
      followDisk(e.path, body.content); // open tabs follow the disk (clean ones update, dirty ones are flagged)
    });
    // Too large or binary to diff: a NEW such file, or one that grew past the limit, is still a change we can undo.
    for (const e of tree) {
      if (e.type !== "file" || trackable(e)) continue;
      const sig = `${e.size}:${e.mtime}`;
      if (!baselineReady) { initialPaths.add(e.path); sigs.set(e.path, sig); continue; }
      if (sigs.get(e.path) === sig) continue;
      sigs.set(e.path, sig);
      const b = baseline.has(e.path) ? baseline.get(e.path) : initialPaths.has(e.path) ? undefined : null;
      if (b === undefined) continue; // existed before, no earlier copy: nothing to compare or restore
      if (b === null) baseline.set(e.path, null); // (so a later delete of this file clears the entry below)
      changeVer.set(e.path, ++verSeq); resolutions.delete(e.path);
      changes = { ...changes, [e.path]: { status: b === null ? "added" : "modified", add: 0, del: 0, opaque: true } };
    }
    if (!baselineReady) for (const e of tree) if (e.type === "file") initialPaths.add(e.path);
    if (baselineReady) {
      for (const [p, b] of baseline) {
        if (!all.has(p) && b !== null && !changes[p]) { curCache.delete(p); recordChange(p, b, null); }
        else if (!all.has(p) && b === null) { baseline.delete(p); const n = { ...changes }; delete n[p]; changes = n; }
      }
    }
    baselineReady = true;
  }
  async function refreshTree() {
    if (refreshing) return;
    refreshing = true;
    try {
      const r = await fetch(`${API}/api/playgrounds/${id}/tree`);
      if (!r.ok) return;
      const body = await r.json();
      tree = body.entries;
      treeTruncated = !!body.truncated;
      if (!treeSeeded && tree.length) {
        treeSeeded = true;
        const tops = tree.filter((e) => e.type === "dir" && !e.path.includes("/") && !e.collapsed).map((e) => e.path);
        if (tops.length <= 12) expanded = new Set(tops);
      }
      await trackChanges();
    } catch { /* retry next tick */ } finally { refreshing = false; }
  }
  const listFiles = refreshTree;
  async function keepChange(path: string) {
    const st = changes[path];
    if (!st) return;
    if (st.status === "deleted") baseline.delete(path);
    else baseline.set(path, curCache.get(path) ?? (await fetchFile(path))?.content ?? "");
    const n = { ...changes }; delete n[path]; changes = n;
    resolutions.set(path, "kept"); editedByStudent.delete(path);
  }
  // One question at a time: "this will also discard your own edits" (used by Undo from the Changes tab AND from chat cards).
  let discardAsk = $state<{ path: string; reason: "unsaved" | "saved"; resolve: (ok: boolean) => void } | null>(null);
  const askDiscard = (path: string, reason: "unsaved" | "saved") => new Promise<boolean>((resolve) => { discardAsk = { path, reason, resolve }; });
  function answerDiscard(ok: boolean) { const a = discardAsk; discardAsk = null; a?.resolve(ok); }
  const reverting = new Set<string>();
  async function revertChange(path: string) {
    if (!changes[path] || reverting.has(path)) return; // already resolved elsewhere (card vs Changes tab): never apply twice
    reverting.add(path);
    try {
      const tab = edTabs.find((t) => t.params.path === path);
      const reason = tab && dirtyIds.has(tab.id) ? "unsaved" : editedByStudent.has(path) ? "saved" : null;
      if (reason && !(await askDiscard(path, reason))) return;
      const st = changes[path];
      if (!st) return;
      const b = baseline.get(path) ?? null;
      const r = b === null
        ? await fetch(`${API}/api/playgrounds/${id}/files?path=${encodeURIComponent(path)}`, { method: "DELETE" })
        : await fetch(`${API}/api/playgrounds/${id}/files/content`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, content: b }) });
      if (!r.ok) { showToast(`could not revert ${path}`); return; }
      if (b === null) baseline.delete(path);
      sigs.delete(path); curCache.delete(path);
      const n = { ...changes }; delete n[path]; changes = n;
      resolutions.set(path, "undone"); editedByStudent.delete(path);
      await refreshTree();
      await reloadEditorFor(path);
    } finally { reverting.delete(path); }
  }
  async function keepAll() { for (const [p] of changeList) await keepChange(p); }
  let confirmRevertAll = $state(false);
  async function revertAll() {
    if (!confirmRevertAll) { confirmRevertAll = true; return; }
    confirmRevertAll = false;
    for (const [p] of changeList) await revertChange(p);
  }
  // diff cards (Changes view)
  let openCards = $state<Set<string>>(new Set());
  let cardDiffs = $state<Record<string, (DiffLine | { gap: number })[]>>({});
  async function toggleCard(path: string) {
    const n = new Set(openCards);
    if (n.has(path)) { n.delete(path); openCards = n; return; }
    n.add(path); openCards = n;
    if (changes[path]?.opaque) return; // no line diff for big/binary files
    const cur = changes[path]?.status === "deleted" ? "" : (curCache.get(path) ?? (await fetchFile(path))?.content ?? "");
    cardDiffs = { ...cardDiffs, [path]: withContext(diffLines(baseline.get(path) ?? "", cur)) };
  }
  $effect(() => {
    // keep open cards fresh when their file changes again
    const paths = [...openCards];
    for (const p of paths) {
      const st = changes[p];
      if (!st) continue;
      const cur = st.status === "deleted" ? "" : curCache.get(p);
      if (cur !== undefined) cardDiffs[p] = withContext(diffLines(baseline.get(p) ?? "", cur));
    }
  });

  // What the chat's edit cards use: the same change list, Keep and Undo as the Changes tab (see lib/agent/edits.ts).
  const editHost: EditHost = {
    change: (p) => changes[p],
    resolution: (p) => resolutions.get(p),
    version: (p) => changeVer.get(p) ?? 0,
    versions: () => new Map(changeVer),
    hasBaseline: (p) => baseline.has(p),
    syncNow: async () => { for (let i = 0; i < 60 && refreshing; i++) await new Promise((r) => setTimeout(r, 50)); await refreshTree(); },
    flushSaves: () => flushSaves(),
    keep: (p) => keepChange(p),
    undo: (p) => revertChange(p),
    viewDiff: async (p) => { centerView = "changes"; if (!openCards.has(p)) await toggleCard(p); },
    openFile: (p) => openFile(p),
  };

  // --- views, quick open, project search ---
  let centerView = $state<"code" | "preview" | "changes">(shell === "chat" ? "preview" : "code");
  let qo = $state<{ q: string; sel: number } | null>(null);
  function fuzzy(q: string, p: string): number {
    if (!q) return 1;
    const s = p.toLowerCase(), qq = q.toLowerCase();
    const name = s.split("/").pop() ?? s;
    if (name.startsWith(qq)) return 1000 - name.length;
    if (name.includes(qq)) return 700 - name.length;
    let i = 0, score = 0;
    for (const ch of qq) { const j = s.indexOf(ch, i); if (j < 0) return 0; score += j === i ? 3 : 1; i = j + 1; }
    return 100 + score - s.length / 10;
  }
  const qoItems = $derived.by(() => {
    if (!qo) return [] as string[];
    return tree.filter((e) => e.type === "file").map((e) => ({ p: e.path, s: fuzzy(qo!.q, e.path) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 12).map((x) => x.p);
  });
  function onGlobalKey(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === "p") { e.preventDefault(); qo = { q: "", sel: 0 }; return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); sideView = "search"; setTimeout(() => document.getElementById("proj-search")?.focus(), 0); return; }
    if (e.key === "Escape" && qo) qo = null;
  }
  async function qoPick(p: string) { qo = null; centerView = "code"; await openFile(p); }
  let sideView = $state<"files" | "search">("files");
  let sq = $state("");
  let sres = $state<{ path: string; line: number; text: string }[]>([]);
  let searching = $state(false);
  let searchNote = $state("");
  const searchCache = new Map<string, { sig: string; content: string }>();
  async function runSearch() {
    const q = sq.trim();
    if (!q || searching) return;
    searching = true; searchNote = "";
    const cand = tree.filter(trackable);
    await inBatches(cand.slice(0, 300), 6, async (e) => {
      const sig = `${e.size}:${e.mtime}`;
      if (searchCache.get(e.path)?.sig === sig) return;
      const b = await fetchFile(e.path);
      if (b) searchCache.set(e.path, { sig, content: b.content });
    });
    const out: typeof sres = [];
    const ql = q.toLowerCase();
    for (const e of cand) {
      const c = searchCache.get(e.path)?.content;
      if (!c) continue;
      const lines = c.split("\n");
      for (let i = 0; i < lines.length && out.length < 200; i++) if (lines[i].toLowerCase().includes(ql)) out.push({ path: e.path, line: i + 1, text: lines[i].trim().slice(0, 160) });
    }
    sres = out;
    searchNote = out.length ? (out.length >= 200 ? "first 200 matches" : `${out.length} match${out.length === 1 ? "" : "es"}`) : "no matches";
    searching = false;
  }

  async function activateEditor(tabId: string | null) {
    if (view && activeEd) edStates.set(activeEd, view.state);
    activeEd = tabId;
    showDiff = false;
    fileNotice = "";
    if (!tabId) { showState(EditorState.create({ doc: PLACEHOLDER, extensions: [basicSetup, themeComp.of(themeExt())] })); persistLayout(); return; }
    const tab = tabs.find((t) => t.id === tabId);
    let st = edStates.get(tabId);
    if (!st && tab) {
      const path = tab.params.path as string;
      const body = await fetchFile(path);
      if (!body) { fileNotice = `cannot open ${path}`; closeEditor(tabId, true); return; }
      st = mkState(body.content, path);
      edStates.set(tabId, st);
      savedContent.set(tabId, body.content);
      if (body.truncated) fileNotice = "large file, showing first 256KB";
    }
    if (st) showState(st);
    persistLayout();
  }
  async function openFile(path: string, line?: number) {
    centerView = "code";
    const existing = edTabs.find((t) => t.params.path === path);
    if (existing) await activateEditor(existing.id);
    else {
      const body = await fetchFile(path);
      if (!body) { fileNotice = `cannot open ${path}`; return; }
      if (tabs.length >= 30) { showToast("tab limit reached, close some tabs first"); return; }
      const tab: Tab = { id: `ed-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, type: "editor", title: path.split("/").pop() ?? path, params: { path } };
      tabs = [...tabs, tab];
      edStates.set(tab.id, mkState(body.content, path));
      savedContent.set(tab.id, body.content);
      await activateEditor(tab.id);
      if (body.truncated) fileNotice = "large file, showing first 256KB";
    }
    const i = path.lastIndexOf("/");
    selDir = i < 0 ? "" : path.slice(0, i);
    if (line && view && line <= view.state.doc.lines) {
      const pos = view.state.doc.line(line).from;
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      view.focus();
    }
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
      activeEd = null;
      void activateEditor(next?.id ?? null);
    } else persistLayout();
  }
  const inflightSaves = new Set<Promise<void>>();
  function saveFile(tabId: string | null = activeEd): Promise<void> {
    const p = saveFileNow(tabId).finally(() => inflightSaves.delete(p));
    inflightSaves.add(p);
    return p;
  }
  /** Everything the student typed is on disk when this resolves (the agent reads from disk). A tab whose file the
   *  agent changed meanwhile is NOT flushed: that would silently overwrite the agent's version; the student decides. */
  async function flushSaves() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    const skipped: string[] = [];
    for (const t of edTabs) {
      if (!dirtyIds.has(t.id)) continue;
      if (conflicts.has(t.id)) { skipped.push(t.title); continue; }
      await saveFile(t.id);
    }
    await Promise.all([...inflightSaves]);
    if (skipped.length) showToast(`not saved: ${skipped.join(", ")} changed on disk while you were editing. Save it yourself to overwrite.`);
  }
  async function saveFileNow(tabId: string | null) {
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
    if (r.ok) {
      savedContent.set(tabId, content); setDirty(tabId, false);
      // your own edits are accepted: only changes made outside the editor are flagged
      const p = tab.params.path as string;
      if (baselineReady && !changes[p]) baseline.set(p, content);
      else if (changes[p]) editedByStudent.add(p); // the pending change now includes the student's own edits
      curCache.set(p, content);
      void refreshTree();
    }
  }
  /** Pull in a change made outside the editor (terminal, agent). Clean tabs, active or not, take the disk version;
   *  a tab with unsaved edits is never overwritten: it is flagged as a conflict and the banner explains. */
  function followDisk(path: string, content: string) {
    const t = edTabs.find((x) => x.params.path === path);
    if (!t) return;
    if (dirtyIds.has(t.id)) { if (content !== savedContent.get(t.id) && !conflicts.has(t.id)) conflicts = new Set([...conflicts, t.id]); return; }
    if (content === savedContent.get(t.id)) return;
    savedContent.set(t.id, content);
    if (t.id === activeEd && view) {
      if (content === view.state.doc.toString()) return;
      suppressDirty = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
      suppressDirty = false;
      fileNotice = "updated from disk";
    } else edStates.set(t.id, mkState(content, path));
  }
  /** Reload one tab from disk (after Undo). Other tabs, and their unsaved edits, are left alone. */
  async function reloadEditorFor(path: string) {
    const t = edTabs.find((x) => x.params.path === path);
    if (!t) return;
    const body = await fetchFile(path);
    if (!body) { closeEditor(t.id, true); return; }
    const st = mkState(body.content, path);
    edStates.set(t.id, st);
    savedContent.set(t.id, body.content);
    setDirty(t.id, false);
    if (t.id === activeEd) showState(st);
  }
  async function reloadEditors() {
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

  // --- laptop <-> workspace transfer ---
  let uploading = $state(false);
  let dragOver = $state(false);
  let filePick: HTMLInputElement | undefined = $state();
  let dirPick: HTMLInputElement | undefined = $state();
  async function doUpload(getItems: () => ReturnType<typeof collectInput> | Promise<ReturnType<typeof collectInput>>) {
    if (uploading) return;
    uploading = true;
    fileNotice = "uploading…";
    try {
      const r = await upload(API, id, await getItems(), selDir);
      fileNotice = describeUpload(r);
      await refreshTree();
    } catch (e) {
      fileNotice = `upload failed: ${(e as Error).message}`;
    } finally {
      uploading = false;
    }
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    if (e.dataTransfer) { const dt = e.dataTransfer; void doUpload(() => collectDropped(dt)); }
  }
  function onPicked(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const list = el.files;
    if (list?.length) void doUpload(() => collectInput(list));
    el.value = "";
  }

  // --- explorer: new file/folder, rename, delete ---
  let newFileName = $state<string | null>(null);
  let newIsFolder = $state(false);
  let renamingPath = $state<string | null>(null);
  let renameTo = $state("");
  let deletingPath = $state<string | null>(null);
  async function createEntry() {
    const name = (newFileName ?? "").trim().replace(/^\/+|\/+$/g, "");
    const folder = newIsFolder;
    newFileName = null; newIsFolder = false;
    if (!name) return;
    const path = selDir ? `${selDir}/${name}` : name;
    const r = await fetch(`${API}/api/playgrounds/${id}/files/content`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: folder ? `${path}/.gitkeep` : path, content: "" }),
    });
    if (!r.ok) { fileNotice = `cannot create: ${(await r.json()).error}`; return; }
    if (selDir) expanded = new Set([...expanded, selDir]);
    if (folder) expanded = new Set([...expanded, path]);
    await refreshTree();
    if (!folder) await openFile(path);
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
    baseline.clear(); sigs.clear(); baselineReady = false; changes = {};
    persistLayout();
    await refreshTree();
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
    baseline.delete(path);
    await refreshTree();
  }
  let confirmResetFile = $state(false);
  let confirmResetProject = $state(false);
  let confirmStop = $state(false);
  async function resetFile() {
    if (!openPath || !confirmResetFile) return;
    confirmResetFile = false;
    const r = await fetch(`${API}/api/playgrounds/${id}/files/reset`, {
      method: "POST",
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
    if (r.ok) { showDiff = false; baseline.clear(); sigs.clear(); baselineReady = false; changes = {}; await refreshTree(); await reloadEditors(); fileNotice = "project reset ✓"; }
  }

  // --- terminals (one xterm per term tab, shared session) ---
  let termEls = $state<Record<string, HTMLDivElement | null>>({});
  // Text size (projector/screen-share friendly); remembered per browser.
  let fontSize = $state(13);
  try { const f = Number(localStorage.getItem("rfy_font")); if (f >= 11 && f <= 30) fontSize = f; } catch { /* storage blocked */ }
  function bumpFont(delta: number) {
    fontSize = Math.min(30, Math.max(11, fontSize + delta));
    try { localStorage.setItem("rfy_font", String(fontSize)); } catch { /* storage blocked */ }
    for (const o of Object.values(termObjs)) { o.term.options.fontSize = fontSize; try { o.fit.fit(); } catch {} }
  }
  // Is the coding agent usable in this workspace? (never exposes the key)
  let agent = $state<{ ready: boolean; model?: string | null; reason?: string } | null>(null);
  async function loadAgentStatus() {
    try {
      const r = await fetch(`${API}/api/playgrounds/${id}/agent-status`);
      if (r.ok) agent = await r.json();
    } catch { /* chip simply stays hidden */ }
  }
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
    const term = new XTerm({ fontFamily: '"Source Code Pro",ui-monospace,Menlo,monospace', fontSize, theme: { background: "#051a22", foreground: "#d5dce8", cursor: "#f7d602" } });
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
    if (type === "editor") { newFileName = ""; return; }
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
  // Browser tabs: the first one is the "Preview" view; extras live in the run panel.
  const browserTabs = $derived(tabs.filter((t) => t.type === "browser"));
  const previewTab = $derived(browserTabs[0] ?? null);
  const extraBrowsers = $derived(browserTabs.slice(1));
  const runTabs = $derived(tabs.filter((t) => t.type !== "editor" && t.id !== previewTab?.id));
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
      if (cur?.ready && !force && !stale) return;
      bstate[tabId] = { ready: true, url: b.url, signedAt: Date.now() };
    } catch { /* retry next tick */ }
  }
  function setBrowserPort(tab: Tab, v: string) {
    const n = Math.round(Number(v));
    if (!Number.isInteger(n) || n < 1 || n > 65535) return;
    tab.params.port = n;
    tab.params.userPort = true;
    bstate[tab.id] = { ready: false, hint: `waiting for :${n}. Start your app and this pane goes live.` };
    persistLayout();
    checkBrowser(tab.id, true);
  }
  function setBrowserPath(tab: Tab, v: string) {
    tab.params.path = v.startsWith("/") ? v : `/${v}`;
    persistLayout();
  }
  function ensurePreviewTab() {
    if (tabs.some((t) => t.type === "browser")) return;
    tabs = [...tabs, { id: "br-preview", type: "browser", title: "Preview", params: { port: 3000, path: "/" } }];
    persistLayout();
  }
  setInterval(() => {
    if (centerView === "preview" && previewTab) checkBrowser(previewTab.id);
    const t = tabs.find((x) => x.id === runTab);
    if (t?.type === "browser") checkBrowser(t.id);
  }, 3000);

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
    if (["ts", "js", "jsx", "tsx", "svelte"].includes(ext)) return "◈";
    if (["py"].includes(ext)) return "⬣";
    if (["md", "txt"].includes(ext)) return "☰";
    if (["json", "yaml", "yml", "toml"].includes(ext)) return "⚙";
    if (["css", "scss"].includes(ext)) return "#";
    if (["html", "htm"].includes(ext)) return "‹›";
    if (BINARY.test(name)) return "▣";
    return "◦";
  }
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  onMount(() => {
    theme = currentTheme();
    window.addEventListener("rfy-theme", onThemeEvent);
    window.addEventListener("keydown", onGlobalKey);
    window.addEventListener("resize", refitTerms);
    loadSession().then(async () => {
      loadAgentStatus(); loadTrack();
      await loadLayout();
      ensurePreviewTab();
      startPreview();
      void refreshTree();
      if (termTabs.some((t) => t.id === runTab)) setTimeout(() => attachTerm(runTab), 0);
      const first = edTabs.find((t) => t.id === restoreEditorId) ?? edTabs[0];
      if (first) await activateEditor(first.id);
    });
    view = new EditorView({
      state: EditorState.create({ doc: PLACEHOLDER, extensions: [basicSetup, themeComp.of(themeExt())] }),
      parent: editorEl!,
    });
    pollTimer = setInterval(() => { void refreshTree(); }, document.hidden ? 15000 : 5000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) void refreshTree(); });
    heartbeat();
  });
  onDestroy(() => {
    chatCtl?.dispose();
    previewCtl?.dispose();
    if (pollTimer) clearInterval(pollTimer);
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", refitTerms);
      window.removeEventListener("rfy-theme", onThemeEvent);
      window.removeEventListener("keydown", onGlobalKey);
    }
    view?.destroy();
    for (const t of Object.values(termObjs)) { try { t.ws.close(); } catch {} t.term.dispose(); }
  });
</script>

<div class="win" style:--edfs="{fontSize + 1}px">
  <header class="hdr">
    <div class="l">
      <a class="logo" href="/" aria-label="Rarefy Technologies"><img class="mk mk-dark" src="/brand/rtech-icon-secondary.svg" alt="" /><img class="mk mk-light" src="/brand/rtech-icon-primary.svg" alt="" /></a>
      <span class="crumb"><span class="mut">{hasLesson ? "Lesson" : "Playground"}</span><span class="sep">/</span><b>{id.slice(0, 8)}</b></span>
    </div>
    <div class="r">
      {#if !layoutForced}<span class="layoutsw" role="group" aria-label="Layout"><span class="lbl">Layout</span><button class:on={shell === "classic"} aria-pressed={shell === "classic"} title="Classic: explorer, editor and terminal" onclick={() => setShell("classic")}>Classic</button><button class:on={shell === "chat"} aria-pressed={shell === "chat"} title="Chat: agent chat beside a large live preview" onclick={() => setShell("chat")}>Chat</button></span>{/if}
      {#if agent}<span class="agentchip" class:off={!agent.ready} title={agent.ready ? "Your coding agent has its model key. Run opencode in the terminal." : (agent.reason ?? "No model key installed. Ask your instructor for a class code.")}><i></i>{agent.ready ? `Agent ready${(chatCtl?.model ?? agent.model) ? ` · ${(chatCtl?.model ?? agent.model)!.split("/").pop()}` : ""}` : "No agent key"}</span>{/if}
      <span class="timer" class:urgent={ttlUrgent} title={ttlUrgent ? "less than 15 minutes left, download your work" : "time remaining"}>{ttlText}</span>
      <span class="fontbtns" role="group" aria-label="text size"><button class="ibtn" aria-label="smaller text" onclick={() => bumpFont(-1)}>A−</button><button class="ibtn" aria-label="larger text" onclick={() => bumpFont(1)}>A+</button></span>
      <button class="ibtn" aria-label="switch to {theme === 'dark' ? 'light' : 'dark'} mode" title="switch theme" onclick={() => (theme = toggleTheme())}>{theme === "dark" ? "☀" : "☾"}</button>
      <button class="ibtn" title="upload files from your computer" onclick={() => filePick?.click()}>⬆ Upload</button>
      <a class="ibtn" href={downloadUrl(API, id)} download title="download your project as a .zip (node_modules and .git left out)">⬇ Download .zip</a>
      {#if confirmStop}
        <span class="confirm-inline">Stop this workspace? <button class="ibtn danger" onclick={() => fetch(`${API}/api/playgrounds/${id}`, { method: "DELETE" }).then(() => location.assign("/"))}>yes, stop</button> <button class="ibtn" onclick={() => (confirmStop = false)}>keep</button></span>
      {:else}
        <button class="ibtn danger" onclick={() => (confirmStop = true)}>Stop</button>
      {/if}
    </div>
  </header>

  <input type="file" multiple hidden bind:this={filePick} onchange={onPicked} aria-label="upload files" />
  <input type="file" hidden webkitdirectory bind:this={dirPick} onchange={onPicked} aria-label="upload folder" />

  <div class="dock" class:learn={hasLesson && !hideLearn} class:chat={shell === "chat"} class:dfiles={drawer === "files"} class:dterm={drawer === "terminal"}>
    {#if hasLesson && !hideLearn}
    <section class="steps card">
      <div class="colbar">Learn <button onclick={() => (hideLearn = true)}>⟨ hide</button></div>
      <div class="body">
        {#if loading}
          <div class="skel"></div><div class="skel" style="width:70%"></div><div class="skel" style="width:85%"></div>
        {:else if loadError}
          <p class="errtxt">{loadError}</p>
          <p><button class="retry" onclick={loadSession}>↻ retry</button> <a href="/">← start a fresh playground</a></p>
        {/if}
        <div class="meta">{TRACK} · {steps.length ? `step ${curStep + 1} of ${steps.length}` : "free playground"}</div>
        {#each steps as s, i}
          <div class="step" class:cur={i === curStep} onclick={() => (curStep = i, checkHint = "", checkOk = null)}><span class="tick">{passedSteps.has(s.slug) ? "✓ " : ""}</span>{s.title}</div>
        {/each}
        {#if steps[curStep]}<div class="assign">{@html renderMd(steps[curStep].assignment)}</div>{/if}
      </div>
      <div class="checkbar">
        <button onclick={runCheck} disabled={checking}>{checking ? "checking…" : "Check ✓"}</button>
        {#if checkHint}<div class="hint" class:okh={checkOk === true} class:warnh={checkOk === false}>{checkHint}</div>{/if}
        <div style="margin-top:8px;text-align:center">
          {#if confirmSolve}
            <span style="font-size:12px">show solution? it's recorded. <a href="#" onclick={(e) => (e.preventDefault(), unlockSolution())}>yes</a> · <a href="#" onclick={(e) => (e.preventDefault(), confirmSolve = false)}>no</a></span>
          {:else}
            <a href="#" class="mut" style="font-size:12px" onclick={(e) => (e.preventDefault(), unlockSolution())}>stuck? unlock the solution</a>
          {/if}
        </div>
        {#if confirmGrade}
          <p style="font-size:12px;text-align:center">frozen snapshot, immutable record. <button class="mini" onclick={submitGrade}>submit</button> <button class="mini ghost" onclick={() => (confirmGrade = false)}>cancel</button></p>
        {:else}
          <button class="outline" onclick={submitGrade} disabled={grading}>{grading ? "grading…" : "Submit for grade"}</button>
        {/if}
        {#if gradeInfo}<div class="hint">{gradeInfo}</div>{/if}
      </div>
    </section>
    {/if}

    <section class="chatp card" aria-label="agent chat">
      {#if chatCtl}<ChatPanel ctl={chatCtl} />{/if}
    </section>

    <aside class="files card" class:dragover={dragOver} aria-label="explorer"
      ondragover={(e) => { e.preventDefault(); dragOver = true; }} ondragleave={(e) => { if (e.currentTarget === e.target) dragOver = false; }} ondrop={onDrop}>
      <div class="fh">
        <button class="dclose" aria-label="close files" onclick={() => (drawer = null)}>×</button>
        <button class="sv" class:on={sideView === "files"} onclick={() => (sideView = "files")}>Files</button>
        <button class="sv" class:on={sideView === "search"} onclick={() => { sideView = "search"; setTimeout(() => document.getElementById("proj-search")?.focus(), 0); }} title="search all files (Ctrl+Shift+F)">Search</button>
        <span class="sp"></span>
        <button class="xbtn" aria-label="new file" title="new file" onclick={() => { newIsFolder = false; newFileName = ""; sideView = "files"; }}>＋</button>
        <button class="xbtn" aria-label="new folder" title="new folder" onclick={() => { newIsFolder = true; newFileName = ""; sideView = "files"; }}>▭＋</button>
        <button class="xbtn" aria-label="upload folder" title="upload a folder from your computer" onclick={() => dirPick?.click()}>⬆</button>
      </div>
      {#if sideView === "files"}
        {#if dragOver}<div class="dropnote">Drop files or folders to upload{selDir ? ` into ${selDir}` : ""}</div>{/if}
        {#if newFileName !== null}
          <input class="xin" aria-label={newIsFolder ? "new folder name" : "new file name"} placeholder={newIsFolder ? "folder name" : "name.ext"} bind:value={newFileName} use:focusEl onkeydown={(e) => { if (e.key === "Enter") createEntry(); else if (e.key === "Escape") newFileName = null; }} onblur={() => (newFileName = null)} />
        {/if}
        <div class="tree" role="tree">
          <div class="root" class:selroot={selDir === ""} role="treeitem" aria-selected={selDir === ""} onclick={() => (selDir = "")}>{`~/workspace`}</div>
          {#each rows as { e, depth } (e.path)}
            {#if renamingPath === e.path}
              <input class="xin" aria-label="rename" bind:value={renameTo} use:focusEl onkeydown={(ev) => { if (ev.key === "Enter") renameEntry(); else if (ev.key === "Escape") renamingPath = null; }} onblur={() => (renamingPath = null)} />
            {:else if deletingPath === e.path}
              <div class="tr warn">delete {e.path.split("/").pop()}? <a href="#" onmousedown={(ev) => (ev.preventDefault(), deleteEntry())}>yes</a> · <a href="#" onmousedown={(ev) => (ev.preventDefault(), deletingPath = null)}>no</a></div>
            {:else}
              <div class="tr" class:sel={e.type === "file" ? openPath === e.path : selDir === e.path} role="treeitem" aria-selected={openPath === e.path} title={e.path} data-path={e.path}
                style:padding-left="{10 + depth * 14}px"
                onclick={() => { if (e.type === "dir") { selDir = e.path; if (!e.collapsed) toggleDir(e.path); } else void openFile(e.path); }}>
                <span class="chev">{e.type === "dir" ? (expanded.has(e.path) && !e.collapsed ? "▾" : "▸") : ""}</span>
                <span class="fic" class:dirc={e.type === "dir"}>{e.type === "dir" ? "" : fileIcon(e.path.split("/").pop() ?? "", e.type)}</span>
                <span class="fname" class:dim={e.collapsed}>{e.path.split("/").pop()}</span>
                {#if changes[e.path]}<span class="cdot" title="changed outside the editor"></span>{/if}
                <span class="racts"><a class="dl" aria-label="download {e.path}" title={e.type === "dir" ? "download folder as .zip" : "download file"} href={downloadUrl(API, id, e.path)} onclick={(ev) => ev.stopPropagation()}>⬇</a><button aria-label="rename {e.path}" onclick={(ev) => { ev.stopPropagation(); renamingPath = e.path; renameTo = e.path; }}>✎</button><button aria-label="delete {e.path}" onclick={(ev) => { ev.stopPropagation(); deletingPath = e.path; }}>🗑</button></span>
              </div>
            {/if}
          {:else}
            <div class="empty">Empty so far. Create a file, or drop a folder here.</div>
          {/each}
          {#if treeTruncated}<div class="empty">Large project: showing the first files only.</div>{/if}
        </div>
        <div class="dropzone">Drop files or a folder to upload{selDir ? ` into ${selDir}/` : ""}</div>
        {#if hasLesson}
          {#if confirmResetProject}
            <div class="tr warn">reset all? <a href="#" onclick={(e) => (e.preventDefault(), resetProject())}>yes</a> · <a href="#" onclick={(e) => (e.preventDefault(), confirmResetProject = false)}>no</a></div>
          {:else}
            <div class="tr" onclick={() => (confirmResetProject = true)}>⟲ reset project</div>
          {/if}
        {/if}
      {:else}
        <form class="sform" onsubmit={(e) => { e.preventDefault(); void runSearch(); }}>
          <input id="proj-search" class="xin" placeholder="Search in all files" bind:value={sq} autocomplete="off" spellcheck="false" />
        </form>
        <div class="sres">
          {#if searching}<div class="empty">searching…</div>{:else if searchNote}<div class="empty">{searchNote}</div>{/if}
          {#each sres as m, i (i)}
            <div class="sr" onclick={() => openFile(m.path, m.line)}><span class="sp1">{m.path}<i>:{m.line}</i></span><span class="sp2">{m.text}</span></div>
          {/each}
        </div>
      {/if}
    </aside>

    <section class="center card">
      <div class="vtabs" role="tablist">
        <button role="tab" class="vt" class:on={centerView === "code"} onclick={() => (centerView = "code")}>Code</button>
        <button role="tab" class="vt" class:on={centerView === "preview"} onclick={() => { centerView = "preview"; if (previewTab) checkBrowser(previewTab.id, true); }}>Preview</button>
        <button role="tab" class="vt" class:on={centerView === "changes"} onclick={() => (centerView = "changes")}>Changes{#if changeList.length}<span class="badge">{changeList.length}</span>{/if}</button>
        <span class="hint-k">Ctrl+P to open a file</span>
        <span class="drawerbtns"><button class="vt" class:on={drawer === "files"} onclick={() => toggleDrawer("files")}>Files</button><button class="vt" class:on={drawer === "terminal"} onclick={() => toggleDrawer("terminal")}>Terminal</button></span>
      </div>

      <div class="pane" class:on={centerView === "code"}>
        <div class="edtabs" role="tablist">
          {#each edTabs as t (t.id)}
            <span class="edt" class:active={activeEd === t.id}>
              <button class="edname" role="tab" data-edtab={t.id} title={t.params.path as string} onclick={() => activateEditor(t.id)}>{t.title}{#if dirtyIds.has(t.id)}<span class="d dirty" title="unsaved"></span>{:else if changes[t.params.path as string]}<span class="d chg" title="changed outside the editor"></span>{/if}</button>
              <button class="edx" aria-label="close {t.title}" onclick={() => closeEditor(t.id)}>×</button>
            </span>
          {/each}
          {#if !edTabs.length}<span class="notab">No file open. Pick one from the explorer or press Ctrl+P.</span>{/if}
        </div>
        {#if openPath && changes[openPath]}
          {@const c = changes[openPath]}
          <div class="banner">
            <span><b>{c.status === "added" ? "New file" : c.status === "deleted" ? "Deleted" : "Changed outside the editor"}</b> <span class="mono">{#if c.add}<span class="pl">+{c.add}</span>{/if} {#if c.del}<span class="mi">−{c.del}</span>{/if}</span></span>
            {#if activeEd && conflicts.has(activeEd)}<span class="conf" data-testid="edit-conflict">You have unsaved edits and this file changed on disk. Your edits are kept and not auto-saved; saving overwrites the changed version.</span>{/if}
            <span class="bactions"><button class="primary" onclick={() => { centerView = "changes"; if (!openCards.has(openPath!)) void toggleCard(openPath!); }}>Review diff</button><button onclick={() => keepChange(openPath!)}>Keep</button><button onclick={() => revertChange(openPath!)}>Revert</button></span>
          </div>
        {/if}
        <div class="edtool">
          <span class="path">{openPath ?? ""}</span>
          <span class="notice">{fileNotice}</span>
          <label class="auto" title="save automatically 1 second after you stop typing"><input type="checkbox" bind:checked={autosave} /> Auto-save</label>
          {#if openPath}
            <button class="savebtn" onclick={() => saveFile()} disabled={!dirty}>Save</button>
            {#if hasLesson}
              <a href="#" onclick={(e) => (e.preventDefault(), loadDiff())}>diff vs starter</a>
              {#if confirmResetFile}<span>reset? <a href="#" onclick={(e) => (e.preventDefault(), resetFile())}>yes</a> · <a href="#" onclick={(e) => (e.preventDefault(), confirmResetFile = false)}>no</a></span>
              {:else}<a href="#" onclick={(e) => (e.preventDefault(), confirmResetFile = true)}>reset file</a>{/if}
            {/if}
          {/if}
        </div>
        {#if showDiff}<pre class="diff">{diffText}</pre>{/if}
        <div class="code" bind:this={editorEl}></div>
      </div>

      <div class="pane" class:on={centerView === "preview"}>
        {#if previewTab}
          <div class="urlbar">
            <button aria-label="reload preview" title="reload" onclick={() => checkBrowser(previewTab!.id, true)}>⟳</button>
            <span class="host">localhost:</span><input class="port" aria-label="preview port" inputmode="numeric" value={String(previewTab.params.port ?? 3000)} onchange={(e) => setBrowserPort(previewTab!, e.currentTarget.value)} />
            <input class="path" aria-label="preview path" value={String(previewTab.params.path ?? "/")} onchange={(e) => setBrowserPath(previewTab!, e.currentTarget.value)} />
          </div>
          {#if bstate[previewTab.id]?.ready}
            <iframe bind:this={previewFrame} title="preview" src={`${bstate[previewTab.id].url}${String(previewTab.params.path ?? "/").replace(/^\//, "")}`} style="flex:1;border:0;background:#fff" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
          {:else if shell === "chat"}
            <PreviewStatus ui={pv.ui} hint={pv.hint} onretry={() => void previewCtl?.ensure({ retry: true })} />
          {:else}
            <div class="prev"><div>◷ {bstate[previewTab.id]?.hint ?? `Waiting for :${previewTab.params.port ?? 3000}.`}<br /><span class="mut">Start your app in the terminal, for example <code>npx serve .</code>. This pane goes live on its own.</span></div></div>
          {/if}
        {/if}
      </div>

      <div class="pane" class:on={centerView === "changes"}>
        <div class="chead">
          {#if changeList.length}
            <span><b>{changeList.length}</b> file{changeList.length === 1 ? "" : "s"} changed outside the editor</span>
            <span class="bactions">
              <button onclick={keepAll}>Keep all</button>
              {#if confirmRevertAll}<button class="dng" onclick={revertAll}>Really revert all?</button><button onclick={() => (confirmRevertAll = false)}>no</button>
              {:else}<button onclick={revertAll}>Revert all</button>{/if}
            </span>
          {:else}
            <span class="mut">Nothing yet. When your agent or a command changes your files, they show up here so you can review them, keep them, or undo them.</span>
          {/if}
        </div>
        <div class="cards">
          {#each changeList as [p, c] (p)}
            <div class="cardx">
              <div class="chd">
                <button class="cname mono" onclick={() => toggleCard(p)}>{openCards.has(p) ? "▾" : "▸"} {p}</button>
                {#if c.add}<span class="mono pl">+{c.add}</span>{/if}{#if c.del}<span class="mono mi">−{c.del}</span>{/if}
                <span class="tag">{c.status}</span>
                <span class="bactions">
                  {#if c.status !== "deleted"}<button onclick={() => openFile(p)}>Open</button>{/if}
                  <button onclick={() => keepChange(p)}>Keep</button><button onclick={() => revertChange(p)}>Revert</button>
                </span>
              </div>
              {#if openCards.has(p) && c.opaque}<div class="dbody mono"><div class="dline gap">No line diff for this file (binary or large). Keep accepts it; Revert {c.status === "added" ? "deletes it" : "restores the earlier copy"}.</div></div>{/if}
              {#if openCards.has(p) && cardDiffs[p]}
                <div class="dbody mono">
                  {#each cardDiffs[p] as l}
                    {#if "gap" in l}<div class="dline gap">⋯ {l.gap} unchanged line{l.gap === 1 ? "" : "s"}</div>
                    {:else}<div class="dline" class:dadd={l.t === "+"} class:ddel={l.t === "-"}><span class="sg">{l.t === " " ? "" : l.t}</span>{l.s}</div>{/if}
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </section>

    <section class="right card">
      <div class="rtabs">
        <button class="dclose" aria-label="close terminal" onclick={() => (drawer = null)}>×</button>
        {#each runTabs as t (t.id)}
          <span class="tabwrap" role="presentation" draggable="true" ondragstart={() => (dragId = t.id)} ondragover={(e) => e.preventDefault()} ondrop={() => dropOn(t.id)}>
            {#if renaming === t.id}
              <input class="tabedit" aria-label="rename tab" bind:value={renameVal} use:focusEl onblur={commitRename} onkeydown={(e) => { if (e.key === "Enter") commitRename(); else if (e.key === "Escape") renaming = null; }} />
            {:else}
              <button class="rt" class:on={runTab === t.id} data-tab={t.id} ondblclick={() => startRename(t)} onclick={() => { showRunTab(t.id); if (t.type === "terminal") setTimeout(() => attachTerm(t.id), 0); else checkBrowser(t.id); }}>{t.type === "browser" ? "◫ " : ""}{t.title}</button>
            {/if}
            {#if runTab === t.id && renaming !== t.id}<button class="tabmenu" aria-label="tab menu" onclick={(e) => openTabMenu(e, t.id)}>⋯</button>{/if}
          </span>
        {/each}
        {#if hasLesson}<button class="rt" class:on={runTab === "Agent"} onclick={() => showRunTab("Agent")}>Lab agent</button>{/if}
        <button class="add" aria-label="new tab" onclick={openChooser}>+</button>
      </div>
      {#each termTabs as t (t.id)}
        <div class="rpane term" class:on={runTab === t.id}><div class="termbar"><span class="tstate {termState[t.id] ?? 'connecting'}">● {termState[t.id] ?? "connecting"}</span><span class="tip">run <code>opencode</code> or <code>claude</code> here</span><button class:alert={termState[t.id] === "disconnected"} onclick={() => reconnectTerm(t.id)} title="reconnect shell">⟳ reconnect</button></div><div class="termwrap" bind:this={termEls[t.id]}></div></div>
      {/each}
      {#each extraBrowsers as t (t.id)}
        <div class="rpane" class:on={runTab === t.id}>
          <div class="urlbar">
            <button aria-label="reload preview" title="reload" onclick={() => checkBrowser(t.id, true)}>⟳</button>
            <span class="host">localhost:</span><input class="port" aria-label="preview port" inputmode="numeric" value={String(t.params.port ?? 3000)} onchange={(e) => setBrowserPort(t, e.currentTarget.value)} />
            <input class="path" aria-label="preview path" value={String(t.params.path ?? "/")} onchange={(e) => setBrowserPath(t, e.currentTarget.value)} />
          </div>
          {#if bstate[t.id]?.ready}
            <iframe title="{t.title} preview" src={`${bstate[t.id].url}${String(t.params.path ?? "/").replace(/^\//, "")}`} style="flex:1;border:0;background:#fff" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
          {:else}
            <div class="prev">◷ {bstate[t.id]?.hint ?? `waiting for :${t.params.port ?? 3000}`}</div>
          {/if}
        </div>
      {/each}
      {#if hasLesson}
      <div class="rpane" class:on={runTab === "Agent"}>
        <div class="agent"><b>Lab agent</b>
          <div class="apolicy">file ✓ allowed · shell ⚠ approval · network/creds ⛔ forbidden</div>
          <button class="abtn" onclick={() => { showRunTab("Agent"); agentFix(); }}>✨ fix step 1 with the agent</button>
          {#if agentStatus}<p class="mut">run: {agentStatus}</p>{/if}
          {#each agentPending as p}
            <div class="approve">{p.tool} needs approval, {p.reason}<br /><code>{JSON.stringify(p.args).slice(0, 160)}</code><br />
              <button class="abtn ok" onclick={() => decide(p.callId, true)}>allow</button>
              <button class="abtn no" onclick={() => decide(p.callId, false)}>deny</button>
            </div>
          {/each}
          {#each agentTrace as t}<div class="trace {t.ok ? '' : 'bad'}"><b>{t.tool}</b> {t.ok ? "✓" : "✗"}: {t.output.slice(0, 200)}</div>{/each}
          {#if agentAudit.length}<div class="fh2">AUDIT (redacted)</div>{#each agentAudit.slice(-8) as a}<div class="trace">#{a.seq} {a.tool} [{a.decision}] {auditArgs(a.argsPreview)}</div>{/each}{/if}
        </div>
      </div>
      {/if}
    </section>
  </div>
</div>

{#if qo}
  <div class="modal-veil" onclick={() => (qo = null)}></div>
  <div class="qo" role="dialog" aria-label="open file">
    <input placeholder="Open file by name…" aria-label="open file by name" bind:value={qo.q} use:focusEl oninput={() => { if (qo) qo.sel = 0; }}
      onkeydown={(e) => {
        if (!qo) return;
        if (e.key === "ArrowDown") { e.preventDefault(); qo.sel = Math.min(qo.sel + 1, qoItems.length - 1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); qo.sel = Math.max(qo.sel - 1, 0); }
        else if (e.key === "Enter" && qoItems[qo.sel]) { e.preventDefault(); void qoPick(qoItems[qo.sel]); }
      }} />
    {#each qoItems as p, i (p)}
      <div class="qi" class:on={qo.sel === i} onclick={() => qoPick(p)}><span>{p.split("/").pop()}</span><i>{p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ""}</i></div>
    {:else}
      <div class="qi none">No matching files</div>
    {/each}
  </div>
{/if}
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
{#if discardAsk}
  <div class="modal-veil" role="presentation" onclick={() => answerDiscard(false)}></div>
  <div class="modal" role="dialog" aria-label="discard your edits" data-testid="discard-ask">
    <b>You changed this file too</b>
    <p>{discardAsk.path} has {discardAsk.reason === "unsaved" ? "unsaved edits of yours in the editor" : "edits you saved after the agent changed it"}. Undoing puts the file back to how it was before the agent's change, so those edits are lost too.</p>
    <button class="mini" onclick={() => answerDiscard(true)}>Undo anyway</button>
    <button class="mini ghost" onclick={() => answerDiscard(false)}>Cancel</button>
  </div>
{/if}
{#if chooser || tabMenu}<div class="menu-veil" role="presentation" onclick={() => { chooser = null; tabMenu = null; }}></div>{/if}
{#if chooser}
  <div class="menu" role="menu" aria-label="new tab type" style:left="{chooser.x}px" style:top="{chooser.y}px">
    <button role="menuitem" onclick={() => addTab("terminal")}>▣ Terminal</button>
    <button role="menuitem" onclick={() => addTab("browser")}>◫ Browser</button>
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
{#if hasLesson && hideLearn}<button class="fab" onclick={() => (hideLearn = false)}>⟩ Learn</button>{/if}


<style>
  .win{display:flex;flex-direction:column;height:100vh;font-family:var(--sans);font-size:14px;background:var(--bg);color:var(--text)}
  .mono{font-family:var(--mono)}.mut{color:var(--muted)}
  .hdr{display:flex;align-items:center;justify-content:space-between;gap:12px;height:56px;padding:0 18px;background:var(--surface);border-bottom:1px solid var(--border);flex:none}
  .hdr .l,.hdr .r{display:flex;align-items:center;gap:10px;min-width:0}
  .hdr .r{flex-wrap:nowrap;overflow:hidden}
  .logo{display:block;height:26px;flex:none}
  .crumb{display:flex;gap:8px;font-size:14.5px;white-space:nowrap}.crumb .sep{color:var(--faint)}
  .timer{font:13px var(--mono);color:var(--muted);white-space:nowrap}.timer.urgent{color:var(--danger);font-weight:700}
  .confirm-inline{font-size:13px;white-space:nowrap}
  .ibtn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:500 13px var(--sans);cursor:pointer;text-decoration:none;white-space:nowrap}
  .ibtn:hover{background:var(--accent-soft)}.ibtn.danger{color:var(--danger)}
  .fontbtns{display:inline-flex;gap:4px}.fontbtns .ibtn{padding:0 9px}
  .agentchip{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px;border-radius:99px;background:var(--ok-soft);color:var(--ok);font-size:13px;font-weight:500;white-space:nowrap}
  .agentchip i{width:8px;height:8px;border-radius:50%;background:var(--ok)}
  .agentchip.off{background:var(--danger-soft);color:var(--warn)}.agentchip.off i{background:var(--warn)}
  .retry,.mini{background:var(--accent);color:var(--accent-ink);border:0;border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer}
  .mini.ghost{background:transparent;color:var(--muted);border:1px solid var(--border)}
  .errtxt{color:var(--danger)}

  .dock{flex:1;min-height:0;display:grid;grid-template-columns:236px minmax(0,1fr) minmax(360px,44%);gap:12px;padding:12px}
  .dock.learn{grid-template-columns:minmax(240px,24%) 220px minmax(0,1fr) minmax(340px,38%)}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;min-height:0;min-width:0;overflow:hidden;display:flex;flex-direction:column}

  .steps{background:var(--surface)}
  .colbar{display:flex;align-items:center;gap:6px;padding:8px 12px;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid var(--border)}
  .colbar button{margin-left:auto;background:none;border:1px solid var(--border);color:var(--muted);border-radius:6px;font-size:12px;cursor:pointer;padding:2px 8px}
  .steps .body{padding:14px 16px;overflow:auto;flex:1}
  .steps .meta{font-size:12px;color:var(--muted);margin-bottom:8px}
  .step{padding:8px 10px;border-radius:8px;margin-bottom:4px;font-size:14px;cursor:pointer}
  .step.cur{background:var(--accent);color:var(--accent-ink)}
  .tick{color:var(--ok);font-weight:800}.step.cur .tick{color:#fff}
  .assign{font-size:13.5px;line-height:1.5}.assign :global(code){background:var(--accent-soft);padding:1px 5px;border-radius:4px}
  .assign :global(pre){background:var(--term-bg);color:#d5dce8;padding:10px;border-radius:8px;font-family:var(--mono);font-size:12px;overflow:auto}
  .skel{height:12px;border-radius:6px;background:var(--border);margin-bottom:8px}
  .checkbar{padding:12px 16px;border-top:1px solid var(--border)}
  .checkbar button{width:100%;padding:10px;border:0;border-radius:8px;background:var(--accent);color:var(--accent-ink);font-size:14px;font-weight:600;cursor:pointer}
  .checkbar button.outline{background:transparent;color:var(--text);border:1px solid var(--border);margin-top:8px}
  .checkbar button:disabled{opacity:.45;cursor:not-allowed}
  .checkbar button.mini{width:auto}
  .hint{margin-top:10px;font-size:13px;border:1px solid var(--border);border-radius:8px;padding:8px 10px}
  .hint.okh{background:var(--ok-soft);border-color:var(--ok)}.hint.warnh{background:var(--danger-soft);border-color:var(--warn)}

  /* explorer */
  .files{position:relative}
  .files.dragover{outline:2px dashed var(--accent);outline-offset:-4px;background:var(--accent-soft)}
  .fh{display:flex;align-items:center;gap:2px;padding:8px 8px 6px;border-bottom:1px solid var(--border);flex:none}
  .fh .sp{flex:1}
  .sv{background:none;border:0;color:var(--muted);font:600 11px var(--sans);letter-spacing:.08em;text-transform:uppercase;padding:5px 7px;border-radius:6px;cursor:pointer}
  .sv.on{color:var(--text);background:var(--accent-soft)}
  .xbtn{white-space:nowrap;background:none;border:0;color:var(--muted);border-radius:6px;font-size:13px;cursor:pointer;padding:3px 6px}.xbtn:hover{background:var(--accent-soft);color:var(--text)}
  .xin{width:calc(100% - 16px);box-sizing:border-box;background:var(--surface2);color:var(--text);border:1px solid var(--accent);border-radius:6px;font:12.5px var(--mono);padding:5px 8px;margin:6px 8px;outline:none}
  .tree{flex:1;overflow:auto;padding:4px 0}
  .root{font:600 11px var(--mono);color:var(--faint);padding:4px 12px;cursor:pointer}.root.selroot{color:var(--accent)}
  .tr{display:flex;align-items:center;gap:6px;height:27px;padding-right:8px;font:13px var(--sans);color:var(--text);cursor:pointer;white-space:nowrap;user-select:none}
  .tr:hover{background:var(--accent-soft)}
  .tr.sel{background:var(--accent-soft);color:var(--accent);font-weight:500}
  .tr.warn{color:var(--danger);padding-left:12px}
  .chev{width:12px;color:var(--muted);font-size:12px;flex:none;text-align:center}
  .fic{width:14px;text-align:center;color:var(--faint);font-size:12px;flex:none}
  .fname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}.fname.dim{color:var(--faint)}
  .cdot{width:7px;height:7px;border-radius:50%;background:var(--accent);flex:none}
  .racts{display:none;gap:2px;align-items:center}.tr:hover .racts{display:inline-flex}
  .racts button,.racts .dl{background:none;border:0;color:var(--muted);font-size:11px;cursor:pointer;padding:0 3px;text-decoration:none}
  .empty{padding:10px 14px;font-size:12.5px;color:var(--muted);line-height:1.5}
  .dropzone{margin:8px 12px 12px;border:1.5px dashed var(--border);border-radius:10px;padding:12px;font-size:12px;line-height:1.5;color:var(--muted);text-align:center;flex:none}
  .dropnote{color:var(--accent);font-size:12px;padding:6px 12px}
  .sform{flex:none}.sres{flex:1;overflow:auto}
  .sr{padding:6px 12px;cursor:pointer;display:flex;flex-direction:column;gap:1px}.sr:hover{background:var(--accent-soft)}
  .sp1{font:12px var(--mono);color:var(--accent)}.sp1 i{color:var(--faint);font-style:normal}
  .sp2{font:12px var(--mono);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  /* center */
  .vtabs{display:flex;align-items:center;height:42px;flex:none;border-bottom:1px solid var(--border);padding:0 6px;gap:2px}
  .vt{height:42px;padding:0 14px;background:none;border:0;border-bottom:2px solid transparent;color:var(--muted);font:500 13.5px var(--sans);cursor:pointer;display:inline-flex;align-items:center}
  .vt.on{color:var(--text);font-weight:600;border-bottom-color:var(--accent)}
  .badge{margin-left:7px;background:var(--accent);color:var(--accent-ink);font-size:11px;border-radius:99px;padding:1px 7px}
  .hint-k{margin-left:auto;padding-right:12px;font-size:12px;color:var(--faint)}
  .pane{display:none;flex:1;min-height:0;flex-direction:column}.pane.on{display:flex}
  .edtabs{display:flex;overflow-x:auto;background:var(--surface2);border-bottom:1px solid var(--border);flex:none;min-height:36px;align-items:flex-end}
  .edt{display:inline-flex;align-items:center;border-right:1px solid var(--border);color:var(--muted);flex:none;height:36px;border-top:2px solid transparent}
  .edt.active{background:var(--surface);color:var(--text);border-top-color:var(--accent)}
  .edname{background:none;border:0;color:inherit;font:13px var(--sans);padding:0 4px 0 14px;height:100%;cursor:pointer;display:inline-flex;align-items:center;gap:8px}
  .d{width:7px;height:7px;border-radius:50%}.d.dirty{background:var(--text)}.d.chg{background:var(--accent)}
  .edx{background:none;border:0;color:var(--faint);font-size:15px;padding:0 9px;cursor:pointer}.edx:hover{color:var(--text)}
  .notab{padding:0 14px;align-self:center;font-size:12.5px;color:var(--muted)}
  .conf{flex-basis:100%;color:var(--warn);font-size:12.5px}
  .banner{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 14px;background:var(--accent-soft);border-bottom:1px solid var(--border);font-size:13px;flex:none;flex-wrap:wrap}
  .pl{color:var(--ok)}.mi{color:var(--danger)}
  .bactions{display:inline-flex;gap:8px;margin-left:auto}
  .bactions button{height:28px;padding:0 12px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:500 12.5px var(--sans);cursor:pointer}
  .bactions button.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
  .bactions button.dng{color:var(--danger);border-color:var(--danger)}
  .edtool{display:flex;align-items:center;gap:12px;padding:6px 14px;font-size:12px;border-bottom:1px solid var(--border);flex:none;flex-wrap:wrap}
  .edtool .path{font-family:var(--mono);color:var(--muted)}.edtool .notice{color:var(--faint);margin-left:auto}
  .edtool a{color:var(--accent)}.auto{display:inline-flex;align-items:center;gap:5px;color:var(--muted);cursor:pointer}
  .savebtn{background:var(--accent);color:var(--accent-ink);border:0;border-radius:6px;font:600 12px var(--sans);padding:4px 12px;cursor:pointer}.savebtn:disabled{opacity:.4;cursor:default}
  .diff{margin:0;padding:10px 12px;font:12px var(--mono);background:var(--surface2);color:var(--text);max-height:180px;overflow:auto;white-space:pre-wrap}
  .code{flex:1;min-height:0;overflow:hidden}
  .code :global(.cm-editor){height:100%}
  .code :global(.cm-editor .cm-scroller),.code :global(.cm-editor .cm-content){font-size:var(--edfs,14px)}
  .code :global(.cm-editor.cm-focused){outline:none}
  .code :global(.cm-editor),.code :global(.cm-gutters){background:var(--surface)!important}
  .code :global(.cm-activeLine),.code :global(.cm-activeLineGutter){background:var(--accent-soft)!important}
  .code :global(.cm-cursor){border-left-color:var(--accent)!important}

  /* changes */
  .chead{display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border);font-size:13.5px;flex:none;flex-wrap:wrap}
  .cards{flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
  .cardx{border:1px solid var(--border);border-radius:10px;overflow:hidden}
  .chd{display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--surface2);font-size:13px;flex-wrap:wrap}
  .cname{background:none;border:0;color:var(--text);font-size:12.5px;cursor:pointer;padding:0}
  .tag{font-size:11px;color:var(--muted);border:1px solid var(--border);border-radius:99px;padding:1px 8px}
  .dbody{font-size:12px;line-height:1.6;overflow:auto;max-height:340px;border-top:1px solid var(--border)}
  .dbody .dline{display:flex;white-space:pre;padding:0 12px;color:var(--text)}
  .dbody .dline.dadd{background:var(--add-bg)}.dbody .dline.ddel{background:var(--del-bg)}.dbody .dline.gap{color:var(--faint);background:var(--surface2)}
  .sg{width:16px;flex:none;color:var(--muted)}

  /* preview + browser */
  .urlbar{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--border);flex:none;font:12px var(--mono);color:var(--muted)}
  .urlbar button{background:none;border:1px solid var(--border);color:var(--text);border-radius:6px;cursor:pointer;padding:1px 8px}
  .urlbar input{background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:6px;font:12px var(--mono);padding:3px 6px}
  .urlbar .port{width:64px}.urlbar .path{flex:1;min-width:0}
  .prev{margin:14px;border:1px dashed var(--border);border-radius:10px;flex:1;display:grid;place-items:center;color:var(--muted);text-align:center;padding:16px;line-height:1.7}
  .prev code{background:var(--accent-soft);padding:1px 6px;border-radius:4px}

  /* right: terminals */
  .right{background:var(--term-bg);border-color:var(--border)}
  .rtabs{display:flex;align-items:center;gap:2px;height:38px;padding:0 8px;flex:none;border-bottom:1px solid #12303d;overflow-x:auto}
  .tabwrap{display:inline-flex;align-items:center;flex:none}
  .rt{height:38px;padding:0 12px;background:none;border:0;border-bottom:2px solid transparent;color:#7b8697;font:500 12.5px var(--sans);cursor:pointer;white-space:nowrap}
  .rt.on{color:#f2f5fa;border-bottom-color:var(--accent)}
  .tabmenu{border:0;background:transparent;color:#7b8697;font-size:15px;cursor:pointer;padding:0 4px}
  .tabedit{height:26px;border:1px solid var(--accent);border-radius:6px;padding:0 8px;font-size:12.5px;width:110px;background:#0a232d;color:#f2f5fa}
  .add{border:0;background:transparent;color:#7b8697;width:30px;height:30px;font-size:18px;cursor:pointer;flex:none}
  .rpane{flex:1;min-height:0;display:none}.rpane.on{display:flex;flex-direction:column}
  .termbar{display:flex;align-items:center;gap:10px;padding:4px 12px;font-size:11.5px;color:#7b8697;flex:none}
  .termbar .tip{margin-left:auto}.termbar code{color:#a9b4c6}
  .termbar button{background:none;border:1px solid #1b4152;color:#a9b4c6;border-radius:6px;cursor:pointer;font-size:12px;padding:1px 8px}
  .termbar button.alert{border-color:var(--danger);color:var(--danger)}
  .tstate.connected{color:#34d399}.tstate.disconnected{color:#f87171}.tstate.connecting{color:#fbbf24}
  .termwrap{flex:1;min-height:0;padding:4px 10px 10px}.termwrap :global(.xterm){height:100%}
  .right .urlbar{background:#0a232d;border-color:#12303d}.right .prev{color:#93a0b4;border-color:#1b4152}
  .agent{padding:14px;font-size:13px;overflow:auto;color:#d5dce8}
  .apolicy{background:#12303d;border-radius:8px;padding:8px 10px;margin:8px 0;font-size:12.5px}
  .abtn{background:#1b4152;color:#fff;border:0;border-radius:6px;padding:6px 12px;font-weight:600;cursor:pointer;margin:4px 4px 4px 0}
  .abtn.ok{background:#16a34a}.abtn.no{background:#7f1d1d}
  .approve{border:1px solid var(--warn);border-radius:8px;padding:8px 10px;margin-top:8px;font-size:12.5px}
  .trace{font:11.5px var(--mono);color:#a5b4fc;margin-top:6px;word-break:break-word}.trace.bad{color:#fca5a5}
  .fh2{margin-top:10px;color:#7b8697;font-size:11px}

  /* overlays */
  .menu-veil{position:fixed;inset:0;z-index:40}
  .menu{position:fixed;z-index:41;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow);padding:4px;min-width:170px;display:flex;flex-direction:column}
  .menu button{text-align:left;background:none;border:0;padding:8px 12px;border-radius:6px;font-size:13px;cursor:pointer;color:var(--text)}
  .menu button:hover:not(:disabled){background:var(--accent-soft)}.menu button:disabled{color:var(--faint);cursor:not-allowed}
  .menu button.danger{color:var(--danger)}.menu .confirm{padding:8px 12px;font-size:12.5px}
  .menu .confirm button{display:inline;padding:3px 8px;background:var(--accent-soft);margin-top:6px}
  .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--text);color:var(--bg);padding:10px 18px;border-radius:8px;z-index:60}
  .modal-veil{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:50}
  .modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:12px;padding:20px 24px;z-index:51;max-width:380px;box-shadow:var(--shadow)}
  .modal p{font-size:13px;color:var(--muted)}.modal button{margin-right:8px}
  .qo{position:fixed;top:14vh;left:50%;transform:translateX(-50%);width:min(560px,92vw);background:var(--surface);border:1px solid var(--border);border-radius:12px;z-index:51;box-shadow:var(--shadow);overflow:hidden}
  .qo input{width:100%;box-sizing:border-box;border:0;border-bottom:1px solid var(--border);background:transparent;color:var(--text);font:15px var(--sans);padding:14px 16px;outline:none}
  .qi{display:flex;gap:10px;align-items:baseline;padding:8px 16px;font-size:13.5px;cursor:pointer}.qi i{color:var(--faint);font-style:normal;font-size:12px;font-family:var(--mono)}
  .qi.on{background:var(--accent-soft)}.qi.none{color:var(--muted);cursor:default}
  .fab{position:fixed;left:0;top:110px;z-index:6;background:var(--accent);color:var(--accent-ink);border:0;padding:8px 10px;font-size:13px;cursor:pointer;border-radius:0 8px 8px 0}

  /* narrow windows: files column shrinks, terminal drops below the editor */
  @media (max-width:1200px){
    .dock,.dock.learn{grid-template-columns:210px minmax(0,1fr);grid-template-rows:minmax(0,1.2fr) minmax(0,1fr)}
    .dock.learn .steps{display:none}
    .right{grid-column:1 / -1}
    .hint-k{display:none}
  }
  @media (max-width:760px){
    .dock,.dock.learn{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,1fr)}
    .files{display:none}
    .hdr .r .ibtn:not(.danger):not(:nth-last-child(-n+3)){display:none}
  }

  /* layout switch + Chat shell. Classic rules above are untouched; everything below is scoped to .dock.chat
     (or hidden by default), and the same live panels are only re-arranged, never unmounted. */
  .layoutsw{display:inline-flex;align-items:center;gap:2px;height:32px;padding:2px;border:1px solid var(--border);border-radius:9px;background:var(--surface2);flex:none}
  .layoutsw .lbl{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:0 8px 0 8px}
  .layoutsw button{height:26px;padding:0 12px;border:0;border-radius:7px;background:none;color:var(--muted);font:600 13px var(--sans);cursor:pointer}
  .layoutsw button.on{background:var(--accent);color:var(--accent-ink)}
  .layoutsw button:not(.on):hover{color:var(--text)}
  .chatp,.drawerbtns,.dclose{display:none}
  .dock.chat{position:relative;overflow:hidden;grid-template-columns:minmax(280px,30%) minmax(0,1fr)}
  .dock.chat.learn{grid-template-columns:minmax(220px,20%) minmax(260px,28%) minmax(0,1fr)}
  .dock.chat .chatp{display:flex;flex-direction:column;min-height:0;overflow:hidden}
  .dock.chat .hint-k{display:none}
  .dock.chat .drawerbtns{display:flex;margin-left:auto;padding-right:6px;gap:2px}
  .dock.chat .dclose{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;border:1px solid var(--border);background:none;color:var(--muted);font-size:16px;cursor:pointer;flex:none}
  .dock.chat .fh .dclose{order:9;margin-left:4px}
  .dock.chat .rtabs .dclose{order:9;margin-left:auto;color:#93a0b4;border-color:#12303d}
  /* drawers stay laid out (so xterm can measure) but are hidden until opened */
  .dock.chat .files,.dock.chat .right{position:absolute;top:12px;bottom:12px;right:12px;z-index:5;box-shadow:0 12px 40px rgba(0,0,0,.35);visibility:hidden;opacity:0;transform:translateX(24px);pointer-events:none;transition:opacity .15s,transform .15s,visibility 0s .15s}
  .dock.chat .files{width:min(320px,calc(100% - 24px))}
  .dock.chat .right{width:min(640px,calc(100% - 24px))}
  .dock.chat.dfiles .files,.dock.chat.dterm .right{visibility:visible;opacity:1;transform:none;pointer-events:auto;transition:opacity .15s,transform .15s}
  @media (max-width:1200px){
    .layoutsw .lbl{display:none}
    .dock.chat,.dock.chat.learn{grid-template-columns:minmax(240px,34%) minmax(0,1fr);grid-template-rows:minmax(0,1fr)}
    .dock.chat .right{grid-column:auto}
  }
  @media (max-width:760px){
    .dock.chat,.dock.chat.learn{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,.7fr) minmax(0,1.3fr)}
    .dock.chat .files,.dock.chat .right{display:flex;left:12px;width:auto}
  }
</style>
