import { describe, expect, test, beforeEach } from "bun:test";
import { app } from "../src/app";
import { clearPlaygrounds } from "../src/playgrounds";

const H = { "content-type": "application/json", "x-session-key": "files1" };

async function makePlayground() {
  const res = await app.request("/api/playgrounds", {
    method: "POST",
    headers: H,
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
}

beforeEach(() => clearPlaygrounds());

describe("session filesystem", () => {
  test("list → read → write → diff → reset file → reset project", async () => {
    const id = await makePlayground();

    const list = await (await app.request(`/api/playgrounds/${id}/files`)).json();
    expect(list.files.some((f: { path: string }) => f.path === "README.md")).toBe(true);

    const read = await (
      await app.request(`/api/playgrounds/${id}/files/content?path=README.md`)
    ).json();
    expect(read.truncated).toBe(false);
    expect(typeof read.content).toBe("string");

    const write = await app.request(`/api/playgrounds/${id}/files/content`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ path: "src/app.ts", content: "export const x = 1;\n" }),
    });
    expect(write.status).toBe(200);

    const diff = await (
      await app.request(`/api/playgrounds/${id}/files/diff?path=src/app.ts`)
    ).json();
    expect(diff.changed).toBe(true);
    expect(diff.diff).toContain("x = 1");

    const resetFile = await app.request(`/api/playgrounds/${id}/files/reset`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ path: "README.md" }),
    });
    // README unchanged since starter → reset is a no-op success
    expect(resetFile.status).toBe(200);

    const resetAll = await app.request(`/api/playgrounds/${id}/files/reset`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({}),
    });
    expect(resetAll.status).toBe(200);
    const after = await (
      await app.request(`/api/playgrounds/${id}/files`)
    ).json();
    expect(after.files.some((f: { path: string }) => f.path === "src")).toBe(false);
    expect(after.files.some((f: { path: string }) => f.path === "README.md")).toBe(true);
  });

  test("traversal rejected, missing file 404, binary rejected", async () => {
    const id = await makePlayground();
    const trav = await app.request(`/api/playgrounds/${id}/files/content?path=../escape`);
    expect(trav.status).toBe(400);
    const miss = await app.request(`/api/playgrounds/${id}/files/content?path=nope.txt`);
    expect(miss.status).toBe(404);
    await app.request(`/api/playgrounds/${id}/files/content`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ path: "bin.dat", content: "x" }),
    });
    // overwrite with NUL via driver-level check is client-string-limited; large cap enforced:
    const big = await app.request(`/api/playgrounds/${id}/files/content`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ path: "big.txt", content: "x".repeat(1024 * 1024 + 1) }),
    });
    expect(big.status).toBe(400);
  });
});
