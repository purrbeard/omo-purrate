import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { TESTID } from "../src/ui/testids.ts";
import { newSession, send } from "./helpers.ts";

test.skip(process.env["OMO_UI_REAL_NATIVE"] !== "1", "set OMO_UI_REAL_NATIVE=1");
test.setTimeout(40 * 60_000);

const EXE = "C:/Users/truek/AppData/Local/Programs/OmO UI Windows/OmO UI Windows.exe";
const RUN = process.env["OMO_UI_REAL_RUN"] ?? path.join(os.tmpdir(), "omo-ui-real-native", "run");
const MODEL = "opencodex/opencode-go/deepseek-v4.1-flash";
const RESULTS = path.join(RUN, "results-C.json");
const results: Record<string, { pass: boolean; ui?: string; native?: string; error?: string }> = {};
const save = (): void => { mkdirSync(RUN, { recursive: true }); writeFileSync(RESULTS, JSON.stringify(results, null, 2)); };
const id = (page: Page, t: string): Locator => page.locator(`[data-testid="${t}"]`);

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

function taskDir(project: string): string {
  const real = realpathSync(project);
  const hash = createHash("sha256").update(real).digest("hex").slice(0, 12);
  const name = path.basename(real).replace(/[^\p{L}\p{N}._-]/gu, "_") || "root";
  return path.join(process.env["USERPROFILE"]!, ".omo", "agent", "projects", `${name}-${hash}`, "senpi-task", "tasks");
}
function taskRecord(project: string, taskId: string): Record<string, unknown> | null {
  const f = path.join(taskDir(project), taskId + ".json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown> : null;
}
function childSessionFile(childId: string): string | null {
  const root = path.join(process.env["USERPROFILE"]!, ".omo", "agent", "sessions");
  for (const d of readdirSync(root)) {
    const dir = path.join(root, d);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) if (f.endsWith("_" + childId + ".jsonl")) return path.join(dir, f);
  }
  return null;
}
const rpc = (page: Page, method: string, params: unknown): Promise<any> =>
  page.evaluate(async ([m, p]) => window.omo.request(m as never, p as never), [method, params] as const);

async function point(name: string, check: () => Promise<{ ui: string; native: string }>): Promise<boolean> {
  try { const r = await check(); results[name] = { pass: true, ...r }; }
  catch (error) { results[name] = { pass: false, error: (error instanceof Error ? error.message : String(error)).replace(/\u001b\[[0-9;]*m/g, "").slice(0, 1500) }; }
  save();
  return results[name]!.pass;
}

test("REAL C: stop a running child, then restart restores parent/child and state", async () => {
  mkdirSync(RUN, { recursive: true });
  const userData = mkdtempSync(path.join(RUN, "userdata-C-"));
  const project = mkdtempSync(path.join(RUN, "project-C-"));
  writeFileSync(path.join(project, "README.md"), "temp project C\n");
  let { app, page } = await launchInstalled(userData, project);
  let threadId = "", taskId = "", childId = "", relatedId = "";
  try {
    threadId = await newSession(page);
    await id(page, TESTID.modelPicker).click();
    await id(page, TESTID.specificModelTab).click();
    await page.locator(`[data-testid="${TESTID.modelOption}"][data-model-id="${MODEL}"]`).first().click();
    await page.keyboard.press("Escape");
    // DeepSeek thinking "high" + the first-turn todo reminder returned provider 400 (tool_choice) in run3; use low like the passing terminal run.
    await id(page, TESTID.reasoningPicker).click();
    await page.locator(`[data-testid="${TESTID.reasoningOption}"][data-effort="low"]`).click();
    await page.keyboard.press("Escape");

    await point("C1 UI Stop cancels a running background child; native record and child session stop", async () => {
      await send(page, 'Call the task tool exactly once with: subagent_type "task", model "' + MODEL + '", run_in_background true, task_summary "long child", prompt "Run exactly 40 sequential foreground tool calls, one at a time: each is the bash tool in the foreground (never in the background, never a monitor) with the command Start-Sleep -Seconds 6 and a 30 second timeout. Count them in your head. After the 40th returns, reply with exactly: slept". Right after the tool returns its task id, reply with exactly: launched');
      const tab = page.getByTestId("agent-chat-tab").first();
      await expect(tab).toBeVisible({ timeout: 180_000 });
      taskId = String(await tab.getAttribute("data-task-id"));
      await tab.click();
      await expect(tab).toHaveAttribute("data-status", /running|queued/, { timeout: 60_000 });
      const before = taskRecord(project, taskId);
      childId = String(before?.["child_session_id"] ?? "");
      await page.screenshot({ path: path.join(RUN, "C-01-running-child.png") });
      const stop = page.locator(`[data-task-id="${taskId}"] [data-testid="agent-stop"]`);
      await expect(stop).toBeVisible({ timeout: 30_000 });
      const t0 = Date.now();
      await stop.click();
      await expect(tab).not.toHaveAttribute("data-status", /running|queued/, { timeout: 90_000 });
      const uiStatus = await tab.getAttribute("data-status");
      let rec = taskRecord(project, taskId);
      for (let i = 0; i < 30 && rec?.["status"] === "running"; i++) { await page.waitForTimeout(1000); rec = taskRecord(project, taskId); }
      const file = childId ? childSessionFile(childId) : null;
      const size1 = file ? statSync(file).size : -1;
      await page.waitForTimeout(20_000);
      const size2 = file ? statSync(file).size : -1;
      await page.screenshot({ path: path.join(RUN, "C-02-stopped-child.png") });
      const status = String(rec?.["status"]);
      if (!["cancelled", "killed", "failed", "lost", "completed"].includes(status) || status === "completed") throw new Error("native task status after Stop: " + status + " (ui " + uiStatus + ")");
      if (size2 !== size1) throw new Error("child session kept growing after Stop: " + size1 + " -> " + size2);
      return { ui: "tab " + taskId + " running -> " + uiStatus + " " + (Date.now() - t0) + "ms after Stop", native: "senpi-task " + taskId + " status=" + status + " (was " + before?.["status"] + "); child session " + childId + " size unchanged over 20s (" + size1 + " bytes)" };
    });

    await point("C2 related child session created from the UI", async () => {
      // Let the main turn settle so the next one starts cleanly.
      await expect(page.getByTestId("conversation").getByTestId(TESTID.turn).last()).toHaveAttribute("data-status", /completed|failed|interrupted/, { timeout: 240_000 });
      await page.locator(`[data-testid="${TESTID.threadRow}"][data-thread-id="${threadId}"]`).getByTestId(TESTID.threadMenu).click();
      await page.getByRole("menuitem", { name: /관련 세션 만들기|New related session/ }).click();
      // The related session opens asynchronously; send only once the composer belongs to it.
      await expect(id(page, TESTID.composerInput)).not.toHaveAttribute("data-thread-id", threadId, { timeout: 60_000 });
      await send(page, "Reply with exactly: related-ok");
      await expect.poll(async () => Object.values((await page.evaluate(() => window.omo.getPreferences())).threadParents).includes(threadId), { timeout: 30_000 }).toBe(true);
      const prefs = await page.evaluate(() => window.omo.getPreferences());
      relatedId = Object.keys(prefs.threadParents).find(k => prefs.threadParents[k] === threadId) ?? "";
      if (!relatedId) throw new Error("no threadParents entry for " + threadId);
      await expect(page.getByTestId("conversation").getByTestId(TESTID.turn).last()).toHaveAttribute("data-status", "completed", { timeout: 240_000 });
      return { ui: "related session " + relatedId + " opened under " + threadId, native: "thread/read: " + JSON.stringify((await rpc(page, "thread/read", { threadId: relatedId })).thread.path) };
    });

    await rpc(page, "thread/goal/set", { threadId, objective: "restart QA goal", status: "paused" });
    await expect(id(page, TESTID.goalStrip)).toHaveCount(0); // goal belongs to the parent; the related child is open
    await app.close();

    ({ app, page } = await launchInstalled(userData, project));
    await point("C3 after restart parent/child relation, stopped child and goal are restored", async () => {
      const parentRow = page.locator(`[data-testid="${TESTID.threadRow}"][data-thread-id="${threadId}"]`);
      await expect(parentRow).toBeVisible({ timeout: 60_000 });
      const toggle = parentRow.locator("..").getByTestId("thread-children-toggle");
      await expect(toggle).toBeVisible({ timeout: 60_000 });
      if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
      const childRow = page.locator(`[data-testid="${TESTID.threadRow}"][data-thread-id="${relatedId}"]`);
      await expect(childRow).toBeVisible({ timeout: 60_000 });
      const nested = await parentRow.locator("..").locator(`[data-thread-id="${relatedId}"]`).count();
      if (nested === 0) throw new Error("related child is not nested under its parent after restart");
      await parentRow.getByRole("button").first().click();
      await expect(id(page, TESTID.goalStrip)).toHaveAttribute("data-status", "paused", { timeout: 60_000 });
      const tab = page.locator(`[data-testid="agent-chat-tab"][data-task-id="${taskId}"]`);
      await page.getByTestId("right-tab-agents").click().catch(() => undefined);
      await expect(tab).toBeVisible({ timeout: 60_000 });
      const uiStatus = await tab.getAttribute("data-status");
      if (uiStatus === "running" || uiStatus === "queued") throw new Error("stopped child shows " + uiStatus + " after restart");
      await page.screenshot({ path: path.join(RUN, "C-03-after-restart.png") });
      const goal = (await rpc(page, "thread/goal/get", { threadId })).goal;
      const rec = taskRecord(project, taskId);
      return { ui: "child row nested under parent; goal strip paused; task tab " + uiStatus, native: "goal/get status=" + goal?.status + "; senpi-task status=" + rec?.["status"] };
    });
    await rpc(page, "thread/goal/clear", { threadId }).catch(() => undefined);
  } finally {
    await app.close();
  }
  const failed = Object.entries(results).filter(([, r]) => !r.pass).map(([n]) => n);
  expect(failed, JSON.stringify(results, null, 2)).toEqual([]);
});
