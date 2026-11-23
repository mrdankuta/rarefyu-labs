import { expect, test, type Page } from "@playwright/test";
import { startStub } from "../stub-model/stub";

// Chat panel against a STUB model (free, deterministic). Needs a running web + API (DRIVER=local) whose
// OPENCODE_BIN is OpenCode 2.4.1:
//   E2E_BASE_URL=http://localhost:5173 bunx playwright test chat-panel
// The stub (e2e/stub-model/stub.ts) is started by this file and wired in through the workspace's own
// opencode.json custom provider (baseURL + a dummy key), for the test workspace only.
const base = process.env.E2E_BASE_URL;
test.skip(!base, "set E2E_BASE_URL to a running web+api");
test.describe.configure({ mode: "serial" });

const DUMMY_KEY = "dummy-key-DO-NOT-LEAK-7f3a";
let stub: Awaited<ReturnType<typeof startStub>>;
test.beforeAll(async () => { stub = await startStub(0); });
test.afterAll(async () => { await stub?.stop(); });

let wsId = "";
const bodies: string[] = [];

/** New workspace wired to the stub model (never a real provider). */
async function setup(page: Page) {
  bodies.length = 0;
  const res = await page.request.post(`${base}/api/playgrounds`, { data: {} });
  expect(res.status()).toBe(201);
  wsId = (await res.json()).id;
  const cfg = { $schema: "https://opencode.ai/config.json", provider: { stub: { npm: "@ai-sdk/openai-compatible", name: "Stub", options: { baseURL: stub.url, apiKey: DUMMY_KEY }, models: { "stub-1": { name: "Stub 1", tools: true } } } }, model: "stub/stub-1" };
  const put = await page.request.put(`${base}/api/playgrounds/${wsId}/files/content`, { data: { path: "opencode.json", content: JSON.stringify(cfg) } });
  expect(put.ok()).toBe(true);
  recordPanelTraffic(page);
}
/** Setup, then open the lab in the (default) Chat layout. */
async function openChat(page: Page) {
  await setup(page);
  await page.goto(`${base}/lab/${wsId}`);
  await expect(page.getByRole("textbox", { name: "Message the agent" })).toBeEnabled({ timeout: 45_000 });
}
function recordPanelTraffic(page: Page) {
  // record what the PANEL receives (setup above legitimately wrote the config)
  page.on("response", async (r) => {
    // everything the panel gets from the agent proxy. (Workspace file reads are excluded: the fixture's own
    // opencode.json, which holds the dummy key, is a legitimate file in the student's workspace here; real seat
    // keys live under $HOME, outside the workspace tree.)
    if (!r.url().includes("/agent")) return;
    if ((r.headers()["content-type"] ?? "").includes("event-stream")) return; // streamed: checked via DOM + the other responses
    try { bodies.push(await r.text()); } catch { /* body gone (navigation) */ }
  });
}
test.afterEach(async ({ page }) => {
  if (wsId) await page.request.delete(`${base}/api/playgrounds/${wsId}`).catch(() => {});
  wsId = "";
});

const chatp = (p: Page) => p.getByRole("region", { name: "agent chat" });
const input = (p: Page) => p.getByRole("textbox", { name: "Message the agent" });
async function say(p: Page, text: string) { await input(p).fill(text); await input(p).press("Enter"); }
const reply = (p: Page) => p.locator(".msg.assistant");

test.describe("chat panel", () => {
  test.setTimeout(90_000);

  test("message in, reply streams in as markdown; seat/dummy key never reaches the browser", async ({ page }) => {
    await openChat(page);
    await expect(page.getByText("What should we build?")).toBeVisible();
    await expect(page.getByText("No class key is set up for this workspace")).toBeVisible(); // anonymous workspace: no seat
    await say(page, "Hello agent");
    await expect(page.locator(".msg.user")).toContainText("Hello agent");
    await expect(page.locator(".working")).toBeVisible();
    await expect(reply(page)).toContainText("Hello from the stub model", { timeout: 30_000 });
    await expect(reply(page).locator("strong")).toHaveText("bold");
    await expect(reply(page).locator("pre code")).toContainText("console.log('hi')");
    await expect(page.locator(".working")).toHaveCount(0);
    await expect(chatp(page).getByRole("button", { name: "Send", exact: true })).toBeVisible();
    expect(stub.requests.at(-1)?.authorization).toBe(`Bearer ${DUMMY_KEY}`); // the agent used the workspace's key...

    // ...and the browser never saw it: not in the DOM, storage, or any API response the panel triggered
    expect(await page.content()).not.toContain(DUMMY_KEY);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(DUMMY_KEY);
    expect(bodies.length).toBeGreaterThan(3);
    for (const b of bodies) expect(b).not.toContain(DUMMY_KEY);
    // key-bearing upstream endpoints are not reachable through the proxy at all
    for (const p of ["credential", "config", "provider", "model/default"]) {
      const r = await page.request.get(`${base}/api/playgrounds/${wsId}/agent/api/${p}`);
      expect([p, r.status()]).toEqual([p, 404]);
    }
  });

  test("Enter sends, Shift+Enter adds a new line", async ({ page }) => {
    await openChat(page);
    await input(page).fill("line one");
    await input(page).press("Shift+Enter");
    await input(page).pressSequentially("line two");
    expect(await input(page).inputValue()).toBe("line one\nline two");
    await input(page).press("Enter");
    await expect(page.locator(".msg.user")).toContainText("line two");
    await expect(reply(page)).toContainText("Hello from the stub model", { timeout: 30_000 });
  });

  test("tool call shows a compact line, then the final reply; the file exists", async ({ page }) => {
    await openChat(page);
    await say(page, "make me a file [[tool]]");
    const tool = page.locator('.tool[data-tool="write"]');
    await expect(tool).toContainText("Writing hello.txt", { timeout: 30_000 });
    await expect(reply(page).last()).toContainText("I created hello.txt for you.", { timeout: 30_000 });
    await expect(tool).not.toHaveClass(/run/);
    await expect(tool.locator(".ic")).toHaveText("✓");
    const f = await page.request.get(`${base}/api/playgrounds/${wsId}/files/content?path=hello.txt`);
    expect(await f.text()).toContain("hello from the stub");
  });

  test("Stop interrupts a running, slow-streaming turn", async ({ page }) => {
    await openChat(page);
    await say(page, "go slowly [[slow]]");
    await expect(reply(page)).toContainText("word1", { timeout: 30_000 });
    await expect(page.locator(".working")).toBeVisible();
    await chatp(page).getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.locator(".note.stopped")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".working")).toHaveCount(0);
    await expect(chatp(page).getByRole("button", { name: "Send", exact: true })).toBeVisible();
    const text = await reply(page).innerText();
    await page.waitForTimeout(1500);
    expect(await reply(page).innerText()).toBe(text); // really stopped: nothing more streams in
    expect(text).not.toContain("word59");
    // and the agent is usable again
    await say(page, "hello again");
    await expect(reply(page).last()).toContainText("Hello from the stub model", { timeout: 30_000 });
  });

  test("New conversation starts clean and is a different session", async ({ page }) => {
    await openChat(page);
    await say(page, "first topic");
    await expect(reply(page)).toContainText("Hello from the stub model", { timeout: 30_000 });
    const key = `rfy_chat_session:${wsId}`;
    const first = await page.evaluate((k) => localStorage.getItem(k), key);
    expect(first).toMatch(/^ses_/);
    await chatp(page).getByRole("button", { name: "New conversation", exact: true }).click();
    await expect(page.getByText("What should we build?")).toBeVisible();
    await expect(page.locator(".msg")).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
    await say(page, "second topic");
    await expect(reply(page)).toContainText("Hello from the stub model", { timeout: 30_000 });
    const second = await page.evaluate((k) => localStorage.getItem(k), key);
    expect(second).toMatch(/^ses_/);
    expect(second).not.toBe(first);
    const last = stub.requests.at(-1)!.body.messages.map((m: any) => JSON.stringify(m.content)).join(" ");
    expect(last).toContain("second topic");
    expect(last).not.toContain("first topic"); // the model sees a clean history
  });

  test("reload keeps the current conversation (history, tool line) and a running turn", async ({ page }) => {
    await openChat(page);
    await say(page, "remember me [[tool]]");
    await expect(reply(page).last()).toContainText("I created hello.txt for you.", { timeout: 30_000 });
    await page.reload();
    await expect(input(page)).toBeEnabled({ timeout: 45_000 });
    await expect(page.locator(".msg.user")).toContainText("remember me");
    await expect(page.locator('.tool[data-tool="write"]')).toContainText("Writing hello.txt");
    await expect(reply(page).last()).toContainText("I created hello.txt for you.");
    await expect(page.getByText("What should we build?")).toHaveCount(0);

    // a turn still running when the page reloads comes back as "working", and can be stopped
    await say(page, "long one [[slow]]");
    await expect(reply(page).last()).toContainText("word1", { timeout: 30_000 });
    await page.reload();
    await expect(page.locator(".working")).toBeVisible({ timeout: 45_000 });
    await chatp(page).getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.locator(".note.stopped")).toBeVisible({ timeout: 15_000 });
  });

  test("401 shows the key-rejected message", async ({ page }) => {
    await openChat(page);
    await say(page, "hi [[401]]");
    const err = page.locator(".note.cerror");
    await expect(err).toContainText("Your model key was rejected", { timeout: 30_000 });
    await expect(err).toContainText("Ask your facilitator");
    await expect(page.locator(".working")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("authentication_error"); // raw provider text is never shown
  });

  test("429 shows a rate-limit message while retrying, and Stop ends it", async ({ page }) => {
    await openChat(page);
    await say(page, "hi [[429]]");
    const note = page.locator(".note.retry");
    await expect(note).toContainText("busy or your key hit its rate limit", { timeout: 30_000 });
    await expect(note).toContainText("Retrying automatically");
    await expect(page.locator("body")).not.toContainText("rate_limit_error");
    await chatp(page).getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.locator(".note.stopped")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".note.retry")).toHaveCount(0);
  });

  test("500 shows a model-problem message", async ({ page }) => {
    await openChat(page);
    await say(page, "hi [[500]]");
    const note = page.locator(".note.retry");
    await expect(note).toContainText("problem on its side", { timeout: 30_000 });
    await expect(page.locator("body")).not.toContainText("server_error");
    await chatp(page).getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.locator(".note.stopped")).toBeVisible({ timeout: 15_000 });
  });

  test("network failure on send shows a plain message and keeps the draft usable", async ({ page }) => {
    await openChat(page);
    await page.route("**/agent/api/session/*/prompt", (r) => r.abort("failed"));
    await say(page, "will not arrive");
    await expect(page.locator(".note.cerror")).toContainText("Can't reach the lab", { timeout: 15_000 });
    await expect(page.locator(".working")).toHaveCount(0);
    await expect(page.locator(".msg.user")).toHaveCount(0); // optimistic bubble rolled back
  });

  test("agent that cannot start shows a clear message; lab stays usable", async ({ page }) => {
    await page.route("**/api/playgrounds/*/agent", (r) => (r.request().method() === "POST" ? r.fulfill({ status: 503, json: { error: "x", state: "unhealthy" } }) : r.continue()));
    const res = await page.request.post(`${base}/api/playgrounds`, { data: {} });
    wsId = (await res.json()).id;
    await page.goto(`${base}/lab/${wsId}`);
    await expect(page.getByText("The agent could not start.")).toBeVisible({ timeout: 30_000 });
    await expect(input(page)).toBeDisabled();
    await expect(page.locator(".dock")).toBeVisible();
  });
});

test.describe("layouts", () => {
  test.setTimeout(90_000);

  test("Classic never starts the agent; switching layouts keeps the conversation and one event stream", async ({ page }) => {
    await setup(page); // stub-wired, so the model is never a real provider
    const calls: string[] = [];
    page.on("request", (r) => { if (/\/api\/playgrounds\/[^/]+\/agent(\/|$|\?)/.test(r.url())) calls.push(`${r.method()} ${new URL(r.url()).pathname.replace(wsId, ":id")}`); });
    await page.addInitScript(() => localStorage.setItem("rfy_layout", "classic"));
    await page.goto(`${base}/lab/${wsId}`);
    await page.locator(".dock").waitFor();
    await page.waitForTimeout(1500);
    expect(calls).toEqual([]); // Classic: no agent traffic at all

    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await expect(input(page)).toBeEnabled({ timeout: 45_000 });
    await say(page, "stay with me");
    await expect(reply(page)).toContainText("Hello from the stub model", { timeout: 30_000 });
    await page.getByRole("button", { name: "Classic", exact: true }).click();
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await expect(page.locator(".msg.user")).toContainText("stay with me");
    await expect(reply(page)).toContainText("Hello from the stub model");
    expect(calls.filter((c) => c === "POST /api/playgrounds/:id/agent")).toHaveLength(1); // started once
    expect(calls.filter((c) => c.endsWith("/agent/api/event"))).toHaveLength(1); // one stream, never re-opened
  });
});
