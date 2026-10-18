import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, lastTurn, launchApp, newSession, send, shot, prompts } from "./helpers.ts";

test("an unanswered question remains after turn end and sends a follow-up answer", async () => {
  const pickDir = test.info().outputPath("workspace");
  mkdirSync(pickDir, { recursive: true });
  const launched = await launchApp({ omo: "fake", pickDir });
  try {
    const { page, readFakeLog } = launched;
    await newSession(page);
    await send(page, "SCENARIO:async-question");
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
    const question = byTestId(page, TESTID.questionCard);
    await expect(question).toBeVisible();
    await expect(question.getByRole("status").first()).toContainText("new message");
    await shot(page, "async-question-waiting");
    await question.locator(`[data-testid="${TESTID.questionOption}"][data-label="B"]`).click();
    await byTestId(page, TESTID.questionSubmit).click();
    await expect(question).toBeHidden();
    await expect(byTestId(page, TESTID.userMessage)).toHaveCount(2);
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
    const starts = prompts(await readFakeLog());
    expect(starts).toHaveLength(2);
    expect(starts[1]?.message).toBe("Pick A or B?\nB");
    expect(starts[1]?.threadId).toBe(starts[0]?.threadId);
    await shot(page, "async-question-answered");
  } finally {
    await launched.close();
  }
});
