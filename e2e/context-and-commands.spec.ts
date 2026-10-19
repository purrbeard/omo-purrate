import { expect, test } from "@playwright/test";
import { mkdirSync, rmSync, watch, writeFileSync } from "node:fs";
import path from "node:path";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, lastTurn, launchApp, newSession, prompts, send, tempDir, WT } from "./helpers.ts";

test("context usage and native slash command menu", async () => {
  const launched = await launchApp({ omo: "fake", pickDir: WT });
  try {
    const { page } = launched;
    const threadId = await newSession(page);
    const gauge = page.getByTestId("context-gauge");
    await expect(gauge).toBeHidden();
    await send(page, "usage-turn");
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
    await expect(gauge).toBeVisible();
    await expect(gauge).toHaveAttribute("data-tokens", "25000");
    expect(Number(await gauge.getAttribute("data-tokens"))).toBeGreaterThan(0);
    await expect(gauge).toHaveAttribute("data-window", "128000");
    // omo's get_session_stats supplies the tooltip's session totals and cost.
    await expect(gauge).toHaveAttribute("data-total-tokens", "25000");
    await expect(gauge).toHaveAttribute("data-cost", "0.07");
    await expect(gauge).toHaveAttribute("aria-label", /Session total: 25,000 tokens · Session cost: \$0\.07/);

    const input = byTestId(page, TESTID.composerInput);
    const menu = byTestId(page, TESTID.skillMenu);
    await input.fill("/");
    const compact = menu.locator('[data-command="compact"]');
    await expect(compact).toBeVisible();
    await expect(menu.locator('[data-command="todo"]')).toContainText("Extension");
    await expect(menu.locator('[data-command="review"]')).toContainText("Prompt");
    const logPath = launched.dirs.fakeLog;
    if (logPath === null) throw new Error("fake log path is required");
    const compactReceived = new Promise<void>((resolve, reject) => {
      const watcher = watch(logPath, () => {
        if (!launched.readFakeLog().some(frame => frame["type"] === "compact")) return;
        clearTimeout(timeout);
        watcher.close();
        resolve();
      });
      const timeout = setTimeout(() => {
        watcher.close();
        reject(new Error("fake did not receive compact"));
      }, 30_000);
      watcher.once("error", error => { clearTimeout(timeout); watcher.close(); reject(error); });
    });
    await compact.click();
    await expect(input).toHaveValue("");
    await compactReceived;
    expect(launched.readFakeLog().filter(frame => frame["type"] === "compact"))
      .toEqual([expect.objectContaining({ threadId })]);
    await input.fill("/comp");
    await expect(menu.getByRole("option")).toHaveCount(1);
    await expect(compact).toBeVisible();
  } finally {
    await launched.close();
  }
});

test("Alt+Enter queues a follow-up for after the turn; queued messages can be edited and withdrawn", async () => {
  const pickDir = tempDir("queue-workspace");
  const launched = await launchApp({ omo: "fake", pickDir });
  try {
    const { page } = launched;
    await newSession(page);
    const input = byTestId(page, TESTID.composerInput);
    const items = byTestId(page, TESTID.queueItem);
    // The gate holds the run open until the queue has been changed, so nothing here depends on timing.
    const gate = path.join(pickDir, "release-run");
    await send(page, `SCENARIO:gate:${gate}`);
    await expect(byTestId(page, TESTID.workingIndicator)).toBeVisible();

    await input.fill("later one");
    await input.press("Alt+Enter");
    await expect(input).toHaveValue("");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText("later one");
    await input.fill("drop this");
    await input.press("Alt+Enter");
    await expect(items).toHaveCount(2);
    expect(launched.readFakeLog().filter(frame => frame["type"] === "follow_up")).toHaveLength(2);
    expect(launched.readFakeLog().some(frame => frame["type"] === "steer")).toBe(false);
    // A queued message is listed once and is not in the conversation until omo delivers it.
    await expect(page.getByText("later one")).toHaveCount(1);

    await items.nth(1).getByTestId(TESTID.queueWithdraw).click();
    await expect(items).toHaveCount(1);
    await items.first().getByTestId(TESTID.queueEdit).click();
    await byTestId(page, TESTID.queueEditInput).fill("edited later");
    await byTestId(page, TESTID.queueEditInput).press("Enter");
    await expect(items.first()).toContainText("edited later");
    expect(launched.readFakeLog().map(frame => frame["type"])).toEqual(expect.arrayContaining(["dequeue_message", "edit_queued_message"]));

    writeFileSync(gate, "");
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed", { timeout: 20_000 });
    await expect(items).toHaveCount(0);
    await expect(page.getByText("edited later")).toHaveCount(1);
    await expect(page.getByText("drop this")).toHaveCount(0);
  } finally {
    await launched.close();
    rmSync(pickDir, { recursive: true, force: true });
  }
});

test("Settings > Behavior 'Ctrl+Enter sends' makes Enter a new line and Ctrl+Enter send", async () => {
  const pickDir = tempDir("sendkey-workspace");
  const launched = await launchApp({ omo: "fake", pickDir });
  try {
    const { page } = launched;
    await newSession(page);
    await byTestId(page, TESTID.openSettings).click();
    const sendKey = byTestId(page, TESTID.settingsSendKey);
    await expect(sendKey).toBeVisible();
    await sendKey.getByRole("tab", { name: "Ctrl+Enter" }).click();
    await expect(sendKey.getByRole("tab", { name: "Ctrl+Enter" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(byTestId(page, TESTID.settingsDialog)).toBeHidden();

    const input = byTestId(page, TESTID.composerInput);
    await input.fill("line one");
    await input.press("Enter");
    await expect(input).toHaveValue("line one\n");
    expect(prompts(launched.readFakeLog())).toEqual([]);
    await input.pressSequentially("line two");
    await input.press("Control+Enter");
    await expect(input).toHaveValue("");
    await expect.poll(() => prompts(launched.readFakeLog()).map(entry => entry.message)).toEqual(["line one\nline two"]);
  } finally {
    await launched.close();
    rmSync(pickDir, { recursive: true, force: true });
  }
});

test("@ opens a workspace file menu; choosing a file removes the @query and adds a reference chip", async () => {
  const pickDir = tempDir("mention-workspace");
  mkdirSync(path.join(pickDir, "src"));
  mkdirSync(path.join(pickDir, "node_modules"));
  writeFileSync(path.join(pickDir, "alpha-notes.md"), "notes");
  writeFileSync(path.join(pickDir, "src", "beta.ts"), "export {};");
  writeFileSync(path.join(pickDir, "node_modules", "alpha-dep.js"), "x");
  const launched = await launchApp({ omo: "fake", pickDir });
  try {
    const { page } = launched;
    await newSession(page);
    const input = byTestId(page, TESTID.composerInput);
    const menu = byTestId(page, TESTID.mentionMenu);
    const options = byTestId(page, TESTID.mentionOption);

    await input.fill("see @alp");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toHaveAttribute("data-path", "alpha-notes.md");
    await input.press("Enter");
    await expect(menu).toBeHidden();
    await expect(input).toHaveValue("see ");
    const chips = page.getByTestId("context-chip");
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toHaveAttribute("title", new RegExp("alpha-notes\\.md$"));

    await input.fill("@");
    await expect(options).toHaveCount(2);
    await expect(options.first()).toHaveAttribute("data-path", "src/beta.ts");
    await input.press("ArrowDown");
    await input.press("Escape");
    await expect(menu).toBeHidden();
    await input.fill("mail me@example.com");
    await expect(menu).toBeHidden();
  } finally {
    await launched.close();
    rmSync(pickDir, { recursive: true, force: true });
  }
});
