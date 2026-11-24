<script lang="ts">
  // What the Preview shows instead of the page: calm, never an error page while the site is merely starting.
  import type { PreviewUi } from "$lib/preview";
  let { ui, hint = "", onretry }: { ui: PreviewUi; hint?: string; onretry: () => void } = $props();
</script>

<div class="pstat" role="status" aria-live="polite" data-state={ui}>
  {#if ui === "starting" || ui === "ready"}
    <div class="spin" aria-hidden="true"></div>
    <div><b>Starting your site…</b></div>
    <div class="mut">This usually takes a few seconds. It will appear here by itself.</div>
  {:else if ui === "failed"}
    <div><b>Your site did not start</b></div>
    <div class="mut">{hint}</div>
    <button onclick={onretry}>Try again</button>
  {:else if ui === "not-web"}
    <div><b>Nothing to preview yet</b></div>
    <div class="mut">Ask the agent to build a web page. When your project has one, it shows up here.</div>
  {:else}
    <div><b>Your site will show up here</b></div>
    <div class="mut">Ask the agent to build something and watch it appear.</div>
  {/if}
</div>

<style>
  .pstat{margin:14px;border:1px dashed var(--border);border-radius:10px;flex:1;display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;color:var(--muted);text-align:center;padding:16px;line-height:1.6}
  .pstat b{color:var(--text);font:600 14px var(--display)}
  .mut{max-width:44ch}
  button{margin-top:4px;height:32px;padding:0 16px;border-radius:9px;border:0;background:var(--accent);color:var(--accent-ink);font:600 13px var(--sans);cursor:pointer}
  button:hover{filter:brightness(1.08)}button:active{transform:translateY(1px)}
  .spin{width:22px;height:22px;border-radius:50%;border:3px solid var(--border);border-top-color:var(--accent);animation:sp 0.9s linear infinite}
  @keyframes sp{to{transform:rotate(360deg)}}
  @media (prefers-reduced-motion: reduce){.spin{animation-duration:3s}}
</style>
