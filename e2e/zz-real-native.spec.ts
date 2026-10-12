import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { TESTID } from "../src/ui/testids.ts";
import { newSession, send } from "./helpers.ts";

// REAL evidence: the installed app + the installed omo app-server (no fake). Gated so test:e2e never runs it.
test.skip(process.env["OMO_UI_REAL_NATIVE"] !== "1", "set OMO_UI_REAL_NATIVE=1");
test.setTimeout(30 * 60_000);

const EXE = "C:/Users/truek/AppData/Local/Programs/OmO UI Windows/OmO UI Windows.exe";
const RUN = process.env["OMO_UI_REAL_RUN"] ?? "C:/Users/truek/AppData/Local/Temp/omo-ui-real-native/run";
const MODEL_SUFFIX = "deepseek-v4.1-flash";
const TURN_TIMEOUT_MS = 240_000;
const RESULTS = path.join(RUN, "results-A.json");
const results: Record<string, { pass: boolean; ui?: string; native?: string; error?: string }> = {};
const save = (): void => { mkdirSync(RUN, { recursive: true }); writeFileSync(RESULTS, JSON.stringify(results, null, 2)); };
const id = (page: Page, t: string): Locator => page.locator(`[data-testid="${t}"]`);

export async function launchInstalled(userData: string, pickDir: string): Promise<{ app: ElectronApplication; page: Page }> {
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

export async function finishTurn(page: Page, text: string): Promise<Locator> {
  const turns = page.getByTestId("conversation").getByTestId(TESTID.turn);
  const index = await turns.count();
  await send(page, text);
  const turn = turns.nth(index);
  const settled = turn.and(page.locator('[data-status="completed"], [data-status="failed"], [data-status="interrupted"]'));
  await expect(settled).toBeVisible({ timeout: TURN_TIMEOUT_MS });
  return turn;
}

export function answeringModels(file: string): string[] {
  const out: string[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line === "") continue;
    const e = JSON.parse(line) as { type?: string; message?: { role?: string; provider?: string; model?: string } };
    if (e.type === "message" && e.message?.role === "assistant") out.push(`${e.message.provider}/${e.message.model}`);
  }
  return out;
}

const rpc = (page: Page, method: string, params: unknown): Promise<any> =>
  page.evaluate(async ([m, p]) => window.omo.request(m as never, p as never), [method, params] as const);

async function point(name: string, check: () => Promise<{ ui: string; native: string }>): Promise<boolean> {
  try { const r = await check(); results[name] = { pass: true, ...r }; }
  catch (error) { results[name] = { pass: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 1200) }; }
  save();
  return results[name]!.pass;
}

test("REAL A: first turn on DeepSeek, goal pause/resume/clear, fork/archive/restore", async () => {
  mkdirSync(RUN, { recursive: true });
  const userData = mkdtempSync(path.join(RUN, "userdata-A-"));
  const project = mkdtempSync(path.join(RUN, "project-A-"));
  writeFileSync(path.join(project, "README.md"), "temp project for omo-ui real native QA\n");
  const { app, page } = await launchInstalled(userData, project);
  let threadId = "";
  let onTarget = false;
  try {
    threadId = await newSession(page);
    results["meta"] = { pass: true, native: JSON.stringify({ threadId, project, userData }) }; save();

    await point("R1 first turn answered by DeepSeek v4.1 Flash", async () => {
      await id(page, TESTID.modelPicker).click();
      await id(page, TESTID.specificModelTab).click();
      const option = page.locator(`[data-testid="${TESTID.modelOption}"][data-model-id$="${MODEL_SUFFIX}"]`).first();
      const modelId = await option.getAttribute("data-model-id", { timeout: 30_000 });
      await option.click();
      await page.keyboard.press("Escape");
      const turn = await finishTurn(page, "Reply with exactly: pong");
      await expect(turn).toHaveAttribute("data-status", "completed");
      await expect(turn.getByTestId(TESTID.assistantMessage).last()).toContainText(/pong/i);
      const thread = (await rpc(page, "thread/read", { threadId })).thread;
      const models = answeringModels(thread.path);
      onTarget = (models.at(-1) ?? "").includes(MODEL_SUFFIX);
      if (!onTarget) throw new Error("answered by " + models.join(","));
      return { ui: "picked " + modelId + "; turn completed with pong", native: "session " + thread.path + " answered by " + models.join(",") };
    });
    await page.screenshot({ path: path.join(RUN, "A-01-first-turn.png") });
    if (!onTarget) throw new Error("stopping paid steps: not on " + MODEL_SUFFIX);

    await point("R2 goal pause/resume/clear reach native", async () => {
      const set = await rpc(page, "thread/goal/set", { threadId, objective: "QA goal: reply ok once", status: "paused", tokenBudget: 20000 });
      const strip = id(page, TESTID.goalStrip);
      await expect(strip).toHaveAttribute("data-status", "paused", { timeout: 30_000 });
      const steps: string[] = ["set(paused) -> " + set.goal.status];
      await id(page, TESTID.goalResume).click();
      await expect(strip).toHaveAttribute("data-status", "active", { timeout: 30_000 });
      steps.push("UI Resume -> native " + (await rpc(page, "thread/goal/get", { threadId })).goal?.status);
      await id(page, TESTID.goalPause).click();
      await expect(strip).toHaveAttribute("data-status", "paused", { timeout: 30_000 });
      steps.push("UI Pause -> native " + (await rpc(page, "thread/goal/get", { threadId })).goal?.status);
      await page.screenshot({ path: path.join(RUN, "A-02-goal-paused.png") });
      // Let any continuation turn the resume started settle before clearing.
      await expect(page.getByTestId("conversation").getByTestId(TESTID.turn).last()).toHaveAttribute("data-status", /completed|failed|interrupted/, { timeout: TURN_TIMEOUT_MS });
      await id(page, TESTID.goalClear).click();
      await expect(strip).toHaveCount(0, { timeout: 30_000 });
      const after = await rpc(page, "thread/goal/get", { threadId });
      steps.push("UI Clear -> native goal " + JSON.stringify(after.goal ?? null));
      const nativeStatuses = steps.join(" | ");
      if (!/Resume -> native active/.test(nativeStatuses) || !/Pause -> native paused/.test(nativeStatuses) || !/goal null/.test(nativeStatuses)) throw new Error(nativeStatuses);
      return { ui: "strip paused -> active -> paused -> removed", native: nativeStatuses };
    });

    await point("R3 fork/archive/restore reach native", async () => {
      const original = (await rpc(page, "thread/read", { threadId })).thread;
      const sizeBefore = statSync(original.path).size;
      await page.locator(`[data-testid="${TESTID.threadRow}"][data-thread-id="${threadId}"]`).getByTestId(TESTID.threadMenu).click();
      await page.getByRole("menuitem", { name: /포크|분기|Fork/ }).click();
      const forkRow = page.locator(`[data-testid="${TESTID.threadRow}"][aria-current="page"]`);
      await expect(forkRow).not.toHaveAttribute("data-thread-id", threadId, { timeout: 60_000 });
      const forkId = String(await forkRow.getAttribute("data-thread-id"));
      const fork = (await rpc(page, "thread/read", { threadId: forkId })).thread;
      const steps = ["fork " + forkId + " forkedFromId=" + fork.forkedFromId + " path=" + fork.path];
      await page.locator(`[data-testid="${TESTID.threadRow}"][data-thread-id="${threadId}"]`).getByTestId(TESTID.threadMenu).click();
      await page.getByRole("menuitem", { name: /보관|Archive/ }).click();
      await expect(page.locator(`[data-testid="${TESTID.threadRow}"][data-thread-id="${threadId}"]`)).toHaveCount(0, { timeout: 30_000 });
      const archivedList = (await rpc(page, "thread/list", { archived: true, cwd: project, limit: 50 })).data.map((t: { id: string }) => t.id);
      const activeList = (await rpc(page, "thread/list", { archived: false, cwd: project, limit: 50 })).data.map((t: { id: string }) => t.id);
      steps.push("after archive: native archived has original=" + archivedList.includes(threadId) + ", active has original=" + activeList.includes(threadId));
      await id(page, TESTID.openSettings).click();
      await page.locator(`[data-testid="${TESTID.settingsNavItem}"][data-section="archived"]`).click();
      const row = page.locator(`[data-testid="${TESTID.archivedThreadRow}"][data-thread-id="${threadId}"]`);
      await expect(row).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: path.join(RUN, "A-03-archived.png") });
      await row.getByTestId(TESTID.archivedRestore).click();
      await expect(row).toHaveCount(0, { timeout: 30_000 });
      await id(page, TESTID.settingsBack).click();
      await expect(page.locator(`[data-testid="${TESTID.threadRow}"][data-thread-id="${threadId}"]`)).toBeVisible({ timeout: 30_000 });
      const archived2 = (await rpc(page, "thread/list", { archived: true, cwd: project, limit: 50 })).data.map((t: { id: string }) => t.id);
      const active2 = (await rpc(page, "thread/list", { archived: false, cwd: project, limit: 50 })).data.map((t: { id: string }) => t.id);
      const restored = (await rpc(page, "thread/read", { threadId })).thread;
      const sizeAfter = restored.path === null ? -1 : statSync(restored.path).size;
      steps.push("after restore: archived has original=" + archived2.includes(threadId) + ", active has original=" + active2.includes(threadId) + ", history bytes " + sizeBefore + " -> " + sizeAfter + " path " + restored.path);
      const s = steps.join(" | ");
      if (fork.forkedFromId !== threadId && !String(fork.forkedFromId ?? "").length) steps.push("(forkedFromId missing)");
      if (!archivedList.includes(threadId) || activeList.includes(threadId) || archived2.includes(threadId) || !active2.includes(threadId) || sizeAfter < sizeBefore) throw new Error(s);
      return { ui: "fork opened; original left sidebar, listed in Archived, restored to sidebar", native: s };
    });
    await page.screenshot({ path: path.join(RUN, "A-04-restored.png") });
  } finally {
    await app.close();
  }
  const failed = Object.entries(results).filter(([, r]) => !r.pass).map(([n]) => n);
  expect(failed, JSON.stringify(results, null, 2)).toEqual([]);
});
