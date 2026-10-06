import { rmSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, lastTurn, launchApp, newSession, send, shot, tempDir, threadRow } from "./helpers.ts";

test("editing a sent message and regenerating an answer open branches and keep the original thread", async () => {
  const fakeHome = tempDir("fake-home");
  const pickDir = tempDir("workspace");
  const launched = await launchApp({ omo: "fake", fakeHome, pickDir });
  try {
    const { page, readFakeLog } = launched;
    await newSession(page);
    await send(page, "alpha question");
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
    await send(page, "beta question");
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
    const users = byTestId(page, TESTID.userMessage);
    await expect(users).toHaveCount(2);

    await users.nth(1).hover();
    await byTestId(page, TESTID.editMessage).nth(1).click();
    const input = byTestId(page, TESTID.editMessageInput);
    await expect(input).toHaveValue("beta question");
    await input.fill("gamma question");
    await shot(page, "edit-open");
    await byTestId(page, TESTID.editMessageSend).click();

    await expect(byTestId(page, TESTID.editMessageForm)).toBeHidden();
    await expect(users).toHaveText(["alpha question", "gamma question"]);
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
    await expect(byTestId(page, TESTID.sidebar)).toContainText("alpha question (edited)");
    const resumes = (await readFakeLog()).filter((entry) => entry.method === "thread/resume");
    expect(resumes).toHaveLength(1);
    await shot(page, "edit-branch");

    await byTestId(page, TESTID.regenerate).click();
    await expect(byTestId(page, TESTID.turn)).toHaveCount(2);
    await expect(users).toHaveText(["alpha question", "gamma question"]);
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
    await expect.poll(async () => (await readFakeLog()).filter((entry) => entry.method === "thread/resume").length).toBe(2);
    await expect(byTestId(page, TESTID.sidebar)).not.toContainText("(edited) (edited)");
    await shot(page, "regenerate-branch");

    const original = (await readFakeLog()).find((entry) => entry.method === "turn/start")?.params as { threadId: string };
    await threadRow(page, original.threadId).getByRole("button").first().click();
    await expect(users).toHaveText(["alpha question", "beta question"]);
  } finally {
    await launched.close();
    for (const dir of [fakeHome, pickDir]) rmSync(dir, { recursive: true, force: true });
  }
});
