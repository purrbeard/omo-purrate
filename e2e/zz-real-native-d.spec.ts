import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { TESTID } from "../src/ui/testids.ts";
import { newSession, send } from "./helpers.ts";

test.skip(process.env["OMO_UI_REAL_NATIVE"] !== "1", "set OMO_UI_REAL_NATIVE=1");
test.setTimeout(20 * 60_000);

const EXE = "C:/Users/truek/AppData/Local/Programs/OmO UI Windows/OmO UI Windows.exe";
const RUN = process.env["OMO_UI_REAL_RUN"] ?? path.join(os.tmpdir(), "omo-ui-real-native", "run");
const MODEL = "opencodex/opencode-go/deepseek-v4.1-flash";
const RESULTS = path.join(RUN, "results-D.json");
const results: Record<string, { pass: boolean; ui?: string; native?: string; error?: string }> = {};
const save = (): void => { mkdirSync(RUN, { recursive: true }); writeFileSync(RESULTS, JSON.stringify(results, null, 2)); };
const id = (page: Page, t: string): Locator => page.locator(`[data-testid="${t}"]`);
const row = (page: Page, threadId: string): Locator => page.locator(`[data-testid="${TESTID.threadRow}"][data-thread-id="${threadId}"]`);

async function launchInstalled(userData: string, pickDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const prefs = path.join(userData, "preferences.json");
  if (!existsSync(prefs)) writeFileSync(prefs, JSON.stringify({ locale: "ko", onboardingCompleted: true }));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["ELECTRON_RUN_AS_NODE", "OMO_UI_OMO_BIN", "FAKE_OMO_HOME", "FAKE_OMO_LOG"]) delete env[k];
  Object.assign(env, { OMO_UI_USER_DATA: userData, OMO_UI_QA_PICK_DIR: pickDir, OMO_UI_OMO_AUTO_UPDATE: "0", OMO_UI_IPHONE_BRIDGE: "0" });
  const app = await electron.launch({ executablePath: EXE, args: [], env, timeout: 90_000 });
  const page = await app.firstWindow({ timeout: 90_000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900));
  await expect(page.locator("html")).toHaveAttribute("data-bridge-state", "connected", { timeout: 120_000 });
  return { app, page };
}
const rpc = (page: Page, method: string, params: unknown): Promise<any> =>
  page.evaluate(async ([m, p]) => window.omo.request(m as never, p as never), [method, params] as const);
async function point(name: string, check: () => Promise<{ ui: string; native: string }>): Promise<boolean> {
  try { const r = await check(); results[name] = { pass: true, ...r }; }
  catch (error) { results[name] = { pass: false, error: (error instanceof Error ? error.message : String(error)).replace(/\u001b\[[0-9;]*m/g, "").slice(0, 1500) }; }
  save();
  return results[name]!.pass;
}

test("REAL D: goal survives app restart; archive/restore works in the installed app", async () => {
  mkdirSync(RUN, { recursive: true });
  const userData = mkdtempSync(path.join(RUN, "userdata-D-"));
  const project = mkdtempSync(path.join(RUN, "project-D-"));
  writeFileSync(path.join(project, "README.md"), "temp project D\n");
  let { app, page } = await launchInstalled(userData, project);
  let threadId = "";
  try {
    threadId = await newSession(page);
    await id(page, TESTID.modelPicker).click();
    await id(page, TESTID.specificModelTab).click();
    await page.locator(`[data-testid="${TESTID.modelOption}"][data-model-id="${MODEL}"]`).first().click();
    await page.keyboard.press("Escape");
    await id(page, TESTID.reasoningPicker).click();
    await page.locator(`[data-testid="${TESTID.reasoningOption}"][data-effort="low"]`).click();
    await page.keyboard.press("Escape");
    const turns = page.getByTestId("conversation").getByTestId(TESTID.turn);
    await send(page, "Reply with exactly: d-ok");
    await expect(turns.last()).toHaveAttribute("data-status", /completed|failed|interrupted/, { timeout: 240_000 });
    const firstStatus = await turns.last().getAttribute("data-status");
    const firstError = await turns.last().innerText();
    results["D0 first turn status as shown"] = { pass: true, ui: "data-status=" + firstStatus + " text=" + firstError.slice(0, 300) };
    save();

    await point("D1 paused goal is restored after an app restart", async () => {
      await rpc(page, "thread/goal/set", { threadId, objective: "restart QA goal", status: "paused" });
      await expect(id(page, TESTID.goalStrip)).toHaveAttribute("data-status", "paused", { timeout: 30_000 });
      await app.close();
      ({ app, page } = await launchInstalled(userData, project));
      await row(page, threadId).getByRole("button").first().click();
      await expect(id(page, TESTID.goalStrip)).toHaveAttribute("data-status", "paused", { timeout: 60_000 });
      await page.screenshot({ path: path.join(RUN, "D-01-goal-after-restart.png") });
      const goal = (await rpc(page, "thread/goal/get", { threadId })).goal;
      if (goal?.status !== "paused") throw new Error("native goal after restart: " + JSON.stringify(goal));
      await id(page, TESTID.goalClear).click();
      await expect(id(page, TESTID.goalStrip)).toHaveCount(0, { timeout: 30_000 });
      const cleared = (await rpc(page, "thread/goal/get", { threadId })).goal;
      if (cleared !== null) throw new Error("native goal after UI Clear: " + JSON.stringify(cleared));
      return { ui: "strip paused before and after restart; Clear removed it", native: "goal/get paused after restart; null after Clear" };
    });

    await point("D2 archive then restore from Settings works against native", async () => {
      const before = (await rpc(page, "thread/read", { threadId })).thread;
      const size = statSync(before.path).size;
      await row(page, threadId).getByTestId(TESTID.threadMenu).click();
      await page.getByRole("menuitem", { name: /보관|Archive/ }).click();
      await expect(row(page, threadId)).toHaveCount(0, { timeout: 30_000 });
      const archived = (await rpc(page, "thread/list", { archived: true, limit: 100 })).data.some((t: { id: string }) => t.id === threadId);
      await id(page, TESTID.openSettings).click();
      await page.locator(`[data-testid="${TESTID.settingsNavItem}"][data-section="archived"]`).click();
      const archivedRow = page.locator(`[data-testid="${TESTID.archivedThreadRow}"][data-thread-id="${threadId}"]`);
      await expect(archivedRow).toBeVisible({ timeout: 30_000 });
      await archivedRow.getByTestId(TESTID.archivedRestore).click();
      await expect(archivedRow).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByRole("alert")).toHaveCount(0);
      await page.screenshot({ path: path.join(RUN, "D-02-restored.png") });
      await id(page, TESTID.settingsBack).click();
      await expect(row(page, threadId)).toBeVisible({ timeout: 30_000 });
      const stillArchived = (await rpc(page, "thread/list", { archived: true, limit: 100 })).data.some((t: { id: string }) => t.id === threadId);
      const active = (await rpc(page, "thread/list", { limit: 100 })).data.some((t: { id: string }) => t.id === threadId);
      const after = (await rpc(page, "thread/read", { threadId })).thread;
      const sizeAfter = statSync(after.path).size;
      if (!archived || stillArchived || !active || sizeAfter < size || existsSync(after.path + ".archived")) throw new Error(JSON.stringify({ archived, stillArchived, active, size, sizeAfter }));
      return { ui: "row archived, listed in Settings, Restore without error, row back in sidebar", native: "thread/list archived=" + archived + " -> " + stillArchived + "; active list has it=" + active + "; sidecar removed; history " + size + " -> " + sizeAfter + " bytes" };
    });
  } finally {
    await app.close();
  }
  const failed = Object.entries(results).filter(([, r]) => !r.pass).map(([n]) => n);
  expect(failed, JSON.stringify(results, null, 2)).toEqual([]);
});
