<script lang="ts">
  import type { UiPermission } from "$lib/agent/permissions";

  let { perm, onanswer }: { perm: UiPermission; onanswer: (decision: "once" | "reject") => void } = $props();
  const busy = $derived(perm.status === "sending");
</script>

<div class="perm" role="alert" data-permission={perm.action}>
  <b>{perm.title}</b>
  {#if perm.detail}<code>{perm.detail}</code>{/if}
  <span class="row">
    <button type="button" class="allow" disabled={busy} onclick={() => onanswer("once")}>Allow</button>
    <button type="button" class="deny" disabled={busy} onclick={() => onanswer("reject")}>Deny</button>
    <span class="hint">The agent is paused until you answer.</span>
  </span>
</div>

<style>
  .perm{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:10px;border:1px solid var(--warn);background:var(--surface2);font-size:12.5px}
  b{color:var(--text)}
  code{font:12px/1.4 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere;max-height:120px;overflow:auto;background:var(--term-bg);color:var(--on-term);border:1px solid var(--term-line);border-radius:6px;padding:5px 8px}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  button{height:28px;padding:0 14px;border-radius:8px;border:1px solid var(--border);font:600 12px var(--sans);cursor:pointer;transition:border-color .12s,background .12s}
  button:hover:not(:disabled){filter:brightness(1.08)}button:active:not(:disabled){transform:translateY(1px)}
  .deny:hover:not(:disabled){filter:none;border-color:var(--accent);background:var(--accent-soft)}
  button:disabled{opacity:.5;cursor:not-allowed}
  .allow{background:var(--accent);color:var(--accent-ink);border-color:transparent}
  .deny{background:none;color:var(--text)}
  .hint{color:var(--muted);font-size:11.5px}
</style>
