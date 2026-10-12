import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, newSession, send, setTheme, shot, tempDir, threadRow } from "./helpers.ts";

test("running child agents can be stopped from the agent workspace", async () => {
  const launched = await launchApp({ omo: "fake", pickDir: tempDir("agent-stop-workspace"), size: { width: 1440, height: 900 } });
  const { page } = launched;
  try {
    const threadId = await newSession(page);
    await send(page, "SCENARIO:dag");
    await page.locator('[data-testid="agent-chat-tab"][data-task-id="st_dag_layout"]').click();
    const stop = page.locator('[data-task-id="st_dag_layout"] [data-testid="agent-stop"]');
    await expect(stop).toBeVisible();
    await expect(stop).toHaveAccessibleName("Stop agent");
    const current = threadRow(page, threadId);
    await expect(current).toHaveAttribute("aria-current", "page");
    await stop.click();
    const cancels = () => launched.readFakeLog().filter(entry => entry.method === "extension_request" && (entry.params as { name?: string })?.name === "omo-ui.task.cancel");
    await expect.poll(() => cancels().length).toBe(1);
    expect(cancels()[0]?.params).toEqual({ threadId, name: "omo-ui.task.cancel", data: { taskId: "st_dag_layout" } });
    const tab = page.locator('[data-testid="agent-chat-tab"][data-task-id="st_dag_layout"]');
    await expect(tab).toHaveAttribute("data-status", "cancelled");
    await expect(stop).toHaveCount(0);
    await expect(current).toHaveAttribute("aria-current", "page");
  } finally { await launched.close(); }
});

test("compact DAG and nested subagent todos update without disturbing the conversation", async () => {
  const pickDir = tempDir("dag-workspace");
  const launched = await launchApp({ omo: "fake", pickDir, size: { width: 1440, height: 900 } });
  const { page, app } = launched;
  const capture = async (name: string): Promise<void> => {
    mkdirSync("/tmp/dag-ev", { recursive: true });
    copyFileSync(await shot(page, `dag-${name}`), `/tmp/dag-ev/${name}.png`);
  };
  const entity = (id: string) => page.locator(`[data-task-id="st_dag_${id}"]`);
  try {
    await setTheme(page, "light");
    const threadId = await newSession(page);
    const chip = byTestId(page, TESTID.omoActivityToggle);
    await expect(chip).toHaveCount(0);
    const started = expect(chip).toBeVisible();
    await send(page, "SCENARIO:dag");
    await started;
    await expect(chip).toHaveAttribute("aria-expanded", "false");
    await expect(chip).toContainText("3/8 done");
    await expect(chip).toContainText("1 failed");
    await expect(byTestId(page, TESTID.omoActivity)).toHaveCount(0);
    await capture("collapsed");
    await chip.click();
    await page.getByTestId("workflow-list").click();
    const panel = byTestId(page, TESTID.omoActivity);
    await expect(panel).toBeVisible();
    await expect(entity("layout").getByTestId(TESTID.taskSteps).first()).toHaveText("4/9");
    await expect(entity("layout").locator("summary").first()).toContainText("now: Run tests");
    await expect(entity("browser")).toBeVisible();
    await expect(entity("visual")).toBeVisible();
    await expect(entity("contrast")).toHaveCount(0);
    await expect(entity("visual")).toHaveAttribute("data-depth", "2");
    await expect(entity("layout").locator("summary").first()).toContainText("gpt-6.1-sol");
    await expect(page.locator('[data-node-id="review"] > details > summary')).toContainText("layout · coverage");
    await capture("expanded");
    await entity("audit").scrollIntoViewIfNeeded();
    await expect(entity("audit").getByTestId(TESTID.taskSteps)).toHaveText("1/4");
    await entity("audit").locator("summary").click();
    await expect(entity("audit").getByTestId(TESTID.taskStep)).toHaveCount(4);
    await capture("ordinary-substeps");
    await entity("audit").locator("summary").click();
    await entity("layout").scrollIntoViewIfNeeded();
    await entity("visual").getByTestId(TESTID.taskChildrenToggle).click();
    await expect(entity("contrast")).toBeVisible();
    await entity("browser").locator("summary").first().click();
    await expect(entity("browser").locator(":scope > details").getByTestId(TESTID.taskStep)).toHaveCount(5);
    await capture("child-details");
    await entity("browser").locator("summary").first().click();
    await entity("visual").getByTestId(TESTID.taskChildrenToggle).click();
    const updated = expect(entity("layout").getByTestId(TESTID.taskSteps).first()).toHaveText("6/9");
    await page.evaluate(async (id) => {
      await window.omo.request("extension_request", { threadId: id, name: "fake.advance", data: {} });
    }, threadId);
    await updated;
    await expect(entity("layout").locator("summary").first()).toContainText("Inspect screenshots");
    await setTheme(page, "dark");
    await capture("expanded-dark");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(900, 700));
    await expect(page.locator("html")).toHaveJSProperty("clientWidth", 900);
    await expect(byTestId(page, TESTID.composerInput)).toBeVisible();
    await capture("expanded-narrow");
    await page.getByTestId("workflow-close").click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900));
    // Apply locale through the same settings control used by the app.
    await byTestId(page, TESTID.openSettings).click();
    await byTestId(page, TESTID.settingsDialog).locator('[data-section="appearance"]').click();
    await page.getByRole("tab", { name: "한국어", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(chip).toContainText("완료");
    await chip.click();
    await capture("expanded-ko");
    const other = await newSession(page);
    await expect(threadRow(page, other)).toHaveAttribute("aria-current", "page");
    await expect(chip).toHaveCount(0);
    await threadRow(page, threadId).getByRole("button").first().click();
    await expect(panel).toBeVisible();
    expect(launched.readFakeLog().filter((entry) => entry["method"] === "turn/start")).toHaveLength(1);
  } finally {
    await launched.close();
    rmSync(pickDir, { recursive: true, force: true });
  }
});
