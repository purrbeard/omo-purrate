import { quarantineSync } from "../scripts/quarantine-temp.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { TESTID } from "../src/ui/testids.ts";
import { byTestId, launchApp, shot, tempDir, threadRow, type LaunchedApp } from "./helpers.ts";

test.use({ trace: { mode: "retain-on-failure", snapshots: false } });

const LONG_ID = "timeline-session";
const TURNS = 90;

let launched: LaunchedApp | null = null;
let pickDir = "";

const current = (): LaunchedApp => {
  if (launched === null) throw new Error("the app is not running");
  return launched;
};

const step = (page: Page, n: number): Locator => byTestId(page, TESTID.turn).filter({ hasText: `Step ${n}: check how` });

/** The turn's top edge measured from the transcript scroller's top edge. */
function offsetFromTop(turn: Locator): Promise<number> {
  return turn.evaluate((element) => {
    let scroller = element.parentElement;
    while (scroller !== null && getComputedStyle(scroller).overflowY !== "auto") scroller = scroller.parentElement;
    if (scroller === null) throw new Error("no transcript scroller");
    return Math.round(element.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
  });
}

/** A smooth jump settles over a few frames, so the landing position is polled until it is just below the top edge. */
async function expectLanded(turn: Locator): Promise<void> {
  await expect.poll(() => offsetFromTop(turn)).toBeGreaterThanOrEqual(20);
  await expect.poll(() => offsetFromTop(turn)).toBeLessThanOrEqual(28);
}

async function pointAt(page: Page, index: number): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId("timeline-minimap-rail").boundingBox();
  if (box === null) throw new Error("the timeline rail is not laid out");
  return { x: box.x + box.width / 2, y: box.y + (box.height * index) / (TURNS - 1) };
}

test.beforeAll(async () => {
  pickDir = tempDir("timeline");
  launched = await launchApp({
    omo: "fake",
    pickDir,
    managed: [LONG_ID],
    size: { width: 1280, height: 860 },
    extraEnv: { FAKE_OMO_LONG_SESSION: JSON.stringify({ id: LONG_ID, cwd: pickDir, turns: TURNS, toolCalls: 3 }) },
  });
});

test.afterAll(async () => {
  await launched?.close();
  launched = null;
  if (pickDir !== "") quarantineSync(pickDir, { recursive: true, force: true });
});

test("the timeline rail previews a message and jumps to it, past the lazily rendered window", async () => {
  // Given: a 90-turn session, of which the transcript renders the latest 40.
  const { page } = current();
  await threadRow(page, LONG_ID).getByRole("button").first().click();
  await expect(step(page, TURNS)).toBeAttached();
  await expect(byTestId(page, TESTID.turn)).toHaveCount(40);
  await expect(step(page, 5)).toHaveCount(0);
  await expect(page.getByTestId("timeline-minimap-tick")).toHaveCount(TURNS);

  // When: hovering the fifth tick
  const fifth = await pointAt(page, 4);
  await page.mouse.move(fifth.x, fifth.y);
  // Then: it previews that message
  await expect(page.getByTestId("timeline-minimap-preview")).toContainText("Step 5: check how the cart totals are computed.");
  await shot(page, "timeline-minimap-preview");

  // When: clicking it
  await page.mouse.click(fifth.x, fifth.y);
  // Then: the window widens to that turn and the turn sits just below the top edge, marked as the jump target.
  await expect(step(page, 5)).toHaveAttribute("data-jump-target", "true");
  await expectLanded(step(page, 5));
  await expect(page.getByTestId("timeline-minimap-tick").nth(4)).toHaveAttribute("data-in-view", "true");
  await shot(page, "timeline-minimap-jumped");

  // When / Then: the previous-turn arrow steps one message back.
  await page.getByTestId("timeline-minimap-previous").click();
  await expect(step(page, 4)).toHaveAttribute("data-jump-target", "true");
  await expectLanded(step(page, 4));

  // When / Then: the keyboard picks the first message.
  await page.getByTestId("timeline-minimap-rail").focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(step(page, 1)).toHaveAttribute("data-jump-target", "true");
  await expectLanded(step(page, 1));
});

test("loading the preceding history page keeps the current reading anchor", async () => {
  const { page } = current();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-bridge-state", "connected");
  await threadRow(page, LONG_ID).getByRole("button").first().click();
  await expect(step(page, 51)).toBeAttached();
  await page.getByTestId("show-earlier-turns").scrollIntoViewIfNeeded();
  const before = await offsetFromTop(step(page, 51));
  await page.getByTestId("show-earlier-turns").click();
  await expect(step(page, 11)).toBeAttached();
  await expect.poll(async () => Math.abs(await offsetFromTop(step(page, 51)) - before)).toBeLessThanOrEqual(2);
});

test("opening a large historical tool item fetches its complete result and image-only output", async () => {
  const root = test.info().outputPath("tool-page");
  const home = path.join(root, "agent"), sessions = path.join(home, "sessions");
  mkdirSync(sessions, { recursive: true });
  const id = "tool-page-session";
  const output = "large result ".repeat(8_000) + " FULL_RESULT_END";
  const file = path.join(sessions, `${id}.jsonl`);
  writeFileSync(file, [
    { type: "session", version: 3, id, cwd: pickDir, timestamp: "2026-11-01T00:00:00Z" },
    { type: "message", id: "u", parentId: null, message: { role: "user", content: "Inspect large result" } },
    { type: "message", id: "a", parentId: "u", message: { role: "assistant", content: [{ type: "toolCall", id: "large", name: "read", arguments: { path: "test.log" } }, { type: "toolCall", id: "image-only", name: "image", arguments: {} }] } },
    { type: "message", id: "r", parentId: "a", message: { role: "toolResult", toolCallId: "large", toolName: "read", content: [{ type: "text", text: output }] } },
    { type: "message", id: "image", parentId: "r", message: { role: "toolResult", toolCallId: "image-only", toolName: "image", content: [{ type: "image", mimeType: "image/svg+xml", data: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><!--${"x".repeat(64_000)}--><rect width="10" height="10" fill="blue"/></svg>`).toString("base64") }] } },
    { type: "message", id: "done", parentId: "image", message: { role: "assistant", content: "Result ready", stopReason: "stop" } },
  ].map(record => JSON.stringify(record)).join("\n") + "\n");
  const original = readFileSync(file, "utf8");
  const isolated = await launchApp({ omo: "fake", fakeHome: home, managed: [id], pickDir });
  try {
    await threadRow(isolated.page, id).getByRole("button").first().click();
    await expect(isolated.page.getByText("Result ready", { exact: true })).toBeVisible();
    await isolated.page.getByTestId("turn-work-log").locator("summary").click();
    const card = isolated.page.locator('[data-testid="tool-card"][data-item-id="large"]');
    await card.getByRole("button").first().click();
    await expect(card).toContainText("FULL_RESULT_END");
    const image = isolated.page.locator('[data-testid="tool-card"][data-item-id="image-only"]');
    await image.getByRole("button").first().click();
    await expect(image.locator("img")).toBeVisible();
    expect(readFileSync(file, "utf8")).toBe(original);
  } finally { await isolated.close(); }
});
