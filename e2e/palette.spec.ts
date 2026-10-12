import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, newSession, send, threadRow, WT, type LaunchedApp } from "./helpers.ts";

let launched: LaunchedApp;
const modifier = process.platform === "darwin" ? "Meta" : "Control";

test.beforeEach(async () => {
  launched = await launchApp({ omo: "fake", pickDir: WT });
});

test.afterEach(async () => {
  await launched?.close();
});

test("Ctrl+K opens the palette with the search input focused", async () => {
  const { page } = launched;
  await page.keyboard.press(`${modifier}+k`);
  await expect(byTestId(page, TESTID.commandPalette)).toBeVisible();
  await expect(byTestId(page, TESTID.paletteInput)).toBeFocused();
});

test("searching a session title and pressing Enter opens that session", async () => {
  const { page } = launched;
  const target = await newSession(page);
  const title = "Palette session search target";
  await send(page, title);
  await expect(threadRow(page, target)).toHaveAttribute("data-title", title);
  const other = await newSession(page);
  await expect(byTestId(page, TESTID.composerInput)).toHaveAttribute("data-thread-id", other);

  await page.keyboard.press(`${modifier}+k`);
  await byTestId(page, TESTID.paletteInput).fill(title);
  const option = byTestId(page, TESTID.paletteEntry).filter({ hasText: title });
  await expect(option).toHaveAttribute("data-entry-id", `session:${target}`);
  await byTestId(page, TESTID.paletteInput).press("Enter");
  await expect(byTestId(page, TESTID.commandPalette)).toBeHidden();
  await expect(byTestId(page, TESTID.composerInput)).toHaveAttribute("data-thread-id", target);
});

test("Escape closes the palette and restores the invoking control's focus", async () => {
  const { page } = launched;
  const search = byTestId(page, TESTID.sidebarSearch);
  await search.focus();
  await page.keyboard.press(`${modifier}+k`);
  await expect(byTestId(page, TESTID.paletteInput)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(byTestId(page, TESTID.commandPalette)).toBeHidden();
  await expect(search).toBeFocused();
});

test("the palette Settings command opens settings and yields its modal layer", async () => {
  const { page } = launched;
  await page.keyboard.press(`${modifier}+k`);
  await byTestId(page, TESTID.paletteInput).fill("Settings");
  await expect(byTestId(page, TESTID.paletteEntry).first()).toHaveAttribute("data-entry-id", "settings");
  await byTestId(page, TESTID.paletteInput).press("Enter");
  await expect(byTestId(page, TESTID.commandPalette)).toBeHidden();
  await expect(byTestId(page, TESTID.settingsDialog)).toBeVisible();
  await page.keyboard.press(`${modifier}+k`);
  await expect(byTestId(page, TESTID.commandPalette)).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(byTestId(page, TESTID.settingsDialog)).toBeHidden();
});

test("Ctrl+Shift+P opens the palette and arrows change the active command", async () => {
  const { page } = launched;
  await page.keyboard.press(`${modifier}+Shift+p`);
  const options = byTestId(page, TESTID.paletteEntry);
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
});
