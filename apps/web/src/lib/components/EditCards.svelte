<script lang="ts">
  // The files one agent turn changed: counts, View diff, Keep, Undo. All numbers and actions come from the lab's own
  // change tracking (EditHost), the same list the Changes tab shows, so the two always agree.
  import type { Card, EditHost } from "$lib/agent/edits";
  import { totals } from "$lib/agent/edits";

  let { host, cards, locked }: { host: EditHost; cards: Card[]; /** the agent is working: files may still change */ locked: boolean } = $props();
  let busy = $state(false);
  let confirmAll = $state(false);

  const live = $derived(cards.filter((c) => c.state === "pending" && !c.superseded));
  const sum = $derived(totals(live));
  const label = (c: Card) =>
    c.state === "kept" ? "Kept" : c.state === "undone" ? "Undone" : c.state === "unknown" ? "Changed (no earlier copy)"
    : c.change?.status === "added" ? "New" : c.change?.status === "deleted" ? "Deleted" : "Edited";

  async function run(fn: () => Promise<void>) { if (busy) return; busy = true; try { await fn(); } finally { busy = false; } }
  const keep = (c: Card) => run(() => host.keep(c.path));
  const undo = (c: Card) => run(() => host.undo(c.path));
  const keepAll = () => run(async () => { for (const c of live) await host.keep(c.path); });
  const undoAll = () => run(async () => { confirmAll = false; for (const c of live) await host.undo(c.path); });
</script>

<div class="cards" data-testid="edit-cards">
  {#if live.length > 1}
    <div class="all">
      <span class="mut">{live.length} files changed</span>
      <span class="sp"></span>
      <button disabled={busy || locked} onclick={keepAll}>Keep all</button>
      {#if confirmAll}
        <button class="dng" disabled={busy || locked} onclick={undoAll}>Undo all {live.length}?</button>
        <button onclick={() => (confirmAll = false)}>No</button>
      {:else}
        <button disabled={busy || locked} onclick={() => (confirmAll = true)}>Undo all</button>
      {/if}
    </div>
  {/if}
  {#each cards as c (c.path)}
    <div class="card" data-testid="edit-card" data-path={c.path} data-state={c.superseded && c.state === "pending" ? "superseded" : c.state}>
      <div class="row">
        <button class="name" title={c.path} disabled={c.change?.status === "deleted"} onclick={() => host.openFile(c.path)}>{c.path}</button>
        {#if c.change && !c.change.opaque}
          <span class="cnt"><span class="pl" data-testid="card-add">+{c.change.add}</span> <span class="mi" data-testid="card-del">−{c.change.del}</span></span>
        {:else if c.change?.opaque}<span class="mut sm" data-testid="card-nodiff">no diff (binary or large)</span>{/if}
        <span class="tag" data-testid="card-status">{c.superseded && c.state === "pending" ? "edited again below" : label(c)}</span>
      </div>
      {#if c.state === "pending" && !c.superseded}
        <div class="acts">
          {#if !c.change?.opaque}<button disabled={busy} onclick={() => host.viewDiff(c.path)}>View diff</button>{/if}
          <span class="sp"></span>
          <button disabled={busy || locked} onclick={() => keep(c)}>Keep</button>
          <button disabled={busy || locked} onclick={() => undo(c)}>Undo</button>
        </div>
      {/if}
    </div>
  {/each}
  {#if live.length > 1 && (sum.add || sum.del)}<div class="sum mut sm">Total +{sum.add} −{sum.del}</div>{/if}
</div>

<style>
  .cards{display:flex;flex-direction:column;gap:6px;margin-top:4px}
  .all{display:flex;align-items:center;gap:6px;font-size:12px}
  .sp{flex:1}.mut{color:var(--muted)}.sm{font-size:11.5px}
  .card{border:1px solid var(--border);border-radius:9px;background:var(--surface2);padding:7px 10px;display:flex;flex-direction:column;gap:6px;min-width:0}
  .card[data-state="kept"],.card[data-state="undone"],.card[data-state="superseded"]{opacity:.75}
  .row{display:flex;align-items:center;gap:8px;min-width:0}
  .name{border:0;background:none;padding:0;font:12.5px var(--mono);color:var(--text);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;min-width:0;flex:0 1 auto}
  .name:hover:not(:disabled){text-decoration:underline}.name:disabled{cursor:default}
  .cnt{font:12px var(--mono);flex:none}
  .pl{color:var(--ok)}.mi{color:var(--danger)}
  .tag{margin-left:auto;flex:none;font-size:11px;color:var(--muted);border:1px solid var(--border);border-radius:99px;padding:0 8px}
  .acts{display:flex;align-items:center;gap:6px}
  button:not(.name){height:26px;padding:0 10px;border-radius:7px;border:1px solid var(--border);background:none;color:var(--text);font:500 12px var(--sans);cursor:pointer}
  button:not(.name):hover:not(:disabled){border-color:var(--accent)}
  button:disabled{opacity:.45;cursor:not-allowed}
  .dng{border-color:var(--danger)!important;color:var(--danger)!important}
  .sum{text-align:right}
</style>
