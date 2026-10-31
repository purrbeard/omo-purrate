import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, newSession, tempDir, WT, type LaunchedApp } from "./helpers.ts";

let launched: LaunchedApp;
const modifier = process.platform === "darwin" ? "Meta" : "Control";

test.beforeEach(async () => {
  launched = await launchApp({ omo: "fake", pickDir: WT });
});

test.afterEach(async () => {
  await launched?.close();
});

test("Ctrl+1 and Ctrl+2 open the first and second visible sessions", async () => {
  const { page } = launched;
  await newSession(page);
  await newSession(page);
  const rows = page.locator(`[data-testid="${TESTID.sidebar}"] [data-testid="${TESTID.threadRow}"]`);
  await expect(rows).toHaveCount(2);
  const first = await rows.nth(0).getAttribute("data-thread-id");
  const second = await rows.nth(1).getAttribute("data-thread-id");
  await byTestId(page, TESTID.sidebarSearch).focus();
  await page.keyboard.press(`${modifier}+2`);
  await expect(byTestId(page, TESTID.composerInput)).toHaveAttribute("data-thread-id", second ?? "");
  await page.keyboard.press(`${modifier}+1`);
  await expect(byTestId(page, TESTID.composerInput)).toHaveAttribute("data-thread-id", first ?? "");
});

test("Help > Keyboard Shortcuts opens the keybindings settings page", async () => {
  const { app, page } = launched;
  await app.evaluate(({ Menu }) => {
    const item = (Menu.getApplicationMenu()?.items ?? []).flatMap(menu => menu.submenu?.items ?? []).find(entry => entry.label === "Keyboard Shortcuts");
    if (item === undefined) throw new Error("Keyboard Shortcuts menu item missing");
    item.click();
  });
  await expect(byTestId(page, TESTID.settingsDialog)).toHaveAttribute("data-active-section", "keybindings");
});

test("palette shortcut rejects collisions, survives restart and resets without replacing native shortcuts", async () => {
  await launched.close();
  const userData = tempDir("shortcut-profile");
  launched = await launchApp({ omo: "fake", userData });
  let page = launched.page;
  const open = async (): Promise<void> => {
    await byTestId(page, TESTID.openSettings).click();
    await page.locator('[data-section="keybindings"]').click();
  };
  await open();
  const field = () => page.locator('[data-shortcut-input="command-palette"]');
  await field().fill("Ctrl+N");
  await expect(page.getByTestId("shortcuts-error")).toBeVisible();
  await expect(page.getByTestId("shortcuts-save")).toBeDisabled();
  await field().fill("Ctrl+Shift+J");
  await page.getByTestId("shortcuts-save").click();
  await expect(page.getByTestId("settings-keybindings")).toHaveAttribute("data-dirty", "false");
  const accelerator = await launched.app.evaluate(({ Menu }) => (Menu.getApplicationMenu()?.items ?? [])
    .flatMap(menu => menu.submenu?.items ?? []).find(item => item.label === "Command Palette")?.accelerator);
  expect(accelerator).toBe("CmdOrCtrl+Shift+J");
  await page.keyboard.press("Escape");
  await page.evaluate(isMac => window.dispatchEvent(new KeyboardEvent("keydown", {
    key: "J", ctrlKey: !isMac, metaKey: isMac, shiftKey: true, isComposing: true, bubbles: true,
  })), process.platform === "darwin");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press(`${modifier}+K`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press(`${modifier}+Shift+J`);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await launched.close();
  launched = await launchApp({ omo: "fake", userData });
  page = launched.page;
  await page.keyboard.press(`${modifier}+Shift+J`);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await open();
  await page.getByTestId("shortcuts-reset").click();
  await expect(page.getByTestId("settings-keybindings")).toHaveAttribute("data-dirty", "false");
  await page.keyboard.press("Escape");
  await page.keyboard.press(`${modifier}+Shift+J`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press(`${modifier}+K`);
  await expect(page.getByRole("dialog")).toHaveCount(1);
});

test("Settings > About opens the logs folder that holds main.log", async () => {
  const { app, page } = launched;
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { openedPaths?: string[] }).openedPaths = opened;
    shell.openPath = async (target: string) => { opened.push(target); return ""; };
  });
  await byTestId(page, TESTID.openSettings).click();
  await page.locator(`[data-testid="${TESTID.settingsNavItem}"][data-section="about"]`).click();
  await byTestId(page, TESTID.settingsOpenLogs).click();
  await expect.poll(() => app.evaluate(() => (globalThis as { openedPaths?: string[] }).openedPaths ?? [])).toHaveLength(1);
  const [opened] = await app.evaluate(() => (globalThis as { openedPaths?: string[] }).openedPaths ?? []);
  const logs = await app.evaluate(({ app }) => app.getPath("logs"));
  expect(opened).toBe(logs);
  expect(existsSync(`${logs}/main.log`)).toBe(true);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
