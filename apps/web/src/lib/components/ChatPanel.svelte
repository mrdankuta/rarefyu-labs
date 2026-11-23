<script lang="ts">
  import { tick } from "svelte";
  import type { ChatController } from "$lib/agent/chat.svelte";
  import { renderMarkdown } from "$lib/agent/markdown";

  let { ctl }: { ctl: ChatController } = $props();
  let draft = $state("");
  let list: HTMLDivElement | undefined = $state();
  let stick = true; // follow the stream unless the student scrolled up

  const ready = $derived(ctl.phase === "ready");
  const busy = $derived(ctl.chat.running);
  const empty = $derived(ctl.chat.messages.length === 0);

  function onScroll() {
    if (!list) return;
    stick = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  }
  $effect(() => {
    // re-run on any transcript change (text deltas included) and keep the latest in view
    ctl.chat.messages.length; ctl.chat.running; ctl.chat.retry;
    for (const m of ctl.chat.messages) if (m.kind === "assistant") for (const p of m.parts) if (p.type === "text") p.text.length;
    if (stick) tick().then(() => { if (list) list.scrollTop = list.scrollHeight; });
  });

  async function submit() {
    const t = draft;
    if (!t.trim() || busy || !ready) return;
    draft = "";
    stick = true;
    await ctl.send(t);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); void submit(); }
  }
</script>

<div class="chat">
  <div class="top">
    <span class="ttl">Agent chat</span>
    {#if ctl.conn === "reconnecting" && ready}<span class="chip warn" title="Reconnecting to the agent">reconnecting…</span>{/if}
    <span class="sp"></span>
    <button class="ghost" onclick={() => ctl.newConversation()} disabled={!ready || (empty && !busy)} title="Start a fresh conversation">New conversation</button>
  </div>

  {#if ctl.fatal}
    <div class="banner err" role="alert"><b>{ctl.fatal.title}</b><span>{ctl.fatal.hint}</span></div>
  {:else if ctl.phase === "starting" || ctl.phase === "idle"}
    <div class="banner info" role="status"><span class="spin"></span><b>Starting the agent…</b><span>This takes a few seconds the first time.</span></div>
  {/if}
  {#if ctl.noKey && ready}
    <div class="banner warn" role="status"><b>No class key is set up for this workspace.</b><span>The agent may use a limited free model. Join with your class code from the start page, or ask your facilitator.</span></div>
  {/if}

  <div class="log" bind:this={list} onscroll={onScroll} role="log" aria-live="polite" aria-label="conversation">
    {#if empty && ready && !ctl.loading}
      <div class="empty"><span class="spark">✨</span><b>What should we build?</b><span class="mut">Ask for a change in plain words and watch your site update next to this panel.</span></div>
    {/if}
    {#each ctl.chat.messages as m (m.id)}
      {#if m.kind === "user"}
        <div class="msg user"><div class="bub">{m.text}</div></div>
      {:else if m.kind === "assistant"}
        <div class="msg assistant">
          {#each m.parts as p (p.type === "text" ? p.key : p.id)}
            {#if p.type === "text"}
              <div class="md">{@html renderMarkdown(p.text)}</div>
            {:else}
              <div class="tool" class:run={p.status === "running"} class:fail={p.status === "error"} data-tool={p.name}>
                <span class="ic" aria-hidden="true">{#if p.status === "running"}<i class="spin sm"></i>{:else if p.status === "error"}✕{:else}✓{/if}</span>
                <span class="lbl">{p.label}</span>
              </div>
            {/if}
          {/each}
        </div>
      {:else if m.kind === "stopped"}
        <div class="note stopped">Stopped. You can send a new message.</div>
      {:else}
        <div class="note cerror" role="alert" data-kind={m.error.kind}><b>{m.error.title}</b><span>{m.error.hint}</span></div>
      {/if}
    {/each}
    {#if ctl.chat.retry}
      <div class="note retry" role="status" data-kind={ctl.chat.retry.error.kind}><b>{ctl.chat.retry.error.title}</b><span>Retrying automatically (attempt {ctl.chat.retry.attempt}). Press Stop to cancel.</span></div>
    {/if}
    {#if busy}
      <div class="working" role="status"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>Working…</div>
    {/if}
  </div>

  <form class="composer" onsubmit={(e) => { e.preventDefault(); void submit(); }}>
    <textarea rows="2" bind:value={draft} onkeydown={onKey} disabled={!ready} aria-label="Message the agent"
      placeholder={ready ? "Ask the agent to build something…" : "Starting the agent…"}></textarea>
    {#if busy}
      <button type="button" class="stop" onclick={() => ctl.stop()} aria-label="Stop">■ Stop</button>
    {:else}
      <button type="submit" class="send" disabled={!ready || !draft.trim()} aria-label="Send">Send</button>
    {/if}
  </form>
  <div class="keys">Enter to send · Shift+Enter for a new line</div>
</div>

<style>
  .chat{display:flex;flex-direction:column;min-height:0;height:100%;font-size:13.5px;line-height:1.5}
  .top{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);flex:none}
  .ttl{font:600 12px var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
  .sp{flex:1}
  .chip{font-size:11px;padding:2px 8px;border-radius:99px;border:1px solid var(--border);color:var(--muted)}
  .chip.warn{color:var(--warn);border-color:var(--warn)}
  .ghost{height:28px;padding:0 10px;border-radius:7px;border:1px solid var(--border);background:none;color:var(--text);font:500 12px var(--sans);cursor:pointer}
  .ghost:disabled{opacity:.45;cursor:not-allowed}
  .banner{display:flex;flex-wrap:wrap;gap:2px 8px;align-items:center;margin:10px 12px 0;padding:9px 12px;border-radius:9px;border:1px solid var(--border);background:var(--surface2);font-size:12.5px}
  .banner span{color:var(--muted)}
  .banner.err{background:var(--danger-soft);border-color:var(--danger)}
  .banner.err b{color:var(--danger)}
  .banner.warn{border-color:var(--warn)}
  .log{flex:1;min-height:0;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:10px}
  .empty{margin:auto;max-width:300px;display:flex;flex-direction:column;gap:8px;align-items:center;text-align:center}
  .empty b{font-size:16px}.empty .spark{font-size:28px;color:var(--accent)}
  .mut{color:var(--muted)}
  .msg.user{display:flex;justify-content:flex-end}
  .bub{max-width:88%;padding:8px 12px;border-radius:12px 12px 3px 12px;background:var(--accent-soft);border:1px solid var(--border);white-space:pre-wrap;overflow-wrap:anywhere}
  .msg.assistant{display:flex;flex-direction:column;gap:6px;min-width:0}
  .md{overflow-wrap:anywhere}
  .md :global(p){margin:0 0 .6em}.md :global(p:last-child){margin-bottom:0}
  .md :global(h3),.md :global(h4),.md :global(h5),.md :global(h6){margin:.8em 0 .3em;font-size:14px;font-family:var(--display)}
  .md :global(ul),.md :global(ol){margin:.3em 0 .6em;padding-left:1.4em}
  .md :global(blockquote){margin:.4em 0;padding:2px 10px;border-left:3px solid var(--border);color:var(--muted)}
  .md :global(a){color:var(--accent);text-decoration:underline}
  :global(:root[data-theme="light"]) .md :global(a){color:#0b5d7a}
  .md :global(code){font:12.5px var(--mono);background:var(--surface2);border:1px solid var(--border);border-radius:5px;padding:0 4px}
  .md :global(pre){margin:.5em 0;padding:10px 12px;overflow-x:auto;background:var(--term-bg);color:#e8f0f3;border:1px solid var(--term-line);border-radius:9px}
  .md :global(pre code){background:none;border:0;padding:0;color:inherit;font-size:12.5px;white-space:pre}
  .tool{display:flex;align-items:center;gap:8px;padding:4px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface2);font:12px var(--mono);color:var(--muted);min-width:0}
  .tool .lbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tool .ic{width:14px;text-align:center;color:var(--ok);flex:none}
  .tool.fail .ic{color:var(--danger)}
  .tool.run{color:var(--text)}
  .note{display:flex;flex-direction:column;gap:2px;padding:9px 12px;border-radius:9px;font-size:12.5px;border:1px solid var(--border)}
  .note span{color:var(--muted)}
  .note.stopped{color:var(--muted);background:var(--surface2);align-self:flex-start}
  .note.cerror{background:var(--danger-soft);border-color:var(--danger)}.note.cerror b{color:var(--danger)}
  .note.retry{background:var(--surface2);border-color:var(--warn)}.note.retry b{color:var(--warn)}
  .working{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12.5px}
  .dots{display:inline-flex;gap:3px}
  .dots i{width:5px;height:5px;border-radius:50%;background:var(--accent);animation:b 1.1s infinite ease-in-out}
  .dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
  @keyframes b{0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}
  .spin{width:12px;height:12px;border-radius:50%;border:2px solid var(--border);border-top-color:var(--accent);animation:r .8s linear infinite;display:inline-block}
  .spin.sm{width:10px;height:10px;border-width:2px}
  @keyframes r{to{transform:rotate(360deg)}}
  .composer{display:flex;gap:8px;padding:12px;border-top:1px solid var(--border);flex:none;align-items:flex-end}
  textarea{flex:1;min-width:0;resize:none;max-height:140px;padding:8px 12px;border-radius:9px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font:13.5px/1.45 var(--sans)}
  textarea:focus{outline:2px solid var(--accent-soft);border-color:var(--accent)}
  textarea:disabled{opacity:.6}
  .keys{padding:0 12px 8px;font-size:11px;color:var(--faint);flex:none}
  .composer{padding-bottom:4px}
  .send,.stop{height:38px;padding:0 16px;border:0;border-radius:9px;font:600 13.5px var(--sans);cursor:pointer;flex:none}
  .send{background:var(--accent);color:var(--accent-ink)}
  .send:disabled{opacity:.5;cursor:not-allowed}
  .stop{background:var(--danger);color:#fff}
  @media (prefers-reduced-motion:reduce){.dots i,.spin{animation:none}}
</style>
