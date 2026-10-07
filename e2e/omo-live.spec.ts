import { rmSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, lastTurn, launchApp, newSession, send, setTheme, shot, tempDir, threadRow, type LaunchedApp } from "./helpers.ts";

test.describe.configure({ mode: "serial" });

let fakeHome = "";
let userData = "";
let pickDir = "";
let launched: LaunchedApp | null = null;
let threadId = "";

const current = (): LaunchedApp => {
  if (launched === null) throw new Error("the app is not running");
  return launched;
};

const start = async (): Promise<void> => {
  launched = await launchApp({ omo: "fake", fakeHome, userData, pickDir, size: { width: 1440, height: 900 } });
};

const node = (page: Page, id: string) => page.locator(`[data-testid="${TESTID.dagNode}"][data-node-id="${id}"]`);
// A DAG node and its backing task now share one row instead of rendering duplicate task cards.
const task = (page: Page, id: string) => byTestId(page, TESTID.omoActivity).locator(`[data-task-id="task-${id}"]`);

const advance = async (page: Page): Promise<void> => {
  await page.evaluate(async (id) => {
    await window.omo.request("extension_request", { threadId: id, name: "fake.advance", data: {} });
  }, threadId);
};

test.beforeAll(async () => {
  fakeHome = tempDir("live-fake-home");
  userData = tempDir("live-user-data");
  pickDir = tempDir("live-workspace");
  await start();
});

test.afterAll(async () => {
  try {
    await launched?.close();
  } finally {
    launched = null;
    for (const dir of [fakeHome, userData, pickDir]) if (dir !== "") rmSync(dir, { recursive: true, force: true });
  }
});

test("live stages show DAG states, child output, todo and goal across themes and widths", async () => {
  const { page, app } = current();
  await setTheme(page, "light");
  threadId = await newSession(page);
  const started = expect(byTestId(page, TESTID.omoActivityToggle)).toBeVisible();
  await send(page, "SCENARIO:omo-live");
  await started;
  await byTestId(page, TESTID.omoActivityToggle).click();
  await page.getByTestId("workflow-list").click();

  const run = byTestId(page, TESTID.dagRun);
  await expect(run).toContainText("mass-ulw display");
  await expect(run).toHaveAttribute("data-status", "running");
  await expect(node(page, "A")).toHaveAttribute("data-state", "running");
  await expect(node(page, "B")).toHaveAttribute("data-state", "blocked");
  await expect(node(page, "C")).toHaveAttribute("data-state", "blocked");
  await expect(task(page, "A")).toHaveAttribute("data-status", "running");
  await expect(task(page, "A")).toContainText("Execute A");

  const secondStage = expect(node(page, "B")).toHaveAttribute("data-state", "running");
  await advance(page);
  await secondStage;
  await expect(node(page, "A")).toHaveAttribute("data-state", "completed");
  await expect(node(page, "B")).toContainText("implementing");
  await expect(node(page, "C")).toHaveAttribute("data-state", "scheduled");
  await expect(task(page, "A")).toHaveAttribute("data-status", "completed");
  await expect(task(page, "A")).toContainText("A completed");
  await expect(task(page, "B")).toHaveAttribute("data-status", "running");
  await expect(task(page, "B")).toContainText("working");

  const dock = byTestId(page, TESTID.todoDock);
  await expect(dock).toBeVisible();
  await dock.getByRole("button").click();
  await expect(byTestId(page, TESTID.todoPhase)).toHaveCount(2);
  await expect(byTestId(page, TESTID.todoPhase).nth(0)).toContainText("Implementation");
  await expect(byTestId(page, TESTID.todoPhase).nth(1)).toContainText("Verification");
  await expect(page.locator(`[data-testid="${TESTID.todoItem}"][data-status="abandoned"]`)).toContainText("Verify B");
  await expect(byTestId(page, TESTID.goalStrip)).toContainText("Ship the OmO UI app");
  await expect(byTestId(page, TESTID.goalStrip)).toHaveAttribute("data-status", "active");
  await shot(page, "C001-live-light");
  await setTheme(page, "dark");
  await shot(page, "C001-live-dark");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(760, 600));
  await expect(page.locator("html")).toHaveJSProperty("clientWidth", 760);
  await page.getByTestId("workflow-close").click();
  await expect(byTestId(page, TESTID.composerInput)).toBeVisible();
  await expect(byTestId(page, TESTID.composerInput)).toBeEnabled();
  await shot(page, "C001-narrow");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900));
  await setTheme(page, "light");
});

test("thread switching isolates activity and final failure clears the goal", async () => {
  const { page } = current();
  const secondThread = await newSession(page);
  const settled = expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
  await send(page, "A plain isolated session");
  await settled;
  await expect(threadRow(page, secondThread)).toHaveAttribute("aria-current", "page");
  for (const id of [TESTID.omoActivityToggle, TESTID.dagRun, TESTID.omoTask, TESTID.todoDock, TESTID.goalStrip]) {
    await expect(byTestId(page, id)).toHaveCount(0);
  }
  await threadRow(page, threadId).getByRole("button").first().click();
  await expect(byTestId(page, TESTID.omoActivityToggle)).toBeVisible();
  if (await byTestId(page, TESTID.omoActivityToggle).getAttribute("aria-expanded") === "false") {
    await byTestId(page, TESTID.omoActivityToggle).click();
  }
  await page.getByTestId("workflow-list").click();
  await expect(byTestId(page, TESTID.dagRun)).toHaveAttribute("data-status", "running");
  await expect(task(page, "A")).toHaveAttribute("data-status", "completed");
  await expect(task(page, "B")).toHaveAttribute("data-status", "running");
  await expect(byTestId(page, TESTID.todoDock)).toBeVisible();
  await expect(byTestId(page, TESTID.goalStrip)).toHaveAttribute("data-status", "active");
  await shot(page, "C002-switch");

  const failed = expect(node(page, "B")).toHaveAttribute("data-state", "failed");
  const cleared = expect(byTestId(page, TESTID.goalStrip)).toHaveCount(0);
  await advance(page);
  await Promise.all([failed, cleared]);
  await expect(node(page, "B")).toContainText("402: Insufficient Balance");
  await expect(node(page, "C")).toHaveAttribute("data-state", "skipped");
  await expect(byTestId(page, TESTID.dagRun)).toHaveAttribute("data-status", "failed");
  await expect(task(page, "B")).toHaveAttribute("data-status", "error");
  await expect(task(page, "B")).toContainText("402: Insufficient Balance");
  await expect(lastTurn(page)).toHaveAttribute("data-status", "completed");
});

test("relaunch restores phased todo and task receipts without live spinners or a new turn", async () => {
  await current().close();
  launched = null;
  await start();
  const { page, readFakeLog } = current();
  const turnsBefore = readFakeLog().filter((entry) => entry["method"] === "turn/start").length;
  const row = threadRow(page, threadId);
  await expect(row).toBeVisible();
  await row.getByRole("button").first().click();
  await expect(row).toHaveAttribute("aria-current", "page");
  const dock = byTestId(page, TESTID.todoDock);
  await expect(dock).toHaveAttribute("data-source", "history");
  await expect(dock).toContainText("restored");
  await dock.getByRole("button").click();
  await expect(byTestId(page, TESTID.todoPhase)).toHaveCount(2);
  await expect(byTestId(page, TESTID.todoPhase).nth(0)).toContainText("Implementation");
  await expect(byTestId(page, TESTID.todoPhase).nth(1)).toContainText("Verification");
  await expect(page.locator(`[data-testid="${TESTID.todoItem}"][data-status="abandoned"]`)).toContainText("Verify B");
  await expect(byTestId(page, TESTID.omoActivityToggle)).toBeVisible();
  await byTestId(page, TESTID.omoActivityToggle).click();
  await expect(byTestId(page, TESTID.omoTask)).toHaveCount(2);
  for (const [id, status] of [["A", "completed"], ["B", "error"]] as const) {
    await expect(task(page, id)).toHaveAttribute("data-source", "history");
    await expect(task(page, id)).toHaveAttribute("data-status", status);
    await expect(task(page, id)).toContainText("restored");
  }
  await expect(task(page, "A")).toContainText("A completed");
  await expect(task(page, "B")).toContainText("402: Insufficient Balance");
  await expect(byTestId(page, TESTID.dagRun)).toHaveCount(0);
  await expect(byTestId(page, TESTID.omoActivity).locator('[data-state="ongoing"]')).toHaveCount(0);
  await expect(byTestId(page, TESTID.omoActivityToggle).locator('[data-state="ongoing"]')).toHaveCount(0);
  await expect(byTestId(page, TESTID.goalStrip)).toHaveCount(0);
  expect(readFakeLog().filter((entry) => entry["method"] === "turn/start")).toHaveLength(turnsBefore);
  await shot(page, "C002-restored");
});
