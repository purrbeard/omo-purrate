import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, newSession, WT } from "./helpers.ts";

test("loaded extensions include commandless entries and refresh independently from skills", async () => {
  const entry = { name: "commandless-example", path: WT, sourceInfo: { source: "fixture", scope: "user" }, enabled: true };
  const launched = await launchApp({ omo: "fake", pickDir: WT, extraEnv: { FAKE_OMO_EXTENSIONS: JSON.stringify([entry, entry]) } });
  try {
    const { page } = launched;
    await newSession(page);
    await byTestId(page, TESTID.openSettings).click();
    await page.locator('[data-section="skills"]').click();
    const section = page.getByTestId("settings-extensions");
    const rows = section.getByTestId("settings-extension-row");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("commandless-example");
    await expect(rows).toContainText("fixture");
    await expect(rows).toContainText("user");
    await expect(rows).toContainText(WT);
    await launched.app.evaluate(({ ipcMain, BrowserWindow }) => {
      ipcMain.removeHandler("omo:request");
      ipcMain.handle("omo:request", async (_event, method: string) => {
        if (method !== "thread/extensions/list") throw new Error(`Unexpected refresh method ${method}`);
        await BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScript('document.documentElement.dataset.qaExtensionsRefreshed = "true"');
        return { ok: true, result: { extensions: [{ name: "refreshed-commandless", path: "/refreshed-extension.ts", source: "fixture", scope: "project", enabled: true }] } };
      });
    });
    await section.getByTestId("extensions-refresh").click();
    await expect(section).toHaveAttribute("aria-busy", "false");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("refreshed-commandless");
  } finally { await launched.close(); }
});
