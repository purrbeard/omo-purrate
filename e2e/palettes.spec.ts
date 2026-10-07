import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, newSession, shot, tempDir } from "./helpers.ts";

test("palettes apply globally, retain the color scheme, persist and reset", async () => {
  const userData = tempDir("palette-preferences");
  let launched = await launchApp({ omo: "fake", userData, pickDir: userData });
  try {
    let page = launched.page;
    await byTestId(page, TESTID.openSettings).click();
    const nav = page.getByRole("button", { name: "Show sidebar", exact: true });
    if (await nav.isVisible()) await nav.click();
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await byTestId(page, TESTID.settingsThemeLight).click();
    await expect(page.locator("body")).not.toHaveAttribute("data-ds-dark-theme", "");
    const colors = new Set<string>();
    for (const palette of ["omo", "classic", "mint", "ocean", "sbd"]) {
      await page.getByTestId(`settings-palette-${palette}`).click();
      await expect(page.locator("body")).toHaveAttribute("data-palette", palette);
      await expect(page.getByTestId(`settings-palette-${palette}`)).toHaveAttribute("aria-pressed", "true");
      colors.add(await page.locator("body").evaluate((body) => getComputedStyle(body).getPropertyValue("--dsw-alias-bg-base").trim()));
      await shot(page, `palette-${palette}-light`);
    }
    expect(colors.size).toBe(5);
    await shot(page, "palette-sbd-light");
    await byTestId(page, TESTID.settingsThemeDark).click();
    await expect(page.locator("body")).toHaveAttribute("data-ds-dark-theme", "");
    const darkColors = new Set<string>();
    for (const palette of ["omo", "classic", "mint", "ocean", "sbd"]) {
      await page.getByTestId(`settings-palette-${palette}`).click();
      await expect(page.locator("body")).toHaveAttribute("data-palette", palette);
      await expect(page.locator("body")).toHaveAttribute("data-ds-dark-theme", "");
      darkColors.add(await page.locator("body").evaluate((body) => getComputedStyle(body).getPropertyValue("--dsw-alias-bg-base").trim()));
      await shot(page, `palette-${palette}-dark`);
    }
    expect(darkColors.size).toBe(5);
    await expect(page.locator("body")).toHaveAttribute("data-palette", "sbd");
    await shot(page, "palette-sbd-dark");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await newSession(page);
    await shot(page, "palette-sbd-conversation-dark");
    expect(await page.evaluate(() => window.omo.getPreferences())).toMatchObject({ palette: "sbd", theme: "dark" });
    await launched.close();
    launched = await launchApp({ omo: "fake", userData, size: { width: 560, height: 820 } });
    page = launched.page;
    await expect(page.locator("body")).toHaveAttribute("data-palette", "sbd");
    await expect(page.locator("body")).toHaveAttribute("data-ds-dark-theme", "");
    await byTestId(page, TESTID.openSettings).click();
    await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(page.getByTestId("settings-palette-sbd")).toHaveAttribute("aria-pressed", "true");
    await shot(page, "palette-sbd-narrow");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await byTestId(page, TESTID.settingsThemeLight).click();
    await expect(page.locator("body")).not.toHaveAttribute("data-ds-dark-theme", "");
    await shot(page, "palette-sbd-narrow-light");
    await page.getByTestId("appearance-reset").click();
    await expect(page.locator("body")).toHaveAttribute("data-palette", "omo");
    await expect(byTestId(page, TESTID.settingsThemeSystem)).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => window.omo.getPreferences())).toMatchObject({ palette: "omo", theme: "system", locale: "system" });
  } finally {
    await launched.close();
  }
});
