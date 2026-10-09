import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, newSession, send, shot, tempDir } from "./helpers.ts";

// Drives the installed omo with one cheap model and records every UI-to-native connection point on its own,
// so one failing link does not hide the state of the others.
const MODEL_SUFFIX = "deepseek-v4.1-flash";
const WORKSPACE = path.join(tmpdir(), "omo-ui-qa", "connections");
const TURN_TIMEOUT_MS = 240_000;
const RESULTS = path.join(process.env["OMO_UI_EVIDENCE_DIR"] ?? path.join(import.meta.dirname, "..", "test-results", "evidence"), "real-connections.json");

test.skip(process.env["OMO_UI_E2E_REAL"] !== "1", "set OMO_UI_E2E_REAL=1 to drive the installed omo");
test.setTimeout(25 * 60_000);

async function finishTurn(page: Page, text: string): Promise<Locator> {
  const turns = page.getByTestId("conversation").getByTestId(TESTID.turn);
  const index = await turns.count();
  await send(page, text);
  const turn = turns.nth(index);
  const settled = turn.and(page.locator('[data-status="completed"], [data-status="failed"], [data-status="interrupted"]'));
  const accept = byTestId(page, TESTID.approvalAccept);
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("the turn did not finish in time");
    await expect(settled.or(accept).first()).toBeVisible({ timeout: remaining });
    if (await settled.isVisible()) break;
    await accept.first().click();
  }
  await expect(turn).toHaveAttribute("data-status", "completed");
  return turn;
}

/** Model selections and answering models as the native session file records them. */
function sessionModels(file: string | null): { changes: string[]; answers: string[] } {
  const changes: string[] = [], answers: string[] = [];
  if (file === null) return { changes, answers };
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line === "") continue;
    const entry = JSON.parse(line) as { type?: string; provider?: string; modelId?: string; source?: string; message?: { role?: string; provider?: string; model?: string } };
    if (entry.type === "model_change") changes.push(entry.provider + "/" + entry.modelId + (entry.source === undefined ? "" : "(" + entry.source + ")"));
    if (entry.type === "message" && entry.message?.role === "assistant") answers.push(entry.message.provider + "/" + entry.message.model);
  }
  return { changes, answers };
}

const occurrences = async (locator: Locator, text: string): Promise<number> => (await locator.innerText()).split(text).length - 1;

test("every connection point reaches a live DeepSeek session", async () => {
  mkdirSync(WORKSPACE, { recursive: true });
  mkdirSync(path.dirname(RESULTS), { recursive: true });
  const launched = await launchApp({ omo: "installed", userData: tempDir("connections-user-data"), pickDir: WORKSPACE, size: { width: 1440, height: 900 } });
  const { page, app } = launched;
  const results: Record<string, { pass: boolean; detail: string }> = {};
  const point = async (name: string, check: () => Promise<string>): Promise<void> => {
    try { results[name] = { pass: true, detail: await check() }; }
    catch (error) { results[name] = { pass: false, detail: (error instanceof Error ? error.message : String(error)).slice(0, 900) }; }
    writeFileSync(RESULTS, JSON.stringify(results, null, 2));
  };
  let threadId = "";
  let onTarget = false;
  const requireTarget = (): void => { if (!onTarget) throw new Error("skipped: the session is not running on " + MODEL_SUFFIX + ", so no further paid turns were sent"); };
  try {
    threadId = await newSession(page);
    const workspace = page.getByTestId("agent-workspace");
    const mainTurns = page.getByTestId("conversation").getByTestId(TESTID.turn);

    await point("model selected in composer", async () => {
      await byTestId(page, TESTID.modelPicker).click();
      await byTestId(page, TESTID.specificModelTab).click();
      const option = page.locator('[data-testid="' + TESTID.modelOption + '"][data-model-id$="' + MODEL_SUFFIX + '"]').first();
      const id = await option.getAttribute("data-model-id", { timeout: 20_000 });
      await option.click();
      await page.keyboard.press("Escape");
      return String(id);
    });

    await point("reasoning effort offered for the model is one native accepts", async () => {
      await byTestId(page, TESTID.reasoningPicker).click();
      const options = byTestId(page, TESTID.reasoningOption);
      await expect.poll(() => options.count(), { timeout: 15_000 }).toBeGreaterThan(0);
      const offered = await options.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-effort") ?? ""));
      await page.locator('[data-testid="' + TESTID.reasoningOption + '"][data-effort="high"]').click();
      await page.keyboard.press("Escape");
      const unsupported = offered.filter(effort => !["low", "high", "max"].includes(effort));
      if (unsupported.length > 0) throw new Error("offered " + offered.join(",") + " but models.json maps only low/high/max for this model; selected high");
      return "offered " + offered.join(",") + "; selected high";
    });

    await point("first turn answered by the selected model", async () => {
      const turn = await finishTurn(page, "Reply with exactly: pong");
      await expect(turn.getByTestId(TESTID.assistantMessage).last()).toContainText(/pong/i);
      const thread = await page.evaluate(async id => (await window.omo.request("thread/read", { threadId: id })).thread, threadId);
      const { changes, answers } = sessionModels(thread.path);
      const detail = "selections: " + changes.join(" -> ") + " | answered by: " + answers.join(", ");
      onTarget = (answers.at(-1) ?? "").includes(MODEL_SUFFIX);
      if (!onTarget) throw new Error(detail);
      return detail;
    });
    await shot(page, "real-conn-01-first-turn");

    await point("context gauge shows live usage", async () => {
      const gauge = page.getByTestId("context-gauge");
      await expect.poll(async () => Number(await gauge.getAttribute("data-tokens")), { timeout: 30_000 }).toBeGreaterThan(0);
      return "tokens=" + await gauge.getAttribute("data-tokens") + " window=" + await gauge.getAttribute("data-window") + " percent=" + await gauge.getAttribute("data-percent");
    });

    await point("slash lists native commands", async () => {
      const input = byTestId(page, TESTID.composerInput);
      await input.fill("/");
      const options = byTestId(page, TESTID.commandOption);
      await expect.poll(() => options.count(), { timeout: 20_000 }).toBeGreaterThan(0);
      const names = (await options.allInnerTexts()).map(text => text.split("\n")[0]).slice(0, 14);
      const total = await options.count();
      await input.fill("");
      return total + " commands: " + names.join(" | ");
    });

    await point("bundled task-message extension is loaded in native", async () => {
      const message = await page.evaluate(async id => {
        try { await window.omo.sendTaskMessage(id, "st_connection_probe_missing", "probe"); return "DELIVERED"; }
        catch (error) { return error instanceof Error ? error.message : String(error); }
      }, threadId);
      if (!/No task found/i.test(message)) throw new Error("expected native task_send refusal, got: " + message);
      return message.slice(0, 160);
    });

    await point("model spawns a child and its tab shows the child transcript", async () => {
      requireTarget();
      await finishTurn(page, 'Call the task tool exactly once with these arguments: subagent_type "explore", model "opencodex/opencode-go/' + MODEL_SUFFIX + '", run_in_background false, task_summary "connection probe", prompt "Reply with exactly: child-ok". After it returns, reply with exactly: spawned');
      await expect(workspace).toBeVisible({ timeout: 30_000 });
      const tab = workspace.getByTestId("agent-chat-tab").first();
      await expect(tab).toBeVisible({ timeout: 30_000 });
      await expect(workspace.getByTestId("agent-chat-history")).toContainText("child-ok", { timeout: 60_000 });
      const model = await workspace.locator("form span").first().innerText();
      if (!model.includes(MODEL_SUFFIX)) throw new Error("child ran on a different model: " + model);
      return "task=" + await tab.getAttribute("data-task-id") + " status=" + await tab.getAttribute("data-status") + " model=" + model;
    });
    await shot(page, "real-conn-02-child-tab");

    await point("child tab message is delivered through native task_send", async () => {
      requireTarget();
      const input = workspace.locator("textarea");
      await input.fill("Reply with exactly: child-again");
      await workspace.locator('button[type="submit"]').click();
      const history = workspace.getByTestId("agent-chat-history");
      await expect.poll(() => occurrences(history, "child-again"), { timeout: 90_000 }).toBeGreaterThanOrEqual(1);
      // Native answers the request once the resumed agent has finished, so the draft clears with its reply.
      await expect(input).toHaveValue("", { timeout: 180_000 });
      return "the message appears in the child history and the draft cleared";
    });

    await point("child answers the delivered message", async () => {
      requireTarget();
      const history = workspace.getByTestId("agent-chat-history");
      await expect.poll(() => occurrences(history, "child-again"), { timeout: 150_000 }).toBeGreaterThanOrEqual(2);
      return "child history holds the message and its reply";
    });
    await shot(page, "real-conn-03-child-reply");

    await point("btw side chat answers without touching the main transcript", async () => {
      requireTarget();
      const before = await mainTurns.count();
      await send(page, "/btw Reply with exactly: side-ok");
      const panel = byTestId(page, TESTID.sidePanel);
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => occurrences(panel, "side-ok"), { timeout: 150_000 }).toBeGreaterThanOrEqual(2);
      expect(await mainTurns.count()).toBe(before);
      return "side answer shown; main turns stayed at " + before;
    });
    await shot(page, "real-conn-04-btw");

    await point("terminal runs in the session workspace", async () => {
      const tab = page.getByTestId("right-tab-terminal");
      if (await tab.isVisible()) await tab.click();
      else await page.getByTestId("terminal-toggle").click();
      const panel = page.getByTestId("terminal-panel");
      const input = panel.getByTestId("terminal-input");
      await expect(input).toBeEnabled({ timeout: 30_000 });
      await input.fill("Get-Location");
      await input.press("Enter");
      await expect(panel.getByTestId("terminal-output")).toContainText(path.basename(WORKSPACE), { timeout: 30_000 });
      return "Get-Location printed " + path.basename(WORKSPACE);
    });

    await point("workflow and files panels open for the session", async () => {
      await page.getByTestId("right-tab-workflow").click();
      await expect(page.getByTestId("workflow-panel")).toBeVisible({ timeout: 20_000 });
      await page.getByTestId("right-tab-files").click();
      await expect(page.getByTestId("workspace-panel")).toBeVisible({ timeout: 20_000 });
      return "both visible";
    });

    await point("responsive placement follows the window", async () => {
      await page.getByTestId("right-tab-agents").click();
      const seen: string[] = [];
      for (const [width, placement] of [[1440, "docked"], [1000, "docked"], [700, "overlay"], [1440, "docked"]] as const) {
        await app.evaluate(({ BrowserWindow }, wanted) => { BrowserWindow.getAllWindows()[0]?.setContentSize(wanted, 900); }, width);
        await expect.poll(() => page.evaluate(() => window.innerWidth), { timeout: 15_000 }).toBe(width);
        await expect(workspace).toHaveAttribute("data-placement", placement, { timeout: 15_000 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await shot(page, "real-conn-05-width-" + seen.length + "-" + width);
        seen.push(width + ":" + placement);
      }
      return seen.join(" ");
    });
  } finally {
    if (threadId !== "") await page.evaluate(id => window.omo.request("thread/delete", { threadId: id }), threadId).catch(() => undefined);
    await launched.close();
  }
  const failed = Object.entries(results).filter(([, result]) => !result.pass).map(([name]) => name);
  expect(failed, JSON.stringify(results, null, 2)).toEqual([]);
});

test("every reasoning effort omo lists for a model is one it accepts for that model", async () => {
  mkdirSync(WORKSPACE, { recursive: true });
  mkdirSync(path.dirname(RESULTS), { recursive: true });
  const launched = await launchApp({ omo: "installed", userData: tempDir("efforts-user-data"), pickDir: WORKSPACE });
  try {
    // Thread settings only: no turn is started, so nothing is sent to a provider.
    const report = await launched.page.evaluate(async (cwd) => {
      const models = (await window.omo.request("model/list", { includeHidden: false })).data;
      const { thread } = await window.omo.request("thread/start", { cwd });
      const rejected: string[] = [], rawDefaultNotOffered: string[] = [];
      let checked = 0;
      for (const model of models) {
        const offered = model.supportedReasoningEfforts.map(entry => entry.reasoningEffort);
        if (model.defaultReasoningEffort !== null && !offered.includes(model.defaultReasoningEffort)) rawDefaultNotOffered.push(model.id);
        for (const effort of offered) {
          checked += 1;
          try { await window.omo.request("thread/settings/update", { threadId: thread.id, model: model.id, effort }); }
          catch (error) { rejected.push(model.id + " " + effort + ": " + (error instanceof Error ? error.message : String(error))); }
        }
      }
      await window.omo.request("thread/delete", { threadId: thread.id });
      return { models: models.length, reasoningModels: models.filter(model => model.supportedReasoningEfforts.length > 0).length, checked, rejected, rawDefaultNotOffered };
    }, WORKSPACE);
    writeFileSync(path.join(path.dirname(RESULTS), "real-efforts.json"), JSON.stringify(report, null, 2));
    expect(report.checked).toBeGreaterThan(0);
    expect(report.rejected).toEqual([]);
  } finally { await launched.close(); }
});
