import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, newSession, shot, tempDir, threadRow } from "./helpers.ts";

test("session-only provider errors appear live and after restoring history", async () => {
  const userData = tempDir("error-user-data");
  const fakeHome = tempDir("error-fake-home");
  const pickDir = tempDir("error-workspace");
  let launched: Awaited<ReturnType<typeof launchApp>> | null = null;
  try {
    launched = await launchApp({ omo: "fake", userData, fakeHome, pickDir });
    const threadId = await newSession(launched.page);
    const input = byTestId(launched.page, TESTID.composerInput);
    await input.fill("SCENARIO:silent-error");
    await input.press("Enter");
    await expect(byTestId(launched.page, TESTID.turnError)).toContainText("402: Insufficient Balance", { timeout: 2000 });
    await shot(launched.page, "C001-error-live");
    await launched.close();
    launched = null;

    launched = await launchApp({ omo: "fake", userData, fakeHome, pickDir });
    await threadRow(launched.page, threadId).click();
    await expect(byTestId(launched.page, TESTID.turnError)).toContainText("402: Insufficient Balance", { timeout: 2000 });
    await shot(launched.page, "C001-error-restored");
  } finally {
    try {
      await launched?.close();
    } finally {
      for (const dir of [userData, fakeHome, pickDir]) rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("New session stays disabled until omo has connected", async () => {
  const pickDir = tempDir("workspace");
  const gateDir = tempDir("init-gate");
  const gate = path.join(gateDir, "release");
  const launched = await launchApp({ omo: "fake", pickDir, extraEnv: { FAKE_OMO_INIT_GATE: gate }, waitForConnected: false });
  try {
    const { page } = launched;
    await expect(page.locator("html")).toHaveAttribute("data-bridge-state", "starting");
    await expect(byTestId(page, TESTID.newSession)).toBeDisabled();
    writeFileSync(gate, "");
    await expect(page.locator("html")).toHaveAttribute("data-bridge-state", "connected");
    await expect(byTestId(page, TESTID.newSession)).toBeEnabled();
  } finally {
    await launched.close();
    for (const dir of [pickDir, gateDir]) rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed turn surfaces as an error toast", async () => {
  const pickDir = tempDir("workspace");
  const launched = await launchApp({ omo: "fake", pickDir });
  try {
    const { page } = launched;
    await newSession(page);
    const input = byTestId(page, TESTID.composerInput);
    await input.fill("SCENARIO:fail");
    await input.press("Enter");
    const toast = byTestId(page, TESTID.noticeToast);
    await expect(toast).toHaveAttribute("data-level", "error");
    await expect(toast).toContainText("Simulated turn failure");
    await expect(input).toHaveValue("SCENARIO:fail");
    await shot(page, "C002-notice", { maxSettleMs: 1000 });
  } finally {
    await launched.close();
    rmSync(pickDir, { recursive: true, force: true });
  }
});
