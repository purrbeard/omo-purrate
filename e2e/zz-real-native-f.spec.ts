import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TESTID } from "../src/ui/testids.ts";
import { newSession } from "./helpers.ts";

test.skip(process.env["OMO_UI_REAL_NATIVE"] !== "1", "set OMO_UI_REAL_NATIVE=1");
test.setTimeout(30 * 60_000);

const EXE = "C:/Users/truek/AppData/Local/Programs/OmO UI Windows/OmO UI Windows.exe";
const RUN = process.env["OMO_UI_REAL_RUN"] ?? path.join(os.tmpdir(), "omo-ui-real-native", "run");
const MODEL = "opencodex/opencode-go/deepseek-v4.1-flash";
const RESULTS = path.join(RUN, "results-F.json");
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
function answeringModels(cwd: string): string[] {
  const root = path.join(process.env["USERPROFILE"]!, ".omo", "agent", "sessions");
  const key = cwd.replace(/[\\/:]/g, "-");
  const models = new Set<string>();
  for (const dir of readdirSync(root).filter((name) => name.includes(path.basename(cwd)))) {
    for (const file of readdirSync(path.join(root, dir)).filter((name) => name.endsWith(".jsonl"))) {
      for (const line of readFileSync(path.join(root, dir, file), "utf8").split("\n")) {
        if (!line.includes('"assistant"')) continue;
        try { const entry = JSON.parse(line) as { message?: { role?: string; model?: string } }; if (entry.message?.role === "assistant" && entry.message.model) models.add(entry.message.model); } catch { /* partial line */ }
      }
    }
  }
  void key;
  return [...models];
}

test("REAL F: side chat carries out an edit; worktree history attributes the model's commit to its branch", async () => {
  mkdirSync(RUN, { recursive: true });
  const userData = mkdtempSync(path.join(RUN, "userdata-F-"));
  const main = mkdtempSync(path.join(RUN, "project-F-"));
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  git(main, "init", "-q", "-b", "main");
  git(main, "config", "user.name", "qa");
  git(main, "config", "user.email", "qa@example.test");
  writeFileSync(path.join(main, "README.md"), "temp project F\n");
  git(main, "add", ".");
  execFileSync("git", ["-C", main, "commit", "-q", "-m", "base"], { env: { ...process.env, GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z" } });
  const worktree = main + "-feat";
  git(main, "worktree", "add", "-q", "-b", "feat", worktree);
  const { app, page } = await launchInstalled(userData, worktree);
  try {
    await newSession(page);
    await id(page, TESTID.modelPicker).click();
    await id(page, TESTID.specificModelTab).click();
    await page.locator(`[data-testid="${TESTID.modelOption}"][data-model-id="${MODEL}"]`).first().click();
    await page.keyboard.press("Escape");
    await expect(id(page, TESTID.modelPicker)).toContainText("deepseek-v4.1-flash");

    await point("F1 side chat carries out a file edit when instructed", async () => {
      await page.keyboard.press("Control+E");
      const input = id(page, TESTID.sideInput);
      await input.fill("Create the file side.txt in the workspace containing exactly: side-ok . Use the write tool. Then reply with exactly: done");
      await id(page, TESTID.sideSend).click();
      const turn = id(page, TESTID.sideTurn).last();
      await expect(turn).toHaveAttribute("data-status", /completed|failed|interrupted/, { timeout: 240_000 });
      const status = await turn.getAttribute("data-status");
      const file = path.join(worktree, "side.txt");
      const written = existsSync(file) ? readFileSync(file, "utf8").trim() : null;
      await page.screenshot({ path: path.join(RUN, "F-01-side-chat-edit.png") });
      if (written !== "side-ok") throw new Error("side.txt = " + JSON.stringify(written) + ", side turn " + status);
      const models = answeringModels(worktree);
      if (models.some((model) => !model.includes("deepseek-v4.1-flash"))) throw new Error("side chat answered by " + models.join(","));
      return { ui: "side turn " + status, native: "side.txt on disk = side-ok; answering models " + models.join(",") };
    });

    await point("F2 the model's commit in the worktree shows as feat -> main, not merged", async () => {
      git(worktree, "add", "side.txt");
      execFileSync("git", ["-C", worktree, "commit", "-q", "-m", "side chat edit"]);
      await page.keyboard.press("Control+E");
      await page.getByTestId("checkout-folder").click();
      const panel = page.getByTestId("workspace-panel");
      await panel.getByRole("button", { name: "세션 이력", exact: true }).click();
      const group = panel.getByTestId("workspace-session-worktree").filter({ hasText: "side chat edit" });
      await expect(group).toContainText("feat");
      await expect(group.getByTestId("workspace-session-target")).toHaveText("→ main");
      await expect(group.getByTestId("workspace-session-merged")).toHaveAttribute("data-merged", "false");
      await page.screenshot({ path: path.join(RUN, "F-02-worktree-unmerged.png") });
      execFileSync("git", ["-C", main, "merge", "-q", "--no-ff", "feat", "-m", "merge feat"]);
      await panel.getByRole("button", { name: "파일 새로고침" }).click();
      await expect(group.getByTestId("workspace-session-merged")).toHaveAttribute("data-merged", "true");
      const mainGroup = panel.getByTestId("workspace-session-worktree").filter({ hasText: "merge feat" });
      await expect(mainGroup).toContainText("main");
      await page.screenshot({ path: path.join(RUN, "F-03-worktree-merged.png") });
      const contains = git(main, "branch", "--contains", git(worktree, "rev-parse", "HEAD").trim()).includes("main");
      return { ui: "feat group: -> main, not merged -> merged after merge; main group shows merge commit", native: "git branch --contains: main contains the feat commit = " + contains };
    });
  } finally {
    await app.close();
  }
  const failed = Object.entries(results).filter(([, r]) => !r.pass).map(([n]) => n);
  expect(failed, JSON.stringify(results, null, 2)).toEqual([]);
});
