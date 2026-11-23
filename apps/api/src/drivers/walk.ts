// One-shot recursive listing for the explorer tree, quick-open, search and change tracking.
// A single `find` (one docker exec) replaces a listing per folder.
export interface WalkEntry { path: string; type: "file" | "dir"; size: number; mtime: number; collapsed?: boolean }

const HEAVY = ["node_modules", "__pycache__", "venv"];

/** find(1) args rooted at `root`; dotfiles are hidden, heavy dirs are listed but not entered. */
export function walkArgs(root: string): string[] {
  const heavy = HEAVY.flatMap((n, i) => (i ? ["-o", "-name", n] : ["-name", n]));
  return [
    "find", root, "-mindepth", "1",
    "(", "-name", ".*", "-prune", ")", "-o",
    "(", "-type", "d", "(", ...heavy, ")", "-printf", "H\\t0\\t%T@\\t%P\\n", "-prune", ")", "-o",
    "-printf", "%y\\t%s\\t%T@\\t%P\\n",
  ];
}

export function parseWalk(text: string, max = 3000): { entries: WalkEntry[]; truncated: boolean } {
  const entries: WalkEntry[] = [];
  let truncated = false;
  for (const line of text.split("\n")) {
    if (!line) continue;
    const [y, size, mtime, ...rest] = line.split("\t");
    const path = rest.join("\t");
    if (!path || (y !== "f" && y !== "d" && y !== "H")) continue;
    if (entries.length >= max) { truncated = true; break; }
    entries.push({ path, type: y === "f" ? "file" : "dir", size: Number(size) || 0, mtime: Math.floor(Number(mtime) || 0), ...(y === "H" ? { collapsed: true } : {}) });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { entries, truncated };
}
