import { expect, test } from "@playwright/test";
import { byTestId, launchApp, newSession, setTheme, shot, tempDir } from "./helpers.ts";
import { TESTID } from "../src/ui/testids.ts";

test("right dock tabs show which panel is open and the docked panel edge resizes it", async () => {
  const launched = await launchApp({ omo: "fake", pickDir: tempDir("right-dock-project"), size: { width: 1440, height: 900 } });
  const { page } = launched;
  try {
    await newSession(page);
    await page.getByTestId(TESTID.sideToggle).click();
    const dock = page.getByTestId("right-dock");
    await expect(dock).toHaveAttribute("data-tab", "btw");
    for (const id of ["agents", "btw", "terminal", "workflow", "files"]) {
      const tab = page.getByTestId(`right-tab-${id}`);
      await expect(tab.locator("svg")).toHaveCount(1);
      const clipped = await tab.evaluate((element) => { const strip = element.parentElement!.getBoundingClientRect(); const box = element.getBoundingClientRect(); return box.right > strip.right + 1 || box.left < strip.left - 1; });
      expect(clipped, id + " tab clipped in the narrow side chat dock").toBe(false);
    }
    await page.getByTestId("right-tab-files").click();
    await expect(dock).toHaveAttribute("data-tab", "files");
    const selected = page.getByTestId("right-tab-files");
    const other = page.getByTestId("right-tab-btw");
    const look = (locator: typeof selected) => locator.evaluate((element) => { const style = getComputedStyle(element); return [style.backgroundColor, style.boxShadow, style.borderColor].join("|"); });
    expect(await look(selected)).not.toBe(await look(other));
    const column = page.getByTestId(TESTID.appFrame);
    const width = async (): Promise<number> => Number((await column.evaluate((element) => getComputedStyle(element).gridTemplateColumns)).split(" ").at(-1)?.replace("px", ""));
    const before = await width();
    const handle = page.getByTestId("right-panel-resize");
    const box = await handle.boundingBox();
    if (box === null) throw new Error("resize handle has no box");
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 160, box.y + 200, { steps: 8 });
    await page.mouse.up();
    await expect.poll(width).toBeGreaterThan(before + 100);
    const widened = await width();
    await page.getByTestId("right-tab-terminal").click();
    await page.getByTestId("right-tab-files").click();
    await expect.poll(width).toBe(widened);
    const order = (): Promise<string[]> => page.locator('[data-testid^="right-tab-"]').evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-testid")!.replace("right-tab-", "")));
    expect(await order()).toEqual(["agents", "btw", "terminal", "workflow", "files"]);
    await page.getByTestId("right-tab-files").dragTo(page.getByTestId("right-tab-agents"));
    await expect.poll(order).toEqual(["files", "agents", "btw", "terminal", "workflow"]);
    const frame = page.getByTestId(TESTID.appFrame);
    const panelLeftOfConversation = (): Promise<boolean> => page.evaluate(() => {
      const panel = document.querySelector('[data-testid="right-dock"]')!.getBoundingClientRect();
      const conversation = document.querySelector('[data-testid="composer"]')!.getBoundingClientRect();
      return panel.right <= conversation.left;
    });
    expect(await panelLeftOfConversation()).toBe(false);
    await page.getByTestId("right-dock-side").click();
    await expect(frame).toHaveAttribute("data-panel-side", "left");
    await expect.poll(panelLeftOfConversation).toBe(true);
    await shot(page, "right-dock-left");
    const composerWidth = (): Promise<number> => page.getByTestId(TESTID.composer).evaluate((element) => element.getBoundingClientRect().width);
    await page.getByTestId("right-dock-close").click();
    await expect(page.getByTestId("right-dock")).toHaveCount(0);
    await expect.poll(composerWidth).toBeGreaterThan(400);
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(700, 900));
    await page.keyboard.press("Control+E");
    await expect(frame).toHaveAttribute("data-panel-side", "left");
    await expect(page.getByTestId("right-dock")).toBeVisible();
    await expect.poll(composerWidth).toBeGreaterThan(300);
    await page.getByTestId("right-dock-close").click();
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-bridge-state", "connected");
    await expect.poll(composerWidth).toBeGreaterThan(400);
    await page.keyboard.press("Control+E");
    await expect(frame).toHaveAttribute("data-panel-side", "left");
    await expect.poll(order).toEqual(["files", "agents", "btw", "terminal", "workflow"]);
    await page.getByTestId("right-dock-side").click();
    await expect(frame).toHaveAttribute("data-panel-side", "right");
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      await shot(page, `right-dock-tabs-${theme}`);
    }
    await expect(byTestId(page, TESTID.composerInput)).toBeVisible();
  } finally { await launched.close(); }
});
