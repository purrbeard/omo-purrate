import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import {
  byTestId,
  launchApp,
  newSession,
  send,
  setTheme,
  shot,
  tempDir,
} from "./helpers.ts";

test("profile drag resolves the turn; specific model search and persistence still work", async () => {
  const pickDir = tempDir("profile-workspace");
  const userData = tempDir("profile-preferences");
  let launched = await launchApp({ omo: "fake", pickDir, userData });
  try {
    let page = launched.page;
    await newSession(page);
    await setTheme(page, "light");
    await byTestId(page, TESTID.modelPicker).click();
    await expect(byTestId(page, TESTID.profileTab)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const led = byTestId(page, TESTID.profileLed);
    await expect(led).toHaveAttribute("data-settled", "true");
    await shot(page, "G013-profile-light");
    await page.keyboard.press("Escape");
    await setTheme(page, "dark");
    await byTestId(page, TESTID.modelPicker).click();
    await expect(led).toHaveAttribute("data-settled", "true");
    await shot(page, "G013-profile-dark");
    const pad = await byTestId(page, TESTID.profilePad).boundingBox();
    const dot = await byTestId(page, TESTID.profileDot).boundingBox();
    if (!pad || !dot) throw new Error("profile pad is missing");
    await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
    await page.mouse.down();
    await page.mouse.move(pad.x + pad.width * 0.75, pad.y + pad.height * 0.25, {
      steps: 8,
    });
    await expect(byTestId(page, TESTID.profilePreview)).toHaveAttribute(
      "data-profile",
      "geeky-heavy",
    );
    await expect(led).toHaveAttribute("data-model", "GPT-6 Astra");
    await expect(led).toHaveAttribute("data-effort", "XHIGH");
    await page.mouse.up();
    await expect(byTestId(page, TESTID.modelPicker)).toContainText(
      "Geeky · Heavy",
    );
    await expect(led).toHaveAttribute("data-settled", "true");
    await shot(page, "G013-geeky-heavy-dark");
    await page.keyboard.press("Escape");
    await send(page, "SCENARIO:echo profile route");
    await expect(byTestId(page, TESTID.turn).last()).toHaveAttribute(
      "data-status",
      "completed",
    );
    expect(launched.readFakeLog()).toContainEqual(
      expect.objectContaining({
        method: "turn/start",
        params: expect.objectContaining({
          model: "gpt-6-astra",
          effort: "xhigh",
        }),
      }),
    );
    const persisted = JSON.parse(
      readFileSync(path.join(userData, "preferences.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(persisted["modelProfile"]).toBe("geeky-heavy");
    await launched.close();
    launched = await launchApp({ omo: "fake", pickDir, userData });
    page = launched.page;
    await expect(byTestId(page, TESTID.modelPicker)).toContainText(
      "Geeky · Heavy",
    );
    await byTestId(page, TESTID.modelPicker).click();
    await expect(byTestId(page, TESTID.profileLed)).toHaveAttribute(
      "data-model",
      "GPT-6 Astra",
    );
    await expect(byTestId(page, TESTID.profileLed)).toHaveAttribute(
      "data-effort",
      "XHIGH",
    );
    await page.keyboard.press("Escape");
    await setTheme(page, "light");
    await byTestId(page, TESTID.modelPicker).click();
    await expect(byTestId(page, TESTID.profileLed)).toHaveAttribute(
      "data-settled",
      "true",
    );
    await shot(page, "G013-geeky-heavy-light");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const handle = byTestId(page, TESTID.profileDot);
    await handle.focus();
    await handle.press("ArrowLeft");
    await handle.press("ArrowDown");
    await expect(byTestId(page, TESTID.profilePreview)).toHaveAttribute(
      "data-profile",
      "daily-normal",
    );
    await expect(byTestId(page, TESTID.profileLed)).toHaveAttribute(
      "data-settled",
      "true",
    );
    await handle.press("Enter");
    await expect(byTestId(page, TESTID.modelPicker)).toContainText("Daily");
    await byTestId(page, TESTID.specificModelTab).click();
    await page.getByRole("searchbox").fill("Fake Beta");
    await expect(byTestId(page, TESTID.modelOption)).toHaveCount(1);
    await byTestId(page, TESTID.modelOption).click();
    await expect(byTestId(page, TESTID.modelPicker)).toContainText("Fake Beta");
    await expect(byTestId(page, TESTID.profilePad)).toBeHidden();
  } finally {
    await launched.close();
    rmSync(pickDir, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});
