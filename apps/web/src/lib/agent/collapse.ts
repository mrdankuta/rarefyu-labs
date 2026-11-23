// First lines of a long text, for "Show more" blocks. Pure.
export interface Collapsed { head: string; hiddenLines: number; long: boolean }

/** `lines` visible lines and at most `chars` characters before the text counts as long. */
export function collapseText(text: string, lines = 4, chars = 600): Collapsed {
  const all = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  if (all.length <= lines && text.length <= chars) return { head: all.join("\n"), hiddenLines: 0, long: false };
  let head = all.slice(0, lines).join("\n");
  if (head.length > chars) head = `${head.slice(0, chars)}…`;
  return { head, hiddenLines: Math.max(0, all.length - lines), long: true };
}
