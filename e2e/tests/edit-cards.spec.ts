import { expect, test, type Page } from "@playwright/test";
import { startStub } from "../stub-model/stub";

// Edit cards (chat) against the STUB model: counts, View diff, Keep, Undo, agreement with the Changes tab,
// editor refresh, unsaved-edit protection, save-before-send. Needs web + API (DRIVER=local, OpenCode 2.4.1):
//   E2E_BASE_URL=http://localhost:5273 bunx playwright test edit-cards
const base = process.env.E2E_BASE_URL;
test.skip(!base, "set E2E_BASE_URL to a running web+api");
// retries: the local OpenCode agent server occasionally fails to come up on a fresh workspace (provider connect 500s),
// which has nothing to do with the cards; a retry gets a clean workspace.
test.describe.configure({ mode: "serial", retries: 2 });

let stub: Awaited<ReturnType<typeof startStub>>;
test.beforeAll(async () => { stub = await startStub(0); });
test.afterAll(async () => { await stub?.stop(); });

let wsId = "";
test.afterEach(async ({ page }) => {
  if (wsId) await page.request.delete(`${base}/api/playgrounds/${wsId}`).catch(() => {});
  wsId = "";
});

const put = async (p: Page, path: string, content: string) => expect((await p.request.put(`${base}/api/playgrounds/${wsId}/files/content`, { data: { path, content } })).ok()).toBe(true);
const read = async (p: Page, path: string) => { const r = await p.request.get(`${base}/api/playgrounds/${wsId}/files/content?path=${encodeURIComponent(path)}`); return r.ok() ? ((await r.json()).content as string) : null; };

/** Workspace wired to the stub, seeded with `files`, lab opened in Chat layout (baseline is taken at load). */
async function open(page: Page, files: Record<string, string> = {}) {
  const res = await page.request.post(`${base}/api/playgrounds`, { data: {} });
  expect(res.status()).toBe(201);
  wsId = (await res.json()).id;
  const cfg = { $schema: "https://opencode.ai/config.json", provider: { stub: { npm: "@ai-sdk/openai-compatible", name: "Stub", options: { baseURL: stub.url, apiKey: "dummy" }, models: { "stub-1": { name: "Stub 1", tools: true } } } }, model: "stub/stub-1", permission: { edit: "allow", bash: "allow" } };
  await put(page, "opencode.json", JSON.stringify(cfg));
  for (const [p, c] of Object.entries(files)) await put(page, p, c);
  await page.goto(`${base}/lab/${wsId}`);
  await expect(input(page)).toBeEnabled({ timeout: 45_000 });
  await page.waitForTimeout(1500); // first tree scan = baseline
}
const input = (p: Page) => p.getByRole("textbox", { name: "Message the agent" });
const call = (name: string, args: object) => `[[call:${name} ${JSON.stringify(args)}]]`;
async function say(p: Page, text: string) { await input(p).fill(text); await input(p).press("Enter"); }
const card = (p: Page, path: string) => p.locator(`[data-testid=edit-card][data-path="${path}"]`);
const done = (p: Page) => expect(p.locator(".msg.assistant").last()).toContainText("Done with the edits", { timeout: 40_000 });
const changesTab = (p: Page) => p.getByRole("tab", { name: /^Changes/ });

const A = "one\ntwo\nthree\n";
/** edit two->TWO+extra (+2 -1), then three->3 (+1 -1): combined on a.txt = +3 -2; plus a new 3-line file */
const turn1 = () =>
  "update files " +
  call("edit", { path: "a.txt", oldString: "two", newString: "TWO\nextra" }) +
  call("edit", { path: "a.txt", oldString: "three", newString: "3" }) +
  call("write", { path: "new.txt", content: "n1\nn2\nn3\n" });

test.describe("edit cards", () => {
  test.setTimeout(120_000);

  test("one card per file with combined +/- counts; Changes tab agrees; View diff opens the diff", async ({ page }) => {
    await open(page, { "a.txt": A });
    await say(page, turn1());
    await done(page);
    await expect(page.locator("[data-testid=edit-card]")).toHaveCount(2); // a.txt edited twice = ONE card
    await expect(card(page, "a.txt").getByTestId("card-add")).toHaveText("+3");
    await expect(card(page, "a.txt").getByTestId("card-del")).toHaveText("−2");
    await expect(card(page, "a.txt").getByTestId("card-status")).toHaveText("Edited");
    await expect(card(page, "new.txt").getByTestId("card-add")).toHaveText("+3");
    await expect(card(page, "new.txt").getByTestId("card-status")).toHaveText("New");
    await expect(changesTab(page)).toContainText("2"); // same two files in the lab's Changes list

    await card(page, "a.txt").getByRole("button", { name: "View diff" }).click();
    await expect(changesTab(page)).toHaveAttribute("class", /on/);
    const body = page.locator(".cardx", { hasText: "a.txt" }).locator(".dbody");
    await expect(body).toContainText("TWO");
    await expect(body.locator(".dadd")).toHaveCount(3);
    await expect(body.locator(".ddel")).toHaveCount(2);
    // nothing was accepted or undone by looking
    await expect(card(page, "a.txt")).toHaveAttribute("data-state", "pending");
  });

  test("Keep accepts (file stays, both surfaces clear)", async ({ page }) => {
    await open(page, { "a.txt": A });
    await say(page, turn1());
    await done(page);
    await card(page, "a.txt").getByRole("button", { name: "Keep", exact: true }).click();
    await expect(card(page, "a.txt")).toHaveAttribute("data-state", "kept");
    await expect(changesTab(page)).toContainText("1");
    expect(await read(page, "a.txt")).toBe("one\nTWO\nextra\n3\n");
    await card(page, "new.txt").getByRole("button", { name: "Keep", exact: true }).click();
    await expect(card(page, "new.txt")).toHaveAttribute("data-state", "kept");
    await expect(changesTab(page)).not.toContainText("1");
    expect(await read(page, "new.txt")).toBe("n1\nn2\nn3\n");
  });

  test("Undo restores the old content and removes a file the agent created; Changes tab agrees; Undo all / Keep all", async ({ page }) => {
    await open(page, { "a.txt": A });
    await say(page, turn1());
    await done(page);
    await card(page, "a.txt").getByRole("button", { name: "Undo", exact: true }).click();
    await expect(card(page, "a.txt")).toHaveAttribute("data-state", "undone");
    expect(await read(page, "a.txt")).toBe(A);
    await expect(changesTab(page)).toContainText("1");
    await card(page, "new.txt").getByRole("button", { name: "Undo", exact: true }).click();
    await expect(card(page, "new.txt")).toHaveAttribute("data-state", "undone");
    expect(await read(page, "new.txt")).toBeNull();
    await changesTab(page).click();
    await expect(page.getByText("Nothing yet.")).toBeVisible();

    // second turn, resolved in bulk from the card header: Undo all asks first
    await say(page, "again " + call("write", { path: "x1.txt", content: "1\n" }) + call("write", { path: "x2.txt", content: "2\n" }));
    await expect(page.locator(".msg.assistant").last()).toContainText("Done with the edits", { timeout: 40_000 });
    await expect(page.locator("[data-testid=edit-card][data-state=pending]")).toHaveCount(2);
    await page.getByTestId("edit-cards").last().getByRole("button", { name: "Undo all", exact: true }).click();
    await expect(page.getByTestId("edit-cards").last().getByRole("button", { name: /Undo all 2\?/ })).toBeVisible();
    await page.getByTestId("edit-cards").last().getByRole("button", { name: /Undo all 2\?/ }).click();
    await expect(page.locator("[data-testid=edit-card][data-state=undone]")).toHaveCount(4);
    expect(await read(page, "x1.txt")).toBeNull();
    expect(await read(page, "x2.txt")).toBeNull();

    // third turn: Keep all accepts both files in one click
    await say(page, "more " + call("write", { path: "y1.txt", content: "1\n" }) + call("write", { path: "y2.txt", content: "2\n" }));
    await expect(page.locator("[data-testid=edit-card][data-state=pending]")).toHaveCount(2, { timeout: 40_000 });
    await page.getByTestId("edit-cards").last().getByRole("button", { name: "Keep all", exact: true }).click();
    await expect(page.locator("[data-testid=edit-card][data-state=kept]")).toHaveCount(2);
    expect(await read(page, "y1.txt")).toBe("1\n");
  });

  test("resolving in the Changes tab updates the card and never applies twice", async ({ page }) => {
    await open(page, { "a.txt": A });
    await say(page, turn1());
    await done(page);
    await changesTab(page).click();
    await page.locator(".cardx", { hasText: "new.txt" }).getByRole("button", { name: "Revert" }).click();
    await expect(card(page, "new.txt")).toHaveAttribute("data-state", "undone");
    await page.locator(".cardx", { hasText: "a.txt" }).getByRole("button", { name: "Keep" }).click();
    await expect(card(page, "a.txt")).toHaveAttribute("data-state", "kept");
    // a resolved card offers no second action
    await expect(card(page, "a.txt").getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
    expect(await read(page, "a.txt")).toBe("one\nTWO\nextra\n3\n");
  });

  test("a deleted file shows as Deleted and Undo brings it back", async ({ page }) => {
    await open(page, { "a.txt": A, "gone.txt": "bye\n" });
    await say(page, "clean up " + call("bash", { command: "rm gone.txt", description: "remove" }));
    await done(page);
    await expect(card(page, "gone.txt").getByTestId("card-status")).toHaveText("Deleted", { timeout: 15_000 });
    await expect(card(page, "gone.txt").getByTestId("card-del")).toHaveText("−1");
    expect(await read(page, "gone.txt")).toBeNull();
    await card(page, "gone.txt").getByRole("button", { name: "Undo", exact: true }).click();
    await expect(card(page, "gone.txt")).toHaveAttribute("data-state", "undone");
    expect(await read(page, "gone.txt")).toBe("bye\n");
  });

  test("a large file gets a card without a diff; Undo still removes it", async ({ page }) => {
    await open(page, { "a.txt": A });
    await say(page, "big " + call("write", { path: "big.txt", content: "x".repeat(150_000) + "\n" }));
    await done(page);
    await expect(card(page, "big.txt").getByTestId("card-nodiff")).toBeVisible({ timeout: 15_000 });
    await expect(card(page, "big.txt").getByRole("button", { name: "View diff" })).toHaveCount(0);
    await card(page, "big.txt").getByRole("button", { name: "Undo", exact: true }).click();
    await expect(card(page, "big.txt")).toHaveAttribute("data-state", "undone");
    expect(await read(page, "big.txt")).toBeNull();
  });

  /** Open a.txt in the Code view via its card, with auto-save off so "unsaved" stays unsaved. */
  async function openInEditor(page: Page, path: string) {
    await card(page, path).getByRole("button", { name: path }).click();
    await expect(page.locator(".cm-content")).toBeVisible();
    await page.getByLabel("Auto-save").uncheck();
  }

  test("an open editor tab refreshes after the agent edits the file", async ({ page }) => {
    await open(page, { "a.txt": A });
    await say(page, "first " + call("edit", { path: "a.txt", oldString: "one", newString: "ONE" }));
    await done(page);
    await openInEditor(page, "a.txt");
    await expect(page.locator(".cm-content")).toContainText("ONE");
    await say(page, "second " + call("edit", { path: "a.txt", oldString: "three", newString: "THREE" }));
    await expect(page.locator(".msg.assistant").last()).toContainText("Done with the edits", { timeout: 40_000 });
    await expect(page.locator(".cm-content")).toContainText("THREE", { timeout: 15_000 }); // no reload, no click
    await expect(page.locator(".edname .d.dirty")).toHaveCount(0);
  });

  test("unsaved student edits are protected when the agent changes the same file", async ({ page }) => {
    await open(page, { "a.txt": A });
    await say(page, "first " + call("edit", { path: "a.txt", oldString: "one", newString: "ONE" }));
    await done(page);
    await openInEditor(page, "a.txt");
    // agent edits after a 4s pause; the student types during the pause
    await say(page, "second [[wait:4000]]" + call("edit", { path: "a.txt", oldString: "three", newString: "THREE" }));
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("student line");
    await expect(page.locator(".edname .d.dirty")).toHaveCount(1);
    await expect(page.locator(".msg.assistant").last()).toContainText("Done with the edits", { timeout: 40_000 });
    await expect(page.getByTestId("edit-conflict")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".cm-content")).toContainText("student line"); // not overwritten
    await expect(page.locator(".cm-content")).not.toContainText("THREE");
    await page.waitForTimeout(2500); // longer than auto-save's delay (it is off anyway): nothing written over the agent's file
    expect(await read(page, "a.txt")).toBe("ONE\ntwo\nTHREE\n");
    await expect(page.locator(".edname .d.dirty")).toHaveCount(1);
  });

  test("student edits are on disk before the agent's next turn (flush on send)", async ({ page }) => {
    await open(page, { "a.txt": A });
    await say(page, "first " + call("edit", { path: "a.txt", oldString: "one", newString: "ONE" }));
    await done(page);
    await openInEditor(page, "a.txt");
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("typed by student");
    await expect(page.locator(".edname .d.dirty")).toHaveCount(1);
    expect(await read(page, "a.txt")).not.toContain("typed by student"); // auto-save is off: not saved yet
    await say(page, "look [[wait:3000]]" + call("read", { path: "a.txt" }));
    await expect(page.locator(".msg.user").last()).toContainText("look");
    // the agent has not answered yet (3s pause), but the save already happened
    await expect.poll(() => read(page, "a.txt"), { timeout: 2500 }).toContain("typed by student");
    await done(page);
    await expect(page.locator(".edname .d.dirty")).toHaveCount(0);
  });

  test("Undo after the student edited the file warns instead of silently discarding", async ({ page }) => {
    await open(page, { "a.txt": A });
    await say(page, "first " + call("edit", { path: "a.txt", oldString: "one", newString: "ONE" }));
    await done(page);
    await openInEditor(page, "a.txt");
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("mine");
    await page.keyboard.press("Control+s");
    await expect.poll(() => read(page, "a.txt")).toContain("mine");
    await card(page, "a.txt").getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByTestId("discard-ask")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    expect(await read(page, "a.txt")).toContain("mine"); // nothing changed
    await expect(card(page, "a.txt")).toHaveAttribute("data-state", "pending");
    await card(page, "a.txt").getByRole("button", { name: "Undo", exact: true }).click();
    await page.getByRole("button", { name: "Undo anyway" }).click();
    await expect(card(page, "a.txt")).toHaveAttribute("data-state", "undone");
    expect(await read(page, "a.txt")).toBe(A);
    await expect(page.locator(".cm-content")).not.toContainText("mine"); // the editor shows the restored file
  });
});
