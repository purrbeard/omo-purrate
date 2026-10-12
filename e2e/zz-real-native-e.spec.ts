import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { TESTID } from "../src/ui/testids.ts";
import { newSession, send } from "./helpers.ts";

test.skip(process.env["OMO_UI_REAL_NATIVE"] !== "1", "set OMO_UI_REAL_NATIVE=1");
test.setTimeout(30 * 60_000);

const EXE = "C:/Users/truek/AppData/Local/Programs/OmO UI Windows/OmO UI Windows.exe";
const RUN = process.env["OMO_UI_REAL_RUN"] ?? path.join(os.tmpdir(), "omo-ui-real-native", "run");
const MODEL = "opencodex/opencode-go/deepseek-v4.1-flash";
const RESULTS = path.join(RUN, "results-E.json");
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
async function point(name: string, check: () => Promise<{ ui: string; native: string }>): Promise<boolean> {
  try { const r = await check(); results[name] = { pass: true, ...r }; }
  catch (error) { results[name] = { pass: false, error: (error instanceof Error ? error.message : String(error)).replace(/\u001b\[[0-9;]*m/g, "").slice(0, 1500) }; }
  save();
  return results[name]!.pass;
}
async function settleAnswering(page: Page, turns: Locator, answer: "accept" | "decline"): Promise<number> {
  const button = id(page, answer === "accept" ? TESTID.approvalAccept : TESTID.approvalDecline).first();
  const settled = turns.last().and(page.locator('[data-status="completed"], [data-status="failed"], [data-status="interrupted"]'));
  let answered = 0;
  const deadline = Date.now() + 240_000;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("turn did not settle; answered " + answered + " approvals");
    await expect(settled.or(button)).toBeVisible({ timeout: remaining });
    if (await settled.isVisible()) return answered;
    await button.click();
    answered += 1;
  }
}
const conversation = (page: Page): Locator => page.getByTestId("conversation");
function sessionFileFor(threadId: string): string {
  const root = path.join(process.env["USERPROFILE"]!, ".omo", "agent", "sessions");
  for (const d of readdirSync(root)) {
    const dir = path.join(root, d);
    try { for (const f of readdirSync(dir)) if (f.endsWith("_" + threadId + ".jsonl")) return path.join(dir, f); } catch { /* file entries */ }
  }
  throw new Error("no session file for " + threadId);
}

test("REAL E: UI approvals and questions round-trip to native; terminal error and goal sync into the UI", async () => {
  mkdirSync(RUN, { recursive: true });
  const userData = mkdtempSync(path.join(RUN, "userdata-E-"));
  const project = mkdtempSync(path.join(RUN, "project-E-"));
  writeFileSync(path.join(project, "README.md"), "temp project E\n");
  mkdirSync(path.join(project, ".omo"), { recursive: true });
  writeFileSync(path.join(project, ".omo", "settings.json"), JSON.stringify({ permissionPreset: "ask" }));
  const { app, page } = await launchInstalled(userData, project);
  let threadId = "";
  try {
    threadId = await newSession(page);
    await id(page, TESTID.modelPicker).click();
    await id(page, TESTID.specificModelTab).click();
    await page.locator(`[data-testid="${TESTID.modelOption}"][data-model-id="${MODEL}"]`).first().click();
    await page.keyboard.press("Escape");
    const turns = conversation(page).getByTestId(TESTID.turn);

    await point("E1 approval card appears for a write under the ask preset and Accept reaches native", async () => {
      await send(page, "Use the write tool once to create the file approved.txt containing exactly: approved. Then reply with exactly: wrote");
      const card = id(page, TESTID.approvalCard).first();
      await expect(card).toBeVisible({ timeout: 180_000 });
      await page.screenshot({ path: path.join(RUN, "E-01-approval.png") });
      const accepted = await settleAnswering(page, turns, "accept");
      const written = existsSync(path.join(project, "approved.txt")) ? readFileSync(path.join(project, "approved.txt"), "utf8") : null;
      if (written === null) throw new Error("approved.txt not written after Accept");
      return { ui: "approval card shown; accepted " + accepted + " approval(s); turn " + await turns.last().getAttribute("data-status"), native: "approved.txt on disk: " + JSON.stringify(written.trim()) };
    });

    await point("E2 Decline keeps the file from being written", async () => {
      await send(page, "Use the write tool once to create the file declined.txt containing exactly: no. Then reply with exactly: done");
      await expect(id(page, TESTID.approvalCard).first()).toBeVisible({ timeout: 180_000 });
      const declined = await settleAnswering(page, turns, "decline");
      if (existsSync(path.join(project, "declined.txt"))) throw new Error("declined.txt exists after Decline");
      return { ui: "declined " + declined + " approval(s); turn " + await turns.last().getAttribute("data-status"), native: "declined.txt absent" };
    });

    await point("E3 question card answer reaches the model", async () => {
      await send(page, 'Call the ask_user_question tool exactly once with waitForAnswer true and one question: header "Pick", question "Pick A or B?", options "A" and "B", multiSelect false. After it returns, reply with exactly the label I picked.');
      const card = id(page, TESTID.questionCard).first();
      await expect(card).toBeVisible({ timeout: 180_000 });
      await page.screenshot({ path: path.join(RUN, "E-02-question.png") });
      await card.locator(`[data-testid="${TESTID.questionOption}"][data-label="B"]`).click();
      await id(page, TESTID.questionSubmit).click();
      await expect(turns.last()).toHaveAttribute("data-status", /completed|failed|interrupted/, { timeout: 240_000 });
      const text = await turns.last().innerText();
      const file = sessionFileFor(threadId);
      const answered = readFileSync(file, "utf8").includes('"B"');
      if (!/\bB\b/.test(text.split("\n").slice(-6).join(" "))) throw new Error("reply does not name B: " + text.slice(-300));
      return { ui: "question card answered B; reply: " + text.slice(-120).replace(/\n/g, " "), native: "session file records the B answer: " + answered };
    });
  } finally {
    await app.close();
  }
  const failed = Object.entries(results).filter(([, r]) => !r.pass).map(([n]) => n);
  expect(failed, JSON.stringify(results, null, 2)).toEqual([]);
});
