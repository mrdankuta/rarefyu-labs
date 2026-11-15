/** Resolve `rel` strictly inside `base`; throws if it escapes. Pure string logic (no fs). */
export function resolveInside(base: string, rel: string): string {
  if (rel.includes("\0")) throw new Error("invalid path");
  const abs = rel ? `${base}/${rel}` : base;
  const norm = abs
    .split("/")
    .reduce<string[]>((acc, seg) => {
      if (seg === "" || seg === ".") return acc;
      if (seg === "..") acc.pop();
      else acc.push(seg);
      return acc;
    }, [])
    .join("/");
  const full = `/${norm}`;
  if (full !== base && !full.startsWith(`${base}/`)) throw new Error("path escapes workspace");
  return full;
}
