import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, newSession, tempDir, type LaunchedApp } from "./helpers.ts";

let launched: LaunchedApp;
const modifier = process.platform === "darwin" ? "Meta" : "Control";

test.beforeEach(async () => {
  launched = await launchApp({ omo: "fake", pickDir: tempDir("shortcuts-workspace") });
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
