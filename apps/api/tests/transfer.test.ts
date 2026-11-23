import { describe, expect, test } from "bun:test";
import { app } from "../src/app";

const post = (path: string, body?: BodyInit) => app.request(path, { method: "POST", body, headers: body instanceof FormData ? {} : { "content-type": "application/json" } });

async function start() {
  const r = await post("/api/playgrounds", JSON.stringify({}));
  expect(r.status).toBeLessThan(300);
  return (await r.json()).id as string;
}
const form = (files: [string, string | Uint8Array][], extra: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [p, d] of files) {
    f.append("files", new File([d as BlobPart], p.split("/").pop()!));
    f.append("paths", p);
  }
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
};

describe("file transfer API", () => {
  test("upload a folder, then download it as a zip and a single file as-is", async () => {
    const id = await start();
    const bin = Uint8Array.from({ length: 256 }, (_, i) => i);
    const up = await post(`/api/playgrounds/${id}/upload?dest=site`, form([["index.html", "<h1>hi</h1>"], ["img/pic.bin", bin], ["node_modules/a/b.js", "x"]]));
    expect(up.status).toBe(201);
    expect(await up.json()).toEqual({ files: 2, bytes: 11 + 256, skipped: 1 });

    const file = await app.request(`/api/playgrounds/${id}/download?path=site/img/pic.bin`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toContain('filename="pic.bin"');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bin);

    const zip = await app.request(`/api/playgrounds/${id}/download?path=site`);
    expect(zip.headers.get("content-type")).toBe("application/zip");
    expect(zip.headers.get("content-disposition")).toContain('filename="site.zip"');
    const bytes = new Uint8Array(await zip.arrayBuffer());
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");

    const back = await post(`/api/playgrounds/${id}/upload?extract=1&dest=copy`, form([["site.zip", bytes]]));
    expect(back.status).toBe(201);
    expect((await back.json()).files).toBe(2);
  });

  test("path traversal and bad input are refused with readable errors", async () => {
    const id = await start();
    const evil = await post(`/api/playgrounds/${id}/upload`, form([["../escape.txt", "x"]]));
    expect(evil.status).toBe(400);
    expect((await evil.json()).error).toMatch(/bad path|escapes/);
    expect((await post(`/api/playgrounds/${id}/upload`, new FormData())).status).toBe(400);
    expect((await app.request(`/api/playgrounds/${id}/download?path=nope`)).status).toBe(404);
    expect((await app.request(`/api/playgrounds/${id}/download?path=nope.txt`)).status).toBe(404);
    const notZip = await post(`/api/playgrounds/${id}/upload?extract=1`, form([["x.zip", "plain text"]]));
    expect(notZip.status).toBe(400);
    expect((await notZip.json()).error).toMatch(/not a valid zip/);
  });

  test("oversized uploads are rejected before buffering", async () => {
    const id = await start();
    const r = await app.request(`/api/playgrounds/${id}/upload`, { method: "POST", headers: { "content-length": String(200 * 1024 * 1024) }, body: new FormData() });
    expect(r.status).toBe(413);
  });
});
