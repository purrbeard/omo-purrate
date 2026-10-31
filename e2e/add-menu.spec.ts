import path from "node:path";
import { expect, test } from "@playwright/test";
import { byTestId, launchApp, newSession, send, setTheme, shot, WT, goalCommands, prompts, threadRow } from "./helpers";
import { TESTID } from "../src/ui/testids";

const planSkill = { name: "ulw-plan", description: "Write a plan before implementation.", scope: "system", enabled: true, path: "/fake/ulw-plan/SKILL.md" };

test("a failed delayed send preserves both submitted text and a newer draft", async () => {
  const launched = await launchApp({ omo: "fake", pickDir: WT });
  try {
    const { page, app } = launched;
    await newSession(page);
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      const existing = Reflect.get(ipcMain, "_invokeHandlers").get("omo:request");
      ipcMain.removeHandler("omo:request");
      ipcMain.handle("omo:request", async (event, method: string, params: unknown) => {
        if (method !== "turn/start") return existing(event, method, params);
        let release = (): void => {};
        const pending = new Promise<void>(resolve => { release = resolve; });
        Object.assign(globalThis, { rejectDraftSend: release });
        await BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScript('document.documentElement.dataset.qaSendHeld = "true"');
        await pending;
        return { ok: false, error: { message: "QA send refused" } };
      });
    });
    const input = byTestId(page, TESTID.composerInput);
    await input.fill("original submitted draft");
    await input.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-qa-send-held", "true");
    await input.fill("new draft while sending");
    await app.evaluate(() => Reflect.get(globalThis, "rejectDraftSend")());
    await expect(byTestId(page, TESTID.composerSend)).toBeEnabled();
    await expect(input).toHaveValue("original submitted draft\n\nnew draft while sending");
  } finally { await launched.close(); }
});

test("a delayed goal send stays in its original session and preserves the selected session draft", async () => {
  const launched = await launchApp({ omo: "fake", pickDir: WT });
  try {
    const { page, app } = launched;
    const first = await newSession(page);
    const second = await newSession(page);
    const input = byTestId(page, TESTID.composerInput);
    await input.fill("second session draft");
    await threadRow(page, first).click();
    await byTestId(page, TESTID.modelPicker).click();
    await byTestId(page, TESTID.specificModelTab).click();
    await byTestId(page, TESTID.modelOption).filter({ hasText: "GPT-6 Sol Fast" }).click();
    await page.getByTestId("composer-add").click();
    await page.getByRole("menuitem", { name: /^Goal/ }).click();
    await page.getByTestId("context-dialog-input").fill("goal on first session");
    await page.getByRole("button", { name: "Add goal", exact: true }).click();
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      const existing = Reflect.get(ipcMain, "_invokeHandlers").get("omo:request");
      ipcMain.removeHandler("omo:request");
      ipcMain.handle("omo:request", async (event, method: string, params: { status?: string }) => {
        if (method === "thread/goal/set" && params.status === "paused") {
          let release = (): void => {};
          const ready = new Promise<void>(resolve => { release = resolve; });
          Object.assign(globalThis, { releaseGoalSend: release });
          await BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScript('document.documentElement.dataset.qaGoalHeld = "true"');
          await ready;
        }
        return existing(event, method, params);
      });
    });
    await input.fill("message for first session");
    await input.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-qa-goal-held", "true");
    await threadRow(page, second).click();
    await expect(input).toHaveValue("second session draft");
    await byTestId(page, TESTID.modelPicker).click();
    await byTestId(page, TESTID.specificModelTab).click();
    await byTestId(page, TESTID.modelOption).filter({ hasText: "GPT-6 Astra" }).click();
    await app.evaluate(() => Reflect.get(globalThis, "releaseGoalSend")());
    await expect(byTestId(page, TESTID.composerSend)).toBeEnabled();
    await expect(input).toHaveValue("second session draft");
    await expect(byTestId(page, TESTID.turn)).toHaveCount(0);
    await threadRow(page, first).click();
    await expect(byTestId(page, TESTID.assistantMessage)).toContainText("message for first session");
    await expect(input).toHaveValue("");
    const selections = launched.readFakeLog().filter(entry => entry["type"] === "set_model");
    expect(selections.at(-1)).toMatchObject({ provider: "chatgpt-subscription", modelId: "gpt-6-sol-fast" });
  } finally { await launched.close(); }
});

test("terminal context and goal are attached only on send, then activated in order", async () => {
  const launched = await launchApp({ omo: "fake", pickDir: WT });
  try {
    const { page, readFakeLog } = launched;
    await newSession(page);
    await page.evaluate(async () => { await window.omo.setPreferences({ locale: "en" }); });
    await page.getByTestId("composer-add").click();
    await page.getByRole("menuitem", { name: "Attach terminal text" }).click();
    await page.getByTestId("context-dialog-input").fill("PS> npm test\nTests passed");
    await shot(page, "add-menu-terminal-dialog");
    await page.getByRole("button", { name: "Attach", exact: true }).click();
    await expect(page.getByTestId("context-chip")).toHaveText("WindowsTerminal");
    await page.getByTestId("composer-add").click();
    await page.getByRole("menuitem", { name: /^Goal/ }).click();
    await page.getByTestId("context-dialog-input").fill("Finish the test report");
    await page.getByRole("button", { name: "Add goal", exact: true }).click();
    expect(goalCommands(readFakeLog())).toEqual([]);
    await send(page, "SCENARIO:echo inspect the context");
    await expect(byTestId(page, TESTID.turn).last()).toHaveAttribute("data-status", "completed");
    await expect(page.getByTestId("goal-draft-chip")).toHaveCount(0);
    const log = readFakeLog();
    expect(goalCommands(log)).toEqual(["/goal Finish the test report", "/goal pause", "/goal resume"]);
    const isTurn = (entry: Record<string, unknown>): boolean => entry["type"] === "prompt" && !String(entry["message"]).startsWith("/goal");
    expect(log.findIndex(entry => entry["type"] === "prompt" && entry["message"] === "/goal pause")).toBeLessThan(log.findIndex(isTurn));
    expect(prompts(log)[0]?.message).toContain("PS> npm test");
  } finally { await launched.close(); }
});

test("plan menu invokes the installed skill; sketch produces a PNG and keyboard dismisses the menu", async () => {
  const launched = await launchApp({ omo: "fake", pickDir: WT, extraEnv: { FAKE_OMO_SKILLS: JSON.stringify({ data: [{ cwd: WT, skills: [planSkill], errors: [] }] }) } });
  try {
    const { page, readFakeLog } = launched;
    await newSession(page);
    await page.evaluate(async () => { await window.omo.setPreferences({ locale: "en" }); });
    await page.getByTestId("composer-add").click();
    await expect(page.getByRole("menuitem", { name: /^Plan mode/ })).toBeEnabled();
    await page.getByRole("menuitem", { name: /^Plan mode/ }).click();
    await expect(page.getByTestId("plan-mode-chip")).toBeVisible();
    await page.getByTestId("composer-add").click();
    await page.getByRole("menuitem", { name: "Draw a sketch", exact: true }).click();
    await expect(page.getByRole("button", { name: "Attach sketch", exact: true })).toBeDisabled();
    const canvas = page.locator('canvas');
    const bounds = await canvas.boundingBox();
    if (bounds === null) throw new Error("Missing sketch canvas");
    const paper = await page.locator('canvas').evaluate(element => element.parentElement?.getBoundingClientRect().toJSON());
    if (paper === undefined) throw new Error("Missing sketch paper");
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(paper.bottom);
    await page.mouse.move(bounds.x + 30, bounds.y + 30);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 100, bounds.y + 70);
    await page.mouse.up();
    await shot(page, "add-menu-sketch-drawing");
    const png = await canvas.evaluate(element => {
      if (!(element instanceof HTMLCanvasElement)) throw new Error("Missing sketch canvas");
      return element.toDataURL("image/png").split(",")[1];
    });
    await page.getByRole("button", { name: "Attach sketch", exact: true }).click();
    await expect(byTestId(page, TESTID.attachmentThumbnail)).toHaveCount(1);
    await send(page, "SCENARIO:echo plan the layout");
    await expect(byTestId(page, TESTID.turn).last()).toHaveAttribute("data-status", "completed");
    const log = readFakeLog();
    const message = prompts(log)[0]?.message ?? "";
    expect(message).toMatch(/^\/skill:ulw-plan /);
    expect(log.find(entry => entry["type"] === "prompt" && entry["message"] === message)?.["images"]).toEqual([
      { type: "image", mimeType: "image/png", data: png },
    ]);
    await page.getByTestId("composer-add").click();
    // Escape must reach the open menu: pressed before it opens, the menu would open afterwards and take focus.
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(page.getByTestId("composer-add")).toBeFocused();
  } finally { await launched.close(); }
});

test("native attachment selection and menu layout at desktop and narrow widths", async () => {
  const launched = await launchApp({ omo: "fake", pickDir: WT, extraEnv: { OMO_UI_QA_PICK_ATTACHMENTS: JSON.stringify([`${WT}/package.json`]) } });
  try {
    const { page, readFakeLog } = launched;
    await newSession(page);
    await page.evaluate(async () => { await window.omo.setPreferences({ locale: "en" }); });
    await page.getByTestId("composer-add").click();
    await page.getByRole("menuitem", { name: "Attach files", exact: true }).click();
    await expect(page.getByTestId("context-chip")).toHaveText("package.json");
    await byTestId(page, TESTID.openSettings).click();
    await byTestId(page, TESTID.settingsDialog).locator('[data-section="appearance"]').click();
    await page.getByRole("tab", { name: "한국어", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("언어");
    await page.keyboard.press("Escape");
    for (const theme of ["light", "dark"] as const) {
      await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 850));
      await setTheme(page, theme);
      for (const width of [1280, 640]) {
        await launched.app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]?.setSize(width, 850), width);
        await page.getByTestId("composer-add").click();
        await expect(page.getByRole("menu")).toBeVisible();
        await shot(page, `add-menu-${width}-${theme}`);
        await page.keyboard.press("Escape");
      }
    }
    await send(page, "SCENARIO:echo inspect package");
    await expect(byTestId(page, TESTID.turn).last()).toHaveAttribute("data-status", "completed");
    expect(prompts(readFakeLog())[0]?.message).toContain("package.json");
  } finally { await launched.close(); }
});

test("folder references persist per conversation and installed skills can be selected from Add", async () => {
  const launched = await launchApp({ omo: "fake", pickDir: WT, extraEnv: { OMO_UI_QA_PICK_ATTACHMENTS: JSON.stringify([WT]) } });
  try {
    const { page, readFakeLog } = launched;
    await newSession(page);
    const firstId = await page.locator('[data-testid="thread-row"][aria-current="page"]').getAttribute("data-thread-id");
    await page.getByTestId("composer-add").click();
    await page.getByRole("menuitem", { name: "Attach folder", exact: true }).click();
    await expect(page.getByTestId("context-chip")).toHaveText(path.basename(WT));
    await newSession(page);
    await expect(page.getByTestId("context-chip")).toHaveCount(0);
    if (firstId === null) throw new Error("Missing first thread");
    await page.locator(`[data-testid="thread-row"][data-thread-id="${firstId}"]`).click();
    await expect(page.getByTestId("context-chip")).toHaveText(path.basename(WT));
    await page.getByTestId("composer-add").click();
    await page.getByRole("menuitem", { name: /^ulw-loop/ }).click();
    await expect(byTestId(page, TESTID.composerInput)).toHaveValue("/ulw-loop ");
    await byTestId(page, TESTID.composerInput).fill("/ulw-loop SCENARIO:echo inspect folder");
    await byTestId(page, TESTID.composerInput).press("Enter");
    await expect(byTestId(page, TESTID.turn).last()).toHaveAttribute("data-status", "completed");
    expect(prompts(readFakeLog())[0]?.message).toMatch(/^\/skill:ulw-loop /);
  } finally { await launched.close(); }
});
