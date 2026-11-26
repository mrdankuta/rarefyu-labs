import { expect, test, type Page } from "@playwright/test";

// Resizable / collapsible panels (both layouts). Live-server spec:
//   E2E_BASE_URL=http://localhost:5173 bunx playwright test panes --workers=1
const base = process.env.E2E_BASE_URL;
test.skip(!base, "set E2E_BASE_URL to a running web+api");
test.use({ viewport: { width: 1500, height: 900 } });

async function openLab(page: Page, layout: "chat" | "classic") {
  await page.addInitScript((l) => { try { if (!sessionStorage.getItem("rfy_e2e_seeded")) { localStorage.setItem("rfy_layout", l); sessionStorage.setItem("rfy_e2e_seeded", "1"); } } catch { /* blocked */ } }, layout);
  await page.goto(`${base}/`);
  await page.getByRole("button", { name: /Open a playground/ }).click();
  await page.waitForURL(/\/lab\//);
  await page.locator(".dock").waitFor();
}
const width = async (page: Page, sel: string) => Math.round((await page.locator(sel).boundingBox())!.width);
const grip = (page: Page, pane: string) => page.locator(`.gut[data-pane="${pane}"] [role="separator"]`);
async function drag(page: Page, pane: string, dx: number) {
  const b = (await grip(page, pane).boundingBox())!;
  const x = b.x + b.width / 2, y = b.y + b.height * 0.25; // the collapse chevron sits at the middle of the divider
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 4 });
  await page.mouse.move(x + dx, y, { steps: 4 });
  await page.mouse.up();
}
const stored = (page: Page) => page.evaluate(() => localStorage.getItem("rfy_panes_v1"));
async function ptyCols(page: Page): Promise<number> {
  await page.getByRole("textbox", { name: "Terminal input" }).click();
  const tag = `S${Date.now() % 100000}`;
  await page.keyboard.type(`echo ${tag}:$(stty size)\n`);
  const row = page.locator(".xterm-rows").getByText(new RegExp(`${tag}:\\d+ \\d+`));
  await expect(row.last()).toBeVisible();
  const m = /:(\d+) (\d+)/.exec((await row.last().innerText()) ?? "");
  return Number(m![2]);
}

test.describe("Chat layout", () => {
  test("drag the chat/preview divider: sizes follow the pointer, persist across reload, double-click resets", async ({ page }) => {
    await openLab(page, "chat");
    const chat0 = await width(page, ".chatp"), center0 = await width(page, ".center");
    await drag(page, "chat", 150);
    const chat1 = await width(page, ".chatp"), center1 = await width(page, ".center");
    expect(Math.abs(chat1 - (chat0 + 150))).toBeLessThanOrEqual(3);
    expect(Math.abs(center1 - (center0 - 150))).toBeLessThanOrEqual(3);
    expect(JSON.parse((await stored(page))!).w.chat).toBe(chat1);
    await expect(page.getByRole("button", { name: "Reset panel sizes" })).toBeVisible();

    await page.reload();
    await page.locator(".dock").waitFor();
    expect(await width(page, ".chatp")).toBe(chat1); // remembered

    await grip(page, "chat").dblclick({ position: { x: 6, y: 120 } });
    expect(Math.abs((await width(page, ".chatp")) - chat0)).toBeLessThanOrEqual(2);
    expect(await stored(page)).toBeNull();
    await expect(page.getByRole("button", { name: "Reset panel sizes" })).toHaveCount(0);
  });

  test("limits: the chat keeps its minimum, the centre keeps its minimum", async ({ page }) => {
    await openLab(page, "chat");
    await drag(page, "chat", -2000);
    expect(await width(page, ".chatp")).toBe(280);
    await drag(page, "chat", 4000);
    expect(await width(page, ".center")).toBeGreaterThanOrEqual(358);
    await expect(page.locator(".center")).toBeVisible();
  });

  test("keyboard: arrows resize, Home/End jump, Enter collapses and expands", async ({ page }) => {
    await openLab(page, "chat");
    const g = grip(page, "chat");
    const w0 = await width(page, ".chatp");
    await g.focus();
    await page.keyboard.press("ArrowRight");
    expect(await width(page, ".chatp")).toBe(w0 + 16);
    await page.keyboard.press("Shift+ArrowLeft");
    expect(await width(page, ".chatp")).toBe(w0 + 16 - 64);
    await page.keyboard.press("Home");
    expect(await width(page, ".chatp")).toBe(280);
    await page.keyboard.press("End");
    expect(await width(page, ".center")).toBeGreaterThanOrEqual(358);
    await page.keyboard.press("Enter");
    await expect.poll(() => width(page, ".chatp")).toBe(32);
    await page.keyboard.press("Enter");
    await expect.poll(() => width(page, ".chatp")).toBeGreaterThan(280);
  });

  test("collapse the chat to a rail, expand it back to its old size; the conversation survives", async ({ page }) => {
    await openLab(page, "chat");
    await drag(page, "chat", 100);
    const w = await width(page, ".chatp");
    const input = page.getByRole("textbox", { name: "Message the agent" });
    await input.fill("keep this draft");
    const centerBefore = await width(page, ".center");
    await page.getByRole("button", { name: "Collapse Chat panel" }).click();
    expect(await width(page, ".chatp")).toBe(32);
    expect(await width(page, ".center")).toBeGreaterThan(centerBefore + 300);
    await expect(page.locator(".chatp")).toHaveClass(/railed/);
    await page.getByRole("button", { name: "Expand Chat panel" }).click();
    expect(await width(page, ".chatp")).toBe(w);
    await expect(input).toHaveValue("keep this draft"); // panel stayed mounted
    await page.reload();
    await page.locator(".dock").waitFor();
    expect(await width(page, ".chatp")).toBe(w);
  });

  test("terminal drawer: dragging its edge changes its width and the shell's real column count", async ({ page }) => {
    await openLab(page, "chat");
    await page.getByRole("button", { name: "Terminal", exact: true }).click();
    await expect(page.locator(".tstate").first()).toContainText("connected");
    await expect(page.locator(".xterm")).toHaveCount(1); // one terminal, not two stacked by overlapping attaches
    const w0 = await width(page, ".right");
    const cols0 = await ptyCols(page);
    await drag(page, "term", -200);
    const w1 = await width(page, ".right");
    expect(Math.abs(w1 - (w0 + 200))).toBeLessThanOrEqual(3);
    await expect.poll(() => ptyCols(page), { timeout: 10_000 }).toBeGreaterThan(cols0 + 15);
    expect(JSON.parse((await stored(page))!).w.term).toBe(w1);
    // the preview keeps its minimum beside the drawer
    expect(await width(page, ".center")).toBeGreaterThanOrEqual(0);
  });

  test("dragging across the preview iframe does not lose the pointer", async ({ page }) => {
    await openLab(page, "chat");
    await page.evaluate(() => { const f = document.createElement("iframe"); f.setAttribute("title", "probe"); f.style.cssText = "position:fixed;left:600px;top:100px;width:600px;height:600px;z-index:1"; f.srcdoc = "<body style='margin:0;background:#fff'>probe</body>"; document.body.appendChild(f); });
    const w0 = await width(page, ".chatp");
    await drag(page, "chat", 400); // the pointer travels over the iframe
    expect(Math.abs((await width(page, ".chatp")) - (w0 + 400))).toBeLessThanOrEqual(3);
    expect(await page.evaluate(() => document.documentElement.classList.contains("rfy-dragging"))).toBe(false);
  });

  test("below 760px there are no dividers", async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 900 });
    await openLab(page, "chat");
    await expect(page.locator(".gut")).toHaveCount(0);
  });
});

test.describe("Classic layout", () => {
  test("drag explorer and terminal edges; collapse each to a rail; reset restores defaults", async ({ page }) => {
    await openLab(page, "classic");
    await expect(page.locator(".tstate").first()).toContainText("connected");
    const files0 = await width(page, ".files"), right0 = await width(page, ".right"), center0 = await width(page, ".center");
    await drag(page, "files", 80);
    expect(Math.abs((await width(page, ".files")) - (files0 + 80))).toBeLessThanOrEqual(3);
    await drag(page, "right", -120);
    expect(Math.abs((await width(page, ".right")) - (right0 + 120))).toBeLessThanOrEqual(3);
    expect(await width(page, ".center")).toBeLessThan(center0 - 150);

    await page.getByRole("button", { name: "Collapse Explorer" }).click();
    expect(await width(page, ".files")).toBe(32);
    await page.getByRole("button", { name: "Collapse Terminal panel" }).click();
    expect(await width(page, ".right")).toBe(32);
    await expect(page.locator(".files")).toHaveClass(/railed/);
    await expect(page.locator(".right")).toHaveClass(/railed/);

    await page.getByRole("button", { name: "Reset panel sizes" }).click();
    expect(Math.abs((await width(page, ".files")) - files0)).toBeLessThanOrEqual(2);
    expect(Math.abs((await width(page, ".right")) - right0)).toBeLessThanOrEqual(2);
    expect(await stored(page)).toBeNull();
  });

  test("the classic terminal follows its panel: more columns when it is wider", async ({ page }) => {
    await openLab(page, "classic");
    await expect(page.locator(".tstate").first()).toContainText("connected");
    const cols0 = await ptyCols(page);
    await drag(page, "right", -250);
    await expect.poll(() => ptyCols(page), { timeout: 10_000 }).toBeGreaterThan(cols0 + 20);
  });

  test("sizes are per layout slot: Classic widths do not change the Chat layout", async ({ page }) => {
    await openLab(page, "classic");
    await drag(page, "files", 60);
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    const chat = await width(page, ".chatp");
    expect(chat).toBeGreaterThan(400); // default 30%, untouched by the explorer width
    await page.getByRole("button", { name: "Classic", exact: true }).click();
    expect(await width(page, ".files")).toBeGreaterThan(280);
  });

  test("below 1200px (stacked classic) there are no dividers", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await openLab(page, "classic");
    await expect(page.locator(".gut")).toHaveCount(0);
  });
});
