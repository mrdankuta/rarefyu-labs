<script lang="ts">
  import { collapseText } from "$lib/agent/collapse";

  // Long command output / error text: first lines visible, the rest behind "Show more". Short text shows as is.
  let { text, lines = 4, tone = "plain" }: { text: string; lines?: number; tone?: "plain" | "error" } = $props();
  let open = $state(false);
  const c = $derived(collapseText(text, lines));
</script>

<div class="out" class:error={tone === "error"} data-collapsible={c.long ? (open ? "open" : "closed") : "short"}>
  <pre>{c.long && !open ? c.head : text.replace(/\n+$/, "")}</pre>
  {#if c.long}
    <button type="button" class="more" aria-expanded={open} onclick={() => (open = !open)}>
      {open ? "Show less" : c.hiddenLines > 0 ? `Show more (${c.hiddenLines} more ${c.hiddenLines === 1 ? "line" : "lines"})` : "Show more"}
    </button>
  {/if}
</div>

<style>
  .out{min-width:0}
  pre{margin:0;padding:6px 10px;max-height:260px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--term-bg);color:var(--on-term);border:1px solid var(--term-line);border-radius:8px;font:12px/1.45 var(--mono)}
  .error pre{border-color:var(--danger)}
  .more{margin-top:3px;padding:2px 0;border:0;background:none;color:var(--link);font:500 12px var(--sans);cursor:pointer;border-radius:4px}
  .more:hover{text-decoration:underline;text-underline-offset:2px}
  .more:active{opacity:.8}
</style>
