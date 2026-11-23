import { expect, test, type Page } from "@playwright/test";
import { startStub } from "../stub-model/stub";

// Preview automation (#54) against the STUB model. Needs a running web + API (DRIVER=local, OpenCode 2.4.1):
//   E2E_BASE_URL=http://localhost:5373 bunx playwright test preview-automation
const base = process.env.E2E_BASE_URL;
test.skip(!base, "set E2E_BASE_URL to a running web+api");
test.describe.configure({ mode: "serial" });

let stub: Awaited<ReturnType<typeof startStub>>;
test.beforeAll(async () => { stub = await startStub(0); });
test.afterAll(async () => { await stub?.stop(); });

let wsId = "";
async function setup(page: Page, opts: { files?: Record<string, string> } = {}) {
  const res = await page.request.post(`${base}/api/playgrounds`, { data: {} });
  expect(res.status()).toBe(201);
  wsId = (await res.json()).id;
  const cfg = { $schema: "https://opencode.ai/config.json", provider: { stub: { npm: "@ai-sdk/openai-compatible", name: "Stub", options: { baseURL: stub.url, apiKey: "dummy-key" }, models: { "stub-1": { name: "Stub 1", tools: true } } } }, model: "stub/stub-1" };
  for (const [path, content] of Object.entries({ "opencode.json": JSON.stringify(cfg), ...(opts.files ?? {}) })) {
    const put = await page.request.put(`${base}/api/playgrounds/${wsId}/files/content`, { data: { path, content } });
    expect(put.ok()).toBe(true);
  }
}
async function openChat(page: Page) {
  await page.goto(`${base}/lab/${wsId}`);
  await expect(page.getByRole("textbox", { name: "Message the agent" })).toBeEnabled({ timeout: 45_000 });
}
test.afterEach(async ({ page }) => {
  if (wsId) await page.request.delete(`${base}/api/playgrounds/${wsId}`).catch(() => {});
  wsId = "";
});
const input = (p: Page) => p.getByRole("textbox", { name: "Message the agent" });
async function say(p: Page, text: string) { await input(p).fill(text); await input(p).press("Enter"); }
const frame = (p: Page) => p.frameLocator('iframe[title="preview"]');
const readFile = async (p: Page, path: string) => (await p.request.get(`${base}/api/playgrounds/${wsId}/files/content?path=${encodeURIComponent(path)}`)).text();

test.describe("preview automation", () => {
  test.setTimeout(120_000);

  test("new workspace has AGENTS.md (and the agent actually receives it)", async ({ page }) => {
    await setup(page);
    const rules = await readFile(page, "AGENTS.md");
    expect(rules).toContain("# How to work in this lab");
    expect(rules).toMatch(/http\.server \d+/);
    expect(rules.split("\n").length).toBeLessThan(40);
    // OpenCode 2.4.1 loads AGENTS.md from the project directory into the system prompt
    await openChat(page);
    await say(page, "hello");
    await expect(page.locator(".msg.assistant")).toContainText("Hello from the stub model", { timeout: 30_000 });
    const system = JSON.stringify(stub.requests.at(-1)?.body?.messages?.filter((m: any) => m.role === "system") ?? []);
    expect(system).toContain("How to work in this lab");
  });

  test("agent writes index.html: preview opens by itself, refreshes after the next turn, keeps scroll", async ({ page }) => {
    await setup(page);
    await openChat(page);
    await expect(page.getByRole("tab", { name: "Preview" })).toBeVisible();
    await say(page, "make my site [[site:First version]]");
    // no terminal, no commands: the preview appears on its own
    await expect(frame(page).locator("#t")).toHaveText("First version", { timeout: 60_000 });
    await expect(page.locator(".msg.assistant").last()).toContainText("I updated index.html", { timeout: 30_000 });

    // scroll the previewed page, then edit again: it refreshes once at turn end and the scroll position is kept
    const inner = await frame(page).locator("#end").elementHandle();
    await inner!.scrollIntoViewIfNeeded();
    const scrollBefore = await frame(page).locator("body").evaluate(() => window.scrollY);
    expect(scrollBefore).toBeGreaterThan(500);
    let loads = 0;
    page.on("framenavigated", (f) => { if (f !== page.mainFrame()) loads++; });
    await say(page, "change it [[site:Second version]]");
    await expect(frame(page).locator("#t")).toHaveText("Second version", { timeout: 60_000 });
    await page.waitForTimeout(2500);
    expect(loads).toBeLessThanOrEqual(2); // one refresh for the turn, not one per streamed token
    const scrollAfter = await frame(page).locator("body").evaluate(() => window.scrollY);
    expect(scrollAfter).toBeGreaterThan(500);
  });

  test("non-web workspace: nothing is started, no forced preview", async ({ page }) => {
    await setup(page);
    await openChat(page);
    await say(page, "hello there");
    await expect(page.locator(".msg.assistant")).toContainText("Hello from the stub model", { timeout: 30_000 });
    await expect(page.getByText("Nothing to preview yet")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('iframe[title="preview"]')).toHaveCount(0);
    const r = await page.request.post(`${base}/api/playgrounds/${wsId}/preview/ensure`, { data: {} });
    expect((await r.json()).state).toBe("not-web");
  });

  test("existing web project: preview starts when the lab opens, boot state is friendly, never an error page", async ({ page }) => {
    await setup(page, { files: { "index.html": "<h1 id='t'>Existing site</h1>" } });
    // hold the start answer so the boot state is observable
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let first = true;
    await page.route("**/preview/ensure", async (route) => {
      if (first) { first = false; await gate; }
      await route.continue();
    });
    await page.goto(`${base}/lab/${wsId}`);
    await expect(page.getByText("Your site will show up here")).toBeVisible(); // calm placeholder, no error text
    release();
    await expect(frame(page).locator("#t")).toHaveText("Existing site", { timeout: 60_000 });
    await expect(page.getByText(/cannot reach|stopped responding|not reachable|Start your app in the terminal/i)).toHaveCount(0);
  });

  test("boot state: 'Starting your site…' while the server comes up; failure falls back to a terminal hint", async ({ page }) => {
    await setup(page, { files: { "index.html": "<h1 id='t'>Slow site</h1>" } });
    let calls = 0;
    await page.route("**/preview/ensure", async (route) => {
      calls++;
      if (calls <= 3) return route.fulfill({ json: { state: "starting", port: 3000, kind: "static", sinceMs: calls * 1000 } });
      if (calls === 4) return route.fulfill({ json: { state: "failed", port: 3000, kind: "static", hint: "Your site did not start on port 3000. Open a terminal and run: python3 -m http.server 3000" } });
      return route.continue(); // retry: the real API starts it
    });
    if (process.env.THEME) await page.addInitScript((t) => localStorage.setItem("rfy_theme", t), process.env.THEME);
    await page.goto(`${base}/lab/${wsId}`);
    await expect(page.getByText("Starting your site…")).toBeVisible({ timeout: 20_000 });
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${await page.evaluate(() => document.documentElement.dataset.theme ?? "dark")}-starting.png` });
    await expect(page.getByText(/cannot reach|stopped responding|not reachable/i)).toHaveCount(0);
    await expect(page.getByText("Your site did not start", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Open a terminal and run")).toBeVisible();
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${await page.evaluate(() => document.documentElement.dataset.theme ?? "dark")}-failed.png` });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(frame(page).locator("#t")).toHaveText("Slow site", { timeout: 60_000 });
  });
});
