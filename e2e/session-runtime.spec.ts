import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, newSession, send, lastTurn, WT } from "./helpers.ts";

test("Stop exposes explicit Resume and session runtime choices use native state", async () => {
  const launched = await launchApp({ omo: "fake", pickDir: WT });
  try {
    const { page } = launched;
    await newSession(page);
    await send(page, "SCENARIO:slow");
    await expect(byTestId(page, TESTID.composerStop)).toBeVisible();
    await byTestId(page, TESTID.composerStop).click();
    await expect(page.getByTestId("session-paused-banner")).toBeVisible();
    await page.getByTestId("session-resume").click();
    await expect(page.getByTestId("session-paused-banner")).toHaveCount(0);
    await expect(lastTurn(page)).toContainText("Resume the interrupted work.");
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
    const resume = launched.readFakeLog().filter(entry => entry["type"] === "resume_session");
    expect(resume).toHaveLength(1);
    expect(resume[0]).toMatchObject({ expectedSeq: 1, mode: "continue" });
    await byTestId(page, TESTID.openSettings).click();
    await page.locator('[data-section="omo"]').click();
    const toggle = page.getByTestId("runtime-auto-compaction");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await page.getByTestId("runtime-retry-disable").click();
    await expect(page.getByTestId("settings-session-runtime")).toHaveAttribute("aria-busy", "false");
    expect(launched.readFakeLog()).toContainEqual(expect.objectContaining({ type: "set_auto_retry", enabled: false }));
  } finally { await launched.close(); }
});
