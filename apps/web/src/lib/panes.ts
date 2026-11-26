// Panel sizes and collapse state for the lab page (both layouts). Pure helpers so the policy is unit-testable;
// the page owns the reactive state and the Gutter component does the dragging.
export type PaneKey = "steps" | "files" | "chat" | "right" | "term" | "fdrawer";
export const PANES_KEY = "rfy_panes_v1";
/** Width of a collapsed panel (a slim rail with its expand handle). */
export const RAIL = 32;
/** The centre (editor / preview) never gets narrower than this while another pane is resized. */
export const CENTER_MIN = 360;

/** Narrowest useful width of each pane while expanded. */
export const MINS: Record<PaneKey, number> = { steps: 180, files: 160, chat: 280, right: 320, term: 360, fdrawer: 240 };
/** Panes that can collapse to a rail (the drawers just close). */
export const COLLAPSIBLE: PaneKey[] = ["steps", "files", "chat", "right"];

export interface PaneState {
  w: Partial<Record<PaneKey, number>>;
  collapsed: Partial<Record<PaneKey, boolean>>;
}
export const emptyPanes = (): PaneState => ({ w: {}, collapsed: {} });
const KEYS = Object.keys(MINS) as PaneKey[];

export function clampWidth(key: PaneKey, px: number, max: number): number {
  const hi = Math.max(MINS[key], Math.floor(max));
  return Math.round(Math.min(hi, Math.max(MINS[key], px)));
}

/** Width after dragging `dx` px. A handle on a pane's right edge grows it rightwards; on its left edge, leftwards. */
export function nextWidth(key: PaneKey, startW: number, dx: number, edge: "left" | "right", max: number): number {
  return clampWidth(key, edge === "right" ? startW + dx : startW - dx, max);
}

/** Largest width this pane may take so the centre keeps CENTER_MIN (drawers overlay, so they only need the dock). */
export function maxWidth(key: PaneKey, startW: number, centerW: number, dockW: number): number {
  if (key === "term" || key === "fdrawer") return Math.max(MINS[key], dockW - 24);
  return Math.max(MINS[key], startW, startW + centerW - CENTER_MIN); // never forces a pane to shrink just because the centre is already tight
}

export function setWidth(s: PaneState, key: PaneKey, px: number): PaneState {
  return { w: { ...s.w, [key]: Math.round(px) }, collapsed: { ...s.collapsed, [key]: false } };
}
export function toggleCollapsed(s: PaneState, key: PaneKey): PaneState {
  return { w: s.w, collapsed: { ...s.collapsed, [key]: !s.collapsed[key] } };
}
export function resetPane(s: PaneState, key: PaneKey): PaneState {
  const w = { ...s.w }, collapsed = { ...s.collapsed };
  delete w[key]; delete collapsed[key];
  return { w, collapsed };
}
export function isCustom(s: PaneState): boolean {
  return KEYS.some((k) => s.w[k] !== undefined || s.collapsed[k]);
}

/** CSS custom properties for the dock; unset panes keep the stylesheet default. Percent caps keep a narrow window usable. */
export function paneVars(s: PaneState): string {
  const out: string[] = [];
  const CAP: Partial<Record<PaneKey, string>> = { steps: "40%", files: "40%", chat: "60%", right: "70%" };
  for (const k of KEYS) {
    if (s.collapsed[k] && COLLAPSIBLE.includes(k)) { out.push(`--w-${k}:${RAIL}px`); continue; }
    const w = s.w[k];
    if (w === undefined) continue;
    const cap = CAP[k];
    out.push(`--w-${k}:${cap ? `min(${w}px,${cap})` : `${w}px`}`);
  }
  return out.join(";");
}

export function parsePanes(raw: string | null | undefined): PaneState {
  const s = emptyPanes();
  if (!raw) return s;
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return s; }
  if (!o || typeof o !== "object") return s;
  const { w, collapsed } = o as { w?: unknown; collapsed?: unknown };
  for (const k of KEYS) {
    const v = w && typeof w === "object" ? (w as Record<string, unknown>)[k] : undefined;
    if (typeof v === "number" && Number.isFinite(v)) s.w[k] = Math.min(4000, Math.max(MINS[k], Math.round(v)));
    const c = collapsed && typeof collapsed === "object" ? (collapsed as Record<string, unknown>)[k] : undefined;
    if (c === true && COLLAPSIBLE.includes(k)) s.collapsed[k] = true;
  }
  return s;
}
export const serializePanes = (s: PaneState) => JSON.stringify(s);

export function readPanes(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): PaneState {
  try { return parsePanes(storage?.getItem(PANES_KEY)); } catch { return emptyPanes(); }
}
export function storePanes(s: PaneState, storage: Pick<Storage, "setItem" | "removeItem"> | undefined = safeStorage()) {
  try { if (isCustom(s)) storage?.setItem(PANES_KEY, serializePanes(s)); else storage?.removeItem(PANES_KEY); } catch { /* storage blocked */ }
}
function safeStorage(): Storage | undefined {
  try { return typeof localStorage === "undefined" ? undefined : localStorage; } catch { return undefined; }
}
