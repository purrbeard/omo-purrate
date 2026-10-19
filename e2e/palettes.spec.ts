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
    for (const palette of ["noir", "omo", "classic", "mint", "ocean", "sbd"]) {
      await page.getByTestId(`settings-palette-${palette}`).click();
      await expect(page.locator("body")).toHaveAttribute("data-palette", palette);
      await expect(page.getByTestId(`settings-palette-${palette}`)).toHaveAttribute("aria-pressed", "true");
      const roles = await page.locator("body").evaluate((body) => {
        const style = getComputedStyle(body);
        return ["--primary", "--ring", "--dsw-focus-ring-color", "--dsw-alias-brand-primary", "--foreground"].map((name) => style.getPropertyValue(name).trim());
      });
      expect(roles[1]).not.toBe(roles[0]);
      expect(roles[2]).toBe(roles[1]);
      expect(roles[3]).toBe(roles[4]);
      colors.add(await page.locator("body").evaluate((body) => getComputedStyle(body).getPropertyValue("--dsw-alias-bg-base").trim()));
      await shot(page, `palette-${palette}-light`);
    }
    expect(colors.size).toBe(6);
    await shot(page, "palette-sbd-light");
    await byTestId(page, TESTID.settingsThemeDark).click();
    await expect(page.locator("body")).toHaveAttribute("data-ds-dark-theme", "");
    const darkColors = new Set<string>();
    for (const palette of ["noir", "omo", "classic", "mint", "ocean", "sbd"]) {
      await page.getByTestId(`settings-palette-${palette}`).click();
      await expect(page.locator("body")).toHaveAttribute("data-palette", palette);
      await expect(page.locator("body")).toHaveAttribute("data-ds-dark-theme", "");
      darkColors.add(await page.locator("body").evaluate((body) => getComputedStyle(body).getPropertyValue("--dsw-alias-bg-base").trim()));
      await shot(page, `palette-${palette}-dark`);
    }
    expect(darkColors.size).toBe(6);
    await page.getByTestId("settings-palette-noir").click();
    const noirRoles = await page.locator("body").evaluate((body) => {
      const style = getComputedStyle(body);
      return { ring: style.getPropertyValue("--ring").trim(), primary: style.getPropertyValue("--primary").trim(), destructive: style.getPropertyValue("--destructive").trim() };
    });
    expect(noirRoles.ring).not.toBe(noirRoles.primary);
    expect(noirRoles.primary).not.toBe(noirRoles.destructive);
    await page.getByTestId("settings-palette-sbd").click();
    await expect(page.locator("body")).toHaveAttribute("data-palette", "sbd");
    await shot(page, "palette-sbd-dark");
    await page.getByRole("button", { name: "Back to app", exact: true }).click();
    await newSession(page);
    await shot(page, "palette-sbd-conversation-dark");
    expect(await page.evaluate(() => window.omo.getPreferences())).toMatchObject({ palette: "sbd", theme: "dark" });
    await launched.close();
    launched = await launchApp({ omo: "fake", userData, size: { width: 560, height: 820 } });
    page = launched.page;
    await expect(page.locator("body")).toHaveAttribute("data-palette", "sbd");
    await expect(page.locator("body")).toHaveAttribute("data-ds-dark-theme", "");
    await byTestId(page, TESTID.headerSidebarToggle).click();
    await byTestId(page, TESTID.openSettings).click();
    await page.getByTestId("settings-nav-toggle").click();
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(page.getByTestId("settings-palette-sbd")).toHaveAttribute("aria-pressed", "true");
    await shot(page, "palette-sbd-narrow");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await byTestId(page, TESTID.settingsThemeLight).click();
    await expect(page.locator("body")).not.toHaveAttribute("data-ds-dark-theme", "");
    await shot(page, "palette-sbd-narrow-light");
    await page.getByTestId("appearance-reset").click();
    await expect(page.locator("body")).toHaveAttribute("data-palette", "noir");
    await expect(byTestId(page, TESTID.settingsThemeSystem)).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => window.omo.getPreferences())).toMatchObject({ palette: "noir", theme: "system", locale: "system" });
  } finally {
    await launched.close();
  }
});
