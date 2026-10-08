import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { launchApp, newSession, shot } from "./helpers.ts";

test("workspace panel previews real files and changes", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "omo-workspace-panel-"));
  execFileSync("git", ["init", workspace]);
  writeFileSync(path.join(workspace, "hello.ts"), "export const hello = 'workspace-ready';\n");
  const running = await launchApp({ omo: "fake", pickDir: workspace, size: { width: 640, height: 760 } });
  try {
    await newSession(running.page);
    await running.page.getByTestId("workspace-toggle").click();
    const panel = running.page.getByTestId("workspace-panel");
    await expect(panel).toHaveAttribute("data-placement", "overlay");
    await expect(panel.getByRole("button", { name: "Close files", exact: true })).toBeFocused();
    await panel.getByRole("button", { name: "hello.ts U", exact: true }).click();
    await expect(panel.locator('[data-read="true"]')).toContainText("workspace-ready");
    await panel.getByRole("button", { name: "Diff", exact: true }).click();
    await expect(panel.locator('[data-diff="true"]')).toContainText("+export const hello");
    writeFileSync(path.join(workspace, "hello.ts"), "export const hello = 'external-refresh';\n");
    await running.page.evaluate(() => window.dispatchEvent(new Event("omo:git-refresh")));
    await expect(panel.locator('[data-diff="true"]')).toContainText("external-refresh");
    await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 850));
    await expect(panel).toHaveAttribute("data-placement", "docked");
    await expect(panel.locator('[data-diff="true"]')).toContainText("+export const hello");
    writeFileSync(path.join(workspace, "hello.ts"), "export const hello = 'turn-completed-refresh';\n");
    await running.page.evaluate(async () => {
      const threadId = document.querySelector('[data-testid="composer-input"]')?.getAttribute("data-thread-id");
      if (!threadId) throw new Error("Active thread missing");
      let unsubscribe = (): void => {};
      const completed = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { unsubscribe(); reject(new Error("Turn completion missing")); }, 10000);
        unsubscribe = window.omo.onNotification((event) => {
          if (event.method === "turn/completed" && (event.params as { threadId?: string }).threadId === threadId) {
            clearTimeout(timeout); unsubscribe(); resolve();
          }
        });
      });
      await window.omo.request("turn/start", { threadId, input: [{ type: "text", text: "workspace refresh regression" }] });
      await completed;
    });
    await expect(panel.locator('[data-diff="true"]')).toContainText("turn-completed-refresh");
    await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(640, 850));
    await expect(panel).toHaveAttribute("data-placement", "overlay");
    await expect(panel.locator('[data-diff="true"]')).toContainText("+export const hello");
    await shot(running.page, "workspace-real-file-diff");
    const firstControl = panel.getByRole("button", { name: "Refresh files", exact: true });
    const lastControl = panel.getByRole("button", { name: "hello.ts U", exact: true });
    await lastControl.focus();
    await running.page.keyboard.press("Tab");
    await expect(firstControl).toBeFocused();
    await running.page.keyboard.press("Shift+Tab");
    await expect(lastControl).toBeFocused();
    await running.page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(running.page.getByTestId("workspace-toggle")).toBeFocused();
  } finally { await running.close(); }
});
