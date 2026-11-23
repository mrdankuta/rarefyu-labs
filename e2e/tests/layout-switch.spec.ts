import { expect, test, type Page } from "@playwright/test";

// Live-server spec. Run the API (DRIVER=local) + web, then:
//   E2E_BASE_URL=http://localhost:5173 bunx playwright test layout-switch
// Forced-Classic variant: start web with PUBLIC_DEFAULT_LAYOUT=classic and also set E2E_FORCED_CLASSIC=1.
const base = process.env.E2E_BASE_URL;
const forced = process.env.E2E_FORCED_CLASSIC === "1";
test.skip(!base, "set E2E_BASE_URL to a running web+api");

async function openLab(page: Page) {
  await page.goto(`${base}/`);
  await page.getByRole("button", { name: /Open a playground/ }).click();
  await page.waitForURL(/\/lab\//);
  await page.locator(".dock").waitFor();
}
const isChat = (page: Page) => page.locator(".dock").evaluate((e) => e.classList.contains("chat"));

test.describe("default layout", () => {
  test.skip(forced, "web is started with PUBLIC_DEFAULT_LAYOUT=classic");

  test("first visit is Chat; switch keeps terminal, unsaved edit and websocket; choice persists", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__wsNew = 0;
      const W = window.WebSocket;
      (window as any).WebSocket = function (...a: any[]) { (window as any).__wsNew++; return new (W as any)(...a); };
      (window as any).WebSocket.prototype = W.prototype;
    });
    await openLab(page);
    expect(await isChat(page)).toBe(true);
    await expect(page.getByRole("group", { name: "Layout" })).toBeVisible();

    // terminal output + an unsaved edit
    await page.getByRole("button", { name: "Terminal", exact: true }).click();
    await expect(page.locator(".tstate").first()).toContainText("connected");
    await page.getByRole("textbox", { name: "Terminal input" }).click();
    await page.keyboard.type("echo KEEP-$((20+22))\n");
    await expect(page.locator(".xterm-rows")).toContainText("KEEP-42");
    await page.getByRole("button", { name: "close terminal" }).click();
    const wsBefore = await page.evaluate(() => (window as any).__wsNew as number); // initial connect (+ dev HMR socket)

    const id = page.url().split("/").pop();
    await page.evaluate((id) => fetch(`/api/playgrounds/${id}/files/content`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "notes.txt", content: "hello\n" }) }), id);
    await page.getByRole("tab", { name: "Code" }).click();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.locator('.tr[data-path="notes.txt"]').click({ timeout: 15000 });
    await page.getByRole("button", { name: "close files" }).click();
    await page.locator(".auto input").uncheck();
    await page.locator(".cm-content").click();
    await page.keyboard.type("UNSAVED-EDIT");
    await expect(page.locator(".edt .d.dirty")).toHaveCount(1);

    await page.getByRole("button", { name: "Classic", exact: true }).click();
    expect(await isChat(page)).toBe(false);
    await expect(page.locator(".xterm-rows")).toContainText("KEEP-42");
    await expect(page.locator(".edt .d.dirty")).toHaveCount(1);
    await expect(page.locator(".cm-content")).toContainText("UNSAVED-EDIT");

    await page.getByRole("button", { name: "Chat", exact: true }).click();
    expect(await isChat(page)).toBe(true);
    await expect(page.locator(".edt .d.dirty")).toHaveCount(1);
    expect(await page.evaluate(() => (window as any).__wsNew)).toBe(wsBefore); // no terminal reconnect

    // persistence
    await page.getByRole("button", { name: "Classic", exact: true }).click();
    await page.reload();
    await page.locator(".dock").waitFor();
    expect(await isChat(page)).toBe(false);
  });
});

test.describe("forced classic", () => {
  test.skip(!forced, "needs web started with PUBLIC_DEFAULT_LAYOUT=classic and E2E_FORCED_CLASSIC=1");

  test("first visit is Classic, no toggle, stored Chat ignored", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("rfy_layout", "chat"));
    await openLab(page);
    expect(await isChat(page)).toBe(false);
    await expect(page.getByRole("group", { name: "Layout" })).toHaveCount(0);
  });
});
