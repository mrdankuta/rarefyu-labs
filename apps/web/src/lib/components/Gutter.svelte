<script lang="ts">
  // A draggable divider that sits in the 12px gap beside a panel and resizes it (pointer or keyboard), with an
  // optional collapse chevron. It only reports widths; the page owns the state and the stylesheet applies it.
  import { onMount } from "svelte";
  import { MINS, RAIL, maxWidth, nextWidth, clampWidth, type PaneKey } from "$lib/panes";

  interface Props {
    pane: PaneKey;
    /** Which edge of `target` this divider is on: "right" grows the panel rightwards, "left" leftwards. */
    edge: "left" | "right";
    label: string;
    dock: HTMLElement | null;
    target: HTMLElement | null;
    center: HTMLElement | null;
    collapsible?: boolean;
    collapsed?: boolean;
    /** Bump to force a re-measure (layout changed without a size change we can observe). */
    tick?: number;
    onresize: (px: number) => void;
    oncommit: () => void;
    oncollapse?: () => void;
    onreset: () => void;
  }
  let { pane, edge, label, dock, target, center, collapsible = false, collapsed = false, tick = 0, onresize, oncommit, oncollapse, onreset }: Props = $props();

  const GAP = 12;
  let box = $state({ left: 0, top: 0, height: 0, show: false, width: 0 });
  let dragging = $state(false);
  let limit = $state(0);

  function measure() {
    if (!dock || !target) { box.show = false; return; }
    const d = dock.getBoundingClientRect(), t = target.getBoundingClientRect();
    const shown = target.offsetParent !== null && t.width > 0 && getComputedStyle(target).visibility !== "hidden";
    box = { show: shown, width: Math.round(t.width), top: Math.round(t.top - d.top), height: Math.round(t.height), left: Math.round(edge === "right" ? t.right - d.left : t.left - d.left - GAP) };
  }
  let raf = 0;
  const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
  onMount(() => {
    const ro = new ResizeObserver(schedule);
    if (dock) ro.observe(dock);
    if (target) ro.observe(target);
    window.addEventListener("resize", schedule);
    measure();
    return () => { ro.disconnect(); window.removeEventListener("resize", schedule); cancelAnimationFrame(raf); };
  });
  $effect(() => { void tick; void collapsed; void dock; void target; schedule(); });

  function bounds() {
    const startW = target?.getBoundingClientRect().width ?? MINS[pane];
    limit = maxWidth(pane, startW, center?.getBoundingClientRect().width ?? 0, dock?.getBoundingClientRect().width ?? 0);
    return { startW, max: limit };
  }

  let startX = 0, startW = 0, max = 0, pending = 0, lastPx = 0;
  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    ({ startW, max } = bounds());
    startX = e.clientX; dragging = true;
    document.documentElement.classList.add("rfy-dragging"); // the preview iframe must not eat the drag
    e.preventDefault();
  }
  function move(e: PointerEvent) {
    if (!dragging) return;
    lastPx = nextWidth(pane, startW, e.clientX - startX, edge, max);
    if (!pending) pending = requestAnimationFrame(() => { pending = 0; onresize(lastPx); }); // once per frame
  }
  function up(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    document.documentElement.classList.remove("rfy-dragging");
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
    cancelAnimationFrame(pending); pending = 0;
    if (lastPx) onresize(lastPx);
    lastPx = 0;
    oncommit();
  }
  function key(e: KeyboardEvent) {
    const { startW: w, max: hi } = bounds();
    const step = e.shiftKey ? 64 : 16;
    const grow = edge === "right" ? "ArrowRight" : "ArrowLeft", shrink = edge === "right" ? "ArrowLeft" : "ArrowRight";
    let next: number | null = null;
    if (e.key === grow) next = clampWidth(pane, w + step, hi);
    else if (e.key === shrink) next = clampWidth(pane, w - step, hi);
    else if (e.key === "Home") next = MINS[pane];
    else if (e.key === "End") next = hi;
    else if (e.key === "Enter" && collapsible) { e.preventDefault(); oncollapse?.(); return; }
    if (next === null) return;
    e.preventDefault();
    onresize(next);
    oncommit();
  }
  const word = $derived(collapsed ? "Expand" : "Collapse");
  // Chevron points at where the panel goes when collapsing, and back at it when expanding.
  const glyph = $derived((edge === "right") === !collapsed ? "‹" : "›");
</script>

{#if box.show}
  <div class="gut" class:drag={dragging} class:rail={collapsed} style="left:{box.left}px;top:{box.top}px;height:{box.height}px" data-pane={pane}>
    <!-- ARIA "window splitter": a focusable separator is interactive by definition, the lint rule does not know that -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div class="grip" role="separator" aria-orientation="vertical" aria-label={`Resize ${label}`} tabindex="0"
      aria-valuenow={collapsed ? RAIL : box.width} aria-valuemin={MINS[pane]} aria-valuemax={limit || undefined}
      onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={key} ondblclick={onreset} title="Drag to resize · double-click to reset"></div>
    {#if collapsible}
      <button class="chev" aria-label={`${word} ${label}`} title={`${word} ${label}`} onclick={oncollapse} onpointerdown={(e) => e.stopPropagation()}>{glyph}</button>
    {/if}
  </div>
{/if}

<style>
  .gut{position:absolute;width:12px;z-index:7;display:flex;align-items:center;justify-content:center}
  .grip{position:absolute;inset:0;cursor:col-resize;touch-action:none;outline:none}
  .grip::before{content:"";position:absolute;top:8px;bottom:8px;left:5px;width:2px;border-radius:2px;background:transparent;transition:background .12s}
  .gut:hover .grip::before,.grip:focus-visible::before,.gut.drag .grip::before{background:var(--accent)}
  .grip:focus-visible{outline:2px solid var(--accent);outline-offset:-1px;border-radius:4px}
  .chev{position:relative;z-index:1;width:18px;height:34px;padding:0;border-radius:9px;border:1px solid var(--border);background:var(--surface);color:var(--muted);font-size:14px;line-height:1;cursor:pointer;opacity:0;transition:opacity .12s,color .12s,border-color .12s}
  .gut:hover .chev,.chev:focus-visible,.gut.rail .chev,.gut.drag .chev{opacity:1}
  .chev:hover{color:var(--text);border-color:var(--accent)}
  .chev:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
  @media (pointer:coarse){.chev{opacity:1}}
</style>
