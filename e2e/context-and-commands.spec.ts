import { expect, test } from "@playwright/test";
import { watch } from "node:fs";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, lastTurn, launchApp, newSession, send, WT } from "./helpers.ts";

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
        if (!launched.readFakeLog().some(frame => frame["method"] === "thread/compact/start")) return;
        clearTimeout(timeout);
        watcher.close();
        resolve();
      });
      const timeout = setTimeout(() => {
        watcher.close();
        reject(new Error("fake did not receive thread/compact/start"));
      }, 30_000);
      watcher.once("error", error => { clearTimeout(timeout); watcher.close(); reject(error); });
    });
    await compact.click();
    await expect(input).toHaveValue("");
    await compactReceived;
    expect(launched.readFakeLog().filter(frame => frame["method"] === "thread/compact/start"))
      .toEqual([expect.objectContaining({ params: { threadId } })]);
    await input.fill("/comp");
    await expect(menu.getByRole("option")).toHaveCount(1);
    await expect(compact).toBeVisible();
  } finally {
    await launched.close();
  }
});
