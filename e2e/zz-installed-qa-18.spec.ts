import { _electron as electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skip(process.env["OMO_UI_INSTALLED_QA"] !== "1", "set OMO_UI_INSTALLED_QA=1");
test.setTimeout(10 * 60_000);

const EXE = "C:/Users/truek/AppData/Local/Programs/OmO UI Windows/OmO UI Windows.exe";
const OUT = process.env["OMO_UI_INSTALLED_QA_OUT"] ?? path.join(os.tmpdir(), "omo-ui-installed-qa-18");

test("installed 0.1.4-win.18 shows the new dock, side chat, attachments and worktree history", async () => {
  mkdirSync(OUT, { recursive: true });
  const userData = mkdtempSync(path.join(OUT, "userdata-"));
  const repo = mkdtempSync(path.join(OUT, "repo-"));
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { env: { ...process.env, GIT_AUTHOR_DATE: "2030-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2030-01-01T00:00:00Z" } });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "qa");
  git(repo, "config", "user.email", "qa@example.test");
  writeFileSync(path.join(repo, "base.txt"), "base\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "commit", "-q", "-m", "base"], { env: { ...process.env, GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z" } });
  const child = repo + "-feat";
  git(repo, "worktree", "add", "-q", "-b", "feat", child);
  writeFileSync(path.join(child, "feature.txt"), "feature\n");
  git(child, "add", ".");
  git(child, "commit", "-q", "-m", "feature work");
  writeFileSync(path.join(userData, "preferences.json"), JSON.stringify({ locale: "ko", onboardingCompleted: true }));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  for (const key of ["ELECTRON_RUN_AS_NODE", "OMO_UI_OMO_BIN", "FAKE_OMO_HOME", "FAKE_OMO_LOG"]) delete env[key];
  const document = path.join(OUT, "notes.pdf");
  writeFileSync(document, "%PDF-1.4\n");
  Object.assign(env, { OMO_UI_USER_DATA: userData, OMO_UI_QA_PICK_DIR: repo, OMO_UI_QA_PICK_ATTACHMENTS: JSON.stringify([document]), OMO_UI_OMO_AUTO_UPDATE: "0", OMO_UI_IPHONE_BRIDGE: "0" });
  const app = await electron.launch({ executablePath: EXE, args: [], env, timeout: 90_000 });
  try {
    const page = await app.firstWindow({ timeout: 90_000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900));
    await expect(page.locator("html")).toHaveAttribute("data-bridge-state", "connected", { timeout: 120_000 });
    expect(await app.evaluate(({ app: electronApp }) => electronApp.getVersion())).toBe("0.1.4-win.18");
    await page.getByTestId("new-session").click();
    const projectNew = page.getByTestId("project-new");
    if (await projectNew.count() > 0) await projectNew.click();
    await expect(page.locator('[data-testid="thread-row"][aria-current="page"]')).toBeVisible({ timeout: 60_000 });
    // Any file attaches as a file chip; nothing is sent, so no paid turn runs.
    await page.getByTestId("attachment-pick").click();
    await expect(page.getByTestId("context-chip")).toHaveText("notes.pdf");
    await page.screenshot({ path: path.join(OUT, "18-01-attach-any-file.png") });
    // Side chat: renamed, instructable.
    await page.keyboard.press("Control+E");
    const dock = page.getByTestId("right-dock");
    await expect(dock).toHaveAttribute("data-tab", "btw");
    await expect(dock).toContainText("사이드 채팅");
    await expect(dock).toContainText("작업을 지시");
    await page.screenshot({ path: path.join(OUT, "18-02-side-chat.png") });
    // Tabs: icons, reorder, move left.
    for (const id of ["agents", "btw", "terminal", "workflow", "files"]) await expect(page.getByTestId("right-tab-" + id).locator("svg")).toHaveCount(1);
    await page.getByTestId("right-tab-files").click();
    await page.getByTestId("right-tab-files").dragTo(page.getByTestId("right-tab-agents"));
    const order = () => page.locator('[data-testid^="right-tab-"]').evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-testid")!.replace("right-tab-", "")));
    await expect.poll(order).toEqual(["files", "agents", "btw", "terminal", "workflow"]);
    await page.getByTestId("right-dock-side").click();
    await expect(page.getByTestId("app-frame")).toHaveAttribute("data-panel-side", "left");
    // Worktree history with main / -> main / merged badges.
    const panel = page.getByTestId("workspace-panel");
    await panel.getByRole("button", { name: "세션 이력", exact: true }).click();
    const feat = panel.getByTestId("workspace-session-worktree").filter({ hasText: "feature work" });
    await expect(feat.getByTestId("workspace-session-target")).toHaveText("→ main");
    await expect(feat.getByTestId("workspace-session-merged")).toHaveAttribute("data-merged", "false");
    await page.screenshot({ path: path.join(OUT, "18-03-left-dock-worktree.png") });
    // Closing the left-docked panel keeps the conversation width.
    await page.getByTestId("right-dock-close").click();
    await expect(dock).toHaveCount(0);
    await expect.poll(() => page.getByTestId("composer").evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(600);
    await page.screenshot({ path: path.join(OUT, "18-04-left-dock-closed.png") });
    await page.getByTestId("context-chip").click();
    await expect(page.getByTestId("context-chip")).toHaveCount(0);
  } finally { await app.close(); }
});
