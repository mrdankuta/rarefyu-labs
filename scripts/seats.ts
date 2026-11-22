#!/usr/bin/env bun
/**
 * Bulk-load class seats from a CSV of `label,key` lines and print the class codes.
 *
 *   ADMIN_TOKEN=... API=https://labs.example.com bun scripts/seats.ts students.csv
 *   ADMIN_TOKEN=... bun scripts/seats.ts --list
 *
 * Keys are sent once to the API and stored server-side; this script never writes them to disk.
 * Output is `label,code` for handing out (it is the only thing worth printing).
 */
const API = process.env.API ?? "http://localhost:3000";
const token = process.env.ADMIN_TOKEN;
if (!token) { console.error("set ADMIN_TOKEN"); process.exit(2); }
const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
const arg = process.argv[2];

if (arg === "--list") {
  const r = await fetch(`${API}/api/admin/seats`, { headers });
  if (!r.ok) { console.error(`HTTP ${r.status}: ${await r.text()}`); process.exit(1); }
  for (const s of (await r.json()).seats) console.log(`${s.label},${s.code},${s.workspaceId ? "active" : "unused"}`);
  process.exit(0);
}
if (!arg) { console.error("usage: bun scripts/seats.ts <students.csv> | --list"); process.exit(2); }

const lines = (await Bun.file(arg).text()).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const seats = lines.map((l, i) => {
  const at = l.lastIndexOf(",");
  if (at < 1) { console.error(`line ${i + 1}: expected label,key`); process.exit(2); }
  return { label: l.slice(0, at).trim(), key: l.slice(at + 1).trim() };
});
const r = await fetch(`${API}/api/admin/seats`, { method: "POST", headers, body: JSON.stringify({ seats }) });
if (!r.ok) { console.error(`HTTP ${r.status}: ${await r.text()}`); process.exit(1); }
for (const s of (await r.json()).seats) console.log(`${s.label},${s.code}`);
