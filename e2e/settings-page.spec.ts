import { expect, test, type Page } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, shot } from "./helpers.ts";

const SECTIONS: ReadonlyArray<{ section: string; label: string }> = [
  { section: "general", label: "General" },
  { section: "archived", label: "Archived sessions" },
  { section: "projects", label: "Projects" },
  { section: "appearance", label: "Appearance" },
  { section: "keybindings", label: "Keybindings" },
  { section: "model", label: "Model" },
  { section: "mcp", label: "MCP" },
  { section: "skills", label: "Skills" },
  { section: "accounts", label: "Providers" },
  { section: "android", label: "Android" },
  { section: "devices", label: "Devices & memory" },
  { section: "import", label: "Import" },
  { section: "omo", label: "Runtime" },
  { section: "about", label: "About" },
];

const sidebarFill = (page: Page): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--sidebar-background").trim());

/** True when the point over the app sidebar is covered by the Settings page. */
const coversAppSidebar = (page: Page): Promise<boolean> =>
  page.evaluate((testId) => {
    const hit = document.elementFromPoint(8, Math.round(window.innerHeight / 2));
    return hit !== null && hit.closest(`[data-testid="${testId}"]`) !== null;
  }, TESTID.settingsDialog);

test("opens as a full page, walks every section through the breadcrumb, searches and closes", async () => {
  const launched = await launchApp({ omo: "fake" });
  try {
    const { page } = launched;
    await byTestId(page, TESTID.openSettings).click();
    const dialog = byTestId(page, TESTID.settingsDialog);
    await expect(dialog).toBeVisible();
    await expect.poll(() => coversAppSidebar(page)).toBe(true);
    await expect(byTestId(page, TESTID.settingsBreadcrumb)).toHaveText("Settings/General");

    for (const entry of SECTIONS) {
      await dialog.locator(`[data-section="${entry.section}"]`).click();
      await expect(byTestId(page, TESTID.settingsBreadcrumb)).toHaveText(`Settings/${entry.label}`);
    }

    await expect(dialog.getByTestId(TESTID.settingsRestoreDefaults).locator("../..")).toHaveCSS("max-width", "720px");

    const navItems = dialog.locator(`[data-testid="${TESTID.settingsNavItem}"]`);
    await expect(navItems).toHaveCount(SECTIONS.length);
    await page.getByTestId("settings-search").fill("mcp");
    await expect(navItems).toHaveCount(1);
    await expect(navItems.first()).toHaveAttribute("data-section", "mcp");
    await page.getByTestId("settings-search").fill("");
    await expect(navItems).toHaveCount(SECTIONS.length);

    await byTestId(page, TESTID.settingsBreadcrumb).click();
    await page.keyboard.press("/");
    await expect(page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).resolves.toBe(
      "settings-search",
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(byTestId(page, TESTID.sidebar)).toBeVisible();

    await byTestId(page, TESTID.openSettings).click();
    await expect(dialog).toBeVisible();
    await byTestId(page, TESTID.settingsBack).click();
    await expect(dialog).toBeHidden();
  } finally {
    await launched.close();
  }
});

test("the sidebar account shortcut always opens Providers after other settings sections", async () => {
  const launched = await launchApp({ omo: "fake" });
  try {
    const { page } = launched;
    const dialog = byTestId(page, TESTID.settingsDialog);
    await byTestId(page, TESTID.openAccounts).click();
    await expect(byTestId(page, TESTID.settingsBreadcrumb)).toHaveText("Settings/Providers");
    await dialog.locator('[data-section="general"]').click();
    await byTestId(page, TESTID.settingsBack).click();
    await byTestId(page, TESTID.openAccounts).click();
    await expect(byTestId(page, TESTID.settingsBreadcrumb)).toHaveText("Settings/Providers");
    await dialog.locator('[data-section="about"]').click();
    await byTestId(page, TESTID.settingsBack).click();
    await byTestId(page, TESTID.openAccounts).click();
    await expect(byTestId(page, TESTID.settingsBreadcrumb)).toHaveText("Settings/Providers");
    await byTestId(page, TESTID.settingsBack).click();
  } finally {
    await launched.close();
  }
});

test("appearance changes the scheme and palette, and restore device defaults resets both", async () => {
  const launched = await launchApp({ omo: "fake" });
  try {
    const { page } = launched;
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await byTestId(page, TESTID.openSettings).click();
    const dialog = byTestId(page, TESTID.settingsDialog);
    await dialog.locator('[data-section="appearance"]').click();
    await expect(byTestId(page, TESTID.settingsBreadcrumb)).toHaveText("Settings/Appearance");
    await shot(page, "settings-appearance-light");

    await byTestId(page, TESTID.settingsThemeDark).click();
    await expect(page.locator("body")).toHaveAttribute("data-ds-dark-theme", "");
    await expect(byTestId(page, TESTID.settingsThemeDark)).toHaveAttribute("aria-pressed", "true");
    await shot(page, "settings-appearance-dark");

    const darkBefore = await sidebarFill(page);
    await dialog.getByTestId("settings-palette-classic").click();
    await expect(page.locator("body")).toHaveAttribute("data-palette", "classic");
    await expect.poll(() => sidebarFill(page)).not.toBe(darkBefore);
    await shot(page, "settings-appearance-classic-dark");
    expect(await page.evaluate(() => window.omo.getPreferences())).toMatchObject({
      theme: "dark",
      palette: "classic",
    });

    await byTestId(page, TESTID.settingsRestoreDefaults).click();
    await byTestId(page, TESTID.settingsRestoreConfirm).click();
    await expect(page.locator("body")).not.toHaveAttribute("data-palette", "classic");
    // The device default is the dark noir scheme.
    await expect(page.locator("body")).toHaveAttribute("data-ds-dark-theme", "");
    await expect(byTestId(page, TESTID.settingsThemeDark)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => sidebarFill(page)).toBe(darkBefore);
    expect(await page.evaluate(() => window.omo.getPreferences())).toMatchObject({
      theme: "dark",
      palette: "noir",
      modelId: null,
      lastWorkspace: null,
    });
  } finally {
    await launched.close();
  }
});

test("general and appearance fine controls persist and take effect", async () => {
  const launched = await launchApp({ omo: "fake", size: { width: 1440, height: 900 } });
  try {
    const { page, app } = launched;
    const html = page.locator("html");
    const prefs = () => page.evaluate(() => window.omo.getPreferences());
    const zoom = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor());
    await byTestId(page, TESTID.openSettings).click();
    const dialog = byTestId(page, TESTID.settingsDialog);
    await page.evaluate(() => window.omo.setPreferences({ theme: "dark", locale: "en" }));

    // General: composer and workflow rows write their preferences.
    await dialog.getByTestId(TESTID.settingsFollowUp).getByRole("tab", { name: "Queue" }).click();
    await dialog.getByTestId(TESTID.settingsKeywordEffects).click();
    await dialog.getByTestId(TESTID.settingsShowContextUsage).click();
    await dialog.getByTestId(TESTID.settingsOpenWorkflowOnRun).click();
    await expect.poll(prefs).toMatchObject({ followUpBehavior: "queue", keywordEffects: false, showContextUsage: false, openWorkflowOnRun: true });
    await page.getByTestId("settings-search").fill("workflow graph");
    await expect(dialog.locator('[data-section="general"]')).toBeVisible();
    await page.getByTestId("settings-search").fill("");
    await shot(page, "settings-general-fine-dark");

    // Appearance.
    await dialog.locator('[data-section="appearance"]').click();
    const border = () => dialog.locator("div.border-border").first().evaluate((node) => getComputedStyle(node).borderTopColor);
    const border100 = await border();
    const contrast = dialog.getByTestId(TESTID.settingsContrast);
    await contrast.focus();
    await page.keyboard.press("End");
    await expect(html).toHaveAttribute("data-contrast", "foreground");
    await expect.poll(prefs).toMatchObject({ contrast: 150 });
    const border150 = await border();
    expect(border150).not.toBe(border100);
    // More contrast moves the border toward the palette's foreground, whichever scheme is showing.
    const distanceToForeground = (color: string) => page.evaluate((color) => {
      const rgb = (css: string): number[] => {
        const context = document.createElement("canvas").getContext("2d");
        if (context === null) throw new Error("no 2d context");
        context.fillStyle = css;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      };
      const foreground = rgb(getComputedStyle(document.body).color);
      return rgb(color).reduce((sum, value, index) => sum + Math.abs(value - (foreground[index] ?? 0)), 0);
    }, color);
    expect(await distanceToForeground(border150)).toBeLessThan(await distanceToForeground(border100));

    await dialog.getByTestId(TESTID.settingsDiffColors).getByRole("tab", { name: "Blue & orange" }).click();
    await expect(html).toHaveAttribute("data-diff-colors", "blue-orange");
    await dialog.getByTestId(TESTID.settingsCompactSidebar).click();
    await expect(html).toHaveAttribute("data-compact-sidebar", "");
    await dialog.getByTestId(TESTID.settingsReduceMotion).click();
    await expect(html).toHaveAttribute("data-reduce-motion", "");
    await dialog.getByTestId(TESTID.settingsTerminalCursorBlink).click();
    // The code size starts at the theme size; Default off then a slider key press sets an explicit size.
    await dialog.getByTestId(`${TESTID.settingsCodeFontSize}-default`).click();
    await dialog.getByTestId(TESTID.settingsCodeFontSize).focus();
    await page.keyboard.press("End");
    await expect(html).toHaveAttribute("data-code-font", "");
    await expect.poll(() => html.evaluate((node) => node.style.getPropertyValue("--code-font-size"))).toBe("18px");
    // Range inputs move in steps of 5, so 120% is written through the bridge.
    await page.evaluate(() => window.omo.setPreferences({ uiScale: 120 }));
    await expect.poll(zoom).toBeCloseTo(1.2, 5);
    await expect.poll(prefs).toMatchObject({
      contrast: 150, diffColors: "blue-orange", compactSidebar: true, reduceMotion: true, terminalCursorBlink: false, codeFontSize: 18, uiScale: 120,
    });
    await shot(page, "settings-appearance-fine-dark");

    await byTestId(page, TESTID.settingsRestoreDefaults).click();
    await byTestId(page, TESTID.settingsRestoreConfirm).click();
    await expect(html).not.toHaveAttribute("data-contrast");
    await expect(html).not.toHaveAttribute("data-diff-colors", "blue-orange");
    await expect(html).not.toHaveAttribute("data-compact-sidebar", "");
    await expect(html).not.toHaveAttribute("data-reduce-motion", "");
    await expect(html).not.toHaveAttribute("data-code-font", "");
    await expect.poll(zoom).toBeCloseTo(1, 5);
    // Restore also returns the scheme to System (light), so compare with the mixed value rather than the dark one.
    await expect.poll(border).not.toBe(border150);
    expect(await prefs()).toMatchObject({
      followUpBehavior: "steer", keywordEffects: true, showContextUsage: true, openWorkflowOnRun: false, uiScale: 100, contrast: 100,
      promptFontSize: null, codeFontSize: null, terminalFontSize: null, terminalCursorBlink: true, diffColors: "red-green", compactSidebar: false, reduceMotion: false,
    });
  } finally {
    await launched.close();
  }
});

test("the default model picker writes the preference and restore resets it", async () => {
  const launched = await launchApp({ omo: "fake" });
  try {
    const { page } = launched;
    await byTestId(page, TESTID.openSettings).click();
    const dialog = byTestId(page, TESTID.settingsDialog);
    await dialog.locator('[data-section="model"]').click();
    await expect(page.locator(`[data-testid="${"settings-model"}"]`).first()).toBeVisible();
    await page.getByTestId("settings-model-default").selectOption("fake/beta");
    expect(await page.evaluate(() => window.omo.getPreferences())).toMatchObject({ modelId: "fake/beta" });

    await dialog.locator('[data-section="general"]').click();
    await shot(page, "settings-general-light");
    await byTestId(page, TESTID.settingsRestoreDefaults).click();
    await byTestId(page, TESTID.settingsRestoreConfirm).click();
    await expect.poll(() => page.evaluate(() => window.omo.getPreferences().then((prefs) => prefs.modelId))).toBeNull();
  } finally {
    await launched.close();
  }
});

test("narrow settings navigation traps focus in the drawer and Escape returns to content", async () => {
  const launched = await launchApp({ omo: "fake", size: { width: 640, height: 850 } });
  try {
    const { page } = launched;
    await byTestId(page, TESTID.headerSidebarToggle).click();
    await byTestId(page, TESTID.openSettings).click();
    const dialog = byTestId(page, TESTID.settingsDialog);
    const toggle = page.getByTestId("settings-nav-toggle");
    const notificationRow = page.getByTestId(TESTID.settingsThreadNotifications).locator("../..");
    expect(await notificationRow.locator(":scope > div").first().evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThanOrEqual(200);
    await toggle.click();
    const search = page.getByTestId("settings-search");
    await expect(search).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("settings-back")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(search).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(toggle).toBeFocused();
    await expect(dialog.locator("nav")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  } finally { await launched.close(); }
});
