import path from "node:path";
import { expect, test } from "@playwright/test";
import { byTestId, launchApp, newSession, send, setTheme, shot, WT } from "./helpers";
import { TESTID } from "../src/ui/testids";

const planSkill = { name: "ulw-plan", description: "Write a plan before implementation.", scope: "system", enabled: true, path: "/fake/ulw-plan/SKILL.md" };

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
    expect(readFakeLog().filter(entry => entry["method"] === "thread/goal/set")).toHaveLength(0);
    await send(page, "SCENARIO:echo inspect the context");
    await expect(byTestId(page, TESTID.turn).last()).toHaveAttribute("data-status", "completed");
    await expect(page.getByTestId("goal-draft-chip")).toHaveCount(0);
    const log = readFakeLog();
    const goals = log.filter(entry => entry["method"] === "thread/goal/set");
    expect(goals.map(entry => (entry["params"] as { status: string }).status)).toEqual(["paused", "active"]);
    expect(log.findIndex(entry => entry["method"] === "thread/goal/set")).toBeLessThan(log.findIndex(entry => entry["method"] === "turn/start"));
    const input = (log.find(entry => entry["method"] === "turn/start")?.["params"] as { input: unknown }).input;
    expect(input).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text", text: expect.stringContaining("PS> npm test") })]));
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
    await page.getByRole("button", { name: "Attach sketch", exact: true }).click();
    await expect(byTestId(page, TESTID.attachmentThumbnail)).toHaveCount(1);
    await send(page, "SCENARIO:echo plan the layout");
    await expect(byTestId(page, TESTID.turn).last()).toHaveAttribute("data-status", "completed");
    const input = (readFakeLog().find(entry => entry["method"] === "turn/start")?.["params"] as { input: unknown }).input;
    expect(input).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text", text: expect.stringMatching(/^\/skill:ulw-plan /) })]));
    expect(JSON.stringify(input)).toContain(".png");
    await page.getByTestId("composer-add").click();
    await page.keyboard.press("Escape");
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
    expect((readFakeLog().find(entry => entry["method"] === "turn/start")?.["params"] as { input: unknown }).input).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text", text: expect.stringContaining("package.json") })]));
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
    expect((readFakeLog().find(entry => entry["method"] === "turn/start")?.["params"] as { input: unknown }).input).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text", text: expect.stringMatching(/^\/skill:ulw-loop /) })]));
  } finally { await launched.close(); }
});
