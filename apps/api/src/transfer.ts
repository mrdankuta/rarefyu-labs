/** Wire format between the API and `lab-transfer put` (see images/base-lab/lab-transfer). */
export interface TransferResult {
  files: number;
  bytes: number;
  skipped: number;
}

export type ImportInput = { kind: "files"; files: { path: string; data: Uint8Array }[] } | { kind: "zip"; data: Uint8Array };

/** Frame: u32 pathlen, path, u64 size, bytes — repeated. */
export function frameFiles(files: { path: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts = files.map((f) => ({ p: enc.encode(f.path), d: f.data }));
  const total = parts.reduce((n, x) => n + 4 + x.p.length + 8 + x.d.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let o = 0;
  for (const { p, d } of parts) {
    dv.setUint32(o, p.length);
    o += 4;
    out.set(p, o);
    o += p.length;
    dv.setBigUint64(o, BigInt(d.length));
    o += 8;
    out.set(d, o);
    o += d.length;
  }
  return out;
}

export function parseTransferResult(stdout: string): TransferResult {
  try {
    const r = JSON.parse(stdout.trim());
    return { files: r.files ?? 0, bytes: r.bytes ?? 0, skipped: r.skipped ?? 0 };
  } catch {
    throw new Error("transfer failed");
  }
}
