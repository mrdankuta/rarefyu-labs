// Small line diff (LCS) for the "Changes" view. Inputs are capped so a huge file can't stall the tab.
export interface DiffLine { t: " " | "+" | "-"; s: string }
export interface DiffStat { add: number; del: number }

const MAX_LINES = 1500;

/** Lines of a text: a final newline ends the last line, it does not start an empty one ("a\nb\n" is 2 lines). */
export function splitLines(t: string): string[] {
  if (t === "") return [];
  const l = t.split("\n");
  if (l.length > 1 && l[l.length - 1] === "") l.pop();
  return l;
}

export function diffLines(a: string, b: string): DiffLine[] {
  const A = splitLines(a);
  const B = splitLines(b);
  if (A.length > MAX_LINES || B.length > MAX_LINES) {
    return [...A.map((s) => ({ t: "-" as const, s })), ...B.map((s) => ({ t: "+" as const, s }))];
  }
  // trim common head/tail to keep the table small
  let head = 0;
  while (head < A.length && head < B.length && A[head] === B[head]) head++;
  let tail = 0;
  while (tail < A.length - head && tail < B.length - head && A[A.length - 1 - tail] === B[B.length - 1 - tail]) tail++;
  const a2 = A.slice(head, A.length - tail), b2 = B.slice(head, B.length - tail);
  const n = a2.length, m = b2.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a2[i] === b2[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = A.slice(0, head).map((s) => ({ t: " " as const, s }));
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a2[i] === b2[j]) { out.push({ t: " ", s: a2[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: "-", s: a2[i++] });
    else out.push({ t: "+", s: b2[j++] });
  }
  while (i < n) out.push({ t: "-", s: a2[i++] });
  while (j < m) out.push({ t: "+", s: b2[j++] });
  for (const s of A.slice(A.length - tail)) out.push({ t: " ", s });
  return out;
}

export function statOf(d: DiffLine[]): DiffStat {
  let add = 0, del = 0;
  for (const l of d) { if (l.t === "+") add++; else if (l.t === "-") del++; }
  return { add, del };
}

/** Collapse long unchanged runs, keeping `ctx` lines around each change. */
export function withContext(d: DiffLine[], ctx = 3): (DiffLine | { gap: number })[] {
  const keep = new Array(d.length).fill(false);
  d.forEach((l, i) => { if (l.t !== " ") for (let k = Math.max(0, i - ctx); k <= Math.min(d.length - 1, i + ctx); k++) keep[k] = true; });
  const out: (DiffLine | { gap: number })[] = [];
  let gap = 0;
  d.forEach((l, i) => { if (keep[i]) { if (gap) { out.push({ gap }); gap = 0; } out.push(l); } else gap++; });
  if (gap) out.push({ gap });
  return out;
}
