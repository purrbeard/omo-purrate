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
    await running.page.getByTestId("checkout-folder").click();
    const panel = running.page.getByTestId("workspace-panel");
    await expect(panel).toHaveAttribute("data-placement", "overlay");
    await expect(running.page.getByTestId("right-dock-close")).toBeFocused();
    await expect(panel.getByTestId("workspace-file-lines")).toHaveText("+1 −0");
    await expect(panel.getByTestId("workspace-line-totals")).toHaveText("+1 −0");
    await panel.getByRole("button", { name: "hello.ts +1 −0 U", exact: true }).click();
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
    const firstControl = running.page.getByTestId("right-tab-files");
    const lastControl = panel.getByRole("button", { name: "hello.ts +1 −0 U", exact: true });
    await lastControl.focus();
    await running.page.keyboard.press("Tab");
    await expect(firstControl).toBeFocused();
    await running.page.keyboard.press("Shift+Tab");
    await expect(lastControl).toBeFocused();
    await running.page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(running.page.getByTestId("checkout-folder")).toBeFocused();
  } finally { await running.close(); }
});

test("folder chip opens in-app files and session history includes committed worktree files", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "omo-session-work-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", workspace, ...args]);
  git("init");
  git("config", "user.name", "Workspace test");
  git("config", "user.email", "workspace@example.test");
  git("config", "core.autocrlf", "false");
  writeFileSync(path.join(workspace, "base.txt"), "base\n");
  execFileSync("git", ["-C", workspace, "add", "."]);
  execFileSync("git", ["-C", workspace, "commit", "-m", "base"], {
    env: { ...process.env, GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z" },
  });
  const worktree = `${workspace}-child`;
  git("worktree", "add", "-b", "session-child", worktree);
  const running = await launchApp({ omo: "fake", pickDir: workspace, size: { width: 1280, height: 850 } });
  try {
    await newSession(running.page);
    await running.page.evaluate(() => {
      window.omo.openWorkspace = async () => { throw new Error("Unexpected external editor launch"); };
    });
    await running.page.getByTestId("checkout-folder").click();
    const panel = running.page.getByTestId("workspace-panel");
    await expect(panel).toBeVisible();
    writeFileSync(path.join(worktree, "landing.html"), "<main>Landing</main>\n<footer>Done</footer>\n");
    execFileSync("git", ["-C", worktree, "add", "."]);
    execFileSync("git", ["-C", worktree, "commit", "-m", "Add landing page"], {
      env: { ...process.env, GIT_AUTHOR_DATE: "2030-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2030-01-01T00:00:00Z" },
    });
    writeFileSync(path.join(worktree, "draft.txt"), "draft\n");
    await panel.getByRole("button", { name: "Session history", exact: true }).click();
    const group = panel.getByTestId("workspace-session-worktree").filter({ hasText: "session-child" });
    await expect(group).toContainText("landing.html");
    await expect(group).toContainText("draft.txt");
    await expect(group.getByTestId("workspace-session-lines")).toHaveText("+2 −0");
    await expect(panel.getByTestId("workspace-session-commit")).toHaveCount(1);
    const branchName = execFileSync("git", ["-C", workspace, "branch", "--show-current"], { encoding: "utf8" }).trim();
    await expect(group.getByTestId("workspace-session-target")).toHaveText(`→ ${branchName}`);
    await expect(group.getByTestId("workspace-session-merged")).toHaveAttribute("data-merged", "false");
    execFileSync("git", ["-C", workspace, "merge", "--no-ff", "session-child", "-m", "Merge landing"], {
      env: { ...process.env, GIT_AUTHOR_DATE: "2030-01-02T00:00:00Z", GIT_COMMITTER_DATE: "2030-01-02T00:00:00Z" },
    });
    await panel.getByRole("button", { name: "Refresh files" }).click();
    await expect(group.getByTestId("workspace-session-merged")).toHaveAttribute("data-merged", "true");
    const main = panel.getByTestId("workspace-session-worktree").filter({ hasText: "Merge landing" });
    await expect(main).toHaveCount(1);
    await expect(main.getByTestId("workspace-session-commit")).toHaveText(/Merge landing/);
    await shot(running.page, "workspace-session-history-desktop");
    await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(640, 850));
    await expect(panel).toHaveAttribute("data-placement", "overlay");
    await expect(group).toContainText("landing.html");
    await shot(running.page, "workspace-session-history-overlay");
  } finally { await running.close(); }
});
