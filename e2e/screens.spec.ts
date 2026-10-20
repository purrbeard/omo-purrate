import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, setTheme, shot, tempDir, threadRow, type LaunchedApp } from "./helpers.ts";

let fakeHome = "";
let userData = "";
let alpha = "";
let beta = "";
let launched: LaunchedApp | null = null;

const current = (): LaunchedApp => {
  if (launched === null) throw new Error("the app is not running");
  return launched;
};

const archive = async (page: Page, id: string): Promise<void> => {
  await threadRow(page, id).getByTestId(TESTID.threadMenu).click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expect(threadRow(page, id)).toHaveCount(0);
};

const openSection = async (page: Page, section: string): Promise<void> => {
  if (!(await byTestId(page, TESTID.settingsDialog).isVisible())) await byTestId(page, TESTID.openSettings).click();
  await page.locator(`[data-testid="${TESTID.settingsNavItem}"][data-section="${section}"]`).click();
};

test.beforeAll(async () => {
  fakeHome = tempDir("screens-home");
  userData = tempDir("screens-user-data");
  alpha = tempDir("alpha");
  beta = tempDir("beta");
  writeFileSync(path.join(userData, "preferences.json"), JSON.stringify({ locale: "en", autoSettle: false, managedThreadIds: ["a-fix", "a-docs", "b-fix", "b-docs"] }));
  const now = Date.now() / 1000;
  const seedFile = path.join(fakeHome, "seed.json");
  writeFileSync(seedFile, JSON.stringify([
    { id: "a-fix", cwd: alpha, name: "Alpha fix", preview: "fix", updatedAt: now - 400 },
    { id: "a-docs", cwd: alpha, name: "Alpha docs", preview: "docs", updatedAt: now - 300 },
    { id: "b-fix", cwd: beta, name: "Beta fix", preview: "fix", updatedAt: now - 200 },
    { id: "b-docs", cwd: beta, name: "Beta docs", preview: "docs", updatedAt: now - 100 },
  ]));
  launched = await launchApp({ omo: "fake", fakeHome, userData, extraEnv: { FAKE_OMO_SEED_THREADS: seedFile } });
});

test.afterAll(async () => {
  await launched?.close();
  launched = null;
  for (const dir of [fakeHome, userData, alpha, beta]) if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

test("archive screen groups by project, filters, and restoring returns the row to the sidebar", async () => {
  const { page } = current();
  for (const id of ["a-fix", "a-docs", "b-fix"]) await archive(page, id);
  await openSection(page, "archived");
  const rows = byTestId(page, TESTID.archivedThreadRow);
  await expect(rows).toHaveCount(3);
  await expect(byTestId(page, TESTID.archiveGroup)).toHaveCount(2);

  await byTestId(page, TESTID.archiveProjectFilter).selectOption({ label: path.basename(beta) });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-thread-id", "b-fix");

  await byTestId(page, TESTID.archiveProjectFilter).selectOption({ index: 0 });
  await byTestId(page, TESTID.archiveSearch).fill("docs");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-thread-id", "a-docs");
  await byTestId(page, TESTID.archiveSearch).fill("nothing-matches");
  await expect(byTestId(page, TESTID.archiveEmpty)).toBeVisible();

  await byTestId(page, TESTID.archiveSearch).fill("");
  await byTestId(page, TESTID.archiveProjectFilter).selectOption({ label: path.basename(beta) });
  await rows.first().getByTestId(TESTID.archivedRestore).click();
  await expect(rows).toHaveCount(0);
  await expect(byTestId(page, TESTID.archiveEmpty)).toBeVisible();
  await byTestId(page, TESTID.settingsBack).click();
  await expect(threadRow(page, "b-fix")).toBeVisible();

  // Multi-select restores the rest in one action.
  await openSection(page, "archived");
  await expect(rows).toHaveCount(2);
  await rows.first().getByTestId(TESTID.archiveSelect).check();
  await rows.nth(1).getByTestId(TESTID.archiveSelect).check();
  await byTestId(page, TESTID.archiveRestoreSelected).click();
  await expect(rows).toHaveCount(0);
  await byTestId(page, TESTID.settingsBack).click();
  await expect(threadRow(page, "a-fix")).toBeVisible();
  await expect(threadRow(page, "a-docs")).toBeVisible();
});

test("renaming a project and choosing an icon and color changes its sidebar header", async () => {
  const { page } = current();
  const header = page.locator(`[data-testid="${TESTID.workspaceGroup}"][data-cwd="${alpha.replaceAll("\\", "\\\\")}"]`);
  await expect(header).toBeVisible();
  await header.getByTestId(TESTID.workspaceMenu).click();
  await page.getByTestId(TESTID.workspaceSettings).click();
  const projects = byTestId(page, TESTID.settingsProjects);
  await expect(projects).toBeVisible();
  const row = projects.locator(`[data-testid="${TESTID.projectRow}"]`).filter({ hasText: alpha });
  await expect(row).toBeVisible();

  await row.getByTestId(TESTID.projectRename).click();
  await row.getByTestId(TESTID.projectRenameInput).fill("Alpha Project");
  await row.getByTestId(TESTID.projectRenameSave).click();
  await expect(row).toContainText("Alpha Project");

  await row.getByTestId(TESTID.projectAppearance).click();
  await row.locator(`[data-testid="${TESTID.projectIconOption}"][data-icon="rocket"]`).click();
  await row.locator(`[data-testid="${TESTID.projectColorOption}"][data-color="red"]`).click();
  await expect(row.locator("[data-project-icon='rocket'][data-project-color='red']")).toBeVisible();

  await shot(page, "screens-light-projects");
  await byTestId(page, TESTID.settingsBack).click();
  await expect(header.getByTestId(TESTID.workspaceName)).toHaveText("Alpha Project");
  await expect(header.locator("[data-project-icon='rocket']")).toBeVisible();
  await shot(page, "screens-light-sidebar");
  await setTheme(page, "dark");
  await expect(header.locator("[data-project-icon='rocket']")).toBeVisible();
  await shot(page, "screens-dark-sidebar");
  await openSection(page, "projects");
  await shot(page, "screens-dark-projects");
  await byTestId(page, TESTID.settingsBack).click();

  // Removing only drops the list entry: the group leaves the sidebar, no session is deleted.
  await header.getByTestId(TESTID.workspaceMenu).click();
  await page.getByTestId(TESTID.workspaceSettings).click();
  await projects.locator(`[data-testid="${TESTID.projectRow}"]`).filter({ hasText: alpha }).getByTestId(TESTID.projectRemove).click();
  await page.getByTestId(TESTID.projectRemoveConfirm).click();
  await expect(projects.locator(`[data-testid="${TESTID.projectRow}"]`).filter({ hasText: alpha })).toHaveCount(0);
  await byTestId(page, TESTID.settingsBack).click();
  await expect(header).toHaveCount(0);
});
