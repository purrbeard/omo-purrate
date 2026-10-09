import path from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp, newSession, tempDir } from "./helpers.ts";

test("terminal runs commands in the session workspace", async () => {
  const workspace = tempDir("terminal");
  const running = await launchApp({ omo: "fake", pickDir: workspace, size: { width: 1280, height: 820 } });
  try {
    await newSession(running.page);
    await running.page.getByTestId("terminal-toggle").click();
    const panel = running.page.getByTestId("terminal-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-placement", "docked");
    const input = panel.getByTestId("terminal-input");
    await expect(input).toBeEnabled();
    await input.fill("echo terminal-e2e-ok");
    await input.press("Enter");
    await expect(panel.getByTestId("terminal-output")).toContainText("terminal-e2e-ok", { timeout: 20_000 });
    await input.fill("Get-Location");
    await input.press("Enter");
    await expect(panel.getByTestId("terminal-output")).toContainText(path.basename(workspace), { timeout: 20_000 });
    await panel.getByTestId("terminal-close").click();
    await expect(panel).toHaveCount(0);
  } finally { await running.close(); }
});

test("terminal shortcut opens the panel and Escape closes it", async () => {
  const running = await launchApp({ omo: "fake", pickDir: tempDir("terminal-shortcut"), size: { width: 1280, height: 820 } });
  try {
    await newSession(running.page);
    await running.page.keyboard.press("Control+Backquote");
    const panel = running.page.getByTestId("terminal-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("terminal-input")).toBeFocused();
    await running.page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  } finally { await running.close(); }
});
