import { expect, test } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, newSession, send, setTheme, shot, WT } from "./helpers.ts";

test("workflow graph and background work stay in the same conversation after main completion", async () => {
  const launched = await launchApp({ omo: "fake", pickDir: WT, size: { width: 1440, height: 900 } });
  const { page, app } = launched;
  try {
    const id = await newSession(page);
    const input = byTestId(page, TESTID.composerInput);
    await input.fill("mass ulw: SCENARIO:workflow-background");
    await expect(byTestId(page, TESTID.keywordHint)).toBeVisible();
    const background = page.getByTestId("background-work-strip");
    const arrived = expect(background).toBeVisible();
    await input.press("Enter");
    await arrived;
    await expect(byTestId(page, TESTID.workingIndicator)).toHaveCount(0);
    await expect(byTestId(page, TESTID.assistantMessage)).toContainText("Background workflow started.");
    const log = page.getByTestId("turn-work-log").first();
    await expect(log).not.toHaveAttribute("open", "");
    await log.locator(":scope > summary").click();
    await expect(log.getByTestId(TESTID.toolCard)).toBeVisible();
    await log.locator(":scope > summary").click();
    await background.click();
    const panel = page.getByTestId("workflow-panel");
    await expect(panel).toHaveAttribute("data-placement", "docked");
    await page.getByTestId("workflow-widen").click();
    await expect(panel).toHaveAttribute("data-size", "wide");
    await expect(panel).toHaveAttribute("data-placement", "docked");
    await page.getByTestId("workflow-maximize").click();
    await expect(panel).toHaveAttribute("data-size", "maximized");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1920, 900));
    await shot(page, "workflow-selected-maximized");
    await page.getByTestId("workflow-maximize").click();
    await expect(panel).toHaveAttribute("data-size", "normal");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900));
    await page.getByTestId("workflow-graph-view").click();
    await expect(page.getByTestId("workflow-graph-node")).toHaveCount(7);
    await page.getByTestId("workflow-graph-node").filter({ hasText: "Build compact panel" }).click();
    await expect(panel.getByTestId("workflow-node-detail")).toContainText("Build compact panel");
    await expect(panel.getByTestId(TESTID.omoTask)).toHaveCount(0);
    await expect(panel.getByTestId("workflow-activity-log")).not.toBeVisible();
    const graph = page.getByTestId("workflow-graph");
    const zoom = graph.getByRole("status");
    const fitZoom = await zoom.textContent();
    await graph.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(zoom).not.toHaveText(fitZoom ?? "");
    await graph.getByRole("button", { name: "Fit", exact: true }).click();
    await expect(zoom).toHaveText(fitZoom ?? "");
    expect(await graph.evaluate(element => {
      const stage = element.querySelector('[class*="stage"]');
      return stage === null || stage.getBoundingClientRect().width <= (stage.parentElement?.clientWidth ?? 0) + 1;
    })).toBe(true);
    const firstNode = page.getByTestId("workflow-graph-node").filter({ hasText: "Read protocol" });
    await firstNode.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("workflow-graph-node").filter({ hasText: "Validate events" })).toBeFocused();
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      await shot(page, `workflow-${theme}-desktop-graph`);
      await page.getByTestId("workflow-list").click();
      await shot(page, `workflow-${theme}-desktop-list`);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(640, 760));
      await expect(panel).toHaveAttribute("data-placement", "overlay");
      await expect(page.getByTestId("workflow-close")).toBeFocused();
      await page.getByTestId("workflow-log-view").click();
      await page.getByTestId("workflow-list").click();
      await shot(page, `workflow-${theme}-narrow-list`);
      await page.getByTestId("workflow-graph-view").click();
      await shot(page, `workflow-${theme}-narrow-graph`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.getByTestId("workflow-close").click();
      await background.click();
      await expect(page.getByTestId("workflow-close")).toBeFocused();
      await page.getByTestId("workflow-log-view").click();
      const firstControl = page.getByTestId("workflow-files");
      const lastControl = page.getByTestId("workflow-activity-log").locator(":scope > summary");
      await panel.evaluate(element => {
        const closed = document.createElement("details");
        closed.innerHTML = '<summary tabindex="-1">Hidden work</summary><button>Hidden action</button>';
        element.append(closed);
      });
      await lastControl.focus();
      await page.keyboard.press("Tab");
      await expect(firstControl).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(lastControl).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
      await expect(background).toBeFocused();
      await expect(input).toBeVisible();
      await background.click();
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900));
      await expect(panel).toHaveAttribute("data-placement", "docked");
    }
    await page.getByTestId("workflow-files").click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId("workspace-panel")).toBeVisible();
    await byTestId(page, TESTID.omoActivityToggle).click();
    await expect(panel).toBeVisible();
    await page.getByTestId("workflow-close").click();
    await send(page, "Keep going");
    await expect(byTestId(page, TESTID.assistantMessage).last()).toBeVisible();
    await expect(background).toBeVisible();
    await background.click();
    await page.getByTestId("workflow-log-view").click();
    await expect(page.getByTestId("workflow-activity-entry")).toHaveCount(0);
    const finished = expect(background).toHaveCount(0);
    await page.evaluate(async threadId => {
      await window.omo.request("extension_request", { threadId, name: "fake.advance", data: {} });
      await window.omo.request("extension_request", { threadId, name: "fake.advance", data: {} });
    }, id);
    await finished;
    await expect(page.getByTestId("workflow-activity-entry").filter({ hasText: "Build compact panel" })).toHaveAttribute("data-state", "completed");
    await shot(page, "workflow-selected-activity");
    expect(launched.readFakeLog().filter(entry => entry["method"] === "thread/start")).toHaveLength(1);
    const turns = launched.readFakeLog().filter(entry => entry["method"] === "turn/start");
    expect(turns).toHaveLength(2);
    expect(turns[0]?.["params"]).toMatchObject({ threadId: id, input: [{ type: "text", text: "mass ulw: SCENARIO:workflow-background" }] });
  } finally { await launched.close(); }
});

test("ordinary tasks never become graph nodes and stay in their request groups", async () => {
  const launched = await launchApp({ omo: "fake", pickDir: WT });
  const { page } = launched;
  try {
    const id = await newSession(page);
    await send(page, "Ordinary request");
    await launched.app.evaluate(({ BrowserWindow }, threadId) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send("omo:notification", {
        method: "extension_event", params: { type: "extension_event", threadId, name: "omo.task.updated", data: {
          parent_session_id: threadId,
          tasks: [{ task_id: "ordinary-task", status: "completed", execution_mode: "in-process", model: "fixture", depth: 1,
            created_at: new Date().toISOString(), updated_at: new Date().toISOString(), task_summary: "Ordinary agent", residency_state: "disposed" }],
        } },
      });
    }, id);
    await byTestId(page, TESTID.omoActivityToggle).click();
    const panel = page.getByTestId("workflow-panel");
    await expect(panel.getByTestId(TESTID.omoTask)).toHaveCount(0);
    await page.getByTestId("workflow-list").click();
    await expect(panel.getByTestId(TESTID.omoTask)).not.toHaveCount(0);
    await expect(panel.getByTestId("workflow-task-group")).not.toHaveCount(0);
    await page.getByTestId("workflow-log-view").click();
    await expect(panel.getByTestId(TESTID.omoTask)).toHaveCount(0);
    await expect(panel.getByTestId("workflow-activity-log")).toBeVisible();
    expect(launched.readFakeLog().filter(entry => entry["method"] === "thread/start")).toHaveLength(1);
  } finally { await launched.close(); }
});
