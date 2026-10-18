import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, send, tempDir, threadRow } from "./helpers.ts";

function seeded(label: string): { fakeHome: string; userData: string; id: string; seedFile: string } {
  const fakeHome = tempDir(`${label}-home`), userData = tempDir(`${label}-user`), workspace = tempDir(`${label}-workspace`);
  const id = randomUUID();
  const seedFile = path.join(fakeHome, "seed.json");
  writeFileSync(seedFile, JSON.stringify([{ id, cwd: workspace, name: "Session served by the shared host" }]));
  writeFileSync(path.join(userData, "preferences.json"), JSON.stringify({ locale: "en", sharedHost: true, managedThreadIds: [id] }));
  return { fakeHome, userData, id, seedFile };
}

async function openOmoSettings(page: Page): Promise<void> {
  await byTestId(page, TESTID.openSettings).click();
  await byTestId(page, TESTID.settingsDialog).locator('[data-section="omo"]').click();
}

test("with the shared-host setting on, the app attaches through omo host ensure, lists and opens sessions", async () => {
  const { fakeHome, userData, id, seedFile } = seeded("shared-host");
  const launched = await launchApp({ omo: "fake", fakeHome, userData, extraEnv: { FAKE_OMO_SEED_THREADS: seedFile } });
  try {
    const { page } = launched;
    await expect(page.locator("html")).toHaveAttribute("data-bridge-state", "connected");
    await expect(threadRow(page, id)).toBeVisible();
    await threadRow(page, id).click();
    await expect(byTestId(page, TESTID.composerInput)).toHaveAttribute("data-thread-id", id);
    await send(page, "question-contract served over the shared host socket");
    await expect(page.getByTestId("assistant-message").last()).toContainText("question-contract served over the shared host socket");
    await expect.poll(() => {
      const log = launched.readFakeLog();
      const attached = log.findIndex(frame => frame["type"] === "fake_shared_host_connection");
      return attached >= 0 && log.slice(attached).some(frame => frame["type"] === "open_session" && String(frame["sessionPath"]).includes(id));
    }).toBe(true);
    await openOmoSettings(page);
    await expect(byTestId(page, TESTID.omoSharedHost)).toHaveAttribute("aria-pressed", "true");
    await expect(byTestId(page, TESTID.omoHostTransport)).toHaveAttribute("data-transport", "shared");
    await expect(byTestId(page, TESTID.omoHostNotice)).toHaveCount(0);
  } finally {
    await launched.close();
  }
});

test("when the shared host is unavailable the app falls back to its own host with a notice, and the setting turns off", async () => {
  const { fakeHome, userData, id, seedFile } = seeded("shared-host-fallback");
  const launched = await launchApp({ omo: "fake", fakeHome, userData, extraEnv: { FAKE_OMO_SEED_THREADS: seedFile, FAKE_OMO_HOST_ENSURE: "fail" } });
  try {
    const { page } = launched;
    await expect(page.locator("html")).toHaveAttribute("data-bridge-state", "connected");
    await expect(threadRow(page, id)).toBeVisible();
    await threadRow(page, id).click();
    await expect(byTestId(page, TESTID.composerInput)).toHaveAttribute("data-thread-id", id);
    expect(launched.readFakeLog().some(frame => frame["type"] === "fake_shared_host_connection")).toBe(false);
    await openOmoSettings(page);
    await expect(byTestId(page, TESTID.omoHostTransport)).toHaveAttribute("data-transport", "private");
    await expect(byTestId(page, TESTID.omoHostNotice)).toContainText("fake shared host refused");
    await byTestId(page, TESTID.omoSharedHost).click();
    await expect(byTestId(page, TESTID.omoSharedHost)).toHaveAttribute("aria-pressed", "false");
    await expect(byTestId(page, TESTID.omoHostNotice)).toHaveCount(0);
    await expect(byTestId(page, TESTID.omoHostTransport)).toHaveAttribute("data-transport", "private");
    expect(await page.evaluate(() => window.omo.getPreferences())).toMatchObject({ sharedHost: false });
  } finally {
    await launched.close();
  }
});
