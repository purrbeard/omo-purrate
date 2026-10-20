import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, setTheme, shot, tempDir, threadRow, type LaunchedApp } from "./helpers.ts";

const NAMES = ["Alpha thread", "Bravo thread", "Charlie thread", "Delta thread", "Echo thread"];
const IDS = ["bulk-a", "bulk-b", "bulk-c", "bulk-d", "bulk-e"];

interface Seeded {
  launched: LaunchedApp;
  dirs: string[];
}

async function launchSeeded(prefs: Record<string, unknown>): Promise<Seeded> {
  const fakeHome = tempDir("bulk-home");
  const pickDir = tempDir("bulk-workspace");
  const userData = tempDir("bulk-user-data");
  writeFileSync(path.join(userData, "preferences.json"), JSON.stringify({ locale: "en", autoSettle: false, managedThreadIds: IDS, ...prefs }));
  const now = Date.now() / 1000;
  const seedFile = path.join(fakeHome, "seed.json");
  writeFileSync(seedFile, JSON.stringify(IDS.map((id, index) => ({ id, cwd: pickDir, name: NAMES[index], preview: NAMES[index], updatedAt: now - index * 60 }))));
  const launched = await launchApp({ omo: "fake", fakeHome, userData, pickDir, extraEnv: { FAKE_OMO_SEED_THREADS: seedFile } });
  return { launched, dirs: [fakeHome, pickDir, userData] };
}

const main = (page: Page, id: string): Locator => threadRow(page, id).locator("button").first();
const ids = async (page: Page): Promise<string[]> =>
  byTestId(page, TESTID.threadRow).evaluateAll((rows) => rows.map((row) => row.getAttribute("data-thread-id") ?? ""));

test.describe("sidebar bulk tidy", () => {
  let seeded: Seeded | null = null;
  test.afterEach(async () => {
    await seeded?.launched.close();
    for (const dir of seeded?.dirs ?? []) rmSync(dir, { recursive: true, force: true });
    seeded = null;
  });

  test("ctrl/shift select, bulk archive with Undo, snooze into the Snoozed group", async () => {
    seeded = await launchSeeded({});
    const { page } = seeded.launched;
    const rows = byTestId(page, TESTID.threadRow);
    await expect(rows).toHaveCount(5);
    const order = await ids(page);
    const bar = byTestId(page, TESTID.bulkBar);
    const count = byTestId(page, TESTID.bulkCount);

    // Plain click opens; ctrl+click enters selection; shift+click extends over the visible range; Esc clears.
    await main(page, order[0]!).click();
    await expect(threadRow(page, order[0]!)).toHaveAttribute("aria-current", "page");
    await expect(bar).toHaveCount(0);
    await main(page, order[1]!).click({ modifiers: ["Control"] });
    await expect(count).toHaveText("1 selected");
    await main(page, order[3]!).click({ modifiers: ["Shift"] });
    await expect(count).toHaveText("3 selected");
    await expect(byTestId(page, TESTID.threadCheckbox)).toHaveCount(5);
    for (const id of order.slice(1, 4)) await expect(threadRow(page, id)).toHaveAttribute("data-picked", "true");
    await shot(page, "bulk-light");
    await page.keyboard.press("Escape");
    await expect(bar).toHaveCount(0);

    // Ctrl+A in selection mode (entered from the row menu) selects every visible thread.
    await threadRow(page, order[4]!).getByTestId(TESTID.threadMenu).click();
    await page.getByTestId(TESTID.threadSelect).click();
    await expect(count).toHaveText("1 selected");
    await page.keyboard.press("Control+a");
    await expect(count).toHaveText("5 selected");
    await byTestId(page, TESTID.bulkClear).click();
    await expect(bar).toHaveCount(0);

    // Bulk archive, then Undo restores exactly those threads.
    await main(page, order[1]!).click({ modifiers: ["Control"] });
    await main(page, order[2]!).click({ modifiers: ["Control"] });
    await byTestId(page, TESTID.bulkArchive).click();
    await expect(rows).toHaveCount(3);
    await expect(byTestId(page, TESTID.noticeToast)).toHaveText("Archived 2 threads.");
    await expect(bar).toHaveCount(0);
    await byTestId(page, TESTID.noticeUndo).click();
    await expect(rows).toHaveCount(5);
    expect((await ids(page)).sort()).toEqual([...order].sort());

    // Snooze hides the thread from the list; the Snoozed group lists it with its wake time.
    await main(page, order[2]!).click({ modifiers: ["Control"] });
    await byTestId(page, TESTID.bulkSnooze).click();
    await page.locator(`[data-testid="${TESTID.threadSnooze}"][data-preset="hour"]`).click();
    await expect(rows).toHaveCount(4);
    await expect(threadRow(page, order[2]!)).toHaveCount(0);
    await byTestId(page, TESTID.sidebarSnoozedToggle).click();
    await expect(byTestId(page, TESTID.sidebarSnoozed).locator(`[data-thread-id="${order[2]}"]`)).toBeVisible();
    await expect(byTestId(page, TESTID.threadWake)).toContainText("Back");
    await expect.poll(async () => Object.keys((await page.evaluate(() => window.omo.getPreferences())).snoozedThreads)).toEqual([order[2]]);

    await main(page, order[0]!).click({ modifiers: ["Control"] });
    await main(page, order[1]!).click({ modifiers: ["Control"] });
    await setTheme(page, "dark");
    await shot(page, "bulk-dark");
  });

  test("a snooze that ends while the app runs returns the thread to the top with a dot until it is opened", async () => {
    seeded = await launchSeeded({ snoozedThreads: { "bulk-d": Date.now() + 30_000 } });
    const { page } = seeded.launched;
    await expect(byTestId(page, TESTID.sidebarSnoozedToggle)).toBeVisible();
    await expect(threadRow(page, "bulk-d")).toHaveCount(0);
    await expect(byTestId(page, TESTID.threadRow)).toHaveCount(4);

    const woken = threadRow(page, "bulk-d");
    await expect(woken).toBeVisible({ timeout: 60_000 });
    await expect(byTestId(page, TESTID.sidebarSnoozed)).toHaveCount(0);
    await expect(woken.getByTestId(TESTID.threadWoken)).toBeVisible();
    expect((await ids(page))[0]).toBe("bulk-d");
    await main(page, "bulk-d").click();
    await expect(woken.getByTestId(TESTID.threadWoken)).toHaveCount(0);
  });
});
