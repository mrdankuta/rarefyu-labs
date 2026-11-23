/** Laptop <-> workspace file transfer (browser side). UI-agnostic: the explorer just calls these. */

export interface Picked {
  file: File;
  /** Path relative to the dropped/selected root, e.g. "my-app/src/index.js". */
  path: string;
}

/** Folders we never upload: huge, regenerable, or private. Mirrors the server's list. */
const HEAVY = new Set(["node_modules", ".git", ".svelte-kit", ".next", ".cache", "__pycache__", ".venv", "__MACOSX"]);
const JUNK = new Set([".DS_Store", "Thumbs.db"]);
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export interface Collected {
  items: Picked[];
  skipped: number;
}

function readEntries(dir: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((res, rej) => dir.readEntries(res, rej));
}
const fileOf = (e: FileSystemFileEntry) => new Promise<File>((res, rej) => e.file(res, rej));

async function walk(entry: FileSystemEntry, prefix: string, out: Collected) {
  if (entry.isFile) {
    if (JUNK.has(entry.name)) return void out.skipped++;
    out.items.push({ file: await fileOf(entry as FileSystemFileEntry), path: prefix + entry.name });
    return;
  }
  if (HEAVY.has(entry.name)) return void out.skipped++;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns batches (~100); keep reading until empty.
  for (let batch = await readEntries(reader); batch.length; batch = await readEntries(reader))
    for (const child of batch) await walk(child, `${prefix}${entry.name}/`, out);
}

/** Everything dropped onto the page, folders expanded (heavy folders left out). */
export async function collectDropped(dt: DataTransfer): Promise<Collected> {
  const out: Collected = { items: [], skipped: 0 };
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (entries.length) {
    for (const e of entries) await walk(e, "", out);
  } else {
    for (const f of dt.files) out.items.push({ file: f, path: f.name });
  }
  return out;
}

/** From an <input type=file> (optionally webkitdirectory). */
export function collectInput(files: FileList): Collected {
  const out: Collected = { items: [], skipped: 0 };
  for (const f of files) {
    const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const parts = path.split("/");
    if (parts.slice(0, -1).some((p) => HEAVY.has(p)) || JUNK.has(parts[parts.length - 1])) out.skipped++;
    else out.items.push({ file: f, path });
  }
  return out;
}

export interface UploadResult {
  files: number;
  bytes: number;
  skipped: number;
  extractedZip?: string;
}

/** A lone .zip is extracted into `dest`; anything else is uploaded as files/folders. */
export async function upload(api: string, id: string, c: Collected, dest: string): Promise<UploadResult> {
  if (!c.items.length) throw new Error("nothing to upload (node_modules and .git are left out)");
  const total = c.items.reduce((n, i) => n + i.file.size, 0);
  if (total > MAX_UPLOAD_BYTES)
    throw new Error(`that is ${(total / 1048576).toFixed(0)} MB; the limit is ${MAX_UPLOAD_BYTES / 1048576} MB per upload. Leave out build output and big assets.`);
  const form = new FormData();
  const lone = c.items.length === 1 && /\.zip$/i.test(c.items[0].file.name) ? c.items[0] : null;
  for (const it of c.items) {
    form.append("files", it.file, it.file.name);
    form.append("paths", it.path);
  }
  const q = new URLSearchParams();
  if (dest) q.set("dest", dest);
  if (lone) q.set("extract", "1");
  const r = await fetch(`${api}/api/playgrounds/${id}/upload?${q}`, { method: "POST", body: form });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `upload failed (${r.status})`);
  return { ...body, skipped: (body.skipped ?? 0) + c.skipped, extractedZip: lone?.file.name };
}

export const downloadUrl = (api: string, id: string, path = "", heavy = false) =>
  `${api}/api/playgrounds/${id}/download?${new URLSearchParams({ ...(path ? { path } : {}), ...(heavy ? { heavy: "1" } : {}) })}`;

export function describe(r: UploadResult): string {
  const what = r.extractedZip ? `extracted ${r.extractedZip}: ` : "";
  const skip = r.skipped ? ` (${r.skipped} left out: node_modules, .git, system files)` : "";
  return `${what}${r.files} file${r.files === 1 ? "" : "s"} uploaded${skip}`;
}
