import { describe, expect, test } from "bun:test";
import { LocalDriver } from "../src/drivers/local";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("terminal is a real pty (issue #21)", () => {
  test("job control available, no tty warnings, Ctrl-C interrupts foreground", async () => {
    const d = new LocalDriver();
    const id = `pty-${crypto.randomUUID()}`;
    await d.create(id);
    const t = await d.openTerminal(id, "t1");
    t.write("tty; sleep 30\n");
    await sleep(500);
    t.write("\x03"); // Ctrl-C -> SIGINT to foreground group
    await sleep(300);
    t.write("echo DONE_$((6*7))\n");
    await sleep(500);
    const out = t.scrollback();
    expect(out).not.toContain("cannot set terminal process group");
    expect(out).not.toContain("no job control");
    expect(out).toMatch(/\/dev\/(pts|tty)/);
    expect(out).toContain("DONE_42");
    t.kill();
  });

  test("resize changes the pty geometry the shell sees", async () => {
    const d = new LocalDriver();
    const id = `pty-${crypto.randomUUID()}`;
    await d.create(id);
    const t = await d.openTerminal(id, "t1");
    t.write("stty size\n");
    await sleep(400);
    expect(t.scrollback()).toContain("24 80");
    t.resize(132, 41);
    t.write("stty size\n");
    await sleep(400);
    expect(t.scrollback()).toContain("41 132");
    t.kill();
  });
});
