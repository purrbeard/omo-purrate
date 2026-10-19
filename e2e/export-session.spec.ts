import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, lastTurn, launchApp, newSession, send, shot, tempDir } from "./helpers.ts";

// No other spec covers the conversation header menu, so the session export lives here.
test("Export session writes omo's HTML and says where it went", async () => {
  const pickDir = tempDir("export-workspace");
  const target = path.join(tempDir("export-target"), "session.html");
  const launched = await launchApp({ omo: "fake", pickDir, extraEnv: { OMO_UI_QA_SAVE_PATH: target } });
  try {
    const { page } = launched;
    await newSession(page);
    await send(page, "export me");
    await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");

    await byTestId(page, TESTID.headerMenu).click();
    await shot(page, "header-menu");
    await byTestId(page, TESTID.headerExport).click();
    await expect(byTestId(page, TESTID.noticeToast)).toContainText(target);

    const html = readFileSync(target, "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("export me");
    expect(html).toContain("echo: export me");
  } finally { await launched.close(); }
});
