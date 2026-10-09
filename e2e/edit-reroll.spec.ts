import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ENV } from "../shared/ipc.ts";
import { ATTACHMENT_HEADER } from "../src/ui/composer/attachments.ts";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, lastTurn, launchApp, newSession, send, setTheme, shot, tempDir, threadRow, type LaunchedApp } from "./helpers.ts";

interface SessionEntry {
  id: string;
  type: string;
  parentId?: string | null;
  customType?: string;
  message?: { role: string; content: { type: string; text?: string }[] };
}

async function completeTurn(page: Page, threadId: string, action: () => Promise<unknown>): Promise<void> {
  const signal = "native-branch-turn-completed";
  const completed = page.waitForEvent("console", { predicate: (message) => message.text() === signal, timeout: 30_000 });
  await page.evaluate(({ threadId, signal }) => {
    const unsubscribe = window.omo.onNotification((notification) => {
      const params = notification.params;
      if (notification.method === "turn/completed" && typeof params === "object" && params !== null
        && "threadId" in params && params.threadId === threadId) {
        unsubscribe();
        console.log(signal);
      }
    });
  }, { threadId, signal });
  await action();
  await completed;
  await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
}

test("edit and repeated regeneration preserve one native session, images, original answers, and selected branch after relaunch", async () => {
  const fakeHome = tempDir("fake-home");
  const pickDir = tempDir("workspace");
  const userData = tempDir("user-data");
  const image = path.join(pickDir, "question.png");
  writeFileSync(image, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=", "base64"));
  const options = { omo: "fake" as const, fakeHome, pickDir, userData, extraEnv: { [ENV.qaPickImages]: JSON.stringify([image]) } };
  let launched: LaunchedApp | null = await launchApp(options);
  try {
    const { page, readFakeLog } = launched;
    const threadId = await newSession(page);
    await completeTurn(page, threadId, () => send(page, "alpha question"));
    await byTestId(page, TESTID.attachmentPick).click();
    await expect(byTestId(page, TESTID.attachmentThumbnail)).toHaveCount(1);
    await completeTurn(page, threadId, () => send(page, "beta question"));
    const users = byTestId(page, TESTID.userMessage);
    await expect(users).toHaveText(["alpha question", "beta question"]);
    await expect(users.nth(1).locator("img")).toBeVisible();
    const sessionDir = path.join(fakeHome, "sessions");
    const sessionFiles = readdirSync(sessionDir).filter((name) => name.endsWith(".jsonl"));
    expect(sessionFiles).toHaveLength(1);
    const sessionFile = path.join(sessionDir, sessionFiles[0]!);
    const originalSource = readFileSync(sessionFile, "utf8");
    const entries = (): SessionEntry[] => readFileSync(sessionFile, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line) as SessionEntry);
    const originalAnswer = entries().findLast((entry) => entry.message?.role === "assistant")!;
    const originalUser = entries().findLast((entry) => entry.message?.role === "user")!;

    await users.nth(1).hover();
    await byTestId(page, TESTID.editMessage).nth(1).click();
    const input = byTestId(page, TESTID.editMessageInput);
    await expect(input).toHaveValue("beta question");
    await input.fill("gamma question");
    await shot(page, "edit-open");
    await completeTurn(page, threadId, () => byTestId(page, TESTID.editMessageSend).click());

    await expect(byTestId(page, TESTID.editMessageForm)).toBeHidden();
    await expect(users).toHaveText(["alpha question", "gamma question"]);
    await expect(users.nth(1).locator("img")).toBeVisible();
    await expect(byTestId(page, TESTID.threadRow)).toHaveCount(1);
    await expect(threadRow(page, threadId)).toHaveAttribute("aria-current", "page");
    await shot(page, "edit-branch");

    await byTestId(page, TESTID.modelPicker).click();
    await page.getByRole("tab", { name: "Specific model" }).click();
    await byTestId(page, TESTID.modelOption).filter({ hasText: "GPT-6 Astra" }).click();
    await expect(byTestId(page, TESTID.modelPicker)).toContainText("GPT-6 Astra");
    await byTestId(page, TESTID.reasoningPicker).click();
    await page.locator(`[data-testid="${TESTID.reasoningOption}"][data-effort="high"]`).click();
    await expect(byTestId(page, TESTID.reasoningPicker)).toHaveAttribute("data-effort", "high");
    // The first regenerate on the newly picked model is held back once with the cache warning.
    await byTestId(page, TESTID.regenerate).click();
    await expect(byTestId(page, TESTID.noticeToast)).toContainText("GPT-6 Astra");
    await expect(byTestId(page, TESTID.turn)).toHaveCount(2);
    for (let retry = 0; retry < 2; retry += 1) {
      await completeTurn(page, threadId, () => byTestId(page, TESTID.regenerate).click());
      await expect(byTestId(page, TESTID.turn)).toHaveCount(2);
      await expect(users).toHaveText(["alpha question", "gamma question"]);
      await expect(users.nth(1).locator("img")).toBeVisible();
      await expect(byTestId(page, TESTID.threadRow)).toHaveCount(1);
      await expect(threadRow(page, threadId)).toHaveAttribute("aria-current", "page");
      expect(readFakeLog().filter((entry) => entry.method === "turn/start").at(-1)?.params).toMatchObject({
        threadId, model: "gpt-6-astra", effort: "high",
        input: [{ type: "text", text: `gamma question\n\n${ATTACHMENT_HEADER}\n- ${image}`, text_elements: [] }],
      });
      await expect(byTestId(page, TESTID.modelPicker)).toContainText("GPT-6 Astra");
      await expect(byTestId(page, TESTID.reasoningPicker)).toHaveAttribute("data-effort", "high");
    }
    const log = readFakeLog();
    const starts = log.filter((entry) => entry.method === "turn/start");
    expect(starts).toHaveLength(5);
    expect(starts.every((entry) => (entry.params as { threadId: string }).threadId === threadId)).toBe(true);
    expect(log.filter((entry) => entry.method === "thread/start")).toHaveLength(1);
    expect(log.filter((entry) => entry.type === "navigate_tree")).toHaveLength(3);
    expect(log.filter((entry) => entry.type === "extension_request" && entry.name === "omoui.tree.persist")).toHaveLength(3);
    expect(readdirSync(sessionDir).filter((name) => name.endsWith(".jsonl"))).toEqual(sessionFiles);
    expect(readFileSync(sessionFile, "utf8").startsWith(originalSource)).toBe(true);
    expect(entries()).toContainEqual(originalUser);
    expect(entries()).toContainEqual(originalAnswer);
    const branches = page.getByTestId("session-branches");
    await expect(branches.locator("option")).toHaveCount(4);
    await shot(page, "regenerate-branch");
    await setTheme(page, "dark");
    await shot(page, "regenerate-branch-dark");
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(640, 760));
    await expect(branches).toBeInViewport();
    await shot(page, "regenerate-branch-narrow-dark");
    await byTestId(page, TESTID.headerSidebarToggle).click();
    await byTestId(page, TESTID.openSettings).click();
    await page.getByTestId("settings-nav-toggle").click();
    await page.locator('[data-section="appearance"]').click();
    await byTestId(page, TESTID.settingsThemeLight).click();
    await expect(page.locator("body")).not.toHaveAttribute("data-ds-dark-theme");
    await page.keyboard.press("Escape");
    await expect(branches).toBeInViewport();
    await shot(page, "regenerate-branch-narrow-light");

    await branches.selectOption(originalAnswer.id);
    await expect(branches).toBeEnabled();
    await expect(branches).toHaveValue(originalAnswer.id);
    await expect(users).toHaveText(["alpha question", "beta question"]);
    await expect(lastTurn(page)).toContainText("echo: beta question");
    await expect(users.nth(1).locator("img")).toBeVisible();
    const selected = entries().at(-1)!;
    expect(selected).toMatchObject({ type: "custom", customType: "omoui.tree.selection", parentId: originalAnswer.id });
    expect(readFakeLog().filter((entry) => entry.method === "turn/start")).toHaveLength(5);

    await launched.close();
    launched = null;
    launched = await launchApp(options);
    await threadRow(launched.page, threadId).getByRole("button").first().click();
    await expect(byTestId(launched.page, TESTID.userMessage)).toHaveText(["alpha question", "beta question"]);
    await expect(lastTurn(launched.page)).toContainText("echo: beta question");
    await expect(byTestId(launched.page, TESTID.userMessage).nth(1).locator("img")).toBeVisible();
    await expect(launched.page.getByTestId("session-branches")).toHaveValue(originalAnswer.id);
    await expect(byTestId(launched.page, TESTID.threadRow)).toHaveCount(1);
    expect(readdirSync(sessionDir).filter((name) => name.endsWith(".jsonl"))).toEqual(sessionFiles);
    expect(entries().at(-1)).toEqual(selected);
    expect(launched.readFakeLog().filter((entry) => entry.method === "turn/start")).toHaveLength(5);
  } finally {
    await launched?.close();
    for (const dir of [fakeHome, pickDir, userData]) rmSync(dir, { recursive: true, force: true });
  }
});
