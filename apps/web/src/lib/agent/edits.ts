// Pure logic for the chat's "edit cards": which files a turn touched, and how the cards of several turns combine.
// The numbers and the Keep/Undo actions come from the lab's own change tracking (the Changes tab), see EditHost.
import type { UiMessage } from "./events";

/** The lab page's change tracking, as the chat sees it. Implemented in routes/lab/[id]/+page.svelte. */
export interface ChangeInfo { status: "added" | "modified" | "deleted"; add: number; del: number; /** too large / binary: no line diff */ opaque?: boolean }
export type Resolution = "kept" | "undone";
export interface EditHost {
  /** Pending change for a path (reactive when read inside a $derived/$effect), or undefined. */
  change(path: string): ChangeInfo | undefined;
  /** How the last pending change for this path ended, if the student resolved it. */
  resolution(path: string): Resolution | undefined;
  /** Bumped every time the lab records a new state for the path. Used to see what moved during a turn. */
  version(path: string): number;
  /** All paths with a version, for snapshots. */
  versions(): Map<string, number>;
  /** The lab knows this file's content from before (a baseline exists) so "no pending change" means "unchanged". */
  hasBaseline(path: string): boolean;
  /** Re-read the workspace now (instead of waiting for the 5s poll) and update the Changes list. */
  syncNow(): Promise<void>;
  /** Write unsaved editor edits to disk. Resolves when they are on disk. */
  flushSaves(): Promise<void>;
  keep(path: string): Promise<void>;
  /** Undo = restore the baseline (or delete a new file). Asks first when the student also edited the file. */
  undo(path: string): Promise<void>;
  viewDiff(path: string): Promise<void>;
  openFile(path: string): Promise<void>;
}

const FILE_EDIT_TOOLS = new Set(["write", "edit", "multiedit", "patch"]);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Root spellings to try for a path: the server's reported root plus its realpath-ish twin (e.g. /tmp <-> /private/tmp). */
export function rootVariants(root?: string | string[] | null): string[] {
  const out = new Set<string>();
  for (const r0 of Array.isArray(root) ? root : root ? [root] : []) {
    const r = r0.trim().replace(/\\/g, "/").replace(/\/+$/, "");
    if (!r.startsWith("/")) continue;
    out.add(r);
    out.add(r.startsWith("/private/") ? r.slice(8) : "/private" + r);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** Tidy a relative path: backslashes, "./", repeated or trailing slashes. */
const tidy = (s: string) => s.replace(/\/+/g, "/").replace(/^(\.\/)+/, "").replace(/\/\.(?=\/|$)/g, "").replace(/\/+$/, "");

/**
 * Workspace-relative form of a path a tool call gave (models pass ABSOLUTE host paths). With a known `root` a path
 * under it is made relative; an absolute path outside it is returned unchanged (still starting with "/"), see
 * `isOutside`. Without a root the old behaviour applies (leading slashes are just stripped).
 */
export function normPath(p: string, root?: string | string[] | null): string {
  const s = p.trim().replace(/\\/g, "/");
  const roots = rootVariants(root);
  if (roots.length) {
    if (s.startsWith("/")) {
      const c = s.replace(/\/+/g, "/");
      for (const r of roots) {
        if (c === r) return "";
        if (c.startsWith(r + "/")) return tidy(c.slice(r.length + 1));
      }
      return c; // absolute and outside the workspace
    }
  } else if (!s.startsWith("/")) return tidy(s);
  return roots.length ? tidy(s) : tidy(s.replace(/^\/+/, ""));
}

/** A normalized path that is not inside the workspace (absolute, or climbing out with ".."). */
export const isOutside = (np: string) => np.startsWith("/") || np === ".." || np.startsWith("../");

/** Paths outside the workspace get no card (the lab policy denies them anyway). Only judged once the root is known. */
const keep = (paths: string[], root?: string | string[] | null) => paths.filter((x) => x && (!rootVariants(root).length ? !x.startsWith("../") : !isOutside(x)));

/** Files a tool call writes. Empty for read-only and shell tools (shell effects are picked up from the Changes list). */
export function editPathsOf(name: string, input?: Record<string, unknown>, root?: string | string[] | null): string[] {
  const i = input ?? {};
  const n = name.toLowerCase();
  if (FILE_EDIT_TOOLS.has(n)) {
    const p = str(i.path) || str(i.filePath) || str(i.file_path) || str(i.file) || str(i.filename);
    return keep(p ? [normPath(p, root)] : [], root);
  }
  if (n === "apply_patch") {
    const text = str(i.patchText) || str(i.patch) || str(i.input);
    const out: string[] = [];
    for (const m of text.matchAll(/^\*\*\* (?:Add|Update|Delete) File:\s*(.+?)\s*$/gm)) out.push(normPath(m[1]!, root));
    return keep([...new Set(out)], root);
  }
  return [];
}

export interface Turn { index: number; paths: string[] }

/** Split a transcript into turns (one per user message) and collect the file paths its tool calls wrote. */
export function turnsOf(messages: UiMessage[]): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  for (const m of messages) {
    if (m.kind === "user") { cur = { index: turns.length, paths: [] }; turns.push(cur); continue; }
    if (m.kind !== "assistant") continue;
    cur ??= (turns.push({ index: turns.length, paths: [] }), turns[turns.length - 1]!);
    for (const p of m.parts) if (p.type === "tool" && p.status !== "error") for (const x of p.paths ?? []) if (!cur.paths.includes(x)) cur.paths.push(x);
  }
  return turns;
}

/** Id of the last assistant message in each turn: that is where the turn's cards are drawn. */
export function lastAssistantIds(messages: UiMessage[]): Map<number, string> {
  const out = new Map<number, string>();
  let turn = -1;
  for (const m of messages) {
    if (m.kind === "user") turn++;
    else if (m.kind === "assistant") out.set(Math.max(turn, 0), m.id);
  }
  return out;
}

/** Paths whose recorded version moved since `before` (a snapshot taken when the turn started). */
export function changedSince(before: Map<string, number>, now: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [p, v] of now) if (v > (before.get(p) ?? 0)) out.push(p);
  return out.sort();
}

export type CardState = "pending" | "kept" | "undone" | "unknown";
export interface Card { path: string; state: CardState; change?: ChangeInfo; /** a later turn edited this file again: its card carries the actions */ superseded: boolean }

/**
 * Cards per turn. A file edited in several turns keeps ONE actionable card (the latest turn's), because the lab's
 * Changes list holds one combined change per file (baseline -> now); earlier turns show it as superseded.
 * `changed` are paths the lab saw move during the turn (covers shell edits and deletes).
 */
export function buildCards(
  turns: Turn[],
  changed: Map<number, string[]>,
  host: Pick<EditHost, "change" | "resolution" | "hasBaseline" | "versions">,
  opts: { rootKnown?: boolean } = {},
): Map<number, Card[]> {
  // Last resort when the workspace root is unknown: a tool path that still carries the host prefix
  // ("tmp/labs-playgrounds/x/workspace/index.html") is the lab's own "index.html" if the lab's list has a path that is
  // a trailing-segments match. Prevents two cards (and a doubled Changes count) for one file.
  const lab = opts.rootKnown ? null : new Set([...host.versions().keys()]);
  const known = (p: string) => !!lab && (lab.has(p) || !!host.change(p) || !!host.resolution(p) || host.hasBaseline(p));
  const resolve = (p: string) => {
    if (!lab || known(p)) return p;
    let best = p;
    for (const k of lab) if (p.endsWith("/" + k) && (best === p || k.length > best.length)) best = k;
    return best;
  };
  const perTurn = turns.map((t) => ({ index: t.index, paths: [...new Set([...t.paths, ...(changed.get(t.index) ?? [])].map(resolve))].sort() }));
  const latest = new Map<string, number>();
  for (const t of perTurn) for (const p of t.paths) latest.set(p, t.index);
  const out = new Map<number, Card[]>();
  for (const t of perTurn) {
    const cards: Card[] = [];
    for (const path of t.paths) {
      const change = host.change(path);
      const res = host.resolution(path);
      const state: CardState = change ? "pending" : res ?? "unknown";
      // no pending change, never resolved, and we know the old content: the edit netted out to nothing
      if (state === "unknown" && host.hasBaseline(path)) continue;
      cards.push({ path, state, change, superseded: latest.get(path) !== t.index });
    }
    if (cards.length) out.set(t.index, cards);
  }
  return out;
}

export function totals(cards: Card[]): { add: number; del: number } {
  let add = 0, del = 0;
  for (const c of cards) if (c.change) { add += c.change.add; del += c.change.del; }
  return { add, del };
}
