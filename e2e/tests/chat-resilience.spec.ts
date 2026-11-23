import { existsSync, rmSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { startStub } from "../stub-model/stub";

// Chat resilience (#55) against a STUB model. Needs web + API (DRIVER=local, OPENCODE_BIN=2.4.1) and the API
// started with E2E_TEST_HOOKS=1 (adds POST /api/playgrounds/:id/agent/_test/kill, which crashes the agent server):
//   E2E_BASE_URL=http://localhost:5473 bunx playwright test chat-resilience
const base = process.env.E2E_BASE_URL;
test.skip(!base, "set E2E_BASE_URL to a running web+api");
test.describe.configure({ mode: "serial" });

let stub: Awaited<ReturnType<typeof startStub>>;
test.beforeAll(async () => { stub = await startStub(0); });
test.afterAll(async () => { await stub?.stop(); });

let wsId = "";
/** New workspace wired to the stub model. `permission` goes into the project's opencode.json (a student's own config). */
async function setup(page: Page, permission?: Record<string, string>) {
  const res = await page.request.post(`${base}/api/playgrounds`, { data: {} });
  expect(res.status()).toBe(201);
  wsId = (await res.json()).id;
  const cfg: any = { $schema: "https://opencode.ai/config.json", provider: { stub: { npm: "@ai-sdk/openai-compatible", name: "Stub", options: { baseURL: stub.url, apiKey: "dummy-key" }, models: { "stub-1": { name: "Stub 1", tools: true } } } }, model: "stub/stub-1" };
  if (permission) cfg.permission = permission;
  const put = await page.request.put(`${base}/api/playgrounds/${wsId}/files/content`, { data: { path: "opencode.json", content: JSON.stringify(cfg) } });
  expect(put.ok()).toBe(true);
}
async function openChat(page: Page, permission?: Record<string, string>) {
  await setup(page, permission);
  await page.goto(`${base}/lab/${wsId}`);
  await expect(input(page)).toBeEnabled({ timeout: 45_000 });
}
test.afterEach(async ({ page }) => {
  if (wsId) await page.request.delete(`${base}/api/playgrounds/${wsId}`).catch(() => {});
  wsId = "";
});

const chatp = (p: Page) => p.getByRole("region", { name: "agent chat" });
const input = (p: Page) => p.getByRole("textbox", { name: "Message the agent" });
async function say(p: Page, text: string) { await input(p).fill(text); await input(p).press("Enter"); }
const reply = (p: Page) => p.locator(".msg.assistant");
const status = (p: Page) => p.locator(".status");
const kill = (p: Page) => p.request.post(`${base}/api/playgrounds/${wsId}/agent/_test/kill`);

/** A controllable flaky network for the event stream only: drop() errors the open stream; down=true refuses new ones. */
async function flakyStream(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__sse = { down: false, opens: 0, drop: () => {} };
    const orig = w.fetch.bind(w);
    w.fetch = async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (!url.includes("/agent/api/event")) return orig(input, init);
      if (w.__sse.down) throw new TypeError("Failed to fetch");
      const res = await orig(input, init);
      w.__sse.opens++;
      const reader = res.body.getReader();
      let ctl: ReadableStreamDefaultController;
      const stream = new ReadableStream({
        start(c) {
          ctl = c;
          (async () => { try { for (;;) { const { done, value } = await reader.read(); if (done) { c.close(); return; } c.enqueue(value); } } catch { /* cancelled */ } })();
        },
        cancel() { reader.cancel().catch(() => {}); },
      });
      w.__sse.drop = () => { try { ctl.error(new TypeError("network error")); } catch { /* closed */ } reader.cancel().catch(() => {}); };
      return new Response(stream, { status: res.status, headers: res.headers });
    };
  });
}

test.describe("streaming resume", () => {
  test.setTimeout(120_000);

  test("event stream drops mid-turn: quiet 'Reconnecting…', then the reply completes exactly once", async ({ page }) => {
    await flakyStream(page);
    await openChat(page);
    await say(page, "go slowly [[slow]]");
    await expect(reply(page)).toContainText("word3", { timeout: 30_000 });
    const opens = await page.evaluate(() => (window as any).__sse.opens);

    // the network goes away for a few seconds, the turn keeps running server-side
    await page.evaluate(() => { (window as any).__sse.down = true; (window as any).__sse.drop(); });
    await expect(status(page)).toContainText("Reconnecting…", { timeout: 10_000 });
    await expect(page.locator(".note.cerror")).toHaveCount(0); // quiet: a status, not an error
    await expect(page.locator("body")).not.toContainText("Failed to fetch");
    await page.waitForTimeout(3000);
    await page.evaluate(() => { (window as any).__sse.down = false; });

    // back: the whole reply is there, in order, once; one user bubble, one assistant message
    const expected = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    await expect(reply(page)).toContainText("word59", { timeout: 40_000 });
    await expect(page.locator(".status")).toHaveCount(0, { timeout: 15_000 }); // idle again: no status line
    expect((await reply(page).innerText()).replace(/\s+/g, " ").trim()).toBe(expected);
    await expect(page.locator(".msg.user")).toHaveCount(1);
    await expect(reply(page)).toHaveCount(1);
    expect(await page.evaluate(() => (window as any).__sse.opens)).toBeGreaterThan(opens); // it really reconnected

    // and the conversation still works
    await say(page, "hello again");
    await expect(reply(page).last()).toContainText("Hello from the stub model", { timeout: 30_000 });
    await expect(page.locator(".msg.user")).toHaveCount(2);
  });

  test("a drop that heals at once stays invisible and loses nothing", async ({ page }) => {
    await flakyStream(page);
    await openChat(page);
    await say(page, "go slowly [[slow]]");
    await expect(reply(page)).toContainText("word2", { timeout: 30_000 });
    await page.evaluate(() => (window as any).__sse.drop()); // reconnects on its own, immediately
    await expect(reply(page)).toContainText("word59", { timeout: 40_000 });
    const expected = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    expect((await reply(page).innerText()).replace(/\s+/g, " ").trim()).toBe(expected);
    await expect(page.locator(".msg.user")).toHaveCount(1);
  });
});

test.describe("agent server crash", () => {
  test.setTimeout(150_000);

  test("killed agent: 'restarting…', restarts on its own, history is back, chat works", async ({ page }) => {
    await openChat(page);
    await say(page, "remember me");
    await expect(reply(page)).toContainText("Hello from the stub model", { timeout: 30_000 });
    const before = await page.locator(".msg").count();

    expect((await kill(page)).ok()).toBe(true);
    await expect(status(page)).toContainText(/Agent stopped, restarting…|Reconnecting…/, { timeout: 30_000 });
    // back without anyone clicking anything
    await expect(input(page)).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator(".status")).toHaveCount(0, { timeout: 30_000 });
    // history survived the restart (OpenCode keeps sessions under $HOME)
    await expect(page.locator(".msg.user")).toContainText("remember me");
    await expect(reply(page)).toContainText("Hello from the stub model");
    expect(await page.locator(".msg").count()).toBe(before);
    // and the new server answers in the same conversation
    await say(page, "second question");
    await expect(reply(page).last()).toContainText("Hello from the stub model", { timeout: 30_000 });
    await expect(page.locator(".msg.user")).toHaveCount(2);
    const body = stub.requests.at(-1)!.body.messages.map((m: any) => JSON.stringify(m.content)).join(" ");
    expect(body).toContain("remember me"); // the model sees the restored history
  });

  test("agent that stays down: 'Agent unavailable' + Restart works; Files, Code, Preview, Changes and Terminal keep working", async ({ page }) => {
    await openChat(page);
    await say(page, "before the crash");
    await expect(reply(page)).toContainText("Hello from the stub model", { timeout: 30_000 });

    // make restarting fail (as if the VPS were out of memory) and crash the server
    await page.route("**/api/playgrounds/*/agent", (r) => (r.request().method() === "POST" ? r.fulfill({ status: 503, json: { error: "x", state: "unhealthy" } }) : r.continue()));
    expect((await kill(page)).ok()).toBe(true);
    await expect(status(page)).toContainText("Agent unavailable", { timeout: 60_000 });
    const restart = status(page).getByRole("button", { name: "Restart" });
    await expect(restart).toBeVisible();
    await expect(input(page)).toBeDisabled();
    await expect(page.locator("body")).not.toContainText("503"); // never a raw error
    // the Chat layout stays usable: history is still readable, panel is laid out
    await expect(page.locator(".msg.user")).toContainText("before the crash");
    await expect(chatp(page).getByRole("button", { name: "New conversation" })).toBeVisible();

    // the rest of the lab works while the agent is down
    await page.getByRole("tab", { name: "Code" }).click();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.locator('.tr[data-path="opencode.json"]').click({ timeout: 15_000 });
    await expect(page.locator(".cm-content")).toContainText("provider", { timeout: 15_000 });
    await page.getByRole("button", { name: "close files" }).click();
    await page.getByRole("tab", { name: /Changes/ }).click();
    await expect(page.getByRole("tab", { name: /Changes/ })).toHaveClass(/\bon\b/);
    await page.getByRole("tab", { name: "Preview" }).click();
    await expect(page.getByRole("tab", { name: "Preview" })).toHaveClass(/\bon\b/);
    await page.getByRole("button", { name: "Terminal", exact: true }).click();
    await expect(page.locator(".tstate").first()).toContainText("connected", { timeout: 20_000 });
    await page.getByRole("textbox", { name: "Terminal input" }).click();
    await page.keyboard.type("echo STILL-HERE-$((40+2))\n");
    await expect(page.locator(".xterm-rows")).toContainText("STILL-HERE-42", { timeout: 15_000 });
    await page.getByRole("button", { name: "close terminal" }).click();
    await expect(status(page)).toContainText("Agent unavailable"); // chat status unchanged by all that

    // Restart: the API can start it again; the panel comes back with the history
    await page.unroute("**/api/playgrounds/*/agent");
    await restart.click();
    await expect(status(page)).toContainText("restarting", { timeout: 10_000 }).catch(() => {}); // may be quick
    await expect(input(page)).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator(".status")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator(".msg.user")).toContainText("before the crash");
    await expect(reply(page)).toContainText("Hello from the stub model");
    await say(page, "after the restart");
    await expect(reply(page).last()).toContainText("Hello from the stub model", { timeout: 30_000 });
    await expect(page.locator(".msg.user")).toHaveCount(2);
  });

  test("agent killed while a turn runs: the turn is explained, not left 'working'", async ({ page }) => {
    await openChat(page);
    await say(page, "long one [[slow]]");
    await expect(reply(page)).toContainText("word2", { timeout: 30_000 });
    expect((await kill(page)).ok()).toBe(true);
    await expect(input(page)).toBeEnabled({ timeout: 90_000 });
    await expect(page.locator(".status")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator(".note.notice")).toContainText("agent restarted");
    await expect(chatp(page).getByRole("button", { name: "Send", exact: true })).toBeVisible(); // not stuck on Stop
    await expect(page.locator(".msg.user")).toHaveCount(1);
  });
});

test.describe("permissions", () => {
  test.setTimeout(120_000);

  test("a path outside the workspace is refused, visibly, and the turn carries on", async ({ page }) => {
    rmSync("/tmp/rfy-outside-stub.txt", { force: true });
    await openChat(page); // no permission config in the project: the lab's own policy applies
    await say(page, "write it [[outside]]");
    const tool = page.locator('.tool[data-tool="write"]');
    await expect(tool).toHaveClass(/fail/, { timeout: 30_000 });
    await expect(page.locator(".collapsible, [data-collapsible]").first()).toContainText("Permission denied");
    await expect(reply(page).last()).toContainText("All done with the tool step.", { timeout: 30_000 });
    expect(existsSync("/tmp/rfy-outside-stub.txt")).toBe(false); // really not written
    await expect(page.locator(".status")).toHaveCount(0);
  });

  test("a prompt from the student's own config shows an Allow/Deny card; Allow runs it, the turn never stalls silently", async ({ page }) => {
    await openChat(page, { shell: "ask" });
    await say(page, "run it [[bash]]");
    const card = page.locator(".perm");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("wants to run a command");
    await expect(card).toContainText("echo stub-bash-ok");
    await expect(status(page)).toContainText("Waiting for your answer"); // a visible reason, not a silent stall
    await card.getByRole("button", { name: "Allow" }).click();
    await expect(card).toHaveCount(0);
    await expect(page.locator('.tool[data-tool="shell"]')).toContainText("stub-bash-ok", { timeout: 30_000 });
    await expect(reply(page).last()).toContainText("All done with the tool step.", { timeout: 30_000 });
  });

  test("Deny stops the step and the chat is usable again; the card also survives a reload", async ({ page }) => {
    await openChat(page, { shell: "ask" });
    await say(page, "run it [[bash]]");
    await expect(page.locator(".perm")).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.locator(".perm")).toBeVisible({ timeout: 45_000 }); // restored from GET .../permission
    await page.locator(".perm").getByRole("button", { name: "Deny" }).click();
    await expect(page.locator(".perm")).toHaveCount(0);
    await expect(page.locator('.tool[data-tool="shell"]')).toHaveClass(/fail/, { timeout: 30_000 });
    await expect(chatp(page).getByRole("button", { name: "Send", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".status")).toHaveCount(0, { timeout: 15_000 });
  });
});

test.describe("long output", () => {
  test.setTimeout(90_000);

  test("long command output collapses to the first lines; Show more / Show less; code blocks have Copy", async ({ page }) => {
    await openChat(page);
    await say(page, "count [[longout]]");
    const out = page.locator('[data-collapsible="closed"]');
    await expect(out).toBeVisible({ timeout: 30_000 });
    await expect(out).toContainText("1\n2\n3\n4");
    await expect(out).not.toContainText("120");
    await expect(out.getByRole("button")).toContainText("Show more (116 more lines)");
    await out.getByRole("button").click();
    await expect(page.locator('[data-collapsible="open"]')).toContainText("120");
    await page.locator('[data-collapsible="open"]').getByRole("button", { name: "Show less" }).click();
    await expect(page.locator('[data-collapsible="closed"]')).not.toContainText("120");
  });

  test("a failing command's long error text collapses too", async ({ page }) => {
    await openChat(page);
    await say(page, "break [[longerr]]");
    const out = page.locator('[data-collapsible="closed"]');
    await expect(out).toBeVisible({ timeout: 30_000 });
    await expect(out).toContainText("stub error line 1");
    await expect(out).not.toContainText("stub error line 80");
    await out.getByRole("button", { name: /Show more/ }).click();
    await expect(page.locator('[data-collapsible="open"]')).toContainText("stub error line 80");
  });

  test("code block in a reply has a working Copy button", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    await openChat(page);
    await say(page, "show code");
    const copy = reply(page).locator("pre button.copy");
    await expect(copy).toBeVisible({ timeout: 30_000 });
    await copy.click();
    await expect(copy).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("console.log('hi')");
  });
});
