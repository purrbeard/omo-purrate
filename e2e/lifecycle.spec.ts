import { expect, test, type Page } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, newSession, tempDir, threadRow, type LaunchedApp } from "./helpers.ts";

test.describe.configure({ mode: "serial" });

let fakeHome = "";
let userData = "";
let pickDir = "";
let launched: LaunchedApp | null = null;
let threadId = "";

const current = (): LaunchedApp => {
  if (launched === null) throw new Error("the app is not running");
  return launched;
};

const start = async (): Promise<void> => {
  launched = await launchApp({ omo: "fake", fakeHome, userData, pickDir });
};

const menu = async (page: Page, id: string, label: string): Promise<void> => {
  await threadRow(page, id).getByTestId(TESTID.threadMenu).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
};

test.beforeAll(async () => {
  fakeHome = tempDir("lifecycle-home");
  userData = tempDir("lifecycle-user-data");
  pickDir = tempDir("lifecycle-workspace");
  await start();
});

test.afterAll(async () => {
  await launched?.close();
  launched = null;
  // Explicit directories are retained as lifecycle evidence, matching relaunch ownership in launchApp.
});

test("pin persists after relaunch and can be removed", async () => {
  let { page } = current();
  threadId = await newSession(page);
  await page.evaluate(async id => { await window.omo.request("thread/name/set", { threadId: id, name: "Lifecycle session" }); }, threadId);
  await menu(page, threadId, "Pin");
  await expect(byTestId(page, TESTID.sidebarPinned).locator(`[data-thread-id="${threadId}"]`)).toBeVisible();
  await launched?.close();
  launched = null;
  await start();
  page = current().page;
  await expect(byTestId(page, TESTID.sidebarPinned).locator(`[data-thread-id="${threadId}"]`)).toBeVisible();
  await menu(page, threadId, "Unpin");
  await expect(byTestId(page, TESTID.sidebarPinned)).toHaveCount(0);
  await expect(threadRow(page, threadId)).toBeVisible();
});

test("archive removes the selected session and restore uses the archived settings page", async () => {
  const { page } = current();
  await threadRow(page, threadId).getByRole("button").first().click();
  await menu(page, threadId, "Archive");
  await expect(threadRow(page, threadId)).toHaveCount(0);
  await byTestId(page, TESTID.openSettings).click();
  await page.locator(`[data-testid="${TESTID.settingsNavItem}"][data-section="archived"]`).click();
  const archived = page.locator(`[data-testid="${TESTID.archivedThreadRow}"][data-thread-id="${threadId}"]`);
  await expect(archived).toContainText("Lifecycle session");
  await archived.getByTestId(TESTID.archivedRestore).click();
  await expect(archived).toHaveCount(0);
  await byTestId(page, TESTID.settingsBack).click();
  await expect(threadRow(page, threadId)).toBeVisible();
});

test("fork creates and opens a different session while preserving the source", async () => {
  const { page } = current();
  await menu(page, threadId, "Fork");
  const fork = page.locator(`[data-testid="${TESTID.threadRow}"][aria-current="page"]`);
  await expect(fork).toHaveAttribute("data-title", "Lifecycle session (fork)");
  const forkId = await fork.getAttribute("data-thread-id");
  expect(forkId).not.toBe(threadId);
  expect(forkId).not.toBeNull();
  await expect(threadRow(page, threadId)).toBeVisible();
});

test("goal controls pause, resume and clear the active session goal", async () => {
  const { page } = current();
  await threadRow(page, threadId).getByRole("button").first().click();
  await page.evaluate(async id => {
    await window.omo.request("thread/goal/set", { threadId: id, objective: "Finish lifecycle checks", status: "active" });
  }, threadId);
  const strip = byTestId(page, TESTID.goalStrip);
  await expect(strip).toHaveAttribute("data-status", "active");
  await byTestId(page, TESTID.goalPause).click();
  await expect(strip).toHaveAttribute("data-status", "paused");
  await byTestId(page, TESTID.goalResume).click();
  await expect(strip).toHaveAttribute("data-status", "active");
  await byTestId(page, TESTID.goalClear).click();
  await expect(strip).toHaveCount(0);
});
