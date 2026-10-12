import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { TESTID } from "../src/ui/testids.ts";
import { send } from "./helpers.ts";

test.skip(process.env["OMO_UI_REAL_NATIVE"] !== "1", "set OMO_UI_REAL_NATIVE=1");
test.setTimeout(40 * 60_000);

const EXE = "C:/Users/truek/AppData/Local/Programs/OmO UI Windows/OmO UI Windows.exe";
const RUN = process.env["OMO_UI_REAL_RUN"] ?? path.join(os.tmpdir(), "omo-ui-real-native", "run");
const PROJECT = process.env["OMO_UI_REAL_PROJECT"]!;
const THREAD = process.env["OMO_UI_REAL_THREAD"]!;
const SESSION = process.env["OMO_UI_REAL_SESSION"]!;
const MODEL = "opencodex/opencode-go/deepseek-v4.1-flash";
const RESULTS = path.join(RUN, "results-B.json");
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

/** A terminal turn in another omo process on the same session file. */
function terminalTurn(prompt: string): string {
  const r = spawnSync("omo", ["-p", "--session", SESSION, "--model", MODEL, "--thinking", "low", prompt], { cwd: PROJECT, encoding: "utf8", timeout: 600_000, shell: false });
  if (r.status !== 0) throw new Error("terminal omo exited " + r.status + ": " + (r.stderr ?? "").slice(-600));
  return (r.stdout ?? "").trim().slice(-300);
}

interface Entry { type: string; id: string; parentId: string | null; message?: { role?: string; model?: string; content?: unknown } ; customType?: string }
function entries(): Entry[] {
  return readFileSync(SESSION, "utf8").split("\n").filter(l => l !== "").map(l => JSON.parse(l) as Entry);
}
const textOf = (e: Entry): string => JSON.stringify(e.message?.content ?? "");

async function point(name: string, check: () => Promise<{ ui: string; native: string }>): Promise<boolean> {
  try { const r = await check(); results[name] = { pass: true, ...r }; }
  catch (error) { results[name] = { pass: false, error: (error instanceof Error ? error.message : String(error)).replace(/\u001b\[[0-9;]*m/g, "").slice(0, 1500) }; }
  save();
  return results[name]!.pass;
}

const conversation = (page: Page): Locator => page.getByTestId("conversation");

test("REAL B: terminal-led session syncs into the UI and UI continuation does not branch", async () => {
  mkdirSync(RUN, { recursive: true });
  const userData = mkdtempSync(path.join(RUN, "userdata-B-"));
  let { app, page } = await launchInstalled(userData, PROJECT);
  try {
    await point("B0 terminal session imported into the sidebar", async () => {
      await page.getByTestId("native-sessions-open").click();
      const manage = page.locator(`[data-testid="native-session-row"][data-thread-id="${THREAD}"]`).getByTestId("native-session-manage");
      await manage.click();
      await expect(manage).toHaveAttribute("aria-pressed", "true");
      await page.getByTestId("native-sessions-close").click();
      const row = page.locator(`[data-testid="${TESTID.threadRow}"][data-thread-id="${THREAD}"]`);
      await row.getByRole("button").first().click();
      await expect(conversation(page)).toContainText("term-1", { timeout: 60_000 });
      return { ui: "row added and opened; term-1 shown", native: "session " + SESSION };
    });
    await page.screenshot({ path: path.join(RUN, "B-01-imported.png") });

    await point("B1 terminal message, todo and completion appear without reload", async () => {
      const out = terminalTurn("Use the todo tool to create a todo list with exactly two pending tasks named 'alpha task' and 'beta task' in one phase named 'QA'. Then reply with exactly: term-2");
      await expect(conversation(page)).toContainText("term-2", { timeout: 120_000 });
      const last = conversation(page).getByTestId(TESTID.turn).last();
      await expect(last).toHaveAttribute("data-status", "completed", { timeout: 60_000 });
      await expect(id(page, TESTID.todoDock)).toContainText("alpha task", { timeout: 60_000 });
      await expect(id(page, TESTID.todoDock)).toContainText("beta task");
      const e = entries();
      const hasTodo = e.some(x => x.type === "message" && /alpha task/.test(textOf(x)));
      return { ui: "term-2 shown in a completed turn; todo dock shows alpha task / beta task", native: "terminal stdout: " + out + "; JSONL contains todo call with alpha task: " + hasTodo };
    });
    await page.screenshot({ path: path.join(RUN, "B-02-terminal-todo.png") });

    await point("B2 terminal child agent appears in the agent workspace", async () => {
      const out = terminalTurn('Call the task tool exactly once with: subagent_type "explore", model "' + MODEL + '", run_in_background false, task_summary "terminal child probe", prompt "Reply with exactly: child-ok". After it returns, reply with exactly: term-3');
      await expect(conversation(page)).toContainText("term-3", { timeout: 120_000 });
      const tab = page.getByTestId("agent-chat-tab").first();
      await expect(tab).toBeVisible({ timeout: 60_000 });
      const taskId = await tab.getAttribute("data-task-id");
      const status = await tab.getAttribute("data-status");
      return { ui: "agent tab " + taskId + " status=" + status, native: "terminal stdout: " + out };
    });
    await page.screenshot({ path: path.join(RUN, "B-03-terminal-child.png") });

    await point("B3 UI continuation after terminal turns extends the latest leaf (no stale branch)", async () => {
      const before = entries();
      const leaf = before.filter(x => x.type === "message").at(-1)!;
      await id(page, TESTID.modelPicker).click();
      await id(page, TESTID.specificModelTab).click();
      await page.locator(`[data-testid="${TESTID.modelOption}"][data-model-id="${MODEL}"]`).first().click();
      await page.keyboard.press("Escape");
      const turns = conversation(page).getByTestId(TESTID.turn);
      const n = await turns.count();
      await send(page, "What was the last word you replied with before this message? Reply with only that word.");
      await expect(turns.nth(n)).toHaveAttribute("data-status", /completed|failed|interrupted/, { timeout: 240_000 });
      await expect(turns.nth(n)).toHaveAttribute("data-status", "completed");
      const after = entries();
      const byId = new Map(after.map(x => [x.id, x]));
      const userMsg = after.filter(x => x.type === "message" && x.message?.role === "user").at(-1)!;
      const chain = new Set<string>();
      for (let cur: Entry | undefined = userMsg; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) chain.add(cur.id);
      const answer = after.filter(x => x.type === "message" && x.message?.role === "assistant").at(-1)!;
      if (!chain.has(leaf.id)) throw new Error("UI user entry " + userMsg.id + " does not descend from terminal leaf " + leaf.id);
      return { ui: "UI turn completed: " + (await turns.nth(n).innerText()).slice(0, 120), native: "UI user entry " + userMsg.id + " descends from terminal leaf " + leaf.id + "; answered by " + answer.message?.model + " -> " + textOf(answer).slice(0, 80) };
    });
    await page.screenshot({ path: path.join(RUN, "B-04-ui-continuation.png") });

    await point("B4 terminal turn after a UI turn, then UI again, still linear", async () => {
      const out = terminalTurn("Reply with exactly: term-4");
      await expect(conversation(page)).toContainText("term-4", { timeout: 120_000 });
      const leaf = entries().filter(x => x.type === "message").at(-1)!;
      const turns = conversation(page).getByTestId(TESTID.turn);
      const n = await turns.count();
      await send(page, "Reply with exactly: ui-5");
      await expect(turns.nth(n)).toHaveAttribute("data-status", /completed|failed|interrupted/, { timeout: 240_000 });
      const after = entries();
      const byId = new Map(after.map(x => [x.id, x]));
      const userMsg = after.filter(x => x.type === "message" && x.message?.role === "user").at(-1)!;
      const chain = new Set<string>();
      for (let cur: Entry | undefined = userMsg; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) chain.add(cur.id);
      if (!chain.has(leaf.id)) throw new Error("second UI turn branched: user " + userMsg.id + " not under terminal leaf " + leaf.id);
      return { ui: "term-4 shown, then ui-5 turn " + await turns.nth(n).getAttribute("data-status"), native: "terminal stdout " + out + "; UI user " + userMsg.id + " descends from " + leaf.id };
    });
  } finally {
    await app.close();
  }
  const failed = Object.entries(results).filter(([, r]) => !r.pass).map(([n]) => n);
  expect(failed, JSON.stringify(results, null, 2)).toEqual([]);
});
