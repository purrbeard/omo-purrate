import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, lastTurn, launchApp, newSession } from "./helpers.ts";

test("an extension select dialog is answered from the question card, with its notify, status and editor text shown", async () => {
  const pickDir = test.info().outputPath("workspace");
  mkdirSync(pickDir, { recursive: true });
  const launched = await launchApp({ omo: "fake", pickDir });
  try {
    const { page } = launched;
    await newSession(page);
    // send() waits for an empty composer, but the extension replaces the draft meanwhile, so submit by hand.
    const input = byTestId(page, TESTID.composerInput);
    await input.fill("SCENARIO:extension-ui");
    await input.press("Enter");
    const question = byTestId(page, TESTID.questionCard);
    await expect(question).toBeVisible();
    await expect(byTestId(page, TESTID.noticeToast)).toContainText("Extension says hello");
    await expect(byTestId(page, TESTID.extensionStatus)).toHaveText("demo status");
    await expect(input).toHaveValue("text from extension");
    await question.locator(`[data-testid="${TESTID.questionOption}"][data-label="Mint"]`).click();
    await byTestId(page, TESTID.questionSubmit).click();
    await expect(question).toBeHidden();
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
    await expect(lastTurn(page)).toContainText("Flavor: Mint");
  } finally {
    await launched.close();
  }
});
